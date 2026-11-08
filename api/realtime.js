import { toRealtimeDevice, summarize } from '../shared/device.js';
import { fetchPlace } from '../shared/alfaloop.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const place = await fetchPlace({ timeoutMs: 8000 });
    const now = Date.now();
    const devices = (place.devices || []).filter((d) => !d.testmode).map((d) => toRealtimeDevice(d, now));

    // 邊緣快取 20 秒：多位使用者同時開啟時，最多每 20 秒才向 Alfaloop 查詢一次
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=30');
    return res.status(200).json({
      updatedAt: new Date(now).toISOString(),
      summary: summarize(devices),
      merchant: place.merchant,
      place: { title: place.title, address: place.address },
      devices
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
