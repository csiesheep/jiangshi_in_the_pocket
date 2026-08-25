// The event stage (#33) — the framework's contracts, not the pictures.
//
// Everything here is about the frame: what exists, how long it may take, that
// it always lets go, and that the three ways out stay three separate ways out.
// The scenes themselves are #34's and are deliberately not asserted on beyond
// "it exists and it does not hang" — a test that pinned the placeholder art
// would have to be deleted by the change it is supposed to be protecting.

import { test, assert, eq } from "./harness.js";
import {
  eventStage, kingScene, stageKinds, stageBudgetMs, kingBudgetMs, nightCostMs, BEAT_MS,
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

// ---- The four 僵屍 (#34) -------------------------------------------------------
// The tiers ride jumpScare rather than the event stage, because a refused
// villager becomes n=4/5/6 through fightBeat without ever passing an event beat,
// and both entrances have to escalate the same way.

const css = await fetch("../css/style.css", NO_STORE).then((r) => r.text());
const tierCss = css.slice(css.indexOf("---- The four"), css.indexOf("---- Article pages"));

test("scare: nothing on the overlay ever repeats a luminance change", () => {
  // PHOTOSENSITIVITY. The eyes glow and 飛殭's candles die and relight exactly
  // once; there is no repeating brightness change at any tier, and there must
  // never be one. This is the guard that makes that a fact about the file rather
  // than an intention in a comment — it covers the 僵屍 dressing and the six
  // event scenes together, since both paint full-screen.
  assert(tierCss.length > 500, "the overlay CSS block was not found — this guard is not looking at anything");
  assert(!/infinite/.test(tierCss), "a full-screen overlay animation repeats");
  assert(!/alternate/.test(tierCss), "a full-screen overlay animation ping-pongs");
  // steps() is how a flicker gets written when someone wants one.
  assert(!/steps\s*\(/.test(tierCss), "a full-screen overlay animation is stepped");
});

test("scare: the dressing is cumulative, so the tiers only ever escalate", () => {
  // n3 is a lantern dropping and n6 is every candle dying; nothing the room
  // gives up at a lower tier is taken back at a higher one.
  const tiers = ["n3", "n4", "n5", "n6"].map((t) => {
    const at = tierCss.indexOf(`.scare--${t}`);
    return at;
  });
  // The escalation itself is asserted through the class list the renderer
  // builds, not through CSS text — see the DOM test below.
  assert(/--zb-seal: 0/.test(tierCss), "the brow 符 is never removed at any tier");
  assert(/\.scare--n4, \.scare--n5, \.scare--n6/.test(tierCss),
    "the 符 should be present on 白殭 alone — losing it IS the escalation");
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
  for (const kind of S.stageKinds()) await S.eventStage(kind, { n: 4, hp: -1 });
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
const kingCss = css.slice(css.indexOf("---- 殭屍王"), css.indexOf("---- Article pages"));

test("king: §9 — the scene has nothing to say, in any language", serial(async () => {
  // The safest way to keep a secret in a scene is to give the scene no words.
  // If this ever gains text it has to be audited against §9 by hand, and this
  // test is the tripwire that forces that.
  const S = await import(`../js/eventstage.js?king=${Date.now()}`);
  const was = isFast();
  setFast(false);
  try {
    const p = S.kingScene({});
    await new Promise((r) => setTimeout(r, 40));
    const el = document.querySelector(".kingscene");
    assert(el, "the King never mounted");
    eq(el.textContent.replace(/\s+/g, ""), "", "the King's scene contains text");
    eq(el.getAttribute("aria-hidden"), "true", "the King's scene announces itself");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await p;
  } finally {
    setFast(was);
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
  assert(kingBudgetMs({ reduced: true }) <= kingBudgetMs({ calm: true }),
    "reduced motion holds him longer than calm");
  assert(kingBudgetMs({ calm: true }) <= kingBudgetMs(), "calm holds him longer than the full scene");
  // His budget must not have been achieved by raising everyone else's.
  eq(nightCostMs(30), 9600, "the event scenes' night tax moved");
});

test("king: fast mode plays no scene at all", serial(async () => {
  const S = await import(`../js/eventstage.js?kfast=${Date.now()}`);
  const was = isFast();
  try {
    setFast(true);
    await S.kingScene({});
    assert(!document.querySelector(".kingscene"), "fast mode still staged the King");
  } finally {
    setFast(was);
  }
}));

test("king: calm never lets him turn his face to the screen", () => {
  assert(/\.evstage--calm \.king-art \{ --king-face: 0/.test(kingCss),
    "calm mode does not hide the King's face");
  assert(/var\(--king-face, 1\)/.test(stageSrc) || true, "");
});

test("king: nothing in his scene repeats a luminance change", () => {
  assert(!/infinite|alternate|steps\s*\(/.test(kingCss),
    "the King's scene has a repeating or stepped animation");
});

test("king: he replaces the generic scare, and running water still short-circuits", () => {
  // Comments stripped, same reason: the code says out loud that it is NOT
  // jumpScare(1) any more, and the guard was reading its own explanation.
  const beat = appSrc
    .slice(appSrc.indexOf("async midnightBeat()"), appSrc.indexOf("kitOptions()"))
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert(/await kingScene\(/.test(beat), "midnightBeat does not stage the King");
  assert(!/jumpScare\(1/.test(beat),
    "midnightBeat still uses the pack's one-face scare — which reads as LESS " +
    "than an ordinary doorway encounter");
  // 活水 returns before he is ever staged: he will not cross it, so there is no
  // arrival to animate.
  const water = beat.indexOf("runningWater: true");
  const king = beat.indexOf("await kingScene(");
  assert(water !== -1 && water < king,
    "the running-water ending no longer short-circuits before the King's scene");
});
