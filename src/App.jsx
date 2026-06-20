import React, { useReducer, useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  ROUNDS, PALETTE, MIN_WORDS, MAX_TEAMS, TURN_SECONDS, WORDS_PER_PLAYER, sampleDeck,
  uid, initial, viewFor, createHostHub, peerOptions,
} from "./engine.js";

/* ================================================================== *
 * MURRAY'S GAME — a 5-round Fishbowl for South African students.
 * P2P rooms, no backend.
 *
 * One HOST phone is the room (authoritative engine + timer + hub).
 * Every other phone connects once (copy-paste signaling), then:
 *   - all phones add words to the shared bowl in PARALLEL
 *   - N teams
 *   - on each turn, ONE phone per team claims the word + CORRECT button
 * The word is only ever sent to the active clue-giver's device.
 *
 * Visual identity: risograph party-flyer on paper stock. The secret
 * word arrives as a torn paper slip with a colored misregistration
 * ghost in the round's ink.
 *
 * Pure game logic + the P2P host hub live in ./engine.js (unit-tested).
 *
 * Test P2P with two browser tabs, or phones on one WiFi served over
 * https / localhost (WebRTC needs a secure context).
 * ================================================================== */

/* ----------------------- link-join plumbing ----------------------- *
 * The room is reached by a shareable link (?room=CODE) instead of
 * copy-pasting SDP blobs. PeerJS brokers ONLY the WebRTC handshake;
 * once connected, game data — words included — flows directly phone
 * to phone, so the word-privacy guarantee is unchanged.
 * ------------------------------------------------------------------ */
const PEER_PREFIX = "mrysg-"; // namespaces our room ids on the shared broker
const peerIdFor = (code) => PEER_PREFIX + String(code).trim().toLowerCase();
// Human-friendly code, ambiguous characters (0/o/1/l/i) left out.
function makeRoomCode() {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += a[(Math.random() * a.length) | 0];
  return s;
}
function roomLinkFor(code) {
  const u = new URL(window.location.href);
  u.search = ""; u.hash = "";
  u.searchParams.set("room", code);
  return u.toString();
}
function readRoomParam() {
  try { return new URL(window.location.href).searchParams.get("room") || ""; } catch { return ""; }
}
// A stable per-room identity for this device, persisted so a reload or a
// dropped-and-restored connection rejoins as the SAME player — keeping the
// team, score and turn the host already has for us. Keyed by room so joining
// a different room is a clean slate.
function stableClientId(code) {
  const key = "mrysg-cid-" + String(code).trim().toLowerCase();
  try {
    let v = localStorage.getItem(key);
    if (!v) { v = uid() + uid() + uid(); localStorage.setItem(key, v); }
    return v;
  } catch { return uid() + uid() + uid(); }
}
// Adapt a PeerJS DataConnection to the channel shape the host hub speaks:
// { readyState, send(str), onmessage(ev), onclose() }.
function peerChannel(conn) {
  const ch = {
    get readyState() { return conn.open ? "open" : "connecting"; },
    send: (s) => { try { conn.send(s); } catch {} },
  };
  conn.on("data", (d) => ch.onmessage && ch.onmessage({ data: d }));
  conn.on("close", () => ch.onclose && ch.onclose());
  conn.on("error", () => ch.onclose && ch.onclose());
  // Phones often drop the WebRTC link without a clean close (backgrounding,
  // signal loss). Catch the ICE failure so the host marks them offline and
  // frees the seat for their reconnect instead of holding a dead channel.
  conn.on("iceStateChanged", (st) => { if (st === "failed" || st === "closed") ch.onclose && ch.onclose(); });
  return ch;
}

/* ============================== APP ============================== */
export default function App() {
  const initialRoom = useRef(readRoomParam()).current;
  const [role, setRole] = useState(initialRoom ? "client" : null);
  return (
    <div className="fb-root" style={{ "--accent": "#FF6A3D" }}>
      <style>{CSS}</style>
      <div className="fb-shell">
        <div className="fb-brand">🇿🇦 MURRAY'S GAME</div>
        {role && <div className="fb-topbackwrap"><button className="fb-topback" onClick={() => setRole(null)}>← Leave to start</button></div>}
        {!role && <Landing onPick={setRole} />}
        {role === "host" && <HostApp onExit={() => setRole(null)} />}
        {role === "client" && <ClientApp onExit={() => setRole(null)} initialRoom={initialRoom} />}
      </div>
    </div>
  );
}
function Landing({ onPick }) {
  return (
    <div className="fb-card fb-stack fb-center">
      <div className="fb-sliprow" aria-hidden="true"><span>praat</span><span>mime</span><span>loer</span></div>
      <h1 className="fb-h1 fb-xl">Five rounds.<br />One bowl.</h1>
      <p className="fb-muted">The party game you might know as <b>Fishbowl</b>, <b>Celebrity</b>, <b>Salad Bowl</b>, <b>Monikers</b> or <b>the Hat Game</b>. Everyone scribbles words into one bowl, then teams race to make each other guess them — same words, five rounds, each one harder than the last.</p>
      <button className="fb-btn" onClick={() => onPick("host")}>Open a room</button>
      <button className="fb-btn fb-ghost" onClick={() => onPick("client")}>Join a room</button>
      <p className="fb-tiny">Named after Murray — the varsity mate who first taught us to play.</p>
    </div>
  );
}

