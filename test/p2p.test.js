import { describe, it, expect, beforeEach } from "vitest";
import { createHostHub, encode, decode } from "../src/engine.js";

/* ------------------------------------------------------------------ *
 * In-memory loopback of a WebRTC data-channel pair. Mirrors the parts
 * of RTCDataChannel the app actually uses: readyState, send(str),
 * onmessage(ev), onclose(). Delivery is async (queueMicrotask) like
 * the real thing, so tests must `await flush()` between steps.
 * ------------------------------------------------------------------ */
function channelPair() {
  const a = { readyState: "open", onmessage: null, onclose: null };
  const b = { readyState: "open", onmessage: null, onclose: null };
  a.send = (data) => queueMicrotask(() => b.onmessage && b.onmessage({ data }));
  b.send = (data) => queueMicrotask(() => a.onmessage && a.onmessage({ data }));
  a.close = () => { a.readyState = b.readyState = "closed"; a.onclose && a.onclose(); };
  b.close = () => { a.readyState = b.readyState = "closed"; b.onclose && b.onclose(); };
  return [a, b];
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// A test "client": holds its host-facing channel, the last lobby/view it
// received, and its assigned id. This is exactly the protocol the real
// ClientApp speaks over the data channel.
function makeClient(name) {
  const [hostSide, clientSide] = channelPair();
  const client = { name, hostSide, clientSide, id: null, lobby: null, view: null, welcomed: false };
  clientSide.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "welcome") { client.id = m.youId; client.welcomed = true; }
    else if (m.t === "lobby") client.lobby = m.lobby;
    else if (m.t === "view") client.view = m.view;
  };
  client.send = (o) => clientSide.send(JSON.stringify(o));
  // A fresh join omits youId; a reload sends the id the host gave us before.
  client.hello = (youId) => client.send({ t: "hello", name, youId });
  return client;
}

describe("P2P host hub — connection + lobby protocol", () => {
  let hub, states;
  beforeEach(() => { states = []; hub = createHostHub({ onState: (s) => states.push(s) }); });

  it("a connecting player gets a welcome id and a lobby snapshot", async () => {
    const c = makeClient("Ann");
    hub.attach(c.hostSide);
    c.hello();
    await flush();

    expect(c.welcomed).toBe(true);
    expect(c.id).toBeTruthy();
    expect(hub.channelCount()).toBe(1);
    expect(c.lobby).toBeTruthy();
    expect(c.lobby.roster.map((p) => p.name)).toContain("Ann");
    expect(hub.getState().players).toHaveLength(1);
  });

  it("two players connect and both appear in each other's lobby", async () => {
    const a = makeClient("Ann"), b = makeClient("Ben");
    hub.attach(a.hostSide); hub.attach(b.hostSide);
    a.hello(); b.hello();
    await flush();

    expect(hub.channelCount()).toBe(2);
    expect(a.id).not.toBe(b.id);
    // last broadcast lobby reflects both players
    const names = b.lobby.roster.map((p) => p.name).sort();
    expect(names).toEqual(["Ann", "Ben"]);
  });

  it("setTeam and word adds flow from client to host state and back out", async () => {
    const a = makeClient("Ann");
    hub.attach(a.hostSide);
    a.hello();
    await flush();

    // host has set up teams before start (done here directly on the hub)
    hub.dispatch({ type: "ADD_TEAM" });
    hub.dispatch({ type: "ADD_TEAM" });
    await flush();
    const teamId = hub.getState().teams[0].id;

    a.send({ t: "setTeam", teamId });
    a.send({ t: "words", words: ["Braai", "biltong"] });
    await flush();

    const me = hub.getState().players.find((p) => p.id === a.id);
    expect(me.teamId).toBe(teamId);
    expect(hub.getState().bowl).toEqual(["Braai", "biltong"]);
    expect(a.lobby.bowlCount).toBe(2);
  });

  it("words from two clients are merged and de-duplicated in one bowl", async () => {
    const a = makeClient("Ann"), b = makeClient("Ben");
    hub.attach(a.hostSide); hub.attach(b.hostSide);
    a.hello(); b.hello();
    await flush();

    a.send({ t: "words", words: ["Braai", "Pap"] });
    b.send({ t: "words", words: ["braai", "Boerewors"] }); // "braai" is a dupe
    await flush();

    expect(hub.getState().bowl).toEqual(["Braai", "Pap", "Boerewors"]);
  });

  it("a disconnecting player keeps their slot so a reload can reclaim it", async () => {
    const a = makeClient("Ann"), b = makeClient("Ben");
    hub.attach(a.hostSide); hub.attach(b.hostSide);
    a.hello(); b.hello();
    await flush();
    expect(hub.getState().players).toHaveLength(2);

    a.hostSide.close();
    await flush();
    expect(hub.channelCount()).toBe(1);                                   // channel dropped
    expect(hub.getState().players.map((p) => p.name)).toEqual(["Ann", "Ben"]); // but player remains
  });

  it("a reloaded player reconnects to the same slot, team and scores", async () => {
    const a = makeClient("Ann"), b = makeClient("Ben");
    hub.attach(a.hostSide); hub.attach(b.hostSide);
    a.hello(); b.hello();
    await flush();
    hub.dispatch({ type: "ADD_TEAM" });
    hub.dispatch({ type: "ADD_TEAM" });
    await flush();
    const teamId = hub.getState().teams[0].id;
    a.send({ t: "setTeam", teamId });
    await flush();
    const annId = a.id;

    a.hostSide.close(); // Ann reloads — connection is gone, slot is not
    await flush();

    // Ann re-signals (a fresh channel) and says hello with her saved id.
    const a2 = makeClient("Ann");
    a2.id = annId;
    hub.attach(a2.hostSide);
    a2.hello(annId);
    await flush();

    expect(a2.id).toBe(annId);                                  // same identity, no duplicate
    expect(hub.getState().players.filter((p) => p.id === annId)).toHaveLength(1);
    expect(hub.getState().players.find((p) => p.id === annId).teamId).toBe(teamId);
    expect(a2.lobby.youTeamId).toBe(teamId);                    // team restored on the client
    expect(hub.channelCount()).toBe(2);
  });
});

