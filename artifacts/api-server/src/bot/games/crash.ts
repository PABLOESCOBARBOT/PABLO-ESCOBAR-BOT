export interface CrashResult {
  crashPoint: number;
  cashedOutAt: number | null;
  won: boolean;
  multiplier: number;
  display: string;
}

/**
 * Generate a crash point using provably-fair-style logic.
 * House edge ~3%: crash at 1x happens ~3% of the time.
 */
export function generateCrashPoint(): number {
  const r = Math.random();
  if (r < 0.03) return 1.0; // instant crash
  // exponential distribution
  const raw = 0.97 / (1 - r);
  return Math.min(parseFloat(raw.toFixed(2)), 1000);
}

export function resolveCrash(crashPoint: number, cashedOutAt: number | null): CrashResult {
  let won = false;
  let multiplier = 0;

  if (cashedOutAt !== null && cashedOutAt <= crashPoint) {
    won = true;
    multiplier = cashedOutAt;
  }

  const display = won
    ? `📈 Crash Game\n\nCrash: ${crashPoint}x\nYou cashed out at: ${cashedOutAt}x\n\n✅ Win! (${multiplier}x)`
    : `📈 Crash Game\n\nCrash: ${crashPoint}x\nYou cashed out at: ${cashedOutAt ?? "—"}x\n\n❌ Loss! Game crashed at ${crashPoint}x`;

  return { crashPoint, cashedOutAt, won, multiplier, display };
}

export function buildCrashBar(current: number): string {
  const bars = Math.min(Math.floor((current - 1) * 5), 20);
  return "▰".repeat(bars) + "▱".repeat(20 - bars);
}
