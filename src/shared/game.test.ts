import { describe, expect, it } from 'vitest';
import { chipValue, makeChange, pay, splitBuyIn } from './chips';
import { createGame, joinGame, ledger, reduce, settlements } from './game';
import type { Action, GameState } from './types';

const D = [50, 100];

function setup(n = 3, mode: 'strict' | 'free' = 'strict') {
  let s = createGame('ABCD', 'p0', 'Host');
  for (let i = 1; i < n; i++) s = joinGame(s, `p${i}`, `P${i}`);
  s = reduce(s, 'p0', { type: 'updateSettings', settings: { mode } });
  s = reduce(s, 'p0', { type: 'startGame' });
  return s;
}
const act = (s: GameState, id: string, a: Action) => reduce(s, id, a);
const total = (s: GameState) =>
  s.players.reduce((a, p) => a + chipValue(p.chips), 0) + (s.hand ? chipValue(s.hand.potChips) : 0);

describe('chips', () => {
  it('splits a buy-in into a mix that adds up', () => {
    const c = splitBuyIn(2000, D);
    expect(chipValue(c)).toBe(2000);
    expect(c['50']).toBe(20);
    expect(splitBuyIn(5000, [50, 100, 500, 1000])).toSatisfy((x: Record<string, number>) => chipValue(x) === 5000);
  });
  it('makes change when paying', () => {
    const r = pay({ 100: 3 }, 150, D);
    expect(chipValue(r.paid)).toBe(150);
    expect(chipValue(r.stack)).toBe(150);
  });
});

describe('making change', () => {
  it('breaks big chips so every smaller chip is available', () => {
    const c = makeChange({ 1000: 3 }, [50, 100, 500, 1000]);
    expect(chipValue(c)).toBe(3000);
    expect(c['50']).toBeGreaterThanOrEqual(4);
    expect(c['100']).toBeGreaterThanOrEqual(4);
    expect(c['500']).toBeGreaterThanOrEqual(4);
  });
  it('leaves a healthy stack alone and copes with a short one', () => {
    expect(makeChange({ 50: 20, 100: 10 }, [50, 100])).toEqual({ 50: 20, 100: 10 });
    expect(chipValue(makeChange({ 1000: 1 }, [50, 100, 200, 500, 1000]))).toBe(1000);
    expect(makeChange({ 100: 1 }, [50, 100])).toEqual({ 50: 2 });
  });
  it('refills a player who runs out of small chips during play', () => {
    let s = createGame('ABCD', 'p0', 'A');
    s = joinGame(s, 'p1', 'B');
    s = reduce(s, 'p0', { type: 'updateSettings', settings: { mode: 'free' } });
    s = reduce(s, 'p0', { type: 'startGame' });
    s = reduce(s, 'p0', { type: 'bet', chips: { 50: 20 } }); // throw every small chip
    const p = s.players[0];
    expect(p.chips['50']).toBeGreaterThanOrEqual(4);
    expect(chipValue(p.chips)).toBe(1000);
  });
});

describe('strict mode', () => {
  it('posts blinds and runs a hand to a fold win', () => {
    let s = setup(3);
    const h = s.hand!;
    expect(chipValue(h.potChips)).toBe(150);
    expect([h.dealer, h.sb, h.bb]).toEqual(['p0', 'p1', 'p2']);
    // 3 players: dealer p0, SB p1, BB p2, first to act p0
    expect(h.toAct).toBe('p0');
    s = act(s, 'p0', { type: 'fold' });
    s = act(s, 'p1', { type: 'fold' });
    expect(s.hand).toBeNull();
    expect(chipValue(s.players[2].chips)).toBe(2050);
    expect(total(s)).toBe(6000);
  });

  it('rejects acting out of turn and short raises', () => {
    const s = setup(3);
    expect(() => act(s, 'p1', { type: 'call' })).toThrow('Not your turn');
    expect(() => act(s, 'p0', { type: 'bet', chips: { 100: 1, 50: 1 } })).toThrow(/Minimum raise/);
  });

  it('goes to showdown, winner claims, others confirm', () => {
    let s = setup(2);
    // heads-up: dealer p0 is SB and acts first preflop
    s = act(s, 'p0', { type: 'call' });
    s = act(s, 'p1', { type: 'bet', chips: {} }); // check
    for (const street of ['flop', 'turn', 'river']) {
      expect(s.hand!.street).toBe(street);
      s = act(s, s.hand!.toAct!, { type: 'bet', chips: {} });
      s = act(s, s.hand!.toAct!, { type: 'bet', chips: {} });
    }
    expect(s.hand!.street).toBe('showdown');
    s = act(s, 'p1', { type: 'claim', pot: 0 });
    expect(() => act(s, 'p1', { type: 'confirm', pot: 0 })).toThrow();
    s = act(s, 'p0', { type: 'confirm', pot: 0 });
    expect(s.hand).toBeNull();
    expect(chipValue(s.players[1].chips)).toBe(2100);
  });

  it('builds side pots on all-ins', () => {
    let s = createGame('ABCD', 'p0', 'A');
    s = joinGame(s, 'p1', 'B');
    s = joinGame(s, 'p2', 'C');
    s = act(s, 'p0', { type: 'setPlanned', playerId: 'p0', amount: 500 });
    s = act(s, 'p0', { type: 'startGame' });
    s = act(s, 'p0', { type: 'allIn' });
    s = act(s, 'p1', { type: 'allIn' });
    s = act(s, 'p2', { type: 'call' });
    const pots = s.hand!.pots;
    expect(s.hand!.street).toBe('showdown');
    expect(pots[0].amount).toBe(1500);
    expect(pots[0].eligible).toHaveLength(3);
    expect(pots[1].amount).toBe(3000);
    expect(pots[1].eligible).toEqual(['p1', 'p2']);
    s = act(s, 'p0', { type: 'claim', pot: 0 });
    s = act(s, 'p1', { type: 'confirm', pot: 0 });
    s = act(s, 'p2', { type: 'confirm', pot: 0 });
    s = act(s, 'p2', { type: 'claim', pot: 1 });
    s = act(s, 'p0', { type: 'confirm', pot: 1 }); // host confirms for all
    expect(s.hand).toBeNull();
    expect(chipValue(s.players[0].chips)).toBe(1500);
    expect(chipValue(s.players[2].chips)).toBe(3000);
    expect(total(s)).toBe(4500);
  });
});

