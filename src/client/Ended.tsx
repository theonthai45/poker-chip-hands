import { useState } from 'react';
import { money } from '../shared/chips';
import { ledger, settlements } from '../shared/game';
import type { GameState } from '../shared/types';

const signed = (c: number) => `${c > 0 ? '+' : ''}${money(c)}`;

/** Results and who-pays-who, as plain text for sharing in a group chat. */
function summaryText(state: GameState) {
  const rows = ledger(state).sort((a, b) => b.net - a.net);
  const pays = settlements(rows);
  return [
    `Chip Stack results (${state.code})`,
    ...rows.map((r) => `${r.name}: ${signed(r.net)} (in ${money(r.buyIn)}, out ${money(r.stack)})`),
    '',
    pays.length ? 'Payments:' : 'Everyone is even.',
    ...pays.map((p) => `${p.from} pays ${p.to} ${money(p.amount)}`),
  ].join('\n');
}

/** Who owes whom, plus each player's buy-in, final chips and net result. */
export function Standings({ state, you, live }: { state: GameState; you?: string | null; live?: boolean }) {
  const rows = ledger(state).sort((a, b) => b.net - a.net);
  const pays = settlements(rows);
  const mine = state.players.find((p) => p.id === you)?.name;
  return (
    <>
      <h3>{live ? 'If the game ended now' : 'Who pays who'}</h3>
      {pays.length === 0 ? (
        <p className="muted">Everyone is even. Nobody owes anything.</p>
      ) : (
        <table className="ledger pays">
          <thead>
            <tr>
              <th>From</th>
              <th></th>
              <th>To</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {pays.map((p, i) => (
              <tr key={i} className={p.from === mine || p.to === mine ? 'me' : ''}>
                <td>{p.from}</td>
                <td className="arrow">pays</td>
                <td>{p.to}</td>
                <td>
                  <b>{money(p.amount)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Results</h3>
      <table className="ledger">
        <thead>
          <tr>
            <th>Player</th>
            <th>Bought in</th>
            <th>{live ? 'Chips now' : 'Cashed out'}</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === you ? 'me' : ''}>
              <td>{r.name}</td>
              <td>{money(r.buyIn)}</td>
              <td>{money(r.stack)}</td>
              <td className={r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}>
                <b>{signed(r.net)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function ShareResults({ state }: { state: GameState }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const text = summaryText(state);
    try {
      if (navigator.share) await navigator.share({ title: 'Poker results', text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <button className="btn primary" onClick={share}>
      {copied ? 'Copied' : 'Share results'}
    </button>
  );
}

export function Ended({ state, you }: { state: GameState; you?: string | null }) {
  return (
    <div className="screen ended">
      <h2>Game over</h2>
      <p className="muted">Final tally for game {state.code}.</p>
      <Standings state={state} you={you} />
      <div className="row2">
        <ShareResults state={state} />
        <a className="btn" href="/">
          New game
        </a>
      </div>
    </div>
  );
}
