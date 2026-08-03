import app from "./app";
import { logger } from "./lib/logger";
import { createCasinoBot } from "./bot/casino-bot";
import { createAdminBot } from "./bot/admin-bot";
import {
  isNowPaymentsEnabled,
  startPaymentPoller,
  listRecentPayments,
  isPaymentComplete,
  getIpnCallbackUrl,
} from "./bot/nowpayments";
import { handlePaidPayment } from "./routes/nowpayments-ipn";
import { setCasinoBotForNotifications, setAdminBotForNotifications } from "./bot/bot-notify";
import {
  getPendingNowPaymentsPaymentIds,
  getPendingNowPaymentsInvoiceDeposits,
  bindDepositPaymentId,
  findDepositByOrderId,
} from "./bot/db-helpers";
import { chatGameMenuCommands } from "./bot/chat-games/register";
import { ensureSchema } from "./ensure-schema";

const port = Number(process.env["PORT"] ?? "3000");
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

if (!process.env["DATABASE_URL"]) {
  logger.error("DATABASE_URL missing — link Railway Postgres to this service");
}

// ─── Start Express FIRST so Railway healthcheck can pass ─────────────────────
const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening on 0.0.0.0");
});
server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

async function boot(): Promise<void> {
  try {
    await ensureSchema();
  } catch (err) {
    logger.error({ err }, "DB schema sync failed — check DATABASE_URL / Postgres link");
  }

  const casinoToken = process.env["CASINO_BOT_TOKEN"];
  const adminToken = process.env["ADMIN_BOT_TOKEN"];

  if (!casinoToken) {
    logger.warn("CASINO_BOT_TOKEN not set — main casino bot will not start");
  } else {
    const casinoBot = createCasinoBot(casinoToken);
    setCasinoBotForNotifications(casinoBot);

    casinoBot.telegram
      .setMyCommands([
        { command: "start", description: "🏠 Main menu / Open casino" },
        { command: "chatgames", description: "🎮 Chat duels list" },
        { command: "games", description: "🎮 Games menu" },
        { command: "balance", description: "💰 Check chip balance" },
        { command: "deposit", description: "📥 Deposit chips" },
        { command: "withdraw", description: "📤 Withdraw LTC" },
        ...chatGameMenuCommands().filter((c) => c.command !== "chatgames"),
        { command: "slots", description: "🎰 Play Slots" },
        { command: "blackjack", description: "🃏 Play Blackjack" },
        { command: "roulette", description: "🎡 Play Roulette" },
        { command: "crash", description: "📈 Play Crash" },
        { command: "plinko", description: "🏓 Play Plinko" },
        { command: "help", description: "ℹ️ Help & how to play" },
      ])
      .then(() => logger.info("📋 Casino bot Menu commands set"))
      .catch((err) => logger.warn({ err }, "Failed to set casino bot commands"));

    casinoBot.launch({ dropPendingUpdates: true }).catch((err) => {
      logger.error({ err }, "Failed to start Casino Bot");
    });
    logger.info("🎰 Casino Bot started (polling)");

    if (isNowPaymentsEnabled()) {
      const ipn = getIpnCallbackUrl();
      logger.info(
        { ipn: ipn ?? null },
        "🔔 NOWPayments enabled — deposit poller every 30s (blockchain confirm → auto USD credit)",
      );
      if (!ipn) {
        logger.warn(
          "PUBLIC_BASE_URL missing — set Railway public URL so NOWPayments IPN can hit /api/nowpayments/ipn",
        );
      }

      const resolveInvoices = async () => {
        const invoices = await getPendingNowPaymentsInvoiceDeposits();
        if (invoices.length === 0) return;
        const recent = await listRecentPayments(80);
        for (const inv of invoices) {
          const match = recent.find((p) => {
            const orderOk = inv.orderId && String(p.order_id ?? "") === inv.orderId;
            const invOk =
              p.invoice_id != null &&
              (`inv-${p.invoice_id}` === inv.txHash || String(p.invoice_id) === inv.txHash.replace(/^inv-/, ""));
            return Boolean(orderOk || invOk);
          });
          if (!match) continue;
          const paymentId = String(match.payment_id);
          if (/^\d+$/.test(paymentId)) {
            await bindDepositPaymentId(inv.id, paymentId);
          }
          if (isPaymentComplete(match.payment_status)) {
            await handlePaidPayment(match);
          } else if (inv.orderId) {
            // ensure order match path still works even before bind
            const tx = await findDepositByOrderId(inv.orderId);
            if (tx && isPaymentComplete(match.payment_status)) {
              await handlePaidPayment(match);
            }
          }
        }
      };

      const poller = startPaymentPoller(
        30_000,
        handlePaidPayment,
        getPendingNowPaymentsPaymentIds,
        resolveInvoices,
      );
      process.once("SIGINT", () => clearInterval(poller));
      process.once("SIGTERM", () => clearInterval(poller));
    } else {
      logger.warn("NOWPAYMENTS_API_KEY not set — auto payment detection disabled (manual deposits only)");
    }

    process.once("SIGINT", () => casinoBot.stop("SIGINT"));
    process.once("SIGTERM", () => casinoBot.stop("SIGTERM"));
  }

  if (!adminToken) {
    logger.warn("ADMIN_BOT_TOKEN not set — admin bot will not start");
  } else {
    const adminBot = createAdminBot(adminToken);
    setAdminBotForNotifications(adminBot);

    adminBot.telegram
      .setMyCommands([
        { command: "start", description: "🛠 Open admin panel" },
        { command: "menu", description: "📋 Admin menu" },
        { command: "deposits", description: "💰 Pending deposits" },
        { command: "withdrawals", description: "📤 Pending withdrawals" },
        { command: "users", description: "👥 User management" },
        { command: "stats", description: "📊 Casino stats" },
      ])
      .then(() => logger.info("📋 Admin bot Menu commands set"))
      .catch((err) => logger.warn({ err }, "Failed to set admin bot commands"));

    adminBot.launch({ dropPendingUpdates: true }).catch((err) => {
      logger.error({ err }, "Failed to start Admin Bot");
    });
    logger.info("🛠 Admin Bot started (polling)");

    process.once("SIGINT", () => adminBot.stop("SIGINT"));
    process.once("SIGTERM", () => adminBot.stop("SIGTERM"));
  }
}

void boot().catch((err) => {
  logger.error({ err }, "Boot failed");
});
