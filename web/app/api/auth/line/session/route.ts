import { NextResponse } from 'next/server';
import { getTeacherSession } from '@/lib/auth';

// 老師頁載入時問一下：這個瀏覽器有沒有真正用 LINE 登入過、而且 cookie 簽章還有效。
// 沒有的話回傳 null，畫面就照舊用「示範登入」切換鈕，不影響現在的測試流程。
export async function GET() {
  return NextResponse.json(await getTeacherSession());
}
