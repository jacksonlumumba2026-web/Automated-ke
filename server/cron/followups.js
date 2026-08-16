const cron = require('node-cron');
const db = require('../lib/db');
const sms = require('../lib/sms');

function start() {
  // Every 15 minutes: send any follow-up SMS that's now due.
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

  // Every Monday at 8am EAT (5am UTC): send each active client a weekly summary.
  cron.schedule('0 5 * * 1', async () => {
    const data = db.read();
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;

    for (const client of data.clients.filter((c) => c.active && c.ownerPhone)) {
      const weekTxns = data.transactions.filter(
        (t) => t.clientId === client.id && t.status === 'success' && new Date(t.time).getTime() >= weekAgo
      );
      const weekContacts = data.contacts.filter(
        (c) => c.clientId === client.id && new Date(c.createdAt).getTime() >= weekAgo
      );
      const revenue = weekTxns.reduce((sum, t) => sum + (t.amount || 0), 0);

      const message =
        `AutomateKE Weekly Summary for ${client.name}:\n` +
        `Payments: ${weekTxns.length} (Ksh ${revenue.toLocaleString()})\n` +
        `New contacts: ${weekContacts.length}\n` +
        `Have a great week!`;

      sms.sendSMS(client.ownerPhone, message).catch(() => {});
    }
  });
}

module.exports = { start };
