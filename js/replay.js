// Replaying a recorded night, with no DOM (#142).
//
// THIS FILE MIRRORS js/app.js's TURN ORDER AND THAT IS ITS WHOLE DIFFICULTY.
// tools/bots.js is the proven headless driver and the shape here is its shape —
// a loop over turns where a policy supplies the decisions — but the ORDER of
// engine calls has to be the one a human actually walked, which is app.js's and
// not bots.js's. The two differ: bots search inside the turn body, app.js offers
// search among the end-of-turn choices; bots resolve the villager inline, app.js
// asks before resolving. A replay that follows the wrong order desynchronises
// silently and produces a valid night with a wrong score.
//
// So every step below names the app.js method it transcribes. If that file's
// order changes and this one does not, the guard in tests/replay.test.js goes
// red on the whole verdict rather than on one field — which is the only reason
// a transcription is safe to keep.
//
// The Worker in #143 imports this: no DOM, no fetch, no timers, no audio.

import * as E from "./engine.js";
import * as B from "./board.js";
import { verdictOf } from "./night.js";

// The action vocabulary, language-independent and shared with the recorder.
// One list so a decision the recorder can write and the replayer cannot read is
// impossible to introduce quietly.
export const ACT = {
  STAY: "stay", EXPLORE: "explore", MOVE: "move", OUTSIDE: "outside",
  RICE: "rice",                        // the villager: give or refuse
  FIGHT: "fight", ESCAPE: "escape", FLEE: "flee",
  REPLACE: "replace",                  // a blade offered against the one held
  DROP: "drop", TAKE: "take",          // a full pack
  SEARCH: "search", USE: "use", TRUEFIRE: "truefire", CINNABAR: "cinnabar",
  NEXT: "next",                        // end the turn
  KIT: "kit",                          // what is brought to midnight
};

// THE RITE IS NOT RECORDED, and the reason is stronger than "it is only a few
// presses": IT IS NOT A DECISION AT ALL. app.js:530 riteBeat fires from where
// the player is STANDING — goal tile, riteDraws() true — with no button to
// decline and no branch to take. completeRite() consumes no draw and reads only
// state.fled and state.tablet, so a replay that arrives at the same tile in the
// same state performs the same rite by arriving.
//
// Its one branch is `fled`, and fleeing IS recorded (ACT.FLEE), so the abort
// path is derived from an action rather than guessed at. That is what makes the
// omission checkable rather than a hope.
//
// If the burial ever becomes a choice — dig or walk away — it stops being a
// consequence and becomes an action, and it belongs in the list above.

// THE FOUR WAYS A TURN CAN BE ANSWERED AT THE BOARD, named once because two
// places ask the question: the turn loop dispatches them, and the end-of-turn
// window has to recognise one arriving instead of a press of next.
const BOARD_ACTS = new Set([ACT.STAY, ACT.EXPLORE, ACT.MOVE, ACT.OUTSIDE]);

class Divergence extends Error {}

// A replay reads decisions from the list instead of from a person. Running out
// is not "the night ended": it means the recording is INCOMPLETE, which is the
// failure this whole design exists to catch, so it is loud.
function reader(actions) {
  let i = 0;
  return {
    next(expect) {
      if (i >= actions.length) {
        throw new Divergence(
          "the recording ran out after " + actions.length + " actions while the " +
          "replay still wanted " + (expect || "a decision") + " — an unrecorded " +
          "decision does not throw during play, it silently produces a different night");
      }
      const a = actions[i++];
      if (expect && a.t !== expect) {
        throw new Divergence(
          "action " + i + " is " + a.t + " and the replay wanted " + expect +
          " — the recorded order and the engine's order have come apart");
      }
      return a;
    },
    peek() { return i < actions.length ? actions[i] : null; },
    used() { return i; },
    left() { return actions.length - i; },
  };
}

