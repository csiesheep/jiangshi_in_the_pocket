// Rendering — reflects game + board state into the DOM. No game logic here.

import { RULES, effectiveAttack } from "./engine.js";
import { cellKey, currentTile, listMoves } from "./board.js";
import { combatSting, doorCreak, tollBell } from "./audio.js";

const DIR_CLASS = { N: "n", E: "e", S: "s", W: "w" };
const DIRS = ["N", "E", "S", "W"];
const DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIR_WORD = { N: "north", E: "east", S: "south", W: "west" };

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

// Interface icons for anything outside the board — the sprite builder itself
// stays private.
export function uiIcon(name, cls) {
  return icon("ui", name, cls);
}

export function formatHour(hour) {
  return `${hour - 12} PM`;
}

// Health has no upper bound in this ruleset — cowering adds 3 with no cap — so
// there is no "x of y" to draw. Hearts show damage against the starting health
// while the number stays small, and fall back to a count once it does not.
const HEART_BASELINE = RULES.START_HEALTH;
const MAX_HEARTS = 10;

// Health, items and the hour are all diffed here rather than at the dozens of
// places that change them: renderHud sees every state refresh, so one hook
// catches damage from fights, flee costs and events alike.
let lastHealth = null;
const LOW_HEALTH = 2;

export function renderHud(game) {
  const health = game.state.health;
  if (lastHealth != null && health < lastHealth) damageFeedback();
  lastHealth = health;

  // One class; the pulse itself is CSS. Only while alive — the body should not
  // be beating under the you-died overlay.
  document.body.classList.toggle(
    "low-health",
    health > 0 && health <= LOW_HEALTH && game.state.status === "playing"
  );

  renderHealth(game.state);
  renderAttack(game.state);
  renderHour(game.state);
  renderRelic(game.state);
  renderBackpack(game);
}

// Icons are decorative; every stat carries its value as text for screen readers.
function srOnly(text) {
  const el = document.createElement("span");
  el.className = "sr-only";
  el.textContent = text;
  return el;
}

function statBox(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = "";
  return el;
}

function renderHealth(s) {
  const el = statBox("hud-health");
  if (!el) return;

  if (s.health > MAX_HEARTS) {
    const heart = icon("stat", "heart", "staticon heart heart--full");
    if (heart) el.appendChild(heart);
    const n = document.createElement("span");
    n.className = "statnum";
    n.textContent = `×${s.health}`;
    n.setAttribute("aria-hidden", "true");
    el.appendChild(n);
  } else {
    const slots = Math.max(s.health, HEART_BASELINE);
    for (let i = 0; i < slots; i++) {
      const full = i < s.health;
      const heart = icon("stat", "heart", `staticon heart heart--${full ? "full" : "empty"}`);
      if (heart) el.appendChild(heart);
    }
  }
  el.appendChild(srOnly(String(s.health)));
}

function renderAttack(s) {
  const el = statBox("hud-attack");
  if (!el) return;
  const attack = effectiveAttack(s);
  const buffed = attack > RULES.START_ATTACK;

  const sword = icon("stat", "sword", "staticon sword" + (buffed ? " sword--buffed" : ""));
  if (sword) el.appendChild(sword);
  const n = document.createElement("span");
  n.className = "statnum" + (buffed ? " statnum--buffed" : "");
  n.textContent = String(attack);
  n.setAttribute("aria-hidden", "true");
  el.appendChild(n);
  el.appendChild(srOnly(buffed ? `${attack}, boosted by a weapon` : String(attack)));
}

// The hand sweeps round when the hour actually turns, which is the only time
// the clock changes — every other render redraws it in place.
let lastHour = null;

