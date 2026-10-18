// 讀取 data 分支上由 GitHub Actions 爬蟲產生的最新資料
// 資料不再隨網站部署打包，爬蟲更新資料時不會觸發 Vercel 重新部署
const DATA_BASE_URL = 'https://raw.githubusercontent.com/gigijim/UMC-3D-WasherMonitor/data/';
const FILES = {
  history: 'history_data.json',
  realtime: 'realtime_latest.json'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const file = FILES[req.query.name];
  if (!file) {
    return res.status(400).json({ error: `Unknown data name. Use one of: ${Object.keys(FILES).join(', ')}` });
  }

  try {
    const response = await fetch(DATA_BASE_URL + file, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch data (${response.status})` });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).send(await response.text());
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
