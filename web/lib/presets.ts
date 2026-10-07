import { parseHM } from './scheduling';
import { STUDIO_STARTS } from './ym';
import type { SlotPreset } from '@/components/PresetChips';

// 標籤上的「19–21」「18–21」是指最後一堂可以幾點「開始」，不是幾點「結束」——
// 所以 21 要包含 21:00 這個開始時間，不是停在 20:00（最後一堂 20:00–21:00 就沒把 21:00 這個按鈕也選進去）。
export const STUDENT_PRESETS: SlotPreset[] = [
  { id: 'wkday-19-21', label: '平日晚上 19–21', weekdays: [1, 2, 3, 4, 5], starts: [parseHM('19:00'), parseHM('20:00'), parseHM('21:00')] },
  { id: 'wkday-18-21', label: '平日晚上 18–21', weekdays: [1, 2, 3, 4, 5], starts: [parseHM('18:00'), parseHM('19:00'), parseHM('20:00'), parseHM('21:00')] },
  { id: 'weekend-all', label: '週末全天', weekdays: [0, 6], starts: STUDIO_STARTS },
];
