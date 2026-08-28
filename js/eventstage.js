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

import { enterScene, leaveScene, icon, reducedMotion, grain,
         clearRevealPanel, HINT_TIMES } from "./render.js";

// The beat the stage is replacing. Kept here as its own name rather than
// imported from app.js so the arithmetic in the header can be checked against
// something local; app.js asserts the two agree.
export const BEAT_MS = 780;

// The budgets. A stage is not permitted to outlive its budget under any
// circumstances — the timer below is a deadline, not a duration, so a scene
// that hangs or animates longer than it promised is cut off rather than
// allowed to hold the turn.
const STAGE_MS = 1100;
const REDUCED_MS = 700; // a held frame; nobody needs a held frame for long

// How many times a run explains itself. The hint is for the player who does not
// yet know the stage can be dismissed; after that it is furniture, and
// furniture in the middle of the screen thirty times a night is worse than no
// hint at all.
// The number lives in render.js so the two layers over the board cannot drift
// apart on how often a run explains itself. The budgets stay separate: this
// hint teaches an optional skip, the reveal's teaches a required click.
let hintsLeft = HINT_TIMES;

// ---- Fast mode, retired (#72) -------------------------------------------------
// A pace opt-out: the same beat, no stage. Retired with calm by the same user
// ruling — default off, nothing switches it, and that is expected.
//
// The READ went with it deliberately. A stale jitp:fast = "1" would otherwise
// keep skipping every scene for a player with nothing left to turn it off, and
// the point of the ruling is that the default is authoritative rather than a
// value a leftover key can override.

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

  // No DOM to stage into (the headless suite, mostly). Take the beat and go.
  if (typeof document === "undefined" || !document.body) return wait(BEAT_MS);

  const reduced = reducedMotion();
  const budget = reduced ? REDUCED_MS : STAGE_MS;

  return runStage({
    cls: `evstage--${kind}`,
    // #95: OVER THE TILE, AT TILE SIZE, UNFRAMED. An event is not a thing being
    // handed to you, it is the room doing something, so it does not get a box.
    //
    // A RULE ONCE STOOD HERE and it is gone: framed meant "here is a thing" and
    // full-bleed meant "this is happening", which stopped being true the moment
    // #97 unframed the reveal panel as well. The two layers over the board are
    // no longer told apart by their frames, because neither has one.
    //
    // They are told apart by HOW THEY END, and that is the difference worth
    // knowing here: this ends on a beat, because a night holds thirty of them
    // and thirty clicks is not a game. The reveal waits for a click, because
    // there are a handful a night and each one is news. That is why the budget
    // below is still this function's problem and is not the reveal's.
    //
    // The 殭屍王 does not take this branch. His is the one set-piece that is not
    // an event beat, it plays once a night, and full screen is the point of it.
    onTile: true,
    build: (inner, ctx) => scene(inner, ctx),
    ctx: { ...opts, reduced },
    budget, reduced,
    skipHint: opts.skipHint,
    // A scene that throws still owes the caller the beat it was pacing on.
    onBuildError: () => wait(BEAT_MS),
  });
}

// ---- 殭屍王 ---------------------------------------------------------------------
// His own set-piece, and the reason it is here rather than in the SCENES table:
// it is not an event beat. It plays once a night, at the appointment the whole
// night has been walking toward, and it is exempt from the thirty-times tax the
// event scenes are capped by — so it gets its own budget and no registry entry.
//
// Everything the pack does, inverted. The pack RISES: an approaching rhythm,
// the question being how fast they reach you. He FALLS. There is no hop, no
// rush and no lunge — the frame opens on him ALREADY STANDING, and the only
// movement in the whole scene is one slow step that changes nothing.
//
// §9 BINDS HARDER HERE THAN ANYWHERE. This plays immediately before the one
// comparison the game never explains, so there is no text in this scene at all:
// no numbers, no hint of a threshold, nothing that grades what you are holding.
// The safest way to keep a secret in a scene is to give the scene nothing to
// say, and that is what this does.
const KING_MS = 2500;
const KING_REDUCED_MS = 1400;

// Takes no options, and that is the §9 decision made structural. It was passed a
// skipHint at first, which put "press anything to go on" across the one arrival
// the whole night walks toward — chrome in the middle of the set-piece, and 19
// characters of text in a scene whose whole defence is having none. The test
// asserting the scene was wordless passed anyway, because it called this without
// a hint and so never exercised the path the game actually uses.
//
// The skip still works. By midnight the hint has been shown twice already, and a
// scene that cannot be handed text cannot be handed the wrong text.
export function kingScene() {
  // Fast mode keeps what the game did before this scene existed: the sting, and
  // then straight to the question. Nothing is skipped that carries information,
  // because this scene never carried any.
  if (typeof document === "undefined" || !document.body) return Promise.resolve();

  const reduced = reducedMotion();
  const budget = reduced ? KING_REDUCED_MS : KING_MS;

  return runStage({
    cls: "kingscene",
    build: buildKing,
    ctx: { reduced },
    budget, reduced,
    onBuildError: () => undefined,
  });
}

