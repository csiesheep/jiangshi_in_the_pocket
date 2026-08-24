import { test, assert, eq } from "./harness.js";

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
