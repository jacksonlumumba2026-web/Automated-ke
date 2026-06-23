const express = require('express');
const db = require('../lib/db');
const sms = require('../lib/sms');
const { requireClient } = require('../lib/auth');

const router = express.Router();

router.get('/', requireClient, (req, res) => {
  const data = db.read();
  res.json(data.contacts.filter((c) => c.clientId === req.auth.clientId));
});

router.post('/', requireClient, async (req, res) => {
  const { name, phone, email, notes, source } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
  const contact = {
    id: 'ct_' + Date.now(),
    clientId: req.auth.clientId,
    name,
    phone,
    email: email || '',
    notes: notes || '',
    source: source || 'manual',
    status: 'lead',
    createdAt: new Date().toISOString(),
    lastContactAt: null,
  };
  await db.update((d) => d.contacts.push(contact));
  res.status(201).json(contact);
});

router.patch('/:id', requireClient, async (req, res) => {
  const allowed = ['name', 'phone', 'email', 'notes', 'status', 'lastContactAt'];
  const updated = await db.update((d) => {
    const c = d.contacts.find((x) => x.id === req.params.id && x.clientId === req.auth.clientId);
    if (!c) return null;
    for (const key of allowed) {
      if (req.body && key in req.body) c[key] = req.body[key];
    }
    return c;
  });
  if (!updated) return res.status(404).json({ error: 'Contact not found' });
  res.json(updated);
});

// Sends an immediate SMS to the contact and logs it as a touchpoint.
router.post('/:id/sms', requireClient, async (req, res) => {
  const { message } = req.body || {};
  const data = db.read();
  const contact = data.contacts.find((c) => c.id === req.params.id && c.clientId === req.auth.clientId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  if (!sms.isConfigured()) return res.status(400).json({ error: 'SMS is not configured yet. Add Africa\'s Talking keys in Settings.' });

  await sms.sendSMS(contact.phone, message || contact.notes || `Hi ${contact.name}, this is ${req.auth.clientId}.`);
  await db.update((d) => {
    const c = d.contacts.find((x) => x.id === contact.id);
    if (c) c.lastContactAt = new Date().toISOString();
  });
  res.json({ ok: true });
});

router.delete('/:id', requireClient, async (req, res) => {
  const existed = await db.update((d) => {
    const before = d.contacts.length;
    d.contacts = d.contacts.filter((x) => !(x.id === req.params.id && x.clientId === req.auth.clientId));
    return d.contacts.length < before;
  });
  if (!existed) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true });
});

module.exports = router;
