import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { remainingLessons } = await req.json().catch(() => ({}));
  if (!Number.isInteger(remainingLessons) || remainingLessons < 0) return NextResponse.json({ error: '堂數必須是 0 以上的整數' }, { status: 400 });
  const { data: student } = await supabase.from('students').select('id').eq('id', studentId).eq('teacher_id', session.id).maybeSingle();
  if (!student) return NextResponse.json({ error: '找不到這位學生' }, { status: 404 });

  // lesson_credits 存累計購買堂數；老師輸入的是「現在還剩幾堂」，所以要加回已存在的 active lessons。
  // 這讓重新排課刪除課程時堂數自然退回，而不是永久多扣一次。
  const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true })
    .eq('student_id', studentId).eq('status', 'active');
  const lessonCredits = (count ?? 0) + remainingLessons;
  const { error } = await supabase.from('students').update({ lesson_credits: lessonCredits }).eq('id', studentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, remainingLessons });
}

// 刪除學生：slots／lessons／unassigned 都沒有 FK 會自動清掉，line_groups 的綁定也要先解除，
// 照順序手動刪乾淨，不是一個交易，但這個 app 規模小，風險可以接受。
export async function DELETE(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { data: student } = await supabase.from('students').select('id,teacher_id').eq('id', studentId).maybeSingle();
  if (!student || student.teacher_id !== session.id) return NextResponse.json({ error: '找不到這位學生' }, { status: 404 });

  await supabase.from('line_groups').update({ student_id: null }).eq('student_id', studentId);
  await supabase.from('slots').delete().eq('owner_type', 'student').eq('owner_id', studentId);
  await supabase.from('lessons').delete().eq('student_id', studentId);
  await supabase.from('unassigned').delete().eq('student_id', studentId);
  const { error } = await supabase.from('students').delete().eq('id', studentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
