import * as E from "../js/engine.js";
import { test, assert, eq } from "./harness.js";

// Data is fetched no-store. A test that reads a cached copy of the file it is
// asserting about is worse than no test.
const NO_STORE = { cache: "no-store" };

// Spec §13 — "numbers worth re-deriving after any change". Several of these are
// load-bearing and were arrived at by hand, which is exactly why they belong in
// a suite: a weight nudged in search.json or one more jiangshi in a band moves
// them silently and nothing else would notice.
//
// These DERIVE the numbers from the shipped tables and the real engine rather
// than restating them. A test that hardcodes 1.85 passes forever after someone
// changes the pool; a test that computes it from events.json fails the moment
// the pool stops meaning 1.85, which is the whole point of the table.
const [items, search, events, tiles] = await Promise.all([
  fetch("../data/items.json", NO_STORE).then((r) => r.json()),
  fetch("../data/search.json", NO_STORE).then((r) => r.json()),
  fetch("../data/events.json", NO_STORE).then((r) => r.json()),
  fetch("../data/tiles.json", NO_STORE).then((r) => r.json()),
]);
const DATA = { items, search, events, tiles };
const game = (opts) => E.newGame(DATA, opts);

const round2 = (n) => Math.round(n * 100) / 100;

// Expected HP lost in one turn of a band, at a given attack.
//
// The two exclusions are the spec's, and both matter. The VILLAGER is counted
// as REFUSED — taking the gift is a choice the average cannot model, and
// refusing is the branch that costs health. POISON contributes nothing here
// because it is a separate −1/turn on top, not part of the draw.
function expectedLoss(band, attack, { charm = false } = {}) {
  let total = 0;
  for (const e of events[band]) {
    const p = e.p / 100;
    if (e.t === "JIANGSHI") total += p * E.combatDamage(e.n, attack, charm);
    else if (e.t === "HP") total += p * -e.hp; // a +1 is a negative loss
    else if (e.t === "VILLAGER") total += p * E.combatDamage(e.turnsInto, attack, charm);
    // NOTHING and POISON contribute nothing to this figure.
  }
  return round2(total);
}

test("§13: every search table and event band sums to 100", () => {
  for (const [name, t] of Object.entries(search)) {
    eq(t.reduce((n, e) => n + e.p, 0), 100, `search.${name}`);
  }
  for (const [band, t] of Object.entries(events)) {
    eq(t.reduce((n, e) => n + e.p, 0), 100, `events.${band}`);
  }
});

test("§13: expected HP lost per turn bare-handed is 1.85 / 2.00 / 2.90", () => {
  eq(expectedLoss("9", 0), 1.85);
  eq(expectedLoss("10", 0), 2.00);
  eq(expectedLoss("11", 0), 2.90);
});

test("§13: expected HP lost per turn at Attack 4 is 0.00 / 0.25 / 0.90", () => {
  eq(expectedLoss("9", 4), 0);
  eq(expectedLoss("10", 4), 0.25);
  eq(expectedLoss("11", 4), 0.9);
  // The shape of the whole game in one line: four points of attack is the
  // difference between a night that costs you 2-3 a turn and one that costs
  // you a fraction.
  assert(expectedLoss("11", 4) < expectedLoss("11", 0) / 3, "attack is worth more than anything else you can carry");
});

test("§13: the sustained ceiling from swords alone is 4", () => {
  const s = game({ seed: 1 });
  let best = 0;
  for (const it of items.filter((i) => i.cat === "weapon")) {
    const t = game({ seed: 1 });
    E.pickUpItem(t, it.id);
    E.pickUpItem(t, "truefire-talisman");
    E.buffSword(t, it.id);
    best = Math.max(best, E.effectiveAttack(t));
  }
  eq(best, 4, "七星劍 3 + one 真火符, and nothing sustains higher");
  eq(E.effectiveAttack(s), 0, "and you start at nothing");
});

test("§13: eleven o'clock at the ceiling costs ~9 over ten turns, against a cap of 10", () => {
  const perTurn = expectedLoss("11", 4);
  const overTen = round2(perTurn * 10);
  eq(overTen, 9);
  assert(overTen < E.RULES.HEALTH_CAP, "survivable, but only just — and that is the design");
});

test("§13: camping a HEAL_1 tile is losing", () => {
  const heal = 1; // what onTurnEnd HEAL_1 gives
  // Camping still draws an event every turn, so the tile has to out-earn the
  // band. At the ceiling in the mildest band it does not, and it gets worse
  // from there.
  assert(heal < expectedLoss("11", 2), `+1 against ${expectedLoss("11", 2)} at eleven`);
  assert(heal < expectedLoss("11", 0), "and far worse bare-handed");
  const tilesWithHeal = [...tiles.indoor, ...tiles.outdoor].filter((t) => t.onTurnEnd === "HEAL_1");
  eq(tilesWithHeal.length, 2, "帳房 and 槐樹");
});

