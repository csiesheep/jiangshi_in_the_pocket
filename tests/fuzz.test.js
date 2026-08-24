import * as E from "../js/engine.js";
import * as B from "../js/board.js";
import { test, assert, eq } from "./harness.js";

const NO_STORE = { cache: "no-store" };

// Headless fuzz. Three hundred nights played by a policy that makes deliberately
// stupid, deliberately varied choices, asserting only the things that must hold
// however the night goes:
//
//   1. nothing throws
//   2. every run reaches one of the five outcomes
//   3. no run runs forever
//
// It is not a balance check — the invariants suite does that arithmetically.
// This is here for the failures no hand-written test thinks of: the branch
// nobody wired, the state two systems disagree about, the turn that resolves
// into a shape the next turn cannot read. A failure prints its seed, because a
// fuzz failure you cannot reproduce is a rumour.
const [items, search, events, tiles] = await Promise.all([
  fetch("../data/items.json", NO_STORE).then((r) => r.json()),
  fetch("../data/search.json", NO_STORE).then((r) => r.json()),
  fetch("../data/events.json", NO_STORE).then((r) => r.json()),
  fetch("../data/tiles.json", NO_STORE).then((r) => r.json()),
]);
const DATA = { items, search, events, tiles };

const OUTCOMES = ["WIN_BURIAL", "WIN_SEAL", "SURVIVED", "LOSS_HEALTH", "LOSS_KING"];

// A whole night, start to ending. The policy rolls from its OWN rng so it never
// disturbs the game's streams — a fuzz that shifted the seeds it is testing
// would be testing something else.
function playNight(seed, { maxTurns = 400 } = {}) {
  const state = E.newGame(DATA, { seed });
  const board = B.createBoard(DATA, { seed });
  const die = E.makeRng((seed ^ 0x5bd1e995) >>> 0);
  const pick = (arr) => arr[Math.floor(die() * arr.length) % arr.length];
  const log = [];

  let guard = 0;
  while (state.status === "playing") {
    if (++guard > maxTurns) throw new Error(`did not terminate within ${maxTurns} turns`);

    E.beginTurn(state); // step 1: the poison tick
    if (state.status !== "playing") break;

    // ---- step 2: an action
    const moves = B.listMoves(board);
    const roll = die();
    // Cower when it is worth cowering: a charge buys the expected damage of the
    // draw you skip, which is most valuable late and when there is little left
    // to lose it with.
    const wantsCower = state.cowerCharges > 0 && (state.health <= 3 || (state.hour === 23 && die() < 0.3));
    if (wantsCower) {
      E.cower(state); // skips the event entirely; the turn ends here
      log.push("cower");
    } else {
      if (moves.length) {
        const m = pick(moves);
        if (m.type === "explore") B.explore(board, m.dir, B.pickExploreRotation(board, m.dir));
        else if (m.type === "outside") B.goOutside(board);
        else B.moveTo(board, m.dir);
      }
      // ---- step 3: the event
      const ev = E.drawEvent(state);
      const out = E.resolveEvent(state, ev, { giveRice: die() < 0.5 });
      if (out.type === "FIGHT") resolveFight(state, out.n, die, pick);
      log.push(ev ? ev.t : "none");

      if (state.status === "playing" && !state.fled) {
        // ---- step 4: a free search, if the room offers one
        const here = B.currentTile(board);
        if (here && here.def.search) {
          const r = E.search(state, here.def.search);
          // A full pack is offered a drop; take it or leave it, both are legal.
          if (r.result === "OFFER_DROP" && die() < 0.5) {
            E.pickUpItem(state, r.id, pick(E.heldIds(state)));
          }
        }
        // Eat when badly hurt. The old policy never ate at all, which is one of
      // the reasons every night ended the same way.
      if (state.health <= 4 && E.held(state, "sticky-rice")) E.useMedicine(state, "sticky-rice");
      if (state.poisoned && E.held(state, "sticky-rice") && die() < 0.7) E.useMedicine(state, "sticky-rice");

      // Tile actions are free.
        if (here && here.def.action === "RESTORE_COWER_ONCE" && die() < 0.8) E.restoreCowerCharge(state);
        if (here && here.def.action === "PRAY_ONCE" && B.canPray(board) && die() < 0.8) B.pray(board);

        // ---- the rites, which draw one more event apiece
        const goal = here && here.def.goal;
        if (goal && E.riteDraws(state, goal)) {
          const riteEv = E.riteEvent(state);
          const riteOut = E.resolveEvent(state, riteEv, { giveRice: die() < 0.5 });
          if (riteOut.type === "FIGHT") resolveFight(state, riteOut.n, die, pick);
          if (state.status === "playing") E.completeRite(state, goal);
        }
      }

      // ---- 破牆, after the room's own event and only if you are still here
      if (state.status === "playing") {
        const n = E.breachAfterEvent(state, { deadEnd: B.isDeadEnd(board) });
        if (n) {
          const wall = B.pickZombieDoorWall(board);
          if (wall) B.openZombieDoor(board, wall);
          resolveFight(state, n, die, pick);
        }
      }

      // ---- step 5: the tile's own end
      const here2 = B.currentTile(board);
      if (state.status === "playing" && !state.fled && here2 && here2.def.onTurnEnd === "HEAL_1") {
        E.changeHealth(state, 1);
      }
    }

    if (state.status !== "playing") break;

    // ---- step 6: the clock, and midnight when it runs out
    if (state.turn >= E.RULES.TOTAL_TURNS) {
      const here = B.currentTile(board);
      const water = !!(here && (here.def.flags || []).includes("RUNNING_WATER"));
      E.midnight(state, { runningWater: water, use: bestKit(state, die) });
      break;
    }
    E.advanceTurn(state);
  }

  return { state, board, log };
}

