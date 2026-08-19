import * as E from "../js/engine.js";
import { test, assert, eq } from "./harness.js";

// Load the real game data so tests run against the shipped tables.
const [cards, items] = await Promise.all([
  fetch("../data/cards.json").then((r) => r.json()),
  fetch("../data/items.json").then((r) => r.json()),
]);
const DATA = { cards, items };
const game = (opts) => E.newGame(DATA, opts);

// ---- Setup -----------------------------------------------------------------
test("setup: starting stats", () => {
  const s = game({ seed: 1 });
  eq(s.health, 6, "health");
  eq(s.hour, 21, "hour");
  eq(s.items, [], "items");
  eq(s.totem, false, "totem");
  eq(s.status, "playing", "status");
});

test("setup: 9-card deck, burn 2, 7 live", () => {
  const s = game({ seed: 1 });
  eq(s.deck.length, 7, "deck");
  eq(s.burned.length, 2, "burned");
  const all = [...s.deck, ...s.burned].sort((a, b) => a - b);
  eq(all, [1, 2, 3, 4, 5, 6, 7, 8, 9], "all nine present, unique");
});

test("setup: same seed -> same shuffle", () => {
  eq(game({ seed: 42 }).deck, game({ seed: 42 }).deck);
  assert(
    JSON.stringify(game({ seed: 1 }).deck) !== JSON.stringify(game({ seed: 2 }).deck),
    "different seeds should usually differ"
  );
});

test("bandKey maps hour -> card key", () => {
  const s = game({ seed: 1 });
  s.hour = 21; eq(E.bandKey(s), "9");
  s.hour = 22; eq(E.bandKey(s), "10");
  s.hour = 23; eq(E.bandKey(s), "11");
});

// ---- Clock -----------------------------------------------------------------
test("timePasses: advances hour, rebuilds full deck", () => {
  const s = game({ seed: 1 });
  E.timePasses(s);
  eq(s.hour, 22, "hour++");
  eq(s.deck.length, 7, "fresh deck");
  eq(s.burned.length, 2, "burned again");
});

test("timePasses: midnight at 11 PM is a loss", () => {
  const s = game({ seed: 1 });
  s.hour = 23;
  E.timePasses(s);
  eq(s.status, "lost");
  eq(s.lossReason, "midnight");
});

test("drawCard: empty deck advances the hour", () => {
  const s = game({ seed: 1 });
  s.deck = [];
  const c = E.drawCard(s);
  eq(s.hour, 22, "hour advanced");
  assert(c != null, "drew from the fresh deck");
  eq(s.deck.length, 6, "one drawn from the fresh 7");
});

test("clockTime: minutes track the deck, 7 draws to the hour", () => {
  const s = game({ seed: 1 });
  eq(s.deck.length, 7, "the hour starts with 7 resolvable draws");
  eq(E.clockTime(s).label, "9:00", "untouched deck reads the top of the hour");
  eq(E.clockTime(s).draws, 0);

  const seen = [];
  for (let i = 0; i < 7; i++) {
    s.deck.pop();
    const c = E.clockTime(s);
    seen.push(c.label);
    eq(c.draws, i + 1, `draws after ${i + 1} cards`);
  }
  eq(seen, ["9:09", "9:17", "9:26", "9:34", "9:43", "9:51", "10:00"], "the walk down the deck");
});

// The one that looks like a bug and is not.
test("clockTime: an empty deck stands at the next hour before it turns", () => {
  const s = game({ seed: 1 });
  s.deck = [];
  const c = E.clockTime(s);
  eq(s.hour, 21, "the hour itself has NOT turned");
  eq(E.bandKey(s), "9", "cards are still read at the 9 PM band");
  eq(c.label, "10:00", "but the face shows the top of the next hour");
  eq(c.hour, 21, "the band hour");
  eq(c.hour24, 22, "the face hour, one ahead");
  eq(c.minutes, 0, "carried, not left at 60");
  assert(c.atTheTurn, "flagged so the UI can say the next card tolls the hour");
});

test("clockTime: the last deck of the night reads midnight", () => {
  const s = game({ seed: 1 });
  s.hour = 23;
  s.deck = [];
  eq(E.clockTime(s).label, "12:00", "11 PM exhausted is midnight on the face");
  eq(E.clockTime(s).elapsed, 3, "the whole night spent");
});