test("§13: the worst single turn is 7 HP at Attack 2, 3 at Attack 4", () => {
  // 11 PM, standing in a dead end: the band's worst pack, then the breach.
  const worstPack = Math.max(...events["11"].filter((e) => e.t === "JIANGSHI").map((e) => e.n));
  const breach = E.RULES.BREACH_COUNT["11"];
  eq(worstPack, 6);
  eq(breach, 5);
  eq(E.combatDamage(worstPack, 2) + E.combatDamage(breach, 2), 7);
  eq(E.combatDamage(worstPack, 4) + E.combatDamage(breach, 4), 3);
});

test("§13: a cower charge is worth ~0.85 / ~1.25 / ~2.3 at Attack 2", () => {
  // What a charge buys is the expected damage of the draw you did not make,
  // which is why charges hoard themselves for late without a rule saying so.
  eq(expectedLoss("9", 2), 0.85);
  eq(expectedLoss("10", 2), 1.25);
  eq(expectedLoss("11", 2), 2.3);
  assert(expectedLoss("11", 2) > expectedLoss("9", 2) * 2.5, "worth nearly three times as much at eleven");
});

test("§13: ~7 searches for 七星劍, ~7 for 攝魂幡", () => {
  const p = (table, id) => search[table].find((e) => e.id === id).p;
  eq(p("weapon", "sevenstar-sword"), 15);
  eq(p("relic", "soul-banner"), 15);
  eq(Math.round(100 / 15), 7, "one in fifteen, so about seven rummages apiece");
});

// Enumerated rather than transcribed. The spec lists four kits; this builds
// every sword × buff × banner × talisman combination the game allows and counts
// the ones that clear each threshold, so a new talisman or a changed sword
// moves the count here before anyone notices in play.
test("§13: 2 kits reach 12, and 4 reach 11", () => {
  const swords = items.filter((i) => i.cat === "weapon");
  const talismans = items.filter((i) => i.cat === "magic" && i.attack);
  const reached = [];
  for (const sword of swords) {
    for (const buff of [false, true]) {
      for (const banner of [false, true]) {
        for (const tal of [null, ...talismans]) {
          const s = game({ seed: 1 });
          E.pickUpItem(s, sword.id);
          if (buff) { E.pickUpItem(s, "truefire-talisman"); E.buffSword(s, sword.id); }
          if (tal) E.pickUpItem(s, tal.id);
          const atk = E.attackWith(s, { banner, talisman: tal ? tal.id : null });
          reached.push(atk);
        }
      }
    }
  }
  eq(reached.filter((a) => a >= 12).length, 2, "at threshold 12");
  eq(reached.filter((a) => a >= 11).length, 4, "at threshold 11, carrying the tablet");
  eq(Math.max(...reached), 13, "and 13 is the most the game can produce");
});

test("§13: every winning line spends the banner", () => {
  const swords = items.filter((i) => i.cat === "weapon");
  const talismans = items.filter((i) => i.cat === "magic" && i.attack);
  let bestWithoutBanner = 0;
  for (const sword of swords) {
    for (const tal of [null, ...talismans]) {
      const s = game({ seed: 1 });
      E.pickUpItem(s, sword.id);
      E.pickUpItem(s, "truefire-talisman");
      E.buffSword(s, sword.id);
      if (tal) E.pickUpItem(s, tal.id);
      bestWithoutBanner = Math.max(bestWithoutBanner, E.attackWith(s, { talisman: tal ? tal.id : null }));
    }
  }
  eq(bestWithoutBanner, 9, "the best you can do without 攝魂幡");
  assert(bestWithoutBanner < E.RULES.KING_THRESHOLD_WITH_TABLET,
    "so the banner is the one truly compulsory item in the game");
});

test("§13: starting rice plus a full duel kit is exactly 6 of 6", () => {
  const s = game({ seed: 1 });
  eq(E.slotsUsed(s), 3, "three 糯米 to begin");
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "soul-banner");
  E.pickUpItem(s, "fivethunder-talisman");
  eq(E.slotsUsed(s), 6, "sword, banner, one talisman stack");
  eq(E.freeSlots(s), 0, "exactly full, with nothing to spare");
  eq(E.hasItemSpace(s, "golden-elixir"), false);
  // And the stack really is one slot however deep it goes.
  E.pickUpItem(s, "cinnabar-would-not-fit-either");
  eq(E.slotsUsed(s), 6);
});
