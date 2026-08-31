// A night, written down (#141, #142).
//
// ONE FORMAT FOR TWO JOBS, and that is why these arrived together. #141 wants a
// snapshot so a reload does not lose a run; #142 wants {v, seed, actions} so a
// night can be replayed and scored by something that does not trust the client.
// Both are the same serialisation problem, and solving them separately means
// solving it twice and then reconciling two shapes that drifted.
//
// THE FAILURE THIS IS BUILT AGAINST DOES NOT THROW. A lost stream position or
// an unrecorded decision produces a DIFFERENT BUT ENTIRELY VALID night with a
// plausible score. Nothing crashes, nothing looks wrong, and the number is
// simply not the number that was played. Every decision below is made against
// that: the format is versioned, the build is stamped, the streams are named in
// one place, and a mismatch is refused rather than attempted.

import { makeRng } from "./engine.js";
import { restoreBoard } from "./board.js";

// Bumped when the SHAPE changes. #141 and the leaderboard both refuse a
// mismatch rather than trying to read an older night, because a format read
// with the wrong assumptions is exactly the plausible-but-wrong failure above.
export const FORMAT_V = 1;

// HOW LONG A NAME MAY BE, IN CODE POINTS, and it lives here because both sides
// need it. src/run.js is the only writer and enforces it; #144's input mirrors
// it so the field agrees with the rule rather than inventing a second one. Two
// copies of one number drift, and the day they disagree the symptom is a name
// that passes the field and comes back refused with a message nobody can read
// — which is the same hazard src/run.js's own comment names about the schema.
//
// Counted in code points, never in "".length: an emoji is two UTF-16 units, so
// a naive cap both measures wrong and truncates mid-surrogate.
export const NAME_LIMIT = 24;

// THE SEVEN STREAMS WHOSE POSITION MUST SURVIVE, named in ONE place. A stream
// added to the state and not added here is a silent desynchronisation: the
// snapshot restores, the night continues, and it draws different cards.
// Listing them here rather than walking the state for functions is deliberate —
// a walk would pick up whatever happened to be a function and would quietly
// stop covering a stream the day one is stored differently.
export const STREAMS = [
  "rng", "phantomRng", "scareRng", "gutterRng",
  "standingRng", "searchRng", "eventRng",
];

// The board carries an EIGHTH stream and it is deliberately not in that list.
// board.rng is consumed entirely inside createBoard — the two deck shuffles —
// and never drawn from again; pickExploreRotation scores rotations and does not
// roll. So the board's position is not a live thing to preserve, and the
// snapshot carries the DECKS AS THEY STAND instead, which is what survives
// tiles being dealt off them. Reconstructing a mid-night deck by replaying a
// shuffle would be the shadow-of-the-truth mistake in another costume.
//
// If board.rng ever gains a second caller, it belongs in STREAMS and this
// paragraph is wrong. It is written down so that change is a decision.

// What the verdict card prints, as data. #142 compares a replay against this
// whole object rather than one field — this project's endings have been
// miscounted by three unrelated mechanisms, and a replay that agrees on turns
// while disagreeing on kills is exactly the shape a single-field check misses.
//
// It is also what #144's submit gate needs at the verdict, so a finished night
// carries its own score rather than requiring a replay to find out.
export function verdictOf(state, tally = {}) {
  return {
    outcome: state.outcome,
    status: state.status,
    lossReason: state.lossReason ?? null,
    turn: state.turn,
    hour: state.hour,
    health: state.health,
    kills: tally.fights ?? 0,
    found: tally.found ?? 0,
    tablet: !!state.tablet,
  };
}

// Fields that are rebuilt from `data` rather than stored: three tables and a
// lookup, all of them large, none of them run-specific, and every one of them a
// chance for a stale copy to outlive the file it came from.
const FROM_DATA = ["itemsById", "searchTables", "eventTables"];

export function snapshot(state, board, { tally, build, actions } = {}) {
  const streams = {};
  for (const name of STREAMS) {
    const s = state[name];
    // A stream that cannot report its position is the whole failure mode, so it
    // is refused here rather than silently written as undefined and restored as
    // a fresh seed.
    if (!s || typeof s.s !== "number") {
      throw new Error("night: stream " + name + " has no position to save — " +
        "makeRng must publish .s or a restore will draw a different night");
    }
    streams[name] = s.s >>> 0;
  }

  const plain = {};
  for (const [k, v] of Object.entries(state)) {
    if (STREAMS.includes(k) || FROM_DATA.includes(k)) continue;
    if (typeof v === "function") continue;
    plain[k] = v;
  }

  return {
    v: FORMAT_V,
    build: build ?? null,
    seed: state.seed,
    streams,
    state: plain,
    board: packBoard(board),
    tally: { fights: tally?.fights ?? 0, found: tally?.found ?? 0 },
    // Carried when the caller has one. A snapshot is a position; a recorded
    // night is the road to it. Keeping them in one envelope is what stops the
    // two formats from drifting apart.
    actions: actions ? actions.slice() : null,
  };
}

// Maps and tile objects do not survive JSON, and the tiles hold a `def` that
// points back into `data`. Only what cannot be derived is stored: id, where it
// sits, how it was turned, and the holes punched in it afterwards.
function packBoard(board) {
  const world = (name) => [...board.worlds[name].values()].map((t) => ({
    id: t.id, x: t.x, y: t.y, rotation: t.rotation, holes: [...(t.holes || [])],
  }));
  return {
    worlds: { indoor: world("indoor"), outdoor: world("outdoor") },
    decks: { indoor: [...board.decks.indoor], outdoor: [...board.decks.outdoor] },
    outsideId: board.outsideId,
    seamPlaced: board.seamPlaced,
    seam: board.seam,
    player: { ...board.player },
  };
}

// Why a refusal is a return value and not an exception: the caller is deciding
// whether to offer a resume, and "this snapshot is from another build" is an
// ordinary answer to that question rather than a fault.
export function checkable(snap, build) {
  if (!snap || typeof snap !== "object") return "there is no snapshot";
  if (snap.v !== FORMAT_V) {
    return "snapshot format v" + snap.v + ", this build reads v" + FORMAT_V;
  }
  if (build != null && snap.build != null && snap.build !== build) {
    // Both ids, always. A refusal that names neither cannot be acted on.
    return "snapshot is from build " + snap.build + ", this is build " + build;
  }
  return null;
}

export function restore(data, snap, { build } = {}) {
  const refusal = checkable(snap, build);
  if (refusal) throw new Error("night: " + refusal);

  const state = { ...snap.state };
  state.itemsById = Object.fromEntries(data.items.map((i) => [i.id, i]));
  state.searchTables = data.search || {};
  state.eventTables = data.events || {};
  // Each stream resumed AT ITS POSITION, not from its seed. This one line is
  // the difference between continuing a night and starting a different one that
  // looks the same.
  for (const name of STREAMS) state[name] = makeRng(0, snap.streams[name]);

  return {
    state,
    board: restoreBoard(data, snap.board),
    tally: { ...snap.tally },
    actions: snap.actions ? snap.actions.slice() : null,
  };
}
