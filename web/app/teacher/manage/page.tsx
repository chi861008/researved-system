'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAllTeachers, getMyTeacherId, MAIN_TEACHER_ID, getDemoTeacherSettings, saveDemoTeacherSettings } from '@/lib/teacherDemo';
import { defaultCourseRuleLines } from '@/lib/courseDefaults';

export default function ManageTeachersPage() {
  const [notice, setNotice] = useState('');
  // 有沒有用真的 LINE 登入，決定下面幾張設定卡片存進哪裡（Supabase 或 localStorage）、
  // 以及「邀請學生連結／邀請新老師／登出」這幾張只有真老師才有意義的卡片要不要顯示。
  const [realSession, setRealSession] = useState<{ id: string; name: string } | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [courseNameInput, setCourseNameInput] = useState('');
  const [savingCourseName, setSavingCourseName] = useState(false);
  const [courseRulesInput, setCourseRulesInput] = useState('');
  const [savingCourseRules, setSavingCourseRules] = useState(false);
  const [hoursPrefixInput, setHoursPrefixInput] = useState('');
  const [hoursSuffixInput, setHoursSuffixInput] = useState('');
  const [savingHoursTemplate, setSavingHoursTemplate] = useState(false);
  // 還不知道是不是真老師之前先不要畫面板，不然會先閃一下展示模式的空白輸入框才跳到真老師填好的值，
  // 跟 /teacher 那邊是同一個問題、同一個修法。
  const [authChecked, setAuthChecked] = useState(false);
  // 展示模式：這些設定是「哪一位老師」的——預設最早建立的那位，除非這台瀏覽器之前自己加入過另一位。
  const [demoTeacherId, setDemoTeacherId] = useState(MAIN_TEACHER_ID);

  useEffect(() => {
    const allTeachers = getAllTeachers();
    (async () => {
      // 一支 /api/teacher/state 就同時拿到 id/name 跟課程名稱／規則／通知文字設定，不用先問
      // session 再問 state 兩趟，縮短「展示模式畫面」閃現的時間。
      const res = await fetch('/api/teacher/state').catch(() => null);
      if (res?.ok) {
        const data = await res.json().catch(() => null) as { id: string; name: string; courseName?: string; courseRules?: string; hoursPrefix?: string; hoursSuffix?: string } | null;
        if (data) {
          setRealSession({ id: data.id, name: data.name });
          setNameInput(data.name || '');
          setCourseNameInput(data.courseName || '');
          setCourseRulesInput(data.courseRules || '');
          setHoursPrefixInput(data.hoursPrefix || '');
          setHoursSuffixInput(data.hoursSuffix || '');
        }
      } else {
        // 展示模式：這些設定存在 localStorage，不用問資料庫——套用目前這台瀏覽器對應的老師身份。
        const mine = getMyTeacherId();
        const tid = mine && allTeachers.some(t => t.id === mine) ? mine : MAIN_TEACHER_ID;
        setDemoTeacherId(tid);
        const s = getDemoTeacherSettings(tid);
        setNameInput(s.name || allTeachers.find(t => t.id === tid)?.name || '');
        setCourseNameInput(s.courseName || '');
        setCourseRulesInput(s.courseRules || '');
        setHoursPrefixInput(s.hoursPrefix || '');
        setHoursSuffixInput(s.hoursSuffix || '');
      }
      setAuthChecked(true);
    })();
  }, []);

  async function saveName() {
    const nm = nameInput.trim();
    if (!nm) { setNotice('請輸入名字。'); return; }
    setSavingName(true);
    try {
      if (realSession) {
        const res = await fetch('/api/teacher/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setNotice(data?.error || '儲存失敗，請稍後再試。'); return; }
        setRealSession(prev => prev ? { ...prev, name: nm } : prev);
      } else {
        saveDemoTeacherSettings(demoTeacherId, { name: nm });
      }
      setNotice(`名字已更新為「${nm}」。`);
    } finally { setSavingName(false); }
  }

  async function saveCourseName() {
    const nm = courseNameInput.trim();
    if (!nm) { setNotice('請輸入課程名稱。'); return; }
    setSavingCourseName(true);
    try {
      if (realSession) {
        const res = await fetch('/api/teacher/course-name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseName: nm }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setNotice(data?.error || '儲存失敗，請稍後再試。'); return; }
      } else {
        saveDemoTeacherSettings(demoTeacherId, { courseName: nm });
      }
      setNotice(`課程名稱已更新為「${nm}」。`);
    } finally { setSavingCourseName(false); }
  }

  async function saveCourseRules() {
    setSavingCourseRules(true);
    try {
      if (realSession) {
        const res = await fetch('/api/teacher/course-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRules: courseRulesInput }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setNotice(data?.error || '儲存失敗，請稍後再試。'); return; }
      } else {
        saveDemoTeacherSettings(demoTeacherId, { courseRules: courseRulesInput.trim() });
      }
      setNotice(courseRulesInput.trim() ? '選課規則與時間說明已更新。' : '已清空，學生端會改回預設說明文字。');
    } finally { setSavingCourseRules(false); }
  }

  async function saveHoursTemplate() {
    setSavingHoursTemplate(true);
    try {
      if (realSession) {
        const res = await fetch('/api/teacher/hours-template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: hoursPrefixInput, suffix: hoursSuffixInput }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setNotice(data?.error || '儲存失敗，請稍後再試。'); return; }
      } else {
        saveDemoTeacherSettings(demoTeacherId, { hoursPrefix: hoursPrefixInput.trim(), hoursSuffix: hoursSuffixInput.trim() });
      }
      setNotice('上班時段通知文字的開頭／結尾已更新。');
    } finally { setSavingHoursTemplate(false); }
  }

  if (!authChecked) return <main />;

  return (<main style={{ paddingBottom: 100 }}>
    <h1>管理老師</h1>
    {notice && <p className="toast" role="status">{notice}</p>}

    {!realSession && (<>
      <p className="hint">目前是展示模式，下面的設定存在這台瀏覽器裡，不會真的送進資料庫；正式老師請改用 LINE 登入。</p>
      <a className="btn outline" href="/api/auth/line/login" style={{ width: '100%', marginBottom: 16 }}>用 LINE 登入</a>
    </>)}

    <div className="card">
      <b>我的名字</b>
      <div className="rng">
        <input className="tin" placeholder="例如：Joanna" value={nameInput}
          onChange={e => { setNameInput(e.target.value); setNotice(''); }}
          onKeyDown={e => { if (e.key === 'Enter') saveName(); }} />
        <button className="btn" style={{ flex: '0 0 auto', padding: '0 18px' }} disabled={savingName} onClick={saveName}>{savingName ? '儲存中…' : '儲存'}</button>
      </div>
    </div>

    <div className="card">
      <b>課程名稱</b>
      <div className="rng">
        <input className="tin" placeholder="例如：皮拉提斯" value={courseNameInput}
          onChange={e => { setCourseNameInput(e.target.value); setNotice(''); }}
          onKeyDown={e => { if (e.key === 'Enter') saveCourseName(); }} />
        <button className="btn" style={{ flex: '0 0 auto', padding: '0 18px' }} disabled={savingCourseName} onClick={saveCourseName}>{savingCourseName ? '儲存中…' : '儲存'}</button>
      </div>
    </div>

    <div className="card">
      <b>選課規則與時間說明</b>
      <p className="hint">學生端「選課規則與時間說明」裡的內容，整段自己寫，留空就會用預設的四條規則。</p>
      <textarea className="tin" style={{ minHeight: 100, padding: 8 }}
        placeholder={defaultCourseRuleLines(realSession?.name || nameInput || '老師').map(l => `• ${l}`).join('\n')}
        value={courseRulesInput}
        onChange={e => { setCourseRulesInput(e.target.value); setNotice(''); }} />
      <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={savingCourseRules} onClick={saveCourseRules}>{savingCourseRules ? '儲存中…' : '儲存'}</button>
    </div>

    <div className="card">
      <b>上班時段通知文字</b>
      <p className="hint">中間實際上班時間、固定會議時間、邀請連結是自動算出來的，不能改；這裡只能加開頭的問候語、結尾的補充說明，留空就不會加。</p>
      <p className="m" style={{ marginBottom: 2 }}>開頭</p>
      <textarea className="tin" style={{ minHeight: 60, padding: 8 }} placeholder="例如：各位同學好 🌸"
        value={hoursPrefixInput}
        onChange={e => { setHoursPrefixInput(e.target.value); setNotice(''); }} />
      <p className="m" style={{ margin: '8px 0 2px' }}>結尾</p>
      <textarea className="tin" style={{ minHeight: 60, padding: 8 }} placeholder="例如：有問題歡迎直接回覆我"
        value={hoursSuffixInput}
        onChange={e => { setHoursSuffixInput(e.target.value); setNotice(''); }} />
      <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={savingHoursTemplate} onClick={saveHoursTemplate}>{savingHoursTemplate ? '儲存中…' : '儲存'}</button>
    </div>

    {/* 「邀請學生的專屬連結」拿掉了：連結現在一定要帶月份（?ym=）才有意義，這頁不知道「現在是哪個
        月」（那是 /teacher 主頁 curYm 的狀態），而且同時可能有好幾個月都在收集中，沒有唯一一個「現在
        這個」可以代表。邀請連結維持現在真正在用的管道：老師頁「上班時段」卡片裡的訊息文字，本來就
        帶正確月份的連結。 */}
    {/* 「邀請新老師」也拿掉：這個連結點了只是去登入頁，沒有白名單的 LINE 帳號登入會直接被擋下，
        連結本身不會自動幫對方開通——新增老師目前還是要先拿到對方的 LINE 代碼，手動加進 teachers 表。 */}
    {realSession && (
      <a className="btn outline" href="/api/auth/line/logout" style={{ width: '100%' }}>登出</a>
    )}

    {/* ---- 底部分頁列，跟老師頁共用同一個樣式，直接切換不用先按返回 ---- */}
    <div className="bar" style={{ padding: '0 0 env(safe-area-inset-bottom,0px)' }}>
      <div className="tabs" role="tablist">
        <Link href="/teacher" role="tab">上班時間</Link>
        <Link href="/teacher" role="tab">自動排課</Link>
        <Link href="/teacher/manage" role="tab" aria-selected="true">老師管理</Link>
      </div>
    </div>
  </main>);
}
