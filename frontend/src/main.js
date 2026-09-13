import { LaundryScene } from './three/LaundryScene.js';
import { renderAnalytics } from './components/Charts.js';

let scene = null;
let realtimeData = null;
let historyData = null;
let selectedDevice = null;
let timerInterval = null;
let isDemoMode = false; // 預設 100% 真實即時 IoT 數據
let demoStartTime = null;
let autoRefreshRemaining = 30;

function resetRefreshCountdown() {
  autoRefreshRemaining = 30;
  updateRefreshCountdownUI();
}

function updateRefreshCountdownUI() {
  const cdDesktop = document.getElementById('refresh-countdown');
  const cdMobile = document.getElementById('m-refresh-countdown');
  if (cdDesktop) cdDesktop.textContent = `${autoRefreshRemaining}s`;
  if (cdMobile) cdMobile.textContent = `自動刷新: ${autoRefreshRemaining}s`;
}

async function fetchRealtime() {
  let data = null;
  try {
    // 1. Try Vercel Serverless Function or local Vite proxy
    const res = await fetch('/api/realtime');
    if (res.ok) {
      data = await res.json();
    }
  } catch (err) {
    // fallback
  }

  // 2. Fallback to static snapshot JSON if API is offline
  if (!data || !data.devices) {
    const resFallback = await fetch('/data/realtime_latest.json');
    if (resFallback.ok) {
      data = await resFallback.json();
    }
  }

  if (data && data.devices) {
    const now = Date.now();

    // 1. 嚴格校驗與過期清理：倒數時間已結束者，100% 強制轉為閒置可使用！
    for (const dev of data.devices) {
      if (dev.dueTime) {
        const rem = Math.max(0, Math.floor((new Date(dev.dueTime).getTime() - now) / 1000));
        dev.remainingSec = rem;
        if (rem <= 0) {
          // 時間已到，自動轉為可使用
          dev.isRunning = false;
        }
      } else {
        dev.remainingSec = 0;
        if (!dev.connection) {
          dev.isRunning = false;
        }
      }
    }

    // 2. 模擬測試模式：啟用過半機台運轉 (15台 / 24台 = 62.5% > 50%，時間不一)
    if (isDemoMode) {
      if (!demoStartTime) demoStartTime = now;
      const elapsedSec = Math.floor((now - demoStartTime) / 1000);

      const demoConfigs = [
        // 2F (4台運轉)
        { floor: '2F', type: 'washer', num: 1, durationSec: 28 * 60 + 15 }, // 洗1: 28分15秒
        { floor: '2F', type: 'washer', num: 3, durationSec: 12 * 60 + 40 }, // 洗3: 12分40秒
        { floor: '2F', type: 'dryer',  num: 1, durationSec: 45 * 60 + 30 }, // 烘1: 45分30秒
        { floor: '2F', type: 'dryer',  num: 2, durationSec: 19 * 60 + 15 }, // 烘2: 19分15秒

        // 4F (4台運轉)
        { floor: '4F', type: 'washer', num: 1, durationSec: 35 * 60 + 20 }, // 洗1: 35分20秒
        { floor: '4F', type: 'washer', num: 2, durationSec: 8 * 60 + 10 },  // 洗2: 8分10秒
        { floor: '4F', type: 'washer', num: 4, durationSec: 22 * 60 + 30 }, // 洗4: 22分30秒
        { floor: '4F', type: 'dryer',  num: 2, durationSec: 54 * 60 + 45 }, // 烘2: 54分45秒

        // 6F (4台運轉)
        { floor: '6F', type: 'washer', num: 2, durationSec: 18 * 60 + 50 }, // 洗2: 18分50秒
        { floor: '6F', type: 'washer', num: 3, durationSec: 5 * 60 + 15 },  // 洗3: 5分15秒
        { floor: '6F', type: 'washer', num: 4, durationSec: 39 * 60 + 40 }, // 洗4: 39分40秒
        { floor: '6F', type: 'dryer',  num: 1, durationSec: 33 * 60 + 20 }, // 烘1: 33分20秒

        // 8F (3台運轉)
        { floor: '8F', type: 'washer', num: 1, durationSec: 31 * 60 + 10 }, // 洗1: 31分10秒
        { floor: '8F', type: 'washer', num: 4, durationSec: 14 * 60 + 25 }, // 洗4: 14分25秒
        { floor: '8F', type: 'dryer',  num: 1, durationSec: 62 * 60 + 15 }, // 烘1: 62分15秒
      ];

      for (const cfg of demoConfigs) {
        const dev = data.devices.find((d) =>
          d.floor === cfg.floor &&
          d.type === cfg.type &&
          (d.num === cfg.num || d.description.includes(`${cfg.num}號`))
        );
        if (dev) {
          const rem = Math.max(0, cfg.durationSec - elapsedSec);
          dev.connection = true;
          dev.isRunning = rem > 0;
          dev.remainingSec = rem;
          dev.dueTime = new Date(demoStartTime + cfg.durationSec * 1000).toISOString();
        }
      }
    }

    if (data.summary) {
      data.summary.running = data.devices.filter((d) => d.isRunning).length;
      data.summary.idle = data.devices.filter((d) => d.connection && !d.isRunning).length;
    }
    return data;
  }
  throw new Error('無法取得機台狀態資料');
}

