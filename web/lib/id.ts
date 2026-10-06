// 展示老師／學生 id（t1、t-add-xxx、xxx-join-xxx……）永遠不是這個格式；真正的老師／學生
// 是 Supabase 給的 UUID。用這個判斷「這個 id 要不要真的去碰資料庫」，不需要額外的旗標。
export const isUuid = (s: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
