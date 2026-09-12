const { getDb, initDb } = require('./db');
const { collectOnce } = require('./collector');
const { exportData } = require('./export_data');

console.log('[Reset] 正在清空歷史資料庫，準備開始純真實數據採集...');
const db = getDb();
db.exec('DELETE FROM usage_events;');
db.exec('DELETE FROM device_snapshots;');
db.close();

console.log('[Reset] 資料庫已清空。正在立即執行一次真實現場狀態抓取...');
collectOnce().then(() => {
  exportData();
  console.log('[Reset] 重置完成！目前資料庫僅包含現場真實狀態。');
}).catch((err) => {
  console.error('[Reset] 錯誤:', err);
});
