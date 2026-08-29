// The event stage (#33) — the framework's contracts, not the pictures.
//
// Everything here is about the frame: what exists, how long it may take, that
// it always lets go, and that the three ways out stay three separate ways out.
// The scenes themselves are #34's and are deliberately not asserted on beyond
// "it exists and it does not hang" — a test that pinned the placeholder art
// would have to be deleted by the change it is supposed to be protecting.

import { test, assert, eq, skipUnless, suite } from "./harness.js";
import {
  eventStage, kingScene, stageKinds, stageBudgetMs, kingBudgetMs, nightCostMs, BEAT_MS,
  resetStageHints,
} from "../js/eventstage.js";
import { ghostIcon, revealPanel, HINT_TIMES as HINT_BUDGET,
         creaturePanel, clearCreaturePanel, resolveBeat,
         showDropDialog, onPackUse, clearChoices,
         heartSweeps, heartsSettled, HEART_STEP, HEART_SWEEP,
         renderActions } from "../js/render.js";
import { Game } from "../js/app.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "823e30e3");

const NO_STORE = { cache: "no-store" };

// Comments, gone. Every guard in this file is a NEGATIVE assertion — "this word
// must not appear" — and the comment explaining each rule inevitably contains
// the word the rule forbids. That has now tripped three separate guards: two
// §9 audits and the no-strobe check, which went red on its own sentence saying
// "nothing alternates".
//
// Written with indexOf and split rather than a regex, deliberately. A backslash
// in this file has twice arrived as a literal control character, and the guards
// that would use one are exactly the negative assertions that pass silently
// forever when their pattern cannot match anything.
function noComments(text) {
  let out = "";
  let rest = String(text);
  for (;;) {
    const i = rest.indexOf("/*");
    if (i === -1) { out += rest; break; }
    out += rest.slice(0, i) + " ";
    const j = rest.indexOf("*/", i + 2);
    if (j === -1) break;
    rest = rest.slice(j + 2);
  }
  // String.fromCharCode(10) rather than a newline escape. Writing this file
  // through a shell heredoc turned that escape into a REAL newline and broke
  // the string literal, which silently took thirty tests out of the run: the
  // suite went from 261 to 231 and still reported a tidy one-line failure.
  const nl = String.fromCharCode(10);
  return out.split(nl).filter((l) => !l.trim().startsWith("//")).join(nl);
}

// The stage is a singleton by design: one full-screen layer, and a new one
// displaces the old so two set-pieces can never be up at once. The harness
// starts every async test the moment it is declared, so without this the DOM
// tests below would all mount into the same document and dismiss each other's
// layers — which is exactly what they did, and the three failures looked like
// framework bugs rather than test bugs. Each one takes its turn instead.
//
// Chained with the same function for both settlements so one failing test does
// not strand the queue: the next test runs either way, and its own rejection is
// what the harness reads.
let queue = Promise.resolve();
// EVERY STAGE TEST HAS TO END ITS OWN PANEL NOW (#91). The event stage waits
// for a tap instead of a timer, so an unawaited eventStage() never resolves and
// a test that merely awaits it hangs the whole suite behind the serial queue.
function tap() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
}

function serial(fn) {
  return () => {
    queue = queue.then(fn, fn);
    return queue;
  };
}

// ---- What exists --------------------------------------------------------------

test("stage: the six kinds #34 names, and no others", () => {
  eq(stageKinds().slice().sort(),
     ["hurt", "mend", "nothing", "pack", "poison", "villager"],
     "the framework's slots are the six animations the content issue lists");
});

// ---- Pacing, which is the whole design constraint -----------------------------

test("stage: a whole night does not grow by more than ten seconds", () => {
  // The number the header does its arithmetic on. This is the guard that keeps
  // the constraint from decaying into a comment nobody re-derives: a stage that
  // feels right once is a tax collected thirty times, and three seconds a piece
  // would be ninety seconds on a six-minute game.
  const cost = nightCostMs(30);
  assert(cost <= 10000,
    `thirty turns of stage add ${cost}ms; the budget is 10000ms — ` +
    `raising the stage length means paying that thirty times`);
});

test("stage: every budget is a deadline in a sane band", () => {
  for (const gates of [{}, { reduced: true }]) {
    const ms = stageBudgetMs(gates);
    assert(ms >= 400 && ms <= 1600,
      `budget ${ms}ms for ${JSON.stringify(gates)} is outside 400–1600`);
  }
});

test("stage: the quieter the gate, the shorter the hold", () => {
  // Not arbitrary ordering: reduced motion is a held frame and nobody needs a
  // held frame for as long as a moving one. If this ever inverts it means the
  // gate is making the game slower for the player who asked for less, which is
  // backwards. Calm was the other gate here and went with #72.
  assert(stageBudgetMs({ reduced: true }) <= stageBudgetMs(),
    "reduced motion holds longer than the full stage");
});
test("stage: every kind resolves, mounts nothing permanent, and balances the scene", serial(async () => {
  {
    for (const kind of stageKinds()) {
      const staged = document.body.classList.contains("staged");
      const p = eventStage(kind, { n: 3, hp: -1 });
      await new Promise((r) => setTimeout(r, 25));
      tap();
      await p;
      assert(!document.querySelector(".evstage"),
        `${kind}: the layer outlived its own stage`);
      eq(document.body.classList.contains("staged"), staged,
        `${kind}: enterScene/leaveScene did not balance — the letterbox bars are stuck`);
    }
  }
}));

test("stage: an unknown kind still takes the beat rather than vanishing", serial(async () => {
  const t0 = performance.now();
  await eventStage("no-such-scene", {});
  const took = performance.now() - t0;
  assert(!document.querySelector(".evstage"), "an unknown kind built a layer");
  assert(took >= BEAT_MS - 60,
    `an unknown kind returned in ${Math.round(took)}ms — a missing scene must not ` +
    `turn into a turn that reads as skipped`);
}));

test("stage: it is NOT held to a deadline, and waits instead (#91)", serial(async () => {
  {
    const budget = stageBudgetMs();
    // Raced against a reference timer rather than measured against the wall
    // clock, because wall-clock milliseconds here describe the tab more than
    // they describe the stage: a backgrounded pane clamps timers to whole
    // seconds, and this test read 2000ms for an 1100ms budget while the
    // framework was behaving perfectly. Clamping hits both timers alike, so a
    // race between them still means what it is supposed to mean — the stage
    // must not outlive twice its own deadline.
    // THIS USED TO ASSERT THE OPPOSITE, and the inversion is the ruling rather
    // than a loosened test: the stage is dismissed by the player now, so a
    // deadline would cut a panel somebody is still looking at. The budget is
    // still computed and still passed; it is simply no longer armed for a
    // tap-dismissed stage. A timer creeping back in would be invisible except
    // that the panel stopped waiting, which is exactly what this watches.
    const winner = await Promise.race([
      eventStage("nothing", { label: "Tap to continue" }).then(() => "stage"),
      new Promise((r) => setTimeout(() => r("waited"), budget * 2)),
    ]);
    eq(winner, "waited",
      `the stage ended itself within ${budget * 2}ms — it is supposed to wait for a tap`);
    assert(document.querySelector(".evstage"), "the stage left on its own");
    tap();
    await new Promise((r) => setTimeout(r, 40));
    assert(!document.querySelector(".evstage"),
      "tapping did not dismiss the stage — with no timer behind it, the night cannot go on");
  }
}));

// ---- Skipping ------------------------------------------------------------------

test("stage: a key ends it and cleans up after itself", serial(async () => {
  {
    // NOT "early" any more. This was an optimisation over a timer; it is now
    // one of the two ways out, and the timer that used to cover for it is gone.
    // A key that stopped working would be an unfinishable night rather than a
    // stage that felt slow, which is why the comparison against the budget went
    // and an assertion that it actually leaves took its place.
    const p = eventStage("nothing", {});
    await new Promise((r) => setTimeout(r, 30));
    assert(document.querySelector(".evstage"), "the stage never mounted");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await p;
    assert(!document.querySelector(".evstage"), "the dismissed layer was left behind");
  }
}));

test("stage: modified keys are not a skip", serial(async () => {
  {
    const p = eventStage("nothing", {});
    await new Promise((r) => setTimeout(r, 30));
    // Ctrl/Cmd combinations belong to the browser — someone reaching for
    // Cmd-R or Ctrl-C is not asking to dismiss anything.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    assert(document.querySelector(".evstage"),
      "a modified key or Tab dismissed the stage");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await p;
  }
}));

test("stage: the layer announces the action, not the scene (#91)", serial(async () => {
  {
    resetStageHints();
    const p = eventStage("poison", {});
    await new Promise((r) => setTimeout(r, 30));
    const el = document.querySelector(".evstage");
    assert(el, "the stage never mounted");

    // THIS ALSO INVERTED, and for the reason #96 gave for the reveal. It was
    // aria-hidden because the news is written to the log — a live region —
    // before the stage is called, so announcing the layer too would be the same
    // sentence twice. That held while the panel timed out. It does not hold now
    // that the panel BLOCKS: a screen reader user facing a silent layer that
    // will not leave until it is tapped has no way to learn a tap is owed, and
    // there is no timer left to rescue them.
    //
    // The name is the ACTION, so the beat is still not narrated twice: a button
    // announces its label and not its contents.
    assert(el.getAttribute("aria-hidden") !== "true",
      "the panel is hidden from a screen reader while blocking the turn — a player " +
      "using one cannot discover that a tap is owed, and nothing will time out");
    eq(el.getAttribute("role"), "button", "the blocking panel is not a control");
    eq(el.getAttribute("aria-label"), "Tap to continue",
      "the panel does not say what it wants");

    tap();
    await p;

    // THE NAME IS NOT THE HINT, and this is what would have caught the defect
    // that shipped: for a few hours the name was a parameter, and a caller that
    // did not pass it produced a blocking button announcing nothing.
    //
    // Proved by SPENDING the hint budget rather than by assuming it is spent —
    // relying on an earlier test to have used it up would make this pass or
    // fail on the order tests happen to run in. With no visible line left, the
    // panel must still say what it wants.
    for (let i = 0; i < HINT_BUDGET; i++) {
      const q = eventStage("nothing", {});
      await new Promise((r) => setTimeout(r, 25));
      tap();
      await q;
    }
    const bare = eventStage("nothing", {});
    await new Promise((r) => setTimeout(r, 25));
    const el2 = document.querySelector(".evstage");
    assert(!el2.querySelector(".evstage-hint"),
      "the hint budget did not run out, so this cannot show the name stands alone");
    eq(el2.getAttribute("aria-label"), "Tap to continue",
      "with the visible hint gone the panel announces nothing — the name is being " +
      "derived from the hint again, which is exactly the defect this replaced");
    tap();
    await bare;
  }
  resetStageHints();
}));

test("stage: never stacks", serial(async () => {
  {
    const a = eventStage("nothing", {});
    await new Promise((r) => setTimeout(r, 20));
    const b = eventStage("poison", {});
    await new Promise((r) => setTimeout(r, 20));
    eq(document.querySelectorAll(".evstage").length, 1,
      "two stages were up at once — the second must displace the first");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await Promise.all([a, b]);
  }
}));

// ---- The hint ------------------------------------------------------------------

test("stage: the hint teaches twice a run and then stops (#92)", serial(async () => {
  // REMOVED FOR AN HOUR AND RULED BACK: "don't show tap to continue", then
  // "好吧 加上 Tap to continue". What came back is the WORDS. The twice-per-run
  // policy was never overturned by either ruling, so it is the old machinery
  // unretired rather than something new that shows the line every time —
  // furniture in the middle of the board thirty times a night is still worse
  // than a hint that teaches and stops.
  //
  // Four events rather than two, because the thing being checked is COUNTED and
  // the interesting half is that it STOPS.
  resetStageHints();
  {
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const p = eventStage("nothing", {});
      await new Promise((r) => setTimeout(r, 25));
      const el = document.querySelector(".evstage");
      const hint = el && el.querySelector(".evstage-hint");
      seen.push(!!hint);
      // The hint is DECORATION: the panel's own name already says these words,
      // so a screen reader must not hear them twice.
      if (hint) eq(hint.getAttribute("aria-hidden"), "true",
        "the hint is announced as well as the panel's name — the same words twice");
      tap();
      await p;
    }
    eq(seen, [true, true, false, false],
      "the hint should teach twice and then stop being furniture");
  }
  resetStageHints();
}));

// ---- Strings -------------------------------------------------------------------

const [themeEn, themeZh] = await Promise.all([
  fetch("../data/theme.json", NO_STORE).then((r) => r.json()),
  fetch("../data/theme.zh-TW.json", NO_STORE).then((r) => r.json()),
]);

test("fight: the pack goes inert, and the buttons say so (#112)", serial(async () => {
  // 戰鬥中不能吃. app.js:1241 asserted this in prose for a long time and nothing
  // enforced it — measured, health 5 to 8 with the fight card still on screen.
  // The gate that replaced the prose was hand-verified twice and the suite was
  // EXACTLY as green with it as it had been with the bug. A flag nothing checks
  // is a smaller version of the same shape the comment was.
  //
  // FOUR ASSERTIONS, IN THIS ORDER, and the order is the point:
  //   1. prove a fight is actually open — an empty fight satisfies every
  //      "cannot act" claim for free
  //   2. the RULE: a direct call changes nothing
  //   3. the APPEARANCE: every Use is disabled
  //   4. the EXIT: both come back
  //
  // 3 exists because of a near miss. The first version of the gate set the flag
  // and did not re-render, so the rule held and the buttons stayed ENABLED — a
  // control that looks live and silently refuses, which reports as breakage
  // rather than as a rule. A guard checking only 2 would have shipped it.
  const names = ["tiles", "items", "search", "events"];
  const [tiles, items, search, events] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div id="board" class="board"></div></div>' +
                   '<div id="hud-items"></div><div id="actions-pop" hidden>' +
                   '<div id="actions"></div></div>';
  document.body.appendChild(host);
  try {
    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 9 });
    game.state.items = { "sticky-rice": 2 };
    game.state.health = 5;
    // WIRED THE WAY THE APP WIRES IT, at app.js:1728. Without this every Use
    // button renders disabled — `use.disabled = !canUse || typeof packUse !==
    // "function"` — because onPackUse is called from the page bootstrap and not
    // from the constructor. The precondition below caught exactly that on this
    // guard's first run: the buttons were already dead, so the two assertions
    // that matter would have passed without the gate existing at all.
    onPackUse((id) => game.usePackItem(id));
    game.refresh();

    const uses = () => [...document.querySelectorAll("#hud-items .cellact")];
    assert(uses().length > 0,
      "no Use buttons rendered, so every assertion below would pass on nothing");
    assert(uses().some((b) => !b.disabled),
      "the Use buttons are already disabled before any fight — this guard would " +
      "then pass without the gate doing anything");

    game.fightBeat(3, {});
    await new Promise((r) => setTimeout(r, 0));

    // 1. THE REGION. Without this the rest is satisfied by no fight happening.
    assert(game.inFight === true,
      "fightBeat did not open a fight, so 'cannot act during a fight' is vacuous");

    // 2. THE RULE.
    const hp = game.state.health;
    const rice = game.state.items["sticky-rice"];
    game.usePackItem("sticky-rice");
    eq(game.state.health, hp, "medicine was spent during a fight — the gate is not holding");
    eq(game.state.items["sticky-rice"], rice, "the item count moved during a fight");

    // 3. THE APPEARANCE.
    const live = uses().filter((b) => !b.disabled);
    eq(live.length, 0,
      "a pack Use button is still enabled during a fight: it will look live and " +
      "silently refuse, which reports as breakage rather than as a rule");

    // 4. THE EXIT — the half that rots, because nothing complains about a pack
    // that never comes back.
    game.inFight = false;
    game.refresh();
    assert(uses().some((b) => !b.disabled),
      "the pack never recovers after a fight — the exit edge does not re-render");
  } finally {
    host.remove();
  }
}));

test("fight: no empty window is left standing after the attack", serial(async () => {
  // 「攻擊僵屍後，會出現一個空白的 panel」. Measured on the shipped build: after the
  // attack, #actions-pop stood 417x33 with a lit border and a panel background,
  // holding an empty .window-head and an empty #actions. Nothing in it.
  //
  // The cause is a rationale that outlived its reason. clearChoices() empties
  // the list but deliberately does NOT hide the window, because the pack row is
  // the stage the resolve beat plays on — true when it was written. #94 then
  // moved the enemy of a fight into .creature over the board, and resolveBeat
  // prefers that panel; opts.pack now has exactly one caller, the midnight kit.
  // So for every fight the window was being held open for a stage that renders
  // somewhere else.
  //
  // TWO HALVES, and the second is the point. Deleting the behaviour outright
  // would pass the first half and silently take the King's stage down with it,
  // so this guard also states the case that must KEEP its window.
  const names = ["tiles", "items", "search", "events"];
  const [tiles, items, search, events] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div id="board" class="board"></div></div>' +
                   '<div id="hud-items"></div><div id="hud-hands"></div>' +
                   '<div id="actions-pop" hidden><div id="actions"></div></div>' +
                   '<div class="sr-only" id="log"></div>';
  document.body.appendChild(host);
  const pop = host.querySelector("#actions-pop");
  // What the player sees: the box is up, and there is nothing in it. Asserted
  // on the rendered box rather than on a flag, because `hidden` being false is
  // not by itself a complaint — a window with cards in it is also not hidden.
  const emptyBoxShowing = () => {
    if (pop.hidden) return false;
    const head = pop.querySelector(".window-head");
    return !pop.querySelector("#actions").children.length &&
           !(head && head.children.length);
  };
  try {
    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 9 });
    game.state.health = 6;
    game.refresh();

    game.fightBeat(3, {});
    await new Promise((r) => setTimeout(r, 0));

    // THE REGION. Without this every claim below is satisfied by no fight, no
    // window and no buttons — the shape that has made three guards in this file
    // pass on nothing.
    assert(game.inFight === true, "fightBeat did not open a fight");
    const btns = [...host.querySelectorAll("#actions button")];
    assert(btns.length > 0,
      "the fight rendered no buttons, so 'the window is empty afterwards' would " +
      "be true before the attack and this guard would prove nothing");
    assert(!emptyBoxShowing(),
      "the window is already empty with the fight still on screen — the probe " +
      "is measuring something other than the panel the player attacks from");

    // THE ATTACK, pressed the way a player presses it.
    btns[0].click();
    await new Promise((r) => setTimeout(r, BEAT_MS + 400));

    assert(!emptyBoxShowing(),
      "an empty actions window is left standing after the attack: a lit, " +
      "bordered box on the board with no prompt, no pack row and no cards in it");

    // THE CASE THAT KEEPS ITS WINDOW. The midnight kit is the one render that
    // still passes a pack row, and resolveBeat falls back to it because that
    // window has no creature panel. Hiding on empty must not reach it.
    renderActions([{ kind: "use", id: "sticky-rice", label: "Use it" }],
                  "The drum has struck", { pack: "king" });
    assert(!pop.hidden, "the midnight kit did not open its window at all");
    assert(host.querySelector(".packrow"), "the kit rendered no pack row to protect");
    clearChoices();
    assert(!pop.hidden,
      "clearChoices hid the King's window: the pack row is that beat's only " +
      "stage, and resolveBeat gates on finding a figure in it, so this takes " +
      "the whole midnight resolve down with it — swing included");
    assert(host.querySelector(".packrow"),
      "the King's pack row was cleared away with the choices");
  } finally {
    host.remove();
  }
}));

test("hud: the poison sentence is in the language it is read in (#108)", serial(async () => {
  // 「in English mode，中毒 still shows traditional Chinese」. It was hardcoded in
  // the renderer, so there was no language branch to reach and no theme key to
  // compare — a parity guard has nothing to look at and a theme sweep cannot
  // find what is not in a theme. THAT IS WHY THIS RENDERS AND READS THE SCREEN
  // rather than checking the tables.
  //
  // Two of the three strings here were never reported. The mark said 中毒 in
  // every language, which the user saw; the rate said "−1 each turn" in every
  // language, which is the same bug pointing the other way; and the
  // screen-reader line was hardcoded half in each. So this asserts the SCRIPT of
  // what is drawn, in both directions, rather than the one string that got
  // complained about.
  //
  // REPOINTED, NOT RETIRED (#117). The mark and the rate are gone and the strip
  // with them, so two of those three strings no longer exist — but the third
  // one does, and deleting the other two is exactly what made it matter. It is
  // the ONLY non-colour account of the poison rule now, and it is spoken, so it
  // is the one channel no visual check will ever look at. It moved into the
  // hearts' own line and this guard moved with it.
  const names = ["tiles", "items", "search", "events"];
  const [tiles, items, search, events] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  // id="board" AND class="board": renderBoard() writes to getElementById("board")
  // and throws on null, which is how the first version of this fixture failed —
  // loudly, which is the right way for a fixture to be wrong.
  host.innerHTML = '<div class="board-pane"><div id="board" class="board"></div></div>' +
                   '<div class="hearts" id="hud-health"></div>';
  document.body.appendChild(host);
  try {
    const HAN = /[㐀-鿿]/;
    const LATIN = /[A-Za-z]{3,}/;
    for (const [lang, theme, mustNot, why] of [
      ["en", themeEn, HAN, "Han characters"],
      ["zh-TW", themeZh, LATIN, "a Latin word"],
    ]) {
      const game = new Game({ tiles, items, search, events, theme, baseTheme: themeEn, lang },
                            { seed: 5 });
      game.state.poisoned = true;
      game.refresh();
      // The SPOKEN line specifically, not the whole box: the hearts are
      // pictures and carry no script of their own, so reading the box would
      // pass on an empty sentence. Prove the region, then read it.
      const said = document.querySelector("#hud-health .sr-only");
      assert(said, `nothing spoken rendered under the hearts in ${lang}, so ` +
        `this guard is asserting nothing — an empty region satisfies every ` +
        `"must not contain"`);
      const shown = said.textContent.trim();
      assert(shown.length > 0, `the spoken health line is empty in ${lang}`);
      assert(/\d/.test(shown),
        `the spoken line in ${lang} carries no number, so it is not the ` +
        `health reading: ${JSON.stringify(shown)}`);
      assert(!mustNot.test(shown),
        `the ${lang} spoken health line contains ${why}: ${JSON.stringify(shown)}`);

      // The category name, whole. The split that used to be here turned
      // "Ritual implement" into "Ritual" on any card offering the 神主牌 table.
      const relic = game.categoryName("relic");
      eq(relic, theme.categories.relic,
        `categoryName truncated the ${lang} name for relic`);
    }
  } finally {
    host.remove();
  }
}));

// THE POISON WASH GUARD IS RETIRED HERE, ON PURPOSE (#117).
//
// It asserted that something carried .panel--poisoned while poisoned, and its
// first assertion refused to pass on an empty region — so when 目前的中毒方式
// 不好看 deleted the wash, it went red rather than quietly passing on a page
// with nothing to find. That is the guard working, not failing, and it is the
// reason this deletion is a decision someone had to make instead of a silence
// nobody noticed.
//
// What it was really protecting is not gone: the closest()-reaches-the-right-
// ancestor family is covered by the .board-pane guard below, which is the same
// coupling with worse consequences. The wash itself has no successor because
// there is no wash.
//
test("hud: game.html still nests #board inside the pane the panel mounts on", async () => {
  // THE SAME FAULT AS THE POISON WASH, found by looking for it after #115
  // rather than by waiting for it. creaturePanel() mounts on
  // el.closest(".board-pane") — deliberately the PARENT, because renderBoard()
  // does innerHTML = "" on #board and a panel mounted inside would be deleted
  // by any mid-fight refresh. render.js says so at length; nothing checked it.
  //
  // Every stage fixture in this suite hand-writes that nesting as
  // '<div class="board-pane"><div id="board">', so the coupling was restated in
  // the tests rather than read from the page. MEASURED: rename the class in
  // game.html and the suite is 358 passed with only the shell digest fizzing —
  // and that clears the moment you commit and re-run record_shell.py.
  //
  // Losing it is not subtle in play: closest() returns null, the creature never
  // mounts, and eight document.querySelector(".board-pane") sites go quiet too.
  // It is only subtle in the tests, which is exactly what earns a guard.
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const board = doc.querySelector("#board");
  assert(board,
    "game.html has no #board at all, so this guard is asserting nothing about " +
    "where the creature panel would mount");
  const pane = board.closest(".board-pane");
  assert(pane,
    "game.html's #board has no .board-pane ancestor, so creaturePanel()'s " +
    "closest(\".board-pane\") returns null and the creature never mounts. " +
    "The wrapper is: " + (board.parentElement
      ? board.parentElement.tagName.toLowerCase() + "." +
        (board.parentElement.className || "(no class)")
      : "(none — #board has no parent)"));
  assert(pane !== board,
    "the pane and the board are the same element, so renderBoard()'s " +
    "innerHTML wipe would delete the creature panel mid-fight");
});

