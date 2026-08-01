import { Telegraf, session, type Context } from "telegraf";
import { message } from "telegraf/filters";
import { logger } from "../lib/logger";
import {
  getOrCreateUser,
  getChips,
  addChips,
  deductChips,
  recordGame,
  getRecentGames,
  createDepositRequest,
  createCryptoPayDeposit,
  createWithdrawalRequest,
  getDepositAddresses,
  createPvpChallenge,
  acceptPvpChallenge,
  completePvpChallenge,
  getPvpChallenge,
  getUserByTgId,
  reopenPvpChallenge,
  InsufficientChipsError,
} from "./db-helpers";
import { isCryptoPayEnabled, createInvoice, CRYPTOPAY_ASSETS } from "./cryptopay";
import {
  mainMenu,
  gamesMenu,
  betMenu,
  diceChoiceMenu,
  coinChoiceMenu,
  rouletteChoiceMenu,
  bjActionMenu,
  crashMenu,
  playAgainMenu,
  depositMenu,
  withdrawMenu,
  pvpMenu,
  pvpAcceptMenu,
  groupGamesMenu,
} from "./keyboards";
import { playSlots } from "./games/slots";
import { playDice, type DiceBetType } from "./games/dice";
import { playCoinFlip, type CoinSide } from "./games/coinflip";
import {
  startBlackjack,
  bjAction,
  formatBJState,
  type BJState,
} from "./games/blackjack";
import { playRoulette, type RouletteBet } from "./games/roulette";
import { generateCrashPoint, resolveCrash, buildCrashBar } from "./games/crash";
import { playPlinko } from "./games/plinko";

// ─── Session types ─────────────────────────────────────────────────────────────
interface SessionData {
  bjState?: BJState;
  bjBet?: number;
  awaitingDepositCrypto?: string;
  awaitingDepositHash?: boolean;
  awaitingDepositAmount?: boolean;
  depositCryptoAmount?: string;
  awaitingWithdrawCrypto?: string;
  awaitingWithdrawAddress?: boolean;
  awaitingWithdrawAmount?: boolean;
  withdrawChips?: number;
  awaitingRouletteNumber?: number;
  crashPoint?: number;
  crashBet?: number;
  crashCashedOut?: boolean;
  crashMessageId?: number;
  awaitingPvpBet?: boolean;
  pvpBet?: number;
}

type BotContext = Context & { session: SessionData };

// ─── Active crash games in-memory ─────────────────────────────────────────────
const activeCrash = new Map<
  string,
  { interval: ReturnType<typeof setInterval>; current: number; crashPoint: number; bet: number; chatId: number | string; messageId: number }
>();

