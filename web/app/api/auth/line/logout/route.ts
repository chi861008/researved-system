import { NextResponse } from 'next/server';
import { TEACHER_SESSION_COOKIE } from '@/lib/auth';

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const res = NextResponse.redirect(`${origin}/teacher`);
  res.cookies.delete(TEACHER_SESSION_COOKIE);
  return res;
}
