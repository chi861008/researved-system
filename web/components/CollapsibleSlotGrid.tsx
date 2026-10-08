'use client';
import { useState } from 'react';
import SlotGrid, { type SlotGridProps } from './SlotGrid';

export interface CollapsibleSlotGridProps extends SlotGridProps {
  /** 卡片標題，例如「你的時段」「上班時段」 */
  label: string;
  /** 收起時顯示的文字摘要（已選時段的白話說明，或「還沒有選任何時段」之類的提示） */
  summaryText: string;
  defaultExpanded?: boolean;
  /** 唯讀模式下額外顯示的「解鎖編輯」按鈕（例如學生送出後要改，要先點這個才能再點格子） */
  onUnlock?: () => void;
  unlockLabel?: string;
  /** 編輯頁裡、月曆上方的額外內容（例如學生端的「快速選取」預設按鈕） */
  headerExtra?: React.ReactNode;
  /** 編輯頁裡、月曆下方＋確認按鈕上方的額外內容（例如老師端的「快速排休」「固定會議時間」） */
  footerExtra?: React.ReactNode;
  /** 下方主按鈕文字，預設「確認」 */
  confirmLabel?: string;
  /** 按下主按鈕時，收合之前先執行（例如老師端順便把這個月標記成開放選課）；可以是 async，
   * 這段還在跑的時候按鈕會顯示「處理中」並停用，跑完才收合，避免真老師模式打資料庫的空檔
   * 看起來像沒反應。 */
  /** 回傳 false 代表儲存失敗，編輯畫面會保持開啟。 */
  onConfirm?: () => void | boolean | Promise<void | boolean>;
  /** 收起時「編輯時段」下面另外一整排的額外按鈕（例如老師端的「分享／複製文字」＋「分享圖片＋文字」），
   * 跟「編輯時段」分開一列，視覺上是另一組動作；不用就不會多這一排。 */
  collapsedActions?: React.ReactNode;
}

// 一開始只顯示文字摘要，不會看到月曆；要調整才點「編輯」，用滿版頁面打開（不是半版彈窗），
// 按上面「‹ 返回」或下面「確認」都會收起、回到文字摘要。
export default function CollapsibleSlotGrid({
  label, summaryText, defaultExpanded, onUnlock, unlockLabel, headerExtra, footerExtra, confirmLabel, onConfirm, collapsedActions, ...gridProps
}: CollapsibleSlotGridProps) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const [confirming, setConfirming] = useState(false);

  async function saveAndClose() {
    if (confirming) return;
    if (!onConfirm) { setExpanded(false); return; }
    setConfirming(true);
    try {
      const ok = await onConfirm();
      if (ok !== false) setExpanded(false);
    } finally {
      setConfirming(false);
    }
  }

  return (<>
    <div className="card">
      <b>{label}</b>
      <div className="m" style={{ margin: '4px 0 10px', whiteSpace: 'pre-wrap' }}>{summaryText}</div>
      <div className="row">
        <button className="btn outline" style={{ width: '100%' }} onClick={() => setExpanded(true)}>
          {gridProps.readOnly ? '已送出／編輯時段' : '編輯時段'}
        </button>
      </div>
      {collapsedActions && <div className="row" style={{ marginTop: 8 }}>{collapsedActions}</div>}
    </div>

    {expanded && (
      <div className="fullsheet" role="dialog" aria-label={label}>
        <div className="fs-head">
          <button type="button" className="back" aria-label={onConfirm ? '返回並儲存' : '返回'} disabled={confirming} onClick={saveAndClose}>‹</button>
          <b>{label}</b>
        </div>
        <div className="fs-body">
          {headerExtra}
          <SlotGrid {...gridProps} />
          {footerExtra}
        </div>
        <div className="fs-foot">
          {onUnlock && (
            <button className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={onUnlock}>{unlockLabel ?? '編輯我的選擇'}</button>
          )}
          <button className="btn pri" style={{ width: '100%' }} disabled={confirming} onClick={saveAndClose}>
            {confirming ? '儲存中…' : (confirmLabel ?? '確認')}
          </button>
        </div>
      </div>
    )}
  </>);
}
