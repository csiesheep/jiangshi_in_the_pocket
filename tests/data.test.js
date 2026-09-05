import { test, assert, eq, suite } from "./harness.js";
// The letter's interpolation map and its mark table, taken from the product
// rather than restated here (#124). A list of four names in this file is a
// copy that goes stale the day a fifth is added, which is the same failure
// #104 was about one level down.
import { NOTE_MARK, noteValues } from "../js/render.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "97149712");

// Data is fetched no-store. A test that reads a cached copy of the file it is
// asserting about is worse than no test: it passes on data that is not on disk,
// which is exactly how a fixed table can keep reporting the old bug.
const NO_STORE = { cache: "no-store" };

// The mechanics tables, checked against the ruleset spec §4–§5. These assert
// the SHAPE and the ARITHMETIC, not the flavour: ids are the contract between
// the spec's glossary, these files, and every consumer of them, so an id that
// drifts here breaks something that cannot see this file.
const [items, search, events, tiles] = await Promise.all([
  fetch("../data/items.json", NO_STORE).then((r) => r.json()),
  fetch("../data/search.json", NO_STORE).then((r) => r.json()),
  fetch("../data/events.json", NO_STORE).then((r) => r.json()),
  fetch("../data/tiles.json", NO_STORE).then((r) => r.json()),
]);
// Retired with the card system. Asked for rather than assumed gone, because a
// stale copy left in data/ is exactly the sort of thing that keeps working in
// a service worker's cache long after nothing fetches it.
const cardsGone = await fetch("../data/cards.json", NO_STORE).then((r) => !r.ok).catch(() => true);

const byId = Object.fromEntries(items.map((i) => [i.id, i]));
const CATS = ["weapon", "magic", "relic", "medicine", "charm"];

// Ids the source game used. None may survive anywhere in the data.
const RETIRED = ["chainsaw", "oil", "gasoline", "candle", "can-of-soda", "machete",
                 "golf-club", "board-nails", "grisly-femur"];

test("data: cards.json is gone", () => {
  eq(cardsGone, true, "the development deck is retired");
});

test("items: thirteen, unique ids, known categories", () => {
  eq(items.length, 13);
  eq(new Set(items.map((i) => i.id)).size, 13, "no duplicate ids");
  for (const i of items) {
    assert(CATS.includes(i.cat), `${i.id}: unknown cat ${i.cat}`);
  }
});

// The DoD's other half — that every id is in the vault glossary — is checked by
// hand against `jiangshi in the pocket - glossary.md`; a browser test cannot
// read the vault. What it CAN enforce is the half that lives in the repo: that
// no table ever names an item that does not exist.
test("items: no retired id survives anywhere in the data", () => {
  const blob = JSON.stringify({ items, search, events });
  const found = RETIRED.filter((id) => blob.includes(`"${id}"`));
  eq(found, [], "source-game ids must not appear in data/");
});

test("search: four tables, each summing to 100", () => {
  eq(Object.keys(search).sort(), ["magic", "medicine", "relic", "weapon"]);
  for (const [name, table] of Object.entries(search)) {
    eq(table.reduce((n, e) => n + e.p, 0), 100, `${name} table must sum to 100`);
  }
});

test("search: every entry is a real item or an honest nothing", () => {
  for (const [name, table] of Object.entries(search)) {
    for (const e of table) {
      if (e.id === null) continue; // found nothing, which is a result
      assert(byId[e.id], `${name}: no such item ${e.id}`);
    }
  }
});

test("search: the charm is not in any table — it is a gift, not a find", () => {
  eq(byId["protective-charm"].searchable, false);
  for (const [name, table] of Object.entries(search)) {
    assert(!table.some((e) => e.id === "protective-charm"), `${name} must not offer the charm`);
  }
  // And nothing else is flagged unsearchable while sitting in a table.
  for (const i of items.filter((x) => x.searchable === false)) {
    for (const table of Object.values(search)) {
      assert(!table.some((e) => e.id === i.id), `${i.id} is unsearchable but appears in a table`);
    }
  }
});

test("events: three bands, each summing to 100", () => {
  eq(Object.keys(events).sort(), ["10", "11", "9"]);
  for (const [band, table] of Object.entries(events)) {
    eq(table.reduce((n, e) => n + e.p, 0), 100, `band ${band} must sum to 100`);
  }
});

test("events: every villager gift is a real item", () => {
  const gifts = [];
  for (const [band, table] of Object.entries(events)) {
    for (const e of table.filter((x) => x.t === "VILLAGER")) {
      assert(byId[e.gift], `band ${band}: no such gift ${e.gift}`);
      assert(e.turnsInto > 0, `band ${band}: a refused villager must turn into something`);
      gifts.push(e.gift);
    }
  }
  eq(gifts, ["protective-charm", "truefire-talisman", "fivethunder-talisman"],
     "the charm at nine, then the two talismans the seal needs");
});

test("events: the bands only ever carry outcomes the engine will know", () => {
  const KINDS = ["JIANGSHI", "HP", "NOTHING", "POISON", "VILLAGER"];
  for (const [band, table] of Object.entries(events)) {
    for (const e of table) assert(KINDS.includes(e.t), `band ${band}: unknown outcome ${e.t}`);
  }
});

// ---- Reachability -----------------------------------------------------------
// The tables and the map are two halves of one contract, and nothing checked
// that they met. They did not: the relic table existed and no tile pointed at
// it, so 攝魂幡 could not be found, and every winning seal line spends it —
// WIN_SEAL was unreachable in shipped data. These two tests are the guard.
test("reachability: every search table is pointed at by a tile", () => {
  const pointed = new Set(
    [...tiles.indoor, ...tiles.outdoor].filter((t) => t.search).map((t) => t.search)
  );
  const orphaned = Object.keys(search).filter((name) => !pointed.has(name));
  eq(orphaned, [], "a table no room rolls on is a table that does not exist");
  const dangling = [...pointed].filter((name) => !search[name]);
  eq(dangling, [], "and a room cannot roll on a table that is not there");
});

test("reachability: every item can actually be obtained", () => {
  const fromSearch = new Set();
  for (const [name, table] of Object.entries(search)) {
    // Only tables some room actually rolls on count as a way to get anything.
    const reachable = [...tiles.indoor, ...tiles.outdoor].some((t) => t.search === name);
    if (!reachable) continue;
    for (const e of table) if (e.id) fromSearch.add(e.id);
  }
  const fromEvents = new Set();
  for (const table of Object.values(events)) {
    for (const e of table) if (e.gift) fromEvents.add(e.gift);
  }
  const unobtainable = items
    .map((i) => i.id)
    .filter((id) => !fromSearch.has(id) && !fromEvents.has(id));
  eq(unobtainable, [], "every item must come from a reachable table or a villager");

  // And the one the bug was actually about, named so a regression says so.
  assert(fromSearch.has("soul-banner"), "攝魂幡 must be findable — the seal needs it");
});

// ---- Languages ---------------------------------------------------------------
// A translation that falls behind is not a visible failure — the overlay means a
// missing key quietly serves English, which is the right behaviour at runtime
// and exactly the wrong behaviour to leave unmonitored. So the suite watches it:
// add a string to the theme without translating it and this goes red the same
// day, rather than a zh player meeting an English sentence months later.
//
// It nearly happened while this was being written. A generator regenerated the
// zh file and silently dropped eleven keys added to both themes by hand; the
// count is what caught it.
const [themeEn, themeZh] = await Promise.all([
  fetch("../data/theme.json", NO_STORE).then((r) => r.json()),
  fetch("../data/theme.zh-TW.json", NO_STORE).then((r) => r.json()),
]);

function leafKeys(node, path = "") {
  const out = [];
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === "_note") continue; // notes are for whoever edits the file, not players
      out.push(...leafKeys(v, `${path}.${k}`));
    }
  } else {
    out.push(path);
  }
  return out;
}

test("languages: 繁體中文 covers every string English has", () => {
  const en = new Set(leafKeys(themeEn));
  const zh = new Set(leafKeys(themeZh));
  const missing = [...en].filter((k) => !zh.has(k)).sort();
  eq(missing.length, 0, `untranslated: ${missing.slice(0, 8).join(", ")}`);
});

