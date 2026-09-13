import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

let mainChartInstance = null;
let secondaryChartInstance = null;

// Active state
let currentScope = 'floor'; // 'floor' | 'machine' | 'overall'
let selectedFloor = '2F'; // Default '2F'
let selectedHwid = null;

export function renderAnalytics(data, containerEl, options = {}) {
  if (!data) {
    containerEl.innerHTML = '<div class="p-8 text-center text-slate-400">目前尚無足夠的歷史數據。</div>';
    return;
  }

  if (options.scope) {
    currentScope = options.scope;
  }
  if (options.hwid) {
    selectedHwid = options.hwid;
  }
  if (options.floor) {
    selectedFloor = options.floor;
  }

  // Set default machine if not set
  if (!selectedHwid && data.machineStats && data.machineStats.length > 0) {
    selectedHwid = data.machineStats[0].hwid;
  }

  // Render Skeleton UI
  const syncTimeStr = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' })
    : '最新';

  containerEl.innerHTML = `
    <!-- DB Sync Info Banner -->
    <div class="mb-4 px-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>資料庫採集機制：<span class="text-slate-200 font-medium">每 10 分鐘自動由後台排程彙整一次</span></span>
      </div>
      <div class="flex items-center gap-2 font-mono text-[11px]">
        <span>最後彙整時間：<span class="text-amber-300 font-semibold">${syncTimeStr}</span></span>
        <span class="text-slate-600">|</span>
        <span>已累積記錄 <span class="text-cyan-300 font-bold">${data.totalEvents || 0}</span> 次運轉事件</span>
      </div>
    </div>

    <!-- Scope Selector Tabs -->
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
      <div class="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs sm:text-sm">
        <button id="scope-floor-btn" class="scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all ${currentScope === 'floor' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
          🏢 依樓層分析 (預設)
        </button>
        <button id="scope-machine-btn" class="scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all ${currentScope === 'machine' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
          🧺 依機台單獨分析
        </button>
        <button id="scope-overall-btn" class="scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all ${currentScope === 'overall' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
          🌐 全棟總覽分析
        </button>
      </div>

      <!-- Sub Filter Controls Container -->
      <div id="sub-filter-container" class="flex items-center gap-2">
        <!-- Injected based on scope -->
      </div>
    </div>

    <!-- Dynamic Content Area -->
    <div id="analytics-dynamic-body"></div>
  `;

  // Bind Scope Tabs
  document.getElementById('scope-floor-btn').addEventListener('click', () => {
    currentScope = 'floor';
    updateView(data);
  });
  document.getElementById('scope-machine-btn').addEventListener('click', () => {
    currentScope = 'machine';
    updateView(data);
  });
  document.getElementById('scope-overall-btn').addEventListener('click', () => {
    currentScope = 'overall';
    updateView(data);
  });

  updateView(data);
}

function updateView(data) {
  // Update Tab active styling
  document.querySelectorAll('.scope-btn').forEach((btn) => {
    btn.className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all text-slate-400 hover:text-white';
  });
  if (currentScope === 'floor') {
    document.getElementById('scope-floor-btn').className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all bg-cyan-600 text-white shadow';
  } else if (currentScope === 'machine') {
    document.getElementById('scope-machine-btn').className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all bg-cyan-600 text-white shadow';
  } else {
    document.getElementById('scope-overall-btn').className = 'scope-btn px-3.5 py-1.5 rounded-lg font-medium transition-all bg-cyan-600 text-white shadow';
  }

  const subFilter = document.getElementById('sub-filter-container');
  const body = document.getElementById('analytics-dynamic-body');

  if (currentScope === 'floor') {
    // Floor Pills
    subFilter.innerHTML = `
      <div class="flex items-center gap-1 bg-slate-800/80 p-1 rounded-lg text-xs">
        <span class="text-slate-400 px-2">樓層:</span>
        ${['2F', '4F', '6F', '8F'].map((f) => `
          <button data-target-floor="${f}" class="floor-tab-btn px-3 py-1 rounded font-medium transition-colors ${selectedFloor === f ? 'bg-cyan-500 text-white' : 'text-slate-300 hover:text-white'}">
            ${f}
          </button>
        `).join('')}
      </div>
    `;

    subFilter.querySelectorAll('.floor-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedFloor = btn.dataset.targetFloor;
        updateView(data);
      });
    });

    renderFloorView(data, selectedFloor, body);
  } else if (currentScope === 'machine') {
    // Machine Dropdown
    const machineList = data.machineStats || [];
    subFilter.innerHTML = `
      <div class="flex items-center gap-2 text-xs">
        <span class="text-slate-400">選擇機台:</span>
        <select id="machine-select" class="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-medium focus:outline-none focus:border-cyan-500">
          ${machineList.map((m) => `
            <option value="${m.hwid}" ${selectedHwid === m.hwid ? 'selected' : ''}>
              ${m.description} (${m.machine_type === 'washer' ? '洗衣' : '烘衣'}) · ${m.total_cycles}次
            </option>
          `).join('')}
        </select>
      </div>
    `;

    document.getElementById('machine-select').addEventListener('change', (e) => {
      selectedHwid = e.target.value;
      updateView(data);
    });

    renderMachineView(data, selectedHwid, body);
  } else {
    // Overall view
    subFilter.innerHTML = `<span class="text-xs text-slate-400">全棟 24 台彙整統計</span>`;
    renderOverallView(data, body);
  }
}

