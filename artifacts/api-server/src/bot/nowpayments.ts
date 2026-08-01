/**
 * NOWPayments Gateway Integration
 *
 * Docs: https://nowpayments.io / API: https://api.nowpayments.io/v1
 *
 * Setup:
 *   1. Create account at https://account.nowpayments.io
 *   2. Settings → API → copy API key → NOWPAYMENTS_API_KEY
 *   3. Settings → Payments → IPN Secret → NOWPAYMENTS_IPN_SECRET
 *   4. Set PUBLIC_BASE_URL to your public HTTPS origin (for IPN callbacks)
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

export const NOWPAYMENTS_ASSETS = Object.values(NOWPAYMENTS_CURRENCY_MAP);

export interface NowPaymentsInvoice {
  id: string | number;
  invoice_url: string;
  order_id?: string;
  order_description?: string;
  price_amount: string | number;
  price_currency: string;
  pay_currency?: string;
  created_at?: string;
}

export interface NowPaymentsPayment {
  payment_id: number | string;
  invoice_id?: number | string;
  payment_status: string;
  pay_address?: string;
  price_amount: number | string;
  price_currency: string;
  pay_amount?: number | string;
  actually_paid?: number | string;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  purchase_id?: string | number;
  created_at?: string;
  updated_at?: string;
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

/**
 * Create a NOWPayments invoice (hosted checkout URL for Telegram button).
 * priceAmountUsd = chip dollars (1 chip = $1).
 */
export async function createInvoice(
  payCurrency: string,
  priceAmountUsd: number,
  orderId: string,
  description?: string,
): Promise<NowPaymentsInvoice> {
  const payload: Record<string, unknown> = {
    price_amount: priceAmountUsd,
    price_currency: "usd",
    pay_currency: payCurrency.toLowerCase(),
    order_id: orderId,
    order_description: description ?? "Casino Deposit",
  };

  const ipnUrl = getIpnCallbackUrl();
  if (ipnUrl) payload.ipn_callback_url = ipnUrl;

  return apiCall<NowPaymentsInvoice>("POST", "/invoice", payload);
}

/** Get a single payment by id */
export async function getPayment(paymentId: string | number): Promise<NowPaymentsPayment | null> {
  try {
    return await apiCall<NowPaymentsPayment>("GET", `/payment/${paymentId}`);
  } catch (e) {
    logger.warn({ e, paymentId }, "NOWPayments getPayment failed");
    return null;
  }
}

/** List recent payments (polling fallback when IPN URL is unavailable) */
export async function listRecentPayments(limit = 50): Promise<NowPaymentsPayment[]> {
  try {
    const result = await apiCall<{ data?: NowPaymentsPayment[] } | NowPaymentsPayment[]>(
      "GET",
      `/payment/?limit=${limit}&orderBy=desc`,
    );
    if (Array.isArray(result)) return result;
    return result.data ?? [];
  } catch (e) {
    logger.error({ e }, "NOWPayments listRecentPayments failed");
    return [];
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
  // finished = fully done; confirmed is often enough to credit
  return s === "finished" || s === "confirmed";
}

/**
 * Poll recent payments and invoke onPaid for newly completed ones.
 * Dedup is handled by approveTransaction pending-status guard.
 */
export function startPaymentPoller(
  intervalMs: number,
  onPaid: (payment: NowPaymentsPayment) => Promise<void>,
): NodeJS.Timeout {
  const poll = async () => {
    try {
      const payments = await listRecentPayments(50);
      for (const p of payments) {
        if (!isPaymentComplete(p.payment_status)) continue;
        await onPaid(p).catch((e) => logger.error({ e, p }, "NOWPayments onPaid error"));
      }
    } catch (e) {
      logger.error({ e }, "NOWPayments polling error");
    }
  };

  setTimeout(poll, 5000);
  return setInterval(poll, intervalMs);
}
