'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import CollapsibleSlotGrid from '@/components/CollapsibleSlotGrid';
import CopyBtn from '@/components/CopyBtn';
import SaveImageBtn from '@/components/SaveImageBtn';
import TeacherNavIcon, { type TeacherNavIconName } from '@/components/TeacherNavIcon';
import { buildHoursCalendarSvg } from '@/lib/hoursCalendarSvg';
import {
  DEMO_TEACHERS, DEMO_STUDENTS_BY_TEACHER, seedDemoAvailability, seedTeacherAvailability,
  getJoinedStudents, JOINED_STORAGE_KEY, getAllTeachers, ADDED_TEACHERS_STORAGE_KEY, DELETED_TEACHERS_STORAGE_KEY,
  getMyTeacherId, getDemoTeacherPattern, saveDemoTeacherPattern, getDemoSubmittedAvailability, SUBMITTED_AVAIL_STORAGE_PREFIX,
  getDemoTeacherSettings, TEACHER_SETTINGS_STORAGE_PREFIX, saveDemoPeriodStatus,
  type DemoStudent, type DemoTeacher,
} from '@/lib/teacherDemo';
import {
  addDays, analyzeWeeklyPattern, breakTimeAutoLink, datesBetween, hhmm, md, parseHM,
  runScheduling, slotKey, weekday, weekStartOf, windowList, unassignedReasonLabel,
  type UnassignedReason,
} from '@/lib/scheduling';
import { ymFrom, ymEnd, nextYm, ymLabel, STUDIO_STARTS, LESSON_MINUTES } from '@/lib/ym';
import { applyPatternToBlankMonth, deriveWeeklyPattern, type WeeklyPattern } from '@/lib/weeklyPattern';

