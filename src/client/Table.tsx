import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { addChips, chipCount, chipValue, clean, hasChips, money, subChips, type Chips } from '../shared/chips';
import type { Denom, GameState, Hand, Player, Pot } from '../shared/types';
import { Chip, ChipStack } from './Chip';
import { MoneyInput, SettingsSheet } from './Lobby';
import type { ChipScene } from './scene';
import type { useRoom } from './useRoom';

type Room = ReturnType<typeof useRoom>;

const buzz = (ms: number | number[]) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
};

/** Pick chips from a stack that add up exactly to `amount`, biggest first. */
function pickExact(stack: Chips, amount: number): Chips | null {
  const out: Chips = {};
  let rem = amount;
  for (const d of Object.keys(stack).map(Number).sort((a, b) => b - a)) {
    const n = Math.min(stack[d], Math.floor(rem / d));
    if (n > 0) {
      out[d] = n;
      rem -= n * d;
    }
  }
  return rem === 0 ? out : null;
}

function chipList(chips: Chips, denoms: Denom[]) {
  const out: Denom[] = [];
  for (const d of [...denoms].sort((a, b) => b.value - a.value)) for (let i = 0; i < (chips[d.value] ?? 0); i++) out.push(d);
  return out;
}

/* ---------- flying chips ---------- */

interface Flight {
  id: number;
  chips: Denom[];
  from: DOMRect;
  to: DOMRect;
}

let flightId = 0;

function FlyLayer({ flights, done }: { flights: Flight[]; done: (id: number) => void }) {
  return (
    <div className="fly-layer">
      {flights.map((f) => (
        <FlightView key={f.id} f={f} done={() => done(f.id)} />
      ))}
    </div>
  );
}

