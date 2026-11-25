import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { money, splitBuyIn } from '../shared/chips';
import { CHIP_COLORS } from '../shared/game';
import type { GameState, Settings } from '../shared/types';
import { centsToDollars, dollarsToCents } from './App';
import { Chip } from './Chip';
import { HandGuide, InfoButton } from './HandGuide';
import type { useRoom } from './useRoom';

type Room = ReturnType<typeof useRoom>;

export function Lobby({ room, state, you }: { room: Room; state: GameState; you: string }) {
  const isHost = state.hostId === you;
  const [showSettings, setShowSettings] = useState(false);
  const [showHands, setShowHands] = useState(false);
  const url = `${location.origin}/${state.code}`;
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setQr);
  }, [url]);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Join my poker game', url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* cancelled */
    }
  };

  const { settings } = state;
  return (
    <div className="screen lobby">
      {/* Everything above the start button scrolls in its own area, so nothing hides behind it. */}
      <div className="lobby-scroll">
      <header className="top">
        <div>
          <div className="muted small">Game code</div>
          <div className="big-code">{state.code}</div>
        </div>
        <div className="top-actions">
          <button className="btn small" onClick={share}>
            Share link
          </button>
          <InfoButton onClick={() => setShowHands(true)} />
        </div>
      </header>
      {qr && <img className="qr" src={qr} alt={`QR code for ${url}`} />}

      <div className="card summary">
        <div>
          <b>{settings.mode === 'strict' ? 'Turn order' : 'Free-form'}</b>
          <span className="muted">
            {settings.mode === 'strict' ? ` · blinds ${money(settings.smallBlind)}/${money(settings.bigBlind)}` : ' · bet anytime'}
          </span>
        </div>
        <div className="muted">Default buy-in {money(settings.defaultBuyIn)}</div>
        <div className="chip-row">
          {settings.denoms.map((d) => (
            <Chip key={d.value} value={d.value} color={d.color} size={34} />
          ))}
        </div>
        {isHost && (
          <button className="btn small" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        )}
      </div>

      <h3>Players ({state.players.length})</h3>
      <p className="muted small seat-note">
        {isHost ? 'Use the arrows to match the order you are sitting in. Play goes down the list.' : 'Listed in seating order. Play goes down the list.'}
      </p>
      <ul className="list">
        {state.players.map((p, i) => (
          <li key={p.id}>
            {isHost ? <SeatArrows state={state} room={room} index={i} /> : <span className="seat-no">{i + 1}</span>}
            <span className={`dot ${room.online.includes(p.id) ? 'on' : ''}`} />
            <span className="grow pl-name">
              {p.name}
              {p.id === state.hostId && <span className="tag">host</span>}
              {p.id === you && <span className="tag">you</span>}
            </span>
            {isHost ? (
              <>
                <MoneyInput
                  value={p.planned ?? settings.defaultBuyIn}
                  onCommit={(c) => room.send({ type: 'setPlanned', playerId: p.id, amount: c === settings.defaultBuyIn ? null : c })}
                />
                {/* Kept in the layout for the host's own row too, so the buy-in boxes line up. */}
                <button
                  className="icon-btn"
                  aria-label={`Remove ${p.name}`}
                  style={p.id === state.hostId ? { visibility: 'hidden' } : undefined}
                  disabled={p.id === state.hostId}
                  onClick={() => room.send({ type: 'kick', playerId: p.id })}
                >
                  ✕
                </button>
              </>
            ) : (
              <span>{money(p.planned ?? settings.defaultBuyIn)}</span>
            )}
          </li>
        ))}
      </ul>
      </div>

      <div className="lobby-footer">
        {isHost ? (
          <button className="btn primary" disabled={state.players.length < 2} onClick={() => room.send({ type: 'startGame' })}>
            {state.players.length < 2 ? 'Waiting for players…' : 'Start game'}
          </button>
        ) : (
          <div className="muted center-text">Waiting for host to start…</div>
        )}
      </div>

      {showHands && <HandGuide onClose={() => setShowHands(false)} />}
      {showSettings && <SettingsSheet room={room} state={state} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/** Seat number with up/down buttons that move a player one seat earlier or later. */
export function SeatArrows({ state, room, index }: { state: GameState; room: Room; index: number }) {
  const p = state.players[index];
  const move = (to: number) => room.send({ type: 'moveSeat', playerId: p.id, to });
  return (
    <span className="seat-arrows">
      <button className="seat-btn" aria-label={`Move ${p.name} up`} disabled={index === 0} onClick={() => move(index - 1)}>
        ▲
      </button>
      <span className="seat-no">{index + 1}</span>
      <button className="seat-btn" aria-label={`Move ${p.name} down`} disabled={index === state.players.length - 1} onClick={() => move(index + 1)}>
        ▼
      </button>
    </span>
  );
}

export function MoneyInput({ value, onCommit, className }: { value: number; onCommit: (cents: number) => void; className?: string }) {
  const [text, setText] = useState(centsToDollars(value));
  useEffect(() => setText(centsToDollars(value)), [value]);
  const commit = () => {
    const c = dollarsToCents(text);
    if (Number.isFinite(c) && c > 0 && c !== value) onCommit(c);
    else setText(centsToDollars(value));
  };
  return (
    <span className={`money-input ${className ?? ''}`}>
      $
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

export function SettingsSheet({ room, state, onClose }: { room: Room; state: GameState; onClose: () => void }) {
  const [s, setS] = useState<Settings>(state.settings);
  const locked = state.phase !== 'lobby';
  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));
  const sorted = [...s.denoms].sort((a, b) => a.value - b.value);
  let preview: ReturnType<typeof splitBuyIn> | null = null;
  try {
    preview = splitBuyIn(s.defaultBuyIn, sorted.map((d) => d.value));
  } catch {
    preview = null;
  }

  const save = () => {
    room.send({ type: 'updateSettings', settings: { ...s, denoms: sorted } });
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="field">
          <span>Betting</span>
          <div className="seg">
            <button className={s.mode === 'strict' ? 'on' : ''} onClick={() => set({ mode: 'strict' })}>
              Turn order
            </button>
            <button className={s.mode === 'free' ? 'on' : ''} onClick={() => set({ mode: 'free' })}>
              Free-form
            </button>
          </div>
          <small className="muted">
            {s.mode === 'strict'
              ? 'Blinds are posted automatically. Players act in turn: check, call, raise or fold.'
              : 'Anyone can throw chips in anytime. No turns or rules enforced.'}
          </small>
        </div>

        {s.mode === 'strict' && (
          <div className="row2">
            <label className="field">
              <span>Small blind</span>
              <MoneyInput value={s.smallBlind} onCommit={(c) => set({ smallBlind: c })} />
            </label>
            <label className="field">
              <span>Big blind</span>
              <MoneyInput value={s.bigBlind} onCommit={(c) => set({ bigBlind: c })} />
            </label>
          </div>
        )}

        {!locked && (
          <>
            <label className="field">
              <span>Default buy-in</span>
              <MoneyInput value={s.defaultBuyIn} onCommit={(c) => set({ defaultBuyIn: c })} />
            </label>

            <div className="field">
              <span>Chips</span>
              {sorted.map((d) => (
                <div className="denom-row" key={d.value}>
                  <Chip value={d.value} color={d.color} size={36} />
                  <MoneyInput
                    value={d.value}
                    onCommit={(c) => set({ denoms: s.denoms.map((x) => (x.value === d.value ? { ...x, value: c } : x)) })}
                  />
                  <div className="swatches">
                    {CHIP_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`swatch ${c === d.color ? 'on' : ''}`}
                        style={{ background: c }}
                        aria-label={`Colour ${c}`}
                        onClick={() => set({ denoms: s.denoms.map((x) => (x.value === d.value ? { ...x, color: c } : x)) })}
                      />
                    ))}
                  </div>
                  {s.denoms.length > 1 && (
                    <button className="icon-btn" aria-label="Remove chip" onClick={() => set({ denoms: s.denoms.filter((x) => x.value !== d.value) })}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {s.denoms.length < 8 && (
                <button
                  className="btn small"
                  onClick={() => {
                    const top = sorted[sorted.length - 1]?.value ?? 50;
                    const next = [2, 2.5, 2, 2].map((m) => top * m).find((v) => !s.denoms.some((d) => d.value === v)) ?? top * 2;
                    const color = CHIP_COLORS.find((c) => !s.denoms.some((d) => d.color === c)) ?? CHIP_COLORS[0];
                    set({ denoms: [...s.denoms, { value: next, color }] });
                  }}
                >
                  + Add chip
                </button>
              )}
            </div>

            <div className="field">
              <span>Each {money(s.defaultBuyIn)} buy-in gets</span>
              {preview ? (
                <div className="chip-row">
                  {sorted
                    .filter((d) => preview![d.value])
                    .map((d) => (
                      <div key={d.value} className="preview">
                        <Chip value={d.value} color={d.color} size={30} />× {preview![d.value]}
                      </div>
                    ))}
                </div>
              ) : (
                <small className="error-text">Buy-in must be a multiple of the smallest chip</small>
              )}
            </div>
          </>
        )}
        {locked && <small className="muted">Chips and buy-in are locked once the game starts.</small>}

        <div className="row2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
