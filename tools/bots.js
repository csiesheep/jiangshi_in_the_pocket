// Four policies, played over a thousand seeds each, to measure numbers the
// design derived by hand and never checked.
//
// The point is not to find an optimal player. It is to answer questions the
// redesign note asserts: that the camper and the turtle essentially never win,
// that the seal is rarer than the burial but reachable, that a banner-less
// midnight is fatal, and that the villager route really does contribute to the
// kit. Each of those is a claim about the shape of the game, and none of them
// had a number attached.
//
// Deterministic by seed, and the policy's dice come from their own stream so a
// bot never disturbs the game it is measuring — the same rule the fuzz follows.
// Runs in the browser because this project has no Node; tools/bots.html is the
// page that prints the table.

import * as E from "../js/engine.js";
import * as B from "../js/board.js";

const NO_STORE = { cache: "no-store" };

export async function loadData(base = "..") {
  const [items, search, events, tiles] = await Promise.all([
    fetch(`${base}/data/items.json`, NO_STORE).then((r) => r.json()),
    fetch(`${base}/data/search.json`, NO_STORE).then((r) => r.json()),
    fetch(`${base}/data/events.json`, NO_STORE).then((r) => r.json()),
    fetch(`${base}/data/tiles.json`, NO_STORE).then((r) => r.json()),
  ]);
  return { items, search, events, tiles };
}

// ---- Getting about ------------------------------------------------------------
// Breadth-first over tiles that are actually joined, answering with the FIRST
// STEP rather than the path — a bot only ever needs to know which way to go
// next, and recomputing each turn keeps it honest about a board that changed
// under it.
function stepToward(board, want) {
  const start = B.currentTile(board);
  if (!start) return null;
  const save = { ...board.player };
  const at = (t, fn) => {
    board.player = { world: t.world, x: t.x, y: t.y };
    const v = fn();
    board.player = save;
    return v;
  };
  const key = (t) => `${t.world}:${t.x},${t.y}`;
  const seen = new Set([key(start)]);
  let frontier = at(start, () => B.listMoves(board))
    .filter((m) => m.type === "move" || m.type === "cross")
    .map((m) => ({ first: m.dir, tile: board.worlds[m.to.world].get(B.cellKey(m.to.x, m.to.y)) }))
    .filter((n) => n.tile);

  for (const n of frontier) seen.add(key(n.tile));
  let depth = 0;
  while (frontier.length && depth++ < 40) {
    for (const n of frontier) if (want(n.tile)) return n.first;
    const next = [];
    for (const n of frontier) {
      for (const m of at(n.tile, () => B.listMoves(board))) {
        if (m.type !== "move" && m.type !== "cross") continue;
        const t = board.worlds[m.to.world].get(B.cellKey(m.to.x, m.to.y));
        if (!t || seen.has(key(t))) continue;
        seen.add(key(t));
        next.push({ first: n.first, tile: t });
      }
    }
    frontier = next;
  }
  return null;
}

const die01 = (ctx) => ctx.die();

const placed = (board, id) => {
  for (const w of ["indoor", "outdoor"]) {
    for (const t of board.worlds[w].values()) if (t.id === id) return t;
  }
  return null;
};

const goalTile = (data, goal) =>
  [...data.tiles.indoor, ...data.tiles.outdoor].find((t) => t.goal === goal);

// ---- The shared survival floor -------------------------------------------------
// Every policy gets this. Without it a bot dies on turn five and measures
// nothing but the first five turns — which is what the fuzz found the hard way.
function survive(ctx) {
  const { state } = ctx;
  if (state.health <= 4 && E.held(state, "sticky-rice")) E.useMedicine(state, "sticky-rice");
  else if (state.poisoned && E.heldCount(state, "sticky-rice") > 1) E.useMedicine(state, "sticky-rice");
}