test("languages: the overlay invents nothing English does not have", () => {
  // A key here that is absent there is dead weight at best and a typo at worst —
  // it can never be reached, because the code only ever asks for English's keys.
  const en = new Set(leafKeys(themeEn));
  const orphans = leafKeys(themeZh).filter((k) => !en.has(k)).sort();
  eq(orphans.length, 0, `orphaned: ${orphans.slice(0, 8).join(", ")}`);
});

test("languages: §9 holds in both — the threshold is nowhere in the strings", () => {
  // The number lives in the engine and reaches exactly one card, at runtime, so
  // no STRING may state it. Counting tables are exempt and have to be: the room
  // distances, the tally's spelled numbers and the epilogue's hours legitimately
  // contain every number there is, and none of them is a quantity to reach.
  const COUNTING = /^\.(epilogue\.(rooms|hours)|tallyLine\.(words|times))\./;
  for (const [name, theme] of [["en", themeEn], ["zh-TW", themeZh]]) {
    for (const key of leafKeys(theme)) {
      if (COUNTING.test(key + ".")) continue;
      const value = key.split(".").slice(1).reduce((o, k) => o[k], theme);
      if (typeof value !== "string") continue;
      assert(!/\b1[12]\b/.test(value), `${name}${key} states a threshold-shaped number: ${value}`);
    }
  }
});

// The static chrome in game.html is written over at runtime from the theme, so
// the two have to agree: if someone edits the HTML and not the theme, English
// silently reverts on the next render and nobody notices, because English is
// what they were looking at anyway.
//
// This is the half of the page a language sweep cannot see — it caught nothing
// while 25 strings sat untranslated, because they were static nodes and the
// sweep only looked at what the game draws.
// Whitespace collapsed before comparing, because HTML collapses it before
// SHOWING it: index.html's tagline is wrapped across two indented lines, so an
// exact match would fail on formatting the reader never sees. Built with split
// and join rather than a regex, following this file's own rule — an escape in a
// guard here was once mangled into a literal backspace and the assertion passed
// forever after.
const WS = [10, 13, 9, 32].map((c) => String.fromCharCode(c));
function norm(s) {
  let out = String(s);
  for (const w of WS) out = out.split(w).join(" ");
  while (out.indexOf("  ") !== -1) out = out.split("  ").join(" ");
  return out.trim();
}

// A dotted path, so a pair can point at a nested section. game.html's chrome all
// lives under ui; index.html's tagline lives under landing, and one table that
// can address both beats a second copy of this test that drifts from it.
function themeAt(theme, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), theme);
}

// One implementation, both pages. The alternative was a second test shaped like
// this one for index.html, which is how two guards that agree today stop
// agreeing later.
async function chromeMatchesTheme(file, pairs) {
  const html = await fetch("../" + file, NO_STORE).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const [id, path] of pairs) {
    const el = doc.getElementById(id);
    assert(el, `${file} has no #${id} for the theme to write`);
    const want = themeAt(themeEn, path);
    assert(want !== undefined,
      `${file} #${id} is paired with theme.${path}, which does not exist`);
    eq(norm(el.textContent), norm(want), `${file} #${id} and theme.${path} disagree`);
  }
}

// index.html's tagline is EXACTLY the kind of node this guard was written for.
// It is hardcoded English in the markup and only overwritten from the theme
// inside applyLanguage — so an English visitor never triggers the write and
// reads whatever the HTML says, whatever the theme says. The language sweep
// that missed 25 strings missed them for this reason: it looked at what the
// game DRAWS, and a static node is not drawn.
//
// Not currently drifted. This is a gap rather than a defect, and it is being
// closed while the two still agree, which is the only comfortable time to do it.
test("chrome: index.html's static words match the theme's English", async () => {
  await chromeMatchesTheme("index.html", [["tagline", "landing.tagline"]]);
});

// --font-cjk IS THE SERIF ONE, AND A SANS FACE IN IT SILENTLY WINS (#147).
//
// The stack used to carry PingFang TC and Microsoft JhengHei — both 黑體 — AFTER
// the only two 明體 faces, which are macOS-only, and BEFORE the generic serif. A
// Windows machine walked past the serifs it did not have, stopped on JhengHei,
// and never reached the `serif` at the end that would have corrected it. Nothing
// failed. One platform simply got a different kind of face from every other, and
// the fallback that existed to prevent exactly that was unreachable.
//
// NOT A PINNED LIST, deliberately. Asserting the exact stack would fire every
// time someone legitimately tunes the order, which is how people learn to edit a
// guard without reading it. This asserts the RULE — no 黑體 in the 明體 variable
// — so tuning is free and the one change that broke it is not.
//
// The names below are substrings, matched case-insensitively, and each is a
// family that is sans by definition rather than a specific file:
const SANS_CJK = [
  "PingFang",       // macOS 黑體
  "JhengHei",       // Windows 黑體 (Traditional)
  "YaHei",          // Windows 黑體 (Simplified)
  "Heiti",          // 黑體, older macOS/iOS
  "Hiragino Kaku",  // Japanese gothic — the Mincho sibling is the serif one
  "Gothic",         // MS Gothic, Yu Gothic, Apple Gothic
  "Noto Sans",
  "Source Han Sans",
  "sans-serif",
];

test("type: the CJK stack names no sans face (#147)", async () => {
  const css = await fetch("../css/style.css?fresh=" + Date.now(),
                          NO_STORE).then((r) => r.text());
  const m = css.match(/--font-cjk:\s*([^;]+);/);
  assert(m, "--font-cjk is not declared any more, so this guard is checking nothing");
  const stack = m[1].replace(/\s+/g, " ").trim();

  // PROVE THE STACK IS NOT EMPTY before asserting what is absent from it.
  assert(stack.length > 10 && stack.includes("serif"),
    "--font-cjk reads " + JSON.stringify(stack) + ", which has no generic serif " +
    "at the end — every other assertion here would pass on a stack that names " +
    "nothing at all");

  for (const sans of SANS_CJK) {
    // "sans-serif" is the one that would otherwise match inside "serif"'s own
    // spelling, so it is compared against the whole declaration rather than
    // hunted for loosely.
    const hit = sans === "sans-serif"
      ? /\bsans-serif\b/i.test(stack)
      : stack.toLowerCase().includes(sans.toLowerCase());
    assert(!hit,
      "--font-cjk names " + sans + ", which is 黑體. In a stack whose later " +
      "entries are serif it does not fail, it WINS on whichever platform has " +
      "it — and the generic serif at the end is then unreachable. Stack: " + stack);
  }
});

// AND THE GUARD HAS TO BE ABLE TO SEE ONE. It is an absence check over a string,
// which passes just as happily if the regex stopped matching or the file came
// back empty — both of which have happened in this suite before.
test("type: the sans check can actually detect a sans face", () => {
  const broken = '"Songti TC", "Microsoft JhengHei", serif';
  const caught = SANS_CJK.some((sans) => sans === "sans-serif"
    ? /\bsans-serif\b/i.test(broken)
    : broken.toLowerCase().includes(sans.toLowerCase()));
  assert(caught, "the sans list does not match a stack containing Microsoft JhengHei, " +
    "so the guard above proves nothing about the real one");
  // And it leaves a legitimate all-serif stack alone.
  const fine = '"Songti TC", "Hiragino Mincho ProN", PMingLiU, MingLiU, "MS Mincho", serif';
  const falsePositive = SANS_CJK.some((sans) => sans === "sans-serif"
    ? /\bsans-serif\b/i.test(fine)
    : fine.toLowerCase().includes(sans.toLowerCase()));
  assert(!falsePositive,
    "the sans list fires on an all-serif stack, so it would block legitimate tuning");
});

// THE BAR IS SHARED FURNITURE, AND THAT IS WHY NOBODY SAW IT (#146).
//
// game.html has painted its own bar from the theme since the beginning. The four
// STATIC pages carried the same furniture as plain English markup with nothing
// to paint it, so in Chinese the brand, Play, Rulebook, Tiles and Menu all
// stayed English — on every one of those pages at once. It survived a page-by-
// page sweep because it does not belong to any page: whoever was working on one
// saw a bar that looked exactly like the bar on all the others.
//
// So this checks the pages TOGETHER, and in both directions:
//   - every id'd node in a bar has a theme key, or nothing will ever paint it
//   - the markup's English matches the theme's English, or the page and the
//     translation have drifted
//   - every key in BAR is used by at least one page, or it is dead weight
//
// The English in the markup is not a bug — it is the fallback a reader gets
// with no script and the crawler's copy. What was missing was anything to
// replace it.
const BAR_KEYS = ["brand", "nav-play", "nav-rulebook", "nav-tiles", "nav-menu"];
const BAR_PAGES = ["credits.html", "ledger.html", "rulebook.html", "tiles.html", "game.html"];