// The reading has to live OUTSIDE #board (#117). renderBoard() does
// innerHTML = "" on #board and refresh() calls it several times a turn, so a
// HUD mounted in there is deleted — mid-sweep, repeatedly — and it would come
// back looking almost right, because the next render rebuilds it from state.
// Same coupling the creature panel has, read from the page rather than
// restated: a fixture that writes its own nesting cannot fail this.
test("hearts: the reading is not inside the board that gets wiped (#117)", async () => {
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const board = doc.querySelector("#board");
  assert(board, "game.html has no #board, so this guard cannot tell where the reading sits");
  for (const sel of ["#hud-health", "#hud-hour"]) {
    const el = doc.querySelector(sel);
    assert(el, "game.html has no " + sel + " — the reading has no node at all");
    assert(!board.contains(el),
      sel + " is inside #board, which renderBoard() empties on every refresh, " +
      "so the reading is deleted several times a turn");
    assert(el.closest(".board-pane"),
      sel + " is not on the .board-pane, so it is not on the tile at all");
  }
});

// THE DECISION, WITHOUT A DOM. heartSweeps is pure and takes `reduced` as an
// argument rather than asking the OS — the shape stageBudgetMs already uses in
// this file, and what makes the reduced-motion rule checkable here at all.
test("hearts: the sweep plan is ordered, directed, and refusable (#117)", () => {
  const at = (health, poisoned) => ({ health, poisoned });

  // 糯米 CURES AND HEALS IN ONE ACTION and is the case the ordering exists for:
  // a green-to-red sweep and an empty-to-solid sweep land on the same row from
  // a single state change. Colour first, count second — run together they
  // fight over the same hearts.
  const nuomi = heartSweeps(at(6, true), at(9, false));
  eq(nuomi.length, 2, "糯米 should plan two sweeps, not one and not none");
  eq(nuomi[0].kind, "colour", "the cure must sweep before the new hearts arrive");
  eq(nuomi[1].kind, "gain", "the heal is the second sweep");
  eq(nuomi[0].end, 6, "the cure covers the hearts you already had");
  eq(nuomi[1].start, 6, "the heal starts where the old hearts ended");

  // Directions are ruled: gained left to right, lost right to left.
  eq(heartSweeps(at(3, false), at(7, false))[0].dir, "ltr", "a gain runs left to right");
  eq(heartSweeps(at(7, false), at(3, false))[0].dir, "rtl", "a loss runs right to left");
  eq(heartSweeps(at(10, false), at(10, true))[0].dir, "ltr", "poison runs left to right");

  // The per-turn tick is ONE heart, which is why the slow rate is affordable.
  const tick = heartSweeps(at(9, true), at(8, true));
  eq(tick.length, 1, "a poison tick is a single sweep");
  eq(tick[0].end - tick[0].start, 1, "a poison tick moves exactly one heart");

  eq(heartSweeps(at(7, false), at(7, false)).length, 0, "an unchanged row sweeps");

  // Reduced motion gets the END STATE and no sweep — not a faster sweep, which
  // would still be the thing being refused. Each case also asserts it plans
  // something WITH motion on, or the line above passes for the wrong reason.
  for (const [from, to, what] of [
    [at(10, false), at(10, true), "poison"],
    [at(3, false), at(10, false), "a heal"],
    [at(6, true), at(9, false), "糯米"],
  ]) {
    eq(heartSweeps(from, to, { reduced: true }).length, 0,
      "reduced motion still sweeps for " + what);
    assert(heartSweeps(from, to).length > 0,
      what + " plans no sweep even with motion on, so the reduced check above " +
      "passes for the wrong reason");
  }
});

// SAMPLED MID-FLIGHT, which is the only way to tell a sweep from an assignment.
// A check that reads the row afterwards passes an implementation that simply
// sets the end state — and that exact bug was live during this build: the
// empty-to-solid sweep animated fill-opacity on hearts whose fill was `none`,
// so it ran its full duration and showed nothing. Every settled reading was
// correct throughout.
//
// It SEEKS currentTime rather than waiting, because a pane that does not
// composite advances animations in lurches or not at all.
//
// AND IT BRINGS THE REAL STYLESHEET AND THE REAL SPRITE. tests/index.html links
// neither, and without them there is nothing here to measure: the colour tokens
// resolve to empty strings and icon() returns null, so the row has no hearts and
// the sweep never runs. A guard passing in that state asserts about an empty
// region, so both are checked before anything else is believed.
test("hearts: the poison sweep is a sweep, not an assignment (#117)", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html, css, sprite] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
    fetch("../css/style.css", NO_STORE).then((r) => r.text()),
    fetch("../assets/icons.svg", NO_STORE).then((r) => r.text()),
  ]);
  const styles = document.createElement("style");
  styles.textContent = css;
  const spriteHost = document.createElement("div");
  spriteHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  spriteHost.setAttribute("aria-hidden", "true");
  spriteHost.innerHTML = sprite;
  const pane = new DOMParser().parseFromString(html, "text/html")
    .querySelector(".board-pane");
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  document.head.appendChild(styles);
  document.body.appendChild(spriteHost);
  document.body.appendChild(host);
  try {
    assert(pane, "game.html has no .board-pane to take the reading from");
    host.appendChild(document.importNode(pane, true));
    const row = host.querySelector("#hud-health");
    assert(row, "game.html's board pane carries no #hud-health");

    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 5 });
    game.state.health = 10;
    game.state.poisoned = false;
    game.refresh();
    await heartsSettled();

    const hearts = [...row.querySelectorAll(".heart")];
    eq(hearts.length, 10,
      "the row did not draw ten hearts, so the sprite never arrived and there " +
      "is nothing here to sweep");
    const red = getComputedStyle(hearts[0]).color;
    assert(/rgb/.test(red),
      "the hearts have no resolved colour (" + red + "), so the stylesheet did " +
      "not apply and every colour comparison below is between two blanks");

    game.state.poisoned = true;
    game.refresh();
    // The sweep is enqueued through a promise chain, so its animations exist a
    // microtask later. Reading now finds none, which looks exactly like "no
    // sweep" and is the false pass this whole guard is about.
    await Promise.resolve();
    await Promise.resolve();
    const anims = document.getAnimations().filter((a) => a.id === HEART_SWEEP);
    assert(anims.length >= 10,
      "poisoning raised " + anims.length + " heart animations; a sweep of ten " +
      "hearts needs one each, so this is an assignment wearing a sweep's name");

    // Which hearts are STILL the old colour at a given instant.
    const oldAt = (t) => {
      for (const a of anims) a.currentTime = t;
      void document.body.offsetHeight;
      return hearts.map((h) => getComputedStyle(h).color === red);
    };
    const early = oldAt(2.5 * HEART_STEP);
    const later = oldAt(6.5 * HEART_STEP);
    const n = (a) => a.filter(Boolean).length;

    // 1. At some instant the row is NOT all one colour. This is the assertion
    //    "all green afterwards" cannot make.
    assert(early.some(Boolean) && early.some((v) => !v),
      "mid-sweep the row is all one colour (" + n(early) + "/10 still red), so " +
      "nothing is sweeping — the change is instant");

    // 2. The hearts still red are the TRAILING run. Contiguity alone is not
    //    enough: a right-to-left sweep is perfectly contiguous and leaves the
    //    unchanged hearts at the FRONT, which is a different bug and has to
    //    read as one.
    const trailing = (arr) => {
      const first = arr.indexOf(true);
      return first === -1 || arr.slice(first).every(Boolean);
    };
    const show = (arr) => arr.map((v) => (v ? "." : "#")).join("");
    assert(trailing(early) && trailing(later),
      "the hearts still unchanged are not the ones at the END of the row, so " +
      "the sweep is not crossing it left to right (# changed, . not): " +
      show(early) + " then " + show(later));

    // 3. And it moves LEFT TO RIGHT: fewer old hearts later than earlier.
    assert(n(later) < n(early),
      "the boundary did not advance between " + (2.5 * HEART_STEP) + "ms and " +
      (6.5 * HEART_STEP) + "ms (" + n(early) + " then " + n(later) + " still " +
      "red), so the sweep is not running left to right");

    for (const a of anims) a.currentTime = 30 * HEART_STEP;
    await heartsSettled();
  } finally {
    host.remove();
    spriteHost.remove();
    styles.remove();
  }
}));

// THE BOARD IS OCCUPIED TERRITORY AND THE OVERLAY IS A GUEST ON IT (#117
// addendum: 確保剛說的改動，都會實作在電腦和手機等不同解析度的螢幕上; re-framed
// by #119 to the MAP PANEL: 「Tile panel 我是指這個」「不是 tile 本身」).
//
// The doorways take a band --edge/2 deep at each side of the tile, centred; the
// stay control takes an --edge square at the middle; the room-name chip takes
// the bottom left. What makes the corner and the top both usable is that the
// north doorway is only 46px wide and centred — measured at 375x667 relative to
// the pane, it is x 153-199 and the east door starts at y 145, so everything
// right of 199 and above 145 is free. This checks the reading landed there at a
// definite tile size rather than at whatever size the window happened to be.
//
// IT EXISTS BECAUSE OF A SILENT FAILURE, and the failure mode is the point.
// --edge was declared on .focus, and the HUD is a SIBLING of the board rather
// than a descendant of it — so `bottom: calc(var(--edge) / 2 + 2px)` referred to
// a property that did not exist there. An undefined custom property does not
// warn and does not fall back: the whole declaration is dropped, the element
// keeps its initial value, and the result looks deliberate. Both placements
// landed on something — the clock on the room name, the hearts on the north
// doorway — and every other number about them was correct.
//
// So the first assertion is that the placement RESOLVED AT ALL. A guard that
// only checked the rectangles would have gone green the moment someone moved
// --edge back down, because at some tile sizes the dropped placement happens
// not to overlap anything.
test("hearts: the reading is a corner of the map panel, and it resolved (#119)", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html, css, sprite] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
    fetch("../css/style.css", NO_STORE).then((r) => r.text()),
    fetch("../assets/icons.svg", NO_STORE).then((r) => r.text()),
  ]);
  const styles = document.createElement("style");
  styles.textContent = css;
  const spriteHost = document.createElement("div");
  spriteHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  spriteHost.setAttribute("aria-hidden", "true");
  spriteHost.innerHTML = sprite;
  const pane = new DOMParser().parseFromString(html, "text/html")
    .querySelector(".board-pane");
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:900px";
  const root = document.documentElement;
  const hadTile = root.style.getPropertyValue("--tile");
  document.head.appendChild(styles);
  document.body.appendChild(spriteHost);
  document.body.appendChild(host);
  try {
    assert(pane, "game.html has no .board-pane to take the reading from");
    host.appendChild(document.importNode(pane, true));
    // ON THE ROOT, not on the host. --edge is declared at :root and substitutes
    // :root's --tile, so a --tile set on a subtree would size the tile without
    // moving --edge — the two would disagree and this guard would be measuring
    // a state the game never has.
    root.style.setProperty("--tile", "189px");

    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 5 });
    game.refresh();
    // The ways out are drawn by renderMoves(), not by refresh() — and without
    // them the collision checks below have an empty set to look at, which is
    // how this guard failed the first time it ran. Correctly: an empty set
    // never overlaps anything.
    game.renderMoves();

    const hud = host.querySelector("#tilehud");
    const row = host.querySelector("#hud-health");
    const clock = host.querySelector("#hud-hour");
    assert(hud && row && clock, "the pane carries no reading to place");
    // 1. THE PLACEMENT RESOLVED. A dropped declaration leaves the initial
    //    value, which is not an error and looks deliberate — see the header.
    const top = getComputedStyle(row).top;
    const clockTop = getComputedStyle(clock).top;
    for (const [what, value] of [["the hearts' top", top],
                                 ["the clock's top", clockTop]]) {
      assert(/^[\d.]+px$/.test(value) && parseFloat(value) > 0,
        what + " computed to " + JSON.stringify(value) + " — the declaration " +
        "was dropped, which is what happens when a custom property it reads is " +
        "not defined in this element's scope. It does not warn and it looks " +
        "deliberate.");
    }

    // 2. AND IT LANDED CLEAR. Rectangles against what is already on the board.
    const B = (e) => e.getBoundingClientRect();
    const hit = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
                          Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    const cell = host.querySelector(".focus-centre");
    assert(cell, "the board did not render a centre tile to place against");
    const doors = [...host.querySelectorAll(".doorway")];
    assert(doors.length > 0,
      "no doorways rendered, so the collision checks below are asserting " +
      "nothing — an empty set never overlaps");
    const name = host.querySelector(".tilename");
    assert(name, "no room-name chip rendered, so the clock has nothing to clear");

    for (const [label, el] of [["the hearts", row], ["the clock", clock]]) {
      const r = B(el);
      const clash = doors.filter((d) => hit(r, B(d)))
        .map((d) => d.className.toString().slice(0, 14));
      eq(clash.length, 0,
        label + " overlap a way out (" + clash.join(", ") + "), and #111 set " +
        "the rule that nothing may take area from a tap target");
    }
    assert(!hit(B(clock), B(name)),
      "the clock overlaps the room-name chip. The chip is a fixed 17.8px of " +
      "type and does NOT scale with the tile, so it is the taller obstacle on " +
      "a small tile while the doorway is on a large one");

    // 3. And the reading stays within the MAP PANEL — which is the anchor now
    //    (#119: 「Tile panel 我是指這個」「或者叫 map panel」「不是 tile 本身」).
    //    It was the centre tile before, and that is the one line of this guard
    //    the frame correction actually changed.
    const paneBox = B(host.querySelector(".board-pane"));
    for (const [label, el] of [["the hearts", row], ["the clock", clock]]) {
      const r = B(el);
      assert(r.left >= paneBox.left - 1 && r.right <= paneBox.right + 1 &&
             r.top >= paneBox.top - 1 && r.bottom <= paneBox.bottom + 1,
        label + " sit outside the map panel, so the reading is floating in the " +
        "dark beside the board rather than on it");
    }

    // 4. TWO ROWS OF FIVE (#119), asserted as ROWS rather than as a width.
    //    The first version of this compared the block against half the panel's
    //    width and passed a single row of ten — because the fixture's host is
    //    900px wide and a 180px band is trivially under half of that. The
    //    threshold was relative to a number this test chose. Found by putting
    //    the band back and watching the guard stay green.
    //
    //    The row count is the ruling itself and has no such freedom.
    const hearts10 = [...host.querySelectorAll("#hud-health .heart")];
    const bands = [...new Set(hearts10.map((h) => Math.round(B(h).top)))];
    eq(bands.length, 2,
      "the hearts are in " + bands.length + " row(s), not two — ten across is " +
      "95% of the tile's width and reads as a band, which is what #119 exists " +
      "to stop");
    const perRow = hearts10.filter((h) => Math.round(B(h).top) === bands[0]).length;
    eq(perRow, 5, "the top row holds " + perRow + " hearts, not five");

    // And against the BOARD rather than the panel, because the panel can be
    // arbitrarily wide and the board is what the corner is a corner of.
    const focusBox = B(host.querySelector(".focus"));
    const rowBox = B(row);
    assert(rowBox.width < focusBox.width * 0.45,
      "the hearts span " + Math.round(rowBox.width) + " of a " +
      Math.round(focusBox.width) + "px board, which is a band and not a corner");
    assert(paneBox.right - rowBox.right < paneBox.width * 0.2,
      "the hearts are not against the panel's right edge");
  } finally {
    if (hadTile) root.style.setProperty("--tile", hadTile);
    else root.style.removeProperty("--tile");
    host.remove();
    spriteHost.remove();
    styles.remove();
  }
}));

// 改成實心愛心, CHECKED IN THE PIXELS (#118).
//
// The hearts shipped as RINGS while the class said heart--full, the stylesheet
// said fill: currentColor, and getComputedStyle on the <svg> agreed: fill
// rgb(239,100,73), and 364 tests were green. Nothing was lying. Everything was
// reading the HOST, and the paint was not happening there.
//
// icon() builds <use href="#stat-heart">, which clones into a SHADOW TREE, and
// assets/icons.svg carries its own stylesheet whose first rule is
// `symbol { fill: none; stroke: currentColor; stroke-width: 1.5 }`.
// #stat-heart's path has no fill of its own, so it inherits `none` from the
// symbol — a specified value inside the shadow tree, which beats a host fill
// that only arrives by inheritance.
//
// TWO ASSERTIONS, AND THE ORDER MATTERS. First that the drawable geometry is
// reachable at all: through <use> there is no path in the light DOM and no
// computed style anywhere that describes what is drawn. Then the pixels,
// because no style assertion can tell a ring from a solid — that is the whole
// finding, and a guard that only read styles would have passed the bug.
test("hearts: the hearts are solid, checked in the pixels (#118)", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html, css, sprite] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
    fetch("../css/style.css", NO_STORE).then((r) => r.text()),
    fetch("../assets/icons.svg", NO_STORE).then((r) => r.text()),
  ]);
  const styles = document.createElement("style");
  styles.textContent = css;
  const spriteHost = document.createElement("div");
  spriteHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  spriteHost.setAttribute("aria-hidden", "true");
  spriteHost.innerHTML = sprite;
  const pane = new DOMParser().parseFromString(html, "text/html")
    .querySelector(".board-pane");
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:900px";
  const root = document.documentElement;
  const hadTile = root.style.getPropertyValue("--tile");
  document.head.appendChild(styles);
  document.body.appendChild(spriteHost);
  document.body.appendChild(host);

  // Draw one heart on its own and read it back. The resolved paint is copied
  // from the PATH, which is where painting happens — copying it from the <svg>
  // would reproduce the very mistake this guard exists for. paint-order comes
  // too: without it the stroke lands ON the fill instead of behind it, and the
  // rim measures three times its real size.
  const raster = async (node, px) => {
    const clone = node.cloneNode(true);
    const src = node.querySelector("path"), dst = clone.querySelector("path");
    const cs = getComputedStyle(src);
    for (const p of ["fill", "stroke", "stroke-width", "fill-opacity",
                     "stroke-opacity", "paint-order"])
      dst.setAttribute(p, cs.getPropertyValue(p));
    clone.setAttribute("width", px);
    clone.setAttribute("height", px);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("the heart would not rasterise"));
      img.src = "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(clone));
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, px, px);
    const d = ctx.getImageData(0, 0, px, px).data;
    const at = (x, y) => { const i = (y * px + x) * 4;
      return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] }; };
    let painted = 0, rim = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 40) continue;
      painted++;
      // The poisoned rim, --poison-rim #0d2115.
      if (Math.abs(d[i] - 13) + Math.abs(d[i + 1] - 33) + Math.abs(d[i + 2] - 21) < 60) rim++;
    }
    // Inside the lobe rather than the dead centre: a heart's middle at the very
    // centre of its box is close to the cleft between the lobes.
    return { centre: at(px >> 1, Math.round(px * 0.42)), painted, rim };
  };

  try {
    assert(pane, "game.html has no .board-pane");
    host.appendChild(document.importNode(pane, true));
    root.style.setProperty("--tile", "200px");
    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 5 });
    game.state.health = 4;
    game.state.poisoned = false;
    game.refresh();
    await heartsSettled();

    const hearts = [...host.querySelectorAll("#hud-health .heart")];
    eq(hearts.length, 10, "the row did not draw ten hearts, so the sprite never arrived");

    // 1. THE PAINT HAS TO BE REACHABLE. Through <use> the shape lives in a
    //    shadow tree: there is no path here and nothing in this document
    //    describes what is actually drawn.
    for (const [i, h] of hearts.entries()) {
      assert(h.querySelector("path"),
        "heart " + i + " has no path in the light DOM — it is a <use> clone, " +
        "so the sprite's own `symbol { fill: none }` decides how it is painted " +
        "and no rule or computed style in this document can say otherwise");
    }

    // 2. A FULL HEART IS SOLID IN THE PIXELS.
    const full = await raster(hearts[0], 64);
    assert(full.centre.a > 200,
      "the middle of a full heart is transparent (alpha " + full.centre.a +
      ") — it is drawn as a ring, which is what 改成實心愛心 asked to stop");
    assert(Math.abs(full.centre.r - 239) + Math.abs(full.centre.g - 100) +
           Math.abs(full.centre.b - 73) < 60,
      "a full heart's middle is not --danger: " + JSON.stringify(full.centre));

    // 3. AN EMPTY HEART IS AN OUTLINE, AND IS DRAWN AT ALL. Its own bug: with
    //    the sprite's stroke gone and none put back, an empty heart is neither
    //    filled nor outlined, which is not faint — it is absent, and the row
    //    then reads "4" instead of "4 of 10".
    const empty = await raster(hearts[9], 64);
    assert(empty.centre.a < 60,
      "the middle of an empty heart is painted, so it is not reading as empty");
    assert(empty.painted > 64 * 64 * 0.05,
      "an empty heart draws almost nothing (" + empty.painted + " px) — it has " +
      "no fill and no stroke, so the row cannot be counted against ten");

    // 4. THE COLOUR-BLIND CUE RENDERS. It is not enough for the rule to exist:
    //    the first version set a stroke the sprite discarded, so poisoned and
    //    healthy differed in hue alone — the exact thing the rim was added to
    //    prevent.
    game.state.health = 10;
    game.state.poisoned = true;
    game.refresh();
    await heartsSettled();
    const sick = await raster(host.querySelectorAll("#hud-health .heart")[0], 64);
    game.state.poisoned = false;
    game.refresh();
    await heartsSettled();
    const well = await raster(host.querySelectorAll("#hud-health .heart")[0], 64);
    assert(sick.rim > sick.painted * 0.1,
      "a poisoned heart carries " + sick.rim + " rim pixels of " + sick.painted +
      " painted — the second cue is not rendering, so poison and health differ " +
      "in HUE ALONE, which is the commonest colour blindness");
    eq(well.rim, 0, "a healthy heart is drawing the poisoned rim");

    // 5. AND AN EMPTY HEART STAYS EMPTY WHILE A SWEEP IS RUNNING. .hearts--
    //    sweeping makes every heart paintable so fill-opacity can drive the
    //    animation, and that override also removes the `fill: none` that was
    //    the ONLY thing telling empty from full — so every empty heart filled
    //    in solid grey for the length of any sweep. At rest it looked perfect.
    game.state.health = 4;
    game.state.poisoned = false;
    game.refresh();
    await heartsSettled();
    game.state.poisoned = true;
    game.refresh();
    await Promise.resolve();
    await Promise.resolve();
    const mid = document.getAnimations().filter((a) => a.id === HEART_SWEEP);
    for (const a of mid) a.currentTime = 2.5 * HEART_STEP;
    void document.body.offsetHeight;
    const midRow = [...host.querySelectorAll("#hud-health .heart")];
    for (let i = 4; i < midRow.length; i++) {
      const cs = getComputedStyle(midRow[i].querySelector("path"));
      assert(cs.fill === "none" || parseFloat(cs.fillOpacity) < 0.5,
        "heart " + i + " is beyond a health of 4 and is filled mid-sweep " +
        "(fill " + cs.fill + ", fill-opacity " + cs.fillOpacity + "), so the " +
        "row reads as fuller than it is for as long as the sweep runs");
    }
    for (const a of mid) a.currentTime = 30 * HEART_STEP;
    await heartsSettled();
  } finally {
    if (hadTile) root.style.setProperty("--tile", hadTile);
    else root.style.removeProperty("--tile");
    host.remove();
    spriteHost.remove();
    styles.remove();
  }
}));

