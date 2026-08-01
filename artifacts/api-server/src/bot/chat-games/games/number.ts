import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d } from "../random";

function roll(mode: ChatGameMode): { value: number; display: string } {
  if (mode === "normal") {
    const n = d(100);
    return { value: n, display: `🔢 ${n}` };
  }
  if (mode === "double") {
    const n = d(100) + d(100);
    return { value: n, display: `🔢 ${n}` };
  }
  if (mode === "crazy") {
    const n = d(100);
    const mult = d(3);
    return { value: n * mult, display: `🤪 ${n}×${mult}=${n * mult}` };
  }
  const n = d(100) + d(100);
  const mult = d(3);
  return { value: n * mult, display: `🤯 ${n}×${mult}=${n * mult}` };
}

export const numberGame: ChatGameDefinition = {
  id: "number",
  command: "number",
  title: "Number War",
  emoji: "🔢",
  guideTitle: "Play Number Games",
  description: "Random numbers — higher wins the point",
  playRound(mode): RoundResult {
    const host = roll(mode);
    const guest = roll(mode);
    let winner: "host" | "guest" | "draw" = "draw";
    if (host.value > guest.value) winner = "host";
    else if (host.value < guest.value) winner = "guest";
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: ["🔢 Generating…", "🔢 ???", "🔢 ?????", "✨ Number locked!"],
    };
  },
};
