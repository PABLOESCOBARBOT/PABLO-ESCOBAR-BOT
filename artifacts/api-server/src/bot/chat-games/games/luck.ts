import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d, DICE_FACE } from "../random";

function roll(mode: ChatGameMode): { value: number; display: string } {
  if (mode === "normal") {
    const r = d(6);
    return { value: r, display: `${DICE_FACE[r]} ${r}` };
  }
  if (mode === "double") {
    const a = d(6);
    const b = d(6);
    return { value: a + b, display: `${DICE_FACE[a]}${DICE_FACE[b]} = ${a + b}` };
  }
  if (mode === "crazy") {
    // Lucky 7 special
    const a = d(6);
    const b = d(6);
    const sum = a + b;
    const value = sum === 7 ? 77 : sum;
    return { value, display: sum === 7 ? `LUCKY 7!` : `${DICE_FACE[a]}${DICE_FACE[b]} = ${sum}` };
  }
  const rolls = [d(6), d(6), d(6)];
  const sum = rolls.reduce((x, y) => x + y, 0);
  const value = sum === 7 || sum === 21 ? sum * 3 : sum;
  return {
    value,
    display: rolls.map((r) => DICE_FACE[r]).join("") + ` = ${sum}${value !== sum ? " (bonus)" : ""}`,
  };
}

export const luckGame: ChatGameDefinition = {
  id: "luck",
  command: "luck",
  title: "Lucky Roll",
  emoji: "🍀",
  guideTitle: "Play Luck Games",
  description: "Lucky rolls — higher (or lucky 7) wins",
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
      narration: ["Feeling lucky…", "🎲 …", "Fortune!"],
    };
  },
};