test("clockTime: the hour turning snaps the hand back to :00", () => {
  const s = game({ seed: 1 });
  s.deck = [];
  eq(E.clockTime(s).label, "10:00", "standing at the turn");
  E.drawCard(s); // tolls the hour, reshuffles, and spends one of the new deck
  eq(s.hour, 22, "hour turned");
  eq(s.deck.length, 6, "one drawn from the fresh 7");
  eq(E.clockTime(s).label, "10:09", "one card into the new hour");
});

test("clockTime: cowering costs minutes like any other card", () => {
  const s = game({ seed: 1 });
  const before = E.clockTime(s);
  E.cower(s);
  const after = E.clockTime(s);
  eq(after.draws, before.draws + 1, "the discard spent clock");
  assert(after.elapsed > before.elapsed, "rest is not free");
});

// ---- The tension director ---------------------------------------------------
test("dread: a fresh nine o'clock is calm, and it is the floor", () => {
  const s = game({ seed: 1 });
  const d = E.dread(s);
  assert(d >= 0 && d < 0.1, `a fresh start should be near zero, got ${d}`);
});

test("dread: every term pushes it up, and none of them pull it down", () => {
  const base = () => game({ seed: 1 });
  const start = E.dread(base());

  const hurt = base();
  hurt.health = 1;
  const late = base();
  late.hour = 23;
  const bloody = base();
  bloody.foughtThisHour = 12;
  const thin = base();
  thin.deck = [];
  const carrying = base();
  carrying.totem = true;

  for (const [name, s] of [["hurt", hurt], ["late", late], ["bloody", bloody],
                           ["thin deck", thin], ["carrying the relic", carrying]]) {
    assert(E.dread(s) > start, `${name} should raise dread`);
  }
});

test("dread: the worst the game gets is worse than any single thing", () => {
  const s = game({ seed: 1 });
  s.hour = 23;
  s.health = 1;
  s.foughtThisHour = 12;
  s.deck = [];
  s.totem = true;
  const worst = E.dread(s);
  assert(worst > 0.85, `a 1 HP relic-carrying midnight should be near the top, got ${worst}`);
  eq(worst <= 1, true, "and never above 1");
  // and worse than any one term on its own, which is the point of a dial
  const onlyLate = game({ seed: 1 });
  onlyLate.hour = 23;
  assert(worst > E.dread(onlyLate) * 1.5, "the whole should beat any single part");
});

test("dread: health matters most at the bottom, which is where it is felt", () => {
  const at = (hp) => { const s = game({ seed: 1 }); s.health = hp; return E.dread(s); };
  const sixToFive = at(5) - at(6);
  const twoToOne = at(1) - at(2);
  assert(twoToOne > sixToFive * 2, "losing your last heart should count for more than your first");
});

test("dread: pure, and deterministic under a seed", () => {
  const a = game({ seed: 77 });
  const b = game({ seed: 77 });
  for (let i = 0; i < 4; i++) { E.drawCard(a); E.drawCard(b); }
  eq(E.dread(a), E.dread(b), "same seed, same fear");
  const before = JSON.stringify({ h: a.health, d: a.deck, f: a.foughtThisHour });
  E.dread(a);
  eq(JSON.stringify({ h: a.health, d: a.deck, f: a.foughtThisHour }), before,
     "reading the dial changes nothing");
});

test("foughtThisHour: counts the risen, and resets when the hour turns", () => {
  const s = game({ seed: 1 });
  eq(s.foughtThisHour, 0);
  E.resolveCombat(s, 3, {});
  E.resolveCombat(s, 2, {});
  eq(s.foughtThisHour, 5, "five risen put down this hour");
  s.deck = [];
  E.drawCard(s); // tolls the hour
  eq(s.hour, 22, "the hour turned");
  eq(s.foughtThisHour, 0, "and the count went with it");
});

test("clockTime: pure and deterministic under a seed", () => {
  const a = game({ seed: 42 });
  const b = game({ seed: 42 });
  for (let i = 0; i < 5; i++) {
    E.drawCard(a);
    E.drawCard(b);
    eq(E.clockTime(a).label, E.clockTime(b).label, `same seed, same clock at draw ${i}`);
  }
  const snapshot = JSON.stringify(a.deck);
  E.clockTime(a);
  eq(JSON.stringify(a.deck), snapshot, "reading the clock does not spend anything");
});

