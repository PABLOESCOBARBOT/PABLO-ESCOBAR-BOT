import { InlineKeyboardMarkup } from "telegraf/types";

// ─── Group / Deep-link helpers ────────────────────────────────────────────────

export function openCasinoButton(botUsername: string, payload = "menu"): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🎰 Open Casino", url: `https://t.me/${botUsername}?start=${payload}` }],
    ],
  };
}

export function groupGamesMenu(botUsername: string): InlineKeyboardMarkup {
  const btn = (label: string, game: string) => ({
    text: label,
    url: `https://t.me/${botUsername}?start=${game}`,
  });
  return {
    inline_keyboard: [
      [btn("🎰 Slots", "game_slots"),       btn("🎲 Dice",      "game_dice")],
      [btn("🪙 Coin Flip", "game_coinflip"), btn("🃏 Blackjack", "game_blackjack")],
      [btn("🎡 Roulette", "game_roulette"),  btn("📈 Crash",     "game_crash")],
      [btn("🏓 Plinko", "game_plinko"),      { text: "⚔️ PvP (here)", callback_data: "game_pvp" }],
      [btn("💰 Balance", "balance"),          btn("📥 Deposit",  "deposit")],
    ],
  };
}

export function mainMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🎮 Play Games", callback_data: "menu_games" },
        { text: "💰 Balance", callback_data: "balance" },
      ],
      [
        { text: "📥 Deposit", callback_data: "menu_deposit" },
        { text: "📤 Withdraw", callback_data: "menu_withdraw" },
      ],
      [
        { text: "📊 My Stats", callback_data: "my_stats" },
        { text: "ℹ️ Help", callback_data: "help" },
      ],
    ],
  };
}

export function gamesMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🎰 Slots", callback_data: "game_slots" },
        { text: "🎲 Dice", callback_data: "game_dice" },
      ],
      [
        { text: "🪙 Coin Flip", callback_data: "game_coinflip" },
        { text: "🃏 Blackjack", callback_data: "game_blackjack" },
      ],
      [
        { text: "🎡 Roulette", callback_data: "game_roulette" },
        { text: "📈 Crash", callback_data: "game_crash" },
      ],
      [
        { text: "🏓 Plinko", callback_data: "game_plinko" },
        { text: "⚔️ PvP Challenge", callback_data: "game_pvp" },
      ],
      [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
    ],
  };
}

export function betMenu(prefix: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "10 💰", callback_data: `${prefix}_bet_10` },
        { text: "50 💰", callback_data: `${prefix}_bet_50` },
        { text: "100 💰", callback_data: `${prefix}_bet_100` },
      ],
      [
        { text: "500 💰", callback_data: `${prefix}_bet_500` },
        { text: "1000 💰", callback_data: `${prefix}_bet_1000` },
        { text: "All In 🎲", callback_data: `${prefix}_bet_allin` },
      ],
      [{ text: "🔙 Back", callback_data: "menu_games" }],
    ],
  };
}

export function diceChoiceMenu(bet: number): InlineKeyboardMarkup {
  // Two dice → sum is 2–12. Exact "1" was impossible before.
  return {
    inline_keyboard: [
      [
        { text: "Low (2-6)", callback_data: `dice_choice_low_${bet}` },
        { text: "High (8-12)", callback_data: `dice_choice_high_${bet}` },
      ],
      [{ text: "Exact 7 (5x)", callback_data: `dice_choice_7_${bet}` }],
      [
        { text: "2", callback_data: `dice_choice_2_${bet}` },
        { text: "3", callback_data: `dice_choice_3_${bet}` },
        { text: "4", callback_data: `dice_choice_4_${bet}` },
        { text: "5", callback_data: `dice_choice_5_${bet}` },
        { text: "6", callback_data: `dice_choice_6_${bet}` },
      ],
      [
        { text: "8", callback_data: `dice_choice_8_${bet}` },
        { text: "9", callback_data: `dice_choice_9_${bet}` },
        { text: "10", callback_data: `dice_choice_10_${bet}` },
        { text: "11", callback_data: `dice_choice_11_${bet}` },
        { text: "12", callback_data: `dice_choice_12_${bet}` },
      ],
      [{ text: "🔙 Back", callback_data: "game_dice" }],
    ],
  };
}

export function coinChoiceMenu(bet: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🟡 Heads", callback_data: `coin_choice_heads_${bet}` },
        { text: "⚫ Tails", callback_data: `coin_choice_tails_${bet}` },
      ],
      [{ text: "🔙 Back", callback_data: "game_coinflip" }],
    ],
  };
}

