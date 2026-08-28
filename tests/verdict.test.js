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
//
// AND THEN THIS SUITE FAILED THE SAME WAY (#95), which is the part worth
// reading before adding to it. #92 moved the card from tally.putDown to
// tally.fights and these tests did not notice: they went on asserting, by
// hardcoded name, that putDown was incremented — true, and irrelevant, because
// nothing printed putDown any more. One of them went further and REQUIRED the
// dead accumulator to survive, with a message arguing for the headcount model
// that #92 had just retired. Green the whole time. The live counter had no
// guard at all.
//
// So nothing below names a counter. The name is read out of the card, and the
// tests follow whatever it prints. A guard that hardcodes the thing it watches
// is a guard that stops watching the day somebody moves it.

import * as E from "../js/engine.js";
import { createBoard } from "../js/board.js";
import { epilogue } from "../js/epilogue.js";
import { test, assert, eq, suite } from "./harness.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "28cfa9f7");

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
test("verdict: no player-visible text is hidden in css content: (#106)", async () => {
  // FOUR ENGLISH STRINGS SHIPPED ON THE CHINESE CARDS, in css `content:` on
  // .verdict-summary::before — "The tale they'll tell", "Here ends the errand",
  // "You lay down at last", "The house keeps its own".
  //
  // They survived every defence this project has, because they are in the one
  // form none of them can see. Not in either theme, so the parity guards had
  // nothing to compare. NOT IN THE DOM, so an innerText sweep finds nothing —
  // a scan of all five rendered cards for Latin text came back clean while the
  // English was plainly visible on screen beside the result.
  //
  // So this asserts the POPULATION rather than those four strings. `content:`
  // with any visible character in it is player-visible copy living in a
  // stylesheet, which is untranslatable by construction. Empty content: "" is
  // the decorative pseudo-element idiom and is what this must not flag.
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  const found = css.match(/content:\s*"[^"]+"/g) || [];
  assert(found.length === 0,
    "player-visible text is in the stylesheet, where no theme can translate it " +
    "and no DOM scan can see it: " + found.join(" | "));
});

test("verdict: the epitaph is real text, in both languages (#106)", async () => {
  // The other half. The population guard above would still pass if the line had
  // been deleted rather than moved, so this asserts it EXISTS, is keyed for
  // every ending, and is translated — which is the thing the user actually saw
  // was wrong.
  const zh = await fetch("../data/theme.zh-TW.json", NO_STORE).then((r) => r.json());
  const en = (theme.verdict || {}).epitaph || {};
  const cn = (zh.verdict || {}).epitaph || {};
  for (const k of ["won", "lost", "health", "midnight"]) {
    assert(en[k], `verdict.epitaph.${k} is missing from the English theme`);
    assert(cn[k], `verdict.epitaph.${k} is missing from the 繁體中文 theme`);
    assert(cn[k] !== en[k],
      `verdict.epitaph.${k} is the same string in both themes — it is the ` +
      `English line still, and that is exactly what #106 was`);
    assert(!/[A-Za-z]{3,}/.test(cn[k]),
      `verdict.epitaph.${k} still contains a Latin word in the 繁體中文 theme: ` + cn[k]);
  }
});

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

// WHICH COUNTER THE CARD PRINTS, READ OUT OF THE CARD (#95).
//
// This used to be the string "this.tally.putDown", written here by hand. #92
// moved the card onto tally.fights — correctly, because n stopped being a
// headcount and summing attack strengths would have made the line lie — and
// this file did not notice. The guard stayed green while watching a variable
// nothing printed any more, and the live one was guarded by nothing at all.
//
// That is the #66 defect one turn of the screw further out: #66 was a counter
// printed and never incremented, and this was a GUARD pointed at a counter
// nobody printed. So the name is derived from the card instead of declared
// here. Move the card to a third counter tomorrow and these tests follow it.
function cardCounter() {
  const at = app.indexOf('verdictLine("put-down"');
  assert(at !== -1, "the verdict card no longer prints a put-down line at all");
  const args = app.slice(at, app.indexOf(")", at));
  const n = args.indexOf("n:");
  assert(n !== -1, "the put-down line takes no n — what is it printing?");
  const expr = args.slice(n + 2).split(",")[0].trim();
  assert(expr.indexOf("this.tally.") === 0,
    "the card prints " + expr + ", which is not a tally counter this can guard");
  return expr;
}

// THE #66 DEFECT: the counter on this line was initialised at one line, printed
// at another, and incremented at no line anywhere in the repository. Every run
// that had ever ended, won or lost, reported zero.
test("verdict: the counter the card prints is actually incremented", () => {
  const counter = cardCounter();
  assert(countOf(app, counter + " +=") >= 1,
    counter + " is printed on the verdict card and incremented nowhere — the #66 bug");
});

// The design ruling on #67: a fight you ran from is not a jiangshi put down.
// True by construction — the increment lives in doFight, and doFlee and
// doEscape do not reach it — so this pins the construction, which is the thing
// that could quietly stop being true.
//
// It no longer pins HOW MUCH. It used to require "+= n" with the message "a
// pack of four is four", which was right when n was a headcount and became a
// demand that the retired model stay in the code: anyone deleting the dead
// accumulator got a red test arguing for a pack. One fight is one creature at
// a strength now, so the size of the step is the card's business, not this
// test's. What must stay true is WHERE it happens.
test("verdict: only fighting counts", () => {
  const counter = cardCounter();
  const fight = app.indexOf("async doFight(");
  const flee = app.indexOf("async doFlee(");
  const escape = app.indexOf("async doEscape(");
  assert(fight !== -1 && flee !== -1 && escape !== -1, "all three routes must exist");

  const inc = app.indexOf(counter + " +=");
  assert(inc > fight, "the increment must live inside doFight");
  const nextFn = Math.min.apply(null, [flee, escape].filter((i) => i > fight));
  assert(inc < nextFn, "the increment escaped doFight into a route you ran away down");
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
