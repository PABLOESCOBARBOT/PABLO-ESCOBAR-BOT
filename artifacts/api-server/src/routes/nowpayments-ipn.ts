/**
 * NOWPayments IPN (Instant Payment Notification) handler
 *
 * Set callback URL to: https://<your-domain>/api/nowpayments/ipn
 */

import { Router } from "express";
import {
  verifyIpnSignature,
  isPaymentComplete,
  isPayoutComplete,
  isPayoutFailed,
  type NowPaymentsPayment,
} from "../bot/nowpayments";
import {
  findDepositByInvoiceId,
  findDepositByOrderId,
  findWithdrawalByPayoutId,
  bindDepositPaymentId,
  approveTransaction,
  rejectTransaction,
  getUserById,
} from "../bot/db-helpers";
import { logger } from "../lib/logger";
import { notifyCasinoUser, setCasinoBotForNotifications } from "../bot/bot-notify";

export { setCasinoBotForNotifications };

const router = Router();

/**
 * Handle a completed NOWPayments payment (from IPN or poller).
 */
export async function handlePaidPayment(payment: NowPaymentsPayment): Promise<void> {
  if (!isPaymentComplete(payment.payment_status)) return;

  const paymentId = String(payment.payment_id);
  const orderId = payment.order_id ? String(payment.order_id) : "";
  const invoiceId = payment.invoice_id != null ? String(payment.invoice_id) : "";

  // Match pending deposit by order_id (dep-...) or invoice/payment id stored as txHash
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

  // Keep pollable numeric payment id on the row
  if (tx.txHash?.startsWith("inv-") && /^\d+$/.test(paymentId)) {
    await bindDepositPaymentId(tx.id, paymentId);
  }

  // Credit USD (1 USD = 1 balance unit)
  const priceUsd = parseFloat(String(payment.price_amount ?? "0"));
  const paidCrypto = parseFloat(String(payment.actually_paid ?? payment.pay_amount ?? "0"));
  const usd = Math.floor(priceUsd > 0 ? priceUsd : paidCrypto);

  if (usd < 1) {
    logger.warn({ paymentId, priceUsd, paidCrypto, usd }, "NOWPayments: USD too low, skipping");
    return;
  }

  await approveTransaction(tx.id, usd);
  logger.info({ paymentId, usd, txId: tx.id }, "NOWPayments: deposit approved automatically");

  const user = await getUserById(tx.userId);
  if (user) {
    await notifyCasinoUser(
      user.telegramId,
      `✅ *Deposit Confirmed!*\n\n` +
        `💰 Payment detected on the blockchain\n` +
        `💵 *$${usd.toFixed(2)} USD* added to your balance!\n\n` +
        `Deposit: #${tx.id}\n\n` +
        `Happy playing! 🎲`,
    );
  }
}

/** Handle payout IPN / status for automatic withdrawals. */
export async function handlePayoutUpdate(payload: Record<string, unknown>): Promise<void> {
  const status = String(payload["status"] ?? payload["payment_status"] ?? "").toLowerCase();
  const payoutId = String(
    payload["id"] ??
      payload["batch_withdrawal_id"] ??
      payload["withdrawal_id"] ??
      payload["payment_id"] ??
      "",
  );
  if (!payoutId) return;

  const tx = await findWithdrawalByPayoutId(payoutId);
  if (!tx) {
    // Nested withdrawals array from batch payout IPN
    const withdrawals = payload["withdrawals"];
    if (Array.isArray(withdrawals)) {
      for (const w of withdrawals) {
        if (w && typeof w === "object") {
          await handlePayoutUpdate(w as Record<string, unknown>);
        }
      }
    }
    return;
  }

  const user = await getUserById(tx.userId);

  if (isPayoutComplete(status)) {
    await approveTransaction(tx.id, parseFloat(tx.amount));
    logger.info({ payoutId, txId: tx.id }, "NOWPayments: withdrawal marked paid");
    if (user) {
      await notifyCasinoUser(
        user.telegramId,
        `✅ *Withdrawal Paid!*\n\n` +
          `Amount: *$${parseFloat(tx.amount).toFixed(2)} USD*\n` +
          `#${tx.id}\n\n` +
          `Sent on-chain to your LTC address.`,
      );
    }
    return;
  }

  if (isPayoutFailed(status)) {
    await rejectTransaction(tx.id);
    logger.warn({ payoutId, txId: tx.id, status }, "NOWPayments: withdrawal failed — refunded");
    if (user) {
      await notifyCasinoUser(
        user.telegramId,
        `❌ *Withdrawal Failed*\n\n` +
          `#${tx.id} — $${parseFloat(tx.amount).toFixed(2)} USD\n` +
          `USD refunded to your balance.\n` +
          `Status: ${status}`,
      );
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

    const body = req.body as Record<string, unknown>;

    // Payout / withdrawal batch IPN
    if (
      body["withdrawals"] ||
      body["batch_withdrawal_id"] ||
      body["withdrawal_id"] ||
      (typeof body["status"] === "string" &&
        !body["payment_id"] &&
        (isPayoutComplete(String(body["status"])) || isPayoutFailed(String(body["status"]))))
    ) {
      await handlePayoutUpdate(body);
      res.json({ ok: true });
      return;
    }

    const payment = body as unknown as NowPaymentsPayment;
    await handlePaidPayment(payment);
    res.json({ ok: true });
  } catch (e) {
    logger.error({ e }, "NOWPayments IPN error");
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

export default router;
