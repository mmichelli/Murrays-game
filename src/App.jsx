import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  ROUNDS, PALETTE, MIN_WORDS, MAX_TEAMS, TURN_SECONDS, WORDS_PER_PLAYER, sampleDeck, deckTopUp,
  uid, initial, viewFor, createHostHub, peerOptions,
} from "./engine.js";
import { LANGS, detectLang, saveLang, makeT, randomTeamName } from "./i18n.js";
import { RoundIcon, MurrayPix, AlarmIcon, LoaderIcon, ChevronIcon, CheckIcon, CloseIcon, PlusIcon, PlayIcon, AlertIcon } from "./pixel.jsx";
import { CSS } from "./styles.js";

/* ---------------------------- language ---------------------------- *
 * One context carries the chosen language + a translator down to every
 * component. The choice follows the browser on first load and is then
 * remembered (localStorage), so a returning player keeps their flag.
 * Language is a per-device display preference - it never touches the
 * shared game state, so two phones in one room can read it each in their
 * own tongue.
 * ------------------------------------------------------------------ */
const LangCtx = createContext(null);
function LangProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);
  const setLang = useCallback((code) => { saveLang(code); setLangState(code); }, []);
  const t = useMemo(() => makeT(lang), [lang]);
  useEffect(() => { try { document.documentElement.lang = lang; } catch {} }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}