// Careless but not suicidal. A purely random fighter dies inside five turns —
// bare-handed you lose 1.85-2.90 a turn against 10 health — so a policy that
// never defends itself never sees turn six, and a fuzz that never sees turn six
// is not fuzzing the game. This one runs when it is hurt and swings what it has
// when it is not, which is enough to reach midnight sometimes without being so
// clever that it stops exercising the losing branches.
function resolveFight(state, n, die, pick) {
  const hurt = state.health <= 4;
  if (hurt && E.held(state, "black-dog-blood") && E.escapeFight(state).ok) return;
  if (hurt && die() < 0.6) return void E.flee(state);
  if (die() < 0.08) return void E.flee(state); // and sometimes for no reason

  const talismans = E.heldIds(state).filter((id) => {
    const d = state.itemsById[id];
    return d && d.cat === "magic" && d.attack;
  });
  const use = {};
  // Spend a talisman on a pack that would actually hurt, and keep the banner
  // for the King unless this is about to kill us.
  const bare = E.combatDamage(n, E.effectiveAttack(state), E.hasCharm(state));
  if (talismans.length && bare >= 2) {
    use.talisman = talismans.sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack)[0];
    // 血符 costs a point; do not pay it to save a point.
    if (state.itemsById[use.talisman].costHp && state.health <= 2) delete use.talisman;
  }
  if (E.held(state, "soul-banner") && bare >= 4 && state.health <= 4) use.banner = true;
  E.resolveCombat(state, n, use);
}

function bestKit(state, die) {
  const use = {};
  if (E.held(state, "soul-banner")) use.banner = true;
  const talismans = E.heldIds(state)
    .filter((id) => { const d = state.itemsById[id]; return d && d.cat === "magic" && d.attack; })
    .sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack);
  if (talismans.length) use.talisman = talismans[0];
  return use;
}

test("fuzz: 300 nights, nothing throws and every one of them ends", () => {
  const failures = [];
  const seen = {};
  for (let seed = 1; seed <= 300; seed++) {
    try {
      const { state } = playNight(seed);
      if (!OUTCOMES.includes(state.outcome)) {
        failures.push(`seed ${seed}: ended as ${JSON.stringify(state.outcome)} / status ${state.status}`);
      }
      seen[state.outcome] = (seen[state.outcome] || 0) + 1;
      if (state.health < 0) failures.push(`seed ${seed}: health went negative (${state.health})`);
      if (state.health > E.RULES.HEALTH_CAP) failures.push(`seed ${seed}: health ${state.health} above the cap`);
      if (E.slotsUsed(state) > E.RULES.MAX_ITEMS) {
        failures.push(`seed ${seed}: ${E.slotsUsed(state)} slots used of ${E.RULES.MAX_ITEMS}`);
      }
    } catch (err) {
      // The seed is the whole value of this line: it makes the failure a bug
      // report rather than a rumour.
      failures.push(`seed ${seed}: threw ${err && err.message}`);
    }
    if (failures.length >= 5) break; // five is plenty to work from
  }
  eq(failures.slice(0, 5), [], "a night that throws or never ends");
  console.log("fuzz outcomes over 300 nights:", seen);
});

// The fuzz would still pass if the policy quietly stopped playing — if every
// run died on turn one, or no run ever reached midnight. These pin that it is
// actually exercising the game.
test("fuzz: the runs are real — several outcomes, and nights that go the distance", () => {
  const seen = {};
  let deepest = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const { state } = playNight(seed);
    seen[state.outcome] = (seen[state.outcome] || 0) + 1;
    deepest = Math.max(deepest, state.turn);
  }
  assert(Object.keys(seen).length >= 2, `random play should not all end the same way, got ${JSON.stringify(seen)}`);
  assert(deepest >= E.RULES.TOTAL_TURNS, `some night should reach turn 30, deepest was ${deepest}`);
  assert((seen.LOSS_HEALTH || 0) > 0, "and careless play should sometimes get you killed");
});

test("fuzz: a night is deterministic under its seed", () => {
  const a = playNight(77);
  const b = playNight(77);
  eq(a.state.outcome, b.state.outcome);
  eq(a.state.health, b.state.health);
  eq(a.state.turn, b.state.turn);
  eq(a.log.join(","), b.log.join(","), "the same night, event for event");
});