function fight(ctx, n, { hoardBanner = true } = {}) {
  const { state, die } = ctx;
  const hurt = state.health <= 4;
  if (hurt && E.held(state, "black-dog-blood") && E.escapeFight(state).ok) return;
  if (hurt && state.health <= 3) return void E.flee(state);

  const bare = E.combatDamage(n, E.effectiveAttack(state), E.hasCharm(state));
  const use = {};
  const talismans = E.heldIds(state)
    .filter((id) => { const d = state.itemsById[id]; return d && d.cat === "magic" && d.attack; })
    .sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack);
  if (bare >= 2 && talismans.length) {
    const pick = talismans[0];
    if (!(state.itemsById[pick].costHp && state.health <= 2)) use.talisman = pick;
  }
  // A duelist hoards the banner for midnight; anyone dying without one may as
  // well spend it.
  if (E.held(state, "soul-banner") && (!hoardBanner || state.health <= 3) && bare >= 3) use.banner = true;
  E.resolveCombat(state, n, use);
  if (state.status === "playing") survive(ctx);
}

// One sword is worth more than anything else you can carry, so everyone buffs
// the best one they have as soon as they can.
function upkeep(ctx) {
  const { state } = ctx;
  const sword = E.bestSword(state);
  if (sword && !state.buffed[sword] && E.held(state, "truefire-talisman")) {
    // Only if it is not the last attack talisman we hold — burning the one
    // thing that could carry a fight is worse than a slightly duller sword.
    const others = E.heldIds(state).filter((id) => {
      const d = state.itemsById[id];
      return d && d.cat === "magic" && d.attack && id !== "truefire-talisman";
    });
    if (others.length || E.heldCount(state, "truefire-talisman") > 1) E.buffSword(state, sword);
  }
  if (E.held(state, "cinnabar")) {
    const best = E.heldIds(state)
      .filter((id) => { const d = state.itemsById[id]; return d && d.cat === "magic" && d.attack; })
      .sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack)[0];
    if (best) E.useCinnabar(state, best);
  }
}

// ---- The policies ---------------------------------------------------------------
// Each answers one question: where do I want to be standing?

const POLICIES = {
  // Chase the burial. Find the crypt, take the 神主牌, get outdoors, pray if the
  // ground has not turned up, and bury it.
  hunter(ctx) {
    const { board, state, data } = ctx;
    const crypt = goalTile(data, "TAKE_TABLET");
    const grave = goalTile(data, "BURY_TABLET");
    if (!state.tablet) {
      if (placed(board, crypt.id)) return { doRites: true, seek: (x) => x.id === crypt.id };
      return { doRites: true, explore: "indoor" };
    }
    if (placed(board, grave.id)) return { doRites: true, seek: (x) => x.id === grave.id };
    return { doRites: true, explore: "outdoor", pray: true };
  },

  // Assemble a kit that reaches the threshold, then meet him. Searches
  // everything, avoids fights, hoards the banner.
  duelist(ctx) {
    const { board, state, data } = ctx;
    // Never performs the burial — the whole point is to arrive at midnight
    // armed. It will still take the 神主牌 if the crypt turns up, because that
    // lowers the threshold from 12 to 11 for free.
    const crypt = goalTile(data, "TAKE_TABLET");
    if (!state.tablet && placed(board, crypt.id)) {
      return { doRites: "TAKE_TABLET", seek: (x) => x.id === crypt.id, hoardBanner: true };
    }
    // Otherwise: keep turning over rooms that hold the kit. Magic and relic
    // first — 攝魂幡 is compulsory and every talisman is attack.
    const wanted = (x) => x.def.search === "relic" || x.def.search === "magic";
    const unsearched = [...board.worlds.indoor.values(), ...board.worlds.outdoor.values()]
      .some((t) => wanted(t) && t !== B.currentTile(board));
    if (unsearched && die01(ctx) < 0.5) return { seek: wanted, hoardBanner: true };
    return { explore: "any", hoardBanner: true };
  },

  // Hide. Find the 溪澗 and stand in it until the clock runs out — the one
  // ending that costs nothing and proves nothing.
  turtle(ctx) {
    const { board } = ctx;
    const stream = [...board.worlds.outdoor.values()].find((t) => (t.def.flags || []).includes("RUNNING_WATER"));
    if (stream) return { seek: (x) => (x.def.flags || []).includes("RUNNING_WATER"), thenStay: true };
    return { explore: "outdoor" };
  },

  // Stand on a tile that heals and never leave. The design says this loses;
  // this is the measurement of by how much.
  camper(ctx) {
    const { board } = ctx;
    const heal = [...board.worlds.indoor.values(), ...board.worlds.outdoor.values()]
      .find((t) => t.def.onTurnEnd === "HEAL_1");
    if (heal) return { seek: (x) => x.def.onTurnEnd === "HEAL_1", thenStay: true };
    return { explore: "any" };
  },
};

