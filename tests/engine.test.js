import * as E from "../js/engine.js";
import { test, assert, eq } from "./harness.js";

// Data is fetched no-store. A test that reads a cached copy of the file it is
// asserting about is worse than no test: it passes on data that is not on disk,
// which is exactly how a fixed table can keep reporting the old bug.
const NO_STORE = { cache: "no-store" };

// Load the real game data so tests run against the shipped tables.
const [items, search, events] = await Promise.all([
  fetch("../data/items.json", NO_STORE).then((r) => r.json()),
  fetch("../data/search.json", NO_STORE).then((r) => r.json()),
  fetch("../data/events.json", NO_STORE).then((r) => r.json()),
]);
const DATA = { items, search, events };
const game = (opts) => E.newGame(DATA, opts);

// ---- Setup -----------------------------------------------------------------
test("setup: starting stats", () => {
  const s = game({ seed: 1 });
  eq(s.health, 10, "health");
  eq(s.hour, 21, "hour");
  eq(s.tablet, false, "the tablet");
  eq(s.poisoned, false, "not poisoned");
  eq(s.status, "playing", "status");
});

// The DoD's setup check, spelled out: ten health, bare hands, three charges,
// and a pack that begins three-sixths full of rice.
test("setup: 10 HP, attack 0, 3 charges, 3 rice in 3 of 6 slots", () => {
  const s = game({ seed: 1 });
  eq(s.health, E.RULES.START_HEALTH);
  eq(s.health, 10);
  eq(E.effectiveAttack(s), 0, "bare-handed is zero, not one");
  eq(E.heldCount(s, "sticky-rice"), 3, "three rice");
  eq(E.slotsUsed(s), 3, "and they cost three slots, one each");
  eq(E.freeSlots(s), 3, "of six");
});

