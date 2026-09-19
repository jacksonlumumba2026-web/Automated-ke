const express = require('express');
const db = require('../lib/db');
const mpesa = require('../lib/mpesa');
const sms = require('../lib/sms');
const { requireClient } = require('../lib/auth');

const router = express.Router();

// ── CLIENT: M-Pesa configuration status ──
router.get('/status', requireClient, (req, res) => {
  const data = db.read();
  const client = data.clients.find((c) => c.id === req.auth.clientId);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const m = client.mpesa || {};
  res.json({
    configured: !!(m.shortcode && m.consumerKey),
    shortcode: m.shortcode || null,
    type: m.type || 'paybill',
    env: m.env || 'sandbox',
  });
});

// ── CLIENT: save Daraja credentials ──
router.patch('/setup', requireClient, async (req, res) => {
  const { consumerKey, consumerSecret, shortcode, passkey, type, env } = req.body || {};
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    return res.status(400).json({ error: 'consumerKey, consumerSecret, shortcode and passkey are required' });
  }
  const updated = await db.update((d) => {
    const c = d.clients.find((x) => x.id === req.auth.clientId);
    if (!c) return null;
    c.mpesa = {
      consumerKey,
      consumerSecret,
      shortcode,
      passkey,
      type: type || 'paybill',
      env: env || 'sandbox',
    };
    return { shortcode, type: c.mpesa.type, env: c.mpesa.env };
  });
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ ok: true, ...updated });
});

// ── CLIENT: initiate STK push from dashboard ──
router.post('/request', requireClient, async (req, res) => {
  const { phone, amount, description } = req.body || {};
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount are required' });

  const data = db.read();
  const client = data.clients.find((c) => c.id === req.auth.clientId);
  if (!client?.mpesa?.shortcode) {
    return res.status(400).json({ error: 'M-Pesa not set up. Go to Account → M-Pesa Setup.' });
  }

  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const callbackUrl = `${appUrl}/api/mpesa/callback/${client.id}`;

  try {
    const result = await mpesa.stkPushWithCreds(client.mpesa, {
      phone,
      amount,
      accountRef: client.name,
      description: description || 'Payment',
      callbackUrl,
    });

    const txn = {
      id: 'tx_' + Date.now(),
      clientId: client.id,
      clientName: client.name,
      businessType: client.type,
      phone: mpesa.normalizePhone(phone),
      customerPhone: phone,
      amount: Math.round(amount),
      bundle: description || 'M-Pesa Payment',
      description: description || '',
      time: new Date().toISOString(),
      status: 'pending',
      mpesaRef: null,
      checkoutRequestId: result.CheckoutRequestID,
      source: 'dashboard',
    };
    await db.update((d) => d.transactions.push(txn));

    res.json({ ok: true, checkoutRequestId: result.CheckoutRequestID, txnId: txn.id });
  } catch (e) {
    const msg = e.response?.data?.errorMessage || e.message || 'Could not reach M-Pesa';
    res.status(502).json({ error: msg });
  }
});

// ── CLIENT: poll STK push status ──
router.get('/poll/:checkoutRequestId', requireClient, (req, res) => {
  const data = db.read();
  const txn = data.transactions.find(
    (t) => t.checkoutRequestId === req.params.checkoutRequestId && t.clientId === req.auth.clientId
  );
  if (!txn) return res.status(404).json({ status: 'unknown' });
  res.json({ status: txn.status, mpesaRef: txn.mpesaRef || null });
});

// ── CLIENT: list recent dashboard-initiated requests ──
router.get('/requests', requireClient, (req, res) => {
  const data = db.read();
  const reqs = data.transactions
    .filter((t) => t.clientId === req.auth.clientId && t.source === 'dashboard')
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 20);
  res.json(reqs);
});

// ── CLIENT: register C2B URLs with Safaricom ──
router.post('/c2b/register', requireClient, async (req, res) => {
  const data = db.read();
  const client = data.clients.find((c) => c.id === req.auth.clientId);
  if (!client?.mpesa?.shortcode) return res.status(400).json({ error: 'M-Pesa not configured' });

  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  try {
    const result = await mpesa.c2bRegisterWithCreds(client.mpesa, {
      confirmUrl: `${appUrl}/api/mpesa/c2b/${client.id}`,
      validationUrl: `${appUrl}/api/mpesa/c2b/validate/${client.id}`,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: e.response?.data?.errorMessage || e.message });
  }
});

// ── PUBLIC: STK push callback (Safaricom → server) ──
router.post('/callback/:clientId', async (req, res) => {
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
    return t;
  });

  if (txn && success) {
    const data = db.read();
    const client = data.clients.find((c) => c.id === req.params.clientId);
    if (txn.customerPhone) {
      sms.sendSMS(
        txn.customerPhone,
        `✅ M-Pesa payment of Ksh ${txn.amount} confirmed at ${client?.name || 'our business'}. Ref: ${mpesaRef}. Thank you!`
      ).catch(() => {});
    }
    if (client?.ownerPhone) {
      sms.sendSMS(
        client.ownerPhone,
        `💰 Payment received: Ksh ${txn.amount} from ${txn.customerPhone}. Ref: ${mpesaRef}.`
      ).catch(() => {});
    }
  }

  res.json({ ok: true });
});

// ── PUBLIC: C2B confirmation (direct till/paybill payment) ──
router.post('/c2b/:clientId', async (req, res) => {
  const { TransID, TransAmount, MSISDN, BillRefNumber } = req.body || {};
  if (!TransID) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const data = db.read();
  const client = data.clients.find((c) => c.id === req.params.clientId && c.active);
  if (!client) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const txn = {
    id: 'tx_' + Date.now(),
    clientId: client.id,
    clientName: client.name,
    businessType: client.type,
    phone: MSISDN,
    customerPhone: MSISDN,
    amount: Number(TransAmount),
    bundle: BillRefNumber || 'Direct Payment',
    accountRef: BillRefNumber || '',
    time: new Date().toISOString(),
    status: 'success',
    mpesaRef: TransID,
    source: 'c2b',
  };
  await db.update((d) => d.transactions.push(txn));

  if (client.ownerPhone) {
    sms.sendSMS(
      client.ownerPhone,
      `💰 New M-Pesa: Ksh ${TransAmount} from ${MSISDN}. Ref: ${TransID}.`
    ).catch(() => {});
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ── PUBLIC: C2B validation (always accept) ──
router.post('/c2b/validate/:clientId', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

module.exports = router;
