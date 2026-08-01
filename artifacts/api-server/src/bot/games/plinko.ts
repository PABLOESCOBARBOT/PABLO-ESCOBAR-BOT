export interface PlinkoResult {
  path: string[];
  slot: number;
  multiplier: number;
  display: string;
}

// 8-row Plinko — 9 possible slots
const MULTIPLIERS = [10, 3, 1.5, 0.5, 0.3, 0.5, 1.5, 3, 10];

export function playPlinko(): PlinkoResult {
  // Simulate ball dropping through 8 rows, going left (0) or right (1) each row
  let position = 0; // starts at center of 8 pegs
  const path: string[] = [];

  for (let row = 0; row < 8; row++) {
    const dir = Math.random() < 0.5 ? "↙" : "↘";
    path.push(dir);
    if (dir === "↘") position++;
  }

  const slot = position; // 0-8
  const multiplier = MULTIPLIERS[slot]!;

  const slotDisplay = MULTIPLIERS.map((m, i) =>
    i === slot ? `[${m}x]` : `${m}x`
  ).join(" ");

  const display =
    `🏓 *Plinko*\n\n` +
    `Ball path: ${path.join("")}\n\n` +
    `🎯 Slot ${slot + 1}: **${multiplier}x**\n\n` +
    `${slotDisplay}\n\n` +
    `${multiplier >= 1 ? "✅ Win!" : "❌ Loss!"}`;

  return { path, slot, multiplier, display };
}
