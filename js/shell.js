// The app shell: install, fullscreen, wake lock. Everything here is optional
// and every part of it is absent somewhere — iOS has no Wake Lock, older
// Safari has a prefixed fullscreen, a plain http:// origin has no service
// worker at all. So each piece is feature-detected and each failure is silent:
// the game is exactly as playable without any of it.

import { sleep as sleepAudio } from "./audio.js";

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
// GUARDED BY HOW LONG THE PAGE HAS BEEN OPEN, deliberately. A deploy that lands
// while somebody is on turn twenty-two must not pull the floor out from under
// them; they will get the new build the next time they open it. Only a handover
// during the opening moments of a load is one nobody is standing in.
export const HANDOVER_GRACE_MS = 10000;

// The decision, pulled out of the listener so it can be tested rather than
// merely asserted to exist. Every branch here is a way of NOT reloading, and
// the two that matter are the last two: a handover long after the page opened
// belongs to somebody who is playing, and a second handover must never turn
// into a loop.
export function shouldReloadOnHandover({ hasController, openedAt, now, reloading }) {
  if (reloading) return false; // controllerchange can fire more than once
  if (!hasController) return false; // a worker leaving, not one arriving
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

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (fullscreenElement()) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      await (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
  } catch {
    /* the user said no, or the platform will not: nothing else to do */
  }
}

// How the caller names things. Set by wireFullscreen's second argument so this
// module never has to know what a theme is, and defaults to the English so a
// page that wires it without one still says words rather than keys.
let word = (key) => ({ fullscreen: "Fullscreen", "leave-fullscreen": "Leave fullscreen" }[key] || key);

// Held so a language switch can ask for the label again. The state lives in the
// browser rather than in any of our data, so only this closure knows both the
// state and the word for it. Declared before wireFullscreen assigns it — a `let`
// is hoisted but dead until its declaration runs.
export let repaintFullscreen = () => {};

export function wireFullscreen(_unused, naming) {
  if (typeof naming === "function") word = naming;
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) return;
  const el = document.documentElement;
  const supported = !!(el.requestFullscreen || el.webkitRequestFullscreen);
  if (!supported || installed()) return; // stays hidden

  btn.hidden = false;
  const paint = () => {
    const on = !!fullscreenElement();
    btn.setAttribute("aria-pressed", String(on));
    const label = document.getElementById("fs-label");
    const said = word(on ? "leave-fullscreen" : "fullscreen");
    if (label) label.textContent = said;
    btn.title = said;
  };
  btn.addEventListener("click", () => toggleFullscreen().then(paint));
  document.addEventListener("fullscreenchange", paint);
  document.addEventListener("webkitfullscreenchange", paint);
  repaintFullscreen = paint;
  paint();
}


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
