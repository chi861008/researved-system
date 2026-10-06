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

  const [{ data: students }, { data: teacherSlots }] = await Promise.all([
    supabase.from('students').select('id,name').eq('teacher_id', session.id),
    supabase.from('slots').select('date,start_min').eq('owner_type', 'teacher').eq('owner_id', session.id),
  ]);
  const studentIds = (students ?? []).map(s => s.id);
  const { data: studentSlotRows } = studentIds.length
    ? await supabase.from('slots').select('owner_id,date,start_min').eq('owner_type', 'student').in('owner_id', studentIds)
    : { data: [] as { owner_id: string; date: string; start_min: number }[] };
  const studentAvailability = new Map<string, Set<string>>();
  for (const id of studentIds) studentAvailability.set(id, new Set());
  for (const row of studentSlotRows ?? []) studentAvailability.get(row.owner_id)?.add(`${row.date}|${row.start_min}`);

  const { data: otherPeriods } = await supabase.from('periods').select('id').eq('teacher_id', session.id).neq('id', period.id);
  const otherIds = (otherPeriods ?? []).map(p => p.id);
  const { data: otherLessons } = otherIds.length
    ? await supabase.from('lessons').select('student_id,date').eq('status', 'active').in('period_id', otherIds)
    : { data: [] as { student_id: string; date: string }[] };

  const scheduleStart = today() > ymFrom(ym) ? addDays(weekStartOf(today()), 7) : ymFrom(ym);
  const result = runScheduling({
    from: ymFrom(ym), to: ymEnd(ym), scheduleStart, lessonMinutes: LESSON_MINUTES, starts: STUDIO_STARTS,
    students: students ?? [],
    studentAvailability,
    teacherAvailability: rowsToSlotSet(teacherSlots ?? []),
    otherPeriodLessons: (otherLessons ?? []).map(l => ({ studentId: l.student_id, date: l.date })),
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
  return NextResponse.json({ lessons: lessonsOut, unassigned: unassignedOut });
}