async function fetchHistory() {
  try {
    const res = await fetch(`/data/history_data.json?t=${Date.now()}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('歷史數據載入失敗:', err);
  }
  return null;
}

function updateSummaryBadges(data) {
  if (!data?.summary) return;
  const { idle, running, total } = data.summary;

  const bIdle = document.getElementById('badge-idle');
  const bRunning = document.getElementById('badge-running');
  const mIdle = document.getElementById('m-badge-idle');
  const mRunning = document.getElementById('m-badge-running');
  const mTime = document.getElementById('m-update-time');

  if (bIdle) bIdle.textContent = `🟢 閒置: ${idle}`;
  if (bRunning) bRunning.textContent = `🟠 運轉: ${running}`;
  if (mIdle) mIdle.textContent = `🟢 閒置: ${idle}`;
  if (mRunning) mRunning.textContent = `🟠 運轉: ${running}`;

  if (mTime && data.updatedAt) {
    const d = new Date(data.updatedAt);
    mTime.textContent = `更新: ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
}

function showMachineDetail(device) {
  selectedDevice = device;
  const card = document.getElementById('machine-detail-card');
  if (!card) return;

  const isDryer = device.type === 'dryer';
  document.getElementById('card-type-icon').textContent = isDryer ? '💨' : '🧺';
  document.getElementById('card-title').textContent = device.description;
  document.getElementById('card-floor-desc').textContent = `${device.floor} · ${isDryer ? '烘衣機 (10元20分~50元99分)' : '洗衣機 (投幣 20 元 / 40 分鐘)'}`;

  const statusBox = document.getElementById('card-status-box');
  const statusDot = document.getElementById('card-status-dot');
  const statusText = document.getElementById('card-status-text');
  const timerText = document.getElementById('card-timer-text');
  const dueTimeText = document.getElementById('card-due-time');
  const rankText = document.getElementById('card-rank-text');
  const monthCyclesText = document.getElementById('card-month-cycles');
  const totalCostText = document.getElementById('card-total-cost');
  const adviceText = document.getElementById('card-advice');

  // Calculate dynamic stats combining historical DB records WITH live active running machines
  const isRunning = Boolean(device.isRunning);
  const costPerCycle = isDryer ? 10 : 20;

  if (historyData?.machineStats && historyData.machineStats.length > 0) {
    // Map with live running status so running machines immediately get credit for active session
    const liveStats = historyData.machineStats.map((m) => {
      const liveDev = realtimeData?.devices?.find((d) => d.hwid === m.hwid);
      const currentlyRunning = liveDev?.isRunning ? 1 : 0;
      return {
        ...m,
        effective_cycles: m.total_cycles + currentlyRunning,
        currentlyRunning: Boolean(currentlyRunning)
      };
    });

    // Sort by effective cycles DESC, then duration DESC
    liveStats.sort((a, b) => {
      if (b.effective_cycles !== a.effective_cycles) return b.effective_cycles - a.effective_cycles;
      return b.total_duration_min - a.total_duration_min;
    });

    const stat = historyData.machineStats.find((m) => m.hwid === device.hwid);
    const rankIndex = liveStats.findIndex((m) => m.hwid === device.hwid);
    const totalCount = liveStats.length;

    const histCycles = stat ? stat.total_cycles : 0;
    const histDuration = stat ? stat.total_duration_min : 0;
    const totalCyclesWithActive = histCycles + (isRunning ? 1 : 0);

    // 1. Total Cycles Display (若當前運轉中，明確標註包含本次進行中，杜絕 0 次疑惑)
    if (isRunning) {
      if (histCycles > 0) {
        monthCyclesText.innerHTML = `<span class="text-white font-bold">${histCycles} 次</span> <span class="text-amber-300 text-[10px] font-medium">(+1 本次運轉中)</span>`;
      } else {
        monthCyclesText.innerHTML = `<span class="text-amber-300 font-bold">1 次</span> <span class="text-slate-400 text-[10px] font-normal">(本次運轉中)</span>`;
      }
    } else {
      if (histCycles > 0) {
        monthCyclesText.textContent = `${histCycles} 次 (${histDuration} 分)`;
      } else {
        monthCyclesText.textContent = '0 次 (0 分)';
      }
    }

    // 2. Total Cost Display
    const totalCost = totalCyclesWithActive * costPerCycle;
    if (isRunning) {
      totalCostText.innerHTML = `<span class="text-emerald-300 font-bold">NT$ ${totalCost}</span> <span class="text-slate-400 text-[10px]">(含本次)</span>`;
    } else {
      totalCostText.textContent = `NT$ ${totalCost}`;
    }

    // 3. Ranking Display (運轉中機台立即享有排位計算，附帶運轉中角標)
    if (totalCyclesWithActive > 0 && rankIndex !== -1) {
      const medal = rankIndex === 0 ? '🥇' : rankIndex === 1 ? '🥈' : rankIndex === 2 ? '🥉' : '🏅';
      const runningTag = isRunning ? ' <span class="text-amber-400 text-[10px] font-normal">(運轉中)</span>' : '';
      rankText.innerHTML = `${medal} <span class="text-amber-300 font-bold">第 ${rankIndex + 1} 名</span> <span class="text-slate-400 text-[10px]">/ ${totalCount}台</span>${runningTag}`;
    } else {
      rankText.innerHTML = `<span class="text-slate-400 text-[11px]">暫無使用紀錄</span>`;
    }
  } else {
    if (rankText) rankText.textContent = isRunning ? '運轉中' : '--';
    if (monthCyclesText) monthCyclesText.textContent = isRunning ? '1 次 (本次運轉中)' : '-- 次';
    if (totalCostText) totalCostText.textContent = isRunning ? `NT$ ${costPerCycle}` : 'NT$ --';
  }

  if (!device.connection) {
    statusBox.className = 'p-3 rounded-xl mb-4 flex items-center justify-between bg-slate-800/80 border border-slate-700';
    statusDot.className = 'w-3 h-3 rounded-full bg-slate-500';
    statusText.className = 'font-semibold text-slate-300 text-sm';
    statusText.textContent = '離線 / 未知';
    timerText.className = 'text-xs font-mono text-slate-400';
    timerText.textContent = '設備未連線';
    dueTimeText.textContent = '無';
    adviceText.textContent = '⚠️ 提示：此機台目前處於離線狀態，可能正在維護或尚未開機。';
  } else if (device.isRunning) {
    if (isDryer) {
      statusBox.className = 'p-3 rounded-xl mb-4 flex items-center justify-between bg-red-950/70 border-2 border-red-500/80 shadow-[0_0_20px_rgba(239,68,68,0.35)]';
      statusDot.className = 'w-3 h-3 rounded-full bg-red-500 animate-ping';
      statusText.className = 'font-bold text-red-300 text-sm';
      statusText.textContent = '🔥 烘乾中...';
      adviceText.textContent = '⏳ 提示：烘乾機運轉中，請注意高溫，本次運轉結束後將自動彙整入歷史規律庫。';
    } else {
      statusBox.className = 'p-3 rounded-xl mb-4 flex items-center justify-between bg-yellow-950/70 border-2 border-yellow-400/80 shadow-[0_0_20px_rgba(250,204,21,0.35)]';
      statusDot.className = 'w-3 h-3 rounded-full bg-yellow-400 animate-ping';
      statusText.className = 'font-bold text-yellow-300 text-sm';
      statusText.textContent = '⚡ 洗衣中...';
      adviceText.textContent = '⏳ 提示：洗衣機運轉中，預計將於上述時間釋出，本次運轉結束後將自動彙整入歷史規律庫。';
    }

    const formatRemaining = () => {
      const remainingSec = Math.max(0, Math.floor((new Date(device.dueTime).getTime() - Date.now()) / 1000));
      const m = Math.floor(remainingSec / 60);
      const s = remainingSec % 60;
      timerText.textContent = `剩餘 ${m}分${s < 10 ? '0' : ''}${s}秒`;
      timerText.className = `text-xs font-mono font-bold ${isDryer ? 'text-red-200' : 'text-yellow-200'}`;
    };
    formatRemaining();

    if (device.dueTime) {
      const due = new Date(device.dueTime);
      dueTimeText.textContent = `${due.getHours().toString().padStart(2, '0')}:${due.getMinutes().toString().padStart(2, '0')}:${due.getSeconds().toString().padStart(2, '0')}`;
    }
  } else {
    statusBox.className = 'p-3 rounded-xl mb-4 flex items-center justify-between bg-emerald-950/50 border border-emerald-500/30';
    statusDot.className = 'w-3 h-3 rounded-full bg-emerald-400 animate-pulse';
    statusText.className = 'font-semibold text-emerald-300 text-sm';
    statusText.textContent = '可使用';
    timerText.className = 'text-xs font-mono text-slate-300';
    timerText.textContent = '隨時可投幣使用';
    dueTimeText.textContent = '隨時可用';
    adviceText.textContent = '✅ 提示：此機台目前閒置無人使用，可直接前往投幣使用！';
  }

  card.classList.remove('hidden');
}

function renderListView(devices) {
  const container = document.getElementById('list-view-grid');
  if (!container || !devices) return;

  const floorList = ['8F', '6F', '4F', '2F'];

  const floorsHtml = floorList.map((floorName) => {
    const devs = devices.filter((d) => d.floor === floorName);

    // Exact ordering: Screen Left-to-Right is 洗4, 烘2, 烘1, 洗3, 洗2, 洗1
    // So looking from Right-to-Left (由右至左) is: 洗1, 洗2, 洗3, 烘1, 烘2, 洗4
    const w1 = devs.find((d) => d.type === 'washer' && (d.num === 1 || d.description.includes('1號')));
    const w2 = devs.find((d) => d.type === 'washer' && (d.num === 2 || d.description.includes('2號')));
    const w3 = devs.find((d) => d.type === 'washer' && (d.num === 3 || d.description.includes('3號')));
    const d1 = devs.find((d) => d.type === 'dryer' && (d.num === 1 || d.description.includes('1號')));
    const d2 = devs.find((d) => d.type === 'dryer' && (d.num === 2 || d.description.includes('2號')));
    const w4 = devs.find((d) => d.type === 'washer' && (d.num === 4 || d.description.includes('4號')));

    const orderedMachines = [
      { dev: w4, label: '洗4' },
      { dev: d2, label: '烘2' },
      { dev: d1, label: '烘1' },
      { dev: w3, label: '洗3' },
      { dev: w2, label: '洗2' },
      { dev: w1, label: '洗1' }
    ];

    const idleCount = devs.filter((d) => d.connection && !d.isRunning).length;
    const runningCount = devs.filter((d) => d.isRunning).length;

    return `
      <div class="mb-5 bg-slate-950/70 p-4 rounded-2xl border border-slate-800">
        <!-- Floor Header: Large Floor Badge + Adjacent Prominent Counters -->
        <div class="flex items-center justify-between mb-3 border-b border-slate-800 pb-2.5">
          <div class="flex items-center gap-3">
            <span class="px-3.5 py-1 rounded-xl bg-cyan-950 text-cyan-300 border-2 border-cyan-500 font-black font-mono text-xl sm:text-2xl shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              ${floorName}
            </span>
            <div class="flex items-center gap-2">
              <span class="px-3 py-1 rounded-lg bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 font-bold font-mono text-xs sm:text-sm flex items-center gap-1.5 shadow">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                閒置 ${idleCount}
              </span>
              <span class="px-3 py-1 rounded-lg ${runningCount > 0 ? 'bg-yellow-950/90 border-2 border-yellow-400 text-yellow-300 shadow-[0_0_18px_rgba(250,204,21,0.5)] animate-pulse' : 'bg-slate-800/80 border border-slate-700 text-slate-400'} font-bold font-mono text-xs sm:text-sm flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full ${runningCount > 0 ? 'bg-yellow-400' : 'bg-slate-500'}"></span>
                運轉 ${runningCount}
              </span>
            </div>
          </div>
        </div>

        <!-- 6 Machines Row (Ordered Right-to-Left: 洗1..洗4 on Col 6..1) -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          ${orderedMachines.map((slot) => {
            const d = slot.dev;
            if (!d) return '';
            const isDryer = d.type === 'dryer';

            // Distinct non-yellow styling for idle dryer & washer
            let cardBg = 'bg-slate-900/90 border border-slate-700/80 hover:border-slate-500';
            let badgeStyle = isDryer ? 'bg-slate-800 text-slate-200 border border-slate-600' : 'bg-sky-950 text-sky-300 border border-sky-800';

            // High-luminance electric colors when running
            if (d.isRunning) {
              if (isDryer) {
                cardBg = 'bg-gradient-to-b from-red-950/90 via-slate-900 to-slate-950 border-2 border-red-500 shadow-[0_0_24px_rgba(239,68,68,0.5)]';
                badgeStyle = 'bg-red-900 text-red-200 border border-red-400';
              } else {
                cardBg = 'bg-gradient-to-b from-yellow-950/90 via-slate-900 to-slate-950 border-2 border-yellow-400 shadow-[0_0_24px_rgba(250,204,21,0.5)]';
                badgeStyle = 'bg-yellow-900 text-yellow-200 border border-yellow-400';
              }
            } else if (!d.connection) {
              cardBg = 'bg-slate-900/50 border border-slate-800 opacity-60';
              badgeStyle = 'bg-slate-800 text-slate-500 border border-slate-700';
            }

            let remSec = 0;
            if (d.isRunning && d.dueTime) {
              remSec = Math.max(0, Math.floor((new Date(d.dueTime).getTime() - Date.now()) / 1000));
            }
            const remMin = Math.floor(remSec / 60);
            const remSecMod = remSec % 60;

            return `
              <div data-hwid="${d.hwid}" class="list-item-card p-3 rounded-xl border ${cardBg} flex flex-col justify-between cursor-pointer hover:scale-[1.02] transition-all shadow-md min-h-[105px]">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-1.5">
                    <span class="px-2 py-0.5 rounded text-[11px] font-black font-mono ${badgeStyle}">
                      ${slot.label}
                    </span>
                    <span class="text-xs sm:text-sm font-bold text-slate-100 tracking-tight whitespace-nowrap">${isDryer ? '烘乾機' : '洗衣機'}</span>
                  </div>
                </div>

                <!-- Big Prominent Status & Countdown Info (No Line-wrap, No space after 剩, 秒 is always visible) -->
                <div class="pt-1">
                  ${!d.connection ? `
                    <div class="text-xs font-semibold text-slate-500">離線 / 未連線</div>
                    <div class="text-[11px] font-mono text-slate-600 mt-1">無訊號</div>
                  ` : d.isRunning ? `
                    <div class="text-xs font-black ${isDryer ? 'text-red-400' : 'text-yellow-300'} flex items-center gap-1.5">
                      <span class="w-2.5 h-2.5 rounded-full ${isDryer ? 'bg-red-500' : 'bg-yellow-400'} animate-ping"></span>
                      ${isDryer ? '🔥 烘乾中' : '⚡ 洗衣中'}
                    </div>
                    <div class="list-card-timer text-[12px] sm:text-[13px] font-bold ${isDryer ? 'text-red-200 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-yellow-200 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]'} tracking-tight whitespace-nowrap mt-1 flex items-center">
                      <span>⏳&nbsp;剩</span><span class="timer-min font-mono font-black">${remMin}</span><span>分</span><span class="timer-sec font-mono font-black">${remSecMod < 10 ? '0' : ''}${remSecMod}</span><span>秒</span>
                    </div>
                  ` : `
                    <div class="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      可使用
                    </div>
                    <div class="text-xs font-medium text-slate-400 mt-1 whitespace-nowrap">隨時可投幣</div>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  container.className = 'flex flex-col gap-2';
  container.innerHTML = floorsHtml;

  container.querySelectorAll('.list-item-card').forEach((el) => {
    el.addEventListener('click', () => {
      const hwid = el.dataset.hwid;
      const dev = devices.find((d) => d.hwid === hwid);
      if (dev) {
        document.getElementById('list-view-modal')?.classList.add('hidden');
        showMachineDetail(dev);
        const mesh = scene?.machineMeshes.get(hwid);
        if (mesh) scene.focusOnMachine(mesh);
      }
    });
  });
}

async function refreshAll() {
  resetRefreshCountdown();
  const btn = document.getElementById('btn-refresh');
  const icon = document.getElementById('btn-refresh-icon');
  const text = document.getElementById('btn-refresh-text');

  // 柔和微動畫：僅旋轉內部 SVG 箭頭並加上青色外圈微發光，避免整個按鈕選轉帶來的卡頓跳動
  if (icon) icon.classList.add('animate-spin');
  if (btn) {
    btn.classList.add('ring-2', 'ring-cyan-400', 'bg-cyan-950/70', 'border-cyan-500', 'shadow-[0_0_12px_rgba(6,182,212,0.4)]');
  }
  if (text) text.textContent = '同步中';

  try {
    const [data, hist] = await Promise.all([
      fetchRealtime(),
      fetchHistory()
    ]);
    realtimeData = data;
    if (hist) historyData = hist;
    updateSummaryBadges(data);

    if (scene && data.devices) {
      scene.populateMachines(data.devices);
    }
    renderListView(data.devices);

    if (selectedDevice) {
      const updated = data.devices.find((d) => d.hwid === selectedDevice.hwid);
      if (updated) showMachineDetail(updated);
    }

    const analyticsModal = document.getElementById('analytics-modal');
    const analyticsContent = document.getElementById('analytics-content');
    if (analyticsModal && !analyticsModal.classList.contains('hidden') && historyData) {
      renderAnalytics(historyData, analyticsContent);
    }
  } catch (err) {
    console.error('更新失敗:', err);
  } finally {
    setTimeout(() => {
      if (icon) icon.classList.remove('animate-spin');
      if (btn) {
        btn.classList.remove('ring-2', 'ring-cyan-400', 'bg-cyan-950/70', 'border-cyan-500', 'shadow-[0_0_12px_rgba(6,182,212,0.4)]');
      }
      if (text) text.textContent = '刷新';
    }, 600);
  }
}

async function initApp() {
  const container = document.getElementById('webgl-container');

  // Initialize 3D scene
  scene = new LaundryScene(container, (device) => {
    showMachineDetail(device);
    const btnPin = document.getElementById('btn-pin-view');
    if (btnPin) {
      btnPin.classList.add('hidden');
      btnPin.style.display = 'none';
    }
  });

  // Load initial data
  historyData = await fetchHistory();
  await refreshAll();

  // Timer interval for real-time second ticking & auto-refresh countdown
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    // 1. 頁面自動刷新倒數提示 (每 30 秒自動向雲端同步一次最新數據)
    autoRefreshRemaining--;
    if (autoRefreshRemaining <= 0) {
      refreshAll();
      return;
    }
    updateRefreshCountdownUI();

    const now = Date.now();
    let stateChanged = false;

    if (realtimeData?.devices) {
      for (const dev of realtimeData.devices) {
        if (dev.isRunning && dev.dueTime) {
          const remSec = Math.max(0, Math.floor((new Date(dev.dueTime).getTime() - now) / 1000));
          dev.remainingSec = remSec;
          if (remSec <= 0) {
            // 倒數結束！立即切換為閒置狀態，杜絕一直卡在運轉中
            dev.isRunning = false;
            dev.dueTime = null;
            stateChanged = true;
          }
        }
      }
    }

    if (stateChanged) {
      // 重新計算閒置與運轉總數並即時更新 3D 與 2D 畫面
      realtimeData.summary.running = realtimeData.devices.filter((d) => d.isRunning).length;
      realtimeData.summary.idle = realtimeData.devices.filter((d) => d.connection && !d.isRunning).length;
      updateSummaryBadges(realtimeData);
      scene?.updateMachineStatus(realtimeData.devices);
      renderListView(realtimeData.devices);
      if (selectedDevice) {
        const updated = realtimeData.devices.find((d) => d.hwid === selectedDevice.hwid);
        if (updated) showMachineDetail(updated);
      }
    } else {
      // 1. Update machine detail drawer card if open
      if (selectedDevice && selectedDevice.isRunning && selectedDevice.dueTime) {
        const timerText = document.getElementById('card-timer-text');
        if (timerText) {
          const m = Math.floor(selectedDevice.remainingSec / 60);
          const s = selectedDevice.remainingSec % 60;
          timerText.textContent = `剩餘 ${m}分${s < 10 ? '0' : ''}${s}秒`;
        }
      }

      // 2. Update list view card timers dynamically every second
      const listModal = document.getElementById('list-view-modal');
      if (listModal && !listModal.classList.contains('hidden') && realtimeData?.devices) {
        document.querySelectorAll('.list-item-card[data-hwid]').forEach((card) => {
          const hwid = card.dataset.hwid;
          const dev = realtimeData.devices.find((d) => d.hwid === hwid);
          if (dev && dev.isRunning && dev.remainingSec > 0) {
            const timerEl = card.querySelector('.list-card-timer');
            if (timerEl) {
              const remMin = Math.floor(dev.remainingSec / 60);
              const remSecMod = dev.remainingSec % 60;
              const minEl = timerEl.querySelector('.timer-min');
              const secEl = timerEl.querySelector('.timer-sec');
              if (minEl && secEl) {
                minEl.textContent = remMin;
                secEl.textContent = remSecMod < 10 ? '0' + remSecMod : remSecMod;
              }
            }
          }
        });
      }
    }
  }, 1000);

  // Bind Floor Buttons & Pin View Toggle
  const floorButtons = document.querySelectorAll('.floor-btn');
  const btnPin = document.getElementById('btn-pin-view');
  const pinIcon = document.getElementById('pin-icon');
  const pinText = document.getElementById('pin-text');

  const updatePinButtonUI = (isPinned) => {
    if (!btnPin) return;
    if (isPinned) {
      btnPin.className = 'px-2 py-1 rounded-lg text-xs flex items-center gap-1 transition-all bg-amber-950/70 text-amber-300 border border-amber-500/40 hover:bg-amber-900/60 shadow-inner';
      btnPin.title = '目前為固定視角，點擊開啟動態巡航';
      if (pinIcon) pinIcon.textContent = '📌';
      if (pinText) pinText.textContent = '固定視角';
    } else {
      btnPin.className = 'px-2 py-1 rounded-lg text-xs flex items-center gap-1 transition-all bg-slate-800/80 text-cyan-300 border border-cyan-500/30 hover:bg-slate-700';
      btnPin.title = '目前為動態巡航中，點擊固定視角';
      if (pinIcon) pinIcon.textContent = '📍';
      if (pinText) pinText.textContent = '動態巡航';
    }
  };

  btnPin?.addEventListener('click', () => {
    if (!scene) return;
    const isPinned = scene.togglePinView();
    updatePinButtonUI(isPinned);
  });

  floorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      floorButtons.forEach((b) => {
        b.classList.remove('bg-cyan-600', 'text-white');
        b.classList.add('text-slate-300');
      });
      btn.classList.add('bg-cyan-600', 'text-white');
      btn.classList.remove('text-slate-300');

      const floor = btn.dataset.floor;
      scene.setFloorFocus(floor);

      if (btnPin) {
        if (floor === 'all') {
          btnPin.classList.remove('hidden');
          btnPin.style.display = 'flex';
          updatePinButtonUI(scene.isPinned);
        } else {
          btnPin.classList.add('hidden');
          btnPin.style.display = 'none';
        }
      }
    });
  });

  // Bind UI Controls
  document.getElementById('btn-refresh')?.addEventListener('click', refreshAll);

  // Toggle Demo Mode (可手動開啟過半機台模擬測試，或隨時恢復真實 IoT 監控)
  const btnDemo = document.getElementById('btn-toggle-demo');
  btnDemo?.addEventListener('click', async () => {
    isDemoMode = !isDemoMode;
    demoStartTime = isDemoMode ? Date.now() : null;
    btnDemo.classList.toggle('bg-amber-600', isDemoMode);
    btnDemo.classList.toggle('text-white', isDemoMode);
    btnDemo.classList.toggle('border-amber-400', isDemoMode);
    const demoLabel = document.getElementById('demo-btn-text');
    if (demoLabel) demoLabel.textContent = isDemoMode ? '恢復真實' : '模擬測試';
    btnDemo.title = isDemoMode ? '點擊結束模擬測試，恢復即時真實數據' : '切換真實即時數據 / 模擬測試 (過半機台運轉)';
    await refreshAll();
  });

  document.getElementById('card-close-btn')?.addEventListener('click', () => {
    document.getElementById('machine-detail-card')?.classList.add('hidden');
    selectedDevice = null;
    if (btnPin && scene?.currentFocusFloor === 'all') {
      btnPin.classList.remove('hidden');
      btnPin.style.display = 'flex';
    }
  });

  // View Detailed Report for Selected Machine
  document.getElementById('card-view-report-btn')?.addEventListener('click', async () => {
    if (!selectedDevice) return;
    const analyticsModal = document.getElementById('analytics-modal');
    const analyticsContent = document.getElementById('analytics-content');
    analyticsModal?.classList.remove('hidden');

    if (!historyData) {
      historyData = await fetchHistory();
    }
    renderAnalytics(historyData, analyticsContent, {
      scope: 'machine',
      hwid: selectedDevice.hwid
    });
  });

  // Analytics Modal
  const analyticsModal = document.getElementById('analytics-modal');
  const analyticsContent = document.getElementById('analytics-content');
  document.getElementById('btn-open-analytics')?.addEventListener('click', async () => {
    analyticsModal?.classList.remove('hidden');
    historyData = await fetchHistory();
    renderAnalytics(historyData, analyticsContent);
  });

  document.getElementById('analytics-close-btn')?.addEventListener('click', () => {
    analyticsModal?.classList.add('hidden');
  });

  // 2D List View Modal
  const listModal = document.getElementById('list-view-modal');
  document.getElementById('btn-list-view')?.addEventListener('click', () => {
    listModal?.classList.remove('hidden');
  });
  document.getElementById('list-close-btn')?.addEventListener('click', () => {
    listModal?.classList.add('hidden');
  });

  // PWA & iOS Add to Home Screen Setup
  const pwaModal = document.getElementById('pwa-install-modal');
  const btnInstall = document.getElementById('btn-install-pwa');
  const mBtnInstall = document.getElementById('m-btn-install-pwa');
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  if (isStandalone) {
    if (btnInstall) btnInstall.style.display = 'none';
    if (mBtnInstall) mBtnInstall.style.display = 'none';
  } else {
    const openPwaModal = () => pwaModal?.classList.remove('hidden');
    btnInstall?.addEventListener('click', openPwaModal);
    mBtnInstall?.addEventListener('click', openPwaModal);

    document.getElementById('pwa-modal-close')?.addEventListener('click', () => {
      pwaModal?.classList.add('hidden');
    });
    document.getElementById('pwa-modal-ok')?.addEventListener('click', () => {
      pwaModal?.classList.add('hidden');
    });
  }

  // Register PWA Service Worker for offline shell and installability
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('ServiceWorker registration note:', err);
    });
  }
}

window.addEventListener('DOMContentLoaded', initApp);
