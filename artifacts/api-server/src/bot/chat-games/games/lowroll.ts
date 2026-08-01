import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { crazyMult, playFromPlan, throwsFor } from "./_helpers";

/** Lower score wins — invert for compare by using negative value. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji: "🎲",
    throws,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      const raw = sum * mult;
      // Higher compare value = lower roll (so lowroll wins)
      const value = 1000 - raw;
      const body = vals.length > 1 ? `${vals.join("+")}=${sum}` : `${sum}`;
      return {
        value,
        display: mult > 1 ? `🎲 ${body}×${mult}=${raw}` : `🎲 ${body}`,
      };
    },
  };
}

export const lowrollGame: ChatGameDefinition = {
  id: "lowroll",
  command: "lowroll",
  title: "Low Roll Duel",
  emoji: "🎲",
  guideTitle: "Play Low Roll Games",
  description: "Real dice — lowest score wins",
  modeHint() {
    return "Lowest roll wins the point.";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
