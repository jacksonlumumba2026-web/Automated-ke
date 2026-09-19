const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { sign, requireAdmin } = require('../lib/auth');
const { PLANS } = require('../lib/plans');
const mpesa = require('../lib/mpesa');
const sms = require('../lib/sms');

const DEFAULT_BUNDLES = {
  wifi:[{id:'1hr',label:'1 Hour',price:10,detail:'5 Mbps'},{id:'daily',label:'Daily',price:50,detail:'10 Mbps'},{id:'weekly',label:'Weekly',price:250,detail:'15 Mbps'},{id:'monthly',label:'Monthly',price:800,detail:'20 Mbps'}],
  hotel:[{id:'single',label:'Single Room',price:2500,detail:'1 Guest'},{id:'double',label:'Double Room',price:3500,detail:'2 Guests'},{id:'suite',label:'Suite',price:6500,detail:'Luxury'},{id:'conf',label:'Conference',price:8000,detail:'20 pax'}],
  parking:[{id:'1h',label:'1 Hour',price:50,detail:'1 slot'},{id:'4h',label:'4 Hours',price:100,detail:'1 slot'},{id:'24h',label:'Overnight',price:300,detail:'1 slot'}],
  shop:[{id:'s',label:'Small Item',price:500,detail:''},{id:'m',label:'Medium Item',price:2000,detail:''},{id:'l',label:'Large Item',price:5000,detail:''}],
  rental:[{id:'d',label:'Daily',price:1500,detail:''},{id:'w',label:'Weekly',price:8000,detail:''},{id:'mo',label:'Monthly',price:25000,detail:''}],
  salon:[{id:'h',label:'Haircut',price:300,detail:''},{id:'t',label:'Treatment',price:800,detail:''},{id:'f',label:'Full Package',price:1500,detail:''}],
  gym:[{id:'d',label:'Day Pass',price:200,detail:''},{id:'w',label:'Weekly',price:700,detail:''},{id:'m',label:'Monthly',price:2500,detail:''}],
  custom:[{id:'a',label:'Service A',price:500,detail:''},{id:'b',label:'Service B',price:1000,detail:''},{id:'c',label:'Service C',price:2000,detail:''}],
};

function buildClient({ name, type, ownerName, ownerPhone, email, password, plan }) {
  const planConfig = PLANS[plan] || PLANS.trial;
  return {
    id: 'cl_' + Date.now(),
    name,
    type: type || 'custom',
    ownerName,
    ownerPhone,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    apiKey: 'ake_' + crypto.randomBytes(12).toString('hex'),
    plan: plan || 'trial',
    monthlyFee: planConfig.monthlyFee,
    billingCycle: 'monthly',
    setupFeePaid: plan === 'trial',
    location: '',
    active: true,
    createdAt: new Date().toISOString(),
    memberSince: new Date().toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }),
    bundles: DEFAULT_BUNDLES[type] || DEFAULT_BUNDLES.custom,
  };
}

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

// ── PUBLIC: self-service registration ──────────────────────────────────────

