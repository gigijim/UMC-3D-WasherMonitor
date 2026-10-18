import { toRealtimeDevice, summarize } from '../shared/device.js';

const ALFALOOP_URL = 'https://app.alfaloop.com/ndr/fn/api/v1/web';
const PLACE_ID = '67359cb42f71210375a69599';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const ts = Math.floor(Date.now() / 1000);
    const response = await fetch(`${ALFALOOP_URL}?tz=Asia/Taipei&timestamp=${ts}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: JSON.stringify({
        action: 'checkoutPlaceStatus',
        placeId: PLACE_ID
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch from alfaloop' });
    }

    const data = await response.json();
    const place = data?.message?.place;
    if (!place) {
      return res.status(500).json({ error: 'Invalid response from alfaloop' });
    }

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
    return res.status(500).json({ error: err.message });
  }
}
