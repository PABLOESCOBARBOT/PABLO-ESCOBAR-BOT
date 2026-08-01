export type RouletteBet =
  | { type: "number"; value: number }
  | { type: "color"; value: "red" | "black" | "green" }
  | { type: "parity"; value: "odd" | "even" }
  | { type: "half"; value: "low" | "high" };

export interface RouletteResult {
  number: number;
  color: "red" | "black" | "green";
  won: boolean;
  multiplier: number;
  display: string;
}

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function getColor(n: number): "red" | "black" | "green" {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

const COLOR_EMOJI: Record<string, string> = { red: "🔴", black: "⚫", green: "💚" };

export function playRoulette(bet: RouletteBet): RouletteResult {
  const number = Math.floor(Math.random() * 37); // 0-36
  const color = getColor(number);

  let won = false;
  let multiplier = 0;

  switch (bet.type) {
    case "number":
      won = number === bet.value;
      multiplier = 35;
      break;
    case "color":
      won = color === bet.value;
      multiplier = bet.value === "green" ? 35 : 1.95;
      break;
    case "parity":
      if (number === 0) { won = false; }
      else { won = bet.value === "odd" ? number % 2 !== 0 : number % 2 === 0; }
      multiplier = 1.95;
      break;
    case "half":
      if (number === 0) { won = false; }
      else { won = bet.value === "low" ? number <= 18 : number >= 19; }
      multiplier = 1.95;
      break;
  }

  const betLabel =
    bet.type === "number" ? `Number ${bet.value}` :
    bet.type === "color" ? `${COLOR_EMOJI[bet.value]} ${bet.value}` :
    bet.type === "parity" ? bet.value :
    bet.value === "low" ? "Low (1-18)" : "High (19-36)";

  const display =
    `🎡 Roulette\n\n` +
    `${COLOR_EMOJI[color]} Ball landed on **${number}** (${color})\n\n` +
    `Your bet: ${betLabel}\n` +
    `${won ? `✅ Win! (${multiplier}x)` : "❌ Loss!"}`;

  return { number, color, won, multiplier, display };
}
