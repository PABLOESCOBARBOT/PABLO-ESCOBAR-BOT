import type { Telegram } from "telegraf";
import { sleep } from "./animate";

export type TgDiceEmoji = "🎲" | "🎯" | "🏀" | "⚽" | "🎳" | "🎰";

type Pending = {
  userId: string;
  chatId: number;
  emoji: TgDiceEmoji;
  resolve: (value: number) => void;
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

/** Called from dice message handler — returns true if consumed. */
export function resolveUserDice(
  chatId: number,
  userId: string,
  emoji: string,
  value: number,
): boolean {
  const k = key(chatId, userId);
  const p = pending.get(k);
  if (!p) return false;
  if (p.emoji !== emoji) return false;
  clearTimeout(p.timer);
  pending.delete(k);
  p.resolve(value);
  return true;
}

/** Ask a human to send a Telegram dice sticker; times out soft. */
export function waitForUserDice(
  chatId: number,
  userId: string,
  emoji: TgDiceEmoji,
  timeoutMs = 45_000,
): Promise<number> {
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

/** Bot throws a real Telegram animated emoji and returns its value. */
export async function botThrowDice(
  telegram: Telegram,
  chatId: number,
  emoji: TgDiceEmoji,
): Promise<number> {
  const msg = await telegram.sendDice(chatId, { emoji });
  const value = msg.dice?.value;
  // Wait for Telegram animation, then a natural 1s beat
  await sleep(emoji === "🎰" ? 2500 : 4000);
  await sleep(1000);
  if (typeof value !== "number") throw new Error("dice value missing");
  return value;
}

export function isPendingThrow(chatId: number, userId: string): boolean {
  return pending.has(key(chatId, userId));
}
