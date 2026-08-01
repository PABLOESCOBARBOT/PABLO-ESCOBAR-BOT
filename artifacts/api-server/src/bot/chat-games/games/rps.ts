import type { ChatGameDefinition, ChatGameMode, RoundResult, ThrowPlan, ThrowScore } from "../types";
import { playFromPlan, throwsFor } from "./_helpers";

const MOVES = ["rock", "paper", "scissors"] as const;
const ICON = { rock: "🪨", paper: "📄", scissors: "✂️" } as const;

function moveFromDie(v: number): (typeof MOVES)[number] {
  return MOVES[(v - 1) % 3]!;
}

function beats(a: (typeof MOVES)[number], b: (typeof MOVES)[number]): "host" | "guest" | "draw" {
  if (a === b) return "draw";
  if (
    (a === "rock" && b === "scissors") ||
    (a === "paper" && b === "rock") ||
    (a === "scissors" && b === "paper")
  ) {
    return "host";
  }
  return "guest";
}

/** Real 🎲 mapped to RPS via (die-1)%3. */
function plan(mode: ChatGameMode): ThrowPlan {
  const throws = throwsFor(mode);
  return {
    emoji: "🎲",
    throws,
    combine: (vals) => {
      const pick = vals[vals.length - 1]!;
      const m = moveFromDie(pick);
      const extras =
        vals.length > 1 ? vals.slice(0, -1).map((v) => ICON[moveFromDie(v)]).join("") + "→" : "";
      return {
        value: MOVES.indexOf(m),
        display: `${extras}${ICON[m]} ${m}`,
      };
    },
    decide(host: ThrowScore, guest: ThrowScore) {
      const hm = MOVES[host.value] ?? "rock";
      const gm = MOVES[guest.value] ?? "rock";
      return beats(hm, gm);
    },
  };
}

export const rpsGame: ChatGameDefinition = {
  id: "rps",
  command: "rps",
  title: "Rock Paper Scissors",
  emoji: "✊",
  guideTitle: "Play RPS Games",
  description: "Animated 🎲 mapped to Rock / Paper / Scissors",
  modeHint(mode) {
    if (mode === "normal") return "One 🎲 → Rock / Paper / Scissors.";
    if (mode === "double") return "Two 🎲 — last throw is your move.";
    if (mode === "crazy") return "Crazy RPS with two dice energy!";
    return "Double crazy — last die is your move.";
  },
  throwPlan: plan,
  playRound(mode): RoundResult {
    return playFromPlan(plan(mode));
  },
};
