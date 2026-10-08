-- 暫停排課保留學生堂數、LINE 綁定與歷史資料，只排除後續排課與提醒。
alter table students
  add column if not exists scheduling_paused boolean not null default false;
