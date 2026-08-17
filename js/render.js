// Rendering — reflects game + board state into the DOM. No game logic here.

import { effectiveAttack } from "./engine.js";
import { cellKey, openings } from "./board.js";

const DIR_CLASS = { N: "n", E: "e", S: "s", W: "w" };

export function formatHour(hour) {
  return `${hour - 12} PM`;
}

export function renderHud(game) {
  const s = game.state;
  set("hud-health", s.health);
  set("hud-attack", effectiveAttack(s));
  set("hud-hour", formatHour(s.hour));
  set(
    "hud-items",
    s.items.length
      ? s.items.map((id) => itemName(game, id) + (id === "chainsaw" ? ` (${s.chainsawFuel})` : "")).join(", ")
      : "—"
  );
  set("hud-totem", s.totem ? "Yes" : "No");
}

export function renderBoard(game) {
  const board = game.board;
  const el = document.getElementById("board");
  el.innerHTML = "";

  const world = board.player.world;
  const map = board.worlds[world];
  const tiles = [...map.values()];

  const label = document.createElement("div");
  label.className = "world-label";
  label.textContent = world === "indoor" ? "Inside the house" : "Outside";
  el.appendChild(label);

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
        if (board.player.x === x && board.player.y === y) cell.classList.add("here");
        cell.appendChild(tileInner(game, t));
      }
      grid.appendChild(cell);
    }
  }
  el.appendChild(grid);
}

function tileInner(game, t) {
  const box = document.createElement("div");
  box.className = "tilebox";

  for (const dir of ["N", "E", "S", "W"]) {
    const edge = document.createElement("span");
    let kind = "wall";
    if (t.holes.includes(dir)) kind = "hole";
    else if (t.exits.includes(dir)) kind = "door";
    if (dir === t.exteriorDir) kind = "door exterior";
    edge.className = `edge ${DIR_CLASS[dir]} ${kind}`;
    box.appendChild(edge);
  }

  const name = document.createElement("span");
  name.className = "tilename";
  name.textContent = tileName(game, t.id);
  box.appendChild(name);

  if (game.board.player.x === t.x && game.board.player.y === t.y) {
    const you = document.createElement("span");
    you.className = "you";
    you.textContent = "☻";
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

// Render a set of action buttons. `actions` = [{label, onClick, primary?}].
export function renderActions(actions, prompt = "") {
  const el = document.getElementById("actions");
  el.innerHTML = "";
  if (prompt) {
    const p = document.createElement("p");
    p.className = "prompt";
    p.textContent = prompt;
    el.appendChild(p);
  }
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = "action" + (a.primary ? " action--primary" : "");
    b.textContent = a.label;
    b.disabled = !!a.disabled;
    b.addEventListener("click", a.onClick);
    el.appendChild(b);
  }
}

export function showOverlay(title, sub) {
  let ov = document.getElementById("overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "overlay";
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="overlay-card"><h2>${title}</h2><p>${sub || ""}</p>
    <a class="btn btn--primary" href="game.html">Play again</a>
    <a class="btn" href="index.html">Menu</a></div>`;
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