test("drawCard: empty deck at 11 PM loses (returns null)", () => {
  const s = game({ seed: 1 });
  s.hour = 23;
  s.deck = [];
  const c = E.drawCard(s);
  eq(c, null);
  eq(s.status, "lost");
  eq(s.lossReason, "midnight");
});

// ---- Health ----------------------------------------------------------------
test("changeHealth: 0 is a loss", () => {
  const s = game({ seed: 1 });
  s.health = 1;
  E.changeHealth(s, -1);
  eq(s.health, 0);
  eq(s.status, "lost");
  eq(s.lossReason, "health");
});

test("changeHealth: no cap by default", () => {
  const s = game({ seed: 1 });
  E.changeHealth(s, +5);
  eq(s.health, 11);
});

test("changeHealth: v1.75 cap clamps gains", () => {
  const s = game({ seed: 1, healthCap: 6 });
  E.changeHealth(s, +5);
  eq(s.health, 6);
});

// ---- Combat ----------------------------------------------------------------
test("combatDamage: clamps to [0,4]", () => {
  eq(E.combatDamage(3, 1), 2, "normal");
  eq(E.combatDamage(6, 1), 4, "capped at 4");
  eq(E.combatDamage(2, 5), 0, "never negative / no heal");
});

test("resolveCombat: applies damage", () => {
  const s = game({ seed: 1 });
  const r = E.resolveCombat(s, 3); // attack 1 -> 2 damage
  eq(r.damage, 2);
  eq(s.health, 4);
});

test("resolveCombat: lethal fight loses with reason combat", () => {
  const s = game({ seed: 1 });
  s.health = 2;
  E.resolveCombat(s, 6); // 4 damage
  eq(s.health, 0);
  eq(s.status, "lost");
  eq(s.lossReason, "combat");
});

test("attack never stacks: best weapon only", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "grisly-femur"); // +1
  E.pickUpItem(s, "machete"); // +2
  eq(E.effectiveAttack(s), 3, "1 + best(2), not 1+1+2");
  eq(E.chooseWeapon(s), "machete");
});

test("chooseWeapon: honours an explicit weapon", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "grisly-femur");
  E.pickUpItem(s, "machete");
  eq(E.chooseWeapon(s, "grisly-femur"), "grisly-femur");
});

// ---- Chainsaw --------------------------------------------------------------
test("chainsaw: picks up loaded, gives +3", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "chainsaw");
  eq(s.chainsawFuel, 2);
  eq(E.effectiveAttack(s), 4);
});

test("chainsaw: fuel drains, is kept when spent, refuellable", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "chainsaw");
  E.resolveCombat(s, 5); // use 1 -> fuel 1
  E.resolveCombat(s, 5); // use 2 -> fuel 0
  eq(s.chainsawFuel, 0);
  assert(s.items.includes("chainsaw"), "empty chainsaw is kept");
  eq(E.effectiveAttack(s), 1, "empty chainsaw gives no bonus");
  E.pickUpItem(s, "gasoline");
  eq(E.refuelChainsaw(s).ok, true);
  eq(s.chainsawFuel, 2);
  assert(!s.items.includes("gasoline"), "gasoline consumed");
  eq(E.effectiveAttack(s), 4, "refuelled chainsaw usable again");
});

test("chainsaw: can preserve fuel by choosing another weapon", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "chainsaw");
  E.pickUpItem(s, "machete");
  E.resolveCombat(s, 4, { weapon: "machete" });
  eq(s.chainsawFuel, 2, "fuel untouched");
});

// ---- Items -----------------------------------------------------------------
test("items: 2-slot limit, drop to make room", () => {
  const s = game({ seed: 1 });
  eq(E.pickUpItem(s, "machete").ok, true);
  eq(E.pickUpItem(s, "golf-club").ok, true);
  eq(E.pickUpItem(s, "board-nails").ok, false, "full without a drop");
  eq(E.pickUpItem(s, "board-nails", "machete").ok, true, "drop then pick up");
  eq(s.items, ["golf-club", "board-nails"]);
});

