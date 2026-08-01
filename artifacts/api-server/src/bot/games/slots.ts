export interface SlotsResult {
  reels: string[];
  multiplier: number;
  display: string;
}

const SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "🔔", "⭐", "💎", "7️⃣"];
const WEIGHTS =  [30,   25,   20,   15,   5,    3,    1,    1  ]; // out of 100

const PAYOUTS: Record<string, number> = {
  "🍒🍒🍒": 3,
  "🍋🍋🍋": 4,
  "🍊🍊🍊": 5,
  "🍇🍇🍇": 8,
  "🔔🔔🔔": 10,
  "⭐⭐⭐": 15,
  "💎💎💎": 25,
  "7️⃣7️⃣7️⃣": 50,
  "🍒🍒": 1.5,   // two cherries pays partial
};

function weightedRandom(): string {
  const total = WEIGHTS.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < SYMBOLS.length; i++) {
    rand -= WEIGHTS[i]!;
    if (rand <= 0) return SYMBOLS[i]!;
  }
  return SYMBOLS[0]!;
}

export function playSlots(): SlotsResult {
  const reels = [weightedRandom(), weightedRandom(), weightedRandom()];
  const key3 = reels.join("");
  const key2 = reels.slice(0, 2).join("");

  let multiplier = 0;
  if (PAYOUTS[key3]) {
    multiplier = PAYOUTS[key3]!;
  } else if (reels[0] === "🍒" && reels[1] === "🍒") {
    multiplier = PAYOUTS["🍒🍒"]!;
  }

  const spinLine = reels.join(" | ");
  let display: string;
  if (multiplier === 0) {
    display = `🎰 ${spinLine}\n\n😔 No match — try again!`;
  } else {
    display = `🎰 ${spinLine}\n\n🎉 ${multiplier}x — You won!`;
  }

  return { reels, multiplier, display };
}
