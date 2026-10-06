import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const session = await getTeacherSession();
  if (!session) return NextResponse.json({ error: '未登入' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const { name } = await req.json().catch(() => ({}));
  const nm = typeof name === 'string' ? name.trim() : '';
  if (!nm) return NextResponse.json({ error: '請輸入學生名稱' }, { status: 400 });
  const { data: existing } = await supabase.from('students').select('id').eq('teacher_id', session.id).eq('name', nm).maybeSingle();
  if (existing) return NextResponse.json({ error: `${nm} 已經在名單裡。` }, { status: 409 });
  const { data, error } = await supabase.from('students').insert({ teacher_id: session.id, name: nm }).select('id,name').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