function renderHour(s) {
  const el = statBox("hud-hour");
  if (!el) return;
  const angle = (s.hour % 12) * 30;
  const face = clockFace(angle);
  el.appendChild(face);

  const text = document.createElement("span");
  text.className = "statnum";
  text.textContent = formatHour(s.hour);
  text.setAttribute("aria-hidden", "true");
  el.appendChild(text);
  el.appendChild(srOnly(formatHour(s.hour)));

  // The hour is the only thing that moves the light. timePasses loses at
  // midnight before it can increment past 23, so 9/10/11 covers every state a
  // player can be looking at; the clamp is belt and braces.
  const hour = Math.min(Math.max(s.hour - 12, 9), 11);
  const body = document.body;
  for (const h of [9, 10, 11]) body.classList.toggle(`hour-${h}`, h === hour);

  const turned = lastHour != null && lastHour !== s.hour;
  lastHour = s.hour;
  if (!turned) return;

  if (s.hour === RULES.FINAL_HOUR) strikeEleven(face);
  if (reducedMotion()) return;
  const hand = face.querySelector(".clock-hand--hour");
  if (hand && typeof hand.animate === "function") {
    hand.animate(
      [{ transform: `rotate(${angle - 30}deg)` }, { transform: `rotate(${angle}deg)` }],
      { duration: 480, easing: "cubic-bezier(.3,.8,.4,1)" }
    );
  }
}

// The last hour, called out. The ambient palette shift is handled by the hour
// class; this is the punctuation on top of it.
function strikeEleven(face) {
  log("Eleven. The last hour — when the deck runs dry, it is midnight.", "bad");
  tollBell();
  if (reducedMotion() || typeof face.animate !== "function") return;
  face.animate(
    [
      { transform: "rotate(0deg) scale(1)" },
      { transform: "rotate(-9deg) scale(1.18)", offset: 0.25 },
      { transform: "rotate(8deg) scale(1.14)", offset: 0.55 },
      { transform: "rotate(-3deg) scale(1.06)", offset: 0.8 },
      { transform: "rotate(0deg) scale(1)" },
    ],
    { duration: 900, easing: "ease-in-out" }
  );
}

function clockFace(angle) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "staticon clock");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  const face = document.createElementNS(NS, "circle");
  face.setAttribute("cx", "12");
  face.setAttribute("cy", "12");
  face.setAttribute("r", "9.5");
  face.setAttribute("class", "clock-face");
  svg.appendChild(face);

  for (const a of [0, 90, 180, 270]) {
    const tick = document.createElementNS(NS, "line");
    tick.setAttribute("x1", "12");
    tick.setAttribute("y1", "3.6");
    tick.setAttribute("x2", "12");
    tick.setAttribute("y2", "5.6");
    tick.setAttribute("transform", `rotate(${a} 12 12)`);
    tick.setAttribute("class", "clock-tick");
    svg.appendChild(tick);
  }

  // Always on the hour, so the minute hand points at twelve.
  const minute = document.createElementNS(NS, "line");
  minute.setAttribute("x1", "12");
  minute.setAttribute("y1", "12");
  minute.setAttribute("x2", "12");
  minute.setAttribute("y2", "5.8");
  minute.setAttribute("class", "clock-hand clock-hand--minute");
  svg.appendChild(minute);

  const hour = document.createElementNS(NS, "line");
  hour.setAttribute("x1", "12");
  hour.setAttribute("y1", "12");
  hour.setAttribute("x2", "12");
  hour.setAttribute("y2", "8");
  hour.setAttribute("class", "clock-hand clock-hand--hour");
  hour.style.transformOrigin = "12px 12px";
  hour.style.transform = `rotate(${angle}deg)`;
  svg.appendChild(hour);

  return svg;
}

function renderRelic(s) {
  const el = statBox("hud-totem");
  if (!el) return;
  if (s.totem) {
    const art = icon("tile", "graveyard", "staticon relic relic--held");
    if (art) el.appendChild(art);
  }
  const text = document.createElement("span");
  text.className = "statnum" + (s.totem ? " statnum--buffed" : "");
  text.textContent = s.totem ? "Held" : "Not yet";
  text.setAttribute("aria-hidden", "true");
  el.appendChild(text);
  el.appendChild(srOnly(s.totem ? "held" : "not found yet"));
}

