import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d } from "../random";

function throwDart(mode: ChatGameMode): { value: number; display: string } {
  if (mode === "normal") {
    const score = d(20);
    return { value: score, display: `🎯 ${score}` };
  }
  if (mode === "double") {
    const a = d(20);
    const b = d(20);
    return { value: a + b, display: `🎯 ${a}+${b}=${a + b}` };
  }
  if (mode === "crazy") {
    const score = d(100) <= 10 ? 50 : d(20);
    return { value: score, display: score === 50 ? "🔴 BULL 50" : `🎯 ${score}` };
  }
  const a = d(20);
  const b = d(20);
  const bull = d(100) <= 8 ? 50 : 0;
  const value = a + b + bull;
  return { value, display: bull ? `🎯${a}+${b}+🔴${bull}=${value}` : `🎯${a}+${b}=${value}` };
}

export const dartGame: ChatGameDefinition = {
  id: "dart",
  command: "dart",
  title: "Dart Duel",
  emoji: "🎯",
  description: "Throw darts — highest score wins the point",
  playRound(mode): RoundResult {
    const host = throwDart(mode);
    const guest = throwDart(mode);
    let winner: "host" | "guest" | "draw" = "draw";
    if (host.value > guest.value) winner = "host";
    else if (host.value < guest.value) winner = "guest";
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: ["🎯 Target ready…", "🏹 →", "🏹 → → 🎯", "✨ Hit!"],
    };
  },
};
