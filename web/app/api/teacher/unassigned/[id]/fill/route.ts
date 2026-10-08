import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { data: u } = await supabase.from('unassigned').select('id,period_id,student_id').eq('id', id).maybeSingle();
  if (!u) return NextResponse.json({ error: '找不到這筆待補紀錄' }, { status: 404 });
  const { data: period } = await supabase.from('periods').select('id,teacher_id').eq('id', u.period_id).maybeSingle();
  if (!period || period.teacher_id !== session.id) return NextResponse.json({ error: '找不到這筆待補紀錄' }, { status: 404 });

  const { date, start, teacherName } = await req.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(start)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });

  const [{ data: student }, { count: usedCredits }] = await Promise.all([
    supabase.from('students').select('lesson_credits').eq('id', u.student_id).maybeSingle(),
    supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('student_id', u.student_id).eq('status', 'active'),
  ]);
  if (!student || (student.lesson_credits ?? 0) - (usedCredits ?? 0) <= 0) {
    return NextResponse.json({ error: '這位學生已沒有剩餘堂數，請先續課再安排。' }, { status: 409 });
  }

  const { data: lesson, error } = await supabase.from('lessons')
    .insert({ teacher_id: session.id, period_id: u.period_id, student_id: u.student_id, date, start_min: start, teacher_name: teacherName || null })
    .select('id,student_id,date,start_min,teacher_name').single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '這個時段已經有課，請改選別的時間。' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await supabase.from('unassigned').delete().eq('id', id);
  return NextResponse.json({ lesson: { id: lesson.id, studentId: lesson.student_id, date: lesson.date, start: lesson.start_min, teacherName: lesson.teacher_name ?? undefined } });
}
