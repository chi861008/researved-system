'use client';

export interface SlotPreset { id: string; label: string; weekdays: number[]; starts: number[] }

/** 快速選取按鈕列：點一下幫你把下面日曆對應的星期、時間一次勾好，不是另一套系統——用的是同一份
 * value/onChange。手動調整過日曆後，activeId 要由外面清成 null，這裡不會自己判斷有沒有跟選項一致。 */
export default function PresetChips({ presets, activeId, onPick }: {
  presets: SlotPreset[]; activeId: string | null; onPick: (preset: SlotPreset) => void;
}) {
  return (
    <div className="chiprow">
      {presets.map(p => (
        <button type="button" key={p.id} className={`chip${activeId === p.id ? ' on' : ''}`} onClick={() => onPick(p)}>{p.label}</button>
      ))}
    </div>
  );
}