export function replayNight(data, night) {
  if (!night || typeof night.seed !== "number") {
    throw new Divergence("a night with no seed cannot be replayed");
  }
  const state = E.newGame(data, { seed: night.seed });
  const board = B.createBoard(data, { seed: night.seed });
  const tally = { fights: 0, found: 0 };
  const act = reader(night.actions || []);

  let guard = 0;
  while (state.status === "playing") {
    if (++guard > 400) throw new Divergence("the replay did not terminate");

    // ---- app.js:1476 — the clock, then app.js:236 beginTurn ----------------
    E.beginTurn(state);
    if (state.status !== "playing") break;

    // ---- app.js:256 renderMoves --------------------------------------------
    // A TURN IS NOT ONE BOARD ACTION, and assuming it was is what made a real
    // recorded night fail to replay. app.js:347 arrive() is async and doMove
    // does not await it, so the board's doorways are still live while the beat
    // runs; a second press is taken. Measured on a robot-driven night at seed
    // 99: turn 13 holds move(N) then move(S) and BOTH move the player, and turn
    // 10 holds a second move(W) that the board refuses.
    //
    // The refused one is recorded too, and that is correct rather than sloppy:
    // doMove ignores moveTo's result and calls arrive() anyway, so a move into a
    // wall still DRAWS AN EVENT at the player — measured, eventRng advances by
    // one. Dropping it from the recording would leave the replay one draw
    // behind for the rest of the night, which is the silent divergence this
    // whole format exists to prevent. So it is replayed exactly as it happened,
    // wasted beat and all.
    let inTurn = 0;
    for (;;) {
      if (++inTurn > 60) throw new Divergence("a turn did not end");
      const a = act.next();
      if (a.t === ACT.EXPLORE) {
        // app.js:293 doExplore. The rotation is CHOSEN BY THE BOARD, not the
        // player — pickExploreRotation scores and does not roll — so it is
        // derived here rather than recorded.
        B.explore(board, a.dir, B.pickExploreRotation(board, a.dir));
      } else if (a.t === ACT.MOVE) {
        B.moveTo(board, a.dir);                                // app.js:314
      } else if (a.t === ACT.OUTSIDE) {
        B.goOutside(board);                                    // app.js:326
      } else if (a.t !== ACT.STAY) {                           // app.js:284
        throw new Divergence("turn " + state.turn + " was answered at the board " +
          "with " + a.t + " — that is stay, move, explore or outside");
      }

      // ---- app.js:347 arrive(), and it runs AGAIN for each of them ---------
      eventBeat(data, state, board, tally, act);
      if (state.status !== "playing") break;
      if (!state.fled) {
        riteBeat(data, state, board, tally, act);
        if (state.status !== "playing") break;
      }
      if (!state.fled) {
        breachBeat(data, state, board, tally, act);
        if (state.status !== "playing") break;
      }
      if (!state.fled) ghostBeat(state);

      // ---- app.js:1125 endTurn --------------------------------------------
      if (!state.fled) {
        const tile = B.currentTile(board);
        if (tile && tile.def.onTurnEnd === "HEAL_1") {
          E.changeHealth(state, 1);
          E.grantRelief(state, 0.7);
        }
      }
      if (state.status !== "playing") break;

      // ---- app.js:1142 endTurnChoices --------------------------------------
      // Hands back "again" when the next recorded decision is another board
      // action rather than a press of next, which is the turn continuing.
      if (endTurnChoices(data, state, board, tally, act) !== "again") break;
      if (state.status !== "playing") break;
    }
    if (state.status !== "playing") break;

    // ---- app.js:1474 — midnight intercepts, it is not a turn ---------------
    if (state.turn >= E.RULES.TOTAL_TURNS) {
      const kit = act.next(ACT.KIT);
      E.midnight(state, { use: kit.use || {} });
      break;
    }
    E.advanceTurn(state);
  }

  return {
    state, board, tally,
    verdict: verdictOf(state, tally),
    used: act.used(),
    // Actions left over are as much a divergence as running out: the replay
    // finished the night without spending decisions the player made, which
    // means it took a different road to a plausible end.
    unused: act.left(),
  };
}

// ---- app.js:424 eventBeat ----------------------------------------------------
function eventBeat(data, state, board, tally, act) {
  if (state.status !== "playing") return;
  if (B.isWarded(board)) return;              // 石敢當: nothing is drawn
  const ev = E.drawEvent(state);
  if (!ev) return;

  if (ev.t === "VILLAGER") {
    // app.js:1059 villagerBeat — asked BEFORE resolving, because whether the
    // rice is given is an input to resolveEvent and not a reaction to it. If
    // there is no rice the game never asks, and neither does this.
    let give = false;
    if (E.held(state, "sticky-rice")) give = !!act.next(ACT.RICE).give;
    const res = E.resolveEvent(state, ev, { giveRice: give });
    if (res.type === "FIGHT") fightBeat(data, state, board, tally, act, res.n);
    return;
  }

  const res = E.resolveEvent(state, ev);
  if (res.type === "FIGHT") fightBeat(data, state, board, tally, act, res.n);
}

// ---- app.js:722 fightBeat, and the three ways out ---------------------------
function fightBeat(data, state, board, tally, act, n) {
  if (state.status !== "playing") return;
  const a = act.next();
  if (a.t === ACT.FIGHT) {
    // app.js:952 doFight
    const r = E.resolveCombat(state, n, a.use || {});
    // 血符 IS PAID BEFORE THE SWING, and if the blood kills you the strike never
    // happened — app.js returns here without counting. That is the only early
    // exit, and mirroring it is not optional.
    if (r.diedPaying) return;
    // app.js:995 — one counter, and it counts FIGHTS rather than summing attack
    // power, because the card says "{n} jiangshi put down".
    //
    // COUNTED EVEN WHEN THE FIGHT KILLED YOU. A first draft guarded this with
    // `if (state.status === "playing")`, which looks like ordinary care and is
    // wrong: the fight that ends the night is still a fight that happened, and
    // app.js counts it. The whole-card comparison is what caught it — every
    // other field matched and only `kills` was short by one, which is exactly
    // the divergence a single-field check waves through.
    tally.fights += 1;
    return;
  }
  if (a.t === ACT.ESCAPE) {
    E.escapeFight(state, { vsKing: false });   // app.js:1018
    return;
  }
  if (a.t === ACT.FLEE) {
    E.flee(state);                             // app.js:1031
    B.moveTo(board, a.dir);
    return;
  }
  throw new Divergence("a fight was answered with " + a.t);
}

