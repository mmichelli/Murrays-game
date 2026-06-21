import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  ROUNDS, PALETTE, MIN_WORDS, MAX_TEAMS, TURN_SECONDS, WORDS_PER_PLAYER, sampleDeck, deckTopUp,
  uid, initial, viewFor, createHostHub, peerOptions,
} from "./engine.js";
import { LANGS, detectLang, saveLang, makeT, roundText } from "./i18n.js";
// Round glyphs from Pixelarticons (MIT) - https://pixelarticons.com - imported
// as raw SVG so each round wears a crisp pixel-art icon that inherits the
// surrounding text colour. Describe=speak, Charades=act, One Word=bubble,
// Hands Only=hand, Face Only=face.
import describeSvg from "pixelarticons/svg/mic.svg?raw";
import charadesSvg from "pixelarticons/svg/human-arms-up.svg?raw";
import oneWordSvg from "pixelarticons/svg/comment.svg?raw";
import handsSvg from "pixelarticons/svg/hand.svg?raw";
import faceSvg from "pixelarticons/svg/smile.svg?raw";

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

/* ---------------------- pixel-art round icons --------------------- *
 * Each round wears a Pixelarticons glyph (see import note above). The raw
 * SVG uses fill="currentColor", so the icon inherits the surrounding text
 * colour - ink on the landing list, accent-tinted in-game - and scales
 * with the font size via CSS.
 * ------------------------------------------------------------------ */
