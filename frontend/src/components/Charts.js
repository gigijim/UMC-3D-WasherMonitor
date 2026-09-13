import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

let mainChartInstance = null;
let secondaryChartInstance = null;

// Active UI States
let currentScope = 'floor';   // 'floor' | 'overall' | 'machine' (default 'floor' as requested)
let selectedFloor = '2F';     // '2F' | '4F' | '6F' | '8F'
let selectedHwid = null;
let equipmentType = 'combined'; // 'combined' | 'wash' | 'dry'
let activeData = null;
let cachedFloorRanking = [];
let cachedTopMachineHwid = null;

function formatSyncTime(isoStr) {
  if (!isoStr) return '最新';
  const target = new Date(isoStr);
  const now = new Date();

  const getTaipeiDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d);
  const isToday = getTaipeiDate(target) === getTaipeiDate(now);

  const formatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit'
  });
  const timeStr = formatter.format(target);
  const prefix = isToday ? '今天' : `${target.getMonth() + 1}月${target.getDate()}日 `;
  return `${prefix}${timeStr}分`;
}

function formatLastUsedSimple(timestamp) {
  if (!timestamp) return '尚無紀錄';
  const target = new Date(timestamp);
  if (isNaN(target.getTime())) return '尚無紀錄';
  const now = new Date();
  const diffMin = Math.max(0, Math.floor((now.getTime() - target.getTime()) / 60000));

  const getTaipeiDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d);
  const isToday = getTaipeiDate(target) === getTaipeiDate(now);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const isYesterday = getTaipeiDate(target) === getTaipeiDate(yesterday);

  const timeFormatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit'
  });
  const timeStr = timeFormatter.format(target);
  const prefix = isToday ? '今天 ' : isYesterday ? '昨天 ' : `${target.getMonth() + 1}/${target.getDate()} `;
  const relStr = diffMin < 60 ? `${diffMin}分前` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}小時前` : `${Math.floor(diffMin / 1440)}天前`;
  return `${prefix}${timeStr} (${relStr})`;
}

export function renderAnalytics(data, containerEl, options = {}) {
  activeData = data;
  if (!data) {
    containerEl.innerHTML = '<div class="p-8 text-center text-slate-400">目前尚無足夠的歷史數據。</div>';
    return;
  }

  // 1. Calculate floor ranking across all 4 floors
  const floorRanking = ['8F', '6F', '4F', '2F'].map((f) => {
    const fData = data.byFloor?.[f] || {};
    return {
      floor: f,
      cycles: fData.totalCycles || 0,
      washerCycles: fData.washerCycles || 0,
      dryerCycles: fData.dryerCycles || 0,
      durationMin: fData.durationMin || 0,
      cost: fData.cost || 0
    };
  }).sort((a, b) => b.cycles - a.cycles);
  floorRanking.forEach((fr, idx) => {
    fr.rank = idx + 1;
    fr.medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4️⃣';
  });
  cachedFloorRanking = floorRanking;

  const topFloor = floorRanking[0]?.floor || '2F';

  // 2. Find machine with highest usage
  const sortedMachinesByUsage = [...(data.machineStats || [])].sort((a, b) => (b.total_cycles || 0) - (a.total_cycles || 0));
  const topMachineHwid = sortedMachinesByUsage[0]?.hwid || null;
  cachedTopMachineHwid = topMachineHwid;

  // 3~5: Determine scope, floor and machine selections (Requirements 3, 4, 5)
  if (!options.preserveState) {
    // 3. Set current scope (Requirement 3: 預設選樓層分析)
    currentScope = options.scope || 'floor';

    // 4. Set selected floor (Requirement 4: 預設選擇使用率最高的樓層)
    selectedFloor = options.floor || topFloor;

    // 5. Set selected machine (Requirement 5: 預設選擇最高使用率的機台)
    selectedHwid = options.hwid || topMachineHwid;
  } else {
    if (options.scope) currentScope = options.scope;
    if (options.floor) selectedFloor = options.floor;
    if (options.hwid) selectedHwid = options.hwid;
  }

  const syncTimeStr = formatSyncTime(data.generatedAt);
  const crawlCount = data.crawlCount || 1;
  const totalEvents = data.totalEvents || 0;

  // Render Base Layout Skeleton
  containerEl.innerHTML = `
    <!-- Top Sync & Cloud Cron Status Banner (Requirement 2: 改為 每10分鐘 cron-job.org 自動觸發更新) -->
    <div class="mb-3 p-2.5 sm:px-3.5 sm:py-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs text-slate-400">
      <div class="flex items-center gap-1.5 shrink-0">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-slate-200 font-medium text-[11px] sm:text-xs">每10分鐘 cron-job.org 自動觸發更新</span>
      </div>
      <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-slate-400">
        <div>數據更新時間: <span class="text-amber-300 font-semibold">${syncTimeStr}</span></div>
        <span class="text-slate-600 hidden sm:inline">·</span>
        <div>雲端爬蟲更新次數: <span class="text-emerald-400 font-bold">${crawlCount}</span> 次</div>
        <span class="text-slate-600 hidden sm:inline">·</span>
        <div>累積總使用數: <span class="text-cyan-300 font-bold">${totalEvents}</span> 次</div>
      </div>
    </div>

    <!-- Primary Scope Selector Tabs: 全棟 -> 樓層 -> 機台 (Requirement 1) -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 pb-3">
      <div class="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs sm:text-sm">
        <button id="scope-overall-btn" class="scope-btn px-3 py-1.5 rounded-lg font-medium transition-all ${currentScope === 'overall' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
          🌐 全棟
        </button>
        <button id="scope-floor-btn" class="scope-btn px-3 py-1.5 rounded-lg font-medium transition-all ${currentScope === 'floor' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
          🏢 樓層
        </button>
        <button id="scope-machine-btn" class="scope-btn px-3 py-1.5 rounded-lg font-medium transition-all ${currentScope === 'machine' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
          🧺 機台
        </button>
      </div>

      <!-- Secondary Sub-Filter Container (Floors, Machines, Equipment Types) -->
      <div id="sub-filter-container" class="flex flex-wrap items-center gap-2"></div>
    </div>

    <!-- Dynamic Analytics Content Body -->
    <div id="analytics-dynamic-body"></div>
  `;

  // Bind Main Scope Switchers
  document.getElementById('scope-overall-btn').addEventListener('click', () => {
    currentScope = 'overall';
    updateView(data);
  });
  document.getElementById('scope-floor-btn').addEventListener('click', () => {
    currentScope = 'floor';
    if (!selectedFloor) selectedFloor = topFloor;
    updateView(data);
  });
  document.getElementById('scope-machine-btn').addEventListener('click', () => {
    currentScope = 'machine';
    if (!selectedHwid && topMachineHwid) selectedHwid = topMachineHwid;
    updateView(data);
  });

  updateView(data);
}

function updateView(data) {
  // Update Tab active styling
  document.querySelectorAll('.scope-btn').forEach((btn) => {
    btn.className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all text-slate-400 hover:text-white';
  });

  if (currentScope === 'overall') {
    document.getElementById('scope-overall-btn').className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all bg-cyan-600 text-white shadow';
  } else if (currentScope === 'floor') {
    document.getElementById('scope-floor-btn').className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all bg-cyan-600 text-white shadow';
  } else {
    document.getElementById('scope-machine-btn').className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all bg-cyan-600 text-white shadow';
  }

  const subFilter = document.getElementById('sub-filter-container');
  const body = document.getElementById('analytics-dynamic-body');

  if (currentScope === 'overall') {
    // Equipment Type Switcher for Whole Building
    subFilter.innerHTML = `
      <div class="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-lg text-xs">
        <span class="text-slate-400 pl-1.5 pr-1 hidden sm:inline">分母篩選:</span>
        <button data-eq="combined" class="eq-btn px-2.5 py-1 rounded font-medium transition-colors ${equipmentType === 'combined' ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'}">
          📊 全棟合併 (24台)
        </button>
        <button data-eq="wash" class="eq-btn px-2.5 py-1 rounded font-medium transition-colors ${equipmentType === 'wash' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}">
          🧺 洗衣機 (16台)
        </button>
        <button data-eq="dry" class="eq-btn px-2.5 py-1 rounded font-medium transition-colors ${equipmentType === 'dry' ? 'bg-amber-500 text-white' : 'text-slate-400 hover:text-white'}">
          💨 烘衣機 (8台)
        </button>
      </div>
    `;

    subFilter.querySelectorAll('.eq-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        equipmentType = btn.dataset.eq;
        updateView(data);
      });
    });

    renderOverallView(data, body);
  } else if (currentScope === 'floor') {
    // Floor Ranking for Floor Tab Badges (8F down to 2F)
    const floorRankMap = {};
    const rankingList = cachedFloorRanking.length
      ? cachedFloorRanking
      : ['8F', '6F', '4F', '2F'].map((f) => {
          const fData = data.byFloor?.[f] || {};
          return { floor: f, cycles: fData.totalCycles || 0 };
        }).sort((a, b) => b.cycles - a.cycles).map((fr, idx) => ({ ...fr, rank: idx + 1, medal: idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4️⃣' }));
    rankingList.forEach((fr) => {
      floorRankMap[fr.floor] = fr;
    });

    // Floor Pills + Floor Equipment Switcher
    subFilter.innerHTML = `
      <!-- Floor Selection (from 8F downwards with rank medals) -->
      <div class="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-lg text-xs">
        <span class="text-slate-400 pl-1.5 pr-1">樓層:</span>
        ${['8F', '6F', '4F', '2F'].map((f) => {
          const r = floorRankMap[f];
          return `
            <button data-target-floor="${f}" class="floor-tab-btn px-2.5 py-1 rounded font-medium transition-colors ${selectedFloor === f ? 'bg-cyan-500 text-white shadow' : 'text-slate-400 hover:text-white'}">
              ${f} ${r ? r.medal : ''}
            </button>
          `;
        }).join('')}
      </div>

      <!-- Equipment Type in this floor -->
      <div class="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-lg text-xs">
        <button data-eq="combined" class="eq-btn px-2.5 py-1 rounded font-medium transition-colors ${equipmentType === 'combined' ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'}">
          📊 合併 (6台)
        </button>
        <button data-eq="wash" class="eq-btn px-2.5 py-1 rounded font-medium transition-colors ${equipmentType === 'wash' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}">
          🧺 洗衣機 (4台)
        </button>
        <button data-eq="dry" class="eq-btn px-2.5 py-1 rounded font-medium transition-colors ${equipmentType === 'dry' ? 'bg-amber-500 text-white' : 'text-slate-400 hover:text-white'}">
          💨 烘衣機 (2台)
        </button>
      </div>
    `;

    subFilter.querySelectorAll('.floor-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedFloor = btn.dataset.targetFloor;
        updateView(data);
      });
    });

    subFilter.querySelectorAll('.eq-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        equipmentType = btn.dataset.eq;
        updateView(data);
      });
    });

    renderFloorView(data, selectedFloor, body);
  } else {
    // Machine Dropdown Selector (Requirement 5: 預設選最高使用率機台，清單由8樓往下去排)
    const floorOrder = { '8F': 1, '6F': 2, '4F': 3, '2F': 4 };
    const sortedMachines = [...(data.machineStats || [])].sort((a, b) => {
      const fA = floorOrder[a.floor] || 99;
      const fB = floorOrder[b.floor] || 99;
      if (fA !== fB) return fA - fB;
      if (a.machine_type !== b.machine_type) {
        return a.machine_type === 'washer' ? -1 : 1;
      }
      return (a.machine_num || 0) - (b.machine_num || 0);
    });

    const topMachineHwid = cachedTopMachineHwid || ([...(data.machineStats || [])].sort((a, b) => (b.total_cycles || 0) - (a.total_cycles || 0))[0]?.hwid);
    if (!selectedHwid && topMachineHwid) {
      selectedHwid = topMachineHwid;
    }

    subFilter.innerHTML = `
      <div class="flex items-center gap-2 text-xs">
        <span class="text-slate-400">選擇機台:</span>
        <select id="machine-select" class="bg-slate-900 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-medium focus:outline-none focus:border-cyan-500">
          ${sortedMachines.map((m) => {
            const isTop = m.hwid === topMachineHwid;
            return `
              <option value="${m.hwid}" ${selectedHwid === m.hwid ? 'selected' : ''}>
                ${m.floor} · ${m.description} (${m.machine_type === 'washer' ? '洗衣' : '烘衣'}) · ${m.total_cycles}次${isTop ? ' ★最高使用率' : ''}
              </option>
            `;
          }).join('')}
        </select>
      </div>
    `;

    document.getElementById('machine-select').addEventListener('change', (e) => {
      selectedHwid = e.target.value;
      updateView(data);
    });

    renderMachineView(data, selectedHwid, body);
  }
}

// ----------------------------------------------------
// 1. Overall View (by 全棟)
// ----------------------------------------------------
function renderOverallView(data, body) {
  const overallData = data.overall?.[equipmentType] || data.overall?.combined || data;
  const capacityCount = overallData.capacityCount || (equipmentType === 'wash' ? 16 : equipmentType === 'dry' ? 8 : 24);
  const eqName = equipmentType === 'wash' ? '全棟洗衣機' : equipmentType === 'dry' ? '全棟烘衣機' : '全棟洗烘設備';

  const totalCycles = data.machineStats
    ? data.machineStats
        .filter((m) => equipmentType === 'combined' || (equipmentType === 'wash' ? m.machine_type === 'washer' : m.machine_type === 'dryer'))
        .reduce((sum, m) => sum + m.total_cycles, 0)
    : data.totalEvents || 0;

  const totalCost = data.machineStats
    ? data.machineStats
        .filter((m) => equipmentType === 'combined' || (equipmentType === 'wash' ? m.machine_type === 'washer' : m.machine_type === 'dryer'))
        .reduce((sum, m) => sum + m.total_cost_ntd, 0)
    : 0;

  body.innerHTML = `
    <!-- Top Recommendation & Quiet Hours Policy Banner -->
    <div class="mb-4 p-3.5 rounded-xl bg-gradient-to-r from-slate-900 via-cyan-950/40 to-slate-900 border border-cyan-500/30">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 text-xs font-bold text-cyan-300">
            <span class="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
            💡 全棟離峰最佳推薦 (${eqName} · 物理分母 ${capacityCount} 台)
          </div>
          <div class="text-xs text-slate-200 mt-1">
            推薦時段：<span class="text-amber-400 font-bold font-mono">${overallData.bestTimeWindows?.[0]?.label || '08:00 ~ 09:00'}</span>
            （平均佔用率 <span class="font-mono text-emerald-400 font-semibold">${overallData.bestTimeWindows?.[0]?.rate || 0}%</span>，空閒率 <span class="font-mono text-emerald-400 font-bold">${100 - (overallData.bestTimeWindows?.[0]?.rate || 0)}%</span>）
          </div>
          <div class="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
            <span>🌙</span>
            <span>宿舍生活公約安寧時段：<strong class="text-slate-300">00:00 ~ 08:00 嚴格禁止洗烘衣</strong>（已自動自離峰推薦排除），合法洗烘時段為 <strong class="text-cyan-300">08:00 ~ 24:00</strong>。</span>
          </div>
        </div>

        <!-- Top Legal Off-peak Windows -->
        <div class="flex gap-1.5 flex-wrap text-xs font-mono shrink-0">
          ${(overallData.bestTimeWindows || []).slice(0, 4).map((w, idx) => `
            <div class="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/80 text-slate-200 flex items-center gap-1.5">
              <span class="text-cyan-400 font-bold">#${idx + 1}</span>
              <span>${w.label}</span>
              <span class="text-[10px] px-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">${w.rate}%佔用</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Whole Building Stat Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">監控設備數</div>
        <div class="text-base sm:text-lg font-bold font-mono text-cyan-400 mt-0.5">${capacityCount} 台</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">總運轉次數</div>
        <div class="text-base sm:text-lg font-bold font-mono text-sky-400 mt-0.5">${totalCycles} 次</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">熱度計算依據</div>
        <div class="text-xs sm:text-sm font-bold font-mono text-amber-300 mt-0.5">近 30 天數據</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">推估投幣營收</div>
        <div class="text-base sm:text-lg font-bold font-mono text-emerald-400 mt-0.5">NT$ ${totalCost}</div>
      </div>
    </div>

    <!-- Heatmap Table with Physical Denominator & Night Violation Markers -->
    ${renderHeatmapHtml(`${eqName} 每週熱度矩陣 (分母: ${capacityCount} 台)`, overallData.heatmap)}

    <!-- Charts Row: Floor Comparison & 24H Hourly Curve -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 mb-4">
      <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
        <h3 class="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
          <span>🏢</span> 樓層使用量對比
        </h3>
        <div class="h-60 relative">
          <canvas id="overallFloorChartCanvas"></canvas>
        </div>
      </div>

      <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
        <h3 class="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
          <span>⏰</span> 24H 使用率走勢 (${eqName})
        </h3>
        <div class="h-60 relative">
          <canvas id="overallHourlyChartCanvas"></canvas>
        </div>
      </div>
    </div>

    <!-- Rankings: Coldest vs Busiest (Excluding Offline Machines) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="bg-slate-900/80 p-3.5 rounded-xl border border-emerald-500/20">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
            <span>❄️</span> 推薦離峰冷門機台 (Top 5)
          </h3>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800">已過濾在線正常</span>
        </div>
        <div class="space-y-1.5">
          ${(data.coldestMachines || []).map((m, idx) => `
            <div class="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors text-xs border border-slate-700/50 cursor-pointer" onclick="window.selectMachineAnalytics && window.selectMachineAnalytics('${m.hwid}')">
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-full bg-emerald-900/70 text-emerald-300 flex items-center justify-center font-bold text-[10px]">${idx + 1}</span>
                <div>
                  <div class="font-medium text-white flex items-center gap-1.5">
                    ${m.description}
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  </div>
                  <div class="text-[10px] text-slate-400">${m.floor} · ${m.machine_type === 'washer' ? '洗衣機' : '烘衣機'}</div>
                </div>
              </div>
              <div class="text-right font-mono">
                <div class="text-emerald-400 font-semibold text-xs">${m.total_cycles} 次</div>
                <div class="text-[10px] text-slate-400">${m.total_duration_min}分</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="bg-slate-900/80 p-3.5 rounded-xl border border-red-500/20">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-xs font-semibold text-red-400 flex items-center gap-1.5">
            <span>🔥</span> 尖峰常滿熱門機台 (Top 5)
          </h3>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-red-950/70 text-red-300 border border-red-800">尖峰建議避開</span>
        </div>
        <div class="space-y-1.5">
          ${(data.busiestMachines || []).map((m, idx) => `
            <div class="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors text-xs border border-slate-700/50 cursor-pointer" onclick="window.selectMachineAnalytics && window.selectMachineAnalytics('${m.hwid}')">
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-full bg-red-900/70 text-red-300 flex items-center justify-center font-bold text-[10px]">${idx + 1}</span>
                <div>
                  <div class="font-medium text-white">${m.description}</div>
                  <div class="text-[10px] text-slate-400">${m.floor} · ${m.machine_type === 'washer' ? '洗衣機' : '烘衣機'}</div>
                </div>
              </div>
              <div class="text-right font-mono">
                <div class="text-red-400 font-semibold text-xs">${m.total_cycles} 次</div>
                <div class="text-[10px] text-slate-400">NT$${m.total_cost_ntd}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Draw Overall Floor Chart (Washer vs Dryer)
  const canvas1 = document.getElementById('overallFloorChartCanvas');
  if (canvas1 && data.floorComparison) {
    if (mainChartInstance) mainChartInstance.destroy();
    mainChartInstance = new Chart(canvas1, {
      type: 'bar',
      data: {
        labels: data.floorComparison.map((f) => f.floor),
        datasets: [
          {
            label: '洗衣機次數',
            data: data.floorComparison.map((f) => f.washerCycles),
            backgroundColor: 'rgba(56, 189, 248, 0.75)',
            borderColor: '#38bdf8',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: '烘衣機次數',
            data: data.floorComparison.map((f) => f.dryerCycles),
            backgroundColor: 'rgba(245, 158, 11, 0.75)',
            borderColor: '#f59e0b',
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
        },
        plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } }
      }
    });
  }

  // Draw Hourly Curve for Selected Equipment Type
  const canvas2 = document.getElementById('overallHourlyChartCanvas');
  if (canvas2 && overallData.hourlyAverages) {
    if (secondaryChartInstance) secondaryChartInstance.destroy();
    secondaryChartInstance = new Chart(canvas2, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }).map((_, h) => `${h}:00`),
        datasets: [{
          label: `${eqName} 平均使用率 (%)`,
          data: overallData.hourlyAverages,
          borderColor: equipmentType === 'dry' ? '#f59e0b' : '#06b6d4',
          backgroundColor: equipmentType === 'dry' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(6, 182, 212, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].label} ~ ${String((parseInt(items[0].label) + 1) % 24).padStart(2, '0')}:00`,
              label: (item) => `使用率: ${item.parsed.y}% (對應熱度矩陣)`
            }
          }
        }
      }
    });
  }
}

