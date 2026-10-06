import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { replaceOwnerAvailability } from '@/lib/supabaseSlots';
import { slotKey } from '@/lib/scheduling';

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 老師自己的上班時段：整批覆蓋，只替換「今天之後」的部分（固定會議時間／快速排休用）。
export async function POST(req: Request) {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { slots } = await req.json().catch(() => ({}));
  if (!Array.isArray(slots)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
  for (const s of slots) if (!/^\d{4}-\d{2}-\d{2}$/.test(s?.date) || !Number.isInteger(s?.start)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });

  const keys = slots.map((s: { date: string; start: number }) => slotKey(s.date, s.start));
  const { error } = await replaceOwnerAvailability(supabase, 'teacher', session.id, keys, today());
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
