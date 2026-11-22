# Chip Stack

Live poker chip tracker. Play with real cards; everyone's phone holds their chips.

**Play:** https://poker-chip-hands.theonthai.workers.dev/

- Create a game, share the 4-letter code / QR, players join from their phones
- Auto-splits each buy-in into chips; host can change chips, colours, buy-in and blinds in Settings
- **Turn order** (default): blinds, check / call / raise / fold, side pots
- **Free-form**: anyone throws chips anytime, undo last throw
- Tap (or hold) chips to pick them up, then **flick up** anywhere in the chip area to throw; chips follow your finger
- 3D chips (three.js): bevelled chips with a different edge design per denomination, tumbling throws and a pot pile; flat fallback when WebGL is unavailable
- Poker-table look (woven felt, padded rail) with layouts for small and large iPhones, landscape and iPad
- Round tracker (pre-flop to showdown), big announcements for new hands, streets and winners, and dealer / small blind / big blind badges
- Chips are broken into smaller ones automatically, so a player always has small chips to bet with
- Live scores at any time, and a who-pays-who table with a share button when the game ends
- Host can reorder the seats in the lobby or mid-game (a hand in progress keeps its order)
- Drag a chip from a stack into the bet area, as well as tapping or holding
- Sounds for chips, checks, folds, deals, wins and your turn (mute button in the top bar)
- All textures and sounds are generated in code, so there are no third-party assets to license
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

Live at https://poker-chip-hands.theonthai.workers.dev/

## Tests

```bash
npm test
```

## Layout

- `src/shared/` – chip maths and game rules (pure, unit-tested)
- `src/server/` – Worker + one Durable Object per room (WebSockets)
- `src/client/` – React app (`scene.ts` is the three.js chip scene)
