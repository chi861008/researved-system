import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 老師「代填」學生的時段：整批覆蓋，標記 filled_by_teacher=true，讓畫面上能顯示「老師代填」標籤。
export async function POST(req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { data: student } = await supabase.from('students').select('id,teacher_id').eq('id', studentId).maybeSingle();
  if (!student || student.teacher_id !== session.id) return NextResponse.json({ error: '找不到這位學生' }, { status: 404 });

  const { slots } = await req.json().catch(() => ({}));
  if (!Array.isArray(slots)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
  for (const s of slots) if (!/^\d{4}-\d{2}-\d{2}$/.test(s?.date) || !Number.isInteger(s?.start)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });

  const { error: delErr } = await supabase.from('slots').delete().eq('owner_type', 'student').eq('owner_id', studentId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  const rows = slots.map((s: { date: string; start: number }) => ({ owner_type: 'student', owner_id: studentId, date: s.date, start_min: s.start, filled_by_teacher: true }));
  if (rows.length) {
    const { error: insErr } = await supabase.from('slots').insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
