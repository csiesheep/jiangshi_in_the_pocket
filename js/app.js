// Game page controller — orchestrates the turn sequence (spec §5), wiring user
// input -> engine + board -> render. Owns the RNG seed and the interactive
// flow (rotation, item, combat, flee, cower, zombie-door choices).

import * as E from "./engine.js";
import * as Bd from "./board.js";
import {
  renderHud,
  renderBoard,
  renderActions,
  log,
  clearLog,
  showOverlay,
  hideOverlay,
  loadIcons,
  animateEntry,
  tileName as tName,
  itemName as iName,
} from "./render.js";

// `no-cache` forces a revalidation rather than a blind cache hit: it still
// costs only a 304 when nothing changed, but it means a re-theme or a rules fix
// actually reaches players who already have the old data cached.
const FETCH_OPTS = { cache: "no-cache" };

async function loadData() {
  const [tiles, cards, items, theme] = await Promise.all(
    ["tiles", "cards", "items", "theme"].map((name) =>
      fetch(`data/${name}.json`, FETCH_OPTS).then((r) => {
        if (!r.ok) throw new Error(`data/${name}.json -> HTTP ${r.status}`);
        return r.json();
      })
    )
  );
  return { tiles, cards, items, theme };
}

class Game {
  constructor(data, opts = {}) {
    this.data = data;
    const seed = opts.seed ?? (Date.now() >>> 0);
    this.seed = seed;
    this.state = E.newGame(data, { seed });
    this.board = Bd.createBoard(data, { seed });
    this.fled = false;
  }

  tileName(id) { return tName(this, id); }
  itemName(id) { return iName(this, id); }

  // Themed nouns, so nothing player-visible is hardcoded to one setting.
  word(key) { return (this.data.theme.words && this.data.theme.words[key]) || key; }

  // The flavour line for a card in the current hour band, if the skin has one.
  flavour(cardId) {
    const f = this.data.theme.cardFlavour;
    const byCard = f && f[cardId];
    return (byCard && byCard[E.bandKey(this.state)]) || null;
  }

  refresh() { renderHud(this); renderBoard(this); }

  start() {
    E.beginTurn(this.state);
    this.refresh();
    clearLog();
    log(
      `You wake in the ${this.tileName("foyer")}. Find the ${this.word("relic")}, ` +
        `bury it in the ${this.tileName("graveyard")} before midnight.`
    );
    this.renderMoves();
  }

  // ---- Step 1: choose a move (mandatory) -----------------------------------
  renderMoves() {
    if (this.state.status !== "playing") return this.gameOver();
    const moves = Bd.listMoves(this.board);
    if (!moves.length) {
      log("Nowhere left to go…", "bad");
      return this.zombieDoorPhase(() => this.endTurn());
    }
    const acts = moves.map((m) => {
      if (m.type === "explore") {
        return { label: `Go ${m.dir} — explore`, primary: true, onClick: () => this.chooseRotation(m.dir) };
      }
      if (m.type === "outside") {
        return { label: "Step outside (the arrow door)", primary: true, onClick: () => this.doOutside(m.dir) };
      }
      const to = this.board.worlds[m.to.world].get(Bd.cellKey(m.to.x, m.to.y));
      return { label: `Go ${m.dir} — ${this.tileName(to.id)}`, onClick: () => this.doMove(m.dir) };
    });
    renderActions(acts, "Choose a way out — you must move.");
  }

  chooseRotation(dir) {
    const deck = this.board.decks[this.board.player.world];
    const def = this.board.byId[deck[0]];
    const rots = Bd.validExploreRotations(this.board, dir);
    if (rots.length <= 1) return this.doExplore(dir, rots[0] ?? 0);
    const acts = rots.map((r) => ({
      label: `Doors: ${Bd.rotatedExits(def.exits, r).join(" ")}`,
      onClick: () => this.doExplore(dir, r),
    }));
    renderActions(acts, `You reveal the ${this.tileName(deck[0])}. Turn it which way?`);
  }