// 應在tile的中心 (#120), and the guard varies THE THING THAT DRIVES THE FAULT.
//
// The creature sat low, and by an amount that grew with the number of options
// the fight offered — `top: 50%` on a panel whose parent is the pane, and the
// pane is the room plus the actions window. Measured before the fix at
// 375x667: the art was 31.9px below the tile's centre with one option, 60.4
// with a taller window, 138.0 with a taller one still.
//
// THE #94 MOVEMENT GUARD CANNOT SEE THIS, which is why it shipped. That one
// compares two frames of the strike, so off-centre before equals off-centre
// after and it passes clean on a creature that was never in the right place.
// A guard that only checked "the art is centred" at one option count would
// have the same blind spot from the other side.
//
// So this measures the offset, MAKES THE ACTIONS WINDOW TALLER, and measures
// again. The offset must not move.
test("fight: the creature is centred on the tile, whatever the actions window does (#120)", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html, css, sprite] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
    fetch("../css/style.css", NO_STORE).then((r) => r.text()),
    fetch("../assets/icons.svg", NO_STORE).then((r) => r.text()),
  ]);
  const styles = document.createElement("style");
  styles.textContent = css;
  const spriteHost = document.createElement("div");
  spriteHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  spriteHost.setAttribute("aria-hidden", "true");
  spriteHost.innerHTML = sprite;
  const pane = new DOMParser().parseFromString(html, "text/html")
    .querySelector(".board-pane");
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:375px;height:1400px";
  const root = document.documentElement;
  const hadTile = root.style.getPropertyValue("--tile");
  document.head.appendChild(styles);
  document.body.appendChild(spriteHost);
  document.body.appendChild(host);
  try {
    assert(pane, "game.html has no .board-pane");
    host.appendChild(document.importNode(pane, true));
    root.style.setProperty("--tile", "189px");

    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 5 });
    game.refresh();

    const paneEl = host.querySelector(".board-pane");
    const pop = host.querySelector(".actions-pop");
    const cell = host.querySelector(".focus-centre");
    assert(cell, "the board drew no centre tile, so there is no centre to be on");
    assert(pop, "game.html carries no .actions-pop, so this guard cannot make " +
      "the pane taller and is asserting nothing");

    const panel = creaturePanel(4, { reduced: true });
    assert(panel, "no creature panel mounted");
    assert(paneEl.contains(panel),
      "the creature is not a child of .board-pane — renderBoard() wipes #board, " +
      "so a panel mounted in there is deleted by any mid-fight refresh (4276fe5)");
    const art = panel.querySelector(".creature-breath");
    assert(art, "the panel drew no creature, so there is nothing to centre");

    // Layout, not rects: the entrance and the duck both use transforms, and a
    // rect taken while either runs describes a box that has been moved.
    const within = (el, ancestor) => {
      let y = 0, n = el;
      while (n && n !== ancestor) { y += n.offsetTop; n = n.offsetParent; }
      return n === ancestor ? y : null;
    };
    const offset = () => {
      const tileCentre = within(cell, paneEl) + cell.offsetHeight / 2;
      const artCentre = within(art, paneEl) + art.offsetHeight / 2;
      return +(artCentre - tileCentre).toFixed(1);
    };
    const paneH = () => Math.round(paneEl.getBoundingClientRect().height);

    // THE FAULT ONLY EXISTS IN THE ONE-COLUMN LAYOUT, and the media query that
    // makes it cannot fire here: it keys off the VIEWPORT, and the test page's
    // is desktop-width however narrow this fixture is. At >800px .actions-pop
    // is absolutely positioned, floats over the board, and adds nothing to the
    // pane's height — so this guard failed its own precondition on its first
    // run, correctly. The fixture reproduces that one rule from the
    // max-width: 800px block, copied rather than invented.
    pop.hidden = false;
    pop.style.position = "static";
    pop.style.transform = "none";
    pop.style.width = "100%";

    // AND THE PANE NEEDS SLACK, which is the part a first version of this guard
    // missed. Once the placement is a pixel value the creature is immune to the
    // pane merely getting taller — so a guard that only grows the pane passes a
    // fix that never re-places at all. It was measured passing one.
    //
    // The case that actually needs re-placing is .board-pane's own
    // justify-content: center: when the content is SHORTER than the pane, the
    // board is centred in the leftover height, so a taller actions window
    // pushes the board UP and the tile with it. min-height: 62vh gives the real
    // page exactly that slack whenever the window is short.
    paneEl.style.minHeight = "900px";
    void document.body.offsetHeight;

    // VARY WHAT ACTUALLY VARIES: the number of options the fight offers. That
    // is the quantity the owner's report turned on — a screenshot with four
    // options showing — and it goes through renderActions, the product's own
    // path, rather than through a height this test invents.
    const seen = [];
    for (const n of [1, 3, 6]) {
      const acts = [];
      for (let i = 0; i < n; i++) {
        acts.push({ label: "Strike with the peachwood sword " + (i + 1),
                    onClick: () => {} });
      }
      renderActions(acts, "It is standing in the doorway.");
      void document.body.offsetHeight;
      // The TILE's position in the pane, which is what the creature has to
      // track — not the pane's height. With slack the pane stays one size
      // while the board slides inside it, and that is the case that needs
      // re-placing at all.
      seen.push({ options: n, pane: paneH(),
                  tile: Math.round(within(cell, paneEl) + cell.offsetHeight / 2),
                  off: offset() });
    }

    // 1. THE HARNESS ACTUALLY MOVES THE TILE. Without this the sameness below
    //    passes for the wrong reason — identical rows are what a disconnected
    //    knob looks like, and that has bitten this suite before.
    //
    //    THE TILE, NOT THE PANE. A first version asserted the pane's height
    //    changed, which is wrong twice over: with slack the pane is pinned and
    //    the board slides inside it, and a pane that merely grows moves nothing
    //    once the placement is a pixel value.
    const seats = new Set(seen.map((r) => r.tile));
    assert(seats.size > 1,
      "more options did not move the tile inside the pane (" + [...seats].join(", ") +
      "), so this guard never exercised the fault: " + JSON.stringify(seen));

    // 2. THE CREATURE IS ON THE TILE'S CENTRE.
    assert(Math.abs(seen[0].off) <= 1.5,
      "the creature sits " + seen[0].off + "px from the tile's centre");

    // 3. AND IT STAYS THERE AS THE WINDOW GROWS. This is the assertion the
    //    fault fails: the offset used to track the actions window at half a
    //    pixel per pixel, so it was worse the more choices you were given.
    const offs = seen.map((r) => r.off);
    const spread = Math.max(...offs) - Math.min(...offs);
    assert(spread <= 1.5,
      "the creature moves as the actions window grows — " + JSON.stringify(seen));

    // 4. Horizontal was exact before the fix and must stay exact.
    const dx = Math.abs(
      (panel.getBoundingClientRect().left + panel.getBoundingClientRect().right) / 2 -
      (cell.getBoundingClientRect().left + cell.getBoundingClientRect().right) / 2);
    assert(dx <= 1, "the creature is " + dx.toFixed(1) + "px off horizontally");

    paneEl.style.minHeight = "";
    clearCreaturePanel();
  } finally {
    clearCreaturePanel();
    if (hadTile) root.style.setProperty("--tile", hadTile);
    else root.style.removeProperty("--tile");
    host.remove();
    spriteHost.remove();
    styles.remove();
  }
}));

// 一個平面,沒有盒子 — NOTHING ON THIS SCREEN HAS A GROUND (#121, Layout A).
//
// There is already a guard for this and it is not enough. That one reads
// game.html as source text and counts class="panel", which is immune to the
// unstyled-fixture trap — but its immunity IS its blind spot: it proves the
// MARKUP carries no panel, not that nothing RENDERS as a card. A .sidebar rule
// with a ground and a border would put the box straight back with no "panel"
// string anywhere in the document, and the counting guard would stay green
// through it. Layout A's claim is "nothing has a ground", not "no element is
// called panel", so the claim has to be asserted about paint.
//
// WHICH MEANS THE SHEET HAS TO BE HERE. tests/index.html links no CSS, so a
// guard reasoning about what things paint agrees with a document that has none
// of the code under test in it — #123 passed cleanly for two runs on exactly
// that. So: adopt the real stylesheet, PROVE the region is styled, and only
// then assert anything about what it paints.
test("surface: nothing in the sidebar renders as a card (#121)", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html, css, sprite] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
    fetch("../css/style.css", NO_STORE).then((r) => r.text()),
    fetch("../assets/icons.svg", NO_STORE).then((r) => r.text()),
  ]);
  const styles = document.createElement("style");
  styles.textContent = css;
  const spriteHost = document.createElement("div");
  spriteHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  spriteHost.setAttribute("aria-hidden", "true");
  spriteHost.innerHTML = sprite;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const side = doc.querySelector(".sidebar");
  const nav = doc.querySelector(".topnav");
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:375px";
  document.head.appendChild(styles);
  document.body.appendChild(spriteHost);
  document.body.appendChild(host);
  try {
    assert(side, "game.html has no .sidebar");
    assert(nav, "game.html has no .topnav");
    // renderBoard() writes to getElementById("board") and throws on null, which
    // is how this fixture failed on its first run — loudly, which is the right
    // way for a fixture to be wrong.
    host.innerHTML = '<div class="board-pane"><div id="board" class="board"></div></div>';
    host.appendChild(document.importNode(nav, true));
    host.appendChild(document.importNode(side, true));

    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 5 });
    game.state.tablet = true;
    game.refresh();

    const paints = (c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";

    // 1. THE REGION IS STYLED. Without this every assertion below is agreeing
    //    with an unstyled document, which is the failure #123 shipped twice.
    //
    //    THE PROBE USED TO BE THE DIVIDER, which #131 removed — and this guard
    //    went red for it, correctly, which is the whole reason a probe like
    //    this is worth having. The empty carried place is the replacement: its
    //    ring is painted only by the stylesheet, and like the divider it is
    //    load-bearing rather than decorative — it is what says a place is a
    //    place when there is nothing in it.
    const ring = host.querySelector(".cell--empty .cellface");
    assert(ring, "no empty carried place, so this guard has nothing to probe with");
    const ringCs = getComputedStyle(ring);
    assert(parseFloat(ringCs.borderTopWidth) > 0 && paints(ringCs.borderTopColor),
      "an empty carried place draws no ring (" + ringCs.borderTopWidth + " " +
      ringCs.borderTopColor + ") — the stylesheet did not apply, so everything " +
      "this guard is about to assert is about a document with none of the code " +
      "under test in it");

    // 2. AND SO IS THE SEPARATION IT REPLACED. A hairline under the banner is
    //    what Layout A puts there instead of a bar.
    const navEl = host.querySelector(".topnav");
    const navCs = getComputedStyle(navEl);
    assert(paints(navCs.borderBottomColor) && parseFloat(navCs.borderBottomWidth) > 0,
      "the banner has no hairline under it, so nothing separates it from the table");

    // 3. NOTHING HAS A GROUND. Deliberately backgroundCOLOR: an empty place is
    //    a ring whose fill is a radial-gradient, which is a background IMAGE —
    //    it is pressed into the table rather than standing on it, and it must
    //    keep passing.
    // TWO EXCLUSIONS, BOTH WITH A REASON, because "has a background" is not
    // quite "is a card" and a guard that cannot say the difference gets
    // relaxed by the first person it inconveniences.
    //
    //   A LINE IS NOT A BOX. The divider between the worn three and the carried
    //   four is a painted 1px rule — it is the separation Layout A asks FOR, so
    //   flagging it would have this guard forbid its own mechanism.
    //
    //   A POPOVER IS NOT ON THE TABLE. .celltip floats above the surface to be
    //   read over whatever is under it, and a transparent tooltip is not a
    //   tooltip. It is not part of the one plane; it is held over it.
    const isLine = (el) => {
      const r = el.getBoundingClientRect();
      return r.width <= 2 || r.height <= 2;
    };
    const painted = [navEl, ...host.querySelectorAll(".topnav *"),
                     host.querySelector(".sidebar"),
                     ...host.querySelectorAll(".sidebar *")]
      .filter(Boolean)
      .filter((el) => !el.closest(".celltip") && !isLine(el))
      .filter((el) => paints(getComputedStyle(el).backgroundColor))
      .map((el) => (el.className || el.tagName).toString().slice(0, 24) + " " +
                   getComputedStyle(el).backgroundColor);
    eq(painted.length, 0,
      "these render as cards — Layout A gives nothing a ground, and a box here " +
      "reads as a thing standing on the table rather than part of it: " +
      painted.join(" | "));
  } finally {
    host.remove();
    spriteHost.remove();
    styles.remove();
  }
}));

// 物品向上對齊 (#130): THE SEVEN OBJECTS SIT ON ONE LINE, IN BOTH LANGUAGES.
//
// The row was bottom-aligned, and the comment on it said that was how the
// objects came to stand on a common line. They do not: a blade carries an
// attack numeral, an occupied pack cell carries its Use, and the charm, the
// tablet and an empty cell carry nothing — so pinning seven stacks of unequal
// height by their feet put their middles at four heights. Measured at 1024x768
// before the fix: 102.8 / 126.6 / 126.6 / 109.4 / 109.4 / 109.4 / 135.7, which
// is a spread of 32.9px.
//
// WHY THIS RUNS TWICE, IN TWO LANGUAGES. The obvious repair is to reserve the
// hand label's height above the pack cells — and that reserve is 30.7px in
// English, where "Left hand" wraps to two lines, and 15.4px in 繁體中文, where
// 左手 does not. A constant would align whichever language it was measured in
// and drop the other by half an object: the same fault, moved. So the guard has
// to see both, and step 4 asserts the two runs really did produce different
// labels — otherwise it is one case run twice and the language half is
// decoration.
test("places: the seven objects share one line, in both languages (#130)", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html, css, sprite] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
    fetch("../css/style.css", NO_STORE).then((r) => r.text()),
    fetch("../assets/icons.svg", NO_STORE).then((r) => r.text()),
  ]);
  const styles = document.createElement("style");
  styles.textContent = css;
  const spriteHost = document.createElement("div");
  spriteHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  spriteHost.setAttribute("aria-hidden", "true");
  spriteHost.innerHTML = sprite;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const side = doc.querySelector(".sidebar");
  // The BOARD comes along, and it is the real one rather than a stub with the
  // right id in it. refresh() renders the board before it renders the panel and
  // walks straight into `el.innerHTML` on a missing #board, so something has to
  // be here; a hand-written stand-in would be a second fixture to keep true.
  const pane = doc.querySelector(".board-pane");
  const host = document.createElement("div");
  // TWO WIDTHS, AND THE SECOND ONE EARNED ITS PLACE. 300px is the sidebar
  // beside the board on a desktop, where this was reported and where an English
  // label wraps to the two lines that make the languages differ. 351px is the
  // full-width column a phone gives it — and at 351 the row has space to spare,
  // which is a different regime: the tracks open past the picture and anything
  // sized as a share of a track stops agreeing with anything sized in pixels.
  // A defect that existed only at 351 sat under this guard while it measured
  // one width, so the width is now a dimension the guard varies.
  const WIDTHS = [300, 351];
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:300px";
  document.head.appendChild(styles);
  document.body.appendChild(spriteHost);
  document.body.appendChild(host);

  const read = (lang, theme, width) => {
    host.style.width = width + "px";
    host.textContent = "";
    host.appendChild(document.importNode(pane, true));
    host.appendChild(document.importNode(side, true));
    const game = new Game({ tiles, items, search, events, theme,
                            baseTheme: theme, lang }, { seed: 5 });
    // EVERY PLACE HOLDS SOMETHING, so all seven draw a real picture and the
    // size check below has seven things to compare rather than four.
    //
    // It also takes the weapon place off its ghost, which matters more than it
    // sounds: .hand--weapon .handghost is rotated 45deg, so its rect is the
    // 1.414x envelope of its box and not its size. A real blade is not rotated.
    // The stacks stay unequal — the blade carries its attack numeral, the charm
    // and the tablet carry nothing, the cells carry their Use — which is the
    // inequality this guard's alignment half needs to exist at all.
    game.state.hands = { weapon: "peachwood-sword", charm: "protective-charm" };
    game.state.tablet = true;
    game.state.items = { "sticky-rice": 1, "cinnabar": 1,
                         "blood-talisman": 1, "golden-elixir": 1 };
    game.refresh();
    const row = host.querySelector(".places");
    assert(row, "game.html has no .places, so there is no row to align");
    const places = [...row.querySelectorAll(".hand, .cell")];
    const arts = places.map((p) => p.querySelector(".handart, .cellface"));
    const label = row.querySelector(".handlabel");
    const lr = label && label.getBoundingClientRect();
    const sep = row.querySelector(".sep");
    // EVERY NUMBER IS TAKEN NOW, WHILE THIS RUN IS STILL MOUNTED, and nothing
    // but plain data leaves this function. Holding the elements and measuring
    // them after the second language has been read gives a rect full of zeros —
    // the first run's nodes are detached by then, and a detached node reports no
    // width rather than an error. Step 1 caught exactly that while this guard
    // was being written.
    return {
      count: places.length,
      missingArt: arts.map((a, i) => (a ? null : i)).filter((i) => i !== null),
      widths: arts.map((a) => (a ? +a.getBoundingClientRect().width.toFixed(1) : 0)),
      tops: arts.map((a) => (a ? +a.getBoundingClientRect().top.toFixed(1) : null)),
      labelText: label ? label.textContent : null,
      labelH: lr ? +lr.height.toFixed(1) : null,
      // What sits UNDER each place — the numeral, the Use, or nothing at all.
      // This inequality is what the fault is made of.
      unders: places.map((p) =>
        p.querySelector(".handattack") ? "numeral"
        : p.querySelector(".cellact") ? "use" : "nothing"),
      // THE DRAWINGS THEMSELVES, not the boxes that hold them (#131). Rects
      // rather than offsetWidth, because these are SVG elements and
      // SVGElement has no offsetWidth — it reads undefined, and comparing
      // undefined with undefined passes on every layout there is.
      art: places.map((p) => {
        const a = p.querySelector(".handicon, .cellicon");
        if (!a) return null;
        const r = a.getBoundingClientRect();
        return { w: +r.width.toFixed(1), top: +r.top.toFixed(1) };
      }),
      sepH: sep ? +sep.getBoundingClientRect().height.toFixed(1) : null,
    };
  };

  try {
    assert(side, "game.html has no .sidebar, so there is no row of places");
    assert(pane, "game.html has no .board-pane — refresh() renders the board " +
      "first and would throw before reaching the places");
    const en = read("en", themeEn, 300);
    const zh = read("zh-TW", themeZh, 300);

    // 1. THE FIXTURE IS STYLED AND POPULATED. Every number below is a rect, and
    //    rects agree with each other very happily in a document that has none
    //    of the code under test in it.
    eq(en.count, 7,
      "the row drew " + en.count + " places rather than seven — either the " +
      "markup changed or the game never rendered, and a spread measured over " +
      "fewer than seven is not the thing this guard is about");
    eq(en.missingArt.length, 0,
      "places " + en.missingArt.join(", ") + " have no object box, so they have " +
      "no top to compare");
    assert(en.widths.every((w) => w > 0),
      "the objects have no width (" + JSON.stringify(en.widths) + ") — the " +
      "stylesheet did not apply, so every alignment assertion below would pass " +
      "against an unstyled document");

    // 2. THE INEQUALITY THAT CAUSES THE FAULT IS PRESENT. If every place
    //    carried the same thing underneath, the seven would line up under the
    //    old bottom-aligned rule as well, and this guard would pass on the bug.
    const kinds = new Set(en.unders);
    assert(kinds.size > 1,
      "every place carries the same thing underneath (" + [...kinds].join(", ") +
      ") — the stacks are equal, so a bottom-aligned row would satisfy this " +
      "guard too. Under each place: " + JSON.stringify(en.unders));

    // 3. THE SEVEN OBJECTS SHARE A LINE.
    for (const [name, m] of [["English", en], ["繁體中文", zh]]) {
      const spread = +(Math.max(...m.tops) - Math.min(...m.tops)).toFixed(1);
      assert(spread <= 1,
        "the seven objects sit at " + spread + "px of spread in " + name + ": " +
        JSON.stringify(m.tops) + ". They are one row of things lying on a " +
        "table, and a broken line is read before any of the objects are.");
    }

    // 3b. ONE SIZE OF THING, ACROSS ALL SEVEN (#131). The places lining up is
    //     not the same claim as the things in them being the same size, and
    //     before #131 they were not: a hand drew at 38 and a pack cell at 34.2,
    //     because one was a fixed px and the other 90% of whatever remained.
    //
    //     THAT DIFFERENCE ALSO MOVED THE PICTURES OFF THE LINE, which is the
    //     part worth keeping in this guard rather than a separate one. Two
    //     boxes can share a top and still hold their contents at different
    //     heights: both drawings are centred, so a 3.8px difference in size is
    //     a 1.9px difference in where the drawing starts — exactly half, and
    //     invisible to a guard that measures only the boxes. Equalising the
    //     size takes it to zero on its own; an offset would have been the wrong
    //     repair for it.
    const artRuns = [];
    for (const width of WIDTHS)
      for (const [lang, theme] of [["en", themeEn], ["zh-TW", themeZh]])
        artRuns.push([lang + " at " + width, read(lang, theme, width)]);
    for (const [name, m] of artRuns) {
      const drawn = m.art.filter(Boolean);
      eq(drawn.length, 7,
        name + ": only " + drawn.length + " of the seven places drew a picture, " +
        "so this is comparing a subset and would pass with a place empty");
      const ws = drawn.map((a) => a.w);
      const sizeSpread = +(Math.max(...ws) - Math.min(...ws)).toFixed(1);
      assert(sizeSpread <= 1,
        name + ": the seven pictures are drawn at " + JSON.stringify(ws) + " — a " +
        "spread of " + sizeSpread + "px. A worn thing and a carried thing are " +
        "both objects lying on the same table, and nothing states a reason for " +
        "them to differ in size.");
      const tops = drawn.map((a) => a.top);
      const topSpread = +(Math.max(...tops) - Math.min(...tops)).toFixed(1);
      assert(topSpread <= 1,
        name + ": the pictures start at " + JSON.stringify(tops) + " — a spread " +
        "of " + topSpread + "px. The BOXES agree, so this is the contents " +
        "sitting at different heights inside them, which is what a size " +
        "difference does to two centred drawings.");
    }

    // 4. AND THE TWO RUNS WERE ACTUALLY DIFFERENT. Without this, step 3 is one
    //    case run twice — same label, same heights, same layout — and the
    //    language-dependent repair it exists to rule out sails through.
    //    Under 600px the labels are visually hidden ON PURPOSE, so that case is
    //    named rather than skipped: a label that vanishes for any other reason
    //    still fails here.
    const hidden = window.matchMedia("(max-width: 600px)").matches;
    if (hidden) {
      eq(en.labelH, 0,
        "the suite is running under 600px, where the slot labels are visually " +
        "hidden by design, and yet a label still has height — the media query " +
        "and the layout disagree about what is on screen");
    } else {
      assert(en.labelText !== zh.labelText,
        "both runs rendered the same slot label (" + en.labelText + ") — the " +
        "theme never reached the label, so this checked one language twice");
      assert(en.labelH !== zh.labelH,
        "the slot label is " + en.labelH + "px tall in both languages, so the " +
        "difference that makes a fixed reserve wrong is not present in this " +
        "fixture and the two-language check is proving nothing");
    }

    // 5. THE DIVIDER IS GONE, AND ON PURPOSE (#131). This used to assert it had
    //    height, because when this guard was written it was the only thing
    //    saying which three of the seven are worn and which four are carried —
    //    and it had just silently measured 0px tall, which is why the check
    //    existed at all.
    //
    //    That job now belongs to the captions, and it is asserted in the #131
    //    guard below rather than being dropped: three worn places captioned,
    //    four carried places not. This assertion is inverted rather than
    //    deleted so that re-adding the line is a decision somebody has to make
    //    here, in front of the reasoning, instead of a change nothing notices.
    eq(en.sepH, null,
      "the divider is back between the worn three and the carried four — #131 " +
      "removed it and moved its job to the captions; if it is wanted again, " +
      "say why here and in css/style.css where the rule used to be");
  } finally {
    host.remove();
    spriteHost.remove();
    styles.remove();
  }
}));

