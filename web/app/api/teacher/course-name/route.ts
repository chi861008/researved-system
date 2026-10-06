import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 老師自訂「課程名稱」（例如「皮拉提斯」「瑜伽」），學生端的文字（「OOO 的 XX 課程」「XX 月 XX 選課開始囉」）
// 會套這個詞，不用再寫死「皮拉提斯」——之後要讓老師自己改整段訊息範本是更大的功能，這裡先讓她能換掉課程名稱。
export async function POST(req: Request) {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { courseName } = await req.json().catch(() => ({}));
  const nm = typeof courseName === 'string' ? courseName.trim() : '';
  if (!nm) return NextResponse.json({ error: '請輸入課程名稱' }, { status: 400 });
  if (nm.length > 20) return NextResponse.json({ error: '課程名稱太長了，請精簡一點（20 字以內）' }, { status: 400 });

  const { error } = await supabase.from('teachers').update({ course_name: nm }).eq('id', session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, courseName: nm });
}
