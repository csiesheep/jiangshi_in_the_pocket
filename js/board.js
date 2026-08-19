// Board model — the dual grid (indoor + outdoor), tile placement, rotation,
// adjacency, the Dining Room -> Patio seam, and zombie-door dead ends.
// Pure logic, no DOM. Shares the seeded RNG with the engine.

import { makeRng, shuffle } from "./engine.js";

export const DIRS = ["N", "E", "S", "W"];
const DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function opposite(dir) {
  return { N: "S", E: "W", S: "N", W: "E" }[dir];
}

// Rotate a single direction by r quarter-turns clockwise (N->E->S->W).
export function rotateDir(dir, r) {
  const n = ((r % 4) + 4) % 4;
  return DIRS[(DIRS.indexOf(dir) + n) % 4];
}

// Rotate a tile's base exits by r.
export function rotatedExits(exits, r) {
  return exits.map((d) => rotateDir(d, r));
}

export function cellKey(x, y) {
  return `${x},${y}`;
}

export function inDir(x, y, dir) {
  const [dx, dy] = DELTA[dir];
  return [x + dx, y + dy];
}

// ---- Tiles -----------------------------------------------------------------
function makeTile(byId, id, world, x, y, rotation) {
  const def = byId[id];
  const tile = {
    id,
    world,
    x,
    y,
    rotation,
    exits: rotatedExits(def.exits, rotation), // doors (or grassy edges outdoors)
    holes: [], // zombie-door openings, added later
    def,
  };
  if (def.exteriorDoor) tile.exteriorDir = rotateDir("N", rotation); // arrow door
  if (def.seam) tile.seamDir = rotateDir(def.seam, rotation);
  return tile;
}

// Every direction you can physically leave a tile by: doors + holes.
export function openings(tile) {
  return [...new Set([...tile.exits, ...tile.holes])];
}

// ---- Setup -----------------------------------------------------------------
export function createBoard(data, opts = {}) {
  const rng = makeRng(opts.seed ?? (Date.now() >>> 0));
  const byId = {};
  for (const d of [...data.tiles.indoor, ...data.tiles.outdoor]) byId[d.id] = d;

  const foyer = data.tiles.indoor.find((d) => d.start);
  const patio = data.tiles.outdoor.find((d) => d.start);

  // Foyer and Patio are set aside (not shuffled): Foyer is placed now, Patio
  // is placed the first time you step outside.
  const board = {
    rng,
    byId,
    worlds: { indoor: new Map(), outdoor: new Map() },
    decks: {
      indoor: shuffle(data.tiles.indoor.filter((d) => !d.start).map((d) => d.id), rng),
      outdoor: shuffle(data.tiles.outdoor.filter((d) => !d.start).map((d) => d.id), rng),
    },
    patioId: patio.id,
    seamPlaced: false,
    seam: null,
    player: { world: "indoor", x: 0, y: 0 },
  };

  board.worlds.indoor.set(cellKey(0, 0), makeTile(byId, foyer.id, "indoor", 0, 0, 0));
  return board;
}

// ---- Queries ---------------------------------------------------------------
export function tileAt(board, world, x, y) {
  return board.worlds[world].get(cellKey(x, y)) || null;
}

export function currentTile(board) {
  const p = board.player;
  return tileAt(board, p.world, p.x, p.y);
}

