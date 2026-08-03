# Permanent bot hosting (24/7)

Cursor cloud agent **band** hone pe bot bhi band ho jata hai.  
GitHub PR code store karta hai — **24/7 process nahi chalata**.

Permanent online ke liye bot ko **Railway** (recommended) ya apne VPS pe Docker se chalao.

---

## Option A — Railway (GitHub se, easiest)

1. Open https://railway.app → login with GitHub
2. **New Project** → **Deploy from GitHub repo** → `PABLOESCOBARBOT/PABLO-ESCOBAR-BOT`
3. Select branch `main` (merge PR #1 pehle) **ya** `cursor/fix-casino-bot-bugs-93df`
4. **Add Plugin** → **PostgreSQL**
5. Service → **Variables** → add:

| Variable | Value |
|---|---|
| `CASINO_BOT_TOKEN` | (BotFather casino token) |
| `ADMIN_BOT_TOKEN` | (BotFather admin token) |
| `ADMIN_TELEGRAM_IDS` | `6405341340` |
| `CASINO_BOT_USERNAME` | `PabloEscobarCasinoBot` |
| `PORT` | `3000` |

`DATABASE_URL` Railway Postgres plugin se **auto** mil jata hai — mat overwrite karo.

6. Deploy. Logs mein dikhega:
   - `Casino Bot started (polling)`
   - `Admin Bot started (polling)`

7. Telegram pe `/start` — bot agent offline hone pe bhi chalega.

Optional: Settings → **Generate Domain** (NOWPayments IPN ke liye `PUBLIC_BASE_URL`).

---

## Option B — Docker on any VPS

```bash
git clone https://github.com/PABLOESCOBARBOT/PABLO-ESCOBAR-BOT.git
cd PABLO-ESCOBAR-BOT
cp .env.example .env
# fill CASINO_BOT_TOKEN, ADMIN_BOT_TOKEN, ADMIN_TELEGRAM_IDS, CASINO_BOT_USERNAME

docker compose up -d --build
docker compose logs -f bot
```

Restart policy `unless-stopped` — reboot ke baad bhi bots wapas aate hain.

---

## Important

- **Ek hi jagah** pe bot chalao (Railway **ya** Cursor VM **ya** VPS). Do jagah polling = Telegram conflict (`409`).
- Permanent host start karte hi Cursor/agent wala process **band** kar do.