// The backpack: one row per carry slot, empty ones included so the two-item
// limit is visible rather than implied. Effects are derived from items.json, so
// a re-theme or a stat change needs no edit here.
function renderBackpack(game) {
  const s = game.state;
  const el = document.getElementById("hud-items");
  if (!el) return;
  el.textContent = "";

  for (let i = 0; i < RULES.MAX_ITEMS; i++) {
    const id = s.items[i];
    const row = document.createElement("div");
    row.className = "slot" + (id ? "" : " slot--empty");

    if (!id) {
      const name = document.createElement("span");
      name.className = "slotname";
      name.textContent = "Empty slot";
      row.appendChild(name);
      el.appendChild(row);
      continue;
    }

    const art = icon("item", id, "itemicon");
    if (art) row.appendChild(art);

    const text = document.createElement("span");
    text.className = "slottext";
    const name = document.createElement("span");
    name.className = "slotname";
    name.textContent = itemName(game, id);
    text.appendChild(name);

    const effect = itemEffect(game, id);
    if (effect) {
      const eff = document.createElement("span");
      eff.className = "sloteffect";
      eff.textContent = effect;
      text.appendChild(eff);
    }
    row.appendChild(text);
    el.appendChild(row);
  }

  // The relic is exempt from the carry limit, so it sits outside the slots.
  if (s.totem) {
    const row = document.createElement("div");
    row.className = "slot slot--relic";
    const art = icon("tile", "graveyard", "itemicon");
    if (art) row.appendChild(art);
    const text = document.createElement("span");
    text.className = "slottext";
    const name = document.createElement("span");
    name.className = "slotname";
    name.textContent = "The relic";
    const eff = document.createElement("span");
    eff.className = "sloteffect";
    eff.textContent = "takes no slot · bury it to win";
    text.appendChild(name);
    text.appendChild(eff);
    row.appendChild(text);
    el.appendChild(row);
  }
}

function itemEffect(game, id) {
  const it = game.state.itemsById[id];
  if (!it) return "";
  if (it.type === "weapon") {
    const fuel = it.fuel != null ? ` · ${game.state.chainsawFuel} fight${game.state.chainsawFuel === 1 ? "" : "s"} of fuel` : "";
    return `+${it.attack} attack${fuel}`;
  }
  if (it.type === "heal") return `+${it.health} health`;
  const bits = [];
  if (it.fleeNoDamage) bits.push("flee unharmed");
  if (it.combo) bits.push("pairs with " + Object.keys(it.combo).map((k) => itemName(game, k)).join(" or "));
  if (it.type === "enabler") bits.push("needs a fuel to use");
  return bits.join(" · ");
}

// What each wall of the room you're standing in is currently doing. Passability
// is taken from listMoves() rather than re-derived, so the picture can never
// disagree with the buttons.
//
// Five states, because this ruleset allows a door to open onto a neighbour's
// blank wall:
//   wall     — no opening at all
//   shut     — an opening with unexplored space beyond; nothing to show behind it
//   open     — a passage into an explored room; that room is shown, half-seen
//   blocked  — an opening that leads nowhere (a door facing a wall, or no tiles
//              left to place). Drawn shut, because you cannot use it.
//   outside  — the arrow door, before the seam is placed
function edgeStates(game) {
  const board = game.board;
  const tile = currentTile(board);
  // A seam "cross" move shares its direction with the arrow door, and is pushed
  // after the per-direction moves, so it legitimately wins here.
  const byDir = new Map(listMoves(board).map((m) => [m.dir, m]));

  const out = {};
  for (const dir of DIRS) {
    const hole = tile.holes.includes(dir);
    const door = tile.exits.includes(dir);
    const move = byDir.get(dir);
    const type = move && move.type;

    // The arrow edge is a passage that is not one of the tile's own doors: the
    // Veranda joins the house along its seam edge, which is absent from its
    // exit list. Without this the way home renders as blank wall.
    const arrow = dir === tile.exteriorDir || dir === tile.seamDir;

    if (!hole && !door && !arrow) {
      out[dir] = { kind: "wall", state: "wall", neighbour: null };
      continue;
    }

    let state = "blocked";
    let neighbour = null;

    if (type === "move" || type === "cross") {
      state = "open";
      const to = move.to;
      neighbour = board.worlds[to.world].get(cellKey(to.x, to.y)) || null;
    } else if (type === "outside") {
      state = "outside";
    } else if (type === "explore") {
      state = "shut";
    } else {
      // No move offered. Either a door onto an explored neighbour's wall, or an
      // unexplored edge with an empty tile stack.
      const [dx, dy] = DELTA[dir];
      state = board.worlds[tile.world].get(cellKey(tile.x + dx, tile.y + dy)) ? "blocked" : "shut";
    }

    out[dir] = {
      kind: hole ? "broken" : "door",
      arrow,
      crossesWorld: type === "cross",
      state,
      neighbour,
    };
  }
  return out;
}

