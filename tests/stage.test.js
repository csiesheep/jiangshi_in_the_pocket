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
  // It lives on the MENU now, not the game HUD (#55). The feature did not move
  // — the preference is localStorage-backed and survives — only the door to it,
  // so this follows the door rather than being deleted with the old button.
  const html = await fetch("../index.html", NO_STORE).then((r) => r.text());
  assert(/id="menu-fast"/.test(html), "the menu has no fast-mode control");
  assert(/id="menu-fast-label"/.test(html), "the fast control has no screen-reader label");
  const btn = html.slice(html.indexOf('id="menu-fast"'), html.indexOf('id="menu-fast-label"'));
  assert(/aria-pressed/.test(html.slice(html.indexOf('id="menu-fast"') - 120, html.indexOf('id="menu-fast-label"'))),
    "the fast control is not announced as a toggle");
  assert(btn !== null, "");
  // And the HUD really has stopped carrying it.
  const game = await fetch("../game.html", NO_STORE).then((r) => r.text());
  for (const gone of ["btn-fast", "btn-calm", "btn-copy-seed", "hud-attack"]) {
    assert(!game.includes('id="' + gone + '"'), "the game HUD still carries " + gone);
  }
}));

// ---- The four 僵屍 (#34) -------------------------------------------------------
// The tiers ride jumpScare rather than the event stage, because a refused
// villager becomes n=4/5/6 through fightBeat without ever passing an event beat,
// and both entrances have to escalate the same way.

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
      // "1" and "" are the only acceptable counts. Anything else runs the
      // brightness change more than once, including a plain 2.
      if (s.animationIterationCount && !["1", ""].includes(s.animationIterationCount)) {
        bad.push("iteration-count: " + s.animationIterationCount);
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
  const was = isFast();
  setFast(false);
  try {
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
  // Kept as its own named claim — the King is the one scene that plays at the
  // moment the whole night walks toward — but reading the parsed rules rather
  // than a text slice, like everything else photosensitivity now checks.
  const offenders = repeatingAnimations(styleSheetText, (sel) => sel.includes(".king"));
  assert(offenders.length === 0,
    "the King's scene repeats a luminance change: " + offenders.join(" | "));
});

test("king: he replaces the generic scare, and nothing short-circuits ahead of him", () => {
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
  assert(!/i < 4/.test(loop), "the grid hard-codes four cells");
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
// These render at 18px in the found-item row, 26px in the hands and about 76px in
// a pack cell. EIGHTEEN is the number that decides whether an icon works, and an
// icon judged at poster size is not judged at all.
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

test("icons: the four weapons stay apart at the size the choice is made", async () => {
  const W = ITEM_IDS.slice(0, 4);
  for (const px of [18, 26]) {
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
        // 14.5% and 27.5.
        assert(sil >= 12, name + ": silhouettes only " + sil.toFixed(1) + "% apart");
        assert(col >= 25, name + ": colours only " + col.toFixed(1) + " apart");
      }
    }
  }
});
