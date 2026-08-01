export type DiceBetType =
  | "low"
  | "high"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "11"
  | "12";

export interface DiceResult {
  dice1: number;
  dice2: number;
  sum: number;
  betType: DiceBetType;
  won: boolean;
  multiplier: number;
  display: string;
}

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export function playDice(betType: DiceBetType): DiceResult {
  const dice1 = Math.ceil(Math.random() * 6);
  const dice2 = Math.ceil(Math.random() * 6);
  const sum = dice1 + dice2;
  const face1 = DICE_FACES[dice1 - 1]!;
  const face2 = DICE_FACES[dice2 - 1]!;

  let won = false;
  let multiplier = 0;

  if (betType === "low") {
    // low = sum 2-6
    won = sum <= 6;
    multiplier = 1.9;
  } else if (betType === "high") {
    // high = sum 8-12
    won = sum >= 8;
    multiplier = 1.9;
  } else {
    // exact = sum equals chosen number (2–12)
    const target = parseInt(betType, 10);
    won = sum === target;
    multiplier = 5;
  }

  const betLabel =
    betType === "low"
      ? "Low (2-6)"
      : betType === "high"
        ? "High (8-12)"
        : `Exact ${betType}`;

  const resultEmoji = won ? "✅ Win!" : "❌ Loss!";
  const display =
    `🎲 Dice Roll\n\n` +
    `${face1} + ${face2} = **${sum}**\n\n` +
    `Bet: ${betLabel}\n` +
    `${resultEmoji}${won ? ` (${multiplier}x)` : ""}`;

  return { dice1, dice2, sum, betType, won, multiplier, display };
}
