import { money } from '../shared/chips';
import { ledger, settlements } from '../shared/game';
import type { GameState } from '../shared/types';

export function Ended({ state }: { state: GameState }) {
  const rows = ledger(state).sort((a, b) => b.net - a.net);
  const pays = settlements(rows);
  return (
    <div className="screen">
      <h2>Game over</h2>
      <table className="ledger">
        <thead>
          <tr>
            <th>Player</th>
            <th>In</th>
            <th>Out</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{money(r.buyIn)}</td>
              <td>{money(r.stack)}</td>
              <td className={r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}>
                {r.net > 0 ? '+' : ''}
                {money(r.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Settle up</h3>
      {pays.length === 0 ? (
        <p className="muted">Everyone is even.</p>
      ) : (
        <ul className="list">
          {pays.map((p, i) => (
            <li key={i}>
              <span className="grow">
                <b>{p.from}</b> pays <b>{p.to}</b>
              </span>
              <b>{money(p.amount)}</b>
            </li>
          ))}
        </ul>
      )}
      <a className="btn" href="/">
        New game
      </a>
    </div>
  );
}
