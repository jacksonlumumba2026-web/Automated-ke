const express = require('express');
const db = require('../lib/db');
const { requireClient } = require('../lib/auth');

const router = express.Router();

router.get('/', requireClient, (req, res) => {
  const data = db.read();
  res.json(data.inventory.filter((i) => i.clientId === req.auth.clientId));
});

router.post('/', requireClient, async (req, res) => {
  const { name, category, sellingPrice, costPrice, quantity, unit, lowStockThreshold } = req.body || {};
  if (!name || sellingPrice == null || quantity == null) {
    return res.status(400).json({ error: 'Name, selling price and quantity required' });
  }
  const item = {
    id: 'inv_' + Date.now(),
    clientId: req.auth.clientId,
    name,
    category: category || 'General',
    sellingPrice: Number(sellingPrice),
    costPrice: Number(costPrice) || 0,
    quantity: Number(quantity),
    unit: unit || 'pcs',
    lowStockThreshold: Number(lowStockThreshold) || 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.update((d) => d.inventory.push(item));
  res.status(201).json(item);
});

router.patch('/:id', requireClient, async (req, res) => {
  const allowed = ['name', 'category', 'sellingPrice', 'costPrice', 'unit', 'lowStockThreshold'];
  const updated = await db.update((d) => {
    const item = d.inventory.find((i) => i.id === req.params.id && i.clientId === req.auth.clientId);
    if (!item) return null;
    for (const key of allowed) {
      if (req.body && key in req.body) item[key] = req.body[key];
    }
    item.updatedAt = new Date().toISOString();
    return item;
  });
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  res.json(updated);
});

router.delete('/:id', requireClient, async (req, res) => {
  const existed = await db.update((d) => {
    const before = d.inventory.length;
    d.inventory = d.inventory.filter((i) => !(i.id === req.params.id && i.clientId === req.auth.clientId));
    return d.inventory.length < before;
  });
  if (!existed) return res.status(404).json({ error: 'Item not found' });
  res.json({ ok: true });
});

// Record a sale — deducts stock
router.post('/:id/sell', requireClient, async (req, res) => {
  const qty = Number(req.body?.quantity) || 1;
  const updated = await db.update((d) => {
    const item = d.inventory.find((i) => i.id === req.params.id && i.clientId === req.auth.clientId);
    if (!item) return null;
    if (item.quantity < qty) return { _err: 'Not enough stock' };
    item.quantity -= qty;
    item.updatedAt = new Date().toISOString();
    return item;
  });
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  if (updated._err) return res.status(400).json({ error: updated._err });
  res.json(updated);
});

// Restock — adds stock
router.post('/:id/restock', requireClient, async (req, res) => {
  const qty = Number(req.body?.quantity) || 0;
  if (qty <= 0) return res.status(400).json({ error: 'Quantity must be positive' });
  const updated = await db.update((d) => {
    const item = d.inventory.find((i) => i.id === req.params.id && i.clientId === req.auth.clientId);
    if (!item) return null;
    item.quantity += qty;
    item.updatedAt = new Date().toISOString();
    return item;
  });
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  res.json(updated);
});

module.exports = router;
