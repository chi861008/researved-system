import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 伺服器端專用（service role key，繞過 RLS）：所有真正老師／學生的資料讀寫都走這裡，
// 瀏覽器端永遠不會直接碰 Supabase。沒設金鑰時回傳 null，呼叫端照舊走展示模式。
let client: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}
