import {
  runScheduling, analyzeWeeklyPattern, carryForward, windowList, dayWindowLabel, ranges,
  hourlyStarts, slotKey, weekday, weekStartOf, addDays, parseHM, hhmm,
} from './scheduler.js';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fail++; console.log('✗', msg); } else { console.log('✓', msg); } };

// ---------- 共用資料 ----------
const FROM = '2026-10-01', TO = '2026-10-31';
const L = 60;
const starts = hourlyStarts(parseHM('10:00'), parseHM('21:00'), L); // 10:00–21:00 整點

const allDays = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

/** 把「星期幾 + 起訖時間」的規律展開成一個月的 Set */
function weeklyPatternSet(dates: string[], weekdays: number[], startHM: string, endHM: string): Set<string> {
  const s = new Set<string>();
  const a = parseHM(startHM), b = parseHM(endHM);
  for (const d of dates) {
    if (!weekdays.includes(weekday(d))) continue;
    for (const st of starts) if (st >= a && st + L <= b) s.add(slotKey(d, st));
  }
  return s;
}

const monthDates = allDays(FROM, TO);

// ========== 1. 排課主流程：模擬交接文件描述的情境 ==========
{
  // Joanna 13:00–22:00 全月上班，另外 10/12–10/14 休假
  const joanna = weeklyPatternSet(monthDates, [0, 1, 2, 3, 4, 5, 6], '13:00', '22:00');
  for (const d of ['2026-10-12', '2026-10-13', '2026-10-14']) for (const s of starts) joanna.delete(slotKey(d, s));

  const students = [
    { id: 's1', name: 'Amy' }, { id: 's2', name: 'Bella' }, { id: 's3', name: 'Cindy' },
    { id: 's4', name: 'Dora' }, { id: 's5', name: 'Emma' },
  ];
  const studentAvailability = new Map<string, Set<string>>([
    ['s1', weeklyPatternSet(monthDates, [1, 2, 3, 4], '19:00', '22:00')],
    ['s2', weeklyPatternSet(monthDates, [1, 3, 5], '18:00', '21:00')],
    ['s3', weeklyPatternSet(monthDates, [2, 4], '19:00', '21:00')],
    ['s4', weeklyPatternSet(monthDates, [1, 2, 3, 4, 5], '10:00', '13:00')], // 白天，跟 Joanna 13:00–22:00 完全不重疊
    ['s5', weeklyPatternSet(monthDates, [6, 0], '13:00', '18:00')],
  ]);

  const res = runScheduling({
    from: FROM, to: TO, scheduleStart: FROM, lessonMinutes: L, starts, students,
    studentAvailability, teacherAvailability: joanna, otherPeriodLessons: [],
  });

  console.log(`\n共排入 ${res.lessons.length} 堂；待補 ${res.unassigned.length} 位次`);

  const seen = new Set<string>();
  for (const l of res.lessons) {
    const k = slotKey(l.date, l.start);
    check(!seen.has(k), `衝堂 ${k}`); seen.add(k);
    check(!(weekday(l.date) === 3 && l.start >= parseHM('16:00') && l.start < parseHM('17:00')), `排進週三公司開會 ${l.date}`);
    check(!['2026-10-12', '2026-10-13', '2026-10-14'].includes(l.date), `Joanna 休假被排課 ${l.date}`);
    check(joanna.has(k), `排進 Joanna 不上班的時段 ${k}`);
    const sel = studentAvailability.get(l.studentId)!;
    check(sel.has(k), `排進學生沒選的時段 ${l.studentId} ${k}`);
  }
  const perWeek = new Map<string, number>();
  for (const l of res.lessons) { const k = `${l.studentId}|${weekStartOf(l.date)}`; perWeek.set(k, (perWeek.get(k) ?? 0) + 1); }
  for (const [k, n] of perWeek) check(n <= 1, `每週超過一堂 ${k}`);

  // Dora（s4）選的是白天 10:00–13:00，跟 Joanna 13:00–22:00 完全不重疊 → 每週都該待補，原因是「Joanna 不上班」
  const doraUnassigned = res.unassigned.filter(u => u.studentId === 's4');
  check(doraUnassigned.length > 0, 'Dora 應該每週都待補（白天時段與 Joanna 上班時間完全不重疊）');
  check(doraUnassigned.every(u => u.reason === 'teacher_unavailable'), 'Dora 待補原因應全部是「學生選的時段 Joanna 不上班」');
}

