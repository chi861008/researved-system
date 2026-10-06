import { dayWindowLabel, weekday } from './scheduling';

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const FONT = 'font-family="PingFang TC, Microsoft JhengHei, Noto Sans TC, system-ui, sans-serif"';
const COL = { ink: '#2e2722', muted: '#9c8f7e', line: '#e3d8c9', on: '#d9622f', card: '#fbf7f1', soft: '#fbe3d4', warn: '#b2501f', bg: '#efe8df' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Run { dayLabel: string; windowLabel: string }
interface Exception { date: string; kind: 'off' | 'custom'; label: string }

/** 跟 lib/scheduling.ts 的 analyzeWeeklyPattern 同一套邏輯（同星期幾裡最多天數的時段當「預設」，
 * 少數跟多數不一樣的當例外），但回傳的是畫圖用的原始資料，不是給學生看的格式化文字。 */
function analyzeForImage(sel: Set<string>, dates: string[], starts: number[], lessonMinutes: number): { runs: Run[]; exceptions: Exception[] } {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const typical: Record<number, string> = {};
  const exceptions: Exception[] = [];
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
      if (lab !== best) exceptions.push(lab ? { date: d, kind: 'custom', label: lab } : { date: d, kind: 'off', label: '休假' });
    }
  }
  const groups: { t: string; ws: number[] }[] = [];
  order.forEach((w, i) => {
    if (!typical[w]) return;
    const last = groups[groups.length - 1];
    if (last && last.t === typical[w] && last.ws[last.ws.length - 1] === order[i - 1]) last.ws.push(w);
    else groups.push({ t: typical[w], ws: [w] });
  });
  const runs: Run[] = groups.map(g => {
    const n = g.ws.length;
    const dayLabel = n === 1 ? `週${WD[g.ws[0]]}` : n === 2 ? `週${WD[g.ws[0]]}、週${WD[g.ws[1]]}` : `週${WD[g.ws[0]]}至週${WD[g.ws[n - 1]]}`;
    return { dayLabel, windowLabel: g.t };
  });
  return { runs, exceptions };
}

/** 畫一張「本月上班時段」的 SVG 月曆圖：預設時段留白，只標「休假」或「可約 HH:MM–HH:MM」這種例外，
 * 右側一塊說明區寫預設時段是什麼。回傳完整的 <svg>...</svg> 字串，給轉 PNG 用。 */
export function buildHoursCalendarSvg(opts: {
  year: number; month: number; teacherName: string;
  dates: string[]; sel: Set<string>; starts: number[]; lessonMinutes: number;
}): string {
  const { year, month, teacherName, dates, sel, starts, lessonMinutes } = opts;
  const { runs, exceptions } = analyzeForImage(sel, dates, starts, lessonMinutes);
  const exByDate = new Map(exceptions.map(e => [e.date, e]));

  const cols = 7, gridW = 700, legendW = 220, gap = 20, headH = 40, cellW = gridW / cols, cellH = 80;
  const firstWd = dates.length ? weekday(dates[0]) : 0;
  const rows = Math.max(1, Math.ceil((firstWd + dates.length) / cols));
  const gridH = headH + rows * cellH;
  const legendH = Math.max(gridH, 150 + runs.length * 56);
  const totalW = gridW + gap + legendW, totalH = Math.max(gridH, legendH);

  let s = `<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="${COL.bg}"/>`;

  for (let c = 0; c < cols; c++) {
    const weekend = c === 0 || c === 6;
    s += `<text x="${c * cellW + cellW / 2}" y="${headH - 14}" text-anchor="middle" font-size="17" font-weight="700" fill="${weekend ? COL.on : COL.ink}" ${FONT}>${WD[c]}</text>`;
  }
  s += `<line x1="0" y1="${headH}" x2="${gridW}" y2="${headH}" stroke="${COL.line}" stroke-width="1.5"/>`;

  dates.forEach((date, i) => {
    const d = i + 1;
    const idx = firstWd + i;
    const row = Math.floor(idx / cols), col = idx % cols;
    const x = col * cellW, y = headH + row * cellH;
    const ex = exByDate.get(date);

    if (ex) s += `<rect x="${x + 3}" y="${y + 3}" width="${cellW - 6}" height="${cellH - 6}" rx="10" fill="${COL.soft}"/>`;
    s += `<text x="${x + 11}" y="${y + 23}" font-size="18" font-weight="700" fill="${ex ? COL.on : COL.ink}" ${FONT}>${d}</text>`;

    if (ex) {
      const color = ex.kind === 'off' ? COL.warn : COL.on;
      const lines = ex.kind === 'off' ? ['休假'] : ['可約', ex.label];
      const startY = y + cellH / 2 - ((lines.length - 1) * 11) + 10;
      lines.forEach((line, li) => {
        s += `<text x="${x + cellW / 2}" y="${startY + li * 22}" text-anchor="middle" font-size="16" font-weight="700" fill="${color}" ${FONT}>${esc(line)}</text>`;
      });
    }
  });

  for (let r = 0; r <= rows; r++) s += `<line x1="0" y1="${headH + r * cellH}" x2="${gridW}" y2="${headH + r * cellH}" stroke="${COL.line}" stroke-width="1"/>`;
  for (let c = 0; c <= cols; c++) s += `<line x1="${c * cellW}" y1="${headH}" x2="${c * cellW}" y2="${headH + rows * cellH}" stroke="${COL.line}" stroke-width="1"/>`;

  const lx = gridW + gap;
  s += `<rect x="${lx}" y="0" width="${legendW}" height="${totalH}" rx="14" fill="${COL.card}" stroke="${COL.line}"/>`;
  let ly = 38;
  s += `<text x="${lx + legendW / 2}" y="${ly}" text-anchor="middle" font-size="17" font-weight="700" fill="${COL.ink}" ${FONT}>🌸 ${esc(teacherName)}・${month} 月</text>`;
  ly += 34;
  s += `<text x="${lx + legendW / 2}" y="${ly}" text-anchor="middle" font-size="16" font-weight="700" fill="${COL.ink}" ${FONT}>空白的日期</text>`;
  ly += 24;
  s += `<text x="${lx + legendW / 2}" y="${ly}" text-anchor="middle" font-size="15" font-weight="600" fill="${COL.muted}" ${FONT}>都是預設上班時段：</text>`;
  ly += 36;
  if (!runs.length) {
    s += `<text x="${lx + legendW / 2}" y="${ly}" text-anchor="middle" font-size="15" font-weight="600" fill="${COL.muted}" ${FONT}>本月無上班</text>`;
  }
  runs.forEach(run => {
    s += `<text x="${lx + legendW / 2}" y="${ly}" text-anchor="middle" font-size="15" font-weight="600" fill="${COL.muted}" ${FONT}>${esc(run.dayLabel)}</text>`;
    ly += 22;
    s += `<text x="${lx + legendW / 2}" y="${ly}" text-anchor="middle" font-size="15" font-weight="600" fill="${COL.muted}" ${FONT}>${esc(run.windowLabel)}</text>`;
    ly += 34;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">${s}</svg>`;
}
