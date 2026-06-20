# 🇿🇦 Murray's Game

**A 5-round Fishbowl party game for South African students.** Runs entirely peer-to-peer in the browser — **no backend, no accounts, no install.**

▶ **Play it:** https://mmichelli.github.io/Murrays-game/

One phone opens the **room** (it's the authoritative game engine, timer, and hub). Every other phone connects once via copy-paste WebRTC signaling. Then everyone drops words into a shared bowl in parallel, splits into teams, and plays — the secret word is only ever sent to the device of the player currently giving clues.

Load **Murray's deck** for an instant SA-flavoured bowl: braai, load shedding, hadeda, Madiba, babbelas, the Bokke and more.

## The five rounds

Same bowl of words cycles through all five rounds — it just gets harder:

| # | Round | How to give clues |
|---|-------|-------------------|
| 1 | 🎭 Describe | Talk, describe, make sounds and gestures |
| 2 | 🏃 Charades | Full-body mime, no sound |
| 3 | 💬 One Word | Exactly one word per card |
| 4 | ✋ Hands Only | Only your hands show (behind the couch) |
| 5 | 🤨 Face Only | Only your face shows (over the couch) |

## How to play

- **Host:** "Open a room" → name yourself → set up teams + bowl (tap *Load Murray's deck*) → connect each player by trading codes → Start.
- **Player:** "Join a room" → generate your join code → read it to the host → paste back their reply code → pick a team and add words.

The live site is served over HTTPS, so WebRTC works straight from your phones — just get everyone on the same WiFi for the most reliable connection.

## How the P2P networking works

There's **no signaling server**. Each join is a manual SDP exchange:

1. Player creates an **offer** → base64 "join code".
2. Host pastes it, creates an **answer** → base64 "reply code".
3. Player pastes the reply code → the WebRTC data channel opens.

After that, all game traffic flows over the data channel. The host (`createHostHub` in [`src/engine.js`](src/engine.js)) runs the single source of truth and broadcasts a **privacy-filtered view** to each device, so only the active clue-giver ever sees the word. Players send only *intents* (`claim turn`, `correct`, `resume`) — the host validates and applies them.

## Develop

```bash
npm install
npm run dev        # local dev server (also reachable from phones on your WiFi)
npm test           # run the test suite
npm run build      # production build
```

## Tests & CI

The pure game engine and the **entire peer-to-peer message protocol** are unit-tested with [Vitest](https://vitest.dev):

- [`test/engine.test.js`](test/engine.test.js) — the reducer, round progression, scoring, the word-privacy filter, and the signaling codec.
- [`test/p2p.test.js`](test/p2p.test.js) — drives `createHostHub` over an in-memory loopback of a WebRTC data-channel pair: players connecting, picking teams, adding words (with de-dup), disconnecting, and — critically — a test that **proves the secret word never reaches any device except the active clue-giver's**, even over the wire.

Both run automatically in GitHub Actions on every push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), and again before each Pages deploy ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

```bash
npm test
# ✓ test/engine.test.js (16 tests)
# ✓ test/p2p.test.js    (7 tests)
```

## Stack

- React 18 + Vite
- WebRTC `RTCDataChannel` for transport (Google STUN for NAT traversal)
- Vitest for the engine + P2P protocol tests
- GitHub Actions → GitHub Pages for hosting
- No router, no state library, no CSS framework — game logic is one tested module, the UI is one component
