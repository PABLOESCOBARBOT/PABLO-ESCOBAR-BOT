import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** 🎳 — 6 is a strike (double that throw). */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🎳",
    throws,
    combine: (vals) => {
      const scored = vals.reduce((a, v) => a + (v === 6 ? 12 : v), 0);
      const value = scored * mult;
      const parts = vals.map((v) => (v === 6 ? "X" : `${v}`)).join("+");
      return {
        value,
        display: mult > 1 ? `🎳 ${parts}=${scored}×${mult}` : `🎳 ${parts}=${scored}`,
      };
    },
  };
}

export const strikeGame: ChatGameDefinition = {
  id: "strike",
  command: "strike",
  title: "Strike Bowling",
  emoji: "🎳",
  guideTitle: "Play Strike Games",
  description: "Real bowling — 6 is a strike (double)",
  modeHint(mode) {
    if (mode === "normal") return "One real 🎳 — 6 is a strike (double).";
    if (mode === "double") return "Two 🎳 — 6 = strike double.";
    if (mode === "crazy") return "One 🎳 × multiplier — strikes double!";
    return "Two 🎳 × multiplier — strikes double!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
