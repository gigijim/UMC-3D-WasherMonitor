// Alfaloop 機況查詢（爬蟲、Vercel /api/realtime、Vite 本機開發伺服器共用）
//
// 2026-11-05 起廠商換裝新一代連網模組（AB2），機況改由 service.alfaloop.com 的新 API 提供。
// 舊 API（app.alfaloop.com checkoutPlaceStatus）仍會回應 200，但資料停在換裝當下、全部顯示離線，
// 因此不可作為備援，否則會把凍結的資料當成最新狀態。
const PLACE_ID = '67359cb42f71210375a69599';
const API_URL = 'https://service.alfaloop.com/api/v1/public/device/device-cloud/info-list';

// 換裝後每台機器的 id 都變了。以機台名稱對應回原本的 hwid，讓資料庫的歷史紀錄與每台機台的分析得以延續。
// 新增的機台（不在表內）會直接使用新 API 的 id。
const LEGACY_HWIDS = {
  '2F洗衣機1號': '7E9100CD',
  '2F洗衣機2號': '0996305B',
  '2F洗衣機3號': '97F2A5F8',
  '2F洗衣機4號': 'A399B0C6',
  '2F烘乾機1號': 'E0F5956E',
  '2F烘乾機2號': 'C35E3923',
  '4F洗衣機1號': 'E7985177',
  '4F洗衣機2號': 'D49E8050',
  '4F洗衣機3號': '4D97D1EA',
  '4F洗衣機4號': 'D3F34449',
  '4F烘乾機1號': '3A90E17C',
  '4F烘乾機2號': 'A4F474DF',
  '6F洗衣機1號': '4AFA15F3',
  '6F洗衣機2號': '3DFD2565',
  '6F洗衣機3號': 'AD4238F4',
  '6F洗衣機4號': '53069C9F',
  '6F烘乾機1號': 'DA450862',
  '6F烘乾機2號': '2401AC09',
  '8F洗衣機1號': 'CA0FCD25',
  '8F洗衣機2號': 'BD08FDB3',
  '8F洗衣機3號': '236C6810',
  '8F洗衣機4號': 'BA6539AA',
  '8F烘乾機1號': '546B5886',
  '8F烘乾機2號': 'CD62093C'
};

// 把新 API 的單台資料轉成系統內部沿用的格式（與舊 API 的 device 結構相同）
function normalizeDevice(item) {
  const names = item.machine?.name || {};
  const description = names['zh-TW'] || Object.values(names)[0] || '';
  return {
    hwid: LEGACY_HWIDS[description] || item.id,
    vendorHwid: item.serialNum != null ? String(item.serialNum) : '',
    description,
    model: item.machine?.model || item.type || '',
    connection: Boolean(item.deviceHardware?.connection),
    testmode: false,
    modelStatus: { operationStatus: { dueTime: item.machine?.dueTime || null } }
  };
}

/**
 * 查詢宿舍所有機台的即時狀態
 * @returns {Promise<{title, address, merchant, devices}>} devices 為 normalizeDevice 後的格式
 */
async function fetchPlace({ timeoutMs = 10000 } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const url = `${API_URL}?placeId=${PLACE_ID}&tz=Asia%2FTaipei&timestamp=${ts}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Alfaloop HTTP ${response.status}`);
  }

  const data = await response.json();
  const result = data?.result;
  if (!Array.isArray(result?.list)) {
    throw new Error(`Unexpected Alfaloop response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    title: result.place?.title || '',
    address: result.place?.address || '',
    merchant: result.merchant,
    devices: result.list.map(normalizeDevice)
  };
}

module.exports = {
  PLACE_ID,
  LEGACY_HWIDS,
  normalizeDevice,
  fetchPlace
};
