// 夜榜 — the ledger (#144).
//
// Three boards and a strip, read from the Worker that #143 landed. Everything
// here is written against the fact that THE BOARDS ARE USUALLY EMPTY AND
// SOMETIMES UNREACHABLE: the tables start with nothing in them, the page ships
// before anyone has played, and a phone opening the installed PWA on a train
// has no network at all. None of those is an error worth an apology, and none
// of them may look like a broken page.

import * as L from "./lang.js";
import { mountLangSwitch, paintLangSwitch } from "./langswitch.js";
import { wireSleep } from "./shell.js";

// RESOLVED AGAINST THE PAGE, NOT HARD-CODED. In production this page is served
// from /jiangshi_in_the_pocket/ledger and the API sits alongside it under the
// same prefix; from a plain local static server it is at the root and there is
// no Worker at all. A relative URL is correct in both, and the local 404 is
// then just another unreachable board — which is a state this page already has
// to render properly.
const api = (path) => new URL(path, location.href).href;

// The three boards, in the order the page shows them. Each names its own
// columns, so adding a board is an entry here rather than a branch in render().
const BOARDS = [
  {
    id: "burial",
    zh: "速葬",
    en: "The fastest burial",
    // ONE WORD, because the tab carries it. "The fastest burial" is the
    // panel's heading and would not fit three-across at 375; this is what a
    // tab can hold beside two characters of Chinese.
    short: "Burial",
    // The panel's heading in Chinese. It used to be English in BOTH languages,
    // justified by a comment saying the tab carried the Chinese and the panel
    // the English — a rationale that stopped being true the day the owner put
    // both halves on the tab, at which point the heading was simply an
    // untranslated string sitting under a tab that already said BURIAL.
    zhLong: "最早入土的一夜",
    // Said in the page rather than left for the reader to infer from the
    // ordering: a board whose rule is invisible looks arbitrary when your run
    // is not on it.
    ruleZh: "把神主牌埋回土裡，越早越好。",
    ruleEn: "Put the tablet back in the ground, as early as you can.",
    cols: [
      { key: "turn", zh: "回合", en: "Turn" },
      { key: "health", zh: "命", en: "Health" },
    ],
  },
  {
    id: "seal",
    zh: "鎮屍",
    en: "The sealing",
    short: "Sealing",
    zhLong: "鎮住他的一夜",
    ruleZh: "鎮住他，看你還剩多少。",
    ruleEn: "Seal him, and keep what you can.",
    cols: [
      { key: "health", zh: "命", en: "Health" },
      { key: "turn", zh: "回合", en: "Turn" },
    ],
  },
  {
    id: "kills",
    zh: "除魔",
    en: "What was put down",
    short: "Kills",
    zhLong: "放倒了多少",
    ruleZh: "任何走完的一夜都算，活著的排在前面。",
    ruleEn: "Any night that ended counts. Survivors rank above the fallen.",
    cols: [
      { key: "kills", zh: "殭屍", en: "Put down" },
      { key: "health", zh: "命", en: "Health" },
    ],
  },
];

// The character is what shows; `en` and `srZh` are what it is CALLED. The
// accessible name follows the reader's language — a Chinese screen-reader user
// was being told "burials" under a page that is otherwise entirely in Chinese.
// The Chinese names echo the boards on purpose, the same way the characters do.
const STRIP = [
  { key: "nights", zh: "夜", en: "nights played", srZh: "總夜數" },
  { key: "burials", zh: "葬", en: "burials", srZh: "速葬" },
  { key: "seals", zh: "鎮", en: "sealings", srZh: "鎮屍" },
  { key: "deaths", zh: "殞", en: "deaths", srZh: "殞命" },
];

const isZh = () => document.documentElement.lang.startsWith("zh");
const say = (o, k) => (isZh() ? o[k + "Zh"] ?? o.zh : o[k + "En"] ?? o.en);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// A name comes from another player and goes into the page. textContent
// everywhere below rather than innerHTML — the server caps the length and
// trims, and it does NOT sanitise, because the correct place to be careful
// about markup is where markup is created.
function nameCell(row) {
  const n = el("td", "ledger-name");
  const raw = typeof row.name === "string" ? row.name.trim() : "";
  if (raw) {
    n.textContent = raw;
  } else {
    // A run submitted without a name is still a run, and the row is still its
    // row. Anonymous rather than blank, so the column never looks broken.
    n.textContent = isZh() ? "無名" : "no name";
    n.classList.add("ledger-anon");
  }
  return n;
}

// READ AS UTC, WHICH IS WHAT IT IS. sql/schema.sql defaults created_at to
// datetime('now'), and SQLite writes that as "YYYY-MM-DD HH:MM:SS" with no zone
// marker at all — which Date.parse reads as LOCAL time. Rendering the result
// back through toISOString then shifted the date by the reader's offset: a run
// stored at 21:14 UTC showed as the following day for anyone east of Greenwich.
// Caught on a fixture whose timestamp was 2026-08-30 and which rendered
// 2026-08-31. Anything that already carries a zone is trusted as it stands.
function parseStamp(raw) {
  if (typeof raw !== "string") return NaN;
  const s = raw.trim();
  if (/([zZ]|[+-]\d\d:?\d\d)$/.test(s)) return Date.parse(s);
  return Date.parse(s.replace(" ", "T") + "Z");
}