test("setup: the starting pack is a copy, not the constant itself", () => {
  const a = game({ seed: 1 });
  const b = game({ seed: 2 });
  E.dropItem(a, "sticky-rice");
  eq(E.heldCount(a, "sticky-rice"), 2, "eaten in this run");
  eq(E.heldCount(b, "sticky-rice"), 3, "and untouched in the next");
  eq(E.RULES.START_ITEMS["sticky-rice"], 3, "the constant is not mutated");
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

test("advanceTurn: the thirtieth is the last, and asking for one more is a bug", () => {
  const s = game({ seed: 1 });
  for (let i = 1; i < 30; i++) E.advanceTurn(s);
  eq(s.turn, 30, "thirty turns are granted");
  eq(s.status, "playing", "and the thirtieth is one of them");
  eq(E.clockTime(s).label, "11:54");

  // The turn that does not exist. This used to end the run quietly as a
  // clock-death, which is the one ending the design abolished — so what is
  // being pinned here is that it fails where a caller can see it rather than
  // inventing an outcome. Every real caller stops at TOTAL_TURNS and hands off
  // to midnight(); reaching this line at all means one of them stopped doing so.
  let threw = null;
  try { E.advanceTurn(s); } catch (err) { threw = err; }
  assert(threw, "advancing past the last turn must not pass silently");
  assert(/midnight/i.test(threw.message), `and it should say why, got: ${threw && threw.message}`);

  eq(s.turn, 30, "the clock is left where it was");
  eq(s.status, "playing", "no ending is invented");
  eq(s.lossReason, null, "least of all a loss to the clock");
});

test("advanceTurn: a finished night does not keep ticking, and does not throw either", () => {
  const s = game({ seed: 1 });
  for (let i = 1; i < 30; i++) E.advanceTurn(s);
  s.status = "lost"; // however it ended — the clock is not what ended it
  for (let i = 0; i < 40; i++) E.advanceTurn(s);
  eq(s.turn, 30, "a night that is over does not move");
  eq(s.status, "lost", "and is not disturbed by being asked");
});

test("clockTime: the face still reads midnight past the last turn", () => {
  // setTurn clamps to TOTAL_TURNS + 1, so the midnight face is reachable for
  // display even though no turn is ever spent to get there.
  const s = game({ seed: 1 });
  E.setTurn(s, E.RULES.TOTAL_TURNS + 1);
  eq(E.clockTime(s).label, "12:00", "the face reads midnight");
  eq(E.clockTime(s).elapsed, 3, "the whole night spent");
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
  carrying.tablet = true;

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
  s.tablet = true;
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
  // Anchored to the top of the scale rather than to a literal, because the
  // literals were 6 and 5 — the first heart of a six-point bar. On a ten-point
  // one that pair sits in the middle of the curve, where it is neither the
  // first heart nor the last and the comparison stops meaning anything.
  const full = E.RULES.START_HEALTH;
  const firstHeart = at(full - 1) - at(full);
  const lastHeart = at(1) - at(2);
  assert(lastHeart > firstHeart * 2,
    `losing your last heart (${lastHeart}) should count for more than your first (${firstHeart})`);
});

test("dread: the weights are a whole", () => {
  const sum = Object.values(E.DREAD_WEIGHTS).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 1e-9, `the dial has to be a unit, got ${sum}`);
});

test("dread: pure, and deterministic under a seed", () => {
  const a = game({ seed: 77 });
  const b = game({ seed: 77 });
  for (let i = 0; i < 4; i++) { E.advanceTurn(a); E.advanceTurn(b); }
  eq(E.dread(a), E.dread(b), "same seed, same fear");
  const snap = (s) => JSON.stringify({ h: s.health, t: s.turn, f: s.foughtThisHour });
  const before = snap(a);
  E.dread(a);
  eq(snap(a), before, "reading the dial changes nothing");
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
  early.tablet = true;
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

test("changeHealth: the cap is hard, and it is ten", () => {
  const s = game({ seed: 1 });
  eq(s.healthCap, 10);
  E.changeHealth(s, 50);
  eq(s.health, 10, "nothing exceeds the cap");
});

test("changeHealth: a run may still be given a lower cap", () => {
  const s = game({ seed: 1, healthCap: 6 });
  E.changeHealth(s, +5);
  eq(s.health, 6);
});

// ---- Combat ----------------------------------------------------------------
// ---- The pack --------------------------------------------------------------
test("pack: six slots, one per unit, drop to make room", () => {
  // Filled with consumables, because that is all the pack holds since the
  // hands took the weapon and the charm out of it.
  const s = game({ seed: 1 }); // starts with 3 rice in 3 slots
  eq(E.pickUpItem(s, "soul-banner").ok, true);
  eq(E.pickUpItem(s, "black-dog-blood").ok, true);
  eq(E.pickUpItem(s, "golden-elixir").ok, true);
  eq(E.slotsUsed(s), 6, "full");
  eq(E.pickUpItem(s, "truefire-talisman").ok, false, "full without a drop");
  eq(E.pickUpItem(s, "truefire-talisman", "sticky-rice").ok, true, "a rice makes room");
  eq(E.heldCount(s, "sticky-rice"), 2, "one rice gone");
  eq(E.slotsUsed(s), 6);
});

// The rule that makes the pack shape worth having. It is scoped to cat magic
// and nothing else, so this checks both halves: a talisman stack stays one
// slot, and rice does not.
test("pack: only talismans stack into one slot", () => {
  const s = game({ seed: 1 });
  eq(E.slotsUsed(s), 3, "three rice, three slots");

  E.pickUpItem(s, "truefire-talisman");
  eq(E.slotsUsed(s), 4);
  eq(E.slotCost(s, "truefire-talisman"), 0, "a second of the same joins the stack");
  E.pickUpItem(s, "truefire-talisman");
  E.pickUpItem(s, "truefire-talisman");
  eq(E.heldCount(s, "truefire-talisman"), 3, "three deep");
  eq(E.slotsUsed(s), 4, "and still one slot");

  eq(E.slotCost(s, "sticky-rice"), 1, "rice never stacks");
  E.pickUpItem(s, "sticky-rice");
  eq(E.slotsUsed(s), 5, "a fourth rice is a fourth slot");
});

test("pack: a unique already held is refused", () => {
  const s = game({ seed: 1 });
  eq(E.pickUpItem(s, "soul-banner").ok, true);
  const again = E.pickUpItem(s, "soul-banner");
  eq(again.ok, false);
  eq(again.reason, "duplicate");
  eq(E.heldCount(s, "soul-banner"), 1);
});

test("pack: dropping the last of an id removes it entirely", () => {
  const s = game({ seed: 1 });
  E.dropItem(s, "sticky-rice", 3);
  eq(E.held(s, "sticky-rice"), false);
  eq(E.heldIds(s), [], "no zero-count ghosts left behind");
  eq(E.slotsUsed(s), 0);
});

test("the tablet: slotless, and wins only when held", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "soul-banner");
  E.pickUpItem(s, "black-dog-blood");
  E.pickUpItem(s, "golden-elixir"); // six of six
  eq(E.slotsUsed(s), 6, "pack full");
  E.completeRite(s, "TAKE_TABLET");
  eq(s.tablet, true);
  eq(E.slotsUsed(s), 6, "the tablet took no slot");
  const empty = game({ seed: 1 });
  eq(E.completeRite(empty, "BURY_TABLET").reason, "no-tablet", "nothing to bury");
  eq(empty.status, "playing", "and no win for standing there");
  E.completeRite(s, "BURY_TABLET");
  eq(s.status, "won");
});

test("medicine: heals, is consumed, respects the cap", () => {
  const s = game({ seed: 1 });
  s.health = 4;
  E.useMedicine(s, "sticky-rice");
  eq(s.health, 7, "4 + the rice's 3");
  eq(E.heldCount(s, "sticky-rice"), 2, "one rice eaten");
  const capped = game({ seed: 1 });
  E.useMedicine(capped, "sticky-rice");
  eq(capped.health, 10, "already full: capped, not overflowing");
});

// ---- Fleeing ---------------------------------------------------------------
// ---- 中毒 --------------------------------------------------------------------
test("poison: a flag, not a counter, and only rice lifts it", () => {
  const s = game({ seed: 1 });
  eq(s.poisoned, false);
  E.poison(s);
  E.poison(s); // a second dose is nothing at all
  eq(s.poisoned, true);
  E.useMedicine(s, "sticky-rice");
  eq(s.poisoned, false, "rice cures");
});

test("poison: the charm does not cure it — poison is not damage", () => {
  const s = game({ seed: 1 });
  E.poison(s);
  E.pickUpItem(s, "protective-charm");
  E.poisonTick(s);
  eq(s.poisoned, true, "still poisoned with the charm on");
  eq(s.health, 9, "and it still took its point");
});

// The DoD's tick-order check. Poison is step 1 of the turn, before the action,
// which is exactly what makes curing on the turn you were poisoned still pay
// that turn's tick — no special case, just the order.
test("poison: curing on the same turn still pays that turn's tick", () => {
  const s = game({ seed: 1 });
  E.poison(s);
  eq(s.health, 10);

  E.beginTurn(s); // step 1: the tick
  eq(s.health, 9, "the tick lands first");
  E.useMedicine(s, "sticky-rice"); // the action: eat the rice
  eq(s.poisoned, false, "cured");
  eq(s.health, 10, "healed back to the cap");

  E.beginTurn(s); // next turn: nothing to tick
  eq(s.health, 10, "no further ticks once cured");
});

test("poison: a tick can kill, and it is a health loss", () => {
  const s = game({ seed: 1 });
  s.health = 1;
  E.poison(s);
  E.beginTurn(s);
  eq(s.health, 0);
  eq(s.status, "lost");
  eq(s.lossReason, "health");
});

test("poison: no tick for a run already over", () => {
  const s = game({ seed: 1 });
  E.poison(s);
  s.status = "won";
  eq(E.poisonTick(s), 0);
  eq(s.health, 10);
});

// ---- The ward ---------------------------------------------------------------
// 石敢當 replaced cowering as the game's safety: a place you travel to rather
// than a resource you carry. The engine's whole share of it is that a warded
// turn draws nothing.
test("ward: a warded turn draws no event at all", () => {
  const s = game({ seed: 1 });
  eq(E.drawEvent(s, { warded: true }), null, "nothing comes to the stone");
  assert(E.drawEvent(s, { warded: false }), "and everywhere else still answers");
  assert(E.drawEvent(s), "unwarded is the default, so no caller draws by accident");
});

test("ward: standing on the stone does not spend the night's events", () => {
  // The short-circuit is before the draw, not a discard after it. Two nights on
  // one seed that differ only in whether the player stood on the ward have to
  // stay in step, or the ward would quietly re-roll everything downstream.
  const a = game({ seed: 9 });
  const b = game({ seed: 9 });
  for (let i = 0; i < 5; i++) E.drawEvent(b, { warded: true });
  eq(E.drawEvent(a).t, E.drawEvent(b).t, "five warded turns cost the stream nothing");
});

// The user's ruling on #28's escalation: 擋. The stone stops 破牆 as well as the
// event, so the corner it makes is not a trap.
//
// This is the whole of what the ruling changed, and it is worth pinning both
// ways rather than only the new half — the breach still has to reach every
// OTHER dead end, or "safety is a place you travel to" would have quietly
// become "dead ends are safe".
test("ward: the breach does not reach the stone, and still reaches everywhere else", () => {
  const at = (band) => { const s = game({ seed: 1 }); E.setTurn(s, band); return s; };
  for (const [turn, count] of [[1, 3], [11, 4], [21, 5]]) {
    const s = at(turn);
    eq(E.breachAfterEvent(s, { deadEnd: true }), count, `an ordinary corner in band ${s.hour}`);
    eq(E.breachAfterEvent(s, { deadEnd: true, warded: true }), 0, "but never on the stone");
  }
});

test("ward: being warded is not the same as not being a dead end", () => {
  // The distinction matters to the board rather than to the engine: the hole
  // still opens on a warded dead end, because a run that cannot leave is stuck
  // whatever the stone does. What the ward changes is what comes through it.
  const s = game({ seed: 1 });
  E.setTurn(s, 21);
  eq(E.breachAfterEvent(s, { deadEnd: true, warded: true }), 0);
  eq(E.breachAfterEvent(s, { deadEnd: false, warded: false }), 0);
  eq(E.breachAfterEvent(s, { deadEnd: true, warded: false }), 5, "eleven o'clock, unwarded");
  // Fleeing still wins on its own, warded or not — two reasons for zero are
  // not a conflict.
  eq(E.breachAfterEvent(s, { deadEnd: true, fled: true, warded: true }), 0);
});

test("ward: the King is not turned by it — only running water declines him", () => {
  // §the amendment: the stone stops what walks the road, not what keeps the
  // appointment. Standing there at midnight is still a meeting.
  const s = game({ seed: 3 });
  E.setTurn(s, E.RULES.TOTAL_TURNS);
  const r = E.midnight(s, { runningWater: false, use: {} });
  eq(r.outcome, "LOSS_KING", "bare-handed on the stone is still bare-handed");

  const w = game({ seed: 3 });
  E.setTurn(w, E.RULES.TOTAL_TURNS);
  eq(E.midnight(w, { runningWater: true, use: {} }).outcome, "SURVIVED",
     "and water is still the only thing that declines him");
});

// ---- Card resolution -------------------------------------------------------

// ---- Searching ---------------------------------------------------------------
// The tables live in search.json and the DoD numbers come from them, so these
// load the real file rather than a fixture: a re-cut of the weights should
// break the arithmetic here loudly rather than pass against a stale copy.

test("search: a weighted pick is proportional and spends one draw", () => {
  const rng = E.makeRng(4242);
  const table = [{ id: "a", p: 70 }, { id: "b", p: 30 }];
  const seen = { a: 0, b: 0 };
  for (let i = 0; i < 4000; i++) seen[E.weightedPick(table, rng).id]++;
  // 4000 draws off a fixed seed: deterministic, so this is an exact check of
  // the split rather than a flaky one.
  assert(seen.a > 2600 && seen.a < 3000, `70% should land near 2800, got ${seen.a}`);
  eq(seen.a + seen.b, 4000, "every draw returned something");
});

test("search: null in a table is a real result — you found nothing", () => {
  const s = game({ seed: 1 });
  const rng = E.makeRng(7);
  const nothing = E.weightedPick([{ id: null, p: 100 }], rng);
  eq(nothing.id, null);
  s.searchTables = { empty: [{ id: null, p: 100 }] };
  eq(E.search(s, "empty").result, "NOTHING");
});

// THE DoD NUMBER. A weapon search misses 10% of the time with no swords and
// 85% with three, and nothing in the code says so — it falls out of the table
// once "a unique you already hold finds nothing" is applied. That escalation is
// what stops weapon searching being a treadmill.
// 10 -> 35 -> 60 -> 85 is the mechanic that makes weapon rooms dry out: every
// blade spoken for raises the chance the next rummage hands back a room you
// have already looted.
//
// #31 nearly killed it — one weapon in hand meant the miss stopped at 35 and a
// weapon table stayed 65 % productive all night. #36's ruling restores it by
// changing what "spoken for" means: a blade you abandoned at a replace is lying
// on some floor, not circulating. So the curve is back, and it climbs through
// weapons that PASSED THROUGH your hands rather than weapons you still hold.
test("search: the weapon miss climbs 15 -> 40 -> 65 -> 90 as blades pass through", () => {
  const s = game({ seed: 1 });
  const at = () => Math.round(E.missChance(s, "weapon"));
  // The floor is the table's own blank, which went 10 -> 15 when 七星劍 dropped
  // to 10 %: the five points came off the sword and went to finding nothing.
  eq(at(), 15, "bare-handed: only the table's own null");

  E.pickUpItem(s, "precept-knife");
  eq(at(), 40, "one sword: its 25 now finds nothing");

  // Swap it away. The knife is on a floor somewhere and never comes back, so
  // two blades are out of the night while only one is in hand.
  E.replaceWeapon(s, "peachwood-sword");
  eq(at(), 65, "two — the one held and the one left behind");

  // And refusing counts the same: it was offered at a decision and declined.
  E.declineWeapon(s, "coin-sword");
  eq(at(), 90, "three — only 七星劍 is still worth turning over, at one in ten");
});

test("search: a unique already held returns nothing, and does not duplicate", () => {
  const s = game({ seed: 1 });
  // The banner rather than a sword: a unique that still lives in the pack, so
  // this tests the duplicate rule rather than the hands.
  s.searchTables = { only: [{ id: "soul-banner", p: 100 }] };
  eq(E.search(s, "only").result, "TOOK");
  eq(E.heldCount(s, "soul-banner"), 1);
  const again = E.search(s, "only");
  eq(again.result, "NOTHING");
  eq(again.reason, "duplicate");
  eq(E.heldCount(s, "soul-banner"), 1, "still exactly one");
});

// Rice is not unique, so a second one is a real find — the duplicate rule is
// scoped to `unique` and must not leak into everything else.
test("search: a non-unique can be found again", () => {
  const s = game({ seed: 1 });
  s.searchTables = { only: [{ id: "sticky-rice", p: 100 }] };
  eq(E.search(s, "only").result, "TOOK");
  eq(E.heldCount(s, "sticky-rice"), 4, "a fourth rice on top of the starting three");
});

test("search: a full pack offers a drop rather than silently losing the find", () => {
  const s = game({ seed: 1 }); // 3 rice
  E.pickUpItem(s, "soul-banner");
  E.pickUpItem(s, "black-dog-blood");
  E.pickUpItem(s, "truefire-talisman");
  eq(E.slotsUsed(s), 6, "full");

  s.searchTables = { only: [{ id: "golden-elixir", p: 100 }] };
  const r = E.search(s, "only");
  eq(r.result, "OFFER_DROP");
  eq(r.id, "golden-elixir");
  eq(E.held(s, "golden-elixir"), false, "not taken behind the player's back");

  // The offer is finished through the same door every other pickup uses.
  eq(E.pickUpItem(s, r.id, "sticky-rice").ok, true);
  eq(E.held(s, "golden-elixir"), true);
  eq(E.slotsUsed(s), 6);
});

// THE OTHER DoD NUMBER. The search stream is separate so that a shared seed
// finds the same things whatever else happened — this drives the game's own rng
// and every presentation stream hard in between, and the finds must not move.
test("search: same seed, same finds, however much else is drawn", () => {
  const run = (disturb) => {
    const s = game({ seed: 31 });
    s.searchTables = {
      weapon: [{ id: "precept-knife", p: 25 }, { id: "peachwood-sword", p: 25 },
               { id: "coin-sword", p: 25 }, { id: "sevenstar-sword", p: 15 },
               { id: null, p: 10 }],
    };
    const out = [];
    for (let i = 0; i < 12; i++) {
      if (disturb) {
        for (let k = 0; k < 5; k++) s.rng();
        E.rollPhantom(s, 1);
        E.rollGutter(s, 1);
        E.rollSilentScare(s);
      }
      const r = E.search(s, "weapon");
      out.push(r.result === "TOOK" ? r.id : r.result);
    }
    return out.join(",");
  };
  eq(run(false), run(true), "unrelated draws must not move the search stream");
  eq(run(true), run(true), "and it is deterministic besides");
});

test("search: rolling searches does not disturb the game's own stream", () => {
  const a = game({ seed: 19 });
  const b = game({ seed: 19 });
  a.searchTables = { t: [{ id: "sticky-rice", p: 50 }, { id: null, p: 50 }] };
  for (let i = 0; i < 20; i++) E.search(a, "t");
  eq(a.rng(), b.rng(), "the game stream is where it was");
});

test("search: an unknown table finds nothing rather than throwing", () => {
  const s = game({ seed: 1 });
  eq(E.search(s, "no-such-table").result, "NOTHING");
});

// 金丹 is the one item whose effect is a die roll, and it is rolled from the
// search stream for the same reason the searches are: a shared seed has to
// agree on which half of the elixir you got.
test("golden-elixir: the coin-flip comes off the search stream", () => {
  const outcomes = (seed) => {
    const s = game({ seed });
    const got = [];
    for (let i = 0; i < 6; i++) {
      s.items["golden-elixir"] = 1;
      s.health = 5;
      got.push(E.useMedicine(s, "golden-elixir").healed);
    }
    return got;
  };
  const first = outcomes(88);
  eq(first, outcomes(88), "same seed, same flips");
  for (const h of first) assert(h === 6 || h === -2, `an elixir is +6 or -2, got ${h}`);
  assert(new Set(first).size === 2, "and over six flips it is not always the same face");
});

test("golden-elixir: it is consumed either way, and respects the cap", () => {
  const s = game({ seed: 1 });
  s.items["golden-elixir"] = 1;
  const r = E.useMedicine(s, "golden-elixir");
  eq(E.held(s, "golden-elixir"), false, "drunk, good or bad");
  if (r.healed > 0) eq(s.health, 10, "a good flip cannot exceed the cap");
});

// ---- Attack -------------------------------------------------------------------
// THE DoD TABLE. These five rows are spec §6's worked examples, transcribed
// verbatim, and they are the reason the banner's scope is written down: every
// one of them turns on the banner doubling the sword half and NOT the talisman.
// If someone "simplifies" attack() to double the total, four of these five move.
test("attack: the spec §6 worked examples, all five", () => {
  const kit = (swordId, opts = {}) => {
    const s = game({ seed: 1 });
    E.pickUpItem(s, swordId);
    if (opts.buff) {
      E.pickUpItem(s, "truefire-talisman");
      eq(E.buffSword(s, swordId).ok, true);
    }
    if (opts.banner) E.pickUpItem(s, "soul-banner");
    if (opts.talisman) E.pickUpItem(s, opts.talisman);
    return s;
  };

  // 七星劍 + 真火符 in it, banner, 五雷符 → (3+1) × 2 + 4
  eq(E.attackWith(kit("sevenstar-sword", { buff: true, banner: true, talisman: "fivethunder-talisman" }),
    { banner: true, talisman: "fivethunder-talisman" }), 12);

  // 七星劍 + 真火符 in it, banner, 血符 → (3+1) × 2 + 5
  eq(E.attackWith(kit("sevenstar-sword", { buff: true, banner: true, talisman: "blood-talisman" }),
    { banner: true, talisman: "blood-talisman" }), 13);

  // 銅錢劍 + 真火符 in it, banner, 血符 → (2+1) × 2 + 5
  eq(E.attackWith(kit("coin-sword", { buff: true, banner: true, talisman: "blood-talisman" }),
    { banner: true, talisman: "blood-talisman" }), 11);

  // 七星劍, banner, 五雷符 → 3 × 2 + 4
  eq(E.attackWith(kit("sevenstar-sword", { banner: true, talisman: "fivethunder-talisman" }),
    { banner: true, talisman: "fivethunder-talisman" }), 10);

  // 七星劍 + 真火符, 五雷符, no banner → 4 + 4
  eq(E.attackWith(kit("sevenstar-sword", { buff: true, talisman: "fivethunder-talisman" }),
    { talisman: "fivethunder-talisman" }), 8);
});

test("attack: the banner doubles the sword and never the talisman", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword"); // 2
  E.pickUpItem(s, "fivethunder-talisman"); // 4
  eq(E.attackWith(s, { talisman: "fivethunder-talisman" }), 6, "2 + 4");
  eq(E.attackWith(s, { banner: true, talisman: "fivethunder-talisman" }), 8, "(2×2) + 4, not (2+4)×2");
});

