import * as E from "../js/engine.js";
import { test, assert, eq } from "./harness.js";

// Load the real game data so tests run against the shipped tables.
const [cards, items] = await Promise.all([
  fetch("../data/cards.json").then((r) => r.json()),
  fetch("../data/items.json").then((r) => r.json()),
]);
const DATA = { cards, items };
const game = (opts) => E.newGame(DATA, opts);

// ---- Setup -----------------------------------------------------------------
test("setup: starting stats", () => {
  const s = game({ seed: 1 });
  eq(s.health, 6, "health");
  eq(s.hour, 21, "hour");
  eq(s.items, [], "items");
  eq(s.totem, false, "totem");
  eq(s.status, "playing", "status");
});

test("setup: the night starts on turn 1 at nine o'clock", () => {
  const s = game({ seed: 1 });
  eq(s.turn, 1);
  eq(s.hour, E.RULES.START_HOUR);
  eq(E.clockTime(s).label, "9:00");
  eq(s.status, "playing");
});

// ---- Clock -----------------------------------------------------------------
// The turn is the clock: thirty turns of six minutes, in three bands of ten.
// Nothing else spends time, so every one of these is a pure function of `turn`.

test("bandKey follows the turn, ten turns to a band", () => {
  const s = game({ seed: 1 });
  const bandAt = (turn) => {
    s.turn = turn - 1;
    s.hour = E.RULES.START_HOUR;
    // Walk there rather than setting `hour` by hand, so this tests the thing
    // that actually moves the band in play.
    if (turn > 1) { s.turn = 0; for (let i = 0; i < turn; i++) E.advanceTurn(s); }
    return E.bandKey(s);
  };
  eq(bandAt(1), "9");
  eq(bandAt(10), "9", "the tenth turn is still nine o'clock");
  eq(bandAt(11), "10", "the eleventh turns the hour");
  eq(bandAt(20), "10");
  eq(bandAt(21), "11");
  eq(bandAt(30), "11", "the last turn is the eleven o'clock band");
});

test("advanceTurn: six minutes a turn, and the face walks with it", () => {
  const s = game({ seed: 1 });
  const seen = [E.clockTime(s).label];
  for (let i = 0; i < 5; i++) {
    E.advanceTurn(s);
    seen.push(E.clockTime(s).label);
  }
  eq(seen, ["9:00", "9:06", "9:12", "9:18", "9:24", "9:30"]);
});

test("advanceTurn: the hour turns on the eleventh and twenty-first turns", () => {
  const s = game({ seed: 1 });
  for (let i = 1; i < 11; i++) E.advanceTurn(s); // now on turn 11
  eq(s.turn, 11);
  eq(s.hour, 22);
  eq(E.clockTime(s).label, "10:00", "ten turns of six minutes is exactly an hour");
  for (let i = 0; i < 10; i++) E.advanceTurn(s);
  eq(s.turn, 21);
  eq(s.hour, 23);
  eq(E.clockTime(s).label, "11:00");
});

test("advanceTurn: the thirtieth turn ends the night at midnight", () => {
  const s = game({ seed: 1 });
  for (let i = 1; i < 30; i++) E.advanceTurn(s);
  eq(s.turn, 30, "thirty turns are granted");
  eq(s.status, "playing", "and the thirtieth is one of them");
  eq(E.clockTime(s).label, "11:54");

  E.advanceTurn(s); // the turn that does not exist
  eq(s.status, "lost");
  eq(s.lossReason, "midnight");
  eq(E.clockTime(s).label, "12:00", "the face reads midnight");
  eq(E.clockTime(s).elapsed, 3, "the whole night spent");
});

test("advanceTurn: a finished night does not keep ticking", () => {
  const s = game({ seed: 1 });
  for (let i = 0; i < 40; i++) E.advanceTurn(s);
  eq(s.turn, E.RULES.TOTAL_TURNS + 1, "it stops at the one past the last");
  eq(E.clockTime(s).label, "12:00");
});

test("clockTime: the pips count the turns left in the band", () => {
  const s = game({ seed: 1 });
  const c0 = E.clockTime(s);
  eq(c0.perHour, 10, "ten turns to a band");
  eq(c0.left, 10, "none of them spent yet");
  eq(c0.draws, 0);

  for (let i = 0; i < 9; i++) E.advanceTurn(s); // turn 10, the last of the band
  const c9 = E.clockTime(s);
  eq(c9.left, 1, "one turn stands between here and ten o'clock");
  eq(c9.draws, 9);

  E.advanceTurn(s); // turn 11 — the band has turned
  eq(E.clockTime(s).left, 10, "a fresh band");
});

