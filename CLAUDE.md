# 皮拉提斯排課工具（給 Claude Code 讀的專案說明）

先讀 `docs/HANDOFF.md`（進度與待辦）和 `docs/SPEC.md`（產品規格與已確認的決定）。

## 專案是什麼
皮拉提斯老師 Joanna（與同事 Coco 共用一間工作室）每月請學生在 LINE 裡填可上課時間，系統排課後個別／在群組通知學生。
一對一課、每堂 60 分鐘、原則上每週一堂。目標是長期每月循環使用，目前人數很少（示範資料 5 位學生）。

## 目錄
- `prototype/scheduler-grid-preview.html`：**最新、最完整的互動原型（單一 HTML）**。UI 與流程以它為準。資料只在記憶體，重新整理會還原。
- `prototype/archive/`：較早的原型，僅供參考。
- `engine/`：早期 TypeScript 排課引擎與測試（規則與原型有出入，見 HANDOFF「已知差異」）。
- `web/`：早期 Next.js 骨架（LIFF 學生頁 + 驗證 LIFF ID Token 的 API），**已落後於原型**，重做時可參考 API 驗證寫法。
- `db/schema.v2.sql`：目前建議的資料庫結構（單一工作室＋群組綁定）；`schema.v1-multitenant.sql` 已作廢。
- `liff-test/index.html`：最小 LIFF 連線測試頁。
- `tests/preview-e2e/`：用 jsdom 對原型做的端對端測試（`npm i && npm test`）。

## 工作原則
- 回覆與介面文字一律使用**繁體中文（台灣）**；語氣親切，可用 🌸⭐️🫶🏻 等符號（延續老師原本訊息風格）。
- **手機優先**：按鈕至少 44px、輸入欄位 16px 字級、考慮安全區域（safe-area）。
- 不要把 Channel secret、Channel access token、Supabase service role key 寫進程式或提交到 git，只放環境變數；金鑰不要貼進對話。
- 使用者不是工程師：做完請用白話說明改了什麼、怎麼測試、有哪些限制；不確定的地方要明說，不要假裝測試過。
- 改動原型後，跑 `tests/preview-e2e` 確認沒有壞掉。
- 不要擅自加入使用者已明確拿掉的功能（見 SPEC「已拿掉／不要做」）。

## 建議的第一件事
看 `docs/HANDOFF.md` 的「下一步」，從第 1 項開始，並一步一步帶使用者操作 LINE 後台（使用者看不懂程式，會用截圖回報）。
