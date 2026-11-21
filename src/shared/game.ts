import { addChips, chipValue, clean, greedy, hasChips, money, pay, splitBuyIn, subChips, type Chips } from './chips';
import type { Action, GameState, Hand, Player, Pot, Settings, Street } from './types';

export class GameError extends Error {}

const fail = (message: string): never => {
  throw new GameError(message);
};

export const CHIP_COLORS = ['#f2f2f2', '#d63a3a', '#2f6fd6', '#2e9e5b', '#222222', '#8e44ad', '#e08a1e', '#e75480'];

export const DEFAULT_SETTINGS: Settings = {
  mode: 'strict',
  denoms: [
    { value: 50, color: CHIP_COLORS[0] },
    { value: 100, color: CHIP_COLORS[1] },
  ],
  defaultBuyIn: 2000,
  smallBlind: 50,
  bigBlind: 100,
};

const newPlayer = (id: string, name: string, status: Player['status']): Player => ({
  id,
  name: name.trim().slice(0, 16) || 'Player',
  chips: {},
  buyIn: 0,
  planned: null,
  status,
  rebuyRequest: null,
});

export function createGame(code: string, hostId: string, hostName: string): GameState {
  return {
    code,
    hostId,
    phase: 'lobby',
    settings: structuredClone(DEFAULT_SETTINGS),
    players: [newPlayer(hostId, hostName, 'active')],
    hand: null,
    dealerId: null,
    handCount: 0,
    log: [],
  };
}

export function joinGame(state: GameState, id: string, name: string): GameState {
  const s = structuredClone(state);
  const existing = s.players.find((p) => p.id === id);
  if (existing) return s;
  if (s.phase === 'ended') fail('This game has ended');
  if (s.players.length >= 12) fail('Game is full');
  const p = newPlayer(id, name, s.phase === 'lobby' ? 'active' : 'waiting');
  s.players.push(p);
  log(s, `${p.name} joined`);
  return s;
}

/* ---------- helpers ---------- */

const denomsOf = (s: GameState) => s.settings.denoms.map((d) => d.value);
const unitOf = (s: GameState) => Math.min(...denomsOf(s));
const stackOf = (p: Player) => chipValue(p.chips);
const nameOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)?.name ?? '?';
const names = (s: GameState, ids: string[]) => ids.map((id) => nameOf(s, id)).join(' & ');

function log(s: GameState, text: string) {
  s.log.push(text);
  if (s.log.length > 40) s.log.shift();
}

function getPlayer(s: GameState, id: string): Player {
  return s.players.find((p) => p.id === id) ?? fail('Player not found');
}

export function validateSettings(st: Settings) {
  if (st.mode !== 'strict' && st.mode !== 'free') fail('Invalid mode');
  const vals = st.denoms.map((d) => d.value);
  if (vals.length < 1 || vals.length > 8) fail('Use 1 to 8 chip denominations');
  if (vals.some((v) => !Number.isInteger(v) || v <= 0)) fail('Chip values must be positive');
  if (new Set(vals).size !== vals.length) fail('Chip values must be different');
  const unit = Math.min(...vals);
  if (vals.some((v) => v % unit !== 0)) fail(`Every chip must be a multiple of the smallest (${money(unit)})`);
  for (const [label, v] of [
    ['Buy-in', st.defaultBuyIn],
    ['Small blind', st.smallBlind],
    ['Big blind', st.bigBlind],
  ] as const) {
    if (!Number.isInteger(v) || v <= 0 || v % unit !== 0) fail(`${label} must be a multiple of ${money(unit)}`);
  }
  if (st.bigBlind < st.smallBlind) fail('Big blind must be at least the small blind');
  if (st.defaultBuyIn > 100_000_00) fail('Buy-in too large');
}

function checkAmount(s: GameState, amount: number) {
  const unit = unitOf(s);
  if (!Number.isInteger(amount) || amount <= 0 || amount % unit !== 0 || amount > 100_000_00)
    fail(`Amount must be a multiple of ${money(unit)}`);
}

function giveBuyIn(s: GameState, p: Player, amount: number) {
  checkAmount(s, amount);
  p.chips = addChips(p.chips, splitBuyIn(amount, denomsOf(s)));
  p.buyIn += amount;
  p.status = 'active';
  p.rebuyRequest = null;
}

function validChips(s: GameState, chips: Chips): Chips {
  const ok = new Set(denomsOf(s).map(String));
  if (typeof chips !== 'object' || chips === null) fail('Invalid chips');
  for (const [d, n] of Object.entries(chips)) {
    if (!ok.has(d) || !Number.isInteger(n) || n < 0) fail('Invalid chips');
  }
  return clean(chips);
}

