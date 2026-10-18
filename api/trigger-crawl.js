const WORKFLOW_DISPATCH_URL = 'https://api.github.com/repos/gigijim/UMC-3D-WasherMonitor/actions/workflows/crawl.yml/dispatches';

function getCallerKey(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^bearer\s+(.+)$/i);
  return match ? match[1] : req.query.key;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.CRON_SECRET;
  if (secret && getCallerKey(req) !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ success: false, error: 'Trigger is not configured' });
  }

  try {
    const ghRes = await fetch(WORKFLOW_DISPATCH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'UMC-3D-WasherMonitor-Cron-Webhook',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(10000)
    });

    if (!ghRes.ok) {
      return res.status(502).json({
        success: false,
        error: `GitHub API error (${ghRes.status})`
      });
    }

    return res.status(200).json({
      success: true,
      message: '✅ 爬蟲排程已觸發',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
