# Pablo Escobar Casino Bot

Telegram dual-bot casino: player bot + admin bot.

## Bots

| Bot | Username |
|---|---|
| Casino | [@PabloEscobarCasinoBot](https://t.me/PabloEscobarCasinoBot) |
| Admin | [@PabloEscobarAdminBot](https://t.me/PabloEscobarAdminBot) |

## Setup

```bash
cp .env.example .env
# fill CASINO_BOT_TOKEN, ADMIN_BOT_TOKEN, ADMIN_TELEGRAM_IDS, CASINO_BOT_USERNAME, DATABASE_URL, PORT

pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
```

## Required env

See `.env.example`.

## Permanent 24/7 hosting

Cursor / local agent offline = bot offline.  
Deploy from GitHub so bots stay online:

→ see **[DEPLOY.md](./DEPLOY.md)** (Railway recommended, or Docker VPS)
