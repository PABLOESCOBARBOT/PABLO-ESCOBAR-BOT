# Telegram Casino Bot

A dual-bot Telegram casino system: a **Casino Bot** for players (games, deposit, withdraw) and an **Admin Bot** to manage everything.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run both bots + Express API server (port from env)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — rebuild lib declarations first (run before api-server typecheck after lib changes)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `CASINO_BOT_TOKEN` | BotFather token for the main casino bot |
| `ADMIN_BOT_TOKEN` | BotFather token for the admin bot |
| `ADMIN_TELEGRAM_IDS` | Comma-separated Telegram IDs of admins (e.g. `123456,789012`) |
| `CASINO_BOT_USERNAME` | Username of the casino bot (without @) — used for redirect links in admin bot |
| `CRYPTOPAY_TOKEN` | *(Optional)* CryptoPay API token from @CryptoBot — enables auto-payment detection |

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bots: Telegraf 4
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/bot/casino-bot.ts` — main player-facing casino bot
- `artifacts/api-server/src/bot/admin-bot.ts` — admin management bot (4-section menu)
- `artifacts/api-server/src/bot/keyboards.ts` — all Telegram keyboard layouts
- `artifacts/api-server/src/bot/db-helpers.ts` — all database operations
- `artifacts/api-server/src/bot/cryptopay.ts` — CryptoPay gateway integration
- `artifacts/api-server/src/bot/games/` — game logic (slots, dice, coinflip, blackjack, roulette, crash, plinko)
- `artifacts/api-server/src/routes/cryptopay-webhook.ts` — webhook handler for auto payment notifications
- `lib/db/src/schema/index.ts` — database schema (source of truth)

## Admin Bot — 4 Sections

1. **💰 Deposit** — view pending deposits, approve/reject, manage crypto addresses, payment settings
2. **📤 Withdrawal** — view pending withdrawals, approve/reject, see today's history
3. **🎁 Bonuses** — give chips to users, bonus history (coming soon)
4. **🎮 Games** — casino stats, user management, ban/unban, find user, link to casino bot

## Crypto Payment Modes

### Static Addresses (Manual)
Admin sets their own wallet address per crypto in Admin Bot → Deposit → Crypto Addresses.
User sends funds → submits TX hash → admin approves manually → chips credited.

### CryptoPay Gateway (Auto)
Recommended. Set `CRYPTOPAY_TOKEN` from @CryptoBot.
Each user gets a unique invoice → pays via CryptoBot → payment auto-detected via polling (every 30s) or webhook → chips credited instantly → user notified on Telegram.

**CryptoPay setup:**
1. Open @CryptoBot on Telegram
2. /pay → My Apps → Create App
3. Copy API token → set `CRYPTOPAY_TOKEN=<token>`
4. *(Optional)* Set webhook URL: `https://<your-domain>/api/cryptopay/webhook`

## Games Available

Slots, Dice, Coin Flip, Blackjack, Roulette, Crash, Plinko, PvP Challenge

## User preferences

_Populate as you build._

## Gotchas

- Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` if lib/db schema changed — stale declarations cause false errors.
- The admin bot checks `ADMIN_TELEGRAM_IDS` env var; add your numeric Telegram ID there or all requests will be denied.
- CryptoPay polling runs every 30s; for instant notifications use the webhook endpoint instead.