// "The best of several, never summed" was the old rule. There is no several
// now: the blade in the right hand IS the attack, and the second amendment
// swapped choosing between swords for choosing which one to leave behind.
test("attack: the blade in hand is the number, and there is only ever one", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "precept-knife"); // 1
  eq(E.effectiveAttack(s), 1);
  eq(E.equippedWeapon(s), "precept-knife");
  eq(E.heldIds(s).includes("precept-knife"), false, "and it is not in the pack");
  eq(E.slotsUsed(s), 3, "so it costs nothing to carry");

  // A better sword neither stacks nor silently takes over.
  eq(E.pickUpItem(s, "sevenstar-sword").reason, "armed");
  eq(E.effectiveAttack(s), 1, "nothing changes until the player says so");
  E.replaceWeapon(s, "sevenstar-sword");
  eq(E.effectiveAttack(s), 3, "and then it is simply the new blade");
  eq(E.held(s, "precept-knife"), false, "the old one is left behind, not pocketed");
});

// ---- The hands ---------------------------------------------------------------
test("hands: both empty at nine o'clock, and neither is luggage", () => {
  const s = game({ seed: 1 });
  eq(s.hands, { weapon: null, charm: null });
  eq(E.equippedWeapon(s), null);
  eq(E.hasCharm(s), false);
  eq(E.slotsUsed(s), 3, "three rice and nothing else");
  eq(E.freeSlots(s), 3);
});