const STARTS = STUDIO_STARTS;
// 學生選時段頁的連結（LIFF 會把 ?t=teacherId 一起帶過去，學生端用這個分辨要加入哪位老師）。
const STUDENT_LIFF_BASE = process.env.NEXT_PUBLIC_LIFF_ID ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}` : '';
const L = LESSON_MINUTES;
const WD = '日一二三四五六';
// 月份旁邊那顆狀態小標籤：draft／approved／notified 對學生來說都是「已經排好、不能再編輯」，
// 不需要細分成三種文字；收集中則帶上目前幾位已填寫／總共幾位，一眼看出進度。
function periodPillLabel(status: PeriodState['status'], filledCount: number, totalStudents: number): string {
  // upcoming（還沒建過 row）跟 closed（row 在了、開關沒開）對學生來說是同一件事：還看不到、不能填，
  // 不需要在這顆標籤上特別分開講，開關本身的狀態已經夠清楚了。
  if (status === 'upcoming' || status === 'closed') return '尚未開放';
  if (status === 'collecting') return `收集中（${filledCount}/${totalStudents}）`;
  return '完成排課不開放';
}

const isBlockedGlobal = (d: string, s: number) => weekday(d) === 3 && s >= parseHM('16:00') && s < parseHM('17:00');
// 台灣日期（UTC+8）
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// id 是 number：展示模式用流水號；真老師模式是資料庫給的 UUID 字串。
interface Lesson { id: number | string; studentId: string; date: string; start: number; teacherName?: string; checkedInAt?: string }
interface UnassignedUI { id?: string; studentId: string; weekStart: string; reason: UnassignedReason; windows: string[] }
interface LogEntry { kind: 'notify' | 'remind'; time: string; studentId: string; text: string }
// 'upcoming'：還沒建過這個月的 row（純前端狀態，不會寫進資料庫）。'closed'：row 已經存在（可能已經
// 存過上班時段），但「開放給學生填」這個開關還沒打開——對應真資料庫 periods.status 新增的那個值。
interface PeriodState { status: 'upcoming' | 'closed' | 'collecting' | 'draft' | 'approved' | 'notified'; lessons: Lesson[]; unassigned: UnassignedUI[]; notified: boolean; log: LogEntry[] }

// 每位老師自己的資料：學生、上班時間、固定會議時間、每月排課週期……彼此完全分開，用 teacherId 當 key。
interface TeacherState {
  students: DemoStudent[];
  studentAvailability: Map<string, Set<string>>;
  teacherAvailability: Set<string>;
  names: string[];
  weeklyBlock: { weekday: number; start: number; end: number };
  periods: Record<string, PeriodState>;
  curYm: string;
  proxy: Record<string, boolean>;
}

const FIRST_YM = '2026-11';
const initialPeriods = (): Record<string, PeriodState> => ({
  [FIRST_YM]: { status: 'collecting', lessons: [], unassigned: [], notified: false, log: [] },
});

function initialTeacherState(teacherId: string): TeacherState {
  // 只有已經開放（FIRST_YM）的月份才該有示範上班時段；更後面的月份都還「尚未開放」，
  // 有時段就代表開放了，兩者要一致，所以不能把好幾個月都先鋪好。
  const openDates = datesBetween(ymFrom(FIRST_YM), ymEnd(FIRST_YM));
  return {
    students: DEMO_STUDENTS_BY_TEACHER[teacherId] ?? [],
    studentAvailability: seedDemoAvailability(teacherId, openDates, STARTS),
    teacherAvailability: seedTeacherAvailability(openDates, STARTS, isBlockedGlobal),
    names: [],
    weeklyBlock: { weekday: 3, start: parseHM('16:00'), end: parseHM('17:00') },
    periods: initialPeriods(),
    curYm: FIRST_YM,
    proxy: {},
  };
}

// 真老師登入後的「開機讀取」：打 /api/teacher/state 拿她自己在 Supabase 裡的真實資料，整理成
// 跟展示模式一樣的 TeacherState 形狀。全新帳號（還沒開放過任何月份）會合成一個本月「尚未開放」
// 的 period（跟展示模式 createUpcomingMonth() 的邏輯一致，'upcoming' 本來就不會寫進資料庫）。
// 回傳 null 代表這個瀏覽器沒有真老師登入（401／金鑰未設定），直接維持展示模式，不用再多打一次
// /api/auth/line/session——這支 API 本身的回應已經帶著 id/name，一次請求就夠，展示模式也不會
// 因此多一個注定失敗的網路請求。
async function fetchRealTeacherState(): Promise<{ session: { id: string; name: string }; state: TeacherState; hoursPrefix: string; hoursSuffix: string; weeklyPattern: WeeklyPattern | null } | null> {
  const res = await fetch('/api/teacher/state').catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const studentAvailability = new Map<string, Set<string>>();
  for (const [sid, keys] of Object.entries<string[]>(data.studentAvailability ?? {})) studentAvailability.set(sid, new Set(keys));

  const weeklyBlock = data.weeklyBlock ?? { weekday: 3, start: parseHM('16:00'), end: parseHM('17:00') };
  const weeklyPattern: WeeklyPattern | null = data.weeklyPattern ?? null;
  let teacherAvailability = new Set<string>(data.teacherAvailability ?? []);

  const periods: Record<string, PeriodState> = {};
  for (const [ym, p] of Object.entries<{ status: PeriodState['status']; lessons: Lesson[]; unassigned: UnassignedUI[] }>(data.periods ?? {}))
    periods[ym] = { status: p.status, lessons: p.lessons, unassigned: p.unassigned, notified: false, log: [] };
  if (!Object.keys(periods).length) {
    const todayYm = today.slice(0, 7);
    periods[todayYm] = { status: 'upcoming', lessons: [], unassigned: [], notified: false, log: [] };
    // 全新帳號、第一次合成的「尚未開放」月份也是一個全新空白月份，如果之前記住過常用時段，
    // 直接先幫忙勾好，不用等她自己重新點一次。
    if (weeklyPattern && weeklyPattern.length) {
      const isBlockedFn = (d: string, s: number) => weekday(d) === weeklyBlock.weekday && s >= weeklyBlock.start && s < weeklyBlock.end;
      const blankDates = datesBetween(ymFrom(todayYm), ymEnd(todayYm));
      teacherAvailability = new Set([...teacherAvailability, ...applyPatternToBlankMonth(weeklyPattern, blankDates, today, isBlockedFn)]);
    }
  }
  const ymKeys = Object.keys(periods).sort();
  const requestedYm = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('ym');
  const initialYm = requestedYm && periods[requestedYm] ? requestedYm : ymKeys[ymKeys.length - 1];

  return {
    session: { id: data.id, name: data.name },
    hoursPrefix: data.hoursPrefix || '',
    hoursSuffix: data.hoursSuffix || '',
    weeklyPattern,
    state: {
      students: data.students ?? [],
      studentAvailability,
      teacherAvailability,
      names: data.names ?? [],
      weeklyBlock,
      periods,
      curYm: initialYm,
      proxy: data.proxy ?? {},
    },
  };
}

const nowStr = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

// 可以先編輯內容再複製／分享的文字框（例如改個稱呼、補一句話），不是唯讀的。
function EditableMsg({ text, extraAction }: { text: string; extraAction?: (value: string) => React.ReactNode }) {
  const [value, setValue] = useState(text);
  // 高度只用「一開始」的內容算一次、固定下來（不會隨打字即時變動，避免編輯時視窗一直跳動），
  // 多留一點空間給手機上的自動換行，讓正常長度的訊息不用捲動就看得到全部。
  const [rows] = useState(() => Math.min(Math.max(text.split('\n').length + 4, 6), 14));
  return (<>
    <textarea className="msg-edit" rows={rows} value={value} onChange={e => setValue(e.target.value)} />
    {extraAction ? (
      <div className="row" style={{ marginTop: 6 }}>
        <CopyBtn text={value} style={{ marginTop: 0 }} />
        {extraAction(value)}
      </div>
    ) : (
      <CopyBtn text={value} />
    )}
  </>);
}

type SheetState =
  | { mode: 'time'; lessonId: number | string; key: string; customDate: string; customStart: string; error: string }
  | { mode: 'sub'; lessonId: number | string; name: string; error: string }
  | { mode: 'fill'; unassignedIndex: number; name: string; key: string; customDate: string; customStart: string; error: string };

export default function TeacherPage() {
  // 在 LINE 內用 LIFF 開啟時，初始化後才能用「分享到 LINE」（shareTargetPicker）。
  // 用瀏覽器直接開（例如電腦管理）不會有 liffId，分享按鈕會自動退回「複製文字」。
  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_TEACHER_LIFF_ID;
    if (!liffId) return;
    (async () => { try { const liff = (await import('@line/liff')).default; await liff.init({ liffId }); } catch { /* 不在 LINE 內開啟時會失敗，忽略即可，按鈕會退回複製 */ } })();
  }, []);

  // 用來組「邀請連結」的網站網址，只能在瀏覽器端取得（避免 SSR 時網址不一致的 hydration 警告）。
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested === 'hours' || requested === 'plan' || requested === 'students') setTab(requested);
  }, []);

  // ---------- 多老師資料隔離 ----------
  // 展示模式：用按鈕切換「目前登入的老師」，之後會換成真正的 LINE 登入＋白名單比對。
  const [teacherStates, setTeacherStates] = useState<Record<string, TeacherState>>(() => {
    const m: Record<string, TeacherState> = {};
    for (const t of DEMO_TEACHERS) m[t.id] = initialTeacherState(t.id);
    return m;
  });
  const [currentTeacherId, setCurrentTeacherId] = useState(DEMO_TEACHERS[0].id);
  // 固定示範老師先用這份渲染（SSR 安全）；上線後的瀏覽器端再從 localStorage 併入主要老師新增的老師。
  const [teachersList, setTeachersList] = useState<DemoTeacher[]>(DEMO_TEACHERS);
  const currentTeacherName = teachersList.find(t => t.id === currentTeacherId)?.name ?? '';

  useEffect(() => {
    function mergeTeachers() {
      const all = getAllTeachers();
      setTeachersList(all);
      setTeacherStates(prev => {
        let changed = false;
        const next = { ...prev };
        for (const t of all) if (!next[t.id]) { next[t.id] = initialTeacherState(t.id); changed = true; }
        return changed ? next : prev;
      });
    }
    mergeTeachers();
    // 如果這台瀏覽器之前用「自己加入」的方式建立過老師身份，一進頁面就預設顯示那位老師，不用每次手動切換。
    const mine = getMyTeacherId();
    if (mine && getAllTeachers().some(t => t.id === mine)) setCurrentTeacherId(mine);
    const onStorage = (e: StorageEvent) => {
      if (e.key === ADDED_TEACHERS_STORAGE_KEY || e.key === DELETED_TEACHERS_STORAGE_KEY || e.key?.startsWith(TEACHER_SETTINGS_STORAGE_PREFIX)) mergeTeachers();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ---------- 真正的 LINE 登入（跟上面的「示範登入」並存：金鑰設定好之前，示範切換照常可用） ----------
  const [realSession, setRealSession] = useState<{ id: string; name: string } | null>(null);
  // 還不知道是不是真老師之前，先不要把畫面畫出來——不然會先看到展示模式預設的 11 月（Joanna），
  // 等真老師資料讀完才跳到真正的月份，中間那一下閃爍很confusing。
  const [authChecked, setAuthChecked] = useState(false);
  // 沒登入時（例如登出後）主要應該是導去 LINE 登入，不是直接看到展示模式的切換鈕——
  // 展示模式只在按了「試用展示版」之後才出現，避免真老師登出後誤以為自己要選 Joanna/Coco。
  const [demoMode, setDemoMode] = useState(false);
  // 還沒登入、也還沒按「試用展示版」的那個畫面（下面那個 if 區塊）本來沒有顯示 notice，
  // 導致白名單沒過（not_whitelisted）那組要交給管理者的代碼完全看不到，登入的人會以為「點了沒反應」。
  // 這組代碼額外存一份，那個畫面才讀得到、才能直接複製。
  const [loginErrorUid, setLoginErrorUid] = useState<string | null>(null);
  // 「上班時段」通知文字的自訂開頭／結尾（在「老師管理」頁設定），展示模式永遠是空字串、不受影響。
  const [hoursPrefix, setHoursPrefix] = useState('');
  const [hoursSuffix, setHoursSuffix] = useState('');
  // 記住的常用上班時段（開新的空白月份時直接先勾好用）；展示模式不用這個 state，直接即時查 localStorage。
  const [teacherPattern, setTeacherPattern] = useState<WeeklyPattern | null>(null);
  const [rememberHours, setRememberHours] = useState(true);
  useEffect(() => {
    (async () => {
      const result = await fetchRealTeacherState();
      if (result) {
        const { session, state } = result;
        setRealSession(session);
        setTeachersList(prev => prev.some(t => t.id === session.id) ? prev : [...prev, { id: session.id, name: session.name }]);
        setTeacherStates(prev => ({ ...prev, [session.id]: state }));
        setHoursPrefix(result.hoursPrefix);
        setHoursSuffix(result.hoursSuffix);
        setTeacherPattern(result.weeklyPattern);
        switchTeacher(session.id);
      }
      setAuthChecked(true);
    })();

    const qs = new URLSearchParams(window.location.search);
    const err = qs.get('loginError');
    if (err) {
      const msg: Record<string, string> = {
        not_configured: 'LINE 登入功能尚未設定完成（缺少金鑰），請聯絡管理者，先用下面的示範登入。',
        missing_code: '登入逾時或被取消，請重新登入一次。',
        state_mismatch: '登入驗證失敗，請重新登入一次。',
        token_exchange_failed: '跟 LINE 交換登入資訊失敗，請稍後再試。',
        profile_failed: '無法取得 LINE 個人資料，請稍後再試。',
        supabase_not_configured: '資料庫尚未設定完成，暫時無法用 LINE 登入，請用下面的示範登入。',
        not_whitelisted: '這個 LINE 帳號還不在老師名單裡。',
        supabase_error: '連線資料庫時發生錯誤，請稍後再試。',
      };
      const uid = qs.get('uid');
      setNotice((msg[err] ?? '登入失敗，請再試一次。') + (uid ? '請把下面這組代碼交給管理者加入老師名單：' : ''));
      if (uid) setLoginErrorUid(uid);
      window.history.replaceState(null, '', '/teacher');
    }
  }, []);

  function makeFieldSetter<K extends keyof TeacherState>(key: K) {
    return (fn: TeacherState[K] | ((prev: TeacherState[K]) => TeacherState[K])) => {
      setTeacherStates(prev => {
        const cur = prev[currentTeacherId];
        const nextVal = typeof fn === 'function' ? (fn as (p: TeacherState[K]) => TeacherState[K])(cur[key]) : fn;
        return { ...prev, [currentTeacherId]: { ...cur, [key]: nextVal } };
      });
    };
  }
  const setStudents = makeFieldSetter('students');
  const setStudentAvailability = makeFieldSetter('studentAvailability');
  const setTeacherAvailability = makeFieldSetter('teacherAvailability');
  const setNames = makeFieldSetter('names');
  const setWeeklyBlock = makeFieldSetter('weeklyBlock');
  const setPeriods = makeFieldSetter('periods');
  const setCurYm = makeFieldSetter('curYm');
  const setProxy = makeFieldSetter('proxy');

  const { students, studentAvailability, teacherAvailability, names, weeklyBlock, periods, curYm, proxy } = teacherStates[currentTeacherId];

  function selectMonth(ym: string) {
    setCurYm(ym);
    if (realSession) {
      const url = new URL(window.location.href);
      url.searchParams.set('ym', ym);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
  }

  function switchTeacher(id: string) {
    if (id === currentTeacherId) return;
    setCurrentTeacherId(id);
    setActingStudentId(null);
    setSheet(null);
    setNotice('');
    setPendingApprove(false);
    setRescheduleConfirmOpen(false);
    setShowHoursPopup(false);
    setPendingDeleteId(null);
    setAddStudentOpen(false);
    setTab('hours');
    setPlanSection('schedule');
  }

  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentLessons, setNewStudentLessons] = useState('8');
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [addStudentBusy, setAddStudentBusy] = useState(false);
  const [creditStudentId, setCreditStudentId] = useState<string | null>(null);
  const [creditMode, setCreditMode] = useState<'set' | 'add'>('set');
  const [creditInput, setCreditInput] = useState('');
  const [creditSaving, setCreditSaving] = useState(false);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [blockForm, setBlockForm] = useState({ weekday: '3', start: '960', end: '1020' });
  const [rangeForm, setRangeForm] = useState({ from: today, to: today, start: String(STARTS[0]), end: String(STARTS[STARTS.length - 1] + L) });
  const [rangeApplied, setRangeApplied] = useState(false);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [blockApplied, setBlockApplied] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [tab, setTab] = useState<'hours' | 'plan' | 'students'>('hours');
  const [planSection, setPlanSection] = useState<'schedule' | 'confirm' | 'notify'>('schedule');
  const [actingStudentId, setActingStudentId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  // 提醒文字改成浮在畫面上方、幾秒後自動消失的 toast，不要佔位置把下面的內容往下推；
  // 每次 notice 一變就重新倒數，避免上一則還沒消失、下一則就蓋上來時提早被切斷。
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [pendingApprove, setPendingApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rescheduleConfirmOpen, setRescheduleConfirmOpen] = useState(false);
  const [showHoursPopup, setShowHoursPopup] = useState(false);
  const [hoursPopupKind, setHoursPopupKind] = useState<'opened' | 'updated'>('opened');
  // 真老師模式排課要真的打資料庫，不像展示模式是瞬間算完的，按鈕要有「處理中」的反饋，
  // 不然看起來像沒反應。
  const [scheduling, setScheduling] = useState(false);
  // 開關那支 API 也要打資料庫，同一個道理：沒有這個狀態的話，手滑點兩下中間那段空檔沒有任何反饋，
  // 感覺「很遲鈍」，容易在請求還沒回來之前又點一次，兩個請求前後蓋過去造成畫面跟資料庫對不起來。
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const period = periods[curYm];
  const needsTeacher = period.unassigned.filter(u => u.reason !== 'no_selection');
  const deferredWeeks = period.unassigned.filter(u => u.reason === 'no_selection');
  const dates = useMemo(() => datesBetween(ymFrom(curYm), ymEnd(curYm)), [curYm]);
  const ymKeys = Object.keys(periods).sort();
  const lastYm = ymKeys[ymKeys.length - 1];
  // 老師可以一直往未來排、不限一次只能看一個月之後，所以這份「全部日期」要跟著目前排到多遠一起長大，
  // 「固定會議時間」「快速排休」這類一次調整一段日期的功能才不會因為範圍太小而對遠的月份沒反應。
  const allDates = useMemo(() => {
    const endYm = lastYm > '2027-03' ? nextYm(lastYm) : '2027-03';
    return datesBetween('2026-10-01', ymEnd(endYm));
  }, [lastYm]);

  // 展示模式：學生用邀請連結填名字加入後，資料存在 localStorage；這裡把目前老師底下新加入的學生併進名單。
  // 也監聽 storage 事件，這樣學生在別的分頁加入時，老師這頁不用手動重新整理也能看到（同一瀏覽器才看得到）。
  useEffect(() => {
    function mergeJoined(teacherId: string) {
      const joined = getJoinedStudents(teacherId);
      if (!joined.length) return;
      setTeacherStates(prev => {
        const cur = prev[teacherId];
        if (!cur) return prev;
        const existingIds = new Set(cur.students.map(s => s.id));
        const toAdd = joined.filter(j => !existingIds.has(j.id)).map(j => ({ ...j, remainingLessons: j.remainingLessons ?? 0 }));
        // 學生送出的時段存在另一組 localStorage key（見 saveDemoSubmittedAvailability），每次都要
        // 重新比對一次，不是只有「剛加入」的學生才需要——已經在名單裡的學生之後才送出，也要能看到。
        const nextAvail = new Map(cur.studentAvailability);
        let availChanged = false;
        for (const s of joined) {
          const submitted = new Set(getDemoSubmittedAvailability(teacherId, s.id));
          const existing = nextAvail.get(s.id);
          const same = existing && existing.size === submitted.size && [...existing].every(k => submitted.has(k));
          if (!same) { nextAvail.set(s.id, submitted); availChanged = true; }
        }
        if (!toAdd.length && !availChanged) return prev;
        return { ...prev, [teacherId]: { ...cur, students: [...cur.students, ...toAdd], studentAvailability: nextAvail } };
      });
    }
    mergeJoined(currentTeacherId);
    const onStorage = (e: StorageEvent) => {
      if (e.key === JOINED_STORAGE_KEY || e.key?.startsWith(SUBMITTED_AVAIL_STORAGE_PREFIX)) mergeJoined(currentTeacherId);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [currentTeacherId]);

  // 展示模式：「上班時段通知文字」的開頭／結尾在「老師管理」頁設定、存在 localStorage，這裡要讀回來
  // 套用，不然展示模式永遠是空字串（跟真老師那邊靠 fetchRealTeacherState 設定是同一件事，只是換來源）。
  useEffect(() => {
    if (realSession) return;
    function loadHoursTemplate() {
      const s = getDemoTeacherSettings(currentTeacherId);
      setHoursPrefix(s.hoursPrefix || '');
      setHoursSuffix(s.hoursSuffix || '');
    }
    loadHoursTemplate();
    const onStorage = (e: StorageEvent) => { if (e.key === TEACHER_SETTINGS_STORAGE_PREFIX + currentTeacherId) loadHoursTemplate(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [currentTeacherId, realSession]);

  // 連結帶上 &ym=，學生端才知道這個連結是哪個月的，不用再靠「猜唯一收集中的月份」
  // （現在可以同時好幾個月都在收集中，真老師模式才需要帶，展示模式維持原本不帶月份的格式）。
  const inviteLink = STUDENT_LIFF_BASE ? `${STUDENT_LIFF_BASE}?t=${currentTeacherId}${realSession ? `&ym=${curYm}` : ''}`
    : (origin ? `${origin}/?t=${currentTeacherId}${realSession ? `&ym=${curYm}` : ''}` : '');

  const studentName = (id: string) => students.find(s => s.id === id)?.name ?? id;
  const isBlocked = (d: string, s: number) => weekday(d) === weeklyBlock.weekday && s >= weeklyBlock.start && s < weeklyBlock.end;

  // 真老師模式：把目前的上班時段整批送到伺服器（只替換「今天之後」，不動過去的紀錄）。
  async function persistTeacherAvailability(next: Set<string>): Promise<string | null> {
    if (!realSession) return null;
    const res = await fetch('/api/teacher/availability', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [...next].filter(k => k.split('|')[0] >= today).map(k => { const [date, s] = k.split('|'); return { date, start: Number(s) }; }) }),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.error || '更新失敗，請稍後再試。';
  }

  async function applyBlockForm(): Promise<boolean> {
    const next = { weekday: Number(blockForm.weekday), start: Number(blockForm.start), end: Number(blockForm.end) };
    if (next.end <= next.start) { setNotice('結束時間要晚於開始時間。'); return false; }
    const prevBlock = weeklyBlock;
    const nowBlocked = (d: string, s: number) => weekday(d) === next.weekday && s >= next.start && s < next.end;
    const wasOldBlock = (d: string, s: number) => weekday(d) === prevBlock.weekday && s >= prevBlock.start && s < prevBlock.end;
    const nextAvailability = new Set(teacherAvailability);
    for (const d of allDates) for (const s of STARTS) {
      if (nowBlocked(d, s)) nextAvailability.delete(slotKey(d, s));
      else if (wasOldBlock(d, s)) nextAvailability.add(slotKey(d, s)); // 舊的固定會議時段恢復成可上班
    }
    if (realSession) {
      const res = await fetch('/api/teacher/weekly-block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setNotice(data?.error || '更新失敗，請稍後再試。'); return false; }
      const err = await persistTeacherAvailability(nextAvailability);
      if (err) { setNotice(err); return false; }
    }
    setWeeklyBlock(next);
    setTeacherAvailability(nextAvailability);
    setNotice(`已更新固定會議時間為週${WD[next.weekday]} ${hhmm(next.start)}–${hhmm(next.end)}，原本週${WD[prevBlock.weekday]} ${hhmm(prevBlock.start)}–${hhmm(prevBlock.end)} 已恢復成可上班，新時段已從上班時間移除。`);
    return true;
  }

  // 快速調整一段日期＋一段時間（例如請假幾天的某幾個小時），不用一格一格點。
  async function applyRangeForm(turnOn: boolean): Promise<boolean> {
    const from = rangeForm.from, to = rangeForm.to, start = Number(rangeForm.start), end = Number(rangeForm.end);
    if (!from || !to || from > to) { setNotice('結束日期要晚於或等於開始日期。'); return false; }
    if (end <= start) { setNotice('結束時間要晚於開始時間。'); return false; }
    const keys: string[] = [];
    for (const d of allDates) {
      if (d < from || d > to || d < today) continue;
      for (const s of STARTS) {
        if (s < start || s + L > end || isBlocked(d, s)) continue;
        keys.push(slotKey(d, s));
      }
    }
    const n = keys.filter(k => turnOn ? !teacherAvailability.has(k) : teacherAvailability.has(k)).length;
    const next = new Set(teacherAvailability);
    for (const k of keys) { if (turnOn) next.add(k); else next.delete(k); }
    const err = await persistTeacherAvailability(next);
    if (err) { setNotice(err); return false; }
    setTeacherAvailability(next);
    setNotice(`已將 ${md(from)}–${md(to)}、${hhmm(start)}–${hhmm(end)} 設為${turnOn ? '可上班' : '不可上班'}（更新 ${n} 格）。`);
    return true;
  }

  const updatePeriod = (ym: string, patch: Partial<PeriodState>) => setPeriods(p => ({ ...p, [ym]: { ...p[ym], ...patch } }));

  // 展示模式：這個月變成「收集中」還是「已經排課、不能再編輯」，額外存一份到 localStorage，
  // 學生頁（完全獨立的另一個元件／分頁）才看得到，不然學生永遠不會被鎖住。真老師模式由資料庫的
  // periods.status 把關，不需要這份。
  function syncDemoPeriodStatus(ym: string, status: PeriodState['status']) {
    if (realSession) return;
    saveDemoPeriodStatus(currentTeacherId, ym, status === 'upcoming' || status === 'collecting' ? 'collecting' : 'locked');
  }

  const monthCount = (sel: Set<string>) => [...sel].filter(k => k.startsWith(curYm)).length;
  // teacherAvailability 會同時保留多個月份的資料，所以不能用整個 Set 的 size 判斷目前月份
  // 是否有設定上班時段。否則老師只要其他月份曾經排過班，本月全空仍會被放行自動排課。
  const hasTeacherHours = monthCount(teacherAvailability) > 0;
  const filled = (st: DemoStudent) => [...(studentAvailability.get(st.id) ?? [])].some(k => k.startsWith(curYm));

  function setStudentSel(id: string, next: Set<string>) {
    setStudentAvailability(prev => { const m = new Map(prev); m.set(id, next); return m; });
  }

  // ---------- 上班時間 ----------
  const hoursMessage = useMemo(() => {
    // wholeWeekdaysOff=true：整個星期幾都排休（例如用「快速排休」整月封掉週日），也要在這裡顯示
    // 「週日 不上班」，不然那天會整排空白、跟「預設上班」長得一樣，等於排休完全看不出來。
    const a = analyzeWeeklyPattern(teacherAvailability, dates, STARTS, L, true);
    const lines = a.runs.map(r => {
      // 「不上班」不是一段時間範圍，不能照下面那樣拆時間算「最後一堂」，直接照字面顯示就好。
      if (r.windowLabel === '不上班') return `${r.dayLabel} 不上班`;
      const lastWindow = r.windowLabel.split('、').pop()!;
      const endHM = lastWindow.split('–')[1];
      const [eh, em] = endHM.split(':').map(Number);
      const lastStart = eh * 60 + em - L;
      return `${r.dayLabel} ${r.windowLabel}（最後一堂 ${hhmm(lastStart)} 開始）`;
    });
    const autoBody = `👩🏻 ${currentTeacherName} ${+curYm.slice(5)} 月可預約時段\n${lines.join('\n') || '本月無上班'}` +
      (a.off.length ? `\n🚫 休假（無法預約）：${a.off.map(md).join('、')}` : '') +
      (a.changed.length ? `\n⏰ 時段調整：${a.changed.join('、')}` : '') +
      `\n\n🚫 固定無法預約：每週${WD[weeklyBlock.weekday]} ${hhmm(weeklyBlock.start)}–${hhmm(weeklyBlock.end)}（公司開會）\n💡 ${currentTeacherName} 不上班的時段若有需要，會安排其他老師授課。` +
      (inviteLink ? `\n\n📲 點這裡選時間：${inviteLink}` : '');
    // 自訂開頭／結尾只加在最外側，中間這段根據實際上班時間算出來的內容不開放自訂。
    const full = (hoursPrefix ? `${hoursPrefix}\n\n` : '') + autoBody + (hoursSuffix ? `\n\n${hoursSuffix}` : '');
    // 這是最後要送出去的文字了，這裡才套用「打斷 LINE 自動連結」，前面所有時間計算都還是乾淨的字串。
    return breakTimeAutoLink(full);
  }, [teacherAvailability, dates, curYm, weeklyBlock, currentTeacherName, inviteLink, hoursPrefix, hoursSuffix]);

  // 格狀表格收起時顯示的簡短摘要（跟上面的通知文字分開，這個只在頁面裡給自己看）。
  // 「完全還沒設定」跟「某幾天刻意排休、其他天正常上班」是兩回事，前者才顯示這句提示文字
  // （後面很多地方靠比對這個字串決定要不要顯示分享按鈕），後者要讓 wholeWeekdaysOff 顯示「不上班」。
  const hoursSummaryText = useMemo(() => {
    if (!hasTeacherHours) return '這個月還沒有設定上班時段';
    const a = analyzeWeeklyPattern(teacherAvailability, dates, STARTS, L, true);
    return a.runs.map(r => `${r.dayLabel} ${r.windowLabel}`).join('\n') +
      (a.off.length ? `\n休假：${a.off.map(md).join('、')}` : '') +
      (a.changed.length ? `\n調整：${a.changed.join('、')}` : '');
  }, [teacherAvailability, dates, hasTeacherHours]);

  // ---------- 月份切換 ----------
  // 切到還沒出現過的下個月：狀態是「尚未開放」，這時候還不該有任何上班時段
  // （有時段就代表已經開放學生選課了，兩者要一致）。上班時段留空，等老師自己
  // 進「編輯時段」設定、按「完成選取／開放選課」，那一刻才會同時有時段、也真的開放。
  function createUpcomingMonth() {
    const nx = nextYm(lastYm);
    setPeriods(p => ({ ...p, [nx]: { status: 'upcoming', lessons: [], unassigned: [], notified: false, log: [] } }));
    selectMonth(nx); setTab('hours');
    // 開一個全新月份：如果之前記住過常用時段，直接幫忙先勾好，不用等她自己重新點一次。
    const pattern = realSession ? teacherPattern : getDemoTeacherPattern(currentTeacherId);
    if (pattern && pattern.length) {
      const newDates = datesBetween(ymFrom(nx), ymEnd(nx));
      const additions = applyPatternToBlankMonth(pattern, newDates, today, isBlocked);
      if (additions.size) setTeacherAvailability(prev => new Set([...prev, ...additions]));
    }
  }

  // 編輯時段頁最下面「完成選取」：真老師模式下，這個按鈕只負責存時段，不再負責開放——開放是獨立的
  // 開關（見 openPeriod()）。展示模式維持原本的行為不變（存時段第一次順便開放），範圍只收真老師。
  async function confirmHours() {
    if (realSession) {
      const res = await fetch(`/api/teacher/periods/${curYm}/confirm-hours`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots: [...teacherAvailability].filter(k => k.split('|')[0] >= today).map(k => { const [date, s] = k.split('|'); return { date, start: Number(s) }; }),
          remember: rememberHours,
        }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setNotice(data?.error || '更新失敗，請稍後再試。'); return; }
      const data = await res.json().catch(() => ({}));
      if (rememberHours) setTeacherPattern(deriveWeeklyPattern(teacherAvailability, dates, STARTS));
      // 狀態一律用 API 實際回傳的值更新：'upcoming' 第一次存會變成 'closed'，已經是 closed／
      // collecting 的月份維持原狀，不會因為單純存時段就被改去 'collecting'。
      if (data.status) updatePeriod(curYm, { status: data.status });
      setNotice(`已更新 ${+curYm.slice(5)} 月的上班時段。`);
      setHoursPopupKind('updated');
    } else {
      if (rememberHours) saveDemoTeacherPattern(currentTeacherId, deriveWeeklyPattern(teacherAvailability, dates, STARTS));
      if (period.status === 'upcoming') {
        updatePeriod(curYm, { status: 'collecting' });
        syncDemoPeriodStatus(curYm, 'collecting');
        setNotice(`已開放 ${+curYm.slice(5)} 月選課，學生現在可以開始填寫時段了。`);
        setHoursPopupKind('opened');
      } else {
        setNotice(`已更新 ${+curYm.slice(5)} 月的上班時段。`);
        setHoursPopupKind('updated');
      }
    }
    // 不管是哪種情況，每次存完都用彈窗強調「記得把最新的通知文字傳給學生」，
    // 不要只是安靜地放在畫面下方等她自己捲下去看到。
    setShowHoursPopup(true);
  }

  // 「開放／關閉這個月收集時段」的開關：真老師模式才有，展示模式的月份一律維持現在的行為
  // （FIRST_YM 固定一開始就是收集中，不需要另外開關）。只能在排課之前切換，已經排過課的月份
  // 這顆開關會被停用，要重開走既有的「重新排課」。
  async function openPeriod(open: boolean) {
    if (!realSession || togglingOpen) return;
    setTogglingOpen(true);
    try {
      const res = await fetch(`/api/teacher/periods/${curYm}/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ open }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data?.error || '操作失敗，請稍後再試。'); return; }
      updatePeriod(curYm, { status: data.status });
      if (open) {
        // 「把這段訊息傳給學生」那張分享卡只在存時段（confirmHours）時跳，不是在這裡——分享卡的內容
        // 是從上班時段算出來的，開關本身跟時段內容無關，這裡開了但時段還空著的話，分享卡只會讓她
        // 把一段「本月無上班」的誤導訊息傳給學生。改成一句平實的提示，時段空的話順便提醒她去設定。
        setNotice(`已開放 ${+curYm.slice(5)} 月選課，學生現在可以開始填寫時段了。`
          + (!hasTeacherHours ? '記得去設定上班時段，不然學生進來會看到空的。' : ''));
      } else {
        setNotice(`已關閉 ${+curYm.slice(5)} 月的收集，學生暫時看不到這個月的選課畫面。`);
      }
    } finally { setTogglingOpen(false); }
  }

  // ---------- 學生 ----------
  async function addStudent() {
    const nm = newStudentName.trim();
    const remainingLessons = newStudentLessons.trim() === '' ? NaN : Number(newStudentLessons);
    if (!nm) { setNotice('請輸入學生名稱。'); return; }
    if (!Number.isInteger(remainingLessons) || remainingLessons < 0) { setNotice('堂數必須是 0 以上的整數。'); return; }
    const ex = students.find(s => s.name === nm);
    if (ex) { setNotice(`${nm} 已經在名單裡。`); return; }
    setAddStudentBusy(true);
    try {
      let student: DemoStudent;
      if (realSession) {
        const res = await fetch('/api/teacher/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm, remainingLessons }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setNotice(data?.error || '新增失敗，請稍後再試。'); return; }
        student = data;
      } else {
        student = { id: `s${students.length + 1}_${Date.now()}`, name: nm, remainingLessons, linked: false };
      }
      setStudents(prev => [...prev, student]);
      setStudentAvailability(prev => { const m = new Map(prev); m.set(student.id, new Set()); return m; });
      setNewStudentName('');
      setNewStudentLessons('8');
      setAddStudentOpen(false);
      setNotice(`已新增 ${nm}。請在學生管理複製他的個人加入連結。`);
    } finally { setAddStudentBusy(false); }
  }
  function openCredits(student: DemoStudent, mode: 'set' | 'add' = 'set') {
    setCreditStudentId(student.id);
    setCreditMode(mode);
    setCreditInput(mode === 'add' ? '' : String(student.remainingLessons ?? 0));
  }
  async function saveCredits() {
    if (!creditStudentId || creditSaving) return;
    const inputLessons = creditInput.trim() === '' ? NaN : Number(creditInput);
    if (!Number.isInteger(inputLessons) || inputLessons < (creditMode === 'add' ? 1 : 0)) { setNotice(creditMode === 'add' ? '新增堂數必須是 1 以上的整數。' : '堂數必須是 0 以上的整數。'); return; }
    setCreditSaving(true);
    try {
      let remainingLessons = creditMode === 'add'
        ? (students.find(s => s.id === creditStudentId)?.remainingLessons ?? 0) + inputLessons
        : inputLessons;
      if (realSession) {
        const res = await fetch(`/api/teacher/students/${creditStudentId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(creditMode === 'add' ? { addLessons: inputLessons } : { remainingLessons: inputLessons }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setNotice(data?.error || '更新堂數失敗，請稍後再試。'); return; }
        remainingLessons = data.remainingLessons;
      }
      const nm = studentName(creditStudentId);
      setStudents(prev => prev.map(s => s.id === creditStudentId ? { ...s, remainingLessons } : s));
      setCreditStudentId(null);
      const alreadyScheduled = period.status === 'draft' || period.status === 'approved' || period.status === 'notified';
      setNotice(creditMode === 'add'
        ? `已替 ${nm} 增加 ${inputLessons} 堂，目前剩餘 ${remainingLessons} 堂。${alreadyScheduled ? '這個月已經排過課，如要套用新堂數請重新排課。' : ''}`
        : `已將 ${nm} 的剩餘堂數設為 ${remainingLessons} 堂。${alreadyScheduled ? '這個月已經排過課，請按「重新排課」後再執行自動排課，新的堂數才會套用。' : ''}`);
    } finally { setCreditSaving(false); }
  }
  function personalInviteLink(student: DemoStudent) {
    if (!student.inviteToken) return '';
    const base = STUDENT_LIFF_BASE || (origin ? `${origin}/` : '');
    return base ? `${base}?t=${currentTeacherId}&invite=${encodeURIComponent(student.inviteToken)}&ym=${curYm}` : '';
  }
  async function generateInvite(student: DemoStudent) {
    if (!realSession || inviteBusyId) return;
    setInviteBusyId(student.id);
    try {
      const res = await fetch(`/api/teacher/students/${student.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateInvite: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data?.error || '產生連結失敗，請稍後再試。'); return; }
      setStudents(prev => prev.map(s => s.id === student.id ? { ...s, inviteToken: data.inviteToken, linked: false } : s));
      setNotice(`已替 ${student.name} 產生個人加入連結。`);
    } finally { setInviteBusyId(null); }
  }
  async function deleteStudent(id: string) {
    if (pendingDeleteId !== id) { setPendingDeleteId(id); setNotice(`確定要刪除 ${studentName(id)} 嗎？所有已選時段與課表紀錄都會一併刪除、無法復原。如果要重新收這位學生，之後可以重新登錄。再按一次「確認刪除」才會真的刪除。`); return; }
    setDeletingId(id);
    try {
    if (realSession) {
      const res = await fetch(`/api/teacher/students/${id}`, { method: 'DELETE' });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setNotice(data?.error || '刪除失敗，請稍後再試。'); return; }
    }
    const nm = studentName(id);
    setPeriods(prev => { const n: Record<string, PeriodState> = {}; for (const [y, p] of Object.entries(prev)) n[y] = { ...p, lessons: p.lessons.filter(l => l.studentId !== id), unassigned: p.unassigned.filter(u => u.studentId !== id) }; return n; });
    setStudents(prev => prev.filter(s => s.id !== id));
    setStudentAvailability(prev => { const m = new Map(prev); m.delete(id); return m; });
    setPendingDeleteId(null);
    setNotice(`已刪除 ${nm}。`);
    } finally { setDeletingId(null); }
  }
  function remind() {
    const nf = eligibleStudents.filter(st => !filled(st));
    const entries: LogEntry[] = nf.map(st => ({ kind: 'remind', time: nowStr(), studentId: st.id, text: `${st.name} 你好 🌸 ${+curYm.slice(5)} 月的選課還沒收到你的時段喔，麻煩點選下方按鈕填寫，謝謝！🫶🏻` }));
    updatePeriod(curYm, { log: [...entries, ...period.log] });
    setNotice(`已提醒 ${nf.length} 位尚未填寫的學生。`);
  }

  // ---------- 排課 ----------
  const eligibleStudents = students.filter(s => (s.remainingLessons ?? 0) > 0);
  const filledCount = eligibleStudents.filter(filled).length;
  // 只要還有人沒填寫，就不能排課，避免排到一半又要重排
  const allFilled = eligibleStudents.length > 0 && filledCount === eligibleStudents.length;
  const hasExistingSchedule = period.lessons.length > 0 || period.unassigned.length > 0;

  // 「自動排課／確認課表／發送訊息」其實是同一個長頁面，這三個分頁只是錨點：
  // 點了先切換 highlight，再等畫面更新完滑過去，不用自己找。
  function gotoSection(id: 'schedule' | 'confirm' | 'notify') {
    // 先用現在的版面（還沒展開/收合）平滑捲到目標標題的位置，讓人看得出「從這裡滑到那裡」；
    // 捲到了之後才真的切換展開哪一段，展開後再微調一次位置（展開會讓下面變長，但目標標題本身位置不太會變）。
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      setPlanSection(id);
      setTimeout(() => document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }, 400);
  }

  // 「自動排課」分頁裡的「自動排課」按鈕：不管有沒有排過課，按下去就直接排（不跳確認視窗）；
  // 「確認課表」「發送訊息」裡的「重新排課」按鈕才會先跳出確認視窗，因為那兩個畫面本身就是在看
  // 已經排好的結果，從那裡重排比較容易誤觸，值得多一層確認。
  async function runAutoSchedule() {
    if (!allFilled || scheduling) return;
    // 老師把上班時段全部清空了卻忘記重設（例如改時段手滑清空）：排課只會把每個人都排成「待補」，
    // 看起來像排課失敗，其實是還沒設定時段——直接擋下、提醒她回去設定，不要讓她誤以為排課壞了。
    if (!hasTeacherHours) { setNotice('這個月還沒有設定上班時段，請先到「上班時間」設定後再排課。'); return; }
    setScheduling(true);
    try {
      // 排課失敗（例如伺服器錯誤）就留在「自動排課」這一欄讓她重試，不要跳到還是空的「確認課表」，
      // 不然會卡在一個看起來什麼都沒有、也點不到「自動排課」按鈕的畫面。
      if (await doSchedule()) gotoSection('confirm');
    } finally { setScheduling(false); }
  }
  // 重新排課只是把課表清掉、退回收集中，不是在算新課表，不需要等全部填完——而且擋著反而會卡死：
  // 排完課之後才新增的學生一定是「未填寫」，但她不可能填得到（月份已經不是收集中），只能靠「重新排課」
  // 退回收集中讓她補填，所以這個按鈕一定要隨時按得下去。
  function requestReschedule() {
    setRescheduleConfirmOpen(true);
  }
  // 重新排課會清掉已核准／已推播的狀態，確認課表、發送訊息都要重新來一次，
  // 所以排完直接回到第一欄（還可以改學生名單那裡），不要停在已經失效的後面幾欄。
  async function confirmReschedule() {
    setScheduling(true);
    try {
      if (realSession) {
        const res = await fetch(`/api/teacher/periods/${curYm}/clear-schedule`, { method: 'POST' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setRescheduleConfirmOpen(false);
          setNotice(data?.error || '清除課表失敗，請稍後再試。');
          return;
        }
      }
      const restoredByStudent = new Map<string, number>();
      for (const l of period.lessons) restoredByStudent.set(l.studentId, (restoredByStudent.get(l.studentId) ?? 0) + 1);
      setStudents(prev => prev.map(s => ({ ...s, remainingLessons: (s.remainingLessons ?? 0) + (restoredByStudent.get(s.id) ?? 0) })));
      updatePeriod(curYm, { lessons: [], unassigned: [], status: 'collecting', notified: false });
      syncDemoPeriodStatus(curYm, 'collecting');
      setNotice('已清除課表，恢復成收集中。調整好學生名單或上班時段後，再按「自動排課」重新排一次。');
      setRescheduleConfirmOpen(false);
      gotoSection('schedule');
    } finally { setScheduling(false); }
  }
  async function doSchedule(): Promise<boolean> {
    if (realSession) {
      const res = await fetch(`/api/teacher/periods/${curYm}/schedule`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data?.error || '排課失敗，請稍後再試。'); return false; }
      if (data.remainingLessons) setStudents(prev => prev.map(s => ({ ...s, remainingLessons: data.remainingLessons[s.id] ?? s.remainingLessons ?? 0 })));
      updatePeriod(curYm, { lessons: data.lessons, unassigned: data.unassigned, status: 'draft', notified: false });
      setNotice('');
      return true;
    }
    const scheduleStart = today > ymFrom(curYm) ? addDays(weekStartOf(today), 7) : ymFrom(curYm);
    const otherPeriodLessons = Object.entries(periods).filter(([y]) => y !== curYm).flatMap(([, p]) => p.lessons.map(l => ({ studentId: l.studentId, date: l.date })));
    const res = runScheduling({
      from: ymFrom(curYm), to: ymEnd(curYm), scheduleStart, lessonMinutes: L, starts: STARTS,
      students,
      studentAvailability, teacherAvailability, otherPeriodLessons,
      existingLessons: [],
    });
    let uid = 1;
    const newLessons: Lesson[] = res.lessons.map(l => ({ id: uid++, studentId: l.studentId, date: l.date, start: l.start }));
    const scheduledByStudent = new Map<string, number>();
    for (const l of newLessons) scheduledByStudent.set(l.studentId, (scheduledByStudent.get(l.studentId) ?? 0) + 1);
    setStudents(prev => prev.map(s => ({ ...s, remainingLessons: Math.max(0, (s.remainingLessons ?? 0) - (scheduledByStudent.get(s.id) ?? 0)) })));
    updatePeriod(curYm, { lessons: newLessons, unassigned: res.unassigned, status: 'draft', notified: false });
    syncDemoPeriodStatus(curYm, 'draft');
    setNotice('');
    return true;
  }
  async function approve() {
    if (needsTeacher.length && !pendingApprove) { setPendingApprove(true); setNotice(`還有 ${needsTeacher.length} 位次待補其他老師。如果仍要核准，請再按一次「確認送出」。`); return; }
    setApproving(true);
    try {
      if (realSession) {
        const res = await fetch(`/api/teacher/periods/${curYm}/approve`, { method: 'POST' });
        if (!res.ok) { const data = await res.json().catch(() => ({})); setNotice(data?.error || '核准失敗，請稍後再試。'); return; }
      }
      setPendingApprove(false);
      updatePeriod(curYm, { status: 'approved' });
      syncDemoPeriodStatus(curYm, 'approved');
      gotoSection('notify');
    } finally { setApproving(false); }
  }

  function remember(name: string) {
    if (!name || name === currentTeacherName) return;
    setNames(prev => [name, ...prev.filter(x => x !== name)].slice(0, 8));
    if (realSession) fetch('/api/teacher/substitute-names', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {});
  }
  function findConflict(teacherName: string | undefined, date: string, start: number, studentId: string, ignoreId: number | string | null): string {
    const label = teacherName || currentTeacherName;
    if (period.lessons.some(l => l.id !== ignoreId && (l.teacherName || currentTeacherName) === label && l.date === date && l.start === start)) return `${label} 在這個時段已經有課`;
    if (period.lessons.some(l => l.id !== ignoreId && l.studentId === studentId && l.date === date && l.start === start)) return `${studentName(studentId)} 在這個時段已經有課`;
    return '';
  }
  function notifyIfSent(studentId: string, text: string): string {
    if (period.status === 'notified') { updatePeriod(curYm, { log: [{ kind: 'notify', time: nowStr(), studentId, text }, ...period.log] }); return `已自動發送 LINE 訊息給 ${studentName(studentId)}。`; }
    return '目前尚未推播課表，這次調整會包含在正式通知中。';
  }
  async function applySheet() {
    if (!sheet) return;
    if (sheet.mode === 'sub') {
      const l = period.lessons.find(x => x.id === sheet.lessonId)!;
      const nm = sheet.name.trim();
      if (!nm) { setSheet({ ...sheet, error: '請輸入或選擇老師名稱' }); return; }
      const err = findConflict(nm === currentTeacherName ? undefined : nm, l.date, l.start, l.studentId, l.id);
      if (err) { setSheet({ ...sheet, error: err }); return; }
      const teacherName = nm === currentTeacherName ? undefined : nm;
      if (realSession) {
        const res = await fetch(`/api/teacher/lessons/${l.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teacherName: teacherName ?? null }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); setSheet({ ...sheet, error: data?.error || '更新失敗，請稍後再試。' }); return; }
      }
      updatePeriod(curYm, { lessons: period.lessons.map(x => x.id === l.id ? { ...x, teacherName } : x) });
      remember(nm);
      const msg = `${studentName(l.studentId)} 你好 🌸 ${md(l.date)}（${WD[weekday(l.date)]}）${hhmm(l.start)} 的課，${nm === currentTeacherName ? `改回由 ${currentTeacherName} 老師授課` : `${currentTeacherName} 老師臨時無法授課，將由 ${nm} 老師代課，時間不變`}。如有問題請直接回覆我，謝謝！🫶🏻`;
      setNotice(`${studentName(l.studentId)} ${md(l.date)}（${WD[weekday(l.date)]}）${hhmm(l.start)} 的授課老師已改為 ${teacherName || currentTeacherName}。 ${notifyIfSent(l.studentId, msg)}`);
      setSheet(null); return;
    }
    if (sheet.mode === 'time') {
      const l = period.lessons.find(x => x.id === sheet.lessonId)!;
      if (!sheet.key) { setSheet({ ...sheet, error: '請選擇一個上課時間' }); return; }
      const [date, startStr] = sheet.key.split('|'); const start = Number(startStr);
      if (!l.teacherName && !teacherAvailability.has(sheet.key)) { setSheet({ ...sheet, error: `${currentTeacherName} 在這個時段不上班，可以先用「請人代」換老師。` }); return; }
      const err = findConflict(l.teacherName, date, start, l.studentId, l.id);
      if (err) { setSheet({ ...sheet, error: err }); return; }
      if (realSession) {
        const res = await fetch(`/api/teacher/lessons/${l.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, start }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); setSheet({ ...sheet, error: data?.error || '更新失敗，請稍後再試。' }); return; }
      }
      const oldLabel = `${md(l.date)}（${WD[weekday(l.date)]}）${hhmm(l.start)}`;
      updatePeriod(curYm, { lessons: period.lessons.map(x => x.id === l.id ? { ...x, date, start } : x) });
      const newLabel = `${md(date)}（${WD[weekday(date)]}）${hhmm(start)}`;
      const msg = `${studentName(l.studentId)} 你好 🌸 你的課已調整：${oldLabel} → ${newLabel}，授課老師：${l.teacherName || currentTeacherName} 老師。如有問題請直接回覆我，謝謝！🫶🏻`;
      setNotice(`${studentName(l.studentId)} 的課已從 ${oldLabel} 改到 ${newLabel}。 ${notifyIfSent(l.studentId, msg)}`);
      setSheet(null); return;
    }
    if (sheet.mode === 'fill') {
      const u = period.unassigned[sheet.unassignedIndex];
      if (u.reason === 'no_selection') { setSheet({ ...sheet, error: '學生這週沒有可上課時段，已順延，不需安排老師。' }); return; }
      const nm = sheet.name.trim();
      if (!nm) { setSheet({ ...sheet, error: '請輸入或選擇老師名稱' }); return; }
      if (!sheet.key) { setSheet({ ...sheet, error: '請選擇一個上課時間' }); return; }
      const [date, startStr] = sheet.key.split('|'); const start = Number(startStr);
      const err = findConflict(nm === currentTeacherName ? undefined : nm, date, start, u.studentId, null);
      if (err) { setSheet({ ...sheet, error: err }); return; }
      const teacherName = nm === currentTeacherName ? undefined : nm;
      if (realSession) {
        if (!u.id) { setSheet({ ...sheet, error: '資料有誤，請重新整理後再試。' }); return; }
        const res = await fetch(`/api/teacher/unassigned/${u.id}/fill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, start, teacherName: teacherName ?? null }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setSheet({ ...sheet, error: data?.error || '安排失敗，請稍後再試。' }); return; }
        updatePeriod(curYm, { lessons: [...period.lessons, data.lesson], unassigned: period.unassigned.filter((_, i) => i !== sheet.unassignedIndex) });
      } else {
        const uid = Math.max(0, ...period.lessons.map(l => typeof l.id === 'number' ? l.id : 0)) + 1;
        const newLesson: Lesson = { id: uid, studentId: u.studentId, date, start, teacherName };
        updatePeriod(curYm, { lessons: [...period.lessons, newLesson], unassigned: period.unassigned.filter((_, i) => i !== sheet.unassignedIndex) });
      }
      remember(nm);
      const msg = `${studentName(u.studentId)} 你好 🌸 你的課已安排好：${md(date)}（${WD[weekday(date)]}）${hhmm(start)}，授課老師：${nm} 老師。如有問題請直接回覆我，謝謝！🫶🏻`;
      setNotice(`${studentName(u.studentId)} 的課已安排：${md(date)}（${WD[weekday(date)]}）${hhmm(start)}，${nm} 老師。 ${notifyIfSent(u.studentId, msg)}`);
      setSheet(null); return;
    }
  }

  function candidateSlots(mode: 'time' | 'fill', studentId: string, weekStart: string, ignoreLessonId: number | string | null, teacherName?: string): string[] {
    const sel = studentAvailability.get(studentId) ?? new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      if (d < today || !dates.includes(d)) continue;
      for (const s of STARTS) {
        const k = slotKey(d, s);
        if (!sel.has(k)) continue;
        if (period.lessons.some(x => x.id !== ignoreLessonId && x.studentId === studentId && x.date === d && x.start === s)) continue;
        if (mode === 'time' && !teacherName && (!teacherAvailability.has(k) || period.lessons.some(x => x.id !== ignoreLessonId && !x.teacherName && x.date === d && x.start === s))) continue;
        out.push(k);
      }
    }
    return out;
  }

  const activeStudent = actingStudentId ? students.find(s => s.id === actingStudentId) : null;

  // 還不確定是不是真老師之前先不畫面板，避免先閃一下展示模式的預設月份（11 月、Joanna）才跳到真正的資料。
  if (!authChecked) return <main />;

  // 沒登入、也還沒按「試用展示版」：只給「用 LINE 登入」這個主要動作，不直接丟出展示模式的切換鈕，
  // 避免真老師登出後看到 Joanna／Coco 誤以為自己要選一個。
  if (!realSession && !demoMode) {
    return (<main style={{ paddingTop: '20vh', textAlign: 'center' }}>
      <h1>🌸 排課助手</h1>
      <p className="sub">老師請用 LINE 登入管理自己的課表。</p>
      {notice && <p className="toast" role="status">{notice}</p>}
      {loginErrorUid && <div className="msg" style={{ textAlign: 'left' }}>{loginErrorUid}</div>}
      {loginErrorUid && <CopyBtn text={loginErrorUid} />}
      <a className="btn pri" style={{ width: '100%', marginTop: 24 }} href="/api/auth/line/login">用 LINE 登入</a>
      <button className="btn outline" style={{ width: '100%', marginTop: 10 }} onClick={() => setDemoMode(true)}>試用展示版</button>
    </main>);
  }

  return (<main style={{ paddingBottom: 100 }}>
    {/* ---- 已經選過「試用展示版」了，不用再把 Joanna/Coco 切換鈕秀在最上面；「用 LINE 登入」
         放回「老師管理」頁，這裡只留「展示模式」字樣，右上角呼應學生端的「切換回老師畫面」，
         放一個對稱的「預覽學生畫面」連結。 ---- */}
    {!realSession && (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <p className="hint" style={{ margin: 0 }}>展示模式</p>
        {inviteLink && (
          <p className="hint" style={{ margin: 0 }}>
            <a href={inviteLink} target="_blank" rel="noopener noreferrer">👀 預覽學生畫面</a>
          </p>
        )}
      </div>
    )}
    {/* ---- 月份列 ---- */}
    <div className="wnav">
      <button type="button" aria-label="上個月" disabled={ymKeys.indexOf(curYm) === 0} onClick={() => { selectMonth(ymKeys[ymKeys.indexOf(curYm) - 1]); setNotice(''); }}>‹</button>
      <b>{ymLabel(curYm)} <span className="pillt">{periodPillLabel(period.status, filledCount, eligibleStudents.length)}</span></b>
      <button type="button" aria-label="下個月"
        onClick={() => {
          setNotice('');
          if (curYm === lastYm) { createUpcomingMonth(); return; }
          selectMonth(ymKeys[ymKeys.indexOf(curYm) + 1]);
        }}>›</button>
    </div>

    {/* ---- 開放／關閉這個月收集時段的開關：只有真老師模式有、而且只能在還沒排課前切換 ----
         （展示模式的 FIRST_YM 固定一開始就是收集中，不需要這顆；已排課的月份要重開走「重新排課」）。 */}
    {realSession && (
      <div className="card remember-row" style={{ marginBottom: 12 }}>
        {period.status === 'closed' || period.status === 'collecting' || period.status === 'upcoming' ? (<>
          <label className="switch">
            <input type="checkbox" checked={period.status === 'collecting'} disabled={togglingOpen}
              onChange={e => openPeriod(e.target.checked)} />
            <span className="slider" />
          </label>
          <span>{togglingOpen ? '處理中…' : '開放這個月收集時段'}</span>
        </>) : (
          <p className="hint" style={{ margin: 0 }}>這個月已經排課了，要重新開放請用下面的「重新排課」。</p>
        )}
      </div>
    )}

    {/* ---- 代填模式 ---- */}
    {activeStudent ? (
      <ActingView
        student={activeStudent} dates={dates} isBlocked={isBlocked}
        sel={studentAvailability.get(activeStudent.id) ?? new Set()}
        onChange={next => setStudentSel(activeStudent.id, next)}
        onDone={async () => {
          const sel = studentAvailability.get(activeStudent.id) ?? new Set<string>();
          const n = monthCount(sel);
          if (realSession) {
            const res = await fetch(`/api/teacher/students/${activeStudent.id}/availability`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slots: [...sel].map(k => { const [date, s] = k.split('|'); return { date, start: Number(s) }; }) }),
            });
            if (!res.ok) { const data = await res.json().catch(() => ({})); setNotice(data?.error || '儲存失敗，請稍後再試。'); setActingStudentId(null); return; }
          }
          if (n) { setProxy(p => ({ ...p, [`${activeStudent.id}|${curYm}`]: true })); setNotice(`已幫 ${activeStudent.name} 儲存 ${n} 個時段。`); }
          setActingStudentId(null);
        }}
        curYm={curYm}
      />
    ) : (<>
      {notice && <p className="toast-overlay" role="status">{notice}</p>}
      {/* ---- 分頁內容 ---- */}
      {tab === 'hours' && (
        <div>
          <CollapsibleSlotGrid
            key={currentTeacherId}
            label={`${ymLabel(curYm)} 上班時段`}
            summaryText={hoursSummaryText === '這個月還沒有設定上班時段' ? hoursSummaryText : hoursMessage}
            collapsedActions={hoursSummaryText !== '這個月還沒有設定上班時段' ? (<>
              <CopyBtn text={hoursMessage} style={{ marginTop: 0 }} />
              <SaveImageBtn
                buildSvg={() => buildHoursCalendarSvg({ year: +curYm.slice(0, 4), month: +curYm.slice(5, 7), teacherName: currentTeacherName, dates, sel: teacherAvailability, starts: STARTS, lessonMinutes: L })}
                filename={`${curYm}-${currentTeacherName}-上班時段.png`}
                shareText={hoursMessage}
                style={{ marginTop: 0 }}
              />
            </>) : undefined}
            dates={dates} starts={STARTS} today={today} isBlocked={isBlocked}
            value={teacherAvailability} onChange={setTeacherAvailability}
            confirmLabel="完成選取／開放選課"
            onConfirm={confirmHours}
            footerExtra={<>
              <div className="card remember-row">
                <input type="checkbox" id="rememberHoursChk" checked={rememberHours} onChange={e => setRememberHours(e.target.checked)} />
                <label htmlFor="rememberHoursChk">記住這次的時段，之後新月份自動帶入</label>
              </div>
              <details className="card">
                <summary style={{ fontWeight: 700, cursor: 'pointer' }}>快速排休</summary>
                <p className="hint">選一段日期＋一段時間，一次設定，不用一格一格點。下面格子裡還是可以再手動微調。</p>
                <div className="rng">
                  <input type="date" aria-label="開始日期" className="tin" min={today} value={rangeForm.from} onChange={e => setRangeForm(f => ({ ...f, from: e.target.value }))} />
                  到
                  <input type="date" aria-label="結束日期" className="tin" min={rangeForm.from || today} value={rangeForm.to} onChange={e => setRangeForm(f => ({ ...f, to: e.target.value }))} />
                </div>
                <div className="rng">
                  <select aria-label="開始時間" value={rangeForm.start} onChange={e => setRangeForm(f => ({ ...f, start: e.target.value }))}>
                    {STARTS.map(s => <option key={s} value={s}>{hhmm(s)}</option>)}
                  </select>
                  到
                  <select aria-label="結束時間" value={rangeForm.end} onChange={e => setRangeForm(f => ({ ...f, end: e.target.value }))}>
                    {STARTS.map(s => <option key={s} value={s + L}>{hhmm(s + L)}</option>)}
                  </select>
                </div>
                <button
                  className={`btn${rangeApplied ? ' pri' : ' outline'}`}
                  style={{ width: '100%', marginTop: 8 }}
                  disabled={rangeBusy}
                  onClick={async () => {
                    setRangeBusy(true);
                    const ok = await applyRangeForm(false);
                    setRangeBusy(false);
                    if (ok) { setRangeApplied(true); setTimeout(() => setRangeApplied(false), 1200); }
                  }}
                >{rangeBusy ? '處理中…' : rangeApplied ? '已套用' : '設為不可上班'}</button>
              </details>
              <details className="card">
                <summary className="flexhead" style={{ fontWeight: 700, cursor: 'pointer', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '2px 8px' }}>
                  <span><i className="caret" />固定會議時間</span>
                  <span style={{ color: 'var(--on)', fontWeight: 400 }}>目前：週{WD[weeklyBlock.weekday]} {hhmm(weeklyBlock.start)}–{hhmm(weeklyBlock.end)}</span>
                </summary>
                <p className="hint">整個工作室每週固定不能上課的時間，雖然很少變動，但可以在這裡調整。</p>
                <div className="rng">
                  <select aria-label="星期" value={blockForm.weekday} onChange={e => setBlockForm(f => ({ ...f, weekday: e.target.value }))}>
                    {[1, 2, 3, 4, 5, 6, 0].map(w => <option key={w} value={w}>週{WD[w]}</option>)}
                  </select>
                  <select aria-label="開始時間" value={blockForm.start} onChange={e => setBlockForm(f => ({ ...f, start: e.target.value }))}>
                    {STARTS.map(s => <option key={s} value={s}>{hhmm(s)}</option>)}
                  </select>
                  到
                  <select aria-label="結束時間" value={blockForm.end} onChange={e => setBlockForm(f => ({ ...f, end: e.target.value }))}>
                    {STARTS.map(s => <option key={s} value={s + L}>{hhmm(s + L)}</option>)}
                  </select>
                </div>
                <button
                  className={`btn${blockApplied ? ' pri' : ' outline'}`}
                  style={{ width: '100%', marginTop: 8 }}
                  disabled={blockBusy}
                  onClick={async () => {
                    setBlockBusy(true);
                    const ok = await applyBlockForm();
                    setBlockBusy(false);
                    if (ok) { setBlockApplied(true); setTimeout(() => setBlockApplied(false), 1200); }
                  }}
                >{blockBusy ? '處理中…' : blockApplied ? '已套用' : '套用'}</button>
              </details>
            </>}
          />
        </div>
      )}

      {tab === 'plan' && (
        <div>
          {/* ---- 自動排課：邀請連結、填寫狀況、提醒、排課按鈕 ---- */}
          <button type="button" id="section-schedule" onClick={() => gotoSection('schedule')}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', background: 'none', border: 0, padding: '10px 0', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}>
            <span style={{ color: planSection === 'schedule' ? 'var(--ink)' : 'var(--muted)' }}>{planSection === 'schedule' ? '▾' : '▸'} 自動排課</span>
            {planSection !== 'schedule' && <span className="m" style={{ fontWeight: 400 }}>{filledCount}/{eligibleStudents.length} 已填寫</span>}
          </button>
          <div className={`plan-section${planSection === 'schedule' ? ' open' : ''}`}><div className="plan-section-inner">
            <div className="card">
              <b>{+curYm.slice(5)} 月填寫狀況　<span className={allFilled ? '' : 'warn'}>{filledCount}/{eligibleStudents.length}</span></b>
              {students.map(st => (
                <div className="li" key={st.id}>
                  <span>{st.name}{proxy[`${st.id}|${curYm}`] && <span className="pillt" style={{ marginLeft: 6 }}>老師代填</span>}<br />
                    <span className={(st.remainingLessons ?? 0) === 0 ? 'warn' : 'm'}>{(st.remainingLessons ?? 0) === 0 ? '0 堂・待續課' : `剩餘 ${st.remainingLessons} 堂`}</span>
                  </span>
                  <span>
                    {(st.remainingLessons ?? 0) > 0 && <><span className={filled(st) ? '' : 'warn'}>{filled(st) ? '已填寫' : '尚未填寫'}</span>{' '}
                    <button onClick={() => setActingStudentId(st.id)}>{filled(st) ? '修改時段' : '幫他填時段'}</button></>}
                    {(st.remainingLessons ?? 0) === 0 && <button onClick={() => { setTab('students'); setNotice('請在這裡替學生增加續課堂數。'); }}>前往續課</button>}
                  </span>
                </div>
              ))}
              {!allFilled && eligibleStudents.length > 0 && (
                <p className="hint" style={{ marginTop: 8 }}>還有 {eligibleStudents.length - filledCount} 位有剩餘堂數的學生沒填寫，全部填完才能自動排課。</p>
              )}
              {eligibleStudents.length === 0 && <p className="warn" style={{ marginTop: 8 }}>目前沒有可排課的學生，請先替學生設定續課堂數。</p>}
              {allFilled && !hasTeacherHours && (
                <p className="warn" style={{ marginTop: 8 }}>這個月還沒有設定上班時段，請先到「上班時間」設定後再排課。</p>
              )}
            </div>

            {period.status === 'collecting' && eligibleStudents.some(s => !filled(s)) && (
              <div className="card">
                <button className="btn" style={{ width: '100%' }} onClick={remind}>
                  現在就提醒 {eligibleStudents.filter(s => !filled(s)).length} 位未填的學生
                </button>
                <p className="hint">按鈕會直接記錄為已發送；如果想自己手動貼到 LINE（不占用則數），可以在下面已發出的提醒找複製按鈕、編輯後再傳。</p>
                {period.log.filter(x => x.kind === 'remind').length > 0 && (<>
                  <p className="m" style={{ marginTop: 8 }}>已發出的提醒：</p>
                  {period.log.filter(x => x.kind === 'remind').slice(0, 4).map((x, i) => (
                    <div key={`${currentTeacherId}|${i}`}>
                      <p className="m" style={{ marginBottom: 0 }}>{x.time} → {studentName(x.studentId)}</p>
                      <EditableMsg text={x.text} />
                    </div>
                  ))}
                </>)}
              </div>
            )}

            {/* 已經排過課的月份（draft／approved／notified）不能再直接按「自動排課」重排一次——
                要嘛去下面「確認課表」用「重新排課」，先清掉再重排，不是在這裡悄悄蓋掉舊結果。 */}
            {(period.status === 'draft' || period.status === 'approved' || period.status === 'notified') && (
              <p className="hint" style={{ marginTop: 8 }}>這個月已經排過課了，要重新排課請到下面「確認課表」按「重新排課」。</p>
            )}
            <button className="btn pri" style={{ width: '100%', marginTop: 10 }}
              disabled={!allFilled || !hasTeacherHours || scheduling || period.status === 'draft' || period.status === 'approved' || period.status === 'notified'}
              onClick={runAutoSchedule}>{scheduling ? '排課中…' : '自動排課'}</button>
          </div></div>

          {/* ---- 確認課表：排課結果、待補、順延、重新排課／確認課表 ---- */}
          <button type="button" id="section-confirm" onClick={() => gotoSection('confirm')}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', background: 'none', border: 0, padding: '10px 0', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}>
            <span style={{ color: planSection === 'confirm' ? 'var(--ink)' : 'var(--muted)' }}>{planSection === 'confirm' ? '▾' : '▸'} 確認課表</span>
            {planSection !== 'confirm' && (
              <span className="m" style={{ fontWeight: 400 }}>{hasExistingSchedule ? `已排入 ${period.lessons.length} 堂` : '尚未排課'}</span>
            )}
          </button>
          <div className={`plan-section${planSection === 'confirm' ? ' open' : ''}`}><div className="plan-section-inner">
          {
            !period.lessons.length && !period.unassigned.length ? (
              <p className="hint">按「自動排課」後，這裡會列出課表。</p>
            ) : (<>
              <LessonList lessons={period.lessons} studentName={studentName}
                onChangeTime={l => setSheet({ mode: 'time', lessonId: l.id, key: '', customDate: '', customStart: '', error: '' })}
                onSub={l => setSheet({ mode: 'sub', lessonId: l.id, name: l.teacherName || '', error: '' })} />
              {needsTeacher.length > 0 && (
                <div className="card">
                  <b className="warn">待補其他老師</b>
                  {period.unassigned.map((u, i) => u.reason === 'no_selection' ? null : (
                    <div className="li" style={{ display: 'block' }} key={i}>
                      <b>{studentName(u.studentId)}</b>　{md(u.weekStart)} 起這週<br />
                      <span className="m">{unassignedReasonLabel[u.reason]}{u.windows.length ? `，可上課：${u.windows.join('；')}` : ''}</span><br />
                      <button style={{ marginTop: 6 }} onClick={() => setSheet({ mode: 'fill', unassignedIndex: i, name: '', key: '', customDate: '', customStart: '', error: '' })}>安排老師與時間</button>
                    </div>
                  ))}
                </div>
              )}
              {deferredWeeks.length > 0 && (
                <div className="card">
                  <b>本週無可上課時段・順延</b>
                  <p className="hint">這些週不安排老師，後續週依學生可上課時間照常排課，不會自動加排兩堂。</p>
                  {deferredWeeks.map(u => (
                    <div className="li" key={`${u.studentId}|${u.weekStart}`}>
                      <span>{studentName(u.studentId)}　{md(u.weekStart)} 起這週</span>
                      <span className="m">已順延</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn outline" onClick={requestReschedule}>重新排課</button>
                <button className="btn pri" disabled={period.status === 'approved' || period.status === 'notified' || approving} onClick={approve}>
                  {approving ? '處理中…' : pendingApprove ? `確認送出（仍有 ${needsTeacher.length} 位次待補）` : '確認課表'}
                </button>
              </div>
            </>)
          }
          </div></div>

          {/* ---- 發送訊息：通知卡片 ---- */}
          <button type="button" id="section-notify" onClick={() => gotoSection('notify')}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', background: 'none', border: 0, padding: '10px 0', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}>
            <span style={{ color: planSection === 'notify' ? 'var(--ink)' : 'var(--muted)' }}>{planSection === 'notify' ? '▾' : '▸'} 發送訊息</span>
            {planSection !== 'notify' && (
              <span className="m" style={{ fontWeight: 400 }}>{period.status === 'notified' ? '已推播' : period.status === 'approved' ? '待推播' : '尚未確認課表'}</span>
            )}
          </button>
          <div className={`plan-section${planSection === 'notify' ? ' open' : ''}`}><div className="plan-section-inner">
          {
            period.status !== 'approved' && period.status !== 'notified' ? (
              <p className="hint">確認課表後，這裡會列出每位學生的通知文字。</p>
            ) : (<>
              {students.map(s => {
                const ls = period.lessons.filter(l => l.studentId === s.id);
                const n = needsTeacher.filter(u => u.studentId === s.id).length;
                const deferred = deferredWeeks.filter(u => u.studentId === s.id);
                const text = `${s.name} 你好 🌸\n這是你 ${+curYm.slice(5)} 月的上課時間：\n` +
                  ls.map(l => `${md(l.date)}（${WD[weekday(l.date)]}）${hhmm(l.start)}–${hhmm(l.start + L)}　${l.teacherName || currentTeacherName} 老師`).join('\n') +
                  (n ? `\n另有 ${n} 週的課還在安排授課老師，確定後會再通知你。` : '') +
                  (deferred.length ? `\n${deferred.map(u => `${md(u.weekStart)} 起這週`).join('、')}沒有可上課時段，這些週先不排課，順延至後續可上課週，仍以每週一堂為原則。` : '') +
                  ((s.remainingLessons ?? 0) === 0 ? `\n\n🔔 你的堂數已經排完了，如要繼續上課，請聯絡 ${currentTeacherName} 老師續課。` : `\n\n剩餘堂數：${s.remainingLessons ?? 0} 堂`);
                return (
                  <div className="card" key={s.id}>
                    <b>{s.name}</b> {period.notified && <span className="pillt">已通知</span>}
                    <EditableMsg text={text} />
                  </div>
                );
              })}
              <button className="btn outline" style={{ width: '100%' }} onClick={requestReschedule}>重新排課</button>
              {period.log.filter(x => x.kind !== 'remind').length > 0 && (<>
                <div className="sec" style={{ fontWeight: 700, margin: '18px 0 2px' }}>之後自動發送的訊息</div>
                {period.log.filter(x => x.kind !== 'remind').map((x, i) => (
                  <div className="card" key={`${currentTeacherId}|${i}`}>
                    <p className="m" style={{ marginBottom: 0 }}>{x.time} → {studentName(x.studentId)}</p>
                    <EditableMsg text={x.text} />
                  </div>
                ))}
              </>)}
            </>)
          }
          </div></div>
        </div>
      )}

      {tab === 'students' && (
        <div>
          <div className="card">
            <b>學生管理</b>
            <p className="hint">先建立學生與堂數，再把他的個人加入連結傳給本人。學生第一次用 LINE 開啟後，會直接綁定這筆資料，不用再輸入名字。</p>
            <button className="btn pri" style={{ width: '100%' }} onClick={() => setAddStudentOpen(true)}>＋ 新增學生</button>
          </div>
          {students.length === 0 && <p className="hint">目前還沒有學生，請先新增第一位學生。</p>}
          {students.map(st => {
            const link = personalInviteLink(st);
            return (
              <div className="card" key={st.id}>
                <div className="li" style={{ paddingTop: 0 }}>
                  <span><b>{st.name}</b><br /><span className="m">剩餘 {st.remainingLessons ?? 0} 堂</span></span>
                  <span className={st.linked ? '' : 'warn'}>{st.linked ? '已加入 LINE' : realSession ? '待加入' : '展示學生'}</span>
                </div>
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => openCredits(st, 'add')}>增加堂數</button>
                  <button className="btn" onClick={() => openCredits(st, 'set')}>調整餘額</button>
                </div>
                {realSession && !st.linked && (
                  <div style={{ marginTop: 10 }}>
                    {link ? <>
                      <p className="hint" style={{ marginBottom: 4 }}>這是 {st.name} 專用的一次性加入連結，請只傳給本人。</p>
                      <CopyBtn text={`${st.name} 你好 🌸\n請用 LINE 開啟這個連結加入課程：\n${link}`} style={{ width: '100%' }} />
                      <button className="btn outline" style={{ width: '100%', marginTop: 6 }} disabled={inviteBusyId === st.id} onClick={() => generateInvite(st)}>
                        {inviteBusyId === st.id ? '產生中…' : '讓舊連結失效並重新產生'}
                      </button>
                    </> : (
                      <button className="btn" style={{ width: '100%' }} disabled={inviteBusyId === st.id} onClick={() => generateInvite(st)}>
                        {inviteBusyId === st.id ? '產生中…' : '產生個人加入連結'}
                      </button>
                    )}
                  </div>
                )}
                <button className="btn outline" style={{ width: '100%', marginTop: 10 }} disabled={deletingId === st.id} onClick={() => deleteStudent(st.id)}>
                  {deletingId === st.id ? '刪除中…' : pendingDeleteId === st.id ? '確認刪除學生' : '刪除學生'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>)}

    {/* ---- 底部分頁列 ---- */}
    {!activeStudent && (
      <div className="bar" style={{ padding: '0 0 env(safe-area-inset-bottom,0px)' }}>
        <div className="tabs" role="tablist">
          {([['hours', '上班時間'], ['plan', '自動排課'], ['students', '學生管理']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setNotice(''); if (k === 'plan') setPlanSection('schedule'); }}>
              <TeacherNavIcon name={k as TeacherNavIconName} /><span>{label}</span>
            </button>
          ))}
          <Link href="/teacher/manage" role="tab"><TeacherNavIcon name="manage" /><span>老師管理</span></Link>
        </div>
      </div>
    )}

    {/* ---- 重新排課的確認視窗 ---- */}
    {rescheduleConfirmOpen && (
      <div className="ov" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }} onClick={() => setRescheduleConfirmOpen(false)}>
        <div className="card" style={{ maxWidth: 340, width: '100%', textAlign: 'center', margin: 0, padding: '28px 24px', borderRadius: 20 }} onClick={e => e.stopPropagation()}>
          <b style={{ fontSize: '1.15rem' }}>確定重新排課？</b>
          <p className="hint" style={{ margin: '10px 0 22px', fontSize: '.95rem' }}>會清除目前課表</p>
          <div className="row" style={{ gap: 12 }}>
            <button className="btn" style={{ minHeight: 50, borderRadius: 14 }} disabled={scheduling} onClick={() => setRescheduleConfirmOpen(false)}>取消</button>
            <button className="btn pri" style={{ minHeight: 50, borderRadius: 14 }} disabled={scheduling} onClick={confirmReschedule}>{scheduling ? '處理中…' : '確定'}</button>
          </div>
        </div>
      </div>
    )}

    {/* ---- 剛開放選課：強提醒把通知文字傳給學生 ---- */}
    {showHoursPopup && (
      <div className="ov" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowHoursPopup(false)}>
        <div className="card" style={{ maxWidth: 420, width: '100%', margin: 0, maxHeight: '85vh', overflow: 'auto', position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button type="button" aria-label="關閉" onClick={() => setShowHoursPopup(false)}
            style={{ position: 'absolute', top: 10, right: 10, width: 32, height: 32, border: 0, background: 'none', color: 'var(--muted)', fontSize: '1.5rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          <b style={{ fontSize: '1.1rem', display: 'block', paddingRight: 36 }}>{hoursPopupKind === 'opened' ? `🎉 已開放 ${+curYm.slice(5)} 月選課！` : `✅ ${+curYm.slice(5)} 月上班時段已更新`}</b>
          <p className="hint">把下面這段最新的訊息傳給學生，{hoursPopupKind === 'opened' ? '讓他們知道可以開始選時間了' : '確保他們看到的時段是最新的'}。</p>
          <EditableMsg
            key={`popup-${currentTeacherId}|${curYm}`}
            text={hoursMessage}
            extraAction={value => (
              <SaveImageBtn
                buildSvg={() => buildHoursCalendarSvg({ year: +curYm.slice(0, 4), month: +curYm.slice(5, 7), teacherName: currentTeacherName, dates, sel: teacherAvailability, starts: STARTS, lessonMinutes: L })}
                filename={`${curYm}-${currentTeacherName}-上班時段.png`}
                shareText={value}
                primary
                style={{ marginTop: 0 }}
              />
            )}
          />
        </div>
      </div>
    )}

    {/* ---- 新增學生 的彈出表單 ---- */}
    {addStudentOpen && (<>
      <div className="ov" onClick={() => setAddStudentOpen(false)} />
      <div className="sheet" role="dialog" aria-label="新增學生">
        <b>新增學生</b>
        <p className="hint">先輸入學生姓名與目前可用堂數。新增後，系統會產生他的個人加入連結。</p>
        <div className="rng">
          <input className="tin" placeholder="學生名稱" autoFocus value={newStudentName}
            onChange={e => setNewStudentName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addStudent(); }} />
        </div>
        <p className="m" style={{ margin: '10px 0 4px' }}>目前可排堂數</p>
        <input className="tin" type="number" min="0" step="1" inputMode="numeric" value={newStudentLessons}
          onChange={e => setNewStudentLessons(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addStudent(); }} />
        <button className="btn pri" style={{ width: '100%', marginTop: 12 }} disabled={addStudentBusy} onClick={addStudent}>{addStudentBusy ? '新增中…' : '新增學生'}</button>
      </div>
    </>)}

    {/* ---- 設定／續課堂數 ---- */}
    {creditStudentId && (<>
      <div className="ov" onClick={() => setCreditStudentId(null)} />
      <div className="sheet" role="dialog" aria-label="設定剩餘堂數">
        <b>{creditMode === 'add' ? `替 ${studentName(creditStudentId)} 增加堂數` : `${studentName(creditStudentId)} 的剩餘堂數`}</b>
        <p className="hint">{creditMode === 'add' ? '輸入這次新購買的堂數，會直接加到目前餘額。' : '填寫從現在開始還能排幾堂。排入課表後會自動扣除；重新排課清除課表時會自動退回。'}</p>
        <input className="tin" type="number" min={creditMode === 'add' ? '1' : '0'} step="1" inputMode="numeric" autoFocus value={creditInput}
          onChange={e => setCreditInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveCredits(); }} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={creditSaving} onClick={() => setCreditStudentId(null)}>取消</button>
          <button className="btn pri" disabled={creditSaving} onClick={saveCredits}>{creditSaving ? '儲存中…' : creditMode === 'add' ? '確認增加' : '儲存堂數'}</button>
        </div>
      </div>
    </>)}

    {/* ---- 改時間／請人代／安排老師 的彈出表單 ---- */}
    {sheet && (
      <SheetView
        sheet={sheet} setSheet={setSheet} names={names} studentName={studentName} currentTeacherName={currentTeacherName}
        period={period} candidateSlots={candidateSlots} dates={dates} studentAvailability={studentAvailability} apply={applySheet}
      />
    )}
  </main>);
}

function ActingView({ student, dates, isBlocked, sel, onChange, onDone, curYm }: {
  student: DemoStudent; dates: string[]; isBlocked: (d: string, s: number) => boolean;
  sel: Set<string>; onChange: (n: Set<string>) => void; onDone: () => void | Promise<void>; curYm: string;
}) {
  const [saving, setSaving] = useState(false);
  const n = [...sel].filter(k => k.startsWith(curYm)).length;
  const summary = analyzeWeeklyPattern(sel, dates, STARTS, L);
  const summaryText = summary.runs.length
    ? summary.runs.map(r => `${r.dayLabel} ${r.windowLabel}`).join('\n') +
      (summary.off.length ? `\n不行：${summary.off.map(md).join('、')}` : '') +
      (summary.changed.length ? `\n調整：${summary.changed.join('、')}` : '')
    : '還沒有選任何時段';
  return (<div>
    <h1>幫 {student.name} 填寫</h1>
    <p className="hint">你正在代替 {student.name} 填寫 {+curYm.slice(5)} 月可上課的時間，點格子的方式和學生端一樣。</p>
    <CollapsibleSlotGrid
      label={`${student.name}的${ymLabel(curYm)}時段`}
      summaryText={summaryText}
      dates={dates} starts={STARTS} today={today} isBlocked={isBlocked}
      value={sel} onChange={onChange}
      confirmLabel="完成選取"
    />
    <button className="btn pri" style={{ width: '100%', marginTop: 10 }} disabled={saving}
      onClick={async () => { setSaving(true); try { await onDone(); } finally { setSaving(false); } }}>
      {saving ? '儲存中…' : `完成（已選 ${n} 個時段）`}
    </button>
  </div>);
}

function LessonList({ lessons, studentName, onChangeTime, onSub }: {
  lessons: Lesson[]; studentName: (id: string) => string;
  onChangeTime: (l: Lesson) => void; onSub: (l: Lesson) => void;
}) {
  let curWeek = '';
  return (<>
    {lessons.map(l => {
      const w = weekStartOf(l.date);
      const header = w !== curWeek ? (curWeek = w, <div className="wh" key={`w-${w}`}>{md(w)} 起這週</div>) : null;
      return (
        <Fragment key={l.id}>
          {header}
          <div className="li">
            <span>{md(l.date)}（{WD[weekday(l.date)]}）{hhmm(l.start)} {studentName(l.studentId)}
              {l.checkedInAt && <span className="pillt" style={{ marginLeft: 6 }}>✅ 已簽到</span>}
              {l.teacherName && <><br /><span className="m">代課：{l.teacherName}</span></>}
            </span>
            <span>
              <button onClick={() => onChangeTime(l)}>改時間</button>{' '}
              <button onClick={() => onSub(l)}>請人代</button>
            </span>
          </div>
        </Fragment>
      );
    })}
  </>);
}

function SheetView({ sheet, setSheet, names, studentName, currentTeacherName, period, candidateSlots, dates, studentAvailability, apply }: {
  sheet: SheetState; setSheet: (s: SheetState | null) => void; names: string[]; studentName: (id: string) => string;
  currentTeacherName: string;
  period: PeriodState; candidateSlots: (mode: 'time' | 'fill', studentId: string, weekStart: string, ignoreId: number | string | null, teacherName?: string) => string[];
  dates: string[]; apply: () => void | Promise<void>;
  studentAvailability: Map<string, Set<string>>;
}) {
  const [applying, setApplying] = useState(false);
  const lesson = sheet.mode !== 'fill' ? period.lessons.find(x => x.id === sheet.lessonId) : null;
  const unassigned = sheet.mode === 'fill' ? period.unassigned[sheet.unassignedIndex] : null;
  const studentId = lesson?.studentId ?? unassigned?.studentId ?? '';
  const weekStart = lesson ? weekStartOf(lesson.date) : (unassigned?.weekStart ?? '');

  const title = sheet.mode === 'time' ? `${studentName(studentId)} 改時間（目前 ${md(lesson!.date)}（${WD[weekday(lesson!.date)]}）${hhmm(lesson!.start)}）`
    : sheet.mode === 'sub' ? `${studentName(studentId)} ${md(lesson!.date)}（${WD[weekday(lesson!.date)]}）${hhmm(lesson!.start)} 請人代`
    : `${studentName(studentId)} 安排老師與時間`;

  const showNamePicker = sheet.mode !== 'time';
  const showTimePicker = sheet.mode !== 'sub';
  const candidates = showTimePicker ? candidateSlots(sheet.mode === 'fill' ? 'fill' : 'time', studentId, weekStart, sheet.mode !== 'fill' ? sheet.lessonId : null, sheet.mode === 'time' ? lesson!.teacherName : undefined) : [];
  const selectedKey = sheet.mode !== 'sub' ? sheet.key : '';
  const studentSlots = studentAvailability.get(studentId) ?? new Set<string>();
  const weekStudentSlots = [...studentSlots].filter(k => {
    const d = k.split('|')[0];
    return dates.includes(d) && d >= today && weekStartOf(d) === weekStart;
  });

  return (<>
    <div className="ov" onClick={() => setSheet(null)} />
    <div className="sheet" role="dialog" aria-label={title}>
      <b>{title}</b>
      {showNamePicker && (<>
        <p className="m" style={{ margin: '10px 0 4px' }}>代課老師</p>
        <input className="tin" list="tnl" placeholder="輸入老師名稱" autoComplete="off"
          value={sheet.name}
          onChange={e => setSheet({ ...sheet, name: e.target.value, error: '' })} />
        <datalist id="tnl">{names.map(n => <option key={n} value={n} />)}</datalist>
        <div className="tags">
          {sheet.mode === 'sub' && lesson?.teacherName && (
            <button className="tag" aria-pressed={sheet.name === currentTeacherName} onClick={() => setSheet({ ...sheet, name: currentTeacherName, error: '' })}>改回 {currentTeacherName}</button>
          )}
          {names.map(n => (
            <span className="tagp" key={n}>
              <button className="tag" aria-pressed={sheet.name === n} onClick={() => setSheet({ ...sheet, name: n, error: '' })}>{n}</button>
            </span>
          ))}
        </div>
        <p className="m">輸入過的老師名稱會記住，下次直接點選。</p>
      </>)}
      {showTimePicker && (<>
        <p className="m" style={{ margin: '10px 0 4px' }}>{sheet.mode === 'time' ? '學生選過的可調整時段（同一週）' : `學生選過的時段（${md(weekStart)} 起這週）`}</p>
        {candidates.length ? (
          <div className="slots">
            {candidates.map(k => {
              const [d, s] = k.split('|');
              return <button key={k} aria-pressed={selectedKey === k} onClick={() => setSheet({ ...sheet, key: k, customDate: d, customStart: s, error: '' } as SheetState)}>
                {md(d)}（{WD[weekday(d)]}）{hhmm(Number(s))}
              </button>;
            })}
          </div>
        ) : <p className="m">{weekStudentSlots.length ? '學生這週選過的時段目前無法安排（可能已有課或不符合老師班表）。' : '學生在這週的本月日期沒有勾選可上課時段。'} 可查看下方本月其他日期；未勾選的時間需先與學生確認。</p>}
        <p className="m" style={{ margin: '10px 0 4px' }}>本月其他時間（★ 表示學生選過）</p>
        <div className="rng">
          <select aria-label="日期" value={sheet.customDate} onChange={e => { const v = e.target.value; const ns = { ...sheet, customDate: v, error: '' }; if (v && ns.customStart) ns.key = `${v}|${ns.customStart}`; setSheet(ns); }}>
            <option value="">日期</option>
            {dates.filter(d => d >= today).map(d => <option key={d} value={d}>{md(d)}（{WD[weekday(d)]}）{STARTS.some(s => studentSlots.has(slotKey(d, s))) ? ' ★' : ' 未勾選'}</option>)}
          </select>
          <select aria-label="時間" value={sheet.customStart} onChange={e => { const v = e.target.value; const ns = { ...sheet, customStart: v, error: '' }; if (ns.customDate && v) ns.key = `${ns.customDate}|${v}`; setSheet(ns); }}>
            <option value="">時間</option>
            {STARTS.map(s => <option key={s} value={s}>{hhmm(s)}{sheet.customDate ? studentSlots.has(slotKey(sheet.customDate, s)) ? ' ★' : ' 未勾選，需確認' : ''}</option>)}
          </select>
        </div>
        {selectedKey && (<>
          <p className="m">已選：{md(selectedKey.split('|')[0])}（{WD[weekday(selectedKey.split('|')[0])]}）{hhmm(Number(selectedKey.split('|')[1]))}</p>
          {!studentSlots.has(selectedKey) && <p className="warn">⚠ 學生沒有勾選這個時段，請先與學生確認再安排。</p>}
        </>)}
      </>)}
      {sheet.error && <p className="warn" role="alert">{sheet.error}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => setSheet(null)}>取消</button>
        <button className="btn pri" disabled={applying} onClick={async () => { setApplying(true); try { await apply(); } finally { setApplying(false); } }}>
          {applying ? '處理中…' : sheet.mode === 'time' ? '改成這個時間' : sheet.mode === 'sub' ? '確認代課' : '確認安排'}
        </button>
      </div>
    </div>
  </>);
}
