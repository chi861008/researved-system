import { hourlyStarts, parseHM } from './scheduling';

// 月份字串（'2026-11'）的共用換算，老師端畫面和新的伺服器端 API 都要用同一份，避免兩邊算法兜不起來。
export const ymFrom = (ym: string) => `${ym}-01`;
export const ymEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const nextYm = (ym: string) => { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
export const ymLabel = (ym: string) => `${ym.slice(0, 4)} 年 ${+ym.slice(5)} 月`;

// 全工作室共用的選課時段範圍：10:00–21:00 整點起算、每堂 60 分鐘。
export const STUDIO_STARTS = hourlyStarts(parseHM('10:00'), parseHM('21:00'), 60);
export const LESSON_MINUTES = 60;
