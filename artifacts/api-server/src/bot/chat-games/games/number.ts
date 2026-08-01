import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan } from "./_helpers";

/** Two real 🎲 → number like 35 (first×10 + second). */
function plan(mode: ChatGameMode): ThrowPlan {
  const mult = crazyMult(mode);
  return {
    emoji: "🎲",
    throws: 2,
    combine: (vals) => {
      const a = vals[0]!;
      const b = vals[1]!;
      const n = a * 10 + b;
      const value = n * mult;
      return {
        value,
        display: mult > 1 ? `🔢 ${a}${b}×${mult}=${value}` : `🔢 ${a}${b}`,
      };
    },
  };
}

export const numberGame: ChatGameDefinition = {
  id: "number",
  command: "number",
  title: "Number War",
  emoji: "🔢",
  guideTitle: "Play Number Games",
  description: "Two real dice make your number (11–66)",
  modeHint(mode) {
    if (mode === "crazy" || mode === "crazy_double") return "Two 🎲 → number × multiplier.";
    return "Two 🎲 make a number 11–66. Higher wins.";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
