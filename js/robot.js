// A robot that PLAYS THE PAGE, and a warning about what it is not.
//
// ────────────────────────────────────────────────────────────────────────────
// THIS IS NOT THE SWEEP BRAIN, AND NOTHING IT DOES IS BALANCE DATA.
//
// tools/bots.js is the measuring instrument: four policies, a thousand seeds
// each, dice of their own, engine-level. When somebody asks how often the
// hunter buries the tablet, THAT is the file with the answer, and its report
// is the only thing quotable.
//
// This file is the opposite kind of thing. It is a UI EXERCISER. It presses
// what a player can press — the doorways, the action cards, the way out of a
// stage, the button on the verdict — and it chooses among them by flipping its
// own coin. It has no model of the game, no idea what an item is for, and it
// cannot tell a good move from a fatal one except that the UI has drawn one of
// them in red. Any tally of its wins and losses would be a measurement of
// random flailing, and worse than no number at all, because it would look like
// a number.
//
// So: never quote it. If a sentence needs a rate, it comes from
// tools/bots-report.md or it does not get said.
// ────────────────────────────────────────────────────────────────────────────
//
// WHAT IT IS FOR. The verdict card shipped three false statements while 280
// tests passed (#66), because the suites call the engine and the bots read
// `outcome`, and nothing in this project has ever RENDERED an ending and
// looked at it. A thing that plays the real page to a real verdict, over and
// over, is the cheapest way to put eyes on screens no instrument visits.
//
// WHY IT LIVES IN THE PAGE rather than in tools/. Three reasons, all of them
// things a harness cannot have:
//
//   1. A click on its button is a REAL USER GESTURE, so the run has audio,
//      which is a whole layer of the game no headless driver has ever heard.
//   2. It drives the shipped app.js, not a reconstruction of it. A driver that
//      builds its own game is testing the driver.
//   3. Anyone can watch it. It has a visible panel and a stop button, and the
//      person watching is the instrument — see tools/bots-report.md for what
//      the mechanised ones are for instead.
//
// ---- THE TWO RULES IT IS BUILT AROUND -------------------------------------
//
// IT MUST NOT TOUCH THE GAME'S DICE. A night at seed 4242 has to play out the
// same whether a person or this robot pressed the buttons, or every shared
// seed in existence quietly means something different when the robot is on.
// So its coin is Math.random and nothing else, and it imports neither engine
// nor board — there is no seeded stream in this file's scope to spend by
// accident. That is a claim, and claims of this shape have been wrong here
// before, so it is MEASURED rather than asserted: see robotSpendsNoDice() at
// the foot of this file, which wraps all seven streams, counts, and can be
// run from the console. It has to keep being true, not just have been true.
//
// IT DETECTS A STALL BY PROGRESS, NEVER BY ACTIVITY. The distinction is the
// whole design. A driver that watches its own clicking cannot tell playing
// from thrashing: a robot mashing a button that reopens the same window is
// maximally "active" and is going nowhere, and it will report itself healthy
// forever. The only honest question is whether THE NIGHT IS GETTING LATER, so
// the watchdog reads the in-game clock and nothing else. Clicks do not feed
// it. See progress().

// ---- The only thing it knows about the game --------------------------------
// Deliberately narrow, and narrow in a way that is enforced rather than
// promised: this returns a NUMBER, not the state. The chooser below cannot
// reach the game even if a later edit wanted it to, because nothing hands it
// anything to reach with. Reading the clock is observation; reading the state
// to pick a move would make this a policy, and policies belong in bots.js.
function progress() {
  const g = window.__game;
  const s = g && g.state;
  if (!s) return null;
  return typeof s.turn === "number" ? s.turn : null;
}

// Whether the night is over. Read from the GAME, never from the overlay's
// layout: two sessions have now made opposite errors reading offsetParent on
// the ending card — one counted a single loss eight times, the other counted a
// real ending as zero — because offsetParent answers a question about an
// element and they read it as a question about the player.
function nightOver() {
  const g = window.__game;
  const s = g && g.state;
  return !!s && s.status !== "playing";
}

