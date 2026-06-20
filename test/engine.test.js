import { describe, it, expect } from "vitest";
import {
  reducer, initial, viewFor, lobbyFor, encode, decode, shuffle, createHostHub,
  ROUNDS, PALETTE, MIN_WORDS, MAX_TEAMS, TURN_SECONDS, MURRAY_DECK, LOOKAHEAD,
} from "../src/engine.js";

// An in-memory stand-in for a WebRTC data channel: records what the hub
// sends, and lets a test push a client message in or simulate a drop.
function makeChannel() {
  return {
    readyState: "open", sent: [],
    send(s) { this.sent.push(JSON.parse(s)); },
    close() { if (this.readyState === "open") { this.readyState = "closed"; this.onclose?.(); } },
    recv(m) { this.onmessage?.({ data: JSON.stringify(m) }); },
    last(t) { return [...this.sent].reverse().find((m) => m.t === t); },
  };
}

// Drive the reducer through a list of actions from a starting state.
const run = (state, actions) => actions.reduce((s, a) => reducer(s, a), state);

// A ready-to-play state: 2 teams, one player each, a small bowl, game started.
function startedGame(bowl = ["alpha", "bravo", "charlie", "delta"]) {
  let s = run(initial, [
    { type: "ADD_TEAM" },
    { type: "ADD_TEAM" },
    { type: "ADD_WORDS", words: bowl },
  ]);
  const [t1, t2] = s.teams;
  s = run(s, [
    { type: "ADD_PLAYER", player: { id: "p1", name: "Ann", teamId: t1.id } },
    { type: "ADD_PLAYER", player: { id: "p2", name: "Ben", teamId: t2.id } },
    { type: "START_GAME" },
  ]);
  return { s, t1, t2 };
}

describe("deck + constants", () => {
  it("ships a South African student deck with enough unique words", () => {
    expect(MURRAY_DECK.length).toBeGreaterThanOrEqual(MIN_WORDS);
    const lower = MURRAY_DECK.map((w) => w.toLowerCase());
    expect(new Set(lower).size).toBe(MURRAY_DECK.length); // no dupes
    expect(MURRAY_DECK).toContain("Braai");
    expect(MURRAY_DECK).toContain("Load shedding");
  });
  it("has 5 rounds and a colour per palette slot", () => {
    expect(ROUNDS).toHaveLength(5);
    expect(PALETTE.length).toBeGreaterThanOrEqual(MAX_TEAMS);
    expect(TURN_SECONDS).toBe(60);
  });
});

describe("lobby reducer", () => {
  it("adds teams up to the max and never below two", () => {
    let s = initial;
    for (let i = 0; i < MAX_TEAMS + 3; i++) s = reducer(s, { type: "ADD_TEAM" });
    expect(s.teams).toHaveLength(MAX_TEAMS);
    // removing down to the floor of two
    while (s.teams.length > 2) s = reducer(s, { type: "REMOVE_TEAM", id: s.teams[0].id });
    s = reducer(s, { type: "REMOVE_TEAM", id: s.teams[0].id });
    expect(s.teams).toHaveLength(2);
  });

  it("dedupes words case-insensitively and trims", () => {
    const s = run(initial, [
      { type: "ADD_WORDS", words: ["Braai", "  biltong ", "BRAAI", "braai"] },
    ]);
    expect(s.bowl).toEqual(["Braai", "biltong"]);
  });

  it("unassigns players when their team is removed", () => {
    let s = run(initial, [{ type: "ADD_TEAM" }, { type: "ADD_TEAM" }, { type: "ADD_TEAM" }]);
    const team = s.teams[2];
    s = reducer(s, { type: "ADD_PLAYER", player: { id: "p1", name: "Ann", teamId: team.id } });
    s = reducer(s, { type: "REMOVE_TEAM", id: team.id });
    expect(s.players[0].teamId).toBeNull();
  });
});

