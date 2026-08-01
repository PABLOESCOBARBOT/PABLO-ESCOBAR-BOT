import { Telegraf } from "telegraf";
import { logger } from "../lib/logger";

let casinoBot: Telegraf | null = null;
let adminBot: Telegraf | null = null;

export function setCasinoBotForNotifications(bot: Telegraf) {
  casinoBot = bot;
}

export function setAdminBotForNotifications(bot: Telegraf) {
  adminBot = bot;
}

export function getCasinoBot(): Telegraf | null {
  return casinoBot;
}

/** Best-effort Telegram notify to a casino user */
export async function notifyCasinoUser(telegramId: string, text: string, extra?: object): Promise<void> {
  if (!casinoBot) return;
  try {
    await casinoBot.telegram.sendMessage(telegramId, text, {
      parse_mode: "Markdown",
      ...extra,
    });
  } catch (e) {
    logger.warn({ e, telegramId }, "Failed to notify casino user");
  }
}

function parseAdminIds(): string[] {
  const raw = process.env["ADMIN_TELEGRAM_IDS"] ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Notify all admins on the Admin Bot (e.g. new withdrawal request) */
export async function notifyAdmins(text: string, extra?: object): Promise<void> {
  if (!adminBot) return;
  const ids = parseAdminIds();
  for (const id of ids) {
    try {
      await adminBot.telegram.sendMessage(id, text, {
        parse_mode: "HTML",
        ...extra,
      });
    } catch (e) {
      logger.warn({ e, id }, "Failed to notify admin");
    }
  }
}
