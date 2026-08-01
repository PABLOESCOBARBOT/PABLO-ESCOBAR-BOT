/**
 * NOWPayments Gateway Integration
 *
 * Docs: https://nowpayments.io — API: https://api.nowpayments.io/v1
 *
 * Env:
 *   NOWPAYMENTS_API_KEY
 *   NOWPAYMENTS_IPN_SECRET
 *   PUBLIC_BASE_URL (optional — enables IPN callbacks)
 */

import { createHmac } from "node:crypto";
import { logger } from "../lib/logger";

const NOWPAYMENTS_BASE_URL = "https://api.nowpayments.io/v1";

/** Our internal crypto keys → NOWPayments pay_currency codes */
export const NOWPAYMENTS_CURRENCY_MAP: Record<string, string> = {
  usdt_trc20: "usdttrc20",
  usdt_erc20: "usdterc20",
  btc: "btc",
  eth: "eth",
  ton: "ton",
  bnb: "bnbbsc",
  ltc: "ltc",
};

export interface NowPaymentsPayment {
  payment_id: number | string;
  invoice_id?: number | string | null;
  payment_status: string;
  pay_address?: string;
  price_amount: number | string;
  price_currency: string;
  pay_amount?: number | string;
  actually_paid?: number | string;
  amount_received?: number | string;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  purchase_id?: string | number;
  network?: string;
  created_at?: string;
  updated_at?: string;
  expiration_estimate_date?: string;
}

export interface NowPaymentsInvoice {
  id: string | number;
  invoice_url: string;
  order_id?: string;
  order_description?: string;
  price_amount: string | number;
  price_currency: string;
  pay_currency?: string;
}

function getApiKey(): string | null {
  return process.env["NOWPAYMENTS_API_KEY"] ?? null;
}

export function isNowPaymentsEnabled(): boolean {
  return !!getApiKey();
}

function getIpnCallbackUrl(): string | undefined {
  const explicit = process.env["NOWPAYMENTS_IPN_URL"];
  if (explicit) return explicit;
  const base = process.env["PUBLIC_BASE_URL"];
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/api/nowpayments/ipn`;
}

async function apiCall<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not set");

  const res = await fetch(`${NOWPAYMENTS_BASE_URL}${path}`, {
    method,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`NOWPayments invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "message" in json
        ? String((json as { message: unknown }).message)
        : text.slice(0, 200);
    throw new Error(`NOWPayments API error (${res.status}): ${msg}`);
  }

  return json as T;
}

/** Minimum USD amount required for a pay_currency (NOWPayments account min). */
export async function getMinAmountUsd(payCurrency: string): Promise<number> {
  try {
    const result = await apiCall<{ min_amount: number }>(
      "GET",
      `/min-amount?currency_from=usd&currency_to=${encodeURIComponent(payCurrency.toLowerCase())}`,
    );
    return Number(result.min_amount) || 20;
  } catch (e) {
    logger.warn({ e, payCurrency }, "NOWPayments min-amount failed — using $20 default");
    return 20;
  }
}

/**
 * Create a crypto payment (address + amount). Works with API key (no JWT).
 * May fail if priceAmountUsd is below the merchant minimum (~$19 on some accounts).
 */
export async function createPayment(
  payCurrency: string,
  priceAmountUsd: number,
  orderId: string,
  description?: string,
): Promise<NowPaymentsPayment> {
  const payload: Record<string, unknown> = {
    price_amount: priceAmountUsd,
    price_currency: "usd",
    pay_currency: payCurrency.toLowerCase(),
    order_id: orderId,
    order_description: description ?? "Casino Deposit",
  };

  const ipnUrl = getIpnCallbackUrl();
  if (ipnUrl) payload.ipn_callback_url = ipnUrl;

  return apiCall<NowPaymentsPayment>("POST", "/payment", payload);
}