export function rouletteChoiceMenu(bet: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🔴 Red (1.95x)", callback_data: `rou_color_red_${bet}` },
        { text: "⚫ Black (1.95x)", callback_data: `rou_color_black_${bet}` },
      ],
      [
        { text: "Odd (1.95x)", callback_data: `rou_parity_odd_${bet}` },
        { text: "Even (1.95x)", callback_data: `rou_parity_even_${bet}` },
      ],
      [
        { text: "Low 1-18 (1.95x)", callback_data: `rou_half_low_${bet}` },
        { text: "High 19-36 (1.95x)", callback_data: `rou_half_high_${bet}` },
      ],
      [
        { text: "0 (35x)", callback_data: `rou_num_0_${bet}` },
        { text: "Lucky # (35x)", callback_data: `rou_num_pick_${bet}` },
      ],
      [{ text: "🔙 Back", callback_data: "game_roulette" }],
    ],
  };
}

export function bjActionMenu(canDouble: boolean): InlineKeyboardMarkup {
  const row1 = [
    { text: "🃏 Hit", callback_data: "bj_hit" },
    { text: "🛑 Stand", callback_data: "bj_stand" },
  ];
  if (canDouble) {
    row1.push({ text: "✖️ Double", callback_data: "bj_double" });
  }
  return { inline_keyboard: [row1] };
}

/** Cash-out button — never embed the secret crashPoint in callback_data. */
export function crashMenu(bet: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "💸 Cash Out!", callback_data: `crash_cashout_${bet}` }],
    ],
  };
}

export function playAgainMenu(game: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🔄 Play Again", callback_data: `game_${game}` },
        { text: "🎮 Games", callback_data: "menu_games" },
      ],
      [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
    ],
  };
}

export function depositMenu(
  addresses: { crypto: string; label: string }[],
  opts?: { showManualConfirm?: boolean },
): InlineKeyboardMarkup {
  const rows = addresses.map(a => [
    { text: a.label, callback_data: `deposit_crypto_${a.crypto}` },
  ]);
  if (opts?.showManualConfirm) {
    rows.push([{ text: "📋 Confirm Manual Deposit", callback_data: "deposit_confirm" }]);
  }
  rows.push([{ text: "🔙 Back", callback_data: "main_menu" }]);
  return { inline_keyboard: rows };
}

/** Amount picker for NOWPayments (min $5) */
export function depositAmountMenu(crypto: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "$5", callback_data: `deposit_amt_${crypto}_5` },
        { text: "$10", callback_data: `deposit_amt_${crypto}_10` },
        { text: "$20", callback_data: `deposit_amt_${crypto}_20` },
      ],
      [
        { text: "$50", callback_data: `deposit_amt_${crypto}_50` },
        { text: "$100", callback_data: `deposit_amt_${crypto}_100` },
      ],
      [{ text: "🔙 Back", callback_data: "menu_deposit" }],
    ],
  };
}

export function withdrawMenu(addresses: { crypto: string; label: string }[]): InlineKeyboardMarkup {
  const rows = addresses.map(a => [
    { text: a.label, callback_data: `withdraw_crypto_${a.crypto}` },
  ]);
  rows.push([{ text: "📜 My Withdrawals", callback_data: "withdraw_history" }]);
  rows.push([{ text: "🔙 Back", callback_data: "main_menu" }]);
  return { inline_keyboard: rows };
}

/** Withdraw amount picker — amounts are chips (= USD) */
export function withdrawAmountMenu(crypto: string, balance: number): InlineKeyboardMarkup {
  const opts = [5, 10, 20, 50, 100, 500].filter((n) => n <= balance);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < opts.length; i += 3) {
    rows.push(
      opts.slice(i, i + 3).map((n) => ({
        text: `$${n}`,
        callback_data: `withdraw_amt_${crypto}_${n}`,
      })),
    );
  }
  if (balance >= 5) {
    rows.push([
      { text: `All In ($${Math.floor(balance)})`, callback_data: `withdraw_amt_${crypto}_all` },
      { text: "✏️ Custom", callback_data: `withdraw_custom_${crypto}` },
    ]);
  }
  rows.push([{ text: "🔙 Back", callback_data: "menu_withdraw" }]);
  return { inline_keyboard: rows };
}

