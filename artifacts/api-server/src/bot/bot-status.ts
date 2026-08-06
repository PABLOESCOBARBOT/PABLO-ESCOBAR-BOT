/** Runtime status for Railway /health debugging (no secrets). */

export type BotRuntimeStatus = {
  casino: {
    configured: boolean;
    username: string | null;
    polling: boolean;
    lastError: string | null;
  };
  admin: {
    configured: boolean;
    username: string | null;
    polling: boolean;
    allowListCount: number;
    lastUpdateAt: string | null;
    lastUpdateType: string | null;
    lastFromId: string | null;
    lastError: string | null;
    tokensClashWithCasino: boolean;
  };
};

export const botStatus: BotRuntimeStatus = {
  casino: {
    configured: false,
    username: null,
    polling: false,
    lastError: null,
  },
  admin: {
    configured: false,
    username: null,
    polling: false,
    allowListCount: 0,
    lastUpdateAt: null,
    lastUpdateType: null,
    lastFromId: null,
    lastError: null,
    tokensClashWithCasino: false,
  },
};

export function noteAdminUpdate(updateType: string, fromId: string | undefined): void {
  botStatus.admin.lastUpdateAt = new Date().toISOString();
  botStatus.admin.lastUpdateType = updateType;
  botStatus.admin.lastFromId = fromId ?? null;
}

export function noteAdminError(err: unknown): void {
  botStatus.admin.lastError = err instanceof Error ? err.message : String(err);
}
