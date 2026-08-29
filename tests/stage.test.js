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
         showDropDialog, onPackUse } from "../js/render.js";
import { Game } from "../js/app.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "1d727f8b");

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

test("hud: the poison strip is in the language it is read in (#108)", serial(async () => {
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
                   '<div id="hud-poison"></div>';
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
      const strip = document.getElementById("hud-poison");
      assert(strip && !strip.hidden,
        `the poison strip did not render at all in ${lang}, so this guard is ` +
        `asserting nothing — an empty region satisfies every "must not contain"`);
      const shown = strip.textContent.trim();
      assert(shown.length > 0, `the poison strip is empty in ${lang}`);
      assert(!mustNot.test(shown),
        `the ${lang} poison strip contains ${why}: ${JSON.stringify(shown)}`);

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

test("hud: the poison wash lands on the body, not the clock block (#113)", serial(async () => {
  // 「整個身體的panel變紅色」. The renderer reaches the box by closest(".panel")
  // from the mark, and that resolves correctly ONLY because .panel--status is
  // named like a modifier without being a .panel. Add the panel class to it —
  // a tidy that looks like a naming fix — and the wash silently shrinks to the
  // clock block. It would still be red, still toggle with the flag, and every
  // number a test usually takes would stay green.
  //
  // THE FIXTURE IS game.html's OWN SIDEBAR, not a hand-written copy of it, and
  // that is the whole point of this guard. Its first version built the nesting
  // from a string right here, so closest() was asserted against markup the TEST
  // wrote — and the failing-direction demo added the class to the FIXTURE,
  // which is this guard's input rather than the product. Sabotaging game.html
  // itself left the suite at 359 passed, 0 failed, with the wash sitting on an
  // 84px clock block inside a 323px body panel.
  //
  // The shell digest DOES notice the raw edit, but it is a tamper detector and
  // not a semantics one: commit, re-run tools/record_shell.py — exactly what a
  // developer would do — and it goes green with the bug in.
  //
  // So this asserts CONTAINMENT against the product's real nesting: whatever is
  // washed must hold the hands and the pack, because that is what makes it the
  // body rather than a row inside it.
  const names = ["tiles", "items", "search", "events"];
  const [[tiles, items, search, events], html] = await Promise.all([
    Promise.all(names.map((n) =>
      fetch("../data/" + n + ".json", NO_STORE).then((r) => r.json()))),
    fetch("../game.html", NO_STORE).then((r) => r.text()),
  ]);
  const sidebar = new DOMParser().parseFromString(html, "text/html")
    .querySelector(".sidebar");
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:600px";
  // id="board" AND class="board": renderBoard() writes to getElementById("board")
  // and throws on null. The sidebar is game.html's; only the board is ours.
  host.innerHTML = '<div class="board-pane"><div id="board" class="board"></div></div>';
  document.body.appendChild(host);
  try {
    // Prove the region before believing anything about it — an absent or empty
    // sidebar satisfies every containment check below by holding nothing.
    assert(sidebar, "game.html has no .sidebar, so this guard is reading the wrong file");
    host.appendChild(document.importNode(sidebar, true));
    for (const [sel, what] of [["#hud-poison", "the poison mark"],
                               [".hands", "the hands"],
                               [".backpack", "the pack"]])
      assert(host.querySelector(sel),
        "game.html's sidebar has no " + sel + " (" + what + "), so this guard " +
        "cannot tell a wash on the body from a wash on anything else");
    const game = new Game({ tiles, items, search, events, theme: themeEn,
                            baseTheme: themeEn, lang: "en" }, { seed: 5 });
    game.state.poisoned = true;
    game.refresh();

    const washed = host.querySelector(".panel--poisoned");
    assert(washed,
      "nothing carries the wash while poisoned, so this guard is asserting " +
      "nothing — an absent region satisfies every containment check");
    const where = washed.className + " > " +
      [...washed.children].map((c) => c.className || c.tagName).join(", ");
    assert(washed.querySelector(".hands") && washed.querySelector(".backpack"),
      "the poison wash landed on a box that does not contain the hands and " +
      "the pack, so it is not 整個身體的panel: " + where);

    // And it is the whole body rather than the board as well — washing an
    // ancestor of everything would pass the check above for the wrong reason.
    assert(!washed.querySelector("#board"),
      "the wash reached an ancestor of the board: " + where);

    game.state.poisoned = false;
    game.refresh();
    assert(!host.querySelector(".panel--poisoned"),
      "the wash did not clear when the poison did");
  } finally {
    host.remove();
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
const PX_SLOT = cssPx(".hands { --handicon: ");
const PX_PACK = 54;


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
