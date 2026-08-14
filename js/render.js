// Rendering — draws the board, HUD and log from game state. No game logic
// lives here; it only reflects state into the DOM (Phase 3).

export function renderHud(state) {
  // TODO: reflect health / attack / hour / items / totem into #hud-*
}

export function renderBoard(state) {
  // TODO: draw the sprawling tile grid into #board (pan/zoom)
}

export function log(msg) {
  const el = document.getElementById("log");
  if (!el) return;
  const p = document.createElement("p");
  p.textContent = msg;
  el.prepend(p);
}