describe("game flow", () => {
  it("START_GAME deals the bowl, zeroes scores and picks a team with players", () => {
    const { s } = startedGame();
    expect(s.phase).toBe("ready");
    expect(s.deck).toHaveLength(4);
    expect(s.teams.every((t) => t.color)).toBe(true);
    for (const t of s.teams) expect(s.scores[t.id]).toEqual([0, 0, 0, 0, 0]);
    expect(s.players.some((p) => p.teamId === s.teams[s.activeTeamIdx].id)).toBe(true);
  });

  it("only an active-team player can claim the turn", () => {
    const { s } = startedGame();
    const upTeam = s.teams[s.activeTeamIdx];
    const offTeamPlayer = s.players.find((p) => p.teamId !== upTeam.id);
    const onTeamPlayer = s.players.find((p) => p.teamId === upTeam.id);

    const blocked = reducer(s, { type: "CLAIM_AND_BEGIN", fromId: offTeamPlayer.id });
    expect(blocked).toBe(s); // unchanged

    const playing = reducer(s, { type: "CLAIM_AND_BEGIN", fromId: onTeamPlayer.id });
    expect(playing.phase).toBe("play");
    expect(playing.running).toBe(true);
    expect(playing.activePlayerId).toBe(onTeamPlayer.id);
    expect(playing.activeCard).toBeTruthy();
    expect(playing.timeLeft).toBe(TURN_SECONDS);
  });

  it("CORRECT scores the current round and only from the active player", () => {
    const { s } = startedGame();
    const up = s.teams[s.activeTeamIdx];
    const giver = s.players.find((p) => p.teamId === up.id);
    let g = reducer(s, { type: "CLAIM_AND_BEGIN", fromId: giver.id });

    // a non-active player cannot score
    expect(reducer(g, { type: "CORRECT", fromId: "p2" })).toBe(g);

    const firstCard = g.activeCard;
    g = reducer(g, { type: "CORRECT", fromId: giver.id });
    expect(g.scores[up.id][0]).toBe(1);
    expect(g.discard).toContain(firstCard);
    expect(g.activeCard).not.toBe(firstCard);
  });

  it("running out the clock passes the turn and keeps the unsolved card", () => {
    const { s } = startedGame();
    const up = s.teams[s.activeTeamIdx];
    const giver = s.players.find((p) => p.teamId === up.id);
    let g = reducer(s, { type: "CLAIM_AND_BEGIN", fromId: giver.id });
    const card = g.activeCard;
    g = { ...g, timeLeft: 1 };
    g = reducer(g, { type: "TICK" });
    expect(g.phase).toBe("ready");
    expect(g.running).toBe(false);
    expect(g.activeCard).toBe(card); // inherited
    expect(g.activeTeamIdx).not.toBe(s.activeTeamIdx);
    expect(g.turnNumber).toBe(2);
  });

  it("clearing the bowl advances the round, and round 5 ends the game", () => {
    const { s } = startedGame(["only-one"]);
    const up = s.teams[s.activeTeamIdx];
    const giver = s.players.find((p) => p.teamId === up.id);

    const playOutRound = (state) => {
      let g = reducer(state, { type: "CLAIM_AND_BEGIN", fromId: giver.id });
      return reducer(g, { type: "CORRECT", fromId: giver.id });
    };

    let g = s;
    for (let round = 1; round <= 4; round++) {
      g = playOutRound(g);
      expect(g.phase).toBe("transition");
      expect(g.currentRound).toBe(round + 1);
      // resume into the next round so a player is active again
      g = reducer(g, { type: "RESUME", fromId: giver.id });
      // RESUME only works for the active player; activePlayerId carried over
      expect(g.phase === "play" || g.phase === "ready").toBe(true);
      if (g.phase !== "play") {
        g = reducer(g, { type: "CLAIM_AND_BEGIN", fromId: giver.id });
      }
    }
    // round 5: clearing the deck should end the game
    g = reducer(g, { type: "CORRECT", fromId: giver.id });
    expect(g.phase).toBe("endgame");
  });

  it("FORCE_NEXT and END_GAME behave", () => {
    const { s } = startedGame();
    const forced = reducer(s, { type: "FORCE_NEXT" });
    expect(forced.activeTeamIdx).not.toBe(s.activeTeamIdx);
    expect(reducer(s, { type: "END_GAME" }).phase).toBe("endgame");
  });
});

