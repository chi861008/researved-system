'use client';

export interface SlotPreset { id: string; label: string; weekdays: number[]; starts: number[] }

/** 快速選取按鈕列：點一下幫你把下面日曆對應的星期、時間一次勾好，不是另一套系統——用的是同一份
 * value/onChange。星期幾不重疊的按鈕（例如平日晚上、週末全天）可以同時選取；星期幾有重疊的
 * （例如兩種不同的平日晚上時段）點了新的會自動取消舊的，因為本來就不能同時套用兩種時間在同一天。
 * 再點一次已經選取的按鈕＝取消這個按鈕套用的時段。手動調整過日曆後，activeIds 要由外面清空，
 * 這裡不會自己判斷有沒有跟選項一致。 */
export default function PresetChips({ presets, activeIds, onToggle }: {
  presets: SlotPreset[]; activeIds: Set<string>; onToggle: (preset: SlotPreset) => void;
}) {
  return (
    <div className="chiprow">
      {presets.map(p => (
        <button type="button" key={p.id} className={`chip${activeIds.has(p.id) ? ' on' : ''}`} onClick={() => onToggle(p)}>{p.label}</button>
      ))}
    </div>
  );
}
