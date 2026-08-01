import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan } from "./_helpers";

/** Always two dice — matching pair gets big bonus. */
function plan(mode: ChatGameMode): ThrowPlan {
  const mult = crazyMult(mode);
  return {
    emoji: "🎲",
    throws: 2,
    combine: (vals) => {
      const [a, b] = vals;
      const sum = (a ?? 0) + (b ?? 0);
      const twin = a === b;
      const scored = twin ? sum * 3 : sum;
      const value = scored * mult;
      return {
        value,
        display: twin
          ? `🎲 ${a}+${b} TWIN=${scored}${mult > 1 ? `×${mult}` : ""}`
          : `🎲 ${a}+${b}=${sum}${mult > 1 ? `×${mult}` : ""}`,
      };
    },
  };
}

export const twinGame: ChatGameDefinition = {
  id: "twin",
  command: "twin",
  title: "Twin Dice",
  emoji: "🎲",
  guideTitle: "Play Twin Dice Games",
  description: "Two real dice — matching pair ×3",
  modeHint() {
    return "Two 🎲 each. Matching pair scores ×3.";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
