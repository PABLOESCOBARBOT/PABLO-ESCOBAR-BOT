import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { DICE_FACE } from "../random";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🎲",
    throws,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      const value = sum * mult;
      const faces = vals.map((v) => DICE_FACE[v] ?? "🎲").join(" ");
      return {
        value,
        display:
          mult > 1
            ? `${faces} =${sum}×${mult}`
            : vals.length > 1
              ? `${faces} =${sum}`
              : `${faces} ${sum}`,
      };
    },
  };
}

export const diceGame: ChatGameDefinition = {
  id: "dice",
  command: "dice",
  title: "Dice Duel",
  emoji: "🎲",
  guideTitle: "Play Dice Games",
  description: "Roll real Telegram dice — higher wins the point",
  modeHint(mode) {
    if (mode === "normal") return "One real 🎲 throw each.";
    if (mode === "double") return "Two real 🎲 throws — highest sum wins.";
    if (mode === "crazy") return "One 🎲 × random 1–2 multiplier!";
    return "Two 🎲 × random 1–3 multiplier!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
