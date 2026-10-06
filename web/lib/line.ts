import crypto from 'node:crypto';

const LINE_API = 'https://api.line.me/v2/bot/message';

// 驗證 LINE Webhook 的簽章，確認請求真的來自 LINE（不是別人假造的）。
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface LineTextMessage { type: 'text'; text: string }

async function callLineApi(path: string, body: unknown) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 未設定');
  const res = await fetch(`${LINE_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE API ${path} 失敗：${res.status} ${await res.text()}`);
}

// 回覆訊息（用 webhook 事件附的 replyToken）：免費，不計入每月則數。
export function replyMessage(replyToken: string, messages: LineTextMessage[]) {
  return callLineApi('/reply', { replyToken, messages });
}

// 主動推播（用使用者或群組 id）：計入官方帳號每月的訊息則數，只在老師明確要求時才呼叫。
export function pushMessage(to: string, messages: LineTextMessage[]) {
  return callLineApi('/push', { to, messages });
}
