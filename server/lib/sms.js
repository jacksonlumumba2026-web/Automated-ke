const axios = require('axios');

function isConfigured() {
  return Boolean(process.env.AT_API_KEY && process.env.AT_USERNAME);
}

function host() {
  return process.env.AT_ENV === 'production'
    ? 'https://api.africastalking.com'
    : 'https://api.sandbox.africastalking.com';
}

/**
 * Sends an SMS via Africa's Talking. Returns null silently if not configured
 * (so the rest of the app keeps working before the owner adds real keys).
 */
async function sendSMS(to, message) {
  if (!isConfigured()) return null;
  const params = new URLSearchParams({
    username: process.env.AT_USERNAME,
    to,
    message,
    ...(process.env.AT_SENDER_ID ? { from: process.env.AT_SENDER_ID } : {}),
  });
  const { data } = await axios.post(`${host()}/version1/messaging`, params, {
    headers: {
      apiKey: process.env.AT_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
  });
  return data;
}

module.exports = { sendSMS, isConfigured };