describe('seating', () => {
  it('lets the host reorder seats in the lobby', () => {
    let s = createGame('ABCD', 'p0', 'A');
    s = joinGame(s, 'p1', 'B');
    s = joinGame(s, 'p2', 'C');
    expect(() => reduce(s, 'p1', { type: 'moveSeat', playerId: 'p2', to: 0 })).toThrow(/host/);
    s = reduce(s, 'p0', { type: 'moveSeat', playerId: 'p2', to: 0 });
    expect(s.players.map((p) => p.id)).toEqual(['p2', 'p0', 'p1']);
    s = reduce(s, 'p0', { type: 'startGame' });
    expect([s.hand!.dealer, s.hand!.sb, s.hand!.bb]).toEqual(['p2', 'p0', 'p1']);
  });
  it('keeps the turn order of a hand in progress and uses the new seats next hand', () => {
    let s = setup(3); // dealer p0, SB p1, BB p2, p0 to act
    s = act(s, 'p0', { type: 'moveSeat', playerId: 'p2', to: 0 }); // seats now p2, p0, p1
    s = act(s, 'p0', { type: 'call' });
    expect(s.hand!.toAct).toBe('p1'); // still the order the hand was dealt in
    s = act(s, 'p1', { type: 'fold' });
    s = act(s, 'p2', { type: 'fold' });
    expect(s.hand).toBeNull();
    s = act(s, 'p0', { type: 'deal' });
    // New seating p2, p0, p1: the button moves from p0 to p1.
    expect([s.hand!.dealer, s.hand!.sb, s.hand!.bb]).toEqual(['p1', 'p2', 'p0']);
  });
});

describe('free mode', () => {
  it('throws, undoes, claims', () => {
    let s = setup(3, 'free');
    s = act(s, 'p1', { type: 'bet', chips: { 100: 2 } });
    s = act(s, 'p2', { type: 'bet', chips: { 50: 1 } });
    s = act(s, 'p2', { type: 'undo' });
    s = act(s, 'p2', { type: 'bet', chips: { 100: 2 } });
    expect(s.hand!.pots[0].amount).toBe(400);
    s = act(s, 'p1', { type: 'claim', pot: 0 });
    s = act(s, 'p2', { type: 'confirm', pot: 0 });
    expect(s.hand!.pots).toHaveLength(0);
    expect(chipValue(s.players[1].chips)).toBe(2200);
  });
});

describe('mid-game & ledger', () => {
  it('adds a late joiner with a custom buy-in and settles up', () => {
    let s = setup(2, 'free');
    s = joinGame(s, 'p9', 'Late');
    expect(s.players[2].status).toBe('waiting');
    s = act(s, 'p0', { type: 'addChips', playerId: 'p9', amount: 3000 });
    expect(chipValue(s.players[2].chips)).toBe(3000);
    s = act(s, 'p9', { type: 'bet', chips: { 100: 5 } });
    s = act(s, 'p0', { type: 'claim', pot: 0 });
    s = act(s, 'p9', { type: 'confirm', pot: 0 });
    const rows = ledger(s);
    expect(rows.reduce((a, r) => a + r.net, 0)).toBe(0);
    expect(settlements(rows)).toEqual([{ from: 'Late', to: 'Host', amount: 500 }]);
  });
});
