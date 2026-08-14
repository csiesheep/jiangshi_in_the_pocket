// Board model — the dual grid (indoor + outdoor), tile placement, rotation,
// adjacency, the Dining Room -> Patio seam, and zombie-door dead ends.
// Pure logic, no DOM (Phase 2).

export const DIRS = ["N", "E", "S", "W"];

export function opposite(dir) {
  return { N: "S", E: "W", S: "N", W: "E" }[dir];
}

// Apply a rotation r in {0,1,2,3} to a tile's base exits.
export function rotatedExits(exits, r) {
  const shift = ((r % 4) + 4) % 4;
  return exits.map((d) => DIRS[(DIRS.indexOf(d) + shift) % 4]);
}

// --- TODO (Phase 2) ---
// export function createBoard() { ... }              // two grids + seam
// export function placeTile(board, cell, tile, entryDir) { ... }
// export function legalMoves(board, cell) { ... }
// export function isDeadEnd(board, cell) { ... }     // -> zombie door
// export function openZombieDoor(board, cell, dir) { ... }
