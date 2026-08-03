# Permanent 24/7 hosting (Railway)

Cursor agent offline = bot offline. Railway pe deploy karo — GitHub se auto chalega.

## Fix “Build failed”

### 1) Correct branch
Railway service → **Settings → Source**  
Branch: `cursor/fix-casino-bot-bugs-93df`  
(`main` pe deploy setup nahi hai)

### 2) Builder = Nixpacks
Settings → Build:
- Builder: **Nixpacks** (not Dockerfile)
- Root directory: `/` (repo root)

### 3) Add Postgres
Project → **+ New** → **Database** → **PostgreSQL**  
Bot service Variables mein `DATABASE_URL` connect/reference karo (Railway usually auto-adds it).

### 4) Add Variables
Service → **Variables** → **Raw Editor** → paste (apne tokens se):

```env
CASINO_BOT_TOKEN=your_casino_token
ADMIN_BOT_TOKEN=your_admin_token
ADMIN_TELEGRAM_IDS=6405341340
CASINO_BOT_USERNAME=PabloEscobarCasinoBot
PORT=3000
```

Save. (`DATABASE_URL` Postgres plugin se aana chahiye.)

### 5) Redeploy
Click **Deploy** / **Redeploy**.  
Success logs:
- `Casino Bot started (polling)`
- `Admin Bot started (polling)`

### 6) Stop local/Cursor bot
Railway online hone ke baad Cursor wala process band — warna Telegram conflict.

---

## Optional: Docker on VPS

```bash
cp .env.example .env   # fill tokens
docker compose up -d --build
```
