// The event stage (#33) — the framework's contracts, not the pictures.
//
// Everything here is about the frame: what exists, how long it may take, that
// it always lets go, and that the three ways out stay three separate ways out.
// The scenes themselves are #34's and are deliberately not asserted on beyond
// "it exists and it does not hang" — a test that pinned the placeholder art
// would have to be deleted by the change it is supposed to be protecting.

import { test, assert, eq } from "./harness.js";
import {
  eventStage, stageKinds, stageBudgetMs, nightCostMs, BEAT_MS,
  isFast, setFast, resetStageHints,
} from "../js/eventstage.js";

const NO_STORE = { cache: "no-store" };

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
  for (const gates of [{}, { calm: true }, { reduced: true }]) {
    const ms = stageBudgetMs(gates);
    assert(ms >= 400 && ms <= 1600,
      `budget ${ms}ms for ${JSON.stringify(gates)} is outside 400–1600`);
  }
});

test("stage: the quieter the gate, the shorter the hold", () => {
  // Not arbitrary ordering: reduced motion is a held frame and nobody needs a
  // held frame for as long as a moving one, and calm has less on screen to look
  // at. If these ever invert it means a gate is making the game slower for the
  // player who asked for less, which is backwards.
  assert(stageBudgetMs({ reduced: true }) <= stageBudgetMs({ calm: true }),
    "reduced motion holds longer than calm");
  assert(stageBudgetMs({ calm: true }) <= stageBudgetMs(),
    "calm holds longer than the full stage");
});

// ---- Fast mode is its own preference ------------------------------------------

test("stage: fast mode round-trips and keeps its own key", () => {
  const was = isFast();
  // Pace and intensity are separate complaints with separate switches, so
  // writing one must not move the other.
  const calmBefore = localStorage.getItem("jitp:calm");
  try {
    setFast(true);
    assert(isFast() === true, "setFast(true) did not take");
    eq(localStorage.getItem("jitp:fast"), "1", "fast is not under its own key");
    setFast(false);
    assert(isFast() === false, "setFast(false) did not take");
    eq(localStorage.getItem("jitp:fast"), "0", "fast did not persist off");
    eq(localStorage.getItem("jitp:calm"), calmBefore, "fast mode moved calm's key");
  } finally {
    setFast(was);
  }
});

test("stage: fast mode is exactly the game before the stage existed", serial(async () => {
  const was = isFast();
  try {
    setFast(true);
    const t0 = performance.now();
    await eventStage("nothing", {});
    const took = performance.now() - t0;
    // The same beat, no layer. Not "a shorter stage" — no stage.
    assert(!document.querySelector(".evstage"), "fast mode still built a stage");
    assert(took >= BEAT_MS - 60,
      `fast mode returned in ${Math.round(took)}ms; the beat is ${BEAT_MS}ms and ` +
      `the log needs that long to be read`);
  } finally {
    setFast(was);
  }
}));

// ---- The frame always lets go --------------------------------------------------

