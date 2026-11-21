# Chip Stack

Live poker chip tracker. Play with real cards; everyone's phone holds their chips.

- Create a game, share the 4-letter code / QR, players join from their phones
- Auto-splits each buy-in into chips; host can change chips, colours, buy-in and blinds in Settings
- **Turn order** (default): blinds, check / call / raise / fold, side pots
- **Free-form**: anyone throws chips anytime, undo last throw
- Tap chips to pick them up, **swipe up to throw** into the pot
- Winner claims the pot, others confirm (host can confirm for all)
- Late joiners and rebuys with any buy-in amount, approved by the host
- End game shows who pays whom

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. To test with phones on the same Wi-Fi: `npm run dev -- --host`.

## Deploy (free, Cloudflare Workers)

Uses Workers + Durable Objects, both on Cloudflare's free plan. Rooms are deleted 3 days after the last action.

```bash
npx wrangler login
```

```bash
npm run deploy
```

You get a URL like `https://poker-chip-hands.<you>.workers.dev`.

## Tests

```bash
npm test
```

## Layout

- `src/shared/` – chip maths and game rules (pure, unit-tested)
- `src/server/` – Worker + one Durable Object per room (WebSockets)
- `src/client/` – React app
