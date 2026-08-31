// The leaderboard's front door: a night arrives, the server replays it, and the
// score is whatever the replay produces (#143).
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS VERIFIES, AND IT IS NARROWER THAN IT SOUNDS.
//
//   IT VERIFIES: the score is the one that sequence of actions really produces.
//   IT DOES NOT VERIFY: that this is the night somebody actually played.
//
// Measured during #142: swapping one recorded explore for a different legal
// direction replayed to a BYTE-IDENTICAL verdict on five of nine tries, while
// ending in a different room on a different layout. So a passing submission
// means the claimed score is honest arithmetic over the submitted actions. It
// does not mean the road was walked.
//
// Nothing here — no field name, no response body, no log line — may say
// otherwise, and if a UI label ever promises "verified night" rather than
// "verified score", it is promising something this cannot deliver.
// ────────────────────────────────────────────────────────────────────────────
//
// A REFUSAL IS THE PRODUCT WORKING. #142 found a hole where a player could
// leave a fight with no flee roll and no damage; the replayer refused those
// nights and the FIX WENT INTO THE GAME. The temptation when a real submission
// bounces is to loosen this until it passes, and that does not make the
// leaderboard more accurate — it makes it launder whatever the client did, with
// the authority of "the server replayed it". So: no tolerance is added here.
// A night that will not replay is a finding, and it belongs in an issue rather
// than in a catch block.

import { replayNight, Divergence } from "../js/replay.js";
import { FORMAT_V } from "../js/night.js";
import { BOARDS, STATS, DEFAULT_LIMIT, MAX_LIMIT, BOARD_SIZE } from "./boards.js";
import { TERMS } from "../js/boardkey.js";

// The engine's tables, fetched through the ASSETS binding rather than imported
// as JSON modules. Both would work; this one is ALREADY PROVEN IN THIS WORKER —
// src/index.js serves every page through env.ASSETS — and a bundler feature I
// cannot build-test from here is not the place to find out. Same deploy, so the
// bytes are the ones the client played against either way.
const TABLES = ["items", "search", "events", "tiles"];

export async function loadData(env) {
  const out = {};
  for (const name of TABLES) {
    const res = await env.ASSETS.fetch(
      new Request("https://assets.invalid/data/" + name + ".json")
    );
    if (!res.ok) throw new Error("could not load data/" + name + ".json");
    out[name] = await res.json();
  }
  return out;
}

// Why every refusal carries a machine-readable `reason` AND the sentence: the
// sentence is for whoever has to work out what happened, and the code is so a
// count of refusals can be broken down without parsing prose. If one kind of
// refusal starts spiking, that is a finding about the game.
export const REFUSED = {
  MALFORMED: "malformed",
  FORMAT: "format",
  DIVERGED: "diverged",
  UNUSED: "unused-actions",
  UNFINISHED: "unfinished",
  DUPLICATE: "duplicate",
  NOT_STORED: "not-stored",
};

// ---- The name -----------------------------------------------------------
// The owner ruled free-text names with a maximum length, and no account behind
// them. THIS IS THE ONLY PLACE THAT LENGTH LIVES. sql/schema.sql deliberately
// carries no CHECK mirroring it: two copies of one number drift, and the day
// they disagree the symptom is a name that passes validation and is refused by
// the database with an error nobody can read. The server is the only writer.
//
// 24 is my choice, not a ruling — long enough for a short CJK phrase or a Latin
// nickname, short enough that a board row stays a row. Change it here and it
// changes everywhere.
//
// ---- WHY THIS IS A SHARED CONSTANT AND boardSize IS NOT --------------------
// The two look like the same problem and are not, and the question that
// separates them is worth more than either answer:
//
//     DOES THIS VALUE HAVE TO BE KNOWN BEFORE THE NETWORK ANSWERS?
//
// boardSize does not. It is consulted after a fetch, when deciding whether to
// offer the submit button, and that path already has a defined fail-open
// behaviour — so it ships in /api/leaderboard's response and the client reads
// the policy rather than restating it.
//
// This one does. It is an input's maximum length, wanted at render time. Ship
// it in a response and the field is uncapped until the fetch returns, and
// uncapped forever when the fetch fails — which is precisely the case the gate
// is built to survive. A cap that disappears when the network does is not much
// of a cap. So it is a constant the client imports, not a field it receives.
//
// TO BE ACCURATE RATHER THAN DRAMATIC: that is a UX argument, not a correctness
// one. The server truncates whatever arrives and echoes the accepted name back,
// so a client that lets somebody type forty characters still stores twenty-four
// and can show them what was kept. Nothing breaks either way. But a constant
// with no failure mode beats a constant with one when both give the same
// answer.
//
// The question above is the part to keep. It decides the shape for values
// neither of us has thought of yet, without anyone having to remember which
// precedent applied.
//
// AND KEEP THE ECHO. A cached shell means a client and the server can hold
// different values for a while; neither direction is harmful, because the
// server never over-accepts — but the echoed name is the only thing that makes
// the disagreement visible instead of silent. It is not redundant.
export const NAME_MAX = 24;

