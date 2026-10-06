import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { replaceOwnerAvailability } from '@/lib/supabaseSlots';
import { datesBetween, slotKey } from '@/lib/scheduling';
import { deriveWeeklyPattern } from '@/lib/weeklyPattern';
import { ymFrom, ymEnd, STUDIO_STARTS } from '@/lib/ym';

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 「完成選取／開放選課」：如果這個月還沒開放過，這是第一次把它寫進 periods（直接是 collecting）；
// 已經開放過的月份再按，單純更新上班時段，不會動到狀態。同時間只能有一個月在「收集中」——
// 老師要先把上一個月排完（進 draft）或核准，才能開下一個月，這裡擋住，不然學生的單一邀請連結
// 不知道該顯示哪個月。
export async function POST(req: Request, { params }: { params: Promise<{ ym: string }> }) {
  const { ym } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  if (!/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: '月份格式不正確' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { slots, remember } = await req.json().catch(() => ({}));
  if (!Array.isArray(slots)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
  for (const s of slots) if (!/^\d{4}-\d{2}-\d{2}$/.test(s?.date) || !Number.isInteger(s?.start)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });

  const { data: existing } = await supabase.from('periods').select('id,status').eq('teacher_id', session.id).eq('ym', ym).maybeSingle();
  if (!existing) {
    const { data: otherOpen } = await supabase.from('periods').select('ym').eq('teacher_id', session.id).eq('status', 'collecting').neq('ym', ym).maybeSingle();
    if (otherOpen) return NextResponse.json({ error: `${otherOpen.ym} 還在收集中，請先完成排課並核准後再開放這個月。` }, { status: 409 });
    const { error: insErr } = await supabase.from('periods').insert({ teacher_id: session.id, ym, status: 'collecting' });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const keys = slots.map((s: { date: string; start: number }) => slotKey(s.date, s.start));
  const { error } = await replaceOwnerAvailability(supabase, 'teacher', session.id, keys, today());
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (remember) {
    const pattern = deriveWeeklyPattern(new Set(keys), datesBetween(ymFrom(ym), ymEnd(ym)), STUDIO_STARTS);
    await supabase.from('teachers').update({ weekly_pattern: pattern }).eq('id', session.id);
  }
  return NextResponse.json({ ok: true, opened: !existing });
}
