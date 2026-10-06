# 皮拉提斯排課工具 — 交接包

這是在 Claude 網頁版對話中完成的原型與規劃，打包後可在本機繼續（例如用 Claude Code）。

## 怎麼在地端繼續
1. 解壓縮，開終端機進入這個資料夾。
2. 啟動 Claude Code：`claude`
3. 第一句話可以這樣說：
   > 請先讀 CLAUDE.md、docs/HANDOFF.md、docs/SPEC.md，然後從 HANDOFF 的「下一步」第 1 項開始帶我做。
4. 想先看原型長怎樣：用瀏覽器直接打開 `prototype/scheduler-grid-preview.html`（建議用手機尺寸視窗）。
5. 跑原型的測試：`cd tests/preview-e2e && npm install && npm test`

## 文件
- `docs/HANDOFF.md`：目前進度、決定過程、已知問題、下一步
- `docs/SPEC.md`：產品規格（學生端、老師端、排課規則、通知、每月循環）
- `docs/LINE-SETUP.md`：LINE 後台設定步驟
