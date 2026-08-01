import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { d } from "../random";

/** Telegram 🏀 values 1–5. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = mode === "double" || mode === "crazy_double" ? 2 : 1;
  return {
    emoji: "🏀",
    throws,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      const marks = vals.map((v) => (v >= 4 ? "in" : "miss")).join("+");
      return { value: sum, display: `🏀 ${marks} (${sum})` };
    },
  };
}

export const basketballGame: ChatGameDefinition = {
  id: "basketball",
  command: "basketball",
  title: "Basketball Duel",
  emoji: "🏀",
  guideTitle: "Play Basketball Games",
  description: "Real Telegram basketball emoji — better shot wins",
  throwPlan: plan,
  playRound(mode): RoundResult {
    const p = plan(mode);
    const hostVals = Array.from({ length: p.throws }, () => d(5));
    const guestVals = Array.from({ length: p.throws }, () => d(5));
    const host = p.combine(hostVals);
    const guest = p.combine(guestVals);
    let winner: "host" | "guest" | "draw" = "draw";
    if (host.value > guest.value) winner = "host";
    else if (host.value < guest.value) winner = "guest";
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: ["🏀 …"],
    };
  },
};
