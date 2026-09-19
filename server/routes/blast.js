const express = require('express');
const db = require('../lib/db');
const sms = require('../lib/sms');
const { requireClient } = require('../lib/auth');
const { getPlan } = require('../lib/plans');

const router = express.Router();

router.get('/', requireClient, (req, res) => {
  const data = db.read();
  const blasts = (data.blasts || [])
    .filter((b) => b.clientId === req.auth.clientId)
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    .slice(0, 20);
  res.json(blasts);
});

router.post('/', requireClient, async (req, res) => {
  const { message, tag, preview } = req.body || {};
  if (!message || message.trim().length < 3) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (!sms.isConfigured()) {
    return res.status(400).json({ error: "SMS not configured. Add Africa's Talking keys in Settings." });
  }

  const data = db.read();
  let contacts = data.contacts.filter((c) => c.clientId === req.auth.clientId);
  if (tag === 'lead') contacts = contacts.filter((c) => c.status === 'lead');
  if (tag === 'customer') contacts = contacts.filter((c) => c.status === 'customer');

  if (preview) {
    return res.json({
      count: contacts.length,
      contacts: contacts.slice(0, 5).map((c) => ({ name: c.name, phone: c.phone })),
    });
  }

  if (!contacts.length) return res.status(400).json({ error: 'No contacts to send to' });

  // Check monthly SMS quota
  const owner = data.clients.find((c) => c.id === req.auth.clientId);
  const plan = getPlan(owner?.plan);
  if (plan.smsQuota !== -1) {
    const thisMonth = new Date();
    const smsSentThisMonth = (data.blasts || [])
      .filter(
        (b) =>
          b.clientId === req.auth.clientId &&
          new Date(b.sentAt).getMonth() === thisMonth.getMonth() &&
          new Date(b.sentAt).getFullYear() === thisMonth.getFullYear()
      )
      .reduce((sum, b) => sum + (b.recipientCount || 0), 0);

    if (smsSentThisMonth + contacts.length > plan.smsQuota) {
      return res.status(403).json({
        error: `SMS quota exceeded. Your ${plan.name} plan allows ${plan.smsQuota} SMS/month. Used: ${smsSentThisMonth}. Upgrade to send more.`,
      });
    }
  }

  let sent = 0;
  let failed = 0;
  for (const contact of contacts) {
    try {
      await sms.sendSMS(contact.phone, message);
      sent++;
    } catch {
      failed++;
    }
  }

  const blast = {
    id: 'blast_' + Date.now(),
    clientId: req.auth.clientId,
    message,
    recipientCount: sent,
    failedCount: failed,
    tag: tag || 'all',
    sentAt: new Date().toISOString(),
  };

  await db.update((d) => {
    if (!d.blasts) d.blasts = [];
    d.blasts.push(blast);
  });

  res.json({ ok: true, sent, failed });
});

module.exports = router;
