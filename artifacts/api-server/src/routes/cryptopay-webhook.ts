/**
 * CryptoPay Webhook Handler
 *
 * CryptoPay sends a POST request to this endpoint when an invoice is paid.
 * We verify the signature, find the matching transaction, credit chips,
 * and notify the user via the casino bot.
 *
 * Configure webhook in @CryptoBot:
 *   My Apps → Your App → Webhooks → Set URL: https://<your-domain>/api/cryptopay/webhook
 */

import { Router } from "express";
import { verifyWebhookSignature, type CryptoPayInvoice } from "../bot/cryptopay";
import {
  findDepositByInvoiceId,
  approveTransaction,
  getUserById,
  getDepositAddresses,
} from "../bot/db-helpers";
import { logger } from "../lib/logger";
import { Telegraf } from "telegraf";

const router = Router();

// The casino bot instance is set by index.ts after bot creation
let casinoBot: Telegraf | null = null;

export function setCasinoBotForNotifications(bot: Telegraf) {
  casinoBot = bot;
}

/**
 * Handle a paid CryptoPay invoice.
 * This is called both from the webhook and from the polling fallback.
 */
export async function handlePaidInvoice(invoice: CryptoPayInvoice): Promise<void> {
  if (invoice.status !== "paid") return;

  const invoiceId = String(invoice.invoice_id);

  // Find the pending deposit transaction linked to this invoice
  const tx = await findDepositByInvoiceId(invoiceId);
  if (!tx) {
    logger.info({ invoiceId }, "CryptoPay: no matching pending deposit found (may already be processed)");
    return;
  }

  // Determine chips amount from the asset rate
  const cryptoAmount = parseFloat(invoice.amount);
  const asset = (invoice.asset ?? "USDT").toLowerCase();

  // Map CryptoPay asset to our crypto key
  const assetKeyMap: Record<string, string> = {
    usdt: "usdt_trc20",
    btc: "btc",
    eth: "eth",
    ton: "ton",
    bnb: "bnb",
    trx: "usdt_trc20",
    ltc: "ltc",
    usdc: "usdt_trc20", // USDC rates fall back to USDT config if no dedicated entry
  };
  const cryptoKey = assetKeyMap[asset] ?? asset;

  const addresses = await getDepositAddresses();
  const addr = addresses.find(a => a.crypto === cryptoKey);
  const chipsPerUnit = addr ? parseFloat(addr.chipsPerUnit) : 1;
  const chips = Math.floor(cryptoAmount * chipsPerUnit);

  if (chips < 1) {
    logger.warn({ invoiceId, cryptoAmount, chips }, "CryptoPay: chips too low, skipping");
    return;
  }

  // Approve the transaction and credit chips
  await approveTransaction(tx.id, chips);
  logger.info({ invoiceId, chips, txId: tx.id }, "CryptoPay: deposit approved automatically");

  // Notify the user via casino bot
  if (casinoBot) {
    const user = await getUserById(tx.userId);
    if (user) {
      try {
        await casinoBot.telegram.sendMessage(
          user.telegramId,
          `✅ *Payment Received!*\n\n` +
          `💰 ${cryptoAmount} ${invoice.asset ?? "USDT"} received!\n` +
          `🎰 *${chips} chips* added to your balance!\n\n` +
          `Transaction: #${tx.id}\n\n` +
          `Happy playing! 🎲`,
          { parse_mode: "Markdown" },
        );
        logger.info({ userId: user.telegramId }, "CryptoPay: payment notification sent");
      } catch (e) {
        logger.error({ e, userId: user.telegramId }, "CryptoPay: failed to send notification");
      }
    }
  }
}

// ── POST /api/cryptopay/webhook ───────────────────────────────────────────────
router.post("/cryptopay/webhook", async (req, res): Promise<void> => {
  try {
    // Verify signature
    const signature = req.headers["crypto-pay-api-signature"] as string;
    if (!signature) {
      res.status(401).json({ ok: false, error: "Missing signature" });
      return;
    }

    const rawBody = JSON.stringify(req.body);
    const valid = await verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      logger.warn("CryptoPay webhook: invalid signature");
      res.status(401).json({ ok: false, error: "Invalid signature" });
      return;
    }

    // Process the payment update
    const update = req.body as { update_type: string; payload: CryptoPayInvoice };
    if (update.update_type === "invoice_paid") {
      await handlePaidInvoice(update.payload);
    }

    res.json({ ok: true });
  } catch (e) {
    logger.error({ e }, "CryptoPay webhook error");
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

export default router;