// ---- app.js:503 riteBeat -----------------------------------------------------
function riteBeat(data, state, board, tally, act) {
  if (state.status !== "playing") return;
  const goal = B.currentTile(board).def.goal;
  if (!goal || !E.riteDraws(state, goal)) return;

  // THE RITE DRAWS ITS OWN EVENT, through the same beat. This is the step most
  // likely to be missed by a replay written from the issue rather than from the
  // code, and missing it eats one event draw for every rite ever performed.
  eventBeat(data, state, board, tally, act);
  if (state.status !== "playing" || state.fled) return;

  // The burial's three presses are not recorded (see the note at the top), and
  // completeRite comes AFTER them in app.js — the order matters there because
  // finish() sets the status synchronously, and it costs nothing to keep the
  // same order here.
  E.completeRite(state, goal);
}

// ---- app.js:639 breachBeat ---------------------------------------------------
function breachBeat(data, state, board, tally, act) {
  if (state.status !== "playing") return;
  if (!B.isDeadEnd(board)) return;
  const wall = B.pickZombieDoorWall(board);
  const n = E.breachAfterEvent(state, {
    deadEnd: true, fled: state.fled, warded: B.isWarded(board),
  });
  if (!n) {
    if (wall) B.openZombieDoor(board, wall);
    return;
  }
  if (!wall) return;                       // no wall to give
  B.openZombieDoor(board, wall);
  fightBeat(data, state, board, tally, act, n);
}

// ---- app.js:694 ghostBeat ----------------------------------------------------
// PRESENTATION ONLY, AND MIRRORED ANYWAY. None of these three change the score,
// but they draw from state streams, and a replay that skips them leaves those
// streams at different positions than the played night — which matters the
// moment a snapshot is taken of a replay, or a stream is ever read for anything
// but a cue. The SHORT-CIRCUIT is the part to get right: gutter and standing
// are only rolled when no phantom appeared.
function ghostBeat(state) {
  const fear = E.dread(state);
  const dir = E.rollPhantom(state, fear);
  if (!dir) E.rollGutter(state, fear);
  if (!dir) E.rollStanding(state, fear);
}

// ---- app.js:1142 endTurnChoices ---------------------------------------------
// Returns "over" when the turn ended, "again" when the player took another
// board action instead of pressing next. app.js renders the end-of-turn window
// WITHOUT taking the board away, so both are ordinary things to meet here; the
// board action is left unconsumed for the turn loop to dispatch.
function endTurnChoices(data, state, board, tally, act) {
  let guard = 0;
  for (;;) {
    if (++guard > 60) throw new Divergence("the end of a turn did not end");
    if (state.status !== "playing") return "over";
    const ahead = act.peek();
    if (ahead && BOARD_ACTS.has(ahead.t)) return "again";
    const a = act.next();
    if (a.t === ACT.NEXT) return "over";

    if (a.t === ACT.SEARCH) {
      doSearch(data, state, board, tally, act);
      continue;
    }
    if (a.t === ACT.USE) { E.useMedicine(state, a.id); continue; }
    if (a.t === ACT.TRUEFIRE) {
      E.buffSword(state, E.bestSword(state));   // app.js:1404
      continue;
    }
    if (a.t === ACT.CINNABAR) { E.useCinnabar(state, a.target); continue; }
    throw new Divergence("the end of a turn was answered with " + a.t);
  }
}

// ---- app.js:1191 doSearch ----------------------------------------------------
function doSearch(data, state, board, tally, act) {
  const tile = B.currentTile(board);
  const table = tile && tile.def && tile.def.search;
  if (!table) throw new Divergence("a search was recorded on a room with no table");
  const out = E.search(state, table);

  if (out.result === "TOOK") { tally.found += 1; return; }
  if (out.result === "OFFER_REPLACE") {
    const a = act.next(ACT.REPLACE);
    if (a.take) E.replaceWeapon(state, out.id);
    else E.declineWeapon(state, out.id);
    return;
  }
  if (out.result === "PACK_FULL") {
    // app.js:1272 — drop something for it, or leave it where it is.
    const a = act.next();
    if (a.t === ACT.DROP) { E.dropItem(state, a.id, a.n ?? 1); E.pickUpItem(state, out.id, a.id); tally.found += 1; }
    else if (a.t === ACT.TAKE) { E.pickUpItem(state, a.foundId, a.dropId); tally.found += 1; }
    else if (a.t !== ACT.NEXT) {
      throw new Divergence("a full pack was answered with " + a.t);
    }
    return;
  }
}

export { Divergence };
