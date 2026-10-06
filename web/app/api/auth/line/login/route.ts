import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

const STATE_COOKIE = 'line_login_state';

// 老師按「用 LINE 登入」的入口：帶使用者去 LINE 的登入頁。
// 金鑰（LINE_LOGIN_CHANNEL_ID／LINE_LOGIN_CHANNEL_SECRET）還沒設定完整前，
// 先直接退回老師頁並顯示提示，不要讓使用者在 LINE 的畫面點完才發現卡住。
export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!channelId || !channelSecret) {
    return NextResponse.redirect(`${origin}/teacher?loginError=not_configured`);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${origin}/api/auth/line/callback`;
  const authorizeUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', channelId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', 'profile openid');

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}
