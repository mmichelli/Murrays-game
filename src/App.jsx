import React, { useReducer, useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  ROUNDS, PALETTE, MIN_WORDS, MAX_TEAMS, TURN_SECONDS, MURRAY_DECK, ICE,
  uid, encode, decode, waitIce, reducer, initial, viewFor, createHostHub,
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

/* ===================== reload persistence ======================== *
 * sessionStorage survives a page reload but is per-tab (so host + client
 * tabs in one browser stay independent) and clears when the tab closes.
 * The live WebRTC connection can't be revived — peers re-exchange codes —
 * but role, host game state and player identity all come back, so a reload
 * resumes the game instead of resetting it.
 * ------------------------------------------------------------------ */
const PK = { role: "mg.role", host: "mg.host", hostId: "mg.hostId", client: "mg.client" };
const load = (k) => { try { const v = sessionStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch { return null; } };
const save = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };
const drop = (...ks) => { try { ks.forEach((k) => sessionStorage.removeItem(k)); } catch {} };
const clearAll = () => drop(...Object.values(PK));

/* ============================== APP ============================== */
export default function App() {
  const [role, setRoleState] = useState(() => load(PK.role));
  const setRole = useCallback((r) => {
    if (r) save(PK.role, r); else clearAll(); // leaving wipes the saved game
    setRoleState(r);
  }, []);
  return (
    <div className="fb-root" style={{ "--accent": "#FF6A3D" }}>
      <style>{CSS}</style>
      <div className="fb-shell">
        <div className="fb-brand">🇿🇦 MURRAY'S GAME <span>varsity edition</span></div>
        {role && <div className="fb-topbackwrap"><button className="fb-topback" onClick={() => setRole(null)}>← Leave to start</button></div>}
        {!role && <Landing onPick={setRole} />}
        {role === "host" && <HostApp onExit={() => setRole(null)} />}
        {role === "client" && <ClientApp onExit={() => setRole(null)} />}
      </div>
    </div>
  );
}
function Landing({ onPick }) {
  return (
    <div className="fb-card fb-stack fb-center">
      <div className="fb-sliprow" aria-hidden="true"><span>praat</span><span>mime</span><span>loer</span></div>
      <h1 className="fb-h1 fb-xl">Five rounds.<br />One bowl.</h1>
      <p className="fb-muted">One phone opens the room. Everyone connects, drops words in the bowl together, then plays. The word only shows on whoever's giving clues. Howzit — let's jol.</p>
      <button className="fb-btn" onClick={() => onPick("host")}>Open a room</button>
      <button className="fb-btn fb-ghost" onClick={() => onPick("client")}>Join a room</button>
      <p className="fb-tiny">No server — phones connect directly. Same WiFi works best.</p>
    </div>
  );
}

/* ============================== HOST ============================== */
function HostApp({ onExit }) {
  // Reuse the same host id and game state across a reload.
  const hostId = useRef(load(PK.hostId) || uid()).current;
  const saved = useRef(load(PK.host)).current;
  const [state, setState] = useState(saved || initial);
  const hubRef = useRef(null);
  if (!hubRef.current) hubRef.current = createHostHub({ onState: setState, initialState: saved || initial });
  const hub = hubRef.current;
  const dispatch = useCallback((a) => hub.dispatch(a), [hub]);

  const [name, setName] = useState("");
  // If a saved game already has us as a player, skip the name screen.
  const [open, setOpen] = useState(() => !!saved?.players?.some((p) => p.id === hostId));

  const view = useMemo(() => viewFor(state, hostId), [state, hostId]);

  // Persist id + authoritative state so a reload recovers the whole game.
  useEffect(() => { save(PK.hostId, hostId); }, [hostId]);
  useEffect(() => { save(PK.host, state); }, [state]);

  // Host is the authoritative timer.
  useEffect(() => { if (!state.running) return; const id = setInterval(() => dispatch({ type: "TICK" }), 1000); return () => clearInterval(id); }, [state.running, dispatch]);
  useEffect(() => {
    const onKey = (e) => { if (e.code === "Space" && view.canCorrect) { e.preventDefault(); dispatch({ type: "CORRECT", fromId: hostId }); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [view.canCorrect, hostId, dispatch]);

  const makeAnswer = useCallback(async (joinCode) => {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pc.ondatachannel = (e) => hub.attach(e.channel);
    await pc.setRemoteDescription(decode(joinCode));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return encode(pc.localDescription);
  }, [hub]);

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
      ? <HostLobby state={state} dispatch={dispatch} hostId={hostId} makeAnswer={makeAnswer} onExit={onExit} />
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

function HostLobby({ state, dispatch, hostId, makeAnswer, onExit }) {
  const [join, setJoin] = useState(""), [reply, setReply] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const color = (i) => PALETTE[i % PALETTE.length];
  const teamsReady = state.teams.filter((t) => state.players.some((p) => p.teamId === t.id)).length >= 2;
  const placed = state.players.every((p) => p.teamId);
  const canStart = teamsReady && placed && state.bowl.length >= MIN_WORDS && state.players.length >= 2;

  const gen = async () => { setErr(""); setBusy(true); try { setReply(await makeAnswer(join)); } catch { setErr("That join code didn't parse. Copy the whole thing."); } setBusy(false); };

  return (
    <div className="fb-stack">
      <div className="fb-card fb-stack">
        <h1 className="fb-h1">Room lobby</h1>
        <h2 className="fb-h2">Teams</h2>
        {state.teams.map((t, i) => (
          <div className="fb-teamrow" key={t.id} style={{ "--tc": color(i) }}>
            <span className="fb-dot" />
            <input className="fb-input bare" value={t.name} maxLength={16} onChange={(e) => dispatch({ type: "RENAME_TEAM", id: t.id, name: e.target.value })} />
            <span className="fb-tcount">{state.players.filter((p) => p.teamId === t.id).length}</span>
            {state.teams.length > 2 && <button className="fb-x" onClick={() => dispatch({ type: "REMOVE_TEAM", id: t.id })}>×</button>}
          </div>
        ))}
        {state.teams.length < MAX_TEAMS && <button className="fb-btn fb-ghost" onClick={() => dispatch({ type: "ADD_TEAM" })}>+ add a team</button>}
        <div className="fb-rosterwrap">
          {state.players.map((p) => {
            const ti = state.teams.findIndex((t) => t.id === p.teamId);
            return <span key={p.id} className="fb-chip" style={{ "--tc": ti >= 0 ? color(ti) : "#9b927f" }}>
              <span className="fb-dot" /> {p.name}{p.isHost ? " (you)" : ""}{p.teamId ? "" : " · no team"}
            </span>;
          })}
        </div>
      </div>

      <div className="fb-card fb-stack">
        <h2 className="fb-h2">Your team</h2>
        <TeamButtons teams={state.teams} colorFn={color} value={state.players.find((p) => p.id === hostId)?.teamId}
          onPick={(teamId) => dispatch({ type: "SET_TEAM", id: hostId, teamId })} />
      </div>

      <div className="fb-card fb-stack">
        <h2 className="fb-h2">The bowl</h2>
        <p className="fb-muted"><b className="fb-num">{state.bowl.length}</b> words in — everyone adds at once. Need {MIN_WORDS}+.</p>
        <WordAdder onAdd={(ws) => dispatch({ type: "ADD_WORDS", words: ws })} />
        <button className="fb-btn fb-ghost" onClick={() => dispatch({ type: "ADD_WORDS", words: MURRAY_DECK })}>
          🇿🇦 Load Murray's deck — {MURRAY_DECK.length} SA student words
        </button>
        <p className="fb-tiny">Adds to whatever's already in. Start right away, or let people sprinkle their own on top.</p>
      </div>

      <div className="fb-card fb-stack">
        <h2 className="fb-h2">Connect a phone</h2>
        <p className="fb-muted">Player taps <b>Join</b> and reads you their <b>join code</b>:</p>
        <textarea className="fb-area" placeholder="Paste join code…" value={join} onChange={(e) => setJoin(e.target.value)} />
        <button className="fb-btn" disabled={!join.trim() || busy} onClick={gen}>{busy ? "Working…" : "Generate reply code"}</button>
        {err && <p className="fb-err">{err}</p>}
        {reply && (<>
          <p className="fb-muted">Read this <b>reply code</b> back to them:</p>
          <CopyBox value={reply} />
          <button className="fb-btn fb-ghost" onClick={() => { setJoin(""); setReply(""); }}>Connect another</button>
        </>)}
      </div>

      <button className="fb-btn fb-big" disabled={!canStart} onClick={() => dispatch({ type: "START_GAME" })}>
        {canStart ? "Start game" : state.bowl.length < MIN_WORDS ? `Add ${MIN_WORDS - state.bowl.length} more words` : !placed ? "Everyone needs a team" : "Need 2 teams with players"}
      </button>
      <button className="fb-link" onClick={onExit}>Leave</button>
    </div>
  );
}

/* ============================= CLIENT ============================= */
function ClientApp({ onExit }) {
  const pc = useRef(null), ch = useRef(null);
  const savedClient = useRef(load(PK.client) || {}).current;
  const myId = useRef(savedClient.youId || null); // the id the host gave us
  const [name, setName] = useState(savedClient.name || ""), [step, setStep] = useState("form");
  const [joinCode, setJoinCode] = useState(""), [answer, setAnswer] = useState(""), [status, setStatus] = useState("");
  const [lobby, setLobby] = useState(null), [view, setView] = useState(null), [myTeam, setMyTeam] = useState(null);
  const rejoining = !!myId.current;

  const makeOffer = async () => {
    save(PK.client, { name: name.trim(), youId: myId.current }); // prefill name on reload
    const conn = new RTCPeerConnection({ iceServers: ICE });
    const dc = conn.createDataChannel("game"); pc.current = conn; ch.current = dc;
    // Send our saved id so the host reconnects us to the same slot + team.
    dc.onopen = () => { dc.send(JSON.stringify({ t: "hello", name: name.trim(), youId: myId.current })); setStatus("Connected."); setStep("lobby"); };
    dc.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "lobby") { setLobby(m.lobby); if (m.lobby.youTeamId) setMyTeam(m.lobby.youTeamId); }
      else if (m.t === "view") setView(m.view);
      else if (m.t === "welcome") { myId.current = m.youId; save(PK.client, { name: name.trim(), youId: m.youId }); }
    };
    dc.onclose = () => setStatus("Disconnected.");
    conn.onconnectionstatechange = () => { if (["failed", "disconnected"].includes(conn.connectionState)) setStatus("Connection lost. Reload to rejoin."); };
    await conn.setLocalDescription(await conn.createOffer());
    await waitIce(conn);
    setJoinCode(encode(conn.localDescription)); setStep("offer");
  };
  const connect = async () => { try { await pc.current.setRemoteDescription(decode(answer)); setStatus("Linking…"); } catch { setStatus("That reply code didn't parse."); } };
  const send = (o) => ch.current?.readyState === "open" && ch.current.send(JSON.stringify(o));
  const pickTeam = (teamId) => { setMyTeam(teamId); send({ t: "setTeam", teamId }); };

  if (view && view.phase !== "lobby") return <GameView view={view} onIntent={(action) => send({ t: "intent", action })} optimistic />;

  return (
    <div className="fb-card fb-stack">
      <h1 className="fb-h1">Join a room</h1>
      {step === "form" && (<>
        {rejoining && <p className="fb-muted">Welcome back, <b>{name}</b> — generate a fresh code and the host will drop you back in your team, scores and all.</p>}
        <label className="fb-label">Your name<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
        <button className="fb-btn" disabled={!name.trim()} onClick={makeOffer}>{rejoining ? "Rejoin the room" : "Generate my join code"}</button>
        <button className="fb-btn fb-ghost" onClick={onExit}>Back</button>
      </>)}
      {step === "offer" && (<>
        <p className="fb-muted">1. Give the host your <b>join code</b>:</p>
        <CopyBox value={joinCode} />
        <p className="fb-muted">2. Paste the <b>reply code</b> they read back:</p>
        <textarea className="fb-area" placeholder="Paste reply code…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <button className="fb-btn" disabled={!answer.trim()} onClick={connect}>Connect</button>
        {status && <p className="fb-muted">{status}</p>}
      </>)}
      {step === "lobby" && lobby && (<>
        <div className="fb-roundtag">In the room</div>
        <h2 className="fb-h2">Pick your team</h2>
        <TeamButtons teams={lobby.teams} colorFn={(i) => lobby.teams[i].color} value={myTeam} onPick={pickTeam} />
        <h2 className="fb-h2">Add words</h2>
        <p className="fb-muted"><b className="fb-num">{lobby.bowlCount}</b> in the bowl. Everyone's adding at once.</p>
        <WordAdder onAdd={(ws) => send({ t: "words", words: ws })} />
        <p className="fb-tiny">{myTeam ? "Waiting for the host to start…" : "Pick a team to be ready."}</p>
      </>)}
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
function Play({ v, onIntent, optimistic }) {
  const r = v.round, pct = (v.timeLeft / TURN_SECONDS) * 100;
  const zone = v.timeLeft <= 10 ? "red" : v.timeLeft <= 20 ? "yellow" : "green";
  const { shown, canBuffer, bump } = useGiverWord(v, optimistic);
  const onCorrect = () => { onIntent("CORRECT"); if (optimistic && canBuffer) bump(); };
  return (
    <div className="fb-card fb-stack">
      <div className="fb-hud">
        <RoundLine r={r} />
        <span className="fb-turn" style={{ color: v.teamUpColor }}>● {v.activeName}</span>
      </div>
      <div className={`fb-timer ${zone} ${v.timeLeft <= 10 ? "pulse" : ""}`}>
        <div className="fb-bar" style={{ width: `${pct}%` }} /><span className="fb-secs">{v.timeLeft}s</span>
      </div>
      {v.isActive ? (<>
        <div className="fb-slip" key={shown}><div className="fb-word" data-word={shown}>{shown}</div></div>
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
        <div className="fb-flash big">🚨 ROUND DONE MID-TURN 🚨</div>
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
function TeamButtons({ teams, colorFn, value, onPick }) {
  return (
    <div className="fb-teampick">
      {teams.map((t, i) => (
        <button key={t.id} className={`fb-teambtn ${value === t.id ? "on" : ""}`} style={{ "--tc": colorFn(i) }} onClick={() => onPick(t.id)}>{t.name}</button>
      ))}
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
      {added > 0 && <p className="fb-tiny">You've added {added}. Keep going or pass the phone — words are hidden from everyone.</p>}
    </div>
  );
}
function CopyBox({ value }) {
  const [ok, setOk] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); } catch {} setOk(true); setTimeout(() => setOk(false), 1400); };
  return (
    <div className="fb-copy">
      <textarea className="fb-area mono" readOnly value={value} onFocus={(e) => e.target.select()} />
      <button className="fb-btn" onClick={copy}>{ok ? "Copied ✓" : "Copy code"}</button>
    </div>
  );
}

/* ============================== CSS ============================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;800&family=Space+Mono:wght@400;700&display=swap');
.fb-root{
  --paper:#E9E3D3; --panel:#F3EEE0; --slip:#FBF7EC; --ink:#221C18; --muted:#8A8173; --line:#D7CFBC;
  --green:#1AA67E; --amber:#E8920A; --red:#E0322B;
  min-height:100vh;background:var(--paper);color:var(--ink);
  font-family:Archivo,system-ui,sans-serif;display:flex;justify-content:center;padding:18px;box-sizing:border-box;position:relative;
}
.fb-root::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;mix-blend-mode:multiply;opacity:.5;
  background-image:radial-gradient(circle at 1px 1px, rgba(34,28,24,.16) 0 1px, transparent 1.6px);background-size:4px 4px;}
.fb-shell{width:100%;max-width:540px;position:relative;z-index:1;}
.fb-brand{font-family:Anton,'Arial Narrow',sans-serif;letter-spacing:.06em;font-size:22px;text-align:center;margin:2px 0 18px;color:var(--ink);text-transform:uppercase;}
.fb-brand span{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.18em;color:var(--accent);vertical-align:3px;text-transform:lowercase;}

.fb-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;
  box-shadow:0 1px 0 #fff inset, 0 14px 30px rgba(40,28,18,.10);}
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

.fb-teamrow{display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--line);border-radius:8px;padding:5px 12px;}
.fb-tcount{font-family:'Space Mono',monospace;color:var(--muted);font-size:13px;min-width:16px;text-align:right;}
.fb-dot{width:11px;height:11px;border-radius:50%;background:var(--tc);flex:none;}
.fb-rosterwrap{display:flex;flex-wrap:wrap;gap:7px;}
.fb-chip{background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:6px 11px;color:var(--ink);font-size:13px;display:inline-flex;align-items:center;gap:7px;}
.fb-teampick{display:flex;gap:8px;flex-wrap:wrap;}
.fb-teambtn{flex:1 1 40%;background:#fff;border:1.5px solid var(--line);border-radius:8px;padding:12px;color:var(--muted);font-weight:800;font-family:inherit;font-size:15px;cursor:pointer;}
.fb-teambtn.on{border-color:var(--tc);color:var(--tc);box-shadow:2px 2px 0 var(--tc);}

.fb-roundline{display:flex;flex-direction:column;gap:6px;align-items:flex-start;}
.fb-center .fb-roundline{align-items:center;}
.fb-roundtag{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);}
.fb-dots{display:inline-flex;gap:5px;}
.fb-pip{width:8px;height:8px;border-radius:50%;border:1.6px solid var(--accent);box-sizing:border-box;}
.fb-pip.on{background:var(--accent);}
.fb-hud{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.fb-turn{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;white-space:nowrap;}

.fb-timer{position:relative;height:42px;border-radius:8px;background:#fff;overflow:hidden;border:1.5px solid var(--ink);display:flex;align-items:center;}
.fb-bar{height:100%;transition:width 1s linear;opacity:.9;}
.fb-timer.green .fb-bar{background:var(--green);}.fb-timer.yellow .fb-bar{background:var(--amber);}.fb-timer.red .fb-bar{background:var(--red);}
.fb-secs{position:absolute;left:0;right:0;text-align:center;font-family:'Space Mono',monospace;font-weight:700;font-size:17px;color:var(--ink);}
.fb-timer.pulse{animation:fbp .8s ease-in-out infinite;}@keyframes fbp{50%{box-shadow:inset 0 0 0 2px var(--red);}}

.fb-slip{position:relative;align-self:center;max-width:100%;background:var(--slip);padding:26px 20px 22px;border-radius:8px;
  box-shadow:0 14px 28px rgba(40,28,18,.18);transform:rotate(-1.1deg);animation:slipdrop .28s cubic-bezier(.2,.85,.3,1);}
.fb-slip::before{content:"";position:absolute;top:-2px;left:10px;right:10px;height:8px;
  background:radial-gradient(circle at 6px -2px, var(--paper) 0 5px, transparent 5.5px) repeat-x;background-size:12px 8px;}
@keyframes slipdrop{from{transform:translateY(-18px) rotate(2.5deg);opacity:0;}to{transform:translateY(0) rotate(-1.1deg);opacity:1;}}
.fb-word{position:relative;z-index:0;font-family:Anton,'Arial Narrow',sans-serif;text-transform:uppercase;text-align:center;
  font-size:clamp(40px,13vw,78px);line-height:1.0;letter-spacing:.01em;color:var(--ink);word-break:break-word;}
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
  .fb-timer.pulse{animation:none;}.fb-bar{transition:none;}.fb-btn{transition:none;}.fb-slip{animation:none;}
}
`;