/** First id in `candidates` sitting after `afterId`, going round the table. */
function nextSeat(s: GameState, candidates: string[], afterId: string | null): string | null {
  if (candidates.length === 0) return null;
  const order = s.players.map((p) => p.id);
  const start = afterId ? order.indexOf(afterId) : -1;
  for (let i = 1; i <= order.length; i++) {
    const id = order[(start + i + order.length) % order.length];
    if (candidates.includes(id)) return id;
  }
  return candidates[0];
}

const potTotal = (h: Hand) => Object.values(h.contrib).reduce((a, b) => a + b, 0);
const liveIn = (h: Hand) => h.inHand.filter((id) => !h.folded.includes(id));

function emptyHand(s: GameState, street: Street): Hand {
  s.handCount += 1;
  return {
    number: s.handCount,
    street,
    dealer: null,
    inHand: [],
    folded: [],
    allIn: [],
    contrib: {},
    streetBet: {},
    currentBet: 0,
    minRaise: 0,
    toAct: null,
    acted: [],
    potChips: {},
    pots: [],
    throws: {},
  };
}

function put(s: GameState, h: Hand, p: Player, amount: number, chips?: Chips) {
  let paid: Chips;
  if (chips && chipValue(chips) === amount && hasChips(p.chips, chips)) {
    p.chips = subChips(p.chips, chips);
    paid = chips;
  } else {
    const r = pay(p.chips, amount, denomsOf(s));
    p.chips = r.stack;
    paid = r.paid;
  }
  h.potChips = addChips(h.potChips, paid);
  h.contrib[p.id] = (h.contrib[p.id] ?? 0) + amount;
  h.streetBet[p.id] = (h.streetBet[p.id] ?? 0) + amount;
  return paid;
}

/* ---------- pots & awards ---------- */

function computePots(h: Hand): Pot[] {
  const live = liveIn(h);
  const levels = [...new Set(live.map((id) => h.contrib[id] ?? 0))].filter((l) => l > 0).sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = Object.values(h.contrib).reduce((sum, c) => sum + Math.min(c, level) - Math.min(c, prev), 0);
    const eligible = live.filter((id) => (h.contrib[id] ?? 0) >= level);
    const last = pots[pots.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else pots.push({ amount, eligible, voters: eligible, claimants: [], confirms: [], awarded: null });
    prev = level;
  }
  const leftover = potTotal(h) - pots.reduce((a, p) => a + p.amount, 0);
  if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
  return pots;
}

function awardPot(s: GameState, h: Hand, pot: Pot, winnersIn: string[]) {
  const winners = s.players.map((p) => p.id).filter((id) => winnersIn.includes(id));
  const denoms = denomsOf(s);
  const unit = unitOf(s);
  pot.awarded = winners;
  if (winners.length === 1 && pot.amount === chipValue(h.potChips)) {
    const w = getPlayer(s, winners[0]);
    w.chips = addChips(w.chips, h.potChips);
    h.potChips = {};
  } else {
    const base = Math.floor(pot.amount / winners.length / unit) * unit;
    let extra = (pot.amount - base * winners.length) / unit;
    for (const id of winners) {
      const share = base + (extra-- > 0 ? unit : 0);
      const w = getPlayer(s, id);
      w.chips = addChips(w.chips, greedy(share, denoms));
    }
    h.potChips = greedy(chipValue(h.potChips) - pot.amount, denoms);
  }
  log(s, `${names(s, winners)} ${winners.length > 1 ? 'split' : 'wins'} ${money(pot.amount)}`);
}

function settle(s: GameState, h: Hand) {
  for (const pot of h.pots) {
    if (pot.awarded || pot.claimants.length === 0) continue;
    const needed = pot.voters.filter((id) => !pot.claimants.includes(id));
    if (needed.length === 0 || needed.every((id) => pot.confirms.includes(id))) {
      awardPot(s, h, pot, pot.claimants);
    }
  }
  if (h.pots.length > 0 && h.pots.every((p) => p.awarded)) {
    s.hand = s.settings.mode === 'free' ? emptyHand(s, 'open') : null;
  }
}

/* ---------- strict mode flow ---------- */

