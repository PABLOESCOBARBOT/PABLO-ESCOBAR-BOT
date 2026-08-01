import type { Telegram } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function editMsg(
  telegram: Telegram,
  chatId: number,
  messageId: number,
  text: string,
  reply_markup?: InlineKeyboardMarkup,
): Promise<void> {
  try {
    await telegram.editMessageText(chatId, messageId, undefined, text, {
      parse_mode: "Markdown",
      reply_markup,
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (/not modified/i.test(m)) return;
    // ignore deleted / flood — caller continues
  }
}

/** Play frames with async delays (does not block other users/games). */
export async function playFrames(
  telegram: Telegram,
  chatId: number,
  messageId: number,
  frames: Array<{ text: string; ms?: number }>,
  defaultMs = 350,
): Promise<void> {
  for (const f of frames) {
    await editMsg(telegram, chatId, messageId, f.text);
    await sleep(f.ms ?? defaultMs);
  }
}
