const express = require('express');
const mpesa = require('../lib/mpesa');
const sms = require('../lib/sms');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();

// Integration credentials live in server environment variables (.env on the
// server), never in the database — this just reports whether they're set.
router.get('/', requireAdmin, (req, res) => {
  res.json({
    mpesaConfigured: mpesa.isConfigured(),
    smsConfigured: sms.isConfigured(),
    appUrl: process.env.APP_URL || '',
  });
});

module.exports = router;
