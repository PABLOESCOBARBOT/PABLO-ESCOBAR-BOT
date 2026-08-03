import type { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import {
  getOrCreateUser,
  getChips,
  deductChips,
  addChips,
  recordGame,
  InsufficientChipsError,
} from "../db-helpers";
import { editMsg, sleep } from "./animate";
import { chatStore } from "./store";
import {
  modeKeyboard,
  raceKeyboard,
  confirmKeyboard,
  opponentKeyboard,
  waitingKeyboard,
  playAgainKeyboard,
} from "./keyboards";
import {
  CB,
  CHAT_MIN_BET,
  CHAT_MAX_BET,
  CHAT_PAYOUT_MULT,
  MODE_LABELS,
  type ChatBotContext,
  type ChatGameDefinition,
  type ChatGameMode,
  type ChatMatch,
  type ThrowPlan,
} from "./types";
import {
  botThrowDice,
  cancelPendingThrow,
  resolveUserDice,
  waitForUserDice,
} from "./telegram-dice";
import { diceGame } from "./games/dice";
import { footballGame } from "./games/football";
import { basketballGame } from "./games/basketball";
import { dartGame } from "./games/dart";
import { bowlingGame } from "./games/bowling";
import { spinGame } from "./games/spin";
import { bullseyeGame } from "./games/bullseye";
import { strikeGame } from "./games/strike";
import { goalGame } from "./games/goal";
import { hoopGame } from "./games/hoop";

/** Public group where chat duels are played. */
export const CASINO_CHAT_GROUP = "@PabloCasinoChat";

/**
 * Only Telegram's real animated activity emojis:
 * 🎲 ⚽ 🏀 🎯 🎳 🎰
 */
export const chatGames: ChatGameDefinition[] = [
  diceGame,       // 🎲
  footballGame,   // ⚽
  basketballGame, // 🏀
  dartGame,       // 🎯
  bowlingGame,    // 🎳
  spinGame,       // 🎰
  goalGame,       // ⚽ goals only
  hoopGame,       // 🏀 makes only
  bullseyeGame,   // 🎯 6 = bullseye
  strikeGame,     // 🎳 6 = strike
];

const byCommand = new Map(chatGames.map((g) => [g.command, g]));
const byId = new Map(chatGames.map((g) => [g.id, g]));

function parseBet(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < CHAT_MIN_BET || n > CHAT_MAX_BET) return null;
  return n;
}

function usage(g: ChatGameDefinition): string {
  return (
    `*${g.title}*\n` +
    `Bet min ${CHAT_MIN_BET} · Win ${CHAT_PAYOUT_MULT}x\n` +
    `\`/${g.command} <bet>\`  e.g. \`/${g.command} 1\``
  );
}

/** Compact setup / lobby card — edited in place so chat stays clean. */
function setupText(g: ChatGameDefinition, m: ChatMatch, stage: string): string {
  const mode = m.mode ? MODE_LABELS[m.mode] : "—";
  const race = m.raceTo ? `First to ${m.raceTo}` : "—";
  return (
    `${g.emoji} *${g.title}*\n` +
    `*${m.host.name}* · Bet *${m.bet}* · ${CHAT_PAYOUT_MULT}x\n` +
    `${mode} · ${race}\n\n` +
    `${stage}`
  );
}

/** Live match board (edited). Names always included for busy groups. */
function boardText(
  g: ChatGameDefinition,
  m: ChatMatch,
  guestName: string,
  extra = "",
): string {
  return (
    `${g.emoji} *${m.host.name}* vs *${guestName}*\n` +
    `Bet *${m.bet}* · First to ${m.raceTo} · ${CHAT_PAYOUT_MULT}x\n` +
    `Score *${m.scoreHost}* — *${m.scoreGuest}*` +
    (extra ? `\n${extra}` : "")
  );
}

async function say(
  bot: Telegraf<ChatBotContext>,
  chatId: number,
  text: string,
  replyTo?: number,
): Promise<void> {
  try {
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
    });
  } catch {
    // reply target may be gone — still deliver the text
    if (replyTo) {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(() => {});
    }
  }
}

