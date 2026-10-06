'use client';
import { useState } from 'react';
import { svgStringToPngBlob } from '@/lib/svgToPng';

// 能用手機的分享面板（可以直接選「儲存到照片」或分享到 LINE，拿到的是真的圖片不是連結）就優先用；
// 面板同時支援「圖片＋文字」一起分享，有帶 shareText 就盡量兩個一起送，對方收到的訊息會跟圖片一起出現。
// 不支援的瀏覽器（例如電腦）就退回成一般的檔案下載。
export default function SaveImageBtn({ buildSvg, filename, shareText, style }: { buildSvg: () => string; filename: string; shareText?: string; style?: React.CSSProperties }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  async function go() {
    setState('busy');
    try {
      const svg = buildSvg();
      const blob = await svgStringToPngBlob(svg);
      const file = new File([blob], filename, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
      const withText = shareText ? { files: [file], text: shareText } : { files: [file] };
      if (nav.canShare?.(withText) && nav.share) {
        await nav.share(withText);
      } else if (nav.canShare?.({ files: [file] }) && nav.share) {
        // 這台裝置的分享面板不支援圖片＋文字一起送，退回只送圖片（文字還是能用旁邊的「分享／複製文字」另外送）。
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
      {state === 'busy' ? '處理中…' : state === 'done' ? '已處理' : '分享圖片＋文字'}
    </button>
  );
}
