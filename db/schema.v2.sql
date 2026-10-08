-- v2：多位獨立老師共用同一個 LINE 官方帳號與同一個網站，但學生、上班時間、排課、通知彼此完全分開。
-- 取代 v1（多租戶／多工作室）；與更早期「單一工作室共用學生」的設計也不同，見下方各表的 teacher_id。
-- 學生沒有 Supabase 登入：所有學生端寫入走伺服器 API（驗證 LIFF ID Token 後以 service role 寫入）。
create extension if not exists pgcrypto;

create table teachers (            -- 可登入管理頁的老師（以 LINE userId 白名單）；新增老師＝手動加一筆
  id uuid primary key default gen_random_uuid(),
  name text not null, line_user_id text unique, is_main boolean default false
);
create table substitute_names (    -- 每位老師自己記住的代課老師名稱（可刪除），老師之間不共用
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers,
  name text not null,
  unique (teacher_id, name)
);
create table students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers,   -- 學生屬於哪位老師；老師之間互相看不到對方的學生
  name text not null,
  lesson_credits int not null default 0 check (lesson_credits >= 0), -- 累計購買堂數；剩餘＝此值－active lessons
  line_user_id text unique,        -- 來自 LIFF（須與官方帳號同一 Provider）
  line_group_id text,              -- 該學生的 LINE 群組（目前通知改以「分享到 LINE」為主，群組非必要）
  consent_at timestamptz
  -- 沒有 hidden 欄位：不需要的學生直接刪除整列，不保留歷史，要重收就重新登錄。
);
create table line_groups (         -- 官方帳號被邀請進的群組；未綁定者出現在「尚未綁定的群組」清單
  group_id text primary key, name text,
  student_id uuid references students, joined_at timestamptz default now()
  -- 注意：綁定前還不知道屬於哪位老師，目前先讓所有老師都能在管理頁看到未綁定群組並自行認領。
);
create table periods (             -- 每位老師自己的每月選課週期
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers,
  ym text not null,                -- '2026-11'
  status text not null default 'collecting' check (status in ('collecting','draft','approved','notified')),
  deadline date not null, reminded_at timestamptz,
  unique (teacher_id, ym)
);
create table weekly_blocks (       -- 老師自己的固定封鎖時段（例：每週三 16:00–17:00），可編輯、很少變動
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers,
  weekday int not null check (weekday between 0 and 6), start_min int not null, end_min int not null, label text
);
-- 老師與學生「可以的時段」用同一種格式：逐小時一列；沒有列＝不行。owner_id 指向 teachers.id 或 students.id，
-- 兩者都已經各自綁定 teacher_id，查詢時用 owner_id 關聯回去即可知道屬於哪位老師。
create table slots (
  owner_type text not null check (owner_type in ('teacher','student')),
  owner_id uuid not null, date date not null, start_min int not null,
  filled_by_teacher boolean default false,   -- 老師代填
  primary key (owner_type, owner_id, date, start_min)
);
create table lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers,   -- 冗余存一份，方便查詢與下面的衝堂檢查
  period_id uuid not null references periods, student_id uuid not null references students,
  date date not null, start_min int not null,
  teacher_name text,               -- null = 老師自己授課；有值 = 代課老師（自由輸入，不綁定其他老師帳號）
  status text not null default 'active' check (status in ('active','cancelled'))
);
-- 同一位老師自己名下、同時段不衝堂（null 視為老師自己授課）；不同老師之間互不影響
create unique index lessons_no_clash on lessons (teacher_id, date, start_min, coalesce(teacher_name,'')) where status='active';
create table unassigned (          -- 待補其他老師／順延
  id uuid primary key default gen_random_uuid(), period_id uuid references periods,
  student_id uuid references students, week_start date, reason text
);
create table message_log (         -- 發送紀錄（kind: notify | remind），不論是推播還是老師自己分享／複製都可以記一筆
  id uuid primary key default gen_random_uuid(), kind text, student_id uuid, text text, sent_at timestamptz default now()
);
