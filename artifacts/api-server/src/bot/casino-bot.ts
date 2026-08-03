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
  createAutoDeposit,
  createWithdrawalRequest,
  getDepositAddresses,
  createPvpChallenge,
  acceptPvpChallenge,
  completePvpChallenge,
  getPvpChallenge,
  getUserByTgId,
  reopenPvpChallenge,
  getTransactionById,
  approveTransaction,
  getUserWithdrawals,
  countUserPendingWithdrawals,
  cancelUserWithdrawal,
  bindWithdrawalPayoutId,
  InsufficientChipsError,
} from "./db-helpers";
import { notifyAdmins } from "./bot-notify";
import {
  isNowPaymentsEnabled,
  isNowPaymentsPayoutEnabled,
  createDepositCheckout,
  getPayment,
  isPaymentComplete,
  estimateAmount,
  createPayout,
  NOWPAYMENTS_CURRENCY_MAP,
} from "./nowpayments";

const DEFAULT_DEPOSIT_COINS = [
  { crypto: "usdt_trc20", label: "USDT (TRC20)" },
  { crypto: "usdt_erc20", label: "USDT (ERC20)" },
  { crypto: "btc", label: "Bitcoin (BTC)" },
  { crypto: "eth", label: "Ethereum (ETH)" },
  { crypto: "ton", label: "TON" },
  { crypto: "bnb", label: "BNB (BSC)" },
  { crypto: "ltc", label: "Litecoin (LTC)" },
];

