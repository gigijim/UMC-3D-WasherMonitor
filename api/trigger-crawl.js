export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
      token = parts[1];
    }
  }

  if (!token) {
    token = req.query.token || req.query.key;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Missing GitHub Token. Please set GH_TOKEN environment variable in Vercel, or pass ?token=ghp_xxx query parameter.',
      usage: 'GET https://umc-3d-washermonitor.vercel.app/api/trigger-crawl?token=YOUR_GITHUB_TOKEN'
    });
  }

  try {
    const ghRes = await fetch('https://api.github.com/repos/gigijim/UMC-3D-WasherMonitor/actions/workflows/crawl.yml/dispatches', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'UMC-3D-WasherMonitor-Cron-Webhook',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      return res.status(ghRes.status).json({
        success: false,
        error: `GitHub API error (${ghRes.status}): ${errText}`
      });
    }

    return res.status(200).json({
      success: true,
      message: '✅ GitHub Actions 10-Minute IoT Laundry Monitor Crawler 爬蟲排程已成功即時喚醒觸發！',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