// ---- The tension director ---------------------------------------------------
test("dread: a fresh nine o'clock is calm, and it is the floor", () => {
  const s = game({ seed: 1 });
  const d = E.dread(s);
  assert(d >= 0 && d < 0.1, `a fresh start should be near zero, got ${d}`);
});

test("dread: every term pushes it up, and none of them pull it down", () => {
  const base = () => game({ seed: 1 });
  const start = E.dread(base());

  const hurt = base();
  hurt.health = 1;
  const late = base();
  E.setTurn(late, 21); // the top of the eleven o'clock band
  const bloody = base();
  bloody.foughtThisHour = 12;
  const deep = base();
  deep.turn = 10; // late in the band, with the hour about to turn
  const carrying = base();
  carrying.totem = true;

  for (const [name, s] of [["hurt", hurt], ["late", late], ["bloody", bloody],
                           ["deep into the band", deep], ["carrying the relic", carrying]]) {
    assert(E.dread(s) > start, `${name} should raise dread`);
  }
});

test("dread: the worst the game gets is worse than any single thing", () => {
  const s = game({ seed: 1 });
  E.setTurn(s, 30);
  s.health = 1;
  s.foughtThisHour = 12;
  s.totem = true;
  const worst = E.dread(s);
  assert(worst > 0.85, `a 1 HP relic-carrying midnight should be near the top, got ${worst}`);
  eq(worst <= 1, true, "and never above 1");
  // and worse than any one term on its own, which is the point of a dial
  const onlyLate = game({ seed: 1 });
  E.setTurn(onlyLate, 30);
  assert(worst > E.dread(onlyLate) * 1.5, "the whole should beat any single part");
});

test("dread: health matters most at the bottom, which is where it is felt", () => {
  const at = (hp) => { const s = game({ seed: 1 }); s.health = hp; return E.dread(s); };
  const sixToFive = at(5) - at(6);
  const twoToOne = at(1) - at(2);
  assert(twoToOne > sixToFive * 2, "losing your last heart should count for more than your first");
});

test("dread: pure, and deterministic under a seed", () => {
  const a = game({ seed: 77 });
  const b = game({ seed: 77 });
  for (let i = 0; i < 4; i++) { E.advanceTurn(a); E.advanceTurn(b); }
  eq(E.dread(a), E.dread(b), "same seed, same fear");
  const before = JSON.stringify({ h: a.health, t: a.turn, f: a.foughtThisHour });
  E.dread(a);
  eq(JSON.stringify({ h: a.health, t: a.turn, f: a.foughtThisHour }), before,
     "reading the dial changes nothing");
});

// ---- The unseen -------------------------------------------------------------
test("phantoms: silent in the first hour, however frightened", () => {
  const s = game({ seed: 5 });
  eq(s.hour, 21);
  for (let i = 0; i < 60; i++) eq(E.rollPhantom(s, 1), null, "nothing in hour one");
});

test("phantoms: never two turns running", () => {
  const s = game({ seed: 5 });
  s.hour = 23;
  let last = null;
  let backToBack = 0;
  for (let i = 0; i < 300; i++) {
    const p = E.rollPhantom(s, 1);
    if (p && last) backToBack++;
    last = p;
  }
  eq(backToBack, 0, "a quiet turn is owed after every phantom");
});

test("phantoms: calm nights are empty, frightened ones are not", () => {
  const count = (fear) => {
    const s = game({ seed: 9 });
    s.hour = 23;
    let n = 0;
    for (let i = 0; i < 400; i++) if (E.rollPhantom(s, fear)) n++;
    return n;
  };
  eq(count(0), 0, "nothing at all when the game is calm");
  assert(count(1) > 0, "and something when it is not");
});

test("phantoms: same seed, same house", () => {
  const run = (seed) => {
    const s = game({ seed });
    s.hour = 22;
    return Array.from({ length: 120 }, () => E.rollPhantom(s, 0.8)).join(",");
  };
  eq(run(42), run(42), "a shared seed hears the same things in the same order");
  assert(run(42) !== run(43), "and different seeds do not");
});

// ---- The candle -------------------------------------------------------------

test("gutter: the light holds through the first hour", () => {
  const s = game({ seed: 3 });
  for (let i = 0; i < 60; i++) eq(E.rollGutter(s, 1), false, "nine o'clock is steady");
});