// COUNTED IN CODE POINTS, NOT UTF-16 UNITS. "".length counts units, so an emoji
// is 2 and a name of twelve emoji would pass a naive check at 24 while being
// twelve characters — and a CJK name is counted correctly either way only by
// accident. Spreading the string iterates code points.
//
// The input field is a courtesy; this is the rule. A client that does not
// truncate, or one that is not our client at all, gets the same answer.
export function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const points = [...trimmed];
  return points.length > NAME_MAX ? points.slice(0, NAME_MAX).join("") : trimmed;
}

// The whole verification, with no HTTP in it, so the suite can drive it with
// real data and a real night rather than through a Worker runtime that does not
// exist on this machine.
export function verifyNight(data, night) {
  if (!night || typeof night !== "object") {
    return { ok: false, reason: REFUSED.MALFORMED, detail: "no night in the request body" };
  }
  // THE FORMAT GATE IS OURS TO DO. replayNight does not check `v` — the string
  // "build" does not appear in replay.js at all, and restore()'s version check
  // belongs to the snapshot path (#141), not to this one. A night read with the
  // wrong assumptions about its shape is exactly the plausible-but-wrong
  // failure night.js was written against, so it is refused rather than tried.
  if (night.v !== FORMAT_V) {
    return {
      ok: false,
      reason: REFUSED.FORMAT,
      detail: "night format v" + night.v + ", this server reads v" + FORMAT_V,
    };
  }

  let result;
  try {
    result = replayNight(data, night);
  } catch (e) {
    // Divergence carries a sentence written to explain itself; pass it through
    // rather than replacing it with something vaguer.
    if (e instanceof Divergence) {
      return { ok: false, reason: REFUSED.DIVERGED, detail: e.message };
    }
    throw e;
  }

  // Left-over actions are a divergence too, and replayNight RETURNS this rather
  // than throwing it — so a caller that only catches would wave it through. The
  // replay finished the night without spending decisions the player made, which
  // means it took a different road to a plausible end.
  if (result.unused > 0) {
    return {
      ok: false,
      reason: REFUSED.UNUSED,
      detail: result.unused + (result.unused === 1 ? " recorded action was" : " recorded actions were") +
        " never spent — the replay reached an ending by a different road than " +
        "the one recorded",
    };
  }

  // A night still playing has no score to claim.
  if (result.verdict.status === "playing") {
    return { ok: false, reason: REFUSED.UNFINISHED, detail: "the night has not ended" };
  }

  // THE SCORE IS COMPUTED, NEVER READ. night.verdict exists — app.js's night()
  // puts it there so a finished run knows its own score without a replay — and
  // this function does not touch it. Not compared, either: a mismatch would be
  // a refusal class that is not about cheating, and the point is simply that
  // the server does the arithmetic.
  return { ok: true, verdict: result.verdict, actions: result.used };
}

