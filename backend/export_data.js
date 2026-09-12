const { getDb } = require('./db');
const { analyzeHistory } = require('./analyzer');
const fs = require('node:fs');
const path = require('node:path');

function exportData() {
  const db = getDb();
  console.log('[Export] Running historical analysis on SQLite database...');
  const analysisResult = analyzeHistory(db);
  db.close();

  const outPath = path.resolve(__dirname, '../frontend/public/data/history_data.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(analysisResult, null, 2), 'utf-8');

  console.log(`[Export] Successfully exported history analysis (${analysisResult.totalEvents} events) to ${outPath}`);
  return analysisResult;
}

if (require.main === module) {
  exportData();
}

module.exports = {
  exportData
};
