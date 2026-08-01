export type CoinSide = "heads" | "tails";

export interface CoinFlipResult {
  result: CoinSide;
  choice: CoinSide;
  won: boolean;
  multiplier: number;
  display: string;
}

export function playCoinFlip(choice: CoinSide): CoinFlipResult {
  const result: CoinSide = Math.random() < 0.5 ? "heads" : "tails";
  const won = result === choice;
  const multiplier = 1.95;

  const coinEmoji = result === "heads" ? "🟡" : "⚫";
  const resultLabel = result === "heads" ? "Heads" : "Tails";
  const choiceLabel = choice === "heads" ? "Heads" : "Tails";

  const display =
    `🪙 Coin Flip\n\n` +
    `${coinEmoji} Result: **${resultLabel}**\n` +
    `Your bet: ${choiceLabel}\n\n` +
    `${won ? `✅ Win! (${multiplier}x)` : "❌ Loss!"}`;

  return { result, choice, won, multiplier, display };
}
