import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rowsToSlotSet } from '@/lib/supabaseSlots';
import { ymFrom, ymEnd, STUDIO_STARTS, LESSON_MINUTES } from '@/lib/ym';

// 公開端點：學生端用來拿「這位老師開放選課的月份」。邀請連結現在會帶 ?ym=，直接查那一個月；
// 沒帶（舊格式、之前已經分享出去的連結）才退回舊行為——挑這位老師目前唯一 collecting 的月份
// （現在可以同時有好幾個月在收集中，舊連結只能猜到其中一個，這是刻意的向下相容妥協）。
export async function GET(req: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  const ym = new URL(req.url).searchParams.get('ym');
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const query = supabase.from('periods').select('ym').eq('teacher_id', teacherId).eq('status', 'collecting');
  const { data: period } = ym ? await query.eq('ym', ym).maybeSingle() : await query.maybeSingle();
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
