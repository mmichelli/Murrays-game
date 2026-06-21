import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LANGS, DEFAULT_LANG, browserLang, detectLang, saveLang, makeT, roundText } from "../src/i18n.js";
import { ROUNDS } from "../src/engine.js";

// Stand in a navigator + localStorage so the browser-facing helpers are
// testable in Node, then restore the originals between tests.
const orig = {};
function setNavigator(nav) {
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
}
function setLocalStorage(store) {
  const map = new Map(Object.entries(store || {}));
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    },
    configurable: true,
  });
}

beforeEach(() => {
  orig.navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  orig.localStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
});
afterEach(() => {
  if (orig.navigator) Object.defineProperty(globalThis, "navigator", orig.navigator);
  else delete globalThis.navigator;
  if (orig.localStorage) Object.defineProperty(globalThis, "localStorage", orig.localStorage);
  else delete globalThis.localStorage;
});

describe("language set", () => {
  it("ships exactly English and Norwegian, each with a flag", () => {
    expect(LANGS.map((l) => l.code)).toEqual(["en", "no"]);
    LANGS.forEach((l) => { expect(l.flag).toBeTruthy(); expect(l.label).toBeTruthy(); });
  });
  it("defaults to English", () => { expect(DEFAULT_LANG).toBe("en"); });
});

describe("browserLang", () => {
  it("follows a Norwegian browser preference (nb/nn/no)", () => {
    for (const tag of ["nb-NO", "nn-NO", "no"]) {
      setNavigator({ languages: [tag, "en"] });
      expect(browserLang()).toBe("no");
    }
  });
  it("follows an English preference", () => {
    setNavigator({ languages: ["en-GB"] });
    expect(browserLang()).toBe("en");
  });
  it("honours preference order, picking the first shipped language", () => {
    setNavigator({ languages: ["de-DE", "nb-NO", "en"] });
    expect(browserLang()).toBe("no");
  });
  it("falls back to English for unsupported languages", () => {
    setNavigator({ languages: ["de-DE", "fr-FR"] });
    expect(browserLang()).toBe("en");
  });
  it("reads the single navigator.language when there is no list", () => {
    setNavigator({ language: "nb" });
    expect(browserLang()).toBe("no");
  });
  it("defaults to English when navigator is unavailable", () => {
    setNavigator(undefined);
    expect(browserLang()).toBe("en");
  });
});

describe("detectLang + saveLang", () => {
  it("prefers a remembered choice over the browser preference", () => {
    setNavigator({ languages: ["nb-NO"] });
    setLocalStorage({ "mrysg.lang": "en" });
    expect(detectLang()).toBe("en");
  });
  it("falls back to the browser preference with no saved choice", () => {
    setNavigator({ languages: ["nb-NO"] });
    setLocalStorage({});
    expect(detectLang()).toBe("no");
  });
  it("ignores a saved value that is not a shipped language", () => {
    setNavigator({ languages: ["en-US"] });
    setLocalStorage({ "mrysg.lang": "xx" });
    expect(detectLang()).toBe("en");
  });
  it("persists a choice that detectLang then reads back", () => {
    setNavigator({ languages: ["en-US"] });
    setLocalStorage({});
    saveLang("no");
    expect(detectLang()).toBe("no");
  });
});

describe("makeT", () => {
  it("translates the same key differently per language", () => {
    expect(makeT("en")("lobby.start")).toBe("Start game");
    expect(makeT("no")("lobby.start")).toBe("Start spillet");
  });
  it("interpolates parameters", () => {
    expect(makeT("en")("end.wins", { team: "Bokke" })).toBe("Bokke wins!");
    expect(makeT("no")("end.wins", { team: "Bokke" })).toBe("Bokke vinner!");
    expect(makeT("en")("arrivals.title", { n: 3 })).toBe("Who's here · 3");
  });
  it("returns rich strings as segment arrays for inline bold", () => {
    const segs = makeT("en")("client.joiningRoom", { code: "kx7m2p" });
    expect(Array.isArray(segs)).toBe(true);
    expect(segs).toContainEqual({ b: "kx7m2p" });
  });
  it("falls back to English for a key missing in another language", () => {
    // every key resolvable in English should resolve in Norwegian too,
    // but an unknown key never renders blank - it yields the key itself.
    expect(makeT("no")("totally.unknown.key")).toBe("totally.unknown.key");
  });
});

describe("roundText", () => {
  it("gives all five rounds localized text in both languages", () => {
    for (const lang of ["en", "no"]) {
      const t = makeT(lang);
      ROUNDS.forEach((r) => {
        const rt = roundText(t, r.n);
        // setup is optional (rounds 1-3 need no extra instruction); the rest copy.
        ["name", "allowed", "restrict", "gloss"].forEach((f) => {
          expect(typeof rt[f]).toBe("string");
          expect(rt[f].length).toBeGreaterThan(0);
        });
        expect(typeof rt.setup).toBe("string");
      });
    }
  });
  it("renders round names in the chosen language", () => {
    expect(roundText(makeT("en"), 1).name).toBe("Describe");
    expect(roundText(makeT("no"), 1).name).toBe("Forklar");
  });
});
