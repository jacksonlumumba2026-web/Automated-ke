const axios = require('axios');

function baseUrl() {
  return process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function isConfigured() {
  return Boolean(
    process.env.MPESA_CONSUMER_KEY &&
    process.env.MPESA_CONSUMER_SECRET &&
    process.env.MPESA_SHORTCODE &&
    process.env.MPESA_PASSKEY
  );
}

async function getAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const { data } = await axios.get(
    `${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return data.access_token;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function normalizePhone(phone) {
  let p = String(phone).replace(/\s|-/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('+')) p = p.slice(1);
  return p;
}

/**
 * Initiates an STK push (Lipa na M-Pesa Online) prompt to the customer's phone.
 * Requires MPESA_* env vars; throws if not configured so callers can fall back.
 */
async function stkPush({ phone, amount, accountRef, description }) {
  if (!isConfigured()) {
    const err = new Error('M-Pesa not configured');
    err.code = 'MPESA_NOT_CONFIGURED';
    throw err;
  }
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const ts = timestamp();
  const password = Buffer.from(shortcode + passkey + ts).toString('base64');
  const token = await getAccessToken();
  const msisdn = normalizePhone(phone);

  const isTill = (process.env.MPESA_TYPE || 'paybill') === 'till';

  const { data } = await axios.post(
    `${baseUrl()}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: isTill ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: msisdn,
      PartyB: shortcode,
      PhoneNumber: msisdn,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountRef.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data; // { MerchantRequestID, CheckoutRequestID, ResponseCode, ... }
}

module.exports = { stkPush, isConfigured, normalizePhone };