router.post('/register', async (req, res) => {
  const { name, type, ownerName, ownerPhone, email, password, plan = 'trial' } = req.body || {};
  if (!name || !ownerName || !ownerPhone || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const data = db.read();
  if (data.clients.some((c) => c.email === email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const planConfig = PLANS[plan] || PLANS.trial;

  // Trial or free — create immediately, no payment needed
  if (!planConfig.monthlyFee) {
    const client = buildClient({ name, type, ownerName, ownerPhone, email, password, plan: 'trial' });
    await db.update((d) => d.clients.push(client));
    const token = sign({ role: 'client', clientId: client.id });
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    sms.sendSMS(
      ownerPhone,
      `🎉 Welcome to AutomateKE, ${ownerName}! Your free trial is ready. Login: ${appUrl}/dashboard.html — Email: ${email}`
    ).catch(() => {});
    return res.json({ mode: 'instant', token, clientId: client.id });
  }

  // Paid plan — initiate M-Pesa STK push (platform credentials)
  if (!mpesa.isConfigured()) {
    return res.status(503).json({ error: 'Online payment not available yet. WhatsApp us at 0741590397 to get started.' });
  }

  const pendingId = 'ps_' + Date.now();
  const pending = {
    id: pendingId,
    name, type, ownerName, ownerPhone, email, password, plan,
    status: 'pending',
    checkoutRequestId: null,
    createdAt: new Date().toISOString(),
  };
  await db.update((d) => { if (!d.pendingSignups) d.pendingSignups = []; d.pendingSignups.push(pending); });

  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const platformCreds = {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    type: process.env.MPESA_TYPE || 'paybill',
    env: process.env.MPESA_ENV || 'sandbox',
  };

  try {
    const result = await mpesa.stkPushWithCreds(platformCreds, {
      phone: ownerPhone,
      amount: planConfig.monthlyFee,
      accountRef: 'AutomateKE',
      description: planConfig.name + ' Plan',
      callbackUrl: `${appUrl}/api/auth/register/callback`,
    });

    await db.update((d) => {
      const p = (d.pendingSignups || []).find((x) => x.id === pendingId);
      if (p) p.checkoutRequestId = result.CheckoutRequestID;
    });

    return res.json({ mode: 'mpesa', checkoutRequestId: result.CheckoutRequestID, pendingId });
  } catch (e) {
    await db.update((d) => {
      if (d.pendingSignups) d.pendingSignups = d.pendingSignups.filter((p) => p.id !== pendingId);
    });
    return res.status(502).json({ error: 'Could not initiate M-Pesa payment. Please try again.' });
  }
});

// ── PUBLIC: poll signup payment status ──
router.get('/register/status/:checkoutRequestId', (req, res) => {
  const data = db.read();
  const ps = (data.pendingSignups || []).find((p) => p.checkoutRequestId === req.params.checkoutRequestId);
  if (!ps) return res.status(404).json({ status: 'unknown' });
  if (ps.status === 'ready') {
    const client = data.clients.find((c) => c.email === ps.email);
    if (client) {
      const token = sign({ role: 'client', clientId: client.id });
      return res.json({ status: 'ready', token, clientId: client.id });
    }
  }
  res.json({ status: ps.status });
});

// ── PUBLIC: M-Pesa callback — confirms signup payment ──
router.post('/register/callback', async (req, res) => {
  const body = req.body?.Body?.stkCallback;
  if (!body) return res.json({ ok: true });

  const { CheckoutRequestID, ResultCode, CallbackMetadata } = body;
  const success = ResultCode === 0;
  let mpesaRef = null;
  if (success && CallbackMetadata?.Item) {
    const receipt = CallbackMetadata.Item.find((i) => i.Name === 'MpesaReceiptNumber');
    mpesaRef = receipt?.Value || null;
  }

  const data = db.read();
  const ps = (data.pendingSignups || []).find((p) => p.checkoutRequestId === CheckoutRequestID && p.status === 'pending');
  if (!ps) return res.json({ ok: true });

  if (!success) {
    await db.update((d) => {
      const p = (d.pendingSignups || []).find((x) => x.id === ps.id);
      if (p) p.status = 'failed';
    });
    return res.json({ ok: true });
  }

  const client = buildClient(ps);
  client.setupFeePaid = true;
  client.mpesaSignupRef = mpesaRef;

  await db.update((d) => {
    d.clients.push(client);
    const p = (d.pendingSignups || []).find((x) => x.id === ps.id);
    if (p) { p.status = 'ready'; p.email = client.email; }
  });

  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  sms.sendSMS(
    ps.ownerPhone,
    `🎉 Payment confirmed (Ref: ${mpesaRef})! Welcome to AutomateKE, ${ps.ownerName}. Login: ${appUrl}/dashboard.html — Email: ${ps.email}`
  ).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;
