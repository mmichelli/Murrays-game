/* ================================================================== *
 * MURRAY'S GAME — pure game engine + P2P hub (no React, no DOM).
 *
 * Everything here is framework-agnostic so it can be unit-tested in
 * Node and reused by the React UI. The host runs `createHostHub`,
 * which is the single source of truth: it owns the reducer state,
 * broadcasts a privacy-filtered view to every connected device, and
 * processes the messages players send over their WebRTC data channel.
 * ================================================================== */

export const ROUNDS = [
  { n: 1, name: "Describe",   icon: "🎭", setup: "Stand in front of your team.",
    allowed: "Sentences, descriptions, sounds, gestures.", restrict: "Don't say the word, parts of it, or rhymes.", accent: "#FF6A3D" },
  { n: 2, name: "Charades",   icon: "🏃", setup: "Stand in front of your team.",
    allowed: "Full-body acting and miming.", restrict: "Silence. No speaking, whispering or mouthing.", accent: "#2C6EE6" },
  { n: 3, name: "One Word",   icon: "💬", setup: "Stand in front of your team.",
    allowed: "Exactly one word, total, per card.", restrict: "Repeat it, but never change it or gesture.", accent: "#E8348B" },
  { n: 4, name: "Hands Only", icon: "✋", setup: "Behind the couch — only hands show.",
    allowed: "Fingers, hands and forearms.", restrict: "Silence. Head, face, torso, legs hidden.", accent: "#1AA67E" },
  { n: 5, name: "Face Only",  icon: "🤨", setup: "Peek over the couch — only your face.",
    allowed: "Eyes, brows, nose, mouth, head tilts.", restrict: "Silence. Neck down stays hidden.", accent: "#7A4DE0" },
];
export const PALETTE = ["#2C6EE6", "#E8348B", "#1AA67E", "#7A4DE0", "#FF6A3D", "#0E8C9B"];
export const MIN_WORDS = 4, MAX_TEAMS = 6, TURN_SECONDS = 60;
// How many upcoming cards the active clue-giver's device may hold, so a tap
// flips instantly and a brief connection blip doesn't stall the turn. The
// buffer lives ONLY in the active giver's view — never any other device.
export const LOOKAHEAD = 2;
// Soft per-player target: everyone aims to drop this many words in the bowl.
// It's a goal with progress, not a hard gate — the host can start whenever
// there are enough words to actually play.
export const WORDS_PER_PLAYER = 4;

