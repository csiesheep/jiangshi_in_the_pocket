// The app shell: install, fullscreen, wake lock. Everything here is optional
// and every part of it is absent somewhere — iOS has no Wake Lock, older
// Safari has a prefixed fullscreen, a plain http:// origin has no service
// worker at all. So each piece is feature-detected and each failure is silent:
// the game is exactly as playable without any of it.

// ---- Service worker ---------------------------------------------------------
// Registered relative, because this ships under a subpath and an absolute "/sw.js"
// would ask for the domain root and get a 404 (or worse, somebody else's worker).
export function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
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

export function wireFullscreen() {
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
    if (label) label.textContent = on ? "Leave fullscreen" : "Fullscreen";
    btn.title = on ? "Leave fullscreen" : "Fullscreen";
  };
  btn.addEventListener("click", () => toggleFullscreen().then(paint));
  document.addEventListener("fullscreenchange", paint);
  document.addEventListener("webkitfullscreenchange", paint);
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") take();
});