// ---- What the page is showing right now ------------------------------------
// The same surface a player has, found the same way the game's own keyboard
// shortcuts find it: doorways if there are doorways, action cards otherwise.
// Kept in step with render.js's currentChoices() by copying its rule rather
// than importing it — this file is not allowed to reach into the game, and a
// four-line rule is a smaller debt than an exported private.
function choices() {
  const doorways = [...document.querySelectorAll(".doorway")].filter((b) => !b.disabled);
  if (doorways.length) return doorways;
  return [...document.querySelectorAll("#actions .action")].filter((b) => !b.disabled);
}

// The two full-screen "press anything" layers: the event stage and the reveal.
// Both listen on WINDOW in capture, which is why a driver that clicks the board
// does nothing at all and looks like a wedged game. This cost another session
// five separate failures.
function pressAnythingLayer() {
  return document.querySelector(".evstage, .reveal");
}

// ---- Its coin --------------------------------------------------------------
// Math.random, on purpose and by rule. Not the game's rng, not a seeded stream
// of its own: a seeded robot would be reproducible, which sounds like a virtue
// until somebody quotes a reproducible run as a result. This one is explicitly
// not reproducible, so nobody can mistake it for an experiment.
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// The one and only preference it has, and it is about COVERAGE, not play.
//
// A uniform random walker takes the lethal option roughly whenever it is
// offered and dies in the first few turns, which means it never reaches a
// verdict worth looking at — the screens this exists to render are the late
// ones. So it declines a card the UI has already drawn as fatal, unless that is
// all there is.
//
// This is a policy, and naming it is the point: it makes the robot's outcomes
// LESS representative than random, not more. Nothing here is a strategy — it
// reads the class the game itself put on the button. See the header.
function chooseFrom(list) {
  const survivable = list.filter((b) => !b.classList.contains("action--lethal"));
  return pick(survivable.length ? survivable : list);
}

// What to call the thing it just pressed, for the readout.
//
// Action cards carry a .action-label; DOORWAYS DO NOT, and every button in the
// game may carry a <kbd> with its number. Reading textContent off a doorway
// therefore produced "2STAY" and "1Apothecary" in the panel — the keyboard hint
// glued to the name. Cosmetic, and worth fixing precisely because the panel's
// whole job is to be read by a person who cannot ask it anything.
function labelOf(b) {
  const named = b.querySelector(".action-label");
  if (named) return named.textContent.trim().slice(0, 28);
  // A doorway's name is its aria-label and nothing else: the arrow inside it is
  // an aria-hidden chevron, so a doorway has no text to read and the readout
  // said "(unlabelled)" for every move the robot made. Taking the ACCESSIBLE
  // NAME here is not a workaround — it is the same string the game already
  // decided this control is called, in the language the page is in.
  const aria = b.getAttribute("aria-label");
  if (aria) return aria.trim().slice(0, 28);
  const clone = b.cloneNode(true);
  for (const k of clone.querySelectorAll("kbd, .sr-only")) k.remove();
  return clone.textContent.trim().replace(/\s+/g, " ").slice(0, 28) || "(unlabelled)";
}

// ---- The driver -------------------------------------------------------------

// The signal a step sends back when it has already booked its own next wake-up.
// A symbol rather than true/undefined so it cannot be produced by accident by a
// branch that just happens to return something truthy.
const HANDLED = Symbol("robot: this step scheduled its own continuation");

const TICK_MS = 420;          // one press per tick: watchable by a person
const STALL_MS = 25000;       // no in-game minute passing for this long = stuck
const NIGHT_PAUSE_MS = 1400;  // leave the verdict card up long enough to READ

