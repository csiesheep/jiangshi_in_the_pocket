// The language switch, built once and mounted by every page that has one (#78).
//
// It used to exist three times: a static button in the game's banner, a
// constructor inside rulebook.js, and another inside menu.js — three copies of
// one control, which is the shape this project has spent a week deleting. The
// user's ruling that credits gets one too turned that from a preference into a
// requirement: a fourth copy was not worth writing.
//
// SCRIPT-BUILT ON PURPOSE, and that property is inherited rather than
// accidental. rulebook.js's original said it plainly — a page with JS off
// should not offer a switch that cannot work — and the same holds everywhere
// else, so the button is never in the markup.
//
// It names the language you would GET rather than the one you have, because a
// control named for its current state reads as a label rather than a thing to
// press. The visible word is therefore its own accessible name, and it needs
// no title and no screen-reader wrapper saying "Language" after it.

import * as L from "./lang.js";

// Where a page keeps it: the top banner, on the right, past everything else.
// The landing page has no banner — it is a deliberately chrome-free cold open —
// so it passes its own host and the control simply sits at the end of the menu.
// Same control, same words, one placement difference forced by the page.
function hostFor(explicit) {
  if (explicit) return explicit;
  return document.querySelector("header.topnav") || document.querySelector("main") || document.body;
}

function otherThan(lang) {
  const order = Object.keys(L.LANGS);
  const i = order.indexOf(lang);
  return order[(i < 0 ? 0 : i + 1) % order.length];
}

// `current` is asked for rather than read from the document, because the game
// knows its own language before the document is stamped and the article pages
// do not. `onPick` receives the language code to switch TO.
export function mountLangSwitch({ host, current, onPick, className = "topbtn" } = {}) {
  const parent = hostFor(host);
  if (!parent) return null;
  let btn = document.getElementById("btn-lang");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-lang";
    btn.className = className;
    btn.addEventListener("click", () => {
      const to = otherThan(btn.dataset.from || L.BASE);
      if (typeof onPick === "function") onPick(to);
    });
    parent.appendChild(btn);
  }
  paintLangSwitch(current);
  return btn;
}

// Split from the mount so a page can repaint after a switch without rebuilding
// the button and losing its listener.
export function paintLangSwitch(current) {
  const btn = document.getElementById("btn-lang");
  if (!btn) return;
  const from = L.known(current) ? current : L.BASE;
  const next = otherThan(from);
  btn.dataset.from = from;
  btn.textContent = L.LANGS[next].name;
  btn.setAttribute("lang", L.LANGS[next].tag);
}
