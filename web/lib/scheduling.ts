// 排課引擎（與 engine/src/scheduler.ts 相同，為了 Vercel 單一專案部署直接複製一份；
// 這份是正式會跑的程式，修改規則請同步更新 engine/ 那份並跑 `cd engine && npm test`）。
// v2：單一老師（Joanna）、每週一堂、無鎖定、無重排。代課老師由老師手動指定，不參與自動排課演算法。
// 時間一律用「分鐘」(例如 13:00 = 780)，日期用 'YYYY-MM-DD' 字串，避免時區問題。

export type SlotKey = string; // `${date}|${start}`
export const slotKey = (date: string, start: number): SlotKey => `${date}|${start}`;

const toUTC = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const weekday = (d: string) => new Date(toUTC(d)).getUTCDay();
export const addDays = (d: string, n: number) => fmt(toUTC(d) + n * 86400000);
export const weekStartOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const parseHM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
export const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const WD = '日一二三四五六';
export const weekdayLabel = (d: string) => WD[weekday(d)];

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function hourlyStarts(openStart: number, lastStart: number, lessonMinutes: number): number[] {
  const out: number[] = [];
  for (let s = openStart; s <= lastStart; s += lessonMinutes) out.push(s);
  return out;
}

export function ranges(starts: number[], lessonMinutes: number): [number, number][] {
  if (!starts.length) return [];
  const out: [number, number][] = [];
  let a = starts[0], b = a + lessonMinutes;
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] === b) b += lessonMinutes;
    else { out.push([a, b]); a = starts[i]; b = a + lessonMinutes; }
  }
  out.push([a, b]);
  return out;
}

export function dayWindowLabel(sel: Set<SlotKey>, date: string, starts: number[], lessonMinutes: number): string {
  const ss = starts.filter(s => sel.has(slotKey(date, s)));
  if (!ss.length) return '';
  return ranges(ss, lessonMinutes).map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join('、');
}

export function windowList(sel: Set<SlotKey>, dates: string[], starts: number[], lessonMinutes: number): string[] {
  return dates
    .map(d => { const w = dayWindowLabel(sel, d, starts, lessonMinutes); return w ? `${md(d)}（${weekdayLabel(d)}）${w}` : ''; })
    .filter(Boolean);
}

export interface WeeklyRun { windowLabel: string; dayLabel: string }
export interface AnalyzeResult { runs: WeeklyRun[]; off: string[]; changed: string[] }

export function analyzeWeeklyPattern(sel: Set<SlotKey>, dates: string[], starts: number[], lessonMinutes: number): AnalyzeResult {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const typical: Record<number, string> = {};
  const off: string[] = [];
  const changed: string[] = [];
  for (const w of order) {
    const days = dates.filter(d => weekday(d) === w);
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const d of days) {
      const lab = dayWindowLabel(sel, d, starts, lessonMinutes);
      labels.set(d, lab);
      if (lab) counts.set(lab, (counts.get(lab) ?? 0) + 1);
    }
    let best = ''; let bestN = -1;
    for (const [lab, n] of counts) if (n > bestN) { best = lab; bestN = n; }
    typical[w] = best;
    for (const d of days) {
      const lab = labels.get(d)!;
      if (!lab) { if (best) off.push(d); }
      else if (lab !== best) changed.push(`${md(d)} 改為 ${lab}`);
    }
  }
  const groups: { t: string; ws: number[] }[] = [];
  order.forEach((w, i) => {
    if (!typical[w]) return;
    const last = groups[groups.length - 1];
    if (last && last.t === typical[w] && last.ws[last.ws.length - 1] === order[i - 1]) last.ws.push(w);
    else groups.push({ t: typical[w], ws: [w] });
  });
  const runs: WeeklyRun[] = groups.map(g => {
    const n = g.ws.length;
    const dayLabel = n === 1 ? `週${WD[g.ws[0]]}` : n === 2 ? `週${WD[g.ws[0]]}、週${WD[g.ws[1]]}` : `週${WD[g.ws[0]]}至週${WD[g.ws[n - 1]]}`;
    return { windowLabel: g.t, dayLabel };
  });
  return { runs, off: off.sort(), changed };
}

export function carryForward(
  sel: Set<SlotKey>, fromDates: string[], toDates: string[], starts: number[],
  okSlot: (date: string, start: number) => boolean,
): void {
  const order = [1, 2, 3, 4, 5, 6, 0];
  for (const w of order) {
    for (const s of starts) {
      const fromDays = fromDates.filter(d => weekday(d) === w);
      const yesCount = fromDays.filter(d => sel.has(slotKey(d, s))).length;
      const yes = fromDays.length > 0 && yesCount * 2 > fromDays.length;
      for (const d of toDates) {
        if (weekday(d) !== w) continue;
        const k = slotKey(d, s);
        if (yes && okSlot(d, s)) sel.add(k); else sel.delete(k);
      }
    }
  }
}

