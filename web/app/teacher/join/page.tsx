'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { joinAsTeacher } from '@/lib/teacherDemo';

export default function JoinTeacherPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const nm = name.trim();
    if (!nm) { setError('請輸入你的名字'); return; }
    joinAsTeacher(nm);
    router.push('/teacher');
  }

  return (<main>
    <h1>🌸 加入皮拉提斯排課系統</h1>
    <p className="sub">第一次使用，請輸入你的名字。系統會幫你建立全新、獨立的學生名單、上班時間和課表，跟其他老師互不干擾，也看不到彼此的資料。</p>
    <div className="card">
      <label className="m" htmlFor="tn">你的名字</label><br />
      <input id="tn" className="tin" placeholder="例如：陳老師" value={name}
        onChange={e => { setName(e.target.value); setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
    <div className="bar"><div>
      <button className="send" onClick={submit}>開始使用</button>
    </div></div>
  </main>);
}
