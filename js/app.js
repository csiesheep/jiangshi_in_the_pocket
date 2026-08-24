// Game page controller — orchestrates the turn, wiring user input -> engine +
// board -> render. Owns the RNG seed.
//
// The turn, in the order §8 sets out: the poison tick, one action — move, stay
// or cower — then the room answers with an event, then the rite if this room
// has one, then the breach if there is nowhere on, then the search, then six
// minutes off the clock. Cowering is the exception that proves the order: it
// ends the turn where it stands, buying the one event-free turn in the game.
//
// Most of that is arithmetic and lives in the engine. Two things are not: a
// fight and a villager come back from resolveEvent unresolved, because both are
// decisions, and decisions belong to whoever is talking to the player. This
// file is where they are asked.

import * as E from "./engine.js";
import * as Bd from "./board.js";
import { isMuted, setMuted, isCalm, setCalm, relicFound, seamCross, verdictSting,
         startAmbience, stopAmbience, stopScore, itemPickup, tollBell,
         watchDrum, paperFlutter, kingArrives, combatHit } from "./audio.js";
import {
  renderHud,
  renderBoard,
  renderActions,
  clearChoices,
  darkDoorBeat,
  settleDust,
  phantom,
  candleGutter,
  standing,
  clearStage,
  mountFilmStock,
  showNote,
  log,
  clearLog,
  showOverlay,
  hideOverlay,
  loadIcons,
  watchBoardSize,
  animateEntry,
  uiIcon,
  formatHour,
  tileName as tName,
  itemName as iName,
  showDropDialog,
  onPackUse,
  caption,
  jumpScare,
  resolveBeat,
  damageCameFrom,
  breakInTelegraph,
  breakInCracks,
  breakInPressure,
  breakInCollapse,
  breakInClear,
  buryBeat,
  cowerScene,
  showCinnabarDialog,
} from "./render.js";

import { registerWorker, wireFullscreen, keepAwake, wireSleep } from "./shell.js";
import { recordVerdict } from "./tally.js";
import { epilogue } from "./epilogue.js";

const DIR_WORD = { N: "north", E: "east", S: "south", W: "west" };

// How long the turn holds when something unexplained was put on the board. The
// cues themselves live longer than this — the phantom 2.6s, the figure 9s — but
// they are mounted inside the board, and the next turn rebuilds it. This is the
// window in which they are actually visible, so it is the number that matters.
const CUE_BEAT_MS = 1500;

// How long a search result sits before the turn moves on. Shorter than a cue:
// finding nothing is the common case and must not become a wait.
const FIND_BEAT_MS = 850;

// Coming up empty, said six ways. Picked by turn number rather than at random —
// a replayed seed has to say the same thing in the same room, and the search
// stream is not to be disturbed for flavour.
const EMPTY_HANDED = [
  "You turn the room over and come up with nothing.",
  "Dust, and a drawer that was already open.",
  "Somebody has been through here before you.",
  "Nothing worth carrying.",
  "You put your hands into the dark and find the dark.",
  "Nothing here but the room.",
];

// The room's own beat, between walking in and the room answering. The event
// line is read in this gap; without it the sentence and the damage land
// together and the sentence is the half that gets skipped.
const EVENT_BEAT_MS = 780;

// And after a result, before the turn moves on. Shorter — by then the HUD has
// already shown the number and this is only stopping it being instant.
const RESULT_BEAT_MS = 620;

// The wall coming in, staged. Four beats: the knock, the cracks, something
// leaning on it, and the collapse. The counts are the engine's (3/4/5 by band);
// these are only how long each stage is given.
// The drum, and the silence after it. Longer than any other beat in the game
// on purpose: this is the appointment the whole night has been walking toward,
// and it is the one moment nothing is being asked of the player.
const MIDNIGHT_TOLL_MS = 2100;

const BREACH_KNOCK_MS = 1250;
const BREACH_CRACK_MS = 900;
const BREACH_PRESS_MS = 950;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// The event's line, by type and band. HP splits by the sign of hp — one
// sentence cannot serve both a cold room that bites and a stub of incense still
// warm — which is why the theme keys those apart when the engine does not.
function eventKey(ev) {
  if (!ev) return "NOTHING";
  if (ev.t === "HP") return ev.hp < 0 ? "HP_LOSS" : "HP_GAIN";
  return ev.t;
}

// `no-cache` forces a revalidation rather than a blind cache hit: it still
// costs only a 304 when nothing changed, but it means a re-theme or a rules fix
// actually reaches players who already have the old data cached.
const FETCH_OPTS = { cache: "no-cache" };

async function loadData() {
  // cards.json is gone. The development deck was the source game's whole engine
  // — clock, events and items in one 9-card table — and the jiangshi set splits
  // it into three tables that are read independently: search rolls (§4), the
  // event pool by band (§5), and item definitions. Nothing draws a card any
  // more, so nothing fetches one.
  const names = ["tiles", "items", "search", "events", "theme"];
  const [tiles, items, search, events, theme] = await Promise.all(
    names.map((name) =>
      fetch(`data/${name}.json`, FETCH_OPTS).then((r) => {
        if (!r.ok) throw new Error(`data/${name}.json -> HTTP ${r.status}`);
        return r.json();
      })
    )
  );
  return { tiles, items, search, events, theme };
}

class Game {
  constructor(data, opts = {}) {
    this.data = data;
    const seed = opts.seed ?? (Date.now() >>> 0);
    this.seed = seed;
    this.state = E.newGame(data, { seed });
    this.board = Bd.createBoard(data, { seed });
    // Kept for the end-of-run verdict; the engine has no use for them.
    this.tally = { putDown: 0, found: 0 };
    // One search per turn, and turn 1 has not had its yet.
    this.searched = false;
    // Set by 躲藏, cleared with it. A cowered turn draws nothing, so there is
    // nothing to search after and nothing to heal from.
    this.cowered = false;
  }

  tileName(id) { return tName(this, id); }
  itemName(id) { return iName(this, id); }

  // Themed nouns, so nothing player-visible is hardcoded to one setting.
  word(key) { return (this.data.theme.words && this.data.theme.words[key]) || key; }

  refresh() { renderHud(this); renderBoard(this); }

  start() {
    E.beginTurn(this.state);
    this.refresh();
    clearLog();
    // Both rooms named from the data: where you are standing, and the one tile
    // that carries the burial. Nothing here knows what either is called.
    const goal = this.data.tiles.outdoor.find((d) => d.goal === "BURY_TABLET");
    log(
      `You wake in the ${this.tileName(Bd.currentTile(this.board).id)}. Find the ${this.word("relic")}` +
        (goal ? `, bury it in the ${this.tileName(goal.id)}` : "") +
        ` before midnight.`
    );
    this.renderMoves();
  }

