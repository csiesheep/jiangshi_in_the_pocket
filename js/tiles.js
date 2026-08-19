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
        : "The first of the garden — it goes down the moment you step outside."
    );
  }
  if (def.exteriorDoor) notes.push("Carries the arrow door — the way out of the house.");
  if (def.seam) notes.push("Joins the house along its seam edge, the way back in.");
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

function card(def, theme, count, world) {
  const el = document.createElement("article");
  el.className = "tilecard";

  const art = document.createElement("div");
  art.className = "tilecard-art";
  const scene = icon("scene", def.id.replace(/-\d+$/, ""), "tilecard-scene");
  if (scene) art.appendChild(scene);
  art.appendChild(doorCompass(def));
  el.appendChild(art);

  const body = document.createElement("div");
  body.className = "tilecard-body";

  const h = document.createElement("h3");
  h.textContent = theme.tiles[def.id] || def.id;
  if (count > 1) {
    const badge = document.createElement("span");
    badge.className = "tilecard-count";
    badge.textContent = `×${count}`;
    // Three identical Lawns in the deck; one card, honestly labelled.
    badge.title = `${count} of these in the deck`;
    h.appendChild(badge);
  }
  body.appendChild(h);

  const doors = document.createElement("p");
  doors.className = "tilecard-doors";
  const named = def.exits.map((d) => WORD[d]);
  // The plan draws the seam as a way through, because it is one — so the
  // sentence has to count it too, or the two disagree in front of the reader.
  doors.textContent =
    (named.length === 4 ? "Doors on all four walls." : `Doors ${named.join(", ")}.`) +
    (def.seam ? ` The ${WORD[def.seam]} edge is the seam.` : "");
  body.appendChild(doors);

  for (const note of noteFor(def, world)) {
    const p = document.createElement("p");
    p.className = "tilecard-note";
    p.textContent = note;
    body.appendChild(p);
  }
  el.appendChild(body);
  return el;
}

function group(host, defs, theme, world) {
  const grid = document.createElement("div");
  // The world cast, so the gallery teaches the same warm/cool language the
  // board speaks.
  grid.className = `tilegrid board board--${world}`;

  // The three Lawns share a scene and a name; show one card with a count
  // rather than three that look like a rendering bug.
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
  for (const { def, count } of seen.values()) grid.appendChild(card(def, theme, count, world));
  host.appendChild(grid);
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
    for (const [world, heading] of [["indoor", "Inside the house"], ["outdoor", "Out the back"]]) {
      const h = document.createElement("h2");
      h.id = world;
      h.textContent = heading;
      host.appendChild(h);
      group(host, tiles[world], theme, world);
    }
  } catch (err) {
    console.error(err);
    host.textContent = "Could not load the tile set.";
  }
}

main();
