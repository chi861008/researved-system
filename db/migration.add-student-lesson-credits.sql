-- 每位學生的累計購買堂數。應用程式以 lesson_credits - active lessons 算出剩餘堂數，
-- 因此重新排課刪除尚未確認的課時，堂數會自然退回，不會重複扣除。
alter table students
  add column if not exists lesson_credits integer not null default 0
  check (lesson_credits >= 0);
