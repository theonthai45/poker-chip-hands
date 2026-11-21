import { DurableObject } from 'cloudflare:workers';
import { createGame, GameError, joinGame, reduce } from '../shared/game';
import type { ClientMsg, GameState, ServerMsg } from '../shared/types';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

interface Attachment {
  playerId: string;
}

const CODE_RE = /^[A-Z]{4}$/;
const ROOM_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** One Durable Object per game room. Holds state and fans updates out over WebSockets. */
export class Room extends DurableObject<Env> {
  private state: GameState | null = null;
  private code = '';
  /** token -> playerId. Tokens stay server-side so ids can be shared safely. */
  private tokens: Record<string, string> = {};
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    this.state = (await this.ctx.storage.get<GameState>('state')) ?? null;
    this.tokens = (await this.ctx.storage.get<Record<string, string>>('tokens')) ?? {};
    this.loaded = true;
  }

  private async save() {
    await this.ctx.storage.put({ state: this.state, tokens: this.tokens });
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
    this.state = null;
    this.tokens = {};
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    this.code = new URL(req.url).searchParams.get('code') ?? '';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  private broadcast() {
    if (!this.state) return;
    const sockets = this.ctx.getWebSockets();
    const online = [
      ...new Set(sockets.map((ws) => (ws.deserializeAttachment() as Attachment | null)?.playerId).filter(Boolean)),
    ] as string[];
    const msg: ServerMsg = { t: 'state', state: this.state, online };
    for (const ws of sockets) if (ws.deserializeAttachment()) this.send(ws, msg);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.load();
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    try {
      if (msg.t === 'hello') {
        if (typeof msg.token !== 'string' || msg.token.length < 16) throw new GameError('Bad token');
        let id = this.tokens[msg.token];
        if (!this.state) {
          if (!msg.create) return this.send(ws, { t: 'error', message: 'Game not found', fatal: true });
          id = crypto.randomUUID();
          this.tokens[msg.token] = id;
          this.state = createGame(this.code, id, String(msg.name ?? ''));
        } else if (!id) {
          id = crypto.randomUUID();
          this.state = joinGame(this.state, id, String(msg.name ?? ''));
          this.tokens[msg.token] = id;
        }
        ws.serializeAttachment({ playerId: id } satisfies Attachment);
        this.send(ws, { t: 'welcome', you: id });
        await this.save();
        this.broadcast();
        return;
      }
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att || !this.state) return;
      if (msg.t === 'action') {
        this.state = reduce(this.state, att.playerId, msg.action);
        await this.save();
        this.broadcast();
      }
    } catch (e) {
      const fatal = msg.t === 'hello';
      const message = e instanceof GameError ? e.message : 'Something went wrong';
      if (!(e instanceof GameError)) console.error(e);
      this.send(ws, { t: 'error', message, fatal });
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.serializeAttachment(null);
    await this.load();
    this.broadcast();
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z]{4})$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('Bad code', { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const fwd = new URL(req.url);
      fwd.searchParams.set('code', code);
      return stub.fetch(new Request(fwd, req));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