// Murray's deck — South African student / varsity culture. Lekker, actable
// across all five rounds, and recognizable to anyone who's survived res,
// load shedding and a Friday jol. Kept broadly kid-safe. Big on purpose so
// the bowl stays fresh game after game; players still add their own on top.
export const MURRAY_DECK = [
  // braai & kos
  "Braai", "Boerewors", "Biltong", "Pap en wors", "Chakalaka", "Koeksister", "Bunny chow", "Vetkoek",
  "Melktert", "Gatsby", "Droëwors", "Bobotie", "Potjiekos", "Sosatie", "Snoek", "Samp",
  "Morogo", "Walkie talkies", "Smiley", "Kota", "Magwinya", "Peppermint crisp tart", "Rusks",
  "Niknaks", "Simba chips", "Mrs Ball's chutney", "Boerewors roll", "Shisanyama",
  // drinks
  "Rooibos", "Mageu", "Amarula", "Oros", "Stoney", "Creme soda", "Appletiser", "Castle Lager",
  "Klipdrift", "Savanna", "Rock shandy", "Springbokkie", "Milo",
  // varsity life
  "Res", "NSFAS", "Digs", "All-nighter", "Cramming", "Past papers", "Group project",
  "Supp exam", "Graduation", "Stipend", "Bursary", "Lecture hall", "Tutorial", "Campus",
  "Babbelas", "Jol", "Dop", "Pre-drinks", "Padkos", "Hangover",
  // slang & expressions
  "Howzit", "Lekker", "Eish", "Shame", "Sharp sharp", "Just now", "Now now", "Boet",
  "China", "Skinner", "Voetsek", "Aweh", "Kiff", "Yoh", "Sho't left", "Hayibo",
  "Yebo", "Sawubona", "Mzansi", "Tannie", "Oom", "Bru", "Hectic", "Sjoe",
  // people & icons
  "Madiba", "Desmond Tutu", "Trevor Noah", "Charlize Theron", "Elon Musk", "Siya Kolisi",
  "Caster Semenya", "Black Coffee", "Nasty C", "Tyla", "Master KG", "Miriam Makeba",
  "Brenda Fassie", "Hugh Masekela", "Johnny Clegg", "Lucky Dube", "AB de Villiers",
  "Gary Player", "John Kani", "Bafana Bafana", "The Bokke",
  // music & dance
  "Amapiano", "Kwaito", "Gqom", "Vuvuzela", "Gumboot dance", "Toyi-toyi", "Jerusalema",
  "Pantsula", "Maskandi", "Cassper Nyovest", "Mafikizolo",
  // places & landmarks
  "Table Mountain", "Kruger Park", "Robben Island", "Long Street", "Soweto", "Drakensberg",
  "Cape Town", "Joburg", "Durban", "Pretoria", "V&A Waterfront", "Garden Route", "Karoo",
  "Kirstenbosch", "Boulders Beach", "God's Window", "Sun City", "Wild Coast", "Sandton",
  "Stellenbosch", "Knysna", "Soccer City", "Vilakazi Street",
  // critters
  "Hadeda", "Dassie", "Meerkat", "Warthog", "Honey badger", "Rhino", "Vervet monkey",
  "Springbok", "Lion", "Elephant", "Leopard", "Buffalo", "Cheetah", "Giraffe", "Zebra",
  "Hippo", "Crocodile", "Penguin", "Ostrich", "Kudu", "Impala", "Baboon", "Black mamba",
  "Guinea fowl", "Tortoise", "Big Five",
  // sport & doen
  "Rugby", "Cricket", "Jukskei", "Sevens", "Soccer", "Netball", "Comrades Marathon",
  "Two Oceans", "Cape Town Cycle Tour", "Proteas", "Currie Cup", "Scrum", "Surfing", "Fishing",
  // load shedding & everyday
  "Load shedding", "Eskom", "Gautrain", "Minibus taxi", "Bakkie", "Robot", "Geyser",
  "Stage 6", "Inverter", "Generator", "Prepaid electricity", "Pothole", "Toll gate",
  "Spaza shop", "Car guard", "Petrol attendant", "Burglar bars", "Boom gate",
  "Takkies", "Slip slops", "Cooldrink", "Sarmie",
  // culture & society
  "Stokvel", "Rand", "Lobola", "Ubuntu", "Heritage Day", "Braai Day", "Freedom Day",
  "Youth Day", "Rainbow Nation", "Gogo", "Sangoma",
  // brands & shops
  "Nando's", "Spur", "Steers", "Wimpy", "Checkers", "Pick n Pay", "Woolworths", "Shoprite",
  "Takealot", "Capitec", "Vodacom", "MTN",
];

// ICE servers handed to WebRTC. STUN alone only works when at least one peer
// is directly reachable — between two phones on mobile data or behind
// symmetric NATs it silently fails. The TURN relays let the data channel fall
// back to relaying, which is what makes real phone-to-phone games connect.
export const ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];
// Resolve the ICE servers to use. A page can set `globalThis.MRYSG_ICE` to a
// list of RTCIceServers (e.g. a dedicated TURN credential) to override the
// free defaults at runtime — no rebuild or redeploy needed.
export function resolveIce() {
  const o = typeof globalThis !== "undefined" ? globalThis.MRYSG_ICE : null;
  return Array.isArray(o) && o.length ? o : ICE;
}
// Single source of truth for how we open a PeerJS peer — every `new Peer`
// MUST go through this so the ICE servers above actually get used.
export const peerOptions = (extra = {}) => ({ debug: 1, config: { iceServers: resolveIce() }, ...extra });

