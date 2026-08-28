// Game page controller — orchestrates the turn, wiring user input -> engine +
// board -> render. Owns the RNG seed.
//
// The turn, in the order §8 sets out: the poison tick, one action — move or
// stay, and there is no third — then the room answers with an event, then the
// rite if this room has one, then the breach if there is nowhere on, then the
// search, then six minutes off the clock. 石敢當 is the one room that skips the
// answer: standing on the ward draws nothing, arriving or staying.
//
// Cowering used to be that third action, and the one exception to that order.
// The post-launch amendment removed it, and the exception moved rather than
// went: safety is a PLACE now — the warded stone — rather than a resource you
// carry, so the only turn that draws no event is a turn spent on the right
// ground.
//
// Most of that is arithmetic and lives in the engine. Two things are not: a
// fight and a villager come back from resolveEvent unresolved, because both are
// decisions, and decisions belong to whoever is talking to the player. This
// file is where they are asked.

import * as E from "./engine.js";
import * as Bd from "./board.js";
import { eventStage, kingScene, resetStageHints,
         BEAT_MS as STAGE_BEAT_MS } from "./eventstage.js";
import { isMuted, setMuted, relicFound, seamCross, verdictSting,
         startAmbience, stopAmbience, stopScore, itemPickup, tollBell,
         watchDrum, paperFlutter, kingArrives, combatHit, duckForScare,
         unduck } from "./audio.js";
import {
  renderHud,
  renderBoard,
  renderActions,
  creaturePanel,
  clearCreaturePanel,
  reducedMotion,
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
  revealPanel,
  resetRevealHint,
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
  showCinnabarDialog,
} from "./render.js";

import { registerWorker, keepAwake, wireSleep,
         markRunInProgress } from "./shell.js";
import { recordVerdict } from "./tally.js";
import { epilogue } from "./epilogue.js";
import * as L from "./lang.js";
import { mountLangSwitch, paintLangSwitch } from "./langswitch.js";

// How long the turn holds when something unexplained was put on the board. The
// cues themselves live longer than this — the phantom 2.6s, the figure 9s — but
// they are mounted inside the board, and the next turn rebuilds it. This is the
// window in which they are actually visible, so it is the number that matters.
const CUE_BEAT_MS = 1500;

// How long a search result sits before the turn moves on. Shorter than a cue:
// finding nothing is the common case and must not become a wait.

// The room's own beat, between walking in and the room answering. The event
// line is read in this gap; without it the sentence and the damage land
// together and the sentence is the half that gets skipped.
const EVENT_BEAT_MS = 780;
// The stage replaces this wait rather than adding to it, and its own pacing
// arithmetic is written against the same number. If the two ever drift, the
// budget documented in eventstage.js is a lie about a night thirty turns long,
// so they are checked rather than trusted.
if (EVENT_BEAT_MS !== STAGE_BEAT_MS) {
  console.warn(`event beat ${EVENT_BEAT_MS}ms but the stage budgets against ${STAGE_BEAT_MS}ms`);
}

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

// The sprite id for an item, or nothing. Bare-handed has no art and must pass
// null rather than "item-", which would send render.js looking up a symbol
// whose id is the empty string.
function itemArt(id) {
  return id ? `item-${id}` : null;
}

// {braced} placeholders, the convention villager.gave and the epilogue fragments
// already use. An unknown placeholder is left standing rather than blanked, for
// the same reason a missing key returns itself — visible beats silent.
// The page-level controls — sound, calm, the copy button — exist before any run
// starts and outlive every one of them, so they cannot reach through `game`
// unconditionally. This falls back to the key, which is the same contract the
// instance helpers keep.
function uiWord(key, values) {
  const table = (data && data.theme && data.theme.ui) || {};
  return fill(table[key] || key, values);
}

function fill(text, values) {
  if (!values) return text;
  return String(text).replace(/\{(\w+)\}/g, (whole, k) =>
    values[k] === undefined ? whole : values[k]);
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
  const [tiles, items, search, events, base] = await Promise.all(
    names.map((name) =>
      fetch(`data/${name}.json`, FETCH_OPTS).then((r) => {
        if (!r.ok) throw new Error(`data/${name}.json -> HTTP ${r.status}`);
        return r.json();
      })
    )
  );
  // The base theme is complete and is the fallback for every language; a
  // language file is merged over it. See lang.js — the overlay is what lets a
  // translation land in pieces without the game ever showing a missing key.
  const lang = L.preferred();
  L.stampDocument(lang);
  const theme = await L.themeFor(base, lang, FETCH_OPTS);
  return { tiles, items, search, events, theme, baseTheme: base, lang };
}

// Exported so a guard can drive a real turn. Nothing else imports it.
export class Game {
  constructor(data, opts = {}) {
    this.data = data;
    const seed = opts.seed ?? (Date.now() >>> 0);
    this.seed = seed;
    this.state = E.newGame(data, { seed });
    this.board = Bd.createBoard(data, { seed });
    // Kept for the end-of-run verdict; the engine has no use for them.
    this.tally = { putDown: 0, fights: 0, found: 0 };
    // One search per turn, and turn 1 has not had its yet.
    this.searched = false;
  }

  tileName(id) { return tName(this, id); }
  itemName(id) { return iName(this, id); }