// Rendered only if it parses, and silently dropped if it does not: a date is the
// least important thing on the row, and "Invalid Date" in a leaderboard looks
// like the board itself is broken.
function whenCell(row) {
  const td = el("td", "ledger-when");
  const t = parseStamp(row.created_at);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    td.textContent = d.toISOString().slice(0, 10);
    td.title = d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
  return td;
}

function boardTable(board, rows) {
  const table = el("table", "ledger-table");
  const head = el("tr");
  head.appendChild(el("th", "ledger-rank", "#"));
  head.appendChild(el("th", "ledger-name", isZh() ? "名" : "Name"));
  for (const c of board.cols) head.appendChild(el("th", "ledger-num", say(c, "")));
  head.appendChild(el("th", "ledger-when", isZh() ? "日期" : "Date"));
  table.appendChild(el("thead")).appendChild(head);

  const body = el("tbody");
  rows.forEach((row, i) => {
    const tr = el("tr");
    tr.appendChild(el("td", "ledger-rank", String(i + 1)));
    tr.appendChild(nameCell(row));
    for (const c of board.cols) {
      const v = row[c.key];
      tr.appendChild(el("td", "ledger-num", v == null ? "—" : String(v)));
    }
    tr.appendChild(whenCell(row));
    body.appendChild(tr);
  });
  table.appendChild(body);
  return table;
}

// THE THREE THINGS A BOARD CAN BE, and they are deliberately worded apart.
// "Nobody has done this yet" is an invitation; "we could not reach the board"
// is a fault on our side. Collapsing them into one grey line would tell a
// player on a train that nobody has ever buried the tablet.
//
// THIS MATTERS MORE INSIDE A TAB, not less. With three boards stacked a reader
// could infer what one meant from its neighbours; a tab shows one board and
// nothing else, so the board's own sentence is the only thing on screen saying
// what it ranks.
function boardPanel(board, outcome) {
  const sec = el("section", "ledger-board");
  sec.id = "panel-" + board.id;
  sec.setAttribute("role", "tabpanel");
  sec.setAttribute("aria-labelledby", "tab-" + board.id);
  // Focusable so a keyboard reaches the panel's own content after leaving the
  // strip — a tabpanel that Tab cannot enter strands the table behind it.
  sec.tabIndex = 0;

  // The board's name, in the language being read. The class is not called
  // ledger-en any more: it held Chinese in Chinese mode while being named for
  // English, which is the kind of stale name that survives long enough to be
  // believed.
  const name = el("h2", "ledger-boardname", isZh() ? board.zhLong : board.en);
  name.lang = isZh() ? "zh-Hant" : "en";
  sec.appendChild(name);
  sec.appendChild(el("p", "ledger-rule", say(board, "rule")));

  if (!outcome.ok) {
    sec.appendChild(el("p", "ledger-note ledger-note--off", isZh()
      ? "現在連不上夜榜。這一頁需要網路。"
      : "The ledger is out of reach right now. This page needs the network."));
    return sec;
  }
  if (!outcome.rows.length) {
    sec.appendChild(el("p", "ledger-note", isZh()
      ? "還沒有人上榜。第一個就是你。"
      : "Nobody here yet. The first name could be yours."));
    return sec;
  }
  sec.appendChild(boardTable(board, outcome.rows));
  return sec;
}

// REAL TAB SEMANTICS, because the cheap version is indistinguishable by eye and
// unusable without a mouse: role=tab/tablist/tabpanel, aria-selected, and a
// ROVING TABINDEX so Tab moves in and out of the strip as one stop while the
// arrow keys move between the tabs inside it.
function mountTabs(host, panels) {
  const list = el("div", "ledger-tabs");
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", isZh() ? "夜榜" : "The ledger");

  const tabs = BOARDS.map((board) => {
    const t = el("button", "ledger-tab");
    t.type = "button";
    t.id = "tab-" + board.id;
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", "panel-" + board.id);
    // BOTH HALVES ON THE TAB, stacked rather than side by side: three bilingual
    // labels in a row do not fit 375 honestly, and the ruling was to stack
    // rather than shrink the type. Chinese over English is the talismans'
    // pairing — 開始 over START — so the page already has this idiom.
    const zh = el("span", "ledger-tab-zh", board.zh);
    zh.lang = "zh-Hant";
    t.appendChild(zh);
    t.appendChild(el("span", "ledger-tab-en", board.short));
    list.appendChild(t);
    return t;
  });

  const show = (i, moveFocus) => {
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute("aria-selected", on ? "true" : "false");
      // The roving part: only the selected tab is in the document's tab order.
      t.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (moveFocus) tabs[i].focus();
    // A linkable board that survives a reload. replaceState rather than
    // location.hash: assigning the hash scrolls the panel into view, which
    // yanks the page down every time somebody changes tab.
    try { history.replaceState(null, "", "#" + BOARDS[i].id); } catch { /* file:// */ }
  };

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => show(i, false));
    t.addEventListener("keydown", (e) => {
      const last = tabs.length - 1;
      let to = null;
      if (e.key === "ArrowRight") to = i === last ? 0 : i + 1;
      else if (e.key === "ArrowLeft") to = i === 0 ? last : i - 1;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = last;
      if (to === null) return;
      e.preventDefault();
      show(to, true);
    });
  });

  // #kills opens on that board. An unknown or absent hash opens the first.
  const asked = BOARDS.findIndex((b) => "#" + b.id === location.hash);
  show(asked >= 0 ? asked : 0, false);
  host.appendChild(list);
  return tabs;
}