export function withdrawConfirmMenu(crypto: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Confirm Withdraw", callback_data: `withdraw_confirm_${crypto}` },
        { text: "❌ Cancel", callback_data: "menu_withdraw" },
      ],
    ],
  };
}

export function pvpMenu(betOptions: number[]): InlineKeyboardMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < betOptions.length; i += 2) {
    const row = betOptions.slice(i, i + 2).map(b => ({
      text: `${b} 💰`,
      callback_data: `pvp_bet_${b}`,
    }));
    rows.push(row);
  }
  rows.push([{ text: "🔙 Back", callback_data: "menu_games" }]);
  return { inline_keyboard: rows };
}

export function pvpAcceptMenu(challengeId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "⚔️ Accept Challenge!", callback_data: `pvp_accept_${challengeId}` }],
      [{ text: "❌ Ignore", callback_data: `pvp_ignore_${challengeId}` }],
    ],
  };
}

// ─── ADMIN BOT KEYBOARDS ──────────────────────────────────────────────────────

/** Main admin panel */
export function adminMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "💰 Deposit", callback_data: "admin_deposit" },
        { text: "📤 Withdrawal", callback_data: "admin_withdrawal" },
      ],
      [
        { text: "👥 Users", callback_data: "admin_users" },
        { text: "🎁 Bonuses", callback_data: "admin_bonuses" },
      ],
      [
        { text: "🎮 Games / Stats", callback_data: "admin_games" },
      ],
    ],
  };
}

/** Dedicated users section */
export function adminUsersMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "📋 Recent Users", callback_data: "admin_users_list" },
        { text: "🔍 Find User", callback_data: "admin_find_user" },
      ],
      [
        { text: "➕ Credit Chips", callback_data: "admin_add_chips" },
        { text: "➖ Debit Chips", callback_data: "admin_remove_chips" },
      ],
      [
        { text: "🚫 Ban User", callback_data: "admin_ban_user" },
      ],
      [{ text: "🔙 Back", callback_data: "admin_back" }],
    ],
  };
}

/** Admin deposit sub-menu */
export function adminDepositMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "⏳ Pending Deposits", callback_data: "admin_pending_deposits" },
        { text: "💱 Crypto Addresses", callback_data: "admin_addresses" },
      ],
      [
        { text: "➕ Add Chips (User)", callback_data: "admin_add_chips" },
        { text: "🏦 Payment Settings", callback_data: "admin_payment_settings" },
      ],
      [{ text: "🔙 Back", callback_data: "admin_back" }],
    ],
  };
}

/** Admin withdrawal sub-menu */
export function adminWithdrawalMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "⏳ Pending Withdrawals", callback_data: "admin_pending_withdrawals" },
        { text: "✅ Approved Today", callback_data: "admin_approved_withdrawals" },
      ],
      [
        { text: "➖ Deduct Chips (User)", callback_data: "admin_remove_chips" },
      ],
      [{ text: "🔙 Back", callback_data: "admin_back" }],
    ],
  };
}

/** Admin bonuses sub-menu */
export function adminBonusesMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🎁 Give Bonus (User)", callback_data: "admin_add_chips" },
        { text: "📋 Bonus History", callback_data: "admin_bonus_history" },
      ],
      [{ text: "🔙 Back", callback_data: "admin_back" }],
    ],
  };
}

/** Admin games sub-menu */
export function adminGamesMenu(casinoBotUsername?: string): InlineKeyboardMarkup {
  const rows: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [];

  if (casinoBotUsername) {
    rows.push([{ text: "🎰 Open Casino Bot", url: `https://t.me/${casinoBotUsername}` }]);
  }
  rows.push([
    { text: "📊 Casino Stats", callback_data: "admin_stats" },
    { text: "👥 View Users", callback_data: "admin_users_list" },
  ]);
  rows.push([
    { text: "🔍 Find User", callback_data: "admin_find_user" },
    { text: "🚫 Ban User", callback_data: "admin_ban_user" },
  ]);
  rows.push([{ text: "🔙 Back", callback_data: "admin_back" }]);

  return { inline_keyboard: rows as InlineKeyboardMarkup["inline_keyboard"] };
}

/** Payment gateway settings menu */
export function adminPaymentSettingsMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📋 Static Addresses (Manual)", callback_data: "admin_addresses" }],
      [{ text: "🤖 NOWPayments Gateway Info", callback_data: "admin_nowpayments_info" }],
      [{ text: "🔙 Back", callback_data: "admin_deposit" }],
    ],
  };
}