// ---- One night ------------------------------------------------------------------
export function playNight(data, policyName, seed) {
  const state = E.newGame(data, { seed });
  const board = B.createBoard(data, { seed });
  const die = E.makeRng((seed ^ 0x2545f491) >>> 0);
  const stats = { gifts: 0, giftIds: [], everHadBanner: false, bestAttack: 0 };
  const ctx = { state, board, data, die, stats };
  const policy = POLICIES[policyName];

  let guard = 0;
  while (state.status === "playing") {
    if (++guard > 400) throw new Error(`${policyName} seed ${seed}: did not terminate`);
    E.beginTurn(state);
    if (state.status !== "playing") break;

    const plan = policy(ctx) || {};

    // ---- the action
    const charges = state.cowerCharges;
    const wantCower = charges > 0 && (state.health <= 3 || (plan.thenStay && state.hour === 23 && die() < 0.5));
    if (wantCower) {
      E.cower(state);
    } else {
      const moves = B.listMoves(board);
      const here = B.currentTile(board);
      let dir = null;
      if (plan.seek && !plan.seek(here)) dir = stepToward(board, plan.seek);
      if (!dir && plan.explore) {
        const outs = moves.filter((m) => m.type === "explore" || m.type === "outside");
        const want = plan.explore === "any" ? outs
          : outs.filter((m) => m.type === "outside" || board.player.world === plan.explore);
        const chosen = (want.length ? want : outs)[0];
        if (chosen) dir = chosen.dir;
        else if (plan.explore === "outdoor" && board.player.world === "indoor") {
          const out = moves.find((m) => m.type === "cross" || m.type === "outside");
          if (out) dir = out.dir;
        }
      }
      if (dir) {
        const m = moves.find((x) => x.dir === dir);
        if (m && m.type === "explore") B.explore(board, m.dir, B.pickExploreRotation(board, m.dir));
        else if (m && m.type === "outside") B.goOutside(board);
        else if (m) B.moveTo(board, m.dir);
      }

      // ---- the event
      const ev = E.drawEvent(state);
      const out = E.resolveEvent(state, ev, { giveRice: E.heldCount(state, "sticky-rice") > 1 });
      if (out.type === "GIFT") { stats.gifts++; stats.giftIds.push(out.id); }
      if (out.type === "FIGHT") fight(ctx, out.n, { hoardBanner: plan.hoardBanner });

      if (state.status === "playing" && !state.fled) {
        survive(ctx);
        const tile = B.currentTile(board);
        if (tile && tile.def.search) {
          const r = E.search(state, tile.def.search);
          if (r.result === "OFFER_DROP") {
            // Drop rice before equipment; a sword outlives a meal.
            const spare = E.held(state, "sticky-rice") ? "sticky-rice" : E.heldIds(state)[0];
            E.pickUpItem(state, r.id, spare);
          }
        }
        if (tile && tile.def.action === "RESTORE_COWER_ONCE") E.restoreCowerCharge(state);
        if (tile && tile.def.action === "PRAY_ONCE" && plan.pray && B.canPray(board)) B.pray(board);
        upkeep(ctx);

        // Only the hunter performs a rite. Everyone else standing in a goal
        // room is standing in an ordinary room — without this the duelist and
        // the turtle won burials by walking past the grave, which measures
        // nothing about either line.
        const goal = plan.doRites ? tile && tile.def.goal : null;
        const riteAllowed = plan.doRites === true || plan.doRites === goal;
        if (goal && riteAllowed && E.riteDraws(state, goal)) {
          const rev = E.riteEvent(state);
          const rout = E.resolveEvent(state, rev, { giveRice: E.heldCount(state, "sticky-rice") > 1 });
          if (rout.type === "FIGHT") fight(ctx, rout.n, { hoardBanner: plan.hoardBanner });
          if (state.status === "playing") E.completeRite(state, goal);
        }
      }

      if (state.status === "playing") {
        const n = E.breachAfterEvent(state, { deadEnd: B.isDeadEnd(board) });
        if (n) {
          const wall = B.pickZombieDoorWall(board);
          if (wall) B.openZombieDoor(board, wall);
          fight(ctx, n, { hoardBanner: plan.hoardBanner });
        }
      }

      const end = B.currentTile(board);
      if (state.status === "playing" && !state.fled && end && end.def.onTurnEnd === "HEAL_1") {
        E.changeHealth(state, 1);
      }
    }

    if (E.held(state, "soul-banner")) stats.everHadBanner = true;
    stats.bestAttack = Math.max(stats.bestAttack, E.effectiveAttack(state));

    if (state.status !== "playing") break;
    if (state.turn >= E.RULES.TOTAL_TURNS) {
      const here = B.currentTile(board);
      const water = !!(here && (here.def.flags || []).includes("RUNNING_WATER"));
      const use = {};
      if (E.held(state, "soul-banner")) use.banner = true;
      const tal = E.heldIds(state)
        .filter((id) => { const d = state.itemsById[id]; return d && d.cat === "magic" && d.attack; })
        .sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack)[0];
      if (tal) use.talisman = tal;
      const atMidnight = E.attackWith(state, use);
      // Captured BEFORE midnight resolves, because resolving it spends the
      // banner. Read afterwards it is false for exactly the runs that used one,
      // which is the opposite of the question being asked.
      const hadBanner = !!use.banner;
      const r = E.midnight(state, { runningWater: water, use });
      return finish(state, board, { atMidnight, threshold: r.threshold, water, hadBanner, ...stats });
    }
    E.advanceTurn(state);
  }
  return finish(state, board, { ...stats });
}

