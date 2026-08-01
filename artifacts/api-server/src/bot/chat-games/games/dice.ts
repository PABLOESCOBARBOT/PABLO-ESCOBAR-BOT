import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan } from "../types";
import { d, DICE_FACE } from "../random";

function plan(mode: ChatGameMode): ThrowPlan {
  if (mode === "normal") {
    return {
      emoji: "🎲",
      throws: 1,
      combine: ([a]) => ({
        value: a!,
        display: `${DICE_FACE[a!] ?? "🎲"} ${a}`,
      }),
    };
  }
  if (mode === "double") {
    return {
      emoji: "🎲",
      throws: 2,
      combine: (vals) => {
        const sum = vals.reduce((x, y) => x + y, 0);
        const faces = vals.map((v) => DICE_FACE[v] ?? "🎲").join(" ");
        return { value: sum, display: `${faces} = ${sum}` };
      },
    };
  }
  if (mode === "crazy") {
    return {
      emoji: "🎲",
      throws: 1,
      combine: ([a]) => {
        const mult = d(2);
        const value = a! * mult;
        return { value, display: `${DICE_FACE[a!] ?? "🎲"} ×${mult} = ${value}` };
      },
    };
  }
  return {
    emoji: "🎲",
    throws: 2,
    combine: (vals) => {
      const mult = d(3);
      const sum = vals.reduce((x, y) => x + y, 0);
      const value = sum * mult;
      const faces = vals.map((v) => DICE_FACE[v] ?? "🎲").join("+");
      return { value, display: `${faces} ×${mult} = ${value}` };
    },
  };
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
    // RNG fallback (should rarely be used when throwPlan is active)
    const p = plan(mode);
    const hostVals = Array.from({ length: p.throws }, () => d(6));
    const guestVals = Array.from({ length: p.throws }, () => d(6));
    const host = p.combine(hostVals);
    const guest = p.combine(guestVals);
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner: compare(host.value, guest.value),
      narration: ["🎲 Rolling…"],
    };
  },
};