const useLang = () => useContext(LangCtx);
const useT = () => useContext(LangCtx).t;
// Render a translated value that may be a plain string or an array of
// segments (a `{ b }` segment becomes <b>), used for the few strings that
// need inline bold (e.g. "Joining room CODE.").
function Tr({ value, boldClass }) {
  if (Array.isArray(value)) return <>{value.map((seg, i) => seg && typeof seg === "object" ? <b key={i} className={boldClass}>{seg.b}</b> : <React.Fragment key={i}>{seg}</React.Fragment>)}</>;
  return <>{value}</>;
}
// Compact language toggle: two-letter codes (EN / NO) in a brutalist
// segmented pill; the live one is highlighted. Tapping switches language
// everywhere instantly and remembers the choice.
function LangSwitcher() {
  const { lang, setLang, t } = useLang();
  return (
    <div className="fb-langs" role="group" aria-label={t("lang.label")}>
      {LANGS.map((l) => (
        <button key={l.code} type="button" className={`fb-lang ${l.code === lang ? "on" : ""}`}
          aria-pressed={l.code === lang} title={l.label} aria-label={l.label} onClick={() => setLang(l.code)}>
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- accent ----------------------------- *
 * The app's highlight colour. It defaults to the brand neon blue, but
 * once you join a group it follows THAT group's colour - so your buttons,
 * the brand shadow and the live flag all wear your team's colour. It's a
 * per-device cue (set by the host/client subtree from the player's own
 * team) and resets to the brand when you're not in a group.
 * ------------------------------------------------------------------ */
const BRAND_ACCENT = "#3B6EA5";
const AccentCtx = createContext(null);
function AccentProvider({ children }) {
  const [accent, setAccentState] = useState(BRAND_ACCENT);
  // Guard against redundant renders when the same colour is reasserted.
  const setAccent = useCallback((c) => setAccentState(c || BRAND_ACCENT), []);
  const value = useMemo(() => ({ accent, setAccent }), [accent, setAccent]);
  return <AccentCtx.Provider value={value}>{children}</AccentCtx.Provider>;
}
const useAccent = () => useContext(AccentCtx);
// Drive the app accent from the player's team colour for as long as the
// component is mounted, restoring the brand colour when they leave.
function useFollowTeamAccent(color) {
  const { setAccent } = useAccent();
  useEffect(() => { setAccent(color || BRAND_ACCENT); return () => setAccent(BRAND_ACCENT); }, [color, setAccent]);
}

/* ================================================================== *
 * MURRAY'S GAME - a 5-round Fishbowl party game (English / Norwegian).
 * P2P rooms, no backend.
 *
 * One HOST phone is the room (authoritative engine + timer + hub).
 * Every other phone joins via a shareable link (PeerJS handshake), then:
 *   - all phones add words to the shared wordlist in PARALLEL
 *   - N teams
 *   - on each turn, ONE phone per team claims the word + CORRECT button
 * The word is only ever sent to the active clue-giver's device.
 *
 * Visual identity: chunky neo-brutalism with pixel-art icons. The secret
 * word arrives as a torn paper slip with a colored misregistration
 * ghost in the round's ink.
 *
 * Pure game logic + the P2P host hub live in ./engine.js (unit-tested);
 * the language layer is ./i18n.js.
 *
 * Test P2P with two browser tabs, or phones on one WiFi served over
 * https / localhost (WebRTC needs a secure context).
 * ================================================================== */

/* ----------------------- link-join plumbing ----------------------- *
 * The room is reached by a shareable link (?room=CODE) instead of
 * copy-pasting SDP blobs. PeerJS brokers ONLY the WebRTC handshake;
 * once connected, game data - words included - flows directly phone
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
// dropped-and-restored connection rejoins as the SAME player - keeping the
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
// Reload persistence. The WebRTC link itself dies on reload, but PeerJS can
// re-establish it through the broker - so if we remember the room (host code /
// client name+code) and the in-progress game, a refresh silently re-dials and
// drops everyone back exactly where they were. sessionStorage survives a
// reload, is per-tab (so host + client tabs in one browser stay independent),
// and clears when the tab closes. Leaving the room wipes it.
const PK = { role: "mrysg.role", host: "mrysg.host", client: "mrysg.client" };
const ssGet = (k) => { try { const v = sessionStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ssDel = (...ks) => { try { ks.forEach((k) => sessionStorage.removeItem(k)); } catch {} };

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
  return (
    <LangProvider>
      <AccentProvider>
        <AppInner />
      </AccentProvider>
    </LangProvider>
  );
}
function AppInner() {
  const t = useT();
  const { accent } = useAccent();
  const initialRoom = useRef(readRoomParam()).current;
  // Restore the role across a reload (per-tab), so a refresh resumes hosting /
  // playing instead of dropping back to the landing page.
  const [role, setRoleState] = useState(() => ssGet(PK.role) || (initialRoom ? "client" : null));
  const setRole = useCallback((r) => {
    if (r) ssSet(PK.role, r); else ssDel(PK.role, PK.host, PK.client); // leaving wipes the saved game
    setRoleState(r);
  }, []);
  return (
    <div className="fb-root" style={{ "--accent": accent }}>
      <style>{CSS}</style>
      <div className="fb-shell">
        <div className="fb-topbar">
          {role && <button type="button" className="fb-brand" onClick={() => setRole(null)} title={t("common.home")} aria-label={t("common.home")}>MURRAY'S GAME</button>}
          <LangSwitcher />
        </div>
        {!role && <Landing onPick={setRole} />}
        {role === "host" && <HostApp onExit={() => setRole(null)} />}
        {role === "client" && <ClientApp onExit={() => setRole(null)} initialRoom={initialRoom} />}
      </div>
    </div>
  );
}
function Landing({ onPick }) {
  const t = useT();
  return (
    <div className="fb-stack">
      <div className="fb-hero">
        <div className="fb-sliprow" aria-hidden="true">{(t("landing.slips") || []).map((w, i) => <span key={i}>{w}</span>)}</div>
        <h1 className="fb-herobrand">MURRAY'S GAME</h1>
        <div className="fb-herotag">{t("landing.heroTag")}</div>
        <div className="fb-herosub">{t("landing.heroSub")}</div>
      </div>
    <div className="fb-card fb-stack fb-center">
      <p className="fb-muted">{t("landing.lead")} <b>Fishbowl</b>, <b>Celebrity</b>, <b>Salad Bowl</b>, <b>Monikers</b> {t("landing.or")} <b>{t("landing.hatGame")}</b>. {t("landing.tail")}</p>
      <div className="fb-roundlist">
        <div className="fb-roundlisttop">{t("landing.harder")}</div>
        <ol className="fb-rounds">
          {ROUNDS.map((r) => (
            <li key={r.n} style={{ "--tc": r.accent }}>
              <span className="fb-rname"><RoundIcon n={r.n} /> {t(`round.${r.n}.name`)}</span>
              <span className="fb-rgloss">{t(`round.${r.n}.gloss`)}</span>
            </li>
          ))}
        </ol>
      </div>
      <button className="fb-btn" onClick={() => onPick("host")}>{t("landing.openRoom")}</button>
      <button className="fb-btn fb-ghost" onClick={() => onPick("client")}>{t("landing.joinRoom")}</button>
      <div className="fb-murray">
        <span className="fb-murraypic"><MurrayPix size={58} /></span>
        <p className="fb-tiny">{t("landing.named")}</p>
      </div>
    </div>
    </div>
  );
}

/* ============================== HOST ============================== */
function HostApp({ onExit }) {
  const { lang, t } = useLang();
  // Rehydrate the room across a reload: same code (so phones reconnect to the
  // same broker id), same host identity, same in-progress game.
  const saved = useRef(ssGet(PK.host)).current;
  const hostId = useRef(saved?.hostId || uid()).current;
  const roomCode = useRef(saved?.roomCode || makeRoomCode()).current;
  const [state, setState] = useState(saved?.state || initial);
  // Latest language, read by the hub when a phone asks for a new group so the
  // name it coins matches the host's chosen language.
  const langRef = useRef(lang); langRef.current = lang;
  const hubRef = useRef(null);
  if (!hubRef.current) hubRef.current = createHostHub({
    onState: setState, initialState: saved?.state || initial,
    nextTeamName: (taken) => randomTeamName(langRef.current, taken),
  });
  const hub = hubRef.current;
  const dispatch = useCallback((a) => hub.dispatch(a), [hub]);
  // Add a group under a fun, themed name, avoiding the ones already in play.
  const addTeam = useCallback(() => dispatch({ type: "ADD_TEAM", name: randomTeamName(langRef.current, hub.getState().teams.map((tm) => tm.name)) }), [dispatch, hub]);

  const [name, setName] = useState(saved?.name || "");
  const [open, setOpen] = useState(!!saved?.open);
  const [peerStatus, setPeerStatus] = useState("connecting"); // connecting | online | error
  const peerRef = useRef(null);

  const view = useMemo(() => viewFor(state, hostId), [state, hostId]);

  // Once the host picks a group, the whole UI's highlight follows that
  // group's colour. Derived from the team's palette slot so it holds in the
  // lobby (before START_GAME stamps colours on the teams) too.
  const myTeamColor = useMemo(() => {
    const tid = state.players.find((p) => p.id === hostId)?.teamId;
    const i = state.teams.findIndex((tm) => tm.id === tid);
    return i >= 0 ? PALETTE[i % PALETTE.length] : null;
  }, [state.players, state.teams, hostId]);
  useFollowTeamAccent(myTeamColor);

  // Persist enough to recover the room on reload (per-tab).
  useEffect(() => { ssSet(PK.host, { hostId, roomCode, name, open, state }); }, [hostId, roomCode, name, open, state]);

  // Host is the authoritative timer, driven by the wall clock so a screen
  // lock or backgrounded tab (which throttles/pauses setInterval) doesn't
  // freeze the countdown - each tick drains the real seconds elapsed, and we
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
    let peer, cancelled = false, retry = 0, idRetry = 0, timer = null;
    const FATAL = ["invalid-id", "invalid-key", "browser-incompatible", "ssl-unavailable"];
    const backoff = () => { clearTimeout(timer); timer = setTimeout(() => { if (!cancelled) spinUp(); }, Math.min(1000 * 2 ** Math.min(retry++, 4), 16000)); };
    const spinUp = async () => {
      const { default: Peer } = await import("peerjs");
      if (cancelled) return;
      peer = new Peer(peerIdFor(roomCode), peerOptions());
      peerRef.current = peer;
      peer.on("open", () => { retry = 0; idRetry = 0; setPeerStatus("online"); });
      peer.on("connection", (conn) => hub.attach(peerChannel(conn)));
      // If the host phone backgrounds, the broker link can drop. Reclaim it
      // (same room id) so players' reconnect attempts find the room again.
      peer.on("disconnected", () => { if (!cancelled) { setPeerStatus("connecting"); try { peer.reconnect(); } catch {} } });
      peer.on("error", (err) => {
        if (FATAL.includes(err?.type)) { setPeerStatus("error"); return; }
        if (cancelled) return;
        // After a reload the broker may still hold our previous registration of
        // this exact id for a few seconds. Retry through it rather than calling
        // the room dead; only give up if it stays taken (a real code clash).
        if (err?.type === "unavailable-id") {
          if (idRetry++ >= 6) { setPeerStatus("error"); return; }
        }
        setPeerStatus("connecting");
        try { peer.destroy(); } catch {}
        backoff();
      });
    };
    spinUp();
    // Free the broker id promptly on reload/close so the reloaded host can
    // re-claim it without waiting out the broker's stale-registration timeout.
    const bye = () => { try { peer && peer.destroy(); } catch {} };
    window.addEventListener("beforeunload", bye);
    window.addEventListener("pagehide", bye);
    return () => {
      cancelled = true; clearTimeout(timer);
      window.removeEventListener("beforeunload", bye);
      window.removeEventListener("pagehide", bye);
      try { peer && peer.destroy(); } catch {}
    };
  }, [open, roomCode, hub]);

  // Prune phones that have stayed gone for a while - but only in the lobby.
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
    addTeam();
    addTeam();
    const first = hub.getState().teams[0]?.id;
    dispatch({ type: "ADD_PLAYER", player: { id: hostId, name: name.trim(), teamId: first, isHost: true } });
    setOpen(true);
  };

  if (state.phase === "lobby") {
    return open
      ? <HostLobby state={state} dispatch={dispatch} hostId={hostId} roomCode={roomCode} peerStatus={peerStatus} onExit={onExit} />
      : (
        <div className="fb-card fb-stack">
          <h1 className="fb-h1">{t("host.hosting")}</h1>
          <label className="fb-label">{t("common.yourName")}<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
          <button className="fb-btn" disabled={!name.trim()} onClick={openRoom}>{t("host.createRoom")}</button>
          <p className="fb-hostnote"><AlertIcon className="fb-ico-l" />{t("host.keepOpen")}</p>
        </div>
      );
  }
  return (<>
    <GameView view={view} onIntent={(action) => dispatch({ type: action, fromId: hostId })} />
    {state.phase !== "endgame" && (
      <div className="fb-hostbar">
        <span>{t("host.host")}</span>
        <button onClick={() => dispatch({ type: "FORCE_NEXT" })}>{t("host.forceNext")}</button>
        <button onClick={() => dispatch({ type: "END_GAME" })}>{t("host.endGame")}</button>
      </div>
    )}
    {state.phase === "endgame" && (
      <div className="fb-hostbar">
        <span>{t("host.host")}</span>
        <button onClick={() => dispatch({ type: "PLAY_AGAIN" })}>{t("host.playAgain")}</button>
      </div>
    )}
  </>);
}

function HostLobby({ state, dispatch, hostId, roomCode, peerStatus, onExit }) {
  const t = useT();
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
    { label: t("steps.invite"), done: connected },
    { label: t("steps.groups"), done: teamsReady && placed },
    { label: t("steps.bowl"), done: bowlReady },
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
            <span className="fb-stepn">{s.done ? <CheckIcon /> : i + 1}</span>{s.label}
          </button>
        ))}
      </div>

      {tab === 0 && (<>
        <RoomShare code={roomCode} status={peerStatus} />
        <Arrivals players={state.players} myId={hostId} />
        <button className="fb-btn fb-ghost" onClick={() => setTab(1)}>{t("lobby.nextGroups")}<ChevronIcon className="fb-ico-r" /></button>
      </>)}

      {tab === 1 && (
        <div className="fb-card fb-stack">
          <GroupBoard
            teams={teams} roster={roster} myId={hostId}
            myTeamId={state.players.find((p) => p.id === hostId)?.teamId}
            onPick={(teamId) => dispatch({ type: "SET_TEAM", id: hostId, teamId })}
            onRename={(id, name) => dispatch({ type: "RENAME_TEAM", id, name })}
            onAddTeam={addTeam}
            canAddTeam={teams.length < MAX_TEAMS}
            onRemoveTeam={(id) => dispatch({ type: "REMOVE_TEAM", id })}
          />
          <button className="fb-btn fb-ghost" onClick={() => setTab(2)}>{t("lobby.nextBowl")}<ChevronIcon className="fb-ico-r" /></button>
        </div>
      )}

      {tab === 2 && (
        <div className="fb-card fb-stack">
          <p className="fb-wordtotal"><b>{state.bowl.length}</b> {t("lobby.total")}</p>
          <WordAdder onAdd={(ws) => dispatch({ type: "ADD_WORDS", words: ws, by: hostId })}
            onRemove={(w) => dispatch({ type: "REMOVE_WORD", word: w, by: hostId })}
            words={state.bowl.filter((w) => (state.wordBy || {})[w.toLowerCase()] === hostId)}
            count={state.wordCounts[hostId] || 0} target={WORDS_PER_PLAYER} />
          <DeckFill bowl={state.bowl} players={state.players.length}
            onAdd={(ws) => dispatch({ type: "ADD_WORDS", words: ws })} />
        </div>
      )}

      <button className="fb-btn fb-big" disabled={!canStart} onClick={() => dispatch({ type: "START_GAME" })}>
        {canStart ? t("lobby.start")
          : !connected ? t("lobby.waitPlayers")
          : !bowlReady ? t("lobby.addMore", { n: MIN_WORDS - state.bowl.length })
          : !placed ? t("lobby.needGroup")
          : t("lobby.needTwo")}
      </button>
    </div>
  );
}

