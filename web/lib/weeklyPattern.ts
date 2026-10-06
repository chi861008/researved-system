import { slotKey, weekday } from './scheduling';

export interface WeeklyPatternEntry { weekday: number; starts: number[] }
export type WeeklyPattern = WeeklyPatternEntry[];

/** 從一組已選時段整理出「星期幾固定選幾點」的規律：同一個星期幾裡，哪一種時段組合出現的天數最多就記住那一種，
 * 少數被手動調整得跟多數不一樣的那一兩天當例外、不計入規律；完全沒選過的星期幾不會出現在結果裡。 */
export function deriveWeeklyPattern(sel: Set<string>, dates: string[], starts: number[]): WeeklyPattern {
  const out: WeeklyPattern = [];
  for (let wd = 0; wd < 7; wd++) {
    const days = dates.filter(d => weekday(d) === wd);
    if (!days.length) continue;
    const counts = new Map<string, number>();
    const setsByKey = new Map<string, number[]>();
    for (const d of days) {
      const onStarts = starts.filter(s => sel.has(slotKey(d, s)));
      const k = onStarts.join(',');
      counts.set(k, (counts.get(k) ?? 0) + 1);
      setsByKey.set(k, onStarts);
    }
    let bestKey = ''; let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) { bestKey = k; bestN = n; }
    const bestStarts = setsByKey.get(bestKey) ?? [];
    if (bestStarts.length) out.push({ weekday: wd, starts: bestStarts });
  }
  return out;
}

/** 把記住的規律套進一個全新、還沒有任何時段的月份：只補「今天之後」的日期，已經過去的日期不補，
 * 全工作室固定封鎖的時段也會跳過。 */
export function applyPatternToBlankMonth(pattern: WeeklyPattern, dates: string[], today: string, isBlocked: (date: string, start: number) => boolean): Set<string> {
  const byWd = new Map<number, number[]>();
  for (const e of pattern) byWd.set(e.weekday, e.starts);
  const out = new Set<string>();
  for (const d of dates) {
    if (d < today) continue;
    const entryStarts = byWd.get(weekday(d));
    if (!entryStarts) continue;
    for (const s of entryStarts) if (!isBlocked(d, s)) out.add(slotKey(d, s));
  }
  return out;
}

/** 快速選取：把指定星期幾的時段整批換成指定的時間（取代，不是疊加），其他星期幾不受影響。 */
export function applyPresetToSelection(
  value: Set<string>, dates: string[], starts: number[], isBlocked: (date: string, start: number) => boolean, today: string,
  weekdays: number[], presetStarts: number[],
): Set<string> {
  const next = new Set(value);
  const wdSet = new Set(weekdays);
  const pSet = new Set(presetStarts);
  for (const d of dates) {
    if (d < today) continue;
    if (!wdSet.has(weekday(d))) continue;
    for (const s of starts) {
      if (isBlocked(d, s)) continue;
      const k = slotKey(d, s);
      if (pSet.has(s)) next.add(k); else next.delete(k);
    }
  }
  return next;
}
