'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import CollapsibleSlotGrid from '@/components/CollapsibleSlotGrid';
import PresetChips from '@/components/PresetChips';
import { DEMO_PERIOD, slotBlocked, type DemoPeriod } from '@/lib/period';
import {
  getAllTeachers, seedTeacherAvailability, getMyJoin, joinAsStudent, getDemoStudentPattern, saveDemoStudentPattern,
  saveDemoSubmittedAvailability, getDemoTeacherSettings, getDemoPeriodStatus, PERIOD_STATUS_STORAGE_PREFIX, type DemoStudent,
} from '@/lib/teacherDemo';
import { analyzeWeeklyPattern, datesBetween, hhmm, md, weekday, weekdayLabel } from '@/lib/scheduling';
import { applyPatternToBlankMonth, applyPresetToSelection, deriveWeeklyPattern, touchedWeekdays, type WeeklyPattern } from '@/lib/weeklyPattern';
import { STUDENT_PRESETS } from '@/lib/presets';
import { defaultCourseRuleLines } from '@/lib/courseDefaults';

// 台灣日期（UTC+8）
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 畫面實際會用到的欄位：展示模式固定用 DEMO_PERIOD；真老師模式打 API 問這位老師目前開放選課的月份，
// 形狀一樣，剩下的畫面邏輯（月曆、isBlocked、送出）兩邊共用，不用另外分支。
type ActivePeriod = Pick<DemoPeriod, 'ym' | 'from' | 'to' | 'starts' | 'lessonMinutes' | 'weeklyBlocks'>;
// 真老師模式的學生記錄多帶一個「記住的常用時段」，展示模式永遠是 undefined，從 localStorage 另外查。
type JoinedStudent = DemoStudent & { weeklyPattern?: WeeklyPattern | null; existingAvailability?: string[] };
type ScheduleLesson = { id: string; date: string; start: number; teacherName?: string; checkedInAt?: string };

