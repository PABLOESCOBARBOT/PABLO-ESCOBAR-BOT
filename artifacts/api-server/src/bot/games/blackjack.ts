export type Card = { suit: string; value: string; points: number };
export type BJAction = "hit" | "stand" | "double";

export interface BJState {
  playerHand: Card[];
  dealerHand: Card[];
  deck: Card[];
  done: boolean;
  result?: "win" | "loss" | "push" | "blackjack" | "bust";
  multiplier?: number;
}

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function cardPoints(v: string): number {
  if (v === "A") return 11;
  if (["J","Q","K"].includes(v)) return 10;
  return parseInt(v, 10);
}

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value, points: cardPoints(value) });
    }
  }
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

function handTotal(hand: Card[]): number {
  let total = hand.reduce((sum, c) => sum + c.points, 0);
  let aces = hand.filter(c => c.value === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function cardStr(c: Card): string {
  return `${c.value}${c.suit}`;
}

export function handStr(hand: Card[]): string {
  return hand.map(cardStr).join(" ");
}

export function startBlackjack(): BJState {
  const deck = makeDeck();
  const playerHand = [deck.pop()!, deck.pop()!];
  const dealerHand = [deck.pop()!, deck.pop()!];

  const playerTotal = handTotal(playerHand);
  const dealerTotal = handTotal(dealerHand);
  const playerBJ = playerTotal === 21;
  const dealerBJ = dealerTotal === 21;

  // Natural blackjack is settled immediately
  if (playerBJ || dealerBJ) {
    if (playerBJ && dealerBJ) {
      return { playerHand, dealerHand, deck, done: true, result: "push", multiplier: 0 };
    }
    if (playerBJ) {
      return { playerHand, dealerHand, deck, done: true, result: "blackjack", multiplier: 1.5 };
    }
    return { playerHand, dealerHand, deck, done: true, result: "loss", multiplier: 0 };
  }

  return { playerHand, dealerHand, deck, done: false };
}

export function bjAction(state: BJState, action: BJAction): BJState {
  const deck = [...state.deck];
  let playerHand = [...state.playerHand];
  const dealerHand = [...state.dealerHand];

  if (action === "hit" || action === "double") {
    playerHand.push(deck.pop()!);
    const total = handTotal(playerHand);
    if (total > 21) {
      return { ...state, playerHand, deck, done: true, result: "bust", multiplier: 0 };
    }
    if (action === "hit") {
      return { ...state, playerHand, deck, done: false };
    }
  }

  // stand or double — dealer plays
  let dealerTotal = handTotal(dealerHand);
  while (dealerTotal < 17) {
    dealerHand.push(deck.pop()!);
    dealerTotal = handTotal(dealerHand);
  }
  const playerTotal = handTotal(playerHand);

  let result: BJState["result"];
  let multiplier: number;
  if (dealerTotal > 21 || playerTotal > dealerTotal) {
    result = "win"; multiplier = action === "double" ? 2 : 1;
  } else if (playerTotal === dealerTotal) {
    result = "push"; multiplier = 0;
  } else {
    result = "loss"; multiplier = 0;
  }

  return { playerHand, dealerHand, deck, done: true, result, multiplier };
}

export function formatBJState(state: BJState, hideDealer = true): string {
  const playerTotal = handTotal(state.playerHand);
  const dealerVisible = hideDealer ? state.dealerHand[0]! : null;

  let msg = `🃏 *Blackjack*\n\n`;
  if (hideDealer && dealerVisible) {
    msg += `Dealer: ${cardStr(dealerVisible)} 🂠\n`;
  } else {
    const dt = handTotal(state.dealerHand);
    msg += `Dealer: ${handStr(state.dealerHand)} (${dt})\n`;
  }
  msg += `You: ${handStr(state.playerHand)} (${playerTotal})\n\n`;

  if (state.done) {
    const emoji = state.result === "win" || state.result === "blackjack"
      ? "✅" : state.result === "push" ? "🤝" : "❌";
    const label = state.result === "bust" ? "Bust! You lose" :
      state.result === "blackjack" ? "Blackjack! You win!" :
      state.result === "win" ? "You win!" :
      state.result === "push" ? "Draw!" : "You lose!";
    msg += `${emoji} ${label}`;
  } else {
    msg += `What would you like to do?`;
  }
  return msg;
}
