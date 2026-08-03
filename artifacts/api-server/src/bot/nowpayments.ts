/**
 * NOWPayments Gateway Integration
 *
 * Docs: https://nowpayments.io — API: https://api.nowpayments.io/v1
 *
 * Env:
 *   NOWPAYMENTS_API_KEY          — required for auto deposits
 *   NOWPAYMENTS_IPN_SECRET       — required to verify IPN webhooks
 *   PUBLIC_BASE_URL              — public HTTPS origin → IPN URL
 *   NOWPAYMENTS_IPN_URL          — optional full IPN URL override
 *   NOWPAYMENTS_EMAIL            — optional, JWT for payouts / payment list
 *   NOWPAYMENTS_PASSWORD         — optional, JWT for payouts / payment list
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

export interface NowPaymentsPayoutWithdrawal {
  id?: string | number;
  withdrawal_id?: string | number;
  address: string;
  currency: string;
  amount: number | string;
  status?: string;
  hash?: string;
  error?: string;
}

function getApiKey(): string | null {
  return process.env["NOWPAYMENTS_API_KEY"]?.trim() || null;
}

export function isNowPaymentsEnabled(): boolean {
  return !!getApiKey();
}

export function isNowPaymentsPayoutEnabled(): boolean {
  return !!(
    getApiKey() &&
    process.env["NOWPAYMENTS_EMAIL"]?.trim() &&
    process.env["NOWPAYMENTS_PASSWORD"]?.trim()
  );
}

export function getIpnCallbackUrl(): string | undefined {
  const explicit = process.env["NOWPAYMENTS_IPN_URL"]?.trim();
  if (explicit) return explicit;
  const base = process.env["PUBLIC_BASE_URL"]?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/api/nowpayments/ipn`;
}

async function apiCall<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  opts?: { jwt?: string },
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not set");

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  if (opts?.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;

  const res = await fetch(`${NOWPAYMENTS_BASE_URL}${path}`, {
    method,
    headers,
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

/** JWT for payouts / payment list (valid ~5 minutes). */
export async function getAuthToken(): Promise<string | null> {
  const email = process.env["NOWPAYMENTS_EMAIL"]?.trim();
  const password = process.env["NOWPAYMENTS_PASSWORD"]?.trim();
  if (!email || !password) return null;
  try {
    const res = await apiCall<{ token: string }>("POST", "/auth", { email, password });
    return res.token ?? null;
  } catch (e) {
    logger.warn({ e }, "NOWPayments auth (JWT) failed");
    return null;
  }
}

export type MinAmountInfo = {
  /** Minimum crypto units the gateway will accept. */
  minCrypto: number;
  /** Approximate USD equivalent of that minimum. */
  minUsd: number;
};

/**
 * Gateway minimum for generating a direct pay_address.
 * Uses currency_from=<crypto>&fiat_equivalent=usd (same check /payment uses).
 */
export async function getMinAmountInfo(payCurrency: string): Promise<MinAmountInfo> {
  const c = payCurrency.toLowerCase();
  try {
    const result = await apiCall<{ min_amount: number; fiat_equivalent?: number }>(
      "GET",
      `/min-amount?currency_from=${encodeURIComponent(c)}&currency_to=usd&fiat_equivalent=usd`,
    );
    const minCrypto = Number(result.min_amount);
    const minUsd = Number(result.fiat_equivalent ?? result.min_amount);
    if (Number.isFinite(minCrypto) && minCrypto > 0 && Number.isFinite(minUsd) && minUsd > 0) {
      return { minCrypto, minUsd };
    }
  } catch (e) {
    logger.warn({ e, payCurrency }, "NOWPayments min-amount failed — using fallback");
  }
  // Observed NP merchant floor is ~$11–13; keep a safe fallback.
  return { minCrypto: 0, minUsd: 12 };
}

/** @deprecated use getMinAmountInfo — kept for callers expecting a USD number. */
export async function getMinAmountUsd(payCurrency: string): Promise<number> {
  return (await getMinAmountInfo(payCurrency)).minUsd;
}

