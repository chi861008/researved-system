import crypto from 'node:crypto';
import { cookies } from 'next/headers';

// 老師登入後的身分，簽在 cookie 裡（用 LINE Login channel secret 當簽章金鑰，
// 這樣不用另外多準備一把 session 專用的金鑰）。沒有加密，只有簽章：
// 內容不是機密（teacher id／名字），只需要防止被竄改成別的老師。
export const TEACHER_SESSION_COOKIE = 'teacher_session';

export interface TeacherSession { id: string; name: string }

function sessionSecret(): string | null {
  return process.env.LINE_LOGIN_CHANNEL_SECRET || null;
}

export function signSession(session: TeacherSession): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(cookieValue: string | undefined | null): TeacherSession | null {
  const secret = sessionSecret();
  if (!secret || !cookieValue) return null;
  const [payload, sig] = cookieValue.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
}

// 給 Route Handler 用的共用寫法：每一支「老師專屬」的 API 開頭都呼叫這個，取代各自手動解析 cookie。
export async function getTeacherSession(): Promise<TeacherSession | null> {
  const store = await cookies();
  return verifySession(store.get(TEACHER_SESSION_COOKIE)?.value ?? null);
}
