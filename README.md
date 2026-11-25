# 今日菜價 v0.1

台灣家庭採買用的價格查詢 App。這一版有首頁、食材詳情、市場比價、收藏、搜尋、分類、近 7 天走勢，以及缺資料時的各種畫面。

> **目前狀態（11/25）：** 台中 84539 已用官方 JSON 手動匯入並驗證，正式模式顯示 8 項蔬菜；海鮮與肉品單位待確認，暫不顯示。農業部四個來源仍待確認。新增異常值規則，詳見 DATA_SOURCES.md；手機驗收清單見 ACCEPTANCE.md。
>
> 原本的說明：畫面、計價與解析都用**測試資料**（虛構價格）驗證過。測試資料和正式資料分開存放與輸出，在 App 內要手動切換才看得到，而且每一頁頂端都有「測試資料・非真實行情」橫幅。

## 目錄

```
backend/                 共用後端（Node 22，無外部套件）
  cli.js                 inspect / import / fetch / export
  sources.json           五個來源設定；verified 只能人工核對後改 true
  lib/catalog.js         22 個品項與各來源欄位對照
  lib/markets.js         市場 → 縣市 → 四區對照
  lib/price.js           單位換算、有效報價、中位數聚合、台灣日期
  lib/parsers.js         五個來源的解析器
  lib/store.js           檔案型資料庫（official / test 分目錄、冪等寫入、原始檔保存）
  fixtures/test-data/    測試資料（依來源格式產生的虛構檔）
  test/core.test.js      單元測試
app/                     Capacitor 8 專案
  www/                   App 本體（index.html、app.js、styles.css、img/、data/）
  android/  ios/         原生專案（已放入 App 圖示、名稱「今日菜價」、繁中地區）
assets/                  裁切後的透明素材（PNG＋WebP）與兩平台 App 圖示
.github/workflows/       APK 雲端建置、每日抓取排程
```

## 常用指令

```bash
cd backend
npm test                                                        # 單元測試
node cli.js inspect --source taichung_retail --file 下載檔.csv  # 只解析＋印驗證報告，不寫入
node cli.js import  --source taichung_retail --file 下載檔.csv  # 匯入正式資料集（預設 official）
node cli.js import  --source moa_veg --file X.json --dataset test
node cli.js fetch [--date 2026-11-25] [--days 7]                # 依台灣日期抓取；同日期重跑＝安全更新
node cli.js export                                              # 輸出 app/www/data/official.json、test.json
```

來源代號：`taichung_retail`、`moa_veg`、`moa_fish`、`moa_hog`、`moa_poultry`。

## 啟用一個正式來源的流程

1. 下載官方原始檔，執行 `inspect`。報告會列出：最新日期、各日市場數、每個品項是否找到欄位、最近一次有效報價、原始單位、當日市場數、查無對照的市場名稱。
2. 依報告修正 `lib/catalog.js` 的欄位名稱或 `lib/markets.js` 的市場對照。
3. 確認欄位、有效報價、日期、單位都正確後，把 `sources.json` 該來源的 `verified` 改成 `true`（單位也核對過的話，`unitVerified` 一併改）。
4. 執行 `import` 和 `export`。App 正式模式就會出現該來源的資料。

## 資料規則（已實作並有測試）

- **統一紀錄欄位：** 來源、價格類型、品項、原始品名、規格、市場、縣市、地區、範圍、資料日（訪價日或交易日）、原始價格、原始單位、每公斤價（完整精度）、抓取時間、原始檔路徑、資料集。
- **冪等寫入：** 以 (來源, 日期, 市場, 原始品名, 價格類型) 為鍵，重跑同一天只會更新。寫入時先寫暫存檔再 rename。解析或抓取失敗時，records.json 保持不動，失敗原因記在 status.json。
- **原始檔保存：** 存在 `data/<dataset>/raw/<來源>/<抓取日>/<時間>-<sha>.ext`。
- **有效報價：** 數值且 > 0。空值、`-`、`NA` 和來源用來代表缺價的 0，一律視為無報價。
- **參考價：** 在同一 (日期, 地區, 品項, 規格, 價格類型) 內，取各市場報價的中位數，附最低到最高範圍和有效市場數。只有一個市場時，標示「單一市場訪價／報價」。同一市場有重複列時，先合併為一筆，避免重複計數。
- **單位：** 內部一律存元／公斤，1 台斤＝0.6 公斤。預設顯示元／台斤，可切換元／公斤，只在畫面上四捨五入（≥100 顯示整數，其餘到小數一位）。明細保留原始單位。台中來源標示「元／斤」，換算時以台斤計算（待原始檔核對）。
- **分區：** 依國發會四區劃分，北部含宜蘭，東部是花蓮與臺東。只有市場名稱能明確對照時才分區，對照不到的市場列在報告裡，不參與地區中位數。白肉雞依其實際範圍標示「全國產地」或「高屏地區」。
- **今日無資料：** 顯示「今日尚無資料・最近 MM/DD」。近 7 天依台灣日曆日排列，缺資料的那天留空並標「無」。
- **分開標示的價格類型：** 菜市場訪價、批發行情、毛豬拍賣、家禽行情。五花肉、里肌肉這類零售部位，和「毛豬」活體拍賣分開。白蝦和「白蝦(大)」這類不同規格也分開比較。

## 安裝與建置

### Android（debug 測試版，可側載）

需要一台有 Android SDK（Android Studio）和 JDK 21 的電腦：

```bash
cd backend && node cli.js export
cd ../app && npm ci && npx cap sync android
cd android && ./gradlew assembleDebug
# 產物：app/android/app/build/outputs/apk/debug/app-debug.apk
```

也可以把專案推到 GitHub，執行 Actions 的「Android 測試版 APK」，再下載產物。手機需開啟「允許安裝不明來源應用程式」。debug 版用自動產生的 debug 金鑰簽署，不需要 Google Play 帳號。

### iPhone

必須用 macOS 和 Xcode：

```bash
cd app && npm ci && npx cap sync ios && npx cap open ios
```

在 Xcode 的 Signing & Capabilities 選 Team，接上 iPhone 後按 Run。

- **免費 Apple ID：** 可以裝在自己的手機上測試，7 天後過期。
- **Apple Developer Program 帳號：** 才能用 TestFlight 發給其他測試者。

### 遠端資料

`app.js` 可以設定 `window.JCJ_DATA_BASE` 指向後端輸出的 `official.json`。沒設定或連不到時，使用 App 內附的資料。

## 已知限制

- 正式行情來源全部是「待確認」。原因是建置環境無法下載政府資料檔，詳見 DATA_SOURCES.md。
- 品項插畫只有高麗菜、白蝦、五花肉三張，其他品項用文字圓形圖示代替，避免張冠李戴。