// A PLACE IS A SIZE, NOT A SHARE (#131). Reported as two complaints — 「items
// are way too small」 and 「after using one item, other items are shrinked」 —
// which were one defect: the cells divided whatever the pack box had left, so
// the picture was a function of how much you were carrying. Spending an item
// made the survivors smaller, which is the opposite of what a place is for.
//
// #130 fixed the varying half by making the places grid tracks; this pins BOTH
// halves so neither can come back, and adds the part #130 did not address —
// that a carried picture and a worn one are the same size.
test("places: a picture is the same size whatever else you carry (#131)", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html, css, sprite] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
    fetch("../css/style.css", NO_STORE).then((r) => r.text()),
    fetch("../assets/icons.svg", NO_STORE).then((r) => r.text()),
  ]);
  const styles = document.createElement("style");
  styles.textContent = css;
  const spriteHost = document.createElement("div");
  spriteHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  spriteHost.setAttribute("aria-hidden", "true");
  spriteHost.innerHTML = sprite;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const side = doc.querySelector(".sidebar");
  const pane = doc.querySelector(".board-pane");
  const host = document.createElement("div");
  // The desktop sidebar column, which is the narrow case: seven places and six
  // gaps have to clear 300px, and it is where the pictures were smallest.
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:300px";
  document.head.appendChild(styles);
  document.body.appendChild(spriteHost);
  document.body.appendChild(host);

  // Rects, not offsetWidth: these are SVG elements and SVGElement has no
  // offsetWidth at all — reading it returns undefined, and `undefined ===
  // undefined` is a comparison that passes on every layout there is. That
  // exact vacuum was in the first draft of this guard.
  const wide = (el) => (el ? +el.getBoundingClientRect().width.toFixed(1) : null);

  // And never the weapon place: its ghost is rotated 45deg, so its rect is the
  // 1.414x envelope of the box rather than the box.
  const NOT_ROTATED = ".hand--charm, .hand--relic";

  const draw = (pack) => {
    host.textContent = "";
    host.appendChild(document.importNode(pane, true));
    host.appendChild(document.importNode(side, true));
    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 5 });
    game.state.items = pack;
    game.state.hands = { weapon: "peachwood-sword", charm: "protective-charm" };
    game.refresh();
    const filled = [...host.querySelectorAll("#hud-items .cell:not(.cell--empty)")];
    return {
      filled: filled.length,
      carried: filled.map((c) => wide(c.querySelector(".cellicon"))),
      worn: wide(host.querySelector(NOT_ROTATED + " .handicon")),
      places: [...host.querySelectorAll(".places .hand, .places .cell")]
        .map((p) => +p.getBoundingClientRect().width.toFixed(1)),
      // An empty place's ring, which is drawn with border-radius: 50% — so it
      // is a circle only while its box is square. Nothing else here would
      // notice it becoming an ellipse.
      rings: [...host.querySelectorAll(".cell--empty .cellface")].map((e) => {
        const r = e.getBoundingClientRect();
        return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
      }),
      labelled: [...host.querySelectorAll(".places .hand, .places .cell")]
        .map((p) => {
          const l = p.querySelector(".handlabel");
          return !!(l && l.textContent.trim());
        }),
      sep: host.querySelectorAll(".places .sep").length,
    };
  };

  try {
    assert(side && pane, "game.html has no .sidebar / .board-pane");

    const packs = [
      { "sticky-rice": 1 },
      { "sticky-rice": 1, "cinnabar": 1 },
      { "sticky-rice": 1, "cinnabar": 1, "blood-talisman": 1 },
      { "sticky-rice": 1, "cinnabar": 1, "blood-talisman": 1, "golden-elixir": 1 },
    ];
    const runs = packs.map(draw);

    // 1. THE PACK ACTUALLY DREW SOMETHING, at every count. Without this, "all
    //    the sizes agree" is a statement about an empty list, and every claim
    //    below passes on a pack that rendered nothing at all.
    runs.forEach((r, i) => {
      eq(r.filled, i + 1,
        "asked for " + (i + 1) + " items and the pack drew " + r.filled +
        " — this guard is measuring a pack that is not there");
      assert(r.carried.every((n) => n > 0),
        "a carried picture has no width at " + (i + 1) + " items (" +
        JSON.stringify(r.carried) + ") — the stylesheet did not apply");
    });

    // 2. ONE SIZE, WHATEVER YOU ARE CARRYING. This is the reported bug: at
    //    1/2/3/4 items the picture used to be a different size each time,
    //    because the cells divided the pack box's remainder.
    const every = runs.flatMap((r) => r.carried);
    const spread = +(Math.max(...every) - Math.min(...every)).toFixed(1);
    assert(spread <= 1,
      "a carried picture is " + spread + "px bigger with a full pack than an " +
      "empty one — measured at 1, 2, 3, 4 items: " +
      JSON.stringify(runs.map((r) => r.carried)) + ". Spending an item must " +
      "not resize the ones you keep.");

    // 3. A WORN PLACE AND A CARRIED PLACE HOLD THE SAME SIZE OF THING. Both
    //    hands are filled above, so this compares a real picture with a real
    //    picture rather than with the empty place's ghost, which correctly sits
    //    inside the ring and is a placeholder rather than an object.
    for (const [i, r] of runs.entries()) {
      assert(r.worn > 0, "the worn place drew no picture at " + (i + 1) + " items");
      assert(Math.abs(r.worn - r.carried[0]) <= 1,
        "a worn picture is " + r.worn + "px and a carried one " + r.carried[0] +
        "px — they are both things lying on the same table, and nothing states " +
        "a reason for them to differ");
    }

    // 4. And the places themselves are one width.
    const pw = runs[3].places;
    eq(pw.length, 7, "the row is not seven places");
    assert(+(Math.max(...pw) - Math.min(...pw)).toFixed(1) <= 1,
      "the seven places are not the same width: " + JSON.stringify(pw));

    // 4b. AN EMPTY PLACE IS A CIRCLE, NOT AN ELLIPSE. The ring is border-radius:
    //     50% on the face, so it is round only while the face is square — and
    //     the face's width and height come from two different places, which is
    //     exactly the arrangement that drifts. Measured on the runs that still
    //     have an empty cell, and asserted to have found one.
    const withRings = runs.filter((r) => r.rings.length);
    assert(withRings.length > 0,
      "no run left an empty pack place, so this found nothing to measure");
    for (const r of withRings)
      for (const ring of r.rings)
        assert(Math.abs(ring.w - ring.h) <= 1,
          "an empty carried place is " + ring.w + "x" + ring.h + " — with a 50% " +
          "radius on it that draws an ellipse, and the worn places next to it " +
          "are drawing circles");

    // 5. THE DIVIDER IS GONE AND ITS JOB IS STILL DONE. The rule that used to
    //    draw it argued it was the only thing saying which three places are
    //    worn and which four are carried. That argument was right, so removing
    //    the line means the captions have to carry it — and if someone later
    //    takes the captions off the worn places too, the distinction is gone
    //    with nothing left saying so. That is what this asserts.
    eq(runs[3].sep, 0, "the divider is back in the row");
    const marks = runs[3].labelled;
    eq(marks.slice(0, 3).filter(Boolean).length, 3,
      "the three worn places are not all captioned — with the divider gone " +
      "(#131) the captions are the only thing left saying which three of the " +
      "seven you are wearing and which four you are carrying");
    eq(marks.slice(3).filter(Boolean).length, 0,
      "a carried place has grown a caption, so the worn/carried asymmetry that " +
      "replaced the divider no longer reads as an asymmetry");
  } finally {
    host.remove();
    spriteHost.remove();
    styles.remove();
  }
}));

test("stage: both languages carry the stage's own strings", () => {
  for (const key of ["stage-skip"]) {
    assert((themeEn.ui || {})[key], `English is missing ui.${key}`);
    assert((themeZh.ui || {})[key], `繁體中文 is missing ui.${key}`);
    assert(themeEn.ui[key] !== themeZh.ui[key],
      `ui.${key} is identical in both languages — probably untranslated`);
  }
});

test("stage: the skip hint says what to press, not what is lost", () => {
  // "Skip" on its own reads as skipping the turn. The hint has to be about the
  // picture, because the picture is all that is being given up.
  const en = themeEn.ui["stage-skip"];
  assert(!/\bturn\b/i.test(en), `the English hint mentions the turn: ${en}`);
});

// ---- The control ---------------------------------------------------------------

test("modes: calm and fast are gone from both pages, not merely hidden", async () => {
  // #72 retired both by user ruling: default off, nothing switches them, and
  // that is expected. The switches, the preference reads and the branches all
  // went together — the opposite of #70, which was a capability the rules
  // depended on and nobody could reach. This is one nothing depends on.
  const menu = await fetch("../index.html", NO_STORE).then((r) => r.text());
  for (const gone of ["menu-calm", "menu-fast", "menu-settings-wrap", "footnote"]) {
    assert(!menu.includes('id="' + gone + '"'), "the landing page still carries " + gone);
  }
  const game = await fetch("../game.html", NO_STORE).then((r) => r.text());
  for (const gone of ["btn-fast", "btn-calm", "btn-copy-seed", "hud-attack", "hud-modes"]) {
    assert(!game.includes('id="' + gone + '"'), "the game HUD still carries " + gone);
  }
});

test("modes: a stale preference cannot strand anyone in the retired game", async () => {
  // THE LOAD-BEARING HALF. Removing the switches alone would lock anyone whose
  // browser still holds jitp:calm = "1" into the de-fanged game forever with
  // nothing left to turn it off — and the person who owns this game WAS that
  // player, three days running. So the default is authoritative rather than a
  // starting value a stale key can override: the keys are never read again.
  for (const f of ["../js/audio.js", "../js/eventstage.js", "../js/render.js",
                   "../js/app.js", "../js/menu.js"]) {
    const src = noComments(await fetch(f, NO_STORE).then((r) => r.text()));
    for (const key of ["jitp:calm", "jitp:fast"]) {
      assert(!src.includes(key), f + " still reads " + key);
    }
    for (const gate of ["isCalm(", "isFast(", "setCalm(", "setFast("]) {
      assert(!src.includes(gate), f + " still calls " + gate);
    }
  }
});

test("modes: prefers-reduced-motion survived the retirement", async () => {
  // The separate axis, and the one that remains. Calm was about intensity —
  // full animation, no faces arriving. This is about vestibular safety, it is
  // an OS setting rather than a preference this game stores, and retiring calm
  // must not have taken it along.
  const src = noComments(await fetch("../js/render.js", NO_STORE).then((r) => r.text()));
  assert(src.includes("prefers-reduced-motion"),
    "render.js no longer asks the OS about reduced motion");
  assert(stageBudgetMs({ reduced: true }) < stageBudgetMs(),
    "reduced motion no longer shortens the stage");
});

// ---- The four 僵屍 (#34) -------------------------------------------------------
// The tiers ride fightBeat rather than the event stage, because a refused
// villager becomes n=4/5/6 through it without ever passing an event beat, and
// both entrances have to escalate the same way. #97 removed the full-screen
// scare from that path: the escalation now reads on the creature panel and in
// the announcement's rhythm.

const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
const tierCss = css.slice(css.indexOf("---- The four"), css.indexOf("---- Article pages"));

// ---- Photosensitivity, read from the parsed stylesheet -------------------------
// PARSED, not scraped, and that is the whole of the #50 fix.
//
// The previous version sliced style.css between two marker strings and ran a
// hand-rolled comment stripper over the result, then looked for the words
// "infinite", "alternate" and "steps(". Every part of that was a liability:
//
//   - The slice STARTED INSIDE A COMMENT — the marker is text within the
//     "/* ---- The four" header — so the stripper was handed a fragment whose
//     comment delimiters were already unbalanced, and what it treated as code
//     depended on the comment structure of everything after it. Editing a
//     comment could change what the guard checked.
//   - It matched WORDS, so a comment saying "nothing alternates" failed the
//     build (which is how this was found) while `animation: f 1s 2 both` — a
//     genuine two-cycle flash — passed, because "2" is not one of the words.
//   - It only ever saw the slice, so a strobe inside an @media block outside
//     those markers was invisible.
//
// A CSSOM has no comments in it at all. There is nothing to strip, no slice to
// get wrong, and the properties are read after the shorthand has been expanded
// by the browser, so `animation: f .1s infinite alternate` and
// `animation-iteration-count: infinite` are the same fact rather than two
// spellings to remember.
//
// The read is deterministic: same bytes in, same rules out, no timing involved.
// No retry and no sleep anywhere near it — if this ever goes red again it is
// reporting something real.
const styleSheetText = await fetch("../css/style.css", NO_STORE).then((r) => r.text());

// Every rule that repeats, ping-pongs or steps its animation. Returns the
// offenders rather than a boolean so a failure can name what it found.
function repeatingAnimations(cssText, selectorFilter) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  const found = [];
  const walk = (rules) => {
    for (const r of rules) {
      // Dispatch on type. r.cssRules is a truthy EMPTY list on a plain style
      // rule, so branching on it recurses into nothing and silently skips every
      // rule in the sheet — which is exactly what the first draft of this did,
      // and it reported the file clean by checking none of it.
      if (r.type === CSSRule.KEYFRAMES_RULE) continue;
      if (r.type === CSSRule.MEDIA_RULE || r.type === CSSRule.SUPPORTS_RULE) {
        walk(r.cssRules);
        continue;
      }
      if (r.type !== CSSRule.STYLE_RULE || !r.style) continue;
      if (selectorFilter && !selectorFilter(r.selectorText || "")) continue;
      const s = r.style;
      const bad = [];
      // PER ANIMATION, NOT PER RULE. These properties are comma-separated LISTS
      // when an element carries more than one animation, and the first version
      // of this compared the whole list against "1" — so an element running two
      // animations, each exactly once, reported `iteration-count: 1, 1` and was
      // failed as a strobe. That is the guard reading a string where it meant to
      // read a property, and it flagged a correct rule the day one arrived.
      //
      // "1" and "" are still the only acceptable counts. Anything else runs the
      // brightness change more than once, including a plain 2.
      const each = (v) => String(v || "").split(",").map((x) => x.trim());
      for (const n of each(s.animationIterationCount)) {
        if (!["1", ""].includes(n)) bad.push("iteration-count: " + n);
      }
      if (s.animationDirection && s.animationDirection.includes("alternate")) {
        bad.push("direction: " + s.animationDirection);
      }
      // steps() is how a flicker gets written when someone wants one.
      if (s.animationTimingFunction && s.animationTimingFunction.includes("steps")) {
        bad.push("timing-function: " + s.animationTimingFunction);
      }
      if (bad.length) found.push((r.selectorText || "?") + " — " + bad.join(", "));
    }
  };
  walk(sheet.cssRules);
  return found;
}

// SCOPE, stated rather than assumed, because the first version of this test
// asserted the whole stylesheet and was WRONG. Run against every rule, it names
// twenty-seven: drifting fog, falling leaves, swaying bamboo, the dread breath
// on the board, the low-health pulse, the lantern on the title screen. Those are
// the game being alive. They loop slowly, at low amplitude, on small elements.
//
// The photosensitivity claim was never about them. It is about the FULL-SCREEN
// registers — the 僵屍 tiers, the six event scenes and the King — where a
// repeat would be a high-contrast whole-frame flash. Scoping it to those is the
// honest version; asserting the whole sheet and then carrying an allowlist of
// exceptions is how a guard turns into noise nobody reads.
//
// Worth knowing and deliberately not fixed here: .grain on the title screen runs
// steps(1) infinite. It is film grain at low opacity rather than a luminance
// flash, it predates all of this, and changing it belongs to whoever owns that
// screen rather than to a flaky-test fix.
test("photosensitivity: the guard can actually fail", () => {
  // A guard with a safety claim on it has to be shown failing, in the same run
  // that reports it passing. Three vacuous guards in this project's history is
  // three too many, and one of them was this one.
  const strobes = [
    ".x { animation: flick .1s infinite alternate; }",
    ".y { animation-name: f; animation-iteration-count: infinite; }",
    ".z { animation: f 1s steps(4) both; }",
    "@media (min-width: 1px) { .w { animation: f .2s infinite; } }",
    ".v { animation: f 1s 2 both; }",
  ];
  for (const css of strobes) {
    assert(repeatingAnimations(css, null).length > 0,
      "the guard did not catch: " + css);
  }
  // ...and does not fire on a comment that merely talks about strobing, which
  // is what the word-matching version did.
  const innocent =
    "/* nothing repeats, nothing alternates, nothing steps */\n" +
    ".ok { animation: fade .3s ease-out both; }";
  assert(repeatingAnimations(innocent, null).length === 0,
    "the guard fired on a comment or on a one-shot animation");
});

test("photosensitivity: the overlays specifically are clean", () => {
  // The same read, narrowed to the full-screen registers — the 僵屍 tiers, the
  // six event scenes and the King. A named claim per feature, so a failure says
  // which of them broke rather than only that something did.
  const overlay = (sel) =>
    sel.includes(".scare") || sel.includes(".evs-") ||
    sel.includes(".evstage") || sel.includes(".king");
  const offenders = repeatingAnimations(styleSheetText, overlay);
  assert(offenders.length === 0,
    "a full-screen overlay repeats a luminance change: " + offenders.join(" | "));
});

// NAMED FOR WHAT IT CHECKS (#100). This was "the dressing is cumulative, so the
// tiers only ever escalate" — a claim it never verified, and could not: it reads
// CSS TEXT, and escalation is a property of the class list the renderer builds.
// After #99 removed the two assertions that pinned a retired model, what is left
// is a presence check, so that is what the name says now.
//
// The name is the part a reader trusts without opening the body, which is why it
// is the part that must not promise more than the body delivers — the same rule
// that made make_zh.py's docstring worth fixing rather than the code below it.
test("scare: the tier selectors still carry styling", () => {
  // The escalation this file used to claim here — n3 is a lantern dropping, n6
  // is every candle dying, and nothing given up at a lower tier comes back at a
  // higher one — is a real design rule and is NOT checked below. Left as
  // context, marked as context. Renaming the test while leaving its opening
  // sentence asserting the same unchecked thing would have moved the problem by
  // one line.
  const tiers = ["n3", "n4", "n5", "n6"].map((t) => {
    const at = tierCss.indexOf(`.scare--${t}`);
    return at;
  });
  // The escalation itself is asserted through the class list the renderer
  // builds, not through CSS text — see the DOM test below.
  //
  // TWO ASSERTIONS REMOVED HERE by #99, with the rule they guarded. They
  // required the TEXT of `.scare--n4, .scare--n5, .scare--n6 { --zb-seal: 0 }`,
  // and the second said out loud "the 符 should be present on 白殭 alone —
  // losing it IS the escalation". That is the retired four-stage naming pinned
  // as a requirement: tier 4 wears red as a field and draws the paper, so the
  // test demanded the opposite of what the sheet draws. It passed anyway, and
  // always would have, because it read CSS text rather than anything rendered
  // — and the rule itself had been unreachable since #97.
  //
  // WHAT IS LEFT BELOW IS THIN, and the name now says so rather than the
  // comment having to apologise for it. It establishes that some tier styling
  // exists, nothing more. Escalation is not checked here and is not checkable
  // from CSS text at all — it lives in the renderer's class list, as the note
  // above says.
  assert(tiers.every((i) => i !== -1) || /scare--n/.test(tierCss), "no tier styling found");
});

test("scare: reduced motion drops the one layer that is a light changing", () => {
  assert(/\.scare--still \.scare-gutter \{ display: none; \}/.test(tierCss),
    "the candles still die under reduced motion — a light going out is motion " +
    "however gently it is done");
});

test("stage: the six scenes each build their own layers", serial(async () => {
  // A fresh module URL, because the point is to test the file on disk rather
  // than whatever this origin's module map is holding — that exact confusion
  // reported five of these scenes as the previous version's.
  const S = await import(`../js/eventstage.js?suite=${Date.now()}`);
  const built = {};
  const obs = new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType !== 1 || !n.classList || !n.classList.contains("evstage")) continue;
      const kind = [...n.classList].find((c) => c.startsWith("evstage--"));
      built[kind] = [...n.querySelectorAll("span")]
        .map((e) => e.className).filter((c) => c.startsWith("evs-")).length;
    }
  });
  obs.observe(document.body, { childList: true });
  for (const kind of S.stageKinds()) {
    const p = S.eventStage(kind, { n: 4, hp: -1 });
    await new Promise((r) => setTimeout(r, 25));
    tap();
    await p;
  }
  obs.disconnect();
  for (const kind of S.stageKinds()) {
    assert(built[`evstage--${kind}`] > 0, `${kind} built no layers — it is still a placeholder`);
  }
}));

// ---- 殭屍王 (#37) ---------------------------------------------------------------
// His own set-piece, once a night, and the one place §9 binds hardest: it plays
// immediately before the comparison the game never explains.

const appSrc = await fetch("../js/app.js", NO_STORE).then((r) => r.text());
const stageSrc = await fetch("../js/eventstage.js", NO_STORE).then((r) => r.text());
// Sliced from the comment's OPENING delimiter, not from the marker inside it.
// Starting at the marker leaves the block with a comment body and no `/*` to
// match, so the stripper below silently keeps every word it was meant to
// remove — which is exactly how this guard failed itself twice.
const kingCssAt = css.lastIndexOf("/*", css.indexOf("---- 殭屍王"));
const kingCss = css.slice(kingCssAt, css.indexOf("---- Article pages"));

test("king: §9 — the scene has nothing to say, in any language", serial(async () => {
  // The safest way to keep a secret in a scene is to give the scene no words.
  // If this ever gains text it has to be audited against §9 by hand, and this
  // test is the tripwire that forces that.
  const S = await import(`../js/eventstage.js?king=${Date.now()}`);
  {
    // Called WITH a hint on purpose: the scene has to be wordless even when it
    // is offered text, because the first version of this test passed while the
    // live scene carried 19 characters of skip chrome. kingScene takes no
    // options now, so this is structural rather than a promise.
    const p = S.kingScene({ skipHint: "press anything to go on" });
    await new Promise((r) => setTimeout(r, 40));
    const el = document.querySelector(".kingscene");
    assert(el, "the King never mounted");
    eq(el.textContent.replace(/\s+/g, ""), "", "the King's scene contains text");
    eq(el.getAttribute("aria-hidden"), "true", "the King's scene announces itself");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await p;
  }
}));

test("king: §9 — nothing in his staging references the threshold or grades a kit", () => {
  // COMMENTS ARE STRIPPED FIRST, and that is not a loophole. §9 is about what a
  // player can see; the source explaining why it must not name the threshold has
  // to be allowed to use the word, exactly as the zh rulebook guard already
  // allows the fragment that says 門檻 is reserved. Both of these tripped on
  // their own explanations the first time they ran.
  const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ");
  const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const kingJs = stageSrc.slice(stageSrc.indexOf("---- 殭屍王"), stageSrc.indexOf("---- The frame"));
  for (const [label, raw, strip] of [["css", kingCss, stripCss], ["js", kingJs, stripJs]]) {
    assert(raw.length > 300, `the King's ${label} block was not found`);
    const text = strip(raw);
    assert(!/門檻|threshold/i.test(text), `the King's ${label} names the threshold`);
    assert(!/鎮屍/.test(text), `the King's ${label} names the seal`);
    assert(!/enough|sufficien|will do it/i.test(text),
      `the King's ${label} grades the player's kit`);
    // And the rendered scene is the real test of §9 — it has no text at all,
    // which the guard above asserts against the live DOM.
  }
});