function finish(state, board, extra) {
  return {
    outcome: state.outcome,
    turn: state.turn,
    health: state.health,
    tablet: state.tablet,
    attack: E.effectiveAttack(state),
    hadBanner: E.held(state, "soul-banner"),
    ...extra,
  };
}

// ---- A thousand nights -----------------------------------------------------------
export function run(data, policyName, seeds = 1000) {
  const tally = { WIN_BURIAL: 0, WIN_SEAL: 0, SURVIVED: 0, LOSS_HEALTH: 0, LOSS_KING: 0 };
  let reachedMidnight = 0;
  let bannerAtMidnight = 0;
  let sealAttackSum = 0;
  let turns = 0;
  let gifts = 0;
  let runsWithGift = 0;
  let everBanner = 0;
  let bestAttackSum = 0;
  const giftKinds = {};
  const errors = [];
  for (let seed = 1; seed <= seeds; seed++) {
    try {
      const r = playNight(data, policyName, seed);
      if (r.outcome in tally) tally[r.outcome]++;
      else errors.push(`seed ${seed}: outcome ${r.outcome}`);
      turns += r.turn;
      gifts += r.gifts || 0;
      if (r.gifts) runsWithGift++;
      for (const g of r.giftIds || []) giftKinds[g] = (giftKinds[g] || 0) + 1;
      if (r.everHadBanner) everBanner++;
      bestAttackSum += r.bestAttack || 0;
      if (r.atMidnight !== undefined) {
        reachedMidnight++;
        sealAttackSum += r.atMidnight;
        if (r.hadBanner) bannerAtMidnight++;
      }
    } catch (err) {
      errors.push(`seed ${seed}: ${err && err.message}`);
    }
  }
  const wins = tally.WIN_BURIAL + tally.WIN_SEAL;
  return {
    policy: policyName,
    seeds,
    ...tally,
    wins,
    winRate: +((wins / seeds) * 100).toFixed(1),
    reachedMidnight,
    midnightRate: +((reachedMidnight / seeds) * 100).toFixed(1),
    avgAttackAtMidnight: reachedMidnight ? +(sealAttackSum / reachedMidnight).toFixed(2) : 0,
    avgTurns: +(turns / seeds).toFixed(1),
    // The villager is the ONLY source of 護身符 and a second route to two of
    // the four talismans the seal needs, so "does that route matter" is a
    // question with a number.
    giftsTaken: gifts,
    runsWithAGift: +((runsWithGift / seeds) * 100).toFixed(1),
    giftKinds,
    // Did the compulsory item ever turn up at all?
    everHeldBanner: +((everBanner / seeds) * 100).toFixed(1),
    avgBestAttack: +(bestAttackSum / seeds).toFixed(2),
    errors: errors.slice(0, 5),
  };
}

export const POLICY_NAMES = Object.keys(POLICIES);