  doExplore(dir, rot) {
    const r = Bd.explore(this.board, dir, rot);
    log(`You enter the ${this.tileName(r.tile.id)}.`);
    this.refresh();
    animateEntry(dir);
    this.arriveAndDraw();
  }

  doMove(dir) {
    Bd.moveTo(this.board, dir);
    log(`You move to the ${this.tileName(Bd.currentTile(this.board).id)}.`);
    this.refresh();
    animateEntry(dir);
    this.arriveAndDraw();
  }

  doOutside(dir) {
    Bd.goOutside(this.board);
    log(`You step out onto the ${this.tileName("patio")}. Night air, and worse.`);
    this.refresh();
    if (dir) animateEntry(dir);
    this.arriveAndDraw();
  }

  // ---- Steps 3–4: draw and resolve a development card ----------------------
  arriveAndDraw() {
    const c = E.drawCard(this.state);
    if (this.state.status !== "playing" || c == null) return this.gameOver();
    this.refresh();
    this.presentCard(c, { second: false });
  }

  presentCard(cardId, ctx) {
    const o = this.state.cardsById[cardId][E.bandKey(this.state)];
    const flavour = this.flavour(cardId);
    if (flavour) log(flavour);

    if (o.t === "EVENT") {
      E.changeHealth(this.state, o.hp || 0);
      if (o.hp) log(`${o.hp > 0 ? "+" : ""}${o.hp} HP.`, o.hp > 0 ? "good" : "bad");
      this.refresh();
      if (this.state.status === "lost") return this.gameOver();
      return this.proceed(ctx);
    }

    if (o.t === "ZOMBIES") {
      return this.presentCombat(o.n, () => this.proceed(ctx), { allowFlee: true });
    }

    // ITEM
    renderActions(
      [
        {
          label: "Search for the item",
          primary: true,
          onClick: () => {
            const c = E.drawCard(this.state);
            if (this.state.status !== "playing" || c == null) return this.gameOver();
            const item = this.state.cardsById[c].item;
            this.takeItemFlow(item, () => this.proceed(ctx));
          },
        },
        { label: "Leave it", onClick: () => this.proceed(ctx) },
      ],
      "Worth the time to grab it?"
    );
  }

  // ---- Combat (shared by card monsters and zombie doors) -------------------
  presentCombat(n, onDone, opts = {}) {
    const s = this.state;
    const foes = this.word("monsters");
    const usable = E.usableWeapons(s);
    const acts = [];

    if (usable.length > 1) {
      for (const w of usable) {
        acts.push({
          label: `Fight with the ${this.itemName(w)} (atk ${1 + s.itemsById[w].attack})`,
          primary: true,
          onClick: () => this.doFight(n, w, onDone),
        });
      }
    } else {
      acts.push({ label: `Fight ${n} ${foes}`, primary: true, onClick: () => this.doFight(n, null, onDone) });
    }

    if (opts.allowFlee !== false) {
      const dests = Bd.listMoves(this.board).filter((m) => m.type === "move" || m.type === "cross");
      for (const d of dests) {
        const to = this.board.worlds[d.to.world].get(Bd.cellKey(d.to.x, d.to.y));
        acts.push({ label: `Flee ${d.dir} to the ${this.tileName(to.id)} (-1 HP)`, onClick: () => this.doFlee(d, false, onDone) });
        if (s.items.includes("oil")) {
          acts.push({
            label: `Flee ${d.dir} — throw the ${this.itemName("oil")} (no damage)`,
            onClick: () => this.doFlee(d, true, onDone),
          });
        }
      }
    }

    for (const fuel of ["oil", "gasoline"]) {
      if (s.items.includes("candle") && s.items.includes(fuel)) {
        acts.push({
          label: `${this.itemName("candle")} + ${this.itemName(fuel)} — burn them all`,
          onClick: () => this.doCombo(fuel, onDone),
        });
      }
    }

    renderActions(acts, `${n} ${foes}! Your attack is ${E.effectiveAttack(s)}.`);
  }

