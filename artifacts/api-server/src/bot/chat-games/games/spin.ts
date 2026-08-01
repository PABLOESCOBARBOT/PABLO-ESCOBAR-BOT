import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** Telegram 🎰 values 1–64. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🎰",
    throws,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      const value = sum * mult;
      const body = vals.length > 1 ? `${vals.join("+")}=${sum}` : `${sum}`;
      return {
        value,
        display: mult > 1 ? `🎰 ${body}×${mult}=${value}` : `🎰 ${body}`,
      };
    },
  };
}

export const spinGame: ChatGameDefinition = {
  id: "spin",
  command: "spin",
  title: "Slot Spin Duel",
  emoji: "🎰",
  guideTitle: "Play Slot Spin Games",
  description: "Real Telegram slot machine — higher spin wins",
  modeHint(mode) {
    if (mode === "normal") return "One real 🎰 spin each.";
    if (mode === "double") return "Two 🎰 spins — highest sum wins.";
    if (mode === "crazy") return "One 🎰 × random 1–2 multiplier!";
    return "Two 🎰 × random 1–3 multiplier!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
