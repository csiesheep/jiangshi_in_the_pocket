// Game page controller — wires user input -> engine -> render, owns the RNG
// and save/restore. Currently just loads the data files and confirms the
// scaffold is wired (Phase 3 fills in the real loop).

import { RULES } from "./engine.js";
import { log } from "./render.js";

async function loadData() {
  const [tiles, cards, items, theme] = await Promise.all([
    fetch("data/tiles.json").then((r) => r.json()),
    fetch("data/cards.json").then((r) => r.json()),
    fetch("data/items.json").then((r) => r.json()),
    fetch("data/theme.json").then((r) => r.json()),
  ]);
  return { tiles, cards, items, theme };
}

async function main() {
  try {
    const data = await loadData();
    console.log("zitp: data loaded", data);
    log(
      `Scaffold ready — ${data.tiles.indoor.length} indoor + ` +
        `${data.tiles.outdoor.length} outdoor tiles, ${data.cards.length} cards, ` +
        `${data.items.length} items. Starting Health ${RULES.START_HEALTH}.`
    );
  } catch (err) {
    console.error(err);
    log("Failed to load game data — see console.");
  }
}

main();
