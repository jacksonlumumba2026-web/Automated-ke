const express = require('express');
const db = require('../lib/db');
const { requireClient } = require('../lib/auth');

const router = express.Router();

const TYPE_ICON = { wifi: '📶', hotel: '🏨', parking: '🚗', shop: '🛒', rental: '🏠', salon: '💈', gym: '🏋', custom: '⚙️' };

// Authenticated: update own profile fields
router.patch('/', requireClient, async (req, res) => {
  const allowed = ['profileBio', 'profileLocation', 'profileHours', 'profileWhatsApp', 'profileProducts'];
  const updated = await db.update((d) => {
    const client = d.clients.find((c) => c.id === req.auth.clientId);
    if (!client) return null;
    for (const key of allowed) {
      if (req.body && key in req.body) client[key] = req.body[key];
    }
    return client;
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// Public: view profile by client ID
router.get('/:id', (req, res) => {
  const data = db.read();
  const client = data.clients.find((c) => c.id === req.params.id && c.active);
  if (!client) return res.status(404).json({ error: 'Profile not found' });

  res.json({
    id: client.id,
    name: client.name,
    type: client.type,
    icon: TYPE_ICON[client.type] || '⚙️',
    ownerPhone: client.ownerPhone || '',
    profileBio: client.profileBio || '',
    profileLocation: client.profileLocation || '',
    profileHours: client.profileHours || '',
    profileWhatsApp: client.profileWhatsApp || client.ownerPhone || '',
    profileProducts: client.profileProducts || [],
    memberSince: client.createdAt ? new Date(client.createdAt).getFullYear() : new Date().getFullYear(),
  });
});

module.exports = router;