// He is already there. The only thing that arrives is the room's reaction to
// him: the frost off his feet, the light leaning away, the shadow reaching out
// past the frame. Layers, like everything else that paints full screen.
function buildKing(inner, ctx) {
  // The shadow is built FIRST and is full from the opening frame — it is the
  // layer that arrives before the man, and he resolves out of the dark behind
  // it a beat later.
  for (const part of ["shadow", "dark", "bow", "frost", "weave"]) {
    const n = document.createElement("span");
    n.className = `king-${part}`;
    n.setAttribute("aria-hidden", "true");
    inner.appendChild(n);
  }
  const fig = document.createElement("span");
  fig.className = "king-fig";
  fig.setAttribute("aria-hidden", "true");
  const art = icon("king", "figure", "king-art");
  if (art) fig.appendChild(art);
  inner.appendChild(fig);
  grain(inner, 0.22);
}

// ---- The frame ----------------------------------------------------------------
// One owner for enter, skip, deadline and exit, shared by the event scenes and
// by the King. Extracted rather than copied: a second copy of the skip handling
// is a second place for a listener to leak, and the whole reason skipping is
// safe is a property of this function rather than of any scene.
function runStage({ cls, build, ctx, budget, reduced, skipHint, onBuildError, onTile }) {
  return new Promise((resolve) => {
    // Never stack. A fight can follow a rite in the same turn and each would
    // otherwise leave its own full-screen layer behind — the same rule the
    // jump scare follows against itself.
    const stale = document.querySelector(".evstage");
    if (stale) stale.remove();
    // One layer over the board at a time. A search reveal may still be standing
    // if the player clicked through it, and finishing it here is what keeps its
    // timer from firing the rest of that turn underneath this panel — removal
    // and cancellation are the same call on purpose.
    if (onTile) clearRevealPanel();

    // Where it mounts. On the tile it is a panel over the board and belongs to
    // the board's own anchor, beside the reveal and the actions pop-out; the
    // full-screen stages stay on body.
    const host = onTile ? document.querySelector(".board-pane") : null;

    const el = document.createElement("div");
    el.className = `evstage ${cls}` + (host ? " evstage--tile" : "");
    // The log already said what happened, in the live region, before this was
    // called. This layer is the same sentence drawn in paint, so announcing it
    // again would be the screen reader hearing the news twice.
    el.setAttribute("aria-hidden", "true");
    if (reduced) el.classList.add("evstage--still");

    const inner = document.createElement("div");
    inner.className = "evstage-inner";
    el.appendChild(inner);

    // Build before showing, so a scene that throws takes the stage down with it
    // rather than leaving a black rectangle over the board.
    try {
      build(inner, ctx);
    } catch {
      el.remove();
      return resolve(onBuildError ? onBuildError() : undefined);
    }

    if (hintsLeft > 0 && skipHint) {
      hintsLeft--;
      const hint = document.createElement("p");
      hint.className = "evstage-hint";
      hint.textContent = skipHint;
      el.appendChild(hint);
    }

    // The letterbox is a FULL-SCREEN device — bars across the top and bottom of
    // the window — so a panel that only covers the tile does not raise it. The
    // King still does.
    if (!host) enterScene();
    (host || document.body).appendChild(el);

    let done = false;
    let timer = 0;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      el.removeEventListener("click", onClick);
      el.remove();
      if (!host) leaveScene();
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
// ctx: { n, hp, reduced, ... }
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

// ---- The film ------------------------------------------------------------------
// Two lights and nothing else. The lantern is tungsten — the living's light,
// the one you carry — and the moon is a corpse-green white that belongs to the
// other thing. Everything between them is desaturated, the blacks swallow, and
// RED is spent on nothing but 硃砂 and talisman paper. A scene that reaches for
// red for any other reason has spent the only saturated colour in the film.
//
// Motion grammar, which is the part that makes it horror rather than
// decoration: no bounce and no cartoon timing. A long hold in which almost
// nothing changes, then ONE sudden completion. The scare is the thing that did
// not move, moving once — so the keyframes below sit still for two thirds of
// their budget and then arrive.

// A flat layer over the stage. One job each, composed rather than choreographed.
function layer(inner, name) {
  const n = document.createElement("span");
  n.className = "evs-" + name;
  n.setAttribute("aria-hidden", "true");
  inner.appendChild(n);
  return n;
}

// Fog, in layers that drift at different speeds. Slow enough that you are not
// certain it is moving, which is the whole of the effect — a fog you can see
// moving is weather, and a fog you cannot is a room that is wrong.
function fog(inner, n) {
  const count = n || 2;
  for (let i = 0; i < count; i++) {
    const f = document.createElement("span");
    // Two classes: one for what it is, one for which layer — the drift speeds
    // and offsets differ per layer and that difference is the whole illusion.
    f.className = "evs-fog evs-fog--" + i;
    f.setAttribute("aria-hidden", "true");
    inner.appendChild(f);
  }
}

function art(kind, id, cls) {
  return icon(kind, id, ("evstage-art " + (cls || "")).trim());
}

function seat(inner, node, opts) {
  if (!node) return null;
  const o = opts || {};
  const box = document.createElement("span");
  box.className = "evstage-seat";
  box.style.left = (o.x == null ? 50 : o.x) + "%";
  box.style.top = (o.y == null ? 50 : o.y) + "%";
  box.style.setProperty("--seat-scale", String(o.scale == null ? 1 : o.scale));
  box.appendChild(node);
  inner.appendChild(box);
  return box;
}

// Where a pack stands. #45 restages these properly; the composition stays so
// the slot is not empty in the meantime.
const PACK_SLOTS = [
  [50, 54, 1.00], [30, 58, 0.82], [70, 58, 0.82],
  [17, 62, 0.66], [83, 62, 0.66], [50, 66, 0.58],
];

const SCENES = {
  // 僵屍. Registered and reachable, but eventBeat does NOT run it: a drawn
  // JIANGSHI goes on to fightBeat, which stages the pack with jumpScare and its
  // four tiers. Restaged into the new language only as far as the ground it
  // stands on — the figures themselves are #45.
  pack(inner, ctx) {
    layer(inner, "ink");
    fog(inner, 2);
    const n = Math.max(1, Math.min(Number(ctx.n) || 1, PACK_SLOTS.length));
    for (let i = 0; i < n; i++) {
      const slot = PACK_SLOTS[i];
      seat(inner, art("scare", "zombie"), { x: slot[0], y: slot[1], scale: slot[2] });
    }
    grain(inner, 0.2);
  },

  // The wound you do not see. No blood and no number: the frame simply goes
  // darker from one side while the lantern gives up some of its reach, and you
  // find out what it cost from the log, where the news has always lived.
  //
  // The old staging put a big red heart and a "-1" on screen. Both are gone —
  // the numeral was a placeholder crutch by its own comment, and red is spent
  // on 硃砂 and paper now.
  hurt(inner) {
    layer(inner, "ink");
    layer(inner, "tungsten");
    fog(inner, 1);
    layer(inner, "wound");
    grain(inner, 0.26);
  },

  // Tungsten coming back. The one scene in the set that gets warmer, and it
  // arrives from below like a lamp being carried back into the room rather than
  // switched on.
  mend(inner) {
    layer(inner, "ink");
    layer(inner, "warmth");
    fog(inner, 1);
    grain(inner, 0.2);
  },

  // 屍毒 looking for the heart. Ink in water: it enters at the corners, holds,
  // and then reaches — one motion, further than you expect. The only green in
  // the film, and it is the corpse-white moon rather than anything living.
  poison(inner) {
    layer(inner, "ink");
    layer(inner, "moon");
    layer(inner, "creep");
    fog(inner, 2);
    grain(inner, 0.3);
  },

  // Nothing happens, and this is the one that has to be the best in the game.
  // The room simply watches. One candle breathes — a single slow swell and
  // release, no flicker, nothing arriving — and the grain sits over the top of
  // a black that gives nothing back.
  //
  // It is an event, and the most easily mistaken for the game having failed to
  // do anything, which is exactly why it gets the most careful staging of the
  // six. The horror is that you looked and the room was already looking.
  nothing(inner) {
    layer(inner, "ink");
    layer(inner, "candle");
    layer(inner, "watch");
    fog(inner, 2);
    grain(inner, 0.3);
  },

  // A figure at the edge of the light. Mostly out of it — you get an outline and
  // a posture, and the posture is very slightly not a person's: too upright,
  // tilted a few degrees off true, arms that are not hanging the way arms hang.
  //
  // That wrongness is the whole scene, because this is the event that can become
  // a fight. Refuse the rice and it stands up straight.
  villager(inner) {
    layer(inner, "ink");
    layer(inner, "tungsten");
    fog(inner, 2);
    const fig = seat(inner, art("scene", "standing", "evstage-art--villager"),
                     { x: 63, y: 56, scale: 1 });
    if (fig) fig.classList.add("evs-wrong");
    grain(inner, 0.26);
  },
};

// The registry, for the suite and for anything that wants to know what exists
// without reaching into the table.
export function stageKinds() {
  return Object.keys(SCENES);
}

// The budget a stage is held to, given the gates in force.
export function stageBudgetMs({ reduced = false } = {}) {
  return reduced ? REDUCED_MS : STAGE_MS;
}

// The King's, which is a different number for a different reason: once a night
// rather than thirty times, so it is exempt from the tax the event scenes are
// capped by. Still a deadline rather than a duration — cut off, never extended,
// because the kit question must not wait on an animation.
export function kingBudgetMs({ reduced = false } = {}) {
  return reduced ? KING_REDUCED_MS : KING_MS;
}

// What the whole feature costs a night, which is the number the header does the
// arithmetic on. Exported so the suite can hold it to a ceiling: the pacing
// constraint in #33 is the kind of thing that decays into a comment nobody
// re-derives, and a comment cannot fail a build.
export function nightCostMs(turns = 30) {
  return turns * (STAGE_MS - BEAT_MS);
}
