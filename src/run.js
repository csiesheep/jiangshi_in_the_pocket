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
  // The name is normalised here even though there is no D1 to store it in yet:
  // the cap is a server-side rule and the rule exists whether or not the row
  // does. Echoed back so a client can see what was actually accepted rather
  // than assuming its own truncation matched ours.
  const verified = {
    ...result,
    name: cleanName(body && body.name),
    verifiedBy: env.BUILD_ID ?? null,
  };
  return json(verified, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
