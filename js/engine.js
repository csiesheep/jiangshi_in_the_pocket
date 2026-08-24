// Core game engine — pure rules over a state object, no DOM, no fetch.
// Board-dependent turn orchestration (movement, tile placement, dead ends)
// lives in board.js / app.js; this module owns the clock, combat, items,
// health and win/lose — everything testable headless.
//
// TILE-EXPLORING BUILD. The event pool, the item pool and the King are still
// open in the design record, so the card system that used to drive the turn is
// gone: no deck, no draws, no events, no fights, no searches. What is left is
// the map and the clock.
//
// Combat, items and health are kept and exported, untouched and unreferenced by
// the turn loop. They are inert rather than deleted because the pools they
// serve are coming back once they are designed, and a working implementation is
// cheaper to re-wire than to rewrite.
//
// Data (cards + items) is passed in to newGame() rather than imported, so the
// engine has no I/O and tests can inject fixtures.

export const RULES = {
  // ---- clock ---------------------------------------------------------------
  // Spec §1 spells these TURNS_TOTAL / TURN_MINUTES / TURNS_PER_HOUR. The values
  // are identical; the names are left as they are because render.js and the
  // clock suite read them, and reshuffling three identifiers across three files
  // buys nothing a reader of either document would notice.
  START_HOUR: 21, // 9 PM; bands are 21 / 22 / 23
  FINAL_HOUR: 23,
  TOTAL_TURNS: 30,
  TURNS_PER_BAND: 10,
  MINUTES_PER_TURN: 6,

  // ---- player --------------------------------------------------------------
  START_HEALTH: 10,
  // A hard cap now, not the old optional one. Nothing exceeds it: the night is
  // 27-30 event draws against these 10 points, and the cap is what keeps that
  // finite rather than a race between healing and damage.
  HEALTH_CAP: 10,
  // Bare-handed is ZERO, and weapons are absolute rather than bonuses. The
  // source game started you at 1 and added the weapon on top; here the sword IS
  // your attack, so an unarmed caretaker takes a pack of four full in the face.
  START_ATTACK: 0,
  MAX_ITEMS: 6, // the tablet is exempt
  // You start with three rice, which is three of the six slots. The pack begins
  // full of consumables and converts, rice by rice, into equipment.
  START_ITEMS: { "sticky-rice": 3 },

  // ---- cowering ------------------------------------------------------------
  // A charge SKIPS THE EVENT and heals nothing. Its whole value is being the
  // only event-free turn in the game, which makes a charge worth the expected
  // damage of whatever you did not draw — so charges are worth hoarding for the
  // eleven o'clock band, and no rule has to say so.
  COWER_CHARGES: 3,

  // ---- combat --------------------------------------------------------------
  MAX_COMBAT_DAMAGE: 4,
  MIN_COMBAT_DAMAGE: 0,
  RUN_AWAY_DAMAGE: 1, // generic flee, to an adjacent explored tile

  // ---- poison --------------------------------------------------------------
  POISON_PER_TURN: 1, // ticks at the START of a turn; does not stack
};

// House rules, baked in as the defaults. Only the one that still has anything
// to govern: the other two were about cowering and the two-card rites, and both
// of those went with the card system.
export const HOUSE_RULES = {
  FLEE_ADJACENT_ONLY: true, // enforced by board.js
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
    // And a fifth, for the one time someone is standing there (#89). The issue
    // asked for the phantom stream; this file's rule wins, and the rule is that
    // no two presentation dice may move each other. Sharing would mean a run
    // that saw the figure got different phantoms for the rest of the night.
    standingRng: makeRng((seed ^ 0x27d4eb2f) >>> 0),
    stoodOnce: false,
    seed,
    itemsById,
    health: RULES.START_HEALTH,
    // The clock, in two forms. `turn` is the truth — 1..30, and 31 the moment
    // the night is over. `hour` is derived from it and kept in step, because
    // everything downstream (the bands, the epilogue, the phantoms) already
    // speaks in hours and has no business doing the division itself.
    turn: 1,
    hour: RULES.START_HOUR,
    // The pack is {id: count}, not a list. 硃砂 is the only thing in the game
    // that creates duplicates by rule, and a count is the honest shape for that
    // — see slotsUsed for why a count is not the same as a slot.
    items: { ...RULES.START_ITEMS },
    // Three charges, and the one the Incense Hall gives back. Tracked here
    // rather than on the tile because it is the player who is out of nerve.
    cowerCharges: RULES.COWER_CHARGES,
    cowerRestored: false,
    // 中毒. A flag, not a counter: it does not stack, and only rice clears it.
    poisoned: false,
    totem: false, // the tablet — slotless, never counted against MAX_ITEMS
    status: "playing", // playing | won | lost
    lossReason: null,
    foughtThisHour: 0, // risen put down since the hour turned; feeds dread()
    relief: 0, // 1 the moment something is survived, gone two turns later
    healthCap: opts.healthCap ?? RULES.HEALTH_CAP,
  };

  return state;
}

