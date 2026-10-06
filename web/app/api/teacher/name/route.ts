import { NextResponse } from 'next/server';
import { getTeacherSession, signSession, TEACHER_SESSION_COOKIE } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 老師改自己的名字：名字同時存在 teachers 表，也簽在登入 cookie 裡（session 不會每次都重新查資料庫）。
// 只改資料庫的話，畫面上還是會顯示舊名字，要等 30 天後 cookie 過期重新登入才會更新，所以存檔成功後
// 要順便重簽一次 cookie，改名才會馬上生效。
export async function POST(req: Request) {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { name } = await req.json().catch(() => ({}));
  const nm = typeof name === 'string' ? name.trim() : '';
  if (!nm) return NextResponse.json({ error: '請輸入名字' }, { status: 400 });
  if (nm.length > 20) return NextResponse.json({ error: '名字太長了，請精簡一點（20 字以內）' }, { status: 400 });

  const { error } = await supabase.from('teachers').update({ name: nm }).eq('id', session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const token = signSession({ id: session.id, name: nm });
  const res = NextResponse.json({ ok: true, name: nm });
  if (token) res.cookies.set(TEACHER_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30, path: '/' });
  return res;
}
