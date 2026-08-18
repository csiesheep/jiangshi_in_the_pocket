// Game page controller — orchestrates the turn sequence (spec §5), wiring user
// input -> engine + board -> render. Owns the RNG seed and the interactive
// flow (rotation, item, combat, flee, cower, zombie-door choices).

import * as E from "./engine.js";
import * as Bd from "./board.js";
import { combatHit, isMuted, setMuted } from "./audio.js";
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
  jumpScare,
  uiIcon,
  formatHour,
  tileName as tName,
  itemName as iName,
} from "./render.js";

const DIR_WORD = { N: "north", E: "east", S: "south", W: "west" };

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
    // Kept for the end-of-run verdict; the engine has no use for them.
    this.tally = { putDown: 0, found: 0 };
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
        return { kind: "move", dir: m.dir, label: `Go ${m.dir} — explore`, sub: "unexplored",
          primary: true, onClick: () => this.doExplore(m.dir) };
      }
      if (m.type === "outside") {
        return { kind: "move", dir: m.dir, label: "Step outside (the arrow door)", sub: "the way out",
          primary: true, onClick: () => this.doOutside(m.dir) };
      }
      const to = this.board.worlds[m.to.world].get(Bd.cellKey(m.to.x, m.to.y));
      return { kind: "move", dir: m.dir, label: `Go ${m.dir} — ${this.tileName(to.id)}`,
        icon: `tile-${to.id}`, onClick: () => this.doMove(m.dir) };
    });
    renderActions(acts, "Choose a way out — you must move.");
  }


  // The tile turns itself. board.pickExploreRotation prefers a placement that
  // keeps a way on into unexplored space, and is deterministic so a shared seed
  // still replays move for move.
  doExplore(dir) {
    const revealed = this.board.decks[this.board.player.world][0];
    const rot = Bd.pickExploreRotation(this.board, dir);
    const r = Bd.explore(this.board, dir, rot);
    if (!r.ok) return this.renderMoves();
    log(`You reveal the ${this.tileName(revealed)} and step inside.`);
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
          kind: "item",
          label: "Search for the item",
          sub: "costs the next card",
          primary: true,
          onClick: () => {
            const c = E.drawCard(this.state);
            if (this.state.status !== "playing" || c == null) return this.gameOver();
            const item = this.state.cardsById[c].item;
            this.takeItemFlow(item, () => this.proceed(ctx));
          },
        },
        { kind: "item", label: "Leave it", sub: "no cost", onClick: () => this.proceed(ctx) },
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
          kind: "fight",
          icon: `item-${w}`,
          label: this.itemName(w),
          sub: `atk ${1 + s.itemsById[w].attack}`,
          primary: true,
          onClick: () => this.doFight(n, w, onDone),
        });
      }
    } else {
      const best = E.chooseWeapon(s);
      acts.push({
        kind: "fight",
        icon: best ? `item-${best}` : null,
        label: `Fight ${n} ${foes}`,
        sub: best ? `with the ${this.itemName(best)}, atk ${E.effectiveAttack(s)}` : "bare-handed",
        primary: true,
        onClick: () => this.doFight(n, null, onDone),
      });
    }

    if (opts.allowFlee !== false) {
      const dests = Bd.listMoves(this.board).filter((m) => m.type === "move" || m.type === "cross");
      for (const d of dests) {
        const to = this.board.worlds[d.to.world].get(Bd.cellKey(d.to.x, d.to.y));
        acts.push({ kind: "flee", dir: d.dir, icon: `tile-${to.id}`,
          label: `Flee ${d.dir} to the ${this.tileName(to.id)}`, sub: "−1 HP",
          onClick: () => this.doFlee(d, false, onDone) });
        if (s.items.includes("oil")) {
          acts.push({
            kind: "flee",
            dir: d.dir,
            icon: "item-oil",
            label: `Flee ${d.dir} — throw the ${this.itemName("oil")}`,
            sub: "no damage",
            onClick: () => this.doFlee(d, true, onDone),
          });
        }
      }
    }

    for (const fuel of ["oil", "gasoline"]) {
      if (s.items.includes("candle") && s.items.includes(fuel)) {
        acts.push({
          kind: "fight",
          icon: `item-${fuel}`,
          label: `${this.itemName("candle")} + ${this.itemName(fuel)}`,
          sub: "burn them all",
          onClick: () => this.doCombo(fuel, onDone, n),
        });
      }
    }

    const prompt = `${n} ${foes}! Your attack is ${E.effectiveAttack(s)}.`;

    // Clear first, then scare, then offer the choices. Emptying the list is what
    // makes the flash safe: the previous step's buttons are gone, so nothing can
    // be clicked and the global number keys have nothing to find while it plays.
    renderActions([]);
    jumpScare(n).then(() => renderActions(acts, prompt));
  }

  doFight(n, weapon, onDone) {
    combatHit(n);
    this.tally.putDown += n;
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

  doCombo(fuel, onDone, n = 0) {
    E.useCandleCombo(this.state, fuel);
    this.tally.putDown += n;
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
          kind: "item",
          label: "Rummage for an item",
          sub: "costs the next card",
          primary: true,
          onClick: () => {
            const c = E.drawCard(this.state);
            if (this.state.status !== "playing" || c == null) return this.gameOver();
            this.takeItemFlow(this.state.cardsById[c].item, () => this.deadEndCheck());
          },
        },
        { kind: "item", label: "Leave empty-handed", sub: "no cost", onClick: () => this.deadEndCheck() },
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
        kind: "draw",
        label: kind === "graveyard" ? "Dig on — draw the burial card" : "Search on — draw the second card",
        sub: "one more card",
        primary: true,
        onClick: () => this.doDrawSecond(kind),
      },
    ];
    if (!(E.HOUSE_RULES.COWER_ONCE_PER_TURN && this.state.coweredThisTurn)) {
      acts.push({ kind: "rest", label: "Cower first", sub: "+3 HP, burn a card",
        onClick: () => this.doCowerBeforeSecond(kind) });
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
      this.tally.found += 1;
      log(`You take the ${this.itemName(item)}.`, "good");
      this.refresh();
      return done();
    }
    const acts = this.state.items.map((held) => ({
      kind: "item",
      icon: `item-${item}`,
      sub: `lose the ${this.itemName(held)}`,
      label: `Drop ${this.itemName(held)}, take ${this.itemName(item)}`,
      onClick: () => {
        E.pickUpItem(this.state, item, held);
        this.tally.found += 1;
        log(`Dropped the ${this.itemName(held)}, took the ${this.itemName(item)}.`);
        this.refresh();
        done();
      },
    }));
    acts.push({ kind: "item", label: `Leave the ${this.itemName(item)}`, sub: "keep what you carry", onClick: done });
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
    log(`Dead end. Three of the ${this.word("monsters")} claw at the walls…`, "bad");
    // The hole is punched after the fight, not before, because where it lands
    // depends on how the fight ends: stand your ground and they come through a
    // wall of this room; run and they follow, and break into the room you
    // reached instead.
    const cameFrom = Bd.currentTile(this.board);
    this.presentCombat(
      E.RULES.ZOMBIE_DOOR_COUNT,
      () => {
        this.breakInWall(cameFrom);
        onDone();
      },
      { allowFlee: true }
    );
  }

  breakInWall(cameFrom) {
    if (this.state.status !== "playing") return;
    const here = Bd.currentTile(this.board);
    // Compared by tile rather than this.fled, which may already be set from an
    // earlier retreat in the same turn.
    const ran = here !== cameFrom;
    // Favours a wall opening onto unexplored space: the hole persists and is
    // how you get out, so one facing tiles already placed would only lead back.
    const wall = Bd.pickZombieDoorWall(this.board);
    if (!wall) return; // nothing blank left to break through
    Bd.openZombieDoor(this.board, wall);
    log(
      ran
        ? `They follow you in through the ${DIR_WORD[wall]} wall of the ${this.tileName(here.id)}.`
        : `They come through the ${DIR_WORD[wall]} wall.`,
      "bad"
    );
    this.refresh();
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
    const acts = [{ kind: "draw", label: "Next turn", sub: "press on", primary: true, onClick: () => this.nextTurn() }];
    if (!(E.HOUSE_RULES.COWER_ONCE_PER_TURN && this.state.coweredThisTurn)) {
      acts.unshift({ kind: "rest", label: "Cower", sub: "+3 HP, burn a card", onClick: () => this.doCower() });
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
    const won = this.state.status === "won";

    const again = [
      { label: "Play again", primary: true, onClick: () => startNewGame() },
      { label: "Replay this seed", onClick: () => startNewGame(this.seed) },
      // A finished run is exactly when someone wants to hand the seed on.
      { label: "Copy replay link", onClick: (btn) => copyReplayLink(btn) },
      { label: "Menu", href: "index.html" },
    ];

    const summary = [
      `Lasted until ${formatHour(this.state.hour)}`,
      `${this.tally.putDown} of the ${this.word("monsters")} put down`,
      `${this.tally.found} ${this.tally.found === 1 ? "item" : "items"} found`,
      won
        ? `The ${this.word("relic")} is buried`
        : this.state.totem
          ? `The ${this.word("relic")} was on you, unburied`
          : `The ${this.word("relic")} was never found`,
      `Seed ${this.seed}`,
    ];

    if (won) {
      showOverlay(
        "You made it to dawn",
        `The ${this.word("relic")} is buried. The house falls silent.`,
        again,
        { tone: "won", summary }
      );
      return;
    }
    const why = {
      combat: "The dead pulled you under.",
      health: "Your wounds were too deep.",
      midnight: "The bell tolls midnight, and the house keeps you.",
    };
    showOverlay(
      this.state.lossReason === "midnight" ? "Midnight" : "You are one of them now",
      why[this.state.lossReason] || "Game over.",
      again,
      { tone: "lost", summary }
    );
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

// ---- Run controls ----------------------------------------------------------
async function copyReplayLink(btn) {
  btn = btn || document.getElementById("btn-copy-seed");
  const url = `${location.origin}${location.pathname}?seed=${game.seed}`;
  try {
    await navigator.clipboard.writeText(url);
    const was = btn.textContent;
    btn.textContent = "Link copied";
    setTimeout(() => (btn.textContent = was), 1800);
  } catch {
    // Clipboard refused (insecure context or denied permission) — put the link
    // in the log so it can still be copied by hand.
    log("Replay link: " + url);
  }
}

// The toggle carries the state, not just a label: a button reading "Mute" tells
// you nothing about whether sound is currently on.
function paintSoundToggle() {
  const btn = document.getElementById("btn-sound");
  if (!btn) return;
  const on = !isMuted();
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const label = document.getElementById("sound-label");
  if (label) label.textContent = on ? "Sound on" : "Sound off";
  const slot = document.getElementById("sound-icon");
  if (slot) {
    slot.textContent = "";
    const art = uiIcon(on ? "sound-on" : "sound-off", "soundicon-svg");
    if (art) slot.appendChild(art);
  }
}

function wireControls() {
  document.getElementById("btn-copy-seed").addEventListener("click", () => copyReplayLink());
  document.getElementById("btn-sound").addEventListener("click", () => {
    setMuted(!isMuted());
    paintSoundToggle();
  });
  // M is off the 1-9 action path on purpose, and ignored while typing.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "m" && e.key !== "M") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    setMuted(!isMuted());
    paintSoundToggle();
  });
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
    wireControls();
    paintSoundToggle();
    startNewGame(seedFromUrl());
  } catch (err) {
    console.error(err);
    log("Failed to start the game — see console.", "bad");
  }
}

main();
