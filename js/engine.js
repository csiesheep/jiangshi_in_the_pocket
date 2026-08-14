// Core game engine — pure rules over a state object, no DOM.
// Numbers come straight from the ruleset spec (v1.5 + designer rulings).
// This is the load-bearing module; implement it test-first (Phase 1).

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
  MAX_ITEMS: 2, // totem is exempt
  COWER_HEAL: 3,
  RUN_AWAY_DAMAGE: 1,
  ZOMBIE_DOOR_COUNT: 3,
};

// House rules (spec §13), baked in as the defaults:
export const HOUSE_RULES = {
  FLEE_ADJACENT_ONLY: true,
  COWER_ONCE_PER_TURN: true,
  TEMPLE_SECOND_CARD_ONCE: true,
};

// Combat is arithmetic, not dice. Attack never stacks — the caller passes the
// single best weapon bonus in `attack`, not a sum.
export function combatDamage(zombies, attack) {
  const raw = zombies - attack;
  return Math.max(RULES.MIN_COMBAT_DAMAGE, Math.min(RULES.MAX_COMBAT_DAMAGE, raw));
}

// --- TODO (Phase 1) ---
// export function newGame(seed) { ... }        // setup: burn 2, Foyer, no card
// export function drawDevCard(state) { ... }   // empty deck -> timePasses()
// export function resolveCard(state, card) { ... }
// export function timePasses(state) { ... }    // hour++, reshuffle, burn 2
// export function cower(state) { ... }
// export function flee(state, dir) { ... }
// export function checkWinLose(state) { ... }