test("chrome: every page's top bar is painted from the theme (#146)", async () => {
  const ui = themeEn.ui;
  const used = new Set();
  let bars = 0;

  for (const page of BAR_PAGES) {
    const doc = new DOMParser().parseFromString(
      await fetch("../" + page, NO_STORE).then((r) => r.text()), "text/html");
    const bar = doc.querySelector("header.topnav");
    assert(bar, page + " has no header.topnav, so this guard skipped it silently");
    bars += 1;

    // Every LINK in the bar, whether or not it has an id — an id is exactly what
    // this is checking for, so looking only at id'd nodes would let a new
    // untranslated link in unnoticed.
    for (const a of bar.querySelectorAll("a")) {
      const id = a.id;
      assert(id, page + " has a bar link reading " + JSON.stringify(a.textContent.trim()) +
        " with no id, so nothing can paint it and it stays English in Chinese");
      assert(BAR_KEYS.includes(id),
        page + " bar link #" + id + " is not in BAR_KEYS, so paintTopnav will " +
        "never write it — add the key or the link stays in one language");
      assert(ui[id] !== undefined,
        page + " #" + id + " has no theme.ui." + id + " to be painted from");
      eq(a.textContent.trim(), ui[id],
        page + " #" + id + " markup and theme.ui." + id + " disagree");
      used.add(id);
    }
  }

  eq(bars, BAR_PAGES.length, "not every page with a bar was read");
  // A key nothing uses is the other direction, and it is how a rename leaves
  // a translated string behind that no page will ever show.
  for (const key of BAR_KEYS) {
    assert(used.has(key), "theme.ui." + key + " is painted onto no page's bar");
  }
});

// AND THE TRANSLATION HAS TO EXIST, which the English-side check above cannot
// see: a key present in theme.json and absent from theme.zh-TW.json falls back
// to English, which looks exactly like the bug this issue was about.
test("chrome: the bar's words exist in Chinese too (#146)", () => {
  for (const key of BAR_KEYS) {
    const zh = themeZh.ui[key];
    assert(zh !== undefined,
      "theme.zh-TW.json has no ui." + key + ", so that word falls back to " +
      "English and the bar is half-translated");
    assert(zh !== themeEn.ui[key],
      "ui." + key + " is the same string in both languages (" + JSON.stringify(zh) +
      "). If that is deliberate for a wordmark, say so here; today it is the " +
      "shape an untranslated key has.");
  }
});

test("chrome: game.html's static words match the theme's English", async () => {
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ui = themeEn.ui;
  // id in the page -> key in the theme. Both directions matter: a page node
  // with no key never gets translated, and a key with no node is dead weight.
  const PAIRS = [
    ["brand", "brand"], ["nav-rulebook", "nav-rulebook"], ["nav-menu", "nav-menu"],
    ["page-title", "page-title"],
    // The 手記 caption (#121). It is a static node written once on load and
    // again on every switch, which is exactly the shape this list exists for —
    // and it deliberately does NOT share ui.aria-log, so both directions matter:
    // a caption with no key never gets translated, and the key with no node
    // would be dead weight.
    ["account-label", "account-label"],
    // copy-replay went with the HUD button (#55), and the seed line, the sound
    // button and the note button went with the whole utility panel (#73). The
    // seed can still be copied from the verdict card, which is where a seed is
    // worth sharing — that one is built in script and carries its own label, so
    // there is no static node here for the theme to write.
    // "backpack" and "hands-title" are NOT here any more, and their theme keys
    // are gone from both languages. The sidebar merged into one panel and the
    // two headings went with it — this list is the both-directions check, so a
    // key left behind with no node would have failed it, which is what it is
    // for.
  ];
  for (const [id, key] of PAIRS) {
    const el = doc.getElementById(id);
    assert(el, `game.html has no #${id} for the theme to write`);
    eq(el.textContent.trim(), ui[key], `#${id} and ui.${key} disagree`);
  }
});

// The labels a sighted sweep cannot check. #116, and the third instance of one
// family: game.html:87 carries class="board-pane" and id="board-pane" on the
// SAME LINE, so renaming the class — the tidy the board-pane guard now catches
// — takes the id with it. paintChrome writes these under `if (el)`, where a
// missing id is not an error but SILENCE: the node keeps whatever static
// English game.html shipped with.
//
// Measured in 繁體中文 with only the id renamed: #board 遊戲圖板, #actions-pop
// 輪到你, #log 旁白, and the board pane still saying "Board". Three of four
// localised, one silently not, and nothing in the suite complained about the
// language.
//
// THE LIST COMES FROM app.js, not from a copy here. The PAIRS table above
// states the principle this belongs to — a page node with no key never gets
// translated, and a key with no node is dead weight — but it covers the
// visible-text ids only, and a second copy of the aria map is the exact drift
// this family is about.
test("chrome: game.html's spoken labels have a node and both languages", async () => {
  const { ARIA_LABELS } = await import("../js/app.js");
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  assert(ARIA_LABELS.length > 0,
    "app.js exports an empty ARIA_LABELS, so this guard is asserting nothing");
  for (const [id, key] of ARIA_LABELS) {
    const el = doc.getElementById(id);
    assert(el,
      `game.html has no #${id}, so paintChrome's \`if (el)\` skips it in ` +
      `silence and the node keeps its static English aria-label in every ` +
      `language. Paired with ui.${key}`);
    // Both languages, not just English. A reader getting a language nobody
    // chose is #108, and English present with 繁體中文 missing fails exactly
    // that way — uiWord falls back and the label is English again.
    for (const [name, theme] of [["English", themeEn], ["繁體中文", themeZh]]) {
      const want = (theme.ui || {})[key];
      assert(typeof want === "string" && want.trim(),
        `${name} has no ui.${key} for #${id}`);
    }
    assert(themeEn.ui[key] !== themeZh.ui[key],
      `ui.${key} is identical in both languages — probably untranslated, ` +
      `which for a spoken label means a 繁體中文 reader hears English`);
  }
});

// ---- The rulebook against the engine -----------------------------------------
// The page shipped saying "Attack 1, Health 6" while the engine gave 0 and 10 —
// the fork's numbers, kept through a whole reskin because nothing compared them.
// A rules page that teaches the wrong game is worse than no rules page, and the
// error is invisible from inside either file.
//
// Only the numbers a player would act on. Prose is not asserted here: this
// catches drift, not tone.
const rulebookHtml = await fetch("../rulebook.html", NO_STORE).then((r) => r.text());
const rulebookText = rulebookHtml
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z]+;/g, " ")
  .replace(/\s+/g, " ");

test("rulebook: the numbers it teaches are the numbers the engine plays", async () => {
  const { RULES } = await import("../js/engine.js");
  const claims = [
    [`Attack ${RULES.START_ATTACK}`, "starting attack"],
    [`Health ${RULES.START_HEALTH}`, "starting health"],
    [`carry ${RULES.MAX_ITEMS} items`, "carry limit"],
    [`${RULES.TOTAL_TURNS} turns`, "night length"],
  ];
  for (const [phrase, what] of claims) {
    assert(rulebookText.includes(phrase),
      `rulebook does not state the engine's ${what} ("${phrase}")`);
  }
});

test("rulebook: §9 — no threshold, no kit, no tablet effect on the player page", () => {
  // The three things the hidden ending depends on staying hidden. Checked on the
  // shipped page rather than trusted, because it is one careless sentence away
  // from being spoiled for everybody, permanently.
  // The clock legitimately contains both numbers — "11 PM", turns "11–20",
  // "22:00 → 23:00" — and none of those is a quantity to reach at midnight, so
  // the clock comes out first and what is left is what §9 actually governs.
  const withoutClock = rulebookText
    .replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/\b\d{1,2}\s*(?:PM|AM)\b/g, " ")
    .replace(/\b\d{1,2}\s*[–-]\s*\d{1,2}\b/g, " ");
  assert(!/\b1[12]\b/.test(withoutClock),
    "rulebook states a threshold-shaped number outside the clock");
  assert(!/threshold|門檻/.test(rulebookText), "rulebook names the threshold");
  assert(!/鎮屍/.test(rulebookText), "rulebook names the seal");
});