// ---- The HTTP shell ---------------------------------------------------------
// Deliberately thin, and deliberately separate from verifyNight above: the
// verification is the part with the reasoning in it and the part a test can
// drive, so it does not get to depend on a Request.
//
// THE SHAPE OF A REFUSAL IS 200-WITH-ok:false, NOT 4xx. A refused night is not
// a client error in the HTTP sense — the request was well formed and the answer
// is "this does not replay". Reserving 4xx for genuinely malformed input keeps
// "your JSON is broken" distinguishable from "your night is", which is the
// distinction anyone reading the logs will actually want.
export async function handleRun(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, reason: REFUSED.MALFORMED, detail: "POST a night" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: REFUSED.MALFORMED, detail: "body is not JSON" }, 400);
  }

  const data = await loadData(env);
  const result = verifyNight(data, body && body.night);

  if (!result.ok) return json(result, 200);

  // WHICH ENGINE VERIFIED IT, recorded rather than gated on — and this is a
  // known gap, written down rather than papered over.
  //
  // A season gate wants to refuse a night played against a different balance.
  // It cannot, yet: the envelope app.js sends is {v, seed, actions, verdict},
  // and `v` is FORMAT_V — the SHAPE version, which does not move when the
  // engine's numbers do. `build` lives only in snapshot() (#141) and replay.js
  // never mentions it. So two nights from materially different balance both
  // arrive as v:1 and are indistinguishable at this door.
  //
  // Until the client carries a build stamp, the honest thing is to record the
  // build that DID the verifying, so the board can be segmented afterwards even
  // though it cannot be filtered at the door. Recording a fact we have beats
  // enforcing one we do not.
  const name = cleanName(body && body.name);
  const night = body.night;

  // THE SAME NIGHT TWICE IS A RESUBMISSION, NOT TWO RUNS.
  //
  // Without this, one good night can be posted a hundred times and the board is
  // that night a hundred times. Two players CAN legitimately share a seed; what
  // they cannot share is an identical decision sequence, so the pair (seed, the
  // exact envelope) identifies a resubmission rather than a coincidence.
  //
  // IT IS A SELECT-THEN-INSERT AND THEREFORE RACY: two simultaneous posts of
  // the same night can both find nothing and both write. The airtight version
  // is a UNIQUE index, which needs another schema command against the owner's
  // account, so this is what can be done without asking again. It stops the
  // casual case, which is the one that actually happens, and the race costs a
  // duplicate row rather than a wrong score.
  const envelope = JSON.stringify(night);
  const seen = await env.DB.prepare(
    "SELECT id FROM runs WHERE seed = ? AND night = ? LIMIT 1"
  ).bind(night.seed, envelope).first();
  if (seen) {
    return json({ ok: false, reason: REFUSED.DUPLICATE,
                  detail: "this night has already been recorded" }, 200);
  }

  // EVERY COLUMN COMES FROM result.verdict, WHICH THE REPLAY COMPUTED. The
  // request's own `verdict` is not read here any more than it was above.
  const v = result.verdict;
  let inserted;
  try {
    inserted = await env.DB.prepare(
      "INSERT INTO runs (name, night, seed, actions, outcome, status, loss_reason," +
      " turn, hour, health, kills, found, tablet, verified_by)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      name, envelope, night.seed, result.actions,
      v.outcome, v.status, v.lossReason,
      v.turn, v.hour, v.health, v.kills, v.found, v.tablet ? 1 : 0,
      env.BUILD_ID ?? null
    ).run();
  } catch (e) {
    // A VERIFIED NIGHT THAT DID NOT GET STORED MUST NOT LOOK STORED. Returning
    // ok:true here would tell a player their run is on the board when it is
    // not, and they would have no way to tell. The verification still happened
    // and its result is reported; what failed is named.
    return json({ ok: false, reason: REFUSED.NOT_STORED,
                  detail: "verified, but the run could not be recorded: " + e.message,
                  verdict: v }, 200);
  }

  return json({
    ok: true,
    id: inserted && inserted.meta ? inserted.meta.last_row_id : null,
    verdict: v,
    actions: result.actions,
    // Echoed so a client sees what was actually accepted rather than assuming
    // its own truncation matched ours.
    name,
    // WHICH ENGINE VERIFIED IT — recorded, not gated on. A season gate wants to
    // refuse a night played against a different balance and cannot yet: the
    // envelope carries no engine stamp, only FORMAT_V, which does not move when
    // the engine's numbers do. Recording a fact we have beats enforcing one we
    // do not.
    verifiedBy: env.BUILD_ID ?? null,
  }, 200);
}

