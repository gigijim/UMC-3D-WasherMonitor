import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRealtimeDevice, summarize } from '../shared/device.js';
import { fetchPlace } from '../shared/alfaloop.js';

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
            const place = await fetchPlace();

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
