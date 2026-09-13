// Asia/Taipei is strictly UTC+8 year-round with no DST
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function getTaipeiDayAndHour(isoStringOrDate) {
  const utcMs = new Date(isoStringOrDate).getTime();
  const taipeiDate = new Date(utcMs + TAIPEI_OFFSET_MS);
  return {
    day: taipeiDate.getUTCDay(),
    hour: taipeiDate.getUTCHours()
  };
}

/**
 * Calculate weekly heatmap and hourly averages based on physical machine capacity denominator.
 * @param {Array} events - List of usage events
 * @param {number} capacityCount - Number of machines in this scope (e.g. 4 for floor washer, 2 for dryer, 16 for building washer)
 */
function calculateHeatmapAndHourly(events, capacityCount = 1) {
  const heatGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dayLabels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  for (const ev of events) {
    const { day, hour } = getTaipeiDayAndHour(ev.start_time);
    heatGrid[day][hour] += ev.duration_min;
  }

  // Determine observed weeks span
  let observedWeeks = 1;
  if (events.length > 0) {
    const timestamps = events.map((e) => new Date(e.start_time).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const spanDays = Math.max(1, (maxTime - minTime) / (1000 * 60 * 60 * 24));
    observedWeeks = Math.max(1, Math.ceil(spanDays / 7));
  }

  // True physical capacity denominator per 1-hour slot: (capacityCount * 60 min * observedWeeks)
  const slotCapacityMinutes = Math.max(60, capacityCount * 60 * observedWeeks);

  const normalizedHeatmap = [];
  for (let d = 0; d < 7; d++) {
    const row = [];
    for (let h = 0; h < 24; h++) {
      const val = heatGrid[d][h];
      const rate = Math.min(100, Math.round((val / slotCapacityMinutes) * 100));
      row.push(rate);
    }
    normalizedHeatmap.push({
      dayIndex: d,
      dayName: dayLabels[d],
      hours: row
    });
  }

  const hourlyAverages = Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let d = 0; d < 7; d++) {
      sum += normalizedHeatmap[d].hours[h];
    }
    hourlyAverages[h] = Math.round(sum / 7);
  }

  // 宿舍生活公約規範：僅在合法營運時段 08:00 ~ 24:00 運算推薦最佳離峰時段（嚴格排除 00:00 ~ 08:00 夜間安寧區間）
  const legalHourSlots = [];
  for (let h = 8; h < 24; h++) {
    legalHourSlots.push({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00 ~ ${String((h + 1) % 24).padStart(2, '0')}:00`,
      rate: hourlyAverages[h]
    });
  }
  legalHourSlots.sort((a, b) => a.rate - b.rate);
  const bestTimeWindows = legalHourSlots.slice(0, 4);

  return {
    capacityCount,
    heatmap: normalizedHeatmap,
    hourlyAverages,
    bestTimeWindows
  };
}

function analyzeHistory(db) {
  // 1. Machine general metrics
  const machinesStmt = db.prepare(`
    SELECT 
      d.hwid,
      d.description,
      d.floor,
      d.machine_type,
      d.machine_num,
      COUNT(e.id) as total_cycles,
      COALESCE(SUM(e.duration_min), 0) as total_duration_min,
      COALESCE(SUM(e.estimated_cost), 0) as total_cost_ntd
    FROM devices d
    LEFT JOIN usage_events e ON d.hwid = e.hwid
    GROUP BY d.hwid
    ORDER BY d.floor ASC, d.machine_type DESC, d.machine_num ASC
  `);
  const machineStats = machinesStmt.all();

  // 1.1 Query latest online/offline connection state to protect coldest recommendations
  let connectionMap = {};
  try {
    const latestConnections = db.prepare(`
      SELECT hwid, connection FROM device_snapshots 
      WHERE timestamp = (SELECT MAX(timestamp) FROM device_snapshots)
    `).all();
    connectionMap = Object.fromEntries(latestConnections.map((c) => [c.hwid, c.connection === 1]));
  } catch (err) {
    // fallback
  }

  for (const m of machineStats) {
    m.isOnline = connectionMap[m.hwid] !== false;
  }

  // 2. All events
  const events = db.prepare(`SELECT hwid, start_time, duration_min, machine_type, floor, estimated_cost FROM usage_events`).all();
  const washEvents = events.filter((e) => e.machine_type === 'washer');
  const dryEvents = events.filter((e) => e.machine_type === 'dryer');

  // 3. Overall building analytics (分母：洗16台、烘8台、全棟24台)
  const overallWash = calculateHeatmapAndHourly(washEvents, 16);
  const overallDry = calculateHeatmapAndHourly(dryEvents, 8);
  const overallCombined = calculateHeatmapAndHourly(events, 24);

  const overallAnalysis = {
    wash: overallWash,
    dry: overallDry,
    combined: overallCombined,
    // Default compatibility
    heatmap: overallCombined.heatmap,
    hourlyAverages: overallCombined.hourlyAverages,
    bestTimeWindows: overallCombined.bestTimeWindows
  };

  // 4. By Floor analytics (2F, 4F, 6F, 8F - 各層分母：洗4台、烘2台、合6台)
  const floorList = ['2F', '4F', '6F', '8F'];
  const byFloor = {};
  const floorMap = {
    '2F': { floor: '2F', cycles: 0, durationMin: 0, cost: 0, washerCycles: 0, dryerCycles: 0 },
    '4F': { floor: '4F', cycles: 0, durationMin: 0, cost: 0, washerCycles: 0, dryerCycles: 0 },
    '6F': { floor: '6F', cycles: 0, durationMin: 0, cost: 0, washerCycles: 0, dryerCycles: 0 },
    '8F': { floor: '8F', cycles: 0, durationMin: 0, cost: 0, washerCycles: 0, dryerCycles: 0 }
  };

  for (const m of machineStats) {
    if (floorMap[m.floor]) {
      floorMap[m.floor].cycles += m.total_cycles;
      floorMap[m.floor].durationMin += m.total_duration_min;
      floorMap[m.floor].cost += m.total_cost_ntd;
      if (m.machine_type === 'washer') {
        floorMap[m.floor].washerCycles += m.total_cycles;
      } else {
        floorMap[m.floor].dryerCycles += m.total_cycles;
      }
    }
  }

  for (const f of floorList) {
    const fEvents = events.filter((e) => e.floor === f);
    const fWashEvents = fEvents.filter((e) => e.machine_type === 'washer');
    const fDryEvents = fEvents.filter((e) => e.machine_type === 'dryer');

    const fWashAnalysis = calculateHeatmapAndHourly(fWashEvents, 4);
    const fDryAnalysis = calculateHeatmapAndHourly(fDryEvents, 2);
    const fCombinedAnalysis = calculateHeatmapAndHourly(fEvents, 6);
    const fMachines = machineStats.filter((m) => m.floor === f);

    byFloor[f] = {
      floor: f,
      totalCycles: floorMap[f].cycles,
      durationMin: floorMap[f].durationMin,
      cost: floorMap[f].cost,
      washerCycles: floorMap[f].washerCycles,
      dryerCycles: floorMap[f].dryerCycles,
      machines: fMachines,
      wash: fWashAnalysis,
      dry: fDryAnalysis,
      combined: fCombinedAnalysis,
      // Default compatibility
      ...fCombinedAnalysis
    };
  }

  // 5. By Machine individual analytics (all 24 machines)
  const byMachine = {};
  const washersOnly = machineStats.filter((m) => m.machine_type === 'washer').sort((a, b) => b.total_cycles - a.total_cycles);
  const dryersOnly = machineStats.filter((m) => m.machine_type === 'dryer').sort((a, b) => b.total_cycles - a.total_cycles);

  for (const m of machineStats) {
    const mEvents = events.filter((e) => e.hwid === m.hwid);
    const mAnalysis = calculateHeatmapAndHourly(mEvents, 1);

    // Calculate ranking within its equipment peer group
    const peerList = m.machine_type === 'washer' ? washersOnly : dryersOnly;
    const rankInType = peerList.findIndex((p) => p.hwid === m.hwid) + 1;
    const totalInType = peerList.length;

    // Average session duration
    const avgDurationMin = m.total_cycles > 0 ? Math.round(m.total_duration_min / m.total_cycles) : (m.machine_type === 'dryer' ? 40 : 40);

    // Identify top 3 peak hours for this machine (in legal hours 08:00 ~ 24:00)
    const peakSlots = Array.from({ length: 16 }, (_, i) => {
      const h = i + 8;
      return {
        hour: h,
        rate: mAnalysis.hourlyAverages[h] || 0,
        label: `${String(h).padStart(2, '0')}:00 ~ ${String((h + 1) % 24).padStart(2, '0')}:00`
      };
    }).sort((a, b) => b.rate - a.rate).slice(0, 3);

    byMachine[m.hwid] = {
      hwid: m.hwid,
      description: m.description,
      floor: m.floor,
      type: m.machine_type,
      num: m.machine_num,
      isOnline: m.isOnline,
      totalCycles: m.total_cycles,
      totalDurationMin: m.total_duration_min,
      totalCost: m.total_cost_ntd,
      avgDurationMin,
      rankInType,
      totalInType,
      peakSlots,
      ...mAnalysis
    };
  }

  // 6. Ranking: Top 5 Busiest & Top 5 Coldest (嚴格過濾離線機台，防止將故障機台推薦為冷門好選擇)
  const onlineMachines = machineStats.filter((m) => m.isOnline);
  const sortedOnlineByUsage = [...onlineMachines].sort((a, b) => b.total_cycles - a.total_cycles);
  const busiestMachines = sortedOnlineByUsage.slice(0, 5);
  const coldestMachines = [...sortedOnlineByUsage].reverse().slice(0, 5);

  // 7. Crawl updates count
  const countRow = db.prepare(`SELECT value FROM system_config WHERE key = 'crawl_count'`).get();
  const distinctSnapshots = db.prepare(`SELECT COUNT(DISTINCT timestamp) as c FROM device_snapshots`).get();
  const crawlCount = countRow ? parseInt(countRow.value, 10) : (distinctSnapshots?.c || 1);

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    crawlCount,
    floorComparison: Object.values(floorMap),
    overall: overallAnalysis,
    byFloor,
    byMachine,
    machineStats,
    busiestMachines,
    coldestMachines,
    // Backwards compatibility for existing keys
    heatmap: overallCombined.heatmap,
    hourlyAverages: overallCombined.hourlyAverages,
    bestTimeWindows: overallCombined.bestTimeWindows
  };
}

module.exports = {
  analyzeHistory
};
