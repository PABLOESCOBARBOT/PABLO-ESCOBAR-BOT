import type { InlineKeyboardMarkup } from "telegraf/types";
import { CB, type ChatGameMode } from "./types";

export function modeKeyboard(matchId: string): InlineKeyboardMarkup {
  const modes: ChatGameMode[] = ["normal", "double", "crazy", "crazy_double"];
  const labels: Record<ChatGameMode, string> = {
    normal: "🎲 Normal Mode",
    double: "🎲🎲 Double Roll",
    crazy: "🤪 Crazy Mode",
    crazy_double: "🤯 Crazy Double",
  };
  return {
    inline_keyboard: [
      ...modes.map((m) => [{ text: labels[m], callback_data: `${CB}|mode|${matchId}|${m}` }]),
      [{ text: "❌ Cancel", callback_data: `${CB}|cancel|${matchId}` }],
    ],
  };
}

export function raceKeyboard(matchId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🥇 First 1 point to win", callback_data: `${CB}|race|${matchId}|1` }],
      [{ text: "🥈 First 2 points to win", callback_data: `${CB}|race|${matchId}|2` }],
      [{ text: "🥉 First 3 points to win", callback_data: `${CB}|race|${matchId}|3` }],
      [{ text: "⬅️ Back", callback_data: `${CB}|backmode|${matchId}` }],
      [{ text: "❌ Cancel", callback_data: `${CB}|cancel|${matchId}` }],
    ],
  };
}

export function confirmKeyboard(matchId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Confirm", callback_data: `${CB}|confirm|${matchId}` }],
      [{ text: "⬅️ Back", callback_data: `${CB}|backrace|${matchId}` }],
      [{ text: "❌ Cancel", callback_data: `${CB}|cancel|${matchId}` }],
    ],
  };
}

export function opponentKeyboard(matchId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🤖 Play vs Bot", callback_data: `${CB}|vs|${matchId}|bot` }],
      [{ text: "👥 Play vs Player", callback_data: `${CB}|vs|${matchId}|pvp` }],
      [{ text: "❌ Cancel", callback_data: `${CB}|cancel|${matchId}` }],
    ],
  };
}

export function waitingKeyboard(matchId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Join Match", callback_data: `${CB}|join|${matchId}` }],
      [{ text: "❌ Cancel", callback_data: `${CB}|cancel|${matchId}` }],
    ],
  };
}

export function playAgainKeyboard(gameCmd: string, bet: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `🔄 Play again (bet ${bet})`, callback_data: `${CB}|again|${gameCmd}|${bet}` }],
      [{ text: "🏠 Done", callback_data: `${CB}|done` }],
    ],
  };
}