/** Withdrawals are LTC-only. */
const WITHDRAW_COINS = [{ crypto: "ltc", label: "Litecoin (LTC)" }] as const;
const WITHDRAW_CRYPTO = "ltc";
import {
  mainMenu,
  homeMenuText,
  startWelcomeText,
  startWelcomeKeyboard,
  gamesMenu,
  betMenu,
  diceChoiceMenu,
  coinChoiceMenu,
  rouletteChoiceMenu,
  bjActionMenu,
  crashMenu,
  playAgainMenu,
  depositMenu,
  depositAmountMenu,
  withdrawMenu,
  withdrawAmountMenu,
  withdrawConfirmMenu,
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
import { registerChatGames, chatGames, gameGuideText, CASINO_CHAT_GROUP } from "./chat-games/register";

// ─── Session types ─────────────────────────────────────────────────────────────
interface SessionData {
  bjState?: BJState;
  bjBet?: number;
  awaitingDepositCrypto?: string;
  awaitingDepositHash?: boolean;
  awaitingDepositAmount?: boolean;
  depositCryptoAmount?: string;
  /** NOWPayments: waiting for user to type custom USD amount */
  awaitingNpDepositAmount?: boolean;
  awaitingNpDepositCrypto?: string;
  awaitingWithdrawCrypto?: string;
  awaitingWithdrawAddress?: boolean;
  awaitingWithdrawAmount?: boolean;
  withdrawChips?: number;
  pendingWithdrawAddress?: string;
  awaitingRouletteNumber?: number;
  crashPoint?: number;
  crashBet?: number;
  crashCashedOut?: boolean;
  crashMessageId?: number;
  awaitingPvpBet?: boolean;
  pvpBet?: number;
}

/** Soft UI min — gateway may require higher (~$19+). Real min checked per-coin at create time. */
const DEPOSIT_MIN_USD = 1;

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
      await ctx.reply(`💰 *Your Balance*\n\n${chips.toFixed(0)} USD`, {
        parse_mode: "Markdown", reply_markup: mainMenu(),
      });
      return;
    }
    if (payload === "deposit") {
      await showDepositOptions(ctx, true);
      return;
    }
    if (payload === "withdraw") {
      await showWithdrawOptions(ctx, true);
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
    await ctx.reply(homeMenuText(chips, ctx.from?.first_name), {
      parse_mode: "Markdown",
      reply_markup: mainMenu(),
    });
  }

  // ─── /start ─────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const from = ctx.from!;
    const tgId = String(from.id);
    await getOrCreateUser(tgId, from.username, from.first_name, from.last_name);

    if (isGroup(ctx)) {
      const chips = await getChips(tgId);
      return ctx.reply(
        `Enjoy the games!\n\n🏠 *Menu*\nBalance: *$${chips.toFixed(2)}*\n\nPlay right here in the group:`,
        { parse_mode: "Markdown", reply_markup: groupGamesMenu(botUsername) },
      );
    }

    // Clear any leftover custom reply-keyboard (the 🎛 icon next to the mic)
    if (!isGroup(ctx)) {
      try {
        await ctx.reply("\u200B", {
          reply_markup: { remove_keyboard: true },
        });
      } catch { /* ignore */ }
    }

    if (ctx.startPayload) {
      return handleStartPayload(ctx, tgId, ctx.startPayload);
    }

    // Full DiceGamble-style greeting on /start
    await ctx.reply(startWelcomeText(CASINO_CHAT_GROUP), {
      parse_mode: "Markdown",
      reply_markup: startWelcomeKeyboard(CASINO_CHAT_GROUP),
      disable_web_page_preview: true,
    });
  });

  // ─── /balance ───────────────────────────────────────────────────────────
  bot.command("balance", async (ctx) => {
    const tgId = String(ctx.from!.id);
    await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
    // Balance in group — show inline (no private redirect)
    const chips = await getChips(tgId);
    await ctx.reply(
      `💰 *${ctx.from!.first_name}'s Balance*\n\n${chips.toFixed(0)} USD ($${chips.toFixed(0)})`,
      { parse_mode: "Markdown" },
    );
  });

  // ─── /help ──────────────────────────────────────────────────────────────
  bot.command("help", (ctx) => {
    if (isGroup(ctx)) return ctx.reply(helpText(), { parse_mode: "Markdown" });
    return ctx.reply(helpText(), { parse_mode: "Markdown", reply_markup: mainMenu() });
  });

  // ─── /code — referral stub (menu reference) ─────────────────────────────
  bot.command("code", async (ctx) => {
    await ctx.reply(
      `🎁 *Referral codes*\n\nPromo codes are coming soon.\nWhen live: \`/code YOURCODE\``,
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
  });

  // ─── Chat duel games: /dice 1 → mode → race → confirm → bot|player ─────
  // All use real Telegram animated throws (🎲⚽🏀🎯🎳🎰)
  registerChatGames(bot);

  // ─── Classic house games (menu / remaining slash commands) ─────────────
  const gameCommands: Array<[string, string, string, string]> = [
    ["slots",     "game_slots",     "slots",    "🎰 *Slots — Select your bet:*"],
    ["blackjack", "game_blackjack", "bj",       "🃏 *Blackjack — Select your bet:*"],
    ["roulette",  "game_roulette",  "roulette", "🎡 *Roulette — Select your bet:*"],
    ["crash",     "game_crash",     "crash",    "📈 *Crash — Select your bet:*"],
    ["plinko",    "game_plinko",    "plinko",   "🏓 *Plinko — Select your bet:*"],
    ["coin",      "game_coinflip",  "coinflip", "🪙 *Coin Flip — Select your bet:*"],
  ];
  for (const [cmd, _payload, prefix, label] of gameCommands) {
    bot.command(cmd, async (ctx) => {
      const tgId = String(ctx.from!.id);
      await getOrCreateUser(tgId, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);
      // Works in both group AND private — no redirect!
      await ctx.reply(label, { parse_mode: "Markdown", reply_markup: betMenu(prefix) });
    });
  }

  // Coming-soon games listed on /start greeting
  const comingSoon: Array<[string, string]> = [
    ["predict", "🎲 Dice Prediction"],
    ["mines", "💣 Mines"],
    ["tower", "🐒 Monkey Tower"],
    ["crossyroad", "🐔 Crossy Road"],
    ["wheel", "🎰 Wheel"],
    ["revolver", "🔫 Revolver"],
    ["bus", "🃏 Ride the Bus"],
    ["news", "📰 News"],
  ];
  for (const [cmd, title] of comingSoon) {
    bot.command(cmd, async (ctx) => {
      await ctx.reply(
        cmd === "news"
          ? `📰 *News*\n\nNew games and updates drop here first.\nFollow ${CASINO_CHAT_GROUP} for announcements!`
          : `${title} is *coming soon!*\n\nPlay live games now in ${CASINO_CHAT_GROUP} with \`/dice\`.`,
        { parse_mode: "Markdown" },
      );
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
      return ctx.editMessageText(homeMenuText(chips, ctx.from?.first_name), {
        parse_mode: "Markdown",
        reply_markup: mainMenu(),
      });
    }

    if (data === "menu_games") {
      return ctx.editMessageText("🎮 *Play*\n\nChoose a game:", {
        parse_mode: "Markdown",
        reply_markup: gamesMenu(),
      });
    }

    if (data === "menu_bonuses") {
      return ctx.editMessageText(
        `🎁 *Bonuses*\n\n` +
          `Daily / promo bonuses coming soon.\n` +
          `Referral: use \`/code <code>\` when available.\n\n` +
          `Stay tuned!`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Menu", callback_data: "main_menu" }]],
          },
        },
      );
    }

    if (data === "menu_more") {
      return ctx.editMessageText(
        `📁 *More*\n\nPick an option:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📊 My Stats", callback_data: "my_stats" }],
              [{ text: "ℹ️ Help", callback_data: "help" }],
              [{ text: "💰 Balance", callback_data: "balance" }],
              [{ text: "🏠 Menu", callback_data: "main_menu" }],
            ],
          },
        },
      );
    }

    if (data === "menu_settings") {
      const chips = await getChips(tgId);
      return ctx.editMessageText(
        `⚙️ *Settings*\n\n` +
          `Balance: *$${chips.toFixed(2)}* (${chips.toFixed(0)} USD)\n` +
          `Withdraw coin: *LTC only*\n` +
          `Balance shown in USD`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💸 Withdraw", callback_data: "menu_withdraw" }],
              [{ text: "💳 Deposit", callback_data: "menu_deposit" }],
              [{ text: "🏠 Menu", callback_data: "main_menu" }],
            ],
          },
        },
      );
    }

    if (data.startsWith("guide_")) {
      const gameId = data.replace("guide_", "");
      const g = chatGames.find((x) => x.id === gameId);
      if (!g) return ctx.answerCbQuery("Unknown game");
      return ctx.editMessageText(gameGuideText(g), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `💬 Open ${CASINO_CHAT_GROUP}`, url: `https://t.me/${CASINO_CHAT_GROUP.replace("@", "")}` }],
            [{ text: "🔙 Back", callback_data: "menu_games" }],
          ],
        },
      });
    }

    if (data === "balance") {
      const chips = await getChips(tgId);
      return ctx.editMessageText(
        `💰 *Your Balance*\n\n*${chips.toFixed(0)} USD*`,
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
      delete ctx.session.awaitingNpDepositAmount;
      delete ctx.session.awaitingNpDepositCrypto;
      return handleDepositMenu(ctx);
    }
    if (data.startsWith("deposit_crypto_")) {
      const crypto = data.replace("deposit_crypto_", "");
      return handleDepositCryptoSelected(ctx, tgId, crypto);
    }
    if (data.startsWith("deposit_np_") || data.startsWith("deposit_cp_")) {
      const crypto = data.replace(/^deposit_(np|cp)_/, "");
      return showDepositAmountPicker(ctx, crypto);
    }
    if (data.startsWith("deposit_custom_")) {
      const crypto = data.replace("deposit_custom_", "");
      ctx.session.awaitingNpDepositCrypto = crypto;
      ctx.session.awaitingNpDepositAmount = true;
      const label =
        DEFAULT_DEPOSIT_COINS.find((c) => c.crypto === crypto)?.label ?? crypto.toUpperCase();
      return ctx.editMessageText(
        `✏️ <b>Custom Deposit — ${label}</b>\n\n` +
          `Type any USD amount you want to deposit.\n` +
          `Min: <b>$${DEPOSIT_MIN_USD}</b>\n\n` +
          `Example: <code>15</code> or <code>37.5</code>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back", callback_data: `deposit_crypto_${crypto}` }]],
          },
        },
      );
    }
    if (data.startsWith("deposit_amt_")) {
      // deposit_amt_<crypto>_<amount>  crypto may contain underscores
      const rest = data.replace("deposit_amt_", "");
      const amountStr = rest.split("_").pop()!;
      const crypto = rest.slice(0, rest.length - amountStr.length - 1);
      const amount = parseFloat(amountStr);
      delete ctx.session.awaitingNpDepositAmount;
      delete ctx.session.awaitingNpDepositCrypto;
      return handleNowPaymentsDeposit(ctx, tgId, crypto, amount);
    }
    if (data.startsWith("deposit_check_")) {
      const txId = parseInt(data.replace("deposit_check_", ""), 10);
      return handleDepositStatusCheck(ctx, tgId, txId);
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
      // clear any mid-flow withdraw session
      delete ctx.session.awaitingWithdrawCrypto;
      delete ctx.session.awaitingWithdrawAmount;
      delete ctx.session.awaitingWithdrawAddress;
      delete ctx.session.withdrawChips;
      delete ctx.session.pendingWithdrawAddress;
      return handleWithdrawMenu(ctx);
    }
    if (data.startsWith("withdraw_crypto_")) {
      const crypto = data.replace("withdraw_crypto_", "");
      return handleWithdrawCryptoSelected(ctx, tgId, crypto);
    }
    if (data.startsWith("withdraw_amt_")) {
      const rest = data.replace("withdraw_amt_", "");
      const amountStr = rest.split("_").pop()!;
      const crypto = rest.slice(0, rest.length - amountStr.length - 1);
      return handleWithdrawAmountPicked(ctx, tgId, crypto, amountStr);
    }
    if (data.startsWith("withdraw_custom_")) {
      const crypto = data.replace("withdraw_custom_", "");
      if (crypto !== WITHDRAW_CRYPTO) {
        return ctx.answerCbQuery("❌ Withdrawals are LTC only.", { show_alert: true });
      }
      ctx.session.awaitingWithdrawCrypto = crypto;
      ctx.session.awaitingWithdrawAmount = true;
      const bal = await getChips(tgId);
      return ctx.editMessageText(
        `✏️ <b>Custom Withdraw — ${crypto.toUpperCase()}</b>\n\n` +
          `Balance: <b>${bal.toFixed(0)} USD</b>\nMin: <b>$5</b>\n\n` +
          `Type how many USD to withdraw:`,
        { parse_mode: "HTML" },
      );
    }
    if (data.startsWith("withdraw_confirm_")) {
      return handleWithdrawConfirm(ctx, tgId);
    }
    if (data === "withdraw_history") {
      return handleWithdrawHistory(ctx, tgId);
    }
    if (data.startsWith("withdraw_cancel_")) {
      const txId = parseInt(data.replace("withdraw_cancel_", ""), 10);
      return handleWithdrawCancel(ctx, tgId, txId);
    }

    // ── Game: Slots ──────────────────────────────────────────────────────
    if (data === "game_slots") {
      return ctx.editMessageText("🎰 *Slots — Select your bet:*", {
        parse_mode: "Markdown",
        reply_markup: betMenu("slots"),
      });
    }
    if (data.startsWith("slots_bet_")) return handleSlotsPlay(ctx, tgId, data);

    // ── Dice → chat duel guide (real 🎲 animation in group) ──────────────
    if (
      data === "game_dice" ||
      data.startsWith("dice_bet_") ||
      data.startsWith("dice_choice_")
    ) {
      const g = chatGames.find((x) => x.id === "dice")!;
      return ctx.editMessageText(gameGuideText(g), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `Open ${CASINO_CHAT_GROUP}`, url: `https://t.me/${CASINO_CHAT_GROUP.replace("@", "")}` }],
            [{ text: "Back", callback_data: "menu_games" }],
          ],
        },
      });
    }
    // House coin flip (text game — Telegram has no coin animation emoji)
    if (data === "game_coinflip") {
      return ctx.editMessageText("Coin Flip — Select your bet:", {
        reply_markup: betMenu("coinflip"),
      });
    }
    if (data.startsWith("coinflip_bet_")) {
      const bet = parseInt(data.replace("coinflip_bet_", ""), 10);
      return ctx.editMessageText(`Coin Flip — Bet ${bet}\nPick a side:`, {
        reply_markup: coinChoiceMenu(bet),
      });
    }
    if (data.startsWith("coin_choice_")) {
      return handleCoinPlay(ctx, tgId, data);
    }

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
        return ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });
      }
      return ctx.editMessageText(
        `🎡 *Roulette — Bet: ${bet} USD*\n\nWhere do you want to place your bet?`,
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

    // NOWPayments custom USD amount (any value the user wants)
    if (sess.awaitingNpDepositAmount && sess.awaitingNpDepositCrypto) {
      const cleaned = text.replace(/[$,\s]/g, "");
      const amount = parseFloat(cleaned);
      if (!Number.isFinite(amount) || amount <= 0) {
        await ctx.reply("❌ Enter a valid USD amount, e.g. `25` or `12.5`", { parse_mode: "Markdown" });
        return;
      }
      if (amount < DEPOSIT_MIN_USD) {
        await ctx.reply(`❌ Minimum deposit is *$${DEPOSIT_MIN_USD} USD*.`, { parse_mode: "Markdown" });
        return;
      }
      if (amount > 1_000_000) {
        await ctx.reply("❌ Amount too large. Enter a smaller USD amount.");
        return;
      }
      const crypto = sess.awaitingNpDepositCrypto;
      sess.awaitingNpDepositAmount = false;
      delete sess.awaitingNpDepositCrypto;
      await handleNowPaymentsDeposit(ctx, tgId, crypto, amount);
      return;
    }

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
      if (estimatedChips < DEPOSIT_MIN_USD) {
        await ctx.reply(
          `❌ Minimum deposit is *$${DEPOSIT_MIN_USD} USD*.\n\nYour amount would give ${estimatedChips.toFixed(2)} USD.`,
          { parse_mode: "Markdown" },
        );
        return;
      }
      sess.awaitingDepositAmount = false;
      const crypto = sess.awaitingDepositCrypto!;
      delete sess.awaitingDepositCrypto;
      try {
        const walletAddress = cryptoAddr?.address ?? "unknown";
        const tx = await createDepositRequest(tgId, crypto, text, hash, walletAddress);
        await ctx.reply(
          `📥 *Deposit Request Submitted!*\n\nID: #${tx.id}\nCrypto: ${crypto.toUpperCase()}\nAmount: ${amount} → ~${estimatedChips.toFixed(0)} USD 💰\n\n💵 Rate: Balance shown in USD\n\nAdmin will verify and credit your USD. 🙏`,
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
      } catch {
        await ctx.reply("❌ An error occurred. Please try again.");
      }
      return;
    }

    if (sess.awaitingWithdrawAmount) {
      const chips = parseInt(text, 10);
      if (isNaN(chips) || chips <= 0) { await ctx.reply("❌ Please enter a valid USD amount"); return; }
      if (chips < 5) { await ctx.reply("❌ Minimum withdrawal is <b>$5 USD</b>.", { parse_mode: "HTML" }); return; }
      const balance = await getChips(tgId);
      if (chips > balance) { await ctx.reply(`❌ Insufficient USD. Balance: ${balance.toFixed(0)}`); return; }
      sess.awaitingWithdrawAmount = false;
      sess.awaitingWithdrawAddress = true;
      sess.withdrawChips = chips;
      await ctx.reply(
        `✅ Amount: <b>${chips} USD ($${chips})</b>\n\n` +
          `Now paste your <b>${sess.awaitingWithdrawCrypto?.toUpperCase()}</b> wallet address:`,
        { parse_mode: "HTML" },
      );
      return;
    }

    if (sess.awaitingWithdrawAddress) {
      const address = text.trim();
      if (address.length < 8 || address.includes(" ")) {
        await ctx.reply("❌ Invalid wallet address. Please paste a valid address.");
        return;
      }
      const crypto = sess.awaitingWithdrawCrypto!;
      const chips = sess.withdrawChips!;
      sess.awaitingWithdrawAddress = false;
      sess.pendingWithdrawAddress = address;
      await ctx.reply(
        `📤 <b>Confirm Withdrawal</b>\n\n` +
          `Amount: <b>${chips} USD ($${chips})</b>\n` +
          `Crypto: <b>${crypto.toUpperCase()}</b>\n` +
          `Address:\n<code>${address}</code>\n\n` +
          `⚠️ USD will be locked until admin pays or rejects.`,
        { parse_mode: "HTML", reply_markup: withdrawConfirmMenu(crypto) },
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
    let statsText = `📊 *Your Stats*\n\n💰 Balance: *${chips.toFixed(0)} USD*\n\n🎮 *Last 5 Games:*\n`;
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

  function depositCryptoLabel(crypto: string, adminLabel?: string | null): string {
    return (
      adminLabel ||
      DEFAULT_DEPOSIT_COINS.find((c) => c.crypto === crypto)?.label ||
      crypto.toUpperCase()
    );
  }

  async function showDepositAmountPicker(ctx: BotContext, crypto: string) {
    const addresses = await getDepositAddresses();
    const addr = addresses.find((a) => a.crypto === crypto);
    const label = depositCryptoLabel(crypto, addr?.label);
    delete ctx.session.awaitingNpDepositAmount;
    delete ctx.session.awaitingNpDepositCrypto;
    return ctx.editMessageText(
      `💵 *Deposit — ${label}*\n\n` +
        `Pick an amount, or tap *Custom amount*.\n` +
        `Min: *$${DEPOSIT_MIN_USD} USD*\n\n` +
        `Next step: send crypto to the address we show you.`,
      { parse_mode: "Markdown", reply_markup: depositAmountMenu(crypto) },
    );
  }

  async function showDepositOptions(ctx: BotContext, asReply = false) {
    const addresses = await getDepositAddresses();
    const npOn = isNowPaymentsEnabled();

    // Auto deposits: always show full coin list. Manual-only: admin addresses.
    const options = npOn
      ? DEFAULT_DEPOSIT_COINS.map((c) => {
          const admin = addresses.find((a) => a.crypto === c.crypto);
          return { crypto: c.crypto, label: admin?.label ?? c.label };
        })
      : addresses.map((a) => ({ crypto: a.crypto, label: a.label }));

    if (options.length === 0) {
      const text = "⚠️ No deposit methods configured yet. Please contact the admin.";
      return asReply
        ? ctx.reply(text, { reply_markup: mainMenu() })
        : ctx.editMessageText(text, { reply_markup: mainMenu() });
    }

    const text =
      "📥 *Deposit*\n\n" +
      "1) Pick a crypto\n" +
      "2) Enter amount\n" +
      "3) Send to the address shown\n" +
      "4) USD credits automatically after confirm\n\n" +
      `💵 Min: *$${DEPOSIT_MIN_USD} USD*\n` +
      "📤 Withdrawals: *LTC only*";

    const markup = depositMenu(options, { showManualConfirm: addresses.length > 0 && !npOn });
    return asReply
      ? ctx.reply(text, { parse_mode: "Markdown", reply_markup: markup })
      : ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: markup });
  }

  async function handleDepositMenu(ctx: BotContext) {
    return showDepositOptions(ctx, false);
  }

  async function handleDepositCryptoSelected(ctx: BotContext, tgId: string, crypto: string) {
    const addresses = await getDepositAddresses();
    const addr = addresses.find(a => a.crypto === crypto);
    const label = depositCryptoLabel(crypto, addr?.label);

    ctx.session.awaitingDepositCrypto = crypto;

    const npCurrency = NOWPAYMENTS_CURRENCY_MAP[crypto];
    const npAvailable = isNowPaymentsEnabled() && !!npCurrency;

    // Clean flow: crypto → amount → address (no gateway name / no method picker)
    if (npAvailable) {
      return showDepositAmountPicker(ctx, crypto);
    }

    if (!addr?.address) {
      return ctx.answerCbQuery("❌ This crypto is not available for deposit right now.", { show_alert: true });
    }

    return ctx.editMessageText(
      `📥 <b>Deposit — ${label}</b>\n\n` +
        `Network: ${addr.network ?? label}\n` +
        `Min: <b>$${DEPOSIT_MIN_USD}</b>\n\n` +
        `📬 Send to this address:\n<code>${addr.address}</code>\n\n` +
        `After sending, tap Confirm and paste your TX hash.`,
      {
        parse_mode: "HTML",
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
    if (!addr?.address) return ctx.answerCbQuery("❌ Address not found", { show_alert: true });
    ctx.session.awaitingDepositCrypto = crypto;
    return ctx.editMessageText(
      `📥 <b>Manual Deposit — ${addr.label}</b>\n\n` +
        `Network: ${addr.network ?? addr.label}\n` +
        `Min: <b>$${DEPOSIT_MIN_USD}</b> — any amount you want\n\n` +
        `📬 Address:\n<code>${addr.address}</code>\n\n` +
        `Send funds, then tap Confirm and paste TX hash.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Confirm Deposit", callback_data: "deposit_confirm" }],
            [{ text: "🔙 Back", callback_data: `deposit_crypto_${crypto}` }],
          ],
        },
      },
    );
  }

  async function handleNowPaymentsDeposit(
    ctx: BotContext,
    tgId: string,
    crypto: string,
    amountUsd = DEPOSIT_MIN_USD,
  ): Promise<void> {
    const addresses = await getDepositAddresses();
    const addr = addresses.find(a => a.crypto === crypto);
    const label = depositCryptoLabel(crypto, addr?.label);

    const payCurrency = NOWPAYMENTS_CURRENCY_MAP[crypto];
    if (!payCurrency) {
      try {
        await ctx.answerCbQuery("❌ This crypto is not available.", { show_alert: true });
      } catch { /* text path */ }
      return;
    }

    const priceUsd = Math.round(Math.max(DEPOSIT_MIN_USD, amountUsd) * 100) / 100;
    const orderId = `dep-${tgId}-${Date.now()}`;

    const sendHtml = async (
      html: string,
      markup?: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> },
    ) => {
      const opts = { parse_mode: "HTML" as const, ...(markup ? { reply_markup: markup } : {}) };
      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(html, opts);
          return;
        } catch { /* fall through */ }
      }
      await ctx.reply(html, opts);
    };

    const showAddressCard = async (opts: {
      payAmount: string | number;
      payAddress: string;
      network?: string;
      paymentId: string;
      txId: number;
    }) => {
      await sendHtml(
        `📥 <b>Deposit — ${label}</b>\n\n` +
          `💵 You pay for: <b>$${priceUsd.toFixed(2)} USD</b>\n` +
          `🪙 Send exactly: <b>${opts.payAmount} ${payCurrency.toUpperCase()}</b>\n\n` +
          `📬 Address:\n<code>${opts.payAddress}</code>\n\n` +
          `Network: ${opts.network ?? addr?.network ?? label}\n` +
          `Deposit ID: #${opts.txId}\n\n` +
          `✅ After payment confirms, USD is added automatically.\n` +
          `🔔 You'll get a Telegram notification.`,
        {
          inline_keyboard: [
            [{ text: "🔄 Check Status", callback_data: `deposit_check_${opts.txId}` }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
          ],
        },
      );
    };

    await sendHtml(`⏳ Preparing <b>${label}</b> deposit for <b>$${priceUsd.toFixed(2)}</b>…`);

    try {
      const checkout = await createDepositCheckout(
        payCurrency,
        priceUsd,
        orderId,
        `Casino deposit — ${label} — user ${tgId}`,
      );

      const payment = checkout.payment;
      const paymentId = String(payment.payment_id);
      const payAmount = payment.pay_amount ?? priceUsd;
      const payAddress = payment.pay_address;
      if (!payAddress) {
        throw new Error("Empty deposit address from gateway");
      }

      const tx = await createAutoDeposit(
        tgId,
        crypto,
        String(payAmount),
        paymentId,
        payAddress,
        orderId,
      );
      await showAddressCard({
        payAmount,
        payAddress,
        network: payment.network ?? undefined,
        paymentId,
        txId: tx.id,
      });
    } catch (e) {
      logger.warn({ e, crypto, priceUsd, tgId }, "Deposit address create failed");
      const raw = e instanceof Error ? e.message : String(e);
      // Strip internal gateway wording for users
      const nice = raw
        .replace(/NOWPayments[^\n]*/gi, "")
        .replace(/API error \(\d+\):\s*/gi, "")
        .trim() || "Please try again.";
      await sendHtml(
        `❌ <b>Could not create deposit address</b>\n\n` +
          `${nice}\n\n` +
          `Tip: try <b>$20+</b> (network minimum) or another crypto.`,
        {
          inline_keyboard: [
            [{ text: "🔄 Try Again", callback_data: `deposit_crypto_${crypto}` }],
            [{ text: "🔙 Back", callback_data: "menu_deposit" }],
          ],
        },
      );
    }
  }

  async function handleDepositStatusCheck(ctx: BotContext, tgId: string, txId: number): Promise<void> {
    const tx = await getTransactionById(txId);
    if (!tx || tx.status !== "pending") {
      const chips = await getChips(tgId);
      await ctx.answerCbQuery(
        tx?.status === "approved" ? `✅ Already credited! Balance: ${chips.toFixed(0)} USD` : "Deposit not pending",
        { show_alert: true },
      );
      return;
    }

    if (!tx.txHash || tx.txHash.startsWith("inv-")) {
      await ctx.answerCbQuery(
        "Still waiting for payment. Send the exact amount to the address shown.",
        { show_alert: true },
      );
      return;
    }

    const payment = await getPayment(tx.txHash);
    if (!payment) {
      await ctx.answerCbQuery("Could not check status yet. Try again shortly.", { show_alert: true });
      return;
    }

    if (isPaymentComplete(payment.payment_status)) {
      const priceUsd = Math.floor(parseFloat(String(payment.price_amount ?? "0")));
      const chips = priceUsd > 0 ? priceUsd : Math.floor(parseFloat(String(payment.actually_paid ?? "0")));
      try {
        await approveTransaction(tx.id, chips);
        await ctx.editMessageText(
          `✅ <b>Deposit Confirmed!</b>\n\n` +
            `💵 <b>$${chips} USD</b> added to your balance.\n` +
            `Deposit #${tx.id}`,
          { parse_mode: "HTML", reply_markup: mainMenu() },
        );
      } catch (e) {
        await ctx.answerCbQuery(`Still processing. ${String(e)}`, { show_alert: true });
      }
      return;
    }

    const paid = payment.actually_paid ?? 0;
    const need = payment.pay_amount ?? "?";
    await ctx.answerCbQuery(
      `Waiting for payment… Received ${paid} / ${need}`,
      { show_alert: true },
    );
  }

  async function handleDepositConfirmStart(ctx: BotContext, tgId: string): Promise<void> {
    if (!ctx.session.awaitingDepositCrypto) {
      await ctx.editMessageText("Please select a crypto first.", { reply_markup: { inline_keyboard: [[{ text: "📥 Deposit", callback_data: "menu_deposit" }]] } });
      return;
    }
    ctx.session.awaitingDepositHash = true;
    await ctx.editMessageText(`✍️ Please paste your Transaction Hash / TXID:`, { reply_markup: undefined });
  }

  async function showWithdrawOptions(ctx: BotContext, asReply = false) {
    const tgId = String(ctx.from!.id);
    const bal = await getChips(tgId);
    const pending = await countUserPendingWithdrawals(tgId);

    const text =
      `📤 <b>Withdraw Winnings</b>\n\n` +
      `💰 Balance: <b>${bal.toFixed(0)} USD</b> ($${bal.toFixed(0)})\n` +
      `⏳ Pending withdrawals: <b>${pending}</b>\n` +
      `💵 Min withdraw: <b>$5</b>\n` +
      `🪙 Coin: <b>LTC only</b>\n` +
      `🪙 Payout coin: <b>Litecoin (LTC) only</b>\n\n` +
      `Tap below to continue:`;

    const markup = withdrawMenu([...WITHDRAW_COINS]);
    return asReply
      ? ctx.reply(text, { parse_mode: "HTML", reply_markup: markup })
      : ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: markup });
  }

  async function handleWithdrawMenu(ctx: BotContext) {
    return showWithdrawOptions(ctx, false);
  }

  async function handleWithdrawCryptoSelected(ctx: BotContext, tgId: string, crypto: string) {
    if (crypto !== WITHDRAW_CRYPTO) {
      return ctx.answerCbQuery("❌ Withdrawals are LTC only.", { show_alert: true });
    }
    const chips = await getChips(tgId);
    if (chips < 5) {
      return ctx.answerCbQuery("❌ Minimum withdrawal is $5. Win more USD first!", { show_alert: true });
    }
    ctx.session.awaitingWithdrawCrypto = crypto;
    delete ctx.session.awaitingWithdrawAmount;
    delete ctx.session.awaitingWithdrawAddress;
    delete ctx.session.withdrawChips;
    delete ctx.session.pendingWithdrawAddress;

    const label = DEFAULT_DEPOSIT_COINS.find(c => c.crypto === crypto)?.label ?? crypto.toUpperCase();
    return ctx.editMessageText(
      `📤 <b>Withdraw — ${label}</b>\n\n` +
        `💰 Balance: <b>${chips.toFixed(0)} USD</b>\n` +
        `Min: <b>$5</b>\n\n` +
        `Select amount:`,
      { parse_mode: "HTML", reply_markup: withdrawAmountMenu(crypto, chips) },
    );
  }

  async function handleWithdrawAmountPicked(
    ctx: BotContext,
    tgId: string,
    crypto: string,
    amountStr: string,
  ) {
    if (crypto !== WITHDRAW_CRYPTO) {
      return ctx.answerCbQuery("❌ Withdrawals are LTC only.", { show_alert: true });
    }
    const bal = await getChips(tgId);
    const chips = amountStr === "all" ? Math.floor(bal) : parseInt(amountStr, 10);
    if (!chips || chips < 5) {
      return ctx.answerCbQuery("❌ Minimum withdrawal is $5", { show_alert: true });
    }
    if (chips > bal) {
      return ctx.answerCbQuery(`❌ Insufficient USD. Balance: ${bal.toFixed(0)}`, { show_alert: true });
    }

    ctx.session.awaitingWithdrawCrypto = crypto;
    ctx.session.withdrawChips = chips;
    ctx.session.awaitingWithdrawAddress = true;
    ctx.session.awaitingWithdrawAmount = false;

    const label = DEFAULT_DEPOSIT_COINS.find(c => c.crypto === crypto)?.label ?? crypto.toUpperCase();
    return ctx.editMessageText(
      `📤 <b>Withdraw — ${label}</b>\n\n` +
        `Amount: <b>${chips} USD ($${chips})</b>\n\n` +
        `Paste your <b>${label}</b> wallet address:`,
      { parse_mode: "HTML" },
    );
  }

  async function handleWithdrawConfirm(ctx: BotContext, tgId: string) {
    const crypto = ctx.session.awaitingWithdrawCrypto;
    const chips = ctx.session.withdrawChips;
    const address = ctx.session.pendingWithdrawAddress;

    if (!crypto || !chips || !address) {
      return ctx.answerCbQuery("❌ Withdrawal session expired. Start again.", { show_alert: true });
    }
    if (crypto !== WITHDRAW_CRYPTO) {
      return ctx.answerCbQuery("❌ Withdrawals are LTC only.", { show_alert: true });
    }

    const pending = await countUserPendingWithdrawals(tgId);
    if (pending >= 3) {
      return ctx.answerCbQuery("❌ You already have 3 pending withdrawals. Wait for admin.", { show_alert: true });
    }

    try {
      await deductChips(tgId, chips, "withdrawal_pending", `Withdrawal to ${address}`);
    } catch (e) {
      if (e instanceof InsufficientChipsError) {
        return ctx.answerCbQuery("❌ Insufficient USD", { show_alert: true });
      }
      throw e;
    }

    const tx = await createWithdrawalRequest(tgId, chips, crypto, address);
    const user = await getUserByTgId(tgId);
    const uname = user?.username ? `@${user.username}` : user?.firstName ?? tgId;

    delete ctx.session.awaitingWithdrawCrypto;
    delete ctx.session.withdrawChips;
    delete ctx.session.pendingWithdrawAddress;
    delete ctx.session.awaitingWithdrawAddress;

    let autoPayoutLine = "🔒 USD locked. Admin will pay soon.";
    let payoutStarted = false;

    // Optional: auto on-chain payout via NOWPayments mass payouts (JWT)
    if (isNowPaymentsPayoutEnabled()) {
      try {
        const npCurrency = NOWPAYMENTS_CURRENCY_MAP[crypto] ?? crypto;
        const cryptoAmt = await estimateAmount(chips, "usd", npCurrency);
        if (cryptoAmt && cryptoAmt > 0) {
          const payout = await createPayout({
            address,
            currency: npCurrency,
            amountCrypto: cryptoAmt,
            uniqueExternalId: `wd-${tx.id}`,
          });
          const payoutId = payout?.withdrawal?.id ?? payout?.withdrawal?.withdrawal_id ?? payout?.batchId;
          if (payoutId) {
            await bindWithdrawalPayoutId(tx.id, String(payoutId), String(cryptoAmt));
            payoutStarted = true;
            autoPayoutLine =
              `⚡ Auto payout started via NOWPayments (~${cryptoAmt} ${npCurrency.toUpperCase()}).\n` +
              `You'll be notified when it confirms on-chain.`;
          }
        }
      } catch (e) {
        logger.warn({ e, txId: tx.id }, "NOWPayments auto payout failed — admin will pay manually");
        autoPayoutLine =
          "⚡ Auto payout unavailable right now. Admin will pay manually.";
      }
    }

    // Notify admins with approve/reject buttons
    await notifyAdmins(
      `📤 <b>New Withdrawal Request</b>\n\n` +
        `ID: <b>#${tx.id}</b>\n` +
        `User: ${uname} (<code>${tgId}</code>)\n` +
        `Amount: <b>${chips} USD ($${chips})</b>\n` +
        `Crypto: <b>${crypto.toUpperCase()}</b>\n` +
        `Address:\n<code>${address}</code>\n\n` +
        (payoutStarted
          ? `⚡ NOWPayments auto-payout queued. Confirm/2FA in dashboard if required.`
          : `Send crypto, then tap Paid.`),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `✅ Paid #${tx.id}`, callback_data: `admin_approve_${tx.id}` },
              { text: `❌ Reject #${tx.id}`, callback_data: `admin_reject_${tx.id}` },
            ],
            [{ text: "👤 User", callback_data: `admin_user_${tgId}` }],
          ],
        },
      },
    );

    const newBal = await getChips(tgId);
    return ctx.editMessageText(
      `✅ <b>Withdrawal Submitted!</b>\n\n` +
        `Request ID: <b>#${tx.id}</b>\n` +
        `Amount: <b>${chips} USD ($${chips})</b>\n` +
        `Crypto: <b>${crypto.toUpperCase()}</b>\n` +
        `Address:\n<code>${address}</code>\n\n` +
        `${autoPayoutLine}\n` +
        `💼 Remaining balance: <b>${newBal.toFixed(0)} USD</b>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📜 My Withdrawals", callback_data: "withdraw_history" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
          ],
        },
      },
    );
  }

  async function handleWithdrawHistory(ctx: BotContext, tgId: string) {
    const list = await getUserWithdrawals(tgId, 10);
    if (list.length === 0) {
      return ctx.editMessageText("📭 No withdrawals yet.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📤 Withdraw Now", callback_data: "menu_withdraw" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
          ],
        },
      });
    }

    let msg = `📜 <b>Your Withdrawals</b>\n\n`;
    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const t of list) {
      const status =
        t.status === "pending" ? "⏳ Pending" :
        t.status === "approved" ? "✅ Paid" : "❌ Rejected";
      msg += `#${t.id} — <b>${parseFloat(t.amount).toFixed(0)}</b> ${t.crypto?.toUpperCase() ?? ""} — ${status}\n`;
      if (t.walletAddress) msg += `  <code>${t.walletAddress.slice(0, 28)}...</code>\n`;
      if (t.status === "pending") {
        keyboard.push([{ text: `❌ Cancel #${t.id}`, callback_data: `withdraw_cancel_${t.id}` }]);
      }
    }
    keyboard.push([{ text: "📤 New Withdraw", callback_data: "menu_withdraw" }]);
    keyboard.push([{ text: "🏠 Main Menu", callback_data: "main_menu" }]);

    return ctx.editMessageText(msg, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async function handleWithdrawCancel(ctx: BotContext, tgId: string, txId: number) {
    try {
      const tx = await cancelUserWithdrawal(tgId, txId);
      const bal = await getChips(tgId);
      await ctx.answerCbQuery("✅ Cancelled — USD refunded", { show_alert: true });
      return ctx.editMessageText(
        `❌ Withdrawal <b>#${tx.id}</b> cancelled.\n` +
          `💸 <b>${parseFloat(tx.amount).toFixed(0)} USD</b> refunded.\n` +
          `💼 Balance: <b>${bal.toFixed(0)} USD</b>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📜 My Withdrawals", callback_data: "withdraw_history" }],
              [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
            ],
          },
        },
      );
    } catch (e) {
      return ctx.answerCbQuery(`❌ ${String(e)}`, { show_alert: true });
    }
  }

  // ─── SLOTS ─── with 🎰 Telegram dice animation ──────────────────────────
  async function handleSlotsPlay(ctx: BotContext, tgId: string, data: string) {
    const parts = data.split("_");
    const betStr = parts[parts.length - 1]!;
    const chips = await getChips(tgId);
    const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);

    if (bet <= 0 || chips < bet) {
      return ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });
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
    const msg = `${result.display}\n\nBet: ${bet} 💰\n${result.multiplier > 0 ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} USD`;

    return ctx.reply(msg, { reply_markup: playAgainMenu("slots") });
  }

  // ─── DICE ─── with 🎲 Telegram dice animation ───────────────────────────
  async function handleDicePlay(ctx: BotContext, tgId: string, data: string) {
    // format: dice_choice_{type}_{bet}
    const parts = data.split("_");
    const bet = parseInt(parts[parts.length - 1]!, 10);
    const betType = parts[parts.length - 2]! as DiceBetType;

    const chips = await getChips(tgId);
    if (chips < bet) return ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });

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
    const msg = `${result.display}\n\nBet: ${bet} 💰\n${result.won ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} USD`;

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
    if (chips < bet) return ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });

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
    const msg = `${result.display}\n\nBet: ${bet} 💰\n${result.won ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} USD`;

    return ctx.reply(msg, { reply_markup: playAgainMenu("coinflip") });
  }

  // ─── BLACKJACK ──────────────────────────────────────────────────────────
  async function handleBJStart(ctx: BotContext, tgId: string, data: string) {
    const parts = data.split("_");
    const betStr = parts[parts.length - 1]!;
    const chips = await getChips(tgId);
    const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);

    if (bet <= 0 || chips < bet) {
      return ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });
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
        `\n\nBet: ${bet} 💰\n${gameResult === "win" ? `Win: +${payout.toFixed(0)} 💰` : gameResult === "push" ? "Draw — refund!" : `Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} USD`;

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
        return ctx.answerCbQuery("❌ Not enough USD to double!", { show_alert: true });
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
        `\n\nBet: ${sess.bjBet} 💰\n${gameResult === "win" ? `Win: +${payout.toFixed(0)} 💰` : gameResult === "push" ? "Draw — refund!" : `Loss: -${sess.bjBet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} USD`;

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
    if (chips < bet) { await ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true }); return; }

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
    if (chips < betAmt) { await ctx.reply("❌ Insufficient USD!"); return; }

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
    const msg = `${result.display}\n\nBet: ${betAmt} 💰\n${result.won ? `Win: +${payout.toFixed(0)} 💰` : `Loss: -${betAmt} 💰`}\n💼 Balance: ${newBal.toFixed(0)} USD`;

    await ctx.reply(msg, { reply_markup: playAgainMenu("roulette") });
  }

  // ─── CRASH ──────────────────────────────────────────────────────────────
  async function handleCrashStart(ctx: BotContext, tgId: string, data: string): Promise<void> {
    const parts = data.split("_");
    const betStr = parts[parts.length - 1]!;
    const chips = await getChips(tgId);
    const bet = betStr === "allin" ? Math.floor(chips) : parseInt(betStr, 10);

    if (bet <= 0 || chips < bet) {
      await ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });
      return;
    }

    const key = `${tgId}_crash`;
    const existing = activeCrash.get(key);
    if (existing) {
      // Refund abandoned round so USD aren't lost
      clearInterval(existing.interval);
      activeCrash.delete(key);
      await addChips(tgId, existing.bet, "game_win", "Crash abandoned refund");
    }

    await deductChips(tgId, bet, "game_loss", "Crash bet");
    const crashPoint = generateCrashPoint();

    await ctx.editMessageText(
      `📈 *Crash Game* — Bet: ${bet} USD\n\n` +
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
            `📈 *Crash Game*\n\n💥 CRASHED at ${crashPoint}x!\n\nBet: ${bet} 💰\nLoss: -${bet} 💰\n💼 Balance: ${newBal.toFixed(0)} USD`,
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
          `📈 *Crash Game* — Bet: ${bet} USD\n\n` +
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
      `📈 *Crash Game*\n\nCashed out at: ${cashedOutAt}x\nCrash was at: ${crashPoint}x\n\nBet: ${bet} 💰\n${result.won ? `✅ Win: +${payout.toFixed(0)} 💰` : `❌ Loss: -${bet} 💰`}\n💼 Balance: ${newBal.toFixed(0)} USD`,
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
      return ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });
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
      `${result.display}\n\nBet: ${bet} 💰\nPayout: ${payout.toFixed(0)} 💰\n${payout >= bet ? "✅" : "❌"} Net: ${(payout - bet).toFixed(0)} 💰\n💼 Balance: ${newBal.toFixed(0)} USD`;

    return ctx.reply(msg, {
      parse_mode: "Markdown",
      reply_markup: playAgainMenu("plinko"),
    });
  }

  // ─── PvP ────────────────────────────────────────────────────────────────
  async function handlePvpChallenge(ctx: BotContext, tgId: string, bet: number): Promise<void> {
    const chips = await getChips(tgId);
    if (chips < bet) { await ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true }); return; }

    const chatId = String(ctx.chat!.id);
    const challenge = await createPvpChallenge(tgId, "coinflip", bet, chatId);

    await deductChips(tgId, bet, "pvp_bet", "PvP challenge");
    const user = await getUserByTgId(tgId);
    const name = user?.username ? `@${user.username}` : user?.firstName ?? "Someone";

    await ctx.editMessageText(
      `⚔️ *PvP Challenge!*\n\n${name} sent a ${bet} USD challenge!\n\nGame: 🪙 Coin Flip\nBet: ${bet} USD\n\nAnyone can accept!`,
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
        return ctx.answerCbQuery("❌ Insufficient USD!", { show_alert: true });
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
      `⚔️ *PvP Result!*\n\n🪙 Coin: ${flip ? "Heads" : "Tails"}\n\n🏆 *${winName}* wins!\n💰 Payout: ${payout.toFixed(0)} USD\n\n😔 ${loseName} loses.`,
      { parse_mode: "Markdown" },
    );
  }
}

function helpText(): string {
  return (
    `🎰 *Casino Bot Help*\n\n` +
    `*Chat Duels* (real Telegram animations only):\n` +
    `/chatgames — list\n` +
    `🎲 /dice · ⚽ /football · 🏀 /basketball\n` +
    `🎯 /dart · 🎳 /bowling · 🎰 /spin\n` +
    `⚽ /goal · 🏀 /hoop · 🎯 /bullseye · 🎳 /strike\n` +
    `Flow: Mode → First to 1/2/3 → Confirm → Bot/Player\n` +
    `Min bet *1* · Win pays *1.9x* always\n\n` +
    `*Classic house games:*\n` +
    `/slots /blackjack /roulette /crash /plinko\n` +
    `/games — open games menu\n\n` +
    `*Wallet:*\n` +
    `/balance /deposit /withdraw\n` +
    `Withdrawals: *LTC only*\n\n` +
    `Group: ${CASINO_CHAT_GROUP}\n` +
    `_Good luck! 🍀_`
  );
}