test("hands: a weapon and the charm cost no slot at all", () => {
  const s = game({ seed: 1 });
  const before = E.slotsUsed(s);
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "protective-charm");
  eq(E.slotsUsed(s), before, "the pack has not noticed either of them");
  eq(E.slotCost(s, "coin-sword"), 0);
  eq(E.slotCost(s, "protective-charm"), 0);
  // And a full pack is no obstacle to either, which is the point of the hands.
  const full = game({ seed: 1 });
  E.pickUpItem(full, "soul-banner");
  E.pickUpItem(full, "black-dog-blood");
  E.pickUpItem(full, "golden-elixir");
  eq(E.slotsUsed(full), 6, "not a slot to spare");
  eq(E.pickUpItem(full, "sevenstar-sword").ok, true, "the hand does not care");
  eq(E.pickUpItem(full, "protective-charm").ok, true);
  eq(E.slotsUsed(full), 6, "and the pack is unchanged");
});

test("hands: the charm equips itself, because there is only one to argue about", () => {
  const s = game({ seed: 1 });
  eq(E.pickUpItem(s, "protective-charm").ok, true);
  eq(E.equippedCharm(s), "protective-charm");
  eq(E.hasCharm(s), true, "and it is working, not sitting in a bag");
  eq(E.heldIds(s).includes("protective-charm"), false, "never in the pack");
  // Combat reads the hand: the charm's point comes off after the clamp.
  eq(E.combatDamage(6, 0, E.hasCharm(s)), 3, "4 clamped, then the charm's one");
});

// The replace door, both ways. The engine offers and does not decide, which is
// the same contract OFFER_DROP has.
test("replace: a weapon found while armed is offered, not taken", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword"); // 2
  s.searchTables = { only: [{ id: "sevenstar-sword", p: 100 }] };
  const r = E.search(s, "only");
  eq(r.result, "OFFER_REPLACE");
  eq(r.id, "sevenstar-sword");
  eq(r.current, "coin-sword");
  eq(r.currentAttack, 2);
  eq(r.incomingAttack, 3, "both numbers, or the choice cannot be made");
  eq(E.equippedWeapon(s), "coin-sword", "and nothing has changed yet");
});

test("replace: taking it leaves the old blade behind for good", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword");
  const r = E.replaceWeapon(s, "sevenstar-sword");
  eq(r.ok, true);
  eq(r.dropped, "coin-sword");
  eq(E.equippedWeapon(s), "sevenstar-sword");
  eq(E.held(s, "coin-sword"), false, "it is not in the pack");
  eq(E.heldIds(s).includes("coin-sword"), false);
  eq(E.slotsUsed(s), 3, "and it did not cost a slot on the way out");
});