// Only the room you're in, centred, with a half-glimpse of each explored room
// you could step into. Nothing behind a shut door.
export function renderBoard(game) {
  const board = game.board;
  const el = document.getElementById("board");
  el.innerHTML = "";

  const tile = currentTile(board);
  const edges = edgeStates(game);

  const view = document.createElement("div");
  view.className = "focus";

  for (const dir of DIRS) {
    const e = edges[dir];
    const slot = document.createElement("div");
    slot.className = `focus-slot focus-slot--${DIR_CLASS[dir]}`;
    if (e.state === "open" && e.neighbour) slot.appendChild(halfRoom(game, e, dir));
    view.appendChild(slot);
  }

  const centre = document.createElement("div");
  centre.className = "focus-centre";
  centre.appendChild(centreRoom(game, tile, edges));
  view.appendChild(centre);

  el.appendChild(view);
}

// ---- The scare -------------------------------------------------------------
// A full-window flash of the risen before the combat choices appear. Unlike
// animateEntry this one is *awaited* — the actions land after the fade — so it
// has to resolve in every circumstance or the turn would stall: no art, no
// Web Animations, reduced motion, all resolve immediately.
//
// The caller clears the action list before calling this, so during the flash
// there are no buttons to click and none for the global number keys to find.
// That is what stops a player mashing 1 from firing whatever appears
// underneath.
const SCARE_BASE_MS = 300;

// Where each of the risen stands, in order. One face for the smallest pack, up
// to six, so a three-zombie dead end and a six-zombie card do not land
// identically. Fixed rather than random: a seeded run is meant to replay the
// same, and Math.random here would make the same fight look different twice.
// [x%, y%, scale, share of the run before it appears]
const SCARE_SLOTS = [
  [50, 50, 1.0, 0.0],
  [21, 38, 0.62, 0.1],
  [79, 43, 0.66, 0.16],
  [33, 74, 0.54, 0.22],
  [69, 76, 0.58, 0.28],
  [50, 21, 0.5, 0.34],
];