  // ---- Step 1: choose an action --------------------------------------------
  // MOVE, STAY or COWER. Movement is optional in this game, unlike the source
  // it came from — but standing still costs a turn exactly like walking does,
  // so there is no free turn and STAY is always on the table, dead end or not.
  // All three are drawn on the board rather than in the panel: they are the
  // same rank of choice and belong in the same place.
  renderMoves() {
    if (this.state.status !== "playing") return this.gameOver();
    const acts = Bd.listMoves(this.board).map((m) => {
      if (m.type === "explore") {
        return { kind: "move", dir: m.dir, label: `Go ${m.dir} — explore`, sub: "unexplored",
          primary: true, onClick: () => this.doExplore(m.dir) };
      }
      if (m.type === "outside") {
        return { kind: "move", dir: m.dir, label: "Step out through the moon gate", sub: "the way out",
          primary: true, onClick: () => this.doOutside(m.dir) };
      }
      const to = this.board.worlds[m.to.world].get(Bd.cellKey(m.to.x, m.to.y));
      return { kind: "move", dir: m.dir, label: `Go ${m.dir} — ${this.tileName(to.id)}`,
        icon: `tile-${to.id}`, onClick: () => this.doMove(m.dir) };
    });
    // kind "stay", not "rest": render.js draws this one on the board with the
    // doorways, and "rest" would send the whole step to the action panel.
    acts.push({ kind: "stay", label: "Stay where you are", sub: "costs the turn",
      primary: acts.length === 0, onClick: () => this.doStay() });

    // 躲藏. Offered every turn, including with nothing left to spend — then it
    // is inert and says why. What it buys is the only event-free turn in the
    // game, which is worth more the later it gets, and a player who never sees
    // the control has no way to learn that.
    const charges = this.state.cowerCharges;
    const slots = E.RULES.COWER_CHARGES + (this.state.cowerRestored ? 1 : 0);
    acts.push({
      kind: "cower",
      label: this.actionWord("COWER"),
      sub: charges > 0
        ? `skips this room's event · ${charges} left`
        : "no charges left — the incense is out",
      disabled: charges <= 0,
      charges,
      slots,
      onClick: () => this.doCower(),
    });
    renderActions(acts, "Move on, stay put, or hide — each spends six minutes.");
  }

  // The theme's name for a mechanic, minus the English gloss: the controls are
  // narrow and "躲藏" reads better on one than the full "躲藏 Cower" string.
  actionWord(key) {
    const named = (this.data.theme.actions || {})[key] || key;
    return String(named).split(" ")[0];
  }

  // Cowering is a whole action and ends the turn, but it is the one action that
  // draws no event — that IS the item. So it skips the room's answer and goes
  // straight to the end of the turn: no event, no rite, no breach.
  doCower() {
    const r = E.cower(this.state);
    if (!r.ok) return this.renderMoves(); // no charges: the control was inert
    clearChoices();
    this.refresh();
    const outdoors = Bd.currentTile(this.board).world === "outdoor";
    this.tell(`You put yourself in a corner of the ${this.tileName(Bd.currentTile(this.board).id)} and go still.`);
    cowerScene(outdoors).then(() => {
      log(`Whatever was coming went past. ${r.charges} ${r.charges === 1 ? "charge" : "charges"} left.`);
      if (this.state.status !== "playing") return this.gameOver();
      // Straight to the end of the turn. Nothing was drawn, so there is nothing
      // to have rummaged after either — the same rule running follows.
      this.cowered = true;
      this.renderEndTurn();
    });
  }

  // STAY is a whole action. It ends in the same place every other one does, so
  // the room's own instructions and the end of the turn still run.
  doStay() {
    log(`You wait in the ${this.tileName(Bd.currentTile(this.board).id)}.`);
    this.arrive();
  }


  // The tile turns itself. board.pickExploreRotation prefers a placement that
  // keeps a way on into unexplored space, and is deterministic so a shared seed
  // still replays move for move.
  doExplore(dir) {
    // peekTile, not decks[0]: an answered prayer brings a tile up from inside
    // the stack, and the line in the log has to name the room actually placed.
    const revealed = Bd.peekTile(this.board, this.board.player.world);
    const rot = Bd.pickExploreRotation(this.board, dir);
    const r = Bd.explore(this.board, dir, rot);
    if (!r.ok) return this.renderMoves();
    log(`You reveal the ${this.tileName(revealed)} and step inside.`);

    // The engine has already placed the room. What waits is the sight of it:
    // the door opens onto black, holds, and only then does the light get there.
    // Choices go first, so a mashed key during the beat finds nothing — the
    // same rule the scare and the resolution beat follow.
    clearChoices();
    darkDoorBeat(dir, E.dread(this.state)).then(() => {
      this.refresh();
      animateEntry(dir);
      this.arrive();
    });
  }

  doMove(dir) {
    // Crossing the seam is a move like any other to the board, but it is the
    // one that changes world — worth hearing, in both directions.
    const from = Bd.currentTile(this.board).world;
    Bd.moveTo(this.board, dir);
    if (Bd.currentTile(this.board).world !== from) seamCross();
    log(`You move to the ${this.tileName(Bd.currentTile(this.board).id)}.`);
    this.refresh();
    animateEntry(dir);
    this.arrive();
  }

  doOutside(dir) {
    const out = Bd.goOutside(this.board);
    seamCross();
    log(`You step out onto the ${this.tileName(out.tile.id)}. Night air, and worse.`);
    this.refresh();
    if (dir) animateEntry(dir);
    this.arrive();
  }

  // ---- Arrival -------------------------------------------------------------
  // Nothing is drawn. The event pool is not designed, so arriving somewhere is
  // just arriving: the room's own instructions, then the end of the turn.
  // ---- Steps 3 to 5: what the room does about you --------------------------
  // In order, and the order is load-bearing (§8): the room's own event, then
  // the rite if this room has one to perform, then the breach if there is
  // nowhere on from here. A dead-end goal room can therefore be three fights in
  // one turn, and nothing about that is a bug — it is the worst square on the
  // board being the worst square on the board.
  //
  // Running cuts the rest of it short at whatever point it happens. You are not
  // standing here any more: there is no rite left to finish, no wall to come
  // through at you, no room to rummage and no quiet corner to steady yourself
  // in. Checked after every step rather than once, because any of them can be
  // the one you ran from.
  async arrive() {
    if (this.state.status !== "playing") return this.gameOver();
    this.refresh();

    await this.eventBeat();
    if (this.state.status !== "playing") return this.gameOver();
    if (this.state.fled) return this.renderEndTurn();

    await this.riteBeat();
    if (this.state.status !== "playing") return this.gameOver();
    if (this.state.fled) return this.renderEndTurn();

    await this.breachBeat();
    if (this.state.status !== "playing") return this.gameOver();
    if (this.state.fled) return this.renderEndTurn();

    return this.endTurn(this.ghostBeat());
  }

