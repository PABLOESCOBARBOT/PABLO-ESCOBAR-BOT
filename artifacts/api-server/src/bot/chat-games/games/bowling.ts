import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { playFromPlan, sumPlan } from "./_helpers";

function plan(mode: ChatGameMode) {
  return sumPlan("🎳", mode, "🎳");
}

export const bowlingGame: ChatGameDefinition = {
  id: "bowling",
  command: "bowling",
  title: "Bowling Duel",
  emoji: "🎳",
  guideTitle: "Play Bowling Games",
  description: "Real Telegram bowling — highest score wins",
  modeHint(mode) {
    if (mode === "normal") return "One real 🎳 throw each.";
    if (mode === "double") return "Two 🎳 throws — highest sum wins.";
    if (mode === "crazy") return "One 🎳 × random 1–2 multiplier!";
    return "Two 🎳 × random 1–3 multiplier!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