  doFight(n, weapon, onDone) {
    const r = E.resolveCombat(this.state, n, { weapon });
    log(
      `You fight ${n} ${this.word("monsters")} — ${weapon ? "with the " + this.itemName(weapon) : "bare-handed"} — and take ${r.damage} damage.`,
      r.damage >= 3 ? "bad" : ""
    );
    this.refresh();
    if (this.state.status === "lost") return this.gameOver();
    onDone();
  }

  doFlee(move, useOil, onDone) {
    Bd.moveTo(this.board, move.dir);
    E.flee(this.state, { useOil });
    this.fled = true;
    log(
      useOil
        ? `You hurl the ${this.itemName("oil")} and slip away, unscathed.`
        : "You flee, taking a parting swipe (-1 HP)."
    );
    this.refresh();
    animateEntry(move.dir);
    if (this.state.status === "lost") return this.gameOver();
    onDone();
  }

  doCombo(fuel, onDone) {
    E.useCandleCombo(this.state, fuel);
    log(
      fuel === "oil"
        ? `You torch the room — every one of the ${this.word("monsters")} drops.`
        : "Whoomph — the room ignites. All clear.",
      "good"
    );
    this.refresh();
    onDone();
  }

  // ---- Step 6: the tile's own instructions --------------------------------
  proceed(ctx) {
    if (this.state.status !== "playing") return this.gameOver();

    if (ctx && ctx.second) {
      const tile = Bd.currentTile(this.board);
      if (ctx.kind === "temple" && !this.fled && tile.def.onResolve === "SECOND_CARD_THEN_GAIN_TOTEM") {
        E.gainTotem(this.state);
        log(`Among the bones, the ${this.word("relic")}. It is yours.`, "good");
      }
      if (ctx.kind === "graveyard" && !this.fled && this.state.totem) {
        E.buryTotem(this.state);
      }
      this.refresh();
      if (this.state.status === "won") return this.gameOver();
      return this.deadEndCheck();
    }

    return this.afterCardSpecial();
  }

  afterCardSpecial() {
    if (this.fled) return this.deadEndCheck();
    const onr = Bd.currentTile(this.board).def.onResolve;
    if (onr === "BONUS_ITEM") return this.offerBonusItem();
    if (onr === "SECOND_CARD_THEN_GAIN_TOTEM") {
      return this.drawSecond("temple", `You start searching the ${this.tileName("evil-temple")}…`);
    }
    if (onr === "SECOND_CARD_THEN_BURY_TOTEM") {
      return this.drawSecond("graveyard", "You break ground, and begin the burial…");
    }
    return this.deadEndCheck();
  }

  offerBonusItem() {
    renderActions(
      [
        {
          label: "Rummage for an item",
          primary: true,
          onClick: () => {
            const c = E.drawCard(this.state);
            if (this.state.status !== "playing" || c == null) return this.gameOver();
            this.takeItemFlow(this.state.cardsById[c].item, () => this.deadEndCheck());
          },
        },
        { label: "Leave empty-handed", onClick: () => this.deadEndCheck() },
      ],
      `The ${this.tileName("storage")} — worth a rummage?`
    );
  }

  // The Reliquary and Family Plot resolve a second card. The designer ruled the
  // gap between the two "behaves like an ordinary fresh turn", so you may cower
  // there — and that allowance is its own, separate from the end-of-turn one.
  drawSecond(kind, msg) {
    log(msg);
    E.openCowerWindow(this.state);
    this.promptSecondCard(kind);
  }

  promptSecondCard(kind) {
    if (this.state.status !== "playing") return this.gameOver();
    const acts = [
      {
        label: kind === "graveyard" ? "Dig on — draw the burial card" : "Search on — draw the second card",
        primary: true,
        onClick: () => this.doDrawSecond(kind),
      },
    ];
    if (!(E.HOUSE_RULES.COWER_ONCE_PER_TURN && this.state.coweredThisTurn)) {
      acts.push({ label: "Cower first — +3 HP, burn a card", onClick: () => this.doCowerBeforeSecond(kind) });
    }
    renderActions(acts, "One more card to face. Take a breath first?");
  }

