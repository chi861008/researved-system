// 驗證學生端 LIFF 給的 ID Token，取得可信的 LINE userId（不能直接信任前端傳來的字串）。
// client_id 用 LINE_LOGIN_CHANNEL_ID：兩個 LIFF app 的 id 開頭都是這個頻道 ID，代表
// 這些 LIFF 是註冊在這個 LINE Login 頻道底下——第一次真的用手機測試時務必確認這個假設成立
// （如果 LINE 回 invalid_client，代表 LIFF 其實註冊在別的頻道，要改用那個頻道的 ID）。
export async function verifyLineIdToken(idToken: string): Promise<{ sub: string; name?: string } | null> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId || !idToken) return null;
  try {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.aud !== clientId || !data.sub) return null;
    return { sub: data.sub, name: data.name };
  } catch { return null; }
}