// The four counts across the top. It describes the whole ledger rather than
// any one board, so it sits above the tab strip and outside every panel.
// THE FOUR COUNTS, IN CHINESE IN BOTH LANGUAGES. 夜 葬 鎮 殞 are compact enough
// to sit on one row at 375, which four English words are not — measured, the
// English version wrapped to two lines. They also RHYME WITH THE TABS: 葬 and 鎮
// echo 速葬 and 鎮屍, so the strip and the boards read as one composed thing
// rather than a caption over a list. Do not swap either for a synonym.
//
// THE ENGLISH IS NOT LOST, it is the accessible name: an .sr-only word inside
// each item, so a screen reader says "12 burials" and never "12 葬", plus a
// title for a hover. The character is aria-hidden so it is not read twice.
//
// AND THE FOUR NUMBERS ARE AN IDENTITY: 葬 + 鎮 + 殞 = 夜, because every stored
// night ended one of exactly three ways. The three outcomes are grouped and 夜
// is set apart from them, so a reader who notices the arithmetic gets the shape
// of the whole game from one line.
function strip(stats) {
  const wrap = el("p", "ledger-strip");
  if (!stats.ok) return wrap;
  for (const s of STRIP) {
    const n = stats.data[s.key];
    if (n == null) continue;
    const item = el("span", "ledger-stat");
    if (s.key === "nights") item.classList.add("ledger-stat--all");
    item.appendChild(el("b", null, String(n)));
    const glyph = el("span", "ledger-glyph", s.zh);
    glyph.lang = "zh-Hant";
    glyph.setAttribute("aria-hidden", "true");
    item.appendChild(glyph);
    const spoken = isZh() ? s.srZh : s.en;
    item.appendChild(el("span", "sr-only", " " + spoken));
    item.title = n + " " + spoken;
    wrap.appendChild(item);
  }
  return wrap;
}

async function getJSON(path) {
  // no-store because a leaderboard read from the HTTP cache is a leaderboard
  // that does not move, and "my run is not on it" is the one complaint this
  // page must never earn wrongly.
  const r = await fetch(api(path), { cache: "no-store" });
  const body = await r.json();
  if (!r.ok || !body || body.ok !== true) {
    throw new Error("board " + path + " answered " + r.status);
  }
  return body;
}

async function paint() {
  const host = document.querySelector("#ledger");
  if (!host) return;
  host.textContent = "";

  // ONE REQUEST FOR THE WHOLE PAGE, AND FOR ALL THREE TABS. Switching tabs
  // shows a panel that is already built; it never fetches. A per-tab read would
  // bring back the partial-failure matrix #146 removed, one tab at a time, and
  // would turn "out of reach" into a state that only appears after a click.
  let body = null;
  try {
    body = await getJSON("api/leaderboard");
  } catch {
    body = null;
  }

  // The strip describes the whole ledger rather than any one board, so it sits
  // above the tabs and outside every panel.
  host.appendChild(strip(body && body.stats
    ? { ok: true, data: body.stats }
    : { ok: false }));

  const panels = BOARDS.map((board) => {
    // A board missing from the response is reported as unreachable rather than
    // as empty. They are different sentences on purpose and this is exactly the
    // case that would blur them.
    const got = body && body.boards ? body.boards[board.id] : null;
    return boardPanel(board, got ? { ok: true, rows: got.rows || [] } : { ok: false });
  });

  // Tabs first in the DOM, then the panels they control.
  mountTabs(host, panels);
  for (const p of panels) host.appendChild(p);
}

function apply(lang) {
  L.remember(lang);
  L.stampDocument(lang);
  paintLangSwitch(lang);
  // Repainted rather than reloaded: the board names, the column heads and the
  // empty lines are all language-dependent, and the rows are already here.
  paint();
}

const lang = L.preferred();
L.stampDocument(lang);
mountLangSwitch({ current: lang, onPick: apply });
wireSleep();
paint();
