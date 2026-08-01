import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d } from "../random";

function shoot(mode: ChatGameMode): { value: number; display: string } {
  if (mode === "normal") {
    const hit = d(100) <= 48;
    return { value: hit ? 1 : 0, display: hit ? "🏀🟢 SCORE!" : "🏀❌ MISS!" };
  }
  if (mode === "double") {
    const a = d(100) <= 48;
    const b = d(100) <= 48;
    const v = (a ? 1 : 0) + (b ? 1 : 0);
    return { value: v, display: `${a ? "🟢" : "❌"}${b ? "🟢" : "❌"} (${v})` };
  }
  if (mode === "crazy") {
    const pts = d(3); // 1–3 pointer style
    const hit = d(100) <= 55 - pts * 10;
    return { value: hit ? pts : 0, display: hit ? `🏀 +${pts}pts` : "🏀 brick" };
  }
  const pts = d(3) + d(3);
  const hit = d(100) <= 40;
  return { value: hit ? pts : 0, display: hit ? `🤯 +${pts}pts` : "💥 airball" };
}

export const basketballGame: ChatGameDefinition = {
  id: "basketball",
  command: "basketball",
  title: "Basketball Duel",
  emoji: "🏀",
  description: "Shoot hoops — better score wins the point",
  playRound(mode): RoundResult {
    const host = shoot(mode);
    const guest = shoot(mode);
    let winner: "host" | "guest" | "draw" = "draw";
    if (host.value > guest.value) winner = "host";
    else if (host.value < guest.value) winner = "guest";
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: ["🏀 Shoots…", "🏀 ↗️", "🏀 ↗️↗️", "✨ Rim check!"],
    };
  },
};
