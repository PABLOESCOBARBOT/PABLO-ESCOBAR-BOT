import { db } from "@workspace/db";
import {
  usersTable,
  transactionsTable,
  gameSessionsTable,
  pvpChallengesTable,
  depositAddressesTable,
  type User,
  type Transaction,
  type DepositAddress,
} from "@workspace/db";
import { eq, sql, desc, and, gte } from "drizzle-orm";

class InsufficientChipsError extends Error {
  constructor(message = "Insufficient USD") {
    super(message);
    this.name = "InsufficientChipsError";
  }
}

export { InsufficientChipsError };

// ─── User Helpers ─────────────────────────────────────────────────────────────

export async function getOrCreateUser(
  telegramId: string,
  username?: string,
  firstName?: string,
  lastName?: string,
): Promise<User> {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(usersTable)
      .set({ username, firstName, lastName, updatedAt: new Date() })
      .where(eq(usersTable.telegramId, telegramId));
    return { ...existing[0], username: username ?? existing[0].username };
  }

  const inserted = await db
    .insert(usersTable)
    .values({ telegramId, username, firstName, lastName, chips: "0" })
    .returning();
  return inserted[0]!;
}

export async function getUserByTgId(telegramId: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: number): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getChips(telegramId: string): Promise<number> {
  const user = await getUserByTgId(telegramId);
  return user ? parseFloat(user.chips) : 0;
}

export async function addChips(
  telegramId: string,
  amount: number,
  type: string,
  note?: string,
): Promise<number> {
  const user = await getUserByTgId(telegramId);
  if (!user) throw new Error("User not found");

  // Atomic increment — avoids lost updates under concurrent play
  const updated = await db
    .update(usersTable)
    .set({
      chips: sql`(${usersTable.chips}::numeric + ${amount.toFixed(2)})`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.telegramId, telegramId))
    .returning();

  if (!updated[0]) throw new Error("User not found");

  await db.insert(transactionsTable).values({
    userId: user.id,
    type,
    amount: Math.abs(amount).toFixed(2),
    status: "approved",
    note,
  });
  return parseFloat(updated[0].chips);
}

