import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyLineIdToken } from '@/lib/lineIdToken';
import { isUuid } from '@/lib/id';

// 學生端「查看我的課表」：老師排課後 period 狀態會從 collecting 變成 draft/approved/notified，
// 這時候邀請連結不會再顯示選時段畫面，改用這支 API 查這位學生「最新一個已經排課的月份」的課表卡片。
// 固定抓老師目前最新的那個非收集中月份（不是「挑第一個這位學生有課的月份」）：
// 這樣就算她這個月所有課都請假、暫時 0 堂 active，也還是看得到「這個月在處理中」而不是整個消失
// 跳去更舊的月份或顯示「沒有課表」，避免請假中的狀態看起來像系統壞掉。
export async function POST(req: Request) {
  const { idToken, teacherId } = await req.json().catch(() => ({}));
  if (!teacherId || !isUuid(teacherId)) return NextResponse.json({ error: '連結不完整' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const verified = typeof idToken === 'string' ? await verifyLineIdToken(idToken) : null;
  if (!verified) return NextResponse.json({ error: '無法確認你的 LINE 身分，請重新打開連結。' }, { status: 401 });

  const { data: student } = await supabase.from('students').select('id').eq('teacher_id', teacherId).eq('line_user_id', verified.sub).maybeSingle();
  if (!student) return NextResponse.json({ error: '請先透過邀請連結加入。' }, { status: 404 });

  const { data: period } = await supabase.from('periods').select('id,ym,status').eq('teacher_id', teacherId).neq('status', 'collecting').order('ym', { ascending: false }).limit(1).maybeSingle();
  if (!period) return NextResponse.json({ noSchedule: true });

  const { data: lessons } = await supabase.from('lessons').select('id,date,start_min,teacher_name,checked_in_at')
    .eq('period_id', period.id).eq('student_id', student.id).eq('status', 'active').order('date').order('start_min');
  return NextResponse.json({
    ym: period.ym, status: period.status,
    lessons: (lessons ?? []).map(l => ({ id: l.id, date: l.date, start: l.start_min, teacherName: l.teacher_name ?? undefined, checkedInAt: l.checked_in_at ?? undefined })),
  });
}