// ---- Reading the boards -------------------------------------------------------
// One handler for all three, dispatched on a name from BOARDS. A board that is
// not in that table does not exist, which is the right answer for a typo.
export async function handleBoard(request, env, name) {
  const sql = BOARDS[name];
  if (!sql) return json({ ok: false, reason: "no-such-board", detail: name }, 404);

  const url = new URL(request.url);
  const asked = Number(url.searchParams.get("limit"));
  // Clamped rather than rejected: a caller asking for too much gets the most we
  // will give rather than an error it has to handle. NaN falls to the default.
  const limit = Number.isFinite(asked) && asked > 0
    ? Math.min(Math.floor(asked), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const { results } = await env.DB.prepare(sql).bind(limit).all();
  return json({ ok: true, board: name, limit, rows: results ?? [] }, 200);
}

// ---- Everything, in one request -----------------------------------------------
// All three boards and the strip together (#146), and the reason is not the
// three saved round trips.
//
// THE SUBMIT GATE HAS TO FAIL OPEN: if it cannot read the boards it must offer
// submission rather than refuse it, because refusing silently loses a run the
// player earned. With four separate requests that is a PARTIAL-FAILURE MATRIX —
// two boards answer and one does not, and the gate ends up deciding per board
// on incomplete data, which is a condition nobody can state in one sentence or
// falsify in one test. One request collapses it to one condition: this answered,
// or it did not.
//
// Same envelope and error shapes as everything else here, so nothing new has to
// be learned to read it.
export async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const asked = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(asked) && asked > 0
    ? Math.min(Math.floor(asked), MAX_LIMIT)
    : DEFAULT_LIMIT;

  // FETCH ENOUGH TO SEE THE CUT LINE, not just enough to show. The cut is the
  // BOARD_SIZE-th row, which is past `limit` whenever a caller asks for fewer —
  // so each board is read to whichever is deeper and the display is sliced from
  // that. One query per board either way.
  const depth = Math.max(limit, BOARD_SIZE);

  const names = Object.keys(BOARDS);
  // One batch, so this is a single round trip to D1 rather than four.
  const answers = await env.DB.batch([
    ...names.map((n) => env.DB.prepare(BOARDS[n]).bind(depth)),
    env.DB.prepare(STATS),
  ]);

  const boards = {};
  names.forEach((n, i) => {
    // THE KEY COMES OFF THE ROW AS THE DATABASE SORTED IT. k0..kn are the
    // ordering's own expressions, selected by the same query that ordered by
    // them — so a row's key is not computed a second time here, it is read.
    // Collapsed into an array and the k-columns dropped, because a client that
    // can see a field name will eventually branch on one.
    const width = TERMS[n].length;
    const shape = (r) => {
      const key = [];
      const row = {};
      for (const [f, val] of Object.entries(r)) {
        if (/^k\d+$/.test(f)) key[Number(f.slice(1))] = val;
        else row[f] = val;
      }
      return { ...row, key: key.slice(0, width) };
    };
    const rows = (answers[i].results ?? []).map(shape);
    const full = rows.length >= BOARD_SIZE;
    boards[n] = {
      rows: rows.slice(0, limit),
      // WHETHER THE BOARD IS FULL, said rather than left to be counted. A client
      // counting rows to decide would be counting the rows it was SHOWN, which
      // is `limit` and not BOARD_SIZE, and would conclude the board is short
      // whenever it asked for fewer.
      full,
      // THE LAST PLACE, when there is one. null means the board has not filled
      // and everything qualifies.
      //
      // WHAT THIS DOES NOT SOLVE, and it is worth saying here because this is
      // where a client will look: knowing the cut row does not tell anyone how
      // to COMPARE against it. The kills board sorts kills DESC, then survivors
      // before the fallen, then health — a client comparing kills alone gets
      // ties wrong, and that comparison is a second copy of an ordering that
      // lives in the SQL. Shipping the row narrows the gap; it does not close
      // it. See the note to the coordinator on #146.
      cut: full ? rows[BOARD_SIZE - 1] : null,
    };
  });

  const s = answers[answers.length - 1].results?.[0] ?? {};
  return json({
    ok: true,
    limit,
    // The cut-line policy, shipped so the client reads it rather than restating
    // it. A change here reaches every client on the next request.
    boardSize: BOARD_SIZE,
    boards,
    stats: {
      nights: s.nights ?? 0,
      burials: s.burials ?? 0,
      seals: s.seals ?? 0,
      deaths: s.deaths ?? 0,
    },
  }, 200);
}

export async function handleStats(env) {
  const row = await env.DB.prepare(STATS).first();
  // SUM over an empty table is NULL, not 0 — an empty board would otherwise
  // report nulls to a client that is about to render them.
  return json({
    ok: true,
    nights: row?.nights ?? 0,
    burials: row?.burials ?? 0,
    seals: row?.seals ?? 0,
    deaths: row?.deaths ?? 0,
  }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
