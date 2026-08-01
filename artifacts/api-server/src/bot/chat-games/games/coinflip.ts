import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** Real 🎲 — odd = Heads, even = Tails. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🎲",
    throws,
    combine: (vals) => {
      const heads = vals.filter((v) => v % 2 === 1).length;
      const value = heads * mult;
      const faces = vals.map((v) => (v % 2 === 1 ? "H" : "T")).join("");
      return {
        value,
        display: mult > 1 ? `🪙 ${faces} (${heads}H)×${mult}` : `🪙 ${faces} (${heads}H)`,
      };
    },
  };
}

export const coinflipGame: ChatGameDefinition = {
  id: "coinflip",
  command: "coinflip",
  title: "Coin Flip Duel",
  emoji: "🪙",
  guideTitle: "Play Coin Flip Games",
  description: "Animated 🎲 — odd Heads, even Tails",
  modeHint(mode) {
    if (mode === "normal") return "One 🎲: odd=Heads, even=Tails. Most Heads wins.";
    if (mode === "double") return "Two 🎲 — most Heads wins.";
    if (mode === "crazy") return "Heads count × multiplier!";
    return "Two 🎲 + Heads multiplier!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