// The Chinese rulebook is a fragment swapped into the same <main>, so the two
// have to keep the same shape: the table of contents links by #anchor, and an
// anchor that exists in one language and not the other is a link that works
// until somebody switches.
const rulebookZh = await fetch("../data/rulebook.zh-TW.html", NO_STORE).then((r) => r.text());

function shapeOf(html) {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const main = doc.querySelector("main");
  return {
    h2: main.querySelectorAll("h2").length,
    h3: main.querySelectorAll("h3").length,
    tables: main.querySelectorAll("table").length,
    rows: main.querySelectorAll("tr").length,
    ids: [...main.querySelectorAll("[id]")].map((e) => e.id).sort().join(","),
    toc: [...main.querySelectorAll(".toc a")].map((a) => a.getAttribute("href")).join(","),
  };
}

test("rulebook: both languages have the same shape and the same anchors", () => {
  const enBody = rulebookHtml.slice(rulebookHtml.indexOf("<main"), rulebookHtml.indexOf("</main>"));
  const en = shapeOf(enBody.replace(/^<main[^>]*>/, ""));
  const zh = shapeOf(rulebookZh);
  eq(zh.h2, en.h2, "section count");
  eq(zh.h3, en.h3, "subsection count");
  eq(zh.tables, en.tables, "table count");
  eq(zh.rows, en.rows, "table rows — a dropped row is a dropped rule");
  eq(zh.ids, en.ids, "anchors: a #link that works in one language must work in both");
  eq(zh.toc, en.toc, "contents links");
});

test("rulebook: §9 holds in the Chinese page too", () => {
  const text = rulebookZh.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // The comment at the top of the fragment names 門檻 to say it is reserved;
  // strip comments before checking, or the file fails for explaining itself.
  const body = rulebookZh.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
  assert(!/門檻/.test(body), "the zh rulebook names the threshold");
  assert(!/鎮屍/.test(body), "the zh rulebook names the seal");
  const withoutClock = body
    .replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/\b\d{1,2}\s*[–-]\s*\d{1,2}\b/g, " ");
  assert(!/\b1[12]\b/.test(withoutClock),
    "the zh rulebook states a threshold-shaped number outside the clock");
});

// ---- The hands (#32) ----------------------------------------------------------
// The engine half is covered in engine.test.js. These guard the half a player
// actually sees: that the panel exists, that every string it needs is written in
// both languages, and that the rulebook stopped teaching the pack that used to
// hold swords.

test("equipment: both languages carry every string the panel and the prompt use", () => {
  const keys = [
    "hand-weapon", "hand-charm", "hand-relic",
    "hand-empty", "hand-bare", "hand-buffed",
    "hand-weapon-said", "hand-weapon-bare", "hand-charm-said", "hand-charm-bare",
    "hand-relic-said", "hand-relic-bare",
    "replace-prompt", "replace-take", "replace-take-sub", "replace-keep", "replace-keep-sub",
  ];
  for (const k of keys) {
    assert((themeEn.ui || {})[k], `English is missing ui.${k}`);
    assert((themeZh.ui || {})[k], `繁體中文 is missing ui.${k}`);
    assert(themeEn.ui[k] !== themeZh.ui[k], `ui.${k} is the same in both — untranslated`);
  }
  for (const k of ["search-armed", "search-replaced"]) {
    assert((themeEn.lines || {})[k], `English is missing lines.${k}`);
    assert((themeZh.lines || {})[k], `繁體中文 is missing lines.${k}`);
  }
});

test("equipment: the replace prompt names both blades and both numbers", () => {
  // The choice is unanswerable without them: a 真火符 burned into the blade in
  // your hand is worth a point, and it can make worse steel the better weapon.
  // A prompt that showed only one number would be asking the player to guess.
  for (const [lang, t] of [["en", themeEn], ["zh", themeZh]]) {
    for (const k of ["replace-take", "replace-keep"]) {
      assert(/\{item\}/.test(t.ui[k]), `${lang} ui.${k} does not name the weapon`);
      assert(/\{n\}/.test(t.ui[k]), `${lang} ui.${k} does not show its attack`);
    }
    assert(/\{item\}/.test(t.ui["replace-take-sub"]), `${lang} take-sub does not name what is left`);
    assert(/\{item\}/.test(t.ui["replace-keep-sub"]), `${lang} keep-sub does not name what is left`);
  }
});

test("equipment: both sides of the replace prompt admit the loss is permanent", () => {
  // Saying it on one button only would make the other read as the safe choice.
  // Whichever blade you turn down stays on the floor of a room you have no
  // reason to walk back into, and weapons are unique.
  assert(/for good/i.test(themeEn.ui["replace-take-sub"]), "en take-sub hides the permanence");
  assert(/for good/i.test(themeEn.ui["replace-keep-sub"]), "en keep-sub hides the permanence");
  assert(/永遠/.test(themeZh.ui["replace-take-sub"]), "zh take-sub hides the permanence");
  assert(/永遠/.test(themeZh.ui["replace-keep-sub"]), "zh keep-sub hides the permanence");
});

test("equipment: the hands are in the page, in the one panel", async () => {
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  assert(html.indexOf('id="hud-hands"') !== -1, "game.html has no hands");
  assert(html.indexOf('id="hud-items"') !== -1, "game.html has no pack");

  // The heading is deliberately gone, and so is the pack's. Pinned as a
  // negative so nobody restores a <h3> without also restoring the theme keys
  // in both languages — the pairing above would then fail, which is the trap
  // this saves them from.
  assert(html.indexOf('id="hands-title"') === -1,
    "the Equipment heading is back but its theme key is not");
  assert(html.indexOf('id="backpack"') === -1,
    "the Backpack heading is back but its theme key is not");

  // NO PANELS AT ALL, which is a stronger claim than the one this used to make.
  // It counted 3 -> 2 -> 1 as the cards merged; Layout A (#121) has none —
  // 一個平面,沒有盒子, separation by hairline and space. So the assertion stops
  // being "how many cards" and becomes "there are no cards", which is the thing
  // the direction actually rests on and the thing a future edit would break.
  const panels = html.split('class="panel').length - 1;
  eq(panels, 0,
    "game.html carries " + panels + " .panel element(s). Layout A has no cards — " +
    "separation is a hairline and space, and a box here reads as a thing " +
    "standing on the table rather than part of it.");
});

test("rulebook: it no longer teaches a pack that holds swords", () => {
  // One hand, one blade. The old rule — carry several and the best one counts —
  // is the exact thing the second amendment replaced, and a rulebook still
  // teaching it is worse than one that says nothing.
  const en = rulebookHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert(!/best\s+one you are holding/i.test(en), "the English rulebook still teaches best-of-several");
  assert(!/carrying two does not add/i.test(en), "the English rulebook still explains carrying two");
  assert(/one blade at a time/i.test(en), "the English rulebook does not state the one-blade rule");

  const zh = rulebookZh.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert(!/只算你手上\s*最好的那一把/.test(zh), "the zh rulebook still teaches best-of-several");
  assert(!/帶兩把不會相加/.test(zh), "the zh rulebook still explains carrying two");
  assert(/一次只拿得動一把/.test(zh), "the zh rulebook does not state the one-blade rule");
});

test("rulebook: both languages say the hands cost no pack slot", () => {
  const en = rulebookHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert(/neither costs a slot/i.test(en), "the English rulebook does not exempt the hands");
  const zh = rulebookZh.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert(/都不佔格子/.test(zh), "the zh rulebook does not exempt the hands");
});

// ---- 真火符 says one thing and does another (#68) --------------------------------
// This item has two powers in the design: throw it for +1 in a fight, or burn it
// into a blade for +1 for good. The engine implements both. The GAME only
// implements the first — the pack refuses everything that is not medicine or
// 硃砂, and a fight only ever throws — so the second was advertised on the item
// card and reachable nowhere. The engine's own author pressed the fight button
// expecting the permanent one.
//
// Both directions are guarded, so this cannot rot in either: advertise it and
// the first test fails until a caller exists; build the caller and the same
// test stops objecting, so the line can come back.
const jsSources = Object.fromEntries(
  await Promise.all(
    ["app.js", "render.js", "board.js", "menu.js", "shell.js"].map(async (f) => [
      f,
      await fetch("../js/" + f, NO_STORE).then((r) => r.text()),
    ])
  )
);

