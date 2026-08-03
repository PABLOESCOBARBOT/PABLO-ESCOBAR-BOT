import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Users ───────────────────────────────────────────────────────────────────
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: text("telegram_id").notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  chips: numeric("chips", { precision: 20, scale: 2 }).notNull().default("0"),
  isBanned: boolean("is_banned").notNull().default(false),
  /** Unique share code for referral deep-links (?start=ref_CODE). */
  referralCode: text("referral_code").unique(),
  /** users.id of the referrer — set once when a new user joins via link. */
  referredBy: integer("referred_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  type: text("type").notNull(), // deposit | withdrawal | game_win | game_loss | admin_credit | admin_debit
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  crypto: text("crypto"),       // usdt_trc20 | btc | eth | ton | bnb | ltc | usdt_erc20
  cryptoAmount: text("crypto_amount"),
  txHash: text("tx_hash"),
  walletAddress: text("wallet_address"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;

// ─── Game Sessions ────────────────────────────────────────────────────────────
export const gameSessionsTable = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  game: text("game").notNull(),  // slots | dice | coinflip | blackjack | roulette | crash | plinko
  betAmount: numeric("bet_amount", { precision: 20, scale: 2 }).notNull(),
  payout: numeric("payout", { precision: 20, scale: 2 }).notNull().default("0"),
  result: text("result"),        // win | loss | push
  gameData: text("game_data"),   // JSON with game-specific data
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGameSessionSchema = createInsertSchema(gameSessionsTable).omit({ id: true, createdAt: true });
export type InsertGameSession = z.infer<typeof insertGameSessionSchema>;
export type GameSession = typeof gameSessionsTable.$inferSelect;

// ─── PvP Challenges ───────────────────────────────────────────────────────────
export const pvpChallengesTable = pgTable("pvp_challenges", {
  id: serial("id").primaryKey(),
  challengerTgId: text("challenger_tg_id").notNull(),
  challengeeTgId: text("challengee_tg_id"),
  game: text("game").notNull(),
  betAmount: numeric("bet_amount", { precision: 20, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending | accepted | completed | cancelled | expired
  winnerId: text("winner_tg_id"),
  chatId: text("chat_id"),
  messageId: integer("message_id"),
  gameData: text("game_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPvpChallengeSchema = createInsertSchema(pvpChallengesTable).omit({ id: true, createdAt: true });
export type InsertPvpChallenge = z.infer<typeof insertPvpChallengeSchema>;
export type PvpChallenge = typeof pvpChallengesTable.$inferSelect;

// ─── House bank (shared casino balance for bot games) ─────────────────────────
export const houseBankTable = pgTable("house_bank", {
  id: integer("id").primaryKey().default(1),
  balance: numeric("balance", { precision: 20, scale: 2 }).notNull().default("15000"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type HouseBank = typeof houseBankTable.$inferSelect;

// ─── Deposit Addresses ────────────────────────────────────────────────────────
export const depositAddressesTable = pgTable("deposit_addresses", {
  id: serial("id").primaryKey(),
  crypto: text("crypto").notNull().unique(), // usdt_trc20 | btc | eth | etc.
  label: text("label").notNull(),            // "USDT (TRC20)" etc.
  address: text("address").notNull(),
  network: text("network"),
  minDeposit: numeric("min_deposit", { precision: 20, scale: 8 }).notNull().default("1"),
  chipsPerUnit: numeric("chips_per_unit", { precision: 20, scale: 2 }).notNull().default("100"), // 1 crypto = X chips
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDepositAddressSchema = createInsertSchema(depositAddressesTable).omit({ id: true, updatedAt: true });
export type InsertDepositAddress = z.infer<typeof insertDepositAddressSchema>;
export type DepositAddress = typeof depositAddressesTable.$inferSelect;
