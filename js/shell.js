// The app shell: install, fullscreen, wake lock. Everything here is optional
// and every part of it is absent somewhere — iOS has no Wake Lock, older
// Safari has a prefixed fullscreen, a plain http:// origin has no service
// worker at all. So each piece is feature-detected and each failure is silent:
// the game is exactly as playable without any of it.

import { sleep as sleepAudio } from "./audio.js";

// ---- Which build is actually running ----------------------------------------
// WHAT THIS EXISTS TO SETTLE. The shell is cache-first, so the page you are
// reading was served by the worker that was installed BEFORE this deploy. The
// handover below fixes that for the next load — but it is guarded, deliberately,
// and a player who starts a run inside the grace window keeps the old modules
// for the whole session. That is correct behaviour and it is also invisible:
// nothing on the page says which version of the code is executing.
//
// It cost a listening test. A change to js/audio.js shipped, the owner listened,
// heard nothing, and NOBODY COULD TELL whether they had run the new code or the
// old — the change had no visual signal, so "still silent" and "still the old
// build" are the same observation. A deploy whose arrival cannot be observed
// gets re-tested by ear until somebody thinks of this.
//
// So: `window.__build` in any console, and compare it against
// tools/record_shell.py's output for the commit you expect. Different means the
// page is running an older shell, whatever the service worker has installed —
// and those two CAN disagree, which is the whole trap.
//
// STAMPED FROM THE WORKING TREE, NOT THE COMMITTED BLOB, for the same reason
// HARNESS_ID is: the point is to catch a module in memory that is older than the
// file on disk, so the id has to move the moment the file does, committed or
// not. record_shell.py blanks this line before hashing, or it would be hashing
// itself.
export const BUILD_ID = "a10947eb";

// Announced rather than merely exported, because the person who needs it is
// standing at a console on a phone with no way to import anything.
try {
  window.__build = BUILD_ID || "(unstamped: run tools/record_shell.py)";
} catch {
  /* no window, nothing to announce to */
}

// ---- Service worker ---------------------------------------------------------
// Registered relative, because this ships under a subpath and an absolute "/sw.js"
// would ask for the domain root and get a 404 (or worse, somebody else's worker).
// The first visit after a deploy used to show the PREVIOUS build, and that is
// what "I cannot see the animations" turned out to be: the shell is cache-first,
// so the page you are reading was served from the old cache before the new
// worker existed. sw.js already calls skipWaiting and clients.claim, so the new
// worker takes over during that same visit — but by then this document and its
// modules have already been handed over from the old one. The player has to
// come back a second time to see what shipped.
//
// So when the controller actually changes, reload once and let the new worker
// serve the page it was installed for.
//
// GUARDED BY WHETHER ANYBODY IS PLAYING, and only then by the clock. A deploy
// that lands mid-run must not pull the floor out from under somebody: the board
// is dealt on load and NOTHING about a run in progress is persisted, so a reload
// costs every turn taken so far.
//
// The clock alone was not enough, and the difference is not theoretical: a
// handover at second nine would have reloaded a player who had already taken
// two or three turns. The elapsed time is the outer bound for the case where
// nobody has touched anything; whether a run has begun is the actual question,
// so it is now asked directly rather than approximated.
export const HANDOVER_GRACE_MS = 10000;

// Set by whoever owns a run — app.js, the moment the first turn is spent. The
// shell has no idea what a game is and should not learn; it only needs to be
// told that one is under way.
let runInProgress = false;
export function markRunInProgress(on = true) {
  runInProgress = !!on;
}

// The decision, pulled out of the listener so it can be tested rather than
// merely asserted to exist. Every branch here is a way of NOT reloading, and
// the two that matter are the last two: a handover long after the page opened
// belongs to somebody who is playing, and a second handover must never turn
// into a loop.
export function shouldReloadOnHandover({ hasController, openedAt, now, reloading, playing }) {
  if (reloading) return false; // controllerchange can fire more than once
  if (!hasController) return false; // a worker leaving, not one arriving
  if (playing) return false; // somebody is in a run, and a run is not saved
  return now - openedAt <= HANDOVER_GRACE_MS;
}

export function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;

  const openedAt = Date.now();
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const go = shouldReloadOnHandover({
      hasController: !!navigator.serviceWorker.controller,
      openedAt,
      now: Date.now(),
      reloading,
      playing: runInProgress,
    });
    if (!go) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline play is a bonus, never a requirement */
    });
  });
}

// ---- Fullscreen -------------------------------------------------------------
// Only offered when the browser has the API and the game is not already
// running installed — in standalone there is no chrome left to hide.
const installed = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

// Fullscreen went with the utility panel (#73). Worth recording accurately:
// the button was `hidden` in the markup but this code UNHID it wherever the
// browser supported fullscreen and the app was not installed, so it was a
// visible control for most desktop players rather than dead markup. Removed by
// ruling, not because nobody saw it. F11 and the browser's own menu remain.

// ---- Wake lock --------------------------------------------------------------
// The screen must not sleep in the middle of a run. Held while a game is in
// progress and dropped the moment it is not — a lock kept over a verdict screen
// is just a flat battery.
//
// The OS drops the lock whenever the tab is hidden and does not give it back, so
// visibilitychange has to re-take it. That is the part that is easy to miss and
// the reason this is not three lines.
let lock = null;
let wanted = false;

async function take() {
  if (!wanted || lock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => {
      lock = null;
    });
  } catch {
    lock = null; // denied, or the platform has no such thing
  }
}

export function keepAwake(on) {
  wanted = !!on;
  if (wanted) {
    take();
  } else if (lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}

// ---- Asleep ------------------------------------------------------------------
// The atmosphere is a dozen animations that never stop — grain, motes, the
// breathing vignette, the candle, the fog on the menu — plus a Web Audio graph.
// In a pocketed phone all of it is work done for nobody.
//
// So a hidden page sleeps: one class pauses the loops, and the audio context is
// suspended. Presentation only. The game is turn-based and already waiting, and
// nothing here touches a timer that a turn is sitting on — the rule is pause
// loops, never beats.
function setAsleep(hidden) {
  const body = document.body;
  if (body) body.classList.toggle("asleep", hidden);
  sleepAudio(hidden);
}

// Called by each page that has something to put to sleep — the game and the
// menu. A named call rather than a side effect of importing this file, so that
// importing it for the fullscreen button alone does not silently install a
// visibility handler as well.
export function wireSleep() {
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState !== "visible";
    setAsleep(hidden);
    // The OS drops the wake lock whenever the tab is hidden and does not give
    // it back, so coming into view is where it has to be re-taken.
    if (!hidden) take();
  });

  // A page can be loaded already hidden — opened in a background tab, or
  // restored by the browser on startup — and then no visibilitychange ever
  // fires and it would animate away unseen for as long as it stayed there.
  setAsleep(document.visibilityState !== "visible");
}
