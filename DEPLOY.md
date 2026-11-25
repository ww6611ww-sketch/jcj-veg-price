# 部署與端到端驗證（GitHub Actions；GitHub Pages 需另行開啟）

## 資料怎麼流

```
官方網址 ──(Actions：更新行情)──> backend/data/official/records.json（存回 repo，保留近 60 天）
                                        ├─> backend/data/official/status.json  各來源手動匯入／每日抓取狀態
                                        ├─> backend/data/official/last-run.json 本次每個來源的 HTTP、筆數、判定
                                        ├─> backend/data/official/sample.json   一筆原始報價 ↔ App 資料對照
                                        ├─> app/www/data/official.json         App／網頁讀的正式資料
                                        └─> Actions artifact raw-<run id>      本次原始檔（保存 90 天）
app/www ──(Actions：部署網頁；預設關閉，設 ENABLE_PAGES=true 才執行)──> GitHub Pages：https://<帳號>.github.io/<repo>/
```

- **抓取失敗：** 失敗的來源不改動 records.json，其他來源照常更新，失敗原因寫在 status.json 與執行摘要。
- **同一份資料重跑：** 不會新增，判定為「抓取成功，來源沒有新資料」。
- **觸發方式：** schedule（排程）或 workflow_dispatch（手動），寫進 status.json 和 last-run.json，排程與手動分開可查。
- **驗證步驟：** 部署後自動讀 Pages 上的 official.json，確認與 repo 輸出一致，並用 sample.json 對照一筆原始報價與網頁上的價格，不一致時讓 Actions 失敗。

## 三種「網頁」怎麼拿到更新

| 網頁 | 讀資料的方式 | 會不會自動更新 |
|---|---|---|
| GitHub Pages（建議手機驗收用） | 同網址的 `data/official.json`，每次執行都重新部署 | 會，每次排程或手動執行後自動更新 |
| Android／iPhone App | 開啟時先讀 `config.js` 指定的 Pages 網址（建置 APK 時自動填入），連不到才用 App 內附資料 | 會 |
| claude.ai 上的「今日菜價 v0.1 預覽」 | 發布時打包的固定檔案；頁面規定不能讀外部網站，所以讀不到 GitHub 資料 | 不會，需要由我重新發布 |

## 你需要做的設定

1. **連結 GitHub 帳號：** 在 claude.ai 的設定 → 連接器（Connectors）連結 GitHub 帳號。若 jcj-veg-price 是私有 repo，還要在 GitHub 允許 Claude GitHub App 存取它。完成後告訴我 repo 的完整名稱（`帳號/jcj-veg-price`）。
2. **不用改 repo 的工作流程權限：** 維持預設。三個 workflow 的頂層都是 `permissions: {}`，只有以下工作在 YAML 中單獨宣告權限：
   - 「更新行情」的 update 工作：`contents: write`（把資料推回 repo）。
   - 「部署網頁」的 deploy 工作：`pages: write`、`id-token: write`。
   - 例外：如果組織政策限制了工作流程可取得的最高權限，需由管理員放寬。
3. **Pages 等你決定公開範圍再開：** 開啟時：
   - Settings → Pages → Source 選 GitHub Actions。
   - Settings → Secrets and variables → Actions → Variables 新增 `ENABLE_PAGES` = `true`。
   - 免費方案的私有 repo 不能用 Pages。

## 推送前檢查（已完成）

- **金鑰與憑證：** 沒有金鑰、權杖、簽署憑證、`.env`、`google-services.json` 等檔案。
- **原始下載檔：** 不進 repo（`backend/data/*/raw/` 已排除）。每次抓到的原始檔存成 Actions artifact，保留 90 天。
- **模擬報價：** 不進 repo，也不在歷史中。測試資料只在跑測試、部署網頁或建置 APK 時由 `scripts/gen-test-data.js` 產生，產生的檔案已排除。
- **本機演練資料：** 不在 repo 中，例如模擬的 11/25 訪價。
- **正式紀錄：** 只有台中 84539 手動匯入的 13,090 筆（近 60 天，最新 11/24）。
- **本機路徑：** 已移除，實檔測試改由環境變數 `JCJ_REAL_TAICHUNG` 指定。
- **歷史：** 只有 1 個提交。

## 驗證步驟（我取得權限後依序執行）

