# LINE 後台設定步驟

> 金鑰（Channel secret、Channel access token）只放環境變數，不貼進對話、不提交 git。

1. **官方帳號**（已完成）：tw.linebiz.com 建立，輕用量方案免費、每月 200 則。
2. **啟用 Messaging API**：官方帳號後台 → 設定 → Messaging API → 啟用，建立 Provider（例：Joanna-Pilates）。
3. **允許加入群組**：官方帳號後台「帳號設定」→「功能切換」→「接受邀請加入群組或多人聊天室」（名稱可能略異；LINE Developers 的 Messaging API 設定頁也有對應開關；預設關閉）。
4. **LINE Login 頻道**：developers.line.biz → 同一個 Provider → Create a new channel → LINE Login → Web app。須與 Messaging API 在**同一個 Provider**，userId 才能互通。
5. **LIFF**：LINE Login 頻道 → LIFF → Add：Size Full、Scopes 勾 profile／openid、Endpoint URL 先填暫時網址（之後換成正式網址）。取得 LIFF ID。
6. **連結官方帳號**：LINE Login 頻道裡連結官方帳號（Linked LINE Official Account），並可開啟加好友提示。
7. **測試**：把 LIFF ID 填進 `liff-test/index.html`，部署到任何 https 靜態空間（例如 Netlify Drop），回 LIFF 設定換 Endpoint URL；在 LINE 開 `https://liff.line.me/<LIFF ID>`，看到名稱即成功。
8. **發布**：LINE Login 頻道預設 Developing（只有管理者能用），給學生用前改為 Published。
9. **Webhook**：Messaging API 設定填 Webhook URL（正式後端部署後），開啟 Use webhook；取得 Channel access token（長期）放環境變數。
10. **群組測試**：開測試群組，邀請官方帳號，確認收到 `join` 事件並可發訊息到該群組。

注意：一個群組同時只能有一個官方帳號；官方帳號在群組會收到群組內所有訊息，程式只處理排課相關、不儲存一般聊天內容。