  // Both registers at once. The log is a screen-reader live region and carries
  // no pixels; the caption is over the board and is aria-hidden precisely
  // because the log already said it. Neither is optional — dropping either one
  // loses the line for half the players.
  //
  // Reserved for the writing, not the arithmetic: numbers go to log() alone,
  // because the HUD already shows those and a caption repeating them is a
  // second copy of something nobody missed.
  tell(line, tone = "") {
    if (!line) return;
    log(line, tone);
    caption(line, tone);
  }

  eventLine(ev) {
    const table = (this.data.theme.events || {})[eventKey(ev)] || {};
    return table[E.bandKey(this.state)] || "";
  }

  // ---- Step 3: the room answers --------------------------------------------
  // Drawn with replacement, so the same thing can happen twice in a row and
  // nothing is ever used up — it is a distribution, not a deck.
  async eventBeat() {
    if (this.state.status !== "playing") return;
    const ev = E.drawEvent(this.state);
    if (!ev) return;

    this.tell(this.eventLine(ev));
    await wait(EVENT_BEAT_MS);

    // The villager is asked before anything is resolved: whether you give the
    // rice is an input to resolveEvent, not a reaction to it.
    if (ev.t === "VILLAGER") return this.villagerBeat(ev);

    // Read before resolving: resolveEvent is what sets the flag, so asking
    // afterwards can only ever answer "yes".
    const wasPoisoned = this.state.poisoned;
    const res = E.resolveEvent(this.state, ev);
    if (res.type === "FIGHT") return this.fightBeat(res.n);
    if (res.type === "POISON") return this.poisonBeat(wasPoisoned);
    if (res.type === "HP") {
      this.refresh(); // the hearts move, and a loss flashes the board on its own
      log(res.hp > 0 ? `+${res.hp} health.` : `${res.hp} health.`, res.hp > 0 ? "good" : "bad");
      if (this.state.status !== "playing") return;
      return wait(RESULT_BEAT_MS);
    }
    return wait(RESULT_BEAT_MS);
  }

  // 中毒 arrives once and does not stack, so the onset line is only true the
  // first time. Already poisoned, the draw is a nothing — and saying "屍毒 is in
  // your blood now" to someone who has been grey for six turns would be the
  // game losing track of its own fiction.
  async poisonBeat(wasPoisoned) {
    if (wasPoisoned) {
      this.refresh();
      return wait(RESULT_BEAT_MS);
    }
    this.refresh();
    this.tell((this.data.theme.poison || {}).onset || "");
    return wait(RESULT_BEAT_MS);
  }

  // ---- The rites -----------------------------------------------------------
  // Taking the tablet and burying it are what the map is for, and each costs an
  // extra event drawn where you stand. That is the price the rulebook left open
  // and the spec closed: not a turn — an event. So a rite at nine o'clock is
  // usually a held breath, and the same rite at eleven is a real risk.
  //
  // riteDraws() is asked first, and it is what keeps standing on the grave
  // without the tablet free: there is nothing to bury, so there is no rite, so
  // nothing is drawn at you for it.
  async riteBeat() {
    const goal = Bd.currentTile(this.board).def.goal;
    if (!goal || !E.riteDraws(this.state, goal)) return;

    this.tell(
      goal === "BURY_TABLET"
        ? "You kneel and begin to dig. The ground here gives too easily."
        : "The lid is not nailed down. Something in the room objects."
    );
    await wait(EVENT_BEAT_MS);

    await this.eventBeat();
    if (this.state.status !== "playing") return;
    // Running from the rite's own event aborts it — the source's rule was that
    // you only came away with it if you were still standing there when it was
    // over. Retryable: walk back and pay for another event.
    if (this.state.fled) {
      this.tell("You ran. What you came here to do is still undone.");
      return;
    }

    const r = E.completeRite(this.state, goal);
    if (!r.ok) return;

    if (goal === "TAKE_TABLET") {
      relicFound();
      this.tally.found += 1;
      this.tell(`Among the coffins, the ${this.word("relic")}. It is yours.`, "good");
      this.refresh();
      return wait(RESULT_BEAT_MS);
    }
    // A burial ends the run. gameOver is reached from arrive(), which checks
    // status the moment this returns; the beat here is the spade going in.
    this.refresh();
    return buryBeat("graveyard");
  }

  // ---- 破牆, the breach -----------------------------------------------------
  // Two separate things happen at a dead end and it is worth keeping them
  // apart. The wall opening is TOPOLOGY: without it every tile behind this one
  // is stranded and the crypt or the grave may never reach the table, so it
  // happens whatever else does. What comes through the hole is the EVENT, and
  // it scales with the band — the same corner is three of them at nine and five
  // at eleven.
  //
  // The engine owns "and so what": breachAfterEvent returns 0 when you ran,
  // which is the whole reason fleeing a dead end works. The board owns "is this
  // a dead end". This only stages what the two of them already decided.
  async breachBeat() {
    if (this.state.status !== "playing") return;
    if (!Bd.isDeadEnd(this.board)) return;

    const wall = Bd.pickZombieDoorWall(this.board);
    const n = E.breachAfterEvent(this.state, { deadEnd: true, fled: this.state.fled });

    // Nowhere on and nothing coming: the wall still has to give, or the run is
    // stuck standing here. No telegraph for it — nothing is arriving.
    if (!n) {
      if (wall) {
        Bd.openZombieDoor(this.board, wall);
        this.tell(`Nowhere on from here — until the ${DIR_WORD[wall]} wall gives way.`);
        this.refresh();
        await wait(RESULT_BEAT_MS);
      }
      return;
    }

    if (!wall) return; // no wall to give: nothing can come through one

    // The knock, the cracks, something leaning on it, and then the wall. Said
    // out loud one beat before it happens, which is the difference between a
    // stat event and a horror beat.
    this.tell(`Something is working at the ${DIR_WORD[wall]} wall.`);
    breakInTelegraph(wall);
    await wait(BREACH_KNOCK_MS);
    breakInCracks(wall);
    await wait(BREACH_CRACK_MS);
    breakInPressure();
    await wait(BREACH_PRESS_MS);

    Bd.openZombieDoor(this.board, wall);
    this.refresh();
    breakInCollapse(wall);
    breakInClear();

    return this.fightBeat(n, { from: wall });
  }

