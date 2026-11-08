# UMC-3D-WasherMonitor 工作交接與系統維運手冊（v2.5.x）

> **最新版本**：`v2.5.2`（2026-11-08）· 本手冊最初發布於 2026-10-18（v2.5.0）  
> **系統狀態**：正式上線 (Production OK)  
> **線上站台**：[umc-3d-washermonitor.vercel.app](https://umc-3d-washermonitor.vercel.app)  
> **GitHub 儲存庫**：[github.com/gigijim/UMC-3D-WasherMonitor](https://github.com/gigijim/UMC-3D-WasherMonitor)（Release Tag: `v2.5.0`、`v2.5.1`、`v2.5.2`）  
> **本機工作目錄**：`C:\Users\jimmy\Desktop\AI_Work\20260913_二期洗衣監控分析-v2.5.0`

---

## 1. 架構升級成果總覽

| 項目 | 升級前 (v2.4.2) | 升級後 (v2.5.0) | 效益 |
|---|---|---|---|
| **Vercel 每日部署** | ~148 次 / 天（常破 100 次被鎖 24hr） | **0 次**（爬蟲更新只推 `data` 分支） | **徹底根除部署超額停更問題** |
| **資料庫快照數** | 125,305 筆 | **4,427 筆** | 狀態變更才記錄，剔除 120,878 筆冗餘 |
| **資料庫大小** | 14.45 MB | **0.87 MB** | **縮小 94%**，快取與查詢極速 |
| **Git Commit 數** | 5,248 筆（包含大量自動爬蟲備份） | **35 筆**（純手動功能開發 commit） | 徹底避免逼近 GitHub 100MB 限制 |
| **cron-job 觸發** | 舊限制 Bearer Header / key | **直接支援 `?token=...`** | 一行 URL 搞定，不需繁複設定 |

---

## 2. 核心架構運作原理

```text
cron-job.org (每10分鐘)
       │ HTTP GET Ping
       ▼
Vercel /api/trigger-crawl?token=<CRON_SECRET>
       │ GitHub REST API (workflow_dispatch)
       ▼
GitHub Actions (crawl.yml, concurrency: crawl)
       ├─ 簽出 main 分支 (程式碼)
       ├─ 簽出 data 分支 (資料庫與即時 JSON)
       ├─ node backend/collector.js (經 shared/alfaloop.js 向廠商新版 API 抓取機況，寫入 laundry.db 與 realtime_latest.json)
       ├─ node backend/export_data.js (重算統計產出 history_data.json)
       ├─ 自動每日備份 (每天首次執行時上傳 laundry.db 到 GitHub Artifacts，保留 90 天)
       └─ git commit --amend & git push --force-with-lease origin data
            │
            └─ data 分支自帶 vercel.json {"git":{"deploymentEnabled":false}}
               （Vercel 讀取該分支設定，完全不觸發網站重新部署！）
```

---

## 3. 定時排程與 Webhook 設定

### 3.1 cron-job.org 正式設定
- **任務名稱**：聯苑二期洗衣機爬蟲 10分鐘
- **URL**：
  ```text
  https://umc-3d-washermonitor.vercel.app/api/trigger-crawl?token=c66aad88244b442697265934c05035ff03afb7241f594db2aeecb2e13586603a
  ```
- **排程頻率**：Every 10 minutes (`*/10 * * * *`)
- **Request Method**：`GET`
- **Headers**：保持空白（已支援 URL 帶 Token，不需自訂 Header）
- **實測結果**：200 OK，回傳 `{"success":true,"message":"✅ 爬蟲排程已觸發"}`。

### 3.2 GitHub Actions 備援排程
- `.github/workflows/crawl.yml` 內建排程：
  `cron: '5,15,25,35,45,55 * * * *'`（與 cron-job.org 錯開 5 分鐘執行）
- 即便外部網路短暫異常，GitHub Actions 仍會自主備援抓取，雙保險確保資料不漏失。

---

## 4. 關鍵功能與邏輯修正

1. **烘衣機投幣加時合併**：運轉中加幣延長時間，系統自動判定為同一次使用，累計加購時長與費用（可正常累計超過單次 99 分鐘限制）。
2. **洗衣機時間校正去重**：機台自動調整剩餘時間微調時，不再誤判為新事件。只有在上一輪結束且新一輪完整啟動時才新增記錄。
3. **6F 烘乾機 2 號個別計價**：特例規則統一納入 `shared/pricing.js`（NT$10 / 40 分鐘，上限 NT$30）。
4. **離峰推薦與熱度矩陣算法**：分母改以實際觀察天數中「該時段出現的實際次數」計算，解決舊算法稀釋或高估的問題。
5. **歷史數據重算**：遷移腳本 `backend/migrate_v2_5_0.js` 已將自 2026-09-13 以來的所有歷史快照以新規則重播修正完畢。

---

## 5. 廠商 API 變更（v2.5.1，2026-11-08）

- **狀況**：2026-11-05 起廠商換裝新一代連網模組（AB2），網站 24 台機台全部顯示離線約 3 天。
- **原因**：機況改由新 API 提供；舊 API 仍回應 200，但資料凍結在換裝當下、全部顯示離線。
- **現行 API**（與官方頁面 https://service.alfaloop.com/entry/openness/place/67359cb42f71210375a69599 相同來源）：
  ```text
  GET https://service.alfaloop.com/api/v1/public/device/device-cloud/info-list?placeId=67359cb42f71210375a69599&tz=Asia%2FTaipei&timestamp=<秒>
  ```
- **程式位置**：`shared/alfaloop.js`（爬蟲、`/api/realtime`、Vite 本機開發伺服器共用）。舊 API 不作為備援，避免讀到凍結資料。
- **機台編號**：換裝後每台機台的 id 都變了，`LEGACY_HWIDS` 依機台名稱對應回原本的編號，資料庫仍為 24 台、歷史紀錄延續。若宿舍新增機台，未在表內的機台會直接使用新 id。
- **資料空窗**：2026-11-05 13:50 ~ 2026-11-08 期間無法取得機況，只補登到每台機台最後一次使用。

### 5.1 若網站又出現「全部離線」的排查順序
1. 打開上面的官方頁面：若官方也顯示離線 → 現場網路或機台問題，回報宿舍或廠商。
2. 官方顯示正常、網站顯示離線 → 很可能廠商又改了 API。用瀏覽器開發者工具（Network）查看官方頁面呼叫的 API 網址與回應格式，再修改 `shared/alfaloop.js`。
3. 確認爬蟲執行狀態：GitHub → Actions → 10-Minute IoT Laundry Monitor Crawler，日誌中的 `[Collector] Finished crawl ... Offline: N`。

---

## 6. 3D 縮放設定（v2.5.2，2026-11-08）

- **縮小不再淡出**：場景霧氣（`FogExp2`，濃度 0.012）原本會讓模型在縮小時漸層消失。現在縮得比全棟預設視角更遠時，霧氣濃度會等比例降低，模型保持清楚；預設距離以內的畫面與以前完全相同。
- **縮小極限**：全棟預設視角距離的 1.6 倍（電腦版約 67、手機直式約 72 單位），依螢幕比例自動計算、旋轉螢幕或調整視窗時會重新計算。縮到最小時大樓約為預設大小的 6 成。
- **調整方式**：`frontend/src/three/LaundryScene.js` 檔案開頭的 `MAX_ZOOM_OUT_RATIO`（縮小極限倍數）與 `FOG_DENSITY`（霧氣濃度）。放大極限與其他操作不變。

---

## 7. 備份存證與災難復原

### 7.1 本機封存備份
- **位置**：`C:\Users\jimmy\Desktop\AI_Work\UMC-backup-pre-v2.5.0\`
- **檔案**：
  - `full-history.bundle`（44.1 MB）：包含升級前完整的 5,248 筆 Git 歷史紀錄與所有分支/標籤。
  - `laundry-raw-origin-main.db`（14.5 MB）：未壓縮前的原始 SQLite 資料庫。

### 7.2 雲端每日自動備份
- GitHub Actions 每天首次執行時，會自動將 `laundry.db` 上傳至 GitHub Actions Artifacts。
- **下載路徑**：進入 GitHub Repo ➔ Actions ➔ 點選當天的執行紀錄 ➔ 下載 Artifacts `laundry-db-YYYY-MM-DD`。

---

## 8. AI 專用瀏覽器自動化指南

- **桌面捷徑**：`AI 專用 Chrome 瀏覽器.lnk`
- **設定檔位置**：`C:\Users\jimmy\.chrome-ai-profile`
- **遠端偵錯埠**：`9222`
- **使用方式**：
  保持該瀏覽器開啟，AI 代理程式即可透過 Chrome DevTools Protocol (CDP) 隨時連入，執行自動化表單填寫、排程檢查與第三方主控台操作。

---

## 9. 版本紀錄

| 版本 | 日期 | 內容 |
|---|---|---|
| v2.5.2 | 2026-11-08 | 3D 縮小時不再淡出、限制縮小極限（電腦版 / 手機版） |
| v2.5.1 | 2026-11-08 | 改用廠商新版機況 API，修正 24 台持續顯示離線；機台編號延續 |
| v2.5.0 | 2026-10-18 | 資料與網站部署分離（data 分支）、事件偵測修正、資料庫瘦身、版本整理 |

完整內容請見 [CHANGELOG.md](./CHANGELOG.md)。