describe("P2P host hub — in-game word privacy over the wire", () => {
  it("only the active clue-giver's device ever receives the word", async () => {
    const hub = createHostHub();
    const a = makeClient("Ann"), b = makeClient("Ben");
    hub.attach(a.hostSide); hub.attach(b.hostSide);
    a.hello(); b.hello();
    await flush();

    hub.dispatch({ type: "ADD_TEAM" });
    hub.dispatch({ type: "ADD_TEAM" });
    await flush();
    const [t1, t2] = hub.getState().teams;

    a.send({ t: "setTeam", teamId: t1.id });
    b.send({ t: "setTeam", teamId: t2.id });
    a.send({ t: "words", words: ["Braai", "Biltong", "Pap", "Vetkoek"] });
    await flush();

    hub.dispatch({ type: "START_GAME" });
    await flush();

    // whichever client is on the up team claims and begins
    const upTeamId = hub.getState().teams[hub.getState().activeTeamIdx].id;
    const giver = upTeamId === t1.id ? a : b;
    const watcher = giver === a ? b : a;

    giver.send({ t: "intent", action: "CLAIM_AND_BEGIN" });
    await flush();

    expect(giver.view.phase).toBe("play");
    expect(giver.view.word).toBeTruthy();      // the giver sees the slip
    expect(giver.view.canCorrect).toBe(true);
    expect(giver.view.nextWords.length).toBeGreaterThan(0); // and a lookahead buffer
    expect(watcher.view.word).toBeNull();       // the word never reaches anyone else
    expect(watcher.view.canCorrect).toBe(false);
    expect(watcher.view.nextWords).toEqual([]); // nor does the buffer

    // a CORRECT intent from the giver scores; from the watcher it is ignored
    const before = hub.getState().scores[upTeamId][0];
    watcher.send({ t: "intent", action: "CORRECT" });
    await flush();
    expect(hub.getState().scores[upTeamId][0]).toBe(before);

    giver.send({ t: "intent", action: "CORRECT" });
    await flush();
    expect(hub.getState().scores[upTeamId][0]).toBe(before + 1);
  });
});

describe("signaling handshake shape", () => {
  it("offer/answer codes survive the encode -> decode the peers exchange", () => {
    // What the client sends the host:
    const offer = { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n(offer)\r\n" };
    const joinCode = encode(offer);
    expect(decode(joinCode)).toEqual(offer);

    // What the host reads back to the client:
    const answer = { type: "answer", sdp: "v=0\r\no=- 3 4 IN IP4 0.0.0.0\r\n(answer)\r\n" };
    const replyCode = encode(answer);
    expect(decode(replyCode)).toEqual(answer);

    expect(joinCode).not.toBe(replyCode);
  });
});
