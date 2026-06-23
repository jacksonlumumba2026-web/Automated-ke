const express = require('express');
const db = require('../lib/db');
const { requireClient } = require('../lib/auth');

const router = express.Router();

const OFFSETS = { day1: 1, day3: 3, day7: 7 };

router.get('/', requireClient, (req, res) => {
  const data = db.read();
  res.json(data.followups.filter((f) => f.clientId === req.auth.clientId));
});

// Schedules the standard Day 1 / Day 3 / Day 7 follow-up sequence for a contact.
router.post('/schedule', requireClient, async (req, res) => {
  const { contactId, message } = req.body || {};
  const data = db.read();
  const contact = data.contacts.find((c) => c.id === contactId && c.clientId === req.auth.clientId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const now = Date.now();
  const created = Object.entries(OFFSETS).map(([type, days]) => ({
    id: `fu_${now}_${type}`,
    clientId: req.auth.clientId,
    contactId,
    contactName: contact.name,
    contactPhone: contact.phone,
    type,
    dueAt: new Date(now + days * 86400000).toISOString(),
    message: message || `Hi ${contact.name}, just checking in — are you still interested? Reply to let us know.`,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }));

  await db.update((d) => d.followups.push(...created));
  res.status(201).json(created);
});

router.patch('/:id', requireClient, async (req, res) => {
  const allowed = ['status'];
  const updated = await db.update((d) => {
    const f = d.followups.find((x) => x.id === req.params.id && x.clientId === req.auth.clientId);
    if (!f) return null;
    for (const key of allowed) {
      if (req.body && key in req.body) f[key] = req.body[key];
    }
    return f;
  });
  if (!updated) return res.status(404).json({ error: 'Follow-up not found' });
  res.json(updated);
});

router.delete('/:id', requireClient, async (req, res) => {
  const existed = await db.update((d) => {
    const before = d.followups.length;
    d.followups = d.followups.filter((x) => !(x.id === req.params.id && x.clientId === req.auth.clientId));
    return d.followups.length < before;
  });
  if (!existed) return res.status(404).json({ error: 'Follow-up not found' });
  res.json({ ok: true });
});

module.exports = router;
