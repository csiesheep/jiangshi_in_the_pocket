// The rulebook page's one job: serve it in the reader's language.
//
// English is INLINE in rulebook.html and stays there. This file only ever
// replaces it, which is the whole design — a rules reference that needs
// JavaScript to say anything is a worse rules reference, and the one reader who
// most needs the rules working is the one whose scripts failed.
//
// So: no JS, English, complete. JS and a zh preference, Chinese. JS and a failed
// fetch, English, complete. There is no state where the page is empty.

import * as L from "./lang.js";
import { loadIcons } from "./icons.js";
import { wireSleep } from "./shell.js";
import { mountLangSwitch, paintLangSwitch } from "./langswitch.js";

const main = document.querySelector("main");
// The English, kept in memory the moment the page loads, so switching back is
// instant and needs no second fetch — and so a failed zh fetch has something to
// put back if it ever gets that far.
const english = main ? main.innerHTML : "";
let chinese = null;

// Two paths for one file, because production rewrites one of them.
//
// The static-asset handler 307s any `.html` request to its extensionless form,
// so in production this fetch is a redirect the Worker then has to re-prefix.
// It works — verified end to end — but it costs a round trip and it leans on
// that re-prefixing continuing to happen. Locally there is no rewriting at all
// and only the `.html` name resolves. So: ask for the name that works locally,
// and fall back to the name production redirects to.
const FRAGMENTS = ["data/rulebook.zh-TW.html", "data/rulebook.zh-TW"];

async function fragmentFor(lang) {
  if (lang === L.BASE) return english;
  if (chinese) return chinese;
  for (const url of FRAGMENTS) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      chinese = await res.text();
      return chinese;
    } catch {
      /* try the other name */
    }
  }
  // Falling back to English is the right BEHAVIOUR and a terrible silence: the
  // page looks fine and is simply in the wrong language, which is exactly the
  // kind of failure that survives for months. Say so where a maintainer looks.
  console.warn("jiangshi: the Chinese rulebook did not load; staying in English");
  return null;
}

async function apply(lang) {
  const html = await fragmentFor(lang);
  // A language that will not load is not a broken page. Nothing is replaced,
  // the preference is not remembered, and the reader keeps a rulebook.
  if (html == null) return;
  L.remember(lang);
  L.stampDocument(lang);
  if (main) main.innerHTML = html;
  paintLangSwitch(lang);
  // An #anchor from the table of contents survives the swap because the ids do,
  // but the browser will not re-scroll on its own after a replacement.
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
}

// The switch is js/langswitch.js now (#78). It used to be built here, and it
// used to be rebuilt after every swap because apply() replaces main.innerHTML
// and took the button with it — mounting it in the BANNER, outside main, means
// the swap cannot reach it and it survives on its own.

loadIcons();

// Mounted before the first apply(), so the page never renders without it.
mountLangSwitch({ current: L.preferred(), onPick: (to) => apply(to) });
apply(L.preferred());
wireSleep();
