import { randomInt } from "node:crypto";

export function d(sides: number): number {
  return randomInt(1, sides + 1);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length)]!;
}

export const DICE_FACE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