const ROUND_SVG = { 1: describeSvg, 2: charadesSvg, 3: oneWordSvg, 4: handsSvg, 5: faceSvg };
function RoundIcon({ n, className = "" }) {
  const svg = ROUND_SVG[n];
  if (!svg) return null;
  return <span className={`fb-pixicon ${className}`} role="img" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/* ------------------------- Murray, the mate ----------------------- *
 * The namesake, as a pixel minifigure: yellow head, dot eyes and a
 * smile, claw arms, an accent-coloured torso (it follows the theme).
 * Drawn on a 16-wide grid; each letter maps to a colour.
 * ------------------------------------------------------------------ */
const MURRAY_PIX = [
  "....KKKKKKKK....", "...KHHHHHHHHK...", "...KHHHHHHHHK...", "...KYYYYYYYYK...",
  "...KYKYYYYKYK...", "...KYYYYYYYYK...", "...KYYKKKKYYK...", "...KYYYYYYYYK...",
  "....KKKKKKKK....", "......KKKK......", ".KKKKKKKKKKKKKK.", ".KYYKBBBBBBKYYK.",
  ".KYYKBBBBBBKYYK.", ".KYYKBBBBBBKYYK.", ".KYYKBBBBBBKYYK.", ".KKKKBBBBBBKKKK.",
  "....KBBBBBBK....",
];
const MURRAY_COL = { K: "#14181D", H: "#6B4A2B", Y: "#F5C518", B: "var(--accent)" };
// Hair + shirt palettes; a player's stable id picks one of each so everyone
// in the room gets a distinct-but-consistent minifigure.
const MURRAY_HAIR = ["#6B4A2B", "#2C2A29", "#E6B84F", "#C2552E", "#8A8F98", "#3A2418"];
const MURRAY_SHIRT = ["#3B6EA5", "#B15E86", "#3E8E72", "#6B5B9A", "#1F51FF", "#2E8B8B", "#E8920A", "#E0322B"];
const hashSeed = (s) => { let h = 2166136261; const str = String(s); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// With a `seed` the figure is randomised (hair + shirt) from that seed; with
// no seed it's the canonical Murray (brown hair, accent torso).
function MurrayPix({ size = 60, className = "", seed }) {
  const rows = MURRAY_PIX, w = rows[0].length, h = rows.length, px = [];
  let col = MURRAY_COL;
  if (seed != null) { const x = hashSeed(seed); col = { ...MURRAY_COL, H: MURRAY_HAIR[x % MURRAY_HAIR.length], B: MURRAY_SHIRT[(x >> 5) % MURRAY_SHIRT.length] }; }
  rows.forEach((row, y) => { for (let i = 0; i < row.length; i++) { const c = col[row[i]]; if (c) px.push(<rect key={`${i},${y}`} x={i} y={y} width="1.02" height="1.02" style={{ fill: c }} />); } });
  return <svg className={className} width={size} height={Math.round(size * h / w)} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role="img" aria-label="Player">{px}</svg>;
}

/* ================================================================== *
 * MURRAY'S GAME - a 5-round Fishbowl for South African students.
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
  const t = useT();
  // Rehydrate the room across a reload: same code (so phones reconnect to the
  // same broker id), same host identity, same in-progress game.
  const saved = useRef(ssGet(PK.host)).current;
  const hostId = useRef(saved?.hostId || uid()).current;
  const roomCode = useRef(saved?.roomCode || makeRoomCode()).current;
  const [state, setState] = useState(saved?.state || initial);
  const hubRef = useRef(null);
  if (!hubRef.current) hubRef.current = createHostHub({ onState: setState, initialState: saved?.state || initial });
  const hub = hubRef.current;
  const dispatch = useCallback((a) => hub.dispatch(a), [hub]);

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
          <h1 className="fb-h1">{t("host.hosting")}</h1>
          <label className="fb-label">{t("common.yourName")}<input className="fb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
          <button className="fb-btn" disabled={!name.trim()} onClick={openRoom}>{t("host.createRoom")}</button>
          <p className="fb-hostnote">{t("host.keepOpen")}</p>
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
            <span className="fb-stepn">{s.done ? "✓" : i + 1}</span>{s.label}
          </button>
        ))}
      </div>

      {tab === 0 && (<>
        <RoomShare code={roomCode} status={peerStatus} connected={clients} />
        <Arrivals players={state.players} myId={hostId} />
        <button className="fb-btn fb-ghost" onClick={() => setTab(1)}>{t("lobby.nextGroups")}</button>
      </>)}

      {tab === 1 && (
        <div className="fb-card fb-stack">
          <GroupBoard
            teams={teams} roster={roster} myId={hostId}
            myTeamId={state.players.find((p) => p.id === hostId)?.teamId}
            onPick={(teamId) => dispatch({ type: "SET_TEAM", id: hostId, teamId })}
            onRename={(id, name) => dispatch({ type: "RENAME_TEAM", id, name })}
            onAddTeam={() => dispatch({ type: "ADD_TEAM" })}
            canAddTeam={teams.length < MAX_TEAMS}
            onRemoveTeam={(id) => dispatch({ type: "REMOVE_TEAM", id })}
          />
          <button className="fb-btn fb-ghost" onClick={() => setTab(2)}>{t("lobby.nextBowl")}</button>
        </div>
      )}

      {tab === 2 && (
        <div className="fb-card fb-stack">
          <h2 className="fb-h2">{t("lobby.theBowl")}</h2>
          <p className="fb-muted"><b className="fb-num">{state.bowl.length}</b> {t("lobby.bowlInfo")}</p>
          <WordAdder onAdd={(ws) => dispatch({ type: "ADD_WORDS", words: ws, by: hostId })}
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
  // Highlight follows the group you join (brand colour until then).
  useFollowTeamAccent(lobby?.teams.find((tm) => tm.id === myTeam)?.color ?? null);

  // Hoisted function declarations so the mutually-recursive reconnect helpers
  // can reference each other freely; they read live values from refs, so no
  // stale closures even though they're recreated each render.
  function dialHost() {
    if (!aliveRef.current || !peerRef.current) return;
    setStatus(t("client.reaching"));
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
    // A clean "close" doesn't always fire when WebRTC dies - watch the ICE
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
      if (err?.type === "peer-unavailable") setStatus(t("client.roomNotAnswering"));
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
    // Genuinely offline (airplane mode, wifi off)? Don't burn retries - the
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
  // Skip the backoff and reconnect now - triggered automatically when the tab
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
  // Begin (or resume) a connection to the room with a known name + code.
  function start(n, c) {
    nameRef.current = n; codeRef.current = c;
    cidRef.current = stableClientId(c);
    ssSet(PK.client, { name: n, code: c }); // remember so a reload re-dials itself
    aliveRef.current = true; retryRef.current = 0;
    setStep("connecting"); setStatus(t("client.reaching"));
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
      {step === "connecting" && <p className="fb-muted">{status || t("client.connecting")}</p>}
      {step === "lobby" && lobby && (<>
        <GroupBoard
          teams={lobby.teams} roster={lobby.roster} myId={myId} myTeamId={myTeam}
          onPick={(teamId) => send({ t: "setTeam", teamId })}
          onRename={(id, nm) => send({ t: "renameTeam", id, name: nm })}
          onAddTeam={() => send({ t: "addTeam" })}
          canAddTeam={lobby.teams.length < lobby.maxTeams}
        />
        <h2 className="fb-h2">{t("lobby.theBowl")}</h2>
        <p className="fb-muted"><b className="fb-num">{lobby.bowlCount}</b> {t("client.bowlInfo")}</p>
        <WordAdder onAdd={(ws) => send({ t: "words", words: ws })} count={myWords} target={target} />
        <p className="fb-tiny">{myTeam ? t("client.waitHost") : t("client.joinGroupReady")}</p>
      </>)}
    </div>
  );
}
function ReconnectBanner({ show, online }) {
  const t = useT();
  if (!show) return null;
  return (
    <div className={`fb-reconnect ${online ? "" : "offline"}`}>
      {online ? t("reconnect.online") : t("reconnect.offline")}
    </div>
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
const RoundDots = ({ n }) => (
  <span className="fb-dots" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <span key={i} className={`fb-pip ${i <= n ? "on" : ""}`} />)}</span>
);
const RoundLine = ({ r }) => {
  const t = useT();
  return <div className="fb-roundline"><span className="fb-roundtag"><RoundIcon n={r.n} /> {t(`round.${r.n}.name`)}</span><RoundDots n={r.n} /></div>;
};
const Rules = ({ r, tight }) => {
  const t = useT();
  return (
    <div className={`fb-rules ${tight ? "tight" : ""}`}>
      <span><b>{t("rules.allowed")}</b> {t(`round.${r.n}.allowed`)}</span><span><b>{t("rules.never")}</b> {t(`round.${r.n}.restrict`)}</span>
    </div>
  );
};
// A persistent "this is your team" marker so a player always knows which
// side they're on, separate from whichever team is currently up.
const YouBadge = ({ team }) => {
  const t = useT();
  return team ? (
    <div className="fb-youbadge" style={{ "--tc": team.color }}>
      <span className="fb-dot" /> {t("youbadge.lead")} <b>{team.name}</b>
    </div>
  ) : null;
};
function Ready({ v, onIntent }) {
  const tr = useT();
  const r = v.round;
  const myTeam = v.teams.find((t) => t.id === v.myTeamId);
  const mineUp = !!v.myTeamId && v.myTeamId === v.teamUpId;
  return (
    <div className="fb-card fb-stack fb-center" style={{ "--tc": v.teamUpColor }}>
      {v.turnNumber > 1 && <div className="fb-flash">{tr("ready.timesUp")}</div>}
      <RoundLine r={r} />
      <div className="fb-uplabel">{mineUp ? tr("ready.yourTurn") : tr("ready.nowUp")}</div>
      <FitText className="fb-h1 fb-xl" style={{ color: v.teamUpColor }} text={v.teamUpName} min={20} />
      {v.canClaim ? (<>
        <p className="fb-muted">{tr(`round.${r.n}.setup`)}</p>
        {v.inherited && <p className="fb-inherit">{tr("ready.inherit")}</p>}
        <Rules r={r} />
        <button className="fb-btn fb-big" onClick={() => onIntent("CLAIM_AND_BEGIN")}>{tr("ready.illGive", { n: TURN_SECONDS })}</button>
      </>) : mineUp ? (
        <p className="fb-muted">{tr("ready.someone")}</p>
      ) : myTeam ? (
        <p className="fb-muted">{tr("ready.sitTight")}</p>
      ) : (
        <p className="fb-muted">{tr("ready.watch")}</p>
      )}
      <YouBadge team={myTeam} />
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
  const tr = useT();
  const r = v.round;
  const myTeam = v.teams.find((t) => t.id === v.myTeamId);
  const { shown, canBuffer, bump } = useGiverWord(v, optimistic);
  const onCorrect = () => { onIntent("CORRECT"); if (optimistic && canBuffer) bump(); };
  return (
    <div className="fb-card fb-stack">
      <RoundLine r={r} />
      <VisualTimer timeLeft={v.timeLeft} total={TURN_SECONDS} />
      {v.isActive ? (<>
        <WordSlip word={shown} />
        <Rules r={r} tight />
        <button className="fb-btn fb-correct" onClick={onCorrect}>{tr("play.correct")} <span>{tr("play.spacebar")}</span></button>
        <p className="fb-noskip">{tr("play.noSkip")}</p>
      </>) : (
        <div className="fb-watch">
          <p>{v.activeName} {tr("play.givingFor")} <b style={{ color: v.teamUpColor }}>{v.teamUpName}</b>.</p>
          <p className="fb-tiny">{tr("play.guessOut")}</p>
        </div>
      )}
      <YouBadge team={myTeam} />
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
        <div className="fb-nextsetup"><span className="fb-nextsetuphead"><RoundIcon n={r.n} /> <Tr value={tr("trans.roundIs", { n: r.n, name: tr(`round.${r.n}.name`).toUpperCase() })} /></span><span>{tr(`round.${r.n}.setup`)}</span></div>
        <RoundDots n={r.n} />
        <Rules r={r} />
        {v.canResume ? <button className="fb-btn fb-big" onClick={() => onIntent("RESUME")}>{tr("trans.resume")}</button>
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
function Standings({ v }) {
  const total = (id) => v.scores[id].reduce((a, b) => a + b, 0);
  return (
    <div className="fb-standings">
      {v.teams.map((t) => (
        <span key={t.id} className="fb-stand" style={{ color: t.color }}>{t.name} <b>{total(t.id)}</b></span>
      ))}
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
              {onRemoveTeam && teams.length > 2 && <button className="fb-x" title={tr("group.remove")} onClick={() => onRemoveTeam(t.id)}>×</button>}
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
              {mine ? tr("group.youreIn") : tr("group.joinThis")}
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
      {canAddTeam && <button className="fb-btn fb-ghost" onClick={onAddTeam}>{tr("group.addGroup")}</button>}
    </div>
  );
}
// Host's share panel: a QR to scan and a link to send. The PeerJS broker
// handles only the handshake; game data stays peer-to-peer.
function RoomShare({ code, status, connected }) {
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
        <button className="fb-btn" onClick={copy}>{copied ? t("share.copied") : t("share.copyLink")}</button>
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
// the soft per-player goal. The deck button only ever tops you up to the goal.
function WordAdder({ onAdd, count = 0, target = 0 }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const add = () => { const w = draft.trim(); if (!w) return; onAdd([w]); setDraft(""); };
  const remaining = target ? Math.max(0, target - count) : 0;
  const done = target > 0 && remaining === 0;
  return (
    <div className="fb-stack">
      {target > 0 && (
        <div className={`fb-wordprog ${done ? "done" : ""}`}>
          <span>{t("words.progressLead")} <b>{count}/{target}</b></span>
          <span>{done ? t("words.plenty") : t("words.toGo", { n: remaining })}</span>
        </div>
      )}
      <div className="fb-row">
        <input className="fb-input" value={draft} placeholder={t("words.typeWord")} maxLength={40} autoFocus
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="fb-btn fb-add" onClick={add}>{t("common.add")}</button>
      </div>
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
/* ============================== CSS ============================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;800&family=Space+Mono:wght@400;700&display=swap');
.fb-root{
  --paper:#E7EAED; --panel:#FBFCFD; --slip:#FFFFFF; --ink:#14181D; --muted:#5C636C; --line:#D6DBE0;
  --green:#1AA67E; --amber:#E8920A; --red:#E0322B;
  /* a cool, neutral paper desk, lit unevenly - pages sit on top of it */
  min-height:100vh;color:var(--ink);
  background-color:var(--paper);
  background-image:
    radial-gradient(150% 100% at 50% -25%, rgba(255,255,255,.6), rgba(255,255,255,0) 60%),
    radial-gradient(95% 80% at 9% 5%, rgba(247,249,251,.5), rgba(247,249,251,0) 46%),
    radial-gradient(130% 120% at 93% 105%, rgba(64,76,92,.12), rgba(64,76,92,0) 55%);
  background-attachment:fixed;
  font-family:Archivo,system-ui,sans-serif;display:flex;justify-content:center;padding:18px;box-sizing:border-box;position:relative;
}
/* fine fibre grain printed over the whole surface - paper, cards and all */
.fb-root::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:100;mix-blend-mode:multiply;opacity:.1;
  background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.82'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='180'%20height='180'%20filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:180px 180px;}
.fb-shell{width:100%;max-width:540px;position:relative;z-index:1;}
.fb-brand{font-family:Anton,'Arial Narrow',sans-serif;letter-spacing:.03em;font-size:clamp(32px,9.5vw,46px);line-height:.9;text-align:center;width:max-content;max-width:100%;margin:0;color:var(--ink);text-transform:uppercase;text-shadow:3px 3px 0 var(--accent);
  background:none;border:none;padding:0;cursor:pointer;display:block;transition:text-shadow .08s,transform .08s;}
.fb-brand:hover{text-shadow:4px 4px 0 var(--accent);}
.fb-brand:active{transform:translate(1px,1px);text-shadow:2px 2px 0 var(--accent);}
.fb-brand:focus-visible{outline:2.5px solid var(--ink);outline-offset:4px;border-radius:4px;}

/* brand + language toggle - neo-brutalist hard-edged EN/NO codes */
.fb-topbar{display:flex;flex-direction:column;align-items:center;gap:11px;margin:6px 0 18px;}
.fb-langs{display:inline-flex;gap:7px;}
.fb-lang{display:inline-flex;align-items:center;justify-content:center;min-width:42px;background:var(--panel);border:2.5px solid var(--ink);border-radius:6px;padding:6px 10px;cursor:pointer;
  font-family:'Space Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
  box-shadow:2px 2px 0 var(--ink);transition:transform .07s,box-shadow .07s;}
.fb-lang:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink);color:var(--ink);}
.fb-lang:active{transform:translate(2px,2px);box-shadow:0 0 0 var(--ink);}
.fb-lang.on{background:var(--ink);color:var(--paper);box-shadow:3px 3px 0 var(--accent);}
.fb-lang.on:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--accent);color:var(--paper);}
.fb-lang.on:active{transform:translate(3px,3px);box-shadow:0 0 0 var(--accent);}
.fb-lang:focus-visible{outline:3px solid var(--accent);outline-offset:3px;}

