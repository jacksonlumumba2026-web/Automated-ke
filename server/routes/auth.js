const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { sign, requireAdmin } = require('../lib/auth');

const router = express.Router();

async function ensureAdminSeeded() {
  await db.update((data) => {
    if (!data.admin.passwordHash) {
      const seed = process.env.ADMIN_PASSWORD || 'Jackson@AutomateKE2025';
      data.admin.passwordHash = bcrypt.hashSync(seed, 10);
    }
  });
}

router.post('/admin-login', async (req, res) => {
  await ensureAdminSeeded();
  const { password } = req.body || {};
  const data = db.read();
  if (!password || !bcrypt.compareSync(password, data.admin.passwordHash)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = sign({ role: 'admin' });
  res.json({ token });
});

router.post('/admin-change-password', requireAdmin, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const data = db.read();
  if (!bcrypt.compareSync(oldPassword || '', data.admin.passwordHash)) {
    return res.status(400).json({ error: 'Wrong current password' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password too short' });
  }
  await db.update((d) => {
    d.admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  });
  res.json({ ok: true });
});

router.post('/client-login', async (req, res) => {
  const { email, password } = req.body || {};
  const data = db.read();
  const client = data.clients.find((c) => c.email === email);
  if (!client || !bcrypt.compareSync(password || '', client.passwordHash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  if (!client.active) return res.status(403).json({ error: 'Account suspended. Contact support.' });
  const token = sign({ role: 'client', clientId: client.id });
  res.json({ token, clientId: client.id });
});

module.exports = router;