export async function deductChips(
  telegramId: string,
  amount: number,
  type: string,
  note?: string,
): Promise<number> {
  if (amount < 0) throw new Error("deductChips amount must be >= 0");

  const user = await getUserByTgId(telegramId);
  if (!user) throw new Error("User not found");

  // Atomic debit with balance guard — prevents negative balances / double-spend
  const updated = await db
    .update(usersTable)
    .set({
      chips: sql`(${usersTable.chips}::numeric - ${amount.toFixed(2)})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usersTable.telegramId, telegramId),
        sql`${usersTable.chips}::numeric >= ${amount.toFixed(2)}`,
      ),
    )
    .returning();

  if (!updated[0]) throw new InsufficientChipsError();

  await db.insert(transactionsTable).values({
    userId: user.id,
    type,
    amount: amount.toFixed(2),
    status: "approved",
    note,
  });
  return parseFloat(updated[0].chips);
}

export async function setChips(telegramId: string, amount: number): Promise<void> {
  await db
    .update(usersTable)
    .set({ chips: amount.toFixed(2), updatedAt: new Date() })
    .where(eq(usersTable.telegramId, telegramId));
}

export async function banUser(telegramId: string, ban: boolean): Promise<void> {
  await db
    .update(usersTable)
    .set({ isBanned: ban, updatedAt: new Date() })
    .where(eq(usersTable.telegramId, telegramId));
}

// ─── Game Session Helpers ─────────────────────────────────────────────────────

export async function recordGame(
  telegramId: string,
  game: string,
  betAmount: number,
  payout: number,
  result: "win" | "loss" | "push",
  gameData?: Record<string, unknown>,
): Promise<void> {
  const user = await getUserByTgId(telegramId);
  if (!user) return;
  await db.insert(gameSessionsTable).values({
    userId: user.id,
    game,
    betAmount: betAmount.toFixed(2),
    payout: payout.toFixed(2),
    result,
    gameData: gameData ? JSON.stringify(gameData) : null,
  });
}

export async function getRecentGames(telegramId: string, limit = 5) {
  const user = await getUserByTgId(telegramId);
  if (!user) return [];
  return db
    .select()
    .from(gameSessionsTable)
    .where(eq(gameSessionsTable.userId, user.id))
    .orderBy(desc(gameSessionsTable.createdAt))
    .limit(limit);
}

// ─── Transaction Helpers ──────────────────────────────────────────────────────

export async function createDepositRequest(
  telegramId: string,
  crypto: string,
  cryptoAmount: string,
  txHash: string,
  walletAddress: string,
): Promise<Transaction> {
  const user = await getUserByTgId(telegramId);
  if (!user) throw new Error("User not found");
  const rows = await db
    .insert(transactionsTable)
    .values({
      userId: user.id,
      type: "deposit",
      amount: "0",
      crypto,
      cryptoAmount,
      txHash,
      walletAddress,
      status: "pending",
    })
    .returning();
  return rows[0]!;
}

/** Create a gateway (NOWPayments) deposit — auto approved when payment confirmed */
export async function createAutoDeposit(
  telegramId: string,
  crypto: string,
  cryptoAmount: string,
  invoiceId: string,
  invoiceUrl: string,
  orderId: string,
): Promise<Transaction> {
  const user = await getUserByTgId(telegramId);
  if (!user) throw new Error("User not found");
  const rows = await db
    .insert(transactionsTable)
    .values({
      userId: user.id,
      type: "deposit",
      amount: "0",
      crypto,
      cryptoAmount,
      txHash: invoiceId,          // NOWPayments invoice / payment id
      walletAddress: invoiceUrl,  // checkout URL
      status: "pending",
      note: `NOWPayments order ${orderId}`,
    })
    .returning();
  return rows[0]!;
}

/** Find a pending deposit by invoice/payment id stored in txHash (supports inv- prefix). */
export async function findDepositByInvoiceId(invoiceId: string): Promise<Transaction | null> {
  const raw = invoiceId.replace(/^inv-/, "");
  const candidates = [invoiceId, raw, `inv-${raw}`];

  for (const id of candidates) {
    const rows = await db
      .select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.txHash, id),
          eq(transactionsTable.status, "pending"),
          eq(transactionsTable.type, "deposit"),
        ),
      )
      .limit(1);
    if (rows[0]) return rows[0];
  }
  return null;
}

/** Pending NOWPayments deposits — numeric payment_id in txHash (pollable). */
export async function getPendingNowPaymentsPaymentIds(): Promise<string[]> {
  const rows = await db
    .select({ txHash: transactionsTable.txHash, note: transactionsTable.note })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "pending"),
      ),
    )
    .limit(100);

  return rows
    .filter((r) => r.note?.startsWith("NOWPayments order ") && r.txHash)
    .map((r) => r.txHash!)
    .filter((id) => /^\d+$/.test(id));
}

/** Pending NOWPayments invoice-only deposits (txHash = inv-<id>). */
export async function getPendingNowPaymentsInvoiceDeposits(): Promise<
  Array<{ id: number; txHash: string; note: string | null; orderId: string | null }>
> {
  const rows = await db
    .select({
      id: transactionsTable.id,
      txHash: transactionsTable.txHash,
      note: transactionsTable.note,
    })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "pending"),
      ),
    )
    .limit(100);

  return rows
    .filter((r) => r.note?.startsWith("NOWPayments order ") && r.txHash?.startsWith("inv-"))
    .map((r) => ({
      id: r.id,
      txHash: r.txHash!,
      note: r.note,
      orderId: r.note?.replace(/^NOWPayments order /, "") ?? null,
    }));
}

/** Upgrade invoice deposit to numeric payment_id so the poller can track it. */
export async function bindDepositPaymentId(txId: number, paymentId: string): Promise<void> {
  if (!/^\d+$/.test(paymentId)) return;
  await db
    .update(transactionsTable)
    .set({ txHash: paymentId })
    .where(
      and(
        eq(transactionsTable.id, txId),
        eq(transactionsTable.status, "pending"),
        eq(transactionsTable.type, "deposit"),
      ),
    );
}

/** Mark withdrawal with NOWPayments payout/batch id for status tracking. */
export async function bindWithdrawalPayoutId(
  txId: number,
  payoutId: string,
  cryptoAmount?: string,
): Promise<void> {
  await db
    .update(transactionsTable)
    .set({
      txHash: `np-payout-${payoutId}`,
      ...(cryptoAmount ? { cryptoAmount } : {}),
      note: `NOWPayments payout ${payoutId}`,
    })
    .where(
      and(
        eq(transactionsTable.id, txId),
        eq(transactionsTable.status, "pending"),
        eq(transactionsTable.type, "withdrawal"),
      ),
    );
}

export async function findWithdrawalByPayoutId(payoutId: string): Promise<Transaction | null> {
  const candidates = [`np-payout-${payoutId}`, payoutId];
  for (const id of candidates) {
    const byHash = await db
      .select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.txHash, id),
          eq(transactionsTable.status, "pending"),
          eq(transactionsTable.type, "withdrawal"),
        ),
      )
      .limit(1);
    if (byHash[0]) return byHash[0];
  }

  const byNote = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.status, "pending"),
        eq(transactionsTable.type, "withdrawal"),
        eq(transactionsTable.note, `NOWPayments payout ${payoutId}`),
      ),
    )
    .limit(1);
  return byNote[0] ?? null;
}

/** Find a pending deposit by NOWPayments order_id stored in note: "NOWPayments order <id>" */
export async function findDepositByOrderId(orderId: string): Promise<Transaction | null> {
  // Prefer matching note; also support order_id == deposit-<txId>
  const byNote = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.status, "pending"),
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.note, `NOWPayments order ${orderId}`),
      ),
    )
    .limit(1);
  if (byNote[0]) return byNote[0];

  const m = /^deposit-(\d+)$/.exec(orderId);
  if (!m) return null;
  const txId = parseInt(m[1]!, 10);
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.id, txId),
        eq(transactionsTable.status, "pending"),
        eq(transactionsTable.type, "deposit"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createWithdrawalRequest(
  telegramId: string,
  chips: number,
  crypto: string,
  walletAddress: string,
): Promise<Transaction> {
  const user = await getUserByTgId(telegramId);
  if (!user) throw new Error("User not found");
  const rows = await db
    .insert(transactionsTable)
    .values({
      userId: user.id,
      type: "withdrawal",
      amount: chips.toFixed(2),
      crypto,
      walletAddress,
      status: "pending",
    })
    .returning();
  return rows[0]!;
}

export async function getPendingTransactions() {
  return db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.status, "pending"))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(50);
}

/** Pending deposits only */
export async function getPendingDeposits() {
  return db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "pending"),
      ),
    )
    .orderBy(desc(transactionsTable.createdAt))
    .limit(50);
}

/** Pending withdrawals only */
export async function getPendingWithdrawals() {
  return db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "withdrawal"),
        eq(transactionsTable.status, "pending"),
      ),
    )
    .orderBy(desc(transactionsTable.createdAt))
    .limit(50);
}

/** A user's withdrawal history (pending + recent) */
export async function getUserWithdrawals(telegramId: string, limit = 10) {
  const user = await getUserByTgId(telegramId);
  if (!user) return [];
  return db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, user.id),
        eq(transactionsTable.type, "withdrawal"),
      ),
    )
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit);
}

/** Count pending withdrawals for a user */
export async function countUserPendingWithdrawals(telegramId: string): Promise<number> {
  const user = await getUserByTgId(telegramId);
  if (!user) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, user.id),
        eq(transactionsTable.type, "withdrawal"),
        eq(transactionsTable.status, "pending"),
      ),
    );
  return Number(row?.count ?? 0);
}

/**
 * User cancels their own pending withdrawal — refunds chips once.
 */
export async function cancelUserWithdrawal(telegramId: string, txId: number): Promise<Transaction> {
  const user = await getUserByTgId(telegramId);
  if (!user) throw new Error("User not found");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.id, txId),
          eq(transactionsTable.userId, user.id),
          eq(transactionsTable.type, "withdrawal"),
          eq(transactionsTable.status, "pending"),
        ),
      )
      .limit(1);

    if (!rows[0]) throw new Error("Pending withdrawal not found");

    const updated = await tx
      .update(transactionsTable)
      .set({ status: "rejected", note: "Cancelled by user" })
      .where(
        and(
          eq(transactionsTable.id, txId),
          eq(transactionsTable.status, "pending"),
        ),
      )
      .returning();

    if (!updated[0]) throw new Error("Already processed");

    await tx
      .update(usersTable)
      .set({
        chips: sql`(${usersTable.chips}::numeric + ${updated[0].amount})`,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    return updated[0];
  });
}

/** Approved withdrawals from today */
export async function getApprovedWithdrawalsToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "withdrawal"),
        eq(transactionsTable.status, "approved"),
        gte(transactionsTable.createdAt, today),
      ),
    )
    .orderBy(desc(transactionsTable.createdAt))
    .limit(50);
}

export async function getTransactionById(txId: number): Promise<Transaction | null> {
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, txId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Approve a pending transaction.
 * - Deposits: credit chipsAmount to the user
 * - Withdrawals: chips were already deducted on request — only mark approved
 * Idempotent: refuses if status is no longer pending (blocks double-credit races).
 */
export async function approveTransaction(txId: number, chipsAmount: number): Promise<Transaction> {
  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.id, txId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) throw new Error("Transaction not found");
    if (existing.status !== "pending") throw new Error("Transaction already processed");

    const updated = await tx
      .update(transactionsTable)
      .set({ status: "approved", amount: chipsAmount.toFixed(2) })
      .where(
        and(
          eq(transactionsTable.id, txId),
          eq(transactionsTable.status, "pending"),
        ),
      )
      .returning();

    if (!updated[0]) throw new Error("Transaction already processed");

    // Only credit chips for deposits. Withdrawals already deducted on request.
    if (existing.type === "deposit" || existing.type === "admin_credit") {
      await tx
        .update(usersTable)
        .set({
          chips: sql`(${usersTable.chips}::numeric + ${chipsAmount.toFixed(2)})`,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existing.userId));
    }

    return updated[0];
  });
}

/**
 * Reject a pending transaction.
 * - Withdrawals: refund the locked chips (once)
 * Idempotent: refuses if already processed.
 */
export async function rejectTransaction(txId: number, note?: string): Promise<Transaction> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(transactionsTable)
      .set({ status: "rejected", note })
      .where(
        and(
          eq(transactionsTable.id, txId),
          eq(transactionsTable.status, "pending"),
        ),
      )
      .returning();

    if (!updated[0]) throw new Error("Transaction not found or already processed");

    if (updated[0].type === "withdrawal") {
      await tx
        .update(usersTable)
        .set({
          chips: sql`(${usersTable.chips}::numeric + ${updated[0].amount})`,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, updated[0].userId));
    }

    return updated[0];
  });
}

// ─── Deposit Address Helpers ──────────────────────────────────────────────────

export async function getDepositAddresses(): Promise<DepositAddress[]> {
  return db
    .select()
    .from(depositAddressesTable)
    .where(eq(depositAddressesTable.isActive, true));
}

export async function getAllDepositAddresses(): Promise<DepositAddress[]> {
  return db.select().from(depositAddressesTable);
}

export async function upsertDepositAddress(
  crypto: string,
  label: string,
  address: string,
  network: string,
  minDeposit: number,
  chipsPerUnit: number,
): Promise<void> {
  await db
    .insert(depositAddressesTable)
    .values({
      crypto,
      label,
      address,
      network,
      minDeposit: minDeposit.toString(),
      chipsPerUnit: chipsPerUnit.toFixed(2),
      isActive: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: depositAddressesTable.crypto,
      set: {
        label,
        address,
        network,
        minDeposit: minDeposit.toString(),
        chipsPerUnit: chipsPerUnit.toFixed(2),
        isActive: true,
        updatedAt: new Date(),
      },
    });
}

// ─── Admin Stats ──────────────────────────────────────────────────────────────

export async function getStats() {
  const [totalUsers] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable);
  const [totalChips] = await db
    .select({ sum: sql<string>`coalesce(sum(chips::numeric), 0)` })
    .from(usersTable);
  const [totalGames] = await db
    .select({ count: sql<number>`count(*)` })
    .from(gameSessionsTable);
  const [pendingTx] = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactionsTable)
    .where(eq(transactionsTable.status, "pending"));
  return {
    totalUsers: Number(totalUsers?.count ?? 0),
    totalChips: parseFloat(totalChips?.sum ?? "0"),
    totalGames: Number(totalGames?.count ?? 0),
    pendingTx: Number(pendingTx?.count ?? 0),
  };
}

export async function getAllUsers(limit = 20) {
  return db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit);
}

/** All telegram IDs for broadcast (capped). */
export async function getAllTelegramIds(limit = 500): Promise<string[]> {
  const rows = await db
    .select({ telegramId: usersTable.telegramId })
    .from(usersTable)
    .where(eq(usersTable.isBanned, false))
    .orderBy(desc(usersTable.createdAt))
    .limit(limit);
  return rows.map((r) => r.telegramId);
}

export async function getWagerReport() {
  const [row] = await db
    .select({
      games: sql<number>`count(*)`,
      wagered: sql<string>`coalesce(sum(bet_amount::numeric), 0)`,
      paid: sql<string>`coalesce(sum(payout::numeric), 0)`,
    })
    .from(gameSessionsTable);
  return {
    games: Number(row?.games ?? 0),
    wagered: parseFloat(row?.wagered ?? "0"),
    paid: parseFloat(row?.paid ?? "0"),
  };
}

export async function getTopWagers(limit = 10) {
  return db
    .select({
      userId: gameSessionsTable.userId,
      totalBet: sql<string>`coalesce(sum(bet_amount::numeric), 0)`,
      games: sql<number>`count(*)`,
    })
    .from(gameSessionsTable)
    .groupBy(gameSessionsTable.userId)
    .orderBy(sql`sum(bet_amount::numeric) desc`)
    .limit(limit);
}

export interface UserFinanceSummary {
  totalDeposited: number;
  totalWithdrawn: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  adminCredits: number;
  adminDebits: number;
  gamesPlayed: number;
  recentTx: Transaction[];
}

/** Full money + activity summary for admin user detail view */
export async function getUserFinanceSummary(telegramId: string): Promise<UserFinanceSummary | null> {
  const user = await getUserByTgId(telegramId);
  if (!user) return null;

  const txs = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, user.id))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(200);

  let totalDeposited = 0;
  let totalWithdrawn = 0;
  let pendingDeposits = 0;
  let pendingWithdrawals = 0;
  let adminCredits = 0;
  let adminDebits = 0;

  for (const t of txs) {
    const amt = parseFloat(t.amount);
    if (t.type === "deposit" && t.status === "approved") totalDeposited += amt;
    if (t.type === "deposit" && t.status === "pending") pendingDeposits += 1;
    if (t.type === "withdrawal" && t.status === "approved") totalWithdrawn += amt;
    if (t.type === "withdrawal" && t.status === "pending") pendingWithdrawals += 1;
    if (t.type === "admin_credit" && t.status === "approved") adminCredits += amt;
    if (t.type === "admin_debit" && t.status === "approved") adminDebits += amt;
  }

  const [gamesRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(gameSessionsTable)
    .where(eq(gameSessionsTable.userId, user.id));

  return {
    totalDeposited,
    totalWithdrawn,
    pendingDeposits,
    pendingWithdrawals,
    adminCredits,
    adminDebits,
    gamesPlayed: Number(gamesRow?.count ?? 0),
    recentTx: txs.slice(0, 8),
  };
}

// ─── PvP Helpers ─────────────────────────────────────────────────────────────

export async function createPvpChallenge(
  challengerTgId: string,
  game: string,
  betAmount: number,
  chatId: string,
) {
  const rows = await db
    .insert(pvpChallengesTable)
    .values({
      challengerTgId,
      game,
      betAmount: betAmount.toFixed(2),
      chatId,
      status: "pending",
    })
    .returning();
  return rows[0]!;
}

/** Atomically accept a pending challenge. Returns null if already taken/completed. */
export async function acceptPvpChallenge(challengeId: number, challengeeTgId: string, messageId: number) {
  const rows = await db
    .update(pvpChallengesTable)
    .set({ challengeeTgId, status: "accepted", messageId })
    .where(
      and(
        eq(pvpChallengesTable.id, challengeId),
        eq(pvpChallengesTable.status, "pending"),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Re-open a challenge if the acceptor failed to pay. */
export async function reopenPvpChallenge(challengeId: number) {
  const rows = await db
    .update(pvpChallengesTable)
    .set({ status: "pending", challengeeTgId: null, messageId: null })
    .where(
      and(
        eq(pvpChallengesTable.id, challengeId),
        eq(pvpChallengesTable.status, "accepted"),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function completePvpChallenge(challengeId: number, winnerId: string, gameData: string) {
  const rows = await db
    .update(pvpChallengesTable)
    .set({ winnerId, status: "completed", gameData })
    .where(eq(pvpChallengesTable.id, challengeId))
    .returning();
  return rows[0]!;
}

export async function getPvpChallenge(challengeId: number) {
  const rows = await db
    .select()
    .from(pvpChallengesTable)
    .where(eq(pvpChallengesTable.id, challengeId))
    .limit(1);
  return rows[0] ?? null;
}
