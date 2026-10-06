import { parseHM } from './scheduling';
import { STUDIO_STARTS } from './ym';
import type { SlotPreset } from '@/components/PresetChips';

export const STUDENT_PRESETS: SlotPreset[] = [
  { id: 'wkday-19-21', label: '平日晚上 19–21', weekdays: [1, 2, 3, 4, 5], starts: [parseHM('19:00'), parseHM('20:00')] },
  { id: 'wkday-18-21', label: '平日晚上 18–21', weekdays: [1, 2, 3, 4, 5], starts: [parseHM('18:00'), parseHM('19:00'), parseHM('20:00')] },
  { id: 'weekend-all', label: '週末全天', weekdays: [0, 6], starts: STUDIO_STARTS },
];
