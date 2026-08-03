import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** 🏀 — 4–5 count as made shots (score face), else 0. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🏀",
    throws,
    combine: (vals) => {
      const scored = vals.reduce((a, v) => a + (v >= 4 ? v : 0), 0);
      const value = scored * mult;
      const parts = vals.map((v) => (v >= 4 ? `in${v}` : "miss")).join("+");
      return {
        value,
        display: mult > 1 ? `🏀 ${parts}=${scored}×${mult}` : `🏀 ${parts}=${scored}`,
      };
    },
  };
}

export const hoopGame: ChatGameDefinition = {
  id: "hoop",
  command: "hoop",
  title: "Hoop Shot",
  emoji: "🏀",
  guideTitle: "Play Hoop Games",
  description: "Real basketball — only made shots (4+) score",
  modeHint(mode) {
    if (mode === "normal") return "One real 🏀 — make 4–5 to score, miss = 0.";
    if (mode === "double") return "Two 🏀 — only made shots (4+) count.";
    if (mode === "crazy") return "One 🏀 × multiplier — makes only!";
    return "Two 🏀 × multiplier — makes only!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
