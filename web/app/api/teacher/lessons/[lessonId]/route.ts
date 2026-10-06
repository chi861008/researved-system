import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 改時間／換代課老師。lessons_no_clash 這個唯一索引（teacher_id,date,start_min,代課老師）會擋撞堂，
// 撞到時 Postgres 回傳 23505，轉成友善訊息而不是原始錯誤碼。
export async function PATCH(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { data: lesson } = await supabase.from('lessons').select('id,teacher_id').eq('id', lessonId).maybeSingle();
  if (!lesson || lesson.teacher_id !== session.id) return NextResponse.json({ error: '找不到這堂課' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if ('date' in body || 'start' in body) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isInteger(body.start)) return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
    patch.date = body.date; patch.start_min = body.start;
  }
  if ('teacherName' in body) patch.teacher_name = body.teacherName || null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: '沒有要更新的內容' }, { status: 400 });

  const { error } = await supabase.from('lessons').update(patch).eq('id', lessonId);
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '這個時段已經有課，請改選別的時間。' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
