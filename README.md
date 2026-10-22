# 聯苑宿舍二期 · 3D 洗衣監控分析系統 (UMC-3D-WasherMonitor)

> **24H 物聯網即時監控 · 3D 擬真機房 · 大數據規律熱度圖 · 離峰洗衣智慧推薦**

- **專案名稱**：`UMC-3D-WasherMonitor`
- **線上站點**：[https://umc-3d-washermonitor.vercel.app](https://umc-3d-washermonitor.vercel.app)
- **最新版本**：`v2.5.0` (Release 2026.10.18) · [版本修改紀錄 CHANGELOG](./CHANGELOG.md)
- **維護聲明**：看我心情~和下班有沒有空
- **版權宣告**：Copyright © 2026 UMC_IT-Jimmy

---

## 🏗️ 系統全景架構圖 (Architecture)

本系統採用**雙軌分離架構（即時動態流 + 大數據批次流）**，兼顧「秒級即時監控的高靈敏度」與「長期規律分析的容錯高可靠性」：

```mermaid
flowchart TD
    subgraph Client ["前端用戶端 (PWA / WebGL / Mobile / Desktop)"]
        UI["3D 虛擬機房 (Three.js WebGL)"]
        Report["數據分析看板 (熱度圖 / 樓層對比 / 天梯榜)"]
        PWA["iOS / Android PWA Standalone (加入主畫面)"]
    end

    subgraph Vercel ["Vercel 雲端邊緣伺服器"]
        RT_API["/api/realtime<br/>(即時機況代理端點)"]
        Trigger_API["/api/trigger-crawl<br/>(外部 Webhook 喚醒端點)"]
        DataAPI["/api/data<br/>(最新分析資料讀取端點)"]
    end

    subgraph IoT ["Alfaloop 物聯網雲端平台"]
        Hardware["聯苑二期 24 台洗衣/烘衣機<br/>(2F / 4F / 6F / 8F 現場硬體晶片)"]
    end

    subgraph Automation ["雲端定時排程與數據治理 (每 10 分鐘)"]
        CronJob["cron-job.org 定時排程器<br/>(每 10 分鐘自動 HTTP GET Ping)"]
        GHA["GitHub Actions Runner<br/>(Ubuntu 雲端工作流程)"]
        Crawler["Node.js 爬蟲核心<br/>(collector.js / dueTime 自癒偵測)"]
        Analyzer["統計分析引擎<br/>(analyzer.js / Asia/Taipei UTC+8)"]
    end

    subgraph DataBranch ["GitHub data 分支 (只保留最新一份)"]
        DB[("SQLite 關聯資料庫<br/>(laundry.db)")]
        StaticData["分析結果 JSON<br/>(history_data.json / realtime_latest.json)"]
    end

    %% 即時動態流 (軌道一)
    UI -- "每 30 秒輪詢" --> RT_API
    RT_API -- "即時穿透查詢" --> Hardware
    RT_API -. "即時響應" .-> UI

    %% 規律分析排程流 (軌道二)
    CronJob -- "定時 Webhook Ping" --> Trigger_API
    Trigger_API -- "workflow_dispatch API" --> GHA
    GHA --> Crawler
    Crawler -- "抓取設備 dueTime 戳記" --> Hardware
    Crawler -- "事件去重與自癒補登" --> DB
    DB --> Analyzer
    Analyzer -- "產生統計與熱度矩陣" --> StaticData
    GHA -- "推送至 data 分支 (不觸發網站部署)" --> StaticData
    Report -- "讀取最新分析" --> DataAPI
    DataAPI -- "讀取 data 分支" --> StaticData
```

---

## ⚡ 核心雙軌運作機制

### 1. 軌道一：即時 3D 機況流 (Real-Time Pipeline)
- **觸發頻率**：前端預設每 30 秒自動向 `/api/realtime` 輪詢一次（或點擊右上方手動刷新）。
- **轉發與代理**：透過 Vercel Serverless Function 轉發請求至 Alfaloop IoT 伺服器，解決瀏覽器端 CORS 跨域限制，並對原始 JSON 進行資料清洗。
- **視覺渲染**：
  - 🟢 **閒置可使用**：常態微光綠環，提示隨時可投幣。
  - 🟠 **運轉中**：高亮琥珀橘脈衝呼吸環、滾筒動態轉動、每秒精確倒數結束時間。
  - ⚪ **離線**：灰暗狀態，提示未開機或維護中。

---

### 2. 軌道二：大數據分析與自癒排程流 (Batch & Self-Healing Pipeline)
- **定時喚醒機制**：
  - 採用 **`cron-job.org`** 外部 Webhook 服務，每 10 分鐘自動對 `/api/trigger-crawl` 發送 HTTP GET Ping。
  - Vercel API 收到後透過 GitHub REST API 即時觸發 GitHub Actions 工作流程（`workflow_dispatch`），**5~8 秒內即時喚醒爬蟲**，徹底擺脫 GitHub 自身 cron 佇列在尖峰期延遲或被丟棄的限制。
- **資料與網站部署分離 (v2.5.0)**：
  - 爬蟲產生的資料庫與分析 JSON 存放在獨立的 `data` 分支，網站透過 `/api/data` 讀取，資料更新不會觸發 Vercel 重新部署（Vercel 免費方案每日部署上限 100 次）。
  - `data` 分支永遠只保留最新一個 commit；每天自動備份資料庫至 GitHub Actions Artifacts（保留 90 天）。
  - GitHub Actions 以 `concurrency` 確保同一時間只有一個爬蟲執行；GitHub 自身排程與 cron-job.org 錯開 5 分鐘作為備援。
  - `data` 分支自帶 `vercel.json`（`deploymentEnabled: false`），Vercel 不會為資料更新建立部署。
- **基於硬體 dueTime 戳記的自我修復補登**：
  - 即使雲端排程中斷數小時，機台硬體端洗完後仍會保留最後一次運轉的 `dueTime` 戳記。
  - 爬蟲再次啟動時，會自動比對資料庫歷史，若偵測到新的結束時間戳記，**自動回溯起始時間與金額補登入 SQLite 資料庫**，達成離線自癒容錯。
  - 運轉中結束時間被延後：烘衣機視為投幣加時並合併為同一次（時長與金額累加）；洗衣機視為機台校正剩餘時間（只有上一輪即將結束、新一輪完整開始才記為新的一次）。
  - 計價規則集中於 `shared/pricing.js`（6F烘乾機2號為特例：NT$10 / 40 分鐘，最多 NT$30 / 99 分鐘）。
- **平均使用率分母**：以觀察期間（自開始採集至今）內每個「星期幾 × 小時」時段實際出現的次數為分母，熱度矩陣、24H 走勢與離峰推薦一致。
- **時區統一治理 (Asia/Taipei UTC+8)**：
  - 分析核心內建台灣時區座標轉換函式，消除 GitHub Actions 預設 Ubuntu UTC+0 環境帶來的 8 小時偏差，確保熱度矩陣的 24 小時時段完全精確。
- **物理分母容量模型 (Physical Capacity Denominators)**：
  - **全棟分析**：以全棟 24 台（洗衣機 16 台、烘衣機 8 台）為物理容量上限，熱度圖支援「洗烘合併 / 洗衣機 / 烘衣機」三種分母切換。
  - **樓層分析**：單層樓標準配備 4 台洗衣機 + 2 台烘衣機（共 6 台），洗機分母為 4，烘機分母為 2，真實反映物理滿載率。
  - **機台分析**：單機分母為 1，改採「機台行為畫像」：同類熱門度天梯排行、平均單次時長、尖峰常滿時段 Top 3、合法最佳空閒推薦與 24H 被佔用機率走勢。
- **生活公約安寧規範合規 (08:00 ~ 24:00 合法時段)**：
  - 嚴格限定離峰推薦時段計算於 **08:00 ~ 24:00** 之間，自動排除 00:00 ~ 08:00 夜間安寧禁洗區間。
  - 熱度矩陣與走勢圖將 00:00 ~ 08:00 特別標註 `🌙 夜間安寧禁洗`，半夜使用自動以 `⚠️ 違規偷用` 標記。
- **冷門機台健康度過濾**：
  - 離峰冷門推薦機台嚴格過濾斷線或故障機台，確保推薦的皆為在線正常運作之設備。

---

## 📁 專案目錄結構

```text
UMC-3D-WasherMonitor/
├── .github/
│   └── workflows/
│       └── crawl.yml           # GitHub Actions 10 分鐘爬蟲工作流程
│
├── api/                        # Vercel Serverless Functions 根端點
│   ├── realtime.js             # 即時機況代理端點 (20 秒邊緣快取)
│   ├── data.js                 # 讀取 data 分支最新分析資料
│   └── trigger-crawl.js        # 外部排程爬蟲喚醒端點
│
├── shared/                     # 前後端共用模組
│   ├── device.js               # 機台描述解析與即時狀態格式
│   └── pricing.js              # 計價規則 (含特例機台)
│
├── backend/                    # 爬蟲與 SQLite 歷史庫後端
│   ├── collector.js            # Alfaloop IoT 爬蟲 (狀態改變才寫入快照)
│   ├── events.js               # 使用事件偵測 (新增 / 加時合併 / 時間校正)
│   ├── analyzer.js             # 台灣時區熱度矩陣、樓層對比與天梯榜計算
│   ├── export_data.js          # 將 SQLite 資料庫匯出為分析 JSON
│   ├── db.js                   # Node.js 原生 SQLite 連線與資料表結構 (DatabaseSync)
│   ├── migrate_v2_5_0.js       # v2.5.0 一次性資料遷移 (快照壓縮 + 重算)
│   ├── daemon.js               # 本機 24H 背景守護程式 (每 3 分鐘爬取、每 15 分鐘匯出)
│   ├── reset_db.js             # 本機清空歷史並重新開始採集 (開發用)
│   ├── seed_mock_history.js    # 產生模擬歷史資料 (開發用)
│   └── start_daemon.bat        # Windows 一鍵啟動守護腳本
│
├── frontend/                   # 現代化 3D 前端與 PWA (Vite)
│   ├── index.html              # 主畫面 (3D Canvas + 直立式樓層選單 + 版本資訊)
│   ├── vite.config.js          # Vite 設定 (含本機 /api/realtime、/api/data 開發代理)
│   ├── public/
│   │   ├── manifest.webmanifest # PWA Web App 清單 (支援 iOS 加入主畫面)
│   │   ├── sw.js               # Service Worker (離線快取與 Network-First 策略)
│   │   └── icon-*.png …        # App 圖示與 favicon
│   └── src/
│       ├── main.js             # 前端核心邏輯、視角導航、資料同步
│       ├── three/
│       │   └── LaundryScene.js # Three.js 3D 空間建模、材質光影、相機推軌與動畫
│       └── components/
│           └── Charts.js       # Chart.js 視覺化、每週熱度矩陣看板
│
├── package.json                # 根目錄指令 (npm run build / npm run crawl)
├── start_all.bat               # Windows 一鍵啟動本機守護程式 + 前端開發伺服器
├── vercel.json                 # Vercel 建置設定
├── CHANGELOG.md                # 版本修改紀錄
└── README.md                   # 系統架構與說明文件

(data 分支，只保留最新一個 commit)
├── laundry.db                  # SQLite 歷史資料庫
├── history_data.json           # 歷史分析結果 (/api/data?name=history)
├── realtime_latest.json        # 最新一次爬取的機況 (/api/data?name=realtime)
├── last_backup_date            # 每日備份標記
└── vercel.json                 # 停用此分支的 Vercel 部署
```

---

## 💻 本機開發

需求：Node.js 22 以上（使用內建 `node:sqlite`）。

```bash
cd frontend && npm install && npm run dev      # 前端開發伺服器 http://localhost:3000
npm run crawl                                  # 在 repo 根目錄手動爬取一次並匯出分析
```

- 本機資料預設存放在 `backend/`（`laundry.db`、`history_data.json`、`realtime_latest.json`，已列入 `.gitignore`）；可用環境變數 `LAUNDRY_DATA_DIR` 指定其他資料夾。
- 開發伺服器的 `/api/data` 會優先讀取本機資料，沒有時改讀線上 `data` 分支。
- Windows 可直接執行 `start_all.bat`，同時啟動本機守護爬蟲與前端。

---

## 🛠️ data 分支維運

**初始化或從備份還原**（`data` 分支遺失、資料損毀時；爬蟲遇到 `data` 分支缺少 `laundry.db` 會直接停止，不會覆蓋歷史）：

1. 到 GitHub → Actions → 任一次爬蟲執行頁面下方的 Artifacts，下載最近一天的 `laundry-db-YYYY-MM-DD`，解壓出 `laundry.db` 放到暫存資料夾（例如 `D:/restore`）。
2. 產生分析 JSON：`LAUNDRY_DATA_DIR=D:/restore node backend/export_data.js`
3. 推送為單一 commit 的 `data` 分支：

```bash
git checkout --orphan data-restore && git rm -rfq .
cp D:/restore/laundry.db D:/restore/history_data.json .
echo '{"git":{"deploymentEnabled":false}}' > vercel.json
git add -A && git commit -m "data: restore" && git push -f origin data-restore:data
```

斷線期間每台機台最後一次使用會由 dueTime 自癒機制補登。

---

## 🎯 現場機房空間對應 (2F / 4F / 6F / 8F)

現場各樓層機房皆為單排一字型排列，**進門視角由右至左**配置如下：

| 位置 (由右至左) | 設備名稱 | 設備類型 | 預設運轉參數 |
|---|---|---|---|
| **第 1 台（靠門）** | 洗衣機 1 號 | 水洗脫水機 | 投幣 NT$ 20 / 40 分鐘 |
| **第 2 台** | 洗衣機 2 號 | 水洗脫水機 | 投幣 NT$ 20 / 40 分鐘 |
| **第 3 台** | 洗衣機 3 號 | 水洗脫水機 | 投幣 NT$ 20 / 40 分鐘 |
| **第 4 台** | 烘衣機 1 號 | 熱風烘乾機 | 投幣 NT$ 10 / 20 分鐘 (可累投至 99 分鐘) |
| **第 5 台** | 烘衣機 2 號 | 熱風烘乾機 | 投幣 NT$ 10 / 20 分鐘 (可累投至 99 分鐘)；**6F 特例：NT$ 10 / 40 分鐘，最多 NT$ 30 / 99 分鐘** |
| **第 6 台（最內側）**| 洗衣機 4 號 | 水洗脫水機 | 投幣 NT$ 20 / 40 分鐘 |

*(全棟 4 個樓層共 24 台聯網設備，完整納入 3D 視覺化與規律統計)*

---

## 📜 版本演進歷史

> 完整內容請見 [CHANGELOG.md](./CHANGELOG.md)

- **`v2.5.0` (2026.10.18)**
  - **資料更新與網站部署分離**：解決每日更新次數上限造成網站停止更新的問題。
  - **統計修正並重算全部歷史數據**：烘衣機投幣加時合併（時長與金額累加）、洗衣機時間校正不再重複計算；熱度矩陣、24H 走勢與離峰推薦改以各時段實際出現次數為分母計算平均使用率。
  - **6F烘乾機2號特殊計價**、資料庫瘦身（14MB ➔ 0.9MB）、每日自動備份、即時機況快取、數據分析顯示實際觀察天數、全站版本號統一。
- **`v2.4.2` (2026.09.13)**
  - 數據分析視角重整、樓層排名看板、機台清單依樓層排序、單機每週熱度矩陣。
- **`v2.4.1` (2026.09.13)**
  - **點擊機台顯示最後使用時間**：機台資訊卡新增最後一次使用時間與經過時長（如：今天下午06:27，約2小時前）。
  - **剛洗完滾筒衣物取留提醒**：剛洗完 15 分鐘內自動標註「⚠️ 剛洗完 (留意衣物)」，提醒投幣前先確認滾筒是否清空。
  - **2D 清單即時狀態增強**：清單卡片直接呈現閒置機台上次完成時間與經過時間。
  - **大數據單機行為畫像同步**：數據分析「by機台」畫像同步整合最後一次使用時間指標。
- **`v2.4.0` (2026.09.13)**
  - **視角分類重新排序**：依使用習慣調整按鈕由左至右為「by全棟 ➔ by樓層 ➔ by機台」，預設直覺進入全棟總覽。
  - **熱度矩陣物理分母重構**：全面導入洗烘分離分母切換（樓層洗4/烘2/合6、全棟洗16/烘8/合24），告別空泛比例。
  - **生活公約安寧規範嚴格合規**：夜間 00:00~08:00 嚴禁洗烘，半夜違規偷洗以 ⚠️ 標記；智慧空閒離峰推薦時段嚴格限定在 08:00~24:00 合法營運時段。
  - **單機行為畫像取代分母為1的熱度圖**：提供同類熱門度天梯排行、平均單次時長、尖峰常滿 Top 3、最佳空閒推薦與 24H 被佔用機率走勢。
  - **冷門機台健康度過濾**：自動過濾離線與故障機台，避免誤推斷線機台為最佳推薦。
- **`v2.3.0` (2026.09.13)**
  - 串接 `cron-job.org` 外部 Webhook，徹底解決 GitHub Actions 尖峰排程延遲問題。
  - 全面校準數據分析熱度圖時區為台灣時間（Asia/Taipei UTC+8），消除 8 小時時差。
  - 數據分析頂部新增「cron-job.org 定時自動爬蟲數據更新」與「雲端爬蟲更新次數」。
  - 新增 Vercel Serverless `/api/trigger-crawl` 橋接端點，支援外部即時喚醒爬蟲。
  - 自癒補登機制驗證：離線間隔自動精準追蹤並補登 21 筆歷史洗衣/烘衣事件。
- **`v2.2.1` (2026.09.13)**
  - 後牆樓層標示上移外移（x=±8.9, y=3.85），微縮適配紅框角落空間。
  - 左側樓層告示全面放大 35%（x=-12.4, y=2.2），高解析重繪更顯眼。
  - 手機版 i 按鈕獨立移至右上方，與直立式樓層選單保持安全間距。
  - 手機版頂部標題字體顯著加大（粗黑體 15px/18px），清晰易讀。
- **`v2.2.0` (2026.09.13)**
  - 補齊手機頂部標題「聯苑二期3D洗衣監控分析」。
  - 徹底解決 Safari 報表關閉鈕 (X) 遮蔽與 iOS 安全區適配。
  - 機台選取視角中心下移，機台與倒數看板完美避開資訊小窗。
  - 全棟視角微縮並導入微微俯瞰視角，層次更完美。
  - 底部選單防折行與防跑版調優，全面鎖定單行排版。
- **`v2.1.0` (2026.09.13)**
  - 3D 倒數看板每秒跳秒倒數修復、巡航視角校正、背景告示純化、右上直立式樓層切換按鈕、效能優化。
- **`v2.0.0` (2026.09.13)**
  - PWA 支援、24H 數據分析、熱度矩陣、使用率排名與智慧離峰時段推薦、樓層 3D 立體告示。
- **`v1.0.0` (2026.09.12)**
  - 聯苑二期 2F/4F/6F/8F 24 台洗衣機/烘衣機 3D 即時 IoT 監控系統發布。
- **`v0.0.9 beta` (2026.09.12)**
  - 專案初衷發軔：因為太討厭每週下班搶洗衣機，索性開始實驗逆向分析這棟樓的洗衣機 IoT API 傳輸方式，預計做長期分析與數據收集，目標是要改善下班洗衣效率和學習 AI 工具開發。