test("gutter: frightened nights gutter, calm ones do not", () => {
  const count = (fear) => {
    const s = game({ seed: 7 });
    s.hour = 23;
    let n = 0;
    for (let i = 0; i < 400; i++) if (E.rollGutter(s, fear)) n++;
    return n;
  };
  eq(count(0), 0, "a steady hand at no dread");
  assert(count(1) > 0, "and a failing one at full");
});

test("gutter: same seed, same flame", () => {
  const run = (seed) => {
    const s = game({ seed });
    s.hour = 22;
    return Array.from({ length: 150 }, () => E.rollGutter(s, 0.8)).join(",");
  };
  eq(run(8), run(8), "a shared seed watches the same candle");
  assert(run(8) !== run(9), "and different seeds do not");
});

// Four streams now, and the whole point of splitting them is that none of them
// can move any of the others.
test("gutter: its own stream, disturbing nothing", () => {
  const guttered = game({ seed: 13 });
  const not = game({ seed: 13 });
  guttered.hour = 23;
  for (let i = 0; i < 80; i++) E.rollGutter(guttered, 1);
  guttered.hour = 21;

  eq(guttered.rng(), not.rng(), "the game's own stream is untouched");
  // And the other two presentation streams are where they were, so a run that
  // guttered a dozen times still sees the same phantoms.
  eq(E.rollPhantom(guttered, 1), E.rollPhantom(not, 1), "phantoms unmoved");
  eq(E.rollSilentScare(guttered), E.rollSilentScare(not), "scares unmoved");
});

// ---- Relief -------------------------------------------------------------------

// What relief does is absorb the spike, not reverse it. Coming out of a fight
// at 3 HP genuinely IS worse than going into it at 4, and a dial that said
// otherwise would be lying. The claim is that the set-piece does not leave the
// game permanently wound tighter than it found it.
test("relief: a survived fight does not leave the dial wound up", () => {
  const s = game({ seed: 2 });
  s.hour = 22;
  s.health = 4;
  const before = E.dread(s);
  E.resolveCombat(s, 2);
  assert(s.relief > 0, "a survived fight buys relief");

  const eased = E.dread(s);
  const raw = E.dread({ ...s, relief: 0 });
  assert(eased < raw, "the modifier is doing something");
  assert(eased - before < (raw - before) * 0.25,
    "and it absorbs most of what the fight added");
});

test("relief: dying buys nothing", () => {
  const s = game({ seed: 2 });
  s.hour = 23;
  s.health = 1;
  E.resolveCombat(s, 6);
  eq(s.status, "lost", "that fight was not survived");
  eq(s.relief, 0, "and the dead are not relieved");
});

test("relief: it never undoes the hour", () => {
  const late = game({ seed: 12 });
  E.setTurn(late, 30);
  E.grantRelief(late, 1);
  const early = game({ seed: 12 });
  E.setTurn(early, 1);
  // A frightened nine o'clock: hurt, carrying, and mid-hour.
  early.health = 2;
  early.totem = true;
  assert(E.dread(late) > 0, "eleven with full relief is still not calm");
  assert(E.dread(late) >= E.dread(early) * 0.5,
    "the hour keeps its weight through any amount of relief");
});

test("relief: the same relief is worth more early", () => {
  // Measured as a fraction of the dial, not as an absolute drop. Relief is
  // taken out of the headroom above the floor, and the floor IS the night term
  // — so in absolute terms the two cancel exactly and the comparison is a tie
  // that only a rounding error can break. The claim the engine actually makes
  // is the proportional one: at nine the dial empties almost completely, at
  // eleven the same relief barely dents it.
  const at = (turn) => {
    const s = game({ seed: 12 });
    E.setTurn(s, turn);
    s.health = 3;
    const tense = E.dread(s);
    E.grantRelief(s, 1);
    return (tense - E.dread(s)) / tense;
  };
  // Both read at the top of a band, so the only difference is the hour itself.
  assert(at(1) > at(21) * 2, "nine o'clock has far more of its dial to let go of");
});

test("relief: gone within two turns", () => {
  const s = game({ seed: 2 });
  s.hour = 22;
  E.grantRelief(s, 1);
  eq(s.relief, 1, "full on the turn it happens");
  E.beginTurn(s);
  assert(s.relief > 0.2 && s.relief < 0.5, "about a third on the next");
  E.beginTurn(s);
  eq(s.relief, 0, "and nothing on the one after");
});

test("relief: it cannot stack past full", () => {
  const s = game({ seed: 2 });
  E.grantRelief(s, 1);
  E.grantRelief(s, 1);
  eq(s.relief, 1, "two survivals are not twice as safe");
});

