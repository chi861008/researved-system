import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 老師自訂「選課規則與時間說明」整段文字，取代學生端寫死的四條規則；留空＝繼續用預設文字。
export async function POST(req: Request) {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { courseRules } = await req.json().catch(() => ({}));
  if (typeof courseRules !== 'string') return NextResponse.json({ error: '資料格式不正確' }, { status: 400 });
  const text = courseRules.trim();
  if (text.length > 2000) return NextResponse.json({ error: '內容太長了，請精簡一點' }, { status: 400 });

  const { error } = await supabase.from('teachers').update({ course_rules: text || null }).eq('id', session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
