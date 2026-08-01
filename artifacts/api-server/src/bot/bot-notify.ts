import { Telegraf } from "telegraf";
import { logger } from "../lib/logger";

let casinoBot: Telegraf | null = null;

export function setCasinoBotForNotifications(bot: Telegraf) {
  casinoBot = bot;
}

export function getCasinoBot(): Telegraf | null {
  return casinoBot;
}

/** Best-effort Telegram notify to a casino user */
export async function notifyCasinoUser(telegramId: string, text: string): Promise<void> {
  if (!casinoBot) return;
  try {
    await casinoBot.telegram.sendMessage(telegramId, text, { parse_mode: "Markdown" });
  } catch (e) {
    logger.warn({ e, telegramId }, "Failed to notify casino user");
  }
}