/* ============================== HOST ============================== */
function HostApp({ onExit }) {
  const hostId = useRef(uid()).current;
  const roomCode = useRef(makeRoomCode()).current;
  const [state, setState] = useState(initial);
  const hubRef = useRef(null);
  if (!hubRef.current) hubRef.current = createHostHub({ onState: setState });
  const hub = hubRef.current;
  const dispatch = useCallback((a) => hub.dispatch(a), [hub]);

  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [peerStatus, setPeerStatus] = useState("connecting"); // connecting | online | error
  const peerRef = useRef(null);

  const view = useMemo(() => viewFor(state, hostId), [state, hostId]);

  // Host is the authoritative timer, driven by the wall clock so a screen
  // lock or backgrounded tab (which throttles/pauses setInterval) doesn't
  // freeze the countdown — each tick drains the real seconds elapsed, and we
  // reconcile the instant the tab is shown again.
  const lastTickRef = useRef(0);
  useEffect(() => {
    if (!state.running) return;
    lastTickRef.current = Date.now();
    const tick = () => {
      const now = Date.now();
      const seconds = Math.max(1, Math.round((now - lastTickRef.current) / 1000));
      lastTickRef.current = now;
      dispatch({ type: "TICK", seconds });
    };
    const id = setInterval(tick, 1000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [state.running, dispatch]);
  useEffect(() => {
    const onKey = (e) => { if (e.code === "Space" && view.canCorrect) { e.preventDefault(); dispatch({ type: "CORRECT", fromId: hostId }); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [view.canCorrect, hostId, dispatch]);

  // Once the room is open, claim our room id on the broker and accept
  // every phone that connects to the shared link. A broker blip (network,
  // server or socket trouble) rebuilds the peer with backoff instead of
  // hanging the host on "connecting" forever; only a genuinely fatal problem
  // (the code is taken, or the browser can't do WebRTC) shows a dead end.
  useEffect(() => {
    if (!open) return;
    let peer, cancelled = false, retry = 0, timer = null;
    const FATAL = ["unavailable-id", "invalid-id", "invalid-key", "browser-incompatible", "ssl-unavailable"];
    const spinUp = async () => {
      const { default: Peer } = await import("peerjs");
      if (cancelled) return;
      peer = new Peer(peerIdFor(roomCode), peerOptions());
      peerRef.current = peer;
      peer.on("open", () => { retry = 0; setPeerStatus("online"); });
      peer.on("connection", (conn) => hub.attach(peerChannel(conn)));
      // If the host phone backgrounds, the broker link can drop. Reclaim it
      // (same room id) so players' reconnect attempts find the room again.
      peer.on("disconnected", () => { if (!cancelled) { setPeerStatus("connecting"); try { peer.reconnect(); } catch {} } });
      peer.on("error", (err) => {
        if (FATAL.includes(err?.type)) { setPeerStatus("error"); return; }
        if (cancelled) return;
        setPeerStatus("connecting");
        try { peer.destroy(); } catch {}
        clearTimeout(timer);
        timer = setTimeout(() => { if (!cancelled) spinUp(); }, Math.min(1000 * 2 ** Math.min(retry++, 4), 16000));
      });
    };
    spinUp();
    return () => { cancelled = true; clearTimeout(timer); try { peer && peer.destroy(); } catch {} };
  }, [open, roomCode, hub]);

  // Prune phones that have stayed gone for a while — but only in the lobby.
  // Mid-game a disconnected player keeps their seat (team, score, turn) so a
  // blip or screen change never corrupts the round; they reclaim it on return.
  const pruneTimers = useRef(new Map());
  useEffect(() => {
    const timers = pruneTimers.current;
    if (state.phase !== "lobby") { timers.forEach(clearTimeout); timers.clear(); return; }
    const live = new Set(state.players.map((p) => p.id));
    state.players.forEach((p) => {
      const ghost = !p.isHost && p.connected === false;
      if (ghost && !timers.has(p.id)) {
        timers.set(p.id, setTimeout(() => { timers.delete(p.id); dispatch({ type: "REMOVE_PLAYER", id: p.id }); }, 30000));
      } else if (!ghost && timers.has(p.id)) {
        clearTimeout(timers.get(p.id)); timers.delete(p.id);
      }
    });
    timers.forEach((t, id) => { if (!live.has(id)) { clearTimeout(t); timers.delete(id); } });
  }, [state.players, state.phase, dispatch]);

  const openRoom = () => {
    if (!name.trim()) return;
    dispatch({ type: "ADD_TEAM" });
    dispatch({ type: "ADD_TEAM" });
    const first = hub.getState().teams[0]?.id;
    dispatch({ type: "ADD_PLAYER", player: { id: hostId, name: name.trim(), teamId: first, isHost: true } });
    setOpen(true);
  };

  if (state.phase === "lobby") {
    return open
      ? <HostLobby state={state} dispatch={dispatch} hostId={hostId} roomCode={roomCode} peerStatus={peerStatus} onExit={onExit} />
      : (
        <div className="fb-card fb-stack">
          <h1 className="fb-h1">You're hosting</h1>
          <label className="fb-label">Your name<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
          <button className="fb-btn" disabled={!name.trim()} onClick={openRoom}>Open the room</button>
          <button className="fb-btn fb-ghost" onClick={onExit}>Back</button>
        </div>
      );
  }
  return (<>
    <GameView view={view} onIntent={(action) => dispatch({ type: action, fromId: hostId })} />
    {state.phase !== "endgame" && (
      <div className="fb-hostbar">
        <span>Host</span>
        <button onClick={() => dispatch({ type: "FORCE_NEXT" })}>Force next turn</button>
        <button onClick={() => dispatch({ type: "END_GAME" })}>End game</button>
      </div>
    )}
    {state.phase === "endgame" && (
      <div className="fb-hostbar">
        <span>Host</span>
        <button onClick={() => dispatch({ type: "PLAY_AGAIN" })}>Play again — same bowl</button>
      </div>
    )}
  </>);
}

function HostLobby({ state, dispatch, hostId, roomCode, peerStatus, onExit }) {
  const [tab, setTab] = useState(0);
  const color = (i) => PALETTE[i % PALETTE.length];
  // Gate on connected players only, so a phone that's briefly offline (kept in
  // the room for continuity) doesn't block the start or count as "joined".
  const here = state.players.filter((p) => p.connected !== false);
  const teamsReady = state.teams.filter((t) => here.some((p) => p.teamId === t.id)).length >= 2;
  const placed = here.every((p) => p.teamId);
  const bowlReady = state.bowl.length >= MIN_WORDS;
  const clients = here.filter((p) => !p.isHost).length;
  const connected = clients >= 1;
  const canStart = teamsReady && placed && bowlReady && connected;
  const steps = [
    { label: "Invite", done: connected },
    { label: "Groups", done: teamsReady && placed },
    { label: "Bowl", done: bowlReady },
  ];

  const teams = state.teams.map((t, i) => ({
    id: t.id, name: t.name, color: color(i),
    count: state.players.filter((p) => p.teamId === t.id).length,
  }));
  const roster = state.players.map((p) => ({
    id: p.id, name: p.name, teamId: p.teamId, isHost: p.isHost,
    connected: p.connected !== false, words: state.wordCounts[p.id] || 0,
  }));

  return (
    <div className="fb-stack">
      <div className="fb-steps">
        {steps.map((s, i) => (
          <button key={s.label} className={`fb-step ${tab === i ? "on" : ""} ${s.done ? "done" : ""}`} onClick={() => setTab(i)}>
            <span className="fb-stepn">{s.done ? "✓" : i + 1}</span>{s.label}
          </button>
        ))}
      </div>

      {tab === 0 && (<>
        <RoomShare code={roomCode} status={peerStatus} connected={clients} />
        <button className="fb-btn fb-ghost" onClick={() => setTab(1)}>Next · groups →</button>
      </>)}

      {tab === 1 && (
        <div className="fb-card fb-stack">
          <h2 className="fb-h2">Groups · {teams.length} · tap to join</h2>
          <GroupBoard
            teams={teams} roster={roster} myId={hostId}
            myTeamId={state.players.find((p) => p.id === hostId)?.teamId}
            onPick={(teamId) => dispatch({ type: "SET_TEAM", id: hostId, teamId })}
            onRename={(id, name) => dispatch({ type: "RENAME_TEAM", id, name })}
            onAddTeam={() => dispatch({ type: "ADD_TEAM" })}
            canAddTeam={teams.length < MAX_TEAMS}
            onRemoveTeam={(id) => dispatch({ type: "REMOVE_TEAM", id })}
          />
          <button className="fb-btn fb-ghost" onClick={() => setTab(2)}>Next · the bowl →</button>
        </div>
      )}

      {tab === 2 && (
        <div className="fb-card fb-stack">
          <h2 className="fb-h2">The bowl</h2>
          <p className="fb-muted"><b className="fb-num">{state.bowl.length}</b> in the bowl — everyone adds at once. Aim for {WORDS_PER_PLAYER} each.</p>
          <WordAdder onAdd={(ws) => dispatch({ type: "ADD_WORDS", words: ws, by: hostId })}
            count={state.wordCounts[hostId] || 0} target={WORDS_PER_PLAYER} />
        </div>
      )}

      <button className="fb-btn fb-big" disabled={!canStart} onClick={() => dispatch({ type: "START_GAME" })}>
        {canStart ? "Start game"
          : !connected ? "Waiting for players to join"
          : !bowlReady ? `Add ${MIN_WORDS - state.bowl.length} more words`
          : !placed ? "Everyone needs a group"
          : "Need 2 groups with players"}
      </button>
      <button className="fb-link" onClick={onExit}>Leave</button>
    </div>
  );
}

/* ============================= CLIENT ============================= *
 * Resilient join: a phone that backgrounds, loses signal or reloads keeps
 * trying to get back in (exponential backoff, plus an instant automatic retry
 * the moment the browser says the tab is shown or the network is back), and
 * reclaims its exact seat via a stable id. The UI shows an offline/reconnecting
 * banner — no button to press — instead of a dead "reload to rejoin".
 * ------------------------------------------------------------------ */
function ClientApp({ onExit, initialRoom }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialRoom || "");
  const [step, setStep] = useState("form"); // form | connecting | lobby
  const [status, setStatus] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [lobby, setLobby] = useState(null), [view, setView] = useState(null);

  // Imperative connection state lives in refs so the reconnect machinery
  // isn't torn down or stale-closed by re-renders.
  const aliveRef = useRef(false);          // are we meant to be in the room?
  const peerRef = useRef(null), connRef = useRef(null);
  const retryRef = useRef(0), timerRef = useRef(null);
  const cidRef = useRef(null), nameRef = useRef(""), codeRef = useRef("");

  const send = (o) => { const c = connRef.current; if (c && c.open) { try { c.send(JSON.stringify(o)); } catch {} } };

  // We know our own id (it's the stable cid we hand the host), so identity
  // holds even when reconnecting mid-game before a fresh lobby snapshot.
  const myId = cidRef.current;
  const me = lobby?.roster.find((p) => p.id === myId);
  const myTeam = me?.teamId ?? null;
  const myWords = me?.words ?? 0;
  const target = lobby?.wordsPerPlayer ?? WORDS_PER_PLAYER;

  // Hoisted function declarations so the mutually-recursive reconnect helpers
  // can reference each other freely; they read live values from refs, so no
  // stale closures even though they're recreated each render.
  function dialHost() {
    if (!aliveRef.current || !peerRef.current) return;
    setStatus("Reaching the room…");
    let conn;
    try { conn = peerRef.current.connect(peerIdFor(codeRef.current), { reliable: true }); }
    catch { return scheduleRetry(); }
    connRef.current = conn;
    conn.on("open", () => {
      retryRef.current = 0; setReconnecting(false); setStatus(""); setStep("lobby");
      conn.send(JSON.stringify({ t: "hello", name: nameRef.current, cid: cidRef.current }));
    });
    conn.on("data", (d) => { try { const m = JSON.parse(d); if (m.t === "lobby") setLobby(m.lobby); else if (m.t === "view") setView(m.view); } catch {} });
    conn.on("close", () => { if (aliveRef.current) scheduleRetry(); });
    conn.on("error", () => { if (aliveRef.current) scheduleRetry(); });
    // A clean "close" doesn't always fire when WebRTC dies — watch the ICE
    // state so a silent failure still kicks off a reconnect.
    conn.on("iceStateChanged", (st) => {
      if (!aliveRef.current) return;
      if (st === "failed") scheduleRetry();
      else if (st === "disconnected") setReconnecting(true); // may recover on its own
    });
  }
  async function spinUp() {
    const { default: Peer } = await import("peerjs");
    if (!aliveRef.current) return;
    const peer = new Peer(peerOptions());
    peerRef.current = peer;
    peer.on("open", () => dialHost());
    peer.on("disconnected", () => { if (aliveRef.current) { try { peer.reconnect(); } catch {} } });
    peer.on("error", (err) => {
      if (err?.type === "peer-unavailable") setStatus("Room not answering yet — retrying…");
      if (aliveRef.current) scheduleRetry();
    });
  }
  // Tear down the live connection and re-establish a clean one after a backoff.
  function scheduleRetry() {
    if (!aliveRef.current) return;
    setReconnecting(true);
    clearTimeout(timerRef.current);
    try { connRef.current?.close(); } catch {}
    connRef.current = null;
    // Genuinely offline (airplane mode, wifi off)? Don't burn retries — the
    // browser's 'online' event fires the moment the network is back and
    // reconnects us straight away. (onLine can be true with no real internet,
    // so when it's true we still retry on a backoff to cover that case.)
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const n = retryRef.current++;
    const delay = Math.min(1000 * 2 ** Math.min(n, 3), 8000); // 1s,2s,4s,8s…
    timerRef.current = setTimeout(() => {
      if (!aliveRef.current) return;
      try { peerRef.current?.destroy(); } catch {}
      peerRef.current = null;
      spinUp();
    }, delay);
  }
  // Skip the backoff and reconnect now — triggered automatically when the tab
  // is shown again, the window refocuses, or the network comes back.
  function reconnectNow() {
    if (!aliveRef.current) return;
    if (connRef.current && connRef.current.open) return;
    if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") return;
    retryRef.current = 0; clearTimeout(timerRef.current);
    try { peerRef.current?.destroy(); } catch {}
    peerRef.current = null;
    spinUp();
  }
  const join = () => {
    if (!name.trim() || !code.trim()) return;
    nameRef.current = name.trim(); codeRef.current = code.trim();
    cidRef.current = stableClientId(codeRef.current);
    aliveRef.current = true; retryRef.current = 0;
    setStep("connecting"); setStatus("Reaching the room…");
    spinUp();
  };

  // Bridge the latest reconnectNow into a stable listener so the effect
  // subscribes once, not on every render. The browser tells us when the phone
  // comes back — net returning, tab shown, window refocused — and we rejoin
  // automatically; no button to press.
  const reconnectNowRef = useRef(reconnectNow);
  reconnectNowRef.current = reconnectNow;
  useEffect(() => {
    const kick = () => reconnectNowRef.current();
    const goOnline = () => { setOnline(true); reconnectNowRef.current(); };
    const goOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("focus", kick);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("focus", kick);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => () => {
    aliveRef.current = false; clearTimeout(timerRef.current);
    try { connRef.current?.close(); } catch {}
    try { peerRef.current?.destroy(); } catch {}
  }, []);

  if (view && view.phase !== "lobby") return (<>
    <ReconnectBanner show={reconnecting} online={online} />
    <GameView view={view} onIntent={(action) => send({ t: "intent", action })} optimistic />
  </>);

  return (
    <div className="fb-card fb-stack">
      <ReconnectBanner show={reconnecting && step === "lobby"} online={online} />
      <h1 className="fb-h1">Join a room</h1>
      {step === "form" && (<>
        {initialRoom && <p className="fb-muted">Joining room <b className="fb-code">{initialRoom}</b> — just pop your name in.</p>}
        <label className="fb-label">Your name<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus /></label>
        {!initialRoom && <label className="fb-label">Room code<input className="fb-input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} placeholder="e.g. kx7m2p" /></label>}
        <button className="fb-btn" disabled={!name.trim() || !code.trim()} onClick={join}>Join room</button>
        {status && <p className="fb-err">{status}</p>}
        <button className="fb-btn fb-ghost" onClick={onExit}>Back</button>
      </>)}
      {step === "connecting" && <p className="fb-muted">{status || "Connecting…"}</p>}
      {step === "lobby" && lobby && (<>
        <div className="fb-roundtag">In the room</div>
        <h2 className="fb-h2">Groups · {lobby.teams.length} · tap to join</h2>
        <GroupBoard
          teams={lobby.teams} roster={lobby.roster} myId={myId} myTeamId={myTeam}
          onPick={(teamId) => send({ t: "setTeam", teamId })}
          onRename={(id, nm) => send({ t: "renameTeam", id, name: nm })}
          onAddTeam={() => send({ t: "addTeam" })}
          canAddTeam={lobby.teams.length < lobby.maxTeams}
        />
        <h2 className="fb-h2">The bowl</h2>
        <p className="fb-muted"><b className="fb-num">{lobby.bowlCount}</b> in the bowl. Everyone's adding at once.</p>
        <WordAdder onAdd={(ws) => send({ t: "words", words: ws })} count={myWords} target={target} />
        <p className="fb-tiny">{myTeam ? "Waiting for the host to start…" : "Join a group to be ready."}</p>
      </>)}
    </div>
  );
}
function ReconnectBanner({ show, online }) {
  if (!show) return null;
  return (
    <div className={`fb-reconnect ${online ? "" : "offline"}`}>
      {online
        ? "⟳ Connection dropped — getting you back in…"
        : "📡 You're offline — you'll rejoin automatically the moment you're back."}
    </div>
  );
}

/* ===================== shared in-game view ======================= */
// `optimistic` is true on a remote (client) device: the host's word arrives
// over the wire, so when the giver taps CORRECT we flip to the next buffered
// word immediately and reconcile when the host's authoritative view lands.
// The host itself dispatches synchronously, so it shows the real word as-is.
function GameView({ view, onIntent, optimistic = false }) {
  const accent = view.phase === "endgame" ? "#FF6A3D" : view.round?.accent || "#FF6A3D";
  return (
    <div style={{ "--accent": accent }}>
      {view.phase === "ready" && <Ready v={view} onIntent={onIntent} />}
      {view.phase === "play" && <Play v={view} onIntent={onIntent} optimistic={optimistic} />}
      {view.phase === "transition" && <Transition v={view} onIntent={onIntent} />}
      {view.phase === "endgame" && <Endgame v={view} />}
    </div>
  );
}

// Optimistic word buffer for the active clue-giver. The host streams the
// current word plus a short `nextWords` lookahead (giver-only). We display a
// word `pending` steps ahead of the host's current card; each authoritative
// advance consumes one pending step. Purely cosmetic — the host stays the sole
// authority for scoring and round progression, so the worst case is a brief
// snap-back, never a wrong score or a leaked word.
function useGiverWord(view, optimistic) {
  const [pending, setPending] = useState(0);
  const lastWord = useRef(view.word);
  const lastTurn = useRef(view.turnNumber);
  useEffect(() => {
    if (!optimistic) return;
    if (view.phase !== "play" || view.turnNumber !== lastTurn.current) {
      lastTurn.current = view.turnNumber; lastWord.current = view.word; setPending(0); return;
    }
    if (view.word && view.word !== lastWord.current) { // host advanced a card
      lastWord.current = view.word; setPending((p) => Math.max(0, p - 1));
    }
  }, [optimistic, view.word, view.phase, view.turnNumber]);

  if (!optimistic) return { shown: view.word, canBuffer: false, bump: () => {} };
  const list = [view.word, ...(view.nextWords || [])].filter(Boolean);
  const idx = Math.min(pending, Math.max(0, list.length - 1));
  return {
    shown: list.length ? list[idx] : view.word,
    canBuffer: pending < list.length - 1, // a buffered word is ready to show
    bump: () => setPending((p) => p + 1),
  };
}
const RoundDots = ({ n }) => (
  <span className="fb-dots" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <span key={i} className={`fb-pip ${i <= n ? "on" : ""}`} />)}</span>
);
const RoundLine = ({ r }) => (
  <div className="fb-roundline"><span className="fb-roundtag">{r.icon} R{r.n} · {r.name}</span><RoundDots n={r.n} /></div>
);
const Rules = ({ r, tight }) => (
  <div className={`fb-rules ${tight ? "tight" : ""}`}>
    <span><b>Allowed</b> {r.allowed}</span><span><b>Never</b> {r.restrict}</span>
  </div>
);
function Ready({ v, onIntent }) {
  const r = v.round;
  return (
    <div className="fb-card fb-stack fb-center" style={{ "--tc": v.teamUpColor }}>
      {v.turnNumber > 1 && <div className="fb-flash">⏰ Time! {v.teamUpName} is up next.</div>}
      <RoundLine r={r} />
      <FitText className="fb-h1 fb-xl" style={{ color: v.teamUpColor }} text={v.teamUpName} min={20} />
      {v.canClaim ? (<>
        <p className="fb-muted">{r.setup}</p>
        {v.inherited && <p className="fb-inherit">You'd inherit one un-guessed card.</p>}
        <Rules r={r} />
        <button className="fb-btn fb-big" onClick={() => onIntent("CLAIM_AND_BEGIN")}>I'll give clues · {TURN_SECONDS}s</button>
      </>) : v.myTeamId && v.teamUpName ? (
        <p className="fb-muted">Your team's up. Someone tap “I'll give clues” on their phone.</p>
      ) : (
        <p className="fb-muted">Waiting for {v.teamUpName} to start their turn. Watch the room.</p>
      )}
      <Standings v={v} />
    </div>
  );
}
// A Time Timer-style disc: a colored wedge that depletes smoothly around a
// clock face, seconds called out big in the middle. Zones shift green →
// amber → red as the clock winds down; the last 10s give it a heartbeat.
function VisualTimer({ timeLeft, total }) {
  const frac = Math.max(0, Math.min(1, timeLeft / total));
  const zone = timeLeft <= 10 ? "red" : timeLeft <= 20 ? "yellow" : "green";
  const low = timeLeft <= 10 && timeLeft > 0;
  return (
    <div
      className={`fb-vtimer ${zone} ${low ? "pulse" : ""}`}
      role="timer"
      aria-label={`${timeLeft} seconds left`}
    >
      <div className="fb-vt-disc" style={{ "--fbdeg": `${frac * 360}deg` }}>
        <div className="fb-vt-ticks" aria-hidden="true" />
        <div className="fb-vt-hub">
          <span className="fb-vt-secs">{timeLeft}</span>
          <span className="fb-vt-unit">sec</span>
        </div>
      </div>
    </div>
  );
}
// Shrink an element's font-size until its text fits `avail` px on one line
// (down to `min`); below that, let it wrap rather than bleed off the page.
// Shared by the word slip and the big team-name heading.
const padX = (e) => { const s = getComputedStyle(e); return parseFloat(s.paddingLeft) + parseFloat(s.paddingRight); };
function fitOneLine(el, avail, max, min) {
  if (!el || avail <= 0) return;
  el.style.whiteSpace = "nowrap";
  el.style.wordBreak = "normal";
  el.style.fontSize = max + "px";
  const natural = el.scrollWidth;
  const next = natural > avail ? Math.max(min, Math.floor((max * avail) / natural)) : max;
  el.style.fontSize = next + "px";
  if (next <= min && el.scrollWidth > avail) { el.style.whiteSpace = "normal"; el.style.wordBreak = "break-word"; }
}
// Run a fit now, then again once the Anton display font is actually applied
// (fonts.ready can resolve before a CSS @import-ed face loads) and after a
// short beat as a fallback. Returns a cleanup to cancel the pending timer.
function fitWithFont(fit) {
  fit();
  try { document.fonts.load("400 1em 'Anton'").then(fit, () => {}); } catch {}
  try { document.fonts.ready.then(fit, () => {}); } catch {}
  const t = setTimeout(fit, 350);
  return () => clearTimeout(t);
}
// A big heading that auto-sizes to fit its card on one line, so long team
// names ("SPRINGBOKKE") shrink to stay whole instead of overflowing.
function FitText({ text, className, style, max = 58, min = 24 }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.parentElement;
    if (!el || !parent) return;
    const fit = () => fitOneLine(el, parent.clientWidth - padX(parent) - 2, max, min);
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    const cancel = fitWithFont(fit);
    return () => { ro.disconnect(); cancel(); };
  }, [text, max, min]);
  return <h1 ref={ref} className={className} style={style}>{text}</h1>;
}
// The torn-paper word slip. The word is auto-sized to be as big as will
// fit on one line, so long entries ("loadshedding") shrink to stay whole
// instead of breaking ugly mid-word; only past the minimum size do we let
// it wrap. The misregistration ghost (::before) inherits the same size.
const WORD_MAX = 78, WORD_MIN = 30;
function WordSlip({ word }) {
  const slipRef = useRef(null);
  const wordRef = useRef(null);
  useLayoutEffect(() => {
    const slip = slipRef.current, el = wordRef.current, card = slip?.parentElement;
    if (!slip || !el || !card) return;
    // headroom for the slip's slight rotation and the ink ghost's 3px offset.
    const fit = () => fitOneLine(el, card.clientWidth - padX(card) - padX(slip) - 18, WORD_MAX, WORD_MIN);
    const ro = new ResizeObserver(fit);
    ro.observe(card);
    const cancel = fitWithFont(fit);
    return () => { ro.disconnect(); cancel(); };
  }, [word]);
  return (
    <div className="fb-slip" ref={slipRef} key={word}>
      <div className="fb-word" data-word={word} ref={wordRef}>{word}</div>
    </div>
  );
}
function Play({ v, onIntent, optimistic }) {
  const r = v.round;
  const { shown, canBuffer, bump } = useGiverWord(v, optimistic);
  const onCorrect = () => { onIntent("CORRECT"); if (optimistic && canBuffer) bump(); };
  return (
    <div className="fb-card fb-stack">
      <div className="fb-hud">
        <RoundLine r={r} />
        <span className="fb-turn" style={{ color: v.teamUpColor }}>● {v.activeName}</span>
      </div>
      <VisualTimer timeLeft={v.timeLeft} total={TURN_SECONDS} />
      {v.isActive ? (<>
        <WordSlip word={shown} />
        <Rules r={r} tight />
        <button className="fb-btn fb-correct" onClick={onCorrect}>CORRECT <span>(Spacebar)</span></button>
        <p className="fb-noskip">No skipping. Resolve it or run out the clock.</p>
      </>) : (
        <div className="fb-watch">
          <p>{v.activeName} is giving clues for <b style={{ color: v.teamUpColor }}>{v.teamUpName}</b>.</p>
          <p className="fb-tiny">Guess out loud. The word stays on their phone.</p>
        </div>
      )}
      <Standings v={v} />
    </div>
  );
}
function Transition({ v, onIntent }) {
  const r = v.round;
  return (
    <div className="fb-modal" style={{ "--accent": r.accent }}>
      <div className="fb-card fb-stack fb-center">
        <div className="fb-flash big">⏸ Round over mid-turn</div>
        <p className="fb-paused">Paused · <b>{v.timeLeft}s</b> left</p>
        <div className="fb-nextsetup">{r.icon} ROUND {r.n} IS <b>{r.name.toUpperCase()}</b><span>{r.setup}</span></div>
        <RoundDots n={r.n} />
        <Rules r={r} />
        {v.canResume ? <button className="fb-btn fb-big" onClick={() => onIntent("RESUME")}>Resume turn ▶</button>
          : <p className="fb-muted">Waiting for {v.activeName} to resume…</p>}
      </div>
    </div>
  );
}
function Endgame({ v }) {
  const total = (id) => v.scores[id].reduce((a, b) => a + b, 0);
  const ranked = [...v.teams].sort((a, b) => total(b.id) - total(a.id));
  const top = total(ranked[0].id), winners = ranked.filter((t) => total(t.id) === top);
  return (
    <div className="fb-card fb-stack">
      <FitText className="fb-h1 fb-xl" style={{ color: winners[0].color }} text={winners.length > 1 ? "It's a tie!" : `${winners[0].name} wins!`} min={20} />
      {ranked.map((t, i) => (
        <div className="fb-rankrow" key={t.id} style={{ "--tc": t.color }}>
          <span className="fb-rank">{i + 1}</span><span className="fb-dot" />
          <span className="fb-rankname">{t.name}</span><span className="fb-ranktotal">{total(t.id)}</span>
        </div>
      ))}
      <details className="fb-details"><summary>Round-by-round</summary>
        <div className="fb-scroll"><table className="fb-table">
          <thead><tr><th>Team</th>{ROUNDS.map((r) => <th key={r.n}><span className="fb-th2">{r.icon}<span>R{r.n}</span></span></th>)}</tr></thead>
          <tbody>{ranked.map((t) => <tr key={t.id}><td style={{ color: t.color }}>{t.name}</td>{v.scores[t.id].map((s, i) => <td key={i}>{s}</td>)}</tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}
function Standings({ v }) {
  const total = (id) => v.scores[id].reduce((a, b) => a + b, 0);
  return <div className="fb-standings">{v.teams.map((t) => <span key={t.id} style={{ color: t.color }}>{t.name} <b>{total(t.id)}</b></span>)}</div>;
}

/* --------------------------- small parts -------------------------- */
// Shared by host + clients: every group with a live count, who's in it,
// an editable name, and a tap-to-join button. Host also gets a remove (×).
function GroupBoard({ teams, roster, myId, myTeamId, onPick, onRename, onAddTeam, canAddTeam, onRemoveTeam }) {
  const members = (tid) => roster.filter((p) => p.teamId === tid);
  const unplaced = roster.filter((p) => !p.teamId);
  return (
    <div className="fb-stack">
      {teams.map((t) => {
        const mine = myTeamId === t.id;
        return (
          <div className={`fb-group ${mine ? "mine" : ""}`} key={t.id} style={{ "--tc": t.color }}>
            <div className="fb-grouphead">
              <span className="fb-dot" />
              <input className="fb-input bare" value={t.name} maxLength={16}
                onChange={(e) => onRename(t.id, e.target.value)} aria-label="Group name" />
              <span className="fb-tcount">{t.count}</span>
              {onRemoveTeam && teams.length > 2 && <button className="fb-x" title="Remove group" onClick={() => onRemoveTeam(t.id)}>×</button>}
            </div>
            <div className="fb-rosterwrap">
              {members(t.id).length === 0
                ? <span className="fb-empty">— empty —</span>
                : members(t.id).map((p) => (
                  <span key={p.id} className={`fb-chip ${p.connected === false ? "off" : ""}`} style={{ "--tc": t.color }}>
                    <span className="fb-dot" /> {p.name}{p.id === myId ? " (you)" : ""}{p.isHost ? " · host" : ""}
                    {p.connected === false ? " · offline" : ""}
                  </span>
                ))}
            </div>
            <button className={`fb-joinbtn ${mine ? "on" : ""}`} onClick={() => onPick(t.id)}>
              {mine ? "✓ You're in this group" : "Join this group"}
            </button>
          </div>
        );
      })}
      {unplaced.length > 0 && (
        <div className="fb-rosterwrap">
          {unplaced.map((p) => (
            <span key={p.id} className="fb-chip" style={{ "--tc": "#9b927f" }}>
              <span className="fb-dot" /> {p.name}{p.id === myId ? " (you)" : ""} · no group yet
            </span>
          ))}
        </div>
      )}
      {canAddTeam && <button className="fb-btn fb-ghost" onClick={onAddTeam}>+ add a group</button>}
    </div>
  );
}
// Host's share panel: a QR to scan and a link to send. The PeerJS broker
// handles only the handshake; game data stays peer-to-peer.
function RoomShare({ code, status, connected }) {
  const link = useMemo(() => roomLinkFor(code), [code]);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const QR = (await import("qrcode")).default;
        const url = await QR.toDataURL(link, { margin: 1, width: 240, color: { dark: "#221C18", light: "#FBF7EC" } });
        if (live) setQr(url);
      } catch {}
    })();
    return () => { live = false; };
  }, [link]);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {} };
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: "Murray's Game", text: "Join my room", url: link }); else copy(); } catch {}
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const dot = status === "online" ? "var(--green)" : status === "error" ? "var(--red)" : "var(--amber)";
  const msg = status === "online" ? "Room is live — share away"
    : status === "error" ? "That code is taken — leave and re-open the room"
    : "Opening the room…";
  return (
    <div className="fb-card fb-stack fb-center">
      <h2 className="fb-h2">Share the room</h2>
      <p className="fb-statusline"><span className="fb-statusdot" style={{ background: dot }} /> {msg}</p>
      {qr && <img className="fb-qr" src={qr} alt="QR code to join the room" width={200} height={200} />}
      <p className="fb-tiny">Scan it — or send the link. Code: <b className="fb-code">{code}</b></p>
      <input className="fb-input mono fb-linkfield" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Room link" />
      <div className="fb-row fb-sharebtns">
        <button className="fb-btn" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
        {canShare && <button className="fb-btn fb-ghost" onClick={share}>Share…</button>}
      </div>
      <p className="fb-tiny">{connected} {connected === 1 ? "phone" : "phones"} connected</p>
    </div>
  );
}
// `count` is how many words this person has already dropped in; `target` is
// the soft per-player goal. The deck button only ever tops you up to the goal.
function WordAdder({ onAdd, count = 0, target = 0 }) {
  const [draft, setDraft] = useState("");
  const add = () => { const w = draft.trim(); if (!w) return; onAdd([w]); setDraft(""); };
  const remaining = target ? Math.max(0, target - count) : 0;
  const done = target > 0 && remaining === 0;
  return (
    <div className="fb-stack">
      {target > 0 && (
        <div className={`fb-wordprog ${done ? "done" : ""}`}>
          <span>Your words <b>{count}/{target}</b></span>
          <span>{done ? "✓ that's plenty — add more if you like" : `${remaining} to go`}</span>
        </div>
      )}
      <div className="fb-row">
        <input className="fb-input" value={draft} placeholder="Type a word…" maxLength={40} autoFocus
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="fb-btn fb-add" onClick={add}>Add</button>
      </div>
      {remaining > 0 && (
        <button className="fb-btn fb-ghost" onClick={() => onAdd(sampleDeck(remaining))}>
          🇿🇦 Fill my {remaining} from Murray's deck
        </button>
      )}
      {count > 0 && <p className="fb-tiny">Your words stay hidden from everyone until they're in play.</p>}
    </div>
  );
}
/* ============================== CSS ============================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;800&family=Space+Mono:wght@400;700&display=swap');
.fb-root{
  --paper:#E7EAED; --panel:#FBFCFD; --slip:#FFFFFF; --ink:#1A1D22; --muted:#6B7178; --line:#D6DBE0;
  --green:#1AA67E; --amber:#E8920A; --red:#E0322B;
  /* a cool, neutral paper desk, lit unevenly — pages sit on top of it */
  min-height:100vh;color:var(--ink);
  background-color:var(--paper);
  background-image:
    radial-gradient(150% 100% at 50% -25%, rgba(255,255,255,.6), rgba(255,255,255,0) 60%),
    radial-gradient(95% 80% at 9% 5%, rgba(247,249,251,.5), rgba(247,249,251,0) 46%),
    radial-gradient(130% 120% at 93% 105%, rgba(64,76,92,.12), rgba(64,76,92,0) 55%);
  background-attachment:fixed;
  font-family:Archivo,system-ui,sans-serif;display:flex;justify-content:center;padding:18px;box-sizing:border-box;position:relative;
}
/* fine fibre grain printed over the whole surface — paper, cards and all */
.fb-root::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:100;mix-blend-mode:multiply;opacity:.1;
  background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.82'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='180'%20height='180'%20filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:180px 180px;}
