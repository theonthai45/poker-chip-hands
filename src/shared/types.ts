import type { Chips } from './chips';

export type Mode = 'strict' | 'free';

export interface Denom {
  /** Value in cents. */
  value: number;
  color: string;
}

export interface Settings {
  mode: Mode;
  denoms: Denom[];
  defaultBuyIn: number;
  smallBlind: number;
  bigBlind: number;
}

export interface Player {
  id: string;
  name: string;
  chips: Chips;
  /** Total bought in so far, in cents. */
  buyIn: number;
  /** Lobby only: buy-in the host set for this player (null = default). */
  planned: number | null;
  /** waiting = joined mid-game, not yet given chips. out = cashed out. */
  status: 'active' | 'waiting' | 'out';
  rebuyRequest: number | null;
}

export interface Pot {
  amount: number;
  /** Who may claim the pot. */
  eligible: string[];
  /** Who must confirm a claim (everyone in `voters` who is not claiming). */
  voters: string[];
  claimants: string[];
  confirms: string[];
  awarded: string[] | null;
}

export type Street = 'open' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Hand {
  number: number;
  street: Street;
  dealer: string | null;
  /** Who posted the small and big blind this hand (turn-order mode). */
  sb?: string | null;
  bb?: string | null;
  inHand: string[];
  folded: string[];
  allIn: string[];
  contrib: Record<string, number>;
  streetBet: Record<string, number>;
  currentBet: number;
  minRaise: number;
  toAct: string | null;
  acted: string[];
  potChips: Chips;
  pots: Pot[];
  /** Free mode: each player's throws this hand, so the last one can be undone. */
  throws: Record<string, Chips[]>;
}

export interface GameState {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'ended';
  settings: Settings;
  players: Player[];
  hand: Hand | null;
  dealerId: string | null;
  handCount: number;
  log: string[];
  /** Total log lines ever written, so clients can tell which lines are new. */
  logSeq?: number;
}

export type Action =
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'setPlanned'; playerId: string; amount: number | null }
  | { type: 'kick'; playerId: string }
  | { type: 'startGame' }
  | { type: 'addChips'; playerId: string; amount: number }
  | { type: 'requestRebuy'; amount: number }
  | { type: 'cashOut'; playerId: string }
  | { type: 'endGame' }
  | { type: 'deal' }
  | { type: 'bet'; chips: Chips }
  | { type: 'call' }
  | { type: 'allIn' }
  | { type: 'fold' }
  | { type: 'forceFold' }
  | { type: 'undo' }
  | { type: 'claim'; pot: number }
  | { type: 'confirm'; pot: number }
  | { type: 'dispute'; pot: number };

export type ClientMsg =
  | { t: 'hello'; token: string; name: string; create: boolean }
  | { t: 'action'; action: Action };

export type ServerMsg =
  | { t: 'welcome'; you: string }
  | { t: 'state'; state: GameState; online: string[] }
  | { t: 'error'; message: string; fatal?: boolean };