async function startSetup(
  ctx: ChatBotContext,
  g: ChatGameDefinition,
  bet: number,
): Promise<void> {
  const from = ctx.from!;
  const tgId = String(from.id);
  await getOrCreateUser(tgId, from.username, from.first_name, from.last_name);
  if ((await getChips(tgId)) < bet) {
    await ctx.reply(`Not enough USD. Need *${bet}*.`, { parse_mode: "Markdown" });
    return;
  }

  const existing = chatStore.getForUser(tgId);
  if (existing && ["playing", "waiting_pvp", "pick_mode", "pick_race", "confirm", "pick_opponent"].includes(existing.status)) {
    await ctx.reply("You already have an active game. Finish or cancel it first.");
    return;
  }

  const id = chatStore.newId();
  const sent = await ctx.reply(
    setupText(
      g,
      {
        id,
        gameId: g.id,
        chatId: ctx.chat!.id,
        messageId: 0,
        host: { userId: tgId, name: from.first_name ?? "Player" },
        bet,
        status: "pick_mode",
        scoreHost: 0,
        scoreGuest: 0,
        round: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      "Choose a mode:",
    ),
    { parse_mode: "Markdown", reply_markup: modeKeyboard(id) },
  );

  const match: ChatMatch = {
    id,
    gameId: g.id,
    chatId: ctx.chat!.id,
    messageId: sent.message_id,
    host: { userId: tgId, name: from.first_name ?? "Player" },
    bet,
    status: "pick_mode",
    scoreHost: 0,
    scoreGuest: 0,
    round: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  chatStore.save(match);
}

async function runMatch(
  bot: Telegraf<ChatBotContext>,
  match: ChatMatch,
  g: ChatGameDefinition,
): Promise<void> {
  const mode = match.mode!;
  const raceTo = match.raceTo!;
  const guestName = match.opponent === "bot" ? "Bot" : match.guest!.name;
  const boardId = match.messageId;

  try {
    await deductChips(match.host.userId, match.bet, "game_loss", `${g.id} chat bet`);
    if (match.opponent === "pvp" && match.guest) {
      await deductChips(match.guest.userId, match.bet, "game_loss", `${g.id} chat bet`);
    }
  } catch (e) {
    const msg =
      e instanceof InsufficientChipsError
        ? `${g.emoji} Not enough USD — match cancelled.`
        : `${g.emoji} Could not lock USD — match cancelled.`;
    await editMsg(bot.telegram, match.chatId, boardId, msg);
    chatStore.delete(match.id);
    return;
  }

  match.status = "playing";
  match.scoreHost = 0;
  match.scoreGuest = 0;
  match.round = 0;
  chatStore.save(match);
  await editMsg(
    bot.telegram,
    match.chatId,
    boardId,
    boardText(g, match, guestName, "_Playing…_"),
  );

  let lastRolls = "";

  while (match.scoreHost < raceTo && match.scoreGuest < raceTo) {
    match.round += 1;
    chatStore.save(match);
    await editMsg(
      bot.telegram,
      match.chatId,
      boardId,
      boardText(g, match, guestName, `Round ${match.round}`),
    );

    let hostDisplay: string;
    let guestDisplay: string;
    let hostValue: number;
    let guestValue: number;
    let winner: "host" | "guest" | "draw";

    const plan = g.throwPlan?.(mode);
    if (plan) {
      // User / host first, then bot or opponent
      const hostResult = await collectThrows(
        bot,
        match.chatId,
        match.host,
        false,
        plan,
        boardId,
      );
      hostValue = hostResult.value;
      hostDisplay = hostResult.display;

      const guestResult = await collectThrows(
        bot,
        match.chatId,
        { userId: match.guest?.userId ?? "bot", name: guestName },
        match.opponent === "bot",
        plan,
        boardId,
      );
      guestValue = guestResult.value;
      guestDisplay = guestResult.display;

      winner = plan.decide
        ? plan.decide(hostResult, guestResult)
        : hostValue > guestValue
          ? "host"
          : hostValue < guestValue
            ? "guest"
            : "draw";
    } else {
      const round = g.playRound(mode);
      await editMsg(
        bot.telegram,
        match.chatId,
        boardId,
        boardText(g, match, guestName, "Rolling…"),
      );
      await sleep(600);
      hostValue = round.hostValue;
      guestValue = round.guestValue;
      hostDisplay = round.hostDisplay;
      guestDisplay = round.guestDisplay;
      winner = round.winner;
    }

    if (winner === "host") match.scoreHost += 1;
    else if (winner === "guest") match.scoreGuest += 1;
    chatStore.save(match);

    const matchOver = match.scoreHost >= raceTo || match.scoreGuest >= raceTo;
    const rolls =
      `*${match.host.name}* ${hostDisplay}  ·  *${guestName}* ${guestDisplay}`;
    lastRolls = rolls;

    if (!matchOver) {
      // Mid-race only — one short line, reply to board so busy chats stay clear
      const point =
        winner === "draw"
          ? "Draw"
          : winner === "host"
            ? `+1 ${match.host.name}`
            : `+1 ${guestName}`;
      await say(
        bot,
        match.chatId,
        `${rolls}\n${point} · Score *${match.scoreHost}*—*${match.scoreGuest}*`,
        boardId,
      );
    }
    await editMsg(
      bot.telegram,
      match.chatId,
      boardId,
      boardText(g, match, guestName),
    );
  }

  const hostWon = match.scoreHost >= raceTo;
  const winnerName = hostWon ? match.host.name : guestName;
  const payout = Math.floor(match.bet * CHAT_PAYOUT_MULT * 100) / 100;

  if (hostWon) {
    await addChips(match.host.userId, payout, "game_win", `${g.id} chat win`);
    await recordGame(match.host.userId, g.id, match.bet, payout, "win", {
      mode,
      raceTo,
      opponent: match.opponent,
    });
    if (match.opponent === "pvp" && match.guest) {
      await recordGame(match.guest.userId, g.id, match.bet, 0, "loss", {
        mode,
        raceTo,
        opponent: "pvp",
      });
    }
  } else if (match.opponent === "pvp" && match.guest) {
    await addChips(match.guest.userId, payout, "game_win", `${g.id} chat win`);
    await recordGame(match.guest.userId, g.id, match.bet, payout, "win", {
      mode,
      raceTo,
      opponent: "pvp",
    });
    await recordGame(match.host.userId, g.id, match.bet, 0, "loss", {
      mode,
      raceTo,
      opponent: "pvp",
    });
  } else {
    await recordGame(match.host.userId, g.id, match.bet, 0, "loss", {
      mode,
      raceTo,
      opponent: "bot",
    });
  }

  const moneyLine = hostWon
    ? `*${winnerName}* wins · *+${payout}* USD`
    : match.opponent === "bot"
      ? `*Bot* wins · *${match.host.name}* lost ${match.bet}`
      : `*${winnerName}* wins · *+${payout}* USD`;

  const finalMsg =
    `${g.emoji} ${lastRolls}\n` +
    `${moneyLine}\n` +
    `Score *${match.scoreHost}* — *${match.scoreGuest}* · Bet ${match.bet}`;

  match.status = "finished";
  chatStore.save(match);

  // Fresh result message — board scrolls away fast in busy groups
  try {
    await bot.telegram.sendMessage(match.chatId, finalMsg, {
      parse_mode: "Markdown",
      reply_to_message_id: boardId,
      reply_markup: playAgainKeyboard(g.command, match.bet),
    });
  } catch {
    await bot.telegram.sendMessage(match.chatId, finalMsg, {
      parse_mode: "Markdown",
      reply_markup: playAgainKeyboard(g.command, match.bet),
    });
  }
  await editMsg(
    bot.telegram,
    match.chatId,
    boardId,
    boardText(g, match, guestName, hostWon ? `${match.host.name} won` : `${guestName} won`),
  );
  chatStore.delete(match.id);
}

/** Collect throws: humans get one short named prompt; bot just throws (no spam). */
async function collectThrows(
  bot: Telegraf<ChatBotContext>,
  chatId: number,
  player: { userId: string; name: string },
  isBot: boolean,
  plan: ThrowPlan,
  replyTo: number,
): Promise<{ value: number; display: string }> {
  const values: number[] = [];
  for (let i = 0; i < plan.throws; i++) {
    const nLabel = plan.throws > 1 ? ` (${i + 1}/${plan.throws})` : "";
    if (isBot) {
      // No "my turn" text — the animated emoji is the turn
      values.push(await botThrowDice(bot.telegram, chatId, plan.emoji));
    } else {
      await say(
        bot,
        chatId,
        `*${player.name}* — send ${plan.emoji}${nLabel}`,
        replyTo,
      );
      try {
        const v = await waitForUserDice(chatId, player.userId, plan.emoji, 45_000);
        values.push(v);
        await sleep(diceAnimMs(plan.emoji));
      } catch {
        await say(bot, chatId, `*${player.name}* late — auto ${plan.emoji}`, replyTo);
        values.push(await botThrowDice(bot.telegram, chatId, plan.emoji));
      }
    }
  }
  return plan.combine(values);
}

function diceAnimMs(emoji: string): number {
  return emoji === "🎰" ? 2500 : 4000;
}

/** Guide text for main casino bot game buttons. */
export function gameGuideText(g: ChatGameDefinition): string {
  return (
    `*${g.guideTitle}*\n\n` +
    `Play with a friend or the bot using \`/${g.command}\` in our group — ${CASINO_CHAT_GROUP}`
  );
}

/**
 * Register chat duel games: /dice 1 → mode → race → confirm → bot|player → animated play.
 * Min bet 1, payout always 1.9x.
 */
export function registerChatGames(bot: Telegraf<ChatBotContext>): void {
  // Capture real Telegram dice/activity emoji from players
  bot.on(message("dice"), async (ctx) => {
    const dice = ctx.message.dice;
    const uid = String(ctx.from.id);
    const chatId = ctx.chat.id;
    // Don't spam ack — just resolve the pending throw (animation already visible)
    resolveUserDice(chatId, uid, dice.emoji, dice.value);
  });

  for (const g of chatGames) {
    bot.command(g.command, async (ctx) => {
      try {
        const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
        const parts = text.trim().split(/\s+/);
        const bet = parseBet(parts[1]);
        if (bet == null) {
          await ctx.reply(usage(g), {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Bet 1", callback_data: `${CB}|again|${g.command}|1` },
                  { text: "Bet 5", callback_data: `${CB}|again|${g.command}|5` },
                  { text: "Bet 10", callback_data: `${CB}|again|${g.command}|10` },
                ],
              ],
            },
          });
          return;
        }
        await startSetup(ctx, g, bet);
      } catch {
        await ctx.reply("Could not start game. Try again.");
      }
    });
  }

  bot.command("chatgames", async (ctx) => {
    const lines = chatGames.map(
      (g) => `${g.emoji} \`/${g.command} <bet>\` — ${g.title}`,
    );
    await ctx.reply(
      `*Chat Games*\n` +
        `Min *${CHAT_MIN_BET}* · Payout *${CHAT_PAYOUT_MULT}x*\n\n` +
        lines.join("\n") +
        `\n\nExample: \`/dice 1\``,
      { parse_mode: "Markdown" },
    );
  });

  // All cg| callbacks
  bot.on("callback_query", async (ctx, next) => {
    const data = (ctx.callbackQuery as { data?: string }).data;
    if (!data || !data.startsWith(`${CB}|`)) return next();

    const parts = data.split("|");
    const action = parts[1];

    try {
      if (action === "done") {
        await ctx.answerCbQuery("Done");
        try {
          await ctx.editMessageText("GG — send /chatgames anytime.");
        } catch { /* ignore */ }
        return;
      }

      if (action === "again") {
        const cmd = parts[2]!;
        const bet = parseBet(parts[3]);
        const g = byCommand.get(cmd);
        await ctx.answerCbQuery();
        if (!g || bet == null) return;
        await startSetup(ctx, g, bet);
        return;
      }

      const matchId = parts[2]!;
      const match = chatStore.get(matchId);
      if (!match) {
        await ctx.answerCbQuery("Match expired", { show_alert: true });
        return;
      }
      const g = byId.get(match.gameId);
      if (!g) {
        await ctx.answerCbQuery("Unknown game");
        return;
      }

      const uid = String(ctx.from!.id);
      await getOrCreateUser(uid, ctx.from!.username, ctx.from!.first_name, ctx.from!.last_name);

      if (action === "cancel") {
        if (uid !== match.host.userId && uid !== match.guest?.userId) {
          await ctx.answerCbQuery("Not your match", { show_alert: true });
          return;
        }
        cancelPendingThrow(match.chatId, match.host.userId);
        if (match.guest) cancelPendingThrow(match.chatId, match.guest.userId);
        chatStore.delete(matchId);
        await ctx.answerCbQuery("Cancelled");
        await editMsg(
          ctx.telegram,
          match.chatId,
          match.messageId,
          `${g.emoji} Cancelled · *${match.host.name}*`,
        );
        return;
      }

      if (action === "mode") {
        if (uid !== match.host.userId) {
          await ctx.answerCbQuery("Only host can choose", { show_alert: true });
          return;
        }
        const mode = parts[3] as ChatGameMode;
        match.mode = mode;
        match.status = "pick_race";
        chatStore.save(match);
        await ctx.answerCbQuery(MODE_LABELS[mode]);
        const hint = g.modeHint?.(mode);
        await editMsg(
          ctx.telegram,
          match.chatId,
          match.messageId,
          setupText(g, match, hint ? `${hint}\n\nFirst to how many?` : "First to how many?"),
          raceKeyboard(matchId),
        );
        return;
      }

      if (action === "backmode") {
        if (uid !== match.host.userId) return ctx.answerCbQuery("Host only");
        match.status = "pick_mode";
        delete match.mode;
        chatStore.save(match);
        await ctx.answerCbQuery();
        await editMsg(
          ctx.telegram,
          match.chatId,
          match.messageId,
          setupText(g, match, "Choose a mode:"),
          modeKeyboard(matchId),
        );
        return;
      }

      if (action === "race") {
        if (uid !== match.host.userId) return ctx.answerCbQuery("Host only", { show_alert: true });
        const raceTo = parseInt(parts[3]!, 10);
        if (![1, 2, 3].includes(raceTo)) return ctx.answerCbQuery("Invalid");
        match.raceTo = raceTo;
        match.status = "confirm";
        chatStore.save(match);
        await ctx.answerCbQuery(`First to ${raceTo}`);
        await editMsg(
          ctx.telegram,
          match.chatId,
          match.messageId,
          setupText(
            g,
            match,
            `Confirm? Winner gets *${(match.bet * CHAT_PAYOUT_MULT).toFixed(1)}* USD.`,
          ),
          confirmKeyboard(matchId),
        );
        return;
      }

      if (action === "backrace") {
        if (uid !== match.host.userId) return ctx.answerCbQuery("Host only");
        match.status = "pick_race";
        delete match.raceTo;
        chatStore.save(match);
        await ctx.answerCbQuery();
        await editMsg(
          ctx.telegram,
          match.chatId,
          match.messageId,
          setupText(g, match, "How many points to win?"),
          raceKeyboard(matchId),
        );
        return;
      }

      if (action === "confirm") {
        if (uid !== match.host.userId) return ctx.answerCbQuery("Host only", { show_alert: true });
        match.status = "pick_opponent";
        chatStore.save(match);
        await ctx.answerCbQuery("Confirmed!");
        await editMsg(
          ctx.telegram,
          match.chatId,
          match.messageId,
          setupText(g, match, "Play vs Bot or another player?"),
          opponentKeyboard(matchId),
        );
        return;
      }

      if (action === "vs") {
        if (uid !== match.host.userId) return ctx.answerCbQuery("Host only", { show_alert: true });
        const kind = parts[3];
        if (kind === "bot") {
          match.opponent = "bot";
          match.guest = { userId: "bot", name: "Bot" };
          chatStore.save(match);
          await ctx.answerCbQuery("vs Bot!");
          // fire-and-forget async match so other updates continue
          void runMatch(bot, match, g);
          return;
        }
        if (kind === "pvp") {
          match.opponent = "pvp";
          match.status = "waiting_pvp";
          chatStore.save(match);
          await ctx.answerCbQuery("Waiting for player…");
          await editMsg(
            ctx.telegram,
            match.chatId,
            match.messageId,
            setupText(
              g,
              match,
              `Waiting for an opponent…\nAnyone can tap *Join Match*.`,
            ),
            waitingKeyboard(matchId),
          );
          return;
        }
        return;
      }

      if (action === "join") {
        if (match.status !== "waiting_pvp") {
          await ctx.answerCbQuery("Not joinable", { show_alert: true });
          return;
        }
        if (uid === match.host.userId) {
          await ctx.answerCbQuery("You can't join your own match", { show_alert: true });
          return;
        }
        const bal = await getChips(uid);
        if (bal < match.bet) {
          await ctx.answerCbQuery(`Need ${match.bet} USD`, { show_alert: true });
          return;
        }
        match.guest = { userId: uid, name: ctx.from!.first_name ?? "Player" };
        match.opponent = "pvp";
        chatStore.save(match);
        await ctx.answerCbQuery("Joined!");
        await editMsg(
          ctx.telegram,
          match.chatId,
          match.messageId,
          setupText(
            g,
            match,
            `*${match.guest.name}* joined — starting…`,
          ),
        );
        void runMatch(bot, match, g);
        return;
      }

      await ctx.answerCbQuery();
    } catch (err) {
      try {
        await ctx.answerCbQuery("Error", { show_alert: true });
      } catch { /* ignore */ }
      console.error("chat-game callback error", err);
    }
  });
}

export function chatGameMenuCommands(): Array<{ command: string; description: string }> {
  return [
    { command: "chatgames", description: "Chat duel games list" },
    ...chatGames.map((g) => ({
      command: g.command,
      description: `${g.title} — /${g.command} <bet>`,
    })),
  ];
}