describe("privacy: viewFor", () => {
  it("shows the word ONLY to the active clue-giver", () => {
    const { s } = startedGame();
    const up = s.teams[s.activeTeamIdx];
    const giver = s.players.find((p) => p.teamId === up.id);
    const other = s.players.find((p) => p.teamId !== up.id);
    const g = reducer(s, { type: "CLAIM_AND_BEGIN", fromId: giver.id });

    const giverView = viewFor(g, giver.id);
    const otherView = viewFor(g, other.id);

    expect(giverView.word).toBeTruthy();
    expect(giverView.isActive).toBe(true);
    expect(giverView.canCorrect).toBe(true);

    expect(otherView.word).toBeNull(); // never leaks
    expect(otherView.isActive).toBe(false);
    expect(otherView.canCorrect).toBe(false);
  });

  it("buffers upcoming cards ONLY for the active giver, capped at LOOKAHEAD", () => {
    const { s } = startedGame(); // 4-word bowl
    const up = s.teams[s.activeTeamIdx];
    const giver = s.players.find((p) => p.teamId === up.id);
    const other = s.players.find((p) => p.teamId !== up.id);
    const g = reducer(s, { type: "CLAIM_AND_BEGIN", fromId: giver.id });

    const giverView = viewFor(g, giver.id);
    expect(giverView.nextWords).toEqual(g.deck.slice(0, LOOKAHEAD)); // the real upcoming cards
    expect(giverView.nextWords).toHaveLength(LOOKAHEAD);
    expect(giverView.nextWords).not.toContain(g.activeCard); // never the current card

    expect(viewFor(g, other.id).nextWords).toEqual([]); // watchers get nothing
  });

  it("the buffer empties out near a round boundary so the host drives the transition", () => {
    const { s } = startedGame(["solo"]); // deck of one
    const up = s.teams[s.activeTeamIdx];
    const giver = s.players.find((p) => p.teamId === up.id);
    const g = reducer(s, { type: "CLAIM_AND_BEGIN", fromId: giver.id });
    expect(g.deck).toHaveLength(0);
    expect(viewFor(g, giver.id).nextWords).toEqual([]); // nothing to optimistically flip to
  });

  it("canClaim is true only for an up-team member in the ready phase", () => {
    const { s } = startedGame();
    const up = s.teams[s.activeTeamIdx];
    const onTeam = s.players.find((p) => p.teamId === up.id);
    const offTeam = s.players.find((p) => p.teamId !== up.id);
    expect(viewFor(s, onTeam.id).canClaim).toBe(true);
    expect(viewFor(s, offTeam.id).canClaim).toBe(false);
  });
});

describe("lobbyFor", () => {
  it("reports bowl count, roster and per-player id", () => {
    let s = run(initial, [{ type: "ADD_TEAM" }, { type: "ADD_TEAM" }, { type: "ADD_WORDS", words: ["a", "b"] }]);
    s = reducer(s, { type: "ADD_PLAYER", player: { id: "p1", name: "Ann", teamId: s.teams[0].id } });
    const lobby = lobbyFor(s, "p1");
    expect(lobby.bowlCount).toBe(2);
    expect(lobby.youId).toBe("p1");
    expect(lobby.started).toBe(false);
    expect(lobby.roster).toEqual([{ name: "Ann", teamId: s.teams[0].id }]);
    expect(lobby.teams[0].color).toBe(PALETTE[0]);
    expect(lobby.youTeamId).toBe(s.teams[0].id); // so a reconnecting client restores its team
  });
});