// ========== 2. 待補原因分類：三種情況各自觸發 ==========
{
  const students = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const teacherAvailability = new Set<string>([slotKey('2026-11-02', 600)]); // 週一 10:00 Joanna 有空，僅此一格
  const studentAvailability = new Map<string, Set<string>>([
    ['a', new Set()], // 完全沒選 → no_selection
    ['b', new Set([slotKey('2026-11-02', 660)])], // 選了 11:00，但 Joanna 只開 10:00 → teacher_unavailable
  ]);
  const res = runScheduling({
    from: '2026-11-01', to: '2026-11-07', scheduleStart: '2026-11-01', lessonMinutes: 60,
    starts: [600, 660], students, studentAvailability, teacherAvailability, otherPeriodLessons: [],
  });
  check(res.lessons.length === 0, '兩人都不該被排入');
  const ua = Object.fromEntries(res.unassigned.map(u => [u.studentId, u.reason]));
  check(ua['a'] === 'no_selection', `A 應為 no_selection，實際 ${ua['a']}`);
  check(ua['b'] === 'teacher_unavailable', `B 應為 teacher_unavailable，實際 ${ua['b']}`);
}
{
  // 兩個學生搶同一個 Joanna 時段、且沒有其他候選 → 其中一人應為 taken
  const students = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const teacherAvailability = new Set<string>([slotKey('2026-11-02', 600)]);
  const studentAvailability = new Map<string, Set<string>>([
    ['a', new Set([slotKey('2026-11-02', 600)])],
    ['b', new Set([slotKey('2026-11-02', 600)])],
  ]);
  const res = runScheduling({
    from: '2026-11-02', to: '2026-11-02', scheduleStart: '2026-11-02', lessonMinutes: 60,
    starts: [600], students, studentAvailability, teacherAvailability, otherPeriodLessons: [],
  });
  check(res.lessons.length === 1, '只有一人能排進唯一的時段');
  check(res.unassigned.length === 1 && res.unassigned[0].reason === 'taken', `沒排到的那位應為 taken，實際 ${JSON.stringify(res.unassigned)}`);
}

// ========== 3. 跨月同一週不重複排 ==========
{
  const students = [{ id: 'a', name: 'A' }];
  // 10/26（一）～11/1（日）跨月；上個月（10 月）已經把 A 排在 10/28
  const teacherAvailability = weeklyPatternSet(allDays('2026-10-26', '2026-11-30'), [0, 1, 2, 3, 4, 5, 6], '10:00', '21:00');
  const studentAvailability = new Map<string, Set<string>>([
    ['a', weeklyPatternSet(allDays('2026-10-26', '2026-11-30'), [3, 5], '10:00', '21:00')],
  ]);
  const res = runScheduling({
    from: '2026-11-01', to: '2026-11-30', scheduleStart: '2026-11-01', lessonMinutes: 60, starts,
    students, studentAvailability, teacherAvailability,
    otherPeriodLessons: [{ studentId: 'a', date: '2026-10-28' }], // 跨月那一週（10/26 起）已經排過
  });
  const crossWeekLesson = res.lessons.find(l => weekStartOf(l.date) === '2026-10-26');
  check(!crossWeekLesson, '跨月那一週不應該再排一次（上個月已排過）');
}

// ========== 3b. 分批排課：已填的先排，existingLessons 不會被移動或重複佔用 ==========
{
  const teacherAvailability = new Set<string>([slotKey('2026-11-02', 600)]); // 本週 Joanna 只開一個時段
  const studentAvailability = new Map<string, Set<string>>([
    ['a', new Set([slotKey('2026-11-02', 600)])],
    ['b', new Set([slotKey('2026-11-02', 600)])], // 跟 a 搶同一格，但 b 是第二批才填
  ]);
  // 第一批：只有 a 填了，先排 a（11/2 是週一，剛好一整週，避免跨到前一個零散週）
  const pass1 = runScheduling({
    from: '2026-11-02', to: '2026-11-08', scheduleStart: '2026-11-02', lessonMinutes: 60, starts: [600],
    students: [{ id: 'a', name: 'A' }], studentAvailability, teacherAvailability, otherPeriodLessons: [],
  });
  check(pass1.lessons.length === 1 && pass1.lessons[0].studentId === 'a', 'A 應該被排進第一批');

  // 第二批：b 填完後才加入，帶入第一批已排定的課
  const pass2 = runScheduling({
    from: '2026-11-02', to: '2026-11-08', scheduleStart: '2026-11-02', lessonMinutes: 60, starts: [600],
    students: [{ id: 'b', name: 'B' }], studentAvailability, teacherAvailability, otherPeriodLessons: [],
    existingLessons: pass1.lessons,
  });
  check(pass2.lessons.length === 0, 'B 不應該被排進（唯一時段已被 A 佔用）');
  check(pass2.unassigned.length === 1 && pass2.unassigned[0].reason === 'taken', 'B 應該待補，原因是被佔滿');

  // existingLessons 本身不會出現在新一批的回傳結果裡，也不會被重新指派給別人
  check(!pass2.lessons.some(l => l.studentId === 'a'), '第二批結果不應該包含 A（A 已經在第一批排定，不會被重排）');
}

