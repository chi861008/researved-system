import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 公開端點：學生端用來判斷邀請連結裡的 teacherId 是不是真的存在，只回傳 id/name，不含任何敏感資料
// （跟展示模式 getAllTeachers() 回傳的形狀一樣）。
export async function GET(_req: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });
  const { data } = await supabase.from('teachers').select('id,name,course_name,course_rules').eq('id', teacherId).maybeSingle();
  if (!data) return NextResponse.json({ error: '找不到老師' }, { status: 404 });
  return NextResponse.json({ id: data.id, name: data.name, courseName: data.course_name || undefined, courseRules: data.course_rules || undefined });
}
