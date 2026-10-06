import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rowsToSlotSet } from '@/lib/supabaseSlots';
import { ymFrom, ymEnd, STUDIO_STARTS, LESSON_MINUTES } from '@/lib/ym';

// 公開端點：學生端用來拿「這位老師目前開放選課的月份」——同一時間最多只會有一個月是 collecting
// （在 confirm-hours 那支 API 裡擋住，見那邊的註解），沒有就代表目前沒開放。
export async function GET(_req: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { data: period } = await supabase.from('periods').select('ym').eq('teacher_id', teacherId).eq('status', 'collecting').maybeSingle();
  if (!period) return NextResponse.json({ noOpenPeriod: true });

  const [{ data: blockRow }, { data: slotRows }] = await Promise.all([
    supabase.from('weekly_blocks').select('weekday,start_min,end_min').eq('teacher_id', teacherId).limit(1).maybeSingle(),
    supabase.from('slots').select('date,start_min').eq('owner_type', 'teacher').eq('owner_id', teacherId),
  ]);

  return NextResponse.json({
    ym: period.ym, from: ymFrom(period.ym), to: ymEnd(period.ym),
    starts: STUDIO_STARTS, lessonMinutes: LESSON_MINUTES,
    weeklyBlocks: blockRow ? [{ weekday: blockRow.weekday, start: blockRow.start_min, end: blockRow.end_min }] : [],
    teacherAvailability: [...rowsToSlotSet(slotRows ?? [])],
  });
}
