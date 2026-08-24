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

  // 破牆. The dead-end breach scales with the band, so the same corner is
  // three of them at nine o'clock and five at eleven.
  BREACH_COUNT: { "9": 3, "10": 4, "11": 5 },
  // 護身符 takes this much off a blow, AFTER the clamp, and only in combat.
  CHARM_REDUCTION: 1,

  // ---- poison --------------------------------------------------------------
  POISON_PER_TURN: 1, // ticks at the START of a turn; does not stack

  // ---- the King ------------------------------------------------------------
  // What your attack must reach at midnight. Carrying the 神主牌 lowers it by
  // one, which is the tablet's second job and the reason a burial run that
  // fails still leaves you better off than one that never went looking.
  KING_THRESHOLD: 12,
  KING_THRESHOLD_WITH_TABLET: 11,
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
    // A sixth, and the first that is not presentation: every search roll and
    // the 金丹 coin-flip come from here. Its own stream for the same reason as
    // the rest — a shared seed has to find the same things in the same rooms
    // whatever else the night did, and sharing the game's rng would let an
    // unrelated draw shift every find after it.
    searchRng: makeRng((seed ^ 0x1b873593) >>> 0),
    // A seventh, for the event draw. Separate from the search stream as well as
    // from the game's: a night where you rummaged twice more must still meet
    // the same events, or two players comparing a seed are comparing nothing.
    eventRng: makeRng((seed ^ 0xcc9e2d51) >>> 0),
    seed,
    itemsById,
    // The §4 tables, by name. Kept on state rather than reached for at call
    // time so the engine still has no I/O and a test can inject its own.
    searchTables: data.search || {},
    eventTables: data.events || {},
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
    // Which swords have a 真火符 burned into them. Permanent, one per sword,
    // and kept beside the pack rather than inside it because a count of swords
    // is not the same question as which one is on fire.
    buffed: {},
    // Set by fleeing or by 黑狗血, cleared at the top of the next turn. It
    // suppresses this turn's HEAL_1 and cancels the breach — you are not in the
    // dead end any more.
    fled: false,
    tablet: false, // 神主牌 — slotless, never counted against MAX_ITEMS
    // Which of the five endings this was. Written only by finish().
    outcome: null,
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
  const carrying = state.tablet ? 1 : 0;

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
    state.lossReason = state.lossReason || "health";
    finish(state, OUTCOMES.LOSS_HEALTH);
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
// item and never comes through here — the tablet is taken by completeRite().
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

  let healed = def.heal || 0;
  // 金丹 is a coin-flip, and it is rolled from the SEARCH stream rather than
  // the game's. Half of these were made by someone who knew what they were
  // doing; a shared seed has to agree on which half you got, and the search
  // stream is the one nothing else disturbs.
  if (def.gamble) {
    const face = weightedPick(def.gamble, state.searchRng);
    healed = face ? face.hp : 0;
  }
  if (healed) changeHealth(state, healed);
  if (def.cures === "POISON") state.poisoned = false;
  if (def.consumed) dropItem(state, itemId);
  return { ok: true, healed, cured: def.cures === "POISON" };
}

// ---- Searching --------------------------------------------------------------
// A search is free, costs no turn, and happens after the room's event — so you
// rummage a room that has already shown you what is in it.
//
// Every roll comes from state.searchRng and nothing else touches that stream.
// That is the whole reason it exists: a shared seed has to find the same things
// in the same rooms whatever else the night did, and a stream shared with the
// game's own rng would be shifted by every unrelated draw before it.

// One draw, one result. Weights are the `p` column and are asserted to sum to
// 100 in the data tests, but this does not rely on that — it normalises to the
// total it is given, so a table that drifts still picks proportionally rather
// than silently favouring the last row.
export function weightedPick(table, rng) {
  const total = table.reduce((n, e) => n + e.p, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const entry of table) {
    roll -= entry.p;
    if (roll < 0) return entry;
  }
  return table[table.length - 1]; // float dust at the very top of the range
}

