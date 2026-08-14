// Core game engine — pure rules over a state object, no DOM, no fetch.
// Numbers come straight from the ruleset spec (v1.5 + designer rulings).
// Board-dependent turn orchestration (movement, tile placement, dead-end
// zombie doors) lives in board.js / app.js; this module owns the deck, the
// clock, combat, items, health and win/lose — everything testable headless.
//
// Data (cards + items) is passed in to newGame() rather than imported, so the
// engine has no I/O and tests can inject fixtures.

export const RULES = {
  START_HEALTH: 6,
  START_ATTACK: 1,
  HEALTH_CAP: null, // no cap by default; v1.75 hard mode caps at 6
  START_HOUR: 21, // 9 PM
  FINAL_HOUR: 23, // 11 PM; needing a card with an empty deck here = loss
  DEV_DECK_SIZE: 9,
  SETUP_BURN: 2, // -> 7 resolvable draws per hour
  MAX_COMBAT_DAMAGE: 4,
  MIN_COMBAT_DAMAGE: 0,
  MAX_ITEMS: 2, // the totem is exempt
  COWER_HEAL: 3,
  RUN_AWAY_DAMAGE: 1,
  ZOMBIE_DOOR_COUNT: 3,
  CHAINSAW_FUEL: 2, // fights per fill
};

// House rules (spec §13), baked in as the defaults.
export const HOUSE_RULES = {
  FLEE_ADJACENT_ONLY: true, // enforced by board.js
  COWER_ONCE_PER_TURN: true,
  TEMPLE_SECOND_CARD_ONCE: true,
};

// ---- RNG -------------------------------------------------------------------
// Small seeded PRNG (mulberry32) so shuffles are deterministic in tests and
// runs can be shared by seed later.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Setup -----------------------------------------------------------------
export function newGame(data, opts = {}) {
  const seed = opts.seed ?? (Date.now() >>> 0);
  const cardsById = Object.fromEntries(data.cards.map((c) => [c.id, c]));
  const itemsById = Object.fromEntries(data.items.map((i) => [i.id, i]));

  const state = {
    rng: makeRng(seed),
    seed,
    cardsById,
    itemsById,
    allCardIds: data.cards.map((c) => c.id),
    health: RULES.START_HEALTH,
    hour: RULES.START_HOUR,
    items: [], // carried item ids, length <= MAX_ITEMS
    chainsawFuel: 0, // fuel remaining while a chainsaw is carried
    totem: false, // slotless
    status: "playing", // playing | won | lost
    lossReason: null,
    coweredThisTurn: false,
    healthCap: opts.healthCap ?? RULES.HEALTH_CAP,
    deck: [],
    burned: [],
  };

  startHour(state); // build + shuffle deck, burn 2
  return state;
}

// (Re)build the full 9-card deck, shuffle, burn 2. Used at setup and each hour.
function startHour(state) {
  const deck = shuffle(state.allCardIds, state.rng);
  state.burned = deck.splice(0, RULES.SETUP_BURN);
  state.deck = deck;
}

// Map wall-clock hour (21/22/23) to the card's outcome key ("9"/"10"/"11").
export function bandKey(state) {
  return String(state.hour - 12);
}

// ---- Clock -----------------------------------------------------------------
// Fires when a draw is attempted on an empty deck.
export function timePasses(state) {
  if (state.hour >= RULES.FINAL_HOUR) {
    state.status = "lost";
    state.lossReason = "midnight";
    return state;
  }
  state.hour += 1;
  startHour(state);
  return state;
}

// Draw the top card id. Empty deck advances the clock first (which may lose at
// midnight, in which case null is returned and status becomes "lost").
export function drawCard(state) {
  if (state.deck.length === 0) {
    timePasses(state);
    if (state.status === "lost") return null;
  }
  return state.deck.shift();
}

// ---- Health ----------------------------------------------------------------
// For events, heals, cower, kitchen/garden. Respects the (optional) cap and
// triggers a loss at 0. NOT used for combat (see combatDamage/resolveCombat).
export function changeHealth(state, delta) {
  state.health += delta;
  if (state.healthCap != null && state.health > state.healthCap) {
    state.health = state.healthCap;
  }
  if (state.health <= 0) {
    state.health = 0;
    state.status = "lost";
    state.lossReason = state.lossReason || "health";
  }
  return state;
}

// ---- Combat ----------------------------------------------------------------
// Damage is arithmetic, clamped to [0, 4]. Attack never stacks: the caller (or
// chooseWeapon) picks the single best weapon; there is no summing.
export function combatDamage(zombies, attack) {
  const raw = zombies - attack;
  return Math.max(RULES.MIN_COMBAT_DAMAGE, Math.min(RULES.MAX_COMBAT_DAMAGE, raw));
}

// Usable weapons carried right now (an empty chainsaw is unusable but kept).
export function usableWeapons(state) {
  return state.items.filter((id) => {
    const d = state.itemsById[id];
    return d && d.type === "weapon" && !(id === "chainsaw" && state.chainsawFuel <= 0);
  });
}

// The weapon that would be used: an explicit preference if usable, else the
// best bonus available.
export function chooseWeapon(state, preferId = null) {
  const usable = usableWeapons(state);
  if (preferId && usable.includes(preferId)) return preferId;
  let best = null;
  for (const id of usable) {
    if (!best || state.itemsById[id].attack > state.itemsById[best].attack) best = id;
  }
  return best;
}

// Effective attack score for display/preview (1 + best usable weapon bonus).
export function effectiveAttack(state) {
  const w = chooseWeapon(state);
  return RULES.START_ATTACK + (w ? state.itemsById[w].attack : 0);
}