export interface SchedStudent { id: string; name: string }
export interface Lesson { studentId: string; date: string; start: number }
export type UnassignedReason = 'taken' | 'teacher_unavailable' | 'no_selection';
export interface UnassignedEntry { studentId: string; weekStart: string; reason: UnassignedReason; windows: string[] }
export interface ScheduleResult { lessons: Lesson[]; unassigned: UnassignedEntry[] }

export const unassignedReasonLabel: Record<UnassignedReason, string> = {
  taken: 'Joanna 的時段被其他學生佔滿',
  teacher_unavailable: '學生選的時段 Joanna 不上班',
  no_selection: '這週沒有選時段',
};

export interface ScheduleInput {
  from: string; to: string;
  scheduleStart: string;
  lessonMinutes: number;
  starts: number[];
  students: SchedStudent[];
  studentAvailability: Map<string, Set<SlotKey>>;
  teacherAvailability: Set<SlotKey>;
  otherPeriodLessons: { studentId: string; date: string }[];
  /**
   * 本期先前已經排定、不會被移動的課（分批排課用）：新一批只處理還沒處理過的學生，
   * 已排定的課維持原樣，也會被視為「這個時段被佔用」。
   */
  existingLessons?: Lesson[];
}

export function runScheduling(input: ScheduleInput): ScheduleResult {
  const { from, to, scheduleStart, lessonMinutes, starts, students, studentAvailability, teacherAvailability, otherPeriodLessons, existingLessons = [] } = input;
  const allDates = datesBetween(from, to);
  const lessons: Lesson[] = [];
  const unassigned: UnassignedEntry[] = [];

  for (let weekStart = weekStartOf(scheduleStart); weekStart <= to; weekStart = addDays(weekStart, 7)) {
    const weekDates = allDates.filter(d => weekStartOf(d) === weekStart && d >= scheduleStart);
    if (!weekDates.length) continue;

    interface Seat { student: SchedStudent; candidates: SlotKey[]; compatibleCount: number }
    const seats: Seat[] = [];
    for (const st of students) {
      const alreadyThisWeek =
        lessons.some(l => l.studentId === st.id && weekStartOf(l.date) === weekStart) ||
        existingLessons.some(l => l.studentId === st.id && weekStartOf(l.date) === weekStart) ||
        otherPeriodLessons.some(l => l.studentId === st.id && weekStartOf(l.date) === weekStart);
      if (alreadyThisWeek) continue;
      const sel = studentAvailability.get(st.id) ?? new Set<SlotKey>();
      const candidates: SlotKey[] = [];
      let compatibleCount = 0;
      for (const d of weekDates) for (const s of starts) {
        const k = slotKey(d, s);
        if (!sel.has(k) || !teacherAvailability.has(k)) continue;
        compatibleCount++;
        if (!lessons.some(l => l.date === d && l.start === s) && !existingLessons.some(l => l.date === d && l.start === s)) candidates.push(k);
      }
      seats.push({ student: st, candidates, compatibleCount });
    }

    seats.sort((a, b) => a.candidates.length - b.candidates.length);
    const owner = new Map<SlotKey, number>();
    const tryAssign = (i: number, visited: Set<SlotKey>): boolean => {
      for (const k of seats[i].candidates) {
        if (visited.has(k)) continue;
        visited.add(k);
        const cur = owner.get(k);
        if (cur === undefined || tryAssign(cur, visited)) { owner.set(k, i); return true; }
      }
      return false;
    };
    const matched = new Set<number>();
    seats.forEach((_, i) => { if (tryAssign(i, new Set())) matched.add(i); });

    for (const [key, i] of owner) {
      const [date, s] = key.split('|');
      lessons.push({ studentId: seats[i].student.id, date, start: Number(s) });
    }

    seats.forEach((seat, i) => {
      if (matched.has(i)) return;
      const sel = studentAvailability.get(seat.student.id) ?? new Set<SlotKey>();
      const windows = windowList(sel, weekDates, starts, lessonMinutes);
      const reason: UnassignedReason = seat.compatibleCount ? 'taken' : windows.length ? 'teacher_unavailable' : 'no_selection';
      unassigned.push({ studentId: seat.student.id, weekStart, reason, windows });
    });
  }

  lessons.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return { lessons, unassigned };
}