export async function estimateAmount(
  amount: number,
  currencyFrom: string,
  currencyTo: string,
): Promise<number | null> {
  try {
    const result = await apiCall<{ estimated_amount: number }>(
      "GET",
      `/estimate?amount=${amount}&currency_from=${encodeURIComponent(currencyFrom)}&currency_to=${encodeURIComponent(currencyTo)}`,
    );
    const n = Number(result.estimated_amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    logger.warn({ e, amount, currencyFrom, currencyTo }, "NOWPayments estimate failed");
    return null;
  }
}

/**
 * Create a crypto payment (address + amount). Works with API key (no JWT).
 * Optional payAmountCrypto forces the on-chain amount (used to clear gateway mins).
 */
export async function createPayment(
  payCurrency: string,
  priceAmountUsd: number,
  orderId: string,
  description?: string,
  payAmountCrypto?: number,
): Promise<NowPaymentsPayment> {
  const payload: Record<string, unknown> = {
    price_amount: priceAmountUsd,
    price_currency: "usd",
    pay_currency: payCurrency.toLowerCase(),
    order_id: orderId,
    order_description: description ?? "Casino Deposit",
  };
  if (payAmountCrypto != null && payAmountCrypto > 0) {
    payload.pay_amount = payAmountCrypto;
  }

  const ipnUrl = getIpnCallbackUrl();
  if (ipnUrl) payload.ipn_callback_url = ipnUrl;

  return apiCall<NowPaymentsPayment>("POST", "/payment", payload);
}

/**
 * Hosted invoice checkout — supports lower amounts when /payment min is higher.
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

/** Turn an invoice into a concrete payment (numeric payment_id + address). */
export async function createInvoicePayment(
  invoiceId: string | number,
  payCurrency: string,
): Promise<NowPaymentsPayment> {
  return apiCall<NowPaymentsPayment>("POST", "/invoice-payment", {
    iid: invoiceId,
    pay_currency: payCurrency.toLowerCase(),
  });
}

export async function getInvoice(invoiceId: string | number): Promise<NowPaymentsInvoice | null> {
  try {
    return await apiCall<NowPaymentsInvoice>("GET", `/invoice/${invoiceId}`);
  } catch (e) {
    logger.warn({ e, invoiceId }, "NOWPayments getInvoice failed");
    return null;
  }
}

function isMinAmountError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("amount_minimal") ||
    msg.includes("less than minimal") ||
    msg.includes("minimal") ||
    msg.includes("amountto is too small") ||
    msg.includes("too small")
  );
}

export type DepositCheckout = {
  mode: "payment";
  payment: NowPaymentsPayment;
  /** What the user asked for. */
  requestedUsd: number;
  /** Amount we actually created the address for (may be bumped to gateway min). */
  chargedUsd: number;
};

/**
 * Create a deposit with a direct in-chat pay_address — never an external checkout link.
 *
 * NOWPayments rejects address creation below ~$12/coin. For lower requests we bump
 * the charged USD to the gateway minimum so the user still gets an address in chat,
 * and they are credited for the charged amount when paid.
 */