// Fight `zombies`. Consumes a chainsaw use if the chainsaw is the weapon used.
export function resolveCombat(state, zombies, choices = {}) {
  const weaponId = chooseWeapon(state, choices.weapon);
  const bonus = weaponId ? state.itemsById[weaponId].attack : 0;
  const attack = RULES.START_ATTACK + bonus;
  if (weaponId === "chainsaw") state.chainsawFuel -= 1;
  const damage = combatDamage(zombies, attack);
  state.health -= damage;
  if (state.health <= 0) {
    state.health = 0;
    state.status = "lost";
    state.lossReason = "combat";
  }
  return { weaponId, attack, damage };
}

// ---- Items -----------------------------------------------------------------
export function hasItemSpace(state) {
  return state.items.length < RULES.MAX_ITEMS;
}

// Pick up an item, optionally dropping one to make room. Returns {ok}. The
// totem is not an item — use gainTotem().
export function pickUpItem(state, itemId, dropId = null) {
  if (!state.itemsById[itemId]) return { ok: false, reason: "unknown-item" };
  if (state.items.includes(itemId)) return { ok: false, reason: "already-held" };
  if (!hasItemSpace(state)) {
    if (!dropId) return { ok: false, reason: "full" };
    dropItem(state, dropId);
  }
  state.items.push(itemId);
  if (itemId === "chainsaw") state.chainsawFuel = RULES.CHAINSAW_FUEL;
  return { ok: true };
}

// Drop an item. A dropped chainsaw loses its fuel; a spent chainsaw is only
// ever dropped explicitly (never automatically).
export function dropItem(state, itemId) {
  const i = state.items.indexOf(itemId);
  if (i >= 0) state.items.splice(i, 1);
  if (itemId === "chainsaw") state.chainsawFuel = 0;
  return state;
}

// Drink the soda: +2 health (respects cap), consumes it.
export function useHealItem(state, itemId = "can-of-soda") {
  const def = state.itemsById[itemId];
  if (!state.items.includes(itemId) || !def || def.type !== "heal") return { ok: false };
  changeHealth(state, def.health);
  dropItem(state, itemId);
  return { ok: true };
}

// ---- Combos ----------------------------------------------------------------
// Candle + Oil/Gasoline: kill every zombie on the tile, no damage. Candle is a
// reusable enabler; the fuel is one-use.
export function useCandleCombo(state, fuelId) {
  if (!state.items.includes("candle")) return { ok: false, reason: "no-candle" };
  if (!state.items.includes(fuelId) || (fuelId !== "oil" && fuelId !== "gasoline")) {
    return { ok: false, reason: "no-fuel" };
  }
  dropItem(state, fuelId);
  return { ok: true };
}

// Gasoline + Chainsaw: +2 chainsaw uses. One-use gasoline.
export function refuelChainsaw(state) {
  if (!state.items.includes("chainsaw") || !state.items.includes("gasoline")) {
    return { ok: false };
  }
  dropItem(state, "gasoline");
  state.chainsawFuel += RULES.CHAINSAW_FUEL;
  return { ok: true };
}

// ---- Fleeing ---------------------------------------------------------------
// Leave into an already-explored tile instead of fighting. -1 Health, or none
// if you throw Oil (one use). No card is drawn for the tile fled into (the
// caller handles the move). Board enforces adjacency.
export function flee(state, { useOil = false } = {}) {
  if (useOil && state.items.includes("oil")) {
    dropItem(state, "oil");
  } else {
    changeHealth(state, -RULES.RUN_AWAY_DAMAGE);
  }
  return state;
}

// ---- Cowering --------------------------------------------------------------
// After a completed turn: +3 Health, discard the top card unresolved. Once per
// turn (house rule). The discard spends clock like any draw.
export function cower(state) {
  if (state.status !== "playing") return { ok: false, reason: "not-playing" };
  if (HOUSE_RULES.COWER_ONCE_PER_TURN && state.coweredThisTurn) {
    return { ok: false, reason: "once-per-turn" };
  }
  const discarded = drawCard(state);
  if (state.status === "lost") return { ok: true, discarded, lost: true };
  changeHealth(state, RULES.COWER_HEAL);
  state.coweredThisTurn = true;
  return { ok: true, discarded };
}

// ---- Totem / win -----------------------------------------------------------
export function gainTotem(state) {
  state.totem = true;
  return state;
}

export function buryTotem(state) {
  if (state.totem && state.status === "playing") state.status = "won";
  return state;
}

// ---- Turn boundary ---------------------------------------------------------
export function beginTurn(state) {
  state.coweredThisTurn = false;
  return state;
}

// ---- Card resolution -------------------------------------------------------
// Resolve a drawn card's outcome for the current hour. Returns a descriptor.
// ITEM: optionally draws the NEXT card and takes the item printed on it
// (choices.takeItem, default true; choices.drop to make room if full).
// ZOMBIES: auto-fights (use flee()/useCandleCombo() beforehand for alternatives).
export function resolveCard(state, cardId, choices = {}) {
  const card = state.cardsById[cardId];
  const outcome = card[bandKey(state)];

  if (outcome.t === "EVENT") {
    changeHealth(state, outcome.hp || 0);
    return { type: "EVENT", hp: outcome.hp || 0 };
  }

  if (outcome.t === "ZOMBIES") {
    const res = resolveCombat(state, outcome.n, choices);
    return { type: "ZOMBIES", n: outcome.n, ...res };
  }

  // ITEM
  if (choices.takeItem === false) return { type: "ITEM", taken: null };
  const nextId = drawCard(state); // spends clock; may advance the hour or lose
  if (nextId == null) return { type: "ITEM", taken: null, lost: true };
  const itemId = state.cardsById[nextId].item;
  const pick = pickUpItem(state, itemId, choices.drop);
  return { type: "ITEM", taken: itemId, pickedUp: pick.ok, drewCard: nextId };
}
