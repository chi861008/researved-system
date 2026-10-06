import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 固定會議時間：這個 app 只管理「一筆」，所以整批刪除重建，不用煩惱要更新哪一列。
export async function POST(req: Request) {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { weekday, start, end } = await req.json().catch(() => ({}));
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
    return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
  }

  const { error: delErr } = await supabase.from('weekly_blocks').delete().eq('teacher_id', session.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  const { error: insErr } = await supabase.from('weekly_blocks').insert({ teacher_id: session.id, weekday, start_min: start, end_min: end });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