// Would a search of this table find nothing, and how often? Nothing is two
// different outcomes wearing one face: the table's own `null`, and a unique you
// are already carrying. Exported because it is the honest way to state the
// escalation — a weapon search misses 10% of the time with no swords and 85%
// with three, and no rule anywhere says so; it falls out of the table.
export function missChance(state, tableName) {
  const table = (state.searchTables || {})[tableName];
  if (!table) return 100;
  const total = table.reduce((n, e) => n + e.p, 0) || 1;
  let miss = 0;
  for (const e of table) {
    if (e.id === null) miss += e.p;
    else {
      const def = state.itemsById[e.id];
      if (def && def.unique && held(state, e.id)) miss += e.p;
    }
  }
  return (miss / total) * 100;
}

// Roll one search. Consumes EXACTLY ONE draw from the search stream whatever
// the outcome, which is what keeps a shared seed in step: a run that finds
// nothing and a run that finds a sword have spent the same randomness.
//
// Returns one of:
//   { result: "NOTHING" }                  rolled null, or a unique already held
//   { result: "TOOK", id }                 in the pack
//   { result: "OFFER_DROP", id, cost }     no room; the caller picks what goes
//
// OFFER_DROP is deliberately not resolved here. What to drop is a decision, and
// decisions belong to whoever is talking to the player — finish it by calling
// pickUpItem(state, id, dropId), which is the same door every other pickup uses.
export function search(state, tableName) {
  const table = (state.searchTables || {})[tableName];
  if (!table) return { result: "NOTHING", reason: "no-table" };

  const pick = weightedPick(table, state.searchRng);
  if (!pick || pick.id === null) return { result: "NOTHING" };

  const def = state.itemsById[pick.id];
  if (!def) return { result: "NOTHING", reason: "unknown-item" };

  // A unique you already carry finds nothing. This is what makes weapon
  // searches self-limiting rather than a treadmill: every sword you own raises
  // the chance the next search hands you back the room you already looted.
  if (def.unique && held(state, pick.id)) return { result: "NOTHING", reason: "duplicate" };

  if (!hasItemSpace(state, pick.id)) {
    return { result: "OFFER_DROP", id: pick.id, cost: slotCost(state, pick.id) };
  }

  pickUpItem(state, pick.id);
  return { result: "TOOK", id: pick.id };
}

