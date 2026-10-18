# UMC-3D-WasherMonitor v2.5.0 工作交接與系統維運手冊

> **發布時間**：2026-10-18 18:06（台北）  
> **系統狀態**：正式上線 (Production OK)  
> **線上站台**：[umc-3d-washermonitor.vercel.app](https://umc-3d-washermonitor.vercel.app)  
> **GitHub 儲存庫**：[github.com/gigijim/UMC-3D-WasherMonitor](https://github.com/gigijim/UMC-3D-WasherMonitor)（Release Tag: `v2.5.0`）  
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
       ├─ node backend/collector.js (抓取 alfaloop 機況，寫入 laundry.db 與 realtime_latest.json)
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

## 5. 備份存證與災難復原

### 5.1 本機封存備份
- **位置**：`C:\Users\jimmy\Desktop\AI_Work\UMC-backup-pre-v2.5.0\`
- **檔案**：
  - `full-history.bundle`（44.1 MB）：包含升級前完整的 5,248 筆 Git 歷史紀錄與所有分支/標籤。
  - `laundry-raw-origin-main.db`（14.5 MB）：未壓縮前的原始 SQLite 資料庫。

### 5.2 雲端每日自動備份
- GitHub Actions 每天首次執行時，會自動將 `laundry.db` 上傳至 GitHub Actions Artifacts。
- **下載路徑**：進入 GitHub Repo ➔ Actions ➔ 點選當天的執行紀錄 ➔ 下載 Artifacts `laundry-db-YYYY-MM-DD`。

---

## 6. AI 專用瀏覽器自動化指南

- **桌面捷徑**：`AI 專用 Chrome 瀏覽器.lnk`
- **設定檔位置**：`C:\Users\jimmy\.chrome-ai-profile`
- **遠端偵錯埠**：`9222`
- **使用方式**：
  保持該瀏覽器開啟，AI 代理程式即可透過 Chrome DevTools Protocol (CDP) 隨時連入，執行自動化表單填寫、排程檢查與第三方主控台操作。