export default function Page() {
  // 用邀請連結帶的 ?t=teacherId 分辨「這是哪位老師的學生」：先查展示名單（完全不變），
  // 查不到才問 Supabase 是不是真正的老師——這樣真老師的連結才不會被誤判成「連結不完整」。
  const [ready, setReady] = useState(false);
  const [resolved, setResolved] = useState<{ id: string; name: string; isReal: boolean; courseName?: string; courseRules?: string } | null>(null);
  const [joined, setJoined] = useState<JoinedStudent | null>(null);
  const [realPeriod, setRealPeriod] = useState<ActivePeriod | null>(null);
  const [realTeacherAvailability, setRealTeacherAvailability] = useState<Set<string>>(new Set());
  const [noOpenPeriod, setNoOpenPeriod] = useState(false);
  // 真老師模式：排課完成後（noOpenPeriod 代表「不是收集中」，可能是還沒開放、也可能是排完課了），
  // 改查這支「我的課表」API，有課的話顯示卡片畫面，不是籠統顯示「目前沒有開放選課」。
  const [mySchedule, setMySchedule] = useState<{ ym: string; lessons: ScheduleLesson[] } | null>(null);
  // 展示模式：老師完成自動排課後，這個月就不能再編輯了（跟真老師模式靠資料庫 periods.status
  // 是同一個規則，只是展示模式沒有資料庫，額外存一份在 localStorage，見 lib/teacherDemo.ts）。
  const [demoLocked, setDemoLocked] = useState(false);
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  // 在 LINE 裡用 LIFF 打開連結時，網址上的 ?t=... 一開始會被 LIFF 包成 liff.state 參數，
  // liff.init() 跑完才會把網址復原成正常的 ?t=...。這裡要先等 LIFF 準備好才讀網址參數，
  // 不然會在 liff.state 都還沒復原的那一瞬間讀到空的 t，誤判成「連結不完整」。
  const [liffReady, setLiffReady] = useState(!liffId);

  useEffect(() => {
    if (!liffReady) return;
    (async () => {
      const t = new URLSearchParams(window.location.search).get('t');
      if (!t) { setReady(true); return; }
      const demo = getAllTeachers().find(x => x.id === t);
      if (demo) {
        // 老師管理頁的展示模式也能改課程名稱／選課規則了，這裡要套用，不然展示模式永遠只看得到預設值。
        const s = getDemoTeacherSettings(demo.id);
        setResolved({ id: demo.id, name: demo.name, isReal: false, courseName: s.courseName, courseRules: s.courseRules });
        setJoined(getMyJoin(demo.id));
        setReady(true);
        return;
      }
      try {
        const res = await fetch(`/api/teachers/${t}`);
        if (res.ok) {
          const real = await res.json();
          setResolved({ id: real.id, name: real.name, isReal: true, courseName: real.courseName, courseRules: real.courseRules });
        }
      } catch { /* 網路錯誤：resolved 維持 null，顯示「連結不完整」 */ }
      setReady(true);
    })();
  }, [liffReady]);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ t: 'idle' | 'busy' | 'ok' | 'err'; m?: string }>({ t: 'idle' });
  const [idToken, setIdToken] = useState<string | null>(null);
  // 送出成功後鎖住格子，避免手滑誤觸就以為是要修改；要改要先按「編輯」。
  const [locked, setLocked] = useState(false);
  // 快速選取：點一顆就是幫你把下面日曆對應的星期、時間一次勾好，不是另一套系統；星期幾不重疊的
  // 可以同時選好幾顆（例如平日晚上＋週末全天），手動調整過日曆後這裡要清空，不然會讓人誤以為
  // 目前還是那些預設的樣子。
  const [activePresets, setActivePresets] = useState<Set<string>>(new Set());
  const [rememberPattern, setRememberPattern] = useState(true);
  // 只在「打開一個還沒選過任何時段的月份」自動套用一次記住的常用時段，之後使用者自己清空
  // 不會再被蓋回去。
  const patternAppliedRef = useRef(false);

  // 真老師模式：加入時如果查到這個學生本月已經送出過時段，直接把畫面還原成跟上次送出時一樣
  // （鎖定＋顯示她真正選過的格子），不然關掉連結重開會看起來像沒填過，容易重複填寫。
  function handleJoined(s: JoinedStudent) {
    setJoined(s);
    if (s.existingAvailability?.length) {
      setSel(new Set(s.existingAvailability));
      setLocked(true);
      patternAppliedRef.current = true;
    }
  }

  useEffect(() => { // 在 LINE 內開啟時自動登入，取得學生身分
    if (!liffId) return;
    // 展示模式的連結（?t=demo-id）就算直接在一般瀏覽器打開也不該跑 LIFF 流程，不然會被導去
    // 真的 LINE 登入頁面，展示模式就沒辦法直接在瀏覽器裡測試／展示給別人看了。
    const qsT = new URLSearchParams(window.location.search).get('t');
    if (qsT && getAllTeachers().some(x => x.id === qsT)) { setLiffReady(true); return; }
    (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }
        setIdToken(liff.getIDToken());
      } catch { setStatus({ t: 'err', m: '無法連接 LINE，請從官方帳號的選單重新開啟。' }); }
      finally { setLiffReady(true); }
    })();
  }, [liffId]);

  // 真老師模式：確認是真的老師之後，問她這個連結指定的是哪個月（?ym=，邀請連結現在會帶這個參數，
  // 同時可能有好幾個月都在收集中，不能再用「猜唯一一個收集中的月份」那套；沒帶 ym 的舊連結才讓
  // 後端自己退回舊行為）。
  useEffect(() => {
    if (!resolved?.isReal) return;
    const ym = new URLSearchParams(window.location.search).get('ym');
    const url = ym ? `/api/teachers/${resolved.id}/period?ym=${ym}` : `/api/teachers/${resolved.id}/period`;
    fetch(url).then(r => r.json()).then(data => {
      if (data.noOpenPeriod) { setNoOpenPeriod(true); return; }
      setRealPeriod({ ym: data.ym, from: data.from, to: data.to, starts: data.starts, lessonMinutes: data.lessonMinutes, weeklyBlocks: data.weeklyBlocks });
      setRealTeacherAvailability(new Set<string>(data.teacherAvailability));
    }).catch(() => setNoOpenPeriod(true));
  }, [resolved]);

  // 真老師模式：這個月不是收集中（還沒開放，或已經排課），查有沒有已經排好的課，有的話顯示
  // 「我的課表」卡片畫面，不要只顯示籠統的「目前沒有開放選課」。
  useEffect(() => {
    if (!resolved?.isReal || !joined || !noOpenPeriod) return;
    fetch('/api/students/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, teacherId: resolved.id }),
    }).then(r => r.json()).then(data => {
      if (data.lessons?.length) setMySchedule({ ym: data.ym, lessons: data.lessons });
    }).catch(() => {});
  }, [resolved, joined, noOpenPeriod, idToken]);

  // 展示模式：同一件事換個來源——問 localStorage 而不是資料庫，而且要能跨分頁即時反映
  // （老師那頁按「自動排課」之後，學生這頁不用重新整理也會被鎖住）。
  useEffect(() => {
    if (!resolved || resolved.isReal) return;
    const key = PERIOD_STATUS_STORAGE_PREFIX + resolved.id + '|' + DEMO_PERIOD.ym;
    const sync = () => setDemoLocked(getDemoPeriodStatus(resolved.id, DEMO_PERIOD.ym) === 'locked');
    sync();
    const onStorage = (e: StorageEvent) => { if (e.key === key) sync(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [resolved]);

  const P: ActivePeriod | null = resolved?.isReal ? realPeriod : DEMO_PERIOD;
  const teacherName = resolved?.name ?? '';
  const courseName = resolved?.courseName || '皮拉提斯';
  const dates = useMemo(() => P ? datesBetween(P.from, P.to) : [], [P]);
  const isBlocked = (d: string, s: number) => P ? slotBlocked(P, weekday(d), s) : false;

  // 展示模式：跟老師端的示範資料用同一個產生方式，確保兩邊看到的上班時段一致。
  // 真老師模式：直接用老師實際設定的上班時段（API 已經整理成 slot key 陣列）。
  const teacherAvailability = useMemo(() => {
    if (!P) return new Set<string>();
    return resolved?.isReal ? realTeacherAvailability : seedTeacherAvailability(dates, P.starts, isBlocked);
  }, [P, dates, resolved?.isReal, realTeacherAvailability]);

  const summary = useMemo(() => P ? analyzeWeeklyPattern(sel, dates, P.starts, P.lessonMinutes) : { runs: [], off: [], changed: [] }, [sel, P, dates]);

  // 打開一個還沒選過任何時段的月份：如果之前記住過常用時段，直接幫忙先勾好，不用按任何「套用」。
  useEffect(() => {
    if (patternAppliedRef.current || !P || !joined || sel.size > 0) return;
    const pattern = resolved?.isReal ? (joined.weeklyPattern ?? null) : getDemoStudentPattern(resolved!.id, joined.id);
    patternAppliedRef.current = true;
    if (!pattern || !pattern.length) return;
    const next = applyPatternToBlankMonth(pattern, dates, today, isBlocked);
    if (next.size) setSel(next);
  }, [P, joined, dates, resolved, sel.size]);

  async function submit() {
    if (!P || !resolved || !joined) return;
    setStatus({ t: 'busy' });
    try {
      const windows = [...sel].map(k => { const [date, s] = k.split('|'); return { date, start: Number(s), end: Number(s) + P.lessonMinutes }; });
      const res = await fetch('/api/availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, teacherId: resolved.id, ym: P.ym, windows, remember: rememberPattern }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '送出失敗');
      // 展示模式沒有真的資料庫：實際送出的時段、「記住」的常用時段，都要自己存進 localStorage，
      // 老師端（同一瀏覽器的另一個分頁，或重新整理後）才看得到這位學生送出了什麼。
      if (j.demo) {
        saveDemoSubmittedAvailability(resolved.id, joined.id, [...sel]);
        if (rememberPattern) saveDemoStudentPattern(resolved.id, joined.id, deriveWeeklyPattern(sel, dates, P.starts));
      }
      setStatus({ t: 'ok', m: (j.demo ? '展示模式：已模擬送出（尚未寫入資料庫）。' : '已送出！排好後會用 LINE 個別通知你上課日期、時間及授課老師。') + '要修改請按「編輯時段」。' });
      setLocked(true);
    } catch (e) { setStatus({ t: 'err', m: (e as Error).message + '，請稍後再試。' }); }
  }

  // 送出結果的提醒改成浮動 toast，出現一次、幾秒後自動消失，不要一直黏在畫面上。
  useEffect(() => {
    if (!status.m) return;
    const timer = setTimeout(() => setStatus(s => ({ ...s, m: undefined })), 4000);
    return () => clearTimeout(timer);
  }, [status.m]);

  // 展示模式的連結完全跳過 LIFF 登入（見上面那段註解），所以 idToken 本來就會一直是 null，
  // 不能把這個也當成「還沒登入」，不然展示模式送出按鈕會被一直鎖住。
  const needLogin = !!resolved?.isReal && !!liffId && !idToken;

  if (!ready) return <main />;

  if (!resolved) {
    return (<main>
      <h1>這個連結不完整</h1>
      <p className="sub">請跟老師要正確的選課連結。直接打開網站首頁沒辦法知道你是哪位老師的學生，老師的連結後面應該會多一段「?t=」加一串代碼。</p>
    </main>);
  }

  if (!joined) {
    return resolved.isReal
      ? <RealJoinView teacherId={resolved.id} teacherName={resolved.name} courseName={courseName} idToken={idToken} needLogin={needLogin} onJoined={handleJoined} />
      : <JoinView teacherId={resolved.id} teacherName={resolved.name} onJoined={setJoined} />;
  }

  if (resolved.isReal && noOpenPeriod) {
    if (mySchedule) {
      return <MyScheduleView teacherName={teacherName} studentName={joined.name} ym={mySchedule.ym} initialLessons={mySchedule.lessons} idToken={idToken} />;
    }
    return (<main>
      <h1>🌸 {teacherName} 的{courseName}課程</h1>
      <p className="sub">{joined.name} 你好，目前沒有開放選課，請等老師通知開放時間。</p>
    </main>);
  }
  if (!resolved.isReal && demoLocked) {
    return (<main>
      <h1>🌸 {teacherName} 的{courseName}課程</h1>
      <p className="sub">{joined.name} 你好，這個月已經完成排課，不能再修改時段了，請等老師用 LINE 通知你的上課時間。</p>
    </main>);
  }
  if (!P) return <main />; // 真老師模式：還在讀取這個月的設定

  return (<main>
    {!resolved.isReal && <p className="hint" style={{ textAlign: 'right' }}><a href="/teacher">👀 切換回老師畫面</a></p>}
    <h1>🌸 {+P.ym.slice(5)} 月{courseName}選課開始囉！</h1>
    <p className="sub">{joined.name} 你好，請勾選這個月所有可以上課的日期與時間。等大家都填寫完成，我們會安排課表，並用 LINE 個別通知你上課日期、時間及授課老師。</p>
    <details className="card">
      <summary style={{ fontWeight: 700, cursor: 'pointer' }}>選課規則與時間說明</summary>
      {resolved.courseRules ? (
        <p style={{ whiteSpace: 'pre-wrap' }}>{resolved.courseRules}</p>
      ) : (
        <ul>
          {defaultCourseRuleLines(teacherName).map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
    </details>

    {status.m && <p className={'toast-overlay' + (status.t === 'err' ? ' err' : '')} role="status">{status.m}</p>}

    <CollapsibleSlotGrid
      key={String(locked)}
      label={`${+P.ym.slice(5)} 月你的時段`}
      summaryText={summary.runs.length
        ? summary.runs.map(r => `${r.dayLabel} ${r.windowLabel}`).join('\n') +
          (summary.off.length ? `\n不行：${summary.off.map(md).join('、')}` : '') +
          (summary.changed.length ? `\n調整：${summary.changed.join('、')}` : '')
        : '還沒有選任何時段'}
      dates={dates}
      starts={P.starts}
      today={today}
      isBlocked={isBlocked}
      value={sel}
      onChange={next => {
        // 只取消真的被動到的星期幾對應的快速選取按鈕，沒被動到的（例如只調了平日晚上，週末全天）要維持選取。
        const touched = touchedWeekdays(sel, next, dates, P.starts);
        setActivePresets(prev => {
          const n = new Set(prev);
          for (const id of prev) {
            const preset = STUDENT_PRESETS.find(p => p.id === id);
            if (preset?.weekdays.some(w => touched.has(w))) n.delete(id);
          }
          return n;
        });
        setSel(next);
      }}
      dashedSet={teacherAvailability}
      dashedHint={`虛線格子是 ${teacherName} 不上班的時段，可能會安排其他老師授課。`}
      readOnly={locked}
      onUnlock={locked ? () => setLocked(false) : undefined}
      confirmLabel="完成選取"
      headerExtra={!locked && (
        <PresetChips presets={STUDENT_PRESETS} activeIds={activePresets} onToggle={preset => {
          const turningOn = !activePresets.has(preset.id);
          setActivePresets(prev => {
            const next = new Set(prev);
            if (turningOn) {
              // 星期幾有重疊的預設不能同時套用（同一天不能同時是兩種時段），選了新的就取消舊的。
              for (const other of STUDENT_PRESETS) {
                if (other.id !== preset.id && next.has(other.id) && other.weekdays.some(w => preset.weekdays.includes(w))) next.delete(other.id);
              }
              next.add(preset.id);
            } else {
              next.delete(preset.id);
            }
            return next;
          });
          // 取消＝把這個預設的星期幾清空（不是疊加其他預設的時段，只清自己負責的那幾天）。
          setSel(prev => applyPresetToSelection(prev, dates, P.starts, isBlocked, today, preset.weekdays, turningOn ? preset.starts : []));
        }} />
      )}
      footerExtra={!locked && (
        <div className="card remember-row">
          <input type="checkbox" id="rememberPatternChk" checked={rememberPattern} onChange={e => setRememberPattern(e.target.checked)} />
          <label htmlFor="rememberPatternChk">記住這個設定，下個月自動帶入</label>
        </div>
      )}
    />

    {!locked && (
      <div className="bar"><div>
        <button className="send" disabled={!sel.size || needLogin || status.t === 'busy'} onClick={submit}>
          {status.t === 'busy' ? '送出中…' : `送出 ${sel.size} 個可上課時段`}
        </button>
      </div></div>
    )}
  </main>);
}

function JoinView({ teacherId, teacherName, onJoined }: { teacherId: string; teacherName: string; onJoined: (s: JoinedStudent) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  function submit() {
    const nm = name.trim();
    if (!nm) { setError('請輸入你的名字'); return; }
    onJoined(joinAsStudent(teacherId, nm));
  }
  return (<main>
    <p className="hint" style={{ textAlign: 'right' }}><a href="/teacher">👀 切換回老師畫面</a></p>
    <h1>🌸 加入 {teacherName} 的皮拉提斯課程</h1>
    <p className="sub">第一次使用，請輸入你的名字，老師才能在名單裡認出你。之後用同一個連結打開會直接記得你，不用再填一次。</p>
    <div className="card">
      <label className="m" htmlFor="jn">你的名字</label><br />
      <input id="jn" className="tin" placeholder="例如：王小美" value={name}
        onChange={e => { setName(e.target.value); setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
    <div className="bar"><div>
      <button className="send" onClick={submit}>加入</button>
    </div></div>
  </main>);
}

// 真老師模式的加入流程：不用 localStorage，完全靠已驗證的 LINE userId 判斷「加入過了嗎」，
// 換裝置、清瀏覽器資料都還認得出來。先在沒帶名字的情況下問一次，查到既有記錄就直接登入；
// 查不到才顯示填名字表單。
function RealJoinView({ teacherId, teacherName, courseName, idToken, needLogin, onJoined }: {
  teacherId: string; teacherName: string; courseName: string; idToken: string | null; needLogin: boolean; onJoined: (s: JoinedStudent) => void;
}) {
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!idToken) return;
    (async () => {
      try {
        const res = await fetch('/api/students/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, teacherId }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && !data.needsName) { onJoined(data); return; }
        if (!res.ok) setError(data?.error || '無法確認你的身分，請重新打開連結。');
      } catch { setError('無法確認你的身分，請重新打開連結。'); }
      setChecked(true);
    })();
  }, [idToken, teacherId, onJoined]);

  async function submit() {
    const nm = name.trim();
    if (!nm) { setError('請輸入你的名字'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/students/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, teacherId, name: nm }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || '加入失敗，請稍後再試。'); setBusy(false); return; }
      onJoined(data);
    } catch { setError('加入失敗，請稍後再試。'); setBusy(false); }
  }

  if (needLogin || !checked) {
    return (<main>
      <h1>🌸 加入 {teacherName} 的{courseName}課程</h1>
      <p className="sub">{error || '正在確認你的身分…'}</p>
    </main>);
  }

  return (<main>
    <h1>🌸 加入 {teacherName} 的{courseName}課程</h1>
    <p className="sub">第一次使用，請輸入你的名字，老師才能在名單裡認出你。之後用同一個連結打開會直接記得你，不用再填一次。</p>
    <div className="card">
      <label className="m" htmlFor="jn">你的名字</label><br />
      <input id="jn" className="tin" placeholder="例如：王小美" value={name}
        onChange={e => { setName(e.target.value); setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
    <div className="bar"><div>
      <button className="send" disabled={busy} onClick={submit}>{busy ? '加入中…' : '加入'}</button>
    </div></div>
  </main>);
}

// 排課完成後（不管是還沒開放還是已經排完課，noOpenPeriod 都會是 true）學生看到的「我的課表」：
// 每堂課一張卡片，可以請假或上課當天打卡。請假一定要經過老師安排新時間才算數（見
// app/api/students/lessons/[lessonId]/leave/route.ts 的註解），這裡只負責送出請求、不會自己改時間。
function MyScheduleView({ teacherName, studentName, ym, initialLessons, idToken }: {
  teacherName: string; studentName: string; ym: string; initialLessons: ScheduleLesson[]; idToken: string | null;
}) {
  const [lessons, setLessons] = useState(initialLessons);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingLeaveId, setPendingLeaveId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function requestLeave(l: ScheduleLesson) {
    setBusyId(l.id);
    try {
      const res = await fetch(`/api/students/lessons/${l.id}/leave`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || '請假失敗');
      setLessons(prev => prev.filter(x => x.id !== l.id));
      setNotice('已送出請假，老師會幫你安排新時間。');
    } catch (e) { setNotice((e as Error).message + '，請稍後再試。'); }
    finally { setBusyId(null); setPendingLeaveId(null); }
  }

  async function checkIn(l: ScheduleLesson) {
    setBusyId(l.id);
    try {
      const res = await fetch(`/api/students/lessons/${l.id}/check-in`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || '打卡失敗');
      setLessons(prev => prev.map(x => x.id === l.id ? { ...x, checkedInAt: new Date().toISOString() } : x));
      setNotice('已打卡！');
    } catch (e) { setNotice((e as Error).message + '，請稍後再試。'); }
    finally { setBusyId(null); }
  }

  return (<main>
    <h1>🌸 {+ym.slice(5)} 月我的課表</h1>
    <p className="sub">{studentName} 你好，這是你這個月的上課時間；請假會請老師幫你安排新時間，打卡要在上課當天才能按。</p>
    {notice && <p className="toast-overlay" role="status">{notice}</p>}
    {!lessons.length && <p className="sub">這個月目前沒有排定的課，請等老師通知。</p>}
    {lessons.map(l => {
      const isToday = l.date === today;
      return (
        <div className="card" key={l.id}>
          <b>{md(l.date)}（{weekdayLabel(l.date)}）{hhmm(l.start)}</b>
          <p className="m">授課老師：{l.teacherName || teacherName}{l.teacherName ? '（代課）' : ''}</p>
          {l.checkedInAt ? (
            <p className="m">✅ 已簽到</p>
          ) : (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn outline" disabled={busyId === l.id}
                onClick={() => pendingLeaveId === l.id ? requestLeave(l) : setPendingLeaveId(l.id)}>
                {pendingLeaveId === l.id ? '確定請假' : '請假'}
              </button>
              <button className="btn" disabled={busyId === l.id || !isToday} onClick={() => checkIn(l)}>打卡</button>
            </div>
          )}
        </div>
      );
    })}
  </main>);
}