// ---- Clock -----------------------------------------------------------------
// The turn is the clock. Thirty turns of six minutes, in three bands of ten:
// turn 1 begins at 9:00 PM and turn 30 ends at midnight. There is no deck to
// run down, so nothing has to report its own time cost — taking a turn IS the
// cost, and everything that happens inside one is free.

// Which hour band a turn falls in. Capped at the last band so turn 31 — the
// night being over — still reads as eleven rather than running off the end.
function hourForTurn(turn) {
  const band = Math.floor((Math.max(1, turn) - 1) / RULES.TURNS_PER_BAND);
  return Math.min(RULES.FINAL_HOUR, RULES.START_HOUR + band);
}

// Map the band to the key the (undesigned) event pool will be read at.
// Kept because the bands are settled even though their contents are not.
export function bandKey(state) {
  return String(state.hour - 12);
}

// Put the clock at a given turn, band and all. `turn` is the truth and `hour`
// is derived from it, so assigning either one alone is the one reliable way to
// get them out of step — a state with hour 23 and turn 4 reads as eleven
// o'clock to the bands and as 9:18 to the face. Everything that moves the clock
// without taking a turn (tests today, save/restore later) goes through here.
export function setTurn(state, turn) {
  state.turn = Math.min(Math.max(1, turn), RULES.TOTAL_TURNS + 1);
  state.hour = hourForTurn(state.turn);
  return state;
}

// Spend a turn. Turn 31 is not a turn: it is midnight, and the night is over.
export function advanceTurn(state) {
  if (state.status !== "playing") return state;
  state.turn += 1;
  if (state.turn > RULES.TOTAL_TURNS) {
    state.hour = RULES.FINAL_HOUR;
    state.status = "lost";
    state.lossReason = "midnight";
    return state;
  }
  const hour = hourForTurn(state.turn);
  if (hour !== state.hour) {
    state.hour = hour;
    state.foughtThisHour = 0;
  }
  return state;
}