/**
 * Hosted invoice checkout — supports lower amounts (e.g. $5) even when
 * /payment rejects AMOUNT_MINIMAL_ERROR. User sees address on NOWPayments page.
 */
export async function createInvoice(
  payCurrency: string | undefined,
  priceAmountUsd: number,
  orderId: string,
  description?: string,
): Promise<NowPaymentsInvoice> {
  const payload: Record<string, unknown> = {
    price_amount: priceAmountUsd,
    price_currency: "usd",
    order_id: orderId,
    order_description: description ?? "Casino Deposit",
  };
  if (payCurrency) payload.pay_currency = payCurrency.toLowerCase();

  const ipnUrl = getIpnCallbackUrl();
  if (ipnUrl) payload.ipn_callback_url = ipnUrl;

  return apiCall<NowPaymentsInvoice>("POST", "/invoice", payload);
}

/** Try direct payment (with address); on min-amount error fall back to invoice. */
export async function createDepositCheckout(
  payCurrency: string,
  priceAmountUsd: number,
  orderId: string,
  description?: string,
): Promise<
  | { mode: "payment"; payment: NowPaymentsPayment }
  | { mode: "invoice"; invoice: NowPaymentsInvoice }
> {
  try {
    const payment = await createPayment(payCurrency, priceAmountUsd, orderId, description);
    if (payment.pay_address) {
      return { mode: "payment", payment };
    }
  } catch (e) {
    const msg = String(e);
    if (!msg.includes("AMOUNT") && !msg.includes("AMOUNT_MINIMAL") && !msg.includes("minimal")) {
      // unexpected error — still try invoice as fallback for UX
      logger.warn({ e, orderId }, "NOWPayments createPayment failed — trying invoice");
    }
  }

  const invoice = await createInvoice(payCurrency, priceAmountUsd, orderId, description);
  return { mode: "invoice", invoice };
}

/** Get a single payment by id (API key works). */
export async function getPayment(paymentId: string | number): Promise<NowPaymentsPayment | null> {
  try {
    return await apiCall<NowPaymentsPayment>("GET", `/payment/${paymentId}`);
  } catch (e) {
    logger.warn({ e, paymentId }, "NOWPayments getPayment failed");
    return null;
  }
}

/**
 * Verify NOWPayments IPN signature (HMAC-SHA512 of sorted JSON body).
 * Header: x-nowpayments-sig
 */
export function verifyIpnSignature(body: unknown, signature: string): boolean {
  const secret = process.env["NOWPAYMENTS_IPN_SECRET"];
  if (!secret || !signature) return false;

  try {
    const sorted = sortObject(body);
    const payload = JSON.stringify(sorted);
    const computed = createHmac("sha512", secret).update(payload).digest("hex");
    return computed === signature;
  } catch (e) {
    logger.error({ e }, "Error verifying NOWPayments IPN signature");
    return false;
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortObject(obj[key]);
    }
    return out;
  }
  return value;
}

export function isPaymentComplete(status: string): boolean {
  const s = status.toLowerCase();
  return s === "finished" || s === "confirmed";
}

/**
 * Poll pending deposits by payment_id (stored in txHash).
 * List endpoint requires JWT — we avoid it and check each pending payment id.
 */
export function startPaymentPoller(
  intervalMs: number,
  onPaid: (payment: NowPaymentsPayment) => Promise<void>,
  listPendingPaymentIds: () => Promise<string[]>,
): NodeJS.Timeout {
  const poll = async () => {
    try {
      const ids = await listPendingPaymentIds();
      for (const id of ids) {
        const payment = await getPayment(id);
        if (!payment) continue;
        if (!isPaymentComplete(payment.payment_status)) continue;
        await onPaid(payment).catch((e) => logger.error({ e, payment }, "NOWPayments onPaid error"));
      }
    } catch (e) {
      logger.error({ e }, "NOWPayments polling error");
    }
  };

  setTimeout(poll, 5000);
  return setInterval(poll, intervalMs);
}
