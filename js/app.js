// Game page controller — orchestrates the turn, wiring user input -> engine +
// board -> render. Owns the RNG seed.
//
// TILE-EXPLORING BUILD. One action a turn — move or stay — then the room's own
// instructions, then six minutes off the clock. No cards are drawn, so no
// events, items, searches or fights can happen; see the note at the top of
// engine.js.

import * as E from "./engine.js";
import * as Bd from "./board.js";
import { isMuted, setMuted, isCalm, setCalm, relicFound, seamCross, verdictSting,
         startAmbience, stopAmbience, stopScore } from "./audio.js";
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
    // Kept for the end-of-run verdict; the engine has no use for them.
    this.tally = { putDown: 0, found: 0 };
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
    const goal = this.data.tiles.outdoor.find((d) => d.onResolve === "SECOND_CARD_THEN_BURY_TOTEM");
    log(
      `You wake in the ${this.tileName(Bd.currentTile(this.board).id)}. Find the ${this.word("relic")}` +
        (goal ? `, bury it in the ${this.tileName(goal.id)}` : "") +
        ` before midnight.`
    );
    this.renderMoves();
  }

  // ---- Step 1: choose an action --------------------------------------------
  // MOVE or STAY. Movement is optional in this game, unlike the source it came
  // from — but standing still costs a turn exactly like walking does, so there
  // is no free turn and STAY is always on the table, dead end or not.
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
    renderActions(acts, "Move on, or stay put — either spends six minutes.");
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
    const revealed = this.board.decks[this.board.player.world][0];
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
  arrive() {
    if (this.state.status !== "playing") return this.gameOver();
    this.refresh();
    this.roomEffect();
  }

  // The two rooms that still do something.
  //
  // PLACEHOLDER, and deliberately a loud one: the rulebook leaves the cost of
  // both rites open — "a turn each, an event each, or both" — so this build
  // charges nothing for either. Standing in the room is enough. That is not a
  // ruling on the cost, it is the absence of one, and it exists only so the map
  // has a goal to be tested against. Fix it when the rites are designed.
  roomEffect() {
    const onr = Bd.currentTile(this.board).def.onResolve;
    if (onr === "SECOND_CARD_THEN_GAIN_TOTEM" && !this.state.totem) {
      E.gainTotem(this.state);
      relicFound();
      this.tally.found += 1;
      log(`Among the coffins, the ${this.word("relic")}. It is yours.`, "good");
      this.refresh();
    } else if (onr === "SECOND_CARD_THEN_BURY_TOTEM" && this.state.totem) {
      E.buryTotem(this.state);
      this.refresh();
      if (this.state.status === "won") return this.gameOver();
    }
    return this.deadEndCheck();
  }

  // ---- Dead ends -----------------------------------------------------------
  // A room with no way on still has to be leavable, or every tile behind it is
  // stranded and the crypt or the grave may never reach the table. With nothing
  // left in the game to break the wall, the wall simply gives way: no fight, no
  // telegraph, no cost. Pure topology, kept because it is load-bearing for
  // placement — see the seed sweep in tests/board.test.js.
  deadEndCheck() {
    if (this.state.status !== "playing") return this.gameOver();
    if (Bd.isDeadEnd(this.board)) {
      const wall = Bd.pickZombieDoorWall(this.board);
      if (wall) {
        Bd.openZombieDoor(this.board, wall);
        log(`Nowhere on from here — until the ${DIR_WORD[wall]} wall gives way.`);
        this.refresh();
      }
    }
    // The one place a phantom can fire: the turn is done and nothing real is
    // happening. Rolled at a fixed point rather than on a timer, because a
    // shared seed has to hear the same house. Not rolled at all in calm mode —
    // rather than rolled and discarded — so toggling calm mid-run does not
    // change what a seed does afterwards.
    // Whether anything was mounted ONTO THE BOARD this turn. It matters because
    // the next turn rebuilds .focus from nothing: a phantom lives inside a
    // half-room and the standing figure inside an empty slot, so both are
    // destroyed by the very next render. While the turn ended on a button they
    // got their two seconds from the player's own pause. Nothing pauses now, so
    // the beat has to be asked for. The guttering candle is not counted — it is
    // a class on <body> and survives the rebuild on its own.
    let cued = false;
    if (!isCalm()) {
      const fear = E.dread(this.state);
      const dir = E.rollPhantom(this.state, fear);
      if (dir) { phantom(dir); cued = true; }
      // The candle fails on its own schedule, and always when a phantom fires:
      // the two together are one event — something moved, and the light went
      // with it — where separately they are two effects.
      if (dir || E.rollGutter(this.state, fear)) candleGutter();
      // Once a run at the outside, and never on the same beat as a phantom:
      // two unexplained things at once is a haunting, and one is a doubt.
      // standing() returns true only when it actually put a figure in a dark
      // slot — it declines in calm mode, under reduced motion, and when every
      // slot already has a room in it. Only a figure that exists needs a beat.
      if (!dir && E.rollStanding(this.state, fear) && standing()) cued = true;
    }
    return this.endTurn(cued);
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

  // What the end of a turn is still worth stopping for. Empty in this build:
  // cowering, the rites and the searches all went with the card system, so
  // there is nothing here to decide. It is a list rather than a boolean because
  // the moment any of them come back this is where they go, and the choice
  // between prompting and not should follow from whether a choice exists.
  endTurnChoices() {
    return [];
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
    // The turn IS the clock, so this is where the night moves. Turn 31 is not a
    // turn: it is midnight, and advanceTurn ends the run rather than granting
    // one. The duel that should happen there is not designed yet.
    E.advanceTurn(this.state);
    if (this.state.status !== "playing") return this.gameOver();
    E.beginTurn(this.state);
    this.refresh();
    this.renderMoves();
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
    const won = this.state.status === "won";

    // Counted once, and the guard is load-bearing: the win path re-enters
    // gameOver after the silent beat below, so without it every escape would
    // be recorded twice and every one of those runs would look like two.
    if (!this.tallied) {
      this.tallied = true;
      recordVerdict(won);
    }

    // A win is always a burial — buryTotem is the only thing that sets it — so
    // this is the moment the digging has been building to. One silent beat
    // before the dawn: the release is the silence, not the sting.
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
      won
        ? `The ${this.word("relic")} is buried`
        : this.state.totem
          ? `The ${this.word("relic")} was on you, unburied`
          : `The ${this.word("relic")} was never found`,
      `Seed ${this.seed}`,
    ];

    // The sentence somebody might actually screenshot, above the rows nobody
    // does. Composed here so both verdicts get it from one place.
    const closing = epilogue(this);

    if (won) {
      showOverlay(
        "You made it to dawn",
        `The ${this.word("relic")} is buried. The house falls silent.`,
        again,
        { tone: "won", summary, epilogue: closing }
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
      { tone: "lost", reason: this.state.lossReason, summary, epilogue: closing }
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
  clearStage();
  // A run is in progress: the screen stays lit. Released at the verdict, so a
  // finished game is not quietly holding the phone awake.
  keepAwake(true);
  // A new run gets the wind back, and never a second copy of it — startAmbience
  // is idempotent, so restarting mid-run is safe.
  startAmbience();
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
// First run only. The key is the whole mechanism: no zitp:seen means nobody has
// played here before.
//
// Off the RNG entirely — showing the note is presentation, so a shared seed
// plays out identically whether or not the note appeared. That matters more
// than it looks: reading the note takes time, and time is exactly what this
// game measures, so it must not be allowed to cost any.
const SEEN_KEY = "zitp:seen";

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