test("totem: slotless, and wins only when held", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "machete");
  E.pickUpItem(s, "golf-club");
  E.gainTotem(s); // full on items, totem still allowed
  eq(s.totem, true);
  eq(s.items.length, 2, "totem took no slot");
  const noTotem = game({ seed: 1 });
  E.buryTotem(noTotem);
  eq(noTotem.status, "playing", "no win without the totem");
  E.buryTotem(s);
  eq(s.status, "won");
});

test("soda: +2 health, consumed; respects cap", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "can-of-soda");
  E.useHealItem(s);
  eq(s.health, 8);
  assert(!s.items.includes("can-of-soda"), "soda consumed");
  const capped = game({ seed: 1, healthCap: 6 });
  E.pickUpItem(capped, "can-of-soda");
  E.useHealItem(capped);
  eq(capped.health, 6, "capped");
});

// ---- Combos ----------------------------------------------------------------
test("candle combo: needs candle + fuel; fuel consumed, candle kept", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "candle");
  E.pickUpItem(s, "oil");
  eq(E.useCandleCombo(s, "oil").ok, true);
  assert(!s.items.includes("oil"), "oil consumed");
  assert(s.items.includes("candle"), "candle reusable");
});

test("candle combo: fails without candle", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "oil");
  eq(E.useCandleCombo(s, "oil").ok, false);
});

// ---- Fleeing ---------------------------------------------------------------
test("flee: costs 1 health", () => {
  const s = game({ seed: 1 });
  E.flee(s);
  eq(s.health, 5);
});

test("flee: oil escapes damage, one use", () => {
  const s = game({ seed: 1 });
  E.pickUpItem(s, "oil");
  E.flee(s, { useOil: true });
  eq(s.health, 6, "no damage");
  assert(!s.items.includes("oil"), "oil consumed");
});

// ---- Cowering --------------------------------------------------------------
test("cower: +3, discards a card, once per turn", () => {
  const s = game({ seed: 1 });
  const before = s.deck.length;
  eq(E.cower(s).ok, true);
  eq(s.health, 9, "+3");
  eq(s.deck.length, before - 1, "discarded top card");
  eq(E.cower(s).ok, false, "blocked second time this turn");
  E.beginTurn(s);
  eq(E.cower(s).ok, true, "allowed again next turn");
});

// The designer ruled the gap between the Reliquary's / Family Plot's two cards
// "behaves like an ordinary fresh turn", so it carries its own cower allowance
// rather than competing with the one at end of turn.
test("cower: a fresh window grants another allowance in the same turn", () => {
  const s = game({ seed: 1 });
  eq(E.cower(s).ok, true, "first window");
  eq(E.cower(s).ok, false, "still one per window");
  E.openCowerWindow(s);
  const deck = s.deck.length;
  const hp = s.health;
  eq(E.cower(s).ok, true, "second window opens a new allowance");
  eq(s.health, hp + E.RULES.COWER_HEAL, "heals again");
  eq(s.deck.length, deck - 1, "and costs another card");
  eq(E.cower(s).ok, false, "but only once inside that window too");
});

// ---- Card resolution -------------------------------------------------------
test("resolveCard EVENT: applies hp for the hour", () => {
  const s = game({ seed: 1 });
  s.hour = 21; // card 8 @ 9 PM = +1
  const r = E.resolveCard(s, 8);
  eq(r.type, "EVENT");
  eq(s.health, 7);
});

test("resolveCard ZOMBIES: fights for the hour", () => {
  const s = game({ seed: 1 });
  s.hour = 21; // card 9 @ 9 PM = 3 zombies
  const r = E.resolveCard(s, 9);
  eq(r.type, "ZOMBIES");
  eq(r.n, 3);
  eq(s.health, 4); // 3 - 1 = 2 damage
});

test("resolveCard ITEM: draws next card, takes its item", () => {
  const s = game({ seed: 1 });
  s.hour = 22; // card 1 @ 10 PM = ITEM
  s.deck = [4]; // next card is the machete card
  const r = E.resolveCard(s, 1);
  eq(r.type, "ITEM");
  eq(r.taken, "machete");
  assert(s.items.includes("machete"), "item picked up");
});

test("resolveCard ITEM declined: no draw, no item", () => {
  const s = game({ seed: 1 });
  s.hour = 22;
  const before = s.deck.length;
  const r = E.resolveCard(s, 1, { takeItem: false });
  eq(r.taken, null);
  eq(s.deck.length, before, "no card spent");
});
