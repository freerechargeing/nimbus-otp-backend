// Nimbus OTP backend — sends & verifies OTPs using Twilio Verify.
//
// Twilio Verify (not raw SMS) is used on purpose: Twilio itself
// generates, stores and expires the code, so this server never has to
// hold OTPs in memory/DB or worry about replay attacks.
//
// Endpoints:
//   POST /api/otp/send    { phone: "+919876543210" }
//   POST /api/otp/check   { phone: "+919876543210", code: "123456" }
//
// Setup:
//   1. cp .env.example .env   and fill in your Twilio values
//   2. npm install
//   3. npm start

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID,
  PORT = 3000,
  ALLOWED_ORIGIN = '*',
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
  console.error(
    'Missing Twilio env vars. Copy .env.example to .env and fill in ' +
    'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID.'
  );
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const app = express();
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));

// E.164 phone numbers only: + followed by 8-15 digits.
const E164 = /^\+[1-9]\d{7,14}$/;

// Very small in-memory rate limiter: max 5 send-requests per phone
// per 10 minutes, to slow down abuse. Swap for Redis in production
// if you run more than one server instance.
const sendHistory = new Map(); // phone -> [timestamps]
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS = 5;

function tooManyRequests(phone) {
  const now = Date.now();
  const history = (sendHistory.get(phone) || []).filter(
    (t) => now - t < WINDOW_MS
  );
  history.push(now);
  sendHistory.set(phone, history);
  return history.length > MAX_SENDS;
}

app.post('/api/otp/send', async (req, res) => {
  const { phone, channel = 'sms' } = req.body || {};

  if (!phone || !E164.test(phone)) {
    return res.status(400).json({
      error: 'invalid_phone',
      message: 'phone must be in E.164 format, e.g. +919876543210',
    });
  }
  if (!['sms', 'call', 'whatsapp'].includes(channel)) {
    return res.status(400).json({ error: 'invalid_channel' });
  }
  if (tooManyRequests(phone)) {
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Too many OTP requests for this number. Try again later.',
    });
  }

  try {
    const verification = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel });

    return res.json({ status: verification.status }); // "pending"
  } catch (err) {
    console.error('Twilio send error:', err.message);
    return res.status(502).json({
      error: 'twilio_error',
      message: err.message,
    });
  }
});

app.post('/api/otp/check', async (req, res) => {
  const { phone, code } = req.body || {};

  if (!phone || !E164.test(phone)) {
    return res.status(400).json({ error: 'invalid_phone' });
  }
  if (!code || typeof code !== 'string' || code.length < 4 || code.length > 10) {
    return res.status(400).json({ error: 'invalid_code' });
  }

  try {
    const check = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    return res.json({
      status: check.status,             // "approved" | "pending" | ...
      approved: check.status === 'approved',
    });
  } catch (err) {
    console.error('Twilio check error:', err.message);
    // Twilio returns 404 if the phone has no pending verification
    // (e.g. it already expired) — surface that distinctly.
    if (err.status === 404) {
      return res.status(410).json({
        error: 'verification_expired',
        message: 'No pending verification for this number. Send a new code.',
      });
    }
    return res.status(502).json({ error: 'twilio_error', message: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Nimbus OTP backend listening on port ${PORT}`);
});
