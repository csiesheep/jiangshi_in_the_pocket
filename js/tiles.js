// The tile gallery. Everything on the page is built from data/tiles.json and
// data/theme.json at load — the point of the page is to show the real set, so
// hand-copying it would guarantee it drifts the first time a tile changes.

import { loadIcons, icon } from "./render.js";
import { mountLangSwitch } from "./langswitch.js";
import * as L from "./lang.js";

const DIRS = ["N", "E", "S", "W"];

// The behaviour notes live in data/theme.json now, keyed off the same fields the
// engine reads — so a tile cannot gain a power the gallery quietly omits, and a
// translation of this page is a data change like every other. Anything
// unrecognised is still surfaced rather than dropped (see noteFor).
//
// The two goal rooms are rites, not cards: each resolves the room's own event
// and then draws ONE MORE for the rite itself, so a goal room is two events in
// one turn and the second lands at the moment you least want it.
const SEARCH_KEY = {
  weapon: "search-weapon", magic: "search-magic",
  medicine: "search-medicine", relic: "search-relic",
};

// A tile's display name, for the notes that have to refer to another room.
function name(theme, id) {
  return (theme && theme.tiles && theme.tiles[id]) || id;
}

// One lookup for this page, same contract as the game's: the key comes back if
// it is missing, so a gap is a thing you can see rather than a blank card.
function note(theme, key, values) {
  const table = (theme && theme.tileNotes) || {};
  return fill(table[key] || key, values);
}

function fill(line, values) {
  if (!line) return line;
  return String(line).replace(/\{(\w+)\}/g, (whole, k) =>
    values && values[k] !== undefined ? values[k] : whole);
}

function noteFor(def, world, theme) {
  const notes = [];
  // The word for the 神主牌, taken from the theme so this page and the board
  // cannot end up calling it two different things.
  const tablet = (theme && theme.actions && theme.actions.tablet) || "tablet";

  // Both decks have a `start` tile, but they mean different things: one is
  // where the night begins, the other is what goes down the moment you step
  // outside. Two cards reading "Where you begin" would just be confusing.
  if (def.start) {
    notes.push(note(theme, world === "indoor" ? "start-indoor" : "start-outdoor"));
  }
  if (def.search) {
    // No "best of its kind" line: every room sharing a category rolls the
    // identical table, so saying otherwise would teach a rule the game lacks.
    notes.push(SEARCH_KEY[def.search]
      ? note(theme, SEARCH_KEY[def.search])
      : note(theme, "search-other", { what: def.search }));
  }
  if (def.exteriorDoor) {
    notes.push(note(theme, "moon-gate", { dir: dirWord(theme, def.exteriorDoor) }));
  }
  if (def.seam) notes.push(note(theme, "seam"));
  for (const f of def.flags || []) {
    // RUNNING_WATER went with #56 and no tile carries it any more; the branch
    // is gone rather than left describing a flag nothing can have.
    notes.push(f === "WARDED" ? note(theme, "warded") : note(theme, "unknown", { what: f }));
  }
  // No tile carries an `action` since the post-launch redesign took the
  // prayer and the coil, but the branch stays: the field is still read, and a
  // tile that grows one should say so rather than say nothing.
  if (def.action) notes.push(note(theme, "unknown", { what: def.action }));
  if (def.goal) {
    const key = def.goal === "TAKE_TABLET" ? "take-tablet"
      : def.goal === "BURY_TABLET" ? "bury-tablet" : null;
    notes.push(key ? note(theme, key, { tablet }) : note(theme, "unknown", { what: def.goal }));
  }
  if (def.onTurnEnd) {
    notes.push(def.onTurnEnd === "HEAL_1"
      ? note(theme, "heal-1")
      : note(theme, "unknown", { what: def.onTurnEnd }));
  }
  return notes;
}

// The compass, spoken, from the theme like every other player-visible word.
function dirWord(theme, dir) {
  return ((theme && theme.ui) || {})[`dir-${dir}`] || dir;
}

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

// The chip layer: the one category a room can be rummaged for, plus the handful
// of roles worth spotting from across the page. Everything a chip says, noteFor
// also says in a sentence — the chip is there to be scanned, the sentence to be
// read, and the geography of the map (magic indoors only, weapons mostly out)
// is only visible when twenty of these can be taken in at once.
const CHIP_SEARCH = { weapon: "武器 weapons", magic: "符咒 talismans",
                      medicine: "丹藥 medicine", relic: "法器 ritual" };

function chipsFor(def) {
  const chips = [];
  if (def.search) chips.push([CHIP_SEARCH[def.search] || def.search, `tilechip--${def.search}`, true]);
  if (def.onTurnEnd === "HEAL_1") chips.push(["+1 health", "", false]);
  if ((def.flags || []).includes("WARDED")) chips.push(["no events", "", false]);
  if (def.action) chips.push(["once per night", "", false]);
  if (def.goal) chips.push(["goal", "tilechip--goal", false]);
  if (def.start) chips.push(["start", "", false]);
  if (def.exteriorDoor) chips.push(["moon gate", "", false]);
  if (def.seam) chips.push(["seam", "", false]);
  if (!chips.length) chips.push(["transit", "", false]);
  return chips;
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

  const chips = chipsFor(def);
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
  count.textContent = `${defs.length} tiles`;
  headText.appendChild(count);

  host.appendChild(section);
}

// Prose wants words, not digits, and this sentence is prose. Past the teens it
// gives up and lets the numeral stand, which is the right place to stop.
const NUMBER = ["zero", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
function count(n) {
  return NUMBER[n] || String(n);
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
    const intro = document.getElementById("tile-intro");
    if (intro) {
      const inside = tiles.indoor.length;
      const outside = tiles.outdoor.length;
      intro.textContent =
        `${up(count(inside + outside))} tiles: ${count(inside)} in the village, ` +
        `${count(outside)} out on the hillside. You meet them one turn at a time, ` +
        `which is the whole idea — but here they all are, for when you want to ` +
        `know what you are hoping to turn over.`;
    }

    group(host, tiles.indoor, theme, "indoor",
      "The village, and the 義莊 at the end of it",
      "Beams overhead, a plastered wall, a stone floor running away from you, and one oil lamp off to the left.");
    group(host, tiles.outdoor, theme, "outdoor",
      "The hillside",
      "Sky, the same moon in the same corner, hills on the horizon, cold ground and a band of mist.");
  } catch (err) {
    console.error(err);
    host.textContent = "Could not load the tile set."; // pre-theme: the theme is what failed to load
  }
}

main();
