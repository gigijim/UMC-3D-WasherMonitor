# 聯苑宿舍二期 · UMC-3D-WasherMonitor

聯苑二期 3D 洗衣機/烘衣機 24H 物聯網監控與使用率大數據分析系統。
- 專案名稱：`UMC-3D-WasherMonitor`
- Vercel 線上網址：`https://UMC-3D-WasherMonitor.vercel.app`

---

## 🌟 核心特色

1. **真實現場 3D 空間排序（進門由右至左）**：
   - 右側進門（靠牆入口）依序為：
     👉 **[洗1] 洗衣機1號** ➔ **[洗2] 洗衣機2號** ➔ **[洗3] 洗衣機3號** ➔ **[烘1] 烘衣機1號** ➔ **[烘2] 烘衣機2號** ➔ **[洗4] 洗衣機4號**。
   - 完整呈現 2F、4F、6F、8F 四個樓層（全棟共 24 台機台）。
   - **機台動態狀態**：
     - 🟢 **可使用**：常態微光綠環，提示隨時可投幣。
     - 🟠 **運轉中**：高亮琥珀橘光環脈衝呼吸，滾筒內部動態旋轉動畫，並精準倒數剩餘分秒。
     - ⚪ **離線**：灰暗狀態，提示機台未開機或保養中。
   - **直覺互動操作**：支援單指滑動旋轉、雙指捏合縮放、滾輪推拉；點擊任一機台鏡頭自動平滑推軌對焦。

2. **24H × 7D 長期規律分析報表**：
   - **使用熱度矩陣（Heatmap）**：完整繪製週一至週日各小時的熱門度，一眼看出「洗衣大沙漠冷門時段」。
   - **各樓層使用率對比**：以長條圖精準比較 2F、4F、6F、8F 的運轉次數與時數。
   - **冷門 / 熱門機台天梯榜**：列出最少人搶的推薦機台與尖峰常滿機台。
   - **智慧推薦離峰時段**：自動運算空閒率最高的時段區間（例如清晨 05:00~07:00 或平日午後）。

3. **雙模架構（本地 24/7 監控 + Vercel 雲端隨時查）**：
   - **Vercel Serverless API (`/api/realtime`)**：解決瀏覽器跨域（CORS）問題，外部用戶打開網頁時直接向 Alfaloop 查詢秒級最新狀態。
   - **本地爬蟲（Node.js + SQLite）**：24/7 每 3 分鐘精準追蹤狀態機躍遷與投幣金額，定期輸出彙總 JSON 供雲端展現長期分析。

---

## 📁 專案目錄結構

```text
20260913_二期洗衣監控分析/
├── backend/                  # 24/7 爬蟲與 SQLite 後端
│   ├── collector.js          # Alfaloop IoT API 爬蟲與事件判定
│   ├── db.js                 # Node.js 原生 SQLite 資料庫 (DatabaseSync)
│   ├── analyzer.js           # 熱度矩陣、樓層對比、排行與推薦演算法
│   ├── export_data.js        # 將資料庫聚合匯出為前端 JSON
│   ├── daemon.js             # 24 小時守護排程服務 (每 3 分鐘一次)
│   ├── seed_mock_history.js  # 30 天歷史數據模擬生成器
│   └── start_daemon.bat      # Windows 一鍵啟動守護腳本
│
├── frontend/                 # Three.js 3D 與現代化前端
│   ├── index.html            # RWD 響應式介面
│   ├── vercel.json           # Vercel 部署設定
│   ├── api/
│   │   └── realtime.js       # Vercel Serverless 代理 API
│   ├── public/data/
│   │   ├── realtime_latest.json
│   │   └── history_data.json
│   └── src/
│       ├── main.js           # 前端應用入口與事件綁定
│       ├── three/
│       │   └── LaundryScene.js # Three.js 3D 樓層、機台與動畫核心
│       └── components/
│           └── Charts.js     # Chart.js 與熱度圖渲染組件
│
├── start_all.bat             # 一鍵啟動全部 (爬蟲背景 + 前端本機瀏覽)
├── sync_github.bat           # 一鍵同步最新數據至 GitHub
└── README.md
```

---

## 🚀 本機快速啟動

雙擊專案根目錄下的：
👉 `start_all.bat`

系統將自動：
1. 在背景終端機啟動 24H 爬蟲守護程式（每 3 分鐘自動輪詢一次，並累積存入 SQLite）。
2. 啟動 Vite 本地開發伺服器，自動開啟瀏覽器網址 `http://localhost:3000`。

---

## ☁️ 部署至 GitHub + Vercel 指南

### 第一步：推送到 GitHub
1. 在 GitHub 建立一個名為 **`UMC-3D-WasherMonitor`** 的 Repository。
2. 在本機專案根目錄執行：
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit for UMC-3D-WasherMonitor"
   git branch -M main
   git remote add origin https://github.com/您的帳號/UMC-3D-WasherMonitor.git
   git push -u origin main
   ```

### 第二步：連接至 Vercel 部署
1. 登入 [Vercel](https://vercel.com)。
2. 點擊 **"Add New Project"**，選擇剛剛建立的 `UMC-3D-WasherMonitor` Repository。
3. **重要專案設定**：
   - **Project Name**：輸入 `UMC-3D-WasherMonitor`（這樣網址就會是 `UMC-3D-WasherMonitor.vercel.app`）。
   - **Root Directory**：選擇 `frontend` 資料夾。
   - **Framework Preset**：選擇 `Vite`。
   - **Build Command**：`npm run build`。
   - **Output Directory**：`dist`。
4. 點擊 **"Deploy"**。
5. 部署完成後即可直接透過手機或電腦存取：
   👉 **`https://UMC-3D-WasherMonitor.vercel.app`**
