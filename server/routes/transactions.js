const express = require('express');
const db = require('../lib/db');
const mpesa = require('../lib/mpesa');
const sms = require('../lib/sms');
const { requireAdmin, requireClient } = require('../lib/auth');

const router = express.Router();

function maskPhone(p) {
  const clean = String(p).replace(/\s/g, '');
  return clean.slice(0, 4) + '***' + clean.slice(-3);
}

function refCodeFor(type) {
  const map = { hotel: 'BK', parking: 'PKT', shop: 'ORD', rental: 'RNT', salon: 'SAL', gym: 'GYM', custom: 'REF' };
  return (map[type] || 'REF') + '-' + Date.now().toString(36).toUpperCase().slice(-5);
}

function voucherFor(name) {
  const prefix = (name || 'AK').slice(0, 2).toUpperCase();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix + '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── ADMIN: all transactions ──
router.get('/', requireAdmin, (req, res) => {
  res.json(db.read().transactions);
});

// ── CLIENT: own transactions ──
router.get('/mine', requireClient, (req, res) => {
  const data = db.read();
  res.json(data.transactions.filter((t) => t.clientId === req.auth.clientId));
});

// ── PUBLIC: customer initiates payment from the portal ──
router.post('/pay', async (req, res) => {
  const { apiKey, phone, bundleId } = req.body || {};
  if (!apiKey || !phone || !bundleId) return res.status(400).json({ error: 'Missing fields' });

  const data = db.read();
  const client = data.clients.find((c) => c.apiKey === apiKey && c.active);
  if (!client) return res.status(404).json({ error: 'Portal not found' });
  const bundle = (client.bundles || []).find((b) => b.id === bundleId);
  if (!bundle) return res.status(400).json({ error: 'Invalid package' });

  const txnBase = {
    id: 'tx_' + Date.now(),
    clientId: client.id,
    clientName: client.name,
    businessType: client.type,
    phone: maskPhone(phone),
    customerPhone: phone,
    amount: bundle.price,
    bundleId: bundle.id,
    bundle: bundle.label,
    time: new Date().toISOString(),
  };

  if (mpesa.isConfigured()) {
    try {
      const stk = await mpesa.stkPush({
        phone,
        amount: bundle.price,
        accountRef: client.name,
        description: bundle.label,
      });
      const txn = {
        ...txnBase,
        status: 'pending',
        mpesaRef: null,
        code: null,
        checkoutRequestId: stk.CheckoutRequestID,
      };
      await db.update((d) => d.transactions.push(txn));
      return res.json({ mode: 'stk', checkoutRequestId: stk.CheckoutRequestID, message: 'Check your phone for the M-Pesa prompt.' });
    } catch (e) {
      return res.status(502).json({ error: 'Could not reach M-Pesa. Try again shortly.' });
    }
  }

  // No real M-Pesa credentials yet — record a clearly-flagged simulated payment
  // so the rest of the platform (dashboard, CRM, follow-ups) keeps working
  // while the owner finishes Daraja setup in Settings.
  const txn = {
    ...txnBase,
    status: 'success',
    simulated: true,
    mpesaRef: 'SIM' + Math.random().toString(36).slice(2, 9).toUpperCase(),
    code: client.type === 'wifi' ? voucherFor(client.name) : refCodeFor(client.type),
  };
  await db.update((d) => d.transactions.push(txn));

  // Receipt SMS to customer
  sms.sendSMS(
    phone,
    `Payment of Ksh ${bundle.price} confirmed for ${bundle.label} at ${client.name}. Code: ${txn.code}. Thank you!`
  ).catch(() => {});

  res.json({ mode: 'simulated', transaction: txn });
});

// ── PUBLIC: portal polls this while waiting for STK push result ──
router.get('/status/:checkoutRequestId', (req, res) => {
  const data = db.read();
  const txn = data.transactions.find((t) => t.checkoutRequestId === req.params.checkoutRequestId);
  if (!txn) return res.status(404).json({ status: 'unknown' });
  res.json({ status: txn.status, transaction: txn.status !== 'pending' ? txn : undefined });
});

// ── PUBLIC: Safaricom calls this with the real payment result ──
router.post('/mpesa/callback', async (req, res) => {
  const body = req.body?.Body?.stkCallback;
  if (!body) return res.json({ ok: true });

  const { CheckoutRequestID, ResultCode, CallbackMetadata } = body;
  const success = ResultCode === 0;
  let mpesaRef = null;
  if (success && CallbackMetadata?.Item) {
    const receipt = CallbackMetadata.Item.find((i) => i.Name === 'MpesaReceiptNumber');
    mpesaRef = receipt?.Value || null;
  }

  const txn = await db.update((d) => {
    const t = d.transactions.find((x) => x.checkoutRequestId === CheckoutRequestID);
    if (!t) return null;
    t.status = success ? 'success' : 'failed';
    t.mpesaRef = mpesaRef;
    if (success) {
      const client = d.clients.find((c) => c.id === t.clientId);
      t.code = client?.type === 'wifi' ? voucherFor(client.name) : refCodeFor(client?.type);
    }
    return t;
  });

  if (txn && txn.status === 'success') {
    const data = db.read();
    const client = data.clients.find((c) => c.id === txn.clientId);

    // Receipt SMS to customer
    if (txn.customerPhone) {
      sms.sendSMS(
        txn.customerPhone,
        `Payment of Ksh ${txn.amount} confirmed for ${txn.bundle} at ${client?.name || 'our business'}. M-Pesa Ref: ${txn.mpesaRef}. Thank you!`
      ).catch(() => {});
    }

    // Notification SMS to business owner
    if (client) {
      sms.sendSMS(
        client.ownerPhone,
        `AutomateKE: New payment of Ksh ${txn.amount} received for ${txn.bundle}. Ref: ${txn.mpesaRef}.`
      ).catch(() => {});
    }
  }

  res.json({ ok: true });
});

module.exports = router;
