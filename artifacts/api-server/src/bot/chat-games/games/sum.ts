import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan } from "./_helpers";

/** Always two real dice — highest sum wins. */
function plan(mode: ChatGameMode): ThrowPlan {
  const mult = crazyMult(mode);
  return {
    emoji: "🎲",
    throws: 2,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      const value = sum * mult;
      return {
        value,
        display: mult > 1 ? `🎲 ${vals.join("+")}=${sum}×${mult}` : `🎲 ${vals.join("+")}=${sum}`,
      };
    },
  };
}

export const sumGame: ChatGameDefinition = {
  id: "sum",
  command: "sum",
  title: "Sum Duel",
  emoji: "🎲",
  guideTitle: "Play Sum Games",
  description: "Two real dice each — highest sum wins",
  modeHint(mode) {
    if (mode === "crazy" || mode === "crazy_double") return "Two 🎲 + multiplier.";
    return "Always two real 🎲 — highest sum wins.";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