export async function createDepositCheckout(
  payCurrency: string,
  priceAmountUsd: number,
  orderId: string,
  description?: string,
): Promise<DepositCheckout> {
  if (!getApiKey()) {
    throw new Error("Payments are not configured (missing API key). Contact admin.");
  }

  const ipnUrl = getIpnCallbackUrl();
  if (!ipnUrl) {
    logger.warn(
      "PUBLIC_BASE_URL / NOWPAYMENTS_IPN_URL missing — deposits will rely on poller only",
    );
  }

  const currency = payCurrency.toLowerCase().replace(/[^a-z0-9]/g, "");
  const min = await getMinAmountInfo(currency);
  // Small buffer so mid-flight rate moves don't re-trigger AMOUNT_MINIMAL_ERROR
  const gatewayFloor = Math.ceil((min.minUsd + 0.35) * 100) / 100;
  const chargedUsd = Math.max(
    Math.round(priceAmountUsd * 100) / 100,
    gatewayFloor,
  );

  let lastErr: unknown;

  // 1) Direct payment at charged amount (always prefer real address)
  try {
    const payment = await createPayment(currency, chargedUsd, orderId, description);
    if (payment.pay_address) {
      return {
        mode: "payment",
        payment,
        requestedUsd: priceAmountUsd,
        chargedUsd,
      };
    }
    lastErr = new Error("Payment created but address was empty");
  } catch (e) {
    lastErr = e;
    logger.warn(
      { e, orderId, currency, priceAmountUsd, chargedUsd },
      "NOWPayments createPayment failed — trying pay_amount override",
    );
  }

  // 2) Force pay_amount to gateway crypto minimum (still returns pay_address, no link)
  if (min.minCrypto > 0) {
    try {
      const payAmt = Math.ceil(min.minCrypto * 1e8) / 1e8;
      const payment = await createPayment(
        currency,
        chargedUsd,
        `${orderId}-m`,
        description,
        payAmt,
      );
      if (payment.pay_address) {
        return {
          mode: "payment",
          payment,
          requestedUsd: priceAmountUsd,
          chargedUsd,
        };
      }
      lastErr = new Error("Payment created but address was empty");
    } catch (e) {
      lastErr = e;
      logger.warn({ e, orderId, currency }, "NOWPayments pay_amount override failed");
    }
  }

  // 3) Last resort: invoice → invoice-payment for a concrete address (still no external link UI)
  try {
    const invoice = await createInvoice(currency, chargedUsd, `${orderId}-inv`, description);
    const payment = await createInvoicePayment(Number(invoice.id) || invoice.id, currency);
    if (payment.pay_address) {
      return {
        mode: "payment",
        payment,
        requestedUsd: priceAmountUsd,
        chargedUsd,
      };
    }
    lastErr = new Error("Invoice payment had no address");
  } catch (e) {
    lastErr = e;
    logger.warn({ e, orderId, currency }, "NOWPayments invoice→address failed");
  }

  if (isMinAmountError(lastErr)) {
    throw new Error(
      `Network minimum for this coin is about $${gatewayFloor.toFixed(2)}. Try that amount or another crypto.`,
    );
  }
  const detail = lastErr ? String(lastErr).slice(0, 180) : "unknown error";
  throw new Error(`Could not create deposit address. ${detail}`);
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
 * List recent payments (JWT). Used to resolve invoice → payment for polling.
 */
export async function listRecentPayments(limit = 50): Promise<NowPaymentsPayment[]> {
  const token = await getAuthToken();
  if (!token) return [];
  try {
    const res = await apiCall<{ data?: NowPaymentsPayment[] } | NowPaymentsPayment[]>(
      "GET",
      `/payment/?limit=${limit}&page=0&sortBy=created_at&orderBy=desc`,
      undefined,
      { jwt: token },
    );
    if (Array.isArray(res)) return res;
    return res.data ?? [];
  } catch (e) {
    logger.warn({ e }, "NOWPayments listRecentPayments failed");
    return [];
  }
}

/**
 * Create a mass payout withdrawal (JWT required).
 * amountCrypto is in the payout currency (e.g. LTC).
 */
export async function createPayout(opts: {
  address: string;
  currency: string;
  amountCrypto: number;
  uniqueExternalId?: string;
}): Promise<{ batchId?: string; withdrawal?: NowPaymentsPayoutWithdrawal } | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const ipnUrl = getIpnCallbackUrl();
  const withdrawal: Record<string, unknown> = {
    address: opts.address,
    currency: opts.currency.toLowerCase(),
    amount: opts.amountCrypto,
    ipn_callback_url: ipnUrl,
  };
  if (opts.uniqueExternalId) withdrawal.unique_external_id = opts.uniqueExternalId;

  try {
    const res = await apiCall<{
      id?: string | number;
      withdrawals?: NowPaymentsPayoutWithdrawal[];
    }>("POST", "/payout", { withdrawals: [withdrawal] }, { jwt: token });

    return {
      batchId: res.id != null ? String(res.id) : undefined,
      withdrawal: res.withdrawals?.[0],
    };
  } catch (e) {
    logger.error({ e, opts }, "NOWPayments createPayout failed");
    throw e;
  }
}

export async function getPayoutStatus(payoutId: string | number): Promise<unknown | null> {
  try {
    return await apiCall("GET", `/payout/${payoutId}`);
  } catch (e) {
    logger.warn({ e, payoutId }, "NOWPayments getPayoutStatus failed");
    return null;
  }
}

/**
 * Verify NOWPayments IPN signature (HMAC-SHA512 of sorted JSON body).
 * Header: x-nowpayments-sig
 */
export function verifyIpnSignature(body: unknown, signature: string): boolean {
  const secret = process.env["NOWPAYMENTS_IPN_SECRET"]?.trim();
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

export function isPayoutComplete(status: string): boolean {
  const s = status.toLowerCase();
  return s === "finished" || s === "confirmed" || s === "completed" || s === "sent";
}

export function isPayoutFailed(status: string): boolean {
  const s = status.toLowerCase();
  return s === "failed" || s === "rejected" || s === "expired" || s === "refunded";
}

/**
 * Poll pending deposits by payment_id (stored in txHash).
 * Also resolves invoice-only deposits when JWT credentials are available.
 */
export function startPaymentPoller(
  intervalMs: number,
  onPaid: (payment: NowPaymentsPayment) => Promise<void>,
  listPendingPaymentIds: () => Promise<string[]>,
  resolveInvoicePayments?: () => Promise<void>,
): NodeJS.Timeout {
  const poll = async () => {
    try {
      if (resolveInvoicePayments) {
        await resolveInvoicePayments().catch((e) =>
          logger.warn({ e }, "NOWPayments invoice resolve error"),
        );
      }

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