test("真火符: the permanent sword buff is not advertised while nothing can reach it", () => {
  // A call site is any use of buffSword outside engine.js, which is where it is
  // defined. tools/ is not shipped and the bots are not a player.
  const callers = Object.entries(jsSources)
    .filter((pair) => pair[1].includes("buffSword("))
    .map((pair) => pair[0]);
  const advertised = [
    ["en", (themeEn.effects || {})["buff-sword"]],
    ["zh", (themeZh.effects || {})["buff-sword"]],
  ].filter((pair) => pair[1]);

  if (callers.length) {
    // Someone built the affordance. Saying so again is now correct, and this
    // test has done its job and should stop complaining.
    return;
  }
  eq(
    advertised.map((pair) => pair[0]),
    [],
    "the item card promises a permanent sword buff (" +
      advertised.map((pair) => pair[0] + ": " + pair[1]).join(", ") +
      ") and no button in js/ calls buffSword"
  );
});

test("真火符: a fight card that spends something says what it does to it", () => {
  // "真火符" alone reads as naming an item. "Burn the 真火符" reads as an action,
  // which is what a card is. The no-spend card always had its verb.
  for (const pair of [["en", themeEn], ["zh", themeZh]]) {
    const ui = pair[1].ui || {};
    assert(ui["fight-spend"], pair[0] + " has no fight-spend label");
    assert(ui["fight-spend"].includes("{items}"),
      pair[0] + " fight-spend never names what is being burnt: " + ui["fight-spend"]);
    assert(ui["fight-join"] != null, pair[0] + " has no fight-join");
  }
  const app = jsSources["app.js"];
  assert(app.includes('this.ui("fight-spend"'),
    "loadoutLabel does not use the themed spend label");
  // The join was hardcoded to an English idiom with spaces around it, which is
  // wrong in zh twice over.
  assert(!app.includes('spent.join(" and ")'),
    "the loadout label still joins with a hardcoded English word");
});

// ---- The rulebook, one language each and thirteen pictures (#69) ---------------
// Three user rulings: put the item icons on the page, let each language version
// carry only its own language, and make it readable. The first and third are
// judged by eye; these guard the second, which is the one that rots silently —
// a single 漢字 added to an English sentence looks fine to whoever adds it.
//
// Written with NO backslash escapes anywhere. Escapes have not survived the trip
// into this file twice now: one arrived as a backspace and made a negative
// assertion pass forever, and one arrived as a newline and silently dropped
// thirty tests. Character arithmetic cannot be mangled in transit.

// Visible text only. HTML comments are not visible, and the section comment at
// the top of each rulebook has to stay free to name what it is protecting.
function visibleText(html) {
  let s = String(html);
  for (const pair of [["<script", "</script>"], ["<style", "</style>"], ["<!--", "-->"]]) {
    for (;;) {
      const i = s.indexOf(pair[0]);
      if (i === -1) break;
      const j = s.indexOf(pair[1], i);
      if (j === -1) { s = s.slice(0, i); break; }
      s = s.slice(0, i) + " " + s.slice(j + pair[1].length);
    }
  }
  return s.split("<").map((part) => {
    const k = part.indexOf(">");
    return k === -1 ? part : part.slice(k + 1);
  }).join(" ");
}

// Runs of Han, found by codepoint rather than by a character class.
function hanRuns(text) {
  const out = [];
  let cur = "";
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 0x3400 && c <= 0x9fff) cur += ch;
    else if (cur) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

