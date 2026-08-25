// The verdict card — the screen a player screenshots and sends to somebody.
//
// This suite exists because that screen had NO COVERAGE AT ALL and was shipping
// three false statements, found by playing one night rather than by measuring
// anything (#66, seed 4242, tools/one-night-4242.md):
//
//   "nothing in your hands"      — while holding 七星劍, attack 3
//   "0 of the jiangshi put down" — after six won fights
//   "1 item found"               — after finding four
//
// Every one was invisible to 280 tests and to thousands of bot runs, because
// the bots call the engine and read `outcome` and nobody ever rendered the
// ending. Engine invariants cannot catch a counter that is printed but never
// incremented. Only reading the screen can, so this reads the screen.

import * as E from "../js/engine.js";
import { createBoard } from "../js/board.js";
import { epilogue } from "../js/epilogue.js";
import { test, assert, eq, suite } from "./harness.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "7ddcd36f");

const NO_STORE = { cache: "no-store" };

const [items, search, events, tiles, theme] = await Promise.all([
  fetch("../data/items.json", NO_STORE).then((r) => r.json()),
  fetch("../data/search.json", NO_STORE).then((r) => r.json()),
  fetch("../data/events.json", NO_STORE).then((r) => r.json()),
  fetch("../data/tiles.json", NO_STORE).then((r) => r.json()),
  fetch("../data/theme.json", NO_STORE).then((r) => r.json()),
]);
const DATA = { items, search, events, tiles };

// The controller, reduced to the six things epilogue() actually asks it for.
// Deliberately not a mock of the real class: if the epilogue starts needing a
// seventh thing this should fail loudly rather than quietly answer undefined.
//
// The board is a REAL one rather than a stub. A hand-made {tiles:{}} got as far
// as distanceTo() and threw on a missing `world`, which is the stub telling the
// truth: the epilogue measures how far you got, and that needs a real board to
// measure on. Building one costs a line and removes a whole class of lie.
function stubGame(state) {
  return {
    state,
    board: createBoard(DATA, { seed: 1 }),
    data: { theme, tiles },
    // The id, not a display name. Names live in the theme, not items.json, and
    // what is being tested is whether the epilogue FOUND the blade — not how a
    // skin spells it. Asserting on the id keeps this test about the bug.
    itemName: (id) => id,
    tileName: (id) => id,
    word: (k) => k,
  };
}

function endedHolding(weaponId) {
  const s = E.newGame(DATA, { seed: 1 });
  if (weaponId) {
    E.pickUpItem(s, weaponId);
    assert(E.equippedWeapon(s) === weaponId, "setup: the blade must be in hand");
  }
  s.health = 0;
  s.lossReason = "combat";
  s.status = "lost";
  s.outcome = E.OUTCOMES.LOSS_HEALTH;
  return s;
}

// ---- The sentence ----------------------------------------------------------

// THE #66 DEFECT, in the form it reached a player. bestWeapon walked heldIds
// (the pack) after #31 moved the blade into state.hands, so the one clause the
// sentence must never get wrong was wrong for every armed run in the game.
//
// Behavioural, not a source check: it builds a real state through the real
// engine and reads the real sentence. Reverting bestWeapon to heldIds turns
// this red, which was confirmed by doing it rather than assumed.
test("verdict: a run that ended armed says so", () => {
  const s = endedHolding("sevenstar-sword");
  const said = epilogue(stubGame(s));

  assert(said.includes("sevenstar-sword"),
    "the sentence must name the blade — got: " + said);
  assert(!said.includes(theme.epilogue.hand.bare),
    "held the blade and still said the bare line — got: " + said);
});

// The other direction, which is what makes the test above mean anything: a
// genuinely empty-handed run must still say the bare line. A "fix" that merely
// deleted the phrase would pass the first test and fail this one.
test("verdict: a run that ended bare-handed still says so", () => {
  const s = endedHolding(null);
  const said = epilogue(stubGame(s));
  eq(E.equippedWeapon(s), null, "setup: no blade");
  assert(said.includes(theme.epilogue.hand.bare),
    "empty-handed and did not say so — got: " + said);
});