test("stage: every kind resolves, mounts nothing permanent, and balances the scene", serial(async () => {
  const was = isFast();
  setFast(false);
  try {
    for (const kind of stageKinds()) {
      const staged = document.body.classList.contains("staged");
      await eventStage(kind, { n: 3, hp: -1 });
      assert(!document.querySelector(".evstage"),
        `${kind}: the layer outlived its own stage`);
      eq(document.body.classList.contains("staged"), staged,
        `${kind}: enterScene/leaveScene did not balance — the letterbox bars are stuck`);
    }
  } finally {
    setFast(was);
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

test("stage: it is held to its deadline", serial(async () => {
  const was = isFast();
  setFast(false);
  try {
    const budget = stageBudgetMs();
    // Raced against a reference timer rather than measured against the wall
    // clock, because wall-clock milliseconds here describe the tab more than
    // they describe the stage: a backgrounded pane clamps timers to whole
    // seconds, and this test read 2000ms for an 1100ms budget while the
    // framework was behaving perfectly. Clamping hits both timers alike, so a
    // race between them still means what it is supposed to mean — the stage
    // must not outlive twice its own deadline.
    const winner = await Promise.race([
      eventStage("nothing", {}).then(() => "stage"),
      new Promise((r) => setTimeout(() => r("deadline"), budget * 2)),
    ]);
    eq(winner, "stage",
      `a stage budgeted at ${budget}ms was still up after ${budget * 2}ms`);
  } finally {
    setFast(was);
  }
}));

// ---- Skipping ------------------------------------------------------------------

test("stage: a key ends it early and cleans up after itself", serial(async () => {
  const was = isFast();
  setFast(false);
  try {
    const t0 = performance.now();
    const p = eventStage("nothing", {});
    // Let it mount, then dismiss it the way a player would.
    await new Promise((r) => setTimeout(r, 30));
    assert(document.querySelector(".evstage"), "the stage never mounted");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await p;
    const took = performance.now() - t0;
    assert(took < stageBudgetMs(),
      `skipping took ${Math.round(took)}ms, which is not shorter than the budget`);
    assert(!document.querySelector(".evstage"), "the skipped layer was left behind");
  } finally {
    setFast(was);
  }
}));

test("stage: modified keys are not a skip", serial(async () => {
  const was = isFast();
  setFast(false);
  try {
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
  } finally {
    setFast(was);
  }
}));

test("stage: the layer is silent to a screen reader", serial(async () => {
  const was = isFast();
  setFast(false);
  try {
    const p = eventStage("poison", {});
    await new Promise((r) => setTimeout(r, 30));
    const el = document.querySelector(".evstage");
    assert(el, "the stage never mounted");
    // The news is written to the log — a live region — before the stage is
    // called. If this layer were announced too, a screen-reader player would
    // hear the same sentence twice; and if it were ever the ONLY place
    // something was said, the skip affordance would become a way to miss the
    // game. Illustrate the line, never carry it.
    eq(el.getAttribute("aria-hidden"), "true", "the stage announces itself");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await p;
  } finally {
    setFast(was);
  }
}));

test("stage: never stacks", serial(async () => {
  const was = isFast();
  setFast(false);
  try {
    const a = eventStage("nothing", {});
    await new Promise((r) => setTimeout(r, 20));
    const b = eventStage("poison", {});
    await new Promise((r) => setTimeout(r, 20));
    eq(document.querySelectorAll(".evstage").length, 1,
      "two stages were up at once — the second must displace the first");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await Promise.all([a, b]);
  } finally {
    setFast(was);
  }
}));

// ---- The hint ------------------------------------------------------------------

test("stage: the skip hint stops after the first couple of events", serial(async () => {
  const was = isFast();
  setFast(false);
  resetStageHints();
  try {
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const p = eventStage("nothing", { skipHint: "press anything" });
      await new Promise((r) => setTimeout(r, 25));
      seen.push(!!document.querySelector(".evstage-hint"));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
      await p;
    }
    eq(seen, [true, true, false, false],
      "the hint should teach twice and then stop being furniture");
  } finally {
    setFast(was);
    resetStageHints();
  }
}));

// ---- Strings -------------------------------------------------------------------

const [themeEn, themeZh] = await Promise.all([
  fetch("../data/theme.json", NO_STORE).then((r) => r.json()),
  fetch("../data/theme.zh-TW.json", NO_STORE).then((r) => r.json()),
]);

test("stage: both languages carry the stage's own strings", () => {
  for (const key of ["stage-skip", "fast-on", "fast-off", "title-fast"]) {
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

test("stage: the fast control exists and is a real toggle", serial(async () => {
  const html = await fetch("../game.html", NO_STORE).then((r) => r.text());
  assert(/id="btn-fast"/.test(html), "game.html has no fast-mode control");
  assert(/id="fast-label"/.test(html), "the fast control has no screen-reader label");
  const btn = html.slice(html.indexOf('id="btn-fast"') - 200, html.indexOf('id="fast-label"'));
  assert(/aria-pressed/.test(btn), "the fast control is not announced as a toggle");
}));