// ---- Someone standing ---------------------------------------------------------

test("standing: not before the last hour, however bad it is", () => {
  const s = game({ seed: 4 });
  s.hour = 22;
  for (let i = 0; i < 200; i++) eq(E.rollStanding(s, 1), false, "ten o'clock is too early");
});

test("standing: not in a run that is going well", () => {
  const s = game({ seed: 4 });
  s.hour = 23;
  for (let i = 0; i < 200; i++) eq(E.rollStanding(s, 0.4), false, "a calm midnight stays empty");
});

test("standing: once a run and never again", () => {
  const s = game({ seed: 6 });
  s.hour = 23;
  let n = 0;
  for (let i = 0; i < 600; i++) if (E.rollStanding(s, 1)) n++;
  eq(n, 1, "the budget is one, whatever the dice say");
});

test("standing: same seed, same figure", () => {
  const run = (seed) => {
    const s = game({ seed });
    s.hour = 23;
    return Array.from({ length: 40 }, () => E.rollStanding(s, 1)).join(",");
  };
  eq(run(21), run(21), "a shared seed is haunted on the same turn");
});

test("standing: its own stream, disturbing nothing", () => {
  const stood = game({ seed: 17 });
  const not = game({ seed: 17 });
  stood.hour = 23;
  for (let i = 0; i < 40; i++) E.rollStanding(stood, 1);
  stood.hour = 21;
  eq(stood.rng(), not.rng(), "the game's own stream is untouched");
  eq(E.rollPhantom(stood, 1), E.rollPhantom(not, 1), "phantoms unmoved");
  eq(E.rollGutter(stood, 1), E.rollGutter(not, 1), "the candle unmoved");
});

// The reason for a second stream at all.
test("phantoms: rolling them does not disturb the game's own rng", () => {
  const withPhantoms = game({ seed: 11 });
  const without = game({ seed: 11 });
  withPhantoms.hour = 23;
  for (let i = 0; i < 50; i++) E.rollPhantom(withPhantoms, 1);
  withPhantoms.hour = 21;

  // The same next value means the gameplay stream never moved.
  eq(withPhantoms.rng(), without.rng(), "the game's own stream is untouched");
  eq(withPhantoms.rng(), without.rng(), "and stays in step");
});

test("foughtThisHour: counts the risen, and resets when the hour turns", () => {
  const s = game({ seed: 1 });
  eq(s.foughtThisHour, 0);
  E.resolveCombat(s, 3, {});
  E.resolveCombat(s, 2, {});
  eq(s.foughtThisHour, 5, "five risen put down this hour");
  while (s.hour === 21) E.advanceTurn(s); // walk into the ten o'clock band
  eq(s.hour, 22, "the hour turned");
  eq(s.foughtThisHour, 0, "and the count went with it");
});

test("clockTime: pure and deterministic under a seed", () => {
  const a = game({ seed: 42 });
  const b = game({ seed: 42 });
  for (let i = 0; i < 5; i++) {
    E.advanceTurn(a);
    E.advanceTurn(b);
    eq(E.clockTime(a).label, E.clockTime(b).label, `same seed, same clock at turn ${i}`);
  }
  const snapshot = a.turn;
  E.clockTime(a);
  eq(a.turn, snapshot, "reading the clock does not spend anything");
});

// ---- Health ----------------------------------------------------------------
test("changeHealth: 0 is a loss", () => {
  const s = game({ seed: 1 });
  s.health = 1;
  E.changeHealth(s, -1);
  eq(s.health, 0);
  eq(s.status, "lost");
  eq(s.lossReason, "health");
});

test("changeHealth: no cap by default", () => {
  const s = game({ seed: 1 });
  E.changeHealth(s, +5);
  eq(s.health, 11);
});

test("changeHealth: v1.75 cap clamps gains", () => {
  const s = game({ seed: 1, healthCap: 6 });
  E.changeHealth(s, +5);
  eq(s.health, 6);
});

// ---- Combat ----------------------------------------------------------------
test("combatDamage: clamps to [0,4]", () => {
  eq(E.combatDamage(3, 1), 2, "normal");
  eq(E.combatDamage(6, 1), 4, "capped at 4");
  eq(E.combatDamage(2, 5), 0, "never negative / no heal");
});

test("resolveCombat: applies damage", () => {
  const s = game({ seed: 1 });
  const r = E.resolveCombat(s, 3); // attack 1 -> 2 damage
  eq(r.damage, 2);
  eq(s.health, 4);
});

