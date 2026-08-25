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
function survive(ctx, plan) {
  const { state } = ctx;
  // 4 is the shared floor. A policy that means to arrive somewhere can raise
  // it — rice heals 3, so eating at 5 is full value and eating at 8 is waste.
  const line = plan && plan.eatAt ? plan.eatAt(state) : 4;
  if (state.health <= line && E.held(state, "sticky-rice")) E.useMedicine(state, "sticky-rice");
  else if (state.poisoned && E.heldCount(state, "sticky-rice") > 1) E.useMedicine(state, "sticky-rice");
}

function fight(ctx, n, plan = {}) {
  const { hoardBanner = true, keepStrike = false } = plan;
  const { state, die } = ctx;
  const hurt = state.health <= 4;
  if (hurt && E.held(state, "black-dog-blood") && E.escapeFight(state).ok) return;
  if (hurt && state.health <= 3) return void E.flee(state);

  const bare = E.combatDamage(n, E.effectiveAttack(state), E.hasCharm(state));
  const use = {};
  const talismans = E.heldIds(state)
    .filter((id) => { const d = state.itemsById[id]; return d && d.cat === "magic" && d.attack; })
    .sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack);
  // Talismans are consumed. A policy saving one for midnight must not reach
  // for it here — winning a corridor fight with the strike is how you arrive
  // at the door holding nothing.
  const reachable = keepStrike ? spendableTalismans(state) : talismans;
  if (bare >= 2 && reachable.length) {
    const pick = reachable[0];
    if (!(state.itemsById[pick].costHp && state.health <= 2)) use.talisman = pick;
  }
  // A duelist hoards the banner for midnight; anyone dying without one may as
  // well spend it.
  if (E.held(state, "soul-banner") && (!hoardBanner || state.health <= 3) && bare >= 3) use.banner = true;
  E.resolveCombat(state, n, use);
  if (state.status === "playing") survive(ctx, plan);
}

