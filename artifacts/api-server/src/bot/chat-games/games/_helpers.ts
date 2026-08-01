import type { ChatGameMode, RoundResult, ThrowPlan, TgThrowEmoji } from "../types";
import { d } from "../random";

export function throwsFor(mode: ChatGameMode): number {
  return mode === "double" || mode === "crazy_double" ? 2 : 1;
}

export function crazyMult(mode: ChatGameMode): number {
  if (mode === "crazy") return d(2);
  if (mode === "crazy_double") return d(3);
  return 1;
}

/** Standard higher-sum duel over Telegram animated emoji. */
export function sumPlan(
  emoji: TgThrowEmoji,
  mode: ChatGameMode,
  label = emoji,
): ThrowPlan {
  const throws = throwsFor(mode);
  const mult = crazyMult(mode);
  return {
    emoji,
    throws,
    combine: (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      const value = sum * mult;
      const body =
        vals.length > 1 ? `${vals.join("+")}=${sum}` : `${sum}`;
      const show =
        mult > 1 ? `${label} ${body}×${mult}=${value}` : `${label} ${body}`;
      return { value, display: show };
    },
  };
}

export function rngSides(emoji: TgThrowEmoji): number {
  if (emoji === "🏀" || emoji === "⚽") return 5;
  if (emoji === "🎰") return 64;
  return 6; // 🎲 🎯 🎳
}

export function playFromPlan(plan: ThrowPlan): RoundResult {
  const sides = rngSides(plan.emoji);
  const hostVals = Array.from({ length: plan.throws }, () => d(sides));
  const guestVals = Array.from({ length: plan.throws }, () => d(sides));
  const host = plan.combine(hostVals);
  const guest = plan.combine(guestVals);
  const winner = plan.decide
    ? plan.decide(host, guest)
    : host.value > guest.value
      ? "host"
      : host.value < guest.value
        ? "guest"
        : "draw";
  return {
    hostValue: host.value,
    guestValue: guest.value,
    hostDisplay: host.display,
    guestDisplay: guest.display,
    winner,
    narration: [`${plan.emoji} …`],
  };
}
