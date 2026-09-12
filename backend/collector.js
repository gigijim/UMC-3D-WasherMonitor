const { getDb, initDb, upsertDevice, parseDeviceInfo, calculateCost } = require('./db');
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
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();

  console.log(`[Collector] Starting crawl at ${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}...`);
  const placeData = await fetchPlaceStatus();
  const devices = (placeData.devices || []).filter((d) => !d.testmode);

  let runningCount = 0;
  let idleCount = 0;
  let offlineCount = 0;
  let newEventsCount = 0;

  const realtimeList = [];

  const getRecentSnapshotStmt = db.prepare(`
    SELECT is_running, due_time, timestamp 
    FROM device_snapshots 
    WHERE hwid = ? 
    ORDER BY id DESC LIMIT 1
  `);

  const insertSnapshotStmt = db.prepare(`
    INSERT INTO device_snapshots (timestamp, hwid, connection, is_running, due_time, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertEventStmt = db.prepare(`
    INSERT INTO usage_events (hwid, floor, machine_type, machine_num, start_time, end_time, duration_min, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const device of devices) {
    upsertDevice(db, device);

    const connection = device.connection ? 1 : 0;
    const dueTime = device.modelStatus?.operationStatus?.dueTime || null;
    let remainingSec = 0;
    let isRunning = 0;

    if (connection && dueTime) {
      const dueTimestamp = new Date(dueTime).getTime();
      remainingSec = Math.max(0, Math.floor((dueTimestamp - now.getTime()) / 1000));
      if (remainingSec > 0) {
        isRunning = 1;
      }
    }

    if (!connection) {
      offlineCount++;
    } else if (isRunning) {
      runningCount++;
    } else {
      idleCount++;
    }

    // Check state transition for event detection
    const lastSnap = getRecentSnapshotStmt.get(device.hwid);
    const { floor, machine_type, machine_num } = parseDeviceInfo(device.description);

    if (isRunning) {
      // If previously idle, or dueTime changed/extended forward by more than 5 minutes
      const prevDueTime = lastSnap?.due_time;
      const prevRunning = lastSnap?.is_running || 0;

      const isNewCycle = !prevRunning || (prevDueTime && dueTime && new Date(dueTime).getTime() - new Date(prevDueTime).getTime() > 5 * 60 * 1000);

      if (isNewCycle) {
        let durationMin = 40;
        if (machine_type === 'dryer') {
          // calculate remaining duration from dueTime
          const mins = Math.round(remainingSec / 60);
          if (mins <= 20) durationMin = 20;
          else if (mins <= 40) durationMin = 40;
          else if (mins <= 60) durationMin = 60;
          else if (mins <= 80) durationMin = 80;
          else durationMin = 99;
        }

        const startTime = new Date(new Date(dueTime).getTime() - durationMin * 60 * 1000).toISOString();
        const cost = calculateCost(machine_type, durationMin);

        insertEventStmt.run(
          device.hwid,
          floor,
          machine_type,
          machine_num,
          startTime,
          dueTime,
          durationMin,
          cost,
          nowIso
        );
        newEventsCount++;
      }
    }

    // Insert snapshot
    insertSnapshotStmt.run(
      nowIso,
      device.hwid,
      connection,
      isRunning,
      dueTime,
      remainingSec
    );

    realtimeList.push({
      hwid: device.hwid,
      vendorHwid: device.vendorHwid,
      description: device.description,
      floor,
      type: machine_type,
      num: machine_num,
      connection: Boolean(connection),
      isRunning: Boolean(isRunning),
      dueTime,
      remainingSec
    });
  }

  db.close();

  console.log(`[Collector] Finished crawl. Total: ${devices.length}, Running: ${runningCount}, Idle: ${idleCount}, Offline: ${offlineCount}, New Events: ${newEventsCount}`);

  if (options.exportRealtime) {
    const realtimePayload = {
      updatedAt: nowIso,
      summary: {
        total: devices.length,
        running: runningCount,
        idle: idleCount,
        offline: offlineCount
      },
      merchant: placeData.merchant,
      place: {
        title: placeData.title,
        address: placeData.address
      },
      devices: realtimeList
    };

    const outPath = path.resolve(__dirname, '../frontend/public/data/realtime_latest.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(realtimePayload, null, 2), 'utf-8');
  }

  return {
    total: devices.length,
    running: runningCount,
    idle: idleCount,
    offline: offlineCount,
    newEventsCount
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