// Why the bug survived: there are no weapons in the pack AT ALL since #31, so
// heldIds could only ever have returned none of them. Pinned because it is the
// fact that makes "walk the pack for a weapon" not merely wrong but never-right
// — if a blade ever lands in the pack again, whoever puts it there reads this.
test("verdict: the blade is never in the pack, only in the hand", () => {
  const s = endedHolding("sevenstar-sword");
  assert(!E.heldIds(s).includes("sevenstar-sword"),
    "a blade in the pack means bestWeapon's source is a live question again");
  assert(E.carriedIds(s).includes("sevenstar-sword"),
    "carriedIds is the one that can see the hand, which is why the epilogue uses it");
});

// ---- The counters ----------------------------------------------------------
//
// Source assertions, and that is the right shape rather than a compromise: the
// defect was "initialised, printed, incremented NOWHERE", which is a property
// of the text and not of any run. A behavioural test would need the whole game
// page in a DOM and would still only prove it for the paths it happened to walk.
//
// indexOf and split rather than regex, following stage.test.js: a backslash in
// a test file has arrived as a literal control character on this project
// before, and the guards that would use one are exactly the negative assertions
// that then pass silently forever.

const appSrc = await fetch("../js/app.js", NO_STORE).then((r) => r.text());

function noComments(src) {
  return src
    .split("\n")
    .filter((l) => l.trim().slice(0, 2) !== "//")
    .join("\n");
}
const app = noComments(appSrc);

function countOf(hay, needle) {
  return hay.split(needle).length - 1;
}

// THE #66 DEFECT: this counter was initialised at one line, printed at another,
// and incremented at no line anywhere in the repository. Every run that has
// ever ended, won or lost, reported zero.
test("verdict: putDown is actually incremented somewhere", () => {
  assert(countOf(app, "putDown: 0") === 1, "expected the tally to be initialised once");
  assert(countOf(app, "this.tally.putDown +=") >= 1,
    "putDown is printed on the verdict card and incremented nowhere — the #66 bug");
});

// The design ruling on #67: a fight you ran from is not a jiangshi put down.
// True by construction — the increment lives in doFight, and doFlee and
// doEscape do not reach it — so this pins the construction, which is the thing
// that could quietly stop being true.
test("verdict: only fighting counts, and it counts the whole pack", () => {
  const fight = app.indexOf("async doFight(");
  const flee = app.indexOf("async doFlee(");
  const escape = app.indexOf("async doEscape(");
  assert(fight !== -1 && flee !== -1 && escape !== -1, "all three routes must exist");

  const inc = app.indexOf("this.tally.putDown +=");
  assert(inc > fight, "the increment must live inside doFight");
  const nextFn = Math.min.apply(null, [flee, escape].filter((i) => i > fight));
  assert(inc < nextFn, "the increment escaped doFight into a route you ran away down");

  assert(app.indexOf("this.tally.putDown += n") !== -1,
    "a pack of four is four, not one");
});

// THE #66 DEFECT: found counted the tablet and the villager's gift and nothing
// else, so searching — the main verb of the game — never counted. Four finds
// reported as one.
test("verdict: every acquisition route counts the find", () => {
  eq(countOf(app, "noteFound()"), 5,
    "one helper plus four routes: a clean take, a blade swap, a take-after-drop, the villager");
  eq(countOf(app, "this.tally.found +="), 1,
    "found should be incremented in exactly one place, the helper");
});

// The other half of the #67 ruling: the 神主牌 is the object of the night, not
// an item found. It has its own row on the card two lines down, and counting it
// here is what made "1 item found" out of a night with four finds and a tablet.
test("verdict: the tablet is not an item found", () => {
  const take = app.indexOf('goal === "TAKE_TABLET"');
  assert(take !== -1, "the tablet branch must exist");
  const after = app.slice(take, take + 400);
  assert(after.indexOf("noteFound") === -1 && after.indexOf("tally.found") === -1,
    "taking the tablet must not count as an item found");
  assert(after.indexOf("relicFound()") !== -1,
    "it should still be the relic, which has its own line");
});