// One sword is worth more than anything else you can carry, so everyone buffs
// the best one they have as soon as they can.
function upkeep(ctx, plan) {
  const { state } = ctx;
  const sword = E.equippedWeapon(state);
  const mayBuff = !plan || !plan.buffWhen || plan.buffWhen(state);
  if (mayBuff && sword && !state.buffed[sword] && E.held(state, "truefire-talisman")) {
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
  // Chase the burial. Find the crypt, take the 神主牌, get outdoors, and bury
  // it. The shrine's prayer used to shortcut the hunt for the grave; the
  // post-launch redesign took it, so the ground is turned up the long way now.
  hunter(ctx) {
    const { board, state, data } = ctx;
    const crypt = goalTile(data, "TAKE_TABLET");
    const grave = goalTile(data, "BURY_TABLET");
    if (!state.tablet) {
      if (placed(board, crypt.id)) return { doRites: true, seek: (x) => x.id === crypt.id };
      return { doRites: true, explore: "indoor" };
    }
    if (placed(board, grave.id)) return { doRites: true, seek: (x) => x.id === grave.id };
    return { doRites: true, explore: "outdoor" };
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

  // The same line as the duelist, played by someone who knows the recipe.
  //
  // 七星劍 with a 真火符 burned in is 4; 攝魂幡 doubles that half to 8; a heavy
  // talisman adds 4 or 5. Twelve or thirteen against a bar of twelve, or eleven
  // carrying the 神主牌. Every part is findable — the only question is what each
  // is worth in turns.
  //
  // Three things the first duelist never worked out, and all three are the
  // difference:
  //
  //   1. Searching is not once per room. The banner is one tile in twenty
  //      paying 15 % a rummage, so the play is to STAND on 土地廟 and keep
  //      rummaging, not to wander hoping to cross it. Its table is also 40 %
  //      糯米, so the camp that hunts the banner feeds the camper.
  //   2. Talismans are consumed. Spending the heavy one to win a corridor
  //      fight is how you reach midnight holding nothing.
  //   3. The night has one safe square. 石敢當 draws no event at all, so a
  //      finished kit is carried there and waited out — every turn spent
  //      standing anywhere else is a free draw against a player who has
  //      already won if they simply arrive.
  //
  // It is not an oracle: it never reads the rng, and it plans only against
  // tiles already on the table. Deterministic — it takes no dice of its own.
  adept(ctx) {
    const { board, state, data } = ctx;
    const shrine = [...data.tiles.indoor, ...data.tiles.outdoor].find((t) => t.search === "relic");
    const crypt = goalTile(data, "TAKE_TABLET");
    const base = {
      hoardBanner: true,
      keepStrike: true,
      smartStrike: true,
      eatAt: (s) => (s.hour === 23 ? 6 : 5),
      giveRice: adeptGift,
      dropChoice: adeptDrop,
      replaceChoice: adeptReplace,
      buffWhen: adeptBuff,
    };

    // The adept used to walk off 溪澗 before midnight, because standing in it
    // forfeited the exchange. #56 removed that rule, so the detour is gone too:
    // a player who knows the recipe does not avoid a tile for a reason that no
    // longer exists. This is a deliberate instrument change and it is named in
    // the report rather than left to explain a moved number.

    const want = adeptWants(state);
    const onTable = (table) =>
      [...board.worlds.indoor.values(), ...board.worlds.outdoor.values()]
        .some((t) => t.def.search === table);

    // The 神主牌 drops the bar from twelve to eleven, which is a whole talisman
    // grade — worth a detour, but only while there is night left to spend it in
    // and only if we are actually short.
    if (!state.tablet && placed(board, crypt.id) && state.turn <= 22 &&
        strikeNow(state) < barToClear(state)) {
      return { ...base, doRites: "TAKE_TABLET", seek: (x) => x.id === crypt.id };
    }

    // Past the budget, the banner gets the rest of the night: it is the only
    // part with one source and the worst rate.
    const bannerFirst = want[0] === "relic" && state.turn >= BANNER_DEADLINE;
    const order = bannerFirst ? want : [...want.filter((t) => t !== "relic"), ...want.filter((t) => t === "relic")];

    for (const table of order) {
      if (onTable(table)) return { ...base, seek: (x) => x.def.search === table };
    }

    // Nothing we still need has been turned over. Open new ground — outdoors if
    // the banner is what is missing, because that is the deck the shrine is in.
    if (want.length) return { ...base, explore: want.includes("relic") ? "outdoor" : "any" };

    // The recipe is finished, so the only thing left to lose is the night.
    // 石敢當 draws nothing at all — go and stand on it. This is the redesign's
    // whole answer to where safety comes from: a place you travel to.
    const ward = [...data.tiles.indoor, ...data.tiles.outdoor]
      .find((t) => (t.flags || []).includes("WARDED"));
    if (ward && placed(board, ward.id)) return { ...base, seek: (x) => x.id === ward.id };
    return { ...base, explore: "outdoor" }; // not turned up yet; it is outdoor ground
  },

  // Hide. Find the 溪澗 and stand in it until the clock runs out.
  //
  // WHAT THIS POLICY IS FOR HAS CHANGED, and it is worth saying rather than
  // quietly repointing it. It was built to chase 見到天亮 — stand in running
  // water and the night ends with no exchange. #56 removed the rule and #59
  // retired the ending, so there is nothing at the end of this plan any more.
  //
  // It is kept UNCHANGED on purpose, still seeking the same tile (by id now,
  // since the flag it used is gone). A policy that still does exactly what it
  // did is the evidence: its 31-32 survivals became 31-32 deaths to the King,
  // one for one. Retarget it and that measurement disappears along with the
  // ending. What it measures now is the cost of hiding somewhere that does
  // nothing — which is a real question, and the answer is that you live longer
  // and still lose.
  turtle(ctx) {
    const { board } = ctx;
    const stream = [...board.worlds.outdoor.values()].find((t) => t.id === "stream");
    if (stream) return { seek: (x) => x.id === "stream" };
    return { explore: "outdoor" };
  },

  // Stand on a tile that heals and never leave. The design says this loses;
  // this is the measurement of by how much.
  camper(ctx) {
    const { board } = ctx;
    const heal = [...board.worlds.indoor.values(), ...board.worlds.outdoor.values()]
      .find((t) => t.def.onTurnEnd === "HEAL_1");
    if (heal) return { seek: (x) => x.def.onTurnEnd === "HEAL_1" };
    return { explore: "any" };
  },
};

// ---- The adept's judgement -------------------------------------------------------
// Helpers for the one policy that is trying to play well rather than to
// illustrate a thesis. All of them read only the pack, the clock and the tiles
// already on the table — never the rng, never a tile that has not been turned
// over. A practiced player knows the odds and the map's roles; that is the line
// this stays on.

const STRIKE_IDS = ["blood-talisman", "fivethunder-talisman"];

const bigTalisman = (state) => STRIKE_IDS.find((id) => E.held(state, id)) || null;

// What we would hit for if midnight were now, and what we would need.
function strikeNow(state) {
  const use = { banner: E.held(state, "soul-banner") };
  const tal = bigTalisman(state);
  if (tal) use.talisman = tal;
  return E.attackWith(state, use);
}
const barToClear = (state) =>
  state.tablet ? E.RULES.KING_THRESHOLD_WITH_TABLET : E.RULES.KING_THRESHOLD;

// Talismans are consumed, so anything held in one copy that midnight needs is
// not available to win a corridor fight with. 真火符 is also the buff, so the
// last one is spoken for until the sword has it burned in.
function spendableTalismans(state) {
  return E.heldIds(state)
    .filter((id) => {
      const d = state.itemsById[id];
      if (!d || d.cat !== "magic" || !d.attack) return false;
      if (E.heldCount(state, id) > 1) return true; // 硃砂 bought us a spare
      if (STRIKE_IDS.includes(id)) return false; // this one is for the King
      if (id === "truefire-talisman") {
        const sword = E.equippedWeapon(state);
        return !!(sword && state.buffed[sword]); // already burned in, so free
      }
      return true;
    })
    .sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack);
}

// The ordered list of tables still worth standing on. Empty means the recipe is
// finished and the rest of the night is about arriving alive.
function adeptWants(state) {
  const want = [];
  if (!E.held(state, "soul-banner")) want.push("relic");
  // 七星劍 is the only blade that reaches the bar; more weapon rummages once we
  // hold it find nothing, because a unique you carry comes back empty.
  if (!E.held(state, "sevenstar-sword")) want.push("weapon");
  const sword = E.equippedWeapon(state);
  const buffed = !!(sword && state.buffed[sword]);
  if (!buffed && !E.held(state, "truefire-talisman")) want.push("magic");
  if (!bigTalisman(state)) want.push("magic");
  return want;
}

// The charm is the only damage reduction in the game and the late gifts are
// talismans. All of them beat the band's worst pack, which is what refusing
// buys you.
function adeptGift(state) {
  if (!E.held(state, "sticky-rice")) return false;
  return E.heldCount(state, "sticky-rice") > 1 || state.health >= 7;
}

// Returning null refuses the find, which is the right answer more often than
// the default: a fourth sword is not worth the slot it would cost.
// OFFER_DROP only ever concerns the pack now: weapons and 護身符 go to the
// hands and cost nothing, so the old "shed the junk blade" branch went with the
// rule that made carrying four swords possible.
function adeptDrop(state, incomingId) {
  const ids = E.heldIds(state);
  if (E.heldCount(state, "sticky-rice") > 1) return "sticky-rice";
  const keep = new Set(["soul-banner", bigTalisman(state), "truefire-talisman"].filter(Boolean));
  return ids.find((id) => !keep.has(id)) || null;
}

// OFFER_REPLACE, a question the pack rules never had to answer: one hand, one
// blade, and the one put down is gone for good. Take the better number — and
// the comparison is the ENGINE's, so a 真火符 already burned into the blade in
// hand counts, which is exactly why better steel is sometimes the worse trade.
function adeptReplace(state, offer) {
  return offer.incomingAttack > offer.currentAttack;
}

// Only 七星劍 is worth a 真火符 while there is still night left to find one in.
// A lesser blade gets it once being picky has stopped paying.
function adeptBuff(state) {
  const sword = E.equippedWeapon(state);
  if (!sword) return false;
  return sword === "sevenstar-sword" || state.turn >= 20;
}

// The night's budget. Before this the kit is cheaper to chase indoors, where
// three tiles apiece pay 20-30 %; after it the banner needs every rummage it
// can still get at 15 % from the only tile that has one.
const BANNER_DEADLINE = 11;

// ---- One night ------------------------------------------------------------------
export function playNight(data, policyName, seed, opts = {}) {
  const state = E.newGame(data, { seed });
  const board = B.createBoard(data, { seed });
  const die = E.makeRng((seed ^ 0x2545f491) >>> 0);
  const stats = { gifts: 0, giftIds: [], everHadBanner: false, bestAttack: 0,
                  wardTurns: 0, breachesOnWard: 0,
                  // The pack is the lever now, so the cost of a small pack is
                  // worth counting rather than inferring. `forcedChoices` is
                  // every find that arrived at a full pack; `paidWithFood` is
                  // the subset paid for with 糯米; `starvedAfter` is whether the
                  // run later stood at 3 health or less with no food left.
                  // Together they answer "how often was a run made to give up
                  // something it turned out to need" — approximately, and the
                  // approximation is stated rather than hidden: it counts the
                  // case that actually kills runs, not every possible regret.
                  forcedChoices: 0, paidWithFood: 0, starvedAfter: false };
  const ctx = { state, board, data, die, stats };
  const policy = POLICIES[policyName];

  let guard = 0;
  while (state.status === "playing") {
    if (++guard > 400) throw new Error(`${policyName} seed ${seed}: did not terminate`);
    E.beginTurn(state);
    if (state.status !== "playing") break;

    const plan = policy(ctx) || {};

    // ---- the action: MOVE or STAY, and there is no third
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
    // 石敢當 turns what walks the road: nothing is drawn standing on it.
    const warded = B.isWarded(board);
    if (warded) stats.wardTurns++;
    const ev = E.drawEvent(state, { warded });
    const feed = plan.giveRice ? plan.giveRice(state) : E.heldCount(state, "sticky-rice") > 1;
    const out = E.resolveEvent(state, ev, { giveRice: feed });
    if (out.type === "GIFT") { stats.gifts++; stats.giftIds.push(out.id); }
    if (out.type === "FIGHT") fight(ctx, out.n, plan);

    if (state.status === "playing" && !state.fled) {
      survive(ctx, plan);
      const tile = B.currentTile(board);
      if (tile && tile.def.search) {
        const r = E.search(state, tile.def.search);
        // One weapon ever: taking the new blade leaves the old one behind for
        // good, so this is a real decision even for a bot.
        if (r.result === "OFFER_REPLACE") {
          const take = plan.replaceChoice
            ? plan.replaceChoice(state, r)
            : r.incomingAttack > r.currentAttack;
          // Either way a blade stays on the floor and leaves the night: the old
          // one if we take, the new one if we keep what we have.
          if (take) E.replaceWeapon(state, r.id);
          else E.declineWeapon(state, r.id);
        }
        if (r.result === "OFFER_DROP") {
          // Drop rice before equipment; a sword outlives a meal. A policy may
          // answer null instead, which refuses the find — sometimes the right
          // answer, since a fourth blade is not worth the slot.
          stats.forcedChoices++;
          const spare = plan.dropChoice
            ? plan.dropChoice(state, r.id)
            : (E.held(state, "sticky-rice") ? "sticky-rice" : E.heldIds(state)[0]);
          if (spare === "sticky-rice") stats.paidWithFood++;
          if (spare) E.pickUpItem(state, r.id, spare);
        }
      }
      upkeep(ctx, plan);

      // Only the hunter performs a rite. Everyone else standing in a goal
      // room is standing in an ordinary room — without this the duelist and
      // the turtle won burials by walking past the grave, which measures
      // nothing about either line.
      const goal = plan.doRites ? tile && tile.def.goal : null;
      const riteAllowed = plan.doRites === true || plan.doRites === goal;
      if (goal && riteAllowed && E.riteDraws(state, goal)) {
        const rev = E.riteEvent(state);
        const rfeed = plan.giveRice ? plan.giveRice(state) : E.heldCount(state, "sticky-rice") > 1;
        const rout = E.resolveEvent(state, rev, { giveRice: rfeed });
        if (rout.type === "FIGHT") fight(ctx, rout.n, plan);
        if (state.status === "playing") E.completeRite(state, goal);
      }
    }

    if (state.status === "playing") {
      const n = E.breachAfterEvent(state, { deadEnd: B.isDeadEnd(board), warded });
      // Counted because the amendment is silent on it: the ward stops the
      // EVENT, and 破牆 is not an event draw. If this number is ever large the
      // ward is not the safe square it was ruled to be.
      if (n && warded) stats.breachesOnWard++;
      if (n) {
        const wall = B.pickZombieDoorWall(board);
        if (wall) B.openZombieDoor(board, wall);
        fight(ctx, n, plan);
      }
    }

    const end = B.currentTile(board);
    if (state.status === "playing" && !state.fled && end && end.def.onTurnEnd === "HEAL_1") {
      E.changeHealth(state, 1);
    }

    if (E.held(state, "soul-banner")) stats.everHadBanner = true;
    // Hungry and out of food, at any point after a pack decision. This is the
    // shape "I had to drop something I needed" takes in play.
    if (state.health <= 3 && !E.held(state, "sticky-rice") && stats.paidWithFood > 0) {
      stats.starvedAfter = true;
    }
    stats.bestAttack = Math.max(stats.bestAttack, E.effectiveAttack(state));

    if (state.status !== "playing") break;
    if (state.turn >= E.RULES.TOTAL_TURNS) {
      const here = B.currentTile(board);
      const use = {};
      if (E.held(state, "soul-banner")) use.banner = true;
      const cands = E.heldIds(state)
        .filter((id) => { const d = state.itemsById[id]; return d && d.cat === "magic" && d.attack; })
        .sort((a, b) => state.itemsById[b].attack - state.itemsById[a].attack);
      // 血符 is paid before the strike lands, so at 1 HP the heaviest talisman
      // in the pack is the one that kills you on the doorstep. A policy that
      // knows the rule reaches past it.
      const tal = plan.smartStrike
        ? (cands.find((id) => !((state.itemsById[id].costHp || 0) >= state.health)) || cands[0])
        : cands[0];
      if (tal) use.talisman = tal;
      const atMidnight = E.attackWith(state, use);
      // Captured BEFORE midnight resolves, because resolving it spends the
      // banner. Read afterwards it is false for exactly the runs that used one,
      // which is the opposite of the question being asked.
      const hadBanner = !!use.banner;
      const atWard = B.isWarded(board);
      // The five things the seal needs, recorded one by one so the funnel can
      // say WHICH of them was missing rather than only that the total was short.
      const blade = E.equippedWeapon(state);
      const kit = {
        sevenstar: blade === "sevenstar-sword",
        buffed: !!(blade && state.buffed[blade]),
        banner: !!use.banner,
        heavyTalisman: use.talisman === "blood-talisman" || use.talisman === "fivethunder-talisman",
        tablet: !!state.tablet,
      };
      const r = E.midnight(state, { use });
      return finish(state, board, { atMidnight, threshold: r.threshold, hadBanner, atWard, kit, ...stats });
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
export function run(data, policyName, seeds = 1000, from = 1, opts = {}) {
  // Four endings since #59 retired 見到天亮. Enumerated rather than tolerant:
  // an outcome that is not one of these lands in `errors` and is meant to.
  const tally = { WIN_BURIAL: 0, WIN_SEAL: 0, LOSS_HEALTH: 0, LOSS_KING: 0 };
  let reachedMidnight = 0;
  let bannerAtMidnight = 0;
  let sealAttackSum = 0;
  let turns = 0;
  let gifts = 0;
  let runsWithGift = 0;
  let everBanner = 0;
  let wardTurns = 0;
  let forcedChoices = 0;
  let paidWithFood = 0;
  let starvedRuns = 0;
  let breachesOnWard = 0;
  let wardedAtMidnight = 0;
  let bestAttackSum = 0;
  const giftKinds = {};
  const errors = [];
  for (let seed = from; seed < from + seeds; seed++) {
    try {
      const r = playNight(data, policyName, seed, opts);
      if (r.outcome in tally) tally[r.outcome]++;
      else errors.push(`seed ${seed}: outcome ${r.outcome}`);
      turns += r.turn;
      gifts += r.gifts || 0;
      if (r.gifts) runsWithGift++;
      for (const g of r.giftIds || []) giftKinds[g] = (giftKinds[g] || 0) + 1;
      if (r.everHadBanner) everBanner++;
      wardTurns += r.wardTurns || 0;
      forcedChoices += r.forcedChoices || 0;
      paidWithFood += r.paidWithFood || 0;
      if (r.starvedAfter) starvedRuns++;
      breachesOnWard += r.breachesOnWard || 0;
      if (r.atWard) wardedAtMidnight++;
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
    batch: `${from}..${from + seeds - 1}`,
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
    // Did the policy actually use the night's one safe square, and did the
    // breach reach it anyway?
    avgWardTurns: +(wardTurns / seeds).toFixed(2),
    // The pack's cost, per run.
    forcedChoicesPerRun: +(forcedChoices / seeds).toFixed(2),
    paidWithFoodPerRun: +(paidWithFood / seeds).toFixed(2),
    starvedAfterDropping: +((starvedRuns / seeds) * 100).toFixed(1),
    breachesOnWard,
    wardedAtMidnight,
    avgBestAttack: +(bestAttackSum / seeds).toFixed(2),
    errors: errors.slice(0, 5),
  };
}

export const POLICY_NAMES = Object.keys(POLICIES);