function deal(s: GameState) {
  const seated = s.players.filter((p) => p.status === 'active' && stackOf(p) > 0).map((p) => p.id);
  if (seated.length < 2) fail('Need at least 2 players with chips');
  const h = emptyHand(s, 'preflop');
  const dealer = nextSeat(s, seated, s.dealerId)!;
  s.dealerId = dealer;
  h.dealer = dealer;
  h.inHand = s.players.map((p) => p.id).filter((id) => seated.includes(id));
  const sb = seated.length === 2 ? dealer : nextSeat(s, seated, dealer)!;
  const bb = nextSeat(s, seated, sb)!;
  for (const [id, blind] of [
    [sb, s.settings.smallBlind],
    [bb, s.settings.bigBlind],
  ] as const) {
    const p = getPlayer(s, id);
    put(s, h, p, Math.min(blind, stackOf(p)));
    if (stackOf(p) === 0) h.allIn.push(id);
  }
  h.currentBet = s.settings.bigBlind;
  h.minRaise = s.settings.bigBlind;
  s.hand = h;
  log(s, `Hand ${h.number}: ${nameOf(s, dealer)} deals, blinds ${money(s.settings.smallBlind)}/${money(s.settings.bigBlind)}`);
  advance(s, h, bb);
}

function advance(s: GameState, h: Hand, lastId: string) {
  const live = liveIn(h);
  if (live.length === 1) {
    h.toAct = null;
    h.street = 'showdown';
    h.pots = [{ amount: potTotal(h), eligible: live, voters: live, claimants: [], confirms: [], awarded: null }];
    awardPot(s, h, h.pots[0], live);
    settle(s, h);
    return;
  }
  const canAct = live.filter((id) => !h.allIn.includes(id));
  const pending = canAct.filter((id) => !h.acted.includes(id) || (h.streetBet[id] ?? 0) < h.currentBet);
  // Nobody left to bet against: skip the remaining betting.
  const noContest = canAct.length === 1 && (h.streetBet[canAct[0]] ?? 0) >= h.currentBet;
  if (pending.length > 0 && !noContest) {
    h.toAct = nextSeat(s, pending, lastId);
    return;
  }
  const order: Street[] = ['preflop', 'flop', 'turn', 'river'];
  while (h.street !== 'river') {
    h.street = order[order.indexOf(h.street) + 1];
    h.streetBet = {};
    h.currentBet = 0;
    h.minRaise = s.settings.bigBlind;
    h.acted = [];
    if (canAct.length >= 2) {
      h.toAct = nextSeat(s, canAct, h.dealer);
      log(s, `— ${h.street[0].toUpperCase()}${h.street.slice(1)} —`);
      return;
    }
  }
  h.street = 'showdown';
  h.toAct = null;
  h.pots = computePots(h);
  log(s, '— Showdown —');
  for (const pot of h.pots) if (pot.eligible.length === 1) awardPot(s, h, pot, pot.eligible);
  settle(s, h);
}

function strictBet(s: GameState, h: Hand, p: Player, amount: number, chips?: Chips) {
  if (h.toAct !== p.id) fail('Not your turn');
  const stack = stackOf(p);
  const mine = h.streetBet[p.id] ?? 0;
  const toCall = h.currentBet - mine;
  if (amount > stack) fail('Not enough chips');
  const allIn = amount === stack;
  if (!allIn) {
    if (amount < toCall) fail(`${money(toCall)} to call`);
    if (amount > toCall && mine + amount - h.currentBet < h.minRaise)
      fail(`Minimum ${h.currentBet === 0 ? 'bet is' : 'raise is to'} ${money(h.currentBet + h.minRaise)}`);
  }
  if (amount > 0) put(s, h, p, amount, chips);
  const total = mine + amount;
  const verb =
    amount === 0 ? 'checks' : allIn ? `is all-in for ${money(amount)}` : total === h.currentBet ? `calls ${money(amount)}` : h.currentBet === 0 ? `bets ${money(amount)}` : `raises to ${money(total)}`;
  log(s, `${p.name} ${verb}`);
  if (total > h.currentBet) {
    const inc = total - h.currentBet;
    if (inc >= h.minRaise) h.minRaise = inc;
    h.currentBet = total;
    h.acted = [p.id];
  } else {
    h.acted.push(p.id);
  }
  if (allIn) h.allIn.push(p.id);
  advance(s, h, p.id);
}

/* ---------- free mode ---------- */

function syncFreePot(s: GameState, h: Hand) {
  const amount = potTotal(h);
  const seated = s.players.filter((p) => p.status === 'active').map((p) => p.id);
  const contributors = Object.keys(h.contrib).filter((id) => h.contrib[id] > 0);
  h.pots = amount === 0 ? [] : [{ amount, eligible: seated, voters: contributors, claimants: [], confirms: [], awarded: null }];
}

