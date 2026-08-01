import type { ChatGameDefinition, ChatGameMode, RoundResult } from "../types";
import { d } from "../random";

const MOVES = ["rock", "paper", "scissors"] as const;
const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };

function move(mode: ChatGameMode): { value: number; display: string; raw: string } {
  // value encoding for crazy modes: rock=0 paper=1 scissors=2, crazy adds wild
  if (mode === "crazy" || mode === "crazy_double") {
    const r = d(4); // 1-3 normal, 4 = lizard/spock-like wild high
    if (r === 4) return { value: 10, display: "🦎 Lizard", raw: "lizard" };
    const m = MOVES[r - 1]!;
    return { value: r, display: `${EMOJI[m]} ${m}`, raw: m };
  }
  const r = d(3);
  const m = MOVES[r - 1]!;
  // For double: play two and take "strength" — still one move for simplicity but animated as double
  if (mode === "double") {
    const r2 = d(3);
    const m2 = MOVES[r2 - 1]!;
    // use RPS winner of the two against each other as throw — pick randomly between them weighted
    const pick = d(2) === 1 ? m : m2;
    const idx = MOVES.indexOf(pick) + 1;
    return { value: idx, display: `${EMOJI[m]}/${EMOJI[m2]} → ${EMOJI[pick]}`, raw: pick };
  }
  return { value: r, display: `${EMOJI[m]} ${m}`, raw: m };
}

function beats(a: string, b: string): "host" | "guest" | "draw" {
  if (a === b) return "draw";
  if (a === "lizard") return b === "lizard" ? "draw" : "host";
  if (b === "lizard") return "guest";
  if (
    (a === "rock" && b === "scissors") ||
    (a === "paper" && b === "rock") ||
    (a === "scissors" && b === "paper")
  ) {
    return "host";
  }
  return "guest";
}

export const rpsGame: ChatGameDefinition = {
  id: "rps",
  command: "rps",
  title: "Rock Paper Scissors",
  emoji: "✊",
  guideTitle: "Play RPS Games",
  description: "Classic RPS — win the throw to score",
  modeHint(mode) {
    if (mode === "normal") return "Classic Rock / Paper / Scissors.";
    if (mode === "double") return "Two gestures — one final throw!";
    if (mode === "crazy") return "Lizard may appear!";
    return "Crazy Double — lizards everywhere.";
  },
  playRound(mode): RoundResult {
    const host = move(mode);
    const guest = move(mode);
    const winner = beats(host.raw, guest.raw);
    return {
      hostValue: host.value,
      guestValue: guest.value,
      hostDisplay: host.display,
      guestDisplay: guest.display,
      winner,
      narration: ["Showdown…", "vs …", "Reveal!"],
    };
  },
};