1. **台中手動跑一次：** Actions →「更新行情」→ Run workflow，`only` 填 `taichung_retail`，日期留空。回報：
   - HTTP 結果、解析筆數、保留期內筆數
   - 新增、更正、未變筆數
   - 最新訪價日（執行前 → 執行後）
   - 判定，以及一筆原始報價 ↔ 網頁的對照
2. **同一天再跑一次：** 預期新增 0、更正 0，判定「抓取成功，來源沒有新資料」。
3. **確認排程實際觸發：** 等下一個排程時段（台灣時間 07:40、13:40、19:40，GitHub 可能延遲數十分鐘），確認 `last-run.json` 的 trigger 是 `schedule`。
4. **端到端更新通過（Pages 開啟後）：** 「部署網頁」會在每次「更新行情」成功後執行，`verify` 工作會比對網頁和 repo 的資料，並對照一筆原始報價。等官方出現比 11/24 更新的訪價、網頁顯示該日期、手機實機看到同一個數字，才標記通過。
5. **其他四個來源：** 以 `only` 一次跑一個，分別記錄抓取、解析、匯入、網頁顯示。
6. **Android APK：** Actions →「Android 測試版 APK」→ Run workflow，下載 artifact 裡的 `app-debug.apk` 側載安裝。

## 已知風險

- **海外連線可能被擋：** GitHub 的執行環境在台灣以外。如果政府網站拒絕海外連線，第一次執行就會在摘要看到 HTTP 403、逾時或連線錯誤。屆時改用放在台灣的執行環境，例如自架 runner 或台灣機房的主機，跑同一個指令 `node cli.js fetch`。
- **農業部 API 的預設回傳天數：** 目前不知道預設會回傳幾天。若只回當天，近 7 天走勢要靠每日累積，或改用日期參數（需先驗證）。

## 本機演練（已完成，模擬官方網址）

用本機伺服器提供與官方相同的 84539 檔案。

| 情境 | HTTP | 結果 |
|---|---|---|
| 同一份資料（乾淨 clone，照 workflow 步驟跑） | 200 | 4,489 列、解析 78,139 筆、保留期內 13,090 筆；新增 0、更正 0、未變 13,090；最新日 11/24 → 11/24；判定「抓取成功，來源沒有新資料」；records.json 沒有任何變動 |
| 再跑一次 | 200 | 同上，沒有重複 |
| 官方多了一天（模擬 11/25，清水第一市場花椰菜 45） | 200 | 新增 159 筆，最新日 11/24 → 11/25；原始 `"花椰菜":"45"` → App 資料 45 元／台斤 → 網頁比價列「清水第一市場 11/25・原始 45 元/斤 45 元／台斤」，一致 |
| 來源回 404 | 404 | 筆數維持 13,249，保留原資料 |

## Android 測試版 APK（v0.1.0）

- **工作流程：** Actions →「Android 測試版 APK」→ Run workflow，依序執行：
  1. 建置。
  2. 在 Android 14 模擬器上實測連線與斷網兩種情境。
  3. 把 APK 發布到預先版本 `v0.1.0-apk-test`。
- **下載：** https://github.com/ww6611ww-sketch/jcj-veg-price/releases/download/v0.1.0-apk-test/jcj-v0.1.0-debug.apk
- **線上行情來源：** https://ww6611ww-sketch.github.io/jcj-veg-price/data/official.json 。逾時 8 秒或連不到時，改用 App 內附資料，首頁黃框顯示「目前無法連線，顯示 App 內附資料」、資料產生時間與最近訪價日，可按「重新連線」。

### 安裝步驟

1. 用 Android 手機的瀏覽器打開上面的下載連結。
2. 下載完成後點開 `jcj-v0.1.0-debug.apk`。
3. 系統若提示「基於安全性，手機已設為封鎖此來源的不明應用程式」：
   - 點「設定」，開啟「允許這個來源的應用程式」（通常是 Chrome）。
   - 返回後再點「安裝」。
4. Google Play 安全防護若跳出警告，選「仍要安裝」。這是 debug 簽署的測試版，所以會出現這類警告。
5. 安裝完成後打開「今日菜價」。首頁應顯示綠色「線上行情・更新於…・最近訪價日 11/24」。
6. 開飛航模式後完全關閉 App 再開，應顯示黃色離線提示，價格照常顯示。
7. 更新版本：每次建置都用新的臨時 debug 金鑰簽署，新版無法直接覆蓋。請先解除安裝舊版再裝新版；收藏與選區會一併清除。要能直接覆蓋，需要建立固定的簽署金鑰並存成 repo secret，下一版再處理。
