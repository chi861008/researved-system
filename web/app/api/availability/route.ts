import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyLineIdToken } from '@/lib/lineIdToken';
import { isUuid } from '@/lib/id';
import { replaceOwnerAvailability } from '@/lib/supabaseSlots';
import { datesBetween, slotKey } from '@/lib/scheduling';
import { deriveWeeklyPattern } from '@/lib/weeklyPattern';
import { ymFrom, ymEnd, STUDIO_STARTS } from '@/lib/ym';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const { idToken, teacherId, ym, windows, remember } = await req.json().catch(() => ({}));
  if (!Array.isArray(windows) || windows.length === 0 || windows.length > 400) return bad('時段資料不正確');
  for (const w of windows)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w?.date) || !Number.isInteger(w.start) || !Number.isInteger(w.end) || w.start < 0 || w.end > 1440 || w.start >= w.end)
      return bad('時段格式不正確');

  // 展示模式：teacherId 不是真的（或沒帶）時，維持原本的模擬行為，完全不碰 Supabase。
  if (!teacherId || !isUuid(teacherId)) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: true, demo: true });
    return bad('資料庫尚未接上，請稍後再試', 503);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return bad('資料庫尚未設定', 503);

  const verified = typeof idToken === 'string' ? await verifyLineIdToken(idToken) : null;
  if (!verified) return bad('無法確認你的 LINE 身分，請重新打開連結。', 401);

  const { data: student } = await supabase.from('students').select('id').eq('teacher_id', teacherId).eq('line_user_id', verified.sub).maybeSingle();
  if (!student) return bad('請先透過邀請連結加入，再選時段。', 404);

  if (typeof ym !== 'string' || !/^\d{4}-\d{2}$/.test(ym)) return bad('月份格式不正確');
  const { data: period } = await supabase.from('periods').select('id').eq('teacher_id', teacherId).eq('ym', ym).eq('status', 'collecting').maybeSingle();
  if (!period) return bad('目前沒有開放這個月的選課，請跟老師確認。', 409);

  const keys = windows.map((w: { date: string; start: number }) => slotKey(w.date, w.start));
  const { error } = await replaceOwnerAvailability(supabase, 'student', student.id, keys, ymFrom(ym));
  if (error) return bad(error, 500);
  if (remember) {
    const pattern = deriveWeeklyPattern(new Set(keys), datesBetween(ymFrom(ym), ymEnd(ym)), STUDIO_STARTS);
    await supabase.from('students').update({ weekly_pattern: pattern }).eq('id', student.id);
  }
  return NextResponse.json({ ok: true });
}
