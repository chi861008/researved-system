import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyLineIdToken } from '@/lib/lineIdToken';
import { isUuid } from '@/lib/id';

// 真老師模式的「加入」：不用 localStorage，完全靠已驗證的 LINE userId 判斷「這個人是不是已經加入過」，
// 換裝置、清瀏覽器資料都還認得出來。沒帶 name 時只是在「檢查有沒有加入過」，查不到才要前端顯示填名字表單。
export async function POST(req: Request) {
  const { idToken, teacherId, name } = await req.json().catch(() => ({}));
  if (!teacherId || !isUuid(teacherId)) return NextResponse.json({ error: '連結不完整' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const verified = typeof idToken === 'string' ? await verifyLineIdToken(idToken) : null;
  if (!verified) return NextResponse.json({ error: '無法確認你的 LINE 身分，請重新打開連結。' }, { status: 401 });

  const { data: existing } = await supabase.from('students').select('id,name,weekly_pattern').eq('teacher_id', teacherId).eq('line_user_id', verified.sub).maybeSingle();
  if (existing) return NextResponse.json({ id: existing.id, name: existing.name, weeklyPattern: existing.weekly_pattern ?? null });

  const nm = typeof name === 'string' ? name.trim() : '';
  if (!nm) return NextResponse.json({ needsName: true });

  const { data, error } = await supabase.from('students').insert({ teacher_id: teacherId, name: nm, line_user_id: verified.sub }).select('id,name').single();
  if (error) {
    // students.line_user_id 是全站唯一，不是每個老師各自獨立：同一個 LINE 帳號不能同時是兩位老師的學生。
    if (error.code === '23505') return NextResponse.json({ error: '這個 LINE 帳號已經是其他老師的學生了。' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, name: data.name, weeklyPattern: null });
}
