# 🇿🇦 Murray's Game

[![CI](https://github.com/mmichelli/Murrays-game/actions/workflows/ci.yml/badge.svg)](https://github.com/mmichelli/Murrays-game/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/mmichelli/Murrays-game/actions/workflows/deploy.yml/badge.svg)](https://github.com/mmichelli/Murrays-game/actions/workflows/deploy.yml)

**A 5-round Fishbowl party game** — the one you might also know as **Celebrity**, **Salad Bowl**, **Monikers** or **the Hat Game**. Built for South African students and named after Murray, the varsity mate who first taught us to play.

Runs entirely peer-to-peer in the browser — **no backend, no accounts, no install.**

▶ **Play it:** https://mmichelli.github.io/Murrays-game/

**What you'll need:** a group of friends, one phone per player with a modern browser (Chrome, Safari, Edge), and everyone on the same WiFi. No app to download — just open the link.

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

To keep clue-giving snappy over the wire, the giver's view also carries a tiny **lookahead buffer** (the next couple of cards, giver-only — never watchers, never the other team). Their phone flips to the next word the instant they tap CORRECT and reconciles to the host afterwards, so latency or a brief blip doesn't stall the turn. It stays purely cosmetic: the host remains the sole authority for scoring and round progression, and the buffer is naturally empty at a round boundary so the host always drives the transition.

### Staying connected

Real phones drop the WebRTC link constantly — backgrounding, screen locks, signal blips. The app is built to ride through it:

- **Stable seats.** Each device keeps a stable per-room id, so a phone that drops, reloads, or backgrounds **reclaims its exact seat** — same team, score, turn and words — instead of rejoining as a stranger.
- **Survives a full page reload.** A refresh tears down the whole JS context, but each tab remembers its role and room in `sessionStorage`, so it silently re-dials and picks up where it left off — no re-typing, no "reload to rejoin". The host keeps the **same room code** (so phones reconnect to the same broker id, even briefly racing its own freed registration) and recovers the **entire in-progress game** — players, teams, bowl, scores, round and timer — via `createHostHub({ initialState })`. A player just remembers their name + code and auto-rejoins.
- **Auto-reconnect.** Clients retry with backoff, instantly on tab-refocus / network-return, and on a silent ICE failure (which doesn't always fire a clean close). A banner with a **Retry now** button shows while it's working.
- **Seats survive drops.** The host marks a dropped player *offline* rather than deleting them; genuine lobby ghosts are pruned only after a grace period, never mid-game. The host also rebuilds its own broker link on a blip.
- **Wall-clock timer.** The turn countdown is driven by real elapsed time, so a locked host screen can't freeze the clock.

### Reliability across networks (STUN / TURN)

WebRTC needs help connecting phones on different networks (mobile data, symmetric NATs). The app ships **STUN + free public TURN relays** ([`ICE` in `src/engine.js`](src/engine.js)) so the data channel can relay when a direct path is blocked.

The free relays are best-effort and can be rate-limited. To drop in **your own dedicated TURN** without a rebuild, set a global before the app loads — e.g. in `index.html`:

```html
<script>
  window.MRYSG_ICE = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:your.turn.example:3478", username: "USER", credential: "PASS" },
  ];
</script>
```

`resolveIce()` picks this up automatically and falls back to the bundled defaults when it's absent.

## Develop

```bash
npm install
npm run dev        # local dev server (also reachable from phones on your WiFi)
npm test           # run the test suite
npm run build      # production build
```

## Tests & CI

The pure game engine and the **entire peer-to-peer message protocol** are unit-tested with [Vitest](https://vitest.dev):

- [`test/engine.test.js`](test/engine.test.js) — the reducer, round progression, scoring, the wall-clock catch-up timer, keep-seat-on-disconnect, per-player word tallies, the word-privacy filter, the signaling codec, and the ICE/peer config.
- [`test/p2p.test.js`](test/p2p.test.js) — drives `createHostHub` over an in-memory loopback of a WebRTC data-channel pair: players connecting, picking groups, **adding and renaming groups, per-group counts and who's-in-which-group snapshots**, adding words (with de-dup and per-person attribution), **a phone dropping and reclaiming its exact seat on reconnect**, and — critically — a test that **proves the secret word never reaches any device except the active clue-giver's**, even over the wire.

Both run automatically in GitHub Actions on every push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), and again before each Pages deploy ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

```bash
npm test
# ✓ test/engine.test.js (23 tests)
# ✓ test/p2p.test.js    (11 tests)
```

## Stack

- React 18 + Vite
- [PeerJS](https://peerjs.com) for one-tap link joining (handshake only) over WebRTC `RTCDataChannel` (Google STUN for NAT traversal)
- `qrcode` for the scan-to-join code
- Vitest for the engine + P2P protocol tests
- GitHub Actions → GitHub Pages for hosting
- No router, no state library, no CSS framework — game logic is one tested module, the UI is one component
