const express = require('express');
const db = require('../lib/db');
const sms = require('../lib/sms');
const { requireClient } = require('../lib/auth');

const router = express.Router();

function genQuoteNumber(clientId) {
  const data = db.read();
  const count = (data.quotations || []).filter((q) => q.clientId === clientId).length;
  return 'QT-' + String(count + 1).padStart(4, '0');
}

router.get('/', requireClient, (req, res) => {
  const data = db.read();
  const quotes = (data.quotations || [])
    .filter((q) => q.clientId === req.auth.clientId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(quotes);
});

router.post('/', requireClient, async (req, res) => {
  const { customerName, customerPhone, customerEmail, items, validUntil, notes, taxRate } = req.body || {};
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

  const quote = {
    id: 'qt_' + Date.now(),
    clientId: req.auth.clientId,
    quoteNumber: genQuoteNumber(req.auth.clientId),
    customerName,
    customerPhone: customerPhone || '',
    customerEmail: customerEmail || '',
    items: processedItems,
    subtotal,
    taxRate: Number(taxRate) || 0,
    taxAmount,
    total,
    validUntil: validUntil || null,
    notes: notes || '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    sentAt: null,
    acceptedAt: null,
  };

  await db.update((d) => {
    if (!d.quotations) d.quotations = [];
    d.quotations.push(quote);
  });

  res.status(201).json(quote);
});

router.patch('/:id', requireClient, async (req, res) => {
  const allowed = ['status', 'validUntil', 'notes', 'customerName', 'customerPhone'];
  const updated = await db.update((d) => {
    const q = (d.quotations || []).find(
      (x) => x.id === req.params.id && x.clientId === req.auth.clientId
    );
    if (!q) return null;
    for (const key of allowed) {
      if (req.body && key in req.body) q[key] = req.body[key];
    }
    if (req.body.status === 'accepted' && !q.acceptedAt) q.acceptedAt = new Date().toISOString();
    if (req.body.status === 'sent' && !q.sentAt) q.sentAt = new Date().toISOString();
    return q;
  });
  if (!updated) return res.status(404).json({ error: 'Quotation not found' });
  res.json(updated);
});

// Convert accepted quote to invoice
router.post('/:id/convert', requireClient, async (req, res) => {
  const data = db.read();
  const q = (data.quotations || []).find(
    (x) => x.id === req.params.id && x.clientId === req.auth.clientId
  );
  if (!q) return res.status(404).json({ error: 'Quotation not found' });

  const invCount = (data.invoices || []).filter((i) => i.clientId === req.auth.clientId).length;
  const invoice = {
    id: 'invc_' + Date.now(),
    clientId: req.auth.clientId,
    invoiceNumber: 'INV-' + String(invCount + 1).padStart(4, '0'),
    invoiceKey: Math.random().toString(36).slice(2, 10).toUpperCase(),
    quoteId: q.id,
    customerName: q.customerName,
    customerPhone: q.customerPhone,
    customerEmail: q.customerEmail,
    items: q.items,
    subtotal: q.subtotal,
    taxRate: q.taxRate,
    taxAmount: q.taxAmount,
    total: q.total,
    dueDate: null,
    notes: q.notes,
    status: 'draft',
    createdAt: new Date().toISOString(),
    sentAt: null,
    paidAt: null,
  };

  await db.update((d) => {
    if (!d.invoices) d.invoices = [];
    d.invoices.push(invoice);
    const qt = (d.quotations || []).find((x) => x.id === q.id);
    if (qt) qt.status = 'invoiced';
  });

  res.status(201).json(invoice);
});

router.post('/:id/send', requireClient, async (req, res) => {
  const data = db.read();
  const q = (data.quotations || []).find(
    (x) => x.id === req.params.id && x.clientId === req.auth.clientId
  );
  if (!q) return res.status(404).json({ error: 'Quotation not found' });
  if (!q.customerPhone) return res.status(400).json({ error: 'No phone number on quotation' });
  if (!sms.isConfigured()) return res.status(400).json({ error: 'SMS not configured. Add Africa\'s Talking keys in Settings.' });

  const client = data.clients.find((c) => c.id === req.auth.clientId);
  const msg = `Hi ${q.customerName}, you have a quotation from ${client?.name || 'us'} for Ksh ${q.total.toLocaleString()} (${q.quoteNumber}).${q.validUntil ? ' Valid until: ' + q.validUntil + '.' : ''} Contact us to accept or discuss.`;

  await sms.sendSMS(q.customerPhone, msg);
  await db.update((d) => {
    const x = (d.quotations || []).find((qt) => qt.id === q.id);
    if (x && x.status === 'draft') { x.status = 'sent'; x.sentAt = new Date().toISOString(); }
  });

  res.json({ ok: true });
});

router.delete('/:id', requireClient, async (req, res) => {
  const existed = await db.update((d) => {
    const before = (d.quotations || []).length;
    d.quotations = (d.quotations || []).filter(
      (q) => !(q.id === req.params.id && q.clientId === req.auth.clientId)
    );
    return (d.quotations || []).length < before;
  });
  if (!existed) return res.status(404).json({ error: 'Quotation not found' });
  res.json({ ok: true });
});

module.exports = router;