  // ---- What anything player-visible is called ------------------------------
  // Every sentence and every label comes through one of these two, so adding a
  // language is a data change and never a code change. The key is the moment,
  // not the caller — `line("move")` rather than `line("doMove")` — because the
  // person translating this file does not have the source open beside them.
  //
  // A missing key returns the key itself rather than empty: a screen reading
  // "search-took" is a bug anyone can see and report, where a blank line is one
  // nobody notices until it matters.
  line(key, values) { return fill((this.data.theme.lines || {})[key] || key, values); }
  ui(key, values) { return fill((this.data.theme.ui || {})[key] || key, values); }

  // The compass, spoken. In the theme with every other player-visible noun,
  // because "north" is a word on the screen and not a fact about the board —
  // the board's own name for that wall is "N" and stays "N".
  dirWord(dir) { return this.ui(`dir-${dir}`); }

  verdictLine(key, values) {
    return fill((this.data.theme.verdict || {})[key] || key, values);
  }

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
    log(this.line("wake", {
      room: this.tileName(Bd.currentTile(this.board).id),
      relic: this.word("relic"),
      goal: goal ? this.line("wake-goal", { goal: this.tileName(goal.id) }) : "",
    }));
    this.renderMoves();
  }

  // ---- Step 1: choose an action --------------------------------------------
  // MOVE or STAY, and nothing else. Movement is optional in this game, unlike
  // the source it came from — but standing still costs a turn exactly like
  // walking does, so there is no free turn and STAY is always on the table,
  // dead end or not. Both are drawn on the board rather than in the panel:
  // they are the same rank of choice and belong in the same place.
  renderMoves() {
    if (this.state.status !== "playing") return this.gameOver();
    const acts = Bd.listMoves(this.board).map((m) => {
      if (m.type === "explore") {
        return { kind: "move", dir: m.dir,
          label: this.ui("explore", { dir: m.dir, dirWord: this.dirWord(m.dir) }),
          sub: this.ui("explore-sub"),
          primary: true, onClick: () => this.doExplore(m.dir) };
      }
      if (m.type === "outside") {
        return { kind: "move", dir: m.dir,
          label: this.ui("moon-gate"), sub: this.ui("moon-gate-sub"),
          primary: true, onClick: () => this.doOutside(m.dir) };
      }
      const to = this.board.worlds[m.to.world].get(Bd.cellKey(m.to.x, m.to.y));
      return { kind: "move", dir: m.dir,
        label: this.ui("walk", { dir: m.dir, dirWord: this.dirWord(m.dir), room: this.tileName(to.id) }),
        icon: `tile-${to.id}`, onClick: () => this.doMove(m.dir) };
    });
    // kind "stay", not "rest": render.js draws this one on the board with the
    // doorways, and "rest" would send the whole step to the action panel.
    acts.push({ kind: "stay", label: this.ui("stay"), sub: this.ui("stay-sub"),
      primary: acts.length === 0, onClick: () => this.doStay() });
    renderActions(acts, this.ui("move-prompt"));
  }

  // STAY is a whole action. It ends in the same place every other one does, so
  // the room's own instructions and the end of the turn still run.
  doStay() {
    log(this.line("wait", { room: this.tileName(Bd.currentTile(this.board).id) }));
    this.arrive();
  }


  // The tile turns itself. board.pickExploreRotation prefers a placement that
  // keeps a way on into unexplored space, and is deterministic so a shared seed
  // still replays move for move.
  doExplore(dir) {
    // peekTile, not decks[0]: the log has to name the room actually placed, and
    // which room that is belongs to the board rather than to the top of a deck.
    const revealed = Bd.peekTile(this.board, this.board.player.world);
    const rot = Bd.pickExploreRotation(this.board, dir);
    const r = Bd.explore(this.board, dir, rot);
    if (!r.ok) return this.renderMoves();
    log(this.line("reveal", { room: this.tileName(revealed) }));

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
    log(this.line("move", { room: this.tileName(Bd.currentTile(this.board).id) }));
    this.refresh();
    animateEntry(dir);
    this.arrive();
  }

  doOutside(dir) {
    const out = Bd.goOutside(this.board);
    seamCross();
    log(this.line("step-out", { room: this.tileName(out.tile.id) }));
    this.refresh();
    if (dir) animateEntry(dir);
    this.arrive();
  }

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
  // Which stage an event gets. One slot per event beat (§33), chosen from the
  // DRAWN event rather than the resolved one — resolveEvent has not run yet,
  // and the stage is the moment before the arithmetic, not after it.
  //
  // JIANGSHI is the deliberate hole. It goes on to fightBeat, which already
  // stages the pack with jumpScare, and running a stage here would put two
  // full-screen layers back to back. fightBeat cannot simply hand its scare
  // over either: the breach and the refused villager both reach it without
  // passing through an event beat.
  eventStageFor(ev) {
    const kind =
      ev.t === "NOTHING" ? "nothing"
      : ev.t === "POISON" ? "poison"
      : ev.t === "VILLAGER" ? "villager"
      : ev.t === "HP" ? (ev.hp > 0 ? "mend" : "hurt")
      : null;
    if (!kind) return wait(EVENT_BEAT_MS);
    // The panel names itself and writes its own hint, both from reveal-go, so
    // neither is passed from here. stage-skip's "press anything to go on"
    // described SKIPPING, which stopped existing when the panel started
    // waiting. It is left in the theme, unused: a guard asserts the key exists
    // in both languages and that they differ, so renaming it to mark it dead
    // would break a test in order to add a comment.
    // The line goes to the panel as well as to the log and the caption. It is
    // read here rather than in the stage because it depends on the event AND
    // the hour band, neither of which the panel knows.
    // turn goes through for the villager, which picks which of the three
    // people is standing there. Deterministic by seed, like every other draw.
    return eventStage(kind, { n: ev.n, hp: ev.hp, turn: this.state.turn,
                              line: this.eventLine(ev) });
  }

  async eventBeat() {
    if (this.state.status !== "playing") return;

    // 石敢當 turns what walks the road: no event here, arriving or staying.
    // Said out loud, because a turn that quietly skips its own event is
    // indistinguishable from a turn that broke.
    //
    // Asked of the board rather than read off the tile: isWarded is the one
    // place the flag is read, and the engine refusing the draw and the player
    // being told why should not be two separate opinions about the same stone.
    if (Bd.isWarded(this.board)) {
      this.tell(this.line("warded"));
      return wait(RESULT_BEAT_MS);
    }

    const ev = E.drawEvent(this.state);
    if (!ev) return;

    // log() AND NOT tell(), which is the whole of "remove 浮在棋盤上方的字幕列"
    // for this line. The panel draws these words under the scene now, so
    // tell()'s caption would put the same sentence on the board twice, 392px
    // apart, for the 4200ms the caption lives — measured, both present.
    //
    // NOT a deletion of caption(). tell() is called at nineteen sites and this
    // is the only one whose words have another visible carrier; the other
    // eighteen would go screen-reader-only, which is exactly the condition that
    // made a search result invisible and started this whole run of panels.
    // `warded` alone makes the case: its comment says a turn that quietly skips
    // its own event is indistinguishable from a turn that broke.
    const line = this.eventLine(ev);
    if (line) log(line);
    // The line is written BEFORE the stage, and that ordering is what makes the
    // stage skippable: the news is already in the log, so dismissing the
    // picture costs the picture and nothing else.
    await this.eventStageFor(ev);

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
      log(res.hp > 0 ? this.line("hp-gain", { n: res.hp }) : this.line("hp-loss", { n: res.hp }),
          res.hp > 0 ? "good" : "bad");
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

    this.tell(this.line(goal === "BURY_TABLET" ? "rite-bury" : "rite-take"));
    await wait(EVENT_BEAT_MS);

    await this.eventBeat();
    if (this.state.status !== "playing") return;
    // Running from the rite's own event aborts it — the source's rule was that
    // you only came away with it if you were still standing there when it was
    // over. Retryable: walk back and pay for another event.
    if (this.state.fled) {
      this.tell(this.line("rite-aborted"));
      return;
    }

    const r = E.completeRite(this.state, goal);
    if (!r.ok) return;

    if (goal === "TAKE_TABLET") {
      relicFound();
      // NOT counted as an item found. The 神主牌 is the object of the night —
      // it has its own line on the verdict card two rows down, and counting it
      // here said "1 item found" to a player who had found four and the tablet.
      this.tell(this.line("relic-found", { relic: this.word("relic") }), "good");

      // THE PANEL, and the tablet is the moment it exists for. Everything else
      // it shows is a thing you picked up in a room; this is the thing the
      // whole night was for, and it was going past in a caption and a 620ms
      // beat.
      //
      // It is not an item and does not become one to be shown here: no entry in
      // items.json, no id, so the three pieces are handed over directly. The
      // description comes from itemBlurbs under the "relic" key, which the
      // equipment slot already reads and which had never been written — so the
      // slot's tooltip gains it too, from the same single source.
      //
      // THE PANEL OWNS THE BEAT NOW. The wait(RESULT_BEAT_MS) that used to
      // close this rite is gone rather than kept alongside: a click-dismissed
      // panel racing a timer that ends the moment anyway would mean the tablet
      // sometimes waited for the player and sometimes did not, depending on how
      // fast they were, which is the one thing a ruling about waiting cannot
      // tolerate. refresh() moves into the callback for the same reason the
      // search's does — you are told, and then you watch it land.
      return new Promise((resolve) => {
        revealPanel(this, {
          sym: ["ui", "relic"],
          // relic-name, not word("relic"). The two are different jobs and the
          // theme keeps them apart: word() is the INLINE noun, "the tablet",
          // for the middle of a sentence, and it is what the caption above says.
          // This is a TITLE, in the same 神主牌 Ancestral Tablet idiom every item
          // name on this panel uses -- and it is the string the equipment slot
          // already titles the same object with.
          name: this.ui("relic-name"),
          blurb: (this.data.theme.itemBlurbs || {}).relic || "",
          cls: "reveal--relic",
        }, () => {
          this.refresh();
          resolve();
        });
      });
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
    const n = E.breachAfterEvent(this.state, {
      deadEnd: true,
      fled: this.state.fled,
      // The stone's walls hold. A corner made of 石敢當 is still a corner - the
      // hole still opens so the run is not stuck - but nothing comes through it.
      warded: Bd.isWarded(this.board),
    });

    // Nowhere on and nothing coming: the wall still has to give, or the run is
    // stuck standing here. No telegraph for it — nothing is arriving.
    if (!n) {
      if (wall) {
        Bd.openZombieDoor(this.board, wall);
        this.tell(this.line("dead-end", { dir: this.dirWord(wall) }));
        this.refresh();
        await wait(RESULT_BEAT_MS);
      }
      return;
    }

    if (!wall) return; // no wall to give: nothing can come through one

    // The knock, the cracks, something leaning on it, and then the wall. Said
    // out loud one beat before it happens, which is the difference between a
    // stat event and a horror beat.
    this.tell(this.line("breach-working", { dir: this.dirWord(wall) }));
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

      // The room comes back when the window closes, and this is the ONE place
      // that can promise it. jumpScare ducks the bed and the murmur on the way
      // in; unduck() existed to put them back and was called from nowhere, so
      // after the first fight of any run the ambience stayed down for the rest
      // of the night. Every fight in the game since the fork has been followed
      // by permanent silence, which read as atmosphere and was a leak.
      //
      // Closed here rather than at each exit because there are six of them —
      // died-paying, the swing, escape, flight, and two status checks — and a
      // fix that has to be remembered at every return is a fix that will be
      // missed at the next one.
      //
      // midnightBeat does NOT come through here, and that is the point of
      // fixing this: the King's room stays quiet on purpose, and it can only
      // mean something once every other room stops being quiet by accident.
      const close = () => {
        // The creature panel goes here for the same reason unduck() does: there
        // are six exits from this window and a teardown remembered at each one
        // is a teardown missed at the next. Its lifecycle is "until the fight
        // resolves", and this closure IS that moment.
        clearCreaturePanel();
        unduck();
        resolve();
      };

      jumpScare(n, { from: opts.from || null }).then(() => {
        if (this.state.status !== "playing") return close();
        // What you are looking at while you choose. Raised HERE rather than in
        // the event stage because every route into a fight funnels through this
        // function — a jiangshi event, the breach, and both villager paths — so
        // the two encounters are the same encounter by construction.
        creaturePanel(n, { turnedFrom: opts.turnedFrom, reduced: reducedMotion() });
        this.paintFight(n, opts, close);
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

  // The card that spends nothing says "Fight with the 桃木劍" — a verb and a
  // thing. The cards that spend something used to say only the thing, so a
  // loadout card read as NAMING an item rather than as an action, and 真火符 is
  // the one item where that ambiguity has a wrong answer waiting: it is also
  // the talisman that can be burnt into a blade for good, so a bare card headed
  // 真火符 invites exactly the reading "make my sword better". It does not. It
  // throws the paper at them, once. The engine's own author pressed it at the
  // table expecting the other thing.
  //
  // So every card carries the verb, and the verb is BURN, which is true of the
  // banner and of all three papers alike.
  //
  // The join is themed rather than hardcoded to " and ": zh has no spaces.
  loadoutLabel(o, sword) {
    const spent = o.spends.map((id) => this.itemName(id));
    if (!spent.length) {
      return sword ? this.ui("fight-with", { item: this.itemName(sword) }) : this.ui("fight-bare");
    }
    return this.ui("fight-spend", { items: spent.join(this.ui("fight-join")) });
  }

  paintFight(n, opts, done) {
    const s = this.state;
    const sword = E.bestSword(s);

    const acts = this.fightOptions(n).map((o) => ({
      kind: "fight",
      label: this.loadoutLabel(o, sword),
      // The arithmetic, said out loud. Combat is fully deterministic, so there
      // is nothing to hide and no reason to make anyone do it in their head.
      sub: o.blood
        ? this.ui("attack-blood", { n: o.attack, blood: o.blood })
        : this.ui("attack", { n: o.attack }),
      // The card shows what the card is about. Every loadout swings the sword,
      // so the sword is the right mark only when nothing else is being spent —
      // a card headed 五雷符 with a blade on it is answering a question nobody
      // asked. The banner outranks a talisman: it is the rarer thing to burn.
      // BARE HANDS HAVE A PICTURE NOW (#94). itemArt returns null when there
      // is nothing to spend and no blade in hand, so the one option that costs
      // the most was the only card with an empty space where every other card
      // shows what it spends.
      icon: itemArt(o.spends[0] || sword) || "ui-hands",
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
        sub: this.ui("escape-sub"),
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
        label: this.ui("run", { dir: m.dir, dirWord: this.dirWord(m.dir), room: this.tileName(to.id) }),
        sub: this.ui("run-sub"),
        cost: { hp: -E.RULES.RUN_AWAY_DAMAGE },
        onClick: () => this.doFlee(m.dir, done),
      });
    }

    // `health` is what marks a card lethal, and it is read here rather than
    // baked in above: it can move mid-window, and a card that would kill you
    // has to say so at the moment you are looking at it.
    // NO PACK ROW ON A FIGHT ANY MORE (#94 part 2): the creature is the panel
    // above, at full size, and drawing it again at 22px in the header is the
    // caption doubling the user caught when the event line moved.
    //
    // THE ATTACK IS STILL IN THIS PROMPT AND ALSO ON THE PANEL, and that is a
    // known interim rather than an oversight: fight-prompt's new wording is
    // with the user, who ruled the current one hours before #94 existed.
    // NO PROMPT AND NO PACK ROW (#94). The creature panel above carries both
    // the picture and the one text — the story sentence with its attack — and
    // renderActions positions a prompt in the window header, which is a second
    // element in a second place. One sentence, once.
    renderActions(acts, "", { health: s.health });
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
      // Not counted. The 血符 took the last of you before the swing, so the
      // pack is still standing — the one branch where a fight puts nobody down.
      this.refresh();
      this.tell(this.line("died-paying", { item: this.itemName("blood-talisman") }), "toll");
      await wait(RESULT_BEAT_MS);
      return done();
    }

    // The pack goes down here and nowhere else. resolveCombat has no branch
    // that leaves them standing once the strike lands — not even one that kills
    // you, which still counts, because they went down too. By n rather than by
    // one: a pack of four is four.
    //
    // A fight you RAN from is not a fight you won, and that rule needs no test
    // of its own: doFlee and doEscape never reach this line.
    //
    // Until #67 this counter was initialised, printed, and incremented nowhere
    // at all, so every run ever played closed on "0 put down".
    // TWO COUNTERS, because #92 split what used to be one number. `n` is the
    // creature's 攻擊力 now, so accumulating it gives the WEIGHT of the night's
    // fighting, which is what dread and the epilogue want. The verdict card
    // wants something else: it prints a count of creatures as a fact, and
    // summing attack powers and calling the total a number of jiangshi would
    // make that line lie. So the card counts FIGHTS.
    this.tally.putDown += n;
    this.tally.fights += 1;

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
    for (const id of r.spent) log(this.line("spent", { item: this.itemName(id) }));
    log(r.damage ? this.line("damage", { n: r.damage }) : this.line("untouched"),
        r.damage ? "bad" : "good");
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
    this.tell(this.line("blood-escape", { item: this.itemName("black-dog-blood") }));
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
    this.tell(this.line("ran", {
      dir: this.dirWord(dir),
      room: this.tileName(Bd.currentTile(this.board).id),
    }));
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
      this.tell(this.line("villager-empty-handed"));
      await wait(RESULT_BEAT_MS);
      return this.fightBeat(res.n);
    }

    const give = await this.askVillager(ev, t);
    const res = E.resolveEvent(this.state, ev, { giveRice: give });

    if (res.type === "GIFT") {
      itemPickup(res.id);
      this.refresh();
      this.noteFound();
      this.tell(String(t.gave || "").replace("{gift}", this.itemName(res.id)), "good");
      return wait(RESULT_BEAT_MS);
    }

    this.tell(t.refused || "");
    await wait(RESULT_BEAT_MS);
    // The turn goes through so the panel can OPEN AS THE VILLAGER and change.
    // It is the same value #93 picks which villager is standing there with, so
    // the man who transforms is the man they just saw — deterministic by the
    // same route, and not a second source of truth.
    return this.fightBeat(res.n, { turnedFrom: this.state.turn });
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
            label: t.give || this.ui("give"),
            sub: this.ui("give-sub", { item: this.itemName("sticky-rice") }),
            primary: true,
            onClick: () => { clearChoices(); resolve(true); },
          },
          {
            kind: "refuse",
            label: t.refuse || this.ui("refuse"),
            sub: this.ui("refuse-sub", { n: ev.turnsInto }),
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
      log(this.line("heal-tile"), "good");
      this.refresh();
    }
    this.renderEndTurn(cued);
  }

  // What the end of a turn is still worth stopping for. Search is the first of
  // these to come back: it is free, it costs no turn, and it happens after the
  // room's event — so it belongs here, between the event and the clock.
  endTurnChoices() {
    const choices = [];
    // Nothing to rummage after: running means no event was drawn where you
    // landed (§8), and the turn is already over. Standing on the ward is the
    // opposite case — no event was drawn, but you are still here, so the room
    // is still yours to search.
    if (this.state.fled) return choices;
    const tile = Bd.currentTile(this.board);
    const table = tile && tile.def && tile.def.search;
    // One search per turn. Rummaging the same room again is what STAY is for,
    // and the price of it is the event that STAY draws — not the search.
    if (table && !this.searched) {
      const cat = this.categoryName(table);
      choices.push({
        kind: "search",
        label: this.ui("search"),
        sub: cat,
        onClick: () => this.doSearch(table),
      });
    }

    // 香堂's coil and 土地廟's prayer both stood here, free and once per run.
    // The post-launch redesign took the mechanics they belonged to, and no tile
    // carries an `action` any more — the shrine keeps only its search.
    return choices;
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
      this.noteFound();
      log(this.line("search-took", { item: iName(this, out.id) }), "good");
      // #92: the reveal comes BEFORE the pack changes. You find out from the
      // panel over the room, and then you watch it land — which is what makes
      // the panel news rather than a second copy of a cell that already
      // appeared. refresh() is what paints that cell, so it waits.
      //
      // The WHOLE refresh waits, rather than the pack's part of it, and that is
      // safe rather than lazy: E.search touches inventory and nothing else, so
      // the clock and the hearts have not moved and there is nothing else being
      // held. If a search ever costs health, this is the line that has to be
      // split.
      return void revealPanel(this, { id: out.id }, () => {
        this.refresh();
        this.renderEndTurn();
      });
    }

    // A weapon found while already armed. One hand, one blade, and the one you
    // put down stays on the floor of a room you have no reason to walk back
    // into — so this is a real decision and the engine handed it over undecided.
    //
    // Both attacks are on the buttons because the choice is unanswerable
    // without them: a 真火符 burned into the blade you are holding is worth a
    // point, and it can make worse steel the better weapon. FE's #32 dresses
    // this; what it must not do is decide it.
    if (out.result === "OFFER_REPLACE") {
      const name = (id) => iName(this, id);
      log(this.line("search-armed", { item: name(out.id), holding: name(out.current) }));
      // #92: reveal, THEN ask. The prompt's labels are text and numbers; the
      // panel is where the blade is actually seen. No refresh() here because
      // there was none before — nothing has been taken yet, so there is nothing
      // to paint.
      const armed = [
        {
          kind: "replace",
          primary: out.incomingAttack > out.currentAttack,
          label: this.ui("replace-take", { item: name(out.id), n: out.incomingAttack }),
          sub: this.ui("replace-take-sub", { item: name(out.current), n: out.currentAttack }),
          onClick: () => {
            const r = E.replaceWeapon(this.state, out.id);
            this.noteFound();
            log(this.line("search-replaced", { item: name(r.equipped), dropped: name(r.dropped) }), "good");
            this.refresh();
            this.renderEndTurn();
          },
        },
        {
          kind: "replace",
          primary: out.incomingAttack <= out.currentAttack,
          label: this.ui("replace-keep", { item: name(out.current), n: out.currentAttack }),
          sub: this.ui("replace-keep-sub", { item: name(out.id) }),
          onClick: () => {
            // Refusing it leaves it where it lies — and it stays there.
            E.declineWeapon(this.state, out.id);
            log(this.line("search-left", { item: name(out.id) }), "muted");
            this.refresh();
            this.renderEndTurn();
          },
        },
      ];
      return void revealPanel(this, { id: out.id }, () => {
        renderActions(armed, this.ui("replace-prompt", { item: name(out.id) }));
      });
    }

    if (out.result === "OFFER_DROP") {
      log(this.line("search-nowhere", { item: iName(this, out.id) }));
      // #92: reveal, then the dialog opens on top of what you were just shown.
      return void revealPanel(this, { id: out.id }, () => showDropDialog(this, out.id, {
        onDrop: (dropId, foundId) => this.takeInstead(foundId, dropId),
        onDropStack: (dropId, n, foundId) => {
          // A stack is one slot however deep it is, so dropping one of three
          // frees nothing. The whole stack goes down, then the find comes up
          // through the same door every other pickup uses.
          E.dropItem(this.state, dropId, n);
          this.takeInstead(foundId, null);
        },
        onLeave: (foundId) => {
          log(this.line("search-left", { item: iName(this, foundId) }), "muted");
          this.refresh();
          this.renderEndTurn();
        },
      }));
    }

    // Nothing. Said as rummaging rather than as a readout — the odds are in the
    // table and the player is entitled to feel them rather than read them. The
    // line varies by turn, which is deterministic: a replayed seed says the
    // same thing in the same room.
    // Picked by turn number rather than at random — a replayed seed has to say
    // the same thing in the same room, and the search stream is not to be
    // disturbed for flavour. Modulo the list's own length, so a language may
    // offer a different number of ways to find nothing.
    const empty = (this.data.theme.lines || {})["empty-handed"] || [];
    if (empty.length) log(empty[this.state.turn % empty.length], "muted");
    // #92, and this is the outcome the whole panel is for. Nothing was found,
    // so nothing on the HUD changes and nothing ever did — a search that came
    // up empty used to be a pause and then the turn ending. Now the room says
    // so, over the room, and the beat has a shape.
    revealPanel(this, { id: null }, () => {
      this.refresh();
      this.renderEndTurn();
    });
  }

  // What "{n} items found" counts: things you picked up and had in your hands.
  // Not the 神主牌, which is the night's object and gets its own row. Not a
  // find you looked at and left, and not the blade you dropped to take a better
  // one — that was counted when you found IT. Every acquisition route calls
  // this, and there are four: a clean take, a blade swap, a take-after-drop,
  // and the villager's thanks.
  //
  // Until #67 only two of the four counted, and one of those was the tablet.
  noteFound() {
    this.tally.found += 1;
  }

  takeInstead(foundId, dropId) {
    const got = E.pickUpItem(this.state, foundId, dropId);
    if (got.ok) {
      this.noteFound();
      if (dropId) log(this.line("search-swap", {
        dropped: iName(this, dropId), found: iName(this, foundId) }), "good");
      else log(this.line("search-kept", { item: iName(this, foundId) }), "good");
    } else {
      // The engine refused. Say so plainly rather than pretending it worked —
      // the only ways here are a duplicate unique or a stack that freed nothing,
      // and both are the player's business.
      log(this.line("search-no-room", { item: iName(this, foundId) }), "muted");
    }
    this.refresh();
    this.renderEndTurn();
  }

  // Medicine is the one thing the pack spends on its own account, outside a
  // fight and outside the turn's action.
  usePackItem(id) {
    // 硃砂 is the one pack item that needs a target, so it asks before it acts.
    if (id === "cinnabar") return this.useCinnabar();
    // 真火符 is the one pack item that acts on your HANDS rather than on you.
    if (id === "truefire-talisman") return this.useTruefire();
    // Watched rather than assumed (#86). tell() sends to both registers and
    // log() to one, and the rule for choosing was "numbers go to log alone,
    // because the HUD already shows those". That is true right up until the HUD
    // does not move — and it does not move when healing is CLAMPED. Eat a 糯米
    // at full health and useMedicine reports healed: 3, changeHealth caps it,
    // the hearts stay where they were, and the only thing that said anything
    // was a 1x1 clipped live region. The rulebook warns that rice at 9 health
    // is worth holding; the game took it and said nothing.
    //
    // So the test is what actually changed on screen, not what the call
    // returned.
    const before = this.state.health;
    const wasPoisoned = this.state.poisoned;
    const out = E.useMedicine(this.state, id);
    if (!out.ok) return;
    const name = iName(this, id);
    const moved = this.state.health !== before || this.state.poisoned !== wasPoisoned;
    if (!moved) {
      // Nothing on the panel to see it by, so it gets both registers.
      this.tell(this.line("use-wasted", { item: name }));
    } else if (out.healed > 0) {
      log(this.line("use-heal", { item: name, n: out.healed }), "good");
    } else if (out.healed < 0) {
      log(this.line("use-bad-half", { item: name, n: out.healed }), "bad");
    } else {
      log(this.line("use-plain", { item: name }));
    }
    if (out.cured) log(this.line("cured"), "good");
    this.refresh();
  }

  // 真火符 into the blade you are holding (#70). Permanent, one per blade, and
  // it leaves with that blade if you ever trade it away.
  //
  // This is the button the game was missing rather than a new rule: the engine
  // has always had buffSword and the tests for it, the item card advertised it,
  // and nothing in the UI called it — so the ONE loadout that reaches 鎮屍 could
  // not be assembled by a person. BE measured the hole: with the buff neutered,
  // seals across 800 identical seeds went 91 to 0. Not fewer. None.
  //
  // Free, like every other pack action. Spending your turn on it would make the
  // best blade in the game cost a draw at eleven o'clock, which is when you are
  // least able to pay and most likely to want it.
  useTruefire() {
    const sword = E.bestSword(this.state);
    const out = E.buffSword(this.state, sword);
    // The control is only offered when buffState says yes, so a refusal here
    // means the two disagreed. Fail quietly rather than half-acting.
    if (!out.ok) return;
    paperFlutter();
    this.refresh();
    this.tell(this.line("buff-burned", {
      item: this.itemName("truefire-talisman"),
      sword: this.itemName(sword),
      n: out.attack,
    }), "good");
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
        this.tell(this.line("cinnabar-painted", {
          item: this.itemName("cinnabar"),
          target: this.itemName(targetId),
          n: out.count,
        }), "good");
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
       { kind: "draw", label: this.ui("next-turn"), sub: this.ui("next-turn-sub"),
         primary: true, onClick: () => this.nextTurn() }],
      this.ui("quiet-prompt")
    );
  }

  nextTurn() {
    // The shell must never reload a run out from under the player, and a run is
    // not saved anywhere — so the moment a turn is actually spent, say so.
    markRunInProgress();
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
    this.tell(this.line("third-watch"), "toll");
    await wait(MIDNIGHT_TOLL_MS);

    // 溪澗 used to decline him — he would not cross running water, and standing
    // in it ended the night with no exchange at all. #56 removed that rule, so
    // the appointment is the same wherever you are standing and there is no
    // branch here any more.
    // Not the pack's sting. That one rises because the question is how fast
    // they reach you; this one falls, because there is no question.
    //
    // The room goes quiet and STAYS quiet. duckForScare takes the bed and the
    // murmur away and nothing here puts them back — the silence is the sound
    // design, and it holds through the strike to the verdict. Every other
    // set-piece unducks when its fight ends; this one has no fight.
    kingArrives();
    duckForScare();

    // His own scene, not jumpScare(1). One face from the pack's art read as
    // LESS than an ordinary doorway encounter, which is exactly backwards for
    // the one arrival the whole night walks toward.
    //
    // Skippable like any stage, and safe to skip for the usual reason turned up
    // as far as it goes: there is no text in it at all. §9 binds hardest here —
    // the kit question is the next thing that happens, and nothing about this
    // scene may hint at what the kit is worth.
    await kingScene();
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
          : sword ? this.ui("kit-only", { item: this.itemName(sword) }) : this.ui("kit-bare"),
        sub: this.ui("attack", { n: o.attack }),
        icon: itemArt(o.spends[0] || sword),
        primary: i === 0,
        // 血符 is written in your own blood before the strike, and at one heart
        // it kills the hand writing it — the same diedPaying rule as everywhere
        // else, and the card has to say so.
        cost: o.blood ? { hp: -o.blood } : null,
        onClick: () => { clearChoices(); resolve(o.use); },
      }));
      // THE PICTURE HAS TO AGREE WITH THE SENTENCE. kit-prompt reads "He is in
      // the doorway. One strike — what do you show him?", and until now the
      // figure under that line was whatever packRow happened to draw: a
      // hard-coded tier 4 head for as long as this row has existed, and then
      // tier 3 once the hard-coding was removed and the 1 got clamped. Both
      // are the wrong creature standing in a doorway the prose has just said
      // HE is standing in.
      renderActions(acts, this.ui("kit-prompt"), { pack: "king", health: this.state.health });
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
      { label: this.ui("play-again"), primary: true, onClick: () => startNewGame() },
      { label: this.ui("replay-seed"), onClick: () => startNewGame(this.seed) },
      // A finished run is exactly when someone wants to hand the seed on.
      { label: this.ui("copy-link"), onClick: (btn) => copyReplayLink(btn) },
      { label: this.ui("menu"), href: "index.html" },
    ];

    const summary = [
      this.verdictLine("lasted", { hour: formatHour(this.state.hour) }),
      this.verdictLine("put-down", { n: this.tally.fights, monsters: this.word("monsters") }),
      this.tally.found === 1
        ? this.verdictLine("found-one")
        : this.verdictLine("found-many", { n: this.tally.found }),
      this.relicLine(outcome),
      this.verdictLine("seed", { seed: this.seed }),
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

    const title = outs[outcome] ||
      this.verdictLine(won ? "won-fallback" : "lost-fallback");
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
    if (outcome === E.OUTCOMES.WIN_BURIAL) return this.verdictLine("relic-buried", { relic });
    if (this.state.tablet) return this.verdictLine("relic-carried", { relic });
    return this.verdictLine("relic-lost", { relic });
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
  // The stage explains how to dismiss itself for the first couple of events of
  // a run. A fresh run earns that again — someone else may have picked the game
  // up since — and it costs two lines rather than a preference nobody asked for.
  resetStageHints();
  // The reveal explains itself on the same policy and resets at the same
  // moment, so the two layers over the board do not disagree about whether this
  // is a fresh player.
  resetRevealHint();
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
  game.start();
}