  // The turn is done and nothing real is happening — the one place a phantom is
  // allowed to fire. Rolled at a fixed point rather than on a timer, because a
  // shared seed has to hear the same house.
  //
  // Returns whether anything was mounted ONTO THE BOARD, which matters because
  // the next turn rebuilds .focus from nothing: a phantom lives inside a
  // half-room and the standing figure inside an empty slot, so both are
  // destroyed by the very next render. The guttering candle is not counted — it
  // is a class on <body> and survives the rebuild on its own.
  ghostBeat() {
    // Not rolled at all in calm mode, rather than rolled and discarded, so
    // toggling calm mid-run does not change what a seed does afterwards.
    if (isCalm()) return false;
    let cued = false;
    const fear = E.dread(this.state);
    const dir = E.rollPhantom(this.state, fear);
    if (dir) { phantom(dir); cued = true; }
    // The candle fails on its own schedule, and always when a phantom fires:
    // the two together are one event — something moved, and the light went with
    // it — where separately they are two effects.
    if (dir || E.rollGutter(this.state, fear)) candleGutter();
    // Once a run at the outside, and never on the same beat as a phantom: two
    // unexplained things at once is a haunting, and one is a doubt. standing()
    // returns true only when it actually put a figure in a dark slot — it
    // declines in calm mode, under reduced motion, and when every slot already
    // has a room in it. Only a figure that exists needs a beat.
    if (!dir && E.rollStanding(this.state, fear) && standing()) cued = true;
    return cued;
  }

  // ---- The fight -----------------------------------------------------------
  // A JIANGSHI event comes back unresolved because it is a decision: which
  // blade, whether to burn the banner, whether to write a talisman in your own
  // blood, or whether to simply be somewhere else. attackWith() prices every
  // one of those for free, so the window can show what each costs in hearts
  // before anything is spent, and resolveCombat() is the one call that spends.
  //
  // Opening this window consumes nothing. A player who reads every option and
  // takes the free one has spent exactly nothing, which is the property the
  // whole preview/commit split exists to protect.
  fightBeat(n, opts = {}) {
    return new Promise((resolve) => {
      damageCameFrom(opts.from || null);
      // The scare deposits them and the window is what it leaves behind.
      // Choices are cleared first so a key mashed during it finds nothing —
      // the same rule the dark door and the search beat follow.
      clearChoices();
      jumpScare(n, false, { from: opts.from || null }).then(() => {
        if (this.state.status !== "playing") return resolve();
        this.paintFight(n, opts, resolve);
      });
    });
  }

  // Every loadout worth offering, priced. Built by crossing (banner or not)
  // with (each talisman, or none), then dropping the ones that spend strictly
  // more for no less damage.
  //
  // That filter is what makes the window honest rather than merely complete.
  // Damage is clamped to 0..4, so loadouts collide constantly: if the sword
  // alone already takes you to nothing, then burning 五雷符 on top of it also
  // takes you to nothing, and listing both is offering a trap dressed as a
  // choice. An option survives only when no cheaper one — spending a strict
  // subset of the same things — matches or beats it.
  //
  // 硃砂 is excluded by having no `attack`: it copies a talisman rather than
  // being one, and there is nothing to throw.
  fightOptions(n) {
    const s = this.state;
    const charm = E.hasCharm(s);
    const talismans = E.heldIds(s).filter((id) => {
      const d = s.itemsById[id];
      return d && d.cat === "magic" && d.attack != null;
    });
    const banners = E.held(s, "soul-banner") ? [false, true] : [false];

    const raw = [];
    for (const banner of banners) {
      for (const talisman of [null, ...talismans]) {
        const use = {};
        if (banner) use.banner = true;
        if (talisman) use.talisman = talisman;
        const def = talisman ? s.itemsById[talisman] : null;
        // 血符 is paid in blood on top of whatever the pack does to you, so the
        // hearts on the card have to carry both or the card is lying.
        const blood = def && def.costHp ? def.costHp : 0;
        const attack = E.attackWith(s, use);
        raw.push({
          use,
          attack,
          blood,
          spends: [...(banner ? ["soul-banner"] : []), ...(talisman ? [talisman] : [])],
          damage: E.combatDamage(n, attack, charm) + blood,
        });
      }
    }

    const kept = raw.filter(
      (o) =>
        !raw.some(
          (b) =>
            b !== o &&
            b.damage <= o.damage &&
            b.spends.length < o.spends.length &&
            b.spends.every((id) => o.spends.includes(id))
        )
    );
    // Spending nothing first, then the upgrades by how much they buy you.
    // Sorting by damage instead would put the seductive nothing-touches-you
    // card at the top and bury the free one at the bottom, which is a strange
    // thing for the list to recommend when the sword was always going to be the
    // default — it is also what `primary` and the 1 key point at.
    return kept.sort((a, b) => a.spends.length - b.spends.length || a.damage - b.damage);
  }

  loadoutLabel(o, sword) {
    const spent = o.spends.map((id) => this.itemName(id));
    if (!spent.length) {
      return sword ? `Fight with the ${this.itemName(sword)}` : "Fight bare-handed";
    }
    return spent.join(" and ");
  }

  paintFight(n, opts, done) {
    const s = this.state;
    const sword = E.bestSword(s);

    const acts = this.fightOptions(n).map((o) => ({
      kind: "fight",
      label: this.loadoutLabel(o, sword),
      // The arithmetic, said out loud. Combat is fully deterministic, so there
      // is nothing to hide and no reason to make anyone do it in their head.
      sub: o.blood ? `attack ${o.attack} · ${o.blood} of it your own` : `attack ${o.attack}`,
      icon: sword ? `item-${sword}` : null,
      cost: { hp: -o.damage },
      primary: o.spends.length === 0,
      onClick: () => this.doFight(n, o, opts, done),
    }));

    // 黑狗血: no damage, no blade, and they simply do not find you. Strictly
    // better than running, which is correct — that is what the item is for.
    if (E.held(s, "black-dog-blood")) {
      acts.push({
        kind: "escape",
        label: this.itemName("black-dog-blood"),
        sub: "they lose you entirely",
        cost: { hp: 0 },
        onClick: () => this.doEscape(done),
      });
    }

    // Running: one step, through a real connection, into somewhere already
    // known. The 1 HP is a price rather than a wound, which is why 護身符 does
    // not touch it.
    for (const m of Bd.listMoves(this.board)) {
      if (m.type !== "move" && m.type !== "cross") continue;
      const to = this.board.worlds[m.to.world].get(Bd.cellKey(m.to.x, m.to.y));
      acts.push({
        kind: "flee",
        dir: m.dir,
        label: `Run ${m.dir} — ${this.tileName(to.id)}`,
        sub: "the turn ends where you land",
        cost: { hp: -E.RULES.RUN_AWAY_DAMAGE },
        onClick: () => this.doFlee(m.dir, done),
      });
    }

    // `health` is what marks a card lethal, and it is read here rather than
    // baked in above: it can move mid-window, and a card that would kill you
    // has to say so at the moment you are looking at it.
    renderActions(acts, `${n} of them.`, { pack: n, health: s.health });
  }

