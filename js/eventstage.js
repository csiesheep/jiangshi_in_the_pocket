// The event stage — the full-screen moment where a room answers you.
//
// This file is the frame; the pictures are #34. Everything above the SCENES
// table is about WHEN a stage runs, how long it is allowed to take and how it
// gets out of the way. What is actually drawn is six placeholder scenes at the
// bottom, meant to be replaced one at a time without anything above them
// moving.
//
// ---- Pacing is the design problem, not a detail -----------------------------
// A night is thirty turns and very nearly every one of them draws an event. An
// animation that feels right once, watched once, is a tax collected thirty
// times. At three seconds each that is ninety seconds added to a game that runs
// about six minutes — not "more atmospheric", just a longer and worse game, and
// the second night is where the player notices.
//
// So the stage does not get time of its own. It SPENDS THE BEAT THAT WAS
// ALREADY THERE: eventBeat used to sit on a bare wait between telling you what
// happened and moving on, and the stage happens during that wait instead. What
// the feature actually costs is the difference:
//
//     30 turns × (STAGE_MS − BEAT_MS) = 30 × 320ms ≈ 9.6s over a whole night
//
// Ten seconds is worth paying. Ninety is not. Every millisecond added to
// STAGE_MS is multiplied by thirty, which is the reason the number is where it
// is rather than wherever looked good on one viewing. Anyone raising it should
// do that multiplication first and put the answer in the commit message.
//
// ---- Three independent ways out ---------------------------------------------
// They are not the same setting and none of them implies another:
//
//   prefers-reduced-motion  an OS-level statement about vestibular safety. No
//                           motion at all — the scene is composed and held.
//   calm mode               a choice about intensity, not motion. The scene
//                           plays; the assault in it does not.
//   fast mode               a choice about pace. No stage at all: the game runs
//                           exactly as it did before this file existed.
//
// The established policy for the first two is "remove the assault, keep the
// information", and it holds here for a reason particular to this feature: the
// information never lived on the stage in the first place. eventBeat writes the
// line to the log BEFORE calling in, so every gate below can take the whole
// picture away without taking anything away. That ordering is load-bearing —
// see the note on skipping.

import { enterScene, leaveScene, icon, reducedMotion } from "./render.js";
import { isCalm } from "./audio.js";

// The beat the stage is replacing. Kept here as its own name rather than
// imported from app.js so the arithmetic in the header can be checked against
// something local; app.js asserts the two agree.
export const BEAT_MS = 780;

// The budgets. A stage is not permitted to outlive its budget under any
// circumstances — the timer below is a deadline, not a duration, so a scene
// that hangs or animates longer than it promised is cut off rather than
// allowed to hold the turn.
const STAGE_MS = 1100;
const CALM_MS = 900; // less to look at, so less time wanted looking at it
const REDUCED_MS = 700; // a held frame; nobody needs a held frame for long

// How many times a run explains itself. The hint is for the player who does not
// yet know the stage can be dismissed; after that it is furniture, and
// furniture in the middle of the screen thirty times a night is worse than no
// hint at all.
const HINT_TIMES = 2;
let hintsLeft = HINT_TIMES;

const FAST_KEY = "jitp:fast";

// ---- Fast mode ---------------------------------------------------------------
// Deliberately its own preference rather than a mode of calm. Someone can want
// the full assault and none of the waiting, or every animation and no scares:
// intensity and pace are different complaints and get different switches. That
// is the same argument calm mode makes against being folded into
// prefers-reduced-motion, and it is the same answer.
function readFast() {
  try {
    return localStorage.getItem(FAST_KEY) === "1";
  } catch {
    return false; // storage blocked: the game is what it is
  }
}

let fast = readFast();

export function isFast() {
  return fast;
}

export function setFast(next) {
  fast = !!next;
  try {
    localStorage.setItem(FAST_KEY, fast ? "1" : "0");
  } catch {
    /* the setting simply will not survive a reload */
  }
  return fast;
}

