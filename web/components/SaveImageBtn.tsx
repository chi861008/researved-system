'use client';
import { useState } from 'react';
import { svgStringToPngBlob } from '@/lib/svgToPng';

// 能用手機的分享面板（可以直接選「儲存到照片」或分享到 LINE，拿到的是真的圖片不是連結）就優先用；
// 不支援的瀏覽器（例如電腦）就退回成一般的檔案下載。
export default function SaveImageBtn({ buildSvg, filename, style }: { buildSvg: () => string; filename: string; style?: React.CSSProperties }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  async function go() {
    setState('busy');
    try {
      const svg = buildSvg();
      const blob = await svgStringToPngBlob(svg);
      const file = new File([blob], filename, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      setState('done'); setTimeout(() => setState('idle'), 1500);
    } catch { setState('idle'); /* 使用者自己取消分享面板也會到這裡，不用特別顯示錯誤 */ }
  }

  return (
    <button className="btn" style={style} disabled={state === 'busy'} onClick={go}>
      {state === 'busy' ? '處理中…' : state === 'done' ? '已處理' : '儲存圖片'}
    </button>
  );
}
