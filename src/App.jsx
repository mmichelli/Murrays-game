import React, { useReducer, useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  ROUNDS, PALETTE, MIN_WORDS, MAX_TEAMS, TURN_SECONDS, MURRAY_DECK,
  uid, initial, viewFor, createHostHub,
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

  // Host is the authoritative timer.
  useEffect(() => { if (!state.running) return; const id = setInterval(() => dispatch({ type: "TICK" }), 1000); return () => clearInterval(id); }, [state.running, dispatch]);
  useEffect(() => {
    const onKey = (e) => { if (e.code === "Space" && view.canCorrect) { e.preventDefault(); dispatch({ type: "CORRECT", fromId: hostId }); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [view.canCorrect, hostId, dispatch]);

  // Once the room is open, claim our room id on the broker and accept
  // every phone that connects to the shared link.
  useEffect(() => {
    if (!open) return;
    let peer, cancelled = false;
    (async () => {
      const { default: Peer } = await import("peerjs");
      if (cancelled) return;
      peer = new Peer(peerIdFor(roomCode), { debug: 1 });
      peerRef.current = peer;
      peer.on("open", () => setPeerStatus("online"));
      peer.on("connection", (conn) => hub.attach(peerChannel(conn)));
      peer.on("error", (err) => { if (err?.type === "unavailable-id") setPeerStatus("error"); });
    })();
    return () => { cancelled = true; try { peer && peer.destroy(); } catch {} };
  }, [open, roomCode, hub]);

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
  const teamsReady = state.teams.filter((t) => state.players.some((p) => p.teamId === t.id)).length >= 2;
  const placed = state.players.every((p) => p.teamId);
  const bowlReady = state.bowl.length >= MIN_WORDS;
  const clients = state.players.filter((p) => !p.isHost).length;
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
  const roster = state.players.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, isHost: p.isHost }));

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
          <p className="fb-muted"><b className="fb-num">{state.bowl.length}</b> in the bowl — everyone adds at once. Need {MIN_WORDS}+ to start.</p>
          <WordAdder onAdd={(ws) => dispatch({ type: "ADD_WORDS", words: ws })} />
          <button className="fb-btn fb-ghost" onClick={() => dispatch({ type: "ADD_WORDS", words: MURRAY_DECK })}>
            🇿🇦 Load Murray's deck — {MURRAY_DECK.length} words
          </button>
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

/* ============================= CLIENT ============================= */
function ClientApp({ onExit, initialRoom }) {
  const connRef = useRef(null), peerRef = useRef(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialRoom || "");
  const [step, setStep] = useState("form"); // form | connecting | lobby
  const [status, setStatus] = useState("");
  const [lobby, setLobby] = useState(null), [view, setView] = useState(null);

  const send = (o) => { const c = connRef.current; if (c && c.open) { try { c.send(JSON.stringify(o)); } catch {} } };

  // who am I, and which group am I in — read straight off the host's snapshot
  const myId = lobby?.youId;
  const myTeam = lobby?.roster.find((p) => p.id === myId)?.teamId ?? null;

  const join = async () => {
    if (!name.trim() || !code.trim()) return;
    setStep("connecting"); setStatus("Reaching the room…");
    const { default: Peer } = await import("peerjs");
    const peer = new Peer({ debug: 1 }); peerRef.current = peer;
    peer.on("open", () => {
      const conn = peer.connect(peerIdFor(code), { reliable: true });
      connRef.current = conn;
      conn.on("open", () => { conn.send(JSON.stringify({ t: "hello", name: name.trim() })); setStatus("Connected."); setStep("lobby"); });
      conn.on("data", (d) => { try { const m = JSON.parse(d); if (m.t === "lobby") setLobby(m.lobby); else if (m.t === "view") setView(m.view); } catch {} });
      conn.on("close", () => setStatus("Disconnected. Reload the link to rejoin."));
      conn.on("error", () => { setStatus("Couldn't reach that room. Check the code with the host."); setStep("form"); });
    });
    peer.on("error", (err) => {
      setStatus(err?.type === "peer-unavailable"
        ? "No room with that code — ask the host to re-share the link."
        : "Connection trouble. Try again, or check your signal.");
      setStep("form");
    });
  };

  useEffect(() => () => { try { peerRef.current?.destroy(); } catch {} }, []);

  if (view && view.phase !== "lobby") return <GameView view={view} onIntent={(action) => send({ t: "intent", action })} />;

  return (
    <div className="fb-card fb-stack">
      <h1 className="fb-h1">Join a room</h1>
      {step === "form" && (<>
        {initialRoom && <p className="fb-muted">Joining room <b className="fb-code">{initialRoom}</b> — just pop your name in.</p>}
        <label className="fb-label">Your name<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus /></label>
        {!initialRoom && <label className="fb-label">Room code<input className="fb-input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} placeholder="e.g. kx7m2p" /></label>}
        <button className="fb-btn" disabled={!name.trim() || !code.trim()} onClick={join}>Join room</button>
        {status && <p className="fb-err">{status}</p>}
        <button className="fb-btn fb-ghost" onClick={onExit}>Back</button>
      </>)}
      {step === "connecting" && <p className="fb-muted">{status}</p>}
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
        <WordAdder onAdd={(ws) => send({ t: "words", words: ws })} />
        <p className="fb-tiny">{myTeam ? "Waiting for the host to start…" : "Join a group to be ready."}</p>
      </>)}
    </div>
  );
}

