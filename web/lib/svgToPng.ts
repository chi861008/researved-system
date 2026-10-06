/** 把一段 <svg>...</svg> 字串畫到 canvas 上，轉成 PNG 檔案（2 倍解析度，手機存檔或分享都清楚）。 */
export function svgStringToPngBlob(svgString: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 940, h = img.naturalHeight || 500;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) { reject(new Error('無法建立畫布')); return; }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('轉成圖片失敗')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('圖片載入失敗')); };
    img.src = url;
  });
}
