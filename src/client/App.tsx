import { useEffect, useState } from 'react';
import { Ended } from './Ended';
import { Lobby } from './Lobby';
import { Table } from './Table';
import { saveName, savedName, useRoom } from './useRoom';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => LETTERS[b % LETTERS.length]).join('');

export const dollarsToCents = (v: string) => Math.round(parseFloat(v) * 100);
export const centsToDollars = (c: number) => (c / 100).toString();

function codeFromPath() {
  const m = location.pathname.match(/^\/([A-Za-z]{4})$/);
  return m ? m[1].toUpperCase() : null;
}

export function App() {
  const [code, setCode] = useState<string | null>(codeFromPath);
  const [name, setName] = useState(savedName);
  const [joined, setJoined] = useState<{ create: boolean } | null>(null);

  useEffect(() => {
    const onPop = () => {
      setCode(codeFromPath());
      setJoined(null);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // Returning to a room you already belong to: reconnect straight away.
  useEffect(() => {
    if (code && !joined && name && localStorage.getItem(`token:${code}`)) setJoined({ create: false });
  }, [code, joined, name]);

  const go = (c: string, create: boolean) => {
    saveName(name.trim());
    history.pushState(null, '', `/${c}`);
    setCode(c);
    setJoined({ create });
  };

  if (code && joined) return <Room code={code} name={name.trim()} create={joined.create} />;
  return <Home code={code} name={name} setName={setName} go={go} />;
}

function Home({
  code,
  name,
  setName,
  go,
}: {
  code: string | null;
  name: string;
  setName: (n: string) => void;
  go: (code: string, create: boolean) => void;
}) {
  const [joinCode, setJoinCode] = useState(code ?? '');
  const okName = name.trim().length > 0;
  const okCode = /^[A-Za-z]{4}$/.test(joinCode);
  return (
    <div className="screen home">
      <div className="logo">
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>Chip Stack</h1>
        <p className="muted">Real cards. Phone chips.</p>
      </div>
      <label className="field">
        <span>Your name</span>
        <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wei Ming" autoFocus />
      </label>
      <div className="card">
        <label className="field">
          <span>Game code</span>
          <input
            value={joinCode}
            maxLength={4}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABCD"
            className="code-input"
            autoCapitalize="characters"
          />
        </label>
        <button className="btn primary" disabled={!okName || !okCode} onClick={() => go(joinCode.toUpperCase(), false)}>
          Join game
        </button>
      </div>
      {!code && (
        <>
          <div className="or">or</div>
          <button className="btn" disabled={!okName} onClick={() => go(newCode(), true)}>
            Create new game
          </button>
        </>
      )}
    </div>
  );
}

function Room({ code, name, create }: { code: string; name: string; create: boolean }) {
  const room = useRoom(code, name, create);
  const { state, you, status, error, clearError } = room;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  let body;
  if (status === 'failed')
    body = (
      <div className="screen center">
        <h2>{error ?? 'Could not join'}</h2>
        <a className="btn" href="/">
          Back
        </a>
      </div>
    );
  else if (!state || !you) body = <div className="screen center muted">Connecting…</div>;
  else if (state.phase === 'lobby') body = <Lobby room={room} state={state} you={you} />;
  else if (state.phase === 'playing') body = <Table room={room} state={state} you={you} />;
  else body = <Ended state={state} />;

  return (
    <>
      {status === 'reconnecting' && <div className="banner">Reconnecting…</div>}
      {error && status !== 'failed' && (
        <div className="toast" onClick={clearError}>
          {error}
        </div>
      )}
      {body}
    </>
  );
}