function seedFromUrl() {
  const raw = new URLSearchParams(location.search).get("seed");
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : null;
}

// ---- Run controls ----------------------------------------------------------
// The seed, copied. The HUD button that used to call this is gone (#55), and the
// verdict card is where it belongs anyway — a seed is worth sharing at the end
// of a night rather than in the middle of one. The caller always hands us its
// own button now, so the old lookup fallback would only ever have found nothing.
async function copyReplayLink(btn) {
  if (!btn) return;
  const url = `${location.origin}${location.pathname}?seed=${game.seed}`;
  try {
    await navigator.clipboard.writeText(url);
    const was = btn.title || btn.textContent;
    if (btn.title) {
      btn.title = uiWord("link-copied");
      btn.classList.add("utilbtn--done");
      setTimeout(() => {
        btn.title = was;
        btn.classList.remove("utilbtn--done");
      }, 1800);
    } else {
      btn.textContent = uiWord("link-copied");
      setTimeout(() => (btn.textContent = was), 1800);
    }
  } catch {
    // Clipboard refused (insecure context or denied permission) — put the link
    // in the log so it can still be copied by hand.
    log(uiWord("replay-link-fallback", { url }));
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



function wireControls() {
  // The sound button and the note button went with the utility panel (#73).
  // M SURVIVES, and it is the reason the mute is a courtesy rather than a wall:
  // the browser's own tab-mute is the other. It has no visible state any more,
  // which is the honest cost of removing the only thing that showed it.
  //
  // M is off the 1-9 action path on purpose, and ignored while typing.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "m" && e.key !== "M") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    setMuted(!isMuted());
  });
  document.getElementById("btn-new-game").addEventListener("click", () => {
    // Drop ?seed= so a shared link doesn't silently reapply to the fresh run.
    if (location.search) history.replaceState(null, "", location.pathname);
    startNewGame();
  });

  // The language button wires its own click inside langswitch.js (#78). It also
  // does not exist yet at this point — it is appended after this runs — so a
  // listener here would silently attach to nothing and look fine.
}

