// The tile gallery. Everything on the page is built from data/tiles.json and
// data/theme.json at load — the point of the page is to show the real set, so
// hand-copying it would guarantee it drifts the first time a tile changes.

import { loadIcons, icon } from "./render.js";

const DIRS = ["N", "E", "S", "W"];

// Plain words for the behaviour flags. Keyed off the same fields the engine
// reads, so a tile cannot gain a power the gallery quietly omits — anything
// unrecognised is surfaced rather than dropped (see noteFor).
const ON_RESOLVE = {
  BONUS_ITEM:
    "Resolve the room's card as normal, then you may draw one more and take the item on it.",
  SECOND_CARD_THEN_GAIN_TOTEM:
    "The relic is here. Resolve the card, then draw and resolve a second — that one is the search. Survive it and the relic is yours.",
  SECOND_CARD_THEN_BURY_TOTEM:
    "Resolve the card, then a second for the burial. Survive it holding the relic and you have won.",
};
const ON_TURN_END = { HEAL_1: "+1 Health if you end your turn here." };
const ONCE = { RESTORE_COWER: "Restores one cower charge. Once per night." };
// The one category this room can be rummaged for. The pool behind them is not
// designed yet, so this says where a search happens and nothing about what it
// finds.
const SEARCH = {
  weapon: "Search here for a weapon.",
  magic: "Search here for a charm.",
  medicine: "Search here for medicine.",
};

const WORD = { N: "north", E: "east", S: "south", W: "west" };

function noteFor(def, world) {
  const notes = [];
  // Both decks have a `start` tile, but they mean different things: one is
  // where the night begins, the other is what goes down the moment you step
  // outside. Two cards reading "Where you begin" would just be confusing.
  if (def.start) {
    notes.push(
      world === "indoor"
        ? "Where you begin."
        : "Set aside at setup — it goes down the moment you first step outside."
    );
  }
  if (def.search) {
    const line = SEARCH[def.search] || `Search here for ${def.search}.`;
    notes.push(def.best ? `${line} The best of its kind in the game.` : line);
  }
  if (def.exteriorDoor) {
    notes.push(
      `Carries the gate out — its ${WORD[def.exteriorDoor]} door leads outside, not to another room.`
    );
  }
  if (def.seam) notes.push("Joins the house along its seam edge, the way back in.");
  if (def.sanctuary) notes.push("Running water. Their attacks do you no harm while you stand here.");
  if (def.pray) notes.push("Pray: the next unexplored place you put down is the one you are looking for. Once per night.");
  if (def.once) notes.push(ONCE[def.once] || `Special: ${def.once}`);
  if (def.onResolve) notes.push(ON_RESOLVE[def.onResolve] || `Special: ${def.onResolve}`);
  if (def.onTurnEnd) notes.push(ON_TURN_END[def.onTurnEnd] || `Special: ${def.onTurnEnd}`);
  return notes;
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
const CHIP_SEARCH = { weapon: "武器 weapons", magic: "符咒 magic", medicine: "丹藥 medicine" };

function chipsFor(def) {
  const chips = [];
  if (def.search) {
    chips.push([CHIP_SEARCH[def.search] || def.search, `tilechip--${def.search}`, true]);
    if (def.best) chips.push(["best of its kind", "tilechip--star", false]);
  }
  if (def.onTurnEnd === "HEAL_1") chips.push(["+1 health", "", false]);
  if (def.sanctuary) chips.push(["no damage", "", false]);
  if (def.once || def.pray) chips.push(["once per night", "", false]);
  if (def.onResolve) chips.push(["goal", "tilechip--goal", false]);
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
  const named = def.exits.map((d) => WORD[d]);
  const text = document.createElement("span");
  text.textContent =
    (named.length === 4 ? "Doors on all four walls" : `Doors ${named.join(", ")}`) +
    (def.seam ? `, ${WORD[def.seam]} seam` : "") + ".";
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

  for (const note of noteFor(def, world)) {
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
    const [tiles, theme] = await Promise.all([
      fetch("data/tiles.json").then((r) => r.json()),
      fetch("data/theme.json").then((r) => r.json()),
      loadIcons(),
    ]);
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

    // The cast is the one thing on this page that changes what the art looks
    // like, so it gets a switch. Off, every scene renders exactly as it was
    // painted — which is the only way to compare the two halves without the
    // page colouring the answer.
    const castBtn = document.getElementById("btn-cast");
    if (castBtn) {
      castBtn.addEventListener("click", () => {
        const on = castBtn.getAttribute("aria-pressed") === "true";
        castBtn.setAttribute("aria-pressed", String(!on));
        document.body.classList.toggle("nocast", on);
      });
    }

    group(host, tiles.indoor, theme, "indoor",
      "The village, and the 義莊 at the end of it",
      "Beams overhead, a plastered wall, a stone floor running away from you, and one oil lamp off to the left.");
    group(host, tiles.outdoor, theme, "outdoor",
      "The hillside",
      "Sky, the same moon in the same corner, hills on the horizon, cold ground and a band of mist.");
  } catch (err) {
    console.error(err);
    host.textContent = "Could not load the tile set.";
  }
}

main();
