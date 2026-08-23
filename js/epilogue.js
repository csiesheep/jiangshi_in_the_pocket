// The one line on the verdict card worth screenshotting.
//
// Nobody shares "Lasted until 10 PM / 4 of the risen put down". They share a
// sentence. So the run's facts are assembled into one: how it ended, what you
// were holding, and how close you got.
//
// Built from state alone — no dice anywhere in here. The same run always ends
// with the same words, which matters because the seed is printed underneath it
// and somebody is going to check.
//
// Every fragment lives in theme.json with the rest of the writing, so a
// re-theme changes what the house says about you along with everything else.

import { RULES } from "./engine.js";
import { distanceTo } from "./board.js";

// A run needs a fair few zombies at once for this to read as a swarm rather
// than a fight; the zombie door alone puts three on you.
const SWARMED = 6;
// Close enough that saying how close is the point. Further than this and the
// number is just a number.
const NEARBY = 2;
const WITHIN_SIGHT = 3;

function pick(table, key, fallback) {
  return (table && (table[key] || table[fallback])) || "";
}

function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (whole, key) =>
    values[key] === undefined ? whole : values[key]
  );
}

// The weapon the run will be remembered by: the best one still on you at the
// end, which is not always the one that failed you.
function bestWeapon(state) {
  let best = null;
  for (const id of state.items) {
    const def = state.itemsById[id];
    if (!def || def.type !== "weapon") continue;
    if (!best || def.attack > best.def.attack) best = { id, def };
  }
  return best;
}

// Words up to twelve, digits past it. The table is in theme.json rather than
// here because it is writing, and past its last entry the number is the point
// anyway — nobody reads "seventeen rooms" as a sentence.
function roomsPhrase(theme, n) {
  const rooms = theme.rooms || {};
  if (n === null || n === 0) return "";
  const named = rooms[String(n)];
  return named || fill(pick(rooms, "many", "many"), { n });
}

// The three clauses, each chosen by a fact rather than a die.
function openKey(state, won) {
  if (won) return state.health <= 1 ? "won-hurt" : "won";
  if (state.lossReason === "combat") {
    return (state.foughtThisHour || 0) >= SWARMED ? "combat-swarmed" : "combat";
  }
  if (state.lossReason === "health") {
    return state.hour >= RULES.FINAL_HOUR ? "health-worn" : "health";
  }
  return "midnight";
}

function handKey(state, weapon) {
  if (!weapon) return "bare";
  // The saw is the one weapon that can be present and useless, and saying so is
  // more interesting than naming it.
  if (weapon.id === "chainsaw" && state.chainsawFuel <= 0) return "dry";
  return weapon.def.attack >= 2 ? "armed" : "tool";
}

function closeKey(state, won, distance) {
  if (won) return "buried";
  if (state.totem) {
    if (distance === null) return "carrying-lost";
    // Zero is not a distance, it is a place. Sent through the same phrasing as
    // the rest it produced "standing on it from the Family Plot", which is the
    // sort of sentence that only a template writes.
    if (distance === 0) return "carrying-there";
    return distance <= NEARBY ? "carrying-near" : "carrying-far";
  }
  return distance !== null && distance <= WITHIN_SIGHT ? "never-close" : "never";
}

function burialTileId(game) {
  const outdoor = (game.data && game.data.tiles && game.data.tiles.outdoor) || [];
  const found = outdoor.find((d) => d.onResolve === "SECOND_CARD_THEN_BURY_TOTEM");
  return found ? found.id : null;
}

// `game` is the controller: it owns the state, the board and the skin, and this
// needs all three.
export function epilogue(game) {
  const theme = (game.data && game.data.theme && game.data.theme.epilogue) || null;
  if (!theme) return ""; // a skin without the fragments simply has no epilogue
  const state = game.state;
  const won = state.status === "won";

  const weapon = bestWeapon(state);
  // Which room the burial happens in, asked of the tile data rather than named
  // here: the epilogue has no business knowing what that room is called.
  const goalId = burialTileId(game);
  // Only measured when it can be said. A run that never found the ground has no
  // distance to it, and distanceTo answers null rather than guessing.
  const distance = won || !goalId ? null : distanceTo(game.board, goalId);

  const values = {
    hour: pick(theme.hours, String(state.hour), "24"),
    weapon: weapon ? game.itemName(weapon.id) : "",
    relic: game.word("relic"),
    goal: goalId ? game.tileName(goalId) : "",
    rooms: roomsPhrase(theme, distance),
  };

  const parts = [
    fill(pick(theme.open, openKey(state, won), "midnight"), values),
    fill(pick(theme.hand, handKey(state, weapon), "bare"), values),
    fill(pick(theme.close, closeKey(state, won, distance), "never"), values),
  ].filter(Boolean);

  if (!parts.length) return "";
  return `${parts.join(", ")}.`;
}
