import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** ⚽ — values 3–5 count as goals (score the face), miss = 0. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "⚽",
    throws,
    combine: (vals) => {
      const scored = vals.reduce((a, v) => a + (v >= 3 ? v : 0), 0);
      const value = scored * mult;
      const parts = vals.map((v) => (v >= 3 ? `G${v}` : "miss")).join("+");
      return {
        value,
        display: mult > 1 ? `⚽ ${parts}=${scored}×${mult}` : `⚽ ${parts}=${scored}`,
      };
    },
  };
}

export const goalGame: ChatGameDefinition = {
  id: "goal",
  command: "goal",
  title: "Goal Rush",
  emoji: "⚽",
  guideTitle: "Play Goal Games",
  description: "Real football — only goals (3+) score",
  modeHint(mode) {
    if (mode === "normal") return "One real ⚽ — miss under 3, goals 3–5 score.";
    if (mode === "double") return "Two ⚽ — only goals (3+) count.";
    if (mode === "crazy") return "One ⚽ × multiplier — goals only!";
    return "Two ⚽ × multiplier — goals only!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