// ========== 4. analyzeWeeklyPattern：週間規律、休假、例外調整 ==========
{
  const dates = allDays('2026-10-01', '2026-10-31'); // 10/1 是週四
  const sel = new Set<string>();
  for (const d of dates) {
    const w = weekday(d);
    if ([1, 2, 3, 4].includes(w)) for (const s of starts) if (s >= parseHM('19:00') && s + L <= parseHM('22:00')) sel.add(slotKey(d, s));
  }
  // 10/19（一）請假：清空
  for (const s of starts) sel.delete(slotKey('2026-10-19', s));
  // 10/20（二）臨時改時間
  for (const s of starts) sel.delete(slotKey('2026-10-20', s));
  for (const s of starts) if (s >= parseHM('20:00') && s + L <= parseHM('22:00')) sel.add(slotKey('2026-10-20', s));

  const a = analyzeWeeklyPattern(sel, dates, starts, L);
  check(a.runs.length === 1 && a.runs[0].dayLabel === '週一至週四', `應合併成「週一至週四」，實際 ${JSON.stringify(a.runs)}`);
  check(a.runs[0].windowLabel === '19:00–22:00', `時段應為 19:00–22:00，實際 ${a.runs[0].windowLabel}`);
  check(a.off.includes('2026-10-19'), '10/19 應列為休假');
  check(a.changed.some(x => x.startsWith('10/20')), '10/20 應列為例外調整');
}

// ========== 5. carryForward：過半數規則、個別例外不帶入、封鎖時段不帶入 ==========
{
  const fromDates = allDays('2026-10-01', '2026-10-31'); // 5 個週一（10/5,12,19,26 其實是 4 個，視日曆而定）
  const sel = new Set<string>();
  const mondays = fromDates.filter(d => weekday(d) === 1);
  mondays.forEach((d, i) => { if (i < mondays.length - 1) sel.add(slotKey(d, 1200)); }); // 除了最後一個週一都選 20:00（超過半數）
  const toDates = allDays('2026-11-01', '2026-11-30');
  carryForward(sel, fromDates, toDates, [1200], () => true);
  const toMonday = toDates.find(d => weekday(d) === 1)!;
  check(sel.has(slotKey(toMonday, 1200)), '過半數的星期一 20:00 應該帶入下個月');

  // 封鎖時段（okSlot 回傳 false）即使過半數也不帶入
  const sel2 = new Set<string>();
  mondays.forEach(d => sel2.add(slotKey(d, 960))); // 全部週一都選，但這個時段被封鎖
  carryForward(sel2, fromDates, toDates, [960], () => false);
  check(!sel2.has(slotKey(toMonday, 960)), '封鎖時段不應該被帶入，即使上個月全選');
}

// ========== 6. 時段格式化小工具 ==========
{
  check(JSON.stringify(ranges([600, 660, 720, 900], 60)) === JSON.stringify([[600, 780], [900, 960]]), 'ranges 應合併連續起點');
  const sel = new Set([slotKey('2026-10-05', 600), slotKey('2026-10-05', 660)]);
  check(dayWindowLabel(sel, '2026-10-05', [600, 660, 720], 60) === '10:00–12:00', 'dayWindowLabel 應合併成一段');
  check(hhmm(90) === '01:30', 'hhmm 格式化');
  const wl = windowList(sel, ['2026-10-05'], [600, 660, 720], 60);
  check(wl.length === 1 && wl[0].includes('10:00–12:00'), 'windowList 應包含日期與星期標籤');
}

console.log(fail === 0 ? '\n✓ 所有規則檢查通過' : `\n✗ ${fail} 項失敗`);
process.exit(fail ? 1 : 0);
