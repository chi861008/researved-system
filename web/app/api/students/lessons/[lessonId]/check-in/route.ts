import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyLineIdToken } from '@/lib/lineIdToken';

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 學生在自己的課表卡片按「打卡」：上課當天簽到用，不是請假前的確認出席，所以只開放上課「當天」能按，
// 不是之前也不是之後——避免學生提早打卡（還沒上到課）或事後補打卡（失去簽到的意義）。
export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const { idToken } = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const verified = typeof idToken === 'string' ? await verifyLineIdToken(idToken) : null;
  if (!verified) return NextResponse.json({ error: '無法確認你的 LINE 身分，請重新打開連結。' }, { status: 401 });

  const { data: lesson } = await supabase.from('lessons').select('id,student_id,date,status').eq('id', lessonId).maybeSingle();
  if (!lesson || lesson.status !== 'active') return NextResponse.json({ error: '找不到這堂課。' }, { status: 404 });

  const { data: student } = await supabase.from('students').select('id').eq('id', lesson.student_id).eq('line_user_id', verified.sub).maybeSingle();
  if (!student) return NextResponse.json({ error: '這堂課不是你的。' }, { status: 403 });

  if (lesson.date !== today()) return NextResponse.json({ error: '只能在上課當天打卡。' }, { status: 409 });

  const { error } = await supabase.from('lessons').update({ checked_in_at: new Date().toISOString() }).eq('id', lessonId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
