# Permanent 24/7 hosting (Railway)

Cursor agent offline = bot offline. Railway pe deploy karo — GitHub se auto chalega.

## Fix “Build failed”

### 1) Correct branch
Railway service → **Settings → Source**  
Branch: `main` (or `cursor/fix-casino-bot-bugs-93df`)

### 2) Builder = Nixpacks
Settings → Build:
- Builder: **Nixpacks** (not Dockerfile)
- Root directory: `/` (repo root)

### 3) Add Postgres
Project → **+ New** → **Database** → **PostgreSQL**  
Bot service Variables mein `DATABASE_URL` **Reference** karo (type manually mat karo).

### 4) Add Variables
Service → **Variables** → **Raw Editor** → paste:

```env
CASINO_BOT_TOKEN=your_casino_token
ADMIN_BOT_TOKEN=your_admin_token
ADMIN_TELEGRAM_IDS=6405341340
CASINO_BOT_USERNAME=PabloEscobarCasinoBot
PORT=3000

# NOWPayments — auto deposit USD after blockchain confirm
NOWPAYMENTS_API_KEY=your_api_key
NOWPAYMENTS_IPN_SECRET=your_ipn_secret
PUBLIC_BASE_URL=https://YOUR-SERVICE.up.railway.app

# Optional — auto LTC withdrawals via NOWPayments mass payouts
NOWPAYMENTS_EMAIL=your_nowpayments_login_email
NOWPAYMENTS_PASSWORD=your_nowpayments_login_password
```

`PUBLIC_BASE_URL` = Railway service ka public HTTPS URL (Settings → Networking / Domains).  
IPN endpoint: `{PUBLIC_BASE_URL}/api/nowpayments/ipn`

NOWPayments dashboard mein bhi same IPN URL set karo.  
Payouts ke liye dashboard mein IP whitelist + address whitelist + 2FA rules check karo.

Save. (`DATABASE_URL` Postgres plugin se aana chahiye.)

### 5) Redeploy
Click **Deploy** / **Redeploy**.  
Success logs:
- `Casino Bot started (polling)`
- `Admin Bot started (polling)`
- `NOWPayments enabled — deposit poller every 30s`

### 6) Stop local/Cursor bot
Railway online hone ke baad Cursor wala process band — warna Telegram conflict.

---

## How auto payments work

**Deposits**
1. User → Deposit → crypto → Auto Deposit (NOWPayments)
2. Bot creates payment/invoice with unique address
3. User pays on-chain
4. NOWPayments IPN + 30s poller confirm
5. Bot credits **USD** to user balance + Telegram notify

**Withdrawals**
1. User requests LTC withdraw (USD locked)
2. If `NOWPAYMENTS_EMAIL` + `NOWPAYMENTS_PASSWORD` set → auto payout queued
3. Else admin pays manually and taps **Paid**
4. On payout fail → USD refunded

---

## Optional: Docker on VPS

```bash
cp .env.example .env   # fill tokens + NOWPayments keys
docker compose up -d --build
```
