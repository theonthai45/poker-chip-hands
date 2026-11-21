import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, ClientMsg, GameState, ServerMsg } from '../shared/types';

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export const savedName = () => store.get('name') ?? '';
export const saveName = (n: string) => store.set('name', n);

function tokenFor(code: string): string {
  const key = `token:${code}`;
  let t = store.get(key);
  if (!t) {
    t = crypto.randomUUID() + crypto.randomUUID();
    store.set(key, t);
  }
  return t;
}

export type Status = 'connecting' | 'open' | 'reconnecting' | 'failed';

export function useRoom(code: string, name: string, create: boolean) {
  const [state, setState] = useState<GameState | null>(null);
  const [online, setOnline] = useState<string[]>([]);
  const [you, setYou] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let isCreate = create;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/ws/${code}`);
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        const hello: ClientMsg = { t: 'hello', token: tokenFor(code), name, create: isCreate };
        sock.send(JSON.stringify(hello));
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === 'welcome') {
          setYou(msg.you);
          setStatus('open');
          isCreate = false;
        } else if (msg.t === 'state') {
          setState(msg.state);
          setOnline(msg.online);
        } else if (msg.t === 'error') {
          if (msg.fatal) {
            closed = true;
            setStatus('failed');
            sock.close();
          }
          setError(msg.message);
        }
      };
      sock.onclose = () => {
        if (closed) return;
        setStatus('reconnecting');
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000));
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ws.current?.readyState === WebSocket.CLOSED) {
        clearTimeout(timer);
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      ws.current?.close();
    };
  }, [code, name, create]);

  const send = useCallback((action: Action) => {
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setError('Not connected — retrying');
      return;
    }
    ws.current.send(JSON.stringify({ t: 'action', action } satisfies ClientMsg));
  }, []);

  return { state, online, you, status, error, clearError: () => setError(null), send };
}
