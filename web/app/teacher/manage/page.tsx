'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import CopyBtn from '@/components/CopyBtn';
import { getAllTeachers, addTeacher, deleteTeacher, MAIN_TEACHER_ID, type DemoTeacher } from '@/lib/teacherDemo';

const STUDENT_LIFF_BASE = process.env.NEXT_PUBLIC_LIFF_ID ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}` : '';

export default function ManageTeachersPage() {
  const [teachers, setTeachers] = useState<DemoTeacher[]>([]);
  const [newName, setNewName] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [origin, setOrigin] = useState('');
  // 真的用 LINE 登入的老師，看到的不該是展示模式這整套「自己加入／互相刪除」的名單——
  // 那是給示範登入測試用的。真正的老師帳號由管理者在 Supabase 的 teachers 表維護。
  const [realSession, setRealSession] = useState<{ id: string; name: string } | null>(null);
  const [courseNameInput, setCourseNameInput] = useState('');
  const [savingCourseName, setSavingCourseName] = useState(false);
  const [courseRulesInput, setCourseRulesInput] = useState('');
  const [savingCourseRules, setSavingCourseRules] = useState(false);
  const [hoursPrefixInput, setHoursPrefixInput] = useState('');
  const [hoursSuffixInput, setHoursSuffixInput] = useState('');
  const [savingHoursTemplate, setSavingHoursTemplate] = useState(false);
  // 還不知道是不是真老師之前先不要畫面板，不然會先閃一下展示模式的「老師名單」才跳到真老師的設定頁，
  // 跟 /teacher 那邊是同一個問題、同一個修法。
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    setTeachers(getAllTeachers());
    setOrigin(window.location.origin);
    (async () => {
      // 一支 /api/teacher/state 就同時拿到 id/name 跟課程名稱／規則／通知文字設定，不用先問
      // session 再問 state 兩趟，縮短「展示模式畫面」閃現的時間。
      const res = await fetch('/api/teacher/state').catch(() => null);
      if (res?.ok) {
        const data = await res.json().catch(() => null) as { id: string; name: string; courseName?: string; courseRules?: string; hoursPrefix?: string; hoursSuffix?: string } | null;
        if (data) {
          setRealSession({ id: data.id, name: data.name });
          setCourseNameInput(data.courseName || '');
          setCourseRulesInput(data.courseRules || '');
          setHoursPrefixInput(data.hoursPrefix || '');
          setHoursSuffixInput(data.hoursSuffix || '');
        }
      }
      setAuthChecked(true);
    })();
  }, []);

  async function saveCourseName() {
    const nm = courseNameInput.trim();
    if (!nm) { setNotice('請輸入課程名稱。'); return; }
    setSavingCourseName(true);
    try {
      const res = await fetch('/api/teacher/course-name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseName: nm }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data?.error || '儲存失敗，請稍後再試。'); return; }
      setNotice(`課程名稱已更新為「${nm}」。`);
    } finally { setSavingCourseName(false); }
  }

  async function saveCourseRules() {
    setSavingCourseRules(true);
    try {
      const res = await fetch('/api/teacher/course-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRules: courseRulesInput }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data?.error || '儲存失敗，請稍後再試。'); return; }
      setNotice(courseRulesInput.trim() ? '選課規則與時間說明已更新。' : '已清空，學生端會改回預設說明文字。');
    } finally { setSavingCourseRules(false); }
  }

  async function saveHoursTemplate() {
    setSavingHoursTemplate(true);
    try {
      const res = await fetch('/api/teacher/hours-template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: hoursPrefixInput, suffix: hoursSuffixInput }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(data?.error || '儲存失敗，請稍後再試。'); return; }
      setNotice('上班時段通知文字的開頭／結尾已更新。');
    } finally { setSavingHoursTemplate(false); }
  }

  function handleAdd() {
    const nm = newName.trim();
    if (!nm) { setNotice('請輸入老師名稱。'); return; }
    if (teachers.some(t => t.name === nm)) { setNotice(`${nm} 已經在老師名單裡。`); return; }
    const t = addTeacher(nm);
    setTeachers(prev => [...prev, t]);
    setNewName('');
    setNotice(`已新增老師 ${nm}。回老師頁的「示範登入」就會看到她。`);
  }

  function handleDelete(id: string, name: string) {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      setNotice(`確定要刪除 ${name} 嗎？她名下的學生、上班時間、課表都會一併移除、無法復原。再按一次「確認刪除」才會真的刪除。`);
      return;
    }
    deleteTeacher(id);
    setTeachers(prev => prev.filter(t => t.id !== id));
    setPendingDeleteId(null);
    setNotice(`已刪除 ${name}。`);
  }

  const joinLink = origin ? `${origin}/teacher/join` : '';
  const studentInviteLink = realSession
    ? (STUDENT_LIFF_BASE ? `${STUDENT_LIFF_BASE}?t=${realSession.id}` : (origin ? `${origin}/?t=${realSession.id}` : ''))
    : '';

  if (!authChecked) return <main />;

  return (<main style={{ paddingBottom: 100 }}>
    <h1>管理老師</h1>
    {notice && <p className="toast" role="status">{notice}</p>}

    {realSession ? (<>
      <p className="m" style={{ margin: 0 }}>登入中：{realSession.name}</p>
      <p className="hint">你是用 LINE 登入的正式老師帳號，只會看到自己的資料，不會看到其他老師。</p>

      <div className="card">
        <b>課程名稱</b>
        <p className="hint">會用在學生看到的文字裡，例如「OOO 的 ＯＯ課程」「X 月 ＯＯ選課開始囉」，預設是「皮拉提斯」。</p>
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
        <textarea className="tin" style={{ minHeight: 100, padding: 8 }} placeholder="留空＝使用預設說明文字"
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

      <div className="card">
        <b>邀請學生的專屬連結</b>
        <p className="hint">把這個連結傳給你的學生，他們點進來第一次會先填名字加入——只會加進你的名單，不會跟其他老師的學生混在一起。</p>
        {studentInviteLink ? <div className="msg">{studentInviteLink}</div> : <p className="m">網址準備中…</p>}
        {studentInviteLink && <CopyBtn text={studentInviteLink} />}
      </div>

      <div className="card">
        <b>邀請新老師</b>
        <p className="hint">把這個連結傳給新老師，她打開後點「用 LINE 登入」；登入後畫面會顯示一組代碼，請她把代碼給你，你再到後台的老師名單幫她加一筆，她之後就能用自己的 LINE 帳號登入、只看到自己的資料。</p>
        {origin ? <div className="msg">{`${origin}/teacher`}</div> : <p className="m">網址準備中…</p>}
        {origin && <CopyBtn text={`${origin}/teacher`} />}
      </div>

      <a className="btn outline" href="/api/auth/line/logout" style={{ width: '100%' }}>登出</a>
    </>) : (<>
      <p className="hint">新老師不用等別人加，自己點下面的連結、填名字就能加入並建立自己的資料；這頁主要是給你看目前有誰、或要移除不用了的老師。這套是展示模式用的，正式老師請改用 LINE 登入。</p>

      <div className="card">
        <b>給新老師的加入連結</b>
        <p className="hint">傳給新同事，她自己點連結、填名字，就會建立專屬自己的學生名單、上班時間和課表。</p>
        {joinLink ? <div className="msg">{joinLink}</div> : <p className="m">網址準備中…</p>}
        {joinLink && <CopyBtn text={joinLink} />}
      </div>

      <div className="card">
        <b>老師名單</b>
        {teachers.map(t => (
          <div className="li" key={t.id}>
            <span>{t.name}{t.id === MAIN_TEACHER_ID && <span className="pillt" style={{ marginLeft: 6 }}>最早建立</span>}</span>
            {t.id !== MAIN_TEACHER_ID && (
              <button onClick={() => handleDelete(t.id, t.name)}>{pendingDeleteId === t.id ? '確認刪除' : '刪除'}</button>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <b>手動新增老師</b>
        <p className="hint">如果不方便讓對方自己填，也可以在這裡直接幫她建立。</p>
        <div className="rng">
          <input className="tin" placeholder="老師名稱" value={newName}
            onChange={e => { setNewName(e.target.value); setNotice(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} />
          <button className="btn" style={{ flex: '0 0 auto', padding: '0 18px' }} onClick={handleAdd}>新增</button>
        </div>
      </div>
    </>)}

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