  doCowerBeforeSecond(kind) {
    const r = E.cower(this.state);
    if (r.ok) log("You hole up and breathe. +3 HP — a card slips away unseen.", "good");
    this.refresh();
    // Burning that card can empty the deck, turn the hour, and even end the run.
    if (this.state.status !== "playing") return this.gameOver();
    this.promptSecondCard(kind);
  }

  doDrawSecond(kind) {
    const c = E.drawCard(this.state);
    if (this.state.status !== "playing" || c == null) return this.gameOver();
    this.refresh();
    this.presentCard(c, { second: true, kind });
  }

  takeItemFlow(item, done) {
    if (E.hasItemSpace(this.state)) {
      E.pickUpItem(this.state, item);
      log(`You take the ${this.itemName(item)}.`, "good");
      this.refresh();
      return done();
    }
    const acts = this.state.items.map((held) => ({
      label: `Drop ${this.itemName(held)}, take ${this.itemName(item)}`,
      onClick: () => {
        E.pickUpItem(this.state, item, held);
        log(`Dropped the ${this.itemName(held)}, took the ${this.itemName(item)}.`);
        this.refresh();
        done();
      },
    }));
    acts.push({ label: `Leave the ${this.itemName(item)}`, onClick: done });
    renderActions(acts, `Your hands are full. Make room for the ${this.itemName(item)}?`);
  }

  // ---- Step 7: dead-end / zombie door -------------------------------------
  deadEndCheck() {
    if (this.state.status !== "playing") return this.gameOver();
    this.refresh();
    if (Bd.isDeadEnd(this.board)) return this.zombieDoorPhase(() => this.endTurn());
    return this.endTurn();
  }

  zombieDoorPhase(onDone) {
    const tile = Bd.currentTile(this.board);
    const walls = ["N", "E", "S", "W"].filter((d) => !Bd.openings(tile).includes(d));
    log(`Dead end. Three of the ${this.word("monsters")} claw at the walls…`, "bad");
    if (!walls.length) return this.presentCombat(E.RULES.ZOMBIE_DOOR_COUNT, onDone, { allowFlee: true });
    renderActions(
      walls.map((d) => ({
        label: `Let them break the ${d} wall`,
        onClick: () => {
          Bd.openZombieDoor(this.board, d);
          this.refresh();
          this.presentCombat(E.RULES.ZOMBIE_DOOR_COUNT, onDone, { allowFlee: true });
        },
      })),
      "Choose the wall they smash through:"
    );
  }

  // ---- Steps 8–9: end of turn (heal, cower) -------------------------------
  endTurn() {
    if (this.state.status !== "playing") return this.gameOver();
    const tile = Bd.currentTile(this.board);
    if (!this.fled && tile.def.onTurnEnd === "HEAL_1") {
      E.changeHealth(this.state, 1);
      log(`You steady yourself here. +1 HP.`, "good");
      this.refresh();
    }
    // Step 9 gets its own cower allowance, independent of one taken between a
    // Reliquary / Family Plot pair.
    E.openCowerWindow(this.state);
    this.renderEndTurn();
  }

  // Split out from endTurn so cowering can re-render the choices without
  // re-running step 8 — which would hand out the Kitchen / Herb Garden heal a
  // second time.
  renderEndTurn() {
    const acts = [{ label: "Next turn", primary: true, onClick: () => this.nextTurn() }];
    if (!(E.HOUSE_RULES.COWER_ONCE_PER_TURN && this.state.coweredThisTurn)) {
      acts.unshift({ label: "Cower — +3 HP, burn a card", onClick: () => this.doCower() });
    }
    renderActions(acts, "The room is quiet. Rest, or press on?");
  }

  doCower() {
    const r = E.cower(this.state);
    if (r.ok) log("You hole up and breathe. +3 HP — a card slips away unseen.", "good");
    this.refresh();
    if (this.state.status === "lost") return this.gameOver();
    this.renderEndTurn();
  }

