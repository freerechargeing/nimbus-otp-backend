# Nimbus OTP Backend (Twilio Verify)

A tiny Express server that sends and checks OTP codes using **Twilio
Verify**, so real SMS actually reaches the phone number typed into the
Register / Forgot Password screens.

## 1. Twilio setup (one-time)

1. Create a free Twilio account: https://www.twilio.com/try-twilio
2. In the Console, go to **Verify → Services** and create a new
   Verify Service. Copy its **Service SID** (starts with `VA...`).
3. From the Console dashboard, copy your **Account SID** and
   **Auth Token**.

Twilio Verify handles generating, texting and expiring the code for
you — this server never stores the OTP itself, which is both simpler
and safer than rolling your own.

## 2. Run the server

```bash
cd otp-backend
cp .env.example .env       # then paste your 3 Twilio values into .env
npm install
npm start
```

Server runs on `http://localhost:3000` by default.

## 3. API

**Send a code**
```
POST /api/otp/send
Content-Type: application/json

{ "phone": "+919876543210" }
```
→ `{ "status": "pending" }`

**Check a code**
```
POST /api/otp/check
Content-Type: application/json

{ "phone": "+919876543210", "code": "482913" }
```
→ `{ "status": "approved", "approved": true }`

## 4. Important — connecting the Nimbus frontend

The Nimbus app you have as a **published claude.ai artifact** cannot
call this server directly: published artifact pages are locked down by
a content-security policy that blocks outgoing requests to any domain
except a short list of script CDNs — your own backend's URL isn't on
that list, so a `fetch()` to it fails silently.

To actually wire the frontend to this backend, host the Nimbus HTML
file yourself too (any static host — Vercel, Netlify, your own
server, even a folder served by this same Express app), not as a
Claude artifact. Once both are on domains you control, point the
frontend's `fetch()` calls at this backend's URL and it will work
exactly as coded.

A modified copy of the frontend, wired to call `/api/otp/send` and
`/api/otp/check`, is included as `nimbus-app-with-otp.html` —
update the `OTP_API_BASE` constant near the top of its `<script>` to
your backend's real URL before hosting it.

## 5. Production notes

- Set `ALLOWED_ORIGIN` in `.env` to your real frontend domain (not `*`).
- Put this server behind HTTPS.
- The in-memory rate limiter resets if the process restarts and won't
  work across multiple server instances — swap in Redis if you scale
  beyond one instance.
