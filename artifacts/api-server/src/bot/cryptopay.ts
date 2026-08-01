/**
 * CryptoPay Gateway Integration
 *
 * CryptoPay (by Telegram's @CryptoBot) is the recommended gateway for Telegram bots.
 * It generates unique payment invoices per user, detects payments automatically,
 * and allows sending payment notifications via webhook or polling.
 *
 * Setup:
 *   1. Open @CryptoBot on Telegram
 *   2. /pay → My Apps → Create App
 *   3. Copy API token → set env: CRYPTOPAY_TOKEN=<token>
 *   4. Set webhook in your app (optional, polling fallback included)
 *
 * Docs: https://help.crypt.bot/crypto-pay-api
 */

import { logger } from "../lib/logger";

const CRYPTOPAY_BASE_URL = "https://pay.crypt.bot/api";
// For testnet use: https://testnet-pay.crypt.bot/api

export interface CryptoPayInvoice {
  invoice_id: number;
  hash: string;
  currency_type: string;
  asset?: string;
  fiat?: string;
  amount: string;
  /** @deprecated Prefer bot_invoice_url */
  pay_url: string;
  bot_invoice_url?: string;
  description?: string;
  status: "active" | "paid" | "expired";
  created_at: string;
  paid_at?: string;
  payload?: string; // our custom data, e.g. telegramId:depositTxId
}

interface CryptoPayResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: number; name: string };
}

/** Supported CryptoPay assets */
export const CRYPTOPAY_ASSETS = ["USDT", "BTC", "ETH", "TON", "BNB", "TRX", "LTC", "USDC"] as const;
export type CryptoPayAsset = typeof CRYPTOPAY_ASSETS[number];

function getToken(): string | null {
  return process.env["CRYPTOPAY_TOKEN"] ?? null;
}

/** Check if CryptoPay is configured */
export function isCryptoPayEnabled(): boolean {
  return !!getToken();
}

/** Call CryptoPay API */
async function apiCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("CRYPTOPAY_TOKEN not set");

  const url = new URL(`${CRYPTOPAY_BASE_URL}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "Crypto-Pay-API-Token": token },
  });

  if (!res.ok) {
    throw new Error(`CryptoPay HTTP error: ${res.status}`);
  }

  const json = (await res.json()) as CryptoPayResponse<T>;
  if (!json.ok) {
    throw new Error(`CryptoPay API error: ${json.error?.name ?? "Unknown"}`);
  }

  return json.result!;
}

/**
 * Create a payment invoice for a user.
 * @param asset  Crypto asset (USDT, BTC, TON, etc.)
 * @param amount Amount in that asset
 * @param payload Custom string we store (e.g. "userId:txId")
 * @param description shown to user in CryptoBot
 */
export async function createInvoice(
  asset: string,
  amount: number,
  payload: string,
  description?: string,
): Promise<CryptoPayInvoice> {
  return apiCall<CryptoPayInvoice>("createInvoice", {
    asset,
    amount: amount.toFixed(8),
    payload,
    description: description ?? "Casino Deposit",
    expires_in: 3600, // 1 hour
  });
}

/**
 * Get all paid invoices since a given date.
 * Used for polling-based payment detection.
 */
export async function getPaidInvoices(since?: Date): Promise<CryptoPayInvoice[]> {
  interface InvoiceList { items: CryptoPayInvoice[] }
  const result = await apiCall<InvoiceList>("getInvoices", {
    status: "paid",
    count: 100,
  });

  const items = result.items ?? [];
  if (!since) return items;

  return items.filter(inv => {
    const paidAt = inv.paid_at ? new Date(inv.paid_at) : null;
    return paidAt && paidAt > since;
  });
}

/**
 * Get a specific invoice by ID.
 */
export async function getInvoice(invoiceId: number): Promise<CryptoPayInvoice | null> {
  try {
    interface InvoiceList { items: CryptoPayInvoice[] }
    const result = await apiCall<InvoiceList>("getInvoices", {
      invoice_ids: String(invoiceId),
    });
    return result.items?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify a CryptoPay webhook signature.
 * Pass the raw body string and the X-Crypto-Pay-Api-Signature header value.
 */
export async function verifyWebhookSignature(
  body: string,
  signature: string,
): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  try {
    // HMAC-SHA256 of the body using SHA256(token) as the key
    const enc = new TextEncoder();
    const tokenHash = await crypto.subtle.digest("SHA-256", enc.encode(token));
    const key = await crypto.subtle.importKey(
      "raw", tokenHash, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const computed = Array.from(new Uint8Array(mac))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    return computed === signature.toLowerCase();
  } catch (e) {
    logger.error({ e }, "Error verifying CryptoPay signature");
    return false;
  }
}

/**
 * Start a polling loop that checks for new paid invoices every N seconds.
 * Calls `onPaid` for each newly paid invoice.
 */
export function startPaymentPoller(
  intervalMs: number,
  onPaid: (invoice: CryptoPayInvoice) => Promise<void>,
): NodeJS.Timeout {
  let lastCheck = new Date();

  const poll = async () => {
    try {
      const paid = await getPaidInvoices(lastCheck);
      lastCheck = new Date();
      for (const inv of paid) {
        await onPaid(inv).catch(e => logger.error({ e, inv }, "onPaid callback error"));
      }
    } catch (e) {
      logger.error({ e }, "CryptoPay polling error");
    }
  };

  // First poll after a short delay
  setTimeout(poll, 5000);
  return setInterval(poll, intervalMs);
}