export class Robot {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.running = false;
    this.timer = 0;
    this.nights = 0;
    this.presses = 0;
    this.last = "";
    this.status = "idle";
    // The watchdog's memory: the clock reading it last saw, and when it saw it.
    // Only these two fields ever move the deadline. Nothing about pressing.
    this.mark = null;
    this.markedAt = 0;
    // Set while the verdict card is deliberately being left up to be read.
    this.awaitingVerdict = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.status = "running";
    this.mark = progress();
    this.markedAt = Date.now();
    this.say("started");
    this.schedule();
  }

  stop(why = "stopped") {
    this.running = false;
    this.status = why;
    clearTimeout(this.timer);
    this.timer = 0;
    this.say(why);
  }

  say(what) {
    this.last = what;
    this.onChange(this);
  }

  schedule(ms = TICK_MS) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), ms);
  }

  // THE WATCHDOG. Read the clock; if it moved, the night is progressing and the
  // deadline resets. If it has not moved for STALL_MS, stop and SAY SO rather
  // than carrying on pressing — a robot that hides a stall is worse than no
  // robot, because somebody will leave it running and believe the screens got
  // covered.
  //
  // Note what is absent: this.presses is not consulted anywhere in here.
  checkProgress() {
    const now = progress();
    if (now !== this.mark) {
      this.mark = now;
      this.markedAt = Date.now();
      return true;
    }
    if (Date.now() - this.markedAt > STALL_MS) {
      this.stop(`stalled: the clock has not moved past turn ${this.mark} in ${Math.round(STALL_MS / 1000)}s`);
      return false;
    }
    return true;
  }

  tick() {
    if (!this.running) return;
    if (!this.checkProgress()) return;

    let owns = false;
    try {
      // A step that has arranged its OWN next wake-up says so by returning
      // HANDLED, and this must not schedule over the top of it.
      //
      // THIS IS WHERE THE FIRST VERSION WAS WRONG, and it is worth keeping the
      // wreck on the sign. step() set a timer to leave the verdict card up for
      // a beat; tick() then cheerfully cleared it and scheduled a normal tick;
      // that tick found the night still over and did the whole thing again.
      // The robot's own panel reported EIGHT NIGHTS from a single loss, and it
      // reported them confidently. Two other sessions have now made the same
      // miscount on this same ending card by different routes — this project
      // has an ending it cannot count.
      owns = this.step() === HANDLED;
    } catch (e) {
      // A driver that dies silently looks exactly like a driver that finished.
      this.stop("error: " + (e && e.message ? e.message : String(e)));
      return;
    }
    if (!owns) this.schedule();
  }

  // One press, chosen from whatever the page is showing, in the order the page
  // stacks them: a modal is over everything, a full-screen layer over the
  // board, the verdict over a finished night, the choices under all of it.
  step() {
    // The folded note on a first visit. It carries no action card, so a driver
    // looking only for choices sees an empty board and concludes the game is
    // broken.
    const note = document.querySelector(".notedismiss");
    if (note) {
      note.click();
      this.presses++;
      return this.say("read the note");
    }

    // "Press anything" — and it must be a KEY on WINDOW. Clicking the board
    // does nothing; the panel is not the listener.
    if (pressAnythingLayer()) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      this.presses++;
      return this.say("cleared a stage");
    }

    // The night ended. Look at the card for a beat — the whole reason this
    // exists is that somebody is watching this screen — then go again.
    if (nightOver()) {
      // Re-entry guard, belt to the HANDLED braces. One ending is one ending
      // however many times this branch is reached, so the counter cannot run
      // away again even if a later edit breaks the scheduling contract above.
      if (this.awaitingVerdict) return HANDLED;
      const again = document.querySelector(".overlay-actions .btn");
      if (!again) return this.say("waiting for the verdict");
      this.awaitingVerdict = true;
      this.say(`night ${this.nights + 1} ended — reading the verdict`);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (!this.running) return;
        again.click();
        // Counted HERE, on the way out of a verdict actually seen, rather than
        // on the way in. A night is finished when the robot has looked at its
        // card and moved on, which is a fact about a screen that got rendered.
        this.nights++;
        this.awaitingVerdict = false;
        // A fresh night restarts the clock, so the watchdog is re-marked here.
        // Without this the new turn 1 reads as "the clock has not moved" and a
        // working robot gets shot by its own guard.
        this.mark = progress();
        this.markedAt = Date.now();
        this.say(`night ${this.nights + 1} begins`);
        this.schedule();
      }, NIGHT_PAUSE_MS);
      return HANDLED;
    }

    const opts = choices();
    if (!opts.length) return this.say("nothing to press");

    const b = chooseFrom(opts);
    const label = labelOf(b);
    b.click();
    this.presses++;
    this.say(`pressed: ${label}`);
  }
}

// ---- The panel --------------------------------------------------------------
// Built to be WATCHABLE rather than watched by whoever started it. Everything
// it knows is on screen — running or stopped and why, which night, the in-game
// clock, and the last thing it pressed — because the session that runs this may
// be one that cannot see the page at all, and the person who can see it should
// not have to open a console to find out what it is doing.

let robot = null;