test("resolveCombat: lethal fight loses with reason combat", () => {
  const s = game({ seed: 1 });
  s.health = 2;
  E.resolveCombat(s, 6); // 4 damage
  eq(s.health, 0);
  eq(s.status, "lost");
  eq(s.lossReason, "combat");
});

test("attack never stacks: best weapon only", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "grisly-femur"); // +1
  E.pickUpItem(s, "machete"); // +2
  eq(E.effectiveAttack(s), 3, "1 + best(2), not 1+1+2");
  eq(E.chooseWeapon(s), "machete");
});

test("chooseWeapon: honours an explicit weapon", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "grisly-femur");
  E.pickUpItem(s, "machete");
  eq(E.chooseWeapon(s, "grisly-femur"), "grisly-femur");
});

// ---- Chainsaw --------------------------------------------------------------
test("chainsaw: picks up loaded, gives +3", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "chainsaw");
  eq(s.chainsawFuel, 2);
  eq(E.effectiveAttack(s), 4);
});

test("chainsaw: fuel drains, is kept when spent, refuellable", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "chainsaw");
  E.resolveCombat(s, 5); // use 1 -> fuel 1
  E.resolveCombat(s, 5); // use 2 -> fuel 0
  eq(s.chainsawFuel, 0);
  assert(s.items.includes("chainsaw"), "empty chainsaw is kept");
  eq(E.effectiveAttack(s), 1, "empty chainsaw gives no bonus");
  E.pickUpItem(s, "gasoline");
  eq(E.refuelChainsaw(s).ok, true);
  eq(s.chainsawFuel, 2);
  assert(!s.items.includes("gasoline"), "gasoline consumed");
  eq(E.effectiveAttack(s), 4, "refuelled chainsaw usable again");
});

test("chainsaw: can preserve fuel by choosing another weapon", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "chainsaw");
  E.pickUpItem(s, "machete");
  E.resolveCombat(s, 4, { weapon: "machete" });
  eq(s.chainsawFuel, 2, "fuel untouched");
});

// ---- Items -----------------------------------------------------------------
test("items: 2-slot limit, drop to make room", () => {
  const s = game({ seed: 1 });
  eq(E.pickUpItem(s, "machete").ok, true);
  eq(E.pickUpItem(s, "golf-club").ok, true);
  eq(E.pickUpItem(s, "board-nails").ok, false, "full without a drop");
  eq(E.pickUpItem(s, "board-nails", "machete").ok, true, "drop then pick up");
  eq(s.items, ["golf-club", "board-nails"]);
});

test("totem: slotless, and wins only when held", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "machete");
  E.pickUpItem(s, "golf-club");
  E.gainTotem(s); // full on items, totem still allowed
  eq(s.totem, true);
  eq(s.items.length, 2, "totem took no slot");
  const noTotem = game({ seed: 1 });
  E.buryTotem(noTotem);
  eq(noTotem.status, "playing", "no win without the totem");
  E.buryTotem(s);
  eq(s.status, "won");
});

test("soda: +2 health, consumed; respects cap", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "can-of-soda");
  E.useHealItem(s);
  eq(s.health, 8);
  assert(!s.items.includes("can-of-soda"), "soda consumed");
  const capped = game({ seed: 1, healthCap: 6 });
  E.pickUpItem(capped, "can-of-soda");
  E.useHealItem(capped);
  eq(capped.health, 6, "capped");
});

// ---- Combos ----------------------------------------------------------------
test("candle combo: needs candle + fuel; fuel consumed, candle kept", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "candle");
  E.pickUpItem(s, "oil");
  eq(E.useCandleCombo(s, "oil").ok, true);
  assert(!s.items.includes("oil"), "oil consumed");
  assert(s.items.includes("candle"), "candle reusable");
});

test("candle combo: fails without candle", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "oil");
  eq(E.useCandleCombo(s, "oil").ok, false);
});

// ---- Fleeing ---------------------------------------------------------------
test("flee: costs 1 health", () => {
  const s = game({ seed: 1 });
  E.flee(s);
  eq(s.health, 5);
});

test("flee: oil escapes damage, one use", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "oil");
  E.flee(s, { useOil: true });
  eq(s.health, 6, "no damage");
  assert(!s.items.includes("oil"), "oil consumed");
});

// ---- Cowering --------------------------------------------------------------
// The designer ruled the gap between the Reliquary's / Family Plot's two cards
// "behaves like an ordinary fresh turn", so it carries its own cower allowance
// rather than competing with the one at end of turn.
// ---- Card resolution -------------------------------------------------------