test("king: the budget is his own, and does not reopen the event scenes' tax", () => {
  // Once a night, so exempt from the thirty-times cap — but still a hard
  // deadline, because the kit question must never wait on an animation.
  assert(kingBudgetMs() <= 2500, `the King runs ${kingBudgetMs()}ms; the cap is 2500`);
  assert(kingBudgetMs({ reduced: true }) <= kingBudgetMs(),
    "reduced motion holds him longer than the full scene");
  // His budget must not have been achieved by raising everyone else's.
  eq(nightCostMs(30), 9600, "the event scenes' night tax moved");
});
test("king: nothing in his scene repeats a luminance change", () => {
  // Kept as its own named claim — the King is the one scene that plays at the
  // moment the whole night walks toward — but reading the parsed rules rather
  // than a text slice, like everything else photosensitivity now checks.
  const offenders = repeatingAnimations(styleSheetText, (sel) => sel.includes(".king"));
  assert(offenders.length === 0,
    "the King's scene repeats a luminance change: " + offenders.join(" | "));
});

test("king: he replaces the generic scare, and nothing short-circuits ahead of him", () => {
  // Comments stripped, same reason: the code says out loud that it is NOT the
  // generic announcement, and the guard was reading its own explanation.
  //
  // NAMED FOR WHAT EXISTS NOW. This asserted !/jumpScare\(1/ until #97 renamed
  // that function, at which point it would have passed because the spelling had
  // gone from the whole file rather than because the King had kept his scene.
  // A negative assertion about a name outlives the name.
  const beat = appSrc
    .slice(appSrc.indexOf("async midnightBeat()"), appSrc.indexOf("kitOptions()"))
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert(/await kingScene\(/.test(beat), "midnightBeat does not stage the King");
  assert(/announceFight/.test(appSrc),
    "announceFight is gone from app.js — this guard's next assertion would " +
    "pass on a spelling that no longer exists anywhere");
  assert(!/announceFight\(/.test(beat),
    "midnightBeat uses the ordinary fight announcement — which reads as LESS " +
    "than an ordinary doorway encounter, for the one arrival the night walks to");
  // 活水 used to return before he was ever staged — he would not cross it, so
  // there was no arrival to animate. #56 removed that rule, so the King is now
  // staged unconditionally and nothing may short-circuit ahead of him.
  assert(!/runningWater/.test(beat),
    "midnightBeat still branches on running water, which no tile has any more");
  const king = beat.indexOf("await kingScene(");
  const early = beat.indexOf("return this.gameOver()");
  assert(king !== -1 && (early === -1 || early > king),
    "he must be staged before any way out of the beat");
});

// ---- The room's voice (#41) ---------------------------------------------------
// duckForScare() takes the bed and the murmur away for a scare and unduck() puts
// them back. unduck() was called from NOWHERE, so after the first fight of any
// run the ambience stayed down for the whole night — every fight in the game
// since the fork was followed by permanent silence, which read as atmosphere.
//
// Source guards, because the audible version needs a live AudioContext and a
// user gesture. The behaviour itself was verified by spying on the gain
// automation: after a fight the bed ramps back to 0.013, and after midnight's
// duck nothing ramps at all.


test("audio: unduck() is actually called from somewhere", () => {
  // The whole bug in one line. A function that restores something and is never
  // invoked is not a safeguard, it is a comment with a body.
  const app = noComments(appSrc);
  const calls = app.split("unduck()").length - 1;
  assert(calls >= 1,
    "unduck() has no call sites — the room never comes back after a scare");
});

test("audio: the combat window gives the room back when it closes", () => {
  const beat = noComments(
    appSrc.slice(appSrc.indexOf("fightBeat(n, opts = {})"), appSrc.indexOf("kitOptions()")));
  assert(/unduck\(\)/.test(beat),
    "fightBeat never restores the ambience it ducked");
  // Closed in ONE place rather than at each exit: died-paying, the swing,
  // escape, flight and two status checks all leave through the same door, and a
  // fix that must be remembered at every return will be missed at the next one.
  assert(/const close = \(\) => \{/.test(beat),
    "the combat window has no single close — every exit has to remember to unduck");
  assert(!/paintFight\(n, opts, resolve\)/.test(beat),
    "a combat exit still resolves directly, bypassing the close");
});

test("audio: midnight keeps its silence", () => {
  // The King's room is quiet by design, and it can only MEAN that once every
  // other room stops being quiet by accident. midnightBeat ducks and never
  // restores — the silence holds through the kit prompt to the verdict.
  const beat = noComments(
    appSrc.slice(appSrc.indexOf("async midnightBeat()"), appSrc.indexOf("kitOptions()")));
  assert(/duckForScare\(\)/.test(beat), "midnightBeat no longer ducks the room");
  assert(!/unduck\(\)/.test(beat),
    "midnightBeat restores the ambience — the third watch is supposed to stay silent");
});

// ---- The pack as 田 (#48) --------------------------------------------------------

test("pack: the grid takes its cell count from the engine, not from a number here", async () => {
  // The pack has been six and is now four, and the seal-reachability question
  // could move it again. A grid that disagrees with the engine about how much
  // you can carry is worse than an ugly grid, and the way that happens is
  // someone typing the current answer into the view.
  const src = noComments(await fetch("../js/render.js", NO_STORE).then((r) => r.text()));
  const loop = src.slice(src.indexOf("function renderBackpack"), src.indexOf("function packCell"));
  assert(loop.includes("RULES.MAX_ITEMS"), "the grid does not ask the engine for the limit");
  // NOT a regex. The line here was `assert(!/i < 4\b/...)` and the
  // escape did not survive being written into this file: it arrived as a literal
  // backspace, so the pattern was "i < 4" followed by 0x08, which matches no
  // source that has ever existed. Inside assert(!...) that passes forever, so
  // this guard had never once checked what it claims to check. Plain string
  // arithmetic cannot be mangled in transit.
  for (const n of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    assert(!loop.includes("i < " + n), "the grid hard-codes " + n + " cells");
  }
});

test("pack: both languages can say a stack out loud", () => {
  // The cell is a picture now, so the count that used to live in the name text
  // has to reach a screen reader some other way.
  for (const t of [themeEn, themeZh]) {
    const said = (t.ui || {})["pack-said-many"];
    assert(said, "no string for a stack's accessible name");
    assert(said.includes("{item}") && said.includes("{n}"),
      "the stack's accessible name drops the item or the count: " + said);
  }
});


// ---- The thirteen at the size they ship (#54) ----------------------------------
// The sizes come from the stylesheet -- .itemicon for the found-item row,
// .hands{--handicon} for the equipment slot, and .cellicon as a share of the
// pack cell -- and are read there rather than written here. This header used to
// list them, and two of the three had rotted: 76 was wrong from #88, 26 from
// #90, while every assertion underneath stayed green. A number restated in
// prose has no guard on it, so the prose stops restating them.
//
// THE SMALLEST SHIPPED SIZE is the one that decides whether an icon works, and
// an icon judged at poster size is not judged at all.
//
// The weapons matter most: the replace prompt is a decision made on recognition,
// and #36 made that decision permanent — take the wrong blade and the other one
// stays on the floor for the rest of the night. So "they look different" is not
// a claim to make in a comment. It is measured here, on two axes, because an
// icon can be told apart by its outline or by its material and either is enough
// but neither on its own is guaranteed:
//
//   silhouette — fraction of pixels whose coverage differs, which is what
//                survives when detail is gone
//   colour     — mean per-pixel distance composited on the panel behind them,
//                which is what survives when the outline does not
//
// The first draft of this set failed here: three vertical blades came out 4-6%
// apart on silhouette and 13 apart on colour, because everything separating them
// was interior detail that 18px does not have room for. The measurement is what
// said so.
const ICON_SVG = await fetch("../assets/icons.svg", NO_STORE).then((r) => r.text());

async function rasterise(symbolId, px) {
  const doc = new DOMParser().parseFromString(ICON_SVG, "image/svg+xml");
  const sym = doc.getElementById(symbolId);
  if (!sym) return null;
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + sym.getAttribute("viewBox") +
    '" width="' + px + '" height="' + px + '">' + sym.innerHTML + "</svg>";
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const draw = (bg) => {
    const c = document.createElement("canvas");
    c.width = px; c.height = px;
    const x = c.getContext("2d");
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, px, px); }
    x.drawImage(img, 0, 0, px, px);
    return x.getImageData(0, 0, px, px).data;
  };
  const onPanel = draw("#1b1e24");   // --panel, what actually sits behind them
  const bare = draw(null);
  URL.revokeObjectURL(url);
  const alpha = [];
  let ink = 0;
  for (let i = 0; i < px * px; i++) {
    const on = bare[i * 4 + 3] > 96 ? 1 : 0;
    alpha.push(on); ink += on;
  }
  return { onPanel, alpha, inkPct: (100 * ink) / (px * px) };
}

const ITEM_IDS = [
  "item-precept-knife", "item-peachwood-sword", "item-coin-sword", "item-sevenstar-sword",
  "item-truefire-talisman", "item-fivethunder-talisman", "item-blood-talisman",
  "item-cinnabar", "item-soul-banner", "item-sticky-rice", "item-black-dog-blood",
  "item-golden-elixir", "item-protective-charm",
];

test("icons: all thirteen exist and draw something at the smallest shipped size", async () => {
  for (const id of ITEM_IDS) {
    const r = await rasterise(id, 18);
    assert(r, "no symbol " + id + " — the id column is the contract");
    // A blank icon and a missing icon look identical to a player, and only one
    // of them is caught by the id check above.
    assert(r.inkPct > 4, id + " draws almost nothing at 18px (" + r.inkPct.toFixed(1) + "%)");
    assert(r.inkPct < 70, id + " is a solid blob at 18px (" + r.inkPct.toFixed(1) + "%)");
  }
});

// The weapons, named once. Both the four-weapon guard and the burnt-blade guard
// below ask about the same four ids, and deriving that twice is how they drift.
const W = ITEM_IDS.slice(0, 4);

// THE SIZES ARE READ OUT OF THE STYLESHEET, NOT TYPED HERE.
//
// They were literals, with a comment explaining which element each one came
// from. Then #90 grew the equipment slot picture and the comment saying
// ".handicon is 26px" became false while every assertion still passed — art
// judged at a size it does not ship at is not judged, and a stale comment about
// it is worse than none, because the next person believes it.
//
// So: pull the numbers from the rules that set them. If someone changes a
// render size again, the measurement follows on its own.
function cssPx(needle) {
  const at = css.indexOf(needle);
  assert(at >= 0, "style.css no longer contains " + needle + " — the guard cannot find its size");
  const tail = css.slice(at + needle.length);
  const n = parseFloat(tail);
  assert(n > 0, "could not read a size from " + needle);
  return Math.round(n);
}
// The found-item row and the equipment slot set their size directly. The pack
// cell does not: .cellicon is a PERCENTAGE of a face whose width comes from the
// grid, so its pixel size is derived and the derivation is written down in
// css/style.css beside .cellicon. It is asserted against the slot below rather
// than recomputed here, because the user's ruling was that the slot picture is
// at least as big as the pack's.
const PX_FOUND = cssPx(".itemicon { width: ");
// Moved from .hands to .places with #131: a carried picture is the same size as
// a worn one now, so the token that says how big a thing in that row is belongs
// to the row rather than to one half of it.
const PX_SLOT = cssPx(".places { --handicon: ");
// PX_PACK was the literal 54, and it had been wrong for a long time. It came
// from a derivation on .cellicon that assumed a 300px sidebar with a bordered,
// padded panel — the layout Layout A removed — and the pack was actually
// rendering 30.5px under it. There is no third size now: the pack and the slot
// read the same token, which is what #131 ruled, so the honest list is two
// entries and the guard below still dedups them.
const PX_PACK = PX_SLOT;


test("icons: the four weapons stay apart at the size the choice is made", async () => {
  // Every distinct size these actually render at, read from the stylesheet
  // rather than assumed: the found-item row, the pack strip where they mostly
  // live, and the equipment slot. #54 checked only the smallest and #60 was
  // nearly redrawn for 75px, a size they stopped rendering at when the pack
  // became a strip. Both ends belong in the guard so the next person cannot
  // optimise for one of them.
  //
  // The list is deduplicated because two of those places currently render at
  // the same size, and it is sorted so the smallest is tried first -- it is the
  // one that fails.
  //
  // These were literals until #90, with a comment naming the element each came
  // from. The comment went stale the moment an element moved and the assertions
  // stayed green, which is why both the numbers and this description now point
  // at the CSS instead of copying it.
  for (const px of [...new Set([PX_FOUND, PX_PACK, PX_SLOT])].sort((a, b) => a - b)) {
    const r = {};
    for (const id of W) r[id] = await rasterise(id, px);
    for (let i = 0; i < W.length; i++) {
      for (let j = i + 1; j < W.length; j++) {
        const a = r[W[i]], b = r[W[j]];
        let differing = 0;
        for (let k = 0; k < a.alpha.length; k++) if (a.alpha[k] !== b.alpha[k]) differing++;
        const sil = (100 * differing) / a.alpha.length;
        let sum = 0;
        for (let k = 0; k < a.onPanel.length; k += 4) {
          const dr = a.onPanel[k] - b.onPanel[k];
          const dg = a.onPanel[k + 1] - b.onPanel[k + 1];
          const db = a.onPanel[k + 2] - b.onPanel[k + 2];
          sum += Math.sqrt(dr * dr + dg * dg + db * db);
        }
        const col = sum / (a.onPanel.length / 4);
        const name = W[i] + " / " + W[j] + " at " + px + "px";
        // Both floors, deliberately. A pair that is only separated by colour
        // fails anyone who cannot see the difference, and a pair only separated
        // by outline fails at a glance. Measured minima when this was written:
        // 14.2% and 28.4, across all three sizes.
        assert(sil >= 12, name + ": silhouettes only " + sil.toFixed(1) + "% apart");
        assert(col >= 25, name + ": colours only " + col.toFixed(1) + " apart");
      }
    }
  }
});

test("icons: a burnt blade reads as burning, and still reads as ITS OWN blade (#89)", async () => {
  // Before this, buffing a sword changed the NUMERAL and nothing else: the
  // equipment slot drew the same symbol whether the blade carried 真火符 or not,
  // so the only cue that your steel was on fire was a gold digit, and only if
  // you already knew gold meant something.
  //
  // THE EQUIPMENT SLOT'S SIZE ONLY, and that is not laziness: the slot is the
  // only place a burnt blade is ever drawn. Weapons left the pack in #31, and
  // the found-item row has never shown one, because a blade is burnt after it
  // is picked up rather than before.
  //
  // Read from .hands { --handicon } rather than written here. It was 26 and #90
  // made it larger; a literal would have left this comment claiming a size the
  // element no longer has, with every assertion still green.
  //
  // Deliberately NOT checked, so nobody rebuilds this as a sixteen-cell matrix:
  //   burnt-A vs burnt-B    -- cannot co-occur. One weapon, one burn.
  //   burnt-A vs unburnt-B  -- the replace prompt is text and numerals, no icons.
  //
  // TWO AXES, and the second one replaced a mistake worth recording. The first
  // draft of this guard demanded sil >= 12 between a blade and its burnt self,
  // reusing the four-weapon floor on the reasoning that a reused bar beats an
  // invented one. That was wrong, and the art proved it: the only way to move
  // 12% of the box -- 26px at the time, before #90 -- was to draw fire big
  // enough to swallow the blade, and the drawings that passed were flame blobs
  // you could not identify. A floor that destroys what it exists to protect is
  // the wrong floor.
  //
  // So: colour carries "is it burning", which is what fire actually signals and
  // what survives at the size a slot draws. And recognition is protected
  // RELATIVELY instead --
  // a burning blade must look more like itself than like any other weapon. That
  // is the real risk, it is what the flame blobs failed, and unlike an absolute
  // silhouette floor it does not punish a blade for being wide.
  for (const id of W) {
    const base = await rasterise(id, PX_SLOT);
    const burnt = await rasterise(id + "-burnt", PX_SLOT);
    assert(burnt, "no symbol " + id + "-burnt — a buffed " + id + " has no picture to draw");

    let sum = 0;
    for (let k = 0; k < base.onPanel.length; k += 4) {
      const dr = base.onPanel[k] - burnt.onPanel[k];
      const dg = base.onPanel[k + 1] - burnt.onPanel[k + 1];
      const db = base.onPanel[k + 2] - burnt.onPanel[k + 2];
      sum += Math.sqrt(dr * dr + dg * dg + db * db);
    }
    const col = sum / (base.onPanel.length / 4);
    assert(col >= 25, id + " burnt: colours only " + col.toFixed(1) + " apart — the fire does not read");

    const silTo = async (otherId) => {
      const o = otherId === id ? base : await rasterise(otherId, PX_SLOT);
      let differing = 0;
      for (let k = 0; k < burnt.alpha.length; k++) if (burnt.alpha[k] !== o.alpha[k]) differing++;
      return (100 * differing) / burnt.alpha.length;
    };
    const own = await silTo(id);
    for (const other of W) {
      if (other === id) continue;
      const away = await silTo(other);
      assert(own < away,
        id + " burnt is closer in outline to " + other + " (" + away.toFixed(1) +
        ") than to the blade it came from (" + own.toFixed(1) +
        ") — the fire has eaten the weapon");
    }
  }
});

test("icons: the item stroke rule stays thin, and stays scoped to the items", () => {
  // WHY THE PIXEL GUARDS ABOVE CANNOT SEE THIS, AND SHOULD NOT BE TAUGHT TO.
  //
  // rasterise() lifts symbol.innerHTML into a fresh svg, and the sheet's stroke
  // rule lives in a <style> BESIDE the symbols rather than inside them, so it
  // never travels. That is not an oversight waiting to be fixed. Rim-less is the
  // honest question: it asks whether these icons are distinguishable BY THEIR
  // OWN ART. The rim is one uniform treatment applied to every item, so letting
  // it into the measurement would let a gold outline rescue a weak drawing --
  // the floors would get EASIER to pass exactly as the art got worse. Measured
  // both ways: as shipped the weapons' worst pair is 18.2 / 35.6 where the guard
  // sees 12.7 / 26.6. The guard is conservative on purpose. Leave it blind.
  //
  // Which leaves the rim itself unguarded, and it reached the user once already:
  // every item shipped with a 1.5-unit gold stroke traced round every path,
  // because the line-art default outlived the line art, and no test could see
  // it. So it is guarded here instead, on the stylesheet text, from the other
  // side. Someone setting the width to 3 turns every item into a gold blob; this
  // is what stops that landing green.
  //
  // No regexes below, on purpose. The escape in a guard on this file was once
  // mangled into a literal backspace and the assertion passed forever.
  const doc = new DOMParser().parseFromString(ICON_SVG, "image/svg+xml");
  const styles = [...doc.querySelectorAll("style")].map((n) => n.textContent).join(" ");

  // Split into rules without a regex: "sel { body }" separated by braces.
  const rules = [];
  for (const chunk of styles.split("}")) {
    const cut = chunk.indexOf("{");
    if (cut < 0) continue;
    rules.push({ sel: chunk.slice(0, cut).trim(), body: chunk.slice(cut + 1).trim() });
  }
  const widthOf = (body) => {
    const at = body.indexOf("stroke-width:");
    return at < 0 ? NaN : parseFloat(body.slice(at + "stroke-width:".length));
  };

  // 1. The line-art default is still there and still 1.5. Most of this sheet is
  //    genuinely line art and lives on it -- some 1800 elements across the
  //    scenes alone, plus tiles, edges, creatures, verdicts and the rest of the
  //    UI. Thinning it THERE is the damage this guard exists to prevent.
  const base = rules.find((r) => r.sel === "symbol");
  assert(base, "the sheet has lost its line-art default rule for symbol");
  assert(widthOf(base.body) === 1.5,
    "the GLOBAL line-art stroke moved to " + widthOf(base.body) +
    " — that restyles every scene, tile and creature, not just the items");

  // 2. An item-scoped rule exists, and its width is thinner than the line-art
  //    default without being invisible. The user ruled thinner, not gone.
  const scoped = rules.find((r) => r.sel.indexOf("item-") >= 0);
  assert(scoped, "no item-scoped stroke rule — the items are back on the 1.5 line-art default");
  const w = widthOf(scoped.body);
  assert(w >= 0.2 && w <= 0.9,
    "the item stroke is " + w + ", outside the 0.2-0.9 band: below 0.2 it is gone " +
    "rather than thin, above 0.9 it is the thick rim the user asked to lose");

  // 3. THE ONE THAT MATTERS. The selector still covers exactly the items and the
  //    tablet. This fails if a symbol is renamed out of scope and silently keeps
  //    the thick rim, and it fails if the selector is broadened across the
  //    scenes -- which is the trap, because the damage there is invisible in any
  //    contact sheet of the items.
  const covered = new Set([...doc.querySelectorAll(scoped.sel)].map((n) => n.id));
  const want = new Set();
  for (const n of doc.querySelectorAll("symbol")) {
    if (n.id.indexOf("item-") === 0 || n.id === "ui-relic") want.add(n.id);
  }
  const missing = [...want].filter((id) => !covered.has(id));
  const extra = [...covered].filter((id) => !want.has(id));
  assert(missing.length === 0,
    "these still carry the thick line-art rim: " + missing.join(", "));
  assert(extra.length === 0,
    "the item stroke rule has spread beyond the items to: " + extra.join(", ") +
    " — that thins the line art the rest of the game is drawn in");
});

test("icons: an empty slot's ghost is INLINED, not referenced (#91)", () => {
  // WHAT BREAKS IF THIS STOPS HOLDING, because it is not obvious from the code.
  //
  // An empty equipment slot draws a faint OUTLINE of what belongs in it, and
  // that outline is made by CSS suppressing the drawing's fills. The suppression
  // only reaches the drawing if the symbol's children were CLONED IN. Build the
  // same ghost with <use> instead and the rule cannot cross the shadow boundary:
  // the drawing renders FULLY PAINTED, in an empty slot, looking exactly like an
  // item you are carrying and are not. Nothing throws. Nothing else fails.
  //
  // This mechanism has caught three people, twice on this panel alone -- once
  // scoping by ancestry, once by targeting children instead of inheriting, and
  // once by mistaking a dimmed painting for an outline at 54px. A thing that
  // fools everyone who touches it should not ship on a comment.
  //
  // The ghost's LOOK is deliberately not asserted, for the same reason the icon
  // suite is blind to the sheet's stroke rule: what matters is the mechanism
  // holding, not a grey landing on a value. A pixel floor here would fail on
  // rasterisation drift and teach the next person to loosen it.
  const host = document.createElement("div");
  host.style.display = "none";
  host.innerHTML = ICON_SVG;
  document.body.appendChild(host);
  try {
    // A PAINTED symbol on purpose. The line-art ones look like outlines however
    // they are built, so they cannot tell the two paths apart -- which is the
    // exact confusion that let a dimmed painting pass for a drawing.
    const ghost = ghostIcon("ui", "relic", "handghost");
    assert(ghost, "ghostIcon built nothing for ui-relic — an empty slot has no hint art");
    assert(ghost.children.length > 0,
      "the ghost is empty — nothing was cloned in, so there is no drawing to outline");
    assert(!ghost.querySelector("use"),
      "the ghost references its symbol with <use> instead of inlining it — the fill " +
      "suppression cannot reach a shadow tree, so this renders as a fully painted " +
      "item sitting in an empty slot");
  } finally {
    host.remove();
  }

  // The other half of the mechanism, asserted on the stylesheet text the way the
  // stroke-rule guard is: cloning the children achieves nothing if the rule that
  // strips their fills has gone. Together these two are the whole of it.
  const rules = [];
  for (const chunk of css.split("}")) {
    const cut = chunk.indexOf("{");
    if (cut >= 0) rules.push({ sel: chunk.slice(0, cut).trim(), body: chunk.slice(cut + 1) });
  }
  const strip = rules.find((r) => r.sel.indexOf("handghost") >= 0 && r.body.indexOf("fill:") >= 0);
  assert(strip, "no rule suppresses the ghost's fills — it will render as a painted icon");
  assert(strip.body.indexOf("fill: none") >= 0 || strip.body.indexOf("fill:none") >= 0,
    "the ghost's fill rule no longer sets none: " + strip.body.trim());
});

test("search: the pack takes the item AFTER the reveal is dismissed (#92, #96)", serial(async () => {
  // SERIAL, and it has to be. This mounts a .board-pane and a reveal, which are
  // the same single layer over the board that every stage test drives. Run
  // unqueued, it overlapped the stage suite and their runStage() called
  // clearRevealPanel() on THIS panel -- which failed as "the reveal dismissed
  // itself", a message pointing squarely at product code that was behaving
  // correctly the whole time. The stack said eventStage; the panel was
  // innocent.
  //
  // Waiting on a click rather than a timer is what exposed it: the old panel
  // was gone in 1300ms and rarely overlapped anything.
  // THE ORDER IS THE FEATURE, and it fails silently. Move refresh() back in
  // front of the reveal and the pack simply gains its cell early: no error, no
  // red, the panel still appears — and the reveal stops being news and becomes
  // a second copy of something already on screen. Nothing else in this suite
  // would notice.
  //
  // So this drives a REAL turn rather than reading doSearch for a callback. It
  // is why app.js stopped calling main() on import: a module that boots itself
  // cannot be driven, and this is the thing that had to be driven.
  //
  // Asserted in BOTH directions on purpose. "The pack has the item afterwards"
  // passes on the old behaviour too — the only assertion that can tell the two
  // apart is that the pack does NOT have it while the panel is still up.
  const names = ["tiles", "items", "search", "events", "theme"];
  const [tiles, items, search, events, theme] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );

  // The ids the search path paints into. Anything not here is a no-op renderer,
  // which is fine — the pack is what is being watched.
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML =
    '<div class="board-pane" id="board-pane"><div class="board" id="board"></div></div>' +
    '<div id="actions-pop"><div id="actions"></div></div>' +
    '<div id="hud-items"></div><div id="hud-hands"></div>' +
    '<div id="hud-hour"></div><div id="hud-health"></div>' +
    '<div class="sr-only" id="log"></div>';
  document.body.appendChild(host);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const game = new Game({ tiles, items, search, events, theme, baseTheme: theme, lang: "en" },
                          { seed: 4242 });
    // A one-entry table, so the pick is forced by the DATA rather than by
    // stubbing the engine — weightedPick has exactly one thing it can return
    // and the search RNG is left alone.
    game.state.searchTables = game.state.searchTables || {};
    game.state.searchTables.__order = [{ id: "sticky-rice", weight: 1 }];

    const filled = () =>
      document.querySelectorAll("#hud-items .cell:not(.cell--empty)").length;

    // PAINT THE BASELINE FIRST. Without this the during-reveal assertion is
    // vacuous: the pack renders nothing until the first refresh, so "no item in
    // the pack" would be true because the DOM was blank, not because the find
    // was being held back — and it would pass just as happily with refresh()
    // moved back in front of the reveal. The first draft of this test had
    // exactly that hole and it took the real numbers to see it.
    game.refresh();
    const before = filled();
    assert(before > 0, "the pack painted nothing, so this test cannot tell held-back from blank");

    game.doSearch("__order");

    // While the panel is up: the pack must still show what it showed before.
    await sleep(120);
    assert(document.querySelector(".reveal"), "no reveal appeared for a found item");
    assert(filled() === before,
      "the pack changed while the reveal was still up (" + before + " -> " + filled() +
      ") — refresh() has moved back in front of the panel, so the player is being " +
      "told something they can already see");

    // IT DOES NOT LEAVE ON ITS OWN ANY MORE (#96). Waiting well past the old
    // 1300ms budget and finding it still there is half the guard: the ruling is
    // that the player dismisses it, and a timer creeping back in would be
    // invisible except that the panel stopped waiting.
    await sleep(1600);
    assert(document.querySelector(".reveal"),
      "the reveal dismissed itself — it is supposed to wait for the player");
    assert(filled() === before,
      "the pack changed while the reveal was still waiting (" + before + " -> " + filled() + ")");

    // AND IT MUST BE DISMISSIBLE. With no timer, the click is the way out and a
    // listener that failed to attach would be a hung game rather than a
    // cosmetic bug — everything green and the player unable to continue. So
    // this asserts the way out WORKS, not that the panel looks right.
    document.querySelector(".reveal").click();
    await sleep(120);
    assert(!document.querySelector(".reveal"),
      "clicking the reveal did not dismiss it — there is no timer behind this, " +
      "so the turn cannot continue");
    assert(filled() === before + 1,
      "the pack never gained the item (" + before + " -> " + filled() +
      ") — the reveal's callback is not committing the find");
  } finally {
    host.remove();
    for (const el of document.querySelectorAll(".reveal")) el.remove();
  }
}));