export function jumpScare(count = 0) {
  return new Promise((resolve) => {
    // Same rule as the door: the cue is sound, not motion, so it plays whether
    // or not the picture does.
    combatSting(count);
    if (reducedMotion()) return resolve();

    // A card fight can be followed straight away by a zombie door; never stack.
    const stale = document.querySelector(".scare");
    if (stale) stale.remove();

    if (!document.getElementById("scare-zombie")) return resolve(); // no art, no hold-up

    const el = document.createElement("div");
    el.className = "scare";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);

    if (typeof el.animate !== "function") {
      el.remove();
      return resolve();
    }

    // Encounters run 3 to 6, so weight across that band rather than from zero.
    const faces = Math.max(1, Math.min(count || 1, SCARE_SLOTS.length));
    const weight = Math.min(Math.max((faces - 3) / 3, 0), 1);
    const duration = SCARE_BASE_MS + Math.round(weight * 200);

    for (let i = 0; i < faces; i++) {
      const [x, y, scale, at] = SCARE_SLOTS[i];
      const art = icon("scare", "zombie", "scare-art");
      if (!art) break;
      const seat = document.createElement("span");
      seat.className = "scare-face";
      seat.style.left = `${x}%`;
      seat.style.top = `${y}%`;
      seat.style.setProperty("--face-scale", String(scale));
      seat.appendChild(art);
      el.appendChild(seat);

      // The one in front lunges; the pack behind snaps in after it. The size
      // itself comes from --face-scale on the width, so these keyframes are a
      // relative nudge around it — multiplying by `scale` here would apply it
      // twice and leave the back row far smaller than intended.
      seat.animate(
        [
          { opacity: 0, transform: `translate(-50%, -50%) scale(${i ? 0.8 : 1.2})` },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
        ],
        { duration: Math.round(duration * 0.34), delay: Math.round(duration * at), fill: "backwards", easing: "cubic-bezier(.2,.8,.3,1)" }
      );
    }

    const anim = el.animate(
      [
        { opacity: 0 },
        { opacity: 1, offset: 0.16 },
        { opacity: 1, offset: 0.66 },
        { opacity: 0 },
      ],
      { duration, easing: "ease-out" }
    );
    // Resolve once, from whichever comes first. Web Animations do not advance
    // while the document is hidden, so anim.finished hangs for as long as the
    // player has the tab in the background — and the combat choices are gated
    // behind this promise, which would leave the turn frozen on their return.
    // Timers still fire when backgrounded, so one backs the animation up.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.remove();
      resolve();
    };
    anim.finished.then(done).catch(done);
    setTimeout(done, duration + 250);
  });
}

// ---- Taking a hit ----------------------------------------------------------
// A red wash over the board and a short shake. Sits below the jump scare so the
// two do not fight when a fight is what dealt the damage.
function damageFeedback() {
  if (reducedMotion()) return;

  const pane = document.querySelector(".board-pane");
  if (pane && typeof pane.animate === "function") {
    pane.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: "translate(-5px, 2px)" },
        { transform: "translate(4px, -2px)" },
        { transform: "translate(-2px, 1px)" },
        { transform: "translate(0, 0)" },
      ],
      { duration: 160, easing: "ease-out" }
    );
  }

  const existing = document.querySelector(".hitflash");
  if (existing) existing.remove();
  const flash = document.createElement("div");
  flash.className = "hitflash";
  flash.setAttribute("aria-hidden", "true");
  document.body.appendChild(flash);
  if (typeof flash.animate !== "function") {
    flash.remove();
    return;
  }
  const anim = flash.animate(
    [{ opacity: 0 }, { opacity: 0.5, offset: 0.18 }, { opacity: 0 }],
    { duration: 380, easing: "ease-out" }
  );
  let gone = false;
  const clear = () => {
    if (gone) return;
    gone = true;
    flash.remove();
  };
  anim.finished.then(clear).catch(clear);
  // Animations stall while the tab is hidden; never leave a red sheet behind.
  setTimeout(clear, 700);
}

// ---- Moving between rooms --------------------------------------------------
// Three layers, played together after the new room is rendered: the door you
// came through swings open, footprints track from that doorway to where you're
// standing, and the whole view slides one room in the direction travelled.
//
// Purely decorative — state has already changed and nothing waits on these, so
// clicking straight through a move can never desync the board.
const SLIDE_MS = 700;
const DOOR_MS = 300;
const FOOT_MS = 360;
const FOOT_STAGGER = 78;
const OPPOSITE = { N: "S", E: "W", S: "N", W: "E" };

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Deferred to the next frame on purpose: resolving the room's card refreshes the
// board again, and renderBoard rebuilds .focus from scratch, so animating the
// element that exists right now would animate a node about to be thrown away.
export function animateEntry(dir) {
  const [dx, dy] = DELTA[dir] || [0, 0];
  if (!dx && !dy) return;

  // Sound is not motion, so the hinge is heard even with animation turned off.
  // Only for a real door — a smashed wall has nothing to swing.
  const back = OPPOSITE[dir];
  const backEdge = document.querySelector(`.focus-centre .tilebox .edgemark.${DIR_CLASS[back]}`);
  if (backEdge && !backEdge.classList.contains("edgemark--broken")) doorCreak();

  if (reducedMotion()) return;

  requestAnimationFrame(() => {
    const view = document.querySelector(".focus");
    if (!view || typeof view.animate !== "function") return;

    slideView(view, dx, dy);

    const box = view.querySelector(".focus-centre .tilebox");
    if (!box) return;
    const back = OPPOSITE[dir]; // the wall you came through, in the new room
    swingDoor(box, back);
    trackFootprints(box, back);
  });
}

