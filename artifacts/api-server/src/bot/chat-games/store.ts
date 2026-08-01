import { randomBytes } from "node:crypto";
import type { ChatMatch } from "./types";

const MATCH_TTL_MS = 30 * 60 * 1000;

class ChatGameStore {
  private matches = new Map<string, ChatMatch>();
  private byUser = new Map<string, string>(); // userId -> matchId (active setup/play)

  newId(): string {
    return randomBytes(4).toString("hex");
  }

  get(id: string): ChatMatch | undefined {
    const m = this.matches.get(id);
    if (!m) return undefined;
    if (Date.now() - m.updatedAt > MATCH_TTL_MS) {
      this.delete(id);
      return undefined;
    }
    return m;
  }

  save(match: ChatMatch): void {
    match.updatedAt = Date.now();
    this.matches.set(match.id, match);
    this.byUser.set(match.host.userId, match.id);
    if (match.guest) this.byUser.set(match.guest.userId, match.id);
  }

  getForUser(userId: string): ChatMatch | undefined {
    const id = this.byUser.get(userId);
    return id ? this.get(id) : undefined;
  }

  clearUser(userId: string): void {
    const id = this.byUser.get(userId);
    if (!id) return;
    const m = this.matches.get(id);
    if (m) {
      if (m.host.userId === userId || m.guest?.userId === userId) {
        // only drop mapping; match may continue for other player until cancelled
      }
    }
    this.byUser.delete(userId);
  }

  delete(id: string): void {
    const m = this.matches.get(id);
    if (!m) return;
    this.byUser.delete(m.host.userId);
    if (m.guest) this.byUser.delete(m.guest.userId);
    this.matches.delete(id);
  }
}

export const chatStore = new ChatGameStore();