export const uid = () => Math.random().toString(36).slice(2, 8);
export const shuffle = (a0) => { const a = [...a0]; for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
// Deal a fresh, random handful from Murray's deck — used to top a player up
// to their target rather than dumping all ~225 words into the bowl at once.
export const sampleDeck = (n = WORDS_PER_PLAYER) => shuffle(MURRAY_DECK).slice(0, Math.max(0, n));
// Host-only bowl padding: up to n words from Murray's deck that aren't already
// in `bowl` (case-insensitive), shuffled. Lets the host fill a thin bowl
// straight from the library instead of waiting on players to add their share.
export const deckTopUp = (bowl = [], n = WORDS_PER_PLAYER) => {
  const have = new Set(bowl.map((w) => String(w).toLowerCase()));
  return shuffle(MURRAY_DECK.filter((w) => !have.has(w.toLowerCase()))).slice(0, Math.max(0, n));
};
const zeros = (teams) => Object.fromEntries(teams.map((t) => [t.id, [0, 0, 0, 0, 0]]));

// Signaling helpers. We pass plain RTCSessionDescriptionInit objects
// ({type, sdp}) — every modern browser accepts these directly in
// setLocal/RemoteDescription, and it keeps encode/decode testable in Node.
export const encode = (d) => btoa(JSON.stringify({ type: d.type, sdp: d.sdp }));
export const decode = (c) => JSON.parse(atob(c.trim()));
export const waitIce = (pc) => pc.iceGatheringState === "complete" ? Promise.resolve()
  : new Promise((res) => { const d = () => { pc.removeEventListener("icegatheringstatechange", c); res(); }; const c = () => pc.iceGatheringState === "complete" && d(); pc.addEventListener("icegatheringstatechange", c); setTimeout(d, 3000); });

/* ----------------------- authoritative engine --------------------- */
const teamPlayers = (s, idx) => s.players.filter((p) => p.teamId === s.teams[idx]?.id);
function advanceTurn(s, keepCard) {
  let idx = s.activeTeamIdx, tries = 0;
  do { idx = (idx + 1) % s.teams.length; tries++; } while (teamPlayers(s, idx).length === 0 && tries <= s.teams.length);
  if (teamPlayers(s, idx).length === 0) return { ...s, phase: "endgame", running: false };
  return { ...s, activeTeamIdx: idx, activePlayerId: null, phase: "ready", running: false, timeLeft: 0,
    activeCard: keepCard ? s.activeCard : null, turnNumber: s.turnNumber + 1 };
}
function resolveDeckEmpty(s) {
  if (s.currentRound >= 5) return { ...s, phase: "endgame", running: false, activeCard: null };
  return { ...s, deck: shuffle(s.discard), discard: [], activeCard: null, currentRound: s.currentRound + 1,
    lastCompleted: s.currentRound, phase: "transition", running: false };
}

export const initial = {
  phase: "lobby", teams: [], players: [], bowl: [], wordCounts: {},
  deck: [], discard: [], activeCard: null,
  currentRound: 1, activeTeamIdx: 0, activePlayerId: null,
  timeLeft: TURN_SECONDS, running: false, scores: {}, turnNumber: 1, lastCompleted: 0,
};

export function reducer(state, a) {
  switch (a.type) {
    case "ADD_TEAM": return state.teams.length >= MAX_TEAMS ? state
      : { ...state, teams: [...state.teams, { id: uid(), name: `Team ${state.teams.length + 1}` }] };
    case "REMOVE_TEAM": return state.teams.length <= 2 ? state
      : { ...state, teams: state.teams.filter((t) => t.id !== a.id),
          players: state.players.map((p) => p.teamId === a.id ? { ...p, teamId: null } : p) };
    case "RENAME_TEAM": return { ...state, teams: state.teams.map((t) => t.id === a.id ? { ...t, name: a.name } : t) };
    case "ADD_PLAYER": return state.players.some((p) => p.id === a.player.id) ? state
      : { ...state, players: [...state.players, { connected: true, ...a.player }] };
    case "REMOVE_PLAYER": {
      const { [a.id]: _gone, ...wordCounts } = state.wordCounts;
      return { ...state, players: state.players.filter((p) => p.id !== a.id), wordCounts };
    }
    // A dropped phone keeps its seat (team, score, words) so a quick
    // backgrounding or signal blip never unravels the game. We only flip a
    // flag; the React host prunes long-gone lobby ghosts on a grace timer.
    case "SET_CONNECTED": return { ...state, players: state.players.map((p) => p.id === a.id ? { ...p, connected: a.connected } : p) };
    case "SET_TEAM": return { ...state, players: state.players.map((p) => p.id === a.id ? { ...p, teamId: a.teamId } : p) };
    case "ADD_WORDS": {
      const have = new Set(state.bowl.map((w) => w.toLowerCase()));
      const add = [];
      for (const w0 of a.words) { const w = w0.trim(); if (w && !have.has(w.toLowerCase())) { have.add(w.toLowerCase()); add.push(w); } }
      if (!add.length) return state;
      const wordCounts = a.by
        ? { ...state.wordCounts, [a.by]: (state.wordCounts[a.by] || 0) + add.length }
        : state.wordCounts;
      return { ...state, bowl: [...state.bowl, ...add], wordCounts };
    }

    case "START_GAME": {
      const teams = state.teams.map((t, i) => ({ ...t, color: PALETTE[i % PALETTE.length] }));
      const first = teams.findIndex((t) => state.players.some((p) => p.teamId === t.id));
      return { ...state, teams, phase: "ready", deck: shuffle(state.bowl), discard: [], activeCard: null,
        currentRound: 1, activeTeamIdx: first < 0 ? 0 : first, activePlayerId: null,
        scores: zeros(teams), timeLeft: TURN_SECONDS, running: false, turnNumber: 1, lastCompleted: 0 };
    }

    case "CLAIM_AND_BEGIN": {
      if (state.phase !== "ready" || state.activePlayerId) return state;
      const me = state.players.find((p) => p.id === a.fromId);
      if (!me || me.teamId !== state.teams[state.activeTeamIdx].id) return state;
      let { deck, activeCard } = state;
      if (!activeCard && deck.length) { activeCard = deck[0]; deck = deck.slice(1); }
      return { ...state, activePlayerId: a.fromId, phase: "play", running: true, timeLeft: TURN_SECONDS, deck, activeCard };
    }

    case "CORRECT": {
      if (state.phase !== "play" || !state.running || !state.activeCard || a.fromId !== state.activePlayerId) return state;
      const id = state.teams[state.activeTeamIdx].id;
      const scores = { ...state.scores, [id]: state.scores[id].map((v, i) => i === state.currentRound - 1 ? v + 1 : v) };
      const discard = [...state.discard, state.activeCard];
      if (state.deck.length === 0) return resolveDeckEmpty({ ...state, scores, discard, activeCard: null });
      return { ...state, scores, discard, activeCard: state.deck[0], deck: state.deck.slice(1) };
    }

    case "TICK": {
      if (!state.running) return state;
      // `seconds` lets the host reconcile against the wall clock — if its
      // phone throttled or paused timers (screen lock, backgrounding), one
      // catch-up TICK drains the real elapsed time instead of a single second.
      const t = state.timeLeft - Math.max(1, Math.floor(a.seconds || 1));
      if (t > 0) return { ...state, timeLeft: t };
      return advanceTurn({ ...state, timeLeft: 0 }, true);
    }
    case "RESUME": {
      if (state.phase !== "transition" || a.fromId !== state.activePlayerId) return state;
      let { deck } = state, activeCard = null;
      if (deck.length) { activeCard = deck[0]; deck = deck.slice(1); }
      return { ...state, phase: "play", running: true, deck, activeCard };
    }
    case "FORCE_NEXT": return ["ready", "play", "transition"].includes(state.phase) ? advanceTurn({ ...state, running: false }, false) : state;
    case "END_GAME": return { ...state, phase: "endgame", running: false };
    case "PLAY_AGAIN": {
      const first = state.teams.findIndex((t) => state.players.some((p) => p.teamId === t.id));
      return { ...state, phase: "ready", deck: shuffle(state.bowl), discard: [], activeCard: null, currentRound: 1,
        activeTeamIdx: first < 0 ? 0 : first, activePlayerId: null, scores: zeros(state.teams),
        timeLeft: TURN_SECONDS, running: false, turnNumber: 1, lastCompleted: 0 };
    }
    default: return state;
  }
}

/* privacy filter — exactly what one device may see */
export function viewFor(s, pid) {
  const r = ROUNDS[s.currentRound - 1];
  const me = s.players.find((p) => p.id === pid);
  const up = s.teams[s.activeTeamIdx];
  const isActive = s.activePlayerId === pid;
  const myTeamUp = me && up && me.teamId === up.id;
  return {
    phase: s.phase, round: r && { ...r }, teams: s.teams,
    teamUpId: up?.id, teamUpName: up?.name, teamUpColor: up?.color,
    activeName: s.players.find((p) => p.id === s.activePlayerId)?.name || "",
    timeLeft: s.timeLeft, running: s.running, scores: s.scores, turnNumber: s.turnNumber,
    myTeamId: me?.teamId, isActive,
    canClaim: s.phase === "ready" && !s.activePlayerId && myTeamUp,
    canCorrect: s.phase === "play" && s.running && isActive && !!s.activeCard,
    canResume: s.phase === "transition" && isActive,
    word: isActive && s.phase === "play" ? s.activeCard : null,
    // Lookahead buffer — active giver only. Lets their phone flip instantly on
    // CORRECT and ride out a short drop. Empty near a round boundary (deck low),
    // so the client falls back to the host's authoritative transition there.
    nextWords: isActive && s.phase === "play" ? s.deck.slice(0, LOOKAHEAD) : [],
    inherited: myTeamUp && s.phase === "ready" && !s.activePlayerId && !!s.activeCard && s.turnNumber > 1,
  };
}
export const lobbyFor = (s, pid) => ({
  teams: s.teams.map((t, i) => ({
    id: t.id, name: t.name, color: PALETTE[i % PALETTE.length],
    count: s.players.filter((p) => p.teamId === t.id).length,
  })),
  bowlCount: s.bowl.length, started: s.phase !== "lobby", youId: pid,
  maxTeams: MAX_TEAMS, minWords: MIN_WORDS, wordsPerPlayer: WORDS_PER_PLAYER,
  roster: s.players.map((p) => ({
    id: p.id, name: p.name, teamId: p.teamId, isHost: !!p.isHost,
    connected: p.connected !== false, words: s.wordCounts[p.id] || 0,
  })),
});

/* ------------------------ P2P host hub ---------------------------- *
 * Owns the authoritative state, the connected channels, and the
 * message protocol. The React host wraps this; tests drive it with
 * in-memory channels. A "channel" is anything WebRTC-shaped:
 *   { readyState, send(str), onmessage(ev), onclose() }  plus a
 *   private `_pid` we stamp on once the player says hello.
 * ------------------------------------------------------------------ */
export function createHostHub({ onState, initialState } = {}) {
  // Rehydrate from a persisted snapshot when the host reloads, so an
  // in-progress game (players, teams, bowl, scores, round, timer) is recovered
  // and reconnecting phones rejoin the same game rather than an empty lobby.
  let state = initialState || initial;
  const channels = new Map(); // pid -> channel

  const send = (ch, obj) => { if (ch && ch.readyState === "open") { try { ch.send(JSON.stringify(obj)); } catch {} } };
  const snapshotFor = (pid) => state.phase === "lobby"
    ? { t: "lobby", lobby: lobbyFor(state, pid) }
    : { t: "view", view: viewFor(state, pid) };

  function broadcast() { channels.forEach((ch, pid) => send(ch, snapshotFor(pid))); }

  function dispatch(action) {
    const next = reducer(state, action);
    if (next === state) return state;
    state = next;
    broadcast();
    onState?.(state);
    return state;
  }

  function handle(ch, m) {
    if (m.t === "hello") {
      // The client owns a stable id (cid) that survives reconnects, so a
      // phone that drops and comes back reclaims its exact seat instead of
      // joining as a fresh stranger. Fall back to a minted id for old clients.
      const pid = (typeof m.cid === "string" && m.cid) ? m.cid : uid();
      const existing = state.players.find((p) => p.id === pid);
      channels.set(pid, ch); ch._pid = pid;
      send(ch, { t: "welcome", youId: pid });
      if (existing) dispatch({ type: "SET_CONNECTED", id: pid, connected: true });
      else dispatch({ type: "ADD_PLAYER", player: { id: pid, name: m.name || "Player", teamId: null } });
      send(ch, snapshotFor(pid)); // resume them even if the dispatch was a no-op
    } else if (m.t === "setTeam" && ch._pid) {
      dispatch({ type: "SET_TEAM", id: ch._pid, teamId: m.teamId });
    } else if (m.t === "addTeam" && ch._pid) {
      dispatch({ type: "ADD_TEAM" });
    } else if (m.t === "renameTeam" && ch._pid) {
      dispatch({ type: "RENAME_TEAM", id: m.id, name: (m.name || "").slice(0, 16) });
    } else if (m.t === "words" && ch._pid) {
      dispatch({ type: "ADD_WORDS", words: m.words || [], by: ch._pid });
    } else if (m.t === "intent" && ch._pid) {
      dispatch({ type: m.action, fromId: ch._pid });
    }
  }

  // Attach a freshly opened data channel (or any channel-shaped object).
  function attach(ch) {
    ch.onmessage = (e) => { try { handle(ch, JSON.parse(e.data)); } catch {} };
    ch.onclose = () => {
      // Only react if this is still the live channel for the seat — a
      // reconnect swaps in a new channel, and we don't want the old one's
      // late close to knock the player back offline.
      if (ch._pid && channels.get(ch._pid) === ch) {
        channels.delete(ch._pid);
        dispatch({ type: "SET_CONNECTED", id: ch._pid, connected: false });
      }
    };
    return ch;
  }

  return {
    attach,
    dispatch,
    getState: () => state,
    channelCount: () => channels.size,
  };
}