.fb-shell{width:100%;max-width:540px;position:relative;z-index:1;}
.fb-brand{font-family:Anton,'Arial Narrow',sans-serif;letter-spacing:.06em;font-size:22px;text-align:center;width:max-content;max-width:100%;margin:2px auto 18px;color:var(--ink);text-transform:uppercase;}
.fb-brand::after{content:"";display:block;width:100%;height:4px;margin:9px auto 0;border-radius:3px;
  background:linear-gradient(90deg,#007A4D 0 30%,#FFB81C 30% 45%,#DE3831 45% 70%,#0b3aa1 70% 100%);
  box-shadow:0 1px 0 rgba(255,255,255,.55);}

/* clean off-white paper cards on the warm desk. */
.fb-card{position:relative;border:1px solid var(--line);border-radius:12px;padding:22px;
  background-color:var(--panel);
  box-shadow:0 1px 0 #fff inset, 0 14px 30px rgba(20,26,34,.12);}
.fb-stack{display:flex;flex-direction:column;gap:12px;}
.fb-center{text-align:center;align-items:center;}

.fb-h1{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;letter-spacing:.01em;font-size:27px;margin:0;text-transform:uppercase;line-height:1;}
.fb-h2{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.14em;margin:0;text-transform:uppercase;color:var(--muted);}
.fb-xl{font-size:clamp(38px,11vw,58px);line-height:.96;}
.fb-center .fb-h1.fb-xl{margin:6px 0 2px;}
.fb-muted{color:var(--muted);margin:0;font-size:15px;line-height:1.5;}
.fb-muted b{color:var(--ink);}
.fb-tiny{color:var(--muted);font-size:12px;margin:0;font-family:'Space Mono',monospace;}
.fb-num{font-family:Anton,sans-serif;font-weight:400;font-size:20px;color:var(--accent);vertical-align:-1px;margin-right:4px;}
.fb-link{background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit;text-decoration:underline;padding:4px;}

.fb-label{display:flex;flex-direction:column;gap:6px;font-family:'Space Mono',monospace;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;}
.fb-input{background:#fff;border:1.5px solid var(--line);border-radius:8px;color:var(--ink);padding:12px 13px;font-size:16px;font-family:inherit;width:100%;box-sizing:border-box;}
.fb-input:focus{outline:none;border-color:var(--ink);box-shadow:2px 2px 0 var(--accent);}
.fb-input.bare{background:transparent;border:none;padding:6px 0;font-weight:800;font-size:17px;box-shadow:none;}
.fb-input.bare:focus{outline:none;box-shadow:none;border-bottom:2px solid var(--tc);}
.fb-area{background:#fff;border:1.5px solid var(--line);border-radius:8px;color:var(--ink);padding:11px;font-size:13px;width:100%;box-sizing:border-box;min-height:60px;resize:vertical;font-family:inherit;}
.fb-area:focus{outline:none;border-color:var(--ink);box-shadow:2px 2px 0 var(--accent);}
.fb-area.mono{font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);}
.fb-row{display:flex;gap:8px;}
.fb-add{width:auto;padding-left:18px;padding-right:18px;}
.fb-wordprog{display:flex;justify-content:space-between;align-items:center;gap:8px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;}
.fb-wordprog b{font-family:Anton,sans-serif;font-weight:400;font-size:16px;color:var(--accent);vertical-align:-2px;margin:0 2px;}
.fb-wordprog.done{color:var(--green);}.fb-wordprog.done b{color:var(--green);}
.fb-reconnect{position:sticky;top:0;z-index:60;margin-bottom:12px;background:var(--amber);color:#fff;border-radius:8px;
  padding:9px 13px;font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.04em;text-align:center;
  box-shadow:0 6px 16px rgba(20,26,34,.22);}
.fb-reconnect.offline{background:#6E6557;}

.fb-btn{background:var(--ink);color:var(--paper);border:none;border-radius:8px;padding:14px 16px;font-size:16px;font-weight:800;
  font-family:Archivo,sans-serif;cursor:pointer;width:100%;box-shadow:3px 3px 0 var(--accent);transition:transform .08s,box-shadow .08s;}
.fb-btn:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--accent);}
.fb-btn:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--accent);}
.fb-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:inset 0 0 0 2px var(--accent);background:var(--panel);color:var(--muted);}
.fb-btn:focus-visible{outline:2.5px solid var(--ink);outline-offset:2px;}
.fb-ghost{background:transparent;color:var(--ink);border:1.5px dashed var(--line);box-shadow:none;}
.fb-ghost:hover:not(:disabled){transform:none;box-shadow:none;border-color:var(--ink);}
.fb-big{padding:17px;font-size:18px;}
.fb-x{background:none;border:1.5px solid var(--line);color:var(--muted);border-radius:8px;width:36px;height:36px;font-size:19px;cursor:pointer;flex:none;}
.fb-x:hover{color:var(--ink);border-color:var(--tc);}
.fb-err{color:var(--red);margin:0;font-size:13px;font-family:'Space Mono',monospace;}

