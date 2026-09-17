const express = require('express');
const db = require('../lib/db');
const { requireClient } = require('../lib/auth');

const router = express.Router();

router.get('/', requireClient, (req, res) => {
  const data = db.read();
  res.json(data.expenses.filter((e) => e.clientId === req.auth.clientId));
});

router.post('/', requireClient, async (req, res) => {
  const { amount, category, description, date } = req.body || {};
  if (!amount || !category) return res.status(400).json({ error: 'Amount and category required' });
  const expense = {
    id: 'exp_' + Date.now(),
    clientId: req.auth.clientId,
    amount: Number(amount),
    category,
    description: description || '',
    date: date || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
  };
  await db.update((d) => d.expenses.push(expense));
  res.status(201).json(expense);
});

router.delete('/:id', requireClient, async (req, res) => {
  const existed = await db.update((d) => {
    const before = d.expenses.length;
    d.expenses = d.expenses.filter((e) => !(e.id === req.params.id && e.clientId === req.auth.clientId));
    return d.expenses.length < before;
  });
  if (!existed) return res.status(404).json({ error: 'Expense not found' });
  res.json({ ok: true });
});

module.exports = router;
