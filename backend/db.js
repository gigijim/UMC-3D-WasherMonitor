const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'laundry.db');

function getDb() {
  const db = new DatabaseSync(DB_PATH);
  return db;
}

function initDb() {
  const db = getDb();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      hwid TEXT PRIMARY KEY,
      vendor_hwid TEXT,
      floor TEXT,
      machine_type TEXT,
      machine_num INTEGER,
      description TEXT,
      model TEXT,
      last_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS device_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      hwid TEXT NOT NULL,
      connection INTEGER NOT NULL,
      is_running INTEGER NOT NULL,
      due_time TEXT,
      remaining_sec INTEGER,
      FOREIGN KEY (hwid) REFERENCES devices (hwid)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_hwid_time 
    ON device_snapshots (hwid, timestamp);

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hwid TEXT NOT NULL,
      floor TEXT NOT NULL,
      machine_type TEXT NOT NULL,
      machine_num INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      estimated_cost INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (hwid) REFERENCES devices (hwid)
    );

    CREATE INDEX IF NOT EXISTS idx_events_start_time 
    ON usage_events (start_time);

    CREATE INDEX IF NOT EXISTS idx_events_floor_type 
    ON usage_events (floor, machine_type);

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.close();
}

function parseDeviceInfo(description) {
  let floor = 'Unknown';
  let machine_type = 'unknown';
  let machine_num = 1;

  for (const f of ['2F', '4F', '6F', '8F']) {
    if (description.includes(f)) {
      floor = f;
      break;
    }
  }

  if (description.includes('洗')) {
    machine_type = 'washer';
  } else if (description.includes('烘')) {
    machine_type = 'dryer';
  }

  const match = description.match(/(\d+)號/);
  if (match) {
    machine_num = parseInt(match[1], 10);
  }

  return { floor, machine_type, machine_num };
}

function upsertDevice(db, device) {
  const { floor, machine_type, machine_num } = parseDeviceInfo(device.description);
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO devices (hwid, vendor_hwid, floor, machine_type, machine_num, description, model, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hwid) DO UPDATE SET
      vendor_hwid = excluded.vendor_hwid,
      floor = excluded.floor,
      machine_type = excluded.machine_type,
      machine_num = excluded.machine_num,
      description = excluded.description,
      model = excluded.model,
      last_updated = excluded.last_updated
  `);

  stmt.run(
    device.hwid,
    device.vendorHwid || '',
    floor,
    machine_type,
    machine_num,
    device.description,
    device.model || 'alfabox_v2_wifi',
    now
  );
}

function calculateCost(machineType, durationMin) {
  if (machineType === 'washer') {
    const cycles = Math.max(1, Math.round(durationMin / 40));
    return cycles * 20;
  } else {
    // 烘衣機: 10元20分, 20元40分, 30元60分, 40元80分, 50元99分
    if (durationMin <= 25) return 10;
    if (durationMin <= 45) return 20;
    if (durationMin <= 65) return 30;
    if (durationMin <= 85) return 40;
    return 50;
  }
}

function getTrackingStartTime(db) {
  try {
    const row = db.prepare(`SELECT value FROM system_config WHERE key = 'tracking_start_time'`).get();
    if (row && row.value) {
      return row.value;
    }
  } catch (err) {
    // table might be initializing
  }
  const defaultEpoch = '2026-09-12T21:00:00.000Z'; // 2026/09/13 05:00 AM (開始採集真實數據的基準點)
  try {
    db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('tracking_start_time', ?)`).run(defaultEpoch);
  } catch (err) {}
  return defaultEpoch;
}

function setTrackingStartTime(db, isoString) {
  db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('tracking_start_time', ?)`).run(isoString);
}

module.exports = {
  DB_PATH,
  getDb,
  initDb,
  parseDeviceInfo,
  upsertDevice,
  calculateCost,
  getTrackingStartTime,
  setTrackingStartTime
};
