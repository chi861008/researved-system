'use client';
import { useState } from 'react';

// 能在 LINE 裡用「分享」挑群組／朋友送出時優先用（不占用官方帳號的則數），不行就自動退回複製文字。
export default function CopyBtn({ text, style }: { text: string; style?: React.CSSProperties }) {
  const [state, setState] = useState<'idle' | 'copied' | 'shared'>('idle');
  async function go() {
    const liffId = process.env.NEXT_PUBLIC_TEACHER_LIFF_ID;
    if (liffId) {
      try {
        const liff = (await import('@line/liff')).default;
        if (liff.isInClient() && liff.isApiAvailable('shareTargetPicker')) {
          const res = await liff.shareTargetPicker([{ type: 'text', text }]);
          if (res) { setState('shared'); setTimeout(() => setState('idle'), 1500); return; }
        }
      } catch { /* 不支援或使用者取消，退回複製 */ }
    }
    navigator.clipboard?.writeText(text).then(() => { setState('copied'); setTimeout(() => setState('idle'), 1500); }).catch(() => {});
  }
  return (
    <button className="btn" style={{ marginTop: 6, ...style }} onClick={go}>
      {state === 'shared' ? '已送出分享' : state === 'copied' ? '已複製' : '分享／複製文字'}
    </button>
  );
}
