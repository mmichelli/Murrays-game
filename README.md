# 🇿🇦 Murray's Game

**A 5-round Fishbowl party game for South African students.** Runs entirely peer-to-peer in the browser — **no backend, no accounts, no install.**

▶ **Play it:** https://mmichelli.github.io/Murrays-game/

One phone opens the **room** (it's the authoritative game engine, timer, and hub) and gets a **shareable link + QR code**. Everyone else just scans or taps the link to join — no codes to copy. Then everyone drops words into a shared bowl in parallel, organises into groups, and plays — the secret word is only ever sent to the device of the player currently giving clues.

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

- **Host:** "Open a room" → name yourself → show the **QR / link** so everyone can join → tap *Load Murray's deck* → Start.
- **Player:** scan the QR or open the link → type your name → you're in. Anyone can **see every group's live count and who's in it, add a group, or rename one**, then join a group and add words.

The live site is served over HTTPS, so WebRTC works straight from your phones — just get everyone on the same WiFi for the most reliable connection.

## How the P2P networking works

Joining is a **one-tap shareable link** (`?room=CODE`). A free public [PeerJS](https://peerjs.com) broker handles **only the WebRTC handshake** — it never sees any game data. The moment two phones are introduced, a direct `RTCDataChannel` opens and everything (words included) flows peer-to-peer, so the word-privacy guarantee is unchanged.

The host (`createHostHub` in [`src/engine.js`](src/engine.js)) runs the single source of truth and broadcasts a **privacy-filtered view** to each device, so only the active clue-giver ever sees the word. Players send only *intents* (`claim turn`, `correct`, `resume`) and lobby actions (`set group`, `add group`, `rename group`, `add words`) — the host validates and applies them. The SDP signaling codec and in-memory loopback tests still cover the channel-level protocol regardless of how the handshake is brokered.

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
- [`test/p2p.test.js`](test/p2p.test.js) — drives `createHostHub` over an in-memory loopback of a WebRTC data-channel pair: players connecting, picking groups, **adding and renaming groups, per-group counts and who's-in-which-group snapshots**, adding words (with de-dup), disconnecting, and — critically — a test that **proves the secret word never reaches any device except the active clue-giver's**, even over the wire.

Both run automatically in GitHub Actions on every push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), and again before each Pages deploy ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

```bash
npm test
# ✓ test/engine.test.js (16 tests)
# ✓ test/p2p.test.js    (9 tests)
```

## Stack

- React 18 + Vite
- [PeerJS](https://peerjs.com) for one-tap link joining (handshake only) over WebRTC `RTCDataChannel` (Google STUN for NAT traversal)
- `qrcode` for the scan-to-join code
- Vitest for the engine + P2P protocol tests
- GitHub Actions → GitHub Pages for hosting
- No router, no state library, no CSS framework — game logic is one tested module, the UI is one component
