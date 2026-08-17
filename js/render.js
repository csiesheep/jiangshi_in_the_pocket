// Rendering — reflects game + board state into the DOM. No game logic here.

import { effectiveAttack } from "./engine.js";
import { cellKey, openings } from "./board.js";

const DIR_CLASS = { N: "n", E: "e", S: "s", W: "w" };

// The three yard tiles are all "Lawn" and share one icon.
const ICON_ALIAS = { "yard-1": "yard", "yard-2": "yard", "yard-3": "yard" };

// Inject the icon sprite once, then reference symbols with <use href="#id">.
// External-file <use> references are not dependably supported, so the sprite is
// inlined instead. Icons are decorative: if the fetch fails, tiles fall back to
// their text label and nothing else changes.
export async function loadIcons() {
  try {
    const res = await fetch("assets/icons.svg", { cache: "no-cache" });
    if (!res.ok) return false;
    const holder = document.createElement("div");
    holder.hidden = true;
    holder.innerHTML = await res.text();
    document.body.appendChild(holder);
    return true;
  } catch {
    return false;
  }
}

function icon(kind, id, cls) {
  const symbol = `${kind}-${ICON_ALIAS[id] || id}`;
  if (!document.getElementById(symbol)) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${symbol}`);
  svg.appendChild(use);
  return svg;
}

export function formatHour(hour) {
  return `${hour - 12} PM`;
}

export function renderHud(game) {
  const s = game.state;
  set("hud-health", s.health);
  set("hud-attack", effectiveAttack(s));
  set("hud-hour", formatHour(s.hour));
  renderCarried(game);
  set("hud-totem", s.totem ? "Yes" : "No");
}

const WORLD_LABEL = { indoor: "Inside the house", outdoor: "Outside" };

// Both halves of the map are drawn, indoor first, so the rooms you explored
// before stepping outside stay visible. The half you are not standing in is
// dimmed rather than hidden.
// Carried items, as icon + name chips. The chainsaw carries its remaining fuel.
function renderCarried(game) {
  const s = game.state;
  const el = document.getElementById("hud-items");
  if (!el) return;
  el.textContent = "";
  if (!s.items.length) {
    el.textContent = "—";
    return;
  }
  for (const id of s.items) {
    const chip = document.createElement("span");
    chip.className = "itemchip";
    const art = icon("item", id, "itemicon");
    if (art) chip.appendChild(art);
    const label = document.createElement("span");
    label.textContent =
      itemName(game, id) + (id === "chainsaw" ? ` (${s.chainsawFuel})` : "");
    chip.appendChild(label);
    el.appendChild(chip);
  }
}

export function renderBoard(game) {
  const board = game.board;
  const el = document.getElementById("board");
  el.innerHTML = "";

  for (const world of ["indoor", "outdoor"]) {
    const map = board.worlds[world];
    if (!map || map.size === 0) continue; // outdoor is empty until the seam
    const active = board.player.world === world;

    const section = document.createElement("div");
    section.className = "world" + (active ? " world--active" : "");

    const label = document.createElement("div");
    label.className = "world-label";
    label.textContent = WORLD_LABEL[world];
    if (!active) label.textContent += " (explored)";
    section.appendChild(label);

    section.appendChild(worldGrid(game, map, active));
    el.appendChild(section);
  }
}

function worldGrid(game, map, active) {
  const board = game.board;
  const tiles = [...map.values()];
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const grid = document.createElement("div");
  grid.className = "grid";
  grid.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, var(--tile))`;
  grid.style.gridTemplateRows = `repeat(${maxY - minY + 1}, var(--tile))`;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const t = map.get(cellKey(x, y));
      if (t) {
        cell.classList.add("tile");
        const here = active && board.player.x === x && board.player.y === y;
        if (here) cell.classList.add("here");
        cell.appendChild(tileInner(game, t, here));
      }
      grid.appendChild(cell);
    }
  }
  return grid;
}