test("reveal: tile-sized, no frame, and the edges reach transparent (#97)", serial(async () => {
  // THE RULING IS A SHAPE, so it is measured as one. "Looks unframed" is not
  // checkable; "the computed border width is 0 and the background's last colour
  // stop is transparent" is, and those are the two things that would silently
  // come back if someone restored the card.
  // THE STYLESHEET HAS TO BE ON THE PAGE. tests/index.html does not link it --
  // every other CSS guard here reads style.css as TEXT -- so a .reveal built in
  // this document has no styles at all and measures 900x0. The first draft of
  // this test did exactly that and reported the panel as the wrong size, which
  // is the same mistake the icon bench made: reconstructing the thing without
  // the sheet that makes it what it is.
  //
  // So the real sheet is adopted for the length of the test and taken off
  // again. That means these numbers are the ones that ship, clamp() and all,
  // rather than declarations read out of a string.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  // SNAPSHOT, not the live list. document.adoptedStyleSheets returns an
  // OBSERVABLE ARRAY, so holding the reference and assigning it back does not
  // restore anything -- by then it already contains the sheet this test added,
  // and the game's stylesheet stays adopted for every test that follows. Eight
  // copies had accumulated before anyone noticed, and what noticed was a
  // FALSIFICATION: deleting the mask rule from a copy changed nothing, because
  // a stale copy still supplied it. A guard that cannot be made to fail is not
  // yet a guard.
  const adopted = [...document.adoptedStyleSheets];
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  try {
    document.adoptedStyleSheets = [...adopted, sheet];
    const pane = host.querySelector(".board-pane");
    const el = document.createElement("div");
    el.className = "reveal";
    pane.appendChild(el);
    const cs = getComputedStyle(el);

    // The tile size is MEASURED rather than read: --tile is a clamp(), and a
    // custom property read off the root comes back as its unresolved token, so
    // parseFloat would have quietly returned the clamp's first number.
    const probe = document.createElement("div");
    probe.style.width = "var(--tile)";
    pane.appendChild(probe);
    const tile = parseFloat(getComputedStyle(probe).width);
    // SKIP, NOT FAIL (#98). --tile is a clamp on 28vh, so it resolves to
    // nothing in a pane with a zero-height window. This test then has no panel
    // to measure against — it did not run, and a run that did not happen is
    // neither a pass nor a failure.
    skipUnless(tile > 0,
      "--tile resolved to nothing: this window has zero height, so there is no " +
      "panel to measure. Not a fault in the stage — run it in a real viewport.");
    const w = parseFloat(cs.width), h = parseFloat(cs.height);
    assert(Math.abs(w - tile) <= 1 && Math.abs(h - tile) <= 1,
      `the reveal is ${Math.round(w)}x${Math.round(h)} against a ${Math.round(tile)}px ` +
      `tile — the ruling is that it is the size of the room it happened in`);

    // No frame. All four borders, because a single side coming back is exactly
    // the kind of half-revert nobody sees.
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      eq(parseFloat(cs["border" + side + "Width"]), 0,
        `the reveal grew a ${side.toLowerCase()} border — the ruling is no visible frame`);
    }
    assert(cs.boxShadow === "none",
      `the reveal has a box-shadow (${cs.boxShadow}) — a shadow draws the edge the ` +
      `border no longer does`);

    // And the edge FADES. A flat background colour would satisfy everything
    // above while still ending in a hard square line, which is the thing
    // 邊緣自然淡出 is asking not to happen.
    assert(/gradient/.test(cs.backgroundImage),
      "the reveal's ground is not a gradient, so its edges cannot fade");
    assert(/transparent|rgba\(0, 0, 0, 0\)/.test(cs.backgroundImage),
      "the reveal's gradient never reaches transparent — the square's edge is still drawn");
  } finally {
    document.adoptedStyleSheets = adopted;
    host.remove();
  }
}));

test("drop dialog: one tap reveals, a second on the SAME cell drops (#98)", serial(async () => {
  // 點兩下 — 先顯示，再確認. The user's ruling, and the property that matters is
  // not "two taps" but WHICH two: a tap on a different cell must move the
  // arming rather than commit, or a mis-aim still costs an item irreversibly.
  // That is the case this guard exists for; "the first tap does nothing" is the
  // easy half.
  const names = ["tiles", "items", "search", "events", "theme"];
  const [tiles, items, search, events, theme] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );
  const sprite = document.createElement("div");
  sprite.style.display = "none";
  sprite.innerHTML = ICON_SVG;
  document.body.appendChild(sprite);
  let close = null;
  const dropped = [];
  try {
    const game = new Game({ tiles, items, search, events, theme, baseTheme: theme, lang: "en" },
                          { seed: 13 });
    // Two distinct slots, so "a different cell" exists to be tapped.
    game.state.items = { "truefire-talisman": 3, "coin-sword": 1 };
    close = showDropDialog(game, "sevenstar-sword", {
      onDrop: (id) => dropped.push(id),
      onDropStack: (id, n) => dropped.push(id + " x" + n),
      onLeave() {} });

    const cells = [...document.querySelectorAll(".dropcell")];
    assert(cells.length >= 2,
      "this guard needs two slots to tell 'moves the arming' from 'commits'");
    const face = (i) => cells[i].querySelector(".cellface");
    const tap = (i) => face(i).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    tap(0);
    eq(dropped.length, 0, "the FIRST tap dropped the item — 先顯示 never happened");
    assert(cells[0].classList.contains("dropcell--armed"),
      "the first tap left no visible armed state, so the second tap is a mystery");
    eq(face(0).getAttribute("aria-pressed"), "true",
      "the armed state is visual only — a screen reader cannot tell the taps apart");

    tap(1);
    eq(dropped.length, 0,
      "tapping a DIFFERENT cell committed a drop — a mis-aim costs an item, which " +
      "is the whole thing the two-tap ruling exists to prevent");
    assert(!cells[0].classList.contains("dropcell--armed") &&
           cells[1].classList.contains("dropcell--armed"),
      "the arming did not move to the cell that was tapped");

    tap(1);
    eq(dropped.length, 1, "the second tap on the armed cell did not drop anything");
  } finally {
    if (close) close();
    document.querySelectorAll(".notecard").forEach((n) => n.remove());
    sprite.remove();
  }
}));

test("drop dialog: the detail covers neither the find nor the way out (#98)", serial(async () => {
  // THIS HAS BEEN GOT WRONG IN BOTH DIRECTIONS, which is why it is a test and
  // not a comment. #94 gave the cells the pack's floating .celltip, which opens
  // upward and covered the FIND they were being weighed against. #94 flipped it
  // downward, and downward covered "leave it where it is" -- the way OUT. #98
  // moved the find up beside the question and measured: upward stopped covering
  // the leave button and started covering the find again.
  //
  // A position cannot satisfy this. The detail has its own storey now, and this
  // asserts the PROPERTY rather than the position, so any future attempt to
  // float it again fails here rather than in a screenshot.
  const names = ["tiles", "items", "search", "events", "theme"];
  const [tiles, items, search, events, theme] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  // SNAPSHOT, not the live list -- adoptedStyleSheets is an observable array.
  const adopted = [...document.adoptedStyleSheets];
  const sprite = document.createElement("div");
  sprite.style.display = "none";
  sprite.innerHTML = ICON_SVG;
  document.body.appendChild(sprite);
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  let close = null;
  try {
    document.adoptedStyleSheets = [...adopted, sheet];
    const probe = document.createElement("div");
    probe.style.width = "var(--tile)";
    host.querySelector(".board-pane").appendChild(probe);
    const tile = parseFloat(getComputedStyle(probe).width);
    // SKIP, NOT FAIL: --tile is a clamp on 28vh, so a zero-height window
    // resolves it to nothing and there is no panel to measure.
    skipUnless(tile > 0,
      "--tile resolved to nothing: this window has zero height, so the dialog " +
      "has no width and every rectangle here would be empty");

    const game = new Game({ tiles, items, search, events, theme, baseTheme: theme, lang: "en" },
                          { seed: 11 });
    // A pack with a magic STACK in it, so the badge and the whole-stack label
    // are drawn too -- the widest the detail line ever gets.
    game.state.items = { "truefire-talisman": 3, "coin-sword": 1 };
    close = showDropDialog(game, "sevenstar-sword", {
      onDrop() {}, onDropStack() {}, onLeave() {} });

    const detail = document.querySelector(".dropdetail");
    const leave = document.querySelector(".dropleave");
    const found = document.querySelector(".dropfound .cellface");
    assert(detail && leave && found, "the drop dialog did not mount its three parts");

    // A floating tip would report a zero-size rect while hidden and pass this
    // vacuously, so the region is proved non-empty before anything is asserted
    // about what it does not touch.
    const box = (el) => el.getBoundingClientRect();
    assert(box(detail).width > 0 && box(detail).height > 0,
      "the detail region has no area, so 'it covers nothing' would be true of nothing");

    const overlaps = (a, b) => {
      const x = box(a), y = box(b);
      return !(x.right <= y.left || x.left >= y.right || x.bottom <= y.top || x.top >= y.bottom);
    };
    assert(!overlaps(detail, leave),
      "the item detail is drawn over 'leave it where it is' — the way out of a " +
      "modal must never be covered by a hint about what is inside it");
    assert(!overlaps(detail, found),
      "the item detail is drawn over the find — which is the thing every cell " +
      "in this dialog is being weighed against");

    // And it must actually say something, or it covers nothing by being empty.
    const first = document.querySelector(".dropcell .cellface");
    first.dispatchEvent(new MouseEvent("mouseenter"));
    assert(detail.textContent.trim().length > 0,
      "hovering a cell puts nothing in the detail region");
  } finally {
    if (close) close();
    document.adoptedStyleSheets = adopted;
    host.remove();
    sprite.remove();
  }
}));

test("reveal: it says what the thing is, from the pack's own source (#97)", serial(async () => {
  // The description was the other half of the ruling and it is the half that
  // can rot quietly: itemBlurbs is a hand-written map, and a panel reading a
  // key that is not there shows nothing at all rather than failing.
  const names = ["tiles", "items", "search", "events", "theme"];
  const [tiles, items, search, events, theme] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );
  const blurbs = theme.itemBlurbs || {};
  const ids = (items.items || items).map((it) => it.id);
  for (const id of ids) {
    assert(blurbs[id],
      `${id} has no itemBlurbs line, so its reveal panel would show a picture and a ` +
      `name with the description missing`);
  }
  // The tablet is not an item and is keyed separately. It had NO entry until
  // #97 even though the equipment slot has been reading this key since #90.
  assert(blurbs.relic,
    "itemBlurbs.relic is missing — the 神主牌 panel and the equipment slot tooltip " +
    "both read it, and both show nothing when it is absent");

  // icon() looks the symbol up with getElementById and returns NULL when it is
  // not there, so without the sprite sheet in the document this guard would
  // report "the panel shows no picture" about a panel that draws one perfectly
  // well in the game. The sheet goes in hidden and comes out again.
  const sprite = document.createElement("div");
  sprite.style.display = "none";
  sprite.innerHTML = ICON_SVG;
  document.body.appendChild(sprite);

  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  try {
    const game = new Game({ tiles, items, search, events, theme, baseTheme: theme, lang: "en" },
                          { seed: 7 });
    const id = ids[0];
    revealPanel(game, { id }, () => {});
    const el = document.querySelector(".reveal");
    assert(el, "no panel mounted");
    eq(el.querySelector(".revealblurb").textContent, blurbs[id],
      "the panel's description is not the item's blurb — it has grown a second source");
    assert(el.querySelector(".revealicon"), "the panel shows no picture");
    el.click();

    // And the tablet, which reaches the same panel without being an item.
    revealPanel(game, { sym: ["ui", "relic"], name: game.ui("relic-name"),
                        blurb: blurbs.relic, cls: "reveal--relic" }, () => {});
    const relic = document.querySelector(".reveal");
    assert(relic.classList.contains("reveal--relic"), "the tablet panel lost its class");
    eq(relic.querySelector(".revealblurb").textContent, blurbs.relic,
      "the tablet panel is not showing the relic blurb");
    const use = relic.querySelector(".revealicon use");
    assert(use && /relic/.test(use.getAttribute("href") || ""),
      "the tablet panel is not drawing the relic symbol");
    relic.click();
  } finally {
    sprite.remove();
    host.remove();
    for (const el of document.querySelectorAll(".reveal")) el.remove();
  }
}));

test("rite: taking the 神主牌 waits for the player, and adds no timer of its own (#97)", serial(async () => {
  // TWO WAYS TO GET THIS WRONG and only one of them is visible. Forgetting the
  // panel is obvious the moment anyone plays. Keeping wait(RESULT_BEAT_MS)
  // alongside it is not: the rite would resolve on whichever finished LAST, so
  // a player who clicked quickly would still sit through the leftover beat and
  // a slow one would never notice the timer at all. This asserts the rite is
  // still unresolved well past that beat, which is the only way to tell.
  const src = await fetch("../js/app.js", NO_STORE).then((r) => r.text());
  const cut = (text) => {
    const r = text.slice(text.indexOf('goal === "TAKE_TABLET"'));
    return r.slice(0, r.indexOf("\n    }"));
  };
  const body = cut(src);
  // NEGATIVE ASSERTIONS READ THE CODE ONLY. The comment above this rite says
  // in so many words that wait(RESULT_BEAT_MS) is gone, and the first draft of
  // this guard went red on that sentence -- the fourth guard in this file to
  // fail on its own explanation, which is what noComments() exists for.
  const code = cut(noComments(src));
  assert(/revealPanel\(/.test(code), "the rite no longer opens the reveal panel");
  assert(!/wait\(RESULT_BEAT_MS\)/.test(code),
    "the rite still waits a fixed beat as well as the panel — the two race, and " +
    "whether the tablet waits for the player depends on how fast they click");
  // The ruling that survived #97 unchanged, and the reason it is easy to lose:
  // the panel makes the tablet LOOK exactly like a find.
  assert(/NOT counted as an item found/.test(body),
    "the comment explaining why the tablet is not counted as an item found is gone");
  assert(!/noteFound\(\)/.test(code),
    "the rite now counts the tablet as an item found — it has its own verdict row");
  // THE TITLE, not the inline noun. theme.words.relic is "tablet", for the
  // middle of a sentence; theme.ui.relic-name is "神主牌 Ancestral Tablet",
  // which is what the equipment slot titles it with and what every item name on
  // this panel looks like. word("relic") put a lowercase "tablet" under the
  // picture and looked like a missing string rather than a wrong one.
  //
  // THE PANEL'S name FIELD ONLY. The first draft forbade word("relic") anywhere
  // in the rite and went red on the CAPTION, which is the one place the inline
  // noun belongs -- "Among the coffins, the tablet." Both strings are correct
  // here; what matters is which one goes where.
  assert(/name: this\.ui\("relic-name"\)/.test(code),
    "the tablet panel is not titled from ui.relic-name — words.relic is the inline " +
    "noun for the middle of a sentence, and under the picture it reads as a " +
    "missing string rather than a name");
}));

test("stage: the tile panel has no edge, and is not darker than the room (#98)", serial(async () => {
  // "我只看到一個黑框" -- I only see a black box. #95 removed the panel's
  // BORDER, which was not the same thing as removing its EDGE: every scene's
  // first call paints a full-bleed ground, so the panel drew a hard-edged
  // rectangle regardless. Worse, that ground reaches OPAQUE --film-ink, so the
  // room the event was happening in came out darker than the room next door
  // where nothing was happening.
  //
  // Both halves are asserted because either alone leaves the box: a mask over
  // an opaque fill is a black circle, and a lightened fill with a hard edge is
  // still a rectangle.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  // SNAPSHOT, not the live list. document.adoptedStyleSheets returns an
  // OBSERVABLE ARRAY, so holding the reference and assigning it back does not
  // restore anything -- by then it already contains the sheet this test added,
  // and the game's stylesheet stays adopted for every test that follows. Eight
  // copies had accumulated before anyone noticed, and what noticed was a
  // FALSIFICATION: deleting the mask rule from a copy changed nothing, because
  // a stale copy still supplied it. A guard that cannot be made to fail is not
  // yet a guard.
  const adopted = [...document.adoptedStyleSheets];
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  try {
    document.adoptedStyleSheets = [...adopted, sheet];
    const pane = host.querySelector(".board-pane");

    const el = document.createElement("div");
    el.className = "evstage evstage--nothing evstage--tile";
    const ink = document.createElement("div");
    ink.className = "evs-ink";
    el.appendChild(ink);
    pane.appendChild(el);

    const cs = getComputedStyle(el);
    const mask = cs.maskImage && cs.maskImage !== "none" ? cs.maskImage : cs.webkitMaskImage;
    assert(mask && mask !== "none",
      "the tile-sized event panel has no mask, so its layers reach its square edge " +
      "and it reads as a box laid over the board");
    assert(/transparent|rgba\(0, 0, 0, 0\)/.test(mask),
      "the panel's mask never reaches transparent, so the edge is still drawn");

    // THE GROUND IS A WASH, NOT A FILL. A colour with no alpha at the far stop
    // is an opaque rectangle, which is the half of this that a mask cannot save.
    const bg = getComputedStyle(ink).backgroundImage;
    const stops = bg.match(/(rgba?|color)\([^)]*\)/g) || [];
    assert(stops.length > 0, "could not read the ground's colour stops from: " + bg);
    const opaque = stops.filter((st) => !/[/,]\s*0?\.\d+\s*\)$/.test(st));
    assert(opaque.length === 0,
      "the event ground is opaque on a tile (" + opaque.join(" ") + ") — over one " +
      "room that is a filled black square, and the room next door stays brighter " +
      "than the one where something is happening");
  } finally {
    document.adoptedStyleSheets = adopted;
    host.remove();
  }
}));

test("stage: the full-screen stage keeps its ground (#98)", serial(async () => {
  // The other direction, and the one a sweep would break. The King is the one
  // stage that is NOT on a tile: across a letterboxed window an opaque ground IS
  // the room going dark, and it is right there. Masking him, or lightening his
  // ground, would take the set-piece apart to fix a problem he does not have.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  // SNAPSHOT, not the live list. document.adoptedStyleSheets returns an
  // OBSERVABLE ARRAY, so holding the reference and assigning it back does not
  // restore anything -- by then it already contains the sheet this test added,
  // and the game's stylesheet stays adopted for every test that follows. Eight
  // copies had accumulated before anyone noticed, and what noticed was a
  // FALSIFICATION: deleting the mask rule from a copy changed nothing, because
  // a stale copy still supplied it. A guard that cannot be made to fail is not
  // yet a guard.
  const adopted = [...document.adoptedStyleSheets];
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  document.body.appendChild(host);
  try {
    document.adoptedStyleSheets = [...adopted, sheet];
    const el = document.createElement("div");
    el.className = "evstage kingscene";
    const ink = document.createElement("div");
    ink.className = "evs-ink";
    el.appendChild(ink);
    host.appendChild(el);
    const cs = getComputedStyle(el);
    const mask = cs.maskImage && cs.maskImage !== "none" ? cs.maskImage : cs.webkitMaskImage;
    assert(!mask || mask === "none",
      "the full-screen stage has been masked — the tile treatment has leaked onto " +
      "the one scene whose whole point is that it fills the window");
    const bg = getComputedStyle(ink).backgroundImage;
    assert(/rgb\(5, 6, 10\)|color\(srgb 0\.0196078 0\.0235294 0\.0392157\)/.test(bg),
      "the full-screen ground is no longer opaque --film-ink: " + bg);
  } finally {
    document.adoptedStyleSheets = adopted;
    host.remove();
  }
}));

