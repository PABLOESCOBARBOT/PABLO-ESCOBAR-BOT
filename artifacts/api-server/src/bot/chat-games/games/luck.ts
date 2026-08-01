import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { playFromPlan } from "./_helpers";

/** Real dice — lucky totals get a bonus. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = mode === "normal" || mode === "crazy" ? 2 : 3;
  return {
    emoji: "🎲",
    throws,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      let value = sum;
      let tag = "";
      if (sum === 7) {
        value = 77;
        tag = " LUCKY7";
      } else if (sum === 21) {
        value = 63;
        tag = " LUCKY21";
      } else if (mode === "crazy" || mode === "crazy_double") {
        value = sum * 2;
        tag = "×2";
      }
      return {
        value,
        display: `🍀 ${vals.join("+")}=${sum}${tag}`,
      };
    },
  };
}

export const luckGame: ChatGameDefinition = {
  id: "luck",
  command: "luck",
  title: "Lucky Roll",
  emoji: "🍀",
  guideTitle: "Play Luck Games",
  description: "Real dice — lucky 7 / 21 hit big",
  modeHint(mode) {
    if (mode === "normal") return "Two 🎲 — hit 7 for lucky bonus.";
    if (mode === "double") return "Three 🎲 — 7 or 21 are lucky.";
    if (mode === "crazy") return "Two 🎲 — lucky 7 or all scores ×2.";
    return "Three 🎲 — lucky 7/21 or ×2.";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
