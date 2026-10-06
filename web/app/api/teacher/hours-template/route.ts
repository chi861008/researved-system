import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 老師自訂「上班時段」通知文字的開頭／結尾——中間實際上班時間、固定會議時間、邀請連結那段是
// 根據真實資料自動算出來的，不開放自訂，避免跟實際排課資料兜不起來。留空＝不加開頭／結尾。
export async function POST(req: Request) {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { prefix, suffix } = await req.json().catch(() => ({}));
  if (typeof prefix !== 'string' || typeof suffix !== 'string') return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
  if (prefix.length > 500 || suffix.length > 500) return NextResponse.json({ error: '內容太長了，請精簡一點' }, { status: 400 });

  const { error } = await supabase.from('teachers').update({ hours_prefix: prefix.trim() || null, hours_suffix: suffix.trim() || null }).eq('id', session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
