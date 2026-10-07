import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 「開放／關閉這個月收集時段」的開關，跟存上班時段（confirm-hours）是兩個獨立動作——老師、學生誰先
// 填都可以，不綁順序，也可以同時好幾個月都開著。只能在排課之前切換：已經排過課（draft/approved/
// notified）的月份，要重新開放只能走既有的「重新排課」（會把狀態退回 collecting），不走這支。
export async function POST(req: Request, { params }: { params: Promise<{ ym: string }> }) {
  const { ym } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  if (!/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: '月份格式不正確' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { open } = await req.json().catch(() => ({}));
  if (typeof open !== 'boolean') return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
  const nextStatus = open ? 'collecting' : 'closed';

  const { data: existing } = await supabase.from('periods').select('id,status').eq('teacher_id', session.id).eq('ym', ym).maybeSingle();
  if (!existing) {
    const { error: insErr } = await supabase.from('periods').insert({ teacher_id: session.id, ym, status: nextStatus });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: nextStatus });
  }
  if (existing.status !== 'closed' && existing.status !== 'collecting') {
    return NextResponse.json({ error: '這個月已經排課了，請用「重新排課」。' }, { status: 409 });
  }
  const { error } = await supabase.from('periods').update({ status: nextStatus }).eq('id', existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: nextStatus });
}
