import { NextResponse } from 'next/server';
import { replyMessage, verifyLineSignature } from '@/lib/line';

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string };
}

const GROUP_JOIN_GREETING =
  '哈囉！我是皮拉提斯排課小幫手 🌸\n' +
  '老師請到管理頁面的「尚未綁定的群組」，把這個群組指定給某位學生，之後排好課就能直接分享到這裡。';

export async function POST(req: Request) {
  // 還沒設定好 LINE 金鑰（Channel secret／Access token）前，這個 webhook 無法安全運作。
  if (!process.env.LINE_CHANNEL_SECRET || !process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'LINE 尚未設定完成' }, { status: 503 });
  }

  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get('x-line-signature'))) {
    return NextResponse.json({ error: '簽章驗證失敗' }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try { events = JSON.parse(raw).events ?? []; } catch { /* 空 body（LINE 後台的 Verify 按鈕）直接當作沒有事件 */ }

  for (const event of events) {
    try {
      if (event.type === 'join' && event.source?.type === 'group' && event.replyToken) {
        await replyMessage(event.replyToken, [{ type: 'text', text: GROUP_JOIN_GREETING }]);
        // TODO: 接上 Supabase 後，這裡要 upsert line_groups(group_id, joined_at)，
        // 讓老師端的「尚未綁定的群組」清單讀得到這個群組。
      }
      // follow／memberJoined 目前不用做事：學生身分是透過 LIFF 登入辨識，不靠加好友或進群事件。
    } catch (err) {
      console.error('line webhook event error', event.type, err);
    }
  }

  return NextResponse.json({ ok: true });
}
