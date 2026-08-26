// Menu page. The links are plain <a> elements and work with this file absent —
// everything here is atmosphere, and none of it is allowed to stand between a
// player and the Start button.

import { tollBell, isMuted } from "./audio.js";
import { houseLine } from "./tally.js";
import { wireSleep } from "./shell.js";
import * as L from "./lang.js";
import { mountLangSwitch, paintLangSwitch } from "./langswitch.js";

// Far enough apart to be a house settling rather than a metronome.
const BELL_MS = 20000;

let started = false;

// Browsers will not let a page make noise before it is touched, and they are
// right to. The first interaction of any kind opens the door; after that the
// bell keeps its own time.
//
// The mute setting is the game's own — same localStorage key, same silence. A
// player who has never turned sound on hears nothing here either, which is the
// correct default rather than a missing feature: tollBell() builds no nodes
// while muted.
function begin() {
  if (started) return;
  started = true;
  const ring = () => {
    // Not while nobody is looking. The timer keeps its own time either way, so
    // coming back to the tab does not come back to a queue of bells.
    if (!isMuted() && !document.hidden) tollBell();
    // setTimeout rather than setInterval: a tab that was backgrounded for ten
    // minutes should not come back to ten bells queued up.
    window.setTimeout(ring, BELL_MS);
  };
  window.setTimeout(ring, 1800);
}

for (const evt of ["pointerdown", "pointermove", "keydown", "touchstart"]) {
  window.addEventListener(evt, begin, { once: true, passive: true });
}

// ---- What the house remembers -------------------------------------------------
// One line under the tagline, and only if there is something to say. Written
// from here rather than sitting empty in the HTML: a first visit should have no
// element at all, not an element with nothing in it.
//
// Inserted before the nav so it reads as part of the title block, and after it
// in the fade order — the house says this while you are still looking at the
// title, not as a fact attached to the buttons.
// The page's own copy, and the control that changes it. The four charms and the
// title lockup carry both languages at once by design, so only these two
// paragraphs move — which is why the landing needs no rebuild to switch, just
// two textContent writes.
let base = null;
let currentTheme = null;

async function applyLanguage(lang) {
  L.remember(lang);
  L.stampDocument(lang);
  currentTheme = await L.themeFor(base, lang, { cache: "no-cache" });
  const land = currentTheme.landing || {};
  const tag = document.getElementById("tagline");
  if (tag && land.tagline) tag.textContent = land.tagline;
  paintLangSwitch(lang);
}

// The switch is js/langswitch.js now (#78) — one control for all five pages.
// This page is the exception to "in the top banner": it has no banner. It is a
// deliberately chrome-free cold open, so the control is given the menu as its
// host and sits at the end of it, with the same words and the same convention
// as everywhere else.

async function rememberYou() {
  // The only thing this page needs from the theme, so it is fetched here rather
  // than the page carrying a loader it would otherwise have no use for. Any
  // failure means no line at all, which is the same as a first visit and is
  // already a state this handles.
  let tallyTable = null;
  try {
    const res = await fetch("data/theme.json", { cache: "no-cache" });
    if (!res.ok) return;
    base = await res.json();
    mountLangSwitch({
      host: document.querySelector("main.menu"),
      current: L.preferred(),
      className: "langswitch",
      onPick: (to) => applyLanguage(to),
    });
    await applyLanguage(L.preferred());
    tallyTable = currentTheme.tallyLine;
  } catch {
    return; // no theme, no page copy and no sentence; the menu still works
  }
  const line = houseLine(tallyTable);
  if (!line) return;
  const tagline = document.querySelector(".menu .tagline");
  if (!tagline) return;
  const p = document.createElement("p");
  p.className = "whisper";
  p.textContent = line;
  tagline.after(p);
}

rememberYou();

// The fog drifts forever, and a menu left open in a background tab should not
// be drifting it. Same handler the game uses.
wireSleep();
