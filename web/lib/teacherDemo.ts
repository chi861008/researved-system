// 老師端展示用種子資料（之後接資料庫後，改由 teachers / students / periods 資料表讀取）
// 目前有「多位老師、各自資料獨立」兩組示範資料，方便在畫面上切換測試隔離是否正確。
import { datesBetween, parseHM, slotKey, weekday } from './scheduling';
import type { WeeklyPattern } from './weeklyPattern';

export interface DemoStudent { id: string; name: string }
export interface DemoTeacher { id: string; name: string }

export const DEMO_TEACHERS: DemoTeacher[] = [
  { id: 't1', name: 'Joanna' },
  { id: 't2', name: 'Coco' },
];

// 示範用「主要老師」：只是標記最早建立的那位（展示模式固定是 Joanna），用來避免被刪除，
// 不是誰才能新增其他老師的權限限制——新老師可以自己打開加入連結、填名字、產生自己的邀請連結，
// 不需要先經過主要老師同意（接上真正 LINE 登入後，要不要加審核機制由使用者決定）。
export const MAIN_TEACHER_ID = DEMO_TEACHERS[0].id;

export const DEMO_STUDENTS_BY_TEACHER: Record<string, DemoStudent[]> = {
  t1: [
    { id: 't1-s1', name: 'Amy' },
    { id: 't1-s2', name: 'Bella' },
    { id: 't1-s3', name: 'Cindy' },
    { id: 't1-s4', name: 'Dora' },
    { id: 't1-s5', name: 'Emma' },
  ],
  t2: [
    { id: 't2-s1', name: 'Grace' },
    { id: 't2-s2', name: 'Henry' },
  ],
};

/** 把「星期幾 + 起訖時間」的規律展開成一組 Set（整點起算，60 分鐘一堂） */
function weeklyPattern(dates: string[], starts: number[], weekdays: number[], startHM: string, endHM: string): Set<string> {
  const s = new Set<string>();
  const a = parseHM(startHM), b = parseHM(endHM);
  for (const d of dates) {
    if (!weekdays.includes(weekday(d))) continue;
    for (const st of starts) if (st >= a && st + 60 <= b) s.add(slotKey(d, st));
  }
  return s;
}

const STUDENT_PATTERNS: Record<string, [number[], string, string]> = {
  't1-s1': [[1, 2, 3, 4], '19:00', '22:00'],
  't1-s2': [[1, 3, 5], '18:00', '21:00'],
  't1-s3': [[2, 4], '19:00', '21:00'],
  't1-s4': [[1, 2, 3, 4, 5], '10:00', '14:00'],
  't1-s5': [[6, 0], '13:00', '18:00'],
  't2-s1': [[1, 2, 3], '18:00', '21:00'],
  't2-s2': [[4, 5], '19:00', '22:00'],
};

/** 展示用：依老師 id 產生該老師名下學生的預設可上課時段 */
export function seedDemoAvailability(teacherId: string, dates: string[], starts: number[]): Map<string, Set<string>> {
  const students = DEMO_STUDENTS_BY_TEACHER[teacherId] ?? [];
  const m = new Map<string, Set<string>>();
  for (const st of students) {
    const pat = STUDENT_PATTERNS[st.id];
    m.set(st.id, pat ? weeklyPattern(dates, starts, pat[0], pat[1], pat[2]) : new Set());
  }
  return m;
}

export function seedTeacherAvailability(dates: string[], starts: number[], isBlocked: (d: string, s: number) => boolean) {
  const s = new Set<string>();
  const a = parseHM('13:00'), b = parseHM('22:00');
  for (const d of dates) for (const st of starts) if (st >= a && st + 60 <= b && !isBlocked(d, st)) s.add(slotKey(d, st));
  return s;
}

// ---------- 展示用「邀請連結 → 學生填名字加入」----------
// 還沒有真正的資料庫，先用 localStorage 當作共用的假資料庫：同一台瀏覽器的不同分頁（老師頁／學生頁）
// 可以互相看到彼此寫入的東西，讓老師開邀請連結、學生加入後，老師頁重新整理就能看到人。
// 接上真正的 LINE 登入＋資料庫後，這整個檔案會被「用 LINE userId 查 students 表」取代。
export const JOINED_STORAGE_KEY = 'pilates-demo-joined-students';
const JOINED_KEY = JOINED_STORAGE_KEY;
const MY_JOIN_KEY_PREFIX = 'pilates-demo-my-join-';

type JoinedStore = Record<string, DemoStudent[]>; // teacherId -> 透過邀請連結加入的學生

