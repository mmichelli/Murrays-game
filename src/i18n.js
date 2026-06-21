/* ================================================================== *
 * MURRAY'S GAME - internationalisation (English + Norwegian).
 *
 * Pure, framework-agnostic: language detection + persistence + the
 * string tables. The React side (App.jsx) wraps this in a context and
 * a flag picker. Round text lives here keyed by round number so each
 * device renders the rounds in ITS OWN language - the engine only ever
 * sends the round number over the wire, never localized prose.
 * ================================================================== */

// The languages we ship, in the order the flag picker shows them.
export const LANGS = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "no", label: "Norsk", flag: "🇳🇴" },
];
export const DEFAULT_LANG = "en";
const LS_KEY = "mrysg.lang";

// Map a BCP-47 tag (e.g. "nb-NO", "en-GB") to one of our codes, or null.
function tagToCode(tag) {
  const t = String(tag || "").toLowerCase();
  if (t.startsWith("nb") || t.startsWith("nn") || t.startsWith("no")) return "no";
  if (t.startsWith("en")) return "en";
  return null;
}
// Follow the browser's preference order; first language we ship wins.
export function browserLang() {
  try {
    const prefs = (typeof navigator !== "undefined" && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
    for (const p of prefs) { const c = tagToCode(p); if (c) return c; }
  } catch {}
  return DEFAULT_LANG;
}
// Pick the starting language: a remembered choice wins, else the browser
// preference, else English.
export function detectLang() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
  } catch {}
  return browserLang();
}
export function saveLang(code) { try { localStorage.setItem(LS_KEY, code); } catch {} }

/* ----------------------------- strings ---------------------------- *
 * Leaves are either plain strings or functions of an interpolation
 * object. `makeT(lang)` returns a `t(key, params)` that resolves a
 * dotted path and falls back to English for any missing key.
 * ------------------------------------------------------------------ */
