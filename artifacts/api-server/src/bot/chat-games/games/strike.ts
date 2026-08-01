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
  modeHint() {
    return "Roll 6 for a strike (double points).";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