// ----------------------------------------------------
// 2. Floor View (by 樓層)
// ----------------------------------------------------
function renderFloorView(data, floor, body) {
  const floorRaw = data.byFloor?.[floor];
  if (!floorRaw) {
    body.innerHTML = '<div class="p-8 text-center text-slate-400">尚無該樓層數據。</div>';
    return;
  }

  // Calculate floor ranking across all 4 floors (8F down to 2F)
  const floorRanking = ['8F', '6F', '4F', '2F'].map((f) => {
    const fData = data.byFloor?.[f] || {};
    return {
      floor: f,
      cycles: fData.totalCycles || 0,
      washerCycles: fData.washerCycles || 0,
      dryerCycles: fData.dryerCycles || 0,
      durationMin: fData.durationMin || 0,
      cost: fData.cost || 0
    };
  }).sort((a, b) => b.cycles - a.cycles);
  floorRanking.forEach((fr, idx) => {
    fr.rank = idx + 1;
    fr.medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4️⃣';
  });

  const currentFloorRank = floorRanking.find((fr) => fr.floor === floor) || { rank: 1, medal: '🥇' };

  // Select equipment-specific floor data or fallback to combined
  const fData = floorRaw[equipmentType] || floorRaw.combined || floorRaw;
  const capacityCount = fData.capacityCount || (equipmentType === 'wash' ? 4 : equipmentType === 'dry' ? 2 : 6);
  const eqName = equipmentType === 'wash' ? '洗衣機' : equipmentType === 'dry' ? '烘衣機' : '洗烘合併';

  body.innerHTML = `
    <!-- Floor Usage Ranking Board (Requirement 4: 全棟各樓層使用率排名看板) -->
    <div class="mb-4 p-3 sm:p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
        <div class="flex items-center gap-2">
          <span class="text-sm">🏆</span>
          <h3 class="text-xs font-bold text-white">全棟各樓層使用率排名看板</h3>
          <span class="text-[11px] text-slate-400 font-mono">(依累計運轉次數排序 · 點選切換樓層)</span>
        </div>
        <div class="text-[11px] text-amber-300 font-medium">
          👑 全棟最高使用率：<strong class="font-bold">${floorRanking[0]?.floor}</strong> (${floorRanking[0]?.cycles} 次運轉)
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        ${floorRanking.map((fr) => {
          const isSelected = fr.floor === floor;
          const rankBorder = fr.rank === 1 ? 'border-amber-500/50 bg-amber-950/25' : isSelected ? 'border-cyan-500/50 bg-cyan-950/25' : 'border-slate-800 bg-slate-950/60';
          return `
            <div data-target-floor="${fr.floor}" class="floor-ranking-chip p-2.5 rounded-lg border transition-all cursor-pointer hover:border-slate-600 ${rankBorder} ${isSelected ? 'ring-1 ring-cyan-400 shadow-sm' : ''}">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-slate-200 flex items-center gap-1">
                  <span>${fr.medal}</span> ${fr.floor}
                </span>
                <span class="text-[10px] font-mono ${fr.rank === 1 ? 'text-amber-400 font-bold' : 'text-slate-400'}">第 ${fr.rank} 名</span>
              </div>
              <div class="mt-1 flex items-baseline justify-between text-xs font-mono">
                <span class="text-slate-400 text-[10px]">累計運轉</span>
                <span class="text-cyan-300 font-bold">${fr.cycles} 次</span>
              </div>
              <div class="mt-0.5 flex items-baseline justify-between text-[10px] font-mono text-slate-400">
                <span>洗 ${fr.washerCycles} · 烘 ${fr.dryerCycles}</span>
                <span class="text-emerald-400">NT$ ${fr.cost}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Floor Overview Cards (5 Metrics with Floor Rank) -->
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mb-4">
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">全棟使用率排名</div>
        <div class="text-base sm:text-lg font-bold font-mono ${currentFloorRank.rank === 1 ? 'text-amber-400' : 'text-white'} mt-0.5">
          ${currentFloorRank.medal} 第 ${currentFloorRank.rank} 名
        </div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">${floor} 累計運轉</div>
        <div class="text-base sm:text-lg font-bold font-mono text-cyan-400 mt-0.5">${floorRaw.totalCycles} 次</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">洗衣機 (4台)</div>
        <div class="text-base sm:text-lg font-bold font-mono text-sky-400 mt-0.5">${floorRaw.washerCycles} 次</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">烘衣機 (2台)</div>
        <div class="text-base sm:text-lg font-bold font-mono text-amber-400 mt-0.5">${floorRaw.dryerCycles} 次</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800 col-span-2 sm:col-span-1">
        <div class="text-[11px] text-slate-400">${floor} 累計投幣</div>
        <div class="text-base sm:text-lg font-bold font-mono text-emerald-400 mt-0.5">NT$ ${floorRaw.cost}</div>
      </div>
    </div>

    <!-- Recommendation Banner -->
    <div class="mb-4 p-3.5 rounded-xl bg-gradient-to-r from-slate-900 via-cyan-950/40 to-slate-900 border border-cyan-500/30">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <div class="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
            <span>💡</span> ${floor} ${eqName} 最佳離峰推薦 (物理分母: ${capacityCount} 台)
          </div>
          <div class="text-xs text-slate-200 mt-1">
            最佳時段：<span class="text-amber-400 font-bold font-mono">${fData.bestTimeWindows?.[0]?.label || '08:00 ~ 09:00'}</span>
            （平均佔用率 <span class="font-mono text-emerald-400 font-semibold">${fData.bestTimeWindows?.[0]?.rate || 0}%</span>，空閒率 <span class="font-mono text-emerald-400 font-bold">${100 - (fData.bestTimeWindows?.[0]?.rate || 0)}%</span>）
          </div>
          <div class="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
            <span>🌙</span> 00:00 ~ 08:00 為夜間安寧時段嚴格禁止洗烘（已排除於推薦外）。
          </div>
        </div>
        <div class="flex gap-1.5 flex-wrap text-xs font-mono shrink-0">
          ${(fData.bestTimeWindows || []).slice(0, 3).map((w, idx) => `
            <div class="px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/80 text-slate-200 flex items-center gap-1">
              <span class="text-cyan-400 font-bold">#${idx + 1}</span>
              <span>${w.label}</span>
              <span class="text-[10px] px-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">${w.rate}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Heatmap -->
    ${renderHeatmapHtml(`${floor} ${eqName} 每週熱度矩陣 (分母: ${capacityCount} 台)`, fData.heatmap)}

    <!-- Charts Grid: Floor Machine Comparison & Hourly Curve -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
        <h3 class="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
          <span>🧺</span> ${floor} 機台使用排行
        </h3>
        <div class="h-60 relative">
          <canvas id="floorDetailChartCanvas"></canvas>
        </div>
      </div>

      <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
        <h3 class="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
          <span>⏰</span> 24H 使用走勢 (${floor} ${eqName})
        </h3>
        <div class="h-60 relative">
          <canvas id="floorHourlyChartCanvas"></canvas>
        </div>
      </div>
    </div>
  `;

  // Bind click event for Floor Ranking Chips
  body.querySelectorAll('.floor-ranking-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      selectedFloor = chip.dataset.targetFloor;
      updateView(data);
    });
  });

  // Draw Machine Comparison on this floor
  const fMachines = floorRaw.machines || [];
  const filteredMachines = equipmentType === 'combined'
    ? fMachines
    : fMachines.filter((m) => equipmentType === 'wash' ? m.machine_type === 'washer' : m.machine_type === 'dryer');

  const canvas1 = document.getElementById('floorDetailChartCanvas');
  if (canvas1) {
    if (mainChartInstance) mainChartInstance.destroy();
    mainChartInstance = new Chart(canvas1, {
      type: 'bar',
      data: {
        labels: filteredMachines.map((m) => m.description),
        datasets: [{
          label: '使用次數',
          data: filteredMachines.map((m) => m.total_cycles),
          backgroundColor: filteredMachines.map((m) => m.machine_type === 'washer' ? 'rgba(56, 189, 248, 0.75)' : 'rgba(245, 158, 11, 0.75)'),
          borderColor: filteredMachines.map((m) => m.machine_type === 'washer' ? '#38bdf8' : '#f59e0b'),
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  // Draw Floor Hourly Curve
  const canvas2 = document.getElementById('floorHourlyChartCanvas');
  if (canvas2 && fData.hourlyAverages) {
    if (secondaryChartInstance) secondaryChartInstance.destroy();
    secondaryChartInstance = new Chart(canvas2, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }).map((_, h) => `${h}:00`),
        datasets: [{
          label: '平均使用率 (%)',
          data: fData.hourlyAverages,
          borderColor: equipmentType === 'dry' ? '#f59e0b' : '#06b6d4',
          backgroundColor: equipmentType === 'dry' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(6, 182, 212, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 2.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].label} ~ ${String((parseInt(items[0].label) + 1) % 24).padStart(2, '0')}:00`,
              label: (item) => `使用率: ${item.parsed.y}% (對應熱度矩陣)`
            }
          }
        }
      }
    });
  }
}

// ----------------------------------------------------
// 3. Machine View (by 機台) - Behavioral Profile
// ----------------------------------------------------
function renderMachineView(data, hwid, body) {
  const mData = data.byMachine?.[hwid];
  if (!mData) {
    body.innerHTML = '<div class="p-8 text-center text-slate-400">尚無該機台數據。</div>';
    return;
  }

  const isDryer = mData.type === 'dryer';
  const typeText = isDryer ? '烘衣機' : '洗衣機';
  const rank = mData.rankInType || 1;
  const totalInType = mData.totalInType || (isDryer ? 8 : 16);
  const rankPercent = Math.round(((totalInType - rank + 1) / totalInType) * 100);

  // Machine status badge
  const isOnline = mData.isOnline !== false;

  const lastUsedDisplay = formatLastUsedSimple(mData.lastUsedTime);

  body.innerHTML = `
    <!-- Machine Header Card & Peer Ranking -->
    <div class="mb-4 p-4 rounded-xl bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>${isDryer ? '💨' : '🧺'}</span> ${mData.floor} ${mData.description}
          </h2>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${isOnline ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}">
            ${isOnline ? '● 正常在線' : '○ 離線'}
          </span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            ${typeText}
          </span>
        </div>
        <div class="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div>同類熱門度天梯：在全棟 <strong class="text-amber-400">${totalInType} 台${typeText}</strong> 中排名第 <strong class="text-cyan-400 font-mono text-sm">#${rank}</strong> 名 (前 ${100 - rankPercent + 1}%)</div>
          <span class="text-slate-600 hidden sm:inline">·</span>
          <div>單次平均運轉：<strong class="text-sky-300 font-mono">${mData.avgDurationMin} 分鐘</strong></div>
          <span class="text-slate-600 hidden sm:inline">·</span>
          <div>最後使用：<strong class="text-amber-300 font-mono">${lastUsedDisplay}</strong></div>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-right">
          <div class="text-[10px] text-slate-400">推估投幣總額</div>
          <div class="text-sm sm:text-base font-bold font-mono text-emerald-400">NT$ ${mData.totalCost}</div>
        </div>
      </div>
    </div>

    <!-- Machine Metric Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">最後一次使用</div>
        <div class="text-xs sm:text-sm font-bold font-mono text-amber-300 mt-1 truncate" title="${lastUsedDisplay}">
          ${lastUsedDisplay}
        </div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">累計運轉次數</div>
        <div class="text-base sm:text-lg font-bold font-mono text-cyan-400 mt-0.5">${mData.totalCycles} 次</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">累計使用總時長</div>
        <div class="text-base sm:text-lg font-bold font-mono text-sky-400 mt-0.5">${mData.totalDurationMin} 分</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-[11px] text-slate-400">使用率評級</div>
        <div class="text-base sm:text-lg font-bold font-mono ${rank <= 3 ? 'text-rose-400' : rank >= totalInType - 2 ? 'text-emerald-400' : 'text-slate-200'} mt-0.5">
          ${rank <= 3 ? '🔥 極熱門' : rank >= totalInType - 2 ? '❄️ 推薦冷門' : '⚖️ 均衡常客'}
        </div>
      </div>
    </div>

    <!-- Behavioral Profile: Peak vs Off-Peak Slots (Strict Legal Hours 08:00~24:00) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
      <!-- Off-Peak Recommended -->
      <div class="p-3.5 rounded-xl bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
            <span>✨</span> 合法離峰空閒推薦 (08:00 ~ 24:00)
          </div>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">隨到隨洗</span>
        </div>
        <div class="space-y-1.5">
          ${(mData.bestTimeWindows || []).slice(0, 3).map((w, idx) => `
            <div class="flex items-center justify-between p-2 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs font-mono">
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-full bg-emerald-900/80 text-emerald-300 flex items-center justify-center font-bold text-[10px]">#${idx + 1}</span>
                <span class="text-slate-200 font-medium">${w.label}</span>
              </div>
              <div class="text-right">
                <span class="text-emerald-400 font-semibold">${100 - w.rate}% 空閒率</span>
                <span class="text-[10px] text-slate-500 ml-1">(${w.rate}% 佔用)</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Peak Hours to Avoid -->
      <div class="p-3.5 rounded-xl bg-gradient-to-br from-rose-950/40 via-slate-900 to-slate-900 border border-rose-500/30">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-bold text-rose-400 flex items-center gap-1.5">
            <span>🔥</span> 常態尖峰常滿時段 (08:00 ~ 24:00)
          </div>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">容易排隊</span>
        </div>
        <div class="space-y-1.5">
          ${(mData.peakSlots || []).slice(0, 3).map((w, idx) => `
            <div class="flex items-center justify-between p-2 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs font-mono">
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-full bg-rose-900/80 text-rose-300 flex items-center justify-center font-bold text-[10px]">#${idx + 1}</span>
                <span class="text-slate-200 font-medium">${w.label}</span>
              </div>
              <div class="text-right">
                <span class="text-rose-400 font-semibold">${w.rate}% 佔用機率</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Machine 24H Occupancy Curve (Denomination = 1 machine, showing hourly occupancy probability) -->
    <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
        <h3 class="text-xs font-semibold text-white flex items-center gap-1.5">
          <span>⏰</span> 24H 被佔用機率走勢圖
        </h3>
        <div class="text-[11px] text-slate-400 flex items-center gap-2">
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-500/80"></span> 00~08 夜間安寧禁洗</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full ${isDryer ? 'bg-amber-400' : 'bg-cyan-400'}"></span> 08~24 正常洗烘</span>
        </div>
      </div>
      <div class="h-64 relative">
        <canvas id="machineHourlyChartCanvas"></canvas>
      </div>
    </div>
  `;

  const canvas = document.getElementById('machineHourlyChartCanvas');
  if (canvas && mData.hourlyAverages) {
    if (mainChartInstance) mainChartInstance.destroy();
    mainChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }).map((_, h) => `${h}:00`),
        datasets: [{
          label: `${mData.description} 被佔用機率 (%)`,
          data: mData.hourlyAverages,
          borderColor: isDryer ? '#f59e0b' : '#38bdf8',
          backgroundColor: isDryer ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 3.5,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const h = parseInt(items[0].label, 10);
                const nextH = (h + 1) % 24;
                const isNight = h < 8;
                return `${String(h).padStart(2, '0')}:00 ~ ${String(nextH).padStart(2, '0')}:00 ${isNight ? '🌙 [夜間安寧禁洗]' : '☀️ [正常營運]'}`;
              },
              label: (item) => `佔用率: ${item.parsed.y}% (對應熱度矩陣)`
            }
          }
        }
      }
    });
  }
}

// ----------------------------------------------------
// Heatmap Table Helper with Physical Denominator & Quiet Hours
// ----------------------------------------------------
function renderHeatmapHtml(title, heatmapRows) {
  if (!heatmapRows || heatmapRows.length === 0) return '';
  return `
    <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
        <h3 class="text-xs font-semibold text-white flex items-center gap-1.5">
          <span>🔥</span> ${title}
        </h3>
        <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
          <span class="text-slate-500 font-mono">🌙 00-08 安寧(違規⚠️)</span>
          <span class="text-slate-600">|</span>
          <span>空閒</span>
          <span class="w-2.5 h-2.5 rounded bg-slate-800 inline-block"></span>
          <span class="w-2.5 h-2.5 rounded bg-blue-700/60 inline-block"></span>
          <span class="w-2.5 h-2.5 rounded bg-amber-600/70 inline-block"></span>
          <span class="w-2.5 h-2.5 rounded bg-red-600/90 inline-block"></span>
          <span>尖峰常滿</span>
        </div>
      </div>
      <div class="overflow-x-auto pb-1.5">
        <div class="min-w-[760px]">
          <!-- Hours Header -->
          <div class="grid grid-cols-[60px_repeat(24,1fr)] text-[10px] text-slate-400 text-center mb-1 font-mono">
            <div></div>
            ${Array.from({ length: 24 }).map((_, h) => {
              const isNight = h < 8;
              return `<div class="${isNight ? 'text-amber-500/80 font-bold bg-amber-950/20 rounded' : ''}" title="${isNight ? '🌙 00:00~08:00 生活公約夜間安寧禁洗時段' : '☀️ 正常洗烘時段'}">${h}${isNight ? '🌙' : ''}</div>`;
            }).join('')}
          </div>
          <!-- Days Rows -->
          ${heatmapRows.map((row) => `
            <div class="grid grid-cols-[60px_repeat(24,1fr)] gap-1 mb-1 items-center">
              <div class="text-xs text-slate-300 font-medium pl-1">${row.dayName}</div>
              ${row.hours.map((rate, h) => {
                const isNight = h < 8;
                let colorClass = 'bg-slate-800/60 text-slate-500';
                let extraTag = '';

                if (isNight) {
                  // Quiet hours violation check
                  if (rate > 0) {
                    colorClass = 'bg-rose-950/80 border border-rose-600/60 text-rose-300 font-bold';
                    extraTag = '⚠️';
                  } else {
                    colorClass = 'bg-slate-950/50 text-slate-600 border border-slate-800/40';
                  }
                } else {
                  if (rate > 75) colorClass = 'bg-red-600/90 text-white font-bold shadow-sm';
                  else if (rate > 50) colorClass = 'bg-amber-500/80 text-white font-medium';
                  else if (rate > 25) colorClass = 'bg-blue-600/70 text-slate-200';
                  else if (rate > 5) colorClass = 'bg-blue-900/50 text-slate-400';
                }

                const titleText = isNight
                  ? `${row.dayName} ${h}:00 ~ ${h + 1}:00 🌙 夜間安寧禁洗時段${rate > 0 ? ` (⚠️ ${rate}% 違規偷用)` : ' (無使用)'}`
                  : `${row.dayName} ${h}:00 ~ ${h + 1}:00 ☀️ 使用率 ${rate}%`;

                return `
                  <div title="${titleText}" 
                       class="h-7 rounded flex items-center justify-center text-[9px] font-mono transition-transform hover:scale-110 cursor-pointer ${colorClass}">
                    ${rate > 0 ? `${rate}${extraTag}` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// Global click helper for ranking cards to select machine
if (typeof window !== 'undefined') {
  window.selectMachineAnalytics = function(hwid) {
    currentScope = 'machine';
    selectedHwid = hwid;
    if (activeData) {
      updateView(activeData);
    }
  };
}
