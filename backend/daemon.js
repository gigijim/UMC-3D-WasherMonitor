const { collectOnce } = require('./collector');
const { exportData } = require('./export_data');

const CRAWL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const EXPORT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

console.log('=====================================================');
console.log(' 聯苑宿舍二期 洗衣機/烘衣機 24H 守護爬蟲服務啟動中... ');
console.log(` 輪詢頻率: 每 ${CRAWL_INTERVAL_MS / 60000} 分鐘一次`);
console.log(` 匯出頻率: 每 ${EXPORT_INTERVAL_MS / 60000} 分鐘一次`);
console.log(' 按下 Ctrl+C 可停止服務');
console.log('=====================================================');

let lastExportTime = Date.now();

async function runLoop() {
  try {
    await collectOnce({ exportRealtime: true });

    // Check if export needed
    if (Date.now() - lastExportTime >= EXPORT_INTERVAL_MS) {
      exportData();
      lastExportTime = Date.now();
    }
  } catch (err) {
    console.error(`[Daemon] Error during crawl:`, err.message);
  }
}

// Initial run
runLoop();

// Recurring timer
const timer = setInterval(runLoop, CRAWL_INTERVAL_MS);

process.on('SIGINT', () => {
  console.log('\n[Daemon] 收到中斷訊號，正在安全退出...');
  clearInterval(timer);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Daemon] 收到終止訊號，正在安全退出...');
  clearInterval(timer);
  process.exit(0);
});
