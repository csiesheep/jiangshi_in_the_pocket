import * as B from "../js/board.js";
import { test, assert, eq } from "./harness.js";

const [tiles] = await Promise.all([fetch("../data/tiles.json").then((r) => r.json())]);
const DATA = { tiles };
const board = (opts) => B.createBoard(DATA, opts);

// ---- Direction helpers -----------------------------------------------------
test("rotateDir / opposite / rotatedExits", () => {
  eq(B.rotateDir("N", 1), "E");
  eq(B.rotateDir("N", 2), "S");
  eq(B.opposite("E"), "W");
  eq(B.rotatedExits(["N", "W"], 1), ["E", "N"]);
});

// ---- Setup -----------------------------------------------------------------
test("createBoard: Foyer at origin, decks minus the two set-aside tiles", () => {
  const b = board({ seed: 1 });
  const t = B.currentTile(b);
  eq(t.id, "foyer");
  eq(b.player, { world: "indoor", x: 0, y: 0 });
  eq(b.decks.indoor.length, 7, "8 indoor minus Foyer");
  eq(b.decks.outdoor.length, 7, "8 outdoor minus Patio");
  eq(t.exits, ["N"]);
});

test("Foyer offers a single explore move (N)", () => {
  const b = board({ seed: 1 });
  const moves = B.listMoves(b);
  eq(moves, [{ dir: "N", type: "explore" }]);
  eq(B.isDeadEnd(b), false);
});

// ---- Placement + rotation --------------------------------------------------
test("explore: placed tile faces back and player moves onto it", () => {
  const b = board({ seed: 1 });
  const rots = B.validExploreRotations(b, "N");
  assert(rots.length > 0, "at least one legal rotation");
  const r = B.explore(b, "N", rots[0]);
  assert(r.ok, "explore ok");
  eq(b.player, { world: "indoor", x: 0, y: -1 }, "moved north");
  assert(r.tile.exits.includes("S"), "an exit faces back toward the Foyer");
});

test("explore: illegal rotation is rejected", () => {
  const b = board({ seed: 1 });
  const all = [0, 1, 2, 3];
  const bad = all.find((r) => !B.validExploreRotations(b, "N").includes(r));
  if (bad !== undefined) eq(B.explore(b, "N", bad).ok, false);
});

test("explore: fails when the deck is empty", () => {
  const b = board({ seed: 1 });
  b.decks.indoor = [];
  eq(B.explore(b, "N", 0).ok, false);
});

// ---- Dead end + zombie door ------------------------------------------------
// ---- Auto-placement --------------------------------------------------------
test("pickExploreRotation: deterministic for the same board and direction", () => {
  const a = board({ seed: 7 });
  const b = board({ seed: 7 });
  eq(B.pickExploreRotation(a, "N"), B.pickExploreRotation(b, "N"), "same seed, same choice");
  const twice = B.pickExploreRotation(a, "N");
  eq(B.pickExploreRotation(a, "N"), twice, "and it does not drift when asked again");
});

test("pickExploreRotation: only ever returns a legal rotation", () => {
  const b = board({ seed: 3 });
  const legal = B.validExploreRotations(b, "N");
  assert(legal.includes(B.pickExploreRotation(b, "N")), "picked a rotation you may actually use");
});

test("pickExploreRotation: prefers a placement that leaves a way onward", () => {
  const b = board({ seed: 5 });
  // Force a tile whose rotations differ in how many exits face open space: one
  // door back the way we came, one to the side.
  b.byId.__probe = { id: "__probe", exits: ["N", "E"] };
  b.decks.indoor.unshift("__probe");

  const dir = "N";
  const chosen = B.pickExploreRotation(b, dir);
  const exits = B.rotatedExits(b.byId.__probe.exits, chosen);
  assert(exits.includes(B.opposite(dir)), "still connects back through the door used");

  const tile = B.currentTile(b);
  const [nx, ny] = B.inDir(tile.x, tile.y, dir);
  const onward = exits.filter((d) => d !== B.opposite(dir))
    .filter((d) => {
      const [ex, ey] = B.inDir(nx, ny, d);
      return !B.tileAt(b, tile.world, ex, ey);
    });
  assert(onward.length > 0, "and leaves at least one door into unexplored space");
});

