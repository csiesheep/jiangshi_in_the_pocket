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
  eq(tilesWithHeal.map((t) => t.id).sort(), ["incense-hall", "pagoda-tree"], "香堂 and 槐樹");
  // One each side of the seam, which is what stops the mending all living in
  // one half of the map.
  eq(tilesWithHeal.filter((t) => tiles.indoor.includes(t)).length, 1, "one indoors");
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

test("§13: a warded turn is worth ~0.85 / ~1.25 / ~2.3 at Attack 2", () => {
  // This arithmetic used to price a cower charge. The charges went in the
  // post-launch redesign and 石敢當 inherited the thing they were pricing: what
  // an event-free turn buys is the expected damage of the draw you did not
  // make. The numbers did not move because the event tables did not — which is
  // the useful part, since it says the ward is worth exactly what the charge
  // was, minus the carrying.
  eq(expectedLoss("9", 2), 0.85);
  eq(expectedLoss("10", 2), 1.25);
  eq(expectedLoss("11", 2), 2.3);
  assert(expectedLoss("11", 2) > expectedLoss("9", 2) * 2.5,
    "and standing there is worth nearly three times as much at eleven as at nine");
});

// These used to be the same number. They are not any more, and the gap IS the
// hidden ending: the sword is something a good player expects to find, and the
// banner is something they mostly will not.
test("§13: ~10 searches for 七星劍, ~10 for 攝魂幡", () => {
  const p = (table, id) => search[table].find((e) => e.id === id).p;
  eq(p("weapon", "sevenstar-sword"), 10);
  eq(Math.round(100 / p("weapon", "sevenstar-sword")), 10, "one in ten, about ten rummages");
  eq(p("relic", "soul-banner"), 10);
  eq(Math.round(100 / p("relic", "soul-banner")), 10, "one in ten, and only at 土地廟");
  // 攝魂幡 went 15 -> 2 to hide 鎮屍, then 2 -> 10 because at 2 % the shrine was
  // a rice tile with a rumour attached and 土地廟 has no other identity since
  // the prayer was removed. The seal is held down by the bar at 14/13 and by
  // the 神主牌 being compulsory, not by the banner being nearly unfindable.
  eq(p("relic", "sticky-rice"), 40, "the shrine's rice is untouched: it is what makes the walk pay when the banner does not come");
});

// Enumerated rather than transcribed: this builds every sword x buff x banner x
// talisman combination the game allows and counts the ones that clear each bar,
// so a new talisman or a changed sword moves the count here before anyone
// notices in play. Derived from RULES rather than restated, so the day the
// thresholds move this fails with the real number instead of a stale one.
//
// The bar met the ceiling in #56: 13 bare, 12 carrying the 神主牌, against a
// game that tops out at exactly 13. So the hardest kit wins on the nose without
// his name, and the tablet buys the one point that lets a lesser talisman do
// it — an advantage again rather than the requirement option A made it.
test("§13: one kit reaches the bare bar, and the tablet buys a second", () => {
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
  const ceiling = Math.max(...reached);
  eq(ceiling, 13, "13 is the most the game can produce: 七星劍 + 真火符, doubled, + 血符");
  eq(reached.filter((a) => a >= E.RULES.KING_THRESHOLD).length, 1,
    `exactly one kit reaches ${E.RULES.KING_THRESHOLD} bare, and it is the ceiling itself`);
  eq(reached.filter((a) => a >= E.RULES.KING_THRESHOLD_WITH_TABLET).length, 2,
    `two reach ${E.RULES.KING_THRESHOLD_WITH_TABLET} — the tablet buys 五雷 a line of its own`);
  eq(E.RULES.KING_THRESHOLD, ceiling,
    "the bare bar IS the ceiling: winnable without his name, but only perfectly");
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

// This row has been re-derived twice, and both times the question underneath
// survived: how much of the pack does the winning loadout actually cost?
//
// It began as "starting rice plus a full duel kit is exactly 6 of 6". The hands
// (#31) took the sword and 護身符 out of the pack, so it became two slots of six
// with slack to spare — and that slack is precisely what the user then ruled
// away (#47). Two slots of FOUR now, which is the same kit against a pack half
// the size.
//
// The two are 攝魂幡 and 血符. Everything else the seal needs is somewhere that
// is not luggage: the blade in your hand, the 真火符 burned into it and consumed,
// the 神主牌 slotless. See tools/pack-4-reachability.md — this test is that
// analysis, executable.
test("§13: the duel kit costs two of the four pack slots, and nothing else does", () => {
  const s = game({ seed: 1 });
  eq(E.RULES.MAX_ITEMS, 4, "the pack the rest of this row is about");
  eq(E.slotsUsed(s), 3, "three 糯米 to begin");

  // Neither hand is luggage.
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "protective-charm");
  eq(E.slotsUsed(s), 3, "the blade and the charm cost nothing");
  eq(E.equippedWeapon(s), "sevenstar-sword");
  eq(E.hasCharm(s), true);

  // The first of the two the pack must hold at midnight fills it.
  E.pickUpItem(s, "soul-banner");
  eq(E.slotsUsed(s), 4, "full, with three rice still aboard");

  // And the second has to be paid for, which is the whole of what #47 changed:
  // a rice buys the slot, and the engine hands that choice back rather than
  // making it.
  eq(E.pickUpItem(s, "blood-talisman").ok, false, "no room while three rice ride along");
  eq(E.pickUpItem(s, "blood-talisman", "sticky-rice").ok, true, "one rice pays for it");
  eq(E.slotsUsed(s), 4);
  eq(E.heldCount(s, "sticky-rice"), 2, "two meals left");

  // The tightest moment: 真火符 in hand as well, three ids at once, before
  // burning it into the blade gives the slot back.
  eq(E.pickUpItem(s, "truefire-talisman", "sticky-rice").ok, true);
  eq(E.slotsUsed(s), 4, "banner, blood, fire and one rice");
  E.buffSword(s, "sevenstar-sword");
  eq(E.slotsUsed(s), 3, "burning it in returns the slot");
  eq(E.effectiveAttack(s), 4, "七星劍 with the fire in it");

  // Which leaves the standing requirement at two, and a rice to spare.
  eq(E.freeSlots(s), 1);
  eq(E.attackWith(s, { banner: true, talisman: "blood-talisman" }), 13, "the only winning number");
});
