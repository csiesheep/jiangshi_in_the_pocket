// A REACHABILITY TOOL. It walks the game to a NAMED STATE so somebody can look
// at the screen that state draws.
//
// ────────────────────────────────────────────────────────────────────────────
// NOTHING THIS PRODUCES IS A RATE, AND IT IS NOT A POLICY.
//
// A policy optimises for PLAYING WELL, and its outcomes are rates about the
// game. This optimises for ARRIVING SOMEWHERE, and its outcomes are not rates
// about anything, because it is not playing — it is walking to a place. It
// takes the shortest path it can see to a target it was TOLD, ignores every
// consideration that does not serve arriving, and would be a terrible player.
//
// tools/bots.js is the instrument that measures this game: four policies, a
// thousand seeds each, dice of their own. When somebody asks how often a run
// buries the tablet, tools/bots-report.md has the answer and is the only thing
// quotable. If a sentence needs a number, it comes from there or it does not
// get said.
// ────────────────────────────────────────────────────────────────────────────
//
// WHAT IT IS FOR. Three of the game's four endings had never been rendered by
// anything — not by a person, not by a test, not by a harness (#96). The
// verdict card is the one screen with a history of shipping false text: three
// false statements went out while 280 tests passed (#66), because instruments
// call the engine and read `outcome`, and nothing had ever drawn the ending and
// read it. This is the mechanism for drawing it.
//
// IT MUST BE POINTED. There is no default target and reachFor() throws without
// one. A tool you have to aim cannot be mistaken for one that plays: "run it
// and see what happens" is not a thing this can do.
//
// THE SURVIVAL FLOOR SERVES REACHABILITY, NOT PLAY QUALITY, and the distinction
// is not a wording trick — you cannot arrive at the grave if you die in the
// first hour. tools/bots.js records the same necessity for the same reason:
// "Without it a bot dies on turn five and measures nothing but the first five
// turns — which is what the fuzz found the hard way." Ours is thinner than
// theirs on purpose: it declines what the game has already drawn as lethal and
// takes what the game has already drawn as recommended, and that is all. It is
// not choosing well; it is choosing what the screen says.
//
// MEASURE THE CHAIN, NOT THE OUTCOME. "Did it win" tells you only that it did
// not. The chain says which link broke, and every useful thing this found came
// from that: twenty-five nights of a coin-flipping robot said almost nothing
// until somebody looked at state.tablet and found it false in 28 of 28 samples.

import * as B from "./board.js";

// ---- The targets, and there is no default ----------------------------------
// A target is a STATE TO ARRIVE AT, named, and the chain is the preconditions
// that reaching it passes through.
//
// They are listed rather than parameterised because they are different SHAPES
// of problem: the burial is navigation — be in a particular room holding a
// particular thing — and the two midnight endings are survival, be alive at
// midnight with the attack above or below the King's threshold. Only `burial`
// has been driven to a rendered card; the other two are the same loop pointed
// at a different state and have not been, which is said here rather than
// implied by their presence.
const TARGETS = {
  burial: {
    outcome: "WIN_BURIAL",
    // Both rites fire on their own inside riteBeat() when you are standing in
    // the room, so this only ever has to ARRIVE. It never presses a rite.
    goalFor: (s) => (s.tablet ? "mass-grave" : "sealed-crypt"),
  },
  seal: { outcome: "WIN_SEAL", goalFor: () => null },
  king: { outcome: "LOSS_KING", goalFor: () => null },
};

