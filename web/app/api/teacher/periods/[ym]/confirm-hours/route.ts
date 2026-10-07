import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { replaceOwnerAvailability } from '@/lib/supabaseSlots';
import { datesBetween, slotKey } from '@/lib/scheduling';
import { deriveWeeklyPattern } from '@/lib/weeklyPattern';
import { ymFrom, ymEnd, STUDIO_STARTS } from '@/lib/ym';

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 存上班時段，不負責「開放這個月給學生」——那是獨立的開關，見 app/api/teacher/periods/[ym]/open/route.ts。
// 這支第一次存某個月的時段時，如果這個月的 periods row 還不存在，會先建一筆 status='closed'（學生還
// 看不到），之後老師另外去按開關才會變成 'collecting'。不會因為存時段就自動開放，兩件事分開。
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
    const { error: insErr } = await supabase.from('periods').insert({ teacher_id: session.id, ym, status: 'closed' });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const keys = slots.map((s: { date: string; start: number }) => slotKey(s.date, s.start));
  const { error } = await replaceOwnerAvailability(supabase, 'teacher', session.id, keys, today());
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (remember) {
    const pattern = deriveWeeklyPattern(new Set(keys), datesBetween(ymFrom(ym), ymEnd(ym)), STUDIO_STARTS);
    await supabase.from('teachers').update({ weekly_pattern: pattern }).eq('id', session.id);
  }
  return NextResponse.json({ ok: true, status: existing?.status ?? 'closed' });
}