/* ===================== shared in-game view ======================= */
function GameView({ view, onIntent }) {
  const accent = view.phase === "endgame" ? "#FF6A3D" : view.round?.accent || "#FF6A3D";
  return (
    <div style={{ "--accent": accent }}>
      {view.phase === "ready" && <Ready v={view} onIntent={onIntent} />}
      {view.phase === "play" && <Play v={view} onIntent={onIntent} />}
      {view.phase === "transition" && <Transition v={view} onIntent={onIntent} />}
      {view.phase === "endgame" && <Endgame v={view} />}
    </div>
  );
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
      <h1 className="fb-h1 fb-xl" style={{ color: v.teamUpColor }}>{v.teamUpName}</h1>
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
    const fit = () => {
      const px = (e, a, b) => { const s = getComputedStyle(e); return parseFloat(s[a]) + parseFloat(s[b]); };
      const avail = card.clientWidth - px(card, "paddingLeft", "paddingRight") - px(slip, "paddingLeft", "paddingRight") - 2;
      if (avail <= 0) return;
      el.style.whiteSpace = "nowrap";
      el.style.wordBreak = "normal";
      el.style.fontSize = WORD_MAX + "px";
      const natural = el.scrollWidth;
      const next = natural > avail ? Math.max(WORD_MIN, Math.floor((WORD_MAX * avail) / natural)) : WORD_MAX;
      el.style.fontSize = next + "px";
      if (next <= WORD_MIN && el.scrollWidth > avail) { el.style.whiteSpace = "normal"; el.style.wordBreak = "break-word"; }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(card);
    document.fonts?.ready?.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [word]);
  return (
    <div className="fb-slip" ref={slipRef} key={word}>
      <div className="fb-word" data-word={word} ref={wordRef}>{word}</div>
    </div>
  );
}
function Play({ v, onIntent }) {
  const r = v.round;
  return (
    <div className="fb-card fb-stack">
      <div className="fb-hud">
        <RoundLine r={r} />
        <span className="fb-turn" style={{ color: v.teamUpColor }}>● {v.activeName}</span>
      </div>
      <VisualTimer timeLeft={v.timeLeft} total={TURN_SECONDS} />
      {v.isActive ? (<>
        <WordSlip word={v.word} />
        <Rules r={r} tight />
        <button className="fb-btn fb-correct" onClick={() => onIntent("CORRECT")}>CORRECT <span>(Spacebar)</span></button>
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
      <h1 className="fb-h1 fb-xl" style={{ color: winners[0].color }}>{winners.length > 1 ? "It's a tie!" : `${winners[0].name} wins!`}</h1>
      {ranked.map((t, i) => (
        <div className="fb-rankrow" key={t.id} style={{ "--tc": t.color }}>
          <span className="fb-rank">{i + 1}</span><span className="fb-dot" />
          <span className="fb-rankname">{t.name}</span><span className="fb-ranktotal">{total(t.id)}</span>
        </div>
      ))}
      <details className="fb-details"><summary>Round-by-round</summary>
        <div className="fb-scroll"><table className="fb-table">
          <thead><tr><th>Team</th>{ROUNDS.map((r) => <th key={r.n}>{r.icon}</th>)}</tr></thead>
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
                  <span key={p.id} className="fb-chip" style={{ "--tc": t.color }}>
                    <span className="fb-dot" /> {p.name}{p.id === myId ? " (you)" : ""}{p.isHost ? " · host" : ""}
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
function WordAdder({ onAdd }) {
  const [draft, setDraft] = useState(""), [added, setAdded] = useState(0);
  const add = () => { const w = draft.trim(); if (!w) return; onAdd([w]); setDraft(""); setAdded((n) => n + 1); };
  return (
    <div className="fb-stack">
      <div className="fb-row">
        <input className="fb-input" value={draft} placeholder="Type a word…" maxLength={40} autoFocus
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="fb-btn fb-add" onClick={add}>Add</button>
      </div>
      {added > 0 && <p className="fb-tiny">Added {added} — hidden from everyone. Keep going.</p>}
    </div>
  );
}
/* ============================== CSS ============================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;800&family=Space+Mono:wght@400;700&display=swap');
.fb-root{
  --paper:#E9E3D3; --panel:#F3EEE0; --slip:#FBF7EC; --ink:#221C18; --muted:#8A8173; --line:#D7CFBC;
  --green:#1AA67E; --amber:#E8920A; --red:#E0322B;
  /* paper stock: a warm sheet, lit unevenly, with one soft shadow corner */
  min-height:100vh;color:var(--ink);
  background-color:var(--paper);
  background-image:
    radial-gradient(150% 100% at 50% -25%, rgba(255,253,246,.66), rgba(255,253,246,0) 60%),
    radial-gradient(95% 80% at 9% 5%, rgba(255,250,236,.5), rgba(255,250,236,0) 46%),
    radial-gradient(130% 120% at 93% 105%, rgba(120,94,56,.16), rgba(120,94,56,0) 55%);
  background-attachment:fixed;
  font-family:Archivo,system-ui,sans-serif;display:flex;justify-content:center;padding:18px;box-sizing:border-box;position:relative;
}
/* fine fibre grain printed over the whole surface — paper, cards and all */
.fb-root::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:100;mix-blend-mode:multiply;opacity:.1;
  background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.82'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='180'%20height='180'%20filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:180px 180px;}
.fb-shell{width:100%;max-width:540px;position:relative;z-index:1;}
.fb-brand{font-family:Anton,'Arial Narrow',sans-serif;letter-spacing:.06em;font-size:22px;text-align:center;margin:2px 0 18px;color:var(--ink);text-transform:uppercase;}
.fb-brand::after{content:"";display:block;width:132px;height:4px;margin:9px auto 0;border-radius:3px;
  background:linear-gradient(90deg,#007A4D 0 30%,#FFB81C 30% 45%,#DE3831 45% 70%,#0b3aa1 70% 100%);
  box-shadow:0 1px 0 rgba(255,255,255,.55);}

/* every card is a leaf from a South African exercise book: feint blue
   rule lines, a red margin down the left, and a punched binding strip. */
.fb-card{position:relative;border:1px solid var(--line);border-radius:12px;padding:34px 22px 22px 30px;
  background-color:var(--panel);
  background-image:
    linear-gradient(90deg, transparent 0 22px, rgba(201,68,68,.42) 22px 23px, transparent 23px),
    repeating-linear-gradient(180deg, transparent 0 27px, rgba(54,86,148,.13) 27px 28px);
  background-position:0 0, 0 34px;
  box-shadow:0 1px 0 #fff inset, 0 14px 30px rgba(40,28,18,.12);}
.fb-card::before{content:"";position:absolute;left:16px;right:16px;top:12px;height:12px;pointer-events:none;
  background-image:radial-gradient(circle at 50% 50%, var(--paper) 0 4px, rgba(34,28,24,.22) 4px 5px, transparent 5.5px);
  background-size:30px 12px;background-repeat:repeat-x;}
.fb-stack{display:flex;flex-direction:column;gap:12px;}
.fb-center{text-align:center;align-items:center;}

.fb-h1{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;letter-spacing:.01em;font-size:27px;margin:0;text-transform:uppercase;line-height:1;}
.fb-h2{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.14em;margin:0;text-transform:uppercase;color:var(--muted);}
.fb-xl{font-size:clamp(38px,11vw,58px);line-height:.96;}
.fb-muted{color:var(--muted);margin:0;font-size:14.5px;line-height:1.45;}
.fb-muted b{color:var(--ink);}
.fb-tiny{color:var(--muted);font-size:12px;margin:0;font-family:'Space Mono',monospace;}
.fb-num{font-family:Anton,sans-serif;font-weight:400;font-size:22px;color:var(--accent);vertical-align:-2px;margin-right:2px;}
.fb-link{background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit;text-decoration:underline;padding:4px;}

.fb-label{display:flex;flex-direction:column;gap:6px;font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;}
.fb-input{background:#fff;border:1.5px solid var(--line);border-radius:8px;color:var(--ink);padding:12px 13px;font-size:16px;font-family:inherit;width:100%;box-sizing:border-box;}
.fb-input:focus{outline:none;border-color:var(--ink);box-shadow:2px 2px 0 var(--accent);}
.fb-input.bare{background:transparent;border:none;padding:6px 0;font-weight:800;font-size:17px;box-shadow:none;}
.fb-input.bare:focus{outline:none;box-shadow:none;border-bottom:2px solid var(--tc);}
.fb-area{background:#fff;border:1.5px solid var(--line);border-radius:8px;color:var(--ink);padding:11px;font-size:13px;width:100%;box-sizing:border-box;min-height:60px;resize:vertical;font-family:inherit;}
.fb-area:focus{outline:none;border-color:var(--ink);box-shadow:2px 2px 0 var(--accent);}
.fb-area.mono{font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);}
.fb-row{display:flex;gap:8px;}
.fb-add{width:auto;padding-left:18px;padding-right:18px;}

.fb-btn{background:var(--ink);color:var(--paper);border:none;border-radius:8px;padding:14px 16px;font-size:16px;font-weight:800;
  font-family:Archivo,sans-serif;cursor:pointer;width:100%;box-shadow:3px 3px 0 var(--accent);transition:transform .08s,box-shadow .08s;}
.fb-btn:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--accent);}
.fb-btn:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--accent);}
.fb-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none;}
.fb-btn:focus-visible{outline:2.5px solid var(--ink);outline-offset:2px;}
.fb-ghost{background:transparent;color:var(--ink);border:1.5px dashed var(--line);box-shadow:none;}
.fb-ghost:hover:not(:disabled){transform:none;box-shadow:none;border-color:var(--ink);}
.fb-big{padding:17px;font-size:18px;}
.fb-x{background:none;border:1.5px solid var(--line);color:var(--muted);border-radius:8px;width:36px;height:36px;font-size:19px;cursor:pointer;flex:none;}
.fb-x:hover{color:var(--ink);border-color:var(--tc);}
.fb-err{color:var(--red);margin:0;font-size:13px;font-family:'Space Mono',monospace;}

.fb-sliprow{display:flex;gap:9px;justify-content:center;margin-bottom:6px;}
.fb-sliprow span{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;
  background:var(--slip);padding:8px 12px;border-radius:6px;box-shadow:0 7px 14px rgba(40,28,18,.16);}
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

.fb-qr{width:200px;height:200px;border-radius:10px;background:var(--slip);padding:8px;box-shadow:0 10px 22px rgba(40,28,18,.16);image-rendering:pixelated;}
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
  background:conic-gradient(var(--zone) var(--fbdeg), rgba(34,28,24,.07) var(--fbdeg) 360deg);
  transition:--fbdeg 1s linear;box-shadow:0 16px 32px rgba(40,28,18,.20), 0 1px 0 #fff inset;}
.fb-vt-ticks{position:absolute;inset:0;border-radius:50%;pointer-events:none;opacity:.5;
  background:repeating-conic-gradient(from -.7deg, var(--ink) 0 1.4deg, transparent 1.4deg 30deg);
  -webkit-mask:radial-gradient(circle, transparent 0 calc(50% - 15px), #000 calc(50% - 15px) calc(50% - 4px), transparent calc(50% - 4px));
          mask:radial-gradient(circle, transparent 0 calc(50% - 15px), #000 calc(50% - 15px) calc(50% - 4px), transparent calc(50% - 4px));}
.fb-vt-hub{position:absolute;inset:23%;border-radius:50%;background:var(--slip);border:2px solid var(--ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 5px 12px rgba(40,28,18,.14);}
.fb-vt-secs{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;font-size:clamp(38px,15vw,58px);line-height:.85;color:var(--ink);font-variant-numeric:tabular-nums;}
.fb-vtimer.red .fb-vt-secs{color:var(--red);}
.fb-vt-unit{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.fb-vtimer.pulse{animation:fbvt .85s ease-in-out infinite;}@keyframes fbvt{50%{transform:scale(1.045);}}

.fb-slip{position:relative;align-self:center;max-width:100%;background:var(--slip);padding:26px 20px 22px;border-radius:8px;
  box-shadow:0 14px 28px rgba(40,28,18,.18);transform:rotate(-1.1deg);animation:slipdrop .28s cubic-bezier(.2,.85,.3,1);}
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
.fb-correct{background:var(--accent);color:#fff;font-family:Anton,sans-serif;font-weight:400;font-size:25px;letter-spacing:.04em;padding:20px;box-shadow:4px 4px 0 var(--ink);}
.fb-correct:hover:not(:disabled){box-shadow:5px 5px 0 var(--ink);}
.fb-correct:active:not(:disabled){box-shadow:1px 1px 0 var(--ink);}
.fb-correct span{font-family:'Space Mono',monospace;font-size:11px;opacity:.85;font-weight:700;}
.fb-noskip{text-align:center;color:var(--muted);font-size:11px;margin:0;font-family:'Space Mono',monospace;}

.fb-flash{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;letter-spacing:.04em;color:var(--ink);
  background:var(--slip);border:1.5px dashed var(--ink);padding:9px 13px;border-radius:8px;}
.fb-flash.big{font-family:Anton,sans-serif;font-weight:400;font-size:20px;letter-spacing:.03em;}
.fb-inherit{color:var(--accent);font-weight:700;margin:0;font-size:13px;font-family:'Space Mono',monospace;}
.fb-paused{margin:0;color:var(--muted);font-family:'Space Mono',monospace;font-size:13px;}.fb-paused b{color:var(--ink);font-size:18px;}
.fb-nextsetup{font-family:Anton,sans-serif;font-size:21px;color:var(--accent);display:flex;flex-direction:column;gap:5px;line-height:1.1;}
.fb-nextsetup span{font-family:Archivo,sans-serif;font-size:13px;color:var(--muted);}

.fb-standings{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;width:100%;color:var(--muted);font-size:13px;border-top:1.5px dashed var(--line);padding-top:12px;font-family:'Space Mono',monospace;}
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
