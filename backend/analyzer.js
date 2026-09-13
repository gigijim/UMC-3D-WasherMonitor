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

function calculateHeatmapAndHourly(events) {
  const heatGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dayLabels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  for (const ev of events) {
    const { day, hour } = getTaipeiDayAndHour(ev.start_time);
    heatGrid[day][hour] += ev.duration_min;
  }

  let maxCell = 1;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (heatGrid[d][h] > maxCell) maxCell = heatGrid[d][h];
    }
  }

  const normalizedHeatmap = [];
  for (let d = 0; d < 7; d++) {
    const row = [];
    for (let h = 0; h < 24; h++) {
      const val = heatGrid[d][h];
      const rate = Math.min(100, Math.round((val / maxCell) * 100));
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

  const hourSlots = hourlyAverages.map((rate, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00 ~ ${String((h + 1) % 24).padStart(2, '0')}:00`,
    rate
  })).sort((a, b) => a.rate - b.rate);

  const bestTimeWindows = hourSlots.slice(0, 4);

  return {
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

  // 2. All events
  const events = db.prepare(`SELECT hwid, start_time, duration_min, machine_type, floor, estimated_cost FROM usage_events`).all();

  // 3. Overall building analytics
  const overallAnalysis = calculateHeatmapAndHourly(events);

  // 4. By Floor analytics (2F, 4F, 6F, 8F)
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
    const fAnalysis = calculateHeatmapAndHourly(fEvents);
    const fMachines = machineStats.filter((m) => m.floor === f);

    byFloor[f] = {
      floor: f,
      totalCycles: floorMap[f].cycles,
      durationMin: floorMap[f].durationMin,
      cost: floorMap[f].cost,
      washerCycles: floorMap[f].washerCycles,
      dryerCycles: floorMap[f].dryerCycles,
      machines: fMachines,
      ...fAnalysis
    };
  }

  // 5. By Machine individual analytics (all 24 machines)
  const byMachine = {};
  for (const m of machineStats) {
    const mEvents = events.filter((e) => e.hwid === m.hwid);
    const mAnalysis = calculateHeatmapAndHourly(mEvents);
    byMachine[m.hwid] = {
      hwid: m.hwid,
      description: m.description,
      floor: m.floor,
      type: m.machine_type,
      num: m.machine_num,
      totalCycles: m.total_cycles,
      totalDurationMin: m.total_duration_min,
      totalCost: m.total_cost_ntd,
      ...mAnalysis
    };
  }

  // 6. Ranking: Top 5 Busiest & Top 5 Coldest
  const sortedByUsage = [...machineStats].sort((a, b) => b.total_cycles - a.total_cycles);
  const busiestMachines = sortedByUsage.slice(0, 5);
  const coldestMachines = [...sortedByUsage].reverse().slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    floorComparison: Object.values(floorMap),
    overall: overallAnalysis,
    byFloor,
    byMachine,
    machineStats,
    busiestMachines,
    coldestMachines,
    // Backwards compatibility for existing keys
    heatmap: overallAnalysis.heatmap,
    hourlyAverages: overallAnalysis.hourlyAverages,
    bestTimeWindows: overallAnalysis.bestTimeWindows
  };
}

module.exports = {
  analyzeHistory
};
