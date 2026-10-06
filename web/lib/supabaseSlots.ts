import type { SupabaseClient } from '@supabase/supabase-js';
import { slotKey } from './scheduling';

export function rowsToSlotSet(rows: { date: string; start_min: number }[]): Set<string> {
  return new Set(rows.map(r => slotKey(r.date, r.start_min)));
}

// 老師／學生的「可上班／可上課時段」都是同一種整批覆蓋的寫法：先刪掉這個 owner（可選再限定日期範圍，
// 例如老師只替換「今天之後」，不動到過去的紀錄）現有的全部 slots，再把目前整組 Set 寫回去。
export async function replaceOwnerAvailability(
  supabase: SupabaseClient,
  ownerType: 'teacher' | 'student',
  ownerId: string,
  keys: Iterable<string>,
  dateFrom?: string,
): Promise<{ error?: string }> {
  let del = supabase.from('slots').delete().eq('owner_type', ownerType).eq('owner_id', ownerId);
  if (dateFrom) del = del.gte('date', dateFrom);
  const { error: delErr } = await del;
  if (delErr) return { error: delErr.message };

  const rows = [...keys]
    .map(k => { const [date, s] = k.split('|'); return { owner_type: ownerType, owner_id: ownerId, date, start_min: Number(s) }; })
    .filter(r => !dateFrom || r.date >= dateFrom);
  if (!rows.length) return {};
  const { error: insErr } = await supabase.from('slots').insert(rows);
  return insErr ? { error: insErr.message } : {};
}