test("stage: both tile panels dissolve at the same radius (#98)", serial(async () => {
  // The relationship the comment in style.css asks for. The two panels fade by
  // DIFFERENT mechanisms on purpose — the reveal paints a colour wash, the
  // event panel wears an alpha mask — so nothing in the cascade makes them agree
  // and only this does. A comment asking two numbers to match is a comment that
  // is one edit away from being false.
  const pct = (decl, what) => {
    const at = css.indexOf(decl);
    assert(at >= 0, "style.css no longer contains " + decl);
    const tail = css.slice(at, at + 400);
    const m = tail.match(/transparent\s+(\d+)%/);
    assert(m, "no transparent stop found for " + what + " in: " + tail.slice(0, 120));
    return Number(m[1]);
  };
  const edge = pct("--tile-edge:", "the event panel's mask");
  const reveal = pct("background: radial-gradient(circle at 50% 48%", "the reveal's wash");
  assert(Math.abs(edge - reveal) <= 6,
    `the two tile panels dissolve at different radii (mask ${edge}%, reveal ${reveal}%) — ` +
    `a scene and a find should melt into the room the same way`);
}));

// ---- The creature panel (#94) -------------------------------------------------
// TWO PROPERTIES THAT FAIL INVISIBLY, and the branch shipped without either.
// 345 passed before the panel existed and 345 passed after it, which means green
// said "nothing else broke" rather than "this works" — and both of these were
// broken at the time.
//
// Neither is observable at rest, which is the point. The panel measures
// perfectly still and both faults appear only once resolveBeat's keyframes
// apply, so a static check of geometry, colour and stacking passes over them.
// The animation clock does not advance in a hidden tab either, so waiting does
// not show them: the currentTime has to be SET.
test("creature panel: the turned villager leaves, and the creature stays centred (#94)",
     serial(async () => {
  const sprite = document.createElement("div");
  sprite.style.display = "none";
  sprite.innerHTML = ICON_SVG;
  document.body.appendChild(sprite);
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const adopted = [...document.adoptedStyleSheets];
  try {
    document.adoptedStyleSheets = [...adopted, sheet];
    document.documentElement.style.setProperty("--tile", "360px");

    creaturePanel(4, { turnedFrom: 1 });
    const panel = document.querySelector(".creature");
    assert(panel, "no creature panel was mounted");

    // ONE FIGURE resolveBeat will animate. The villager the panel opens as must
    // not still be wearing the class resolveBeat collects, or the man who has
    // just stopped being a person comes back and topples a second time — and
    // two figures also trip the pack-stagger branch, giving a crowd's cadence
    // to one creature.
    const collected = panel.querySelectorAll(".creature-art");
    eq(collected.length, 1,
       "the turned path leaves " + collected.length + " elements under .creature-art; " +
       "resolveBeat animates every one it finds, so anything but the creature itself " +
       "gets felled alongside it");

    // AND THE CENTRING SURVIVES THE STRIKE. resolveBeat's fell keyframes open
    // with a bare translateY(0), which REPLACES the transform property — so any
    // centring living in transform is discarded on the animation's first frame.
    // FINISH THE ENTRANCE FIRST. The clock does not advance in a hidden tab, so
    // without this the entrance sits frozen on its opening scale and the fell
    // keyframes replace THAT — a jump the real game never sees, because by the
    // time a fight can resolve the entrance is long over. Three separate false
    // readings came out of this harness before the setup was right, and every
    // one of them looked like a finding.
    for (const el of panel.querySelectorAll(".creature-art, .creature-was")) {
      for (const an of el.getAnimations()) an.finish();
    }
    const art = collected[0];
    const before = art.getBoundingClientRect();
    resolveBeat({ icon: "item-sevenstar-sword" });
    let seeked = 0;
    for (const an of art.getAnimations()) {
      const kf = (an.effect.getKeyframes()[0] || {}).transform || "";
      // THE FIRST ACTIVE FRAME, and currentTime INCLUDES the delay — seeking to
      // a small absolute number lands inside it, where no keyframe applies and
      // the check passes without exercising anything. At the first active frame
      // the keyframe is translateY(0) rotate(0) and intends no motion at all,
      // so any displacement there is centring being overwritten. Later frames
      // move the creature legitimately: it is falling over.
      if (kf.indexOf("translateY") === 0) {
        an.currentTime = an.effect.getTiming().delay || 0;
        an.pause();
        seeked++;
      }
    }
    // The guard must not pass by finding nothing to check.
    eq(seeked, 1, "no fell animation was attached to the creature, so this test " +
                  "would have passed without exercising anything");
    const after = art.getBoundingClientRect();
    const moved = Math.max(Math.abs(after.left - before.left), Math.abs(after.top - before.top));
    // Falsified both ways before being trusted: with the villager left under
    // .creature-art the count is 2, and with the pre-fix transform centring
    // restored this measures 111px on a 360 tile.
    assert(moved < 4,
      "the creature jumped " + Math.round(moved) + "px on the first frame of the strike; " +
      "its centring is being overwritten by the fell keyframes rather than surviving them");
  } finally {
    document.documentElement.style.removeProperty("--tile");
    clearCreaturePanel();
    document.adoptedStyleSheets = adopted;
    host.remove();
    sprite.remove();
  }
}));

