# AutomateKE 2.0

A working multi-tenant SaaS platform for Kenyan SMEs: CRM, M-Pesa payment automation, SMS/WhatsApp customer touchpoints, and automatic Day 1/3/7 follow-ups — all in one dashboard.

## What's in this repo

- `public/` — the frontend (static HTML/CSS/JS, no build step)
  - `index.html` — marketing/landing page
  - `admin.html` — your super-admin panel (add clients, see revenue, configure integrations)
  - `dashboard.html` — what each client sees (their CRM, transactions, follow-ups)
  - `portal.html` — the public payment page clients share with their own customers
  - `js/api.js` — shared helper that talks to the backend
- `server/` — the Node.js/Express backend (JSON-file database, no separate DB server needed)
  - `routes/` — API endpoints (auth, clients, transactions, contacts, followups, settings)
  - `lib/` — M-Pesa Daraja, Africa's Talking SMS, JWT auth, JSON storage
  - `cron/followups.js` — background job that sends due follow-up SMS every 15 minutes
  - `data/db.json` — the database file (created automatically, **not committed to git**)

## What to push to GitHub

Everything in this repo **except**:
- `node_modules/` (already gitignored — installed fresh on the server)
- `.env` (already gitignored — your real secrets live only on the server)
- `server/data/db.json` (already gitignored — this is your live business data, not source code)

In short: just commit and push normally. The `.gitignore` already keeps secrets and data out.

## What to upload/deploy to Truehost

Truehost (cPanel) hosting needs three things this repo doesn't include by default:

1. **The code itself** — either `git clone` your repo directly on the server (if Truehost gives you SSH/git access), or zip the repo and upload via cPanel File Manager, then extract it into your app's folder.
2. **`node_modules/`** — run `npm install` *on the server* after upload (don't upload your local `node_modules`, it's gitignored and platform-specific anyway).
3. **A real `.env` file** — create this directly on the server (cPanel File Manager → create file `.env` in the project root, or via SSH). Never commit this file. Use `.env.example` as the template.

### Step-by-step on Truehost cPanel

1. **Log in to cPanel** → find **"Setup Node.js App"** (under Software section). If your Truehost plan doesn't have this, you'll need their VPS plan instead — basic shared hosting without Node.js support cannot run this backend.
2. **Create a new Node.js app**:
   - Node version: 18 or higher
   - Application root: e.g. `automate-ke` (a folder under your account)
   - Application URL: your domain or subdomain
   - Application startup file: `server/index.js`
3. **Upload the code** into that application root folder (via Git, File Manager zip upload, or FTP) — same contents as this GitHub repo.
4. **Set Environment Variables** in the same "Setup Node.js App" screen (this is the secure equivalent of a `.env` file — Truehost's panel lets you add them directly, or you can create a real `.env` file in the app folder if your setup doesn't expose this panel):
   ```
   PORT=<the port Truehost assigns — leave default if shown>
   JWT_SECRET=<a long random string — generate one, don't reuse the example>
   ADMIN_PASSWORD=<your real admin password>
   APP_URL=https://yourdomain.co.ke
   MPESA_ENV=production
   MPESA_CONSUMER_KEY=<from developer.safaricom.co.ke>
   MPESA_CONSUMER_SECRET=<from developer.safaricom.co.ke>
   MPESA_SHORTCODE=<your Paybill/Till number>
   MPESA_PASSKEY=<from Safaricom Daraja portal>
   MPESA_CALLBACK_URL=https://yourdomain.co.ke/api/transactions/mpesa/callback
   AT_ENV=production
   AT_API_KEY=<from africastalking.com>
   AT_USERNAME=<your AT username>
   AT_SENDER_ID=AutomateKE
   ```
   You can leave the `MPESA_*` and `AT_*` variables empty at first — the app runs fine without them (payments are recorded as "simulated" and SMS sending is silently skipped) so you can demo the platform before signing up for real credentials.
5. **Run "NPM Install"** from the same Node.js App panel (there's usually a button for this — it runs `npm install` inside the app's virtual environment).
6. **Start/Restart the app** from the panel.
7. Visit your domain — you should see the landing page. Visit `/admin.html` and log in with the `ADMIN_PASSWORD` you set.

### Getting real credentials (optional, app works without them first)

- **M-Pesa Daraja**: sign up free at [developer.safaricom.co.ke](https://developer.safaricom.co.ke), create an app, get sandbox keys to test, then apply for "Go Live" to get production keys against your real Paybill/Till number.
- **Africa's Talking SMS**: sign up free at [africastalking.com](https://africastalking.com), get an API key (sandbox first, then buy SMS credit for production).

## Local development

```bash
npm install
cp .env.example .env   # then fill in JWT_SECRET and ADMIN_PASSWORD at minimum
npm run dev
```

Visit `http://localhost:4000`. Default admin password (until you change it via the Settings page) is whatever you set as `ADMIN_PASSWORD` in `.env`.

## How the pieces fit together

1. You (super-admin) log into `/admin.html` and add a client business — this creates their dashboard login and a unique payment-portal link.
2. You send that client their dashboard link (`/dashboard.html`) and login, plus their portal link (`/portal.html?key=...`) to share with their own customers.
3. The client's customers pay via the portal — M-Pesa STK push if configured, otherwise a clearly-flagged simulated payment so the flow still works end-to-end.
4. The client uses their dashboard's CRM tab to track leads, send SMS, and schedule Day 1/3/7 follow-ups — these are sent automatically by the background cron job in `server/cron/followups.js`.

## Known limitations / upgrade paths

- **WhatsApp** currently uses `wa.me` click-to-chat links (one tap opens WhatsApp with a pre-filled message). A fully automated WhatsApp bot requires Meta Business verification for the WhatsApp Cloud API — a future upgrade, not implemented here.
- **WiFi voucher redemption** is a simplified client-side check, not a real MikroTik router integration. Real router integration is a future upgrade per WiFi client.
- **Database** is a single JSON file with atomic writes — fine for the scale of a single Truehost app, but if you outgrow it, migrate to Postgres/MySQL.
