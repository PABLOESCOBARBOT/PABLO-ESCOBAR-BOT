import { Telegraf, session, type Context } from "telegraf";
import { logger } from "../lib/logger";
import {
  getUserByTgId,
  getStats,
  getAllUsers,
  getPendingTransactions,
  getPendingDeposits,
  getPendingWithdrawals,
  approveTransaction,
  rejectTransaction,
  addChips,
  deductChips,
  banUser,
  upsertDepositAddress,
  getAllDepositAddresses,
  getApprovedWithdrawalsToday,
  getTransactionById,
} from "./db-helpers";
import {
  adminMenu,
  adminDepositMenu,
  adminWithdrawalMenu,
  adminBonusesMenu,
  adminGamesMenu,
  adminPaymentSettingsMenu,
} from "./keyboards";

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
    await ctx.reply(
      `🛠 *Casino Admin Panel*\n\nWelcome, ${ctx.from!.first_name}!\n\nChoose a section to manage:`,
      { parse_mode: "Markdown", reply_markup: adminMenu() },
    );
  });

  // ── /menu command ─────────────────────────────────────────────────────────
  bot.command("menu", async (ctx) => {
    ctx.session.step = undefined;
    await ctx.reply("🛠 *Admin Panel*", {
      parse_mode: "Markdown",
      reply_markup: adminMenu(),
    });
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
        "🛠 *Admin Panel*\n\nChoose a section to manage:",
        { parse_mode: "Markdown", reply_markup: adminMenu() },
      );
      return;
    }

    // ── 💰 DEPOSIT SECTION ─────────────────────────────────────────────────
    if (data === "admin_deposit") {
      await ctx.editMessageText(
        "💰 *Deposit Management*\n\nManage player deposits and crypto addresses.",
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
        "🎁 *Bonus Management*\n\nGive chips bonuses to players or view bonus history.",
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
        `💰 Chips in Circulation: ${stats.totalChips.toFixed(0)}\n\n` +
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
        msg += `#${tx.id} — ${tx.crypto?.toUpperCase() ?? "N/A"}`;
        if (tx.cryptoAmount) msg += ` — ${tx.cryptoAmount}`;
        if (tx.txHash) msg += `\n  Hash: \`${tx.txHash.slice(0, 20)}...\``;
        if (tx.walletAddress) msg += `\n  Addr: \`${tx.walletAddress.slice(0, 20)}...\``;
        msg += "\n\n";
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
        `Each user gets a unique invoice URL. Payments are detected via IPN/polling and chips are credited automatically.\n\n` +
        `To set up NOWPayments:\n` +
        `1. https://account.nowpayments.io\n` +
        `2. Copy API key → \`NOWPAYMENTS_API_KEY\`\n` +
        `3. Copy IPN secret → \`NOWPAYMENTS_IPN_SECRET\`\n` +
        `4. Set \`PUBLIC_BASE_URL\` to your HTTPS domain`,
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
      const status = apiKey ? "✅ API key set" : "❌ Not configured";
      const ipnStatus = ipn ? "✅ IPN secret set" : "⚠️ Missing IPN secret";
      await ctx.editMessageText(
        `🤖 *NOWPayments Gateway*\n\n` +
        `API: ${status}\n` +
        `IPN: ${ipnStatus}\n\n` +
        `*How to set up:*\n` +
        `1. Create account at nowpayments.io\n` +
        `2. Settings → API keys → \`NOWPAYMENTS_API_KEY\`\n` +
        `3. Settings → IPN Secret → \`NOWPAYMENTS_IPN_SECRET\`\n` +
        `4. Set public URL: \`PUBLIC_BASE_URL=https://your-domain\`\n` +
        `   IPN path: \`/api/nowpayments/ipn\`\n\n` +
        `Supported: USDT (TRC20/ERC20), BTC, ETH, TON, BNB, LTC\n\n` +
        `Users get auto chip credit + Telegram notify when paid! 🔔`,
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
      let msg = `📤 *Pending Withdrawals (${txns.length})*\n\n`;
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
      for (const tx of txns.slice(0, 10)) {
        msg += `#${tx.id} — ${parseFloat(tx.amount).toFixed(0)} Chips\n`;
        msg += `  Crypto: ${tx.crypto?.toUpperCase() ?? "N/A"}\n`;
        if (tx.walletAddress) msg += `  To: \`${tx.walletAddress.slice(0, 20)}...\`\n`;
        msg += "\n";
        keyboard.push([
          { text: `✅ Done #${tx.id}`, callback_data: `admin_approve_${tx.id}` },
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
        msg += `#${tx.id} — ${parseFloat(tx.amount).toFixed(0)} Chips — ${tx.crypto?.toUpperCase() ?? "N/A"}\n`;
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

      // Withdrawals already deducted chips on request — just mark done
      if (existing.type === "withdrawal") {
        try {
          await approveTransaction(txId, parseFloat(existing.amount));
          await ctx.editMessageText(
            `✅ Withdrawal #${txId} marked done.\n${parseFloat(existing.amount).toFixed(0)} chips were already deducted from the user.`,
            { reply_markup: adminMenu() },
          );
        } catch (e) {
          await ctx.editMessageText(`❌ Error: ${String(e)}`, { reply_markup: adminMenu() });
        }
        return;
      }

      // Deposits: ask admin how many chips to credit
      sess.pendingTxId = txId;
      sess.step = "approve_chips";
      await ctx.editMessageText(
        `✅ Approving deposit #${txId}\n\nHow many chips to add? (enter number):`,
        { reply_markup: undefined },
      );
      return;
    }

    if (data.startsWith("admin_reject_")) {
      const txId = parseInt(data.replace("admin_reject_", ""), 10);
      try {
        await rejectTransaction(txId, "Admin ne reject kiya");
        await ctx.editMessageText(`❌ TX #${txId} rejected.`, {
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
        msg += `${a.isActive ? "✅" : "❌"} *${a.label}*\n\`${a.address}\`\nRate: ${a.chipsPerUnit} chips/unit\n\n`;
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
        "➕ *Add / Give Chips*\n\nEnter the user's Telegram ID:",
        { parse_mode: "Markdown", reply_markup: undefined },
      );
      return;
    }

    if (data === "admin_remove_chips") {
      sess.step = "remove_chips_user";
      await ctx.editMessageText(
        "➖ *Remove Chips*\n\nEnter the user's Telegram ID:",
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
        `📊 *Casino Stats*\n\n` +
        `👥 Total Users: ${stats.totalUsers}\n` +
        `💰 Chips in Circulation: ${stats.totalChips.toFixed(0)}\n` +
        `🎮 Total Games Played: ${stats.totalGames}\n` +
        `⏳ Pending Transactions: ${stats.pendingTx}`,
        { parse_mode: "Markdown", reply_markup: adminGamesMenu(casinoBotUsername) },
      );
      return;
    }

    if (data === "admin_users") {
      const users = await getAllUsers(15);
      let msg = `👥 *Recent Users (${users.length})*\n\n`;
      for (const u of users) {
        const name = u.username ? `@${u.username}` : u.firstName ?? `ID:${u.telegramId}`;
        msg += `${u.isBanned ? "🚫" : "✅"} ${name} — ${parseFloat(u.chips).toFixed(0)} Chips\n`;
      }
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔍 Find User", callback_data: "admin_find_user" }],
            [{ text: "🔙 Back", callback_data: "admin_games" }],
          ],
        },
      });
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
        "🎁 *Bonus History*\n\nBonus tracking coming soon!\n\nFor now, use the Add Chips option to give bonuses to users.",
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

    // ── Approve TX: chips amount ────────────────────────────────────────────
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
        const credited = tx.type === "deposit" || tx.type === "admin_credit";
        await ctx.reply(
          credited
            ? `✅ TX #${tx.id} approved!\n${chips} chips added to the user.`
            : `✅ TX #${tx.id} approved!`,
          { reply_markup: adminMenu() },
        );
      } catch (e) {
        await ctx.reply(`❌ Error: ${String(e)}`);
      }
      return;
    }

    // ── Add chips: user ID ──────────────────────────────────────────────────
    if (sess.step === "add_chips_user") {
      const user = await getUserByTgId(text.replace("@", ""));
      if (!user) {
        await ctx.reply("❌ User not found. Please use the numeric Telegram ID.");
        return;
      }
      sess.pendingUserId = user.telegramId;
      sess.step = "add_chips_amount";
      await ctx.reply(
        `✅ User: ${user.username ? `@${user.username}` : user.firstName}\nBalance: ${parseFloat(user.chips).toFixed(0)} Chips\n\nHow many chips to add?`,
      );
      return;
    }

    if (sess.step === "add_chips_amount" && sess.pendingUserId) {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Please enter a valid number.");
        return;
      }
      await addChips(sess.pendingUserId, amount, "admin_credit", `Admin added ${amount} chips`);
      sess.step = undefined;
      delete sess.pendingUserId;
      await ctx.reply(`✅ ${amount} chips added successfully!`, {
        reply_markup: adminMenu(),
      });
      return;
    }

    // ── Remove chips: user ID ───────────────────────────────────────────────
    if (sess.step === "remove_chips_user") {
      const user = await getUserByTgId(text.replace("@", ""));
      if (!user) {
        await ctx.reply("❌ User not found.");
        return;
      }
      sess.pendingUserId = user.telegramId;
      sess.step = "remove_chips_amount";
      await ctx.reply(
        `✅ User: ${user.username ? `@${user.username}` : user.firstName}\nBalance: ${parseFloat(user.chips).toFixed(0)} Chips\n\nHow many chips to remove?`,
      );
      return;
    }

    if (sess.step === "remove_chips_amount" && sess.pendingUserId) {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Please enter a valid number.");
        return;
      }
      await deductChips(sess.pendingUserId, amount, "admin_debit", `Admin removed ${amount} chips`);
      sess.step = undefined;
      delete sess.pendingUserId;
      await ctx.reply(`✅ ${amount} chips removed!`, {
        reply_markup: adminMenu(),
      });
      return;
    }

    // ── Find user ───────────────────────────────────────────────────────────
    if (sess.step === "find_user") {
      sess.step = undefined;
      const user = await getUserByTgId(text);
      if (!user) {
        await ctx.reply("❌ User not found.");
        return;
      }
      const msg =
        `👤 *User Info*\n\n` +
        `ID: ${user.telegramId}\n` +
        `Name: ${user.firstName ?? ""} ${user.lastName ?? ""}\n` +
        `Username: ${user.username ? `@${user.username}` : "N/A"}\n` +
        `Chips: ${parseFloat(user.chips).toFixed(0)}\n` +
        `Banned: ${user.isBanned ? "Yes 🚫" : "No ✅"}\n` +
        `Joined: ${user.createdAt.toLocaleDateString()}`;
      await ctx.reply(msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "➕ Add Chips", callback_data: "admin_add_chips" },
              { text: "➖ Remove Chips", callback_data: "admin_remove_chips" },
            ],
            user.isBanned
              ? [{ text: "✅ Unban", callback_data: `admin_unban_${user.telegramId}` }]
              : [{ text: "🚫 Ban", callback_data: `admin_ban_confirm_${user.telegramId}` }],
            [{ text: "🔙 Admin Panel", callback_data: "admin_main" }],
          ],
        },
      });
      return;
    }

    // ── Ban user ────────────────────────────────────────────────────────────
    if (sess.step === "ban_user") {
      sess.step = undefined;
      const user = await getUserByTgId(text);
      if (!user) {
        await ctx.reply("❌ User not found.");
        return;
      }
      await ctx.reply(
        `User: ${user.username ? `@${user.username}` : user.firstName}\nAre you sure you want to ban this user?`,
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
        `✅ Address: \`${text}\`\n\n1 ${sess.pendingCrypto.toUpperCase()} = how many chips? (e.g.: 100)\n\nFor USDT: enter 1 (1 USDT = 1 chip)`,
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
        `✅ *${opt?.label} address saved!*\nAddress: \`${address}\`\nRate: ${rate} chips/unit`,
        { parse_mode: "Markdown", reply_markup: adminMenu() },
      );
      return;
    }
  });

  logger.info("Admin bot created");
  return bot;
}
