const express = require('express');
const db = require('../lib/db');
const sms = require('../lib/sms');
const { requireClient } = require('../lib/auth');

const router = express.Router();

function genInvoiceNumber(clientId) {
  const data = db.read();
  const count = (data.invoices || []).filter((i) => i.clientId === clientId).length;
  return 'INV-' + String(count + 1).padStart(4, '0');
}

function genKey() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// ── CLIENT: list own invoices ──
router.get('/', requireClient, (req, res) => {
  const data = db.read();
  const invoices = (data.invoices || [])
    .filter((i) => i.clientId === req.auth.clientId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(invoices);
});

// ── CLIENT: create invoice ──
router.post('/', requireClient, async (req, res) => {
  const { customerName, customerPhone, customerEmail, items, dueDate, notes, taxRate } = req.body || {};
  if (!customerName || !items || !items.length) {
    return res.status(400).json({ error: 'Customer name and at least one item required' });
  }

  const processedItems = items.map((item) => ({
    description: item.description || '',
    qty: Number(item.qty) || 1,
    unitPrice: Number(item.unitPrice) || 0,
    total: (Number(item.qty) || 1) * (Number(item.unitPrice) || 0),
  }));

  const subtotal = processedItems.reduce((s, i) => s + i.total, 0);
  const taxAmount = Math.round(subtotal * (Number(taxRate) || 0) / 100);
  const total = subtotal + taxAmount;

  const invoice = {
    id: 'invc_' + Date.now(),
    clientId: req.auth.clientId,
    invoiceNumber: genInvoiceNumber(req.auth.clientId),
    invoiceKey: genKey(),
    customerName,
    customerPhone: customerPhone || '',
    customerEmail: customerEmail || '',
    items: processedItems,
    subtotal,
    taxRate: Number(taxRate) || 0,
    taxAmount,
    total,
    dueDate: dueDate || null,
    notes: notes || '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    sentAt: null,
    paidAt: null,
  };

  await db.update((d) => {
    if (!d.invoices) d.invoices = [];
    d.invoices.push(invoice);
  });

  res.status(201).json(invoice);
});

// ── CLIENT: update invoice (status, notes, mark paid) ──
router.patch('/:id', requireClient, async (req, res) => {
  const allowed = ['status', 'dueDate', 'notes', 'customerName', 'customerPhone', 'customerEmail'];
  const updated = await db.update((d) => {
    const inv = (d.invoices || []).find(
      (i) => i.id === req.params.id && i.clientId === req.auth.clientId
    );
    if (!inv) return null;
    for (const key of allowed) {
      if (req.body && key in req.body) inv[key] = req.body[key];
    }
    if (req.body.status === 'paid' && !inv.paidAt) inv.paidAt = new Date().toISOString();
    if (req.body.status === 'sent' && !inv.sentAt) inv.sentAt = new Date().toISOString();
    return inv;
  });
  if (!updated) return res.status(404).json({ error: 'Invoice not found' });
  res.json(updated);
});

// ── CLIENT: send invoice via SMS ──
router.post('/:id/send', requireClient, async (req, res) => {
  const data = db.read();
  const inv = (data.invoices || []).find(
    (i) => i.id === req.params.id && i.clientId === req.auth.clientId
  );
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!inv.customerPhone) return res.status(400).json({ error: 'No phone number on invoice' });
  if (!sms.isConfigured()) return res.status(400).json({ error: 'SMS not configured. Add Africa\'s Talking keys in Settings.' });

  const client = data.clients.find((c) => c.id === req.auth.clientId);
  const viewUrl = req.body?.viewUrl || '';
  const msg = `Hi ${inv.customerName}, you have an invoice from ${client?.name || 'us'} for Ksh ${inv.total.toLocaleString()} (${inv.invoiceNumber}).${inv.dueDate ? ' Due: ' + inv.dueDate + '.' : ''} ${viewUrl}`;

  await sms.sendSMS(inv.customerPhone, msg);
  await db.update((d) => {
    const i = (d.invoices || []).find((x) => x.id === inv.id);
    if (i && i.status === 'draft') { i.status = 'sent'; i.sentAt = new Date().toISOString(); }
  });

  res.json({ ok: true });
});

// ── CLIENT: delete invoice ──
router.delete('/:id', requireClient, async (req, res) => {
  const existed = await db.update((d) => {
    const before = (d.invoices || []).length;
    d.invoices = (d.invoices || []).filter(
      (i) => !(i.id === req.params.id && i.clientId === req.auth.clientId)
    );
    return (d.invoices || []).length < before;
  });
  if (!existed) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ ok: true });
});

// ── PUBLIC: view invoice by key (no auth) ──
router.get('/view/:key', (req, res) => {
  const data = db.read();
  const inv = (data.invoices || []).find((i) => i.invoiceKey === req.params.key);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const client = data.clients.find((c) => c.id === inv.clientId);
  res.json({
    invoice: inv,
    businessName: client?.name || '',
    businessPhone: client?.ownerPhone || '',
    businessType: client?.type || '',
  });
});

module.exports = router;
