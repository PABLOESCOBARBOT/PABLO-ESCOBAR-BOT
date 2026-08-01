import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d, DICE_FACE } from "../random";

function rollMode(mode: ChatGameMode): { value: number; display: string } {
  if (mode === "normal") {
    const r = d(6);
    return { value: r, display: `${DICE_FACE[r]} ${r}` };
  }
  if (mode === "double") {
    const a = d(6);
    const b = d(6);
    return { value: a + b, display: `${DICE_FACE[a]} ${DICE_FACE[b]} = ${a + b}` };
  }
  if (mode === "crazy") {
    const r = d(6);
    const mult = d(2); // 1 or 2
    const value = r * mult;
    return { value, display: `${DICE_FACE[r]} ×${mult} = ${value}` };
  }
  // crazy_double
  const a = d(6);
  const b = d(6);
  const mult = d(3); // 1–3
  const value = (a + b) * mult;
  return { value, display: `${DICE_FACE[a]}+${DICE_FACE[b]} ×${mult} = ${value}` };
}

function compare(a: number, b: number): "host" | "guest" | "draw" {
  if (a > b) return "host";
  if (a < b) return "guest";
  return "draw";
}

export const diceGame: ChatGameDefinition = {
  id: "dice",
  command: "dice",
  title: "Dice Duel",
  emoji: "🎲",
  description: "Roll dice — higher score wins the point",
  modeHint(mode) {
    if (mode === "normal") return "Single d6 — highest wins the point.";
    if (mode === "double") return "Two dice each — highest sum wins.";
    if (mode === "crazy") return "d6 × random 1–2 multiplier!";
    return "2d6 × random 1–3 multiplier!";
  },
  playRound(mode): RoundResult {
    const host = rollMode(mode);
    const guest = rollMode(mode);
    const winner = compare(host.value, guest.value);
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: [
        "🎲 Rolling…",
        "🎲 Rolling..",
        "🎲 Rolling...",
        "✨ Dice settle!",
      ],
    };
  },
};
