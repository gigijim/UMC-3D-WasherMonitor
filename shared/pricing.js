// 計價規則（依機台設定）
// 洗衣機：NT$20 / 40 分
// 一般烘衣機：NT$10 / 20 分，最多累投至 99 分（NT$50）
// 特例機台在 SPECIAL_DRYERS 設定，日後新增特例只需修改此處
const COIN = 10;
const DRYER_MAX_MIN = 99;

const STANDARD_DRYER = { minutesPerCoin: 20, maxCost: 50 };

// key = `${floor}-${machine_num}`
const SPECIAL_DRYERS = {
  // 6F烘乾機2號：投 NT$10 可運轉 40 分鐘，一次最多 NT$30（達 99 分鐘上限）
  '6F-2': { minutesPerCoin: 40, maxCost: 30 }
};

function getDryerRate(machine) {
  return SPECIAL_DRYERS[`${machine.floor}-${machine.machine_num}`] || STANDARD_DRYER;
}

function calculateCost(machine, durationMin) {
  if (machine.machine_type === 'washer') {
    const cycles = Math.max(1, Math.round(durationMin / 40));
    return cycles * 20;
  }

  const rate = getDryerRate(machine);
  // 容許 3 分鐘誤差（dueTime 秒數取整造成的 41、61 分等）
  const coins = Math.max(1, Math.ceil((durationMin - 3) / rate.minutesPerCoin));
  return Math.min(rate.maxCost, coins * COIN);
}

// 機台資訊卡顯示用的價目文字
function getPriceLabel(machine) {
  if (machine.machine_type === 'washer') return '洗衣機 (投幣 20 元 / 40 分鐘)';
  const rate = getDryerRate(machine);
  return `烘衣機 (10元${rate.minutesPerCoin}分~${rate.maxCost}元${DRYER_MAX_MIN}分)`;
}

module.exports = {
  DRYER_MAX_MIN,
  calculateCost,
  getDryerRate,
  getPriceLabel
};