test("replace: declining changes nothing at all", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "truefire-talisman");
  E.buffSword(s, "sevenstar-sword");
  const before = E.effectiveAttack(s);
  s.searchTables = { only: [{ id: "coin-sword", p: 100 }] };
  const r = E.search(s, "only");
  eq(r.result, "OFFER_REPLACE");
  // Worse steel, and the preview says so — this is the case the numbers exist
  // for, because the buffed blade beats the nominally equal one.
  eq(r.currentAttack, 4);
  eq(r.incomingAttack, 2);
  eq(E.effectiveAttack(s), before, "declining is doing nothing");
  eq(E.equippedWeapon(s), "sevenstar-sword");
});

// #36: whichever blade exits a RESOLVED replace un-held is gone from the night.
// Both sides of the decision, because the ruling covers both and the two exits
// are easy to implement asymmetrically by accident.
test("replace: the blade you put down never turns up again", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword");
  E.replaceWeapon(s, "sevenstar-sword");

  s.searchTables = { only: [{ id: "coin-sword", p: 100 }] };
  for (let i = 0; i < 20; i++) {
    const r = E.search(s, "only");
    eq(r.result, "NOTHING", "the room does not hand back what you left in it");
    eq(r.reason, "abandoned");
  }
  eq(E.held(s, "coin-sword"), false);
  eq(E.outOfPlay(s, "coin-sword"), true);
});

test("replace: the blade you refused never turns up again either", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "sevenstar-sword");
  // Offered a worse blade and keeping ours: the refused one stays on the floor.
  E.declineWeapon(s, "coin-sword");

  s.searchTables = { only: [{ id: "coin-sword", p: 100 }] };
  for (let i = 0; i < 20; i++) eq(E.search(s, "only").reason, "abandoned");
  eq(E.outOfPlay(s, "coin-sword"), true);
});

test("replace: only a resolved decision loses a blade, not the mere offer", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword");
  s.searchTables = { only: [{ id: "sevenstar-sword", p: 100 }] };

  // Being offered it does not spend it — the player has not answered yet, and
  // an unanswered offer that lost the sword would be the engine deciding.
  eq(E.search(s, "only").result, "OFFER_REPLACE");
  eq(E.outOfPlay(s, "sevenstar-sword"), false, "still out there, still findable");
  eq(E.search(s, "only").result, "OFFER_REPLACE", "and offered again");

  // Answering is what spends it.
  E.replaceWeapon(s, "sevenstar-sword");
  eq(E.outOfPlay(s, "coin-sword"), true, "the one that left");
  eq(E.outOfPlay(s, "sevenstar-sword"), true, "and the one in hand, for the same reason as ever");
});

test("replace: declining refuses to throw away the blade in your hand", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword");
  const r = E.declineWeapon(s, "coin-sword");
  eq(r.ok, false);
  eq(r.reason, "in-hand", "you cannot decline what you are holding");
  eq(E.outOfPlay(s, "coin-sword"), true, "it is out of play by being held, not by being lost");
  eq(E.equippedWeapon(s), "coin-sword", "and it is still in your hand");
});

test("replace: the 真火符 burned into a blade goes with it", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword"); // 2
  E.pickUpItem(s, "truefire-talisman");
  E.buffSword(s, "coin-sword");
  eq(E.effectiveAttack(s), 3, "2 + 1, burned in");

  // 七星劍 is nominally better, and taking it costs the fire in the old blade.
  E.replaceWeapon(s, "sevenstar-sword");
  eq(E.effectiveAttack(s), 3, "3 bare — the burned point stayed with the steel");
  eq(!!s.buffed["coin-sword"], false, "and the old blade's fire is forgotten");

  // Which means the new blade can be burned in its own right, once.
  E.pickUpItem(s, "truefire-talisman");
  eq(E.buffSword(s, "sevenstar-sword").ok, true);
  eq(E.effectiveAttack(s), 4, "the ceiling, reached the long way round");
});

test("attack: bare-handed is zero", () => {
  const s = game({ seed: 1 });
  eq(E.effectiveAttack(s), 0);
  eq(E.attackWith(s, {}), 0);
  eq(E.attackWith(s, { banner: true }), 0, "twice nothing is still nothing");
});

test("buffSword: permanent, one per sword, and it can shift which sword is best", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword"); // 2
  E.pickUpItem(s, "truefire-talisman");
  eq(E.buffSword(s, "coin-sword").ok, true);
  eq(E.swordAttack(s, "coin-sword"), 3, "2 + 1, permanently");
  eq(E.held(s, "truefire-talisman"), false, "the talisman is spent");

  E.pickUpItem(s, "truefire-talisman");
  const twice = E.buffSword(s, "coin-sword");
  eq(twice.ok, false);
  eq(twice.reason, "already-buffed", "one 真火符 per sword — the ceiling is real");
  eq(E.heldCount(s, "truefire-talisman"), 1, "and a refused buff spends nothing");
});

test("buffSword: the ceiling is 七星劍 + 1 = 4", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "truefire-talisman");
  E.buffSword(s, "sevenstar-sword");
  eq(E.effectiveAttack(s), 4, "the highest a sword can ever read");
});

test("buffSword: refuses what is not a held sword", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "truefire-talisman");
  eq(E.buffSword(s, "coin-sword").reason, "not-held");
  eq(E.buffSword(s, "sticky-rice").reason, "not-a-sword");
});

// ---- Damage --------------------------------------------------------------------
test("damage: clamped to [0,4], then the charm", () => {
  eq(E.combatDamage(3, 0), 3);
  eq(E.combatDamage(9, 0), 4, "clamped at four");
  eq(E.combatDamage(2, 5), 0, "never negative, never a heal");
  eq(E.combatDamage(9, 0, true), 3, "the charm takes its point AFTER the clamp");
  eq(E.combatDamage(1, 1, true), 0, "and cannot push it below zero");
});

// The charm's scope is the whole point of it being sayable in one line.
test("charm: combat only — not HP events, not poison, not the flee cost", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "protective-charm");

  s.health = 10;
  E.resolveEvent(s, { t: "HP", hp: -1 });
  eq(s.health, 9, "an HP event is not a wound the charm can soften");

  E.poison(s);
  E.poisonTick(s);
  eq(s.health, 8, "nor is poison");

  E.flee(s);
  eq(s.health, 7, "nor is the price of running");

  E.resolveCombat(s, 4); // attack 0 -> 4, charm -> 3
  eq(s.health, 4, "but a claw hits softer");
});

// ---- Fighting ------------------------------------------------------------------
test("resolveCombat: spends the banner and the talisman, and only on use", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "soul-banner");
  E.pickUpItem(s, "fivethunder-talisman");

  // Asking what it would come to spends nothing.
  eq(E.attackWith(s, { banner: true, talisman: "fivethunder-talisman" }), 10);
  eq(E.held(s, "soul-banner"), true, "still in the pack while you decide");

  const r = E.resolveCombat(s, 6, { banner: true, talisman: "fivethunder-talisman" });
  eq(r.attack, 10);
  eq(r.damage, 0, "six against ten is nothing");
  eq(E.held(s, "soul-banner"), false, "the banner is one use");
  eq(E.held(s, "fivethunder-talisman"), false, "and the talisman is thrown");
  eq(E.held(s, "sevenstar-sword"), true, "the sword stays");
});

test("resolveCombat: 血符 costs a point of your own blood", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "blood-talisman");
  s.health = 8;
  const r = E.resolveCombat(s, 5, { talisman: "blood-talisman" });
  eq(r.attack, 5, "bare-handed 0 + the talisman's 5");
  eq(r.damage, 0);
  eq(s.health, 7, "one paid for writing it");
});