const STRINGS = {
  en: {
    common: { home: "Back to start", yourName: "Your name", add: "Add" },
    landing: {
      lead: "The legendary game you might know as", or: "or", hatGame: "the Hat Game",
      tail: "Everyone adds their words to one shared wordlist, then teams race to make each other guess them.",
      harder: "Same words, all five rounds, each one harder:",
      openRoom: "Create a game", joinRoom: "Join a game",
      slips: ["talk", "mime", "peek"],
      heroTag: "The party word game", heroSub: "One wordlist · five rounds · pure chaos",
      named: "Named after Murray, one of the guys at UKZN who taught our group the game.",
    },
    host: {
      hosting: "You're hosting", createRoom: "Create the game", host: "Host",
      keepOpen: "📌 Heads up - your phone runs the game. Keep this page open the whole time you play; if it closes, the game ends for everyone.",
      forceNext: "Force next turn", endGame: "End game", playAgain: "Play again, same wordlist",
    },
    steps: { invite: "Invite", groups: "Groups", bowl: "Wordlist" },
    lobby: {
      nextGroups: "Next · groups →", nextBowl: "Next · the wordlist →",
      total: "in the wordlist",
      start: "Start game", waitPlayers: "Waiting for players to join",
      addMore: ({ n }) => `Add ${n} more words`,
      needGroup: "Everyone needs a group", needTwo: "Need 2 groups with players",
    },
    arrivals: { title: ({ n }) => `Who's here · ${n}` },
    client: {
      joinRoom: "Join a room",
      joiningRoom: ({ code }) => ["Joining room ", { b: code }, ". Just pop your name in."],
      roomCode: "Room code", join: "Join room", connecting: "Connecting…",
      reaching: "Reaching the room…", roomNotAnswering: "Room not answering yet, retrying…",
      waitHost: "Waiting for the host to start…", joinGroupReady: "Join a group to be ready.",
    },
    reconnect: {
      online: "⟳ Connection dropped, getting you back in…",
      offline: "📡 You're offline. You'll rejoin automatically the moment you're back.",
    },
    ready: {
      timesUp: "⏰ Time's up!", yourTurn: "Your team's turn", nowUp: "Now up to give clues",
      inherit: "You'd inherit one un-guessed card.",
      illGive: ({ n }) => `I'll give clues · ${n}s`,
      someone: 'Someone tap "I\'ll give clues" on their phone.',
      watch: "Watch the room.",
    },
    youbadge: { lead: "You're on" },
    timer: { sec: "sec", secsLeft: ({ n }) => `${n} seconds left` },
    rules: { allowed: "Allowed", never: "Never" },
    play: {
      correct: "CORRECT", spacebar: "(Spacebar)",
      noSkip: "No skipping. Resolve it or run out the clock.",
      givingFor: "is giving clues for",
      guessOut: "Guess out loud. The word stays on their phone.",
    },
    trans: {
      roundOver: "⏸ Round over mid-turn", pausedLead: "Paused ·", pausedLeft: "left",
      roundIs: ({ n, name }) => ["ROUND ", n, " IS ", { b: name }],
      resume: "Resume turn ▶", waitResume: ({ name }) => `Waiting for ${name} to resume…`,
    },
    end: {
      tie: "It's a tie!", wins: ({ team }) => `${team} wins!`,
      roundByRound: "Round-by-round", team: "Team",
    },
    group: {
      empty: "empty", you: " (you)", host: " · host", offline: " · offline",
      youreIn: "✓ You're in this group", joinThis: "Join this group",
      noGroup: " · no group yet", addGroup: "+ add a group", nameLabel: "Group name", remove: "Remove group",
    },
    share: {
      connecting: "Connecting…", errorTitle: "Code taken - re-open", roomLabel: "Room",
      copied: "Copied ✓", copyLink: "Copy link", shareDots: "Share…",
      joinMyRoom: "Join my room", qrAlt: "QR code to join the room", roomLink: "Room link",
    },
    words: {
      progressLead: "Your words", plenty: "✓ that's plenty", typeWord: "Type a word…",
      deleteAria: ({ w }) => `Delete "${w}"`,
      fillMine: ({ n }) => `Fill my ${n} from Murray's deck`,
    },
    deck: {
      allIn: "The whole deck is already in the wordlist.",
      fillBowl: ({ n }) => `Fill the wordlist from Murray's deck (+${n})`,
      addMore: ({ n }) => `Add ${n} more from Murray's deck`,
    },
    lang: { label: "Language" },
    round: {
      1: { name: "Describe", setup: "Stand in front of your team.", allowed: "Sentences, descriptions, sounds, gestures.", restrict: "Don't say the word, parts of it, or rhymes.", gloss: "say anything but the word" },
      2: { name: "Charades", setup: "Stand in front of your team.", allowed: "Full-body acting and miming.", restrict: "Silence. No speaking, whispering or mouthing.", gloss: "act it out, no talking" },
      3: { name: "One Word", setup: "Stand in front of your team.", allowed: "Exactly one word, total, per card.", restrict: "Repeat it, but never change it or gesture.", gloss: "just one word, out loud" },
      4: { name: "Hands Only", setup: "Behind the couch - only hands show.", allowed: "Fingers, hands and forearms.", restrict: "Silence. Head, face, torso, legs hidden.", gloss: "clues with your hands only" },
      5: { name: "Face Only", setup: "Peek over the couch - only your face.", allowed: "Eyes, brows, nose, mouth, head tilts.", restrict: "Silence. Neck down stays hidden.", gloss: "clues with your face only" },
    },
  },
  no: {
    common: { home: "Tilbake til start", yourName: "Ditt navn", add: "Legg til" },
    landing: {
      lead: "Det legendariske spillet du kanskje kjenner som", or: "eller", hatGame: "Hatteleken",
      tail: "Alle legger til ordene sine i én felles ordliste, så kappes lagene om å få hverandre til å gjette dem.",
      harder: "Samme ord, alle fem runder, hver vanskeligere enn den forrige:",
      openRoom: "Lag et spill", joinRoom: "Bli med i et spill",
      slips: ["snakk", "mim", "kikk"],
      heroTag: "Festens ordspill", heroSub: "Én ordliste · fem runder · rent kaos",
      named: "Oppkalt etter Murray, en av gutta på UKZN som lærte gjengen vår spillet.",
    },
    host: {
      hosting: "Du er vert", createRoom: "Lag spillet", host: "Vert",
      keepOpen: "📌 Obs - telefonen din kjører spillet. Hold denne siden åpen hele tiden mens dere spiller; lukkes den, avsluttes spillet for alle.",
      forceNext: "Tving neste tur", endGame: "Avslutt spillet", playAgain: "Spill igjen, samme ordliste",
    },
    steps: { invite: "Inviter", groups: "Grupper", bowl: "Ordliste" },
    lobby: {
      nextGroups: "Neste · grupper →", nextBowl: "Neste · ordlisten →",
      total: "i ordlisten",
      start: "Start spillet", waitPlayers: "Venter på at spillere blir med",
      addMore: ({ n }) => `Legg til ${n} ord til`,
      needGroup: "Alle trenger en gruppe", needTwo: "Trenger 2 grupper med spillere",
    },
    arrivals: { title: ({ n }) => `Hvem er her · ${n}` },
    client: {
      joinRoom: "Bli med i et rom",
      joiningRoom: ({ code }) => ["Blir med i rom ", { b: code }, ". Bare skriv inn navnet ditt."],
      roomCode: "Romkode", join: "Bli med", connecting: "Kobler til…",
      reaching: "Når rommet…", roomNotAnswering: "Rommet svarer ikke ennå, prøver igjen…",
      waitHost: "Venter på at verten starter…", joinGroupReady: "Bli med i en gruppe for å være klar.",
    },
    reconnect: {
      online: "⟳ Tilkoblingen falt, kobler deg til igjen…",
      offline: "📡 Du er frakoblet. Du kobles til igjen automatisk så snart du er tilbake.",
    },
    ready: {
      timesUp: "⏰ Tiden er ute!", yourTurn: "Lagets tur", nowUp: "Nå er det tur til å gi hint",
      inherit: "Du arver ett ikke-gjettet kort.",
      illGive: ({ n }) => `Jeg gir hint · ${n}s`,
      someone: 'Noen må trykke "Jeg gir hint" på telefonen sin.',
      watch: "Følg med i rommet.",
    },
    youbadge: { lead: "Du er på" },
    timer: { sec: "sek", secsLeft: ({ n }) => `${n} sekunder igjen` },
    rules: { allowed: "Tillatt", never: "Aldri" },
    play: {
      correct: "RIKTIG", spacebar: "(Mellomrom)",
      noSkip: "Ingen hopping. Løs det eller la tiden gå ut.",
      givingFor: "gir hint for",
      guessOut: "Gjett høyt. Ordet blir på telefonen deres.",
    },
    trans: {
      roundOver: "⏸ Runden er over midt i turen", pausedLead: "Pauset ·", pausedLeft: "igjen",
      roundIs: ({ n, name }) => ["RUNDE ", n, " ER ", { b: name }],
      resume: "Fortsett turen ▶", waitResume: ({ name }) => `Venter på at ${name} fortsetter…`,
    },
    end: {
      tie: "Uavgjort!", wins: ({ team }) => `${team} vinner!`,
      roundByRound: "Runde for runde", team: "Lag",
    },
    group: {
      empty: "tom", you: " (deg)", host: " · vert", offline: " · frakoblet",
      youreIn: "✓ Du er i denne gruppen", joinThis: "Bli med i denne gruppen",
      noGroup: " · ingen gruppe ennå", addGroup: "+ legg til en gruppe", nameLabel: "Gruppenavn", remove: "Fjern gruppe",
    },
    share: {
      connecting: "Kobler til…", errorTitle: "Koden er opptatt - åpne på nytt", roomLabel: "Rom",
      copied: "Kopiert ✓", copyLink: "Kopier lenke", shareDots: "Del…",
      joinMyRoom: "Bli med i rommet mitt", qrAlt: "QR-kode for å bli med i rommet", roomLink: "Romlenke",
    },
    words: {
      progressLead: "Dine ord", plenty: "✓ det holder", typeWord: "Skriv et ord…",
      deleteAria: ({ w }) => `Slett "${w}"`,
      fillMine: ({ n }) => `Fyll mine ${n} fra Murrays kortstokk`,
    },
    deck: {
      allIn: "Hele kortstokken er allerede i ordlisten.",
      fillBowl: ({ n }) => `Fyll ordlisten fra Murrays kortstokk (+${n})`,
      addMore: ({ n }) => `Legg til ${n} til fra Murrays kortstokk`,
    },
    lang: { label: "Språk" },
    round: {
      1: { name: "Forklar", setup: "Stå foran laget ditt.", allowed: "Setninger, beskrivelser, lyder, fakter.", restrict: "Ikke si ordet, deler av det, eller rim.", gloss: "si hva som helst utenom ordet" },
      2: { name: "Charade", setup: "Stå foran laget ditt.", allowed: "Helkroppsspill og miming.", restrict: "Stillhet. Ingen tale, hvisking eller munnbevegelser.", gloss: "spill det ut, ingen prat" },
      3: { name: "Ett ord", setup: "Stå foran laget ditt.", allowed: "Nøyaktig ett ord, totalt, per kort.", restrict: "Gjenta det, men aldri endre det eller bruk fakter.", gloss: "bare ett ord, høyt" },
      4: { name: "Kun hender", setup: "Bak sofaen - bare hendene vises.", allowed: "Fingre, hender og underarmer.", restrict: "Stillhet. Hode, ansikt, overkropp og ben skjult.", gloss: "hint kun med hendene" },
      5: { name: "Kun ansikt", setup: "Kikk over sofaen - bare ansiktet.", allowed: "Øyne, bryn, nese, munn, hodebevegelser.", restrict: "Stillhet. Fra halsen og ned er skjult.", gloss: "hint kun med ansiktet" },
    },
  },
};

function resolve(obj, key) {
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
// Build a translator bound to a language. `t(key, params)` returns a string
// (or, for a few rich strings, an array of segments where a `{ b: text }`
// segment is meant to render bold - the UI maps those to <b>). Unknown keys
// fall back to English, then to the key itself, so nothing ever renders blank.
export function makeT(lang) {
  return (key, params) => {
    let v = resolve(STRINGS[lang], key);
    if (v === undefined) v = resolve(STRINGS.en, key);
    if (typeof v === "function") return v(params || {});
    return v === undefined ? key : v;
  };
}
// Convenience: the four pieces of round text for round `n`, localized.
export function roundText(t, n) {
  return { name: t(`round.${n}.name`), setup: t(`round.${n}.setup`), allowed: t(`round.${n}.allowed`), restrict: t(`round.${n}.restrict`), gloss: t(`round.${n}.gloss`) };
}