function panel() {
  let el = document.getElementById("robot-panel");
  if (el) return el;
  el = document.createElement("div");
  el.id = "robot-panel";
  el.innerHTML =
    '<strong>robot</strong>' +
    '<span id="robot-state"></span>' +
    '<span id="robot-last"></span>' +
    '<button type="button" id="robot-stop">Stop</button>';
  document.body.appendChild(el);
  el.querySelector("#robot-stop").addEventListener("click", () => robot && robot.stop("stopped by hand"));
  return el;
}

function paint(r) {
  const el = panel();
  const clock = progress();
  el.dataset.status = r.running ? "running" : "stopped";
  el.querySelector("#robot-state").textContent =
    `${r.status} · night ${r.nights + 1} · turn ${clock == null ? "?" : clock} · ${r.presses} presses`;
  el.querySelector("#robot-last").textContent = r.last;
  el.querySelector("#robot-stop").disabled = !r.running;
}

// The button that starts it. Mounted only when asked for — see mountRobot's
// caller — because a control that drives the game for you is not something to
// leave lying around on a page people are trying to play.
export function mountRobot(host) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "topbtn";
  b.id = "btn-robot";
  b.textContent = "Robot";
  b.addEventListener("click", () => {
    if (robot && robot.running) return robot.stop("stopped by hand");
    robot = robot || new Robot(paint);
    robot.start();
    paint(robot);
  });
  (host || document.querySelector(".topnav") || document.body).appendChild(b);
  return b;
}

// ---- The measurement that keeps the first rule honest ------------------------
// Run from the console on a live game:
//
//     (await import("/js/robot.js")).robotSpendsNoDice()
//
// It wraps EVERY seeded stream on the live state with a counter, drives the
// robot's own step() for a while, and reports how many draws it caused. The
// answer must be zero from every stream.
//
// Why a runtime count rather than a grep for "rng" in this file: a grep proves
// only that a spelling did not appear. Wrapping the streams and counting proves
// the streams did not move.
//
// AND IT IS BUILT TO BE ABLE TO FAIL, twice over.
//
// Pass {falsify: true} and it spends one draw from the game's rng on purpose
// before measuring. If that run does not come back non-zero, the counter is
// broken and a zero from the honest run means nothing. A negative assertion
// nobody has seen fail is not evidence.
//
// AND IT COUNTS ITS OWN PRESSES, because the first version of this did not and
// that was the real hole. "The robot spent no dice" is satisfied completely by
// a robot that did nothing at all — a night already over, a modal nobody
// dismissed, a selector that stopped matching after a rename — and the reading
// would be a clean zero every time. An empty haystack contains no needles. So
// a run that pressed nothing is reported as ok:false with `why` saying so,
// rather than passing quietly.
export function robotSpendsNoDice({ steps = 12, falsify = false } = {}) {
  const g = window.__game;
  const s = g && g.state;
  if (!s) return { ok: false, why: "no game on the page: start a night first" };

  const STREAMS = ["rng", "phantomRng", "scareRng", "gutterRng", "standingRng", "searchRng", "eventRng"];
  const counts = {};
  const originals = {};
  for (const name of STREAMS) {
    if (typeof s[name] !== "function") continue;
    counts[name] = 0;
    originals[name] = s[name];
    s[name] = (...a) => {
      counts[name]++;
      return originals[name](...a);
    };
  }
  if (!Object.keys(counts).length) {
    return { ok: false, why: "no streams found on the state: the shape changed, and this check is stale" };
  }

  let presses = 0;
  try {
    if (falsify) s.rng(); // the deliberate failure, to prove the counter counts
    const r = new Robot(() => {});
    r.running = true;
    for (let i = 0; i < steps; i++) {
      try {
        r.step();
      } catch {
        /* a step that finds nothing to press is not a draw */
      }
    }
    r.running = false;
    presses = r.presses;
  } finally {
    for (const name of Object.keys(originals)) s[name] = originals[name];
  }

  const spent = Object.entries(counts).filter(([, n]) => n > 0);
  const drewNothing = spent.length === 0;
  const pressedNothing = presses === 0;
  return {
    ok: falsify ? spent.length > 0 : drewNothing && !pressedNothing,
    why: pressedNothing
      ? "THIS RUN PRESSED NOTHING, so zero draws proves nothing. Start a night and run it again."
      : null,
    expected: falsify
      ? "at least one draw (this run cheats on purpose)"
      : "zero draws from every stream, over a run that actually pressed something",
    presses,
    counts,
    spent,
  };
}