// ---- Getting about ---------------------------------------------------------
// Breadth-first over tiles that are actually joined, answering with the FIRST
// STEP rather than the path. Lifted from tools/bots.js rather than reinvented:
// two implementations of "which way is the grave" would drift, and only one of
// them is exercised by the sweeps.
function stepToward(board, want) {
  const start = B.currentTile(board);
  if (!start) return null;
  const save = { ...board.player };
  const at = (t, fn) => {
    board.player = { world: t.world, x: t.x, y: t.y };
    const v = fn();
    board.player = save;
    return v;
  };
  const key = (t) => `${t.world}:${t.x},${t.y}`;
  const seen = new Set([key(start)]);
  let frontier = at(start, () => B.listMoves(board))
    .filter((m) => m.type === "move" || m.type === "cross")
    .map((m) => ({ first: m.dir, tile: board.worlds[m.to.world].get(B.cellKey(m.to.x, m.to.y)) }))
    .filter((n) => n.tile);
  for (const n of frontier) seen.add(key(n.tile));
  let depth = 0;
  while (frontier.length && depth++ < 40) {
    for (const n of frontier) if (want(n.tile)) return n.first;
    const next = [];
    for (const n of frontier) {
      for (const m of at(n.tile, () => B.listMoves(board))) {
        if (m.type !== "move" && m.type !== "cross") continue;
        const t = board.worlds[m.to.world].get(B.cellKey(m.to.x, m.to.y));
        if (!t || seen.has(key(t))) continue;
        seen.add(key(t));
        next.push({ first: n.first, tile: t });
      }
    }
    frontier = next;
  }
  return null;
}

// Does this tile have a way OUT of the house? Asked by standing on it, because
// a tile does not carry its own exits in a form that answers this — listMoves
// reads from wherever the player is, so the only honest way to ask about
// somewhere else is to be there for the length of the question.
function hasOutside(board, tile) {
  const save = { ...board.player };
  board.player = { world: tile.world, x: tile.x, y: tile.y };
  const yes = B.listMoves(board).some((m) => m.type === "outside");
  board.player = save;
  return yes;
}

function placed(board, id) {
  for (const w of ["indoor", "outdoor"]) {
    for (const t of board.worlds[w].values()) if (t.id === id) return t;
  }
  return null;
}

const vis = (e) =>
  e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";

// The per-run flags, named once so the chain counters and the furthest-link
// tally cannot drift apart by one of them being renamed.
const SEEN_KEY = {
  reachedCrypt: "crypt", tookTablet: "tablet", wentOutside: "out",
  sawGrave: "saw", reachedGrave: "grave",
};

// ---- Reading the screen ----------------------------------------------------

// THE ENDING IS A THING ON SCREEN. Never `state.status`: pressing "play again"
// builds a NEW Game whose status is already "playing" while the previous
// overlay is still mounted, so a status gate sees nothing ended, forever, and
// the driver spins with no doorways to press. Measured at 2155 wasted steps.
//
// That is the same lesson #96 records about offsetParent, arriving from the
// other side — one driver counted a single loss eight times by ignoring
// visibility, another counted a real ending as zero by trusting it. Together
// the rule is: the ending is the CARD, and every attempt to infer it from
// somewhere else has failed differently.
function endingCard() {
  const card = document.querySelector(".overlay-card");
  if (!card || !vis(card)) return null;
  const again = [...card.querySelectorAll("button")]
    .filter(vis)
    .find((b) => /play again|new game|再玩|重新/i.test(b.textContent));
  return again ? { card, again } : null;
}

// A MODAL WHILE THE GAME IS STILL "playing". The drop dialog and the 硃砂
// picker both cover the board with a scrim, so every doorway is hidden and a
// driver that only hunts doorways spins behind it. Measured at 9000 steps.
//
// It LEAVES the find rather than answering: the pack is not part of any chain
// here, and the question costs turns this does not have. That is a reachability
// choice which makes the tool a worse player, and that is the point.
function openModal() {
  const m = document.querySelector(".notecard");
  if (!m || !vis(m)) return null;
  const btns = [...m.querySelectorAll("button")].filter(vis);
  const out = btns.find((b) => /leave it|留在原地|fold it away/i.test(b.textContent));
  return { modal: m, press: out || btns[btns.length - 1] || null };
}