/* landing hero - a bold solid accent band, brand oversized on top */
.fb-hero{position:relative;background:var(--accent);border:3px solid var(--ink);border-radius:8px;box-shadow:8px 8px 0 var(--ink);
  padding:22px 18px 24px;margin:2px 2px 22px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;overflow:hidden;}
.fb-hero>*{position:relative;z-index:1;}
.fb-herobrand{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;font-size:clamp(46px,15.5vw,82px);line-height:.96;margin:0;
  color:var(--paper);text-transform:uppercase;letter-spacing:.015em;text-shadow:4px 4px 0 var(--ink);}
.fb-herotag{font-family:Anton,sans-serif;font-size:clamp(15px,4.4vw,22px);letter-spacing:.02em;text-transform:uppercase;
  color:var(--ink);background:var(--paper);border:2.5px solid var(--ink);border-radius:6px;padding:5px 13px;box-shadow:3px 3px 0 var(--ink);transform:rotate(-1.4deg);}
.fb-herosub{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--paper);margin:-2px 0 0;opacity:.95;}
/* sit the decorative slips right under the brand inside the hero */
.fb-hero .fb-sliprow{margin-bottom:0;}
.fb-hero .fb-sliprow span{color:var(--ink);}
/* Murray, framed beside his credit line */
.fb-murray{display:flex;align-items:center;gap:13px;text-align:left;margin-top:2px;}
.fb-murraypic{flex:none;display:inline-flex;background:#fff;border:2.5px solid var(--ink);border-radius:6px;box-shadow:3px 3px 0 var(--ink);padding:5px;}
.fb-murraypic svg{display:block;}
.fb-murray .fb-tiny{margin:0;}

/* neo-brutalist paper cards: thick ink border + hard offset shadow. */
.fb-card{position:relative;border:3px solid var(--ink);border-radius:6px;padding:22px;
  background-color:var(--panel);
  box-shadow:6px 6px 0 var(--ink);}
.fb-stack{display:flex;flex-direction:column;gap:12px;}
.fb-center{text-align:center;align-items:center;}

.fb-h1{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;letter-spacing:.01em;font-size:27px;margin:0;text-transform:uppercase;line-height:1;}
.fb-h2{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.14em;margin:0;text-transform:uppercase;color:var(--muted);}
.fb-xl{font-size:clamp(38px,11vw,58px);line-height:.96;}
.fb-center .fb-h1.fb-xl{margin:6px 0 2px;}
.fb-muted{color:var(--muted);margin:0;font-size:15px;line-height:1.62;}
.fb-muted b{color:var(--ink);}
.fb-tiny{color:var(--muted);font-size:12px;margin:0;font-family:'Space Mono',monospace;}
.fb-hostnote{margin:2px 0 0;font-family:'Space Mono',monospace;font-size:11.5px;line-height:1.55;color:var(--ink);
  background:var(--panel);border:2.5px solid var(--ink);border-radius:6px;box-shadow:3px 3px 0 var(--accent);padding:11px 13px;text-align:left;}
.fb-num{font-family:Anton,sans-serif;font-weight:400;font-size:20px;color:var(--accent);vertical-align:-1px;margin-right:4px;}
.fb-link{background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit;text-decoration:underline;padding:4px;}

.fb-label{display:flex;flex-direction:column;gap:6px;font-family:'Space Mono',monospace;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;}
.fb-input{background:#fff;border:2.5px solid var(--ink);border-radius:6px;color:var(--ink);padding:12px 13px;font-size:16px;font-family:inherit;width:100%;box-sizing:border-box;}
.fb-input:focus{outline:none;border-color:var(--ink);box-shadow:3px 3px 0 var(--accent);}
.fb-input.bare{background:transparent;border:none;padding:6px 0;font-weight:800;font-size:17px;box-shadow:none;}
.fb-input.bare:focus{outline:none;box-shadow:none;border-bottom:2px solid var(--tc);}
.fb-area{background:#fff;border:2.5px solid var(--ink);border-radius:6px;color:var(--ink);padding:11px;font-size:13px;width:100%;box-sizing:border-box;min-height:60px;resize:vertical;font-family:inherit;}
.fb-area:focus{outline:none;border-color:var(--ink);box-shadow:2px 2px 0 var(--accent);}
.fb-area.mono{font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);}
.fb-row{display:flex;gap:8px;}
.fb-add{width:auto;padding-left:18px;padding-right:18px;}
.fb-wordprog{display:flex;justify-content:space-between;align-items:center;gap:8px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;}
.fb-wordprog b{font-family:Anton,sans-serif;font-weight:400;font-size:16px;color:var(--accent);vertical-align:-2px;margin:0 2px;}
.fb-wordprog.done{color:var(--green);}.fb-wordprog.done b{color:var(--green);}
.fb-reconnect{position:sticky;top:0;z-index:60;margin-bottom:12px;background:var(--amber);color:var(--ink);border:2.5px solid var(--ink);border-radius:6px;
  padding:9px 13px;font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.04em;text-align:center;
  box-shadow:4px 4px 0 var(--ink);}
.fb-reconnect.offline{background:#9AA0A8;}

.fb-btn{background:var(--ink);color:var(--paper);border:3px solid var(--ink);border-radius:6px;padding:13px 16px;font-size:16px;font-weight:800;
  font-family:Archivo,sans-serif;cursor:pointer;width:100%;box-shadow:5px 5px 0 var(--accent);transition:transform .07s,box-shadow .07s;}
.fb-btn:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:6px 6px 0 var(--accent);}
.fb-btn:active:not(:disabled){transform:translate(4px,4px);box-shadow:1px 1px 0 var(--accent);}
.fb-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;background:var(--panel);color:var(--muted);border-style:dashed;}
.fb-btn:focus-visible{outline:3px solid var(--accent);outline-offset:3px;}
.fb-ghost{background:var(--panel);color:var(--ink);border:3px solid var(--ink);box-shadow:4px 4px 0 var(--ink);}
.fb-ghost:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:5px 5px 0 var(--ink);border-color:var(--ink);}
.fb-ghost:active:not(:disabled){transform:translate(4px,4px);box-shadow:1px 1px 0 var(--ink);}
.fb-big{padding:17px;font-size:18px;}
.fb-x{background:var(--panel);border:2.5px solid var(--ink);color:var(--ink);border-radius:6px;width:38px;height:38px;font-size:19px;cursor:pointer;flex:none;}
.fb-x:hover{color:var(--ink);border-color:var(--tc);box-shadow:2px 2px 0 var(--tc);}
.fb-err{color:var(--red);margin:0;font-size:13px;font-family:'Space Mono',monospace;}