function tileInner(game, t, here) {
  const box = document.createElement("div");
  box.className = "tilebox";

  const marks = [];
  for (const dir of ["N", "E", "S", "W"]) {
    const edge = document.createElement("span");
    let kind = "wall";
    if (t.holes.includes(dir)) kind = "hole";
    else if (t.exits.includes(dir)) kind = "door";
    if (dir === t.exteriorDir) kind = "door exterior";
    edge.className = `edge ${DIR_CLASS[dir]} ${kind}`;
    edge.setAttribute("aria-hidden", "true"); // described in the tile label
    box.appendChild(edge);
    if (kind !== "wall") marks.push(`${dir} ${kind.replace("door exterior", "exterior door")}`);
  }

  // One sentence per tile, so the board is navigable without seeing it.
  const name = tileName(game, t.id);
  box.setAttribute("role", "img");
  box.setAttribute(
    "aria-label",
    `${name}${here ? ", you are here" : ""}${marks.length ? ". Openings: " + marks.join(", ") : ". No openings"}`
  );

  const art = icon("tile", t.id, "tileicon");
  if (art) box.appendChild(art);

  const nameEl = document.createElement("span");
  nameEl.className = "tilename";
  nameEl.textContent = name;
  nameEl.setAttribute("aria-hidden", "true");
  box.appendChild(nameEl);

  if (here) {
    const you = document.createElement("span");
    you.className = "you";
    you.textContent = "☻";
    you.setAttribute("aria-hidden", "true");
    box.appendChild(you);
  }
  return box;
}

export function log(msg, cls = "") {
  const el = document.getElementById("log");
  if (!el) return;
  const p = document.createElement("p");
  if (cls) p.className = cls;
  p.textContent = msg;
  el.prepend(p);
}

export function clearLog() {
  const el = document.getElementById("log");
  if (el) el.innerHTML = "";
}

// The first nine actions get a number-key shortcut. One delegated listener,
// installed on the first render, reads the live button list each keypress.
let keysBound = false;
function bindActionKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > 9) return;
    const b = document.querySelectorAll("#actions .action")[n - 1];
    if (b && !b.disabled) {
      e.preventDefault();
      b.click();
    }
  });
}

// Render a set of action buttons. `actions` = [{label, onClick, primary?}].
export function renderActions(actions, prompt = "") {
  const el = document.getElementById("actions");
  // Keep the keyboard on the turn loop, but don't yank focus out of the
  // sidebar controls if that's where the player put it.
  const hadFocus = el.contains(document.activeElement);
  el.innerHTML = "";
  if (prompt) {
    const p = document.createElement("p");
    p.className = "prompt";
    p.textContent = prompt;
    el.appendChild(p);
  }
  actions.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action" + (a.primary ? " action--primary" : "");
    if (i < 9) {
      const k = document.createElement("kbd");
      k.textContent = String(i + 1);
      b.appendChild(k);
    }
    b.appendChild(document.createTextNode(a.label));
    b.disabled = !!a.disabled;
    b.addEventListener("click", a.onClick);
    el.appendChild(b);
  });
  bindActionKeys();
  if (hadFocus || document.activeElement === document.body) {
    const first =
      el.querySelector(".action--primary:not(:disabled)") ||
      el.querySelector(".action:not(:disabled)");
    if (first) first.focus();
  }
}

// `actions` = [{label, onClick, primary?} | {label, href, primary?}].
export function showOverlay(title, sub, actions = []) {
  let ov = document.getElementById("overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "overlay";
    document.body.appendChild(ov);
  }
  ov.innerHTML = "";

  const card = document.createElement("div");
  card.className = "overlay-card";
  const h = document.createElement("h2");
  h.textContent = title;
  card.appendChild(h);
  const p = document.createElement("p");
  p.textContent = sub || "";
  card.appendChild(p);

  for (const a of actions) {
    const cls = "btn" + (a.primary ? " btn--primary" : "");
    let el;
    if (a.href) {
      el = document.createElement("a");
      el.href = a.href;
    } else {
      el = document.createElement("button");
      el.type = "button";
      el.addEventListener("click", a.onClick);
    }
    el.className = cls;
    el.textContent = a.label;
    card.appendChild(el);
  }

  ov.appendChild(card);
  ov.hidden = false;
  const focusMe = ov.querySelector(".btn--primary") || ov.querySelector(".btn");
  if (focusMe) focusMe.focus();
}

export function hideOverlay() {
  const ov = document.getElementById("overlay");
  if (ov) ov.hidden = true;
}

// ---- name helpers ----------------------------------------------------------
export function tileName(game, id) {
  return (game.data.theme.tiles && game.data.theme.tiles[id]) || id;
}
export function itemName(game, id) {
  return (game.data.theme.items && game.data.theme.items[id]) || id;
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