function latinWords(text) {
  const out = [];
  let cur = "";
  for (const ch of String(text)) {
    const c = ch.toLowerCase();
    if (c >= "a" && c <= "z") cur += ch;
    else if (cur) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

test("rulebook: the English page is English everywhere except the Terms table", () => {
  const body = rulebookHtml.slice(rulebookHtml.indexOf("<main"), rulebookHtml.indexOf("</main>"));
  const cut = body.indexOf('id="terms"');
  assert(cut > 0, "the English page has no Terms table to make the exception for");
  // Terms is the deliberate exception and the only one. THE REASON CHANGED on
  // 2026-08-27 and the exception did not: it used to be that the game's own
  // English labels were bilingual pairs, so the page needed one bridge rather
  // than a gloss in every sentence. "In English mode, remove all traditional
  // Chinese" ended the pairs, and the user then ruled 保留表 — keep the table.
  // So the table is no longer a bridge to something the player sees elsewhere;
  // it is the only place these words exist in English mode at all, which is a
  // better reason to keep it than the one it had.
  const han = hanRuns(visibleText(body.slice(0, cut)));
  eq(han, [], "Han characters in English prose: " + han.join(" "));
});

test("rulebook: the Chinese page carries no English prose", () => {
  const seen = visibleText(rulebookZh);
  const cut = seen.indexOf("名詞對照");
  assert(cut > 0, "the Chinese page has no Terms section");
  // The credit names a person. A name is not a language.
  const words = latinWords(seen.slice(0, cut))
    .filter((w) => w !== "Jeremiah" && w !== "Lee");
  eq(words, [], "English words in Chinese prose: " + words.join(" "));
});

test("rulebook: every item icon sits in the row it names", () => {
  // CONTAINMENT, not presence, and that distinction is the whole test. The
  // first version asked whether an icon was followed by bare text — which a
  // STRIP OF ICONS ABOVE THE TABLE passes, and that is precisely what shipped.
  // Emitted between <tr> and <td>, all thirteen were foster-parented out of the
  // table by the HTML parser, so the Weapons section rendered as four unlabelled
  // marks floating above the header while the Precept Knife row had nothing
  // beside it. Every icon was present; not one was attached to anything. It
  // took someone looking at the page to see it.
  //
  // So this asks the parsed document where each icon actually IS, and whether
  // the thing it sits in names the item it draws.
  for (const entry of [["en", rulebookHtml, themeEn, true],
                       ["zh", rulebookZh, themeZh, false]]) {
    const lang = entry[0], theme = entry[2], english = entry[3];
    const doc = new DOMParser().parseFromString(entry[1], "text/html");
    const icons = [...doc.querySelectorAll("svg.ruleicon")];
    eq(icons.length, 13, lang + " draws " + icons.length + " item icons, not thirteen");
    const seen = new Set();
    for (const svg of icons) {
      const id = svg.querySelector("use").getAttribute("href").replace("#item-", "");
      seen.add(id);
      const host = svg.closest("td") || svg.closest("p");
      assert(host, lang + ": icon " + id + " is loose in " +
        svg.parentElement.tagName + "." + svg.parentElement.className +
        " — beside the table rather than in it");
      // THE ENGLISH NAME IS THE WHOLE LABEL NOW. This used to drop the first
      // token, because every English name was "漢字 English" and the gloss was
      // the half that mattered. That convention was reversed on 2026-08-27 --
      // "In English mode, remove all traditional Chinese" -- so slicing the
      // first word off "Cinnabar" left an empty string and this failed with
      // "no themed name for cinnabar". The Chinese file was always Chinese
      // only, so its side is unchanged.
      const label = theme.items[id] || "";
      const name = english ? label : label.split(" ")[0];
      assert(name, lang + ": no themed name for " + id);
      assert(host.textContent.includes(name),
        lang + ": icon " + id + " sits with " + host.textContent.trim().slice(0, 30) +
        " which does not name it");
      assert(svg.getAttribute("aria-hidden") === "true",
        lang + ": icon " + id + " is announced to a screen reader");
    }
    eq(seen.size, 13, lang + " repeats an icon instead of drawing all thirteen");
  }
});

test("rulebook: pulling every icon out would lose no information", () => {
  // The English page's contract is that it works with no JavaScript at all, and
  // the sprite is injected by JavaScript. So the icons have to be pure
  // decoration: strip them and every item must still be named in words.
  for (const entry of [["en", rulebookHtml, themeEn, true],
                       ["zh", rulebookZh, themeZh, false]]) {
    const lang = entry[0], theme = entry[2], english = entry[3];
    const doc = new DOMParser().parseFromString(entry[1], "text/html");
    for (const svg of [...doc.querySelectorAll("svg.ruleicon")]) svg.remove();
    const text = doc.body.textContent;
    for (const id of Object.keys(theme.items)) {
      if (id === "_note") continue;
      const label = theme.items[id];
      // Same inversion as the guard above: since 2026-08-27 the English name is
      // the WHOLE label, because the Chinese half was ruled out of the English
      // build. Two tests derived this the old way and only one of them was the
      // one that went red first.
      const name = english ? label : label.split(" ")[0];
      assert(text.includes(name), lang + ": " + name + " survives only as a picture");
    }
  }
});

test("rulebook: both pages teach the sword buff, now that it has a button", () => {
  // The mirror of the guard this replaces. #68 removed this teaching because
  // E.buffSword had no caller; #70 built the caller, so the rulebook owes the
  // player the recipe again — and 鎮屍 is unreachable without it, which makes
  // this the one piece of teaching the page cannot omit.
  const en = visibleText(rulebookHtml);
  assert(en.includes("Into the blade"),
    "the English rulebook does not name the control the player has to press");
  assert(en.toLowerCase().includes("a blade takes one only"),
    "the English rulebook does not state the one-per-blade ceiling");
  const zh = visibleText(rulebookZh);
  assert(zh.includes("燒進劍裡"),
    "the zh rulebook does not name the control the player has to press");
  assert(zh.includes("一把劍只吃得下一張"),
    "the zh rulebook does not state the one-per-blade ceiling");
});

test("rulebook: both pages state the pack size the engine actually enforces", () => {
  // The English page said 4 under the turn and 6 under Items, and so did the
  // Chinese one. Only magic stacks, so three Sticky Rice is three of four —
  // which also made "half your pack" wrong wherever the 6 had been right.
  for (const pair of [["en", rulebookHtml], ["zh", rulebookZh]]) {
    const page = pair[1];
    assert(!page.includes("carry <strong>6</strong>"), pair[0] + " still says the pack holds 6");
    assert(!page.includes("能帶 <strong>6 樣</strong>"), pair[0] + " still says the pack holds 6");
    const seen = visibleText(page);
    assert(!seen.includes("half your"), pair[0] + " still calls three rice half the pack");
    assert(!seen.includes("半個包"), pair[0] + " still calls three rice half the pack");
  }
});

// ---- 裝備 / Equipment, three slots (#75, #76) -----------------------------------

test("equipment: three slots, and the tablet is drawn in one without entering the pack", async () => {
  // PRESENTATION ONLY. state.tablet is a slotless boolean and must stay one:
  // showing it in a slot renders it, it does not make it an item. If it ever
  // gains a row in items.json or starts counting against MAX_ITEMS, the panel
  // has quietly changed a rule instead of a layout.
  const items = await fetch("../data/items.json", NO_STORE).then((r) => r.json());
  assert(!items.some((i) => i.id === "relic" || i.id === "tablet"),
    "the 神主牌 has become an item — it is meant to cost no slot");
  const src = await fetch("../js/render.js", NO_STORE).then((r) => r.text());
  assert(src.includes('handSlot(game, "relic"'), "the panel has no slot for the 神主牌");
  assert(src.includes('handSlot(game, "weapon"'), "the panel has no weapon slot");
  assert(src.includes('handSlot(game, "charm"'), "the panel has no charm slot");
});

test("equipment: the tablet is reported once, not twice", async () => {
  // #76 took the RELIC field off the clock panel because the slot now shows it.
  // Two readings of one fact is how they drift apart.
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  assert(!html.includes('id="hud-tablet"'), "the status panel still reports the tablet");
  assert(!html.includes('id="stat-relic"'), "the status panel still labels a relic field");
  for (const t of [themeEn, themeZh]) {
    for (const dead of ["stat-relic", "relic-held", "relic-not-yet"]) {
      assert(!(t.ui || {})[dead], "ui." + dead + " outlived the field it labelled");
    }
  }
});

test("equipment: the Chinese label is 健康 and the blood is still blood", () => {
  // #76 renamed the HUD's health label only. The zh theme carries 血 in twenty
  // other strings and every one of them is the SUBSTANCE — 血符, 黑狗血, 損血,
  // 回血, the hp lines, 其中{blood}是你自己的血. A find-and-replace would have
  // renamed the items and broken the id contract, so this pins both halves:
  // the label moved, the blood did not.
  eq(themeZh.ui["stat-health"], "健康", "the zh health label did not move");
  eq(themeZh.actions.health, "健康", "the zh glossary row disagrees with the label");
  eq(themeZh.items["blood-talisman"], "血符", "血符 was renamed");
  eq(themeZh.items["black-dog-blood"], "黑狗血", "黑狗血 was renamed");
  assert(themeZh.eventNames.HP_LOSS.includes("血"), "損血 lost its blood");
  assert(themeZh.eventNames.HP_GAIN.includes("血"), "回血 lost its blood");
  assert(themeZh.ui["attack-blood"].includes("血"), "the blood cost stopped being blood");
});

test("clock: the dial is one colour, and the countdown survives as the minute hand", async () => {
  // #76 dropped the pip row. Nothing is lost to a sighted player and the
  // arithmetic is the reason: TURNS_PER_BAND × MINUTES_PER_TURN is exactly 60,
  // so the minute hand makes one revolution per band and each turn moves it 36
  // degrees. If that ever stops being true the pips were carrying something the
  // dial cannot, and this fails.
  const E = await import("../js/engine.js");
  eq(E.RULES.TURNS_PER_BAND * E.RULES.MINUTES_PER_TURN, 60,
    "a band is no longer one sweep of the minute hand — the dial has stopped being the countdown");
  const src = await fetch("../js/render.js", NO_STORE).then((r) => r.text());
  assert(!src.includes("drawPips"), "the pip row is still drawn");
  // The screen reader keeps the explicit count: a hand position is not
  // something it can read, so each channel carries the fact its own way.
  assert(src.includes("cardsLeftPhrase"), "the spoken countdown went with the pips");
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  const dial = css.slice(css.indexOf(".clock-face"), css.indexOf(".clocknum") + 1 ||
                         css.indexOf(".clock-pin") + 200);
  const block = css.slice(css.indexOf(".clock-face"), css.indexOf(".clock-pin") + 60);
  for (const hue of ["var(--accent)", "var(--danger)"]) {
    assert(!block.includes(hue), "the dial still uses " + hue + " — it is meant to be one colour");
  }
});

test("chrome: the language button names the language you would get", async () => {
  // #77. Both switches now follow one convention — the landing page's and the
  // game banner's — because a control named for its CURRENT state reads as a
  // label rather than a thing to press, and two switches that disagreed would
  // mean one of them was lying about what pressing it does.
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  assert(!html.includes('id="lang-icon"'), "the glyph outlived the word");
  // The visible text IS the accessible name now, so a second spoken label would
  // say it twice.
  assert(!html.includes('id="lang-label"'), "the sr-only label is still doubling the word");
  // The button itself moved into js/langswitch.js with #78 — script-built on
  // every page — so the naming convention is checked where it now lives.
  const shared = await fetch("../js/langswitch.js", NO_STORE).then((r) => r.text());
  assert(shared.includes("btn.textContent = L.LANGS[next].name"),
    "the button is not written with the language you would get");
  assert(shared.includes('btn.setAttribute("lang"'),
    "the button does not declare the language of its own word");
  for (const t of [themeEn, themeZh]) {
    assert(!(t.ui || {})["title-lang"], "ui.title-lang outlived the title it wrote");
  }
});

// ---- One language switch, five pages (#78) ---------------------------------------

test("chrome: the language switch is built once and used everywhere", async () => {
  // It existed three times before — a static button in the game's banner, a
  // constructor in rulebook.js and another in menu.js. The ruling that credits
  // gets one too turned "three copies" into "four", which is the shape this
  // project has spent a week deleting. There is one builder now.
  const shared = await fetch("../js/langswitch.js", NO_STORE).then((r) => r.text());
  assert(shared.includes("export function mountLangSwitch"), "there is no shared builder");
  for (const [name, file] of [["menu", "menu.js"], ["rulebook", "rulebook.js"],
                              ["tiles", "tiles.js"], ["credits", "credits.js"],
                              ["game", "app.js"]]) {
    const src = await fetch("../js/" + file, NO_STORE).then((r) => r.text());
    assert(src.includes("mountLangSwitch"), name + " does not use the shared switch");
    // Nobody builds their own any more.
    assert(!src.includes('btn.id = "lang-switch"'), name + " still builds its own button");
  }
});

test("chrome: no page ships the switch in its markup", async () => {
  // "A page with JS off should not offer a switch that cannot work" — inherited
  // from rulebook.js's original and worth keeping, so the control is never in
  // the HTML. The game page shipped one statically for one commit; this is what
  // stops that coming back.
  for (const page of ["index.html", "game.html", "rulebook.html", "tiles.html", "credits.html"]) {
    const html = await fetch("../" + page, NO_STORE).then((r) => r.text());
    assert(!html.includes('id="btn-lang"'), page + " has a hardcoded language button");
    assert(!html.includes('id="lang-switch"'), page + " has a hardcoded language button");
  }
});

test("tiles: the World cast button is gone, and its handler with it", async () => {
  // Removing markup and leaving a listener behind is how a page grows code that
  // can never run.
  const html = await fetch("../tiles.html", NO_STORE).then((r) => r.text());
  assert(!html.includes("btn-cast"), "the cast button is still in the page");
  const src = await fetch("../js/tiles.js", NO_STORE).then((r) => r.text());
  assert(!src.includes("btn-cast"), "the cast handler outlived its button");
  assert(!src.includes("nocast"), "the cast class outlived its button");
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  assert(!css.includes(".tiletoggle {"), "the cast styling outlived its button");
});

test("tiles: the page's own prose is themed, not typed into the script (#80)", async () => {
  // #78 gave this page a language switch, which made an older fault visible: it
  // themed the tile NAMES from the shared preference while every sentence
  // around them stayed English, so a Chinese reader got Chinese names under an
  // English introduction.
  // BOTH MODULES. The page's words moved to js/tilewords.js (#136) and the
  // reading of them did not stop being reading; searching only tiles.js would
  // report every chip label as dead the moment they were extracted.
  const src = (await Promise.all(
    ["../js/tiles.js", "../js/tilewords.js"].map((p) =>
      fetch(p, NO_STORE).then((r) => r.text())))).join("\n");
  for (const t of [themeEn, themeZh]) {
    assert(t.tilesPage, "a language has no tilesPage section");
  }
  // Every string the section declares is actually read, and every string the
  // page shows comes from there. A key nothing reads is how a translation
  // drifts out of use without anyone noticing.
  //
  // THE ESCAPE CLAUSE USED TO EXCUSE EVERY KEY. It read
  //
  //     src.includes('"' + key + '"') || src.includes('"chip-" + def.search')
  //
  // and the right-hand side does not mention `key` — so while that one
  // construction existed anywhere in the file, EVERY key passed, whether it was
  // read or not. This guard has been asserting nothing since that clause was
  // added. It surfaced only because #136 moved chipsFor() to another module and
  // took the string with it, at which point the first key in the list failed
  // and three genuinely dead ones came out with it.
  //
  // Scoped now: the four chip-<search> keys are the only ones built rather than
  // written, so they are the only ones that construction can excuse.
  const BUILT = /^chip-(weapon|magic|medicine|relic)$/;
  const constructed = src.includes('"chip-" + def.search');
  for (const key of Object.keys(themeEn.tilesPage)) {
    if (key === "_note" || key === "words") continue;
    if (BUILT.test(key) && constructed) continue;
    assert(src.includes('"' + key + '"'),
      "tilesPage." + key + " is declared and never read");
  }
  // The sentences that used to be typed here.
  for (const gone of ["out on the hillside", "The village, and the",
                      "The plan beside each room", "once per night"]) {
    assert(!src.includes(gone), "tiles.js still types its own prose: " + gone);
  }
});

test("tiles: Chinese spells its own numbers rather than borrowing English ones", () => {
  // count() used to fall back to the English word list for any theme without
  // one, which would have printed "twenty" in the middle of a Chinese sentence.
  for (const [lang, t] of [["en", themeEn], ["zh", themeZh]]) {
    const words = t.tilesPage.words;
    assert(Array.isArray(words) && words.length >= 21,
      lang + " has no number words for the tile count");
    assert(words[20], lang + " cannot spell twenty, which is the size of the set");
  }
  assert(themeEn.tilesPage.words[20] !== themeZh.tilesPage.words[20],
    "both languages spell twenty the same way — one of them is untranslated");
});

test("equipment: the blade slot names its own empty state, not the generic one", async () => {
  // The three slots share a panel now, and an empty hand is not the same fact
  // in all three. The blade slot carries a NUMBER, and "empty" above a lone 0
  // gave the numeral nothing to belong to — at 20px in the display face, muted,
  // with no name above it, it read as a dim ring rather than a value.
  const src = await fetch("../js/render.js", NO_STORE).then((r) => r.text());
  assert(src.includes('slot === "weapon" ? "hand-bare" : "hand-empty"'),
    "the blade slot falls back to the generic empty label again");
  for (const [lang, t] of [["en", themeEn], ["zh", themeZh]]) {
    assert(t.ui["hand-bare"], lang + " has no word for being bare-handed");
    assert(t.ui["hand-bare"] !== t.ui["hand-empty"],
      lang + " uses the same word for an empty hand and a bare one");
  }
  // And the number stays a value in that state. #79 ruled the attack red; the
  // bare case was the half of it that stayed grey.
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  assert(!css.includes(".hand--bare .handattack { color: var(--muted); }"),
    "the attack value is dimmed again in the one state where it reads 0");
});

// ---- The pack tells you what it did (#86) ----------------------------------------

test("pack: it only offers what it can actually spend", async () => {
  // 黑狗血 is filed as cat "medicine" and its effect is ESCAPE_FIGHT. Outside a
  // fight useMedicine finds no heal, no cure and no gamble, drops it and
  // returns ok — so pressing Use destroyed one of thirteen items and moved
  // nothing. The shelf it sits on is not the question; what it does here is.
  const items = await fetch("../data/items.json", NO_STORE).then((r) => r.json());
  const blood = items.find((i) => i.id === "black-dog-blood");
  assert(blood && blood.cat === "medicine" && blood.heal == null && !blood.cures && !blood.gamble,
    "the item this guards has changed shape — re-read the rule below");
  const src = await fetch("../js/render.js", NO_STORE).then((r) => r.text());
  assert(src.includes("function spendsFromPack"),
    "the pack is back to offering Use for anything shelved as medicine");
  // ONE place, and the guard is against the second copy rather than the first:
  // the cell asked one way and packSlot asked another, which is how two copies
  // of one decision come apart.
  // The other def.cat reads are about "magic" and stacking, which is a
  // different question; "medicine" must be asked in exactly one place.
  // Counted by splitting rather than by regex — an escape written into this
  // file has arrived mangled three times, and a broken pattern here would pass
  // silently forever.
  const sites = (src.split('def.cat === "medicine"').length - 1) +
                (src.split('def.cat !== "medicine"').length - 1);
  eq(sites, 1, "the medicine category is consulted in " + sites +
     " places; the rule lives in spendsFromPack and nowhere else");
});

test("pack: an outcome the HUD cannot show is said out loud", async () => {
  // The inversion this fixes: the game DID say it, into a 1x1 clipped live
  // region. Screen-reader users were told and sighted players were not — the
  // fourth instance of that shape in this project.
  //
  // And the case is not only 黑狗血. Healing is CLAMPED, so eating rice at full
  // health returns healed: 3, moves no hearts, and destroys the rice. The
  // rulebook warns that rice at 9 health is worth holding; the game took it and
  // said nothing.
  const app = await fetch("../js/app.js", NO_STORE).then((r) => r.text());
  const cut = app.indexOf("usePackItem(id)");
  const body = app.slice(cut, cut + 2000);
  // Decided by what CHANGED, not by what the call returned.
  assert(body.includes("this.state.health !== before"),
    "usePackItem no longer checks whether anything actually moved");
  assert(body.includes("this.tell("),
    "usePackItem is back to log() alone, which only half the players can read");
  for (const [lang, t] of [["en", themeEn], ["zh", themeZh]]) {
    assert((t.lines || {})["use-wasted"], lang + " has no line for spending something for nothing");
    assert((t.ui || {})["use-grind"], lang + " has no label for the button that opens a picker");
  }
});

// The first-run letter (#104). Three claims, and the first is the one that
// shipped broken: the ENGLISH letter carried 13 Han characters and sent an
// English player to the 停柩房, the 天井 and the 亂葬崗 by name.
//
// A guard rather than a fix-and-forget, because this is the shape of fault that
// reads perfectly in the language whoever changed it was looking at.
test("the letter: English has no Han, and both languages name places from the theme", async () => {
  const [en, zh] = await Promise.all([
    fetch("../data/theme.json", NO_STORE).then((r) => r.json()),
    fetch("../data/theme.zh-TW.json", NO_STORE).then((r) => r.json()),
  ]);

  const enNote = en.note || {};
  const enText = [enNote.title || ""].concat(enNote.lines || []).concat([enNote.dismiss || ""]).join(" ");
  // Prove the region is not empty before asserting about what is absent from it:
  // a letter that lost its lines passes "contains no Han" perfectly.
  assert((enNote.lines || []).length >= 3,
    "the English letter has fewer than three lines - this guard is watching almost nothing");

  const han = [];
  for (const ch of enText) {
    const c = ch.codePointAt(0);
    if (c >= 0x3400 && c <= 0x9fff) han.push(ch);
  }
  assert(han.length === 0,
    "the English letter carries Han characters (" + han.join("") + ") - an English " +
    "player is being sent to places they cannot read; the English names are in " +
    "this same file under tiles.* and words.relic");

  // The names are not spelled in either letter: they are taken from the theme,
  // so renaming a tile follows into the letter instead of leaving it pointing at
  // a place that no longer exists.
  //
  // DERIVED FROM THE PRODUCT, NOT LISTED HERE (#124). This used to be four
  // names typed into this file, which stops being the truth the moment a fifth
  // is interpolated — and the fifth and sixth arrived with the hour. So the set
  // comes from the letters themselves and is checked against NOTE_MARK both
  // ways: nothing interpolated may go unmarked, and no mark may name something
  // the letter does not interpolate.
  const placeholders = (theme) => {
    const found = new Set();
    const re = /\{(\w+)\}/g;
    let m;
    while ((m = re.exec(((theme.note || {}).lines || []).join(" "))) !== null) found.add(m[1]);
    return found;
  };
  const enTokens = placeholders(en);
  const zhTokens = placeholders(zh);

  // Prove the set is not empty before asserting anything about every member of
  // it: a letter that stopped interpolating passes every "for each" below.
  assert(enTokens.size >= 4,
    "the English letter interpolates " + enTokens.size + " values - it named its " +
    "places and its hour by hand again, and every check that follows is vacuous");

  for (const [name, tokens] of [["English", enTokens], ["繁體中文", zhTokens]]) {
    for (const t of tokens) {
      assert(NOTE_MARK[t],
        "the " + name + " letter interpolates {" + t + "} and NOTE_MARK does not " +
        "say how to mark it, so it renders as ordinary text - #124 marks the " +
        "interpolation points, which means adding one is adding a mark");
    }
  }
  for (const key of Object.keys(NOTE_MARK)) {
    assert(enTokens.has(key) && zhTokens.has(key),
      "NOTE_MARK carries " + key + " but " +
      (enTokens.has(key) ? "the 繁體中文" : "the English") + " letter does not " +
      "interpolate it - a mark for something that is never placed is dead, and " +
      "the two languages must interpolate the same set or one is unmarked");
  }

  // And every placeholder must have something to resolve to, in BOTH languages -
  // otherwise the letter renders a literal "{crypt}" at a stranger. Filled by
  // the product's own noteValues(), so a key that moves is caught here rather
  // than by this file quietly describing where it used to be.
  for (const [name, theme, tokens] of [["English", en, enTokens], ["繁體中文", zh, zhTokens]]) {
    const values = noteValues(theme);
    for (const t of tokens) {
      assert(values[t],
        "the " + name + " letter fills {" + t + "} from a theme key that is " +
        "missing, so the letter would show the placeholder itself");
    }
  }

  // THE RENDERED ENGLISH LETTER HAS NO HAN EITHER, and this is a different
  // assertion from the one above. That one reads the letter's SOURCE, where
  // "{midnight}" is seven harmless Latin characters; a placeholder is precisely
  // how Han gets back into the English letter past it. king.midnight is right
  // there and reads "三更 the third watch", because the King's panel is teaching
  // the term - hanging {midnight} on it would put the Han back and the source
  // check would stay green through it.
  const renderedEn = (enNote.lines || [])
    .map((l) => l.replace(/\{(\w+)\}/g, (whole, k) => {
      const v = noteValues(en)[k];
      return v === undefined ? whole : v;
    })).join(" ");
  const renderedHan = [];
  for (const ch of renderedEn) {
    const c = ch.codePointAt(0);
    if (c >= 0x3400 && c <= 0x9fff) renderedHan.push(ch);
  }
  assert(renderedHan.length === 0,
    "the English letter RENDERS Han characters (" + renderedHan.join("") + ") - " +
    "one of its placeholders is filled from a key that carries them, so the " +
    "source reads clean and the player still gets sent somewhere by a name they " +
    "cannot read");

  // SHORTER, and pinned at the length it was cut to rather than at a mood. The
  // ceiling is the rendered length - placeholders expanded - because that is
  // what a player actually reads.
  const rendered = renderedEn;
  assert(rendered.length < 520,
    "the English letter has grown back to " + rendered.length + " characters - it was " +
    "cut from 538 because it was the longest thing a new player is asked to read");
});

// Sound is ON for a new player (#107), and this guard exists because the
// opposite failed SILENTLY for as long as it did — a game that makes no noise
// looks like a game with no sound, not like a bug, and the user had to ask
// directly before anybody checked.
//
// READ THE LIMIT BEFORE TRUSTING A GREEN TICK HERE: this asserts what the
// default IS, not that anything is AUDIBLE. Nobody on this project has ever
// confirmed a sound came out. An automated pane cannot produce the user
// gesture a Web Audio context needs — after a real CDP click,
// navigator.userActivation.hasBeenActive is still false — so the context never
// leaves "suspended" and audibility needs a human with speakers. This test
// passing means the switch is in the right position. It does not mean you can
// hear anything.
test("audio: a first-time player gets sound, and a stored choice still wins", async () => {
  const raw = await fetch("../js/audio.js", NO_STORE).then((r) => r.text());

  // COMMENTS OUT FIRST, and this file learned that the hard way one minute ago:
  // the assertion below forbids "return true" in the catch arm, and the comment
  // explaining WHY the branch was flipped says "This used to return true". The
  // guard went red on the prose defending the very code it was guarding. Every
  // negative assertion over source has this failure mode - stage.test.js has a
  // note at the top saying the same thing after it happened three times there.
  const src = raw
    .split(String.fromCharCode(10))
    .filter((l) => l.trim().indexOf("//") !== 0)
    .join(String.fromCharCode(10));

  // Prove the region: this guard reads one function, so it must exist.
  const at = src.indexOf("function readMuted");
  assert(at !== -1, "readMuted is gone from audio.js - this guard is reading nothing");
  const body = src.slice(at, src.indexOf(String.fromCharCode(125) + String.fromCharCode(10), src.indexOf("catch")));

  // NOTHING STORED means sound. The old default was the bug.
  assert(/stored === null \? false/.test(body),
    "audio.js is muting a player who has never chosen anything - sound is on by " +
    "default since #107, and there is no button to turn it on with");

  // STORAGE BLOCKED means the same thing, so private mode is not a different
  // game. Asserted separately because it is a separate branch that was
  // separately wrong.
  const catchArm = body.slice(body.indexOf("catch"));
  assert(/return false/.test(catchArm) && !/return true/.test(catchArm),
    "the storage-blocked branch is muting again - a private-mode player would " +
    "get a silent game with no stored preference explaining it");

  // A DELIBERATE CHOICE STILL WINS. This is the half that separates it from the
  // retired calm mode, which stopped consulting its key entirely.
  assert(/stored === "1"/.test(body),
    "a stored mute is no longer honoured - somebody who asked for silence is " +
    "being overruled on every load; see the calm-mode note in audio.js for why " +
    "that precedent does NOT apply here");

  // And the only switch there is still exists, since the ruling kept it.
  const app = await fetch("../js/app.js", NO_STORE).then((r) => r.text());
  assert(/setMuted\(!isMuted\(\)\)/.test(app),
    "the M key toggle is gone - it is the only sound control in the game, and " +
    "the ruling that removed the button kept this deliberately");
});
