import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** Odd rolls score double — still uses real 🎲. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🎲",
    throws,
    combine: (vals) => {
      const raw = vals.reduce((a, b) => a + b, 0);
      const oddBonus = vals.reduce((a, v) => a + (v % 2 === 1 ? v : 0), 0);
      // even keeps face value, odd counts twice → total = raw + odd faces
      const scored = raw + oddBonus;
      const value = scored * mult;
      const faces = vals.map((v) => (v % 2 === 1 ? `${v}o` : `${v}e`)).join("+");
      return {
        value,
        display:
          mult > 1
            ? `🎲 ${faces}=${scored}×${mult}`
            : `🎲 ${faces}=${scored}`,
      };
    },
  };
}

export const oddevenGame: ChatGameDefinition = {
  id: "oddeven",
  command: "oddeven",
  title: "Odd Even Duel",
  emoji: "🎲",
  guideTitle: "Play Odd Even Games",
  description: "Real dice — odd rolls score double",
  modeHint(mode) {
    if (mode === "normal") return "Odd numbers score double.";
    if (mode === "double") return "Two dice — odds score double.";
    if (mode === "crazy") return "Odds double + multiplier!";
    return "Two dice, odds double + multiplier!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