// Display-only, and a pure function of the turn number: no storage, no rng, so
// a shared seed replays the same clock to the minute.
export function clockTime(state) {
  const perBand = RULES.TURNS_PER_BAND;
  const turn = Math.min(Math.max(1, state.turn || 1), RULES.TOTAL_TURNS + 1);
  const taken = turn - 1; // turns finished
  const spent = taken * RULES.MINUTES_PER_TURN; // minutes since nine, 0..180
  const hour24 = RULES.START_HOUR + Math.floor(spent / 60);
  const mins = spent % 60;
  const inBand = taken % perBand; // turns spent in this band, 0..9

  return {
    hour: state.hour, // the band being read at
    hour24, // what the face shows; 24 at midnight
    minutes: mins,
    turn,
    turnsTotal: RULES.TOTAL_TURNS,
    // Named for the pip row, which counts what stands between you and the next
    // hour. That used to be cards and is now turns; the shape is the same.
    draws: inBand,
    left: turn > RULES.TOTAL_TURNS ? 0 : perBand - inBand,
    perHour: perBand,
    atTheTurn: mins === 0 && taken > 0,
    // 0..1 through the hour, for a minute hand.
    fraction: mins / 60,
    // 0..3 hours since nine, for anything that fades across the whole night.
    elapsed: spent / 60,
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

  // Relief. Everything above ratchets up inside an hour and never comes down,
  // and tension that only rises stops being tension — there has to be a trough
  // for the next peak to rise out of. So surviving something buys one turn of
  // the room letting go.
  //
  // It is subtracted from the headroom above the hour's own contribution, never
  // from the total. That is what stops it undoing the clock: the night term is
  // untouchable, so relief at eleven still leaves you at eleven, and the same
  // relief at nine — where the floor is nearly zero — empties the dial almost
  // completely. Which is right. Surviving a fight at nine o'clock IS a relief.
  const floor = night * w.night;
  const ease = Math.min(1, Math.max(0, state.relief || 0));
  const eased = score - ease * RELIEF_DEPTH * Math.max(0, score - floor);

  return Math.min(1, Math.max(0, eased));
}

// How much of the headroom a full measure of relief takes away. Not all of it:
// you survived a fight, you are not safe.
const RELIEF_DEPTH = 0.6;

// Something was survived. Called on the far side of a fight and at the end of a
// turn spent in a room that heals — the two moments the game says "not this
// time" — and decayed by beginTurn, so it lasts about one turn either way.
export function grantRelief(state, strength = 1) {
  if (!state) return 0;
  state.relief = Math.min(1, Math.max(state.relief || 0, strength));
  return state.relief;
}

// Decayed rather than cleared, so the turn after a fight is the way back up
// rather than a cliff: full on the turn it happens, about a third on the next,
// and gone by the one after that.
export function decayRelief(state) {
  if (!state) return 0;
  const next = (state.relief || 0) * 0.3;
  state.relief = next < 0.1 ? 0 : next;
  return state.relief;
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

// ---- Someone standing ---------------------------------------------------------
// The escalation of the phantom, and the rarest thing in the game: a figure
// that does not move. A shadow crossing a doorway is something happening; a
// figure standing in one is something waiting, which is worse and cannot be
// used twice.
//
// So: once per run, at most, and only in the last hour of a bad one. The player
// who asks "did you see that?" once is the whole goal. Twice and it is a sprite.
const STANDING_CHANCE = 0.16;
const STANDING_DREAD = 0.55;

export function rollStanding(state, fear = 0) {
  if (!state || !state.standingRng) return false;
  if (state.status !== "playing") return false;
  if (state.stoodOnce) return false;
  // Late, and going badly. Not merely late: a comfortable run at 11 PM has not
  // earned this, and spending the once-per-run budget there wastes it.
  if (state.hour < RULES.FINAL_HOUR) return false;
  if (fear < STANDING_DREAD) return false;
  if (state.standingRng() >= STANDING_CHANCE) return false;
  state.stoodOnce = true;
  return true;
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
// Every route into the health pool: events, medicine, the HEAL_1 tiles, poison.
// Respects the cap in both directions and triggers a loss at 0.
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

// ---- 中毒 --------------------------------------------------------------------
// A flag rather than a counter: poison does not stack, so a second dose is
// nothing at all. Only 糯米 lifts it — the charm does not, because poison is not
// damage and the charm only ever reduces a blow.
export function poison(state) {
  state.poisoned = true;
  return state;
}

// Step 1 of the turn, and it is first for a reason: a turn spent eating rice
// still pays that turn's tick. Putting the tick before the action is what makes
// that true without a special case anywhere.
export function poisonTick(state) {
  if (state.status !== "playing" || !state.poisoned) return 0;
  changeHealth(state, -RULES.POISON_PER_TURN);
  return RULES.POISON_PER_TURN;
}

// ---- The pack ---------------------------------------------------------------
// Inventory is {id: count}. The count and the SLOT are different quantities and
// that is the whole subtlety: 硃砂 duplicates a talisman, so a talisman is held
// as a stack, and a stack of any size is one slot. Everything else costs a slot
// per unit — the three 糯米 you start with really are three of your six.
//
// Scoped deliberately to cat "magic". The rule exists because of 硃砂, the only
// thing in the game that creates duplicates by rule, and it has no business
// leaking to swords or rice.
export function slotsUsed(state) {
  let n = 0;
  for (const [id, count] of Object.entries(state.items)) {
    if (count <= 0) continue;
    const def = state.itemsById[id];
    n += def && def.cat === "magic" ? 1 : count;
  }
  return n;
}

export function freeSlots(state) {
  return Math.max(0, RULES.MAX_ITEMS - slotsUsed(state));
}

// What one more of this id would cost. Zero for a talisman already held — it
// joins the stack — and one for anything else.
export function slotCost(state, itemId) {
  const def = state.itemsById[itemId];
  if (def && def.cat === "magic" && (state.items[itemId] || 0) > 0) return 0;
  return 1;
}

export function held(state, itemId) {
  return (state.items[itemId] || 0) > 0;
}

export function heldCount(state, itemId) {
  return state.items[itemId] || 0;
}

// Every id in the pack, once each. For anything walking the pack without
// knowing its shape — the HUD, the epilogue, the weapon picker.
export function heldIds(state) {
  return Object.keys(state.items).filter((id) => state.items[id] > 0);
}

export function hasItemSpace(state, itemId = null) {
  const cost = itemId ? slotCost(state, itemId) : 1;
  return slotsUsed(state) + cost <= RULES.MAX_ITEMS;
}

// Take one. `dropId` makes room when the pack is full. The tablet is not an
// item and never comes through here — see gainTotem().
export function pickUpItem(state, itemId, dropId = null) {
  const def = state.itemsById[itemId];
  if (!def) return { ok: false, reason: "unknown-item" };
  // Uniques are one to a customer. A search that turns one up while you hold it
  // finds nothing, per the search rules; this is that rule stated where the
  // pack is, so it holds however the item arrives.
  if (def.unique && held(state, itemId)) return { ok: false, reason: "duplicate" };
  if (!hasItemSpace(state, itemId)) {
    if (!dropId) return { ok: false, reason: "full" };
    dropItem(state, dropId);
    if (!hasItemSpace(state, itemId)) return { ok: false, reason: "full" };
  }
  state.items[itemId] = (state.items[itemId] || 0) + 1;
  return { ok: true };
}

// Put one down. Drops the id entirely when the last of it goes, so a zero count
// never lingers to confuse slotsUsed or heldIds.
export function dropItem(state, itemId, n = 1) {
  const have = state.items[itemId] || 0;
  if (have <= 0) return state;
  const left = have - n;
  if (left > 0) state.items[itemId] = left;
  else delete state.items[itemId];
  return state;
}

// Eat it. 糯米 both heals and lifts poison. 金丹's coin-flip is rolled from the
// search stream and belongs to the search issue, so it is not handled here.
export function useMedicine(state, itemId) {
  const def = state.itemsById[itemId];
  if (!def || !held(state, itemId)) return { ok: false, reason: "not-held" };
  if (def.heal) changeHealth(state, def.heal);
  if (def.cures === "POISON") state.poisoned = false;
  if (def.consumed) dropItem(state, itemId);
  return { ok: true, healed: def.heal || 0, cured: def.cures === "POISON" };
}

// ---- Cowering ---------------------------------------------------------------
// Spend a charge to skip the event. It heals nothing — that is the point, and
// the reason a charge is worth more at eleven than at nine: what it buys is the
// expected damage of a draw you did not make.
export function cower(state) {
  if (state.status !== "playing") return { ok: false, reason: "not-playing" };
  if (state.cowerCharges <= 0) return { ok: false, reason: "no-charges" };
  state.cowerCharges -= 1;
  return { ok: true, charges: state.cowerCharges };
}

// 香堂, once per run. The gate lives on the player rather than the tile because
// what is spent is the coil: you only burn it once, however many times you walk
// back through the room.
export function restoreCowerCharge(state) {
  if (state.cowerRestored) return { ok: false, reason: "spent" };
  state.cowerRestored = true;
  state.cowerCharges += 1;
  return { ok: true, charges: state.cowerCharges };
}

// ---- Combat ----------------------------------------------------------------
// Damage is arithmetic, clamped to [0, 4].
export function combatDamage(n, attack) {
  const raw = n - attack;
  return Math.max(RULES.MIN_COMBAT_DAMAGE, Math.min(RULES.MAX_COMBAT_DAMAGE, raw));
}

export function usableWeapons(state) {
  return heldIds(state).filter((id) => {
    const d = state.itemsById[id];
    return d && d.cat === "weapon";
  });
}

// The sword that would swing: an explicit preference if held, else the best.
// Only one sword ever counts — they are never summed.
export function chooseWeapon(state, preferId = null) {
  const usable = usableWeapons(state);
  if (preferId && usable.includes(preferId)) return preferId;
  let best = null;
  for (const id of usable) {
    if (!best || state.itemsById[id].attack > state.itemsById[best].attack) best = id;
  }
  return best;
}

// Your attack right now. The sword IS the number — bare-handed is START_ATTACK,
// which is zero. Adding a talisman on top is the additive formula and belongs
// to the combat issue; this is the sword half only.
export function effectiveAttack(state) {
  const w = chooseWeapon(state);
  return w ? state.itemsById[w].attack : RULES.START_ATTACK;
}

export function resolveCombat(state, n, choices = {}) {
  const weaponId = chooseWeapon(state, choices.weapon);
  const attack = weaponId ? state.itemsById[weaponId].attack : RULES.START_ATTACK;
  const damage = combatDamage(n, attack);
  state.foughtThisHour += n;
  state.health -= damage;
  if (state.health <= 0) {
    state.health = 0;
    state.status = "lost";
    state.lossReason = "combat";
  } else {
    // Survived it. The set-piece is over, and the room is allowed to breathe
    // out before the next one — a fight that ends with the dial still climbing
    // has nowhere left to climb to.
    grantRelief(state);
  }
  return { weaponId, attack, damage };
}

// ---- Fleeing ---------------------------------------------------------------
// Leave into an already-explored tile instead of fighting: a flat -1. The oil
// that used to buy a clean escape is not in this game; 黑狗血 escapes a fight
// now, and it belongs to the combat issue.
export function flee(state) {
  changeHealth(state, -RULES.RUN_AWAY_DAMAGE);
  return state;
}

// ---- Tablet / win -----------------------------------------------------------
export function gainTotem(state) {
  state.totem = true;
  return state;
}

export function buryTotem(state) {
  if (state.totem && state.status === "playing") state.status = "won";
  return state;
}

// ---- Turn boundary ---------------------------------------------------------
// Step 1 of a turn, in order: the poison tick comes before the player is given
// an action, which is what makes "curing still pays this turn's tick" fall out
// of the sequence rather than needing a rule of its own.
export function beginTurn(state) {
  decayRelief(state);
  poisonTick(state);
  return state;
}
