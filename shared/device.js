const { getPriceLabel } = require('./pricing');

// 機台描述解析（後端爬蟲、Vercel API、Vite 本機開發伺服器共用的唯一版本）
// 例：「6F烘乾機2號」→ { floor: '6F', machine_type: 'dryer', machine_num: 2 }
const FLOORS = ['2F', '4F', '6F', '8F'];

function parseDeviceInfo(description = '') {
  let floor = 'Unknown';
  let machine_type = 'unknown';
  let machine_num = 1;

  for (const f of FLOORS) {
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

// 將 Alfaloop 原始設備資料轉為前端使用的即時狀態格式
function toRealtimeDevice(device, nowMs = Date.now()) {
  const { floor, machine_type, machine_num } = parseDeviceInfo(device.description);
  const connection = Boolean(device.connection);
  const dueTime = device.modelStatus?.operationStatus?.dueTime || null;
  let remainingSec = 0;
  let isRunning = false;

  if (connection && dueTime) {
    remainingSec = Math.max(0, Math.floor((new Date(dueTime).getTime() - nowMs) / 1000));
    isRunning = remainingSec > 0;
  }

  return {
    hwid: device.hwid,
    vendorHwid: device.vendorHwid,
    description: device.description,
    floor,
    type: machine_type,
    num: machine_num,
    priceLabel: getPriceLabel({ floor, machine_type, machine_num }),
    connection,
    isRunning,
    dueTime,
    remainingSec
  };
}

function summarize(devices) {
  return {
    total: devices.length,
    running: devices.filter((d) => d.isRunning).length,
    idle: devices.filter((d) => d.connection && !d.isRunning).length,
    offline: devices.filter((d) => !d.connection).length
  };
}

module.exports = {
  parseDeviceInfo,
  toRealtimeDevice,
  summarize
};