// 硃砂. Ground red mineral: paint a charm twice and it works twice. It adds
// `n` more of a talisman you ALREADY HOLD — it copies what is in the pack, so
// it can never conjure one you have not found, and it can never reach a sword.
//
// Costs no extra slot, and that is not a special case here: only cat "magic"
// stacks, and a stack of any size is one slot, so a deeper stack is free by the
// rule that already exists. The sword cap is untouched for the same reason —
// one 真火符 per blade is a fact about the SWORD, and this only ever multiplies
// pack contents.
export function useCinnabar(state, targetId) {
  if (!held(state, "cinnabar")) return { ok: false, reason: "no-cinnabar" };
  const target = state.itemsById[targetId];
  if (!target || target.cat !== "magic") return { ok: false, reason: "not-a-talisman" };
  if (targetId === "cinnabar") return { ok: false, reason: "not-itself" };
  // "A talisman you actually hold" — zero of something is not something.
  if (!held(state, targetId)) return { ok: false, reason: "not-held" };

  const def = state.itemsById["cinnabar"];
  const n = def.n || 2;
  const before = slotsUsed(state);
  dropItem(state, "cinnabar");
  state.items[targetId] = (state.items[targetId] || 0) + n;
  return { ok: true, id: targetId, added: n, count: heldCount(state, targetId),
           slotsBefore: before, slotsAfter: slotsUsed(state) };
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

// ---- Attack -----------------------------------------------------------------
// THE CENTRAL DEPARTURE FROM THE SOURCE: a sword and a talisman ADD. The source
// allowed one weapon and one weapon only, so its whole arms race was "find a
// bigger stick". Here the two halves multiply the decision instead — what you
// swing, and what you burn while swinging it.
//
//     attack = (bestSword × 2 if 攝魂幡) + talisman
//
// The banner doubles the SWORD HALF ONLY. That is not an implementation detail
// to be tidied away: it is what stops 攝魂幡 + 五雷符 being the single correct
// endgame every time, and the worked examples in spec §6 exist to pin it.

// A sword's attack including any 真火符 baked into it. The buff is permanent
// and stored on the sword rather than recomputed, so a talisman spent on a
// blade you later drop is a talisman spent.
export function swordAttack(state, id) {
  const def = state.itemsById[id];
  if (!def || def.cat !== "weapon") return 0;
  return (def.attack || 0) + (state.buffed[id] ? 1 : 0);
}

// The one sword that counts — the best held, never summed. Ties go to the first
// found, which cannot matter: two swords of equal attack are equal.
export function bestSword(state) {
  let best = null;
  let bestN = -1;
  for (const id of heldIds(state)) {
    const def = state.itemsById[id];
    if (!def || def.cat !== "weapon") continue;
    const n = swordAttack(state, id);
    if (n > bestN) { bestN = n; best = id; }
  }
  return best;
}

// Burn a 真火符 into a sword. Permanent, and ONE PER SWORD — so the ceiling is
// 七星劍 3 + 1 = 4, and 硃砂 cannot be used to pump a blade past it.
export function buffSword(state, swordId) {
  const sword = state.itemsById[swordId];
  if (!sword || sword.cat !== "weapon") return { ok: false, reason: "not-a-sword" };
  if (!held(state, swordId)) return { ok: false, reason: "not-held" };
  if (state.buffed[swordId]) return { ok: false, reason: "already-buffed" };
  if (!held(state, "truefire-talisman")) return { ok: false, reason: "no-talisman" };
  dropItem(state, "truefire-talisman");
  state.buffed[swordId] = true;
  return { ok: true, attack: swordAttack(state, swordId) };
}

// What you would hit for with a given loadout. `use.banner` spends 攝魂幡 and
// `use.talisman` names one to throw; neither is consumed here, because this is
// the question the UI asks four times while the player is deciding.
export function attackWith(state, use = {}) {
  const swordId = use.sword && held(state, use.sword) ? use.sword : bestSword(state);
  let sword = swordId ? swordAttack(state, swordId) : RULES.START_ATTACK;
  if (use.banner) sword *= 2;
  const tal = use.talisman ? state.itemsById[use.talisman] : null;
  return sword + (tal ? tal.attack || 0 : 0);
}

// The HUD number: what you are carrying, with nothing spent. Bare-handed is
// START_ATTACK, which is zero — the sword IS the number, never a bonus on top.
export function effectiveAttack(state) {
  const id = bestSword(state);
  return id ? swordAttack(state, id) : RULES.START_ATTACK;
}

// Kept for the weapon picker in the UI.
export function usableWeapons(state) {
  return heldIds(state).filter((id) => {
    const d = state.itemsById[id];
    return d && d.cat === "weapon";
  });
}

export function chooseWeapon(state, preferId = null) {
  if (preferId && held(state, preferId)) {
    const d = state.itemsById[preferId];
    if (d && d.cat === "weapon") return preferId;
  }
  return bestSword(state);
}

// ---- Damage -----------------------------------------------------------------
// Arithmetic, clamped, and THEN the charm. The order matters: 護身符 takes its
// point off after the clamp, so it is worth a full point against the worst
// packs in the game rather than being swallowed by the ceiling.
//
// 護身符 IS COMBAT-ONLY. It does not soften an HP event, it does not touch
// poison, and it does not pay for fleeing. Its damageReduction is read here and
// nowhere else, which keeps its scope sayable in one line: the things that claw
// at you hit softer, and nothing else changes.
export function combatDamage(n, attack, hasCharm = false) {
  let d = Math.max(RULES.MIN_COMBAT_DAMAGE, Math.min(RULES.MAX_COMBAT_DAMAGE, n - attack));
  if (hasCharm) d = Math.max(0, d - (RULES.CHARM_REDUCTION || 1));
  return d;
}

export function hasCharm(state) {
  return held(state, "protective-charm");
}

// Fight `n` of them. `use` may name a sword, spend the banner, and throw one
// talisman; everything spent is consumed here and not before, so a player who
// backs out of the window has spent nothing.
export function resolveCombat(state, n, use = {}) {
  const swordId = use.sword && held(state, use.sword) ? use.sword : bestSword(state);
  const attack = attackWith(state, { ...use, sword: swordId });

  // 血符 is written in your own blood and costs what it says it costs. Paid on
  // use, before the blow lands — it can kill you, and that is the item.
  const tal = use.talisman ? state.itemsById[use.talisman] : null;
  if (tal && tal.costHp) {
    changeHealth(state, -tal.costHp);
    if (state.status !== "playing") {
      return { attack, damage: 0, spent: [], diedPaying: true };
    }
  }

  const spent = [];
  if (use.banner && held(state, "soul-banner")) { dropItem(state, "soul-banner"); spent.push("soul-banner"); }
  if (tal && tal.consumed && held(state, use.talisman)) { dropItem(state, use.talisman); spent.push(use.talisman); }

  const damage = combatDamage(n, attack, hasCharm(state));
  state.foughtThisHour += n;
  state.health -= damage;
  if (state.health <= 0) {
    state.health = 0;
    state.lossReason = "combat";
    finish(state, OUTCOMES.LOSS_HEALTH);
  } else {
    // Survived it. The set-piece is over, and the room is allowed to breathe
    // out before the next one — a fight that ends with the dial still climbing
    // has nowhere left to climb to.
    grantRelief(state);
  }
  return { weaponId: swordId, attack, damage, spent };
}

// ---- Getting out of a fight --------------------------------------------------
// Two ways, and the blood is strictly better, which is correct — that is what
// the item is for. Neither works against the King.

// 黑狗血: no damage, consumed, barred against the King.
export function escapeFight(state, { vsKing = false } = {}) {
  if (!held(state, "black-dog-blood")) return { ok: false, reason: "not-held" };
  const def = state.itemsById["black-dog-blood"];
  if (vsKing && def.notVsKing) return { ok: false, reason: "not-vs-king" };
  dropItem(state, "black-dog-blood");
  state.fled = true;
  return { ok: true };
}

// Generic flee: one step, through a legal connection, into somewhere already
// known — the board enforces that half. The 1 HP is a PRICE, not a wound, so
// 護身符 does not reduce it, on the same reasoning that keeps it off HP events.
//
// `fled` is what suppresses this turn's HEAL_1 and cancels the breach: you are
// not standing in the dead end any more, so nothing breaks in on you.
export function flee(state) {
  changeHealth(state, -RULES.RUN_AWAY_DAMAGE);
  state.fled = true;
  return state;
}

// ---- Events ------------------------------------------------------------------
// Drawn per band WITH REPLACEMENT — it is a distribution, not a deck, so the
// same event may fire twice in a row and nothing is "used up". Its own stream,
// for the same reason searches have one: a shared seed must meet the same night.
export function drawEvent(state) {
  const table = (state.eventTables || {})[bandKey(state)];
  if (!table) return null;
  return weightedPick(table, state.eventRng);
}

// Apply one. JIANGSHI is handed back rather than resolved: a fight is a decision
// — which sword, whether to burn the banner, whether to run — and decisions
// belong to whoever is talking to the player. Everything else is arithmetic and
// resolves here.
export function resolveEvent(state, ev, choices = {}) {
  if (!ev) return { type: "NOTHING" };
  switch (ev.t) {
    case "NOTHING":
      return { type: "NOTHING" };
    case "HP":
      // No charm here. A cold room is not a claw.
      changeHealth(state, ev.hp);
      return { type: "HP", hp: ev.hp };
    case "POISON":
      poison(state);
      return { type: "POISON" };
    case "JIANGSHI":
      return { type: "FIGHT", n: ev.n };
    case "VILLAGER":
      return resolveVillager(state, ev, choices.giveRice);
    default:
      return { type: "NOTHING", reason: `unknown:${ev.t}` };
  }
}

// Someone is still alive in here, and hurt. Rice buys them; refusing leaves you
// with whatever was chasing them — the band's worst pack.
//
// This is the ONLY source of 護身符 in the game: it is in no search table, so a
// player who never spends rice on a stranger never sees the charm at all.
export function resolveVillager(state, ev, giveRice) {
  if (!giveRice || !held(state, "sticky-rice")) {
    return { type: "FIGHT", n: ev.turnsInto, refused: true };
  }
  // The gift always fits, and it is worth saying why rather than guarding for a
  // case that cannot arise: the rice you just gave away was one slot (only
  // talismans stack, so rice is one slot per unit), and the gift costs one — or
  // zero, if it is a talisman you already hold. Spending the rice is exactly
  // what makes the room for the thanks. An OFFER_DROP branch here would be
  // unreachable code pretending to be careful.
  dropItem(state, "sticky-rice");
  pickUpItem(state, ev.gift);
  return { type: "GIFT", id: ev.gift };
}

// ---- 破牆, the breach ----------------------------------------------------------
// Checked AFTER the room's own event, and only if you are still standing in the
// dead end — which is exactly why fleeing cancels it. Scales with the band, so
// the same corner is three at nine o'clock and five at eleven.
//
// The board owns "is this a dead end"; this owns "and so what". Given both
// facts it answers with a number, and 0 means nothing comes through.
export function breachCount(state) {
  return (RULES.BREACH_COUNT || {})[bandKey(state)] || 0;
}

export function breachAfterEvent(state, { deadEnd = false, fled = false } = {}) {
  if (state.status !== "playing") return 0;
  if (fled || state.fled) return 0; // you left; there is no one here to trap
  if (!deadEnd) return 0;
  return breachCount(state);
}

// ---- How a night ends ---------------------------------------------------------
// Five outcomes and no sixth. There is NO LOSS TO THE CLOCK: reaching midnight
// is not failure, it is the appointment — what happens there decides it.
//
// `status` stays the three-state field everything already reads (playing / won
// / lost / over) and `outcome` is the real answer. Two fields for one fact is
// normally a footgun, so the rule is that only finish() writes either, and it
// writes both together.
export const OUTCOMES = {
  WIN_BURIAL: "WIN_BURIAL", // survived the rite at 亂葬崗 holding the tablet
  WIN_SEAL: "WIN_SEAL", // met the King at or above the threshold
  SURVIVED: "SURVIVED", // stood in running water at midnight; neither win nor loss
  LOSS_HEALTH: "LOSS_HEALTH", // health reached 0 — combat, event, or a poison tick
  LOSS_KING: "LOSS_KING", // met him under the threshold
};

const STATUS_FOR = {
  WIN_BURIAL: "won",
  WIN_SEAL: "won",
  SURVIVED: "over",
  LOSS_HEALTH: "lost",
  LOSS_KING: "lost",
};

export function finish(state, outcome) {
  if (state.outcome) return state; // the first ending is the ending
  state.outcome = outcome;
  state.status = STATUS_FOR[outcome] || "over";
  if (state.status === "lost") state.lossReason = state.lossReason || outcome;
  return state;
}

// ---- The rites ----------------------------------------------------------------
// Both goal rooms are TWO EVENTS IN ONE TURN: the room's own, then one more for
// the rite itself — drawn at the moment you least want it, standing over the
// grave with the tablet in your hands. Neither win is free.
//
// The sequence is deliberately split so the caller can resolve the extra event
// however it resolves any other, including offering the flee that aborts it:
//
//     ev = riteEvent(state)          -> draw the rite's own event
//     ...resolve it like any other...
//     completeRite(state, kind)      -> only now does the rite take
export function riteEvent(state) {
  return drawEvent(state);
}

// Take or bury, AFTER the extra event has been survived. Fleeing that event
// aborts the rite — the source's rule was that the totem was only gained if you
// were still standing there, and it carries over. You may walk back and retry;
// what it costs you is the turn and whatever the next event is.
export function completeRite(state, kind) {
  if (state.status !== "playing") return { ok: false, reason: "not-playing" };
  if (state.fled) return { ok: false, reason: "fled" }; // aborted, may be retried

  if (kind === "TAKE_TABLET") {
    if (state.tablet) return { ok: false, reason: "already-held" };
    state.tablet = true;
    return { ok: true, tablet: true };
  }

  if (kind === "BURY_TABLET") {
    // Standing on the ground without it is not a rite at all — nothing to bury,
    // so no extra event should have been drawn either. riteDraws() is what the
    // caller asks first.
    if (!state.tablet) return { ok: false, reason: "no-tablet" };
    finish(state, OUTCOMES.WIN_BURIAL);
    return { ok: true, outcome: OUTCOMES.WIN_BURIAL };
  }

  return { ok: false, reason: "not-a-rite" };
}

// Does this room have a rite to perform right now? The grave with no tablet in
// your hands does not — and that is the difference between a room that costs
// you an extra event and one that does not.
export function riteDraws(state, goal) {
  if (goal === "TAKE_TABLET") return !state.tablet;
  if (goal === "BURY_TABLET") return !!state.tablet;
  return false;
}

// ---- Midnight -----------------------------------------------------------------
// ONE STRIKE, BINARY. He has no rounds, no health pool and no abilities, and
// 黑狗血 does not work on him. You either come to the threshold or you do not.
//
// 🤫 The threshold is a HIDDEN ENDING. This returns the numbers because the
// verdict card of a player killed at midnight is the one place they may ever
// appear — that single line is the whole discovery mechanism. Everywhere else
// they are not to be shown, which is a rule about presentation and binding on
// it (spec §9); the engine's part is only to make the card possible.
export function kingThreshold(state) {
  return state.tablet ? RULES.KING_THRESHOLD_WITH_TABLET : RULES.KING_THRESHOLD;
}

export function midnight(state, { runningWater = false, use = {} } = {}) {
  if (state.status !== "playing") return { outcome: state.outcome };

  // 活水. He will not cross it, so there is no exchange at all — not a win, not
  // a loss, and the only ending in the game that costs nothing and proves
  // nothing.
  if (runningWater) {
    finish(state, OUTCOMES.SURVIVED);
    return { outcome: OUTCOMES.SURVIVED };
  }

  const threshold = kingThreshold(state);
  const attack = attackWith(state, use);

  // Spent whether or not it was enough. Bringing the banner and falling short
  // is still bringing the banner.
  const tal = use.talisman ? state.itemsById[use.talisman] : null;
  // 血符 is paid first, and it can kill you on the doorstep. If it does, you
  // never made the strike — the same rule resolveCombat applies, and the same
  // reason: you cannot spend blood you no longer have.
  if (tal && tal.costHp) {
    changeHealth(state, -tal.costHp);
    if (state.status !== "playing") {
      return { outcome: state.outcome, attack: 0, threshold, diedPaying: true };
    }
  }

  const spent = [];
  if (use.banner && held(state, "soul-banner")) { dropItem(state, "soul-banner"); spent.push("soul-banner"); }
  if (tal && tal.consumed && held(state, use.talisman)) { dropItem(state, use.talisman); spent.push(use.talisman); }

  const outcome = attack >= threshold ? OUTCOMES.WIN_SEAL : OUTCOMES.LOSS_KING;
  finish(state, outcome);
  return { outcome, attack, threshold, spent };
}

// ---- Turn boundary ---------------------------------------------------------
// Step 1 of a turn, in order: the poison tick comes before the player is given
// an action, which is what makes "curing still pays this turn's tick" fall out
// of the sequence rather than needing a rule of its own.
export function beginTurn(state) {
  decayRelief(state);
  // Last turn's running is over. Cleared here rather than at the end of the
  // turn that set it, so anything still resolving that turn — the HEAL_1 it
  // suppresses, the breach it cancels — can still see it.
  state.fled = false;
  poisonTick(state);
  return state;
}
