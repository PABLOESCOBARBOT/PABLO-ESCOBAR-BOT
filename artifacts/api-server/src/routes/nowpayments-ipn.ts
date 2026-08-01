/**
 * NOWPayments IPN (Instant Payment Notification) handler
 *
 * Set callback URL to: https://<your-domain>/api/nowpayments/ipn
 */

import { Router } from "express";
import {
  verifyIpnSignature,
  isPaymentComplete,
  type NowPaymentsPayment,
} from "../bot/nowpayments";
import {
  findDepositByInvoiceId,
  findDepositByOrderId,
  approveTransaction,
  getUserById,
} from "../bot/db-helpers";
import { logger } from "../lib/logger";
import { Telegraf } from "telegraf";

const router = Router();

let casinoBot: Telegraf | null = null;

export function setCasinoBotForNotifications(bot: Telegraf) {
  casinoBot = bot;
}

/**
 * Handle a completed NOWPayments payment (from IPN or poller).
 */
export async function handlePaidPayment(payment: NowPaymentsPayment): Promise<void> {
  if (!isPaymentComplete(payment.payment_status)) return;

  const paymentId = String(payment.payment_id);
  const orderId = payment.order_id ? String(payment.order_id) : "";
  const invoiceId = payment.invoice_id != null ? String(payment.invoice_id) : "";

  // Match pending deposit by order_id (deposit-<txId>) or invoice/payment id stored as txHash
  let tx =
    (orderId ? await findDepositByOrderId(orderId) : null) ??
    (invoiceId ? await findDepositByInvoiceId(invoiceId) : null) ??
    (await findDepositByInvoiceId(paymentId));

  if (!tx) {
    logger.info(
      { paymentId, orderId, invoiceId },
      "NOWPayments: no matching pending deposit (may already be processed)",
    );
    return;
  }

  // Credit based on fiat price (USD = chips) — 1 chip = $1
  const priceUsd = parseFloat(String(payment.price_amount ?? "0"));
  const paidCrypto = parseFloat(String(payment.actually_paid ?? payment.pay_amount ?? "0"));
  const chips = Math.floor(priceUsd > 0 ? priceUsd : paidCrypto);

  if (chips < 1) {
    logger.warn({ paymentId, priceUsd, paidCrypto, chips }, "NOWPayments: chips too low, skipping");
    return;
  }

  await approveTransaction(tx.id, chips);
  logger.info({ paymentId, chips, txId: tx.id }, "NOWPayments: deposit approved automatically");

  if (casinoBot) {
    const user = await getUserById(tx.userId);
    if (user) {
      try {
        await casinoBot.telegram.sendMessage(
          user.telegramId,
          `✅ *Payment Received!*\n\n` +
            `💰 Payment confirmed via NOWPayments\n` +
            `🎰 *${chips} chips* added to your balance!\n\n` +
            `Transaction: #${tx.id}\n\n` +
            `Happy playing! 🎲`,
          { parse_mode: "Markdown" },
        );
      } catch (e) {
        logger.error({ e, userId: user.telegramId }, "NOWPayments: failed to send notification");
      }
    }
  }
}

// ── POST /api/nowpayments/ipn ─────────────────────────────────────────────────
router.post("/nowpayments/ipn", async (req, res): Promise<void> => {
  try {
    const signature = req.headers["x-nowpayments-sig"] as string | undefined;
    if (!signature) {
      res.status(401).json({ ok: false, error: "Missing signature" });
      return;
    }

    if (!verifyIpnSignature(req.body, signature)) {
      logger.warn("NOWPayments IPN: invalid signature");
      res.status(401).json({ ok: false, error: "Invalid signature" });
      return;
    }

    const payment = req.body as NowPaymentsPayment;
    await handlePaidPayment(payment);
    res.json({ ok: true });
  } catch (e) {
    logger.error({ e }, "NOWPayments IPN error");
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

export default router;