test("resolveCombat: 血符 can kill the person writing it", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "blood-talisman");
  s.health = 1;
  const r = E.resolveCombat(s, 3, { talisman: "blood-talisman" });
  eq(s.status, "lost");
  eq(r.diedPaying, true, "the fight never happened");
});

test("resolveCombat: a lethal pack ends the run with reason combat", () => {
  const s = game({ seed: 1 });
  s.health = 3;
  E.resolveCombat(s, 6);
  eq(s.health, 0);
  eq(s.lossReason, "combat");
});

// ---- Getting out ---------------------------------------------------------------
test("escape: 黑狗血 costs nothing and is consumed", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "black-dog-blood");
  s.health = 6;
  eq(E.escapeFight(s).ok, true);
  eq(s.health, 6, "no damage at all — strictly better than running");
  eq(E.held(s, "black-dog-blood"), false);
  eq(s.fled, true, "and you are not standing here any more");
});

test("escape: the blood buys nothing from the King", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "black-dog-blood");
  const r = E.escapeFight(s, { vsKing: true });
  eq(r.ok, false);
  eq(r.reason, "not-vs-king");
  eq(E.held(s, "black-dog-blood"), true, "and a refused escape spends nothing");
});

test("flee: one point, and it marks you as gone", () => {
  const s = game({ seed: 1 });
  E.flee(s);
  eq(s.health, 9);
  eq(s.fled, true);
});

test("flee: the mark clears at the top of the next turn", () => {
  const s = game({ seed: 1 });
  E.flee(s);
  eq(s.fled, true);
  E.beginTurn(s);
  eq(s.fled, false, "cleared then, so the turn that set it can still see it");
});

// ---- Events ---------------------------------------------------------------------
test("events: drawn with replacement, from their own stream", () => {
  const run = (disturb) => {
    const s = game({ seed: 55 });
    const out = [];
    for (let i = 0; i < 25; i++) {
      if (disturb) {
        for (let k = 0; k < 4; k++) s.rng();
        s.searchTables = { t: [{ id: "sticky-rice", p: 100 }] };
        E.search(s, "t");
        E.rollPhantom(s, 1);
      }
      const ev = E.drawEvent(s);
      out.push(ev.t + (ev.n || ""));
    }
    return out.join(",");
  };
  const plain = run(false);
  eq(plain, run(true), "searches and unrelated draws must not move the event stream");
  // With replacement: over 25 draws from a 7-row table something must repeat.
  const seen = plain.split(",");
  assert(new Set(seen).size < seen.length, "a distribution repeats; a deck would not");
});

test("events: each band draws only what that band holds", () => {
  const s = game({ seed: 5 });
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(E.drawEvent(s).t);
  assert(seen.has("JIANGSHI") && seen.has("NOTHING"), "the common ones show up");
  E.setTurn(s, 21); // eleven o'clock
  const late = new Set();
  for (let i = 0; i < 300; i++) late.add(E.drawEvent(s).t);
  assert(!late.has("HP_GAIN"), "no such type exists");
  const gains = [];
  for (let i = 0; i < 300; i++) { const e = E.drawEvent(s); if (e.t === "HP" && e.hp > 0) gains.push(e); }
  eq(gains.length, 0, "the eleven o'clock band has no +1 HP in it at all");
});

test("events: HP, POISON and NOTHING resolve; a fight is handed back", () => {
  const s = game({ seed: 1 });
  s.health = 5;
  eq(E.resolveEvent(s, { t: "HP", hp: 1 }).hp, 1);
  eq(s.health, 6);
  eq(E.resolveEvent(s, { t: "POISON" }).type, "POISON");
  eq(s.poisoned, true);
  eq(E.resolveEvent(s, { t: "NOTHING" }).type, "NOTHING");
  const fight = E.resolveEvent(s, { t: "JIANGSHI", n: 4 });
  eq(fight, { type: "FIGHT", n: 4 }, "a fight is a decision, not arithmetic");
});

test("events: HP respects the cap", () => {
  const s = game({ seed: 1 });
  E.resolveEvent(s, { t: "HP", hp: 1 });
  eq(s.health, 10, "already full");
});

// ---- The villager ----------------------------------------------------------------
// Both paths, per the DoD — and the charm has no other source in the game.
test("villager: rice buys the gift", () => {
  const s = game({ seed: 1 });
  const ev = { t: "VILLAGER", gift: "protective-charm", turnsInto: 4 };
  const r = E.resolveEvent(s, ev, { giveRice: true });
  eq(r.type, "GIFT");
  eq(r.id, "protective-charm");
  eq(E.held(s, "protective-charm"), true);
  eq(E.heldCount(s, "sticky-rice"), 2, "one rice given away");
});

test("villager: refusing leaves you with what was chasing them", () => {
  const s = game({ seed: 1 });
  const ev = { t: "VILLAGER", gift: "protective-charm", turnsInto: 4 };
  const r = E.resolveEvent(s, ev, { giveRice: false });
  eq(r, { type: "FIGHT", n: 4, refused: true });
  eq(E.heldCount(s, "sticky-rice"), 3, "the rice is still yours");
});

test("villager: no rice means no choice", () => {
  const s = game({ seed: 1 });
  E.dropItem(s, "sticky-rice", 3);
  const r = E.resolveEvent(s, { t: "VILLAGER", gift: "truefire-talisman", turnsInto: 5 }, { giveRice: true });
  eq(r.type, "FIGHT", "willing is not the same as able");
  eq(r.n, 5);
});

// Worth pinning, because it is the reason the villager needs no full-pack
// branch at all: the rice you give away IS the room the gift goes into. One
// slot out (rice never stacks), one slot in. It cannot fail to fit.
// The charm's gift used to be a slot argument: the rice you handed over was
// exactly the room the thanks needed. The hands settled it more simply — 護身符
// costs nothing now, so the rice buys a free hand's worth of protection and the
// pack comes back one lighter than it went in.
test("villager: the charm costs a rice and no slot at all", () => {
  const s = game({ seed: 1 }); // 3 rice
  E.pickUpItem(s, "soul-banner");
  E.pickUpItem(s, "black-dog-blood");
  E.pickUpItem(s, "golden-elixir");
  eq(E.slotsUsed(s), 6, "not a slot to spare");
  const r = E.resolveVillager(s, { gift: "protective-charm", turnsInto: 4 }, true);
  eq(r.type, "GIFT");
  eq(E.held(s, "protective-charm"), true);
  eq(E.hasCharm(s), true, "worn, not carried");
  eq(E.heldCount(s, "sticky-rice"), 2, "one rice out");
  eq(E.slotsUsed(s), 5, "and nothing came back to replace it");
});

test("villager: the charm comes from nowhere else in the game", async () => {
  // Belt and braces against a future re-cut quietly adding it to a table.
  const inTables = Object.values(search).some((t) => t.some((e) => e.id === "protective-charm"));
  eq(inTables, false, "護身符 is a gift, never a find");
  const gifts = Object.values(events).flatMap((t) => t.filter((e) => e.t === "VILLAGER").map((e) => e.gift));
  assert(gifts.includes("protective-charm"), "and the 9 PM villager is the one who gives it");
});

// ---- 破牆 --------------------------------------------------------------------------
test("breach: three at nine, four at ten, five at eleven", () => {
  const s = game({ seed: 1 });
  eq(E.breachCount(s), 3);
  E.setTurn(s, 11);
  eq(E.breachCount(s), 4);
  E.setTurn(s, 21);
  eq(E.breachCount(s), 5);
});

