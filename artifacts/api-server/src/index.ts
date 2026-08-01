import app from "./app";
import { logger } from "./lib/logger";
import { createCasinoBot } from "./bot/casino-bot";
import { createAdminBot } from "./bot/admin-bot";
import { isCryptoPayEnabled, startPaymentPoller } from "./bot/cryptopay";
import { setCasinoBotForNotifications, handlePaidInvoice } from "./routes/cryptopay-webhook";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ─── Start Express server ─────────────────────────────────────────────────────
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// ─── Start Casino Bot ─────────────────────────────────────────────────────────
const casinoToken = process.env["CASINO_BOT_TOKEN"];
const adminToken = process.env["ADMIN_BOT_TOKEN"];

if (!casinoToken) {
  logger.warn("CASINO_BOT_TOKEN not set — main casino bot will not start");
} else {
  const casinoBot = createCasinoBot(casinoToken);

  // Register casino bot for CryptoPay payment notifications
  setCasinoBotForNotifications(casinoBot);

  // Telegraf's launch() promise resolves only when the bot stops — log start immediately
  casinoBot.launch({ dropPendingUpdates: true }).catch((err) => {
    logger.error({ err }, "Failed to start Casino Bot");
  });
  logger.info("🎰 Casino Bot started (polling)");

  // ── CryptoPay auto-payment poller ────────────────────────────────────────
  // If CRYPTOPAY_TOKEN is set, poll for paid invoices every 30 seconds
  // (use webhooks in production for instant notifications)
  if (isCryptoPayEnabled()) {
    logger.info("🔔 CryptoPay enabled — starting payment poller (30s interval)");
    const poller = startPaymentPoller(30_000, handlePaidInvoice);

    process.once("SIGINT", () => clearInterval(poller));
    process.once("SIGTERM", () => clearInterval(poller));
  } else {
    logger.warn("CRYPTOPAY_TOKEN not set — auto payment detection disabled (manual deposits only)");
  }

  // Graceful shutdown
  process.once("SIGINT", () => casinoBot.stop("SIGINT"));
  process.once("SIGTERM", () => casinoBot.stop("SIGTERM"));
}

// ─── Start Admin Bot ──────────────────────────────────────────────────────────
if (!adminToken) {
  logger.warn("ADMIN_BOT_TOKEN not set — admin bot will not start");
} else {
  const adminBot = createAdminBot(adminToken);
  adminBot.launch({ dropPendingUpdates: true }).catch((err) => {
    logger.error({ err }, "Failed to start Admin Bot");
  });
  logger.info("🛠 Admin Bot started (polling)");

  process.once("SIGINT", () => adminBot.stop("SIGINT"));
  process.once("SIGTERM", () => adminBot.stop("SIGTERM"));
}
