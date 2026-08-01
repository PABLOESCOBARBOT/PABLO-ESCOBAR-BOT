import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d } from "../random";

function shot(mode: ChatGameMode): { value: number; display: string } {
  // value 1 = goal, 0 = miss; crazy modes can be power scores
  if (mode === "normal") {
    const goal = d(100) <= 55;
    return { value: goal ? 1 : 0, display: goal ? "⚽ GOAL!" : "🧤 SAVED!" };
  }
  if (mode === "double") {
    const g1 = d(100) <= 55;
    const g2 = d(100) <= 55;
    const v = (g1 ? 1 : 0) + (g2 ? 1 : 0);
    return { value: v, display: `${g1 ? "⚽" : "🧤"}${g2 ? "⚽" : "🧤"} (${v})` };
  }
  if (mode === "crazy") {
    const power = d(10);
    return { value: power, display: `⚡ Power ${power}/10` };
  }
  const power = d(10) + d(10);
  return { value: power, display: `🤯 Power ${power}/20` };
}

export const footballGame: ChatGameDefinition = {
  id: "football",
  command: "football",
  title: "Football Penalty",
  emoji: "⚽",
  description: "Penalties — better shot wins the point",
  modeHint(mode) {
    if (mode === "normal") return "One penalty shot.";
    if (mode === "double") return "Two shots — most goals wins.";
    if (mode === "crazy") return "Power shot 1–10!";
    return "Double power shot 2–20!";
  },
  playRound(mode): RoundResult {
    const host = shot(mode);
    const guest = shot(mode);
    let winner: "host" | "guest" | "draw" = "draw";
    if (host.value > guest.value) winner = "host";
    else if (host.value < guest.value) winner = "guest";
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: ["⚽ Preparing…", "⚽ → →", "⚽ → → → 🥅", "✨ Result!"],
    };
  },
};