function readJoinedStore(): JoinedStore {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(JOINED_KEY) || '{}'); } catch { return {}; }
}
function writeJoinedStore(store: JoinedStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(JOINED_KEY, JSON.stringify(store));
}

/** 這位老師目前透過邀請連結加入的學生（老師端用來合併進名單） */
export function getJoinedStudents(teacherId: string): DemoStudent[] {
  return readJoinedStore()[teacherId] ?? [];
}

/** 這台瀏覽器之前有沒有以學生身份加入過這位老師（學生端用來判斷要不要顯示「填名字」畫面） */
export function getMyJoin(teacherId: string): DemoStudent | null {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(MY_JOIN_KEY_PREFIX + teacherId); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** 學生第一次填名字加入：寫進「老師的學生名單」，也記住「我在這位老師底下是誰」 */
export function joinAsStudent(teacherId: string, name: string): DemoStudent {
  const store = readJoinedStore();
  const student: DemoStudent = { id: `${teacherId}-join-${Date.now()}`, name };
  store[teacherId] = [...(store[teacherId] ?? []), student];
  writeJoinedStore(store);
  if (typeof window !== 'undefined') window.localStorage.setItem(MY_JOIN_KEY_PREFIX + teacherId, JSON.stringify(student));
  return student;
}

// ---------- 展示用「學生送出的時段」----------
// 學生送出時段這個 API（/api/availability）在展示模式下只回傳 {ok:true}，不會真的寫進任何資料庫，
// 老師端是另一個 React 分頁、另一份記憶體，沒有這一段的話老師永遠看不到剛剛那位學生送出了什麼。
export const SUBMITTED_AVAIL_STORAGE_PREFIX = 'pilates-demo-submitted-avail-';

/** 學生送出時段後：把實際勾選的格子存起來，老師那頁（同一瀏覽器的另一個分頁，或重新整理後）才讀得到。 */
export function saveDemoSubmittedAvailability(teacherId: string, studentId: string, keys: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SUBMITTED_AVAIL_STORAGE_PREFIX + teacherId + '|' + studentId, JSON.stringify(keys));
}

/** 老師端讀取某位（透過邀請連結加入的）學生實際送出過的時段。 */
export function getDemoSubmittedAvailability(teacherId: string, studentId: string): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(SUBMITTED_AVAIL_STORAGE_PREFIX + teacherId + '|' + studentId) || '[]'); } catch { return []; }
}

// ---------- 展示用「新增老師」----------
// 對應真實規格：新增老師＝主要老師把同事的 LINE 帳號加進白名單，一次性設定、不是對方自己填名字加入。
// 展示模式一樣先存在 localStorage，讓畫面上新增的老師重新整理後還在。
export const ADDED_TEACHERS_STORAGE_KEY = 'pilates-demo-added-teachers';

function readAddedTeachers(): DemoTeacher[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(ADDED_TEACHERS_STORAGE_KEY) || '[]'); } catch { return []; }
}
function writeAddedTeachers(list: DemoTeacher[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADDED_TEACHERS_STORAGE_KEY, JSON.stringify(list));
}

export const DELETED_TEACHERS_STORAGE_KEY = 'pilates-demo-deleted-teachers';

function readDeletedTeacherIds(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(DELETED_TEACHERS_STORAGE_KEY) || '[]'); } catch { return []; }
}
function writeDeletedTeacherIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DELETED_TEACHERS_STORAGE_KEY, JSON.stringify(ids));
}

/** 固定的示範老師 + 後來新增的老師，扣掉刪除過的，合併成完整名單（老師端切換、學生端驗證邀請連結都要用這份）；
 * 名字如果在「老師管理」頁改過，這裡要套用覆蓋值，不然到處顯示的還是原本的 Joanna/Coco。 */
export function getAllTeachers(): DemoTeacher[] {
  const deleted = new Set(readDeletedTeacherIds());
  return [...DEMO_TEACHERS, ...readAddedTeachers()]
    .filter(t => !deleted.has(t.id))
    .map(t => { const nm = getDemoTeacherSettings(t.id).name?.trim(); return nm ? { ...t, name: nm } : t; });
}

/** 新增一位老師，回傳新老師的資料（管理頁用：手動幫同事加一筆） */
export function addTeacher(name: string): DemoTeacher {
  const list = readAddedTeachers();
  const teacher: DemoTeacher = { id: `t-add-${Date.now()}`, name };
  writeAddedTeachers([...list, teacher]);
  return teacher;
}

