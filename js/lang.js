// Which language the house speaks.
//
// One module because three pages need the answer — the game, the tile gallery
// and the menu — and a preference that disagreed between them would be worse
// than no preference at all.
//
// THE THEME IS AN OVERLAY, NOT A REPLACEMENT. data/theme.json is always loaded
// and is always complete; a language file is merged over the top of it, key by
// key. That is what makes translating incremental: a zh file with forty lines
// in it shows those forty in Chinese and the rest in English, and never shows a
// missing key. It also means adding a language cannot break the game — the
// worst a broken language file can do is fail to override anything.

// The `jitp:` prefix is not cosmetic. Every game on games.csiesheep.com shares
// one origin and localStorage is origin-scoped, so a key named for the sibling
// is the SAME key.
const KEY = "jitp:lang";

// The base file is the fallback for every language and is never itself an
// overlay. English lives there rather than in an en overlay so that a corrupt
// or missing language file degrades to a complete game rather than a bare one.
export const BASE = "en";

// Each entry is [tag for <html lang>, the overlay file]. Adding a language is
// one line here plus the file — no code anywhere else changes.
export const LANGS = {
  en: { tag: "en", file: null, name: "English" },
  "zh-TW": { tag: "zh-Hant-TW", file: "data/theme.zh-TW.json", name: "繁體中文" },
};

export function known(lang) {
  return Object.prototype.hasOwnProperty.call(LANGS, lang);
}

// Whether a language may be reached WITHOUT being asked for.
//
// False while a translation is still landing, and that is not caution — it is
// the whole sequencing rule. An overlay means a partial language is safe to
// SHIP; it does not mean a partial language is fit to be the first thing a
// stranger sees. Detection is what turns "available if you want it" into "this
// is your version of the game", and it goes on last, once coverage is done.
//
// It shipped true for about an hour with a thirty-key zh file behind it, which
// meant a zh browser met a half-English night. This flag is that mistake, made
// impossible to repeat quietly — and it stays here, false-able, for whenever a
// third language starts landing.
//
// On since 2026-08-24: 繁體中文 covers the game and the landing page completely.
const DETECT = true;

// What the reader has chosen, or — once DETECT is on — what their browser
// implies. An explicit choice always wins and always outlives a system setting,
// which is the whole point of making it a choice.
export function preferred() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && known(saved)) return saved;
  } catch {
    /* storage blocked; fall through */
  }
  // Until detection is on, an unasked reader gets the complete language. The
  // switch is still there and still works — this only decides the default.
  return DETECT ? fromBrowser() : BASE;
}

// A Chinese-reading browser opens in Chinese. Deliberately generous about which
// Chinese: this game is written in 繁體中文, and someone whose browser says
// zh-CN is far better served by traditional characters they can read than by
// English they may not. They can still switch.
function fromBrowser() {
  const tags = (navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || ""]);
  for (const raw of tags) {
    const t = String(raw).toLowerCase();
    if (t.startsWith("zh")) return "zh-TW";
    if (t.startsWith("en")) return BASE;
  }
  return BASE;
}

export function remember(lang) {
  if (!known(lang)) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* the choice holds for this page and no longer; nothing else to do */
  }
}

// Stamp the document so a screen reader announces the right voice and a crawler
// files the page under the right language. Called on every load and again on
// every switch, because the second is a real language change to anything
// reading the page.
export function stampDocument(lang) {
  const entry = LANGS[lang] || LANGS[BASE];
  document.documentElement.setAttribute("lang", entry.tag);
}

// One level deep is all the theme is: sections of strings, plus two arrays.
// A deep merge would be more general and would also let a half-written language
// file half-replace an array, which is exactly the failure this shape avoids —
// an array is replaced whole or not at all.
function overlay(base, over) {
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = v;
  for (const [k, v] of Object.entries(over || {})) {
    if (Array.isArray(v)) out[k] = v;
    else if (v && typeof v === "object" && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Merge a language over the base theme. Returns the base untouched for English,
// for a language with no file yet, and for a file that fails to load — three
// different reasons with the same correct answer.
export async function themeFor(baseTheme, lang, fetchOpts) {
  const entry = LANGS[lang];
  if (!entry || !entry.file) return baseTheme;
  try {
    const res = await fetch(entry.file, fetchOpts);
    if (!res.ok) return baseTheme;
    return overlay(baseTheme, await res.json());
  } catch {
    return baseTheme; // a language that will not load is not a broken game
  }
}