// 1. Render Floor View (Default)
function renderFloorView(data, floor, body) {
  const fData = data.byFloor?.[floor];
  if (!fData) {
    body.innerHTML = '<div class="p-8 text-center text-slate-400">尚無該樓層數據。</div>';
    return;
  }

  body.innerHTML = `
    <!-- Floor Overview Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">${floor} 累計運轉</div>
        <div class="text-lg font-bold font-mono text-cyan-400 mt-0.5">${fData.totalCycles} 次</div>
      </div>
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">洗衣機次數</div>
        <div class="text-lg font-bold font-mono text-sky-400 mt-0.5">${fData.washerCycles} 次</div>
      </div>
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">烘衣機次數</div>
        <div class="text-lg font-bold font-mono text-amber-400 mt-0.5">${fData.dryerCycles} 次</div>
      </div>
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">${floor} 累計投幣</div>
        <div class="text-lg font-bold font-mono text-emerald-400 mt-0.5">NT$ ${fData.cost}</div>
      </div>
    </div>

    <!-- Recommendation Banner -->
    <div class="mb-6 p-4 rounded-xl bg-gradient-to-r from-cyan-950/60 to-blue-950/60 border border-cyan-500/30 text-cyan-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
      <div>
        <div class="font-semibold text-white text-sm flex items-center gap-2">
          <span>💡</span> ${floor} 最佳離峰洗衣推薦時段
        </div>
        <div class="text-xs text-slate-300 mt-1">
          歷史數據分析：${floor} 最清閒時段為 <span class="text-amber-400 font-bold">${fData.bestTimeWindows?.[0]?.label || '05:00 ~ 07:00'}</span>（佔用率僅 ${fData.bestTimeWindows?.[0]?.rate || 0}%）。
        </div>
      </div>
      <div class="flex gap-2 flex-wrap text-xs">
        ${(fData.bestTimeWindows || []).slice(0, 3).map((w, idx) => `
          <div class="px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200">
            <span class="text-cyan-400 font-mono font-bold">#${idx + 1}</span> ${w.label} (${w.rate}% 佔用)
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Heatmap -->
    ${renderHeatmapHtml(`${floor} 每週 24 小時使用熱度矩陣 (Heatmap)`, fData.heatmap)}

    <!-- Charts Grid: Floor Machine Comparison & Hourly Curve -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        <h3 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span>🧺</span> ${floor} 內部機台使用次數排行
        </h3>
        <div class="h-64 relative">
          <canvas id="floorDetailChartCanvas"></canvas>
        </div>
      </div>

      <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        <h3 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span>⏰</span> ${floor} 全天 24 小時平均使用率走勢
        </h3>
        <div class="h-64 relative">
          <canvas id="floorHourlyChartCanvas"></canvas>
        </div>
      </div>
    </div>
  `;

  // Draw Machine Comparison on this floor
  const fMachines = fData.machines || [];
  const canvas1 = document.getElementById('floorDetailChartCanvas');
  if (canvas1) {
    if (mainChartInstance) mainChartInstance.destroy();
    mainChartInstance = new Chart(canvas1, {
      type: 'bar',
      data: {
        labels: fMachines.map((m) => m.description),
        datasets: [{
          label: '使用次數',
          data: fMachines.map((m) => m.total_cycles),
          backgroundColor: fMachines.map((m) => m.machine_type === 'washer' ? 'rgba(56, 189, 248, 0.75)' : 'rgba(245, 158, 11, 0.75)'),
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
  if (canvas2) {
    if (secondaryChartInstance) secondaryChartInstance.destroy();
    secondaryChartInstance = new Chart(canvas2, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }).map((_, h) => `${h}:00`),
        datasets: [{
          label: '平均使用率 (%)',
          data: fData.hourlyAverages,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.15)',
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
        plugins: { legend: { display: false } }
      }
    });
  }
}

// 2. Render Machine View
function renderMachineView(data, hwid, body) {
  const mData = data.byMachine?.[hwid];
  if (!mData) {
    body.innerHTML = '<div class="p-8 text-center text-slate-400">尚無該機台數據。</div>';
    return;
  }

  const isDryer = mData.type === 'dryer';

  body.innerHTML = `
    <!-- Machine Overview Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">機台型號 / 樓層</div>
        <div class="text-base font-bold text-white mt-0.5">${mData.description}</div>
      </div>
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">歷史累計運轉</div>
        <div class="text-lg font-bold font-mono text-cyan-400 mt-0.5">${mData.totalCycles} 次</div>
      </div>
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">累計運轉時長</div>
        <div class="text-lg font-bold font-mono text-sky-400 mt-0.5">${mData.totalDurationMin} 分鐘</div>
      </div>
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="text-xs text-slate-400">推估投幣收益</div>
        <div class="text-lg font-bold font-mono text-emerald-400 mt-0.5">NT$ ${mData.totalCost}</div>
      </div>
    </div>

    <!-- Recommendation Banner -->
    <div class="mb-6 p-4 rounded-xl bg-gradient-to-r from-emerald-950/60 to-cyan-950/60 border border-emerald-500/30 text-emerald-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
      <div>
        <div class="font-semibold text-white text-sm flex items-center gap-2">
          <span>✨</span> ${mData.description} 歷史空閒時段推薦
        </div>
        <div class="text-xs text-slate-300 mt-1">
          這台機台最少人使用的時段為 <span class="text-amber-400 font-bold">${mData.bestTimeWindows?.[0]?.label || '06:00 ~ 08:00'}</span>（空閒機率高達 ${(100 - (mData.bestTimeWindows?.[0]?.rate || 0)).toFixed(0)}%）。
        </div>
      </div>
      <div class="flex gap-2 flex-wrap text-xs">
        ${(mData.bestTimeWindows || []).slice(0, 3).map((w, idx) => `
          <div class="px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200">
            <span class="text-emerald-400 font-mono font-bold">#${idx + 1}</span> ${w.label} (使用率 ${w.rate}%)
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Heatmap for this single machine -->
    ${renderHeatmapHtml(`${mData.description} 專屬 24H × 7D 使用熱度圖 (越深代表該時間越常有人投幣)`, mData.heatmap)}

    <!-- Machine Hourly Curve -->
    <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800 mt-6">
      <h3 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span>⏰</span> ${mData.description} 全天 24 小時使用概率曲線
      </h3>
      <div class="h-64 relative">
        <canvas id="machineHourlyChartCanvas"></canvas>
      </div>
    </div>
  `;

  const canvas = document.getElementById('machineHourlyChartCanvas');
  if (canvas) {
    if (mainChartInstance) mainChartInstance.destroy();
    mainChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }).map((_, h) => `${h}:00`),
        datasets: [{
          label: '使用率 (%)',
          data: mData.hourlyAverages,
          borderColor: isDryer ? '#f59e0b' : '#38bdf8',
          backgroundColor: isDryer ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
}

// 3. Render Overall View
function renderOverallView(data, body) {
  body.innerHTML = `
    <!-- Top Recommendation Alert -->
    <div class="mb-6 p-4 rounded-xl bg-gradient-to-r from-cyan-950/60 to-blue-950/60 border border-cyan-500/30 text-cyan-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 font-semibold text-white text-base">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></span>
          💡 全棟智慧離峰洗衣時段推薦
        </div>
        <div class="text-xs text-slate-300 mt-1">
          全棟最清閒時段為 
          <span class="text-amber-400 font-bold">${data.bestTimeWindows?.[0]?.label || '05:00 ~ 07:00'}</span> 
          （平均空閒率達 ${(100 - (data.bestTimeWindows?.[0]?.rate || 0)).toFixed(0)}%）。
        </div>
      </div>
      <div class="flex gap-2 flex-wrap text-xs">
        ${(data.bestTimeWindows || []).slice(0, 3).map((w, idx) => `
          <div class="px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200">
            <span class="text-cyan-400 font-mono font-bold">#${idx + 1}</span> ${w.label} (佔用率 ${w.rate}%)
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Heatmap -->
    ${renderHeatmapHtml('全棟每週 24 小時使用熱度矩陣 (Heatmap)', data.heatmap)}

    <!-- Charts Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 mb-8">
      <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        <h3 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span>🏢</span> 各樓層使用量比較 (2F vs 4F vs 6F vs 8F)
        </h3>
        <div class="h-64 relative">
          <canvas id="overallFloorChartCanvas"></canvas>
        </div>
      </div>

      <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        <h3 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span>⏰</span> 全棟 24 小時平均使用率曲線
        </h3>
        <div class="h-64 relative">
          <canvas id="overallHourlyChartCanvas"></canvas>
        </div>
      </div>
    </div>

    <!-- Rankings: Coldest vs Busiest -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="bg-slate-900/80 p-4 rounded-xl border border-emerald-500/20">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-emerald-400 flex items-center gap-2">
            <span>❄️</span> 最少人搶 / 最冷門機台 (Top 5)
          </h3>
          <span class="text-[11px] px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800">推薦使用</span>
        </div>
        <div class="space-y-2">
          ${(data.coldestMachines || []).map((m, idx) => `
            <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors text-xs border border-slate-700/50">
              <div class="flex items-center gap-2.5">
                <span class="w-5 h-5 rounded-full bg-emerald-900/70 text-emerald-300 flex items-center justify-center font-bold text-[11px]">${idx + 1}</span>
                <div>
                  <div class="font-medium text-white">${m.description}</div>
                  <div class="text-[10px] text-slate-400">${m.floor} · ${m.machine_type === 'washer' ? '洗衣機' : '烘衣機'}</div>
                </div>
              </div>
              <div class="text-right font-mono">
                <div class="text-emerald-400 font-semibold">${m.total_cycles} 次</div>
                <div class="text-[10px] text-slate-400">總累計 ${m.total_duration_min} 分鐘</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="bg-slate-900/80 p-4 rounded-xl border border-red-500/20">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-red-400 flex items-center gap-2">
            <span>🔥</span> 最熱門 / 尖峰常滿機台 (Top 5)
          </h3>
          <span class="text-[11px] px-2 py-0.5 rounded bg-red-950/70 text-red-300 border border-red-800">尖峰避開</span>
        </div>
        <div class="space-y-2">
          ${(data.busiestMachines || []).map((m, idx) => `
            <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors text-xs border border-slate-700/50">
              <div class="flex items-center gap-2.5">
                <span class="w-5 h-5 rounded-full bg-red-900/70 text-red-300 flex items-center justify-center font-bold text-[11px]">${idx + 1}</span>
                <div>
                  <div class="font-medium text-white">${m.description}</div>
                  <div class="text-[10px] text-slate-400">${m.floor} · ${m.machine_type === 'washer' ? '洗衣機' : '烘衣機'}</div>
                </div>
              </div>
              <div class="text-right font-mono">
                <div class="text-red-400 font-semibold">${m.total_cycles} 次</div>
                <div class="text-[10px] text-slate-400">累計收益 NT$${m.total_cost_ntd}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Draw Overall Floor Chart
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

  // Draw Overall Hourly Chart
  const canvas2 = document.getElementById('overallHourlyChartCanvas');
  if (canvas2 && data.hourlyAverages) {
    if (secondaryChartInstance) secondaryChartInstance.destroy();
    secondaryChartInstance = new Chart(canvas2, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }).map((_, h) => `${h}:00`),
        datasets: [{
          label: '平均使用率 (%)',
          data: data.hourlyAverages,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
}

// Helper: render Heatmap table
function renderHeatmapHtml(title, heatmapRows) {
  if (!heatmapRows) return '';
  return `
    <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-white flex items-center gap-2">
          <span>🔥</span> ${title}
        </h3>
        <div class="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span>空閒</span>
          <span class="w-3 h-3 rounded bg-slate-800 inline-block"></span>
          <span class="w-3 h-3 rounded bg-blue-700/60 inline-block"></span>
          <span class="w-3 h-3 rounded bg-amber-600/70 inline-block"></span>
          <span class="w-3 h-3 rounded bg-red-600/90 inline-block"></span>
          <span>極熱門</span>
        </div>
      </div>
      <div class="overflow-x-auto pb-2">
        <div class="min-w-[720px]">
          <!-- Hours Header -->
          <div class="grid grid-cols-[60px_repeat(24,1fr)] text-[10px] text-slate-400 text-center mb-1 font-mono">
            <div></div>
            ${Array.from({ length: 24 }).map((_, h) => `<div>${h}</div>`).join('')}
          </div>
          <!-- Days Rows -->
          ${heatmapRows.map((row) => `
            <div class="grid grid-cols-[60px_repeat(24,1fr)] gap-1 mb-1 items-center">
              <div class="text-xs text-slate-300 font-medium pl-1">${row.dayName}</div>
              ${row.hours.map((rate) => {
                let colorClass = 'bg-slate-800/60 text-slate-500';
                if (rate > 75) colorClass = 'bg-red-600/90 text-white font-bold';
                else if (rate > 50) colorClass = 'bg-amber-500/80 text-white';
                else if (rate > 25) colorClass = 'bg-blue-600/70 text-slate-200';
                else if (rate > 5) colorClass = 'bg-blue-900/50 text-slate-400';
                return `
                  <div title="${row.dayName} ${rate}% 使用率" 
                       class="h-7 rounded flex items-center justify-center text-[9px] font-mono transition-transform hover:scale-110 cursor-pointer ${colorClass}">
                    ${rate > 0 ? rate : ''}
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
