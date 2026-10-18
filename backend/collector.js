const { DATA_DIR, getDb, initDb, upsertDevice } = require('./db');
const { createEventDetector } = require('./events');
const { toRealtimeDevice, summarize } = require('../shared/device');
const fs = require('node:fs');
const path = require('node:path');

const PLACE_ID = '67359cb42f71210375a69599';
const API_URL = 'https://app.alfaloop.com/ndr/fn/api/v1/web';

async function fetchPlaceStatus(retries = 3, delay = 2000) {
  const ts = Math.floor(Date.now() / 1000);
  const url = `${API_URL}?tz=Asia/Taipei&timestamp=${ts}`;

  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          action: 'checkoutPlaceStatus',
          placeId: PLACE_ID
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data?.message?.result?.toLowerCase() === 'ok') {
        return data.message.place;
      } else {
        throw new Error(`API returned non-ok result: ${JSON.stringify(data?.message || data)}`);
      }
    } catch (err) {
      console.warn(`[Collector] Attempt ${i + 1}/${retries} failed: ${err.message}`);
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

async function collectOnce(options = { exportRealtime: true }) {
  initDb();
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  console.log(`[Collector] Starting crawl at ${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}...`);
  const placeData = await fetchPlaceStatus();
  const devices = (placeData.devices || []).filter((d) => !d.testmode);
  const realtimeList = devices.map((d) => toRealtimeDevice(d, nowMs));
  const summary = summarize(realtimeList);
  const eventResults = { new: 0, extend: 0, adjust: 0 };
  let snapshotCount = 0;

  const db = getDb();
  const detectEvent = createEventDetector(db);

  const lastSnapshotStmt = db.prepare(`
    SELECT connection, is_running, due_time FROM device_snapshots
    WHERE hwid = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `);

  const insertSnapshotStmt = db.prepare(`
    INSERT INTO device_snapshots (timestamp, hwid, connection, is_running, due_time, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    // Record crawl count in system_config
    db.prepare(`
      INSERT INTO system_config (key, value) VALUES ('crawl_count', '1')
      ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
    `).run();

    for (let i = 0; i < devices.length; i++) {
      const rt = realtimeList[i];
      upsertDevice(db, devices[i]);

      const machine = { hwid: rt.hwid, floor: rt.floor, machine_type: rt.type, machine_num: rt.num };
      const result = detectEvent(machine, rt, nowMs);
      if (result) eventResults[result]++;

      // 只在機台狀態（連線 / 運轉 / dueTime）改變時寫入快照，避免資料庫無限膨脹
      const connection = rt.connection ? 1 : 0;
      const isRunning = rt.isRunning ? 1 : 0;
      const last = lastSnapshotStmt.get(rt.hwid);
      if (!last || last.connection !== connection || last.is_running !== isRunning || last.due_time !== rt.dueTime) {
        insertSnapshotStmt.run(nowIso, rt.hwid, connection, isRunning, rt.dueTime, rt.remainingSec);
        snapshotCount++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  db.close();

  console.log(`[Collector] Finished crawl. Total: ${summary.total}, Running: ${summary.running}, Idle: ${summary.idle}, Offline: ${summary.offline}, New Events: ${eventResults.new}, Extended: ${eventResults.extend}, Adjusted: ${eventResults.adjust}, Snapshots: ${snapshotCount}`);

  if (options.exportRealtime) {
    const realtimePayload = {
      updatedAt: nowIso,
      summary,
      merchant: placeData.merchant,
      place: {
        title: placeData.title,
        address: placeData.address
      },
      devices: realtimeList
    };

    const outPath = path.join(DATA_DIR, 'realtime_latest.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(realtimePayload), 'utf-8');
  }

  return {
    ...summary,
    newEventsCount: eventResults.new
  };
}

if (require.main === module) {
  collectOnce().catch((err) => {
    console.error('[Collector] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  collectOnce,
  fetchPlaceStatus
};