// THE ORDERING, per §8: the breach is checked AFTER the room's own event, and
// only if you are still standing in the dead end.
test("breach: fires after the room's event, in a dead end", () => {
  const s = game({ seed: 1 });
  eq(E.breachAfterEvent(s, { deadEnd: true }), 3, "a corner at nine o'clock");
  eq(E.breachAfterEvent(s, { deadEnd: false }), 0, "a room with a way on is safe");
  eq(E.breachAfterEvent(s, { deadEnd: true, warded: true }), 0, "and 石敢當's walls hold");
});

test("breach: fleeing the room's event cancels it — you are not there any more", () => {
  const s = game({ seed: 1 });
  eq(E.breachAfterEvent(s, { deadEnd: true, fled: true }), 0, "passed explicitly");
  E.flee(s);
  eq(E.breachAfterEvent(s, { deadEnd: true }), 0, "and read off state.fled");
});

test("breach: nothing comes through for a run already over", () => {
  const s = game({ seed: 1 });
  s.status = "lost";
  eq(E.breachAfterEvent(s, { deadEnd: true }), 0);
});

// The §8 edge case, spelled out: a dead-end goal room can be three fights in one
// turn, and none of it is a bug.
test("breach: a dead-end goal room is legal as three fights in one turn", () => {
  const s = game({ seed: 1 });
  E.setTurn(s, 21); // eleven o'clock, the worst of it
  s.health = 10;
  E.resolveCombat(s, 5); // the room's own event
  E.resolveCombat(s, 5); // the rite's extra event (the rite itself is #5)
  const n = E.breachAfterEvent(s, { deadEnd: true });
  eq(n, 5, "and then the wall goes");
  assert(s.status === "lost" || s.health < 10, "it costs what it costs");
});

// ---- The five endings ----------------------------------------------------------
// There is NO LOSS TO THE CLOCK. Reaching midnight is not failure — it is the
// appointment, and what happens there decides it. These five are the whole set.

// A kit that reaches 12: 七星劍 + 真火符 + banner + 五雷符 → (3+1)×2 + 4.
// The only kit that wins, and it needs his name as well. 七星劍 3, a 真火符
// burned in for 4, doubled to 8 by 攝魂幡, plus 血符 5 — thirteen exactly,
// against a bar of thirteen that only the 神主牌 brings within reach.
function sealKit(s) {
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "truefire-talisman");
  E.buffSword(s, "sevenstar-sword");
  E.pickUpItem(s, "soul-banner");
  E.pickUpItem(s, "blood-talisman");
  s.tablet = true;
  return { banner: true, talisman: "blood-talisman" };
}

test("outcome: WIN_BURIAL — survive the rite holding the tablet", () => {
  const s = game({ seed: 1 });
  E.completeRite(s, "TAKE_TABLET");
  eq(s.tablet, true);
  const r = E.completeRite(s, "BURY_TABLET");
  eq(r.outcome, "WIN_BURIAL");
  eq(s.outcome, "WIN_BURIAL");
  eq(s.status, "won");
});

test("outcome: WIN_SEAL — meet him at the threshold, carrying his name", () => {
  const s = game({ seed: 1 });
  const use = sealKit(s);
  const r = E.midnight(s, { use });
  eq(r.attack, 13);
  eq(r.threshold, E.RULES.KING_THRESHOLD_WITH_TABLET);
  eq(r.outcome, "WIN_SEAL");
  eq(s.status, "won");
});

// The other half of the same rule, and the reason the bar sits above the
// ceiling: the identical kit without the 神主牌 is not a near miss, it is not a
// line at all.
test("outcome: the same kit without the tablet cannot win", () => {
  const s = game({ seed: 1 });
  const use = sealKit(s);
  s.tablet = false;
  const r = E.midnight(s, { use });
  eq(r.attack, 13, "the best the game can produce");
  eq(r.threshold, E.RULES.KING_THRESHOLD);
  eq(r.outcome, "LOSS_KING");
  assert(r.attack < r.threshold, "and it is short, by construction rather than by luck");
});

test("outcome: SURVIVED — running water, and no exchange at all", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "soul-banner");
  const r = E.midnight(s, { runningWater: true, use: { banner: true } });
  eq(r.outcome, "SURVIVED");
  eq(s.status, "over", "neither a win nor a loss");
  eq(E.held(s, "soul-banner"), true, "nothing was spent — he never came");
});

test("outcome: LOSS_HEALTH — from a fight, an event, or a poison tick", () => {
  const byFight = game({ seed: 1 });
  byFight.health = 2;
  E.resolveCombat(byFight, 6);
  eq(byFight.outcome, "LOSS_HEALTH");

  const byEvent = game({ seed: 1 });
  byEvent.health = 1;
  E.resolveEvent(byEvent, { t: "HP", hp: -1 });
  eq(byEvent.outcome, "LOSS_HEALTH");

  const byPoison = game({ seed: 1 });
  byPoison.health = 1;
  E.poison(byPoison);
  E.beginTurn(byPoison);
  eq(byPoison.outcome, "LOSS_HEALTH", "all three roads meet here");
});

test("outcome: LOSS_KING — turn 30 resolves under the threshold", () => {
  const s = game({ seed: 1 });
  const r = E.midnight(s, {});
  eq(r.attack, 0, "bare-handed");
  eq(r.threshold, E.RULES.KING_THRESHOLD);
  eq(r.outcome, "LOSS_KING");
  eq(s.status, "lost");
});

test("outcome: there is no loss to the clock", () => {
  const s = game({ seed: 1 });
  for (let i = 0; i < 29; i++) E.advanceTurn(s);
  eq(s.turn, 30);
  eq(s.status, "playing", "turn thirty is a turn like any other");
  // Only meeting him ends it, one way or the other.
  E.midnight(s, {});
  eq(s.outcome, "LOSS_KING");
});

test("outcome: the first ending is the ending", () => {
  const s = game({ seed: 1 });
  E.completeRite(s, "TAKE_TABLET");
  E.completeRite(s, "BURY_TABLET");
  eq(s.outcome, "WIN_BURIAL");
  E.midnight(s, {}); // he never gets a turn
  eq(s.outcome, "WIN_BURIAL", "a won run cannot be lost afterwards");
});

// ---- The threshold ---------------------------------------------------------------
// The DoD asks for both sides of it, and this is the tablet's second job: a
// burial run that fails still leaves you one better off than never going.
test("midnight: the tablet is what brings the bar within reach at all", () => {
  const without = game({ seed: 1 });
  eq(E.kingThreshold(without), E.RULES.KING_THRESHOLD);
  const with_ = game({ seed: 1 });
  with_.tablet = true;
  eq(E.kingThreshold(with_), E.RULES.KING_THRESHOLD_WITH_TABLET);
  eq(E.kingThreshold(without) - E.kingThreshold(with_), 1, "still one, as it always was");
});

// The same pair of runs the old "eleven seals him" test made, moved up to the
// only numbers that still do it: 七星劍 with a 真火符 burned in, doubled, plus
// 血符 — thirteen, which is both the game's ceiling and the tablet's bar.
test("midnight: thirteen seals him with the tablet and fails without it", () => {
  const kit = (s) => {
    E.pickUpItem(s, "sevenstar-sword");
    E.pickUpItem(s, "truefire-talisman");
    E.buffSword(s, "sevenstar-sword");
    E.pickUpItem(s, "soul-banner");
    E.pickUpItem(s, "blood-talisman");
    return { banner: true, talisman: "blood-talisman" };
  };
  const bare = game({ seed: 1 });
  const r1 = E.midnight(bare, { use: kit(bare) });
  eq(r1.attack, 13);
  eq(r1.outcome, "LOSS_KING", "the ceiling is still short of a bar set above it");

  const carrying = game({ seed: 1 });
  carrying.tablet = true;
  const r2 = E.midnight(carrying, { use: kit(carrying) });
  eq(r2.attack, 13);
  eq(r2.threshold, E.RULES.KING_THRESHOLD_WITH_TABLET);
  eq(r2.outcome, "WIN_SEAL", "the same thirteen, and now it is enough");
});