describe("P2P host hub — reload persistence", () => {
  it("rehydrates from a saved state when the host reloads", () => {
    const { s } = startedGame();
    const hub = createHostHub({ initialState: s });
    expect(hub.getState()).toBe(s); // in-progress game recovered, not reset to lobby
    expect(hub.getState().phase).toBe("ready");
  });

  it("registers a brand-new player and hands back an id", () => {
    const hub = createHostHub();
    const ch = makeChannel();
    hub.attach(ch);
    ch.recv({ t: "hello", name: "Ann" });
    const welcome = ch.last("welcome");
    expect(welcome.youId).toBeTruthy();
    expect(hub.getState().players.map((p) => p.id)).toContain(welcome.youId);
    expect(hub.channelCount()).toBe(1);
  });

  it("keeps the player on disconnect so the slot can be reclaimed", () => {
    const hub = createHostHub();
    const ch = makeChannel();
    hub.attach(ch);
    ch.recv({ t: "hello", name: "Ann" });
    const pid = ch.last("welcome").youId;
    ch.close();
    expect(hub.channelCount()).toBe(0);          // channel gone
    expect(hub.getState().players.some((p) => p.id === pid)).toBe(true); // player stays
  });

  it("reclaims the same slot + team when a device rejoins with its saved id", () => {
    const hub = createHostHub();
    hub.dispatch({ type: "ADD_TEAM" });
    hub.dispatch({ type: "ADD_TEAM" });
    const teamId = hub.getState().teams[1].id;

    const a = makeChannel();
    hub.attach(a);
    a.recv({ t: "hello", name: "Ann" });
    const pid = a.last("welcome").youId;
    hub.dispatch({ type: "SET_TEAM", id: pid, teamId });
    a.close();

    // ...later, the same player reloads and reconnects with their saved id.
    const b = makeChannel();
    hub.attach(b);
    b.recv({ t: "hello", name: "Ann", youId: pid });

    expect(b.last("welcome").youId).toBe(pid);                 // same identity
    expect(hub.getState().players.filter((p) => p.id === pid)).toHaveLength(1); // no duplicate
    expect(hub.getState().players.find((p) => p.id === pid).teamId).toBe(teamId); // team kept
    expect(b.last("lobby")?.lobby.youTeamId).toBe(teamId);     // and pushed back to them
  });

  it("a stale channel closing after a reclaim doesn't drop the live one", () => {
    const hub = createHostHub();
    const a = makeChannel();
    hub.attach(a);
    a.recv({ t: "hello", name: "Ann" });
    const pid = a.last("welcome").youId;

    const b = makeChannel();
    hub.attach(b);
    b.recv({ t: "hello", name: "Ann", youId: pid }); // reclaims pid (closes a)
    a.close(); // late onclose from the old channel

    expect(hub.channelCount()).toBe(1); // b survives
  });

  it("treats an unknown saved id as a fresh join", () => {
    const hub = createHostHub();
    const ch = makeChannel();
    hub.attach(ch);
    ch.recv({ t: "hello", name: "Ghost", youId: "nope42" });
    const pid = ch.last("welcome").youId;
    expect(pid).not.toBe("nope42");
    expect(hub.getState().players.map((p) => p.id)).toContain(pid);
  });
});

describe("signaling codec", () => {
  it("round-trips an SDP description through encode/decode", () => {
    const offer = { type: "offer", sdp: "v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\ns=-\r\n" };
    const code = encode(offer);
    expect(typeof code).toBe("string");
    expect(code).not.toContain("v=0"); // base64, not plaintext
    expect(decode(code)).toEqual(offer);
    expect(decode("  " + code + "\n")).toEqual(offer); // tolerant of whitespace
  });
});

describe("shuffle", () => {
  it("keeps every element and the same length", () => {
    const src = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffle(src);
    expect(out).toHaveLength(50);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
    expect(src).toEqual(Array.from({ length: 50 }, (_, i) => i)); // original untouched
  });
});