// Reset per run, so a second night explains itself again to whoever picked the
// game up in between. Cheap, and the alternative is a setting nobody asked for.
export function resetStageHints() {
  hintsLeft = HINT_TIMES;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- The one entry point ------------------------------------------------------
// Always resolves, never rejects, and always takes SOME time: the caller is
// pacing a turn on this, and a stage that returns instantly because its art is
// missing would turn a missing sprite into a game that reads as broken.
//
// `kind` is one of the SCENES keys. An unknown kind is not an error worth
// throwing over — it still gets the beat, it just gets no picture.
export function eventStage(kind, opts = {}) {
  const scene = SCENES[kind];
  if (!scene) return wait(BEAT_MS);

  // Fast mode is defined as the game before this file: the same beat, no stage.
  if (fast) return wait(BEAT_MS);

  // No DOM to stage into (the headless suite, mostly). Take the beat and go.
  if (typeof document === "undefined" || !document.body) return wait(BEAT_MS);

  const reduced = reducedMotion();
  const calm = isCalm();
  const budget = reduced ? REDUCED_MS : calm ? CALM_MS : STAGE_MS;

  return new Promise((resolve) => {
    // Never stack. A fight can follow a rite in the same turn and each would
    // otherwise leave its own full-screen layer behind — the same rule the
    // jump scare follows against itself.
    const stale = document.querySelector(".evstage");
    if (stale) stale.remove();

    const el = document.createElement("div");
    el.className = `evstage evstage--${kind}`;
    // The log already said what happened, in the live region, before this was
    // called. This layer is the same sentence drawn in paint, so announcing it
    // again would be the screen reader hearing the news twice.
    el.setAttribute("aria-hidden", "true");
    if (calm) el.classList.add("evstage--calm");
    if (reduced) el.classList.add("evstage--still");

    const inner = document.createElement("div");
    inner.className = "evstage-inner";
    el.appendChild(inner);

    // Build before showing, so a scene that throws takes the stage down with it
    // rather than leaving a black rectangle over the board.
    try {
      scene(inner, { ...opts, calm, reduced });
    } catch {
      el.remove();
      return resolve(wait(BEAT_MS));
    }

    if (hintsLeft > 0 && opts.skipHint) {
      hintsLeft--;
      const hint = document.createElement("p");
      hint.className = "evstage-hint";
      hint.textContent = opts.skipHint;
      el.appendChild(hint);
    }

    enterScene();
    document.body.appendChild(el);

    let done = false;
    let timer = 0;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      el.removeEventListener("click", onClick);
      el.remove();
      leaveScene();
      resolve();
    };

    // ---- Skipping -------------------------------------------------------
    // Safe precisely because the beat's information is already in the log:
    // skipping costs the player the picture and nothing else. If a stage ever
    // becomes the only place something is said, this stops being true and the
    // skip becomes a way to miss the game — so the rule is that a scene may
    // illustrate the line, never carry it.
    const onClick = () => finish();

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Tab still walks the page: someone navigating by keyboard is not asking
      // to dismiss anything, and trapping Tab here would strand them.
      if (e.key === "Tab") return;
      // Swallowed rather than merely handled. The choices for this turn are
      // mounted the moment this resolves, and a keyup/keypress arriving after
      // that could otherwise land on a button that did not exist when the key
      // went down — the same "a mashed key finds nothing" rule the dark door
      // and the search beat are built on.
      e.preventDefault();
      e.stopPropagation();
      finish();
    };

    // Capture, so the stage is dismissed before any page-level shortcut sees
    // the key — M for mute in particular should not fire while the way out of
    // a full-screen layer is "press anything".
    window.addEventListener("keydown", onKey, true);
    el.addEventListener("click", onClick);

    timer = setTimeout(finish, budget);
  });
}

// ---- The scenes ---------------------------------------------------------------
// The pictures (#34). Each one fills the stage the frame above has already
// built, timed and gated; a scene does not time itself, does not listen for
// anything and does not clean up, which is what keeps them replaceable one at a
// time.
//
// ctx: { n, hp, calm, reduced, ... }
//
// Three rules, all load-bearing above:
//   1. Illustrate the line, never carry it. eventBeat writes the news to the
//      log BEFORE calling in, and that is the only reason skipping is safe. A
//      scene that became the only place something was said would turn the skip
//      affordance into a way to miss the game.
//   2. Honour ctx.reduced by composing rather than animating. The frame will not
//      stop a scene from animating; it only stops it running long.
//   3. Nothing strobes, at any tier, ever. Same rule the 僵屍 tiers are held to.
//
// Built from layer spans plus a centrepiece, the same grammar the scare dressing
// uses, so the two full-screen registers are made of the same material.

// A wash, a vignette, a drift — whatever the scene needs behind its subject.
function layer(inner, name) {
  const n = document.createElement("span");
  n.className = `evs-${name}`;
  n.setAttribute("aria-hidden", "true");
  inner.appendChild(n);
  return n;
}

function art(kind, id, cls = "") {
  return icon(kind, id, `evstage-art ${cls}`.trim());
}

function seat(inner, node, { x = 50, y = 50, scale = 1 } = {}) {
  if (!node) return null;
  const box = document.createElement("span");
  box.className = "evstage-seat";
  box.style.left = `${x}%`;
  box.style.top = `${y}%`;
  box.style.setProperty("--seat-scale", String(scale));
  box.appendChild(node);
  inner.appendChild(box);
  return box;
}

