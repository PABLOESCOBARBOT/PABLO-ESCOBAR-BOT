import { Telegraf, session, type Context } from "telegraf";
import { logger } from "../lib/logger";
import {
  getUserByTgId,
  getUserById,
  findUserByTgOrUsername,
  resolveUserForAdmin,
  getStats,
  getAllUsers,
  getAllTelegramIds,
  getPendingDeposits,
  getPendingWithdrawals,
  getPendingTransactions,
  getWagerReport,
  getTopWagers,
  approveTransaction,
  rejectTransaction,
  addChips,
  deductChips,
  banUser,
  upsertDepositAddress,
  getAllDepositAddresses,
  getApprovedWithdrawalsToday,
  getTransactionById,
  getUserFinanceSummary,
} from "./db-helpers";
import {
  adminMenu,
  adminDepositMenu,
  adminWithdrawalMenu,
  adminBonusesMenu,
  adminGamesMenu,
  adminPaymentSettingsMenu,
  adminUsersMenu,
} from "./keyboards";
import { notifyCasinoUser } from "./bot-notify";

const CRYPTO_OPTIONS = [
  { key: "usdt_trc20", label: "USDT (TRC20)", network: "Tron (TRC20)" },
  { key: "usdt_erc20", label: "USDT (ERC20)", network: "Ethereum (ERC20)" },
  { key: "btc", label: "Bitcoin (BTC)", network: "Bitcoin" },
  { key: "eth", label: "Ethereum (ETH)", network: "Ethereum" },
  { key: "ton", label: "TON", network: "TON" },
  { key: "bnb", label: "BNB (BSC)", network: "BNB Smart Chain" },
  { key: "ltc", label: "Litecoin (LTC)", network: "Litecoin" },
];

interface AdminSession {
  step?: string;
  pendingUserId?: string;
  pendingChips?: number;
  pendingCrypto?: string;
  pendingTxId?: number;
  pendingAddr?: string;
}

type AdminCtx = Context & { session: AdminSession };

function parseAdminIds(): string[] {
  const raw = process.env["ADMIN_TELEGRAM_IDS"] ?? "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function isAdmin(tgId: string): boolean {
  return parseAdminIds().includes(tgId);
}

/** Escape Telegram legacy Markdown special chars (usernames often contain `_`). */
function escMd(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}

function displayUser(user: { username?: string | null; firstName?: string | null; telegramId: string }): string {
  if (user.username) return `@${escMd(user.username)}`;
  if (user.firstName) return escMd(user.firstName);
  return user.telegramId;
}

async function buildUserDetail(telegramId: string): Promise<{
  text: string;
  keyboard: Array<Array<{ text: string; callback_data: string }>>;
} | null> {
  const user = await getUserByTgId(telegramId);
  if (!user) return null;
  const fin = await getUserFinanceSummary(telegramId);
  const name = displayUser(user);

  let recent = "";
  if (fin?.recentTx.length) {
    recent = "\n📜 *Recent TX:*\n";
    for (const t of fin.recentTx.slice(0, 5)) {
      const emoji =
        t.status === "approved" ? "✅" : t.status === "pending" ? "⏳" : "❌";
      recent += `${emoji} #${t.id} ${escMd(t.type)} ${parseFloat(t.amount).toFixed(0)} (${t.status})\n`;
    }
  }

  const text =
    `👤 *User Details*\n\n` +
    `Name: ${name}\n` +
    `TG ID: \`${user.telegramId}\`\n` +
    `Balance: *${parseFloat(user.chips).toFixed(0)} USD*\n` +
    `Status: ${user.isBanned ? "🚫 Banned" : "✅ Active"}\n` +
    `Joined: ${user.createdAt.toLocaleDateString()}\n\n` +
    `📥 Total Deposited: *${(fin?.totalDeposited ?? 0).toFixed(0)}*\n` +
    `📤 Total Withdrawn: *${(fin?.totalWithdrawn ?? 0).toFixed(0)}*\n` +
    `⏳ Pending Deposits: ${fin?.pendingDeposits ?? 0}\n` +
    `⏳ Pending Withdrawals: ${fin?.pendingWithdrawals ?? 0}\n` +
    `🎁 Admin Credits: ${(fin?.adminCredits ?? 0).toFixed(0)}\n` +
    `➖ Admin Debits: ${(fin?.adminDebits ?? 0).toFixed(0)}\n` +
    `🎮 Games Played: ${fin?.gamesPlayed ?? 0}` +
    recent;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: "➕ Credit", callback_data: `admin_credit_${user.telegramId}` },
      { text: "➖ Debit", callback_data: `admin_debit_${user.telegramId}` },
    ],
    user.isBanned
      ? [{ text: "✅ Unban", callback_data: `admin_unban_${user.telegramId}` }]
      : [{ text: "🚫 Ban", callback_data: `admin_ban_confirm_${user.telegramId}` }],
    [
      { text: "🔄 Refresh", callback_data: `admin_user_${user.telegramId}` },
      { text: "🔙 Users", callback_data: "admin_users" },
    ],
  ];

  return { text, keyboard };
}

