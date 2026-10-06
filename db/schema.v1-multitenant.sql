-- Supabase / PostgreSQL 結構：多工作室(tenant)，以 Row Level Security 做資料隔離
create extension if not exists pgcrypto;

create table studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Taipei',
  lesson_minutes int not null default 60,
  weekly_lessons int not null default 1,
  created_at timestamptz default now()
);

-- 工作室成員：對應 Supabase Auth 使用者（老師／管理者）
create table studio_members (
  studio_id uuid references studios on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner','teacher')),
  primary key (studio_id, user_id)
);

create table teachers (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  user_id uuid references auth.users,           -- 該老師若有登入帳號
  name text not null,
  priority int not null default 99,             -- 代課順序，數字小者優先
  active boolean default true
);

create table students (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  name text not null,
  line_user_id text,                            -- LIFF 取得，須與發訊的官方帳號同 Provider
  primary_teacher_id uuid references teachers,
  consent_at timestamptz,                       -- 個資同意時間
  unique (studio_id, line_user_id)
);

-- 工作室固定封鎖（例：每週三 16:00-17:00 公司開會）
create table weekly_blocks (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_min int not null, end_min int not null,
  label text
);

-- 老師當月上班時段與臨時不可用時段
create table teacher_windows (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  teacher_id uuid not null references teachers on delete cascade,
  date date not null, start_min int not null, end_min int not null,
  kind text not null default 'work' check (kind in ('work','block'))
);

-- 排課週期（例：2026 年 10 月）
create table scheduling_periods (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  title text not null,
  from_date date not null, to_date date not null,
  student_deadline date,
  status text not null default 'collecting'
    check (status in ('collecting','draft','approved','notified'))
);

-- 學生勾選的可上課時段
create table student_availability (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  period_id uuid not null references scheduling_periods on delete cascade,
  student_id uuid not null references students on delete cascade,
  date date not null, start_min int not null, end_min int not null
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  period_id uuid not null references scheduling_periods on delete cascade,
  student_id uuid not null references students,
  teacher_id uuid not null references teachers,
  date date not null, start_min int not null,
  locked boolean default false,                 -- 老師手動鎖定，重排不會動
  status text not null default 'draft' check (status in ('draft','approved','cancelled')),
  notified_at timestamptz,
  unique (studio_id, teacher_id, date, start_min) -- 資料庫層也防止同老師衝堂
);

-- 每間工作室自己的 LINE 設定。金鑰必須加密後存放（建議 Supabase Vault 或應用層 AES-GCM）
create table line_channels (
  studio_id uuid primary key references studios on delete cascade,
  channel_id text, liff_id text,
  secret_encrypted text, access_token_encrypted text
);

-- ============ Row Level Security ============
create or replace function is_member(sid uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from studio_members where studio_id = sid and user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['teachers','students','weekly_blocks','teacher_windows',
    'scheduling_periods','student_availability','lessons','line_channels'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "member_all" on %I for all using (is_member(studio_id)) with check (is_member(studio_id))', t);
  end loop;
end $$;

alter table studios enable row level security;
create policy "member_read" on studios for select using (is_member(id));
alter table studio_members enable row level security;
create policy "self_read" on studio_members for select using (user_id = auth.uid());

-- 注意：學生透過 LIFF 提交時段時「沒有 Supabase 登入」，
-- 必須走伺服器端 API：先驗證 LIFF ID Token，再用 service role 寫入，不要對學生開放資料表權限。