test("scenes: 中毒, -1 and +1 each have a subject, and it is their own (#90)", serial(async () => {
  // WHAT IS GUARDED HERE IS THE MECHANISM, NOT THE DRAWING. Whether a picture
  // is recognisable is perceptual, and a test claiming to measure that would be
  // measuring something else and reporting it as recognition. These four
  // properties are the ones that fail INVISIBLY -- each of them turns the
  // subject off while leaving a scene that still mounts, still animates and
  // still passes everything else in this file.
  //
  // And the instrument is deliberately NOT pairwise separability, which settled
  // the icons. That asks "are these two different" with both pictures present.
  // A player sees one scene, once, for about a second, with nothing to compare
  // it against; poison and mend already passed that test on the day the user
  // reported they could not tell them apart.
  const sprite = document.createElement("div");
  sprite.style.display = "none";
  sprite.innerHTML = ICON_SVG;
  document.body.appendChild(sprite);
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const adopted = [...document.adoptedStyleSheets];
  try {
    document.adoptedStyleSheets = [...adopted, sheet];

    // The opaque radius of the panel's mask, read from the stylesheet rather
    // than copied here: --tile-edge holds full black to its second stop and is
    // gone by the last. Anything outside the first number is being faded, and
    // anything outside the last is simply not on screen.
    const edge = css.slice(css.indexOf("--tile-edge:"), css.indexOf("--tile-edge:") + 260);
    const opaquePct = Number((edge.match(/#000\s+(\d+)%/g) || []).pop().match(/(\d+)%/)[1]);
    assert(opaquePct > 0, "could not read the mask's opaque radius from --tile-edge");

    const seen = {};
    for (const kind of ["hurt", "mend", "poison"]) {
      const done = eventStage(kind, { n: 3, hp: -1 });
      const el = document.querySelector(".evstage");
      assert(el, kind + ": no stage mounted");
      const artNode = el.querySelector("svg.evstage-art");
      assert(artNode, kind + " has no subject — it is a light wash again, and a wash " +
        "is weather rather than an event");
      const use = artNode.querySelector("use");
      seen[kind] = use && use.getAttribute("href");

      // VISIBLE AT REST. A first keyframe at opacity 0 renders the subject
      // invisible until the animation ADVANCES, and animations do not advance
      // in a hidden tab. Nine known members of that family before these three.
      for (const n of [artNode, artNode.parentElement])
        for (const a of n.getAnimations()) { try { a.currentTime = 0; a.pause(); } catch (e) {} }
      eq(getComputedStyle(artNode).opacity, "1",
        kind + "'s subject starts transparent, so it is invisible in any frame the " +
        "animation has not reached");
      eq(getComputedStyle(artNode.parentElement).opacity, "1",
        kind + "'s seat starts transparent");

      // INSIDE THE MASK. The panel fades to nothing before its edge, so a
      // subject sized like the villager's would have its corners eaten. The
      // half-diagonals compare with the root-two cancelling on both sides,
      // which is why this reduces to a width against the opaque fraction.
      const pw = parseFloat(getComputedStyle(el).width);
      const aw = parseFloat(getComputedStyle(artNode).width);
      // SKIP, NOT FAIL (#98). Same cause as the reveal test: with a zero-height
      // window the panel and the subject both measure zero and there is nothing
      // to compare.
      skipUnless(pw > 0 && aw > 0,
        kind + ": panel and subject both measure zero — this window has no size, " +
        "so the comparison cannot run. Not a fault in the stage.");
      assert(aw <= pw * (opaquePct / 100),
        `${kind}'s subject is ${Math.round(aw)}px in a ${Math.round(pw)}px panel, outside ` +
        `the mask's ${opaquePct}% opaque radius — its edges are being faded away`);

      // Removing the node does not resolve the promise: the stage waits for a
      // tap now, and its listener is on the window rather than on the node.
      el.remove();
      tap();
      await done;
    }

    // THREE SYMBOLS, NOT ONE RECOLOURED. The load-bearing assertion: if these
    // share a drawing then hue carries the whole burden of telling them apart,
    // and hue alone is exactly what failed. Getting better and being poisoned
    // are opposite outcomes and must not be one picture in two colours.
    const ids = Object.values(seen);
    assert(ids.every(Boolean), "a scene's subject draws no symbol: " + JSON.stringify(seen));
    eq(new Set(ids).size, 3,
      "the three scenes share a drawing (" + JSON.stringify(seen) + ") — hue is then the " +
      "only thing between 中毒 and +1, which is the failure this replaced");
  } finally {
    document.adoptedStyleSheets = adopted;
    host.remove();
    sprite.remove();
    for (const el of document.querySelectorAll(".evstage")) el.remove();
  }
}));

test("scenes: nothing stays a wash, and it is the control (#90)", serial(async () => {
  // THE ONE THAT MUST NOT GAIN A SUBJECT. Its own comment argues harder about
  // it than about anything else in the file: the room simply watches, and it is
  // the scene most easily mistaken for the game having failed — which is
  // literally what happened when it was a black box. It is fixed now by being
  // LIGHTER, not by having something put in it.
  //
  // It is also the control for the three above: they share every layer with it,
  // so if a change to ink, fog or grain breaks something, this is where it
  // shows first without a subject to hide behind.
  const sprite = document.createElement("div");
  sprite.style.display = "none";
  sprite.innerHTML = ICON_SVG;
  document.body.appendChild(sprite);
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  try {
    const done = eventStage("nothing", {});
    const el = document.querySelector(".evstage");
    assert(el, "nothing did not mount");
    assert(!el.querySelector("svg.evstage-art"),
      "the nothing scene has gained a subject — an event that is defined by nothing " +
      "arriving must not have something arrive in it");
    assert(el.querySelector(".evs-candle") && el.querySelector(".evs-watch"),
      "the nothing scene lost the candle or the watch, which are what it IS");
    el.remove();
    tap();
    await done;
  } finally {
    host.remove();
    sprite.remove();
    for (const el of document.querySelectorAll(".evstage")) el.remove();
  }
}));

test("stage: the event's line is on the panel and NOT floating above the board (#94)", serial(async () => {
  // 浮在棋盤上方的字幕列 — the floating line above the board goes. The panel draws
  // these words under the scene now, so tell()'s caption would put the same
  // sentence on the board twice, 392px apart, for the 4200ms a caption lives.
  //
  // WHAT THIS MUST NOT BECOME is a check that caption() is gone. tell() is
  // called at nineteen sites in app.js and this is the ONLY one whose words
  // have another visible carrier; deleting the mechanism would turn the other
  // eighteen screen-reader-only, which is the condition that made a search
  // result invisible and started this whole run of panels. So this asserts the
  // narrow thing: the event line reaches log() and the panel, and not caption().
  const src = await fetch("../js/app.js", NO_STORE).then((r) => r.text());
  const beat = noComments(src.slice(src.indexOf("async eventBeat(")));
  // From AFTER this method's own "async ", not from the first one in the slice
  // -- which is at index 0, so the body came out EMPTY and the negative
  // assertion below passed against nothing. The positive assertion is what
  // caught it, which is the argument for always pairing them.
  const body = beat.slice(0, beat.indexOf("async ", 8));
  assert(body.length > 100, "the eventBeat slice is empty, so nothing below is being checked");
  assert(!/this\.tell\(this\.eventLine/.test(body),
    "the event line still goes through tell(), so it is drawn over the board as well " +
    "as on the panel — the same sentence twice");
  assert(/log\(line\)/.test(body),
    "the event line no longer reaches log() — a screen reader would lose the beat " +
    "entirely, since the panel is aria-hidden");
  assert(/line: this\.eventLine\(ev\)/.test(noComments(src)),
    "the panel is not being given the line to draw");

  // And caption() itself is untouched, because eighteen other moments need it.
  assert(/export function caption/.test(
    await fetch("../js/render.js", NO_STORE).then((r) => r.text())),
    "caption() has been deleted — eighteen tell() sites have no other visible carrier");

  // The panel really draws it, and hides it from a screen reader the way the
  // caption did: log() has already said these words in a live region.
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div class="board"></div></div>';
  document.body.appendChild(host);
  try {
    const p = eventStage("nothing", { line: "The floorboards settle." });
    await new Promise((r) => setTimeout(r, 30));
    const el = document.querySelector(".evstage");
    const ln = el.querySelector(".evstage-line");
    assert(ln, "the panel drew no line");
    eq(ln.textContent, "The floorboards settle.", "the panel drew the wrong words");
    eq(ln.getAttribute("aria-hidden"), "true",
      "the panel's line is announced as well as logged — the same sentence twice");
    tap();
    await p;
  } finally {
    host.remove();
    for (const el of document.querySelectorAll(".evstage")) el.remove();
  }
}));

// ---- The sprite sheet itself (#65) ---------------------------------------------

test("icons: the sprite sheet is well-formed XML", () => {
  // It was NOT, for four landings. A comment in the King's symbol read
  // "--king-face", and an XML comment may not contain a double hyphen, so a
  // strict parser stopped at that line and silently dropped everything after
  // it — 42 of 94 symbols, including the King and every 僵屍 tier.
  //
  // The game never showed it: the sheet is injected as HTML, and the HTML
  // parser forgives what the XML parser will not. What DID show it was my own
  // icon test quietly passing, because item-* happens to sit above the broken
  // line and so was the only part of the file being tested at all.
  //
  // This is the guard for the whole class: parse it strictly, and count what
  // came out.
  const doc = new DOMParser().parseFromString(ICON_SVG, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  assert(!err, "icons.svg is not well-formed: " +
    (err ? err.textContent.replace(/\s+/g, " ").slice(0, 160) : ""));
  const symbols = doc.querySelectorAll("symbol").length;
  assert(symbols >= 90,
    `only ${symbols} symbols parsed — the sheet is being truncated by a parse error`);

  // NO SYMBOL INSIDE ANOTHER SYMBOL. Well-formed is not the same as correct,
  // and this file has now proved it twice from opposite directions: once a
  // double hyphen made a valid comment illegal, and once king-figure's closing
  // tag simply sat in the wrong place, so scare-n3 through scare-n6 parsed as
  // its CHILDREN. The document was flawless XML and every check anyone had
  // asked of it passed.
  //
  // Nothing rendered wrong either, because a symbol is only ever drawn through
  // a use and ids stay reachable across the document. It had no symptom at all
  // until someone tried to scope a rule to the King — at which point a selector
  // naming exactly one id would have repainted every 僵屍 a player fights,
  // because the damage is downstream of the match rather than in it.
  //
  // TESTED BY THE PARENT'S TAG, not by depth. Depth cannot tell a symbol inside
  // <defs> from a symbol inside another symbol, and a depth test reports this
  // sheet clean.
  const nested = [...doc.querySelectorAll("symbol")]
    .filter((n) => n.parentNode && n.parentNode.closest && n.parentNode.closest("symbol"))
    .map((n) => n.getAttribute("id"));
  eq(nested, [],
    "these symbols are nested inside another symbol, so any rule scoped to the " +
    "outer one silently reaches them: " + nested.join(", "));

  // THE SHAPE COUNT THAT USED TO SIT HERE IS GONE, and removing it is the
  // point rather than a concession. It asserted king-figure carried fewer than
  // N shapes, as a blunt second signal for the nesting fault above — the count
  // is what made that fault visible, at 70 against his 14.
  //
  // It then failed TWICE on correct commits, once at 37 and once at 93, both
  // times because he was legitimately redrawn denser. A bound calibrated to the
  // SUBJECT fires whenever the subject changes, and the only available response
  // is to raise it; do that twice and everyone learns to raise it unread, which
  // is worse than no guard because it still looks like protection.
  //
  // Raising it a third time would have been capitulation. The assertion above
  // catches the fault EXACTLY — no symbol may have a symbol for an ancestor —
  // so the proxy was never adding information, only noise. When an exact
  // assertion exists, a proxy for the same fault is a liability.
});

test("icons: each 僵屍 tier has its own artwork", () => {
  // #45 restaged the room around a sprite nobody redrew: every tier drew the
  // same #scare-zombie, so six copies of one head was what reached the screen.
  // Four tiers, four symbols, and none of them the same markup.
  const doc = new DOMParser().parseFromString(ICON_SVG, "image/svg+xml");
  const bodies = [];
  for (const tier of ["n3", "n4", "n5", "n6"]) {
    const sym = doc.getElementById("scare-" + tier);
    assert(sym, "no artwork for " + tier);
    bodies.push(sym.innerHTML.replace(/\s+/g, ""));
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      assert(bodies[i] !== bodies[j], "two tiers share the same artwork");
    }
  }
});
// ---- 真火符 into the blade (#70) -------------------------------------------------
// The engine could always do this and no button reached it, so the one loadout
// that seals the King could not be assembled by a person. BE measured the hole
// rather than arguing it: with the buff neutered across 800 identical seeds,
// seals went 91 to 0. Not fewer — none.
//
// These test that the affordance is REACHABLE, which is a different claim from
// "the code is present". Every one of them drives the actual rendered control:
// finds the button a player would find, reads what it says, and presses it.
//
// No backslash escapes in this block. They have twice failed to survive the
// trip into a test file here, once turning a negative assertion into one that
// could never fail.

// A fresh module graph per call, so registering the pack handler cannot leak
// into the copy of render.js the rest of this suite is holding.
async function packFixture(build) {
  const q = "?buff=" + Date.now() + Math.random();
  const E = await import("../js/engine.js" + q);
  const R = await import("../js/render.js" + q);
  const [theme, items] = await Promise.all([
    fetch("../data/theme.json", NO_STORE).then((r) => r.json()),
    fetch("../data/items.json", NO_STORE).then((r) => r.json()),
  ]);
  let host = document.getElementById("hud-items");
  let borrowed = false;
  if (!host) {
    host = document.createElement("div");
    host.id = "hud-items";
    document.body.appendChild(host);
    borrowed = true;
  }
  const pressed = [];
  // BEFORE the first render, on purpose: the control disables itself when no
  // handler is registered, so registering late makes an enabled button look
  // disabled. That caught me once while writing this.
  R.onPackUse((id) => pressed.push(id));
  const state = E.newGame({ seed: 7, items });
  build(E, state);
  const game = { state, data: { theme } };
  const button = () => {
    R.renderHud(game);
    return [...host.querySelectorAll("button.cellact")]
      .find((b) => (b.getAttribute("aria-label") || "").includes("True Fire"));
  };
  const done = () => { if (borrowed) host.remove(); };
  return { E, R, game, state, button, pressed, done };
}

test("真火符: bare-handed, the control says why rather than going quiet", serial(async () => {
  const f = await packFixture((E, s) => E.pickUpItem(s, "truefire-talisman"));
  try {
    const b = f.button();
    assert(b, "the 真火符 cell has no control at all");
    assert(b.disabled, "the burn was offered with nothing to burn it into");
    eq(f.R.buffState(f.game).why, "no-sword", "wrong reason");
    // A dead control with no reason is the thing #53 was filed over.
    assert(b.title.length > 8, "the disabled control gives no reason: " + b.title);
  } finally { f.done(); }
}));

test("真火符: with a blade in hand the control is offered, and pressing it burns", serial(async () => {
  const f = await packFixture((E, s) => {
    E.pickUpItem(s, "sevenstar-sword");
    E.pickUpItem(s, "truefire-talisman");
  });
  try {
    const b = f.button();
    assert(b && !b.disabled, "the burn is not offered with a sword in hand and paper in the pack");
    // Its own verb. A fight card says "Burn the 真火符" and means throw it at
    // them; this one keeps it. Sharing a word is what #68 was filed over.
    assert(b.textContent !== "Use", "the control does not say what it does");
    const said = b.getAttribute("aria-label");
    assert(said.includes("Seven-Star Sword"), "it does not name the blade: " + said);

    eq(f.E.effectiveAttack(f.state), 3, "七星劍 should start at 3");
    b.click();
    eq(f.pressed, ["truefire-talisman"], "pressing it did not reach the pack handler");
    // The handler is app.js's; this suite has the engine call it makes.
    const out = f.E.buffSword(f.state, f.E.bestSword(f.state));
    assert(out.ok, "the engine refused a burn the control had offered");
    eq(f.E.effectiveAttack(f.state), 4, "the blade did not keep the fire");
    assert(!f.E.held(f.state, "truefire-talisman"), "the paper was not spent");
  } finally { f.done(); }
}));

test("真火符: a blade takes one only, and the second says so", serial(async () => {
  // Reachable only while holding a SECOND paper — burning consumes the first,
  // so this state needs two, which 硃砂 also produces.
  const f = await packFixture((E, s) => {
    E.pickUpItem(s, "sevenstar-sword");
    E.pickUpItem(s, "truefire-talisman");
    E.pickUpItem(s, "truefire-talisman");
  });
  try {
    f.button();
    f.E.buffSword(f.state, f.E.bestSword(f.state));
    eq(f.E.heldCount(f.state, "truefire-talisman"), 1, "the second paper should survive the first burn");
    const b = f.button();
    assert(b && b.disabled, "a second 真火符 was offered to a blade that already carries one");
    eq(f.R.buffState(f.game).why, "already", "wrong reason");
    assert(b.title.length > 8, "the ceiling is enforced without saying so");
  } finally { f.done(); }
}));

test("真火符: the control the pack offers is the one app.js wires to the engine", async () => {
  // The three tests above stop at the pack handler, because the handler belongs
  // to app.js. This is the join: the id the button sends is the id app.js routes
  // to buffSword.
  //
  // COMMENTS STRIPPED FIRST, and that is load-bearing rather than tidy. BE hit
  // exactly this shape from the other side: the paragraph most likely to
  // contain the text "buffSword(" is the comment EXPLAINING the call, and a
  // scan that counts a comment as a call would pronounce the capability
  // reachable while the game was still unwinnable. A grep for a call has to
  // look at code only.
  const app = noComments(await fetch("../js/app.js", NO_STORE).then((r) => r.text()));
  const cut = app.indexOf("usePackItem(id)");
  assert(cut > 0, "app.js has no usePackItem");
  assert(app.slice(cut, cut + 700).includes("truefire-talisman"),
    "usePackItem does not route the 真火符 anywhere");
  assert(app.includes("E.buffSword("), "nothing in app.js calls the engine's buffSword");
});

// ---- The commit path prices what you hold ---------------------------------------
// Found by BE while measuring #70, and it is not the same defect as attackWith
// being permissive. attackWith is a PREVIEW and honours whatever it is handed on
// purpose — the UI asks it once per talisman on every render. The bug was that
// resolveCombat and midnight trusted `use` for the NUMBER while checking held()
// for the INVENTORY, two lines apart in the same function. So an unheld banner
// doubled your sword for free and was then correctly not spent.
//
// Unreachable from the UI — fightOptions, kitOptions and attackCeiling all build
// `use` out of heldIds — which is exactly why it needs a test: nothing a player
// does will ever notice it, and the next non-UI caller inherits it. It already
// cost BE three false WIN_SEALs, each reporting a confident 13.
async function combatFixture() {
  const q = "?atk=" + Date.now() + Math.random();
  const E = await import("../js/engine.js" + q);
  const items = await fetch("../data/items.json", NO_STORE).then((r) => r.json());
  return E;
}

test("combat: a banner you do not hold does not double your sword", async () => {
  const E = await combatFixture();
  const items = await fetch("../data/items.json", NO_STORE).then((r) => r.json());
  const s = E.newGame({ seed: 3, items });
  E.pickUpItem(s, "coin-sword");                       // attack 2
  assert(!E.held(s, "soul-banner"), "the fixture should not hold a banner");
  const r = E.resolveCombat(s, 4, { banner: true });
  eq(r.attack, 2, "an unheld banner was honoured and doubled the sword");
  eq(r.spent, [], "something was spent that was never held");
});

test("combat: a talisman you do not hold adds nothing and costs nothing", async () => {
  const E = await combatFixture();
  const items = await fetch("../data/items.json", NO_STORE).then((r) => r.json());
  const s = E.newGame({ seed: 3, items });
  E.pickUpItem(s, "coin-sword");
  const hp = s.health;
  // 血符 is the sharp case: it charges a point of blood BEFORE the blow, so an
  // unheld one used to take real health for an attack bonus you had not earned.
  const r = E.resolveCombat(s, 4, { talisman: "blood-talisman" });
  eq(r.attack, 2, "an unheld 血符 was added to the swing");
  eq(s.health, hp - E.combatDamage(4, 2, false), "an unheld 血符 charged its blood");
});

test("king: an unheld kit cannot buy a seal", async () => {
  const E = await combatFixture();
  const items = await fetch("../data/items.json", NO_STORE).then((r) => r.json());
  const s = E.newGame({ seed: 3, items });
  E.pickUpItem(s, "sevenstar-sword");                   // 3, the best blade
  // Ask for the whole winning kit while holding none of it. This returned
  // WIN_SEAL at 13 before, which is the number that closes the game.
  const r = E.midnight(s, { use: { banner: true, talisman: "blood-talisman" } });
  eq(r.attack, 3, "the King was met with a kit that was never assembled");
  assert(r.outcome !== "WIN_SEAL", "an unheld kit sealed the King");
  eq(r.spent, [], "something was spent that was never held");
});

// ---- The clock's shake (#79) -----------------------------------------------------
// A repeating animation on a permanently visible element, which is exactly the
// shape the photosensitivity rule exists to police. It is allowed because it is
// POSITION ONLY: a frame that moves is not a frame that flashes, the same rule
// 跳殭's judder follows.
//
// Read from the PARSED KEYFRAMES rather than from the source text, and rather
// than from the comment above them saying so. That distinction has already cost
// this project four vacuous guards, one of them this one.

test("clock: the shake is transform-only, every frame of it", async () => {
  // Parsed from the file, not from document.styleSheets: this page does not
  // link the game's stylesheet, and reading the document would have made the
  // guard quietly untestable rather than loudly wrong.
  const text = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const kf = [...sheet.cssRules].find(
    (r) => r.type === CSSRule.KEYFRAMES_RULE && r.name === "clockshake");
  assert(kf, "there is no clockshake keyframes rule");
  const frames = [...kf.cssRules];
  eq(frames.length, 5, "the shake should be five keyframes");
  for (const f of frames) {
    const props = [...f.style];
    eq(props, ["transform"], f.keyText + " sets " + props.join(", ") + ", not transform alone");
    assert(f.style.transform.startsWith("translate"),
      f.keyText + " is not a translation: " + f.style.transform);
    // A scale or a rotate would be fine too; opacity, filter, colour and
    // background are the ones that make a frame a flash.
    for (const banned of ["opacity", "filter", "background", "color"]) {
      assert(!f.style.getPropertyValue(banned), f.keyText + " sets " + banned);
    }
  }
});

test("clock: reduced motion stops the shake outright", async () => {
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  // Asked of the PARSED media block rather than a slice of text, so the answer
  // does not depend on how far the window happened to reach.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const reduced = [...sheet.cssRules].filter(
    (r) => r.type === CSSRule.MEDIA_RULE && r.conditionText.includes("prefers-reduced-motion"));
  assert(reduced.length, "there is no reduced-motion block at all");
  const stopped = reduced.some((m) => [...m.cssRules].some(
    (r) => r.selectorText && r.selectorText.split(",").some((sel) => sel.trim() === ".clocknum")
           // animationName, not the `animation` shorthand: the browser expands
           // `animation: none` to the full longhand ("auto ease 0s 1 normal
           // none running none"), so comparing the shorthand tests the
           // serialisation rather than the fact.
           && r.style.animationName === "none"));
  assert(stopped, "the shake survives prefers-reduced-motion");
});

test("clock: the night's colour is derived from the clock, not tabulated", async () => {
  // --dusk is written by renderHour from clockTime as elapsed/span: 0 at nine,
  // 1 at midnight. A hand-written table of three hours would say the same thing
  // today and lie the day the band structure moves — the same argument that let
  // the minute hand replace the pip row.
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  const rule = css.slice(css.indexOf(".clocknum {"), css.indexOf("@keyframes clockshake"));
  assert(rule.includes("var(--dusk)"), "the clock's colour does not follow the night");
  assert(rule.includes("color-mix"), "the ramp is not a mix between two ends");
  const render = await fetch("../js/render.js", NO_STORE).then((r) => r.text());
  assert(render.includes('setProperty("--dusk"'), "nothing writes --dusk any more");
  // And no hour is named in the rule — that would be the table this avoids.
  for (const hour of ["21", "22", "23", "9:00", "10:00", "11:00"]) {
    assert(!rule.includes(hour), "the ramp names the hour " + hour + " instead of deriving it");
  }
});

// ---- The night is the window's, not the pane's (#81) -----------------------------

test("atmosphere: the wash and the vignette are not bound to the board pane", async () => {
  // The seam the user saw was these two overlays stopping dead at .board-pane's
  // box: inside, a warm-black wash and a vignette reaching rgba(2,1,3,.95);
  // one pixel outside, the untouched body gradient at rgb(20,22,26), which is
  // BLUER. A straight vertical line where warm-and-dark met cool-and-undarkened.
  //
  // Fixing it by fading them before the edge cannot work for the vignette,
  // whose whole job is to be darkest at the edge. So they became properties of
  // the window: position: fixed, which also escapes .board-pane's overflow:
  // hidden without needing that clip removed.
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const find = (sel) => [...sheet.cssRules].find(
    (r) => r.type === CSSRule.STYLE_RULE && r.selectorText === sel);
  for (const sel of [".board-pane::before", ".board-pane::after"]) {
    const rule = find(sel);
    assert(rule, "no rule for " + sel);
    eq(rule.style.position, "fixed", sel + " is bound to the pane again");
    eq(rule.style.inset, "0px", sel + " does not cover the window");
  }
});

test("atmosphere: only things with their own surface stand above the night", () => {
  // ONE RULE, stated once, because this pair used to be two rules pulling
  // opposite ways: #81 said the interface must not be lifted, #82 says the
  // banner must be. Both are true and neither is the principle.
  //
  // The principle is what the seam actually was. Lifting .sidebar lifted a big
  // TRANSPARENT column, so the night stopped along an invisible boundary and
  // that boundary became the new rectangle — the same bug as the board pane's,
  // moved two inches right. A panel and the banner are different: each has a
  // background and a border of its own, so the night stopping at them reads as
  // a lit card or a bar standing over a dark room, which is a thing, not a seam.
  //
  // So: anything that paints above the vignette must declare a background. That
  // is the whole rule, and it is checked rather than described.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const rules = [...sheet.cssRules].filter((r) => r.type === CSSRule.STYLE_RULE);
  const vignetteZ = Number((rules.find((r) => r.selectorText === ".board-pane::after")
    || { style: {} }).style.zIndex || 0);
  const lifted = [];
  for (const r of rules) {
    const z = Number(r.style.zIndex);
    if (!Number.isFinite(z) || z <= vignetteZ) continue;
    if (r.style.position === "" || r.style.position === "static") continue;
    lifted.push(r);
  }
  for (const r of lifted) {
    // Only judging the plain chrome selectors; overlays, dialogs and the scare
    // are meant to cover the page and are not "standing on" anything.
    const sels = r.selectorText.split(",").map((x) => x.trim());
    if (!sels.some((x) => [".sidebar", ".topnav", ".panel"].includes(x))) continue;
    const hasSurface = !!(r.style.background || r.style.backgroundColor);
    assert(hasSurface,
      r.selectorText + " stands above the night with no surface of its own — " +
      "the night will stop along an invisible edge, which is the seam again");
  }
  // And the column specifically stays down: it is transparent by design.
  const side = rules.find((r) => r.selectorText === ".sidebar");
  if (side) {
    const z = Number(side.style.zIndex);
    assert(!Number.isFinite(z) || z <= vignetteZ,
      ".sidebar is lifted — it is a transparent column, so its edge becomes the seam");
  }
});

test("atmosphere: the HUD cards read through the night at any hour", async () => {
  // The ruling was: do not touch the night, strengthen the panels. Recolouring
  // them could not have worked, and the arithmetic is why rather than taste.
  // When an overlay covers text and background alike it pulls both toward the
  // same ink, so at the alpha the vignette reaches over the HUD at 375px at
  // eleven o'clock (.83) the CEILING — pure white on pure black — is 1.51.
  // No pair of colours reads through that. The card has to be above it.
  //
  // Guarded as the mechanism rather than as a measurement: a card above the
  // overlay takes no wash at all, so its contrast is its own at every hour and
  // every width, which is what the target asked for.
  const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const rules = [...sheet.cssRules].filter((r) => r.type === CSSRule.STYLE_RULE);
  const panel = rules.find((r) => r.selectorText === ".panel");
  assert(panel, "there is no .panel rule");
  const z = Number(panel.style.zIndex);
  assert(z >= 2, ".panel is not above the night (z-index " + panel.style.zIndex + ")");
  assert(panel.style.position === "relative", ".panel has no positioning for its z-index to apply to");
  const vignette = rules.find((r) => r.selectorText === ".board-pane::after");
  assert(Number(vignette.style.zIndex) < z,
    "the vignette now paints over the cards again");
});

test("banner: two rows at phone width, and no label allowed to stack", () => {
  // WHY A WIDTH ASSERTION COULD NOT CATCH THIS, which is the whole lesson of
  // #83: at 375 the bar was flex-wrap: nowrap, so nothing overflowed sideways
  // and no scrollbar appeared — it grew DOWNWARD to 150px instead, and every
  // item wrapped its own text into a narrow column. The title came out 59x122
  // and 繁體中文 became a 38x96 vertical strip of four stacked characters. Every
  // 375px check anyone ran passed, mine included, because they all asked about
  // width.
  //
  // Measured by hand after the fix, at 375x812, both languages and the article
  // pages: the bar is 85px, exactly two visual rows (title centred at y22, all
  // four controls at y59), nothing multiline, rightmost edge 346 of 375.
  //
  // Guarded as the mechanism rather than by rendering, because the suite has to
  // run in a pane where innerWidth is 0 and a rendered measurement there would
  // be worse than none.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const phone = [...sheet.cssRules].filter(
    (r) => r.type === CSSRule.MEDIA_RULE && /max-width/.test(r.conditionText) &&
           Number((r.conditionText.match(/(\d+)px/) || [])[1]) >= 375);
  assert(phone.length, "no phone-width block at all — the banner has nothing to reflow it");
  const ruleFor = (sel) => {
    for (const m of phone) {
      for (const r of m.cssRules) {
        if (r.type !== CSSRule.STYLE_RULE) continue;
        if (r.selectorText.split(",").map((x) => x.trim()).includes(sel)) return r;
      }
    }
    return null;
  };
  const bar = ruleFor(".topnav");
  assert(bar && bar.style.flexWrap === "wrap",
    "the banner still refuses to wrap at phone width, so it grows downward instead");
  const brand = ruleFor(".topnav .brand");
  assert(brand && /100%/.test(brand.style.flexBasis || brand.style.flex || ""),
    "the title does not take a row of its own, so the controls share it");
  // The one that stops 繁體中文 becoming a vertical strip.
  for (const sel of [".topnav a", ".topnav button"]) {
    const r = ruleFor(sel);
    assert(r && r.style.whiteSpace === "nowrap",
      sel + " may still stack its label into a column at phone width");
  }
});

test("equipment: the three slots differ when filled and match when empty (#85)", () => {
  // The panel used to say "three interchangeable slots" when the truth is "your
  // attack, a passive ward, and the reason you are in this building". All three
  // rendered identically and the hand--weapon / hand--charm / hand--relic
  // classes carried no colour at all.
  //
  // The rule this encodes is the one worth keeping, because it is what stops
  // the fix becoming decoration: EMPTY slots stay identical, because nothing is
  // there and three flavours of absence would be ornament. Only the occupied
  // ones differ, and only because the things differ.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const rules = [...sheet.cssRules].filter((r) => r.type === CSSRule.STYLE_RULE);
  const decl = (sel) => rules.filter((r) => r.selectorText === sel);

  // Nothing may dress a slot without excluding the empty state.
  for (const r of rules) {
    const sel = r.selectorText || "";
    if (!/\.hand--(weapon|charm|relic)\b/.test(sel)) continue;
    if (!(r.style.background || r.style.backgroundImage || r.style.borderColor)) continue;
    assert(sel.includes(":not(.hand--bare)"),
      sel + " colours a slot without excluding the empty state — an empty slot " +
      "has nothing to say and three kinds of nothing is decoration");
  }
  // And the one that is not equipment at all is the one that is distinguished.
  assert(decl(".hand--relic:not(.hand--bare)").length,
    "the 神主牌 slot is dressed the same as a charm again");
  // The name moved into the tooltip in #90 when the slots went picture-only, so
  // the rule that distinguishes it moved with it. The claim is unchanged: the
  // tablet's NAME takes a colour of its own, wherever the name is drawn.
  const relicName = decl(".hand--relic:not(.hand--bare) .tipname")[0];
  assert(relicName && /gold/.test(relicName.style.color),
    "the tablet's name has stopped taking a colour of its own");
});

// The marker over the .scare--* block in style.css says those rules are dead
// and that the tier table above them is not. This is that claim, executed.
//
// It is here rather than left as prose because "these rules are unreachable" is
// a sentence a reader can only believe, and this repo has now been caught twice
// by exactly that shape. The point of the guard is that somebody who gives
// scareNow a caller finds out from a red suite instead of from a marker they
// were never going to read.
test("the full-screen scare is unreachable, and the tier table is not", async () => {
  // Built rather than escaped, for the reason noComments spells out above: a
  // newline escape written through a shell heredoc has already become a REAL
  // newline in this file once, and took thirty tests out of the run quietly.
  const NEWLINE = String.fromCharCode(10);
  const src = await fetch("../js/render.js", NO_STORE).then((r) => r.text());
  const bare = noComments(src);
  const sheet = await fetch("../css/style.css", NO_STORE).then((r) => r.text());

  // FIRST, PROVE THE REGION IS NOT EMPTY. Every assertion below is about
  // something being absent or contained, and all of them pass triumphantly
  // against a stylesheet that no longer has any of these rules at all. A guard
  // whose subject has been deleted is not a guard.
  const scareRules = sheet.split(NEWLINE).filter((l) => l.trim().indexOf(".scare--") === 0);
  assert(scareRules.length > 5,
    "the .scare--* rules are gone from style.css, so this guard is now watching " +
    "nothing - if they were deleted on purpose, delete the marker and this test too");

  // The class is applied in exactly the places the marker says, and those
  // places are inside scareNow.
  const lines = bare.split(NEWLINE);
  const opens = lines.findIndex((l) => l.indexOf("function scareNow") === 0);
  assert(opens !== -1, "scareNow is gone from render.js - the marker in style.css is stale");
  let depth = 0, closes = -1;
  for (let i = opens; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth === 0 && i > opens) { closes = i; break; }
  }
  assert(closes > opens, "could not find the end of scareNow");

  const applies = [];
  lines.forEach((l, i) => { if (l.indexOf("scare--") !== -1) applies.push(i); });
  assert(applies.length > 0,
    "nothing in render.js applies a .scare--* class any more, so the stylesheet " +
    "block is dead for a different reason than the marker gives");
  for (const i of applies) {
    assert(i > opens && i < closes,
      // Comment-stripped line number, said as such: noComments collapses each
      // block comment to one space, so this does NOT match the file on disk and
      // sending somebody to that line in an editor would waste their time.
      "a .scare--* class is applied OUTSIDE scareNow (comment-stripped line " +
      (i + 1) + ") - the marker in style.css says those rules cannot be " +
      "reached and it has just become wrong");
  }

  // And scareNow has no caller. Counted rather than grepped for absence: the
  // definition is a real occurrence, so the honest assertion is "exactly one".
  const scareNowHits = lines.filter((l) => l.indexOf("scareNow") !== -1);
  assert(scareNowHits.length === 1,
    "scareNow appears " + scareNowHits.length + " times in comment-stripped " +
    "render.js rather than once - something calls it now, so the .scare--* " +
    "rules are live again and the marker over them is wrong");

  // THE OTHER HALF, and the one the marker exists to protect: the tier table is
  // NOT dead, and a sweep that reads "unreachable" and takes the lot would
  // silently remove the hop's timing from every fight in the game.
  //
  // THE FIRST VERSION OF THIS ASSERTION DID NOT WORK, and only deleting the
  // live caller on purpose revealed it. It counted every line matching
  // "scareTier(" and required more than one - but scareTier's OWN DEFINITION
  // matches, and so does the dead call inside scareNow. Removing the real
  // caller in announceFight left two matches and the guard passed, cheerfully,
  // having watched the exact thing it exists to watch get deleted.
  //
  // So the claim has to be spelled out as what it means: a call site that is
  // neither the definition nor inside the dead function.
  const liveTierCalls = [];
  lines.forEach((l, i) => {
    if (l.indexOf("scareTier(") === -1) return;
    if (l.indexOf("function scareTier") !== -1) return;   // the definition
    if (i > opens && i < closes) return;                  // scareNow's dead call
    liveTierCalls.push(i + 1);
  });
  assert(liveTierCalls.length > 0,
    "scareTier has no caller outside scareNow any more, so the tier table is " +
    "as dead as the pictures - if that is deliberate, the marker in style.css " +
    "needs rewriting, not this test relaxing");
});

// The room name in a half-room must not be inside the thing the candle dims
// (#123). This is measured on a board the game rendered, not on a fixture: the
// whole class of bug it guards is a real cascade doing something the source
// does not show.
//
// WHY IT IS A STRUCTURAL CHECK AND NOT A THRESHOLD. There is no floor that
// would have worked. Measured on the shipped pair, the label needs brightness
// .545 to clear 4.5:1 and the peek's maximum is .46 — so "raise the floor" was
// arithmetically unavailable, and the only fix is the label not being under the
// filter at all. A guard on the floor VALUE would therefore be guarding a knob
// that cannot reach the answer; this guards the arrangement instead.
// SERIAL, and that is not caution. renderBoard() writes to
// getElementById("board") — a document-wide lookup — and this suite's tests are
// awaited together, so an unqueued board test races every other board test for
// that id. Unqueued, this guard reported "the board rendered no way out": its
// host was in the document and another test's #board was earlier in it.
test("the half-room dims the room and not its name", serial(async () => {
  const names = ["tiles", "items", "search", "events"];
  const [tiles, items, search, events] = await Promise.all(
    names.map((n) => fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))
  );
  // SNAPSHOT, not the live list: document.adoptedStyleSheets is an observable
  // array, so keeping the reference and assigning it back restores nothing.
  const adopted = [...document.adoptedStyleSheets];
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(await fetch("../css/style.css", NO_STORE).then((r) => r.text()));

  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  host.innerHTML = '<div class="board-pane"><div id="board" class="board"></div></div>' +
                   '<div id="hud-items"></div><div id="actions-pop" hidden>' +
                   '<div id="actions"></div></div>';
  document.body.appendChild(host);
  try {
    // THE TEST PAGE LINKS NO STYLESHEET, so the game's CSS has to be adopted or
    // every computed style here is the browser's default. That matters more for
    // this guard than for most: its central assertion is that no ancestor
    // carries a filter, and with no CSS loaded that is true of EVERYTHING. It
    // passed vacuously until this was added.
    document.adoptedStyleSheets = [...adopted, sheet];
    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 9 });
    game.refresh();

    // A HALF-ROOM NEEDS A STEP TAKEN. A fresh board has four doorways and no
    // placed neighbours, so nothing renders a peek until the player goes
    // through one — checked across twelve seeds, none of them start with one.
    // So the guard walks through a door, which is the path a player takes.
    // (And it does NOT refresh afterwards: a re-render clears the peek again.)
    const door = host.querySelector(".doorway");
    assert(door, "the board rendered no way out, so this guard cannot reach a half-room");
    door.click();
    for (let i = 0; i < 40 && !host.querySelector(".halfroom"); i++) {
      for (const a of document.getAnimations()) {
        try {
          const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
          if (!t || t.iterations === Infinity) continue;
          a.finish();
        } catch (e) { /* an infinite one refusing must not stop the rest */ }
      }
      await new Promise((r) => setTimeout(r, 40));
    }

    // PROVE THE REGION. Every assertion below is about a half-room's label, and
    // all of them pass triumphantly on a board that rendered none.
    const half = host.querySelector(".halfroom");
    assert(half, "no half-room rendered after stepping through a door, so this " +
      "guard measured nothing");
    const label = half.querySelector(".tilename");
    assert(label && label.textContent.trim(),
      "the half-room has no name in it, so there is no contrast to check");

    // THE ARRANGEMENT: nothing between the label and the board may carry a
    // filter. Walking the ancestors is the check — a filter anywhere up the
    // chain applies to the whole subtree, which is the fact the old code fell
    // foul of.
    for (let el = label; el && el !== host; el = el.parentElement) {
      const f = getComputedStyle(el).filter;
      assert(f === "none",
        "a filter (" + f + ") sits on " + el.className + ", which is an ancestor " +
        "of the room name - it will dim the name with the room, and no floor " +
        "value can undo that");
    }

    // And the dimming still HAPPENS, on the part that is meant to have it. A
    // fix that simply deleted the peek would pass everything above.
    const glimpse = half.querySelector(".halfglimpse");
    assert(glimpse, "the half-room has no .halfglimpse - the dimmed half is gone");
    assert(/brightness/.test(getComputedStyle(glimpse).filter),
      "the glimpse is no longer dimmed, so the neighbour room is not a glimpse " +
      "any more - this guard must not be satisfied by deleting the effect");
    assert(!glimpse.contains(label),
      "the room name is inside .halfglimpse again");

    // THE NUMBER, from the colours the page computed rather than from copies of
    // the hex values - the tokens move with the world cast and the hour.
    const cs = getComputedStyle(label);
    const ratio = contrastOf(cs.color, cs.backgroundColor);
    assert(ratio >= 4.5,
      "the half-room's name reads at " + ratio + ":1 against its own scrim, under " +
      "the 4.5 a name needs");
  } finally {
    host.remove();
    document.adoptedStyleSheets = adopted;
  }
}));

// WCAG contrast from two CSS colour strings, resolved by the browser rather
// than parsed by hand: color-mix() and color(srgb ...) both turn up here and a
// hand-written hex parser would quietly fail on them.
function contrastOf(fg, bg) {
  const c = document.createElement("canvas");
  c.width = c.height = 4;
  const x = c.getContext("2d", { willReadFrequently: true });
  const px = (col) => {
    x.fillStyle = "#000"; x.fillRect(0, 0, 4, 4);
    x.fillStyle = col; x.fillRect(0, 0, 4, 4);
    const d = x.getImageData(2, 2, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const a = L(px(fg)), b = L(px(bg));
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}
