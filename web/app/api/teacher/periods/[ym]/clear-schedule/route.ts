import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 「重新排課」按下確定＝回到自動排課之前的狀態：清掉這個月算出來的課表／待補名單，
// 狀態退回「收集中」，讓老師可以先調整學生名單或時段，之後再自己按「自動排課」重新算，
// 不是按一下就馬上又排一次。
export async function POST(_req: Request, { params }: { params: Promise<{ ym: string }> }) {
  const { ym } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { data: period } = await supabase.from('periods').select('id').eq('teacher_id', session.id).eq('ym', ym).maybeSingle();
  if (!period) return NextResponse.json({ error: '這個月還沒開放選課' }, { status: 404 });

  // 同時間只能有一個月「收集中」，退回去之前先確認沒有別的月份已經是收集中。
  const { data: otherOpen } = await supabase.from('periods').select('ym').eq('teacher_id', session.id).eq('status', 'collecting').neq('ym', ym).maybeSingle();
  if (otherOpen) return NextResponse.json({ error: `${otherOpen.ym} 目前是收集中，請先處理完那個月再清除這個月的課表。` }, { status: 409 });

  await supabase.from('lessons').delete().eq('period_id', period.id);
  await supabase.from('unassigned').delete().eq('period_id', period.id);
  const { error } = await supabase.from('periods').update({ status: 'collecting' }).eq('id', period.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
