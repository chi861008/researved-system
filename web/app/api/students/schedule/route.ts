import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyLineIdToken } from '@/lib/lineIdToken';
import { isUuid } from '@/lib/id';

// 學生端「查看我的課表」：老師排課後 period 狀態會從 collecting 變成 draft/approved/notified，
// 這時候邀請連結不會再顯示選時段畫面，改用這支 API 查這位學生在「最新一個已經排課的月份」有沒有課。
export async function POST(req: Request) {
  const { idToken, teacherId } = await req.json().catch(() => ({}));
  if (!teacherId || !isUuid(teacherId)) return NextResponse.json({ error: '連結不完整' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const verified = typeof idToken === 'string' ? await verifyLineIdToken(idToken) : null;
  if (!verified) return NextResponse.json({ error: '無法確認你的 LINE 身分，請重新打開連結。' }, { status: 401 });

  const { data: student } = await supabase.from('students').select('id').eq('teacher_id', teacherId).eq('line_user_id', verified.sub).maybeSingle();
  if (!student) return NextResponse.json({ error: '請先透過邀請連結加入。' }, { status: 404 });

  const { data: periods } = await supabase.from('periods').select('id,ym,status').eq('teacher_id', teacherId).neq('status', 'collecting').order('ym', { ascending: false });
  for (const p of periods ?? []) {
    const { data: lessons } = await supabase.from('lessons').select('date,start_min,teacher_name').eq('period_id', p.id).eq('student_id', student.id).eq('status', 'active');
    if (lessons && lessons.length) {
      return NextResponse.json({
        ym: p.ym, status: p.status,
        lessons: lessons.map(l => ({ date: l.date, start: l.start_min, teacherName: l.teacher_name ?? undefined })),
      });
    }
  }
  return NextResponse.json({ noSchedule: true });
}
