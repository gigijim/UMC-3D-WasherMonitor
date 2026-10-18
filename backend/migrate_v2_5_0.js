// v2.5.0 一次性資料遷移
// 1. 以新版事件偵測規則（投幣加時合併、洗衣機時間校正、機台個別計價）重播全部快照，重算使用紀錄
// 2. 壓縮快照：每台機台只保留狀態改變的那一筆（無損，第 1 步的重算結果在壓縮前後必須完全一致）
// 3. VACUUM 縮小資料庫檔案
//
// 用法：node backend/migrate_v2_5_0.js（以 LAUNDRY_DATA_DIR 指定資料目錄，預設 backend/）
const { DB_PATH, getDb, initDb } = require('./db');
const { createEventDetector } = require('./events');
const fs = require('node:fs');

const EVENT_COLUMNS = 'hwid, start_time, end_time, duration_min, estimated_cost';

function summarizeEvents(db) {
  const total = db.prepare(`
    SELECT COUNT(*) AS events, COALESCE(SUM(estimated_cost), 0) AS cost, COALESCE(SUM(duration_min), 0) AS minutes
    FROM usage_events
  `).get();
  const byFloorType = db.prepare(`
    SELECT floor, machine_type, COUNT(*) AS events, SUM(estimated_cost) AS cost
    FROM usage_events GROUP BY floor, machine_type ORDER BY floor, machine_type DESC
  `).all();
  return { ...total, byFloorType };
}

function replayEvents(db) {
  const devices = new Map(db.prepare('SELECT hwid, floor, machine_type, machine_num, description FROM devices').all().map((d) => [d.hwid, d]));
  const snapshots = db.prepare(`
    SELECT timestamp, hwid, connection, is_running, due_time, remaining_sec
    FROM device_snapshots ORDER BY timestamp, id
  `).all();

  db.exec('DELETE FROM usage_events');
  const detect = createEventDetector(db);
  const merged = [];

  for (const s of snapshots) {
    const machine = devices.get(s.hwid);
    if (!machine) continue;
    const result = detect(
      machine,
      { dueTime: s.due_time, isRunning: Boolean(s.is_running), remainingSec: s.remaining_sec || 0 },
      new Date(s.timestamp).getTime()
    );
    if (result === 'extend' || result === 'adjust') {
      merged.push({ result, machine: machine.description, at: s.timestamp, dueTime: s.due_time });
    }
  }

  const events = db.prepare(`SELECT ${EVENT_COLUMNS} FROM usage_events ORDER BY hwid, end_time`).all();
  return { snapshots: snapshots.length, merged, events };
}

function compactSnapshots(db) {
  const result = db.prepare(`
    DELETE FROM device_snapshots WHERE id IN (
      SELECT id FROM (
        SELECT id, connection, is_running, due_time,
          LAG(connection) OVER w AS prev_connection,
          LAG(is_running) OVER w AS prev_running,
          LAG(due_time) OVER w AS prev_due,
          ROW_NUMBER() OVER w AS rn
        FROM device_snapshots
        WINDOW w AS (PARTITION BY hwid ORDER BY timestamp, id)
      )
      WHERE rn > 1
        AND connection = prev_connection
        AND is_running = prev_running
        AND due_time IS prev_due
    )
  `).run();
  return result.changes;
}

function formatTaipei(iso) {
  return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function migrate() {
  initDb();
  const sizeBefore = fs.statSync(DB_PATH).size;
  const db = getDb();
  const before = summarizeEvents(db);

  db.exec('BEGIN');
  let first;
  let removed;
  try {
    first = replayEvents(db);
    removed = compactSnapshots(db);
    const second = replayEvents(db);

    if (JSON.stringify(first.events) !== JSON.stringify(second.events)) {
      throw new Error('快照壓縮後重算結果不一致，已取消遷移（資料庫未變更）');
    }

    db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('schema_version', '2.5.0')`).run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  db.exec('VACUUM');
  const after = summarizeEvents(db);
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM device_snapshots').get().c;
  db.close();
  const sizeAfter = fs.statSync(DB_PATH).size;

  console.log('=== v2.5.0 資料遷移完成 ===');
  console.log(`快照：${first.snapshots} → ${remaining} 筆（刪除 ${removed} 筆重複狀態，重算結果驗證一致）`);
  console.log(`資料庫大小：${(sizeBefore / 1048576).toFixed(2)} MB → ${(sizeAfter / 1048576).toFixed(2)} MB`);
  console.log(`使用紀錄：${before.events} → ${after.events} 筆`);
  console.log(`估計營收：NT$${before.cost} → NT$${after.cost}`);
  console.log(`使用時長：${before.minutes} → ${after.minutes} 分鐘`);
  console.log('\n各樓層 / 機型（重算前 → 重算後）：');
  for (const row of after.byFloorType) {
    const old = before.byFloorType.find((b) => b.floor === row.floor && b.machine_type === row.machine_type) || { events: 0, cost: 0 };
    console.log(`  ${row.floor} ${row.machine_type.padEnd(6)} 次數 ${old.events} → ${row.events}，金額 NT$${old.cost} → NT$${row.cost}`);
  }
  console.log(`\n合併為同一次使用的紀錄（${first.merged.length} 筆）：`);
  for (const m of first.merged) {
    const label = m.result === 'extend' ? '投幣加時' : '時間校正';
    console.log(`  ${label}  ${m.machine}  ${formatTaipei(m.at)}  新結束時間 ${formatTaipei(m.dueTime)}`);
  }
}

if (require.main === module) {
  try {
    migrate();
  } catch (err) {
    console.error('[Migrate] 失敗:', err.message);
    process.exit(1);
  }
}

module.exports = {
  migrate
};
