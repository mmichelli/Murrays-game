import { describe, it, expect } from "vitest";
import {
  reducer, initial, viewFor, lobbyFor, encode, decode, shuffle,
  ROUNDS, PALETTE, MIN_WORDS, MAX_TEAMS, TURN_SECONDS, MURRAY_DECK,
  WORDS_PER_PLAYER, sampleDeck,
} from "../src/engine.js";

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
  it("sampleDeck deals a small unique subset sized to top a player up", () => {
    expect(sampleDeck()).toHaveLength(WORDS_PER_PLAYER); // defaults to the per-player goal
    const hand = sampleDeck(3);
    expect(hand).toHaveLength(3);
    expect(sampleDeck(0)).toHaveLength(0); // already at target → nothing to deal
    expect(WORDS_PER_PLAYER).toBeLessThan(MURRAY_DECK.length);
    expect(new Set(hand).size).toBe(hand.length); // no dupes
    expect(hand.every((w) => MURRAY_DECK.includes(w))).toBe(true);
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

  it("tallies words per contributor, counting only what's actually added", () => {
    let s = run(initial, [
      { type: "ADD_WORDS", words: ["Braai", "Pap"], by: "ann" },
      { type: "ADD_WORDS", words: ["braai", "Boerewors"], by: "ben" }, // "braai" is a dupe
      { type: "ADD_WORDS", words: ["Anon"] },                          // no contributor
    ]);
    expect(s.wordCounts).toEqual({ ann: 2, ben: 1 });
    // removing a player forgets their tally (their words stay in the bowl)
    s = reducer(s, { type: "REMOVE_PLAYER", id: "ann" });
    expect(s.wordCounts).toEqual({ ben: 1 });
    expect(s.bowl).toContain("Braai");
  });

  it("keeps a player's seat on disconnect and restores it on reconnect", () => {
    let s = run(initial, [
      { type: "ADD_PLAYER", player: { id: "ann", name: "Ann", teamId: null } },
    ]);
    expect(s.players[0].connected).toBe(true);
    s = reducer(s, { type: "SET_CONNECTED", id: "ann", connected: false });
    expect(s.players).toHaveLength(1);              // not removed
    expect(s.players[0].connected).toBe(false);
    s = reducer(s, { type: "SET_CONNECTED", id: "ann", connected: true });
    expect(s.players[0].connected).toBe(true);
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
    expect(lobby.roster).toEqual([{ id: "p1", name: "Ann", teamId: s.teams[0].id, isHost: false, connected: true, words: 0 }]);
    expect(lobby.teams[0].color).toBe(PALETTE[0]);
    expect(lobby.teams[0].count).toBe(1); // Ann is in the first group
    expect(lobby.teams[1].count).toBe(0);
    expect(lobby.maxTeams).toBe(MAX_TEAMS);
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
