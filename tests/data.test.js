import { test, assert, eq, suite } from "./harness.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "7e20ea7f");

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
test("chrome: game.html's static words match the theme's English", async () => {
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ui = themeEn.ui;
  // id in the page -> key in the theme. Both directions matter: a page node
  // with no key never gets translated, and a key with no node is dead weight.
  const PAIRS = [
    ["brand", "brand"], ["nav-rulebook", "nav-rulebook"], ["nav-menu", "nav-menu"],
    ["page-title", "page-title"], ["backpack", "backpack"], ["seed-label", "seed-label"],
    ["note-again", "note-again"],
    // copy-replay went with the HUD button (#55). The seed can still be copied
    // from the verdict card, which is where a seed is worth sharing — that one
    // is built in script and carries its own label, so there is no static node
    // here for the theme to write.
    ["hands-title", "hands-title"],
  ];
  for (const [id, key] of PAIRS) {
    const el = doc.getElementById(id);
    assert(el, `game.html has no #${id} for the theme to write`);
    eq(el.textContent.trim(), ui[key], `#${id} and ui.${key} disagree`);
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
    "hands-title", "hand-weapon", "hand-charm", "hand-empty", "hand-buffed",
    "hand-weapon-said", "hand-weapon-bare", "hand-charm-said", "hand-charm-bare",
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

test("equipment: the hands panel is in the page", async () => {
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  assert(/id="hud-hands"/.test(html), "game.html has no hands panel");
  assert(/id="hands-title"/.test(html), "the hands panel has no themed heading");
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