/* ============================= CLIENT ============================= *
 * Resilient join: a phone that backgrounds, loses signal or reloads keeps
 * trying to get back in (exponential backoff, plus an instant automatic retry
 * the moment the browser says the tab is shown or the network is back), and
 * reclaims its exact seat via a stable id. The UI shows an offline/reconnecting
 * banner - no button to press - instead of a dead "reload to rejoin".
 * ------------------------------------------------------------------ */
function ClientApp({ onExit, initialRoom }) {
  const t = useT();
  // Restore what we need to silently re-dial after a reload.
  const saved = useRef(ssGet(PK.client)).current;
  const resuming = !!(saved?.name && saved?.code);
  const [name, setName] = useState(saved?.name || "");
  const [code, setCode] = useState(saved?.code || initialRoom || "");
  const [step, setStep] = useState(resuming ? "connecting" : "form"); // form | connecting | lobby
  const [status, setStatus] = useState("");
  const [connStage, setConnStage] = useState(0); // 0 starting up, 1 reaching host, 2 joined
  const [reconnecting, setReconnecting] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [lobby, setLobby] = useState(null), [view, setView] = useState(null);
  const [pendingTeam, setPendingTeam] = useState(undefined); // group picked locally, maybe before the host has heard

  // Imperative connection state lives in refs so the reconnect machinery
  // isn't torn down or stale-closed by re-renders.
  const aliveRef = useRef(false);          // are we meant to be in the room?
  const peerRef = useRef(null), connRef = useRef(null);
  const retryRef = useRef(0), timerRef = useRef(null);
  const cidRef = useRef(null), nameRef = useRef(""), codeRef = useRef("");
  const pendingTeamRef = useRef(undefined); // mirror of pendingTeam, read on reconnect

  const send = (o) => { const c = connRef.current; if (c && c.open) { try { c.send(JSON.stringify(o)); } catch {} } };
  // Pick a group. Remember it so a tap made while offline still lands: it's
  // re-sent the moment we reconnect, and shown optimistically until then.
  const pickTeam = (teamId) => { pendingTeamRef.current = teamId; setPendingTeam(teamId); send({ t: "setTeam", teamId }); };

  // We know our own id (it's the stable cid we hand the host), so identity
  // holds even when reconnecting mid-game before a fresh lobby snapshot.
  const myId = cidRef.current;
  const me = lobby?.roster.find((p) => p.id === myId);
  // Optimistic: show the group we picked even before the host confirms it.
  const myTeam = pendingTeam ?? (me?.teamId ?? null);
  const myWords = me?.words ?? 0;
  const target = lobby?.wordsPerPlayer ?? WORDS_PER_PLAYER;
  // Highlight follows the group you join (brand colour until then).
  useFollowTeamAccent(lobby?.teams.find((tm) => tm.id === myTeam)?.color ?? null);

  // Hoisted function declarations so the mutually-recursive reconnect helpers
  // can reference each other freely; they read live values from refs, so no
  // stale closures even though they're recreated each render.
  function dialHost() {
    if (!aliveRef.current || !peerRef.current) return;
    let conn, opened = false;
    try { conn = peerRef.current.connect(peerIdFor(codeRef.current), { reliable: true }); }
    catch { return scheduleRetry(); }
    connRef.current = conn;
    // A stalled dial sometimes fires neither open nor error; retry if it hasn't
    // connected in time so the join never just sits there.
    const dialTimeout = setTimeout(() => { if (!opened && aliveRef.current && connRef.current === conn) scheduleRetry(); }, 10000);
    conn.on("open", () => {
      opened = true; clearTimeout(dialTimeout);
      retryRef.current = 0; setReconnecting(false); setStatus(""); setConnStage(2); setStep("lobby");
      conn.send(JSON.stringify({ t: "hello", name: nameRef.current, cid: cidRef.current }));
      // Re-send a group choice made while we were offline so the host catches up.
      if (pendingTeamRef.current !== undefined) conn.send(JSON.stringify({ t: "setTeam", teamId: pendingTeamRef.current }));
    });
    conn.on("data", (d) => { try { const m = JSON.parse(d); if (m.t === "lobby") setLobby(m.lobby); else if (m.t === "view") setView(m.view); } catch {} });
    // These only matter while `conn` is still our live connection - once we've
    // moved on (connRef nulled / replaced), a late event must not retry again.
    conn.on("close", () => { clearTimeout(dialTimeout); if (aliveRef.current && connRef.current === conn) scheduleRetry(); });
    conn.on("error", () => { clearTimeout(dialTimeout); if (aliveRef.current && connRef.current === conn) scheduleRetry(); });
    // A clean "close" doesn't always fire when WebRTC dies - watch the ICE
    // state so a silent failure still kicks off a reconnect.
    conn.on("iceStateChanged", (st) => {
      if (!aliveRef.current || connRef.current !== conn) return;
      if (st === "failed") scheduleRetry();
      else if (st === "disconnected") setReconnecting(true); // may recover on its own
    });
  }
  async function spinUp() {
    setConnStage(0); // starting up: loading peerjs + registering with the broker
    const { default: Peer } = await import("peerjs");
    if (!aliveRef.current) return;
    const peer = new Peer(peerOptions());
    peerRef.current = peer;
    peer.on("open", () => { setConnStage(1); dialHost(); }); // registered -> reach the host
    peer.on("disconnected", () => { if (aliveRef.current) { try { peer.reconnect(); } catch {} } });
    peer.on("error", (err) => {
      const type = err?.type;
      // A browser that can't do WebRTC won't get better by retrying.
      if (type === "browser-incompatible" || type === "ssl-unavailable") { setStatus(t("client.badBrowser")); return; }
      if (type === "peer-unavailable") setStatus(t("client.hostNotFound")); // host id not found yet
      if (aliveRef.current) scheduleRetry();
    });
  }
  // Tear down the live connection and re-establish a clean one after a backoff.
  // A retry is already pending? Leave it - re-entrancy here is what used to wedge
  // the join: closing the conn fires its own 'close' handler synchronously, which
  // calls back in, racing a second peer into life. One timer at a time.
  function scheduleRetry() {
    if (!aliveRef.current || timerRef.current) return;
    setReconnecting(true);
    // Genuinely offline (airplane mode, wifi off)? Don't burn retries - the
    // browser's 'online' event fires the moment the network is back and
    // reconnects us straight away. (onLine can be true with no real internet,
    // so when it's true we still retry on a backoff to cover that case.)
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const n = retryRef.current++;
    const delay = Math.min(1000 * 2 ** Math.min(n, 3), 8000); // 1s,2s,4s,8s…
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!aliveRef.current) return;
      // Null the refs *before* tearing down, so any late close/error from the
      // dying conn or peer sees connRef.current !== conn and stays quiet.
      const deadConn = connRef.current, deadPeer = peerRef.current;
      connRef.current = null; peerRef.current = null;
      try { deadConn?.close(); } catch {}
      try { deadPeer?.destroy(); } catch {}
      spinUp();
    }, delay);
  }
  // Skip the backoff and reconnect now - triggered automatically when the tab
  // is shown again, the window refocuses, or the network comes back.
  function reconnectNow() {
    if (!aliveRef.current) return;
    if (connRef.current && connRef.current.open) return;
    if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") return;
    retryRef.current = 0;
    clearTimeout(timerRef.current); timerRef.current = null;
    const deadConn = connRef.current, deadPeer = peerRef.current;
    connRef.current = null; peerRef.current = null;
    try { deadConn?.close(); } catch {}
    try { deadPeer?.destroy(); } catch {}
    spinUp();
  }
  // Begin (or resume) a connection to the room with a known name + code.
  function start(n, c) {
    nameRef.current = n; codeRef.current = c;
    cidRef.current = stableClientId(c);
    ssSet(PK.client, { name: n, code: c }); // remember so a reload re-dials itself
    aliveRef.current = true; retryRef.current = 0;
    setStep("connecting"); setStatus(""); setConnStage(0);
    spinUp();
  }
  const join = () => {
    if (!name.trim() || !code.trim()) return;
    start(name.trim(), code.trim());
  };
  // Auto-rejoin after a reload: we were in a room, so re-dial immediately
  // instead of showing the form. The stable cid means the host hands us back
  // our exact seat - same team, score and turn.
  const startedRef = useRef(false);
  useEffect(() => {
    if (resuming && !startedRef.current) { startedRef.current = true; start(saved.name, saved.code); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bridge the latest reconnectNow into a stable listener so the effect
  // subscribes once, not on every render. The browser tells us when the phone
  // comes back - net returning, tab shown, window refocused - and we rejoin
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
      <h1 className="fb-h1">{t("client.joinRoom")}</h1>
      {step === "form" && (<>
        {initialRoom && <p className="fb-muted"><Tr value={t("client.joiningRoom", { code: initialRoom })} boldClass="fb-code" /></p>}
        <label className="fb-label">{t("common.yourName")}<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus /></label>
        {!initialRoom && <label className="fb-label">{t("client.roomCode")}<input className="fb-input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} placeholder="e.g. kx7m2p" /></label>}
        <button className="fb-btn" disabled={!name.trim() || !code.trim()} onClick={join}>{t("client.join")}</button>
        {status && <p className="fb-err">{status}</p>}
      </>)}
      {step === "connecting" && (
        <div className="fb-stack fb-center">
          <ConnSteps stage={connStage} />
          {status && <p className="fb-connhint">{status}</p>}
        </div>
      )}
      {step === "lobby" && lobby && (<>
        <GroupBoard
          teams={lobby.teams} roster={lobby.roster} myId={myId} myTeamId={myTeam}
          onPick={pickTeam}
          onRename={(id, nm) => send({ t: "renameTeam", id, name: nm })}
          onAddTeam={() => send({ t: "addTeam" })}
          canAddTeam={lobby.teams.length < lobby.maxTeams}
        />
        <WordAdder onAdd={(ws) => send({ t: "words", words: ws })}
          onRemove={(w) => send({ t: "removeWord", word: w })}
          words={lobby.yourWords || []} count={myWords} target={target} />
        <p className="fb-tiny">{myTeam ? t("client.waitHost") : t("client.joinGroupReady")}</p>
      </>)}
    </div>
  );
}
function ReconnectBanner({ show, online }) {
  const t = useT();
  if (!show) return null;
  const label = online ? t("reconnect.online") : t("reconnect.offline");
  return (
    <div className={`fb-reconnect ${online ? "" : "offline"}`} role="status" title={label} aria-label={label}>
      <LoaderIcon className="fb-reconnect-ico" />
    </div>
  );
}
// Live progress for the join handshake: a checklist where the current step
// spins, earlier ones tick, so a slow connect shows movement instead of a
// frozen screen.
function ConnSteps({ stage }) {
  const t = useT();
  const labels = [t("client.stepStart"), t("client.stepReach"), t("client.stepJoin")];
  return (
    <ol className="fb-connsteps">
      {labels.map((label, i) => (
        <li key={i} className={`fb-connstep ${i < stage ? "done" : i === stage ? "now" : ""}`}>
          <span className="fb-connmark" aria-hidden="true">{i < stage ? <CheckIcon /> : i === stage ? <LoaderIcon /> : ""}</span>{label}
        </li>
      ))}
    </ol>
  );
}

/* ===================== shared in-game view ======================= */
// `optimistic` is true on a remote (client) device: the host's word arrives
// over the wire, so when the giver taps CORRECT we flip to the next buffered
// word immediately and reconcile when the host's authoritative view lands.
// The host itself dispatches synchronously, so it shows the real word as-is.
function GameView({ view, onIntent, optimistic = false }) {
  const accent = view.phase === "endgame" ? "#3B6EA5" : view.round?.accent || "#3B6EA5";
  return (
    <div style={{ "--accent": accent }}>
      {view.phase === "ready" && <Ready v={view} onIntent={onIntent} />}
      {view.phase === "play" && <Play v={view} onIntent={onIntent} optimistic={optimistic} />}
      {view.phase === "transition" && <Transition v={view} onIntent={onIntent} />}
      {view.phase === "endgame" && <Endgame v={view} />}
      {(view.phase === "ready" || view.phase === "play") && view.round && <RoundProgress n={view.round.n} />}
    </div>
  );
}

// Optimistic word buffer for the active clue-giver. The host streams the
// current word plus a short `nextWords` lookahead (giver-only). We display a
// word `pending` steps ahead of the host's current card; each authoritative
// advance consumes one pending step. Purely cosmetic - the host stays the sole
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
// A bold, themed round-progress strip shown under the card: one dot per
// round in that round's own colour - filled for done + current, hollow for
// the rounds still ahead, with the current round enlarged.
const RoundProgress = ({ n }) => (
  <div className="fb-progress" role="img" aria-label={`Round ${n} of 5`}>
    {ROUNDS.map((r) => (
      <span key={r.n} className={`fb-progdot ${r.n < n ? "done" : r.n === n ? "now" : ""}`} style={{ "--dc": r.accent }} />
    ))}
  </div>
);
const RoundLine = ({ r }) => {
  const t = useT();
  return <div className="fb-roundline"><span className="fb-roundtag"><RoundIcon n={r.n} /> {t(`round.${r.n}.name`)}</span></div>;
};
const Rules = ({ r, tight }) => {
  const t = useT();
  return (
    <div className={`fb-rules ${tight ? "tight" : ""}`}>
      <span><b>{t("rules.allowed")}</b> {t(`round.${r.n}.allowed`)}</span><span><b>{t("rules.never")}</b> {t(`round.${r.n}.restrict`)}</span>
    </div>
  );
};
function Ready({ v, onIntent }) {
  const tr = useT();
  const r = v.round;
  const myTeam = v.teams.find((t) => t.id === v.myTeamId);
  const mineUp = !!v.myTeamId && v.myTeamId === v.teamUpId;
  return (
    <div className="fb-card fb-stack fb-center" style={{ "--tc": v.teamUpColor }}>
      {v.turnNumber > 1 && <div className="fb-flash"><AlarmIcon /> {tr("ready.timesUp")}</div>}
      <RoundLine r={r} />
      <div className="fb-uplabel">{mineUp ? tr("ready.yourTurn") : tr("ready.nowUp")}</div>
      <FitText className="fb-h1 fb-xl" style={{ color: v.teamUpColor }} text={v.teamUpName} min={20} />
      {v.canClaim ? (<>
        {tr(`round.${r.n}.setup`) && <p className="fb-muted">{tr(`round.${r.n}.setup`)}</p>}
        {v.inherited && <p className="fb-inherit">{tr("ready.inherit")}</p>}
        <Rules r={r} />
        <button className="fb-btn fb-big" onClick={() => onIntent("CLAIM_AND_BEGIN")}>{tr("ready.illGive", { n: TURN_SECONDS })}</button>
      </>) : mineUp ? (
        <p className="fb-muted">{tr("ready.someone")}</p>
      ) : !myTeam ? (
        <p className="fb-muted">{tr("ready.watch")}</p>
      ) : null}
      <Standings v={v} />
    </div>
  );
}
// A Time Timer-style disc: a colored wedge that depletes smoothly around a
// clock face, seconds called out big in the middle. Zones shift green →
// amber → red as the clock winds down; the last 10s give it a heartbeat.
function VisualTimer({ timeLeft, total }) {
  const t = useT();
  const frac = Math.max(0, Math.min(1, timeLeft / total));
  const zone = timeLeft <= 10 ? "red" : timeLeft <= 20 ? "yellow" : "green";
  const low = timeLeft <= 10 && timeLeft > 0;
  return (
    <div
      className={`fb-vtimer ${zone} ${low ? "pulse" : ""}`}
      role="timer"
      aria-label={t("timer.secsLeft", { n: timeLeft })}
    >
      <div className="fb-vt-disc" style={{ "--fbdeg": `${frac * 360}deg` }}>
        <div className="fb-vt-ticks" aria-hidden="true" />
        <div className="fb-vt-hub">
          <span className="fb-vt-secs">{timeLeft}</span>
          <span className="fb-vt-unit">{t("timer.sec")}</span>
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
function WordSlip({ word, onClick }) {
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
  // The whole card doubles as a CORRECT button (tap or Enter), alongside the
  // CORRECT button below it.
  const tap = onClick ? { role: "button", tabIndex: 0, "aria-label": "Mark correct",
    onClick, onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); onClick(); } } } : {};
  return (
    <div className={`fb-slip ${onClick ? "tap" : ""}`} ref={slipRef} key={word} {...tap}>
      <div className="fb-word" data-word={word} ref={wordRef}>{word}</div>
    </div>
  );
}
function Play({ v, onIntent, optimistic }) {
  const tr = useT();
  const r = v.round;
  const { shown, canBuffer, bump } = useGiverWord(v, optimistic);
  const onCorrect = () => { onIntent("CORRECT"); if (optimistic && canBuffer) bump(); };
  return (
    <div className="fb-card fb-stack">
      <RoundLine r={r} />
      <VisualTimer timeLeft={v.timeLeft} total={TURN_SECONDS} />
      {v.isActive ? (<>
        <WordSlip word={shown} onClick={onCorrect} />
        <Rules r={r} tight />
        <button className="fb-btn fb-correct" onClick={onCorrect}>{tr("play.correct")} <span>{tr("play.spacebar")}</span></button>
        <p className="fb-noskip">{tr("play.noSkip")}</p>
      </>) : (
        <div className="fb-watch">
          <p>{v.activeName} {tr("play.givingFor")} <b style={{ color: v.teamUpColor }}>{v.teamUpName}</b>.</p>
          {v.myTeamId === v.teamUpId && <p className="fb-tiny">{tr("play.guessOut")}</p>}
        </div>
      )}
      <Standings v={v} />
    </div>
  );
}
function Transition({ v, onIntent }) {
  const tr = useT();
  const r = v.round;
  return (
    <div className="fb-modal" style={{ "--accent": r.accent }}>
      <div className="fb-card fb-stack fb-center">
        <div className="fb-flash big">{tr("trans.roundOver")}</div>
        <p className="fb-paused">{tr("trans.pausedLead")} <b>{v.timeLeft}s</b> {tr("trans.pausedLeft")}</p>
        <div className="fb-nextsetup"><span className="fb-nextsetuphead"><RoundIcon n={r.n} /> <Tr value={tr("trans.roundIs", { n: r.n, name: tr(`round.${r.n}.name`).toUpperCase() })} /></span>{tr(`round.${r.n}.setup`) && <span>{tr(`round.${r.n}.setup`)}</span>}</div>
        <RoundProgress n={r.n} />
        <Rules r={r} />
        {v.canResume ? <button className="fb-btn fb-big" onClick={() => onIntent("RESUME")}>{tr("trans.resume")}<PlayIcon className="fb-ico-r" /></button>
          : <p className="fb-muted">{tr("trans.waitResume", { name: v.activeName })}</p>}
      </div>
    </div>
  );
}
function Endgame({ v }) {
  const tr = useT();
  const total = (id) => v.scores[id].reduce((a, b) => a + b, 0);
  const ranked = [...v.teams].sort((a, b) => total(b.id) - total(a.id));
  const top = total(ranked[0].id), winners = ranked.filter((t) => total(t.id) === top);
  return (
    <div className="fb-card fb-stack">
      <FitText className="fb-h1 fb-xl" style={{ color: winners[0].color }} text={winners.length > 1 ? tr("end.tie") : tr("end.wins", { team: winners[0].name })} min={20} />
      {ranked.map((t, i) => (
        <div className="fb-rankrow" key={t.id} style={{ "--tc": t.color }}>
          <span className="fb-rank">{i + 1}</span><span className="fb-dot" />
          <span className="fb-rankname">{t.name}</span><span className="fb-ranktotal">{total(t.id)}</span>
        </div>
      ))}
      <details className="fb-details"><summary>{tr("end.roundByRound")}</summary>
        <div className="fb-scroll"><table className="fb-table">
          <thead><tr><th>{tr("end.team")}</th>{ROUNDS.map((r) => <th key={r.n}><span className="fb-th2"><RoundIcon n={r.n} className="fb-pixicon-th" /></span></th>)}</tr></thead>
          <tbody>{ranked.map((t) => <tr key={t.id}><td style={{ color: t.color }}>{t.name}</td>{v.scores[t.id].map((s, i) => <td key={i}>{s}</td>)}</tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}
// The score box also marks which team is yours (a coloured "you" chip),
// so there's no need for a separate "you're on" badge.
function Standings({ v }) {
  const total = (id) => v.scores[id].reduce((a, b) => a + b, 0);
  return (
    <div className="fb-standings">
      {v.teams.map((t) => {
        const mine = t.id === v.myTeamId;
        return (
          <span key={t.id} className={`fb-stand ${mine ? "mine" : ""}`} style={{ color: t.color }}>
            {t.name} <b>{total(t.id)}</b>{mine && <span className="fb-youtag" style={{ background: t.color }}>you</span>}
          </span>
        );
      })}
    </div>
  );
}

/* --------------------------- small parts -------------------------- */
// Shared by host + clients: every group with a live count, who's in it,
// an editable name, and a tap-to-join button. Host also gets a remove (×).
function GroupBoard({ teams, roster, myId, myTeamId, onPick, onRename, onAddTeam, canAddTeam, onRemoveTeam }) {
  const tr = useT();
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
                onChange={(e) => onRename(t.id, e.target.value)} aria-label={tr("group.nameLabel")} />
              <span className="fb-tcount">{t.count}</span>
              {onRemoveTeam && teams.length > 2 && <button className="fb-x" title={tr("group.remove")} onClick={() => onRemoveTeam(t.id)}><CloseIcon /></button>}
            </div>
            <div className="fb-rosterwrap">
              {members(t.id).length === 0
                ? <span className="fb-empty">{tr("group.empty")}</span>
                : members(t.id).map((p) => (
                  <span key={p.id} className={`fb-chip ${p.connected === false ? "off" : ""}`} style={{ "--tc": t.color }}>
                    <span className="fb-dot" /> {p.name}{p.id === myId ? tr("group.you") : ""}{p.isHost ? tr("group.host") : ""}
                    {p.connected === false ? tr("group.offline") : ""}
                  </span>
                ))}
            </div>
            <button className={`fb-joinbtn ${mine ? "on" : ""}`} onClick={() => onPick(t.id)}>
              {mine ? <><CheckIcon className="fb-ico-l" />{tr("group.youreIn")}</> : tr("group.joinThis")}
            </button>
          </div>
        );
      })}
      {unplaced.length > 0 && (
        <div className="fb-rosterwrap">
          {unplaced.map((p) => (
            <span key={p.id} className="fb-chip" style={{ "--tc": "#9b927f" }}>
              <span className="fb-dot" /> {p.name}{p.id === myId ? tr("group.you") : ""}{tr("group.noGroup")}
            </span>
          ))}
        </div>
      )}
      {canAddTeam && <button className="fb-btn fb-ghost" onClick={onAddTeam}><PlusIcon className="fb-ico-l" />{tr("group.addGroup")}</button>}
    </div>
  );
}
// Host's share panel: a QR to scan and a link to send. The PeerJS broker
// handles only the handshake; game data stays peer-to-peer.
function RoomShare({ code, status }) {
  const t = useT();
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
    try { if (navigator.share) await navigator.share({ title: "Murray's Game", text: t("share.joinMyRoom"), url: link }); else copy(); } catch {}
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const dot = status === "online" ? "var(--green)" : status === "error" ? "var(--red)" : "var(--amber)";
  const title = status === "online"
    ? <>{t("share.roomLabel")} <b className="fb-code">{code}</b></>
    : status === "error" ? t("share.errorTitle") : t("share.connecting");
  return (
    <div className="fb-card fb-stack fb-center">
      <h2 className="fb-h2 fb-sharetitle"><span className="fb-statusdot" style={{ background: dot }} /> {title}</h2>
      {qr && <img className="fb-qr" src={qr} alt={t("share.qrAlt")} width={200} height={200} />}
      <input className="fb-input mono fb-linkfield" readOnly value={link} onFocus={(e) => e.target.select()} aria-label={t("share.roomLink")} />
      <div className="fb-row fb-sharebtns">
        <button className="fb-btn" onClick={copy}>{copied ? <>{t("share.copied")}<CheckIcon className="fb-ico-r" /></> : t("share.copyLink")}</button>
        {canShare && <button className="fb-btn fb-ghost" onClick={share}>{t("share.shareDots")}</button>}
      </div>
    </div>
  );
}
// The live "who's here" roster on the Invite tab: every connected player
// pops in as a little minifigure (shirt in their own colour) with their name,
// so the host watches their crew arrive instead of a bare count.
function Arrivals({ players, myId }) {
  const t = useT();
  const here = players.filter((p) => p.connected !== false);
  if (here.length <= 1) return null; // nothing to show until someone else joins
  return (
    <div className="fb-card fb-stack">
      <h2 className="fb-h2">{t("arrivals.title", { n: here.length })}</h2>
      <div className="fb-arrlist">
        {here.map((p) => (
          <span key={p.id} className="fb-arrchip">
            <MurrayPix size={22} seed={p.id} />
            <b>{p.name}</b>
            {p.isHost && <span className="fb-arrtag">{t("host.host")}</span>}
            {p.id === myId && !p.isHost && <span className="fb-arrtag">you</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
// `count` is how many words this person has already dropped in; `target` is
// the soft per-player goal. `words` are this person's own entries, each
// removable via `onRemove`. The deck button tops you up to the goal.
function WordAdder({ onAdd, onRemove, words = [], count = 0, target = 0 }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const add = () => { const w = draft.trim(); if (!w) return; onAdd([w]); setDraft(""); };
  const remaining = target ? Math.max(0, target - count) : 0;
  const done = target > 0 && remaining === 0;
  return (
    <div className="fb-stack">
      <h2 className="fb-h1 fb-yourwords">{t("words.progressLead")}{target > 0 && <span className="fb-yourwordsnum">{count}/{target}</span>}</h2>
      {done && <p className="fb-wordhint done"><CheckIcon className="fb-ico-l" />{t("words.plenty")}</p>}
      <div className="fb-row">
        <input className="fb-input" value={draft} placeholder={t("words.typeWord")} maxLength={40} autoFocus
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="fb-btn fb-add" onClick={add}>{t("common.add")}</button>
      </div>
      {onRemove && words.length > 0 && (
        <div className="fb-mywords">
          {words.map((w) => (
            <span key={w} className="fb-myword">{w}
              <button className="fb-wordx" aria-label={t("words.deleteAria", { w })} onClick={() => onRemove(w)}><CloseIcon /></button>
            </span>
          ))}
        </div>
      )}
      {remaining > 0 && (
        <button className="fb-btn fb-ghost" onClick={() => onAdd(sampleDeck(remaining))}>
          {t("words.fillMine", { n: remaining })}
        </button>
      )}
    </div>
  );
}
// Host-only: pad a thin bowl straight from Murray's deck. Tops up toward a
// "everyone did their share" target (players × WORDS_PER_PLAYER); once there,
// it keeps offering a chunk so the host can build as big a bowl as they like.
function DeckFill({ bowl, players, onAdd }) {
  const t = useT();
  const target = Math.max(MIN_WORDS, players * WORDS_PER_PLAYER);
  const need = Math.max(0, target - bowl.length);
  const amount = need > 0 ? need : 10;
  const words = useMemo(() => deckTopUp(bowl, amount), [bowl, amount]);
  if (words.length === 0) return <p className="fb-tiny">{t("deck.allIn")}</p>;
  return (
    <button className="fb-btn fb-ghost" onClick={() => onAdd(words)}>
      {need > 0 ? t("deck.fillBowl", { n: words.length }) : t("deck.addMore", { n: words.length })}
    </button>
  );
}
