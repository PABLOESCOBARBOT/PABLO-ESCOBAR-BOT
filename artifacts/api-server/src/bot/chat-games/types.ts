import type { Context, Telegraf } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";

export type ChatBotContext = Context;
export type ChatGameMode = "normal" | "double" | "crazy" | "crazy_double";
export type OpponentKind = "bot" | "pvp";

export const CHAT_PAYOUT_MULT = 1.9;
export const CHAT_MIN_BET = 1;
export const CHAT_MAX_BET = 1_000_000;
export const CB = "cg";

export const MODE_LABELS: Record<ChatGameMode, string> = {
  normal: "Normal Mode",
  double: "Double Roll",
  crazy: "Crazy Mode",
  crazy_double: "Crazy Double Roll",
};

export interface ChatPlayer {
  userId: string;
  name: string;
}

export type SetupStatus =
  | "pick_mode"
  | "pick_race"
  | "confirm"
  | "pick_opponent"
  | "waiting_pvp"
  | "playing"
  | "finished"
  | "cancelled";

export interface ChatMatch {
  id: string;
  gameId: string;
  chatId: number;
  messageId: number;
  host: ChatPlayer;
  guest?: ChatPlayer;
  bet: number;
  mode?: ChatGameMode;
  raceTo?: number;
  opponent?: OpponentKind;
  status: SetupStatus;
  scoreHost: number;
  scoreGuest: number;
  round: number;
  createdAt: number;
  updatedAt: number;
}

export interface RoundResult {
  hostValue: number;
  guestValue: number;
  hostDisplay: string;
  guestDisplay: string;
  winner: "host" | "guest" | "draw";
  narration: string[];
}

/** Real Telegram animated emoji throw (🎲 🎯 🏀 ⚽). */
export type TgThrowEmoji = "🎲" | "🎯" | "🏀" | "⚽";

export interface ThrowPlan {
  emoji: TgThrowEmoji;
  /** How many animated throws per player this round. */
  throws: number;
  /** Combine raw telegram values into score + display. */
  combine(values: number[]): { value: number; display: string };
}

export interface ChatGameDefinition {
  id: string;
  command: string;
  title: string;
  emoji: string;
  description: string;
  /** Guide title shown in main casino bot games menu. */
  guideTitle: string;
  /** Play one scoring round (RNG fallback when no telegram throws). */
  playRound(mode: ChatGameMode): RoundResult;
  /** If set, use real Telegram dice/emoji throws instead of RNG. */
  throwPlan?(mode: ChatGameMode): ThrowPlan;
  /** Optional extra lines explaining mode. */
  modeHint?(mode: ChatGameMode): string;
}

export interface RegisterHelpers {
  bot: Telegraf<ChatBotContext>;
  edit(
    chatId: number,
    messageId: number,
    text: string,
    markup?: InlineKeyboardMarkup,
  ): Promise<void>;
  reply(chatId: number, text: string, markup?: InlineKeyboardMarkup): Promise<{ message_id: number }>;
}
