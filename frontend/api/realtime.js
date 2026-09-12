export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const ts = Math.floor(Date.now() / 1000);
    const url = `https://app.alfaloop.com/ndr/fn/api/v1/web?tz=Asia/Taipei&timestamp=${ts}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: JSON.stringify({
        action: 'checkoutPlaceStatus',
        placeId: '67359cb42f71210375a69599'
      })
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch from alfaloop' });
    }

    const data = await response.json();
    const place = data?.message?.place;
    if (!place) {
      return res.status(500).json({ error: 'Invalid response from alfaloop' });
    }

    const now = new Date();
    const devices = (place.devices || []).filter((d) => !d.testmode).map((d) => {
      let floor = 'Unknown';
      for (const f of ['2F', '4F', '6F', '8F']) {
        if (d.description.includes(f)) { floor = f; break; }
      }
      const type = d.description.includes('烘') ? 'dryer' : 'washer';
      let num = 1;
      const match = d.description.match(/(\d+)號/);
      if (match) num = parseInt(match[1], 10);

      const connection = Boolean(d.connection);
      const dueTime = d.modelStatus?.operationStatus?.dueTime || null;
      let remainingSec = 0;
      let isRunning = false;

      if (connection && dueTime) {
        remainingSec = Math.max(0, Math.floor((new Date(dueTime).getTime() - now.getTime()) / 1000));
        isRunning = remainingSec > 0;
      }

      return {
        hwid: d.hwid,
        vendorHwid: d.vendorHwid,
        description: d.description,
        floor,
        type,
        num,
        connection,
        isRunning,
        dueTime,
        remainingSec
      };
    });

    const running = devices.filter((d) => d.isRunning).length;
    const idle = devices.filter((d) => d.connection && !d.isRunning).length;
    const offline = devices.filter((d) => !d.connection).length;

    return res.status(200).json({
      updatedAt: now.toISOString(),
      summary: { total: devices.length, running, idle, offline },
      merchant: place.merchant,
      place: { title: place.title, address: place.address },
      devices
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
