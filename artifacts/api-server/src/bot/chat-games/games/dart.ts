import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { d } from "../random";

/** Telegram 🎯 values 1–6. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = mode === "double" || mode === "crazy_double" ? 2 : 1;
  return {
    emoji: "🎯",
    throws,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      return { value: sum, display: `🎯 ${vals.join("+")}${vals.length > 1 ? `=${sum}` : ""}` };
    },
  };
}

export const dartGame: ChatGameDefinition = {
  id: "dart",
  command: "dart",
  title: "Dart Duel",
  emoji: "🎯",
  guideTitle: "Play Dart Games",
  description: "Real Telegram dart emoji — highest score wins",
  throwPlan: plan,
  playRound(mode): RoundResult {
    const p = plan(mode);
    const hostVals = Array.from({ length: p.throws }, () => d(6));
    const guestVals = Array.from({ length: p.throws }, () => d(6));
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
      narration: ["🎯 …"],
    };
  },
};