// ---- Language ----------------------------------------------------------------
// Two languages, so the control is a toggle rather than a menu. It cycles the
// list, which is why adding a third needs no change here.
//
// Switching mid-run does NOT restart the night. The theme is swapped underneath
// the run and everything visible is drawn again from it — the board, the panel,
// and the choice window when it is safe to redraw. The log is left alone: it is
// the narration already spoken, it is screen-reader-only, and rewriting history
// into another language would be a stranger thing to do than leaving it.
async function useLanguage(lang) {
  L.remember(lang);
  L.stampDocument(lang);
  data.lang = lang;
  data.theme = await L.themeFor(data.baseTheme, lang, FETCH_OPTS);
  paintLangToggle();
  // The furniture and the two toggles are static nodes: nothing redraws them,
  // so a switch has to write them itself.
  paintChrome();
  if (!game) return;
  game.data.theme = data.theme;
  game.refresh();
  // Only the move step is safe to redraw from scratch: it is regenerated from
  // the board every turn anyway. A fight or a dialog is holding a promise that
  // a re-render would strand, so those keep the language they opened in and the
  // next window arrives in the new one.
  if (document.querySelector(".doorway")) game.renderMoves();
}

// The page's furniture: the nav, the panel headings, the utility buttons and
// the aria-labels nobody sees. All static nodes in game.html, which is exactly
// why they survived a sweep of what the game DRAWS — nothing redraws them, so
// they have to be written once on load and again on every switch.
function paintChrome() {
  const text = {
    "nav-rulebook": "nav-rulebook", "nav-menu": "nav-menu",
    "page-title": "page-title",
    // "backpack" and "hands-title" went with the panel merge: the sidebar is
    // one surface now and the two headings were labelling what the drawings
    // already say. Their theme keys went with them in both languages — a key
    // that paints an element which does not exist is the quiet kind of rot.
    brand: "brand",
  };
  for (const [id, key] of Object.entries(text)) {
    const el = document.getElementById(id);
    if (el) el.textContent = uiWord(key);
  }
  const newGame = document.getElementById("btn-new-game");
  if (newGame) newGame.textContent = uiWord("new-game");

  // Spoken, not shown. A screen reader in Chinese was getting the whole panel
  // in English, which is the half of the page a visual sweep cannot check.
  const aria = [
    ["board-pane", "aria-board-pane"], ["board", "aria-board"],
    ["actions-pop", "aria-actions"], ["log", "aria-log"],
  ];
  for (const [id, key] of aria) {
    const el = document.getElementById(id);
    if (el) el.setAttribute("aria-label", uiWord(key));
  }
  // Nothing left with a title to write: the language button carries its
  // destination as visible text since #77, which is its own accessible name.
}

function paintLangToggle() {
  if (!data) return;
  paintLangSwitch(data.lang);
}

async function main() {
  try {
    // Icons are decorative, so a failed sprite must not block the game.
    [data] = await Promise.all([loadData(), loadIcons()]);
    wireControls();
    mountLangSwitch({ current: data.lang, onPick: (to) => useLanguage(to) });
  wireSleep();
  registerWorker();
    paintLangToggle();
    paintChrome();
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
    log(uiWord("start-failed"), "bad");
  }
}

// BOOT ONLY ON THE GAME PAGE. This module used to call main() on import, which
// meant importing it from anywhere -- a test page, a tool -- started a whole
// run: fetching data, mounting the board, taking over the DOM. A module that
// boots itself cannot be tested, and #92's ordering is exactly the kind of
// thing that has to be driven rather than read.
//
// #board is the marker because it is the game page's own root and no other page
// has it. If this ever stops booting, that element was renamed.
if (typeof document !== "undefined" && document.getElementById("board")) main();
