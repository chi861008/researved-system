export type TeacherNavIconName = 'hours' | 'plan' | 'students' | 'manage';

export default function TeacherNavIcon({ name }: { name: TeacherNavIconName }) {
  const common = {
    className: 'tab-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (name === 'hours') return (
    <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M12 14v3l2 1" /></svg>
  );
  if (name === 'plan') return (
    <svg {...common}><path d="M4 5h16M4 12h10M4 19h7" /><path d="m17 15 1.2 2.2L21 18l-2 1.8.4 2.7-2.4-1.3-2.4 1.3.4-2.7-2-1.8 2.8-.8L17 15Z" /></svg>
  );
  if (name === 'students') return (
    <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 6.3a3 3 0 0 1 0 5.4M16.5 14.5A5 5 0 0 1 21 19v1" /></svg>
  );
  return (
    <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M6 20v-2a6 6 0 0 1 12 0v2" /><path d="M18.5 4.5 20 3m-1.5 1.5L20 6m-1.5-1.5H17" /></svg>
  );
}
