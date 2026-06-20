# 🐟 Fishbowl — rooms

A 5-round Fishbowl party game that runs entirely peer-to-peer in the browser. **No backend.**

One phone opens the **room** (it's the authoritative game engine, timer, and hub). Every other phone connects once via copy-paste WebRTC signaling. Then everyone drops words into a shared bowl in parallel, splits into teams, and plays — the secret word is only ever sent to the device of the player currently giving clues.

## The five rounds

| # | Round | How to give clues |
|---|-------|-------------------|
| 1 | 🎭 Describe | Talk, describe, make sounds and gestures |
| 2 | 🏃 Charades | Full-body mime, no sound |
| 3 | 💬 One Word | Exactly one word per card |
| 4 | ✋ Hands Only | Only your hands show (behind the couch) |
| 5 | 🤨 Face Only | Only your face shows (over the couch) |

Same bowl of words cycles through all five rounds.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. To play across phones, serve over **HTTPS or localhost** and put everyone on the **same WiFi** — WebRTC needs a secure context and a direct path between devices.

- **Host:** "Open a room" → name yourself → set up teams + bowl → connect each player by trading codes → Start.
- **Player:** "Join a room" → generate your join code → read it to the host → paste back their reply code → pick a team and add words.

> Connecting won't work inside a sandboxed chat preview (WebRTC is blocked). Test with two real browser tabs or phones on one network.

## How signaling works

There's no signaling server. Each join is a manual SDP exchange:

1. Player creates an **offer** → encoded as a base64 "join code".
2. Host pastes it, creates an **answer** → base64 "reply code".
3. Player pastes the reply code → the data channel opens.

After that, all game messages (lobby state, per-device views, intents like *claim turn* / *correct* / *resume*) flow over the WebRTC data channel. The host runs the single source of truth and broadcasts a privacy-filtered view to each device so only the active clue-giver ever sees the word.

## Stack

- React 18 + Vite
- WebRTC `RTCDataChannel` for transport (Google STUN for NAT traversal)
- Single self-contained component — no router, no state library, no CSS framework