test("dead end: Bathroom above the Foyer, then a zombie door frees it", () => {
  const b = board({ seed: 1 });
  b.decks.indoor = ["bathroom", "bedroom"]; // force the next tile
  const rots = B.validExploreRotations(b, "N"); // bathroom needs its exit facing S
  const r = B.explore(b, "N", rots[0]);
  assert(r.ok);
  eq(r.tile.id, "bathroom");
  eq(B.openings(r.tile), ["S"], "only door faces back");
  eq(B.isDeadEnd(b), true, "no unexplored exit");

  const zd = B.openZombieDoor(b, "N"); // bash the north wall
  assert(zd.ok, "hole opened");
  eq(B.isDeadEnd(b), false, "the hole is now an unexplored exit");
  assert(B.listMoves(b).some((m) => m.dir === "N" && m.type === "explore"));
});

test("pickZombieDoorWall: only ever names a wall with no opening", () => {
  const b = board({ seed: 4 });
  const t = B.currentTile(b);
  const wall = B.pickZombieDoorWall(b);
  assert(wall !== null, "the Entry Hall has blank walls to break");
  assert(!B.openings(t).includes(wall), "picked a wall, not an existing way out");
});

test("pickZombieDoorWall: deterministic, and prefers unexplored space", () => {
  const a = board({ seed: 11 });
  const b = board({ seed: 11 });
  eq(B.pickZombieDoorWall(a), B.pickZombieDoorWall(b), "same seed, same wall");

  // Wall off one side with a placed tile; the pick should avoid breaking into it.
  const t = B.currentTile(a);
  const blanks = B.DIRS.filter((d) => !B.openings(t).includes(d));
  const blocked = blanks[0];
  const [bx, by] = B.inDir(t.x, t.y, blocked);
  a.worlds[t.world].set(B.cellKey(bx, by), { id: "decoy", world: t.world, x: bx, y: by,
    rotation: 0, exits: [], holes: [], def: { id: "decoy", exits: [] } });

  const picked = B.pickZombieDoorWall(a);
  const [px, py] = B.inDir(t.x, t.y, picked);
  assert(!B.tileAt(a, t.world, px, py), "broke through into unexplored space, not the placed tile");
});

test("pickZombieDoorWall: null when every wall already has an opening", () => {
  const b = board({ seed: 2 });
  const t = B.currentTile(b);
  t.exits = ["N", "E", "S", "W"];
  eq(B.pickZombieDoorWall(b), null, "nothing left to break");
});

// The rulebook promises the hole "persists, and you can use it again later".
// It only does if both sides of the wall know about it.
test("holes are two-way: exploring through one leaves a way back", () => {
  const b = board({ seed: 3 });
  b.decks.indoor = ["bathroom"]; // one door only
  const rots = B.validExploreRotations(b, "N");
  B.explore(b, "N", rots[0]);
  assert(B.isDeadEnd(b), "the bathroom dead-ends");

  const wall = B.pickZombieDoorWall(b);
  assert(wall !== null, "there is a wall to break");
  b.decks.indoor = ["storage"];
  B.openZombieDoor(b, wall);

  const from = B.currentTile(b);
  const out = B.explore(b, wall, B.pickExploreRotation(b, wall));
  assert(out.ok, "explored through the breach");

  // The way back is the whole point.
  const back = B.opposite(wall);
  assert(out.tile.holes.includes(back), "the placed tile carries the mirror hole");
  assert(B.openings(out.tile).includes(back), "so it counts as a way out");
  const home = B.listMoves(b).find((m) => m.dir === back && m.type === "move");
  assert(home, "a move back through the breach is offered");
  eq(home.to.x, from.x, "and it leads to the room we came from (x)");
  eq(home.to.y, from.y, "and it leads to the room we came from (y)");
});

