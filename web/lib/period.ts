// 選課期間設定（展示用；之後改由資料庫 periods / weekly_blocks 讀取）
import { hourlyStarts, parseHM } from './scheduling';

export interface DemoPeriod {
  ym: string; from: string; to: string; deadline: string;
  starts: number[]; lessonMinutes: number;
  weeklyBlocks: { weekday: number; start: number; end: number }[];
  teacherHours: { startHM: string; endHM: string }; // Joanna 預設上班時段（展示用，實際以老師端設定為準）
}

export const DEMO_PERIOD: DemoPeriod = {
  ym: '2026-11', from: '2026-11-01', to: '2026-11-30', deadline: '2026-11-10',
  starts: hourlyStarts(parseHM('10:00'), parseHM('21:00'), 60),
  lessonMinutes: 60,
  weeklyBlocks: [{ weekday: 3, start: parseHM('16:00'), end: parseHM('17:00') }],
  teacherHours: { startHM: '13:00', endHM: '22:00' },
};

export const slotBlocked = (p: Pick<DemoPeriod, 'weeklyBlocks' | 'lessonMinutes'>, weekday: number, start: number) =>
  p.weeklyBlocks.some(b => b.weekday === weekday && start < b.end && b.start < start + p.lessonMinutes);