.fb-sliprow{display:flex;gap:9px;justify-content:center;margin-bottom:6px;}
.fb-sliprow span{position:relative;font-family:'Space Mono',monospace;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;
  background:var(--slip);padding:9px 12px 8px;border-radius:0 0 4px 4px;box-shadow:0 7px 14px rgba(20,26,34,.16);}
.fb-sliprow span::before{content:"";position:absolute;top:-1px;left:5px;right:5px;height:5px;
  background:radial-gradient(circle at 4px -1px, var(--paper) 0 3px, transparent 3.4px) repeat-x;background-size:8px 5px;}
.fb-sliprow span:nth-child(1){transform:rotate(-5deg);color:#FF6A3D;}
.fb-sliprow span:nth-child(2){transform:rotate(3deg);color:#2C6EE6;}
.fb-sliprow span:nth-child(3){transform:rotate(-2deg);color:#7A4DE0;}

.fb-steps{display:flex;gap:8px;}
.fb-step{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;background:var(--panel);border:1.5px solid var(--line);border-radius:8px;padding:11px 6px;font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);cursor:pointer;}
.fb-step.on{border-color:var(--ink);color:var(--ink);box-shadow:3px 3px 0 var(--accent);}
.fb-step.done{color:var(--ink);}
.fb-stepn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1.6px solid currentColor;font-size:11px;flex:none;}
.fb-step.done .fb-stepn{background:var(--green);border-color:var(--green);color:#fff;}

.fb-tcount{font-family:'Space Mono',monospace;color:var(--muted);font-size:13px;min-width:16px;text-align:right;}
.fb-dot{width:11px;height:11px;border-radius:50%;background:var(--tc);flex:none;}
.fb-rosterwrap{display:flex;flex-wrap:wrap;gap:7px;}
.fb-chip{background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:6px 11px;color:var(--ink);font-size:13px;display:inline-flex;align-items:center;gap:7px;}
.fb-chip.off{opacity:.5;border-style:dashed;}
.fb-chip.off .fb-dot{background:var(--muted);}
.fb-teampick{display:flex;gap:8px;flex-wrap:wrap;}
.fb-teambtn{flex:1 1 40%;background:#fff;border:1.5px solid var(--line);border-radius:8px;padding:12px;color:var(--muted);font-weight:800;font-family:inherit;font-size:15px;cursor:pointer;}
.fb-teambtn.on{border-color:var(--tc);color:var(--tc);box-shadow:2px 2px 0 var(--tc);}

.fb-group{background:#fff;border:1.5px solid var(--line);border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:9px;}
.fb-group.mine{border-color:var(--tc);box-shadow:2px 2px 0 var(--tc);}
.fb-grouphead{display:flex;align-items:center;gap:10px;}
.fb-grouphead .fb-input.bare{flex:1;}
.fb-empty{color:var(--muted);font-size:12px;font-family:'Space Mono',monospace;letter-spacing:.06em;}
.fb-joinbtn{background:transparent;border:1.5px dashed var(--line);color:var(--muted);border-radius:8px;padding:9px;font-weight:800;font-family:inherit;font-size:14px;cursor:pointer;}
.fb-joinbtn:hover{border-color:var(--tc);color:var(--tc);}
.fb-joinbtn.on{background:var(--tc);border-color:var(--tc);color:#fff;border-style:solid;}

.fb-qr{width:200px;height:200px;border-radius:10px;background:var(--slip);padding:8px;box-shadow:0 10px 22px rgba(20,26,34,.16);image-rendering:pixelated;}
.fb-statusline{display:flex;align-items:center;gap:8px;margin:0;color:var(--muted);font-size:13px;font-family:'Space Mono',monospace;}
.fb-statusdot{width:9px;height:9px;border-radius:50%;flex:none;}
.fb-code{font-family:'Space Mono',monospace;letter-spacing:.12em;color:var(--accent);text-transform:uppercase;}
.fb-linkfield{font-size:12px;text-align:center;}
.fb-sharebtns{width:100%;}

.fb-roundline{display:flex;flex-direction:column;gap:6px;align-items:flex-start;}
.fb-center .fb-roundline{align-items:center;}
.fb-roundtag{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);}
.fb-dots{display:inline-flex;gap:5px;}
.fb-pip{width:8px;height:8px;border-radius:50%;border:1.6px solid var(--accent);box-sizing:border-box;}
.fb-pip.on{background:var(--accent);}
.fb-hud{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.fb-turn{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;white-space:nowrap;}

/* Time Timer-style disc — a depleting wedge on a clock face. */
@property --fbdeg{syntax:'<angle>';inherits:false;initial-value:360deg;}
.fb-vtimer{align-self:center;position:relative;width:min(264px,70vw);aspect-ratio:1;margin:2px auto;}
.fb-vtimer.green{--zone:var(--green);}
.fb-vtimer.yellow{--zone:var(--amber);}
.fb-vtimer.red{--zone:var(--red);}
.fb-vt-disc{position:absolute;inset:0;border-radius:50%;border:3px solid var(--ink);
  background:conic-gradient(var(--zone) var(--fbdeg), rgba(20,26,34,.12) var(--fbdeg) 360deg);
  transition:--fbdeg 1s linear;box-shadow:0 16px 32px rgba(20,26,34,.20), 0 1px 0 #fff inset;}
.fb-vt-ticks{position:absolute;inset:0;border-radius:50%;pointer-events:none;opacity:.5;
  background:repeating-conic-gradient(from -.7deg, var(--ink) 0 1.4deg, transparent 1.4deg 30deg);
  -webkit-mask:radial-gradient(circle, transparent 0 calc(50% - 15px), #000 calc(50% - 15px) calc(50% - 4px), transparent calc(50% - 4px));
          mask:radial-gradient(circle, transparent 0 calc(50% - 15px), #000 calc(50% - 15px) calc(50% - 4px), transparent calc(50% - 4px));}
.fb-vt-hub{position:absolute;inset:23%;border-radius:50%;background:var(--slip);border:2px solid var(--ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 5px 12px rgba(20,26,34,.14);}
.fb-vt-secs{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;font-size:clamp(38px,15vw,58px);line-height:.85;color:var(--ink);font-variant-numeric:tabular-nums;}
.fb-vtimer.red .fb-vt-secs{color:var(--red);}
.fb-vt-unit{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.fb-vtimer.pulse{animation:fbvt .85s ease-in-out infinite;}@keyframes fbvt{50%{transform:scale(1.045);}}

.fb-slip{position:relative;align-self:center;max-width:100%;background:var(--slip);padding:26px 20px 22px;border-radius:8px;
  box-shadow:0 14px 28px rgba(20,26,34,.18);transform:rotate(-1.1deg);animation:slipdrop .28s cubic-bezier(.2,.85,.3,1);}
.fb-slip::before{content:"";position:absolute;top:-2px;left:10px;right:10px;height:8px;
  background:radial-gradient(circle at 6px -2px, var(--paper) 0 5px, transparent 5.5px) repeat-x;background-size:12px 8px;}
@keyframes slipdrop{from{transform:translateY(-18px) rotate(2.5deg);opacity:0;}to{transform:translateY(0) rotate(-1.1deg);opacity:1;}}
.fb-word{position:relative;z-index:0;font-family:Anton,'Arial Narrow',sans-serif;text-transform:uppercase;text-align:center;
  font-size:clamp(40px,13vw,78px);line-height:1.02;letter-spacing:.01em;color:var(--ink);white-space:nowrap;}
.fb-word::before{content:attr(data-word);position:absolute;inset:0;color:var(--accent);transform:translate(3px,4px);
  mix-blend-mode:multiply;z-index:-1;}

.fb-watch{text-align:center;padding:24px 8px;}.fb-watch p{margin:0 0 6px;}
.fb-rules{display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:var(--muted);border-top:1.5px dashed var(--line);padding-top:11px;}
.fb-rules.tight{border-top:none;padding-top:0;}
.fb-rules b{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin-right:7px;}
.fb-correct{background:var(--accent);color:var(--ink);font-family:Anton,sans-serif;font-weight:400;font-size:25px;letter-spacing:.04em;padding:20px;box-shadow:4px 4px 0 var(--ink);}
.fb-correct:hover:not(:disabled){box-shadow:5px 5px 0 var(--ink);}
.fb-correct:active:not(:disabled){box-shadow:1px 1px 0 var(--ink);}
.fb-correct span{font-family:'Space Mono',monospace;font-size:12px;opacity:.75;font-weight:700;}
.fb-noskip{text-align:center;color:var(--muted);font-size:12px;margin:0;font-family:'Space Mono',monospace;}

.fb-flash{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;letter-spacing:.04em;color:var(--ink);
  background:var(--slip);border:1.5px dashed var(--ink);padding:9px 13px;border-radius:8px;}
.fb-flash.big{font-family:Anton,sans-serif;font-weight:400;font-size:20px;letter-spacing:.03em;}
.fb-inherit{color:var(--muted);font-weight:400;margin:0;font-size:13px;font-family:'Space Mono',monospace;}
.fb-inherit::before{content:"\\21B3  ";opacity:.7;}
.fb-paused{margin:0;color:var(--muted);font-family:'Space Mono',monospace;font-size:13px;}.fb-paused b{color:var(--ink);font-size:18px;}
.fb-nextsetup{font-family:Anton,sans-serif;font-size:21px;color:var(--accent);display:flex;flex-direction:column;gap:5px;line-height:1.1;}
.fb-nextsetup span{font-family:Archivo,sans-serif;font-size:13px;color:var(--muted);}

.fb-standings{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;width:100%;box-sizing:border-box;color:var(--muted);font-size:13px;background:rgba(20,26,34,.035);border-radius:8px;padding:11px 12px;margin-top:4px;font-family:'Space Mono',monospace;}
.fb-standings b{font-family:Anton,sans-serif;font-weight:400;font-size:18px;vertical-align:-2px;}

.fb-modal{position:fixed;inset:0;background:rgba(34,28,18,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px;z-index:50;}
.fb-modal .fb-card{max-width:500px;width:100%;border:2px solid var(--ink);}

.fb-rankrow{display:flex;align-items:center;gap:11px;background:#fff;border:1.5px solid var(--line);border-radius:8px;padding:11px 14px;}
.fb-rank{font-family:Anton,sans-serif;color:var(--muted);width:20px;}
.fb-rankname{flex:1;font-weight:800;}
.fb-ranktotal{font-family:Anton,sans-serif;font-size:24px;color:var(--tc);}
.fb-details{color:var(--muted);font-size:14px;font-family:'Space Mono',monospace;}
.fb-details summary{cursor:pointer;padding:6px 0;letter-spacing:.06em;text-transform:uppercase;font-size:12px;}
.fb-scroll{overflow-x:auto;}
.fb-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;font-family:'Space Mono',monospace;}
.fb-table th,.fb-table td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap;}
.fb-table th{color:var(--muted);font-weight:700;}
.fb-th2{display:flex;flex-direction:column;align-items:center;gap:1px;}
.fb-th2 span{font-size:9px;letter-spacing:.06em;color:var(--muted);}
.fb-table th:first-child,.fb-table td:first-child{text-align:left;font-family:Archivo;font-weight:800;}
.fb-copy{display:flex;flex-direction:column;gap:8px;}

.fb-hostbar{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:14px;color:var(--muted);font-size:11px;font-family:'Space Mono',monospace;text-transform:uppercase;letter-spacing:.1em;}
.fb-hostbar button{background:transparent;border:1.5px dashed var(--line);color:var(--muted);border-radius:8px;padding:7px 11px;font-size:11px;cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:.08em;}
.fb-hostbar button:hover{color:var(--ink);border-color:var(--ink);}
.fb-topbackwrap{display:flex;justify-content:center;margin:-8px 0 16px;}
.fb-topback{background:transparent;border:1.5px dashed var(--line);color:var(--muted);border-radius:8px;padding:7px 14px;
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;}
.fb-topback:hover{color:var(--ink);border-color:var(--ink);}

@media (prefers-reduced-motion:reduce){
  .fb-vtimer.pulse{animation:none;}.fb-vt-disc{transition:none;}.fb-btn{transition:none;}.fb-slip{animation:none;}
}
`;