/* ---------- reducer ---------- */

const inLiveHand = (s: GameState, id: string) => {
  const h = s.hand;
  if (!h) return false;
  return h.street === 'open' ? (h.contrib[id] ?? 0) > 0 : h.inHand.includes(id) && !h.folded.includes(id);
};

const handBusy = (s: GameState) => !!s.hand && potTotal(s.hand) > 0;

export function reduce(state: GameState, actorId: string, action: Action): GameState {
  const s = structuredClone(state);
  const actor = getPlayer(s, actorId);
  const isHost = s.hostId === actorId;
  const hostOnly = () => isHost || fail('Only the host can do that');
  const playing = () => s.phase === 'playing' || fail('Game is not running');

  switch (action.type) {
    case 'updateSettings': {
      hostOnly();
      if (s.phase === 'ended') fail('Game has ended');
      const next = { ...s.settings, ...action.settings };
      if (s.phase === 'playing') {
        next.denoms = s.settings.denoms; // chips are locked once the game starts
        if (next.mode !== s.settings.mode) {
          if (handBusy(s)) fail('Finish the current hand first');
          s.hand = null;
          if (next.mode === 'free') {
            s.settings = next;
            s.hand = emptyHand(s, 'open');
          }
          log(s, `Mode: ${next.mode === 'free' ? 'free-form' : 'turn order'}`);
        }
      }
      validateSettings(next);
      s.settings = next;
      break;
    }
    case 'setPlanned': {
      hostOnly();
      if (s.phase !== 'lobby') fail('Game already started');
      if (action.amount !== null) checkAmount(s, action.amount);
      getPlayer(s, action.playerId).planned = action.amount;
      break;
    }
    case 'kick': {
      hostOnly();
      if (s.phase !== 'lobby') fail('Game already started');
      if (action.playerId === s.hostId) fail('Host cannot be removed');
      s.players = s.players.filter((p) => p.id !== action.playerId);
      break;
    }
    case 'startGame': {
      hostOnly();
      if (s.phase !== 'lobby') fail('Game already started');
      if (s.players.length < 2) fail('Need at least 2 players');
      validateSettings(s.settings);
      for (const p of s.players) giveBuyIn(s, p, p.planned ?? s.settings.defaultBuyIn);
      s.phase = 'playing';
      log(s, 'Game started');
      if (s.settings.mode === 'free') s.hand = emptyHand(s, 'open');
      else deal(s);
      break;
    }
    case 'addChips': {
      hostOnly();
      playing();
      const p = getPlayer(s, action.playerId);
      if (s.settings.mode === 'strict' && inLiveHand(s, p.id)) fail('Wait until the hand ends');
      giveBuyIn(s, p, action.amount);
      if (s.hand?.street === 'open') syncFreePot(s, s.hand);
      log(s, `${p.name} buys in for ${money(action.amount)}`);
      break;
    }
    case 'requestRebuy': {
      playing();
      if (action.amount !== 0) checkAmount(s, action.amount);
      actor.rebuyRequest = action.amount || null;
      break;
    }
    case 'cashOut': {
      hostOnly();
      playing();
      const p = getPlayer(s, action.playerId);
      if (inLiveHand(s, p.id)) fail('Wait until the hand ends');
      p.status = 'out';
      log(s, `${p.name} cashes out with ${money(stackOf(p))}`);
      break;
    }
    case 'endGame': {
      hostOnly();
      playing();
      if (handBusy(s)) fail('Finish the current hand first');
      s.phase = 'ended';
      s.hand = null;
      log(s, 'Game ended');
      break;
    }
    case 'deal': {
      playing();
      if (s.settings.mode !== 'strict') fail('Not needed in free-form mode');
      if (s.hand) fail('Hand in progress');
      if (actor.status !== 'active') fail('You are not seated');
      deal(s);
      break;
    }
    case 'bet': {
      playing();
      const h = s.hand ?? fail('No hand in progress');
      if (actor.status !== 'active') fail('You are not seated');
      const chips = validChips(s, action.chips);
      if (!hasChips(actor.chips, chips)) fail('Not enough chips');
      const amount = chipValue(chips);
      if (h.street === 'open') {
        if (amount === 0) fail('Throw at least one chip');
        put(s, h, actor, amount, chips);
        (h.throws[actor.id] ??= []).push(chips);
        syncFreePot(s, h);
        log(s, `${actor.name} puts in ${money(amount)}`);
      } else {
        strictBet(s, h, actor, amount, chips);
      }
      break;
    }
    case 'call':
    case 'allIn': {
      playing();
      const h = s.hand ?? fail('No hand in progress');
      if (h.street === 'open') fail('Not available in free-form mode');
      const toCall = h.currentBet - (h.streetBet[actor.id] ?? 0);
      const stack = stackOf(actor);
      strictBet(s, h, actor, action.type === 'allIn' ? stack : Math.min(toCall, stack));
      break;
    }
    case 'fold':
    case 'forceFold': {
      playing();
      const h = s.hand ?? fail('No hand in progress');
      if (h.street === 'open' || !h.toAct) fail('Nobody to fold');
      if (action.type === 'forceFold') hostOnly();
      else if (h.toAct !== actorId) fail('Not your turn');
      const id = h.toAct!;
      h.folded.push(id);
      log(s, `${nameOf(s, id)} folds`);
      advance(s, h, id);
      break;
    }
    case 'undo': {
      playing();
      const h = s.hand;
      if (!h || h.street !== 'open') fail('Nothing to undo');
      const last = h!.throws[actorId]?.pop() ?? fail('Nothing to undo');
      const amount = chipValue(last);
      actor.chips = addChips(actor.chips, last);
      h!.potChips = subChips(h!.potChips, last);
      h!.contrib[actorId] -= amount;
      syncFreePot(s, h!);
      log(s, `${actor.name} takes back ${money(amount)}`);
      break;
    }
    case 'claim':
    case 'confirm':
    case 'dispute': {
      playing();
      const h = s.hand ?? fail('No pot to claim');
      const pot = h.pots[action.pot] ?? fail('No pot to claim');
      if (pot.awarded) fail('Pot already awarded');
      if (h.street !== 'open' && h.street !== 'showdown') fail('Hand is still being played');
      const eligible = pot.eligible.includes(actorId);
      if (action.type === 'claim') {
        if (!eligible) fail('You are not in this pot');
        const claiming = !pot.claimants.includes(actorId);
        pot.claimants = claiming ? [...pot.claimants, actorId] : pot.claimants.filter((id) => id !== actorId);
        pot.confirms = [];
        log(s, `${actor.name} ${claiming ? 'claims the pot' : 'withdraws the claim'}`);
      } else if (action.type === 'confirm') {
        if (pot.claimants.length === 0) fail('Nobody has claimed this pot');
        if (pot.claimants.includes(actorId)) fail('Someone else must confirm your claim');
        if (isHost) pot.confirms = [...pot.voters];
        else if (!pot.voters.includes(actorId)) fail('Only players with chips in the pot can confirm');
        else if (!pot.confirms.includes(actorId)) pot.confirms.push(actorId);
      } else {
        if (!pot.voters.includes(actorId) && !eligible && !isHost) fail('Only players in the pot can dispute');
        pot.claimants = [];
        pot.confirms = [];
        log(s, `${actor.name} disputes the claim`);
      }
      settle(s, h);
      break;
    }
    default:
      fail('Unknown action');
  }
  return s;
}

