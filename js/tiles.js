// The tile gallery. Everything on the page is built from data/tiles.json and
// data/theme.json at load — the point of the page is to show the real set, so
// hand-copying it would guarantee it drifts the first time a tile changes.

import { loadIcons, icon } from "./render.js";
import { mountLangSwitch, paintTopnav } from "./langswitch.js";
import * as L from "./lang.js";
// The words a card says, with no DOM in them (#136). These were defined in
// this file and were already pure; they are out there so that something
// other than this page can ask what a tile SAYS without building a card.
import { note, page, dirWord, chipsFor, noteFor } from "./tilewords.js";

const DIRS = ["N", "E", "S", "W"];

// A compass of the tile's own doors. Not per rotation — the game turns tiles
// as it places them, so what matters here is which walls have a way through.
function doorCompass(def) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "doorplan");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const room = document.createElementNS(NS, "rect");
  room.setAttribute("x", "18"); room.setAttribute("y", "18");
  room.setAttribute("width", "64"); room.setAttribute("height", "64");
  room.setAttribute("rx", "6");
  room.setAttribute("class", "doorplan-room");
  svg.appendChild(room);

  // Each wall, then a gap punched through the ones with a door.
  const walls = {
    N: [18, 18, 82, 18], E: [82, 18, 82, 82],
    S: [18, 82, 82, 82], W: [18, 18, 18, 82],
  };
  for (const dir of DIRS) {
    const [x1, y1, x2, y2] = walls[dir];
    const open = def.exits.includes(dir) || def.seam === dir;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("class", "doorplan-wall");
    svg.appendChild(line);
    if (!open) continue;
    const gap = document.createElementNS(NS, "line");
    const mid = dir === "N" || dir === "S" ? [38, y1, 62, y1] : [x1, 38, x1, 62];
    gap.setAttribute("x1", mid[0]); gap.setAttribute("y1", mid[1]);
    gap.setAttribute("x2", mid[2]); gap.setAttribute("y2", mid[3]);
    gap.setAttribute("class", `doorplan-door${def.seam === dir ? " doorplan-door--seam" : ""}`);
    svg.appendChild(gap);
  }
  return svg;
}

function card(def, theme, count, world, n) {
  const el = document.createElement("article");
  el.className = "tilecard";

  // The plate. The scene is the point of the page, so it gets the full width of
  // the card and the words go underneath it.
  const plate = document.createElement("div");
  plate.className = "tilecard-plate";
  const scene = icon("scene", def.id.replace(/-\d+$/, ""), "tilecard-scene");
  if (scene) plate.appendChild(scene);
  const num = document.createElement("span");
  num.className = "tilecard-num";
  num.textContent = String(n).padStart(2, "0");
  plate.appendChild(num);
  el.appendChild(plate);

  const body = document.createElement("div");
  body.className = "tilecard-body";

  // Names read "門廳 Gatehouse". Split so the Chinese can take a face that has
  // it and the English can keep the display serif; a name with no space just
  // falls through as one span.
  const name = theme.tiles[def.id] || def.id;
  const cut = name.indexOf(" ");
  const h = document.createElement("h3");
  const cjk = document.createElement("span");
  cjk.className = "tilecard-cjk";
  cjk.textContent = cut === -1 ? name : name.slice(0, cut);
  h.appendChild(cjk);
  if (cut !== -1) {
    const latin = document.createElement("span");
    latin.className = "tilecard-latin";
    latin.textContent = name.slice(cut + 1);
    h.appendChild(latin);
  }
  if (count > 1) {
    const badge = document.createElement("span");
    badge.className = "tilecard-count";
    badge.textContent = `×${count}`;
    badge.title = `${count} of these in the deck`;
    h.appendChild(badge);
  }
  body.appendChild(h);

  // The plan and the sentence say the same thing on purpose: the drawing is
  // faster to compare across twenty cards, the words survive being read aloud.
  const doors = document.createElement("p");
  doors.className = "tilecard-doors";
  doors.appendChild(doorCompass(def));
  const named = def.exits.map((d) => dirWord(theme, d));
  const text = document.createElement("span");
  text.textContent =
    (named.length === 4
      ? note(theme, "doors-all")
      : note(theme, "doors-some", { dirs: named.join(note(theme, "doors-join")) })) +
    (def.seam ? note(theme, "doors-seam", { dir: dirWord(theme, def.seam) }) : "") +
    note(theme, "doors-end");
  doors.appendChild(text);
  body.appendChild(doors);

  const chips = chipsFor(def, theme);
  if (chips.length) {
    const row = document.createElement("div");
    row.className = "tilechips";
    for (const [label, cls, isCjk] of chips) {
      const chip = document.createElement("span");
      chip.className = `tilechip${cls ? " " + cls : ""}${isCjk ? " tilechip-cjk" : ""}`;
      chip.textContent = label;
      row.appendChild(chip);
    }
    body.appendChild(row);
  }

  for (const note of noteFor(def, world, theme)) {
    const p = document.createElement("p");
    p.className = "tilecard-note";
    p.textContent = note;
    body.appendChild(p);
  }
  el.appendChild(body);
  return el;
}

