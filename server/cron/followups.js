const cron = require('node-cron');
const db = require('../lib/db');
const sms = require('../lib/sms');

function start() {
  // Every 15 minutes, send any follow-up SMS that's now due.
  cron.schedule('*/15 * * * *', async () => {
    const data = db.read();
    const now = Date.now();
    const due = data.followups.filter((f) => f.status === 'pending' && new Date(f.dueAt).getTime() <= now);
    if (!due.length) return;

    for (const f of due) {
      try {
        await sms.sendSMS(f.contactPhone, f.message);
        await db.update((d) => {
          const target = d.followups.find((x) => x.id === f.id);
          if (target) target.status = 'sent';
        });
      } catch {
        // leave as pending; will retry on the next tick
      }
    }
  });
}

module.exports = { start };