function slideView(view, dx, dy) {
  const tile = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tile")) || 170;
  const gap = parseFloat(getComputedStyle(view).rowGap) || 0;
  const step = tile + gap;
  view.animate(
    [
      { transform: `translate(${dx * step}px, ${dy * step}px)` },
      { transform: "translate(0, 0)" },
    ],
    { duration: SLIDE_MS, easing: "cubic-bezier(.22,.61,.36,1)" }
  );
}

// A leaf hinged in the doorway, swinging inward. Skipped for a broken wall —
// there is no door there to open.
function swingDoor(box, back) {
  const edge = box.querySelector(`.edgemark.${DIR_CLASS[back]}`);
  if (!edge || edge.classList.contains("edgemark--broken")) return;

  const swing = document.createElement("span");
  swing.className = `doorswing ${DIR_CLASS[back]}`;
  swing.setAttribute("aria-hidden", "true");
  const leaf = document.createElement("span");
  leaf.className = "leaf";
  swing.appendChild(leaf);
  box.appendChild(swing);

  const anim = leaf.animate(
    [
      { transform: "rotate(0deg)", opacity: 1 },
      { transform: "rotate(74deg)", opacity: 1, offset: 0.75 },
      { transform: "rotate(74deg)", opacity: 0 },
    ],
    { duration: DOOR_MS, easing: "cubic-bezier(.3,.7,.4,1)" }
  );
  anim.finished.then(() => swing.remove()).catch(() => swing.remove());
}

// Footprints from the doorway to the middle of the room, alternating left and
// right of the line of travel, fading in one after another.
function trackFootprints(box, back) {
  const track = document.createElement("span");
  track.className = "steps";
  track.setAttribute("aria-hidden", "true");

  const along = [88, 76, 64, 52]; // percent from the wall, inward
  const count = along.length;
  for (let i = 0; i < count; i++) {
    const foot = document.createElement("span");
    foot.className = "step";
    const side = i % 2 ? 57 : 43; // left/right of the walking line
    const near = along[i];
    if (back === "S") { foot.style.top = `${near}%`; foot.style.left = `${side}%`; }
    else if (back === "N") { foot.style.top = `${100 - near}%`; foot.style.left = `${side}%`; }
    else if (back === "E") { foot.style.left = `${near}%`; foot.style.top = `${side}%`; }
    else { foot.style.left = `${100 - near}%`; foot.style.top = `${side}%`; }
    foot.style.transform = `translate(-50%, -50%) rotate(${back === "N" || back === "S" ? 0 : 90}deg)`;
    track.appendChild(foot);

    foot.animate(
      [{ opacity: 0 }, { opacity: 0.9, offset: 0.35 }, { opacity: 0 }],
      { duration: FOOT_MS, delay: DOOR_MS * 0.5 + i * FOOT_STAGGER, easing: "ease-out" }
    );
  }
  box.appendChild(track);
  setTimeout(() => track.remove(), DOOR_MS * 0.5 + count * FOOT_STAGGER + FOOT_MS + 60);
}

function centreRoom(game, tile, edges) {
  const box = document.createElement("div");
  box.className = "tilebox tilebox--here";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", describeRoom(game, tile, edges));

  for (const dir of DIRS) {
    const mark = edgeMark(dir, edges[dir]);
    if (mark) box.appendChild(mark);
  }

  const art = icon("tile", tile.id, "tileicon");
  if (art) box.appendChild(art);

  const name = document.createElement("span");
  name.className = "tilename";
  name.textContent = tileName(game, tile.id);
  name.setAttribute("aria-hidden", "true");
  box.appendChild(name);

  const you = document.createElement("span");
  you.className = "you";
  you.textContent = "☻";
  you.setAttribute("aria-hidden", "true");
  box.appendChild(you);
  return box;
}