function group(host, defs, theme, world, heading, note) {
  // The cast rides on the section, not the grid, so the banner and the plates
  // warm up indoors and cool down outside together.
  const section = document.createElement("section");
  section.className = `tilesection board board--${world}`;

  const head = document.createElement("header");
  head.className = "tilesection-head";
  const vert = document.createElement("span");
  vert.className = "tilesection-vert";
  vert.setAttribute("aria-hidden", "true");
  vert.textContent = world === "indoor" ? "室內" : "室外";
  head.appendChild(vert);

  const headText = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.id = world;
  h2.textContent = heading;
  headText.appendChild(h2);
  const p = document.createElement("p");
  p.textContent = note;
  headText.appendChild(p);
  head.appendChild(headText);
  section.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "tilegrid";

  // Tiles that share a name and a shape are one card with a count, rather than
  // several that look like a rendering bug.
  const seen = new Map();
  for (const def of defs) {
    const key = theme.tiles[def.id] || def.id;
    const prev = seen.get(key);
    if (prev && JSON.stringify(prev.def.exits) === JSON.stringify(def.exits)) {
      prev.count++;
      continue;
    }
    seen.set(key, { def, count: 1 });
  }
  let n = 0;
  for (const { def, count } of seen.values()) {
    grid.appendChild(card(def, theme, count, world, ++n));
  }
  section.appendChild(grid);

  const count = document.createElement("p");
  count.className = "tilesection-count";
  count.textContent = page(theme, "n-tiles", { n: defs.length });
  headText.appendChild(count);

  host.appendChild(section);
}

// Prose wants words, not digits, and this sentence is prose. Past the teens it
// gives up and lets the numeral stand, which is the right place to stop.
const NUMBER = ["zero", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
// English spells small numbers because "four times" is something somebody says
// and "4" is a statistic — the same argument tallyLine makes. Chinese does not
// need the detour: the zh strings put the numeral where it belongs, so a theme
// without a word list simply gets the number.
function count(n, theme) {
  // English spells small numbers because "twenty tiles" is something somebody
  // says and "20 tiles" is a statistic — the same argument tallyLine makes.
  // Chinese does not need the detour, and its strings put the numeral where it
  // belongs, so a theme with no word list gets the number rather than the
  // English word. Falling back to NUMBER here would have printed "twenty" in
  // the middle of a Chinese sentence.
  const words = (theme && theme.tilesPage && theme.tilesPage.words) || null;
  return words ? (words[n] || String(n)) : String(n);
}
// It opens the sentence, so it opens in capitals.
function up(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

async function main() {
  const host = document.getElementById("gallery");
  try {
    const [tiles, base] = await Promise.all([
      fetch("data/tiles.json").then((r) => r.json()),
      fetch("data/theme.json").then((r) => r.json()),
      loadIcons(),
    ]);
    // Same preference the game keeps, so the choice is the reader's and not the
    // page's. The overlay falls through to English per key, exactly as there.
    const lang = L.preferred();
    L.stampDocument(lang);
    // Once is enough here: the switch below reloads rather than re-rendering.
    paintTopnav(lang);
    // The page has always themed itself from the shared preference and never
    // offered a way to change it, so a reader who wanted the other language had
    // to go somewhere else and come back. The switch reloads rather than
    // re-rendering: this page builds its gallery once from data and has no
    // re-render path, and a reload is honest where a half-swap would not be.
    mountLangSwitch({
      current: lang,
      onPick: (to) => { L.remember(to); location.reload(); },
    });
    const theme = await L.themeFor(base, lang);
    host.textContent = "";

    // The standfirst counts the real set. It said "sixteen rooms" for a while
    // after the set became twenty, which is exactly the drift this page exists
    // to avoid.
    const inside = tiles.indoor.length;
    const outside = tiles.outdoor.length;
    // Still counted from the real set rather than written down — that is what
    // this page is for, and it read "sixteen rooms" for a while after the set
    // became twenty. What changed is that the SENTENCE around the numbers comes
    // from the theme, so the page is in one language rather than two.
    const intro = document.getElementById("tile-intro");
    if (intro) {
      intro.textContent = page(theme, "intro", {
        total: up(count(inside + outside, theme)),
        inside: count(inside, theme),
        outside: count(outside, theme),
      });
    }
    const h1 = document.querySelector("main h1");
    if (h1) h1.textContent = page(theme, "title");
    const plans = document.getElementById("tile-plans");
    if (plans) plans.textContent = page(theme, "plans");

    group(host, tiles.indoor, theme, "indoor",
      page(theme, "indoor-title"), page(theme, "indoor-note"));
    group(host, tiles.outdoor, theme, "outdoor",
      page(theme, "outdoor-title"), page(theme, "outdoor-note"));
  } catch (err) {
    console.error(err);
    // Pre-theme on purpose: the theme is what failed to load.
    host.textContent = "Could not load the tile set.";
  }
}

main();