// Where a pack stands. Same idea as the scare's slots — the one in front is
// nearest and largest — but its own table, because this is a composition rather
// than a lunge.
const PACK_SLOTS = [
  [50, 54, 1.00], [30, 58, 0.82], [70, 58, 0.82],
  [17, 62, 0.66], [83, 62, 0.66], [50, 66, 0.58],
];

const SCENES = {
  // 僵屍, scaling with n. Registered and reachable, but eventBeat does NOT run
  // it: a drawn JIANGSHI goes on to fightBeat, which stages the pack with
  // jumpScare and its four tiers, and two full-screen layers back to back is one
  // too many. fightBeat has three callers and only one arrives through an event
  // beat — the breach and the refused villager reach it directly — so the scare
  // has to stay where it is, and the tiers ride it rather than this.
  pack(inner, ctx) {
    const n = Math.max(1, Math.min(Number(ctx.n) || 1, PACK_SLOTS.length));
    layer(inner, "dark");
    for (let i = 0; i < n; i++) {
      const [x, y, scale] = PACK_SLOTS[i];
      seat(inner, art("scare", "zombie"), { x, y, scale });
    }
  },

  // −1 HP. The blow, not the wound: this runs before resolveEvent, so the hearts
  // in the HUD have not moved yet and the stage is the moment they are about to.
  // The frame is struck from one side — a bad step in the dark has a direction
  // even when the game does not name one.
  hurt(inner, ctx) {
    layer(inner, "strike");
    layer(inner, "bleed");
    seat(inner, art("stat", "heart", "evstage-art--hurt"), { y: 46 });
    inner.appendChild(tally(ctx.hp, "hurt"));
  },

  // +1 HP. The same organ read the other way, and the opposite motion: the hurt
  // scene arrives from the edge, this one rises from underneath. Distinct by
  // colour, by direction and by sign — three ways, because two hearts a night
  // apart should never be mistaken for each other.
  mend(inner, ctx) {
    layer(inner, "warm");
    seat(inner, art("stat", "heart", "evstage-art--mend"), { y: 46 });
    inner.appendChild(tally(ctx.hp, "mend"));
  },

  // Nothing happens — which IS an event, and the one most easily mistaken for
  // the game having failed to do anything. That is exactly why it gets a stage:
  // the room was looked at, and there was nothing in it. A held ring and the
  // dust still settling, rather than an empty frame.
  nothing(inner) {
    layer(inner, "dust");
    const ring = document.createElement("span");
    ring.className = "evstage-nil";
    inner.appendChild(ring);
  },

  // 中毒 onset. Not a blow — a change of state — so it is the only scene that
  // takes the whole frame rather than putting something in the middle of it. The
  // grey comes in from the edges, the way it comes in from your hands.
  poison(inner) {
    inner.classList.add("evstage-inner--wash");
    layer(inner, "creep");
    seat(inner, art("ui", "skull", "evstage-art--poison"));
  },

  // 村民受傷. Someone is alive in here and hurt, and the rice is the question
  // that follows — so the picture is the person, with what you could spend on
  // them beside it. The figure is the same silhouette the board uses for you,
  // which is the point: it could have been.
  villager(inner) {
    layer(inner, "lantern");
    seat(inner, art("scene", "standing", "evstage-art--villager"), { x: 42, y: 52, scale: 1 });
    seat(inner, art("item", "sticky-rice", "evstage-art--rice"), { x: 63, y: 60, scale: 0.5 });
  },
};

// The number, drawn big. The one piece of text on any stage, and it is a numeral
// that the log has already said in words — so it needs no theme key and carries
// nothing a skipping player loses.
function tally(hp, tone) {
  const n = Number(hp);
  const p = document.createElement("p");
  p.className = `evstage-tally evstage-tally--${tone}`;
  p.textContent = Number.isFinite(n) && n !== 0
    ? (n > 0 ? `+${n}` : String(n))
    : "";
  return p;
}

// The registry, for the suite and for anything that wants to know what exists
// without reaching into the table.
export function stageKinds() {
  return Object.keys(SCENES);
}

// The budget a stage is held to, given the gates in force.
export function stageBudgetMs({ calm = false, reduced = false } = {}) {
  return reduced ? REDUCED_MS : calm ? CALM_MS : STAGE_MS;
}

// What the whole feature costs a night, which is the number the header does the
// arithmetic on. Exported so the suite can hold it to a ceiling: the pacing
// constraint in #33 is the kind of thing that decays into a comment nobody
// re-derives, and a comment cannot fail a build.
export function nightCostMs(turns = 30) {
  return turns * (STAGE_MS - BEAT_MS);
}
