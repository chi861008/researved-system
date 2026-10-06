import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { signSession, TEACHER_SESSION_COOKIE } from '@/lib/auth';

const STATE_COOKIE = 'line_login_state';

function fail(origin: string, code: string, extra?: Record<string, string>) {
  const url = new URL(`${origin}/teacher`);
  url.searchParams.set('loginError', code);
  for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
  return NextResponse.redirect(url.toString());
}

// LINE 登入完成後導回這裡：換 token、查 LINE 個人資料，再對照 Supabase 的 teachers 白名單，
// 是老師才核發登入 cookie；任何一步金鑰沒設定好，都直接顯示錯誤、不假裝成功。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { origin } = url;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!channelId || !channelSecret) return fail(origin, 'not_configured');
  if (!code || !state) return fail(origin, 'missing_code');

  const savedState = req.headers.get('cookie')?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  if (!savedState || savedState !== state) return fail(origin, 'state_mismatch');

  let accessToken: string;
  try {
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        redirect_uri: `${origin}/api/auth/line/callback`,
        client_id: channelId, client_secret: channelSecret,
      }),
    });
    if (!tokenRes.ok) {
      // 記下 LINE 回傳的詳細錯誤（例如 invalid_client、redirect_uri 不符），在 Vercel 的 function log 看得到，
      // 不會外洩金鑰——body 裡最多是 client_id／redirect_uri，不包含 secret。
      console.error('LINE token exchange failed', tokenRes.status, await tokenRes.text().catch(() => ''));
      return fail(origin, 'token_exchange_failed');
    }
    accessToken = (await tokenRes.json()).access_token;
  } catch { return fail(origin, 'token_exchange_failed'); }

  let lineUserId: string, displayName: string;
  try {
    const profileRes = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!profileRes.ok) return fail(origin, 'profile_failed');
    const profile = await profileRes.json();
    lineUserId = profile.userId; displayName = profile.displayName;
  } catch { return fail(origin, 'profile_failed'); }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return fail(origin, 'supabase_not_configured');

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: teacher } = await supabase.from('teachers').select('id, name').eq('line_user_id', lineUserId).maybeSingle();
    // 還沒被加進白名單：把這組 LINE userId 帶回畫面上顯示，方便管理者直接複製去 teachers 表加一筆，
    // 不用另外去翻 LINE 後台或伺服器 log 才找得到這個代碼。
    if (!teacher) return fail(origin, 'not_whitelisted', { uid: lineUserId });

    const token = signSession({ id: teacher.id, name: teacher.name || displayName });
    if (!token) return fail(origin, 'not_configured');

    const res = NextResponse.redirect(`${origin}/teacher`);
    res.cookies.set(TEACHER_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30, path: '/' });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch { return fail(origin, 'supabase_error'); }
}
