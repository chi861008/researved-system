-- 老師先建立學生後，給學生一人一組的一次性加入連結。
-- LINE 綁定成功後，API 會把 token 清空，避免連結被其他人重複使用。
alter table students
  add column if not exists invite_token text unique;