export function createAdminBot(token: string): Telegraf<AdminCtx> {
  const bot = new Telegraf<AdminCtx>(token);
  bot.use(session({ defaultSession: () => ({} as AdminSession) }));

  const casinoBotUsername = (process.env["CASINO_BOT_USERNAME"] ?? "").replace("@", "");

  // ── Auth middleware ───────────────────────────────────────────────────────
  bot.use(async (ctx, next) => {
    const id = String(ctx.from?.id ?? "");
    if (!isAdmin(id)) {
      if ("message" in ctx.update || "callback_query" in ctx.update) {
        await ctx.reply("⛔ Access denied. This bot is for admins only.");
      }
      return;
    }
    return next();
  });

  // ── /start ────────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    ctx.session.step = undefined;
    const pendingDep = await getPendingDeposits();
    const pendingWd = await getPendingWithdrawals();
    await ctx.reply(
      `👑 *Admin Panel*\n\n` +
        `Welcome back, Admin.\n` +
        `Pending deposits: *${pendingDep.length}* · withdrawals: *${pendingWd.length}*\n\n` +
        `Select an action:`,
      { parse_mode: "Markdown", reply_markup: adminMenu() },
    );
  });

  // ── /menu command ─────────────────────────────────────────────────────────
  bot.command("menu", async (ctx) => {
    ctx.session.step = undefined;
    await ctx.reply("👑 *Admin Panel*\n\nSelect an action:", {
      parse_mode: "Markdown",
      reply_markup: adminMenu(),
    });
  });

  // Shortcut commands (shown in Telegram Menu button)
  bot.command("deposits", async (ctx) => {
    ctx.session.step = undefined;
    const pending = await getPendingDeposits();
    await ctx.reply(
      `💰 *Deposit Management*\n\n⏳ Pending: *${pending.length}*`,
      { parse_mode: "Markdown", reply_markup: adminDepositMenu() },
    );
  });

  bot.command("withdrawals", async (ctx) => {
    ctx.session.step = undefined;
    const pending = await getPendingWithdrawals();
    await ctx.reply(
      `📤 *Withdrawal Management*\n\n⏳ Pending: *${pending.length}*`,
      { parse_mode: "Markdown", reply_markup: adminWithdrawalMenu() },
    );
  });

  bot.command("users", async (ctx) => {
    ctx.session.step = undefined;
    await ctx.reply(
      "👥 *User Management*\n\nView details, credit/debit, ban users.",
      { parse_mode: "Markdown", reply_markup: adminUsersMenu() },
    );
  });

  bot.command("stats", async (ctx) => {
    ctx.session.step = undefined;
    const stats = await getStats();
    await ctx.reply(
      `📊 *Casino Stats*\n\n` +
        `👥 Users: ${stats.totalUsers}\n` +
        `💰 USD: ${stats.totalChips.toFixed(0)}\n` +
        `🎮 Games: ${stats.totalGames}\n` +
        `⏳ Pending TX: ${stats.pendingTx}`,
      { parse_mode: "Markdown", reply_markup: adminMenu() },
    );
  });

  // ── Callback queries ──────────────────────────────────────────────────────
  bot.on("callback_query", async (ctx): Promise<void> => {
    const data = (ctx.callbackQuery as { data?: string }).data;
    if (!data) return;
    await ctx.answerCbQuery();

    const sess = ctx.session;

    // ─────────────────────────────────────────────────────────────────────
    // MAIN MENU SECTIONS
    // ─────────────────────────────────────────────────────────────────────

    if (data === "admin_back" || data === "admin_main") {
      sess.step = undefined;
      await ctx.editMessageText(
        "👑 *Admin Panel*\n\nSelect an action:",
        { parse_mode: "Markdown", reply_markup: adminMenu() },
      );
      return;
    }

    if (data === "admin_pending") {
      const deps = await getPendingDeposits();
      const wds = await getPendingWithdrawals();
      await ctx.editMessageText(
        `⌛ *Pending*\n\n` +
          `Deposits: *${deps.length}*\n` +
          `Withdrawals: *${wds.length}*\n\n` +
          `Open a section to approve:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💰 Pending Deposits", callback_data: "admin_pending_deposits" }],
              [{ text: "📤 Pending Withdrawals", callback_data: "admin_pending_withdrawals" }],
              [{ text: "🔙 Back", callback_data: "admin_back" }],
            ],
          },
        },
      );
      return;
    }

    if (data === "admin_transactions") {
      const pending = await getPendingTransactions();
      let msg = `📋 *Transactions*\n\nPending: *${pending.length}*\n\n`;
      for (const tx of pending.slice(0, 15)) {
        msg += `#${tx.id} ${tx.type} ${parseFloat(tx.amount).toFixed(0)} (${tx.status})\n`;
      }
      if (!pending.length) msg += `_No pending transactions._`;
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⌛ Pending", callback_data: "admin_pending" }],
            [{ text: "🔙 Back", callback_data: "admin_back" }],
          ],
        },
      });
      return;
    }

    if (data === "admin_wager_report") {
      const r = await getWagerReport();
      await ctx.editMessageText(
        `📈 *Wager Report*\n\n` +
          `Games: *${r.games}*\n` +
          `Total wagered: *${r.wagered.toFixed(0)}* USD\n` +
          `Total paid out: *${r.paid.toFixed(0)}* USD\n` +
          `House edge (approx): *${(r.wagered - r.paid).toFixed(0)}*`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back", callback_data: "admin_back" }]],
          },
        },
      );
      return;
    }

    if (data === "admin_top_wagers") {
      const top = await getTopWagers(10);
      let msg = `🏆 *Top Wagers*\n\n`;
      if (!top.length) msg += `_No games yet._`;
      let i = 1;
      for (const row of top) {
        const u = await getUserById(row.userId);
        const name = u?.username ? `@${u.username}` : u?.telegramId ?? `user ${row.userId}`;
        msg += `${i}. ${name} — *${parseFloat(row.totalBet).toFixed(0)}* (${row.games} games)\n`;
        i += 1;
      }
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back", callback_data: "admin_back" }]],
        },
      });
      return;
    }

    if (data === "admin_broadcast") {
      sess.step = "broadcast";
      await ctx.editMessageText(
        `📢 *Broadcast*\n\nSend the message you want to broadcast to all users.\n\nType /cancel to abort.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back", callback_data: "admin_back" }]],
          },
        },
      );
      return;
    }

    // ── 👥 USERS SECTION ───────────────────────────────────────────────────
    if (data === "admin_users") {
      await ctx.editMessageText(
        "👥 *User Management*\n\nView details, deposits, credit/debit USD, ban users.",
        { parse_mode: "Markdown", reply_markup: adminUsersMenu() },
      );
      return;
    }

    // ── 💰 DEPOSIT SECTION ─────────────────────────────────────────────────
    if (data === "admin_deposit") {
      const pending = await getPendingDeposits();
      await ctx.editMessageText(
        `💰 *Deposit Management*\n\n⏳ Pending: *${pending.length}* deposit(s)\n\nApprove deposits or manage crypto / NOWPayments.`,
        { parse_mode: "Markdown", reply_markup: adminDepositMenu() },
      );
      return;
    }

    // ── 📤 WITHDRAWAL SECTION ──────────────────────────────────────────────
    if (data === "admin_withdrawal") {
      const pending = await getPendingWithdrawals();
      await ctx.editMessageText(
        `📤 *Withdrawal Management*\n\n⏳ Pending: ${pending.length} withdrawal(s)`,
        { parse_mode: "Markdown", reply_markup: adminWithdrawalMenu() },
      );
      return;
    }

    // ── 🎁 BONUSES SECTION ─────────────────────────────────────────────────
    if (data === "admin_bonuses") {
      await ctx.editMessageText(
        "🎁 *Bonus Management*\n\nGive USD bonuses to players or view bonus history.",
        { parse_mode: "Markdown", reply_markup: adminBonusesMenu() },
      );
      return;
    }

    // ── 🎮 GAMES SECTION ───────────────────────────────────────────────────
    if (data === "admin_games") {
      const stats = await getStats();
      await ctx.editMessageText(
        `🎮 *Games & Casino*\n\n` +
        `👥 Total Users: ${stats.totalUsers}\n` +
        `🎮 Total Games Played: ${stats.totalGames}\n` +
        `💰 USD in Circulation: ${stats.totalChips.toFixed(0)}\n\n` +
        `Use the casino bot to manage games.`,
        { parse_mode: "Markdown", reply_markup: adminGamesMenu(casinoBotUsername) },
      );
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // DEPOSIT SUB-ACTIONS
    // ─────────────────────────────────────────────────────────────────────

    if (data === "admin_pending_deposits") {
      const txns = await getPendingDeposits();
      if (txns.length === 0) {
        await ctx.editMessageText("✅ No pending deposits!", {
          reply_markup: adminDepositMenu(),
        });
        return;
      }
      let msg = `💰 *Pending Deposits (${txns.length})*\n\n`;
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
      for (const tx of txns.slice(0, 10)) {
        const user = await getUserById(tx.userId);
        const uname = user?.username ? `@${user.username}` : user?.telegramId ?? "?";
        msg += `#${tx.id} — ${tx.crypto?.toUpperCase() ?? "N/A"}`;
        if (tx.cryptoAmount) msg += ` — ${tx.cryptoAmount}`;
        msg += `\n  User: ${uname}`;
        if (tx.txHash) msg += `\n  Hash: \`${tx.txHash.slice(0, 24)}...\``;
        if (tx.walletAddress) msg += `\n  Addr: \`${tx.walletAddress.slice(0, 28)}...\``;
        msg += "\n\n";
        if (user) {
          keyboard.push([{ text: `👤 ${uname}`, callback_data: `admin_user_${user.telegramId}` }]);
        }
        keyboard.push([
          { text: `✅ Approve #${tx.id}`, callback_data: `admin_approve_${tx.id}` },
          { text: `❌ Reject #${tx.id}`, callback_data: `admin_reject_${tx.id}` },
        ]);
      }
      keyboard.push([{ text: "🔙 Back", callback_data: "admin_deposit" }]);
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      return;
    }

    if (data === "admin_payment_settings") {
      await ctx.editMessageText(
        `💳 *Payment Settings*\n\n` +
        `📋 *Static Addresses (Manual)*\n` +
        `Set your own wallet address per crypto. Users send funds to your address and submit the TX hash. You approve manually.\n\n` +
        `🤖 *NOWPayments Gateway (Auto)*\n` +
        `Deposits: blockchain confirm → USD auto-credit.\n` +
        `Withdrawals: optional auto LTC payout (email/password JWT).\n\n` +
        `To set up NOWPayments:\n` +
        `1. https://account.nowpayments.io\n` +
        `2. API key → \`NOWPAYMENTS_API_KEY\`\n` +
        `3. IPN secret → \`NOWPAYMENTS_IPN_SECRET\`\n` +
        `4. Public URL → \`PUBLIC_BASE_URL\`\n` +
        `5. (Payouts) \`NOWPAYMENTS_EMAIL\` + \`NOWPAYMENTS_PASSWORD\``,
        {
          parse_mode: "Markdown",
          reply_markup: adminPaymentSettingsMenu(),
        },
      );
      return;
    }

    if (data === "admin_nowpayments_info" || data === "admin_cryptopay_info") {
      const apiKey = process.env["NOWPAYMENTS_API_KEY"];
      const ipn = process.env["NOWPAYMENTS_IPN_SECRET"];
      const pub = process.env["PUBLIC_BASE_URL"] || process.env["NOWPAYMENTS_IPN_URL"];
      const email = process.env["NOWPAYMENTS_EMAIL"];
      const status = apiKey ? "✅ API key set" : "❌ Not configured";
      const ipnStatus = ipn ? "✅ IPN secret set" : "⚠️ Missing IPN secret";
      const pubStatus = pub ? "✅ Public/IPN URL set" : "⚠️ Missing PUBLIC_BASE_URL";
      const payoutStatus = email ? "✅ Payout login set" : "⚠️ Payouts manual (no email/password)";
      await ctx.editMessageText(
        `🤖 *NOWPayments Gateway*\n\n` +
        `API: ${status}\n` +
        `IPN: ${ipnStatus}\n` +
        `URL: ${pubStatus}\n` +
        `Payouts: ${payoutStatus}\n\n` +
        `*How to set up:*\n` +
        `1. Create account at nowpayments.io\n` +
        `2. Settings → API keys → \`NOWPAYMENTS_API_KEY\`\n` +
        `3. Settings → IPN Secret → \`NOWPAYMENTS_IPN_SECRET\`\n` +
        `4. Railway public URL → \`PUBLIC_BASE_URL\`\n` +
        `   IPN path: \`/api/nowpayments/ipn\`\n` +
        `5. For auto withdrawals: \`NOWPAYMENTS_EMAIL\` + \`NOWPAYMENTS_PASSWORD\`\n\n` +
        `Supported: USDT (TRC20/ERC20), BTC, ETH, TON, BNB, LTC\n\n` +
        `Deposits auto-credit USD after blockchain confirm 🔔`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔙 Back", callback_data: "admin_payment_settings" }],
            ],
          },
        },
      );
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // WITHDRAWAL SUB-ACTIONS
    // ─────────────────────────────────────────────────────────────────────

    if (data === "admin_pending_withdrawals") {
      const txns = await getPendingWithdrawals();
      if (txns.length === 0) {
        await ctx.editMessageText("✅ No pending withdrawals!", {
          reply_markup: adminWithdrawalMenu(),
        });
        return;
      }
      let msg = `📤 *Pending Withdrawals (${txns.length})*\n\nSend crypto, then tap *Paid*. Reject refunds USD.\n\n`;
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
      for (const tx of txns.slice(0, 10)) {
        const user = await getUserById(tx.userId);
        const uname = user?.username ? `@${user.username}` : user?.telegramId ?? "?";
        msg += `#${tx.id} — *${parseFloat(tx.amount).toFixed(0)} USD*\n`;
        msg += `  User: ${uname}\n`;
        msg += `  Crypto: ${tx.crypto?.toUpperCase() ?? "N/A"}\n`;
        if (tx.walletAddress) msg += `  To: \`${tx.walletAddress}\`\n`;
        msg += "\n";
        if (user) {
          keyboard.push([{ text: `👤 ${uname}`, callback_data: `admin_user_${user.telegramId}` }]);
        }
        keyboard.push([
          { text: `✅ Paid #${tx.id}`, callback_data: `admin_approve_${tx.id}` },
          { text: `❌ Reject #${tx.id}`, callback_data: `admin_reject_${tx.id}` },
        ]);
      }
      keyboard.push([{ text: "🔙 Back", callback_data: "admin_withdrawal" }]);
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      return;
    }

    if (data === "admin_approved_withdrawals") {
      const txns = await getApprovedWithdrawalsToday();
      if (txns.length === 0) {
        await ctx.editMessageText("📭 No approved withdrawals today yet.", {
          reply_markup: adminWithdrawalMenu(),
        });
        return;
      }
      let msg = `✅ *Approved Withdrawals Today (${txns.length})*\n\n`;
      for (const tx of txns.slice(0, 15)) {
        msg += `#${tx.id} — ${parseFloat(tx.amount).toFixed(0)} USD — ${tx.crypto?.toUpperCase() ?? "N/A"}\n`;
      }
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back", callback_data: "admin_withdrawal" }]],
        },
      });
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // APPROVE / REJECT TRANSACTIONS
    // ─────────────────────────────────────────────────────────────────────

    if (data.startsWith("admin_approve_")) {
      const txId = parseInt(data.replace("admin_approve_", ""), 10);
      const existing = await getTransactionById(txId);
      if (!existing) {
        await ctx.editMessageText(`❌ TX #${txId} not found.`, { reply_markup: adminMenu() });
        return;
      }
      if (existing.status !== "pending") {
        await ctx.editMessageText(`❌ TX #${txId} already ${existing.status}.`, { reply_markup: adminMenu() });
        return;
      }

      // Withdrawals already deducted USD on request — just mark done
      if (existing.type === "withdrawal") {
        try {
          await approveTransaction(txId, parseFloat(existing.amount));
          const user = await getUserById(existing.userId);
          if (user) {
            await notifyCasinoUser(
              user.telegramId,
              `✅ *Withdrawal Paid!*\n\n` +
                `Request #${txId}\n` +
                `Amount: *${parseFloat(existing.amount).toFixed(0)} USD ($${parseFloat(existing.amount).toFixed(0)})*\n` +
                `Crypto: ${existing.crypto?.toUpperCase() ?? "N/A"}\n` +
                `Address: \`${existing.walletAddress ?? ""}\`\n\n` +
                `Your winnings have been sent. 💸🙏`,
            );
          }
          await ctx.editMessageText(
            `✅ Withdrawal #${txId} marked done.\n${parseFloat(existing.amount).toFixed(0)} USD (already deducted).\nUser notified.`,
            { reply_markup: adminWithdrawalMenu() },
          );
        } catch (e) {
          await ctx.editMessageText(`❌ Error: ${String(e)}`, { reply_markup: adminMenu() });
        }
        return;
      }

      // Deposits: ask admin how many USD to credit
      sess.pendingTxId = txId;
      sess.step = "approve_chips";
      const depUser = await getUserById(existing.userId);
      await ctx.editMessageText(
        `✅ Approving deposit #${txId}\n` +
          `User: ${depUser?.username ? `@${depUser.username}` : depUser?.telegramId ?? "?"}\n` +
          `Crypto: ${existing.crypto?.toUpperCase() ?? "N/A"} ${existing.cryptoAmount ?? ""}\n` +
          `Hash: \`${(existing.txHash ?? "").slice(0, 24)}...\`\n\n` +
          `How many USD to add? (enter number):`,
        { parse_mode: "Markdown", reply_markup: undefined },
      );
      return;
    }

    if (data.startsWith("admin_reject_")) {
      const txId = parseInt(data.replace("admin_reject_", ""), 10);
      try {
        const before = await getTransactionById(txId);
        await rejectTransaction(txId, "Admin rejected");
        if (before) {
          const user = await getUserById(before.userId);
          if (user) {
            if (before.type === "withdrawal") {
              await notifyCasinoUser(
                user.telegramId,
                `❌ *Withdrawal Rejected*\n\n#${txId} — ${parseFloat(before.amount).toFixed(0)} USD\nUSD has been refunded to your balance.`,
              );
            } else if (before.type === "deposit") {
              await notifyCasinoUser(
                user.telegramId,
                `❌ *Deposit Rejected*\n\n#${txId} was rejected by admin.\nContact support if you think this is a mistake.`,
              );
            }
          }
        }
        await ctx.editMessageText(`❌ TX #${txId} rejected. User notified.`, {
          reply_markup: adminMenu(),
        });
      } catch (e) {
        await ctx.editMessageText(`❌ Error: ${String(e)}`, {
          reply_markup: adminMenu(),
        });
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // CRYPTO ADDRESSES
    // ─────────────────────────────────────────────────────────────────────

    if (data === "admin_addresses") {
      const addrs = await getAllDepositAddresses();
      let msg = "💱 *Crypto Deposit Addresses*\n\n";
      for (const a of addrs) {
        msg += `${a.isActive ? "✅" : "❌"} *${a.label}*\n\`${a.address}\`\nRate: ${a.chipsPerUnit} USD/unit\n\n`;
      }
      if (addrs.length === 0) msg += "No addresses configured yet.\n\nSet your wallet addresses for each crypto:";
      const keyboard = CRYPTO_OPTIONS.map(c => ([{
        text: `${addrs.find(a => a.crypto === c.key) ? "✏️" : "➕"} ${c.label}`,
        callback_data: `admin_set_addr_${c.key}`,
      }]));
      keyboard.push([{ text: "🔙 Back", callback_data: "admin_deposit" }]);
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      return;
    }

    if (data.startsWith("admin_set_addr_")) {
      const crypto = data.replace("admin_set_addr_", "");
      const opt = CRYPTO_OPTIONS.find(c => c.key === crypto);
      sess.step = "set_addr_address";
      sess.pendingCrypto = crypto;
      await ctx.editMessageText(
        `💱 *Set ${opt?.label ?? crypto} Address*\n\nEnter your wallet address for receiving ${opt?.label}:`,
        { parse_mode: "Markdown", reply_markup: undefined },
      );
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHIPS MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────

    if (data === "admin_add_chips") {
      sess.step = "add_chips_user";
      await ctx.editMessageText(
        "➕ *Add / Give USD*\n\n" +
          "Enter the user's *numeric Telegram ID* (best).\n" +
          "Or @username if they already used the casino bot.\n\n" +
          "_Tip: get ID from @userinfobot_",
        { parse_mode: "Markdown", reply_markup: undefined },
      );
      return;
    }

    if (data === "admin_remove_chips") {
      sess.step = "remove_chips_user";
      await ctx.editMessageText(
        "➖ *Remove USD*\n\nEnter the user's Telegram ID:",
        { parse_mode: "Markdown", reply_markup: undefined },
      );
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // USER MANAGEMENT (from games section)
    // ─────────────────────────────────────────────────────────────────────

    if (data === "admin_stats") {
      const stats = await getStats();
      await ctx.editMessageText(
        `📊 *Stats*\n\n` +
        `👥 Users: *${stats.totalUsers}*\n` +
        `💰 USD: *${stats.totalChips.toFixed(0)}*\n` +
        `🎮 Games: *${stats.totalGames}*\n` +
        `⏳ Pending TX: *${stats.pendingTx}*`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back", callback_data: "admin_back" }]],
          },
        },
      );
      return;
    }

    if (data === "admin_users_list" || data === "admin_users_from_games") {
      const users = await getAllUsers(12);
      let msg = `👥 *Recent Users (${users.length})*\n\nTap a user for full details:\n\n`;
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
      for (const u of users) {
        const name = u.username ? `@${u.username}` : u.firstName ?? u.telegramId;
        const safeName = displayUser(u);
        const fin = await getUserFinanceSummary(u.telegramId);
        msg += `${u.isBanned ? "🚫" : "✅"} ${safeName} — bal ${parseFloat(u.chips).toFixed(0)} | dep ${(fin?.totalDeposited ?? 0).toFixed(0)}\n`;
        keyboard.push([
          {
            text: `${u.isBanned ? "🚫" : "👤"} ${name} (${parseFloat(u.chips).toFixed(0)})`.slice(0, 64),
            callback_data: `admin_user_${u.telegramId}`,
          },
        ]);
      }
      keyboard.push([
        { text: "🔍 Find User", callback_data: "admin_find_user" },
        { text: "🔙 Back", callback_data: "admin_users" },
      ]);
      try {
        await ctx.editMessageText(msg, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: keyboard },
        });
      } catch {
        await ctx.editMessageText(
          `👥 Recent Users (${users.length})\n\nTap a user below:`,
          { reply_markup: { inline_keyboard: keyboard } },
        );
      }
      return;
    }

    if (data.startsWith("admin_user_")) {
      const uid = data.replace("admin_user_", "");
      const detail = await buildUserDetail(uid);
      if (!detail) {
        await ctx.editMessageText("❌ User not found.", { reply_markup: adminUsersMenu() });
        return;
      }
      try {
        await ctx.editMessageText(detail.text, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: detail.keyboard },
        });
      } catch (e) {
        logger.warn({ e, uid }, "admin_user detail markdown failed");
        await ctx.editMessageText(
          `User ${uid}\nBalance: see buttons below.`,
          { reply_markup: { inline_keyboard: detail.keyboard } },
        );
      }
      return;
    }

    if (data.startsWith("admin_credit_")) {
      const uid = data.replace("admin_credit_", "");
      sess.pendingUserId = uid;
      sess.step = "add_chips_amount";
      const user = await getUserByTgId(uid);
      const label = user ? displayUser(user) : uid;
      const bal = user ? parseFloat(user.chips).toFixed(0) : "?";
      try {
        await ctx.editMessageText(
          `➕ *Credit USD*\n\nUser: ${label}\nTG ID: \`${uid}\`\nBalance: ${bal} USD\n\nHow many USD to *add*?`,
          { parse_mode: "Markdown", reply_markup: undefined },
        );
      } catch (e) {
        // Fallback without Markdown if username still breaks parsing
        await ctx.editMessageText(
          `➕ Credit USD\n\nUser: ${user?.username ? `@${user.username}` : uid}\nTG ID: ${uid}\nBalance: ${bal} USD\n\nHow many USD to add?`,
          { reply_markup: undefined },
        );
        logger.warn({ e, uid }, "admin_credit editMessageText markdown failed — used plain text");
      }
      return;
    }

    if (data.startsWith("admin_debit_")) {
      const uid = data.replace("admin_debit_", "");
      sess.pendingUserId = uid;
      sess.step = "remove_chips_amount";
      const user = await getUserByTgId(uid);
      const label = user ? displayUser(user) : uid;
      const bal = user ? parseFloat(user.chips).toFixed(0) : "?";
      try {
        await ctx.editMessageText(
          `➖ *Debit USD*\n\nUser: ${label}\nTG ID: \`${uid}\`\nBalance: ${bal} USD\n\nHow many USD to *remove*?`,
          { parse_mode: "Markdown", reply_markup: undefined },
        );
      } catch {
        await ctx.editMessageText(
          `➖ Debit USD\n\nUser: ${user?.username ? `@${user.username}` : uid}\nTG ID: ${uid}\nBalance: ${bal} USD\n\nHow many USD to remove?`,
          { reply_markup: undefined },
        );
      }
      return;
    }

    if (data === "admin_find_user") {
      sess.step = "find_user";
      await ctx.editMessageText(
        "🔍 Enter the Telegram ID of the user to look up:",
        { reply_markup: undefined },
      );
      return;
    }

    if (data === "admin_ban_user") {
      sess.step = "ban_user";
      await ctx.editMessageText(
        "🚫 Enter the Telegram ID of the user to ban:",
        { reply_markup: undefined },
      );
      return;
    }

    if (data.startsWith("admin_unban_")) {
      const uid = data.replace("admin_unban_", "");
      await banUser(uid, false);
      await ctx.editMessageText(`✅ User ${uid} unbanned.`, {
        reply_markup: adminMenu(),
      });
      return;
    }

    if (data.startsWith("admin_ban_confirm_")) {
      const uid = data.replace("admin_ban_confirm_", "");
      await banUser(uid, true);
      await ctx.editMessageText(`🚫 User ${uid} banned.`, {
        reply_markup: adminMenu(),
      });
      return;
    }

    if (data === "admin_bonus_history") {
      await ctx.editMessageText(
        "🎁 *Bonus History*\n\nBonus tracking coming soon!\n\nFor now, use the Add USD option to give bonuses to users.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Give Bonus Now", callback_data: "admin_add_chips" }],
              [{ text: "🔙 Back", callback_data: "admin_bonuses" }],
            ],
          },
        },
      );
      return;
    }
  });

  // ── Text messages for multi-step flows ────────────────────────────────────
  bot.on("message", async (ctx): Promise<void> => {
    if (!("text" in ctx.message)) return;
    const text = ctx.message.text.trim();
    const sess = ctx.session;

    if (text === "/cancel") {
      sess.step = undefined;
      await ctx.reply("Cancelled.", { reply_markup: adminMenu() });
      return;
    }

    // ── Broadcast to all users ──────────────────────────────────────────────
    if (sess.step === "broadcast") {
      sess.step = undefined;
      const ids = await getAllTelegramIds(500);
      let ok = 0;
      let fail = 0;
      await ctx.reply(`📢 Sending to ${ids.length} users…`);
      for (const id of ids) {
        try {
          await notifyCasinoUser(id, text);
          ok += 1;
          // gentle rate limit
          await new Promise((r) => setTimeout(r, 40));
        } catch {
          fail += 1;
        }
      }
      await ctx.reply(
        `📢 Broadcast done.\n✅ Sent: *${ok}*\n❌ Failed: *${fail}*`,
        { parse_mode: "Markdown", reply_markup: adminMenu() },
      );
      return;
    }

    // ── Approve TX: USD amount ────────────────────────────────────────────
    if (sess.step === "approve_chips" && sess.pendingTxId) {
      const chips = parseFloat(text);
      if (isNaN(chips) || chips <= 0) {
        await ctx.reply("❌ Please enter a valid number.");
        return;
      }
      try {
        const tx = await approveTransaction(sess.pendingTxId, chips);
        sess.step = undefined;
        delete sess.pendingTxId;
        const user = await getUserById(tx.userId);
        if (user && (tx.type === "deposit" || tx.type === "admin_credit")) {
          await notifyCasinoUser(
            user.telegramId,
            `✅ *Deposit Approved!*\n\n#${tx.id}\n🎰 *${chips} USD* credited to your balance.\n\nHappy playing! 🎲`,
          );
        }
        await ctx.reply(
          `✅ TX #${tx.id} approved!\n${chips} USD added.\nUser notified.`,
          { reply_markup: adminMenu() },
        );
      } catch (e) {
        await ctx.reply(`❌ Error: ${String(e)}`);
      }
      return;
    }

    // ── Add chips: user ID or @username ─────────────────────────────────────
    if (sess.step === "add_chips_user") {
      const resolved = await resolveUserForAdmin(text);
      if (!resolved.user) {
        await ctx.reply(`❌ ${resolved.hint}`);
        return;
      }
      const user = resolved.user;
      sess.pendingUserId = user.telegramId;
      sess.step = "add_chips_amount";
      const createdNote = resolved.created
        ? "\n🆕 New account created (they hadn't /start'd yet).\n"
        : "\n";
      await ctx.reply(
        `✅ User: ${user.username ? `@${user.username}` : user.firstName ?? "—"}\n` +
          `TG ID: ${user.telegramId}\n` +
          `Balance: ${parseFloat(user.chips).toFixed(0)} USD` +
          createdNote +
          `\nHow many USD to add?`,
      );
      return;
    }

    if (sess.step === "add_chips_amount" && sess.pendingUserId) {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Please enter a valid number.");
        return;
      }
      const creditedId = sess.pendingUserId;
      try {
        const newBal = await addChips(
          creditedId,
          amount,
          "admin_credit",
          `Admin added ${amount} USD`,
        );
        sess.step = undefined;
        delete sess.pendingUserId;
        await notifyCasinoUser(
          creditedId,
          `🎁 *USD Credited!*\n\nAdmin added *$${amount.toFixed(2)}* to your balance.\nNew balance: *$${newBal.toFixed(2)}*`,
        );
        const detail = await buildUserDetail(creditedId);
        await ctx.reply(
          `✅ $${amount.toFixed(2)} USD credited to ${creditedId}.\nNew balance: $${newBal.toFixed(2)}\nUser notified.`,
          {
            reply_markup: detail
              ? { inline_keyboard: detail.keyboard }
              : adminUsersMenu(),
          },
        );
      } catch (e) {
        logger.error({ e, creditedId, amount }, "admin credit failed");
        await ctx.reply(`❌ Credit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    // ── Remove chips: user ID or @username ──────────────────────────────────
    if (sess.step === "remove_chips_user") {
      const resolved = await resolveUserForAdmin(text);
      if (!resolved.user) {
        await ctx.reply(`❌ ${resolved.hint}`);
        return;
      }
      const user = resolved.user;
      if (resolved.created || parseFloat(user.chips) <= 0) {
        await ctx.reply(
          `User ${user.telegramId} has balance $${parseFloat(user.chips).toFixed(2)}. Nothing to remove.`,
        );
        sess.step = undefined;
        return;
      }
      sess.pendingUserId = user.telegramId;
      sess.step = "remove_chips_amount";
      await ctx.reply(
        `✅ User: ${user.username ? `@${user.username}` : user.firstName ?? "—"}\n` +
          `TG ID: ${user.telegramId}\n` +
          `Balance: ${parseFloat(user.chips).toFixed(0)} USD\n\nHow many USD to remove?`,
      );
      return;
    }

    if (sess.step === "remove_chips_amount" && sess.pendingUserId) {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Please enter a valid number.");
        return;
      }
      try {
        await deductChips(sess.pendingUserId, amount, "admin_debit", `Admin removed ${amount} USD`);
      } catch (e) {
        await ctx.reply(`❌ ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      const debitedId = sess.pendingUserId;
      sess.step = undefined;
      delete sess.pendingUserId;
      await notifyCasinoUser(
        debitedId,
        `⚠️ *USD Debited*\n\nAdmin removed *${amount} USD* from your balance.`,
      );
      const detail = await buildUserDetail(debitedId);
      await ctx.reply(`✅ ${amount} USD debited. User notified.`, {
        parse_mode: "Markdown",
        reply_markup: detail
          ? { inline_keyboard: detail.keyboard }
          : adminUsersMenu(),
      });
      return;
    }

    // ── Find user ───────────────────────────────────────────────────────────
    if (sess.step === "find_user") {
      sess.step = undefined;
      const found = await findUserByTgOrUsername(text);
      if (!found) {
        await ctx.reply("❌ User not found. Use numeric Telegram ID or @username.");
        return;
      }
      const detail = await buildUserDetail(found.telegramId);
      if (!detail) {
        await ctx.reply("❌ User not found.");
        return;
      }
      try {
        await ctx.reply(detail.text, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: detail.keyboard },
        });
      } catch {
        await ctx.reply(`User ${found.telegramId}`, {
          reply_markup: { inline_keyboard: detail.keyboard },
        });
      }
      return;
    }

    // ── Ban user ────────────────────────────────────────────────────────────
    if (sess.step === "ban_user") {
      sess.step = undefined;
      const user = await findUserByTgOrUsername(text);
      if (!user) {
        await ctx.reply("❌ User not found. Use numeric Telegram ID or @username.");
        return;
      }
      await ctx.reply(
        `User: ${user.username ? `@${user.username}` : user.firstName} (${user.telegramId})\nAre you sure you want to ban this user?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚫 Yes, Ban", callback_data: `admin_ban_confirm_${user.telegramId}` }],
              [{ text: "❌ Cancel", callback_data: "admin_games" }],
            ],
          },
        },
      );
      return;
    }

    // ── Set address ─────────────────────────────────────────────────────────
    if (sess.step === "set_addr_address" && sess.pendingCrypto) {
      sess.pendingAddr = text;
      sess.step = "set_addr_rate";
      await ctx.reply(
        `✅ Address: \`${text}\`\n\n1 ${sess.pendingCrypto.toUpperCase()} = how many USD? (e.g.: 100)\n\nFor USDT: enter 1 (1 USDT = 1 USD)`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (sess.step === "set_addr_rate" && sess.pendingCrypto) {
      const rate = parseFloat(text);
      if (isNaN(rate) || rate <= 0) {
        await ctx.reply("❌ Please enter a valid rate.");
        return;
      }
      const crypto = sess.pendingCrypto;
      const address = sess.pendingAddr ?? "";
      const opt = CRYPTO_OPTIONS.find(c => c.key === crypto);
      sess.step = undefined;
      delete sess.pendingCrypto;
      delete sess.pendingAddr;
      await upsertDepositAddress(crypto, opt?.label ?? crypto, address, opt?.network ?? crypto, 1, rate);
      await ctx.reply(
        `✅ *${opt?.label} address saved!*\nAddress: \`${address}\`\nRate: ${rate} USD/unit`,
        { parse_mode: "Markdown", reply_markup: adminMenu() },
      );
      return;
    }
  });

  logger.info("Admin bot created");
  return bot;
}
