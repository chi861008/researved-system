import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyLineIdToken } from '@/lib/lineIdToken';
import { isUuid } from '@/lib/id';
import { slotKey } from '@/lib/scheduling';
import { ymFrom, ymEnd } from '@/lib/ym';

// 真老師模式的「加入」：不用 localStorage，完全靠已驗證的 LINE userId 判斷「這個人是不是已經加入過」，
// 換裝置、清瀏覽器資料都還認得出來。沒帶 name 時只是在「檢查有沒有加入過」，查不到才要前端顯示填名字表單。
export async function POST(req: Request) {
  const { idToken, teacherId, name, ym, inviteToken } = await req.json().catch(() => ({}));
  if (!teacherId || !isUuid(teacherId)) return NextResponse.json({ error: '連結不完整' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: '資料庫尚未設定' }, { status: 503 });

  const verified = typeof idToken === 'string' ? await verifyLineIdToken(idToken) : null;
  if (!verified) return NextResponse.json({ error: '無法確認你的 LINE 身分，請重新打開連結。' }, { status: 401 });

  const { data: existing } = await supabase.from('students').select('id,name,weekly_pattern,lesson_credits,scheduling_paused').eq('teacher_id', teacherId).eq('line_user_id', verified.sub).maybeSingle();
  if (existing) {
    const { count: usedCredits } = await supabase.from('lessons').select('id', { count: 'exact', head: true })
      .eq('student_id', existing.id).eq('status', 'active');
    const remainingLessons = Math.max(0, (existing.lesson_credits ?? 0) - (usedCredits ?? 0));
    // 這個連結指定月份（?ym=）如果已經送出過時段，一起回傳，前端才能把畫面還原成跟上次送出時一樣
    // （鎖定＋顯示她真正選過的格子），不然重新打開連結會看起來像沒填過。現在可能同時好幾個月都在
    // 收集中，一定要照連結帶的 ym 查那一個月，不能再猜「唯一收集中的月份」（查到兩筆會整個失效）；
    // 沒帶 ym 的舊連結才退回舊行為。
    let existingAvailability: string[] = [];
    const query = supabase.from('periods').select('ym').eq('teacher_id', teacherId).eq('status', 'collecting');
    const { data: period } = typeof ym === 'string' && ym ? await query.eq('ym', ym).maybeSingle() : await query.maybeSingle();
    if (period) {
      const { data: slotRows } = await supabase.from('slots').select('date,start_min')
        .eq('owner_type', 'student').eq('owner_id', existing.id)
        .gte('date', ymFrom(period.ym)).lte('date', ymEnd(period.ym));
      existingAvailability = (slotRows ?? []).map(r => slotKey(r.date, r.start_min));
    }
    return NextResponse.json({ id: existing.id, name: existing.name, weeklyPattern: existing.weekly_pattern ?? null, existingAvailability, remainingLessons, paused: Boolean(existing.scheduling_paused) });
  }

  // 老師先建立好的學生用個人 token 綁定。成功後立刻清掉 token，連結即使被轉傳也不能再綁第二個人。
  if (typeof inviteToken === 'string' && inviteToken) {
    const { data: invited } = await supabase.from('students')
      .select('id,name,weekly_pattern,lesson_credits,line_user_id,scheduling_paused')
      .eq('teacher_id', teacherId).eq('invite_token', inviteToken).maybeSingle();
    if (!invited || invited.line_user_id) return NextResponse.json({ error: '這個加入連結無效或已經使用過，請向老師索取新的連結。' }, { status: 404 });

    const { data: bound, error: bindError } = await supabase.from('students').update({
      line_user_id: verified.sub,
      invite_token: null,
      consent_at: new Date().toISOString(),
    }).eq('id', invited.id).eq('invite_token', inviteToken).select('id').maybeSingle();
    if (bindError) {
      if (bindError.code === '23505') return NextResponse.json({ error: '這個 LINE 帳號已經是其他老師的學生了。' }, { status: 409 });
      return NextResponse.json({ error: bindError.message }, { status: 500 });
    }
    if (!bound) return NextResponse.json({ error: '這個加入連結已經使用過，請向老師確認。' }, { status: 409 });

    const { count: usedCredits } = await supabase.from('lessons').select('id', { count: 'exact', head: true })
      .eq('student_id', invited.id).eq('status', 'active');
    const remainingLessons = Math.max(0, (invited.lesson_credits ?? 0) - (usedCredits ?? 0));
    let existingAvailability: string[] = [];
    const query = supabase.from('periods').select('ym').eq('teacher_id', teacherId).eq('status', 'collecting');
    const { data: period } = typeof ym === 'string' && ym ? await query.eq('ym', ym).maybeSingle() : await query.maybeSingle();
    if (period) {
      const { data: slotRows } = await supabase.from('slots').select('date,start_min')
        .eq('owner_type', 'student').eq('owner_id', invited.id)
        .gte('date', ymFrom(period.ym)).lte('date', ymEnd(period.ym));
      existingAvailability = (slotRows ?? []).map(r => slotKey(r.date, r.start_min));
    }
    return NextResponse.json({ id: invited.id, name: invited.name, weeklyPattern: invited.weekly_pattern ?? null, existingAvailability, remainingLessons, paused: Boolean(invited.scheduling_paused) });
  }

  const nm = typeof name === 'string' ? name.trim() : '';
  if (!nm) return NextResponse.json({ needsName: true });

  const { data, error } = await supabase.from('students').insert({ teacher_id: teacherId, name: nm, line_user_id: verified.sub }).select('id,name').single();
  if (error) {
    // students.line_user_id 是全站唯一，不是每個老師各自獨立：同一個 LINE 帳號不能同時是兩位老師的學生。
    if (error.code === '23505') return NextResponse.json({ error: '這個 LINE 帳號已經是其他老師的學生了。' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, name: data.name, weeklyPattern: null, remainingLessons: 0 });
}