  async doFight(n, o, opts, done) {
    const s = this.state;
    clearChoices();
    damageCameFrom(opts.from || null);
    const r = E.resolveCombat(s, n, o.use);

    // 血符 is written in your own blood and paid before the blow lands. When it
    // takes the last of you there is no fight at all — you never made the
    // strike, and the pack is still standing when the run ends.
    if (r.diedPaying) {
      paperFlutter();
      this.refresh();
      this.tell(
        `You write the ${this.itemName("blood-talisman")} and there is not enough of you left to finish it.`,
        "toll"
      );
      await wait(RESULT_BEAT_MS);
      return done();
    }

    // Paper first, then the swing. Keyed off what resolveCombat actually
    // consumed rather than off what was chosen, so a loadout that never got to
    // spend its talisman never rustles one.
    if (r.spent.some((id) => (s.itemsById[id] || {}).cat === "magic")) paperFlutter();
    // The blow itself. combatHit has existed since the fork and nothing ever
    // called it, so every fight in this game has resolved in silence — the
    // scare arrived, the pack fell over, and the swing made no sound at all.
    // The weapon id picks the layer over the impact, so a 桃木劍 and a 七星劍
    // do not land the same.
    combatHit(n, r.weaponId);
    await resolveBeat({ icon: r.weaponId ? `item-${r.weaponId}` : null });
    this.refresh();
    for (const id of r.spent) log(`${this.itemName(id)} is spent.`);
    log(r.damage ? `${r.damage} damage.` : "They do not touch you.", r.damage ? "bad" : "good");
    if (s.status !== "playing") return done();
    await wait(RESULT_BEAT_MS);
    return done();
  }

  async doEscape(done) {
    clearChoices();
    const r = E.escapeFight(this.state, { vsKing: false });
    if (!r.ok) return done(); // nothing held: the card should not have been there
    await resolveBeat({ mode: "flee" });
    this.refresh();
    this.tell(`You break the ${this.itemName("black-dog-blood")} over the floor. They lose you in it.`);
    await wait(RESULT_BEAT_MS);
    return done();
  }

  async doFlee(dir, done) {
    clearChoices();
    // The hit comes from the way you turned your back on.
    damageCameFrom(dir);
    E.flee(this.state);
    await resolveBeat({ mode: "flee" });
    const from = Bd.currentTile(this.board).world;
    Bd.moveTo(this.board, dir);
    if (Bd.currentTile(this.board).world !== from) seamCross();
    this.refresh();
    if (this.state.status !== "playing") return done();
    animateEntry(dir);
    this.tell(`You run ${DIR_WORD[dir]}, into the ${this.tileName(Bd.currentTile(this.board).id)}.`);
    await wait(RESULT_BEAT_MS);
    return done();
  }

  // ---- The villager --------------------------------------------------------
  // The one event that asks a question. Rice buys the stranger; refusing leaves
  // you with whatever was chasing them — the band's worst pack.
  //
  // There is deliberately no drop prompt on the gift, and it is worth saying
  // why rather than guarding for a case that cannot arise: the rice you just
  // gave away was one slot, and the thanks costs one, or none at all when it is
  // a talisman you already hold. Giving is exactly what makes the room for it.
  async villagerBeat(ev) {
    const t = this.data.theme.villager || {};

    // No rice, no question. The engine would refuse the gift anyway, and asking
    // something whose only answer is no is worse than not asking.
    if (!E.held(this.state, "sticky-rice")) {
      const res = E.resolveEvent(this.state, ev, { giveRice: false });
      this.tell("You have nothing to give them.");
      await wait(RESULT_BEAT_MS);
      return this.fightBeat(res.n);
    }

    const give = await this.askVillager(ev, t);
    const res = E.resolveEvent(this.state, ev, { giveRice: give });

    if (res.type === "GIFT") {
      itemPickup(res.id);
      this.refresh();
      this.tally.found += 1;
      this.tell(String(t.gave || "").replace("{gift}", this.itemName(res.id)), "good");
      return wait(RESULT_BEAT_MS);
    }

    this.tell(t.refused || "");
    await wait(RESULT_BEAT_MS);
    return this.fightBeat(res.n);
  }

  askVillager(ev, t) {
    return new Promise((resolve) => {
      // What refusing costs, as you stand — no spends, current blade. It is the
      // honest floor rather than a promise: the fight that follows still lets
      // you burn something to bring it down.
      const bare = E.combatDamage(
        ev.turnsInto,
        E.effectiveAttack(this.state),
        E.hasCharm(this.state)
      );
      renderActions(
        [
          {
            kind: "give",
            label: t.give || "Give the rice",
            sub: `spends one ${this.itemName("sticky-rice")}`,
            primary: true,
            onClick: () => { clearChoices(); resolve(true); },
          },
          {
            kind: "refuse",
            label: t.refuse || "Keep it",
            sub: `${ev.turnsInto} of them, as you stand`,
            cost: { hp: -bare },
            onClick: () => { clearChoices(); resolve(false); },
          },
        ],
        t.ask || "",
        { health: this.state.health }
      );
    });
  }

  // ---- End of turn ---------------------------------------------------------
  endTurn(cued = false) {
    if (this.state.status !== "playing") return this.gameOver();
    const tile = Bd.currentTile(this.board);
    if (tile.def.onTurnEnd === "HEAL_1") {
      E.changeHealth(this.state, 1);
      // A room that heals is the game's "not this time", so it buys a turn of
      // release. Slightly less of one: it is a counting room, not an escape.
      E.grantRelief(this.state, 0.7);
      log(`You steady yourself here. +1 HP.`, "good");
      this.refresh();
    }
    this.renderEndTurn(cued);
  }

  // What the end of a turn is still worth stopping for. Search is the first of
  // these to come back: it is free, it costs no turn, and it happens after the
  // room's event — so it belongs here, between the event and the clock.
  endTurnChoices() {
    const choices = [];
    // Nothing to rummage after. Running means no event was drawn where you
    // landed (§8); cowering means no event was drawn at all (§7). Either way
    // the turn is already over — and cowering explicitly buys no healing
    // either, which is why it never reaches endTurn().
    if (this.state.fled || this.cowered) return choices;
    const tile = Bd.currentTile(this.board);
    const table = tile && tile.def && tile.def.search;
    // One search per turn. Rummaging the same room again is what STAY is for,
    // and the price of it is the event that STAY draws — not the search.
    if (table && !this.searched) {
      const cat = this.categoryName(table);
      choices.push({
        kind: "search",
        label: "搜索 Search the room",
        sub: cat,
        onClick: () => this.doSearch(table),
      });
    }

    // The two rooms that do something for you, free and once per run. They cost
    // no turn on purpose (§8): both are already gated twice over — once by the
    // once, once by the walk it took to get here — so charging a turn on top
    // would tax the same thing twice and make a late detour never worth making.
    const action = tile && tile.def && tile.def.action;
    if (action === "RESTORE_COWER_ONCE" && !this.state.cowerRestored) {
      choices.push({
        kind: "tileaction",
        label: `${this.actionWord("COWER")} — light the coil`,
        sub: "one more charge, once tonight",
        onClick: () => this.doRestoreCower(),
      });
    }
    // canPray answers for the whole thing: the right room, unspent, and the
    // ground still in the stack. Asked rather than re-derived, so an offered
    // prayer never refuses.
    if (action === "PRAY_ONCE" && Bd.canPray(this.board)) {
      choices.push({
        kind: "tileaction",
        label: "祈求 Ask the land god",
        sub: "the next ground you turn up is the grave",
        onClick: () => this.doPray(),
      });
    }
    return choices;
  }

