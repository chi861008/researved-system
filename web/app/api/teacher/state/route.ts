import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rowsToSlotSet } from '@/lib/supabaseSlots';
import { addDays, datesBetween, windowList } from '@/lib/scheduling';
import { ymFrom, ymEnd, nextYm, STUDIO_STARTS, LESSON_MINUTES } from '@/lib/ym';

const taiwanToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 老師登入後的「開機讀取」：把 Supabase 裡這位老師的全部資料整理成跟展示模式一樣的 TeacherState
// 形狀（studentAvailability/teacherAvailability 用陣列傳，前端自己轉回 Map/Set）。
// 全新帳號（還沒設定過任何東西）回傳的每個欄位都是空的，前端要能處理「空老師」這個狀態。
export async function GET() {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  // 管理畫面只需要本月與下個月。之前一次讀取所有月份，slots 累積超過 Supabase
  // 單次 1,000 筆上限後，較後面的月份會在重新整理時看起來像「資料被清空」。
  const currentYm = taiwanToday().slice(0, 7);
  const visibleYms = [currentYm, nextYm(currentYm)];
  const dateFrom = ymFrom(currentYm);
  const dateTo = ymEnd(visibleYms[1]);

  const [{ data: students }, { data: teacherSlots }, { data: weeklyBlockRow }, { data: periods }, { data: substituteNames }, { data: teacherRow }] = await Promise.all([
    supabase.from('students').select('id,name,lesson_credits,line_user_id,invite_token,scheduling_paused').eq('teacher_id', session.id),
    supabase.from('slots').select('date,start_min').eq('owner_type', 'teacher').eq('owner_id', session.id)
      .gte('date', dateFrom).lte('date', dateTo),
    supabase.from('weekly_blocks').select('weekday,start_min,end_min').eq('teacher_id', session.id).limit(1).maybeSingle(),
    supabase.from('periods').select('id,ym,status').eq('teacher_id', session.id).in('ym', visibleYms),
    supabase.from('substitute_names').select('name').eq('teacher_id', session.id),
    supabase.from('teachers').select('course_name,course_rules,hours_prefix,hours_suffix,weekly_pattern').eq('id', session.id).maybeSingle(),
  ]);

  const studentIds = (students ?? []).map(s => s.id);
  type StudentSlotRow = { owner_id: string; date: string; start_min: number; filled_by_teacher: boolean };
  const studentSlots: StudentSlotRow[] = [];
  if (studentIds.length) {
    // 多位學生兩個月的選擇仍可能超過 1,000 筆，所以分頁讀完，不能再靜默截斷。
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('slots')
        .select('owner_id,date,start_min,filled_by_teacher')
        .eq('owner_type', 'student').in('owner_id', studentIds)
        .gte('date', dateFrom).lte('date', dateTo)
        .order('owner_id').order('date').order('start_min')
        .range(from, from + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      studentSlots.push(...((data ?? []) as StudentSlotRow[]));
      if (!data || data.length < 1000) break;
    }
  }

  const studentAvailability: Record<string, string[]> = {};
  const filledByTeacher = new Map<string, boolean>(); // `${studentId}|${date}` -> 這筆是不是老師代填
  for (const id of studentIds) studentAvailability[id] = [];
  for (const row of studentSlots) {
    studentAvailability[row.owner_id] ??= [];
    studentAvailability[row.owner_id].push(`${row.date}|${row.start_min}`);
    if (row.filled_by_teacher) filledByTeacher.set(`${row.owner_id}|${row.date}`, true);
  }

  const periodIds = (periods ?? []).map(p => p.id);
  const [{ data: lessons }, { data: unassignedRows }] = await Promise.all([
    periodIds.length ? supabase.from('lessons').select('id,period_id,student_id,date,start_min,teacher_name,checked_in_at').eq('status', 'active').in('period_id', periodIds) : Promise.resolve({ data: [] as any[] }),
    periodIds.length ? supabase.from('unassigned').select('id,period_id,student_id,week_start,reason').in('period_id', periodIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const ymById = new Map((periods ?? []).map(p => [p.id, p.ym]));
  const periodsOut: Record<string, { status: string; lessons: unknown[]; unassigned: unknown[]; notified: boolean; log: unknown[] }> = {};
  for (const p of periods ?? []) periodsOut[p.ym] = { status: p.status, lessons: [], unassigned: [], notified: false, log: [] };
  for (const l of lessons ?? []) {
    const ym = ymById.get(l.period_id); if (!ym) continue;
    (periodsOut[ym].lessons as unknown[]).push({ id: l.id, studentId: l.student_id, date: l.date, start: l.start_min, teacherName: l.teacher_name ?? undefined, checkedInAt: l.checked_in_at ?? undefined });
  }
  for (const u of unassignedRows ?? []) {
    const ym = ymById.get(u.period_id); if (!ym) continue;
    const sel = new Set(studentAvailability[u.student_id] ?? []);
    const weekDates = datesBetween(u.week_start, addDays(u.week_start, 6));
    const windows = windowList(sel, weekDates, STUDIO_STARTS, LESSON_MINUTES);
    (periodsOut[ym].unassigned as unknown[]).push({ id: u.id, studentId: u.student_id, weekStart: u.week_start, reason: u.reason, windows });
  }

  // 堂數是跨月份累計，畫面雖然只顯示兩個月，剩餘堂數仍必須計入所有月份的有效課程。
  const activeLessonCount = new Map<string, number>();
  if (studentIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('lessons').select('student_id')
        .eq('status', 'active').in('student_id', studentIds).order('id').range(from, from + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const lesson of data ?? []) activeLessonCount.set(lesson.student_id, (activeLessonCount.get(lesson.student_id) ?? 0) + 1);
      if (!data || data.length < 1000) break;
    }
  }
  const studentsOut = (students ?? []).map(s => ({
    id: s.id,
    name: s.name,
    remainingLessons: Math.max(0, (s.lesson_credits ?? 0) - (activeLessonCount.get(s.id) ?? 0)),
    linked: Boolean(s.line_user_id),
    inviteToken: s.invite_token ?? undefined,
    paused: Boolean(s.scheduling_paused),
  }));

  // proxy：這位學生「這個月」有沒有任一筆時段是老師代填的（slots.filled_by_teacher），有就顯示「老師代填」
  const proxy: Record<string, boolean> = {};
  for (const p of periods ?? []) {
    const monthPrefix = ymFrom(p.ym).slice(0, 7);
    for (const id of studentIds) {
      for (const d of studentAvailability[id]) {
        const [date] = d.split('|');
        if (date.startsWith(monthPrefix) && filledByTeacher.get(`${id}|${date}`)) { proxy[`${id}|${p.ym}`] = true; break; }
      }
    }
  }

  return NextResponse.json({
    id: session.id, name: session.name,
    courseName: teacherRow?.course_name || undefined,
    courseRules: teacherRow?.course_rules || undefined,
    hoursPrefix: teacherRow?.hours_prefix || '',
    hoursSuffix: teacherRow?.hours_suffix || '',
    weeklyPattern: teacherRow?.weekly_pattern ?? null,
    students: studentsOut,
    studentAvailability,
    teacherAvailability: [...rowsToSlotSet(teacherSlots ?? [])],
    names: (substituteNames ?? []).map(n => n.name),
    weeklyBlock: weeklyBlockRow ? { weekday: weeklyBlockRow.weekday, start: weeklyBlockRow.start_min, end: weeklyBlockRow.end_min } : null,
    periods: periodsOut,
    proxy,
  });
}