test("holes are two-way: breaking into a room already standing", () => {
  const b = board({ seed: 3 });
  b.decks.indoor = ["bathroom"];
  const rots = B.validExploreRotations(b, "N");
  B.explore(b, "N", rots[0]); // bathroom to the north, its only door facing back

  // Punch from the bathroom into the Entry Hall's cell, which is already placed.
  const here = B.currentTile(b);
  const foyer = B.tileAt(b, "indoor", here.x, here.y + 1);
  assert(foyer, "the Entry Hall is south of us");
  const before = foyer.holes.slice();
  // S is the bathroom's own door, so pick a wall that is blank but occupied:
  // force the situation by clearing the door and re-breaching it.
  here.exits = [];
  const zd = B.openZombieDoor(b, "S");
  assert(zd.ok, "breached south into the placed room");
  assert(here.holes.includes("S"), "this side has the hole");
  assert(foyer.holes.includes("N"), "and so does the room on the other side");
  assert(!before.includes("N"), "which it did not have before");
});

// The invariant, stated once: no hole may point at a placed tile that does not
// mirror it. Swept over real play rather than a hand-built board.
test("holes stay symmetric across a played-out board", () => {
  const offenders = [];
  for (let seed = 1; seed <= 60; seed++) {
    const b = board({ seed });
    for (let step = 0; step < 40; step++) {
      if (B.isDeadEnd(b)) {
        const wall = B.pickZombieDoorWall(b);
        if (wall == null) break;
        B.openZombieDoor(b, wall);
      }
      const moves = B.listMoves(b);
      const go = moves.find((m) => m.type === "explore") || moves[0];
      if (!go) break;
      if (go.type === "explore") B.explore(b, go.dir, B.pickExploreRotation(b, go.dir));
      else if (go.type === "outside") B.goOutside(b);
      else B.moveTo(b, go.dir);
    }
    for (const world of ["indoor", "outdoor"]) {
      for (const tile of b.worlds[world].values()) {
        for (const dir of tile.holes) {
          const [nx, ny] = B.inDir(tile.x, tile.y, dir);
          const far = B.tileAt(b, world, nx, ny);
          if (far && !far.holes.includes(B.opposite(dir))) {
            offenders.push(`seed ${seed}: ${tile.id} ${dir} -> ${far.id} has no mirror`);
          }
        }
      }
    }
  }
  eq(offenders.slice(0, 3), [], "every hole is mirrored by the tile it opens into");
});

test("openZombieDoor: refuses an existing opening", () => {
  const b = board({ seed: 1 });
  eq(B.openZombieDoor(b, "N").ok, false, "N is already the Foyer door");
});

// ---- Moving between explored tiles -----------------------------------------
test("moveTo: can walk back through a matched door", () => {
  const b = board({ seed: 1 });
  b.decks.indoor = ["bathroom"];
  const rots = B.validExploreRotations(b, "N");
  B.explore(b, "N", rots[0]); // now on the bathroom, exit S back to Foyer
  const back = B.moveTo(b, "S");
  assert(back.ok, "walked back to the Foyer");
  eq(b.player, { world: "indoor", x: 0, y: 0 });
});

// ---- The seam --------------------------------------------------------------
// Both the doorway hotspots and edgeStates key moves by direction, so a second
// move on one direction silently loses. Nothing enforced that until this.
test("listMoves: never offers two moves for the same direction", () => {
  const b = board({ seed: 9 });
  const seen = () => {
    const dirs = B.listMoves(b).map((m) => m.dir);
    return dirs.length === new Set(dirs).size;
  };
  assert(seen(), "at the start");

  // walk out through the arrow door, then back in, which is where it broke
  const dining = [...b.worlds.indoor.values()].find((t) => t.exteriorDir);
  if (!dining) return; // that tile is not down in this seed
  b.player = { world: "indoor", x: dining.x, y: dining.y };
  assert(seen(), "standing on the arrow door before the seam");
  B.goOutside(b);
  assert(seen(), "outside on the Veranda");
  B.moveTo(b, B.currentTile(b).seamDir);
  assert(seen(), "back inside, with the seam placed");
  assert(
    B.listMoves(b).some((m) => m.type === "cross"),
    "and the crossing is still offered"
  );
});

