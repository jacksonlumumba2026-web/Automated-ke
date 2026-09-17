const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { getPlan } = require('../lib/plans');

const router = express.Router();

// Estimate SMS used by a client in a given month (YYYY-MM)
function estimateSmsUsed(data, clientId, monthStr) {
  // Welcome SMS per contact created this month
  const contacts = data.contacts.filter(
    (c) => c.clientId === clientId && c.createdAt && c.createdAt.startsWith(monthStr)
  ).length;

  // Follow-up SMS sent this month
  const followupsSent = data.followups.filter(
    (f) => f.clientId === clientId && f.status === 'sent' && f.dueAt && f.dueAt.startsWith(monthStr)
  ).length;

  // Receipt SMS + owner notification per successful transaction this month (2 per txn)
  const txns = data.transactions.filter(
    (t) => t.clientId === clientId && t.status === 'success' && t.time && t.time.startsWith(monthStr)
  ).length;

  return contacts + followupsSent + txns * 2;
}

// GET /api/billing — full billing breakdown for the current month
router.get('/', requireAdmin, (req, res) => {
  const data = db.read();
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const clients = data.clients.map((client) => {
    const plan = getPlan(client.plan);

    // Transaction fees this month
    const monthTxns = data.transactions.filter(
      (t) => t.clientId === client.id && t.status === 'success' && t.time && t.time.startsWith(monthStr)
    );
    const txnVolume = monthTxns.reduce((s, t) => s + (t.amount || 0), 0);
    const txnFees = monthTxns.reduce((s, t) => s + (t.platformFee || 0), 0);

    // SMS usage
    const smsUsed = estimateSmsUsed(data, client.id, monthStr);
    const smsOverage = plan.smsQuota === -1 ? 0 : Math.max(0, smsUsed - plan.smsQuota);
    const smsOverageFee = Math.round(smsOverage * plan.smsOverageRate);

    const totalOwed =
      (client.active ? plan.monthlyFee : 0) + txnFees + smsOverageFee;

    return {
      clientId: client.id,
      clientName: client.name,
      ownerPhone: client.ownerPhone,
      plan: client.plan,
      planName: plan.name,
      active: client.active,
      billingCycle: client.billingCycle || 'monthly',
      monthlyFee: plan.monthlyFee,
      setupFee: plan.setupFee,
      setupFeePaid: client.setupFeePaid || false,
      txnVolume,
      txnFeePercent: plan.txnFeePercent,
      txnFees,
      smsQuota: plan.smsQuota,
      smsUsed,
      smsOverage,
      smsOverageFee,
      totalOwed,
    };
  });

  const activeClients = clients.filter((c) => c.active);
  const platformRevenue = {
    subscriptions: activeClients.reduce((s, c) => s + c.monthlyFee, 0),
    txnFees: clients.reduce((s, c) => s + c.txnFees, 0),
    smsOverages: clients.reduce((s, c) => s + c.smsOverageFee, 0),
    pendingSetupFees: clients.filter((c) => !c.setupFeePaid).reduce((s, c) => s + c.setupFee, 0),
  };
  platformRevenue.total =
    platformRevenue.subscriptions + platformRevenue.txnFees + platformRevenue.smsOverages;

  // All-time totals
  const allTimeTxnFees = data.transactions
    .filter((t) => t.status === 'success')
    .reduce((s, t) => s + (t.platformFee || 0), 0);

  res.json({ month: monthStr, clients, platformRevenue, allTimeTxnFees });
});

// PATCH /api/billing/:clientId/setup-paid — mark one-time setup fee as collected
router.patch('/:clientId/setup-paid', requireAdmin, async (req, res) => {
  const updated = await db.update((d) => {
    const c = d.clients.find((x) => x.id === req.params.clientId);
    if (!c) return null;
    c.setupFeePaid = true;
    return c;
  });
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ ok: true });
});

module.exports = router;
