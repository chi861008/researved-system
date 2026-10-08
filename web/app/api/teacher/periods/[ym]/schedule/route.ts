import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rowsToSlotSet } from '@/lib/supabaseSlots';
import { addDays, datesBetween, runScheduling, weekStartOf, windowList } from '@/lib/scheduling';
import { ymFrom, ymEnd, STUDIO_STARTS, LESSON_MINUTES } from '@/lib/ym';

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 伺服器端重新讀取最新資料、呼叫跟展示模式一樣的 runScheduling()（lib/scheduling.ts，完全重用），
// 這樣真老師的排課結果不會因為瀏覽器裡的舊資料而跟資料庫兜不起來。整批覆蓋這個月的 lessons／unassigned。
export async function POST(_req: Request, { params }: { params: Promise<{ ym: string }> }) {
  const { ym } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { data: period } = await supabase.from('periods').select('id,status').eq('teacher_id', session.id).eq('ym', ym).maybeSingle();
  if (!period) return NextResponse.json({ error: '這個月還沒開放選課' }, { status: 404 });
  if (period.status !== 'collecting') return NextResponse.json({ error: '這個月已經排過課；如需重排，請先按「重新排課」。' }, { status: 409 });

  const [{ data: students }, { data: teacherSlots }] = await Promise.all([
    supabase.from('students').select('id,name,lesson_credits').eq('teacher_id', session.id).eq('scheduling_paused', false),
    // 只看目前排課月份。老師其他月份即使有上班時段，也不能讓這個完全空白的月份通過排課檢查。
    supabase.from('slots').select('date,start_min').eq('owner_type', 'teacher').eq('owner_id', session.id)
      .gte('date', ymFrom(ym)).lte('date', ymEnd(ym)),
  ]);
  // 老師把上班時段全部取消掉（例如改時段時手滑清空）卻忘記重設，這時候排課只會把每個人都排成
  // 「待補」，看起來像排課失敗，其實是還沒設定時段——直接擋下、提醒她回去設定，比排一堆待補清楚。
  if (!teacherSlots?.length) return NextResponse.json({ error: '這個月還沒有設定上班時段，請先到「上班時間」設定後再排課。' }, { status: 409 });

  const studentIds = (students ?? []).map(s => s.id);
  const activeCreditLessons: { id: string; student_id: string }[] = [];
  if (studentIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('lessons').select('id,student_id')
        .eq('teacher_id', session.id).eq('status', 'active').in('student_id', studentIds)
        .order('id').range(from, from + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      activeCreditLessons.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  const usedCredits = new Map<string, number>();
  for (const l of activeCreditLessons) usedCredits.set(l.student_id, (usedCredits.get(l.student_id) ?? 0) + 1);
  const remainingBefore = new Map<string, number>();
  const schedStudents = (students ?? []).map(s => {
    const remainingLessons = Math.max(0, (s.lesson_credits ?? 0) - (usedCredits.get(s.id) ?? 0));
    remainingBefore.set(s.id, remainingLessons);
    return { id: s.id, name: s.name, remainingLessons };
  });
  // 只讀目前排課月份，並且每 1,000 筆分頁讀到完。只縮小月份還不夠：未來學生變多時，
  // 單月仍可能超過 Supabase 單次回傳上限，不能再讓排在後面的學生靜默消失。
  const studentSlotRows: { owner_id: string; date: string; start_min: number }[] = [];
  if (studentIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('slots').select('owner_id,date,start_min')
        .eq('owner_type', 'student').in('owner_id', studentIds)
        .gte('date', ymFrom(ym)).lte('date', ymEnd(ym))
        .order('owner_id').order('date').order('start_min').range(from, from + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      studentSlotRows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  const studentAvailability = new Map<string, Set<string>>();
  for (const id of studentIds) studentAvailability.set(id, new Set());
  for (const row of studentSlotRows) studentAvailability.get(row.owner_id)?.add(`${row.date}|${row.start_min}`);

  const { data: otherPeriods } = await supabase.from('periods').select('id').eq('teacher_id', session.id).neq('id', period.id);
  const otherIds = (otherPeriods ?? []).map(p => p.id);
  const otherLessons: { id: string; student_id: string; date: string }[] = [];
  if (otherIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('lessons').select('id,student_id,date')
        .eq('status', 'active').in('period_id', otherIds)
        .gte('date', ymFrom(ym)).lte('date', ymEnd(ym))
        .order('id').range(from, from + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      otherLessons.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  }

  const scheduleStart = today() > ymFrom(ym) ? addDays(weekStartOf(today()), 7) : ymFrom(ym);
  const teacherAvailability = rowsToSlotSet(teacherSlots ?? []);
  const result = runScheduling({
    from: ymFrom(ym), to: ymEnd(ym), scheduleStart, lessonMinutes: LESSON_MINUTES, starts: STUDIO_STARTS,
    students: schedStudents,
    studentAvailability,
    teacherAvailability,
    otherPeriodLessons: otherLessons.map(l => ({ studentId: l.student_id, date: l.date })),
    existingLessons: [],
  });

  await supabase.from('lessons').delete().eq('period_id', period.id);
  await supabase.from('unassigned').delete().eq('period_id', period.id);
  const { data: insertedLessons, error: lessonErr } = result.lessons.length
    ? await supabase.from('lessons').insert(result.lessons.map(l => ({ teacher_id: session.id, period_id: period.id, student_id: l.studentId, date: l.date, start_min: l.start })))
      .select('id,student_id,date,start_min,teacher_name')
    : { data: [], error: null };
  if (lessonErr) return NextResponse.json({ error: lessonErr.message }, { status: 500 });
  const { data: insertedUnassigned, error: unassignedErr } = result.unassigned.length
    ? await supabase.from('unassigned').insert(result.unassigned.map(u => ({ period_id: period.id, student_id: u.studentId, week_start: u.weekStart, reason: u.reason })))
      .select('id,student_id,week_start,reason')
    : { data: [], error: null };
  if (unassignedErr) return NextResponse.json({ error: unassignedErr.message }, { status: 500 });

  await supabase.from('periods').update({ status: 'draft' }).eq('id', period.id);

  const lessonsOut = (insertedLessons ?? []).map(l => ({ id: l.id, studentId: l.student_id, date: l.date, start: l.start_min, teacherName: l.teacher_name ?? undefined }));
  const unassignedOut = (insertedUnassigned ?? []).map(u => {
    const sel = studentAvailability.get(u.student_id) ?? new Set<string>();
    const weekDates = datesBetween(u.week_start, addDays(u.week_start, 6));
    return { id: u.id, studentId: u.student_id, weekStart: u.week_start, reason: u.reason, windows: windowList(sel, weekDates, STUDIO_STARTS, LESSON_MINUTES) };
  });
  const scheduledCount = new Map<string, number>();
  for (const l of result.lessons) scheduledCount.set(l.studentId, (scheduledCount.get(l.studentId) ?? 0) + 1);
  const diagnostics = schedStudents.map(student => {
    const selected = [...(studentAvailability.get(student.id) ?? [])]
      .filter(key => key.slice(0, 10) >= scheduleStart && key.slice(0, 10) <= ymEnd(ym));
    const overlapCount = selected.filter(key => teacherAvailability.has(key)).length;
    const reasons = [...new Set(result.unassigned.filter(row => row.studentId === student.id).map(row => row.reason))];
    return {
      studentId: student.id,
      name: student.name,
      remainingLessons: student.remainingLessons,
      selectedSlots: selected.length,
      overlapSlots: overlapCount,
      scheduledLessons: scheduledCount.get(student.id) ?? 0,
      reasons,
    };
  });
  // 只記錄排課判斷的數量與原因，方便正式環境除錯；不記錄實際日期、時間或任何登入資訊。
  console.info('schedule-diagnostics', JSON.stringify({
    ym,
    scheduleStart,
    students: diagnostics.map(({ name: _name, ...counts }) => counts),
  }));
  const remainingLessons = Object.fromEntries(schedStudents.map(s => [
    s.id,
    Math.max(0, (remainingBefore.get(s.id) ?? 0) - (scheduledCount.get(s.id) ?? 0)),
  ]));
  return NextResponse.json({ lessons: lessonsOut, unassigned: unassignedOut, remainingLessons, diagnostics });
}