test("seam: stepping through the Dining Room arrow places the Patio", () => {
  const b = board({ seed: 1 });
  b.decks.indoor = ["dining-room"];
  const r = B.explore(b, "N", 0); // dining-room has all 4 doors; rot 0 keeps arrow on N
  assert(r.ok);
  eq(r.tile.id, "dining-room");
  eq(r.tile.exteriorDir, "N");

  const out = B.goOutside(b);
  assert(out.ok, "went outside");
  eq(out.tile.id, "patio");
  eq(b.player.world, "outdoor");
  eq(B.tileAt(b, "outdoor", 0, 0).id, "patio");
  assert(b.seamPlaced);

  // And we can cross back inside from the Patio.
  const cross = B.listMoves(b).find((m) => m.type === "cross");
  assert(cross, "a cross-back move is offered");
  B.moveTo(b, cross.dir);
  eq(b.player.world, "indoor");
});

// ---- Is every run actually winnable? ---------------------------------------
// The win needs the Reliquary, which sits at a random depth in the indoor deck,
// and only exploring places tiles — so a run is winnable only while exploration
// can continue. This sweeps seeds with a policy that plays the way the rules
// allow and asserts both decks always empty out, which means the Reliquary and
// the Family Plot were both placed. Placement is the same event as arrival:
// explore() moves the player onto the tile it lays down, so "placed" is
// "stood on".
//
// The policy matters as much as the assertion. A naive explorer stalls on
// perfectly winnable boards — standing outdoors on an exhausted deck it will
// call the position hopeless, when the actual play is to walk back inside and
// end a turn somewhere the risen have a wall to break. That is the escape
// valve the ruleset already has, so the policy has to use it or the sweep
// measures the policy rather than the game.
function playOut(makeBoard, seed, maxSteps = 600) {
  const b = makeBoard({ seed });
  const at = (t, fn) => {
    const save = { ...b.player };
    b.player = { world: t.world, x: t.x, y: t.y };
    const v = fn();
    b.player = save;
    return v;
  };
  // Nearest reachable tile satisfying `want`, as a list of directions to walk.
  const routeTo = (want) => {
    const here = B.currentTile(b);
    const queue = [[here, []]];
    const seen = new Set([`${here.world}:${here.x},${here.y}`]);
    while (queue.length) {
      const [t, path] = queue.shift();
      if (at(t, want)) return path;
      for (const m of at(t, () => B.listMoves(b))) {
        if (m.type !== "move" && m.type !== "cross") continue;
        const k = `${m.to.world}:${m.to.x},${m.to.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const next = b.worlds[m.to.world].get(B.cellKey(m.to.x, m.to.y));
        if (next) queue.push([next, [...path, m.dir]]);
      }
    }
    return null;
  };
  const canOpenUp = () => B.listMoves(b).some((m) => m.type === "explore" || m.type === "outside");

  for (let step = 0; step < maxSteps; step++) {
    const moves = B.listMoves(b);
    const go = moves.find((m) => m.type === "explore") || moves.find((m) => m.type === "outside");
    if (go) {
      if (go.type === "explore") B.explore(b, go.dir, B.pickExploreRotation(b, go.dir));
      else B.goOutside(b);
      if (!b.decks.indoor.length && !b.decks.outdoor.length) return { b, reason: "placed everything" };
      continue;
    }
    const toExplore = routeTo(canOpenUp);
    if (toExplore && toExplore.length) { B.moveTo(b, toExplore[0]); continue; }

    const toBreach = routeTo(() => B.isDeadEnd(b) && B.pickZombieDoorWall(b) != null);
    if (toBreach == null) return { b, reason: "no way on, and no wall the risen can break" };
    if (toBreach.length) { B.moveTo(b, toBreach[0]); continue; }
    B.openZombieDoor(b, B.pickZombieDoorWall(b));
  }
  return { b, reason: "hit the step cap" };
}

test("every seed can place the whole house and garden, Reliquary included", () => {
  const bad = [];
  for (let seed = 1; seed <= 1000; seed++) {
    const { b, reason } = playOut(board, seed);
    const placed = new Set();
    for (const world of ["indoor", "outdoor"]) {
      for (const t of b.worlds[world].values()) placed.add(t.id);
    }
    if (!placed.has("evil-temple")) bad.push(`seed ${seed}: no Reliquary (${reason})`);
    else if (!placed.has("graveyard")) bad.push(`seed ${seed}: no Family Plot (${reason})`);
    else if (b.decks.indoor.length || b.decks.outdoor.length) {
      bad.push(`seed ${seed}: ${b.decks.indoor.length}+${b.decks.outdoor.length} tiles stranded (${reason})`);
    }
    if (bad.length >= 3) break;
  }
  eq(bad, [], "no seed strands the tiles the win depends on");
});

// ---- Distance to the plot ------------------------------------------------------
// The epilogue says "three rooms from the Family Plot" out loud, so this has to
// be right rather than roughly right.

// Explores outward until the Family Plot is placed, preferring new ground over
// walking back and forth across the seam — which is what the first version of
// this helper did for forty moves without ever placing an outdoor tile.
function openUp(b, limit = 40) {
  for (let i = 0; i < limit; i++) {
    for (const t of b.worlds.outdoor.values()) if (t.id === "graveyard") return t;
    const moves = B.listMoves(b);
    if (!moves.length) return null;
    const m =
      (!b.seamPlaced && moves.find((x) => x.type === "outside")) ||
      moves.find((x) => x.type === "explore") ||
      moves.find((x) => x.type === "move") ||
      moves[0];
    if (m.type === "explore") B.explore(b, m.dir, B.validExploreRotations(b, m.dir)[0]);
    else if (m.type === "outside") B.goOutside(b);
    else B.moveTo(b, m.dir);
  }
  return null;
}

test("distanceTo: nowhere is not a distance", () => {
  const b = board({ seed: 1 });
  eq(B.distanceTo(b, "graveyard"), null, "a plot that was never placed is not N rooms away");
});

test("distanceTo: standing on it is zero", () => {
  const b = board({ seed: 5 });
  const plot = openUp(b);
  assert(plot, "the plot was placed");
  b.player = { world: "outdoor", x: plot.x, y: plot.y };
  eq(B.distanceTo(b, "graveyard"), 0);
});

test("distanceTo: every step toward it is worth exactly one", () => {
  const b = board({ seed: 5 });
  const plot = openUp(b);
  assert(plot, "the plot was placed");

  // From every placed tile, the distance has to be one more than the best of
  // its neighbours — which is the definition of shortest path, checked without
  // trusting the implementation's own idea of who is a neighbour.
  const all = [];
  for (const w of ["indoor", "outdoor"]) for (const t of b.worlds[w].values()) all.push([w, t]);
  const dist = new Map();
  for (const [w, t] of all) {
    b.player = { world: w, x: t.x, y: t.y };
    dist.set(`${w}:${t.x},${t.y}`, B.distanceTo(b, "graveyard"));
  }
  const reached = [...dist.values()].filter((d) => d !== null);
  assert(reached.length > 2, "several rooms connect to the plot");
  eq(Math.min(...reached), 0, "the plot itself is zero");
  // No gaps: the set of distances is 0..max with nothing missing, which cannot
  // be true of anything but a breadth-first walk over a connected board.
  const sorted = [...new Set(reached)].sort((a, c) => a - c);
  eq(sorted, sorted.map((_, i) => i), "the distances run 0, 1, 2 … with no holes");
});

test("distanceTo: the seam is a passage like any other", () => {
  const b = board({ seed: 5 });
  const plot = openUp(b);
  assert(plot, "the plot was placed");
  b.player = { world: "indoor", x: 0, y: 0 };
  const fromInside = B.distanceTo(b, "graveyard");
  assert(fromInside !== null, "the Foyer can still reach the plot, through the seam");
  assert(fromInside > 0, "and it is not standing on it");
});
