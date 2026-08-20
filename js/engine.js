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
    // A stream of its own for the phantoms (#71). Split from the same seed so a
    // shared run hears the same things in the same places — and kept separate
    // because drawing a single number from `rng` for a sound effect would
    // reshuffle every deck after it and desync every shared seed in existence.
    phantomRng: makeRng((seed ^ 0x9e3779b9) >>> 0),
    lastPhantom: false,
    // A third stream, for deciding when to withhold the scare's picture (#79).
    // Its own rather than shared with the phantoms: two presentation dice that
    // shift each other are impossible to reason about later, and a stream costs
    // nothing.
    scareRng: makeRng((seed ^ 0x85ebca6b) >>> 0),
    scaresSeen: 0,
    // A fourth, for the candle nearly going out (#88). Same argument as the
    // third: presentation dice that shift each other cannot be reasoned about,
    // and a stream is four bytes.
    gutterRng: makeRng((seed ^ 0xc2b2ae35) >>> 0),
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
    foughtThisHour: 0, // risen put down since the hour turned; feeds dread()
    healthCap: opts.healthCap ?? RULES.HEALTH_CAP,
    deck: [],
    burned: [],
  };

  startHour(state); // build + shuffle deck, burn 2
  return state;
}

// (Re)build the full 9-card deck, shuffle, burn 2. Used at setup and each hour.
function startHour(state) {
  state.foughtThisHour = 0;
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

// Display-only. The clock in the rules *is* the deck: seven resolvable draws
// stand for an hour, so every card spent — room card, second card, item search,
// and yes, cowering — moves the hand roughly 8.6 minutes. Nothing has to report
// its own time cost, because it all funnels through drawCard.
//
// Pure function of state, no storage, no rng: a shared seed replays the same
// clock to the minute.
export function clockTime(state) {
  const perHour = RULES.DEV_DECK_SIZE - RULES.SETUP_BURN; // 7
  const left = Math.max(0, Math.min(perHour, state.deck ? state.deck.length : 0));
  const draws = perHour - left;
  const minutes = Math.round((draws / perHour) * 60);

  // An empty deck reads 60, and that is deliberate — NOT an off-by-one. The
  // hour has not turned (nothing has been drawn against the empty deck yet), so
  // state.hour is still 9 while the hand stands at 10:00. That is exactly the
  // truth of the position: the next card tolls the hour.
  const carry = minutes >= 60 ? 1 : 0;
  const hour24 = state.hour + carry;
  const mins = minutes % 60;

  return {
    hour: state.hour, // the band the cards are still being read at
    hour24, // what the face shows, which may be an hour ahead
    minutes: mins,
    draws, // cards spent this hour, 0..7
    left, // cards still standing between the player and the next hour
    perHour,
    atTheTurn: carry === 1,
    // 0..1 through the hour, for a minute hand.
    fraction: minutes / 60,
    // 0..3 hours since nine, for anything that fades across the whole night.
    elapsed: state.hour - RULES.START_HOUR + minutes / 60,
    span: RULES.FINAL_HOUR + 1 - RULES.START_HOUR,
    label: `${((hour24 + 11) % 12) + 1}:${String(mins).padStart(2, "0")}`,
  };
}

// ---- The tension director ---------------------------------------------------
// One number for how frightened the game should be right now, so that a 9 PM
// stroll and a 1 HP crawl at 11:40 do not play at the same pressure. Everything
// atmospheric reads this instead of inventing its own idea of intensity.
//
// Pure function of state: no rng, no storage, no clock. A seeded replay is as
// afraid at the same moments, and it can be tested headless like the rest of
// the engine.
//
// The weights are a judgement, not a measurement, and they are written out
// rather than folded together so they can be argued with:
export const DREAD_WEIGHTS = {
  night: 0.34, // how late it is — the one pressure that never goes down
  hurt: 0.32, // how close to dead
  fought: 0.16, // how violent this hour has already been
  running: 0.1, // how little deck is left before the hour turns
  carrying: 0.08, // the relic makes you worth following
};

// Risen in an hour before that term saturates. Seven draws an hour and packs
// of three to six, so a dozen is already a bad hour.
const FOUGHT_FULL = 12;

export function dread(state) {
  if (!state) return 0;
  const c = clockTime(state);

  const night = c.span > 0 ? c.elapsed / c.span : 0;
  // Health drives this hardest at the bottom of the range, which is where it
  // actually feels different: 6 to 5 is nothing, 2 to 1 is everything. Note it
  // squares the damage taken, not the health left — squaring the health gives
  // the opposite curve, steep at the top and flat where the fear is.
  const hp = Math.min(1, Math.max(0, state.health) / RULES.START_HEALTH);
  const hurt = (1 - hp) ** 2;
  const fought = Math.min(1, (state.foughtThisHour || 0) / FOUGHT_FULL);
  const running = c.perHour > 0 ? 1 - c.left / c.perHour : 0;
  const carrying = state.totem ? 1 : 0;

  const w = DREAD_WEIGHTS;
  const score =
    night * w.night +
    hurt * w.hurt +
    fought * w.fought +
    running * w.running +
    carrying * w.carrying;

  return Math.min(1, Math.max(0, score));
}

// ---- The unseen -------------------------------------------------------------
// Every cue in this game is honest — a sound means a thing happened. That is
// what makes an alarm cheap: you can trust it completely. A few phantoms buy
// the honest cues their weight back.
//
// Rolled from the phantom stream, never the game's, and consulted at a fixed
// point in the turn rather than on a timer — a wall clock is not deterministic
// and a shared seed has to hear the same house.
//
// Tuned for roughly one per run: eligible only in the last two hours, scaled by
// dread, and never twice running.
const PHANTOM_CHANCE = 0.18;
// Spelled out here rather than imported: board.js imports this module, so
// reaching the other way would close the circle.
const PHANTOM_DIRS = ["N", "E", "S", "W"];

export function rollPhantom(state, fear = 0) {
  if (!state || !state.phantomRng) return null;
  if (state.status !== "playing") return null;
  // The first hour is spent earning the trust this later spends.
  if (state.hour <= RULES.START_HOUR) return null;
  // Never twice running: one quiet turn is owed after every phantom, and it
  // costs no draw so the stream stays aligned.
  if (state.lastPhantom) {
    state.lastPhantom = false;
    return null;
  }
  if (state.phantomRng() > PHANTOM_CHANCE * Math.min(1, Math.max(0, fear))) return null;

  state.lastPhantom = true;
  return PHANTOM_DIRS[Math.floor(state.phantomRng() * PHANTOM_DIRS.length) % PHANTOM_DIRS.length];
}

// ---- The light you cannot trust ---------------------------------------------
// The candle nearly goes out. Not a warning about anything — that is the point:
// every other cue in this game means something, so the one that means nothing
// is the one that makes you distrust the room rather than the game.
//
// Scaled by dread and only after the first hour, like the phantoms, for the
// same reason: the early game is spent building the trust the late game spends.
// Rolled at the same fixed point in the turn, from its own stream.
const GUTTER_CHANCE = 0.22;

export function rollGutter(state, fear = 0) {
  if (!state || !state.gutterRng) return false;
  if (state.status !== "playing") return false;
  if (state.hour <= RULES.START_HOUR) return false;
  return state.gutterRng() < GUTTER_CHANCE * Math.min(1, Math.max(0, fear));
}

// The scare fires identically every fight, and the third one lands softer than
// the first. So sometimes the picture simply does not come — the sting and the
// silence happen, the window arrives, and nothing was there.
//
// Only once the pattern exists to break: the first two are always shown,
// because withholding something the player has not learned to expect is not a
// subversion, it is just a missing effect.
const SILENT_SCARE_CHANCE = 0.22;

export function rollSilentScare(state) {
  if (!state || !state.scareRng) return false;
  state.scaresSeen = (state.scaresSeen || 0) + 1;
  if (state.scaresSeen <= 2) return false;
  return state.scareRng() < SILENT_SCARE_CHANCE;
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
  state.foughtThisHour += zombies;
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
// The cower allowance is really per *window*, not per turn. An ordinary turn has
// one window, after the room's card is resolved. The Reliquary and Family Plot
// have a second one in the gap between their two cards, which the designer ruled
// "behaves like an ordinary fresh turn" — so it gets its own allowance rather
// than competing with the end-of-turn one.
export function openCowerWindow(state) {
  state.coweredThisTurn = false;
  return state;
}

export function beginTurn(state) {
  return openCowerWindow(state);
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
