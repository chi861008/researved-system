import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyLineIdToken } from '@/lib/lineIdToken';
import { weekStartOf } from '@/lib/scheduling';

// 學生在自己的課表卡片按「請假」：把這堂課設成 cancelled，再借用「待補其他老師」那套既有機制
// （插入一筆 unassigned，reason='leave_requested'）讓老師安排新時間——不是自己就能改時間，
// 一定要經過老師那邊確認，見 lib/scheduling.ts 的 unassignedReasonLabel 註解。
export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const { idToken } = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const verified = typeof idToken === 'string' ? await verifyLineIdToken(idToken) : null;
  if (!verified) return NextResponse.json({ error: '無法確認你的 LINE 身分，請重新打開連結。' }, { status: 401 });

  const { data: lesson } = await supabase.from('lessons').select('id,period_id,student_id,date,status').eq('id', lessonId).maybeSingle();
  if (!lesson || lesson.status !== 'active') return NextResponse.json({ error: '找不到這堂課，可能已經被老師調整過了。' }, { status: 404 });

  const { data: student } = await supabase.from('students').select('id').eq('id', lesson.student_id).eq('line_user_id', verified.sub).maybeSingle();
  if (!student) return NextResponse.json({ error: '這堂課不是你的。' }, { status: 403 });

  const { error: updErr } = await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lessonId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { error: insErr } = await supabase.from('unassigned')
    .insert({ period_id: lesson.period_id, student_id: lesson.student_id, week_start: weekStartOf(lesson.date), reason: 'leave_requested' });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
