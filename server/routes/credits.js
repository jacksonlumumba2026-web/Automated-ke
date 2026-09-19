const express = require('express');
const db = require('../lib/db');
const sms = require('../lib/sms');
const { requireClient } = require('../lib/auth');

const router = express.Router();

router.get('/', requireClient, (req, res) => {
  const data = db.read();
  const credits = (data.credits || [])
    .filter((c) => c.clientId === req.auth.clientId)
    .sort((a, b) => b.balance - a.balance);
  res.json(credits);
});

router.post('/', requireClient, async (req, res) => {
  const { customerName, customerPhone } = req.body || {};
  if (!customerName) return res.status(400).json({ error: 'Customer name required' });

  const account = {
    id: 'cred_' + Date.now(),
    clientId: req.auth.clientId,
    customerName,
    customerPhone: customerPhone || '',
    balance: 0,
    entries: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.update((d) => {
    if (!d.credits) d.credits = [];
    d.credits.push(account);
  });

  res.status(201).json(account);
});

router.post('/:id/debit', requireClient, async (req, res) => {
  const { amount, description } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount required' });

  const updated = await db.update((d) => {
    const acc = (d.credits || []).find(
      (c) => c.id === req.params.id && c.clientId === req.auth.clientId
    );
    if (!acc) return null;
    acc.balance += Number(amount);
    acc.entries.push({
      id: 'entry_' + Date.now(),
      type: 'debit',
      amount: Number(amount),
      description: description || 'Credit issued',
      date: new Date().toISOString(),
      balance: acc.balance,
    });
    acc.updatedAt = new Date().toISOString();
    return acc;
  });

  if (!updated) return res.status(404).json({ error: 'Account not found' });
  res.json(updated);
});

router.post('/:id/payment', requireClient, async (req, res) => {
  const { amount, description } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount required' });

  const updated = await db.update((d) => {
    const acc = (d.credits || []).find(
      (c) => c.id === req.params.id && c.clientId === req.auth.clientId
    );
    if (!acc) return null;
    acc.balance -= Number(amount);
    acc.entries.push({
      id: 'entry_' + Date.now(),
      type: 'payment',
      amount: Number(amount),
      description: description || 'Payment received',
      date: new Date().toISOString(),
      balance: acc.balance,
    });
    acc.updatedAt = new Date().toISOString();
    return acc;
  });

  if (!updated) return res.status(404).json({ error: 'Account not found' });
  res.json(updated);
});

router.post('/:id/remind', requireClient, async (req, res) => {
  const data = db.read();
  const acc = (data.credits || []).find(
    (c) => c.id === req.params.id && c.clientId === req.auth.clientId
  );
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  if (!acc.customerPhone) return res.status(400).json({ error: 'No phone number on account' });
  if (!sms.isConfigured()) return res.status(400).json({ error: 'SMS not configured. Add Africa\'s Talking keys in Settings.' });

  const client = data.clients.find((c) => c.id === req.auth.clientId);
  const msg = `Hi ${acc.customerName}, you have an outstanding balance of Ksh ${acc.balance.toLocaleString()} at ${client?.name || 'us'}. Please settle at your earliest convenience. Thank you!`;

  await sms.sendSMS(acc.customerPhone, msg);
  res.json({ ok: true });
});

router.delete('/:id', requireClient, async (req, res) => {
  const existed = await db.update((d) => {
    const before = (d.credits || []).length;
    d.credits = (d.credits || []).filter(
      (c) => !(c.id === req.params.id && c.clientId === req.auth.clientId)
    );
    return (d.credits || []).length < before;
  });
  if (!existed) return res.status(404).json({ error: 'Account not found' });
  res.json({ ok: true });
});

module.exports = router;