// ─── Delay helper ─────────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createCasinoBot(token: string): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(token);

  bot.use(session({ defaultSession: () => ({} as SessionData) }));

  // Bot username
  let botUsername = "";
  bot.telegram.getMe().then(me => { botUsername = me.username ?? ""; }).catch(() => {});

  // ─── Helper: is this a group chat? ──────────────────────────────────────
  const isGroup = (ctx: BotContext) =>
    ctx.chat?.type === "group" || ctx.chat?.type === "supergroup" || ctx.chat?.type === "channel";

  // ─── Helper: redirect to private for deposit/withdraw/balance ────────────
  async function replyPrivateRedirect(ctx: BotContext, payload = "menu", label = "🎰 Open Casino") {
    const name = ctx.from?.first_name ?? "Player";
    return ctx.reply(
      `👋 *Hey ${name}!*\n\nClick below to open the casino in private chat.`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: label, url: `https://t.me/${botUsername}?start=${payload}` }],
          ],
        },
      },
    );
  }

  // ─── Helper: handle deep-link startPayload (private chat only) ──────────
  async function handleStartPayload(ctx: BotContext, tgId: string, payload: string): Promise<void> {
    if (payload === "balance") {
      const chips = await getChips(tgId);
      await ctx.reply(`💰 *Your Balance*\n\n${chips.toFixed(0)} Chips`, {
        parse_mode: "Markdown", reply_markup: mainMenu(),
      });
      return;
    }
    if (payload === "deposit") {
      const addresses = await getDepositAddresses();
      if (addresses.length === 0) {
        await ctx.reply("⚠️ No deposit addresses configured yet. Contact admin.", { reply_markup: mainMenu() });
        return;
      }
      await ctx.reply("📥 *Deposit Chips*\n\nSelect a cryptocurrency to deposit:", {
        parse_mode: "Markdown",
        reply_markup: depositMenu(addresses.map(a => ({ crypto: a.crypto, label: a.label }))),
      });
      return;
    }
    if (payload === "withdraw") {
      const addresses = await getDepositAddresses();
      if (addresses.length === 0) {
        await ctx.reply("⚠️ No crypto addresses available.", { reply_markup: mainMenu() });
        return;
      }
      await ctx.reply("📤 *Withdraw Chips*\n\nSelect which crypto to withdraw to:", {
        parse_mode: "Markdown",
        reply_markup: withdrawMenu(addresses.map(a => ({ crypto: a.crypto, label: a.label }))),
      });
      return;
    }
    if (payload.startsWith("game_")) {
      const game = payload.replace("game_", "");
      const labels: Record<string, string> = {
        slots: "🎰 *Slots — Select your bet:*",
        dice: "🎲 *Dice — Select your bet:*",
        coinflip: "🪙 *Coin Flip — Select your bet:*",
        blackjack: "🃏 *Blackjack — Select your bet:*",
        roulette: "🎡 *Roulette — Select your bet:*",
        crash: "📈 *Crash — Select your bet:*",
        plinko: "🏓 *Plinko — Select your bet:*",
      };
      const prefixes: Record<string, string> = {
        slots: "slots", dice: "dice", coinflip: "coinflip",
        blackjack: "bj", roulette: "roulette", crash: "crash", plinko: "plinko",
      };
      if (labels[game] && prefixes[game]) {
        await ctx.reply(labels[game]!, { parse_mode: "Markdown", reply_markup: betMenu(prefixes[game]!) });
        return;
      }
    }
    const chips = await getChips(tgId);
    await ctx.reply(
      `🎰 *Casino Bot*\n\n💰 Balance: *${chips.toFixed(0)} Chips*`,
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
  }

  // ─── /start ─────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const from = ctx.from!;
    const tgId = String(from.id);
    await getOrCreateUser(tgId, from.username, from.first_name, from.last_name);

    if (isGroup(ctx)) {
      const chips = await getChips(tgId);
      return ctx.reply(
        `🎰 *Casino Bot*\n\n👋 Hey ${from.first_name}!\n💰 Balance: *${chips.toFixed(0)} Chips*\n\n🎮 Choose a game to play right here!`,
        { parse_mode: "Markdown", reply_markup: groupGamesMenu(botUsername) },
      );
    }

    if (ctx.startPayload) {
      return handleStartPayload(ctx, tgId, ctx.startPayload);
    }

    const chips = await getChips(tgId);
    await ctx.reply(
      `🎰 *Welcome to Casino Bot, ${from.first_name}!*\n\n` +
      `💰 Your balance: *${chips.toFixed(0)} Chips*\n\n` +
      `1 Chip = $1 USD 💵\n\nPlay games, win big, earn chips! 🏆`,
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
  });

  // ─── /balance ───────────────────────────────────────────────────────────
  bot.command("balance", async (ctx) => {
    const tgId = String(ctx.from!.id);
    await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
    // Balance in group — show inline (no private redirect)
    const chips = await getChips(tgId);
    await ctx.reply(
      `💰 *${ctx.from!.first_name}'s Balance*\n\n${chips.toFixed(0)} Chips ($${chips.toFixed(0)})`,
      { parse_mode: "Markdown" },
    );
  });

  // ─── /help ──────────────────────────────────────────────────────────────
  bot.command("help", (ctx) => {
    if (isGroup(ctx)) return ctx.reply(helpText(), { parse_mode: "Markdown" });
    return ctx.reply(helpText(), { parse_mode: "Markdown", reply_markup: mainMenu() });
  });

  // ─── Game shortcut commands — work in both group and private ─────────────
  const gameCommands: Array<[string, string, string, string]> = [
    ["slots",     "game_slots",     "slots",    "🎰 *Slots — Select your bet:*"],
    ["dice",      "game_dice",      "dice",     "🎲 *Dice — Select your bet:*"],
    ["coinflip",  "game_coinflip",  "coinflip", "🪙 *Coin Flip — Select your bet:*"],
    ["blackjack", "game_blackjack", "bj",       "🃏 *Blackjack — Select your bet:*"],
    ["roulette",  "game_roulette",  "roulette", "🎡 *Roulette — Select your bet:*"],
    ["crash",     "game_crash",     "crash",    "📈 *Crash — Select your bet:*"],
    ["plinko",    "game_plinko",    "plinko",   "🏓 *Plinko — Select your bet:*"],
  ];
  for (const [cmd, _payload, prefix, label] of gameCommands) {
    bot.command(cmd, async (ctx) => {
      const tgId = String(ctx.from!.id);
      await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
      // Works in both group AND private — no redirect!
      await ctx.reply(label, { parse_mode: "Markdown", reply_markup: betMenu(prefix) });
    });
  }

  // ─── /games ─────────────────────────────────────────────────────────────
  bot.command("games", async (ctx) => {
    const tgId = String(ctx.from!.id);
    await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
    if (isGroup(ctx)) {
      return ctx.reply(
        `🎮 *Casino Games*\n\nPlay right here in the group! 🎲`,
        { parse_mode: "Markdown", reply_markup: groupGamesMenu(botUsername) },
      );
    }
    return ctx.reply("🎮 *Choose a game to play:*", {
      parse_mode: "Markdown", reply_markup: gamesMenu(),
    });
  });

  // ─── /deposit and /withdraw — private only ───────────────────────────────
  bot.command("deposit", async (ctx) => {
    const tgId = String(ctx.from!.id);
    await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
    if (isGroup(ctx)) return replyPrivateRedirect(ctx, "deposit", "📥 Deposit");
    return handleStartPayload(ctx, tgId, "deposit");
  });

  bot.command("withdraw", async (ctx) => {
    const tgId = String(ctx.from!.id);
    await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
    if (isGroup(ctx)) return replyPrivateRedirect(ctx, "withdraw", "📤 Withdraw");
    return handleStartPayload(ctx, tgId, "withdraw");
  });

  // ─── Callback queries ────────────────────────────────────────────────────
  bot.on("callback_query", async (ctx) => {
    const data = (ctx.callbackQuery as { data?: string }).data;
    if (!data) return;

    const tgId = String(ctx.from!.id);
    const user = await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
    if (user.isBanned) {
      try { await ctx.answerCbQuery("🚫 You are banned from this casino.", { show_alert: true }); } catch { /* ignore */ }
      return;
    }

    try {
    // ── Navigation ──────────────────────────────────────────────────────
    if (data === "main_menu") {
      const chips = await getChips(tgId);
      return ctx.editMessageText(
        `🎰 *Main Menu*\n\n💰 Balance: *${chips.toFixed(0)} Chips*`,
        { parse_mode: "Markdown", reply_markup: mainMenu() },
      );
    }

    if (data === "menu_games") {
      return ctx.editMessageText("🎮 *Choose a game to play:*", {
        parse_mode: "Markdown",
        reply_markup: gamesMenu(),
      });
    }

    if (data === "balance") {
      const chips = await getChips(tgId);
      return ctx.editMessageText(
        `💰 *Your Balance*\n\n*${chips.toFixed(0)} Chips*`,
        { parse_mode: "Markdown", reply_markup: mainMenu() },
      );
    }

    if (data === "help") {
      return ctx.editMessageText(helpText(), {
        parse_mode: "Markdown",
        reply_markup: mainMenu(),
      });
    }

    if (data === "my_stats") {
      return handleMyStats(ctx, tgId);
    }

    // ── Deposit (private only) ────────────────────────────────────────────
    if (data === "menu_deposit") {
      if (isGroup(ctx)) {
        return ctx.answerCbQuery("Please open the bot in private to deposit", { show_alert: true });
      }
      return handleDepositMenu(ctx);
    }
    if (data.startsWith("deposit_crypto_")) {
      const crypto = data.replace("deposit_crypto_", "");
      return handleDepositCryptoSelected(ctx, tgId, crypto);
    }
    if (data.startsWith("deposit_cp_")) {
      const crypto = data.replace("deposit_cp_", "");
      return handleCryptoPayDeposit(ctx, tgId, crypto);
    }
    if (data.startsWith("deposit_manual_")) {
      const crypto = data.replace("deposit_manual_", "");
      return handleManualDepositAddress(ctx, tgId, crypto);
    }
    if (data === "deposit_confirm") return handleDepositConfirmStart(ctx, tgId);

    // ── Withdraw (private only) ───────────────────────────────────────────
    if (data === "menu_withdraw") {
      if (isGroup(ctx)) {
        return ctx.answerCbQuery("Please open the bot in private to withdraw", { show_alert: true });
      }
      return handleWithdrawMenu(ctx);
    }
    if (data.startsWith("withdraw_crypto_")) {
      const crypto = data.replace("withdraw_crypto_", "");
      return handleWithdrawCryptoSelected(ctx, tgId, crypto);
    }

    // ── Game: Slots ──────────────────────────────────────────────────────
    if (data === "game_slots") {
      return ctx.editMessageText("🎰 *Slots — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("slots"),
      });
    }
    if (data.startsWith("slots_bet_")) return handleSlotsPlay(ctx, tgId, data);

    // ── Game: Dice ───────────────────────────────────────────────────────
    if (data === "game_dice") {
      return ctx.editMessageText("🎲 *Dice — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("dice"),
      });
    }
    if (data.startsWith("dice_bet_")) {
      const parts = data.split("_");
      const betStr = parts[parts.length - 1]!;
      const chips = await getChips(tgId);
      const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);
      if (bet <= 0 || chips < bet) {
        return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
      }
      return ctx.editMessageText(
        `🎲 *Dice — Bet: ${bet} Chips*\n\nWhat do you want to bet on?`,
        { parse_mode: "Markdown", reply_markup: diceChoiceMenu(bet) },
      );
    }
    if (data.startsWith("dice_choice_")) return handleDicePlay(ctx, tgId, data);

    // ── Game: Coin Flip ──────────────────────────────────────────────────
    if (data === "game_coinflip") {
      return ctx.editMessageText("🪙 *Coin Flip — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("coinflip"),
      });
    }
    if (data.startsWith("coinflip_bet_")) {
      const parts = data.split("_");
      const betStr = parts[parts.length - 1]!;
      const chips = await getChips(tgId);
      const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);
      if (bet <= 0 || chips < bet) {
        return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
      }
      return ctx.editMessageText(
        `🪙 *Coin Flip — Bet: ${bet} Chips*\n\nHeads or Tails?`,
        { parse_mode: "Markdown", reply_markup: coinChoiceMenu(bet) },
      );
    }
    if (data.startsWith("coin_choice_")) return handleCoinPlay(ctx, tgId, data);

    // ── Game: Blackjack ──────────────────────────────────────────────────
    if (data === "game_blackjack") {
      return ctx.editMessageText("🃏 *Blackjack — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("bj"),
      });
    }
    if (data.startsWith("bj_bet_")) return handleBJStart(ctx, tgId, data);
    if (data === "bj_hit" || data === "bj_stand" || data === "bj_double") {
      return handleBJAction(ctx, tgId, data.replace("bj_", "") as "hit" | "stand" | "double");
    }

    // ── Game: Roulette ───────────────────────────────────────────────────
    if (data === "game_roulette") {
      return ctx.editMessageText("🎡 *Roulette — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("roulette"),
      });
    }
    if (data.startsWith("roulette_bet_")) {
      const parts = data.split("_");
      const betStr = parts[parts.length - 1]!;
      const chips = await getChips(tgId);
      const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);
      if (bet <= 0 || chips < bet) {
        return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
      }
      return ctx.editMessageText(
        `🎡 *Roulette — Bet: ${bet} Chips*\n\nWhere do you want to place your bet?`,
        { parse_mode: "Markdown", reply_markup: rouletteChoiceMenu(bet) },
      );
    }
    if (data.startsWith("rou_")) return handleRoulettePlay(ctx, tgId, data);

    // ── Game: Crash ──────────────────────────────────────────────────────
    if (data === "game_crash") {
      return ctx.editMessageText("📈 *Crash — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("crash"),
      });
    }
    if (data.startsWith("crash_bet_")) return handleCrashStart(ctx, tgId, data);
    if (data.startsWith("crash_cashout_")) return handleCrashCashout(ctx, tgId, data);

    // ── Game: Plinko ─────────────────────────────────────────────────────
    if (data === "game_plinko") {
      return ctx.editMessageText("🏓 *Plinko — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("plinko"),
      });
    }
    if (data.startsWith("plinko_bet_")) return handlePlinkoPlay(ctx, tgId, data);

    // ── PvP ──────────────────────────────────────────────────────────────
    if (data === "game_pvp") {
      return ctx.editMessageText(
        "⚔️ *PvP Challenge*\n\nChallenge anyone in the group!\n\nSelect your bet:",
        { parse_mode: "Markdown", reply_markup: pvpMenu([50, 100, 250, 500, 1000]) },
      );
    }
    if (data.startsWith("pvp_bet_")) {
      const bet = parseInt(data.replace("pvp_bet_", ""), 10);
      return handlePvpChallenge(ctx, tgId, bet);
    }
    if (data.startsWith("pvp_accept_")) {
      const id = parseInt(data.replace("pvp_accept_", ""), 10);
      return handlePvpAccept(ctx, tgId, id);
    }
    if (data.startsWith("pvp_ignore_")) {
      return ctx.deleteMessage();
    }
    } finally {
      // Acknowledge callback if a handler didn't already (alerts answer themselves)
      try { await ctx.answerCbQuery(); } catch { /* already answered */ }
    }
  });

  // ─── Text messages for multi-step flows (private only) ──────────────────
  bot.on(message("text"), async (ctx): Promise<void> => {
    const tgId = String(ctx.from!.id);
    const text = ctx.message.text.trim();
    const sess = ctx.session;

    if (sess.awaitingDepositHash) {
      sess.awaitingDepositHash = false;
      sess.awaitingDepositAmount = true;
      await ctx.reply(
        `✅ TX Hash saved.\n\nHow much ${sess.awaitingDepositCrypto?.toUpperCase()} did you deposit? (e.g.: 0.5)`,
      );
      (sess as unknown as { pendingTxHash: string }).pendingTxHash = text;
      return;
    }

    if (sess.awaitingDepositAmount) {
      const amount = parseFloat(text);
      const hash = (sess as unknown as { pendingTxHash: string }).pendingTxHash;
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Please enter a valid amount, e.g.: 0.5"); return;
      }
      const addresses = await getDepositAddresses();
      const cryptoAddr = addresses.find(a => a.crypto === sess.awaitingDepositCrypto);
      const chipsPerUnit = cryptoAddr ? parseFloat(cryptoAddr.chipsPerUnit) : 1;
      const estimatedChips = amount * chipsPerUnit;
      if (estimatedChips < 5) {
        await ctx.reply(`❌ Minimum deposit is *$5 (5 Chips)*.\n\nYour amount would give ${estimatedChips.toFixed(2)} Chips.`, { parse_mode: "Markdown" });
        return;
      }
      sess.awaitingDepositAmount = false;
      const crypto = sess.awaitingDepositCrypto!;
      delete sess.awaitingDepositCrypto;
      try {
        const walletAddress = cryptoAddr?.address ?? "unknown";
        const tx = await createDepositRequest(tgId, crypto, text, hash, walletAddress);
        await ctx.reply(
          `📥 *Deposit Request Submitted!*\n\nID: #${tx.id}\nCrypto: ${crypto.toUpperCase()}\nAmount: ${amount} → ~${estimatedChips.toFixed(0)} Chips 💰\n\n💵 Rate: 1 Chip = $1 USD\n\nAdmin will verify and credit your chips. 🙏`,
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
      } catch {
        await ctx.reply("❌ An error occurred. Please try again.");
      }
      return;
    }

    if (sess.awaitingWithdrawAmount) {
      const chips = parseInt(text, 10);
      if (isNaN(chips) || chips <= 0) { await ctx.reply("❌ Please enter a valid chip amount"); return; }
      const balance = await getChips(tgId);
      if (chips > balance) { await ctx.reply(`❌ Insufficient chips. Balance: ${balance.toFixed(0)}`); return; }
      sess.awaitingWithdrawAmount = false;
      sess.awaitingWithdrawAddress = true;
      sess.withdrawChips = chips;
      await ctx.reply(`✅ ${chips} chips. Now please enter your ${sess.awaitingWithdrawCrypto?.toUpperCase()} wallet address:`);
      return;
    }

    if (sess.awaitingWithdrawAddress) {
      const address = text;
      const crypto = sess.awaitingWithdrawCrypto!;
      const chips = sess.withdrawChips!;
      sess.awaitingWithdrawAddress = false;
      delete sess.awaitingWithdrawCrypto;
      delete sess.withdrawChips;
      const balance = await getChips(tgId);
      if (chips > balance) { await ctx.reply("❌ Insufficient chips."); return; }
      await deductChips(tgId, chips, "withdrawal_pending", `Withdrawal request to ${address}`);
      const tx = await createWithdrawalRequest(tgId, chips, crypto, address);
      await ctx.reply(
        `📤 *Withdrawal Request Submitted!*\n\nID: #${tx.id}\nChips: ${chips}\nCrypto: ${crypto.toUpperCase()}\nAddress: \`${address}\`\n\nAdmin will process shortly. 🙏`,
        { parse_mode: "Markdown", reply_markup: mainMenu() },
      );
      return;
    }

    if (sess.awaitingRouletteNumber !== undefined) {
      const num = parseInt(text, 10);
      if (isNaN(num) || num < 0 || num > 36) {
        await ctx.reply("❌ Please enter a number between 0 and 36"); return;
      }
      const bet: RouletteBet = { type: "number", value: num };
      const betAmt = sess.awaitingRouletteNumber;
      delete sess.awaitingRouletteNumber;
      await handleRouletteResult(ctx, tgId, bet, betAmt);
    }
  });

  return bot;

  // ─── Handler Functions ──────────────────────────────────────────────────

  async function handleMyStats(ctx: BotContext, tgId: string) {
    const chips = await getChips(tgId);
    const games = await getRecentGames(tgId, 5);
    let statsText = `📊 *Your Stats*\n\n💰 Balance: *${chips.toFixed(0)} Chips*\n\n🎮 *Last 5 Games:*\n`;
    if (games.length === 0) {
      statsText += "No games played yet!";
    } else {
      for (const g of games) {
        const emoji = g.result === "win" ? "✅" : g.result === "push" ? "🤝" : "❌";
        statsText += `${emoji} ${g.game} — Bet: ${g.betAmount}, Payout: ${g.payout}\n`;
      }
    }
    return ctx.editMessageText(statsText, {
      parse_mode: "Markdown",
      reply_markup: mainMenu(),
    });
  }

  async function handleDepositMenu(ctx: BotContext) {
    const addresses = await getDepositAddresses();
    if (addresses.length === 0) {
      return ctx.editMessageText(
        "⚠️ No deposit addresses configured yet. Please contact the admin.",
        { reply_markup: mainMenu() },
      );
    }
    return ctx.editMessageText(
      "📥 *Deposit Chips*\n\nSelect a cryptocurrency to deposit:",
      {
        parse_mode: "Markdown",
        reply_markup: depositMenu(addresses.map(a => ({ crypto: a.crypto, label: a.label }))),
      },
    );
  }

  async function handleDepositCryptoSelected(ctx: BotContext, tgId: string, crypto: string) {
    const addresses = await getDepositAddresses();
    const addr = addresses.find(a => a.crypto === crypto);
    if (!addr) return ctx.answerCbQuery("❌ Address not found", { show_alert: true });

    ctx.session.awaitingDepositCrypto = crypto;

    // Map crypto key to CryptoPay asset name
    const cpAssetMap: Record<string, string> = {
      usdt_trc20: "USDT", usdt_erc20: "USDT",
      btc: "BTC", eth: "ETH", ton: "TON",
      bnb: "BNB", ltc: "LTC",
    };
    const cpAsset = cpAssetMap[crypto];
    const cpAvailable = isCryptoPayEnabled() && cpAsset && (CRYPTOPAY_ASSETS as readonly string[]).includes(cpAsset);

    const baseText =
      `📥 *Deposit — ${addr.label}*\n\n` +
      `Network: ${addr.network ?? addr.label}\n` +
      `Rate: 1 ${crypto.toUpperCase()} = ${addr.chipsPerUnit} Chips\n` +
      `💵 *1 Chip = $1 USD* | Min: *$5*\n\n`;

    if (cpAvailable) {
      // Show both options: auto (CryptoPay) and manual (static address)
      return ctx.editMessageText(
        baseText +
        `Choose your deposit method:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⚡ Auto Deposit (CryptoPay)", callback_data: `deposit_cp_${crypto}` }],
              [{ text: "🏦 Manual (Send to Address)", callback_data: `deposit_manual_${crypto}` }],
              [{ text: "🔙 Back", callback_data: "menu_deposit" }],
            ],
          },
        },
      );
    }

    // CryptoPay not configured — show only static address
    return ctx.editMessageText(
      baseText +
      `Send funds to this address:\n\`${addr.address}\`\n\n` +
      `After sending, press *Confirm Deposit* and paste your TX hash.`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Confirm Deposit", callback_data: "deposit_confirm" }],
            [{ text: "🔙 Back", callback_data: "menu_deposit" }],
          ],
        },
      },
    );
  }

  async function handleManualDepositAddress(ctx: BotContext, tgId: string, crypto: string) {
    const addresses = await getDepositAddresses();
    const addr = addresses.find(a => a.crypto === crypto);
    if (!addr) return ctx.answerCbQuery("❌ Address not found", { show_alert: true });
    ctx.session.awaitingDepositCrypto = crypto;
    return ctx.editMessageText(
      `📥 *Manual Deposit — ${addr.label}*\n\n` +
      `Network: ${addr.network ?? addr.label}\n` +
      `Address:\n\`${addr.address}\`\n\n` +
      `Rate: 1 ${crypto.toUpperCase()} = ${addr.chipsPerUnit} Chips\n\n` +
      `Send funds to this address, then press *Confirm Deposit* and paste your TX hash.`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Confirm Deposit", callback_data: "deposit_confirm" }],
            [{ text: "🔙 Back", callback_data: `deposit_crypto_${crypto}` }],
          ],
        },
      },
    );
  }

  async function handleCryptoPayDeposit(ctx: BotContext, tgId: string, crypto: string): Promise<void> {
    const addresses = await getDepositAddresses();
    const addr = addresses.find(a => a.crypto === crypto);
    if (!addr) {
      await ctx.answerCbQuery("❌ Address not found", { show_alert: true });
      return;
    }

    const cpAssetMap: Record<string, string> = {
      usdt_trc20: "USDT", usdt_erc20: "USDT",
      btc: "BTC", eth: "ETH", ton: "TON",
      bnb: "BNB", ltc: "LTC",
    };
    const asset = cpAssetMap[crypto] ?? "USDT";

    // Minimum amount — default 5 chips = 5 USD worth
    const chipsPerUnit = parseFloat(addr.chipsPerUnit);
    const minChips = 5;
    const minAmount = chipsPerUnit > 0 ? (minChips / chipsPerUnit) : 1;

    try {
      const invoice = await createInvoice(
        asset,
        minAmount,
        `${tgId}:deposit`,
        `Casino deposit — ${addr.label}`,
      );

      const payUrl = invoice.bot_invoice_url || invoice.pay_url;

      // Save pending deposit
      const tx = await createCryptoPayDeposit(
        tgId,
        crypto,
        minAmount.toFixed(8),
        String(invoice.invoice_id),
        payUrl,
      );

      await ctx.editMessageText(
        `⚡ *Auto Deposit — ${addr.label}*\n\n` +
        `Rate: 1 ${asset} = ${addr.chipsPerUnit} Chips\n\n` +
        `Click the button below to pay via *CryptoBot*.\n` +
        `Your chips will be credited *automatically* after payment is confirmed! 🔔\n\n` +
        `Invoice ID: #${invoice.invoice_id}\nDeposit ID: #${tx.id}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💳 Pay via CryptoBot", url: payUrl }],
              [{ text: "🔙 Back to Menu", callback_data: "main_menu" }],
            ],
          },
        },
      );
    } catch (e) {
      await ctx.editMessageText(
        `❌ CryptoPay invoice creation failed.\n\nPlease try manual deposit or contact support.\n\nError: ${String(e)}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🏦 Use Manual Deposit", callback_data: `deposit_manual_${crypto}` }],
              [{ text: "🔙 Back", callback_data: "menu_deposit" }],
            ],
          },
        },
      );
    }
  }

  async function handleDepositConfirmStart(ctx: BotContext, tgId: string): Promise<void> {
    if (!ctx.session.awaitingDepositCrypto) {
      await ctx.editMessageText("Please select a crypto first.", { reply_markup: { inline_keyboard: [[{ text: "📥 Deposit", callback_data: "menu_deposit" }]] } });
      return;
    }
    ctx.session.awaitingDepositHash = true;
    await ctx.editMessageText(`✍️ Please paste your Transaction Hash / TXID:`, { reply_markup: undefined });
  }

  async function handleWithdrawMenu(ctx: BotContext) {
    const addresses = await getDepositAddresses();
    if (addresses.length === 0) {
      return ctx.editMessageText("⚠️ No crypto addresses available.", { reply_markup: mainMenu() });
    }
    return ctx.editMessageText(
      "📤 *Withdraw Chips*\n\nSelect which crypto to withdraw to:",
      {
        parse_mode: "Markdown",
        reply_markup: withdrawMenu(addresses.map(a => ({ crypto: a.crypto, label: a.label }))),
      },
    );
  }

  async function handleWithdrawCryptoSelected(ctx: BotContext, tgId: string, crypto: string) {
    ctx.session.awaitingWithdrawCrypto = crypto;
    ctx.session.awaitingWithdrawAmount = true;
    const chips = await getChips(tgId);
    await ctx.editMessageText(
      `📤 *Withdraw — ${crypto.toUpperCase()}*\n\n💰 Your Balance: ${chips.toFixed(0)} Chips\n\nHow many chips to withdraw? (e.g.: 500)`,
      { parse_mode: "Markdown" },
    );
  }

  // ─── SLOTS ─── with 🎰 Telegram dice animation ──────────────────────────
  async function handleSlotsPlay(ctx: BotContext, tgId: string, data: string) {
    const parts = data.split("_");
    const betStr = parts[parts.length - 1]!;
    const chips = await getChips(tgId);
    const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);

    if (bet <= 0 || chips < bet) {
      return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
    }

    // Show spinning message
    await ctx.editMessageText(`🎰 *Spinning the slots...*`, { parse_mode: "Markdown" });

    // Send the actual 🎰 Telegram slot machine dice animation
    await ctx.telegram.sendDice(ctx.chat!.id, { emoji: "🎰" });

    // Wait for animation
    await delay(3000);

    // Process result
    await deductChips(tgId, bet, "game_loss", "Slots bet");
    const result = playSlots();
    let payout = 0;
    let gameResult: "win" | "loss" = "loss";

    if (result.multiplier > 0) {
      payout = bet * result.multiplier;
      await addChips(tgId, payout, "game_win", "Slots win");
      gameResult = "win";
    }

    await recordGame(tgId, "slots", bet, payout, gameResult, { reels: result.reels, multiplier: result.multiplier });
    const newBal = await getChips(tgId);
    const msg = `${result.display}\n\nBet: ${bet} 💰\n${result.multiplier > 0 ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} Chips`;

    return ctx.reply(msg, { reply_markup: playAgainMenu("slots") });
  }

  // ─── DICE ─── with 🎲 Telegram dice animation ───────────────────────────
  async function handleDicePlay(ctx: BotContext, tgId: string, data: string) {
    // format: dice_choice_{type}_{bet}
    const parts = data.split("_");
    const bet = parseInt(parts[parts.length - 1]!, 10);
    const betType = parts[parts.length - 2]! as DiceBetType;

    const chips = await getChips(tgId);
    if (chips < bet) return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });

    // Show rolling message
    await ctx.editMessageText(`🎲 *Rolling the dice...*`, { parse_mode: "Markdown" });

    // Send TWO actual Telegram dice — one for each die
    await ctx.telegram.sendDice(ctx.chat!.id, { emoji: "🎲" });
    await delay(500);
    await ctx.telegram.sendDice(ctx.chat!.id, { emoji: "🎲" });

    // Wait for both animations
    await delay(3500);

    await deductChips(tgId, bet, "game_loss", "Dice bet");
    const result = playDice(betType);
    let payout = 0;
    let gameResult: "win" | "loss" = "loss";

    if (result.won) {
      payout = bet * result.multiplier;
      await addChips(tgId, payout, "game_win", "Dice win");
      gameResult = "win";
    }

    await recordGame(tgId, "dice", bet, payout, gameResult, { dice1: result.dice1, dice2: result.dice2 });
    const newBal = await getChips(tgId);
    const msg = `${result.display}\n\nBet: ${bet} 💰\n${result.won ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} Chips`;

    return ctx.reply(msg, {
      parse_mode: "Markdown",
      reply_markup: playAgainMenu("dice"),
    });
  }

  // ─── COIN FLIP ─── with 🎯 Telegram dice animation ──────────────────────
  async function handleCoinPlay(ctx: BotContext, tgId: string, data: string) {
    // format: coin_choice_{side}_{bet}
    const parts = data.split("_");
    const bet = parseInt(parts[parts.length - 1]!, 10);
    const side = parts[parts.length - 2]! as CoinSide;

    const chips = await getChips(tgId);
    if (chips < bet) return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });

    // Show flipping message
    await ctx.editMessageText(`🪙 *Flipping the coin...*`, { parse_mode: "Markdown" });

    // Send 🎯 dice for coin flip animation
    await ctx.telegram.sendDice(ctx.chat!.id, { emoji: "🎯" });

    // Wait for animation
    await delay(3000);

    await deductChips(tgId, bet, "game_loss", "Coin bet");
    const result = playCoinFlip(side);
    let payout = 0;
    let gameResult: "win" | "loss" = "loss";

    if (result.won) {
      payout = bet * result.multiplier;
      await addChips(tgId, payout, "game_win", "Coin win");
      gameResult = "win";
    }

    await recordGame(tgId, "coinflip", bet, payout, gameResult, { result: result.result });
    const newBal = await getChips(tgId);
    const msg = `${result.display}\n\nBet: ${bet} 💰\n${result.won ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} Chips`;

    return ctx.reply(msg, { reply_markup: playAgainMenu("coinflip") });
  }

  // ─── BLACKJACK ──────────────────────────────────────────────────────────
  async function handleBJStart(ctx: BotContext, tgId: string, data: string) {
    const parts = data.split("_");
    const betStr = parts[parts.length - 1]!;
    const chips = await getChips(tgId);
    const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);

    if (bet <= 0 || chips < bet) {
      return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
    }

    await deductChips(tgId, bet, "game_loss", "BJ bet");
    const state = startBlackjack();
    ctx.session.bjState = state;
    ctx.session.bjBet = bet;

    // Natural blackjack / dealer natural — settle immediately
    if (state.done) {
      let payout = 0;
      let gameResult: "win" | "loss" | "push" = "loss";

      if (state.result === "blackjack") {
        payout = bet * (1 + 1.5); // 3:2
        await addChips(tgId, payout, "game_win", "BJ natural");
        gameResult = "win";
      } else if (state.result === "push") {
        await addChips(tgId, bet, "game_win", "BJ push refund");
        gameResult = "push";
        payout = bet;
      }

      await recordGame(tgId, "blackjack", bet, payout, gameResult);
      const newBal = await getChips(tgId);
      delete ctx.session.bjState;
      delete ctx.session.bjBet;

      const msg =
        formatBJState(state, false) +
        `\n\nBet: ${bet} 💰\n${gameResult === "win" ? `Win: +${payout.toFixed(0)} 💰` : gameResult === "push" ? "Draw — refund!" : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} Chips`;

      return ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: playAgainMenu("blackjack"),
      });
    }

    const msg = formatBJState(state, true);
    return ctx.editMessageText(msg, {
      parse_mode: "Markdown",
      reply_markup: bjActionMenu(true),
    });
  }

  async function handleBJAction(ctx: BotContext, tgId: string, action: "hit" | "stand" | "double") {
    const sess = ctx.session;
    if (!sess.bjState || !sess.bjBet) {
      return ctx.answerCbQuery("❌ No active Blackjack game.", { show_alert: true });
    }

    if (action === "double") {
      const chips = await getChips(tgId);
      if (chips < sess.bjBet) {
        return ctx.answerCbQuery("❌ Not enough chips to double!", { show_alert: true });
      }
      await deductChips(tgId, sess.bjBet, "game_loss", "BJ double");
      sess.bjBet *= 2;
    }

    const newState = bjAction(sess.bjState, action);
    sess.bjState = newState;

    if (newState.done) {
      let payout = 0;
      let gameResult: "win" | "loss" | "push" = "loss";

      if (newState.result === "win" || newState.result === "blackjack") {
        const mult = newState.result === "blackjack" ? 1.5 : 1;
        payout = sess.bjBet! * (1 + mult);
        await addChips(tgId, payout, "game_win", "BJ win");
        gameResult = "win";
      } else if (newState.result === "push") {
        await addChips(tgId, sess.bjBet!, "game_win", "BJ push refund");
        gameResult = "push";
        payout = sess.bjBet!;
      }

      await recordGame(tgId, "blackjack", sess.bjBet!, payout, gameResult);
      const newBal = await getChips(tgId);
      const msg =
        formatBJState(newState, false) +
        `\n\nBet: ${sess.bjBet} 💰\n${gameResult === "win" ? `Win: +${payout.toFixed(0)} 💰` : gameResult === "push" ? "Draw — refund!" : `Loss: -${sess.bjBet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} Chips`;

      delete sess.bjState;
      delete sess.bjBet;

      return ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: playAgainMenu("blackjack"),
      });
    }

    return ctx.editMessageText(formatBJState(newState, true), {
      parse_mode: "Markdown",
      reply_markup: bjActionMenu(false),
    });
  }

  // ─── ROULETTE ─── with 🎯 Telegram dice animation ───────────────────────
  async function handleRoulettePlay(ctx: BotContext, tgId: string, data: string): Promise<void> {
    const parts = data.split("_");
    const bet = parseInt(parts[parts.length - 1]!, 10);
    const value = parts[parts.length - 2]!;
    const type = parts[1]!;

    const chips = await getChips(tgId);
    if (chips < bet) { await ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true }); return; }

    if (type === "num" && value === "pick") {
      ctx.session.awaitingRouletteNumber = bet;
      await ctx.editMessageText("🎡 Enter a number between 0 and 36:", { reply_markup: undefined });
      return;
    }

    let rouletteBet: RouletteBet;
    if (type === "color") rouletteBet = { type: "color", value: value as "red" | "black" | "green" };
    else if (type === "parity") rouletteBet = { type: "parity", value: value as "odd" | "even" };
    else if (type === "half") rouletteBet = { type: "half", value: value as "low" | "high" };
    else rouletteBet = { type: "number", value: parseInt(value, 10) };

    // Show spinning animation for roulette
    await ctx.editMessageText(`🎡 *Spinning the wheel...*`, { parse_mode: "Markdown" });
    await ctx.telegram.sendDice(ctx.chat!.id, { emoji: "🎲" });
    await delay(3000);

    await handleRouletteResult(ctx, tgId, rouletteBet, bet);
  }

  async function handleRouletteResult(ctx: BotContext, tgId: string, bet: RouletteBet, betAmt: number): Promise<void> {
    const chips = await getChips(tgId);
    if (chips < betAmt) { await ctx.reply("❌ Insufficient chips!"); return; }

    await deductChips(tgId, betAmt, "game_loss", "Roulette bet");
    const result = playRoulette(bet);
    let payout = 0;
    let gameResult: "win" | "loss" = "loss";

    if (result.won) {
      payout = betAmt * result.multiplier;
      await addChips(tgId, payout, "game_win", "Roulette win");
      gameResult = "win";
    }

    await recordGame(tgId, "roulette", betAmt, payout, gameResult, { number: result.number, color: result.color });
    const newBal = await getChips(tgId);
    const msg = `${result.display}\n\nBet: ${betAmt} 💰\n${result.won ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${betAmt} 💰`}\n💼 Balance: ${newBal.toFixed(0)} Chips`;

    await ctx.reply(msg, { reply_markup: playAgainMenu("roulette") });
  }

  // ─── CRASH ──────────────────────────────────────────────────────────────
  async function handleCrashStart(ctx: BotContext, tgId: string, data: string): Promise<void> {
    const parts = data.split("_");
    const betStr = parts[parts.length - 1]!;
    const chips = await getChips(tgId);
    const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);

    if (bet <= 0 || chips < bet) {
      await ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
      return;
    }

    const key = `${tgId}_crash`;
    const existing = activeCrash.get(key);
    if (existing) {
      // Refund abandoned round so chips aren't lost
      clearInterval(existing.interval);
      activeCrash.delete(key);
      await addChips(tgId, existing.bet, "game_win", "Crash abandoned refund");
    }

    await deductChips(tgId, bet, "game_loss", "Crash bet");
    const crashPoint = generateCrashPoint();

    await ctx.editMessageText(
      `📈 *Crash Game* — Bet: ${bet} Chips\n\n` +
      `${buildCrashBar(1.0)} 1.00x\n\n` +
      `⏳ Starting...`,
      {
        parse_mode: "Markdown",
        reply_markup: crashMenu(bet),
      },
    );

    const messageId = ctx.callbackQuery?.message?.message_id;
    const chatId = ctx.chat!.id;

    const gameState = {
      interval: null as unknown as ReturnType<typeof setInterval>,
      current: 1.0,
      crashPoint,
      bet,
      chatId,
      messageId: messageId!,
    };

    const interval = setInterval(async () => {
      gameState.current = parseFloat((gameState.current + 0.1 + Math.random() * 0.2).toFixed(2));

      if (gameState.current >= crashPoint || !activeCrash.has(key)) {
        clearInterval(interval);
        if (!activeCrash.has(key)) return; // already cashed out
        activeCrash.delete(key);

        await recordGame(tgId, "crash", bet, 0, "loss", { crashPoint });
        const newBal = await getChips(tgId);

        try {
          await ctx.telegram.editMessageText(
            chatId,
            messageId!,
            undefined,
            `📈 *Crash Game*\n\n💥 CRASHED at ${crashPoint}x!\n\nBet: ${bet} 💰\nLoss: -${bet} 💰\n💼 Balance: ${newBal.toFixed(0)} Chips`,
            { parse_mode: "Markdown", reply_markup: playAgainMenu("crash") },
          );
        } catch { /* already edited */ }
        return;
      }

      try {
        await ctx.telegram.editMessageText(
          chatId,
          messageId!,
          undefined,
          `📈 *Crash Game* — Bet: ${bet} Chips\n\n` +
          `${buildCrashBar(gameState.current)} ${gameState.current.toFixed(2)}x\n\n` +
          `💸 Cash out or keep going!`,
          { parse_mode: "Markdown", reply_markup: crashMenu(bet) },
        );
      } catch { /* ignore */ }
    }, 1500);

    gameState.interval = interval;
    activeCrash.set(key, gameState);
  }

  async function handleCrashCashout(ctx: BotContext, tgId: string, _data: string) {
    const key = `${tgId}_crash`;
    const game = activeCrash.get(key);
    if (!game) return ctx.answerCbQuery("❌ Game already ended!", { show_alert: true });

    const cashedOutAt = game.current;
    const crashPoint = game.crashPoint;
    const bet = game.bet;
    clearInterval(game.interval);
    activeCrash.delete(key);

    const result = resolveCrash(crashPoint, cashedOutAt);
    let payout = 0;

    if (result.won) {
      payout = bet * cashedOutAt;
      await addChips(tgId, payout, "game_win", "Crash win");
    }

    await recordGame(tgId, "crash", bet, payout, result.won ? "win" : "loss", { crashPoint, cashedOutAt });
    const newBal = await getChips(tgId);

    return ctx.editMessageText(
      `📈 *Crash Game*\n\nCashed out at: ${cashedOutAt}x\nCrash was at: ${crashPoint}x\n\nBet: ${bet} 💰\n${result.won ? `✅ Win: +${payout.toFixed(0)} 💰` : `❌ Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} Chips`,
      { parse_mode: "Markdown", reply_markup: playAgainMenu("crash") },
    );
  }

  // ─── PLINKO ─── with 🎯 Telegram dice animation ──────────────────────────
  async function handlePlinkoPlay(ctx: BotContext, tgId: string, data: string) {
    const parts = data.split("_");
    const betStr = parts[parts.length - 1]!;
    const chips = await getChips(tgId);
    const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);

    if (bet <= 0 || chips < bet) {
      return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
    }

    // Show dropping animation
    await ctx.editMessageText(`🏓 *Dropping the ball...*`, { parse_mode: "Markdown" });
    await ctx.telegram.sendDice(ctx.chat!.id, { emoji: "🎲" });
    await delay(3000);

    await deductChips(tgId, bet, "game_loss", "Plinko bet");
    const result = playPlinko();
    const payout = bet * result.multiplier;
    const gameResult: "win" | "loss" = payout >= bet ? "win" : "loss";

    if (payout > 0) await addChips(tgId, payout, "game_win", "Plinko payout");
    await recordGame(tgId, "plinko", bet, payout, gameResult, { slot: result.slot, multiplier: result.multiplier });
    const newBal = await getChips(tgId);

    const msg =
      `${result.display}\n\nBet: ${bet} 💰\nPayout: ${payout.toFixed(0)} 💰\n${payout >= bet ? "✅" : "❌"} Net: ${(payout - bet).toFixed(0)} 💰\n💼 Balance: ${newBal.toFixed(0)} Chips`;

    return ctx.reply(msg, {
      parse_mode: "Markdown",
      reply_markup: playAgainMenu("plinko"),
    });
  }

  // ─── PvP ────────────────────────────────────────────────────────────────
  async function handlePvpChallenge(ctx: BotContext, tgId: string, bet: number): Promise<void> {
    const chips = await getChips(tgId);
    if (chips < bet) { await ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true }); return; }

    const chatId = String(ctx.chat!.id);
    const challenge = await createPvpChallenge(tgId, "coinflip", bet, chatId);

    await deductChips(tgId, bet, "pvp_bet", "PvP challenge");
    const user = await getUserByTgId(tgId);
    const name = user?.username ? `@${user.username}` : user?.firstName ?? "Someone";

    await ctx.editMessageText(
      `⚔️ *PvP Challenge!*\n\n${name} sent a ${bet} Chips challenge!\n\nGame: 🪙 Coin Flip\nBet: ${bet} Chips\n\nAnyone can accept!`,
      { parse_mode: "Markdown", reply_markup: pvpAcceptMenu(challenge.id) },
    );
  }

  async function handlePvpAccept(ctx: BotContext, tgId: string, challengeId: number) {
    const challenge = await getPvpChallenge(challengeId);
    if (!challenge) return ctx.answerCbQuery("❌ Challenge not found!", { show_alert: true });
    if (challenge.status !== "pending") return ctx.answerCbQuery("❌ Challenge already completed!", { show_alert: true });
    if (challenge.challengerTgId === tgId) return ctx.answerCbQuery("❌ You cannot accept your own challenge!", { show_alert: true });

    const bet = parseFloat(challenge.betAmount);

    // Lock the challenge first so two acceptors can't both proceed
    const accepted = await acceptPvpChallenge(challengeId, tgId, ctx.callbackQuery!.message!.message_id);
    if (!accepted) return ctx.answerCbQuery("❌ Challenge already taken!", { show_alert: true });

    try {
      await deductChips(tgId, bet, "pvp_bet", "PvP accept");
    } catch (e) {
      await reopenPvpChallenge(challengeId);
      if (e instanceof InsufficientChipsError) {
        return ctx.answerCbQuery("❌ Insufficient chips!", { show_alert: true });
      }
      throw e;
    }

    // Send coin flip animation for PvP
    await ctx.telegram.sendDice(ctx.chat!.id, { emoji: "🎯" });
    await delay(3000);

    const flip = Math.random() < 0.5;
    const winnerId = flip ? challenge.challengerTgId : tgId;
    const loserId = flip ? tgId : challenge.challengerTgId;
    const payout = bet * 2 * 0.95;

    await addChips(winnerId, payout, "pvp_win", `PvP won ${challengeId}`);
    await completePvpChallenge(challengeId, winnerId, JSON.stringify({ flip }));

    const winner = await getUserByTgId(winnerId);
    const loser = await getUserByTgId(loserId);
    const winName = winner?.username ? `@${winner.username}` : winner?.firstName ?? "Winner";
    const loseName = loser?.username ? `@${loser.username}` : loser?.firstName ?? "Loser";

    return ctx.editMessageText(
      `⚔️ *PvP Result!*\n\n🪙 Coin: ${flip ? "Heads" : "Tails"}\n\n🏆 *${winName}* wins!\n💰 Payout: ${payout.toFixed(0)} Chips\n\n😔 ${loseName} loses.`,
      { parse_mode: "Markdown" },
    );
  }
}

function helpText(): string {
  return (
    `🎰 *Casino Bot Help*\n\n` +
    `*Commands:*\n` +
    `/start — Main menu\n` +
    `/balance — Check your chips\n` +
    `/games — Show all games\n` +
    `/dice — Play dice\n` +
    `/slots — Play slots\n` +
    `/coinflip — Play coin flip\n` +
    `/blackjack — Play blackjack\n` +
    `/roulette — Play roulette\n` +
    `/crash — Play crash\n` +
    `/plinko — Play plinko\n\n` +
    `*Games:*\n` +
    `🎰 Slots — Match symbols and win!\n` +
    `🎲 Dice — Bet Low/High/Exact number\n` +
    `🪙 Coin Flip — Heads or Tails (1.95x)\n` +
    `🃏 Blackjack — Get closest to 21\n` +
    `🎡 Roulette — Color/Number/Odd-Even\n` +
    `📈 Crash — Cash out at the right time!\n` +
    `🏓 Plinko — Drop the ball and win!\n` +
    `⚔️ PvP — Challenge other players\n\n` +
    `*Deposit/Withdraw:*\n` +
    `Use /deposit in private chat.\n\n` +
    `_Good luck! 🍀_`
  );
}
