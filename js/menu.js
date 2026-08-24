// Menu page. The links are plain <a> elements and work with this file absent —
// everything here is atmosphere, and none of it is allowed to stand between a
// player and the Start button.

import { tollBell, isMuted } from "./audio.js";
import { houseLine } from "./tally.js";
import { wireSleep } from "./shell.js";
import * as L from "./lang.js";

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
  const foot = document.getElementById("footnote");
  if (tag && land.tagline) tag.textContent = land.tagline;
  if (foot && land.footnote) foot.textContent = land.footnote;
  paintSwitch(lang);
}

// One control, two languages, so it names the language you would GET. Built in
// script rather than sitting in the HTML because a page with JS off should not
// offer a switch that cannot work.
function paintSwitch(lang) {
  const order = Object.keys(L.LANGS);
  const next = order[(order.indexOf(lang) + 1) % order.length];
  let btn = document.getElementById("lang-switch");
  if (!btn) {
    const foot = document.getElementById("footnote");
    if (!foot) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "lang-switch";
    btn.className = "langswitch";
    btn.addEventListener("click", () => applyLanguage(nextOf()));
    foot.before(btn);
  }
  btn.textContent = L.LANGS[next].name;
  btn.setAttribute("lang", L.LANGS[next].tag);
}

function nextOf() {
  const order = Object.keys(L.LANGS);
  const now = document.documentElement.getAttribute("lang") === L.LANGS["zh-TW"].tag ? "zh-TW" : "en";
  return order[(order.indexOf(now) + 1) % order.length];
}

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