/** 刪除老師（白名單移除）；不能刪除最早建立的那位，避免展示模式被清空 */
export function deleteTeacher(id: string) {
  if (id === MAIN_TEACHER_ID) return;
  const deleted = readDeletedTeacherIds();
  if (!deleted.includes(id)) writeDeletedTeacherIds([...deleted, id]);
  writeAddedTeachers(readAddedTeachers().filter(t => t.id !== id));
}

// ---------- 展示用「老師自己點連結、填名字加入」----------
const MY_TEACHER_ID_KEY = 'pilates-demo-my-teacher-id';

/** 這台瀏覽器之前有沒有自己加入過（老師端用來決定一進 /teacher 要預設顯示誰） */
export function getMyTeacherId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(MY_TEACHER_ID_KEY);
}

/** 新老師自己打開加入連結、填名字：建立老師資料，並記住「這台瀏覽器是這位老師」 */
export function joinAsTeacher(name: string): DemoTeacher {
  const teacher = addTeacher(name);
  if (typeof window !== 'undefined') window.localStorage.setItem(MY_TEACHER_ID_KEY, teacher.id);
  return teacher;
}

// ---------- 展示用「常用時段快速套用」：記住的規律存 localStorage，不接資料庫 ----------
const TEACHER_PATTERN_KEY_PREFIX = 'pilates-demo-teacher-pattern-';
const STUDENT_PATTERN_KEY_PREFIX = 'pilates-demo-student-pattern-';

export function getDemoTeacherPattern(teacherId: string): WeeklyPattern | null {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(TEACHER_PATTERN_KEY_PREFIX + teacherId); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveDemoTeacherPattern(teacherId: string, pattern: WeeklyPattern) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TEACHER_PATTERN_KEY_PREFIX + teacherId, JSON.stringify(pattern));
}

export function getDemoStudentPattern(teacherId: string, studentId: string): WeeklyPattern | null {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(STUDENT_PATTERN_KEY_PREFIX + teacherId + '|' + studentId); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveDemoStudentPattern(teacherId: string, studentId: string, pattern: WeeklyPattern) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STUDENT_PATTERN_KEY_PREFIX + teacherId + '|' + studentId, JSON.stringify(pattern));
}

// ---------- 展示用「可自訂的老師設定」：我的名字／課程名稱／選課規則／上班時段通知文字 ----------
// 呼應真老師那邊 teachers 表的對應欄位，一樣存 localStorage，讓「老師管理」頁的展示模式也能示範
// 這幾個設定，不是只有接了資料庫的真老師才看得到新版介面。
export interface DemoTeacherSettings {
  name?: string;
  courseName?: string;
  courseRules?: string;
  hoursPrefix?: string;
  hoursSuffix?: string;
}
const TEACHER_SETTINGS_STORAGE_PREFIX = 'pilates-demo-teacher-settings-';
export { TEACHER_SETTINGS_STORAGE_PREFIX };

export function getDemoTeacherSettings(teacherId: string): DemoTeacherSettings {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(TEACHER_SETTINGS_STORAGE_PREFIX + teacherId) || '{}'); } catch { return {}; }
}
export function saveDemoTeacherSettings(teacherId: string, patch: DemoTeacherSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TEACHER_SETTINGS_STORAGE_PREFIX + teacherId, JSON.stringify({ ...getDemoTeacherSettings(teacherId), ...patch }));
}

// ---------- 展示用「這個月還能不能編輯」----------
// 學生能不能編輯要看老師那個月的狀態（收集中才能），但老師端的 periods 狀態只存在 /teacher 頁的
// React 記憶體裡，學生頁是完全獨立的另一個元件，看不到——所以額外存一份「鎖住了沒」到 localStorage。
// 只分兩種：collecting（學生可以編輯）／locked（已經排課，draft／approved／notified 都算，不能再編輯）。
export type DemoPeriodStatus = 'collecting' | 'locked';
export const PERIOD_STATUS_STORAGE_PREFIX = 'pilates-demo-period-status-';

export function getDemoPeriodStatus(teacherId: string, ym: string): DemoPeriodStatus {
  if (typeof window === 'undefined') return 'collecting';
  return window.localStorage.getItem(PERIOD_STATUS_STORAGE_PREFIX + teacherId + '|' + ym) === 'locked' ? 'locked' : 'collecting';
}
export function saveDemoPeriodStatus(teacherId: string, ym: string, status: DemoPeriodStatus) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PERIOD_STATUS_STORAGE_PREFIX + teacherId + '|' + ym, status);
}

export { datesBetween };