// THE SURVIVAL FLOOR, AND IT IS THE SCREEN'S JUDGEMENT RATHER THAN MINE.
//
// The first version scored a card by the largest number in its text. That reads
// a health COST as though it were an attack, so it took the most expensive
// option every time and every run died inside the first hour — and it presented
// as `wentOutside: 0` across eighteen nights, which looked exactly like a
// finding about the game. It was a finding about the chooser.
//
// .action--primary is what the game itself marks as recommended, and following
// it is what a player does. Declining .action--lethal is the only other rule,
// and it is also read off the screen. Nothing here models the game.
function chooseAction(acts) {
  return (
    acts.find((b) => b.classList.contains("action--primary")) ||
    acts.filter((b) => !b.classList.contains("action--lethal"))[0] ||
    acts[0]
  );
}

// ---- The tool --------------------------------------------------------------

export function reachFor(targetName, opts = {}) {
  const target = TARGETS[targetName];
  if (!target) {
    throw new Error(
      "reachFor needs a named target — one of " + Object.keys(TARGETS).join(", ") +
      ". There is deliberately no default: a tool you must aim cannot be " +
      "mistaken for one that plays."
    );
  }
  // RE-READ EVERY STEP, NEVER CAPTURED. "Play again" constructs a NEW Game and
  // reassigns window.__game, so a reference taken once here goes on reporting a
  // dead object's state for the rest of the run. Caught by the chain rather
  // than by reading: it recorded tookTablet 10 across 9 nights, which is not a
  // number the game can produce, because the corpse of night one still held the
  // tablet. Same shape as the status-versus-card trap below — a thing that was
  // true when it was read, quietly outliving what it described.
  const live = () => opts.game || window.__game;
  if (!live()) throw new Error("reachFor found no game on the page");

  const maxNights = opts.nights || 40;
  const maxSteps = opts.steps || 400000;

  // THE CHAIN. Diagnostic instrumentation, and NOT A RATE: it counts how far
  // this tool got, which is a fact about the tool and about nothing else.
  const chain = { nights: 0, reachedCrypt: 0, tookTablet: 0, wentOutside: 0,
                  sawGrave: 0, reachedGrave: 0, arrived: 0 };

  // WHERE EACH RUN DIED, not merely how many reached each link. The two are
  // different questions and only this one distinguishes "the chain is blocked
  // somewhere" from "the chain leaks everywhere" — which is the difference
  // between a defect and a shape.
  //
  // It matters because the opposite conclusion was drawn from a small sample
  // and had to be withdrawn: 28 consecutive samples with state.tablet false
  // read as "the coin-flipper cannot reach the tablet at all", and at 665
  // samples it does reach it. A per-run furthest-link tally would have shown
  // that immediately, because the deaths would have been spread rather than
  // stacked on one link.
  const diedAt = {};
  const LINKS = ["start", "reachedCrypt", "tookTablet", "wentOutside", "sawGrave", "reachedGrave"];

  const out = { target: targetName, chain, diedAt, endings: [], card: null,
                steps: 0, running: true, error: null };

  const press = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

  (async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    let seen = {};
    try {
      while (out.running && out.steps < maxSteps && chain.nights < maxNights) {
        out.steps++;
        const game = live();
        if (!game) { await tick(); continue; }
        const s = game.state;
        const board = game.board;

        const ending = endingCard();
        if (ending) {
          if (s.outcome === target.outcome) {
            chain.arrived++;
            out.card = ending.card.innerText.replace(/\s*\n\s*/g, " │ ").trim();
            break;
          }
          out.endings.push(s.outcome || "(card)");
          let furthest = "start";
          for (const l of LINKS) if (l !== "start" && seen[SEEN_KEY[l]]) furthest = l;
          diedAt[furthest] = (diedAt[furthest] || 0) + 1;
          chain.nights++;
          seen = {};
          ending.again.click();
          await tick();
          continue;
        }

        const here = B.currentTile(board);
        if (here && here.id === "sealed-crypt" && !seen.crypt) { seen.crypt = 1; chain.reachedCrypt++; }
        if (s.tablet && !seen.tablet) { seen.tablet = 1; chain.tookTablet++; }
        if (here && here.world === "outdoor" && !seen.out) { seen.out = 1; chain.wentOutside++; }
        if (!seen.saw && placed(board, "mass-grave")) { seen.saw = 1; chain.sawGrave++; }
        if (here && here.id === "mass-grave" && !seen.grave) { seen.grave = 1; chain.reachedGrave++; }

        const modal = openModal();
        if (modal) { if (modal.press) modal.press.click(); await tick(); continue; }

        const acts = [...document.querySelectorAll("#actions .action")].filter(vis);
        if (acts.length) { chooseAction(acts).click(); await tick(); continue; }

        // The two full-screen "press anything" layers listen on WINDOW in
        // capture, which is why clicking the board does nothing at all.
        if ([...document.querySelectorAll(".evstage, .reveal")].filter(vis).length) {
          press();
          await tick();
          continue;
        }

        const doors = [...document.querySelectorAll(".doorway")].filter(vis);
        if (doors.length) {
          const goalId = target.goalFor(s);
          const moves = B.listMoves(board);
          let dir = null;
          if (goalId && placed(board, goalId)) dir = stepToward(board, (t) => t.id === goalId);
          if (!dir) {
            // Directed exploration rather than a walk. A goal cannot be pathed
            // to until it has been turned up, and the grave is OUTDOORS — so
            // getting out is a precondition of pathing rather than a move.
            const outside = moves.filter((m) => m.type === "outside");
            const explore = moves.filter((m) => m.type === "explore");
            const wantOut = goalId === "mass-grave" && board.player.world === "indoor";

            // WALK TO A DOOR, do not wait to be standing beside one. The first
            // version took an outside exit only when the room it happened to be
            // in had one, and otherwise explored, so a run holding the tablet
            // wandered until something killed it. This paths to the nearest room
            // that HAS a way out.
            //
            // ON ITS OWN IT IS NOT THE FIX, and saying so is the point of
            // writing it down. Over 50 nights before this change, 24 runs took
            // the tablet and 2 got outside — and the furthest-link tally put 22
            // of those 24 deaths AT the tablet, meaning they died carrying it
            // rather than wandering unable to find a gate. Shortening the trip
            // reduces exposure, which helps; it does not address the cause.
            //
            // THE CAUSE, MEASURED: the pack ends EMPTY. Sampled mid-run at 6
            // health, state.items was {} and all four cells were cell--empty.
            // A run starts with three 糯米 and this tool declines every find
            // (see openModal), so the longest exposed stretch of the night is
            // walked with nothing to heal with and nothing to fight with. That
            // is a consequence of a reachability choice made two functions
            // above, and it is the next thing to change if this target needs to
            // land more often.
            if (wantOut && !outside.length) {
              dir = stepToward(board, (t) => t.world === "indoor" && hasOutside(board, t));
            }
            if (!dir) {
              const pool = wantOut && outside.length ? outside
                : explore.length ? explore
                : moves.filter((m) => m.type === "move" || m.type === "cross");
              if (pool.length) dir = pool[(Math.random() * pool.length) | 0].dir;
            }
          }
          const want = dir && doors.find((d) => d.dataset.dir === dir);
          (want || doors[(Math.random() * doors.length) | 0]).click();
          await tick();
          continue;
        }
        press();
        await tick();
      }
    } catch (e) {
      out.error = String((e && e.stack) || e);
    }
    out.running = false;
  })();

  return out;
}

// The flag's entry point. The button is NAMED FOR ITS TARGET, so the thing on
// screen says what it is aimed at rather than offering to play.
export function mountReach(targetName, host) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "topbtn";
  b.id = "btn-reach";
  b.textContent = "Reach: " + targetName;
  b.addEventListener("click", () => {
    if (window.__reach && window.__reach.running) {
      window.__reach.running = false;
      return;
    }
    window.__reach = reachFor(targetName);
  });
  (host || document.querySelector(".topnav") || document.body).appendChild(b);
  return b;
}