function FlightView({ f, done }: { f: Flight; done: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const els = Array.from(ref.current?.children ?? []) as HTMLElement[];
    const anims = els.map((el, i) => {
      const sx = f.from.left + f.from.width / 2 - 20 + (Math.random() - 0.5) * 30;
      const sy = f.from.top + f.from.height / 2 - 20;
      const tx = f.to.left + f.to.width / 2 - 20 + (Math.random() - 0.5) * f.to.width * 0.4;
      const ty = f.to.top + f.to.height / 2 - 20 + (Math.random() - 0.5) * 30;
      const spin = (Math.random() - 0.5) * 720;
      return el.animate(
        [
          { transform: `translate(${sx}px, ${sy}px) scale(1) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${(sx + tx) / 2}px, ${Math.min(sy, ty) - 60}px) scale(1.15) rotate(${spin / 2}deg)`, offset: 0.5 },
          { transform: `translate(${tx}px, ${ty}px) scale(0.75) rotate(${spin}deg)`, opacity: 0.9 },
        ],
        { duration: 520, delay: i * 45, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' },
      );
    });
    Promise.all(anims.map((a) => a.finished)).then(done, done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref}>
      {f.chips.slice(0, 12).map((d, i) => (
        <div key={i} className="flying">
          <Chip value={d.value} color={d.color} size={40} />
        </div>
      ))}
    </div>
  );
}

/* ---------- table ---------- */

export function Table({ room, state, you }: { room: Room; state: GameState; you: string }) {
  const me = state.players.find((p) => p.id === you)!;
  const isHost = state.hostId === you;
  const h = state.hand;
  const denoms = state.settings.denoms;
  const strict = state.settings.mode === 'strict';

  const [tray, setTray] = useState<Chips>({});
  const [flights, setFlights] = useState<Flight[]>([]);
  const [sheet, setSheet] = useState<'host' | 'settings' | 'rebuy' | 'log' | null>(null);
  const potRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ChipScene | null>(null);
  /** 3D chips when WebGL is available, flat DOM chips otherwise. */
  const [mode, setMode] = useState<'loading' | '3d' | 'dom'>('loading');

  useEffect(() => {
    let dead = false;
    let sc: ChipScene | null = null;
    import('./scene').then(
      (m) => {
        if (dead) return;
        try {
          sc = new m.ChipScene(canvasRef.current!, rootRef.current!);
          sceneRef.current = sc;
          setMode('3d');
        } catch {
          setMode('dom');
        }
      },
      () => setMode('dom'),
    );
    return () => {
      dead = true;
      sc?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Chips just thrown but not yet confirmed by the server; hidden from my stack meanwhile.
  const chipsKey = JSON.stringify(me.chips);
  const [pendingRaw, setPending] = useState<{ key: string; chips: Chips }>({ key: '', chips: {} });
  const pending = pendingRaw.key === chipsKey ? pendingRaw.chips : {};
  useEffect(() => {
    if (room.error) setPending({ key: '', chips: {} });
  }, [room.error]);

  // What is left in my stacks after the tray and pending throws.
  const avail = useMemo(() => {
    const out: Chips = {};
    for (const [d, n] of Object.entries(me.chips)) out[d] = Math.max(0, n - (tray[d] ?? 0) - (pending[d] ?? 0));
    return clean(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipsKey, tray, pendingRaw]);
  useEffect(() => {
    if (!hasChips(me.chips, tray)) setTray({});
  }, [me.chips, tray]);

  const fly = (chips: Denom[], from: Element | null, to: Element | null) => {
    if (!from || !to || chips.length === 0) return;
    setFlights((f) => [...f, { id: ++flightId, chips, from: from.getBoundingClientRect(), to: to.getBoundingClientRect() }]);
  };
  /** Chips going into the pot from somewhere on screen. */
  const throwIn = (chips: Chips, from: Element | null) => {
    if (sceneRef.current) sceneRef.current.throwFrom(from, chips);
    else fly(chipList(chips, denoms), from, potRef.current);
  };
  /** Chips leaving the pot for a winner. */
  const payOut = (chips: Chips, to: Element | null) => {
    if (sceneRef.current) sceneRef.current.payout(chips, to);
    else fly(chipList(chips, denoms), potRef.current, to);
  };

  // Animate other players' throws and pot payouts.
  const prev = useRef<GameState>(state);
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const hb = before.hand;
    const ha = state.hand;
    const cardOf = (id: string) => document.querySelector(`[data-pid="${id}"]`);
    const scene = sceneRef.current;
    scene?.setDenoms(denoms);
    if (ha && hb && ha.number === hb.number) {
      for (const p of state.players) {
        if (p.id === you) continue;
        const delta = (ha.contrib[p.id] ?? 0) - (hb.contrib[p.id] ?? 0);
        if (delta > 0) {
          const gained = clean(Object.fromEntries(Object.entries(ha.potChips).map(([d, n]) => [d, n - (hb.potChips[d] ?? 0)])));
          throwIn(gained, cardOf(p.id));
        }
      }
    }
    // Winnings: whoever's stack grew without a buy-in.
    if (hb && chipValue(hb.potChips) > 0) {
      const sameHand = ha && ha.number === hb.number;
      const winners = state.players.filter((p) => {
        const old = before.players.find((x) => x.id === p.id);
        return old && p.buyIn === old.buyIn && chipValue(p.chips) > chipValue(old.chips);
      });
      // Whatever left the pot, shared out between the winners.
      const left = clean(Object.fromEntries(Object.entries(hb.potChips).map(([d, n]) => [d, n - ((sameHand ? ha.potChips[d] : 0) ?? 0)])));
      winners.forEach((p, i) => {
        const share = clean(Object.fromEntries(Object.entries(left).map(([d, n]) => [d, Math.floor(n / winners.length) + (i < n % winners.length ? 1 : 0)])));
        payOut(share, p.id === you ? trayRef.current : cardOf(p.id));
        if (p.id === you) buzz([30, 40, 30]);
      });
    }
    scene?.setPot(ha?.potChips ?? {});
    if (ha?.toAct === you && hb?.toAct !== you) buzz(60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, mode]);

  useEffect(() => {
    sceneRef.current?.setOwn(
      denoms.map((d) => ({ denom: d.value, stack: me.status === 'active' ? (avail[d.value] ?? 0) : 0, tray: tray[d.value] ?? 0 })),
    );
  }, [avail, tray, mode, denoms, me.status]);

  const throwTray = (power = 0.5) => {
    const amount = chipValue(tray);
    if (amount === 0) return;
    if (!canThrow) return;
    if (sceneRef.current) sceneRef.current.throwTray(power);
    else fly(chipList(tray, denoms), trayRef.current, potRef.current);
    buzz(25);
    room.send({ type: 'bet', chips: tray });
    setPending({ key: chipsKey, chips: tray });
    setTray({});
  };
  const dom = mode === 'dom';

  const myTurn = !!h && h.toAct === you;
  const toCall = h && strict ? Math.max(0, h.currentBet - (h.streetBet[you] ?? 0)) : 0;
  const myStack = chipValue(me.chips);
  const canThrow = me.status === 'active' && !!h && (strict ? myTurn : h.street === 'open');

  const rebuyCount = state.players.filter((p) => p.rebuyRequest || p.status === 'waiting').length;

  return (
    <div className="table" ref={rootRef}>
      <canvas ref={canvasRef} className="scene" style={{ display: dom ? 'none' : undefined }} />
      <header className="table-top">
        <div>
          <b>{state.code}</b>
          <span className="muted small">
            {' '}
            · {strict ? (h ? `Hand ${h.number} · ${h.street}` : 'Between hands') : 'Free-form'}
          </span>
        </div>
        <div className="top-actions">
          <button className="btn tiny" onClick={() => setSheet('log')}>
            Log
          </button>
          {isHost ? (
            <button className="btn tiny" onClick={() => setSheet('host')}>
              Host{rebuyCount > 0 && <span className="badge">{rebuyCount}</span>}
            </button>
          ) : (
            <button className="btn tiny" onClick={() => setSheet('rebuy')}>
              Buy chips
            </button>
          )}
        </div>
      </header>

      <Players state={state} you={you} online={room.online} />

      <div className="felt">
        <div className="pot" ref={potRef}>
          <div className="pot-label">Pot</div>
          <div className="pot-total">{money(h ? chipValue(h.potChips) : 0)}</div>
          <div className="pile-area" data-anchor="pot">
            {dom &&
              h &&
              denoms.filter((d) => h.potChips[d.value]).map((d) => <ChipStack key={d.value} value={d.value} color={d.color} count={h.potChips[d.value]} size={34} />)}
          </div>
          <div className="pot-counts">
            {h && chipCount(h.potChips) > 0 ? (
              denoms
                .filter((d) => h.potChips[d.value])
                .map((d) => (
                  <span key={d.value}>
                    <i style={{ background: d.color }} />× {h.potChips[d.value]}
                  </span>
                ))
            ) : (
              <span className="muted">No chips yet</span>
            )}
          </div>
          {strict && h && h.street !== 'showdown' && h.currentBet > 0 && (
            <div className="muted small">Current bet {money(h.currentBet)}</div>
          )}
        </div>
        {h && <Claims state={state} hand={h} you={you} room={room} />}
        {strict && !h && (
          <button className="btn primary deal" disabled={me.status !== 'active'} onClick={() => room.send({ type: 'deal' })}>
            Deal next hand
          </button>
        )}
      </div>

      {me.status === 'waiting' && <div className="notice">Waiting for the host to give you chips…</div>}
      {me.status === 'out' && <div className="notice">You have cashed out.</div>}

      {me.status === 'active' && (
        <div className="hand-zone">
          {strict && h && h.street !== 'showdown' && (
            <div className="actions">
              {myTurn ? (
                <>
                  <button className="btn danger" onClick={() => room.send({ type: 'fold' })}>
                    Fold
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (toCall > 0) throwIn(pickExact(me.chips, Math.min(toCall, myStack)) ?? {}, trayRef.current);
                      buzz(20);
                      room.send({ type: 'call' });
                    }}
                  >
                    {toCall === 0 ? 'Check' : toCall >= myStack ? `Call all-in ${money(myStack)}` : `Call ${money(toCall)}`}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      throwIn(me.chips, trayRef.current);
                      buzz([20, 30, 20]);
                      room.send({ type: 'allIn' });
                    }}
                  >
                    All-in
                  </button>
                </>
              ) : (
                <div className="muted center-text">
                  {h.folded.includes(you)
                    ? 'You folded'
                    : h.allIn.includes(you)
                      ? 'You are all-in'
                      : h.inHand.includes(you)
                        ? `Waiting for ${state.players.find((p) => p.id === h.toAct)?.name ?? '…'}`
                        : 'Sitting out this hand'}
                </div>
              )}
            </div>
          )}

          {strict && myTurn && (
            <QuickBets hand={h!} me={me} toCall={toCall} bb={state.settings.bigBlind} setTray={setTray} />
          )}

          <Tray dom={dom} tray={tray} denoms={denoms} trayRef={trayRef} canThrow={canThrow} onThrow={throwTray} onRemove={(d) => setTray((t) => subChips(t, { [d]: 1 }))} label={strict && myTurn ? betLabel(h!, you, chipValue(tray), myStack) : null} />

          <div className="my-stacks">
            {denoms.map((d) => {
              const n = avail[d.value] ?? 0;
              return (
                <button
                  key={d.value}
                  className="my-stack"
                  disabled={n === 0}
                  onClick={() => {
                    buzz(8);
                    setTray((t) => addChips(t, { [d.value]: 1 }));
                  }}
                >
                  {dom ? <ChipStack value={d.value} color={d.color} count={n} size={46} /> : <div className="stack-space" data-anchor={`stack:${d.value}`} />}
                  <span>× {n}</span>
                </button>
              );
            })}
          </div>
          <div className="my-total">
            <span>Your stack</span> <b>{money(myStack)}</b>
            {!strict && h && (h.throws[you]?.length ?? 0) > 0 && (
              <button className="btn tiny" onClick={() => room.send({ type: 'undo' })}>
                Undo last throw
              </button>
            )}
            {chipValue(tray) > 0 && (
              <button className="btn tiny" onClick={() => setTray({})}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <FlyLayer flights={flights} done={(id) => setFlights((f) => f.filter((x) => x.id !== id))} />

      {sheet === 'host' && <HostSheet state={state} room={room} onClose={() => setSheet(null)} openSettings={() => setSheet('settings')} />}
      {sheet === 'settings' && <SettingsSheet state={state} room={room} onClose={() => setSheet(null)} />}
      {sheet === 'rebuy' && <RebuySheet state={state} me={me} room={room} onClose={() => setSheet(null)} />}
      {sheet === 'log' && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet">
            <h2>Log</h2>
            <ul className="log">
              {[...state.log].reverse().map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function betLabel(h: Hand, you: string, amount: number, stack: number) {
  if (amount === 0) return null;
  const total = (h.streetBet[you] ?? 0) + amount;
  if (amount === stack) return `All-in ${money(amount)}`;
  if (total === h.currentBet) return `Call ${money(amount)}`;
  if (total < h.currentBet) return `${money(h.currentBet - total)} short of a call`;
  const minTo = h.currentBet + h.minRaise;
  if (total < minTo) return `Min ${h.currentBet ? 'raise to' : 'bet'} ${money(minTo)}`;
  return h.currentBet === 0 ? `Bet ${money(amount)}` : `Raise to ${money(total)}`;
}

function QuickBets({ hand, me, toCall, bb, setTray }: { hand: Hand; me: Player; toCall: number; bb: number; setTray: (c: Chips) => void }) {
  const mine = hand.streetBet[me.id] ?? 0;
  const pot = chipValue(hand.potChips);
  const stack = chipValue(me.chips);
  const options: [string, number][] = [
    [hand.currentBet ? 'Min raise' : 'Min bet', hand.currentBet + Math.max(hand.minRaise, bb) - mine],
    ['½ pot', toCall + Math.round((pot + toCall) / 2 / 50) * 50],
    ['Pot', toCall + pot + toCall],
  ];
  return (
    <div className="quick">
      {options.map(([label, amt]) => {
        const chips = amt > 0 && amt < stack ? pickExact(me.chips, amt) : null;
        return (
          <button key={label} className="btn tiny" disabled={!chips} onClick={() => chips && setTray(chips)}>
            {label}
            {chips && <small> {money(amt)}</small>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- swipe tray ---------- */

function Tray({
  dom,
  tray,
  denoms,
  trayRef,
  canThrow,
  onThrow,
  onRemove,
  label,
}: {
  dom: boolean;
  tray: Chips;
  denoms: Denom[];
  trayRef: React.RefObject<HTMLDivElement | null>;
  canThrow: boolean;
  onThrow: (power: number) => void;
  onRemove: (d: number) => void;
  label: string | null;
}) {
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number; id: number; moved: boolean } | null>(null);
  const amount = chipValue(tray);

  const down = (e: RPointerEvent) => {
    if (amount === 0) return;
    drag.current = { y: e.clientY, t: performance.now(), id: e.pointerId, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = Math.min(0, e.clientY - d.y);
    if (delta < -6) d.moved = true;
    setDy(delta);
  };
  const up = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const delta = e.clientY - d.y;
    const v = delta / Math.max(1, performance.now() - d.t);
    setDy(0);
    if (canThrow && (delta < -70 || (delta < -25 && v < -0.6))) onThrow(Math.min(1, Math.max(0, (-v - 0.3) / 1.5)));
    else if (!d.moved) {
      // A plain tap on a chip in the tray puts it back.
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-denom]');
      if (el) onRemove(Number(el.getAttribute('data-denom')));
    }
  };

  return (
    <div
      ref={trayRef}
      className={`tray ${amount ? 'filled' : ''} ${canThrow ? '' : 'locked'}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        drag.current = null;
        setDy(0);
      }}
      style={{ transform: `translateY(${dy}px) scale(${1 + Math.min(0.08, -dy / 1500)})` }}
    >
      {amount === 0 ? (
        <span className="muted small">Tap your chips below to pick them up</span>
      ) : (
        <>
          <div className="tray-chips">
            {denoms
              .filter((d) => tray[d.value])
              .map((d) => (
                <div key={d.value} data-denom={d.value} className="tray-group">
                  <div className="tray-spot" data-anchor={`tray:${d.value}`}>
                    {dom && <ChipStack value={d.value} color={d.color} count={tray[d.value]} size={40} />}
                  </div>
                  <span>× {tray[d.value]}</span>
                </div>
              ))}
          </div>
          <div className="tray-label">
            <b>{label ?? money(amount)}</b>
            <span className="muted small">{canThrow ? '↑ Swipe up to throw' : 'Wait for your turn'}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- players ---------- */

function Players({ state, you, online }: { state: GameState; you: string; online: string[] }) {
  const h = state.hand;
  return (
    <div className="players">
      {state.players
        .filter((p) => p.id !== you && p.status !== 'out')
        .map((p) => {
          const folded = h?.folded.includes(p.id);
          const bet = h ? (h.street === 'open' ? h.contrib[p.id] : h.streetBet[p.id]) ?? 0 : 0;
          return (
            <div key={p.id} data-pid={p.id} className={`player ${h?.toAct === p.id ? 'turn' : ''} ${folded ? 'folded' : ''}`}>
              <div className="pname">
                <span className={`dot ${online.includes(p.id) ? 'on' : ''}`} />
                {p.name}
                {h?.dealer === p.id && <span className="dealer">D</span>}
              </div>
              <div className="pstack">{p.status === 'waiting' ? 'waiting' : money(chipValue(p.chips))}</div>
              <div className="pbet">{folded ? 'folded' : h?.allIn.includes(p.id) ? 'all-in' : bet ? money(bet) : ' '}</div>
            </div>
          );
        })}
    </div>
  );
}

/* ---------- claims ---------- */

function Claims({ state, hand, you, room }: { state: GameState; hand: Hand; you: string; room: Room }) {
  const isHost = state.hostId === you;
  const nm = (id: string) => (id === you ? 'You' : state.players.find((p) => p.id === id)?.name ?? '?');
  if (hand.street !== 'showdown' && hand.street !== 'open') return null;
  return (
    <div className="claims">
      {hand.pots.map((pot: Pot, i) => {
        if (pot.awarded) return null;
        const title = hand.pots.length > 1 ? (i === 0 ? 'Main pot' : `Side pot ${i}`) : 'Pot';
        const claiming = pot.claimants.includes(you);
        const canClaim = pot.eligible.includes(you);
        const canVote = pot.voters.includes(you) && !claiming;
        const waiting = pot.voters.filter((id) => !pot.claimants.includes(id) && !pot.confirms.includes(id));
        return (
          <div className="claim" key={i}>
            <div>
              <b>{title}</b> {money(pot.amount)}
              {hand.street === 'showdown' && pot.eligible.length < state.players.length && (
                <div className="muted small">Between {pot.eligible.map(nm).join(', ')}</div>
              )}
            </div>
            {pot.claimants.length === 0 ? (
              hand.street === 'showdown' || pot.amount > 0 ? (
                canClaim && (
                  <button className="btn primary small" onClick={() => room.send({ type: 'claim', pot: i })}>
                    I won this
                  </button>
                )
              ) : null
            ) : (
              <div className="claim-status">
                <div>
                  <b>{pot.claimants.map(nm).join(' & ')}</b> {pot.claimants.length > 1 ? 'split' : pot.claimants[0] === you ? 'claim' : 'claims'} it
                </div>
                {waiting.length > 0 && <div className="muted small">Waiting on {waiting.map(nm).join(', ')}</div>}
                <div className="claim-btns">
                  {canVote && !pot.confirms.includes(you) && (
                    <button className="btn primary small" onClick={() => room.send({ type: 'confirm', pot: i })}>
                      Confirm
                    </button>
                  )}
                  {isHost && !canVote && !claiming && (
                    <button className="btn primary small" onClick={() => room.send({ type: 'confirm', pot: i })}>
                      Confirm for all
                    </button>
                  )}
                  {canClaim && !claiming && (
                    <button className="btn small" onClick={() => room.send({ type: 'claim', pot: i })}>
                      Split
                    </button>
                  )}
                  {claiming ? (
                    <button className="btn small" onClick={() => room.send({ type: 'claim', pot: i })}>
                      Withdraw
                    </button>
                  ) : (
                    (canVote || isHost) && (
                      <button className="btn danger small" onClick={() => room.send({ type: 'dispute', pot: i })}>
                        Dispute
                      </button>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- sheets ---------- */

function HostSheet({ state, room, onClose, openSettings }: { state: GameState; room: Room; onClose: () => void; openSettings: () => void }) {
  const h = state.hand;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Host</h2>
        <p className="muted small">
          New players join with code <b>{state.code}</b>, then appear here for chips.
        </p>
        <ul className="list host-list">
          {state.players.map((p) => (
            <HostRow key={p.id} p={p} state={state} room={room} />
          ))}
        </ul>
        {state.settings.mode === 'strict' && h?.toAct && (
          <button className="btn" onClick={() => room.send({ type: 'forceFold' })}>
            Fold {state.players.find((p) => p.id === h.toAct)?.name} (away)
          </button>
        )}
        <div className="row2">
          <button className="btn" onClick={openSettings}>
            Settings
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('End the game and show the final ledger?')) room.send({ type: 'endGame' });
            }}
          >
            End game
          </button>
        </div>
      </div>
    </div>
  );
}

function HostRow({ p, state, room }: { p: Player; state: GameState; room: Room }) {
  const [amt, setAmt] = useState(p.rebuyRequest ?? state.settings.defaultBuyIn);
  useEffect(() => {
    if (p.rebuyRequest) setAmt(p.rebuyRequest);
  }, [p.rebuyRequest]);
  return (
    <li className={p.rebuyRequest || p.status === 'waiting' ? 'highlight' : ''}>
      <div className="grow">
        <div>
          <b>{p.name}</b> <span className="muted small">{p.status === 'out' ? 'cashed out' : money(chipValue(p.chips))}</span>
        </div>
        <div className="muted small">
          Bought in {money(p.buyIn)}
          {p.rebuyRequest ? ` · wants ${money(p.rebuyRequest)}` : ''}
          {p.status === 'waiting' ? ' · new player' : ''}
        </div>
      </div>
      <MoneyInput value={amt} onCommit={setAmt} />
      <button className="btn small primary" onClick={() => room.send({ type: 'addChips', playerId: p.id, amount: amt })}>
        {p.status === 'waiting' ? 'Seat' : 'Add'}
      </button>
      {p.status === 'active' && (
        <button
          className="icon-btn"
          aria-label={`Cash out ${p.name}`}
          title="Cash out"
          onClick={() => confirm(`Cash out ${p.name} with ${money(chipValue(p.chips))}?`) && room.send({ type: 'cashOut', playerId: p.id })}
        >
          ⏏
        </button>
      )}
    </li>
  );
}

function RebuySheet({ state, me, room, onClose }: { state: GameState; me: Player; room: Room; onClose: () => void }) {
  const [amt, setAmt] = useState(me.rebuyRequest ?? state.settings.defaultBuyIn);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Buy more chips</h2>
        <p className="muted small">The host will approve and hand you the chips.</p>
        <label className="field">
          <span>Amount</span>
          <MoneyInput value={amt} onCommit={setAmt} />
        </label>
        <div className="row2">
          {me.rebuyRequest ? (
            <button
              className="btn"
              onClick={() => {
                room.send({ type: 'requestRebuy', amount: 0 });
                onClose();
              }}
            >
              Cancel request
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Close
            </button>
          )}
          <button
            className="btn primary"
            onClick={() => {
              room.send({ type: 'requestRebuy', amount: amt });
              onClose();
            }}
          >
            Request {money(amt)}
          </button>
        </div>
      </div>
    </div>
  );
}