  doRestoreCower() {
    const r = E.restoreCowerCharge(this.state);
    if (!r.ok) return this.renderEndTurn();
    relicFound();
    this.refresh();
    this.tell("You light the last coil. It will buy you one more corner to hide in.", "good");
    this.renderEndTurn();
  }

  doPray() {
    const r = Bd.pray(this.board);
    if (!r.ok) return this.renderEndTurn();
    relicFound();
    this.refresh();
    this.tell(`You ask, and the land god answers. The next ground you turn up outside is the ${this.tileName(r.target)}.`, "good");
    this.renderEndTurn();
  }

  // The category as the theme names it, minus the English gloss — the action
  // card is narrow and "武器 Weapon" reads better on it than the full string.
  categoryName(table) {
    const named = (this.data.theme.categories || {})[table] || table;
    return String(named).split(" ")[0];
  }

  // One draw, whatever comes of it. There is no re-roll anywhere in here: a run
  // that finds nothing and a run that finds a sword have spent the same
  // randomness, which is what keeps a shared seed in step.
  doSearch(table) {
    this.searched = true;
    const out = E.search(this.state, table);
    renderActions([]);

    if (out.result === "TOOK") {
      log(`You turn the room over. ${iName(this, out.id)}.`, "good");
      this.refresh();
      return void setTimeout(() => this.renderEndTurn(), FIND_BEAT_MS);
    }

    if (out.result === "OFFER_DROP") {
      log(`${iName(this, out.id)}, and nowhere to put it.`);
      return showDropDialog(this, out.id, {
        onDrop: (dropId, foundId) => this.takeInstead(foundId, dropId),
        onDropStack: (dropId, n, foundId) => {
          // A stack is one slot however deep it is, so dropping one of three
          // frees nothing. The whole stack goes down, then the find comes up
          // through the same door every other pickup uses.
          E.dropItem(this.state, dropId, n);
          this.takeInstead(foundId, null);
        },
        onLeave: (foundId) => {
          log(`You leave ${iName(this, foundId)} where it lies.`, "muted");
          this.refresh();
          this.renderEndTurn();
        },
      });
    }

    // Nothing. Said as rummaging rather than as a readout — the odds are in the
    // table and the player is entitled to feel them rather than read them. The
    // line varies by turn, which is deterministic: a replayed seed says the
    // same thing in the same room.
    log(EMPTY_HANDED[this.state.turn % EMPTY_HANDED.length], "muted");
    this.refresh();
    setTimeout(() => this.renderEndTurn(), FIND_BEAT_MS);
  }

  takeInstead(foundId, dropId) {
    const got = E.pickUpItem(this.state, foundId, dropId);
    if (got.ok) {
      if (dropId) log(`${iName(this, dropId)} down, ${iName(this, foundId)} up.`, "good");
      else log(`${iName(this, foundId)}.`, "good");
    } else {
      // The engine refused. Say so plainly rather than pretending it worked —
      // the only ways here are a duplicate unique or a stack that freed nothing,
      // and both are the player's business.
      log(`No room for ${iName(this, foundId)}. It stays where it is.`, "muted");
    }
    this.refresh();
    this.renderEndTurn();
  }

  // Medicine is the one thing the pack spends on its own account, outside a
  // fight and outside the turn's action.
  usePackItem(id) {
    // 硃砂 is the one pack item that needs a target, so it asks before it acts.
    if (id === "cinnabar") return this.useCinnabar();
    const out = E.useMedicine(this.state, id);
    if (!out.ok) return;
    const name = iName(this, id);
    if (out.healed > 0) log(`${name}. +${out.healed} health.`, "good");
    else if (out.healed < 0) log(`${name}. It was the bad half: ${out.healed} health.`, "bad");
    else log(`${name}.`);
    if (out.cured) log("The grey goes out of the wound. 中毒 lifted.", "good");
    this.refresh();
  }

  // 硃砂 over a talisman you already hold: it copies, so a stack goes deeper
  // and the pack gets no fuller — a stack of any size is still one slot, and
  // grinding the 硃砂 away actually frees the one it was sitting in.
  useCinnabar() {
    showCinnabarDialog(this, {
      onPick: (targetId) => {
        const out = E.useCinnabar(this.state, targetId);
        if (!out.ok) return;
        paperFlutter();
        itemPickup(targetId);
        this.refresh();
        this.tell(
          `You grind the ${this.itemName("cinnabar")} and paint it again. ${this.itemName(targetId)} ×${out.count}.`,
          "good"
        );
      },
    });
  }

  renderEndTurn(cued = false) {
    const choices = this.endTurnChoices();
    // Nothing to decide, so do not ask. A prompt whose only answer is "yes,
    // continue" is a button that reads the player's mind wrong every single
    // turn — thirty of them a night, and none of them a decision. Fall
    // straight through into the next turn instead.
    if (!choices.length) {
      // Choices cleared first: during the beat below there must be nothing on
      // screen to click, exactly as during the other staged pauses.
      renderActions([]);
      if (!cued) return this.nextTurn();
      // Something is standing in a doorway or crossing one. The next render
      // destroys it, so let it be seen first. Long enough to register and
      // short enough that a rare event does not become a wait.
      return void setTimeout(() => this.nextTurn(), CUE_BEAT_MS);
    }
    renderActions(
      [...choices,
       { kind: "draw", label: "Next turn", sub: "six minutes", primary: true,
         onClick: () => this.nextTurn() }],
      "The room is quiet."
    );
  }

