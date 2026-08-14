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
