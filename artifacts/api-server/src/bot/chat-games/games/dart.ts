import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { playFromPlan, sumPlan } from "./_helpers";

function plan(mode: ChatGameMode) {
  return sumPlan("🎯", mode, "🎯");
}

export const dartGame: ChatGameDefinition = {
  id: "dart",
  command: "dart",
  title: "Dart Duel",
  emoji: "🎯",
  guideTitle: "Play Dart Games",
  description: "Real Telegram dart — highest score wins",
  modeHint(mode) {
    if (mode === "normal") return "One real 🎯 each.";
    if (mode === "double") return "Two 🎯 — highest sum wins.";
    if (mode === "crazy") return "One 🎯 × multiplier!";
    return "Two 🎯 × multiplier!";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
