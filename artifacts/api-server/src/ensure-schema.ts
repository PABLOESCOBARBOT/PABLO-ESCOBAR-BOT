import { pool } from "@workspace/db";
import { logger } from "./lib/logger";

/** Create tables if missing — no drizzle-kit needed at runtime (Railway-safe). */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      chips NUMERIC(20, 2) NOT NULL DEFAULT '0',
      is_banned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      amount NUMERIC(20, 2) NOT NULL,
      crypto TEXT,
      crypto_amount TEXT,
      tx_hash TEXT,
      wallet_address TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS game_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      game TEXT NOT NULL,
      bet_amount NUMERIC(20, 2) NOT NULL,
      payout NUMERIC(20, 2) NOT NULL DEFAULT '0',
      result TEXT,
      game_data TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pvp_challenges (
      id SERIAL PRIMARY KEY,
      challenger_tg_id TEXT NOT NULL,
      challengee_tg_id TEXT,
      game TEXT NOT NULL,
      bet_amount NUMERIC(20, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      winner_tg_id TEXT,
      chat_id TEXT,
      message_id INTEGER,
      game_data TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deposit_addresses (
      id SERIAL PRIMARY KEY,
      crypto TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      network TEXT,
      min_deposit NUMERIC(20, 8) NOT NULL DEFAULT '1',
      chips_per_unit NUMERIC(20, 2) NOT NULL DEFAULT '100',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  logger.info("DB schema ready");
}