  nextTurn() {
    // A turn later, the dust in last turn's hole has settled. The gouges and
    // the dark stay — those are what the house keeps.
    settleDust();
    // Turn 31 is not a turn: it is 三更, and this is where the night stops
    // rather than moves. The set-piece intercepts here, which is what makes the
    // backstop inside advanceTurn unreachable — it used to end the run as a
    // clock-death, and there is no loss to the clock in this game (§10).
    if (this.state.turn >= E.RULES.TOTAL_TURNS) return void this.midnightBeat();
    // The turn IS the clock, so this is where the night moves.
    E.advanceTurn(this.state);
    if (this.state.status !== "playing") return this.gameOver();
    // beginTurn ticks the poison, and it does it before the player is given an
    // action — which is what makes "curing still pays this turn's tick" fall
    // out of the order rather than needing a rule. It reports nothing, so the
    // tick is read off the health either side of it.
    const grey = this.state.poisoned;
    const before = this.state.health;
    E.beginTurn(this.state);
    const ticked = grey && this.state.health < before;
    // A new turn is a new chance to rummage — including a STAY spent in a room
    // you already went through, which is exactly what STAY is for.
    this.searched = false;
    this.cowered = false;
    this.refresh();
    // Said after the refresh, so the hearts have already moved and the board
    // has already flashed by the time the sentence lands on it.
    if (ticked) {
      this.tell((this.data.theme.poison || {}).tick || "", "bad");
      if (this.state.status !== "playing") return this.gameOver();
    }
    this.renderMoves();
  }
  // ---- 三更 -----------------------------------------------------------------
  // The appointment. Not a failure state and not a timer running out — reaching
  // midnight is the thing the whole night has been walking toward, and what
  // happens here decides it.
  //
  // ONE STRIKE, BINARY. He has no rounds, no health and no abilities, 黑狗血
  // does not work on him, and there is nothing to flee to. You present what you
  // brought, once.
  async midnightBeat() {
    this.state.hour = E.RULES.FINAL_HOUR;
    this.refresh();
    clearChoices();

    // He arrives whether or not you are ready, and the room says so first.
    //
    // ONE stroke, not three. The watch drum has been counting up all night and
    // struck three at eleven when 三更 began; this is the last one anybody out
    // there will strike, and what makes the line true is the silence after it.
    watchDrum(1);
    tollBell();
    this.tell("三更. The drum goes, and then nothing goes at all.", "toll");
    await wait(MIDNIGHT_TOLL_MS);

    // 活水. He will not cross it, so there is no exchange at all — the only
    // ending in the game that costs nothing and proves nothing, and it gets a
    // quiet card rather than a triumphant one.
    const tile = Bd.currentTile(this.board);
    const water = ((tile.def && tile.def.flags) || []).includes("RUNNING_WATER");
    if (water) {
      this.tell("He stops at the bank. Whatever he is, it will not cross running water.");
      E.midnight(this.state, { runningWater: true });
      await wait(RESULT_BEAT_MS);
      return this.gameOver();
    }

    // Not the pack's sting. That one rises because the question is how fast
    // they reach you; this one falls, because there is no question.
    kingArrives();
    await jumpScare(1, false, {});
    if (this.state.status !== "playing") return this.gameOver();

    const use = await this.askKit();
    // The one consuming call. Everything named in `use` is spent here whether
    // or not it was enough — bringing the banner and falling short is still
    // bringing the banner.
    if (use.talisman) paperFlutter();
    const r = E.midnight(this.state, { use });
    // Kept for the verdict card, which is the only place either number is ever
    // allowed to appear.
    this.king = r;
    this.refresh();
    await wait(RESULT_BEAT_MS);
    return this.gameOver();
  }

  // What you can present, and what each comes to. Every combination is offered
  // rather than filtered: nothing is worth saving past this point, so there is
  // no dominated option to protect anyone from — the only real question is
  // whether to pay 血符's blood, and that one is priced in hearts like any
  // other.
  //
  // 🤫 The cards show YOUR attack and never whether it is enough. That is the
  // §9 rule and it is load-bearing: a "this will do it" marker here would give
  // the threshold away before the strike and cost the game its hidden ending.
  kitOptions() {
    const s = this.state;
    const talismans = E.heldIds(s).filter((id) => {
      const d = s.itemsById[id];
      return d && d.cat === "magic" && d.attack != null;
    });
    const banners = E.held(s, "soul-banner") ? [false, true] : [false];
    const out = [];
    for (const banner of banners) {
      for (const talisman of [null, ...talismans]) {
        const use = {};
        if (banner) use.banner = true;
        if (talisman) use.talisman = talisman;
        const def = talisman ? s.itemsById[talisman] : null;
        out.push({
          use,
          attack: E.attackWith(s, use),
          blood: def && def.costHp ? def.costHp : 0,
          spends: [...(banner ? ["soul-banner"] : []), ...(talisman ? [talisman] : [])],
        });
      }
    }
    // Hardest first. More is simply better here — there is no next turn to have
    // saved anything for — so the order is the only advice the window gives,
    // and it gives it without naming a number to beat.
    return out.sort((a, b) => b.attack - a.attack || a.blood - b.blood);
  }

  askKit() {
    return new Promise((resolve) => {
      const sword = E.bestSword(this.state);
      const acts = this.kitOptions().map((o, i) => ({
        kind: "kit",
        label: o.spends.length
          ? o.spends.map((id) => this.itemName(id)).join(" and ")
          : sword ? `Just the ${this.itemName(sword)}` : "Nothing but your hands",
        sub: `attack ${o.attack}`,
        icon: sword ? `item-${sword}` : null,
        primary: i === 0,
        // 血符 is written in your own blood before the strike, and at one heart
        // it kills the hand writing it — the same diedPaying rule as everywhere
        // else, and the card has to say so.
        cost: o.blood ? { hp: -o.blood } : null,
        onClick: () => { clearChoices(); resolve(o.use); },
      }));
      renderActions(acts, "He is in the doorway. One strike — what do you show him?",
        { pack: 1, health: this.state.health });
    });
  }

  // ---- End states ----------------------------------------------------------
  gameOver() {
    this.refresh();
    renderActions([]);
    // The house stops breathing when the run does, before the verdict sting,
    // so the ending has the room to itself.
    stopAmbience();
    keepAwake(false);
    // The verdicts carry their own stings; the score is never played over them.
    stopScore();

    const O = E.OUTCOMES;
    const outcome = this.state.outcome;
    const won = this.state.status === "won";

    // Counted once, and the guard is load-bearing: the win path re-enters
    // gameOver after the silent beat below, so without it every escape would
    // be recorded twice and every one of those runs would look like two.
    //
    // Status rather than outcome, and that is the whole of the ranking policy:
    // BOTH WINS COUNT THE SAME, because "won" is true for both and the tally
    // has no third counter to rank them with. 見到天亮 is neither win nor loss,
    // and goes down as having got out — the house did not keep you.
    if (!this.tallied) {
      this.tallied = true;
      recordVerdict(this.state.status !== "lost");
    }

    // One silent beat before the dawn on a win: the release is the silence,
    // not the sting.
    if (won && !this.verdictHeld) {
      this.verdictHeld = true;
      return void setTimeout(() => this.gameOver(), 700);
    }
    verdictSting(won);

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
      this.relicLine(outcome),
      `Seed ${this.seed}`,
    ];

