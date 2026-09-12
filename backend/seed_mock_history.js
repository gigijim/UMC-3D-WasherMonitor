const { getDb, initDb, calculateCost } = require('./db');

function seedRealisticHistory(daysBack = 30) {
  initDb();
  const db = getDb();

  const countStmt = db.prepare('SELECT COUNT(*) as count FROM usage_events');
  const existingCount = countStmt.get().count;

  if (existingCount > 50) {
    console.log(`[Seed] Database already has ${existingCount} events. Skipping seed.`);
    db.close();
    return;
  }

  console.log(`[Seed] Generating realistic ${daysBack}-day historical data for 24 machines...`);

  const devices = db.prepare('SELECT * FROM devices').all();
  if (devices.length === 0) {
    console.log('[Seed] No devices found. Please run collector.js first.');
    db.close();
    return;
  }

  const insertEventStmt = db.prepare(`
    INSERT INTO usage_events (hwid, floor, machine_type, machine_num, start_time, end_time, duration_min, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date();
  let totalInserted = 0;

  // Floor weight: 2F (1.25) > 4F (1.1) > 6F (0.95) > 8F (0.78)
  const floorWeights = { '2F': 1.25, '4F': 1.1, '6F': 0.95, '8F': 0.78 };

  db.exec('BEGIN TRANSACTION');

  try {
    for (let day = daysBack; day >= 1; day--) {
      const targetDate = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
      const dayOfWeek = targetDate.getDay(); // 0 is Sunday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (const dev of devices) {
        const fWeight = floorWeights[dev.floor] || 1.0;
        const baseCycles = dev.machine_type === 'washer' ? (isWeekend ? 3.5 : 2.5) : (isWeekend ? 2.8 : 1.8);
        const cyclesToday = Math.max(0, Math.round((baseCycles + (Math.random() * 2 - 1)) * fWeight));

        for (let c = 0; c < cyclesToday; c++) {
          const rand = Math.random();
          let hour = 21;
          if (rand < 0.35) {
            hour = 20 + Math.floor(Math.random() * 4); // 20, 21, 22, 23
          } else if (rand < 0.55) {
            hour = 17 + Math.floor(Math.random() * 3); // 17, 18, 19
          } else if (rand < 0.75) {
            hour = isWeekend ? (12 + Math.floor(Math.random() * 5)) : (7 + Math.floor(Math.random() * 3));
          } else if (rand < 0.92) {
            hour = 10 + Math.floor(Math.random() * 7); // 10..16
          } else {
            hour = Math.floor(Math.random() * 6); // 0..5
          }

          const minute = Math.floor(Math.random() * 50);
          const startTime = new Date(targetDate);
          startTime.setHours(hour, minute, 0, 0);

          let durationMin = 40;
          if (dev.machine_type === 'dryer') {
            const dryerChoices = [20, 40, 40, 60, 80];
            durationMin = dryerChoices[Math.floor(Math.random() * dryerChoices.length)];
          }

          const endTime = new Date(startTime.getTime() + durationMin * 60 * 1000);
          const cost = calculateCost(dev.machine_type, durationMin);

          insertEventStmt.run(
            dev.hwid,
            dev.floor,
            dev.machine_type,
            dev.machine_num,
            startTime.toISOString(),
            endTime.toISOString(),
            durationMin,
            cost,
            startTime.toISOString()
          );
          totalInserted++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }

  console.log(`[Seed] Successfully seeded ${totalInserted} historical events across ${daysBack} days.`);
}

if (require.main === module) {
  seedRealisticHistory(30);
}

module.exports = {
  seedRealisticHistory
};
