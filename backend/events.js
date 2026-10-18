const { calculateCost, DRYER_MAX_MIN } = require('../shared/pricing');
const { getTrackingStartTime } = require('./db');

const MIN_MS = 60 * 1000;
const DEFAULT_DURATION_MIN = 40;

// 烘衣機第一次看到運轉時，以剩餘時間推估購買時長（20 分一級，最多 99 分）
function estimateDryerDuration(remainingSec) {
  const mins = Math.round(remainingSec / 60);
  if (mins <= 20) return 20;
  if (mins <= 40) return 40;
  if (mins <= 60) return 60;
  if (mins <= 80) return 80;
  return DRYER_MAX_MIN;
}

/**
 * 基於 IoT 設備 dueTime 戳記的使用事件偵測（爬蟲即時偵測與歷史重算共用）
 *
 * 判斷規則：
 * - 新的 dueTime 且上一輪已結束 → 新增事件（含爬蟲間隔中剛好洗完的離線自癒補登）
 * - 上一輪尚未結束、dueTime 只差 1 分鐘內 → 時間微調，僅更新結束時間
 * - 洗衣機上一輪剩 ≤ 5 分、新剩餘 ≥ 30 分 → 上一輪提早結束、下一位開始洗 → 新增事件
 * - 洗衣機其他變動 → 機台校正剩餘時間，同一次使用，僅更新結束時間
 * - 烘衣機 dueTime 變晚 → 投幣加時，合併為同一次：時長與金額皆「累加」本次加購的部分
 *   （99 分是單次購買 / 機台剩餘時間的上限，不是整次使用的上限，累計時長不截斷）
 *
 * @returns {Function} detect(machine, state, nowMs) → 'new' | 'extend' | 'adjust' | null
 */
function createEventDetector(db) {
  const trackingStartMs = new Date(getTrackingStartTime(db)).getTime();

  const lastEventStmt = db.prepare(`
    SELECT id, start_time, end_time, duration_min, estimated_cost FROM usage_events
    WHERE hwid = ?
    ORDER BY end_time DESC
    LIMIT 1
  `);

  const insertEventStmt = db.prepare(`
    INSERT INTO usage_events (hwid, floor, machine_type, machine_num, start_time, end_time, duration_min, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateEventStmt = db.prepare(`
    UPDATE usage_events SET end_time = ?, duration_min = ?, estimated_cost = ? WHERE id = ?
  `);

  const updateEndStmt = db.prepare(`
    UPDATE usage_events SET end_time = ? WHERE id = ?
  `);

  return function detect(machine, { dueTime, isRunning, remainingSec }, nowMs) {
    if (!dueTime) return null;
    const dueMs = new Date(dueTime).getTime();
    if (dueMs <= trackingStartMs) return null;

    const last = lastEventStmt.get(machine.hwid);
    if (last && last.end_time === dueTime) return null;

    if (last) {
      const lastEndMs = new Date(last.end_time).getTime();
      const lastStartMs = new Date(last.start_time).getTime();
      const prevStillRunning = lastEndMs > nowMs;

      if (prevStillRunning && Math.abs(dueMs - lastEndMs) < MIN_MS) {
        updateEndStmt.run(dueTime, last.id);
        return 'adjust';
      }

      if (prevStillRunning && dueMs > lastEndMs) {
        if (machine.machine_type === 'dryer') {
          const extendMin = Math.round((dueMs - lastEndMs) / MIN_MS);
          const durationMin = last.duration_min + extendMin;
          const cost = last.estimated_cost + calculateCost(machine, Math.min(DRYER_MAX_MIN, extendMin));
          updateEventStmt.run(dueTime, durationMin, cost, last.id);
          return 'extend';
        }

        const prevRemainingMin = (lastEndMs - nowMs) / MIN_MS;
        const newRemainingMin = (dueMs - nowMs) / MIN_MS;
        const isNextUser = prevRemainingMin <= 5 && newRemainingMin >= 30;
        if (!isNextUser) {
          updateEndStmt.run(dueTime, last.id);
          return 'adjust';
        }
      }

      // dueTime 比上一筆還早：運轉中被縮短則更新，否則為過期資料直接忽略
      if (dueMs < lastEndMs) {
        if (prevStillRunning && dueMs > lastStartMs) {
          updateEndStmt.run(dueTime, last.id);
          return 'adjust';
        }
        return null;
      }
    }

    let durationMin = DEFAULT_DURATION_MIN;
    if (machine.machine_type === 'dryer' && isRunning && remainingSec > 0) {
      durationMin = estimateDryerDuration(remainingSec);
    }

    insertEventStmt.run(
      machine.hwid,
      machine.floor,
      machine.machine_type,
      machine.machine_num,
      new Date(dueMs - durationMin * MIN_MS).toISOString(),
      dueTime,
      durationMin,
      calculateCost(machine, durationMin),
      new Date(nowMs).toISOString()
    );
    return 'new';
  };
}

module.exports = {
  createEventDetector,
  estimateDryerDuration
};
