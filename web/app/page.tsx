'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import CollapsibleSlotGrid from '@/components/CollapsibleSlotGrid';
import PresetChips from '@/components/PresetChips';
import { DEMO_PERIOD, slotBlocked, type DemoPeriod } from '@/lib/period';
import { getAllTeachers, seedTeacherAvailability, getMyJoin, joinAsStudent, getDemoStudentPattern, saveDemoStudentPattern, type DemoStudent } from '@/lib/teacherDemo';
import { analyzeWeeklyPattern, datesBetween, md, weekday } from '@/lib/scheduling';
import { applyPatternToBlankMonth, applyPresetToSelection, deriveWeeklyPattern, touchedWeekdays, type WeeklyPattern } from '@/lib/weeklyPattern';
import { STUDENT_PRESETS } from '@/lib/presets';
import { defaultCourseRuleLines } from '@/lib/courseDefaults';

// 台灣日期（UTC+8）
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// 畫面實際會用到的欄位：展示模式固定用 DEMO_PERIOD；真老師模式打 API 問這位老師目前開放選課的月份，
// 形狀一樣，剩下的畫面邏輯（月曆、isBlocked、送出）兩邊共用，不用另外分支。
type ActivePeriod = Pick<DemoPeriod, 'ym' | 'from' | 'to' | 'starts' | 'lessonMinutes' | 'weeklyBlocks'>;
// 真老師模式的學生記錄多帶一個「記住的常用時段」，展示模式永遠是 undefined，從 localStorage 另外查。
type JoinedStudent = DemoStudent & { weeklyPattern?: WeeklyPattern | null };

export default function Page() {
  // 用邀請連結帶的 ?t=teacherId 分辨「這是哪位老師的學生」：先查展示名單（完全不變），
  // 查不到才問 Supabase 是不是真正的老師——這樣真老師的連結才不會被誤判成「連結不完整」。
  const [ready, setReady] = useState(false);
  const [resolved, setResolved] = useState<{ id: string; name: string; isReal: boolean; courseName?: string; courseRules?: string } | null>(null);
  const [joined, setJoined] = useState<JoinedStudent | null>(null);
  const [realPeriod, setRealPeriod] = useState<ActivePeriod | null>(null);
  const [realTeacherAvailability, setRealTeacherAvailability] = useState<Set<string>>(new Set());
  const [noOpenPeriod, setNoOpenPeriod] = useState(false);
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
        setResolved({ id: demo.id, name: demo.name, isReal: false });
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

  useEffect(() => { // 在 LINE 內開啟時自動登入，取得學生身分
    if (!liffId) return;
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

  // 真老師模式：確認是真的老師之後，問她目前開放選課的是哪個月（同一時間最多一個月在收集中）。
  useEffect(() => {
    if (!resolved?.isReal) return;
    fetch(`/api/teachers/${resolved.id}/period`).then(r => r.json()).then(data => {
      if (data.noOpenPeriod) { setNoOpenPeriod(true); return; }
      setRealPeriod({ ym: data.ym, from: data.from, to: data.to, starts: data.starts, lessonMinutes: data.lessonMinutes, weeklyBlocks: data.weeklyBlocks });
      setRealTeacherAvailability(new Set<string>(data.teacherAvailability));
    }).catch(() => setNoOpenPeriod(true));
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
      // 展示模式沒有真的資料庫，「記住」要自己存進 localStorage；真老師模式由伺服器直接存進 students 表。
      if (j.demo && rememberPattern) saveDemoStudentPattern(resolved.id, joined.id, deriveWeeklyPattern(sel, dates, P.starts));
      setStatus({ t: 'ok', m: j.demo ? '展示模式：已模擬送出（尚未寫入資料庫）。' : '已送出！排好後會用 LINE 個別通知你上課日期、時間及授課老師。' });
      setLocked(true);
    } catch (e) { setStatus({ t: 'err', m: (e as Error).message + '，請稍後再試。' }); }
  }

  const needLogin = !!liffId && !idToken;

  if (!ready) return <main />;

  if (!resolved) {
    return (<main>
      <h1>這個連結不完整</h1>
      <p className="sub">請跟老師要正確的選課連結。直接打開網站首頁沒辦法知道你是哪位老師的學生，老師的連結後面應該會多一段「?t=」加一串代碼。</p>
    </main>);
  }

  if (!joined) {
    return resolved.isReal
      ? <RealJoinView teacherId={resolved.id} teacherName={resolved.name} courseName={courseName} idToken={idToken} needLogin={needLogin} onJoined={setJoined} />
      : <JoinView teacherId={resolved.id} teacherName={resolved.name} onJoined={setJoined} />;
  }

  if (resolved.isReal && noOpenPeriod) {
    return (<main>
      <h1>🌸 {teacherName} 的{courseName}課程</h1>
      <p className="sub">{joined.name} 你好，目前沒有開放選課，請等老師通知開放時間。</p>
    </main>);
  }
  if (!P) return <main />; // 真老師模式：還在讀取這個月的設定

  return (<main>
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

    {locked && (
      <p className="toast" role="status">
        ✅ 已送出，上面的選擇先保留不會變動。要修改的話請先按「編輯」。
      </p>
    )}

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
        <div className="remember-row">
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
        {status.m && <p className={'msg' + (status.t === 'err' ? ' err' : '')} role="status">{status.m}</p>}
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
