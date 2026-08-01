import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** 🎯 — hitting 6 (bullseye) doubles that throw. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🎯",
    throws,
    combine: (vals) => {
      const scored = vals.reduce((a, v) => a + (v === 6 ? 12 : v), 0);
      const value = scored * mult;
      const parts = vals.map((v) => (v === 6 ? "6★" : `${v}`)).join("+");
      return {
        value,
        display: mult > 1 ? `🎯 ${parts}=${scored}×${mult}` : `🎯 ${parts}=${scored}`,
      };
    },
  };
}

export const bullseyeGame: ChatGameDefinition = {
  id: "bullseye",
  command: "bullseye",
  title: "Bullseye Duel",
  emoji: "🎯",
  guideTitle: "Play Bullseye Games",
  description: "Real darts — 6 is bullseye (double)",
  modeHint() {
    return "Hit 6 for bullseye double points.";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
