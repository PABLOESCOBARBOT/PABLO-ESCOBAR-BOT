import type { Telegram } from "telegraf";
import { sleep } from "./animate";

/** All Telegram animated dice / activity emojis we support in chat duels. */
export type TgDiceEmoji = "🎲" | "🎯" | "🏀" | "⚽" | "🎳" | "🎰";

export type DiceThrowResult = {
  value: number;
  messageId: number;
};

type Pending = {
  userId: string;
  chatId: number;
  emoji: TgDiceEmoji;
  resolve: (result: DiceThrowResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Waiters keyed by chatId:userId */
const pending = new Map<string, Pending>();

function key(chatId: number, userId: string) {
  return `${chatId}:${userId}`;
}

export function cancelPendingThrow(chatId: number, userId: string): void {
  const k = key(chatId, userId);
  const p = pending.get(k);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(k);
  p.reject(new Error("cancelled"));
}

export type ResolveDiceResult =
  | { ok: true }
  | { ok: false; reason: "none" }
  | { ok: false; reason: "wrong_emoji"; expected: TgDiceEmoji; got: string };

/** Called from dice message handler — returns whether the throw was consumed. */
export function resolveUserDice(
  chatId: number,
  userId: string,
  emoji: string,
  value: number,
  messageId: number,
): ResolveDiceResult {
  const k = key(chatId, userId);
  const p = pending.get(k);
  if (!p) return { ok: false, reason: "none" };
  if (p.emoji !== emoji) {
    return { ok: false, reason: "wrong_emoji", expected: p.emoji, got: emoji };
  }
  clearTimeout(p.timer);
  pending.delete(k);
  p.resolve({ value, messageId });
  return { ok: true };
}

/** Expected emoji for a pending human throw, if any. */
export function getPendingEmoji(chatId: number, userId: string): TgDiceEmoji | null {
  return pending.get(key(chatId, userId))?.emoji ?? null;
}

/** Ask a human to send a Telegram dice sticker; times out soft. */
export function waitForUserDice(
  chatId: number,
  userId: string,
  emoji: TgDiceEmoji,
  timeoutMs = 45_000,
): Promise<DiceThrowResult> {
  cancelPendingThrow(chatId, userId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(key(chatId, userId));
      reject(new Error("timeout"));
    }, timeoutMs);
    pending.set(key(chatId, userId), {
      userId,
      chatId,
      emoji,
      resolve,
      reject,
      timer,
    });
  });
}

/** Bot throws a real Telegram animated emoji and returns its value + message id. */
export async function botThrowDice(
  telegram: Telegram,
  chatId: number,
  emoji: TgDiceEmoji,
  replyTo?: number,
): Promise<DiceThrowResult> {
  const msg = await telegram.sendDice(chatId, {
    emoji,
    ...(replyTo ? { reply_to_message_id: replyTo } : {}),
  });
  const value = msg.dice?.value;
  // Only wait until the emoji animation stops — then continue immediately
  await sleep(emoji === "🎰" ? 2500 : 4000);
  if (typeof value !== "number") throw new Error("dice value missing");
  return { value, messageId: msg.message_id };
}

export function isPendingThrow(chatId: number, userId: string): boolean {
  return pending.has(key(chatId, userId));
}
