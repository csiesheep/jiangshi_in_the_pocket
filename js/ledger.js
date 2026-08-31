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
    ruleZh: "任何走完的一夜都算，活著的排在前面。",
    ruleEn: "Any night that ended counts. Survivors rank above the fallen.",
    cols: [
      { key: "kills", zh: "殭屍", en: "Put down" },
      { key: "health", zh: "命", en: "Health" },
    ],
  },
];

const STRIP = [
  { key: "nights", zh: "夜", en: "nights played" },
  { key: "burials", zh: "葬", en: "burials" },
  { key: "seals", zh: "鎮", en: "sealings" },
  { key: "deaths", zh: "殞", en: "deaths" },
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
function boardSection(board, outcome) {
  const sec = el("section", "ledger-board");
  const h = el("h2");
  // BOTH HALVES, ALWAYS, in the talismans' idiom: the Chinese name and the
  // English one side by side. NOT say() — that switches on the reader's
  // language, which rendered the heading as "速葬速葬" in Chinese because both
  // spans resolved to the same string. The rule below and the column heads do
  // switch; the board's name does not, because it is a name.
  h.appendChild(el("span", "ledger-zh", board.zh));
  h.appendChild(el("span", "ledger-en", board.en));
  sec.appendChild(h);
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

function strip(stats) {
  const wrap = el("p", "ledger-strip");
  if (!stats.ok) return wrap;
  for (const s of STRIP) {
    const n = stats.data[s.key];
    if (n == null) continue;
    const item = el("span", "ledger-stat");
    item.appendChild(el("b", null, String(n)));
    item.appendChild(el("span", null, " " + say(s, "")));
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

  // ONE REQUEST FOR THE WHOLE PAGE. Three boards and the strip used to be four
  // reads, which meant four ways to half-load: a page showing two boards, one
  // apology and no counts is worse than a page that says plainly it could not
  // reach the ledger.
  let body = null;
  try {
    body = await getJSON("api/leaderboard");
  } catch {
    body = null;
  }

  host.appendChild(strip(body && body.stats
    ? { ok: true, data: body.stats }
    : { ok: false }));

  for (const board of BOARDS) {
    // A board missing from the response is reported as unreachable rather than
    // as empty. They are different sentences on purpose and this is exactly the
    // case that would blur them.
    const got = body && body.boards ? body.boards[board.id] : null;
    host.appendChild(boardSection(board, got
      ? { ok: true, rows: got.rows || [] }
      : { ok: false }));
  }
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