    // The sentence somebody might actually screenshot, above the rows nobody
    // does. Composed here so all five verdicts get it from one place.
    const closing = epilogue(this);
    const outs = this.data.theme.outcomes || {};
    const subs = outs.subs || {};

    // Which death this was, for the overlay's own staging. The King gets the
    // cracked clock; the other two die their own deaths.
    const reasonFor = {
      [O.LOSS_KING]: "midnight",
      [O.LOSS_HEALTH]: this.state.lossReason === "combat" ? "combat" : "health",
    };

    const title = outs[outcome] || (won ? "You made it to dawn" : "You are one of them now");
    let sub = subs[outcome] || "";
    if (outcome === O.LOSS_HEALTH) {
      sub = subs[`LOSS_HEALTH_${this.state.lossReason === "combat" ? "combat" : "health"}`] || sub;
    }

    const opts = {
      tone: won ? "won" : this.state.status === "lost" ? "lost" : "over",
      summary,
      epilogue: closing,
    };
    if (reasonFor[outcome]) opts.reason = reasonFor[outcome];

    // 🤫 The only place either number is ever printed, on the card of a player
    // he has just killed. See the note over verdict-compare in render.js: this
    // is the discovery mechanism for 鎮屍, not a stat readout, and it appears
    // on exactly one of the five cards.
    if (outcome === O.LOSS_KING && this.king) {
      const k = this.data.theme.king || {};
      opts.compare = [
        [k.yours || "your attack", this.king.attack],
        [k.needed || "needed", this.king.threshold],
      ];
    }

    showOverlay(title, sub, again, opts);
  }

  // What became of the 神主牌, said the same way for every ending that is not a
  // burial. WIN_SEAL is deliberately in the same bucket as the losses here: you
  // sealed him, and the tablet is still in your hands or still out there, which
  // is a fact about the tablet and not a judgement about the ending.
  relicLine(outcome) {
    const relic = this.word("relic");
    if (outcome === E.OUTCOMES.WIN_BURIAL) return `The ${relic} is buried`;
    if (this.state.tablet) return `The ${relic} was on you, unburied`;
    return `The ${relic} was never found`;
  }
}

// ---- Page-level state ------------------------------------------------------
// `data` is fetched once; every run after the first reuses it, so restarting is
// synchronous and needs no reload.
let data = null;
let game = null;

function startNewGame(seed) {
  hideOverlay();
  clearStage();
  // A run is in progress: the screen stays lit. Released at the verdict, so a
  // finished game is not quietly holding the phone awake.
  keepAwake(true);
  // A new run gets the wind back, and never a second copy of it — startAmbience
  // is idempotent, so restarting mid-run is safe.
  startAmbience();
  game = new Game(data, seed != null ? { seed } : {});
  window.__game = game; // handy for debugging
  // The pack spends medicine on its own account, and refresh() rebuilds the
  // panel without knowing about the turn loop — so the handler is registered
  // against the run rather than passed down through every render.
  onPackUse((id) => game.usePackItem(id));
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
    const was = btn.title || btn.textContent;
    if (btn.title) {
      btn.title = "Link copied";
      btn.classList.add("utilbtn--done");
      setTimeout(() => {
        btn.title = was;
        btn.classList.remove("utilbtn--done");
      }, 1800);
    } else {
      btn.textContent = "Link copied";
      setTimeout(() => (btn.textContent = was), 1800);
    }
  } catch {
    // Clipboard refused (insecure context or denied permission) — put the link
    // in the log so it can still be copied by hand.
    log("Replay link: " + url);
  }
}

// The toggle carries the state, not just a label: a button reading "Mute" tells
// you nothing about whether sound is currently on.
// The way out of the horror, for players who want the game without it. Sits
// next to Sound because they are the same kind of decision — how loud should
// this be at me — and it is a separate switch from the OS motion setting on
// purpose: wanting animation and not wanting to be frightened are different.
// First run only. The key is the whole mechanism: no jitp:seen means nobody has
// played here before — and it has to be OUR key, or a player who met Grave
// Errand on this origin never gets the letter that explains this game.
//
// Off the RNG entirely — showing the note is presentation, so a shared seed
// plays out identically whether or not the note appeared. That matters more
// than it looks: reading the note takes time, and time is exactly what this
// game measures, so it must not be allowed to cost any.
const SEEN_KEY = "jitp:seen";

function firstVisit() {
  try {
    return localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return false; // storage blocked: do not ambush a returning player every run
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* they will be offered it again; the button in the corner still works */
  }
}

function openNote() {
  const note = data && data.theme && data.theme.note;
  if (!note) return;
  showNote(note, markSeen);
}

function paintCalmToggle() {
  const btn = document.getElementById("btn-calm");
  if (!btn) return;
  const on = isCalm();
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const label = document.getElementById("calm-label");
  if (label) label.textContent = on ? "Calm mode on" : "Calm mode off";
  const slot = document.getElementById("calm-icon");
  if (slot) {
    slot.textContent = "";
    const art = uiIcon("calm", "utilicon-svg");
    if (art) slot.appendChild(art);
  }
  document.body.classList.toggle("calm", on);
}

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

function paintCopyIcon() {
  const slot = document.getElementById("copy-icon");
  if (!slot || slot.childNodes.length) return;
  const art = uiIcon("copy", "soundicon-svg");
  if (art) slot.appendChild(art);
}

function wireControls() {
  document.getElementById("btn-copy-seed").addEventListener("click", () => copyReplayLink());
  document.getElementById("btn-sound").addEventListener("click", () => {
    setMuted(!isMuted());
    paintSoundToggle();
  });

  const noteBtn = document.getElementById("btn-note");
  if (noteBtn) noteBtn.addEventListener("click", openNote);

  const calmBtn = document.getElementById("btn-calm");
  if (calmBtn) {
    calmBtn.addEventListener("click", () => {
      setCalm(!isCalm());
      paintCalmToggle();
    });
  }
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
  wireFullscreen();
  wireSleep();
  registerWorker();
    paintSoundToggle();
    paintCalmToggle();
    paintCopyIcon();
    // Size the board off its pane before the first render, and keep it sized as
    // the pane changes — the sidebar growing counts, not just the window.
    watchBoardSize();
    // Mounted once for the life of the page: the grain and the dust belong to
    // the pane, not to any particular run.
    mountFilmStock();
    startNewGame(seedFromUrl());
    // After the game is up, so the note is read over the Entry Hall rather
    // than over nothing.
    if (firstVisit()) openNote();
  } catch (err) {
    console.error(err);
    log("Failed to start the game — see console.", "bad");
  }
}

main();
