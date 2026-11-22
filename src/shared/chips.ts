/** A set of chips: denomination (in cents, as a string key) -> count. */
export type Chips = Record<string, number>;

export const chipValue = (c: Chips): number =>
  Object.entries(c).reduce((s, [d, n]) => s + Number(d) * n, 0);

export const chipCount = (c: Chips): number =>
  Object.values(c).reduce((s, n) => s + n, 0);

export function clean(c: Chips): Chips {
  const out: Chips = {};
  for (const [d, n] of Object.entries(c)) if (n > 0) out[d] = n;
  return out;
}

export function addChips(a: Chips, b: Chips): Chips {
  const out: Chips = { ...a };
  for (const [d, n] of Object.entries(b)) out[d] = (out[d] ?? 0) + n;
  return clean(out);
}

export const hasChips = (stack: Chips, want: Chips): boolean =>
  Object.entries(want).every(([d, n]) => (stack[d] ?? 0) >= n);

export function subChips(a: Chips, b: Chips): Chips {
  if (!hasChips(a, b)) throw new Error('Not enough chips');
  const out: Chips = { ...a };
  for (const [d, n] of Object.entries(b)) out[d] = (out[d] ?? 0) - n;
  return clean(out);
}

/** Fewest chips for an amount. Denominations must all be multiples of the smallest. */
export function greedy(amount: number, denoms: number[]): Chips {
  const out: Chips = {};
  let rem = amount;
  for (const d of [...denoms].sort((a, b) => b - a)) {
    const n = Math.floor(rem / d);
    if (n > 0) {
      out[d] = n;
      rem -= n * d;
    }
  }
  if (rem !== 0) throw new Error('Amount does not fit the chip denominations');
  return out;
}

const MAX_SMALL_CHIPS = 20;

/**
 * Turn a buy-in into a playable mix: value is shared evenly across the
 * denominations (capped at 20 chips each), the rest goes into the biggest chips.
 */
export function splitBuyIn(amount: number, denoms: number[]): Chips {
  const asc = [...denoms].sort((a, b) => a - b);
  const share = Math.floor(amount / asc.length);
  let out: Chips = {};
  let rem = amount;
  for (const d of asc.slice(0, -1)) {
    const n = Math.min(Math.floor(share / d), MAX_SMALL_CHIPS);
    if (n > 0) {
      out[d] = n;
      rem -= n * d;
    }
  }
  out = addChips(out, greedy(rem, asc));
  return out;
}

/**
 * Take `amount` out of a stack. Uses the player's own chips where possible and
 * breaks one bigger chip with the bank when exact change is not available.
 */
export function pay(stack: Chips, amount: number, denoms: number[]): { stack: Chips; paid: Chips } {
  if (amount > chipValue(stack)) throw new Error('Not enough chips');
  const left: Chips = { ...stack };
  let paid: Chips = {};
  let rem = amount;
  const desc = [...denoms].sort((a, b) => b - a);
  for (const d of desc) {
    const n = Math.min(left[d] ?? 0, Math.floor(rem / d));
    if (n > 0) {
      paid[d] = n;
      left[d] -= n;
      rem -= n * d;
    }
  }
  if (rem > 0) {
    const breakable = [...desc].reverse().find((d) => d > rem && (left[d] ?? 0) > 0);
    if (breakable === undefined) throw new Error('Cannot make change');
    left[breakable] -= 1;
    paid = addChips(paid, greedy(rem, denoms));
    return { stack: addChips(clean(left), greedy(breakable - rem, denoms)), paid };
  }
  return { stack: clean(left), paid };
}

/**
 * Break bigger chips down until the stack holds at least `min` of every smaller
 * denomination (or runs out of bigger chips), so any bet can be made exactly.
 * The stack's value never changes.
 */
export function makeChange(stack: Chips, denoms: number[], min = 4): Chips {
  const asc = [...denoms].sort((a, b) => a - b);
  const out: Chips = { ...stack };
  for (let i = 0; i < asc.length - 1; i++) {
    const d = asc[i];
    for (let guard = 0; (out[d] ?? 0) < min && guard < 200; guard++) {
      const big = asc.slice(i + 1).find((x) => (out[x] ?? 0) > 0);
      if (big === undefined) break;
      out[big] -= 1;
      // One step down at a time: a 10 becomes two 5s before a 5 becomes smaller chips.
      for (const [k, n] of Object.entries(greedy(big, asc.filter((x) => x < big)))) out[k] = (out[k] ?? 0) + n;
    }
  }
  return clean(out);
}

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${abs % 100 === 0 ? abs / 100 : (abs / 100).toFixed(2)}`;
}
