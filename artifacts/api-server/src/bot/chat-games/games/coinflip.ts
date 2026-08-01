import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d } from "../random";

function flip(mode: ChatGameMode): { value: number; display: string } {
  if (mode === "normal") {
    const v = d(2); // 1 heads 2 tails
    return { value: v, display: v === 1 ? "🟡 Heads" : "⚫ Tails" };
  }
  if (mode === "double") {
    const a = d(2);
    const b = d(2);
    const heads = (a === 1 ? 1 : 0) + (b === 1 ? 1 : 0);
    return {
      value: heads,
      display: `${a === 1 ? "🟡" : "⚫"}+${b === 1 ? "🟡" : "⚫"} (${heads} heads)`,
    };
  }
  if (mode === "crazy") {
    const v = d(3); // 1H 2T 3 edge=0.5→treat as 0
    if (v === 3) return { value: 0, display: "🪙 Edge!" };
    return { value: v, display: v === 1 ? "🟡 Heads" : "⚫ Tails" };
  }
  const flips = [d(2), d(2), d(2)];
  const heads = flips.filter((x) => x === 1).length;
  return {
    value: heads,
    display: flips.map((x) => (x === 1 ? "🟡" : "⚫")).join("") + ` (${heads})`,
  };
}

export const coinflipGame: ChatGameDefinition = {
  id: "coinflip",
  command: "coinflip",
  title: "Coin Flip Duel",
  emoji: "🪙",
  guideTitle: "Play Coin Flip Games",
  description: "Flip coins — better result wins the point",
  modeHint(mode) {
    if (mode === "normal") return "One flip — Heads beats Tails.";
    if (mode === "double") return "Two flips — most Heads wins.";
    if (mode === "crazy") return "Crazy coin — Edge is weakest!";
    return "Triple flip — most Heads wins.";
  },
  playRound(mode): RoundResult {
    const host = flip(mode);
    const guest = flip(mode);
    let winner: "host" | "guest" | "draw" = "draw";
    if (host.value > guest.value) winner = "host";
    else if (host.value < guest.value) winner = "guest";
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: ["🪙 Flipping…", "🪙 ⬆️", "🪙 ⬇️", "✨ Coin lands!"],
    };
  },
};
