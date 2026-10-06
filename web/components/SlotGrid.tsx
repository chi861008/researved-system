'use client';
import { useState } from 'react';
import { hhmm, md, weekday } from '@/lib/scheduling';

const WD = '日一二三四五六';

export interface SlotGridProps {
  /** 整個月份所有日期（預期從當月 1 號開始、同一個月） */
  dates: string[];
  /** 每天可能的起點（分鐘），例如整點 10:00–21:00 */
  starts: number[];
  /** 今天的日期（YYYY-MM-DD），今天以前的格子不能選 */
  today: string;
  /** 全工作室固定封鎖（例如每週三 16:00–17:00 開會），回傳 true 代表不能選 */
  isBlocked: (date: string, start: number) => boolean;
  /** 已選的時段 */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** 虛線提示用的另一組時段（學生端顯示「Joanna 不上班」），不影響是否可選 */
  dashedSet?: Set<string>;
  dashedHint?: string;
  /** true 時整個月曆鎖定、不能點選（例如送出後的唯讀檢視），避免誤觸 */
  readOnly?: boolean;
}

const key = (d: string, s: number) => `${d}|${s}`;

type Panel = { type: 'weekday'; wd: number } | { type: 'date'; date: string };

export default function SlotGrid({ dates, starts, today, isBlocked, value, onChange, dashedSet, dashedHint, readOnly }: SlotGridProps) {
  const [panel, setPanel] = useState<Panel | null>(null);

  const byWeekday: string[][] = Array.from({ length: 7 }, () => []);
  for (const d of dates) byWeekday[weekday(d)].push(d);

  function weekdayDates(wd: number): string[] {
    return byWeekday[wd].filter(d => d >= today);
  }
  function weekdayAvailKeys(wd: number): string[] {
    const out: string[] = [];
    for (const d of weekdayDates(wd)) for (const s of starts) if (!isBlocked(d, s)) out.push(key(d, s));
    return out;
  }
  // 這個星期幾這個月有沒有「任何」已選時段——點標題時用來決定是要整欄全選還是全部清空。
  function isWeekdayAny(wd: number): boolean {
    return weekdayAvailKeys(wd).some(k => value.has(k));
  }
  // 這個星期幾、這個整點：這個月每一天是不是都已經選了（面板裡單一時段按鈕的開關狀態）
  function isWeekdayHourFull(wd: number, s: number): boolean {
    const ds = weekdayDates(wd).filter(d => !isBlocked(d, s));
    return ds.length > 0 && ds.every(d => value.has(key(d, s)));
  }
  function toggleWeekdayHour(wd: number, s: number) {
    if (readOnly) return;
    const ds = weekdayDates(wd).filter(d => !isBlocked(d, s));
    if (!ds.length) return;
    const turnOn = !isWeekdayHourFull(wd, s);
    const next = new Set(value);
    ds.forEach(d => { const k = key(d, s); if (turnOn) next.add(k); else next.delete(k); });
    onChange(next);
  }
  function toggleSlot(d: string, s: number) {
    if (readOnly) return;
    const k = key(d, s);
    const next = new Set(value);
    if (next.has(k)) next.delete(k); else next.add(k);
    onChange(next);
  }
  // 點星期標題：有選＝代表「這個星期幾我要」，先整欄全選（跳過固定封鎖的時段），
  // 再打開面板讓你調整細部時段；已經有任何時段時再點一次＝整欄清空（不用另外按「全不選」）。
  function clickWeekdayHeader(wd: number) {
    if (!readOnly) {
      const keys = weekdayAvailKeys(wd);
      if (keys.length) {
        const turnOn = !isWeekdayAny(wd);
        const next = new Set(value);
        keys.forEach(k => { if (turnOn) next.add(k); else next.delete(k); });
        onChange(next);
      }
    }
    setPanel({ type: 'weekday', wd });
  }

  const firstWd = dates.length ? weekday(dates[0]) : 0;

  return (
    <div>
      <div className="wdrow" role="group" aria-label="套用整個月的星期">
        {[0, 1, 2, 3, 4, 5, 6].map(wd => (
          <button type="button" key={wd} className={`wdbtn${isWeekdayAny(wd) ? ' full' : ''}`}
            disabled={!weekdayAvailKeys(wd).length}
            aria-pressed={panel?.type === 'weekday' && panel.wd === wd}
            onClick={() => clickWeekdayHeader(wd)}>
            {WD[wd]}
          </button>
        ))}
      </div>
      <div className="calgrid">
        {Array.from({ length: firstWd }).map((_, i) => <span key={`b${i}`} />)}
        {dates.map(d => {
          const has = starts.some(s => value.has(key(d, s)));
          const disabled = d < today;
          return (
            <button type="button" key={d}
              className={`caldate${has ? ' has' : ''}${panel?.type === 'date' && panel.date === d ? ' active' : ''}${d === today ? ' today' : ''}`}
              disabled={disabled}
              aria-label={md(d)}
              onClick={() => setPanel({ type: 'date', date: d })}>
              <span className="n">{+d.slice(8)}</span><span className="dot" />
            </button>
          );
        })}
      </div>
      <p className="m">點星期標題＝這個星期幾整個月都要（再點一次清空）；點某一天的數字可以只調整那一天。</p>

      {panel && (
        <div className="daypanel">
          {panel.type === 'weekday' ? (<>
            <b>整個月每週{WD[panel.wd]}</b>
            <p className="hint">預設整天開放，可以點掉不要的時段；調整會套用到這個月每一個星期{WD[panel.wd]}，單獨調整某一天不會受影響。{dashedHint}</p>
          </>) : (<>
            <b>只調整 {md(panel.date)}（{WD[weekday(panel.date)]}）</b>
            <p className="hint">只會改這一天，不影響同星期的其他週。{dashedHint}</p>
          </>)}

          <div className="hourgrid">
            {starts.map(s => {
              let on: boolean, blocked: boolean, off: boolean, handleClick: () => void;
              if (panel.type === 'weekday') {
                const ds = weekdayDates(panel.wd);
                on = isWeekdayHourFull(panel.wd, s);
                blocked = !ds.some(d => !isBlocked(d, s));
                const sampleDate = ds.find(d => !isBlocked(d, s)) ?? ds[0];
                off = dashedSet && sampleDate ? !dashedSet.has(key(sampleDate, s)) : false;
                handleClick = () => toggleWeekdayHour(panel.wd, s);
              } else {
                const k = key(panel.date, s);
                on = value.has(k);
                blocked = isBlocked(panel.date, s) || panel.date < today;
                off = dashedSet ? !dashedSet.has(k) : false;
                handleClick = () => toggleSlot(panel.date, s);
              }
              return (
                <button type="button" key={s}
                  className={`hourbtn${on ? ' on' : ''}${off ? ' off' : ''}${blocked ? ' blocked' : ''}`}
                  disabled={blocked || readOnly}
                  onClick={handleClick}>
                  {hhmm(s)}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn outline" style={{ width: '100%', marginTop: 12 }} onClick={() => setPanel(null)}>確定</button>
        </div>
      )}
    </div>
  );
}