// The far half of a neighbour is masked away, so it reads as a room you can see
// into rather than a room you are in.
function halfRoom(game, edge, dir) {
  const half = document.createElement("div");
  half.className = `halfroom halfroom--${DIR_CLASS[dir]}`;
  if (edge.crossesWorld) half.classList.add("halfroom--across");
  half.setAttribute("aria-hidden", "true"); // already in the centre room's label

  const art = icon("tile", edge.neighbour.id, "tileicon");
  if (art) half.appendChild(art);

  const name = document.createElement("span");
  name.className = "tilename";
  name.textContent = tileName(game, edge.neighbour.id);
  half.appendChild(name);
  return half;
}

function edgeMark(dir, edge) {
  if (edge.kind === "wall") return null;

  let symbol;
  let tone;
  if (edge.kind === "broken") {
    symbol = "wall-broken";
    tone = "broken";
  } else if (edge.arrow && (edge.state === "outside" || edge.crossesWorld)) {
    symbol = "door-exterior";
    tone = "exterior";
  } else if (edge.state === "open") {
    symbol = "door-open";
    tone = "open";
  } else {
    symbol = "door-closed";
    tone = edge.state === "blocked" ? "blocked" : "shut";
  }

  const wrap = document.createElement("span");
  wrap.className = `edgemark ${DIR_CLASS[dir]} edgemark--${tone}`;
  wrap.setAttribute("aria-hidden", "true");
  const art = icon("edge", symbol, "edgeart");
  if (art) wrap.appendChild(art);
  return wrap;
}

// One sentence covering the room and all four walls, so the board is playable
// without seeing it.
function describeRoom(game, tile, edges) {
  const parts = [`${tileName(game, tile.id)}, you are here.`];
  for (const dir of DIRS) {
    const e = edges[dir];
    const where = DIR_WORD[dir];
    if (e.state === "wall") {
      parts.push(`To the ${where}, a wall.`);
    } else if (e.state === "outside") {
      parts.push(`To the ${where}, the arrow door leading outside.`);
    } else if (e.state === "open") {
      const thing = e.kind === "broken" ? "a broken wall" : e.arrow ? "the arrow door" : "an open door";
      const room = e.neighbour ? tileName(game, e.neighbour.id) : "somewhere explored";
      parts.push(`To the ${where}, ${thing} into the ${room}${e.crossesWorld ? ", across the threshold" : ""}.`);
    } else if (e.state === "blocked") {
      const thing = e.kind === "broken" ? "a broken wall" : "a door";
      parts.push(`To the ${where}, ${thing} that leads nowhere.`);
    } else {
      const thing = e.kind === "broken" ? "a broken wall" : "a shut door";
      parts.push(`To the ${where}, ${thing}, unexplored beyond.`);
    }
  }
  return parts.join(" ");
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
//
// These live in a pop-out over the board rather than a fixed sidebar panel, so
// the choice sits next to what the player is looking at and takes no room when
// there is nothing to decide.
//
// There is deliberately no way to dismiss it. Every state that renders actions
// requires one of them to be chosen — moving is mandatory, a fight must be
// resolved, a zombie door must be given a wall — so a close button or an
// Escape binding would only ever strand the player with no way to act. It
// hides when the list is empty, which is the one moment nothing is being asked.
//
// It is also deliberately not a modal and traps no focus: with no dismiss, a
// focus trap would lock a keyboard player away from New game for the rest of
// the run. Tab reaches the sidebar as normal; the number keys stay bound
// globally.
export function renderActions(actions, prompt = "") {
  const el = document.getElementById("actions");
  const pop = document.getElementById("actions-pop");
  // Keep the keyboard on the turn loop, but don't yank focus out of the
  // sidebar controls if that's where the player put it.
  const hadFocus = el.contains(document.activeElement);
  el.innerHTML = "";

  if (!actions.length) {
    if (pop) pop.hidden = true;
    return;
  }
  if (pop) pop.hidden = false;

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
