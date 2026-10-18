import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRealtimeDevice, summarize } from '../shared/device.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 本機開發讀取 backend/（或 LAUNDRY_DATA_DIR）內由 daemon 產生的資料，沒有則改抓 data 分支
const LOCAL_DATA_DIR = path.resolve(process.env.LAUNDRY_DATA_DIR || path.join(__dirname, '../backend'));
const DATA_BASE_URL = 'https://raw.githubusercontent.com/gigijim/UMC-3D-WasherMonitor/data/';
const DATA_FILES = {
  history: 'history_data.json',
  realtime: 'realtime_latest.json'
};

export default defineConfig({
  root: './',
  publicDir: 'public',
  server: {
    port: 3000,
    open: false
  },
  plugins: [
    {
      name: 'api-dev',
      configureServer(server) {
        server.middlewares.use('/api/data', async (req, res) => {
          const name = new URL(req.url, 'http://localhost').searchParams.get('name');
          const file = DATA_FILES[name];
          res.setHeader('Content-Type', 'application/json');
          if (!file) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Unknown data name' }));
            return;
          }

          const localPath = path.join(LOCAL_DATA_DIR, file);
          if (fs.existsSync(localPath)) {
            res.end(fs.readFileSync(localPath, 'utf-8'));
            return;
          }

          try {
            const response = await fetch(DATA_BASE_URL + file);
            res.statusCode = response.status;
            res.end(await response.text());
          } catch (err) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        server.middlewares.use('/api/realtime', async (req, res) => {
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
              res.statusCode = response.status;
              res.end(JSON.stringify({ error: 'Failed to fetch from alfaloop' }));
              return;
            }

            const data = await response.json();
            const place = data?.message?.place;
            if (!place) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Invalid response from alfaloop' }));
              return;
            }

            const now = Date.now();
            const devices = (place.devices || []).filter((d) => !d.testmode).map((d) => toRealtimeDevice(d, now));

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              updatedAt: new Date(now).toISOString(),
              summary: summarize(devices),
              merchant: place.merchant,
              place: { title: place.title, address: place.address },
              devices
            }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