// Rotations that let a freshly drawn tile be entered from `moveDir`. A normal
// (door) move needs an exit facing back; a hole move places the tile
// wall-to-wall, so any rotation is legal.
export function validExploreRotations(board, moveDir) {
  const tile = currentTile(board);
  const throughHole = tile.holes.includes(moveDir) && !tile.exits.includes(moveDir);
  const deck = board.decks[tile.world];
  if (deck.length === 0) return [];
  const def = board.byId[deck[0]];
  const need = opposite(moveDir);
  const out = [];
  for (let r = 0; r < 4; r++) {
    if (throughHole || rotatedExits(def.exits, r).includes(need)) out.push(r);
  }
  // Dedupe rotations that produce identical exit sets (symmetric tiles).
  const seen = new Set();
  return out.filter((r) => {
    const key = rotatedExits(def.exits, r).slice().sort().join("");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Choose how to turn a freshly drawn tile, so the player is not asked on every
// single explore. Prefers the rotation that leaves the most ways on into
// unexplored space, so a placement does not immediately corner you.
//
// Deterministic on purpose: runs are shareable by seed, so this must not draw
// from the RNG and must pick identically on replay. Highest score wins and ties
// go to the lowest rotation index, both of which depend only on board state.
export function pickExploreRotation(board, moveDir) {
  const rots = validExploreRotations(board, moveDir);
  if (rots.length <= 1) return rots[0] ?? 0;

  const tile = currentTile(board);
  const def = board.byId[board.decks[tile.world][0]];
  const [nx, ny] = inDir(tile.x, tile.y, moveDir);
  const back = opposite(moveDir);

  let best = rots[0];
  let bestScore = -1;
  for (const r of rots) {
    let score = 0;
    for (const d of rotatedExits(def.exits, r)) {
      if (d === back) continue; // that door is the one we just came through
      const [ex, ey] = inDir(nx, ny, d);
      if (!tileAt(board, tile.world, ex, ey)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// Is there any move that reveals a new tile (or crosses outside)? If not, the
// current tile is a dead end and triggers a zombie door.
export function isDeadEnd(board) {
  const tile = currentTile(board);
  // Crossing outside for the first time counts as an escape.
  if (tile.exteriorDir && !board.seamPlaced && tile.world === "indoor") return false;
  const deck = board.decks[tile.world];
  if (deck.length === 0) return true; // nothing left to place this side
  for (const dir of openings(tile)) {
    const [nx, ny] = inDir(tile.x, tile.y, dir);
    if (!tileAt(board, tile.world, nx, ny)) return false; // an unexplored exit -> escape
  }
  return true;
}

// List the legal moves from the current tile.
export function listMoves(board) {
  const tile = currentTile(board);
  const moves = [];

  for (const dir of openings(tile)) {
    // The arrow door is the way between worlds and never an ordinary edge.
    // Before the seam it puts the Veranda down; after, the crossing is pushed
    // below. Letting it fall through to the explore branch once the seam was
    // placed produced a second move on the same direction, and the board can
    // only draw one hotspot per wall — so the crossing became unreachable and
    // the run unwinnable, the Family Plot being outdoors.
    if (dir === tile.exteriorDir && tile.world === "indoor") {
      if (!board.seamPlaced) moves.push({ dir, type: "outside" });
      continue;
    }
    const [nx, ny] = inDir(tile.x, tile.y, dir);
    const neighbor = tileAt(board, tile.world, nx, ny);
    if (!neighbor) {
      if (board.decks[tile.world].length > 0) moves.push({ dir, type: "explore" });
    } else if (connected(tile, neighbor, dir)) {
      moves.push({ dir, type: "move", to: { world: tile.world, x: nx, y: ny } });
    }
  }

  // Cross the seam (either direction) once the Patio is down.
  if (board.seamPlaced && board.seam) {
    const s = board.seam;
    if (tile.world === "indoor" && tile.x === s.indoor.x && tile.y === s.indoor.y) {
      moves.push({ dir: s.indoor.dir, type: "cross", to: { world: "outdoor", ...s.outdoor } });
    } else if (tile.world === "outdoor" && tile.x === s.outdoor.x && tile.y === s.outdoor.y) {
      moves.push({ dir: s.outdoor.dir, type: "cross", to: { world: "indoor", ...s.indoor } });
    }
  }

  return moves;
}

// Two adjacent placed tiles are connected if a hole joins them, or doors face
// each other. A door facing a wall is not a passage.
function connected(a, b, dir) {
  const back = opposite(dir);
  if (a.holes.includes(dir) || b.holes.includes(back)) return true;
  return a.exits.includes(dir) && b.exits.includes(back);
}

// ---- Actions ---------------------------------------------------------------
// Reveal and place a new tile in `moveDir`, then move onto it. Returns the
// placed tile.
export function explore(board, moveDir, rotation) {
  const tile = currentTile(board);
  const deck = board.decks[tile.world];
  if (deck.length === 0) return { ok: false, reason: "no-tiles" };
  if (!validExploreRotations(board, moveDir).includes(rotation)) {
    return { ok: false, reason: "bad-rotation" };
  }
  const [nx, ny] = inDir(tile.x, tile.y, moveDir);
  if (tileAt(board, tile.world, nx, ny)) return { ok: false, reason: "occupied" };

  const id = deck.shift();
  const placed = makeTile(board.byId, id, tile.world, nx, ny, rotation);
  // A breach has two sides. Exploring through one puts a room on the far side
  // of it, and that room has to carry the matching hole — otherwise the way
  // back the rules promise would not exist, and the new room could dead-end on
  // a wall that is actually open.
  if (tile.holes.includes(moveDir)) placed.holes.push(opposite(moveDir));
  board.worlds[tile.world].set(cellKey(nx, ny), placed);
  board.player = { world: tile.world, x: nx, y: ny };
  return { ok: true, tile: placed };
}

// Step into an already-explored, connected neighbour.
export function moveTo(board, moveDir) {
  const move = listMoves(board).find((m) => m.dir === moveDir && (m.type === "move" || m.type === "cross"));
  if (!move) return { ok: false, reason: "no-passage" };
  board.player = { world: move.to.world, x: move.to.x, y: move.to.y };
  return { ok: true };
}

// Step outside for the first time: place the Patio and cross onto it.
export function goOutside(board) {
  const tile = currentTile(board);
  if (!tile.exteriorDir || board.seamPlaced || tile.world !== "indoor") {
    return { ok: false, reason: "no-exterior-door" };
  }
  const patio = makeTile(board.byId, board.patioId, "outdoor", 0, 0, 0);
  board.worlds.outdoor.set(cellKey(0, 0), patio);
  board.seam = {
    indoor: { x: tile.x, y: tile.y, dir: tile.exteriorDir },
    outdoor: { x: 0, y: 0, dir: patio.seamDir },
  };
  board.seamPlaced = true;
  board.player = { world: "outdoor", x: 0, y: 0 };
  return { ok: true, tile: patio };
}

// Choose which wall the risen come through at a dead end. The hole is not
// cosmetic — it persists, and it is how you leave the dead end — so a wall
// facing unexplored space is worth more than one facing tiles already placed,
// which would only ever lead back the way you came.
//
// Deterministic, for the same reason as pickExploreRotation: seeds are
// shareable, so this must not touch the RNG. Ties fall to compass order.
// Returns null when the tile has no blank wall left to break.
export function pickZombieDoorWall(board) {
  const tile = currentTile(board);
  const walls = DIRS.filter((d) => !openings(tile).includes(d));
  if (walls.length <= 1) return walls[0] ?? null;

  let best = walls[0];
  let bestScore = -1;
  for (const d of walls) {
    const [nx, ny] = inDir(tile.x, tile.y, d);
    const score = tileAt(board, tile.world, nx, ny) ? 0 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// Three zombies bash a new hole through a chosen wall of the current tile. The
// wall must currently be closed; the hole persists and is reusable.
export function openZombieDoor(board, dir) {
  const tile = currentTile(board);
  if (openings(tile).includes(dir)) return { ok: false, reason: "not-a-wall" };
  tile.holes.push(dir);
  // Same wall, two sides. If a room is already standing on the other side it
  // gains the mirror hole now; if the space is still empty, explore() puts the
  // mirror on whatever gets placed there. Either way the breach is symmetric in
  // the model, so nothing downstream has to special-case which side asked.
  const [nx, ny] = inDir(tile.x, tile.y, dir);
  const neighbour = tileAt(board, tile.world, nx, ny);
  const back = opposite(dir);
  if (neighbour && !neighbour.holes.includes(back)) neighbour.holes.push(back);
  return { ok: true };
}