/* ---------- ledger ---------- */

export interface LedgerRow {
  id: string;
  name: string;
  buyIn: number;
  stack: number;
  net: number;
}

export function ledger(s: GameState): LedgerRow[] {
  return s.players
    .filter((p) => p.buyIn > 0)
    .map((p) => {
      const stack = chipValue(p.chips) + (s.hand?.contrib[p.id] ?? 0);
      return { id: p.id, name: p.name, buyIn: p.buyIn, stack, net: stack - p.buyIn };
    });
}

/** Who pays whom to square up, in as few payments as a greedy match gives. */
export function settlements(rows: LedgerRow[]): { from: string; to: string; amount: number }[] {
  const debt = rows.filter((r) => r.net < 0).map((r) => ({ name: r.name, amt: -r.net })).sort((a, b) => b.amt - a.amt);
  const cred = rows.filter((r) => r.net > 0).map((r) => ({ name: r.name, amt: r.net })).sort((a, b) => b.amt - a.amt);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const amount = Math.min(debt[i].amt, cred[j].amt);
    out.push({ from: debt[i].name, to: cred[j].name, amount });
    debt[i].amt -= amount;
    cred[j].amt -= amount;
    if (debt[i].amt === 0) i++;
    if (cred[j].amt === 0) j++;
  }
  return out;
}