  nextTurn() {
    E.beginTurn(this.state);
    this.fled = false;
    this.refresh();
    this.renderMoves();
  }

  // ---- End states ----------------------------------------------------------
  gameOver() {
    this.refresh();
    renderActions([]);
    const again = [
      { label: "Play again", primary: true, onClick: () => startNewGame() },
      { label: `Replay this seed (${this.seed})`, onClick: () => startNewGame(this.seed) },
      { label: "Menu", href: "index.html" },
    ];
    if (this.state.status === "won") {
      showOverlay(
        "You made it to dawn",
        `The ${this.word("relic")} is buried. The house falls silent.`,
        again
      );
    } else {
      const why = {
        combat: "The dead pulled you under.",
        health: "Your wounds were too deep.",
        midnight: "Midnight came, and with it the end.",
      };
      showOverlay("You didn't make it", why[this.state.lossReason] || "Game over.", again);
    }
  }
}

// ---- Page-level state ------------------------------------------------------
// `data` is fetched once; every run after the first reuses it, so restarting is
// synchronous and needs no reload.
let data = null;
let game = null;

function startNewGame(seed) {
  hideOverlay();
  game = new Game(data, seed != null ? { seed } : {});
  window.__game = game; // handy for debugging
  const el = document.getElementById("seed-value");
  if (el) el.textContent = game.seed;
  game.start();
}

function seedFromUrl() {
  const raw = new URLSearchParams(location.search).get("seed");
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : null;
}

// ---- Zoom ------------------------------------------------------------------
// The view is one room plus a peek at its neighbours, so zoom is the size of
// that room. 170px is the CSS default and reads as 100%.
const ZOOM_STEPS = [110, 140, 170, 210, 250];
const ZOOM_DEFAULT = 170;
let zoomIndex = ZOOM_STEPS.indexOf(ZOOM_DEFAULT);

function applyZoom() {
  const px = ZOOM_STEPS[zoomIndex];
  document.documentElement.style.setProperty("--tile", px + "px");
  const label = document.getElementById("zoom-label");
  if (label) label.textContent = Math.round((px / ZOOM_DEFAULT) * 100) + "%";
  const out = document.getElementById("btn-zoom-out");
  const inn = document.getElementById("btn-zoom-in");
  if (out) out.disabled = zoomIndex === 0;
  if (inn) inn.disabled = zoomIndex === ZOOM_STEPS.length - 1;
}

function zoom(delta) {
  zoomIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex + delta));
  applyZoom();
}

// ---- Run controls ----------------------------------------------------------
async function copyReplayLink() {
  const btn = document.getElementById("btn-copy-seed");
  const url = `${location.origin}${location.pathname}?seed=${game.seed}`;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Link copied";
    setTimeout(() => (btn.textContent = "Copy replay link"), 1800);
  } catch {
    // Clipboard refused (insecure context or denied permission) — put the link
    // in the log so it can still be copied by hand.
    log("Replay link: " + url);
  }
}

function wireControls() {
  document.getElementById("btn-zoom-out").addEventListener("click", () => zoom(-1));
  document.getElementById("btn-zoom-in").addEventListener("click", () => zoom(1));
  document.getElementById("btn-copy-seed").addEventListener("click", copyReplayLink);
  document.getElementById("btn-new-game").addEventListener("click", () => {
    // Drop ?seed= so a shared link doesn't silently reapply to the fresh run.
    if (location.search) history.replaceState(null, "", location.pathname);
    startNewGame();
  });
}

async function main() {
  try {
    // Icons are decorative, so a failed sprite must not block the game.
    [data] = await Promise.all([loadData(), loadIcons()]);
    // The view spans about 1.84 rooms wide, so start smaller on a phone.
    if (window.innerWidth < 600) zoomIndex = ZOOM_STEPS.indexOf(140);
    applyZoom();
    wireControls();
    startNewGame(seedFromUrl());
  } catch (err) {
    console.error(err);
    log("Failed to start the game — see console.", "bad");
  }
}

main();