.fb-sliprow{display:flex;gap:12px;justify-content:center;margin-bottom:6px;}
.fb-sliprow span{position:relative;font-family:'Space Mono',monospace;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);
  background:var(--slip);padding:8px 12px;border:2.5px solid var(--ink);border-radius:5px;box-shadow:3px 3px 0 var(--ink);}
.fb-sliprow span:nth-child(1){transform:rotate(-3deg);}
.fb-sliprow span:nth-child(2){transform:rotate(2deg);}
.fb-sliprow span:nth-child(3){transform:rotate(-2deg);}

/* landing round-by-round breakdown */
.fb-roundlist{width:100%;display:flex;flex-direction:column;gap:10px;}
.fb-roundlisttop{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);text-align:left;}
.fb-rounds{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;width:100%;}
.fb-rounds li{display:flex;align-items:baseline;gap:9px;text-align:left;}
.fb-rname{font-family:Archivo,sans-serif;font-weight:800;font-size:14.5px;color:var(--ink);white-space:nowrap;flex:none;}
.fb-rgloss{color:var(--muted);font-size:13px;line-height:1.42;}
/* pixel-art round glyphs - scale with the text, inherit its colour */
.fb-pixicon{display:inline-flex;width:1.2em;height:1.2em;vertical-align:-0.24em;flex:none;}
.fb-pixicon svg{width:100%;height:100%;display:block;}
.fb-roundtag .fb-pixicon{width:1.35em;height:1.35em;vertical-align:-0.3em;}
.fb-pixicon-th{width:1.7em;height:1.7em;vertical-align:0;}

