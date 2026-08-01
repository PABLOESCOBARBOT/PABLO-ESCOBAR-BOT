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
| `NOWPAYMENTS_API_KEY` | *(Optional)* NOWPayments API key — enables auto deposits |
| `NOWPAYMENTS_IPN_SECRET` | *(Optional)* NOWPayments IPN secret for webhook verification |
| `PUBLIC_BASE_URL` | *(Optional)* Public HTTPS origin for IPN callbacks |

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
- `artifacts/api-server/src/bot/nowpayments.ts` — NOWPayments gateway integration
- `artifacts/api-server/src/bot/games/` — game logic (slots, dice, coinflip, blackjack, roulette, crash, plinko)
- `artifacts/api-server/src/routes/nowpayments-ipn.ts` — IPN webhook handler for auto payment notifications
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

### NOWPayments Gateway (Auto)
Recommended. Set `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET`.
Each user gets a unique invoice URL → pays via NOWPayments → IPN/polling confirms → chips credited → user notified on Telegram.

**NOWPayments setup:**
1. https://account.nowpayments.io → API keys
2. Set `NOWPAYMENTS_API_KEY=<key>`
3. Set `NOWPAYMENTS_IPN_SECRET=<secret>`
4. Set `PUBLIC_BASE_URL=https://<your-domain>`
5. IPN path: `https://<your-domain>/api/nowpayments/ipn`

## Games Available

Slots, Dice, Coin Flip, Blackjack, Roulette, Crash, Plinko, PvP Challenge

## User preferences

_Populate as you build._

## Gotchas

- Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` if lib/db schema changed — stale declarations cause false errors.
- The admin bot checks `ADMIN_TELEGRAM_IDS` env var; add your numeric Telegram ID there or all requests will be denied.
- NOWPayments polling runs every 30s; for instant notifications set PUBLIC_BASE_URL so IPN works.