test("midnight: every winning line spends the banner", () => {
  const s = game({ seed: 1 });
  const use = sealKit(s);
  E.midnight(s, { use });
  eq(E.held(s, "soul-banner"), false, "攝魂幡 is the one compulsory item");
});

test("midnight: the kit is spent even when it falls short", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "soul-banner");
  const r = E.midnight(s, { use: { banner: true } });
  eq(r.outcome, "LOSS_KING");
  eq(E.held(s, "soul-banner"), false, "bringing it and falling short is still bringing it");
});

test("midnight: 血符 can kill you on the doorstep, and then you never struck", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "blood-talisman");
  s.health = 1;
  const r = E.midnight(s, { use: { talisman: "blood-talisman" } });
  eq(r.diedPaying, true);
  eq(s.outcome, "LOSS_HEALTH", "not LOSS_KING — he never got the chance");
});

// The numbers exist so the verdict card of a player killed at midnight can show
// them. That one line is the whole discovery mechanism for the hidden ending.
test("midnight: the loss carries the numbers the verdict card needs", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "coin-sword");
  const r = E.midnight(s, {});
  eq(r.attack, 2, "what you brought");
  eq(r.threshold, E.RULES.KING_THRESHOLD, "what was needed");
});

// ---- The rites ---------------------------------------------------------------------
test("rite: fleeing the rite's event aborts it, and you may come back", () => {
  const s = game({ seed: 1 });
  E.flee(s); // fled the extra event
  const aborted = E.completeRite(s, "TAKE_TABLET");
  eq(aborted.ok, false);
  eq(aborted.reason, "fled");
  eq(s.tablet, false, "nothing taken");

  E.beginTurn(s); // a later turn, standing there again
  eq(E.completeRite(s, "TAKE_TABLET").ok, true);
  eq(s.tablet, true, "the retry works");
});

test("rite: no burial without the tablet, and no extra event either", () => {
  const s = game({ seed: 1 });
  eq(E.riteDraws(s, "BURY_TABLET"), false, "nothing to bury, so nothing is drawn");
  const r = E.completeRite(s, "BURY_TABLET");
  eq(r.ok, false);
  eq(r.reason, "no-tablet");
  eq(s.status, "playing");
});

test("rite: the crypt stops drawing once the tablet is yours", () => {
  const s = game({ seed: 1 });
  eq(E.riteDraws(s, "TAKE_TABLET"), true);
  E.completeRite(s, "TAKE_TABLET");
  eq(E.riteDraws(s, "TAKE_TABLET"), false, "an empty coffin costs you nothing");
  eq(E.completeRite(s, "TAKE_TABLET").reason, "already-held");
});

test("rite: the extra event comes off the event stream, in band", () => {
  const s = game({ seed: 9 });
  const ev = E.riteEvent(s);
  assert(ev && ev.t, "a real event");
  const b = game({ seed: 9 });
  eq(E.riteEvent(b).t, ev.t, "same seed, same rite");
});

// The §8 edge case the DoD names: a dead-end goal room is three fights in one
// turn, and none of it is a bug.
test("rite: a dead-end goal room can be three fights in one turn", () => {
  const s = game({ seed: 1 });
  E.setTurn(s, 21); // eleven o'clock
  s.health = 10;
  s.tablet = true;
  E.resolveCombat(s, 4); // 1. the room's own event
  E.resolveCombat(s, 4); // 2. the rite's extra event
  const breach = E.breachAfterEvent(s, { deadEnd: true });
  eq(breach, 5, "3. and then the wall goes");
  if (s.status === "playing") E.resolveCombat(s, breach);
  assert(s.health < 10, "it costs what it costs, and it is legal");
});

// ---- 硃砂 -----------------------------------------------------------------------
// Paint a charm twice and it works twice. It copies what is in the pack, which
// is what keeps it from being a wish: it cannot conjure a talisman you never
// found, and it cannot reach a sword.
test("cinnabar: doubles a talisman you hold, and costs no slot", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "fivethunder-talisman");
  E.pickUpItem(s, "cinnabar");
  const before = E.slotsUsed(s);

  const r = E.useCinnabar(s, "fivethunder-talisman");
  eq(r.ok, true);
  eq(r.added, 2, "n from the item definition, not a literal here");
  eq(E.heldCount(s, "fivethunder-talisman"), 3, "one held, two painted");
  eq(E.held(s, "cinnabar"), false, "the mineral is used up");
  eq(E.slotsUsed(s), before - 1, "and the deeper stack is still one slot — the cinnabar's own slot is what freed up");
});

test("cinnabar: a stack of any size stays one slot", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "blood-talisman");
  eq(E.slotsUsed(s), 4, "3 rice + 1 talisman");
  for (let i = 0; i < 3; i++) {
    E.pickUpItem(s, "cinnabar");
    E.useCinnabar(s, "blood-talisman");
  }
  eq(E.heldCount(s, "blood-talisman"), 7, "1 + 2 + 2 + 2");
  eq(E.slotsUsed(s), 4, "seven deep and still one slot");
});

test("cinnabar: refuses a talisman you hold none of", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "cinnabar");
  const r = E.useCinnabar(s, "fivethunder-talisman");
  eq(r.ok, false);
  eq(r.reason, "not-held", "zero of something is not something");
  eq(E.held(s, "cinnabar"), true, "and a refused use spends nothing");
});

test("cinnabar: refuses anything that is not a talisman", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "cinnabar");
  E.pickUpItem(s, "sevenstar-sword");
  eq(E.useCinnabar(s, "sevenstar-sword").reason, "not-a-talisman", "it cannot reach a sword");
  eq(E.useCinnabar(s, "sticky-rice").reason, "not-a-talisman", "nor the rice you are holding three of");
  eq(E.useCinnabar(s, "cinnabar").reason, "not-itself", "nor itself");
  eq(E.held(s, "cinnabar"), true);
});

test("cinnabar: needs cinnabar", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "blood-talisman");
  eq(E.useCinnabar(s, "blood-talisman").reason, "no-cinnabar");
});

// The sword cap is a fact about the SWORD, so multiplying pack contents cannot
// touch it. Worth pinning because "paint it twice" invites exactly that guess.
test("cinnabar: cannot push a sword past one 真火符", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "sevenstar-sword");
  E.pickUpItem(s, "truefire-talisman");
  E.pickUpItem(s, "cinnabar");
  E.useCinnabar(s, "truefire-talisman");
  eq(E.heldCount(s, "truefire-talisman"), 3, "three charms in the pack");

  eq(E.buffSword(s, "sevenstar-sword").ok, true);
  eq(E.swordAttack(s, "sevenstar-sword"), 4, "3 + 1");
  eq(E.buffSword(s, "sevenstar-sword").reason, "already-buffed");
  eq(E.swordAttack(s, "sevenstar-sword"), 4, "still four — the ceiling is the sword's, not the pack's");
  eq(E.heldCount(s, "truefire-talisman"), 2, "and the spare charms are still spare");
});