.fb-steps{display:flex;gap:8px;}
.fb-step{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;background:var(--panel);border:2.5px solid var(--ink);border-radius:6px;padding:11px 6px;font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);cursor:pointer;}
.fb-step.on{border-color:var(--ink);color:var(--ink);box-shadow:4px 4px 0 var(--accent);}
.fb-step.done{color:var(--ink);}
.fb-stepn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1.6px solid currentColor;font-size:11px;flex:none;}
.fb-step.done .fb-stepn{background:var(--green);border-color:var(--green);color:#fff;}

.fb-tcount{font-family:'Space Mono',monospace;color:var(--muted);font-size:13px;min-width:16px;text-align:right;}
.fb-dot{width:11px;height:11px;border-radius:50%;background:var(--tc);flex:none;}
.fb-rosterwrap{display:flex;flex-wrap:wrap;gap:7px;}
.fb-chip{background:#fff;border:2px solid var(--ink);border-radius:999px;padding:6px 11px;color:var(--ink);font-size:13px;display:inline-flex;align-items:center;gap:7px;}
.fb-chip.off{opacity:.5;border-style:dashed;}
.fb-chip.off .fb-dot{background:var(--muted);}
/* live arrivals roster - players pop in as little minifigures */
.fb-arrlist{display:flex;flex-wrap:wrap;gap:9px;}
.fb-arrchip{display:inline-flex;align-items:center;gap:7px;background:#fff;border:2.5px solid var(--ink);border-radius:9px;
  box-shadow:3px 3px 0 var(--ink);padding:5px 15px 5px 7px;font-size:14px;animation:arrpop .34s cubic-bezier(.2,.9,.3,1.35);}
.fb-arrchip svg{display:block;flex:none;}
.fb-arrchip b{font-family:Archivo,sans-serif;font-weight:800;color:var(--ink);}
.fb-arrtag{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;
  background:var(--accent);border:1.5px solid var(--ink);border-radius:4px;padding:1px 5px;}
@keyframes arrpop{0%{transform:translateY(-9px) scale(.55);opacity:0;}60%{transform:translateY(0) scale(1.1);}100%{transform:scale(1);opacity:1;}}
.fb-teampick{display:flex;gap:8px;flex-wrap:wrap;}
.fb-teambtn{flex:1 1 40%;background:#fff;border:2.5px solid var(--ink);border-radius:6px;padding:12px;color:var(--muted);font-weight:800;font-family:inherit;font-size:15px;cursor:pointer;}
.fb-teambtn.on{border-color:var(--tc);color:var(--tc);box-shadow:3px 3px 0 var(--tc);}

.fb-group{background:#fff;border:2.5px solid var(--ink);border-radius:6px;padding:11px 13px;display:flex;flex-direction:column;gap:9px;box-shadow:3px 3px 0 var(--ink);}
.fb-group.mine{box-shadow:4px 4px 0 var(--tc);}
.fb-grouphead{display:flex;align-items:center;gap:10px;}
.fb-grouphead .fb-input.bare{flex:1;}
.fb-empty{color:var(--muted);font-size:12px;font-family:'Space Mono',monospace;letter-spacing:.06em;}
.fb-joinbtn{background:transparent;border:2.5px solid var(--ink);color:var(--ink);border-radius:6px;padding:9px;font-weight:800;font-family:inherit;font-size:14px;cursor:pointer;}
.fb-joinbtn:hover{border-color:var(--tc);color:var(--tc);}
.fb-joinbtn.on{background:var(--tc);border-color:var(--ink);color:#fff;box-shadow:3px 3px 0 var(--ink);}

.fb-qr{width:200px;height:200px;border-radius:6px;background:var(--slip);border:3px solid var(--ink);padding:8px;box-shadow:6px 6px 0 var(--ink);image-rendering:pixelated;}
.fb-statusline{display:flex;align-items:center;gap:8px;margin:0;color:var(--muted);font-size:13px;font-family:'Space Mono',monospace;}
.fb-sharetitle{display:flex;align-items:center;justify-content:center;gap:8px;}
.fb-sharetitle .fb-code{font-size:16px;}
.fb-statusdot{width:10px;height:10px;border-radius:50%;flex:none;border:1.5px solid var(--ink);}
.fb-code{font-family:'Space Mono',monospace;letter-spacing:.12em;color:var(--accent);text-transform:uppercase;}
.fb-linkfield{font-size:12px;text-align:center;}
.fb-sharebtns{width:100%;}

.fb-roundline{display:flex;flex-direction:column;gap:6px;align-items:flex-start;}
.fb-center .fb-roundline{align-items:center;}
.fb-roundtag{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);}
.fb-dots{display:inline-flex;gap:5px;}
.fb-pip{width:8px;height:8px;border-radius:50%;border:1.6px solid var(--accent);box-sizing:border-box;}
.fb-pip.on{background:var(--accent);}

/* Time Timer-style disc - a depleting wedge on a clock face. */
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

.fb-slip{position:relative;align-self:center;max-width:100%;background:var(--slip);padding:26px 20px 22px;border-radius:4px;border:4px solid var(--ink);
  box-shadow:8px 8px 0 var(--ink);transform:rotate(-1deg);animation:slipdrop .28s cubic-bezier(.2,.85,.3,1);}
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
.fb-correct{background:var(--accent);color:var(--ink);border:3px solid var(--ink);font-family:Anton,sans-serif;font-weight:400;font-size:26px;letter-spacing:.04em;padding:20px;box-shadow:6px 6px 0 var(--ink);}
.fb-correct:hover:not(:disabled){box-shadow:7px 7px 0 var(--ink);}
.fb-correct:active:not(:disabled){box-shadow:1px 1px 0 var(--ink);}
.fb-correct span{font-family:'Space Mono',monospace;font-size:12px;opacity:.75;font-weight:700;}
.fb-noskip{text-align:center;color:var(--muted);font-size:12px;margin:0;font-family:'Space Mono',monospace;}

.fb-flash{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;letter-spacing:.04em;color:var(--ink);
  background:var(--accent);border:2.5px solid var(--ink);padding:9px 13px;border-radius:6px;box-shadow:3px 3px 0 var(--ink);}
.fb-flash.big{font-family:Anton,sans-serif;font-weight:400;font-size:20px;letter-spacing:.03em;}
.fb-inherit{color:var(--muted);font-weight:400;margin:0;font-size:13px;font-family:'Space Mono',monospace;}
.fb-inherit::before{content:"\\21B3  ";opacity:.7;}
.fb-paused{margin:0;color:var(--muted);font-family:'Space Mono',monospace;font-size:13px;}.fb-paused b{color:var(--ink);font-size:18px;}
.fb-nextsetup{font-family:Anton,sans-serif;font-size:21px;color:var(--accent);display:flex;flex-direction:column;gap:5px;line-height:1.1;}
.fb-nextsetup span{font-family:Archivo,sans-serif;font-size:13px;color:var(--muted);}
.fb-nextsetup .fb-nextsetuphead{font-family:Anton,sans-serif;font-size:21px;color:var(--accent);display:inline-flex;align-items:center;justify-content:center;gap:7px;}

.fb-standings{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;width:100%;box-sizing:border-box;color:var(--muted);font-size:13px;background:var(--panel);border:2.5px solid var(--ink);box-shadow:4px 4px 0 var(--ink);border-radius:6px;padding:11px 12px;margin-top:6px;font-family:'Space Mono',monospace;}
.fb-standings b{font-family:Anton,sans-serif;font-weight:400;font-size:18px;vertical-align:-2px;}
.fb-stand{display:inline-flex;align-items:center;gap:4px;}
/* whose turn it is - an eyebrow above the big team name */
.fb-uplabel{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:-6px;}
/* which side you're on - a persistent, colour-coded marker */
.fb-youbadge{display:inline-flex;align-items:center;gap:7px;align-self:center;font-family:'Space Mono',monospace;font-size:12px;
  color:var(--ink);background:#fff;border:2px solid var(--ink);border-left:6px solid var(--tc);border-radius:6px;padding:5px 12px;}
.fb-youbadge b{color:var(--tc);font-weight:700;}

.fb-modal{position:fixed;inset:0;background:rgba(20,26,34,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px;z-index:50;}
.fb-modal .fb-card{max-width:500px;width:100%;}

.fb-rankrow{display:flex;align-items:center;gap:11px;background:#fff;border:2.5px solid var(--ink);border-radius:6px;padding:11px 14px;box-shadow:3px 3px 0 var(--ink);}
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
.fb-hostbar button{background:var(--panel);border:2px solid var(--ink);color:var(--ink);border-radius:6px;padding:7px 11px;font-size:11px;cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:.08em;}
.fb-hostbar button:hover{color:var(--ink);border-color:var(--ink);box-shadow:2px 2px 0 var(--ink);}

@media (prefers-reduced-motion:reduce){
  .fb-vtimer.pulse{animation:none;}.fb-vt-disc{transition:none;}.fb-btn{transition:none;}.fb-slip{animation:none;}
  .fb-arrchip{animation:none;}
}
`;
