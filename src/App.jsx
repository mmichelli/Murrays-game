import React, { useReducer, useEffect, useState, useRef, useMemo, useCallback } from "react";

/* ================================================================== *
 * 5-ROUND FISHBOWL — P2P rooms. No backend.
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
 * Won't connect inside the chat preview (sandbox blocks WebRTC).
 * Test: two browser tabs (loopback, no STUN) or phones on one WiFi
 * served over https / localhost.
 * ================================================================== */

const ROUNDS = [
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
const PALETTE = ["#2C6EE6", "#E8348B", "#1AA67E", "#7A4DE0", "#FF6A3D", "#0E8C9B"];
const MIN_WORDS = 4, MAX_TEAMS = 6, TURN_SECONDS = 60;

// Quick-play deck — actable across all five rounds, broadly recognizable, kid-safe.
const QUICK_DECK = [
  "Penguin", "Octopus", "Kangaroo", "Flamingo", "Dragon", "Shark", "Sloth", "Hedgehog", "Dolphin", "Squirrel",
  "Pizza", "Spaghetti", "Pineapple", "Taco", "Popcorn", "Cupcake", "Sushi", "Avocado", "Pretzel", "Watermelon",
  "Umbrella", "Toothbrush", "Vacuum", "Telescope", "Skateboard", "Trampoline", "Anchor", "Lawnmower", "Helicopter", "Hammock",
  "Eiffel Tower", "Pyramid", "Volcano", "Lighthouse", "Igloo", "Waterfall", "Windmill", "Treehouse",
  "Astronaut", "Pirate", "Ninja", "Wizard", "Cowboy", "Mermaid", "Vampire", "Clown", "Lifeguard", "Scarecrow", "Caveman", "Knight",
  "Sneeze", "Yoga", "Selfie", "Karate", "Juggling", "Moonwalk", "Limbo", "Tornado", "Rainbow", "Snowman",
  "Robot", "Zombie", "Unicorn", "Dinosaur", "Bagpipes", "Disco", "Karaoke", "Hula hoop",
];
const ICE = [{ urls: "stun:stun.l.google.com:19302" }];

const uid = () => Math.random().toString(36).slice(2, 8);
const shuffle = (a0) => { const a = [...a0]; for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
const zeros = (teams) => Object.fromEntries(teams.map((t) => [t.id, [0, 0, 0, 0, 0]]));
const encode = (d) => btoa(JSON.stringify({ type: d.type, sdp: d.sdp }));
const decode = (c) => new RTCSessionDescription(JSON.parse(atob(c.trim())));
const waitIce = (pc) => pc.iceGatheringState === "complete" ? Promise.resolve()
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

const initial = {
  phase: "lobby", teams: [], players: [], bowl: [],
  deck: [], discard: [], activeCard: null,
  currentRound: 1, activeTeamIdx: 0, activePlayerId: null,
  timeLeft: TURN_SECONDS, running: false, scores: {}, turnNumber: 1, lastCompleted: 0,
};

function reducer(state, a) {
  switch (a.type) {
    case "ADD_TEAM": return state.teams.length >= MAX_TEAMS ? state
      : { ...state, teams: [...state.teams, { id: uid(), name: `Team ${state.teams.length + 1}` }] };
    case "REMOVE_TEAM": return state.teams.length <= 2 ? state
      : { ...state, teams: state.teams.filter((t) => t.id !== a.id),
          players: state.players.map((p) => p.teamId === a.id ? { ...p, teamId: null } : p) };
    case "RENAME_TEAM": return { ...state, teams: state.teams.map((t) => t.id === a.id ? { ...t, name: a.name } : t) };
    case "ADD_PLAYER": return state.players.some((p) => p.id === a.player.id) ? state
      : { ...state, players: [...state.players, a.player] };
    case "REMOVE_PLAYER": return { ...state, players: state.players.filter((p) => p.id !== a.id) };
    case "SET_TEAM": return { ...state, players: state.players.map((p) => p.id === a.id ? { ...p, teamId: a.teamId } : p) };
    case "ADD_WORDS": {
      const have = new Set(state.bowl.map((w) => w.toLowerCase()));
      const add = [];
      for (const w0 of a.words) { const w = w0.trim(); if (w && !have.has(w.toLowerCase())) { have.add(w.toLowerCase()); add.push(w); } }
      return add.length ? { ...state, bowl: [...state.bowl, ...add] } : state;
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
      const t = state.timeLeft - 1;
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
function viewFor(s, pid) {
  const r = ROUNDS[s.currentRound - 1];
  const me = s.players.find((p) => p.id === pid);
  const up = s.teams[s.activeTeamIdx];
  const isActive = s.activePlayerId === pid;
  const myTeamUp = me && up && me.teamId === up.id;
  return {
    phase: s.phase, round: r && { ...r }, teams: s.teams,
    teamUpName: up?.name, teamUpColor: up?.color,
    activeName: s.players.find((p) => p.id === s.activePlayerId)?.name || "",
    timeLeft: s.timeLeft, running: s.running, scores: s.scores, turnNumber: s.turnNumber,
    myTeamId: me?.teamId, isActive,
    canClaim: s.phase === "ready" && !s.activePlayerId && myTeamUp,
    canCorrect: s.phase === "play" && s.running && isActive && !!s.activeCard,
    canResume: s.phase === "transition" && isActive,
    word: isActive && s.phase === "play" ? s.activeCard : null,
    inherited: isActive && s.phase === "ready" && !!s.activeCard && s.turnNumber > 1,
  };
}
const lobbyFor = (s, pid) => ({
  teams: s.teams.map((t, i) => ({ id: t.id, name: t.name, color: PALETTE[i % PALETTE.length] })),
  bowlCount: s.bowl.length, started: s.phase !== "lobby", youId: pid,
  roster: s.players.map((p) => ({ name: p.name, teamId: p.teamId })),
});

/* ============================== APP ============================== */
export default function App() {
  const [role, setRole] = useState(null);
  return (
    <div className="fb-root" style={{ "--accent": "#FF6A3D" }}>
      <style>{CSS}</style>
      <div className="fb-shell">
        <div className="fb-brand">🐟 FISHBOWL <span>rooms</span></div>
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
      <div className="fb-sliprow" aria-hidden="true"><span>talk</span><span>mime</span><span>peek</span></div>
      <h1 className="fb-h1 fb-xl">Five rounds.<br />One bowl.</h1>
      <p className="fb-muted">One phone opens the room. Everyone connects, drops words in the bowl together, then plays. The word only shows on whoever's giving clues.</p>
      <button className="fb-btn" onClick={() => onPick("host")}>Open a room</button>
      <button className="fb-btn fb-ghost" onClick={() => onPick("client")}>Join a room</button>
      <p className="fb-tiny">No server — phones connect directly. Same WiFi works best.</p>
    </div>
  );
}

/* ============================== HOST ============================== */
function HostApp({ onExit }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const hostId = useRef(uid()).current;
  const channels = useRef(new Map());
  const stateRef = useRef(state); stateRef.current = state;
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const view = useMemo(() => viewFor(state, hostId), [state, hostId]);

  useEffect(() => {
    channels.current.forEach((ch, pid) => {
      if (ch.readyState !== "open") return;
      const msg = state.phase === "lobby" ? { t: "lobby", lobby: lobbyFor(state, pid) } : { t: "view", view: viewFor(state, pid) };
      try { ch.send(JSON.stringify(msg)); } catch {}
    });
  }, [state]);

  useEffect(() => { if (!state.running) return; const id = setInterval(() => dispatch({ type: "TICK" }), 1000); return () => clearInterval(id); }, [state.running]);
  useEffect(() => {
    const onKey = (e) => { if (e.code === "Space" && view.canCorrect) { e.preventDefault(); dispatch({ type: "CORRECT", fromId: hostId }); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [view.canCorrect, hostId]);

  const wire = useCallback((ch) => {
    ch.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "hello") {
        const pid = uid(); channels.current.set(pid, ch); ch._pid = pid;
        dispatch({ type: "ADD_PLAYER", player: { id: pid, name: m.name || "Player", teamId: null } });
        try { ch.send(JSON.stringify({ t: "welcome", youId: pid })); } catch {}
      } else if (m.t === "setTeam" && ch._pid) dispatch({ type: "SET_TEAM", id: ch._pid, teamId: m.teamId });
      else if (m.t === "words" && ch._pid) dispatch({ type: "ADD_WORDS", words: m.words || [] });
      else if (m.t === "intent" && ch._pid) dispatch({ type: m.action, fromId: ch._pid });
    };
    ch.onclose = () => { if (ch._pid) { dispatch({ type: "REMOVE_PLAYER", id: ch._pid }); channels.current.delete(ch._pid); } };
  }, []);

  const makeAnswer = useCallback(async (joinCode) => {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pc.ondatachannel = (e) => wire(e.channel);
    await pc.setRemoteDescription(decode(joinCode));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return encode(pc.localDescription);
  }, [wire]);

  const openRoom = () => {
    if (!name.trim()) return;
    dispatch({ type: "ADD_TEAM" }); dispatch({ type: "ADD_TEAM" });
    setTimeout(() => {
      const first = stateRef.current.teams[0]?.id;
      dispatch({ type: "ADD_PLAYER", player: { id: hostId, name: name.trim(), teamId: first, isHost: true } });
    }, 0);
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
        <button className="fb-btn fb-ghost" onClick={() => dispatch({ type: "ADD_WORDS", words: QUICK_DECK })}>
          ✨ Quick play — drop in {QUICK_DECK.length} party words
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
  const [name, setName] = useState(""), [step, setStep] = useState("form");
  const [joinCode, setJoinCode] = useState(""), [answer, setAnswer] = useState(""), [status, setStatus] = useState("");
  const [lobby, setLobby] = useState(null), [view, setView] = useState(null), [myTeam, setMyTeam] = useState(null);

  const makeOffer = async () => {
    const conn = new RTCPeerConnection({ iceServers: ICE });
    const dc = conn.createDataChannel("game"); pc.current = conn; ch.current = dc;
    dc.onopen = () => { dc.send(JSON.stringify({ t: "hello", name: name.trim() })); setStatus("Connected."); setStep("lobby"); };
    dc.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "lobby") setLobby(m.lobby); else if (m.t === "view") setView(m.view); else if (m.t === "welcome") { } };
    dc.onclose = () => setStatus("Disconnected.");
    conn.onconnectionstatechange = () => { if (["failed", "disconnected"].includes(conn.connectionState)) setStatus("Connection lost. Reload to rejoin."); };
    await conn.setLocalDescription(await conn.createOffer());
    await waitIce(conn);
    setJoinCode(encode(conn.localDescription)); setStep("offer");
  };
  const connect = async () => { try { await pc.current.setRemoteDescription(decode(answer)); setStatus("Linking…"); } catch { setStatus("That reply code didn't parse."); } };
  const send = (o) => ch.current?.readyState === "open" && ch.current.send(JSON.stringify(o));
  const pickTeam = (teamId) => { setMyTeam(teamId); send({ t: "setTeam", teamId }); };

  if (view && view.phase !== "lobby") return <GameView view={view} onIntent={(action) => send({ t: "intent", action })} />;

  return (
    <div className="fb-card fb-stack">
      <h1 className="fb-h1">Join a room</h1>
      {step === "form" && (<>
        <label className="fb-label">Your name<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
        <button className="fb-btn" disabled={!name.trim()} onClick={makeOffer}>Generate my join code</button>
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
function Play({ v, onIntent }) {
  const r = v.round, pct = (v.timeLeft / TURN_SECONDS) * 100;
  const zone = v.timeLeft <= 10 ? "red" : v.timeLeft <= 20 ? "yellow" : "green";
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
        <div className="fb-slip" key={v.word}><div className="fb-word" data-word={v.word}>{v.word}</div></div>
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
