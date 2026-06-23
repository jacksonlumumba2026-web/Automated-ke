const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { requireAdmin, requireClient } = require('../lib/auth');

const router = express.Router();

const PLAN_PRICES = { starter: 2000, growth: 5000, pro: 10000 };

const DEFAULT_BUNDLES = {
  wifi: [
    { id: '1hr', label: '1 Hour', price: 10, detail: '5 Mbps' },
    { id: 'daily', label: 'Daily', price: 50, detail: '10 Mbps' },
    { id: 'weekly', label: 'Weekly', price: 250, detail: '15 Mbps' },
    { id: 'monthly', label: 'Monthly', price: 800, detail: '20 Mbps' },
  ],
  hotel: [
    { id: 'single', label: 'Single Room', price: 2500, detail: '1 Guest' },
    { id: 'double', label: 'Double Room', price: 3500, detail: '2 Guests' },
    { id: 'suite', label: 'Suite', price: 6500, detail: 'Luxury' },
    { id: 'conf', label: 'Conference', price: 8000, detail: '20 pax' },
  ],
  parking: [
    { id: '1h', label: '1 Hour', price: 50, detail: '1 slot' },
    { id: '4h', label: '4 Hours', price: 100, detail: '1 slot' },
    { id: '12h', label: '12 Hours', price: 200, detail: '1 slot' },
    { id: '24h', label: 'Overnight', price: 300, detail: '1 slot' },
  ],
  shop: [
    { id: 's', label: 'Small Item', price: 500, detail: '' },
    { id: 'm', label: 'Medium Item', price: 2000, detail: '' },
    { id: 'l', label: 'Large Item', price: 5000, detail: '' },
    { id: 'xl', label: 'Premium', price: 10000, detail: '' },
  ],
  rental: [
    { id: 'd', label: 'Daily', price: 1500, detail: '' },
    { id: 'w', label: 'Weekly', price: 8000, detail: '' },
    { id: 'mo', label: 'Monthly', price: 25000, detail: '' },
    { id: 'yr', label: 'Yearly', price: 250000, detail: '' },
  ],
  salon: [
    { id: 'h', label: 'Haircut', price: 300, detail: '' },
    { id: 't', label: 'Treatment', price: 800, detail: '' },
    { id: 'f', label: 'Full Package', price: 1500, detail: '' },
  ],
  gym: [
    { id: 'd', label: 'Day Pass', price: 200, detail: '' },
    { id: 'w', label: 'Weekly', price: 700, detail: '' },
    { id: 'm', label: 'Monthly', price: 2500, detail: '' },
  ],
  custom: [
    { id: 'a', label: 'Service A', price: 500, detail: '' },
    { id: 'b', label: 'Service B', price: 1000, detail: '' },
    { id: 'c', label: 'Service C', price: 2000, detail: '' },
  ],
};

function publicClient(c) {
  const { passwordHash, ...pub } = c;
  return pub;
}

// ── ADMIN: list all clients ──
router.get('/', requireAdmin, (req, res) => {
  const data = db.read();
  res.json(data.clients.map(publicClient));
});

// ── ADMIN: create client ──
router.post('/', requireAdmin, async (req, res) => {
  const { name, type, ownerName, ownerPhone, email, password, plan, location } = req.body || {};
  if (!name || !ownerName || !ownerPhone || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const data = db.read();
  if (data.clients.some((c) => c.email === email)) {
    return res.status(409).json({ error: 'A client with this email already exists' });
  }
  const client = {
    id: 'cl_' + Date.now(),
    name,
    type: type || 'custom',
    ownerName,
    ownerPhone,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    apiKey: 'ake_' + crypto.randomBytes(12).toString('hex'),
    plan: plan || 'growth',
    monthlyFee: PLAN_PRICES[plan] || PLAN_PRICES.growth,
    location: location || '',
    active: true,
    createdAt: new Date().toISOString(),
    bundles: DEFAULT_BUNDLES[type] || DEFAULT_BUNDLES.custom,
  };
  await db.update((d) => d.clients.push(client));
  res.status(201).json(publicClient(client));
});

// ── ADMIN: update client (toggle active, edit plan/fee etc) ──
router.patch('/:id', requireAdmin, async (req, res) => {
  const allowed = ['name', 'type', 'ownerName', 'ownerPhone', 'plan', 'monthlyFee', 'location', 'active', 'bundles'];
  const updated = await db.update((d) => {
    const c = d.clients.find((x) => x.id === req.params.id);
    if (!c) return null;
    for (const key of allowed) {
      if (req.body && key in req.body) c[key] = req.body[key];
    }
    return c;
  });
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json(publicClient(updated));
});

// ── CLIENT: get own record ──
router.get('/me', requireClient, (req, res) => {
  const data = db.read();
  const client = data.clients.find((c) => c.id === req.auth.clientId);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(publicClient(client));
});

// ── PUBLIC: lookup by portal API key (no auth — used by payment portal) ──
router.get('/by-key/:apiKey', (req, res) => {
  const data = db.read();
  const client = data.clients.find((c) => c.apiKey === req.params.apiKey && c.active);
  if (!client) return res.status(404).json({ error: 'Portal not found' });
  res.json(publicClient(client));
});

module.exports = router;
module.exports.PLAN_PRICES = PLAN_PRICES;
