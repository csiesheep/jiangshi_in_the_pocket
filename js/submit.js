// Putting a night on the 夜榜 (#144).
//
// THE ONE RULE THIS FILE IS ORGANISED AROUND: a run that is offered and then
// refused costs the player a button press. A run that is NEVER OFFERED is a
// record they made and will never learn about. Those two mistakes are not the
// same size, so every uncertain case below resolves towards showing the button
// — an unreachable board, a board we cannot rank against, a tie we cannot
// break. The server is the authority on all of it; this is a courtesy.
//
// Opt-in throughout: nothing is sent until the player presses send, and the
// name is theirs to leave empty.

import { NAME_LIMIT } from "./night.js";
// The ordering, declared once in #146 and generated into both the SQL and
// this comparison. Imported rather than mirrored — that was the whole point.
import { keyOf, beats } from "./boardkey.js";

// Resolved against the page, like the ledger's own reads: production serves
// this under /jiangshi_in_the_pocket/ with the API alongside, a local static
// server has no Worker at all, and the second case has to behave.
const api = (path) => new URL(path, location.href).href;

// THE DEPTH OF A BOARD IS NOT COPIED HERE, and better than that, it is not read
// here either. This file briefly carried a stand-in 50, which was a client copy
// of a server policy wearing the server's authority. /api/leaderboard now ships
// `full` per board — the ANSWER rather than the number the answer is computed
// from — so there is nothing left to keep in step. boardSize is in the response
// too and is deliberately not consulted: reading it would put the comparison
// `rows.length >= boardSize` back in this file, which is the copy again.

// Which board a verdict can be ranked on at all. HOW it ranks is not here —
// that is the key's job, and this list no longer names a metric or a direction.
const BOARDS = [
  { id: "burial", eligible: (v) => v.outcome === "WIN_BURIAL" },
  { id: "seal", eligible: (v) => v.outcome === "WIN_SEAL" },
  { id: "kills", eligible: (v) => v.status !== "playing" },
];

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE A RUN IS RANKED, AND IT NO LONGER KNOWS THE RULE.
//
// This used to compare the primary number, because knowing the cut ROW does not
// tell a client how to compare against it: the kills board sorts kills, then
// survivors before the fallen, then health, and reimplementing that here would
// have been a second copy of an ordering the server owns.
//
// It was on the safe side of that BY CHOICE rather than by construction, which
// was the real problem. `mine >= theirs` offers a place to a run that will not
// get one — harmless. `mine > theirs` HIDES the button from a run that would
// have made the board, and BE measured a reachable case: six kills, survived,
// more health than the cut row. It qualifies, and a kills-only client using `>`
// refuses to offer it. One character apart, and one of them destroys records
// silently. That hazard leaves with this code.
//
// js/boardkey.js now declares the ordering once and BOTH the SQL and this
// comparison are generated from it. The key is opaque on purpose: every element
// is normalised so smaller is better, so there is nothing here to interpret and
// nothing to branch on. Do not read an element. Do not name one.
// ─────────────────────────────────────────────────────────────────────────────
function beatsCut(verdict, board, cut) {
  // No cut row: the board has not filled, so there is no last place to take.
  if (!cut) return true;

  // THE FAIL-OPEN BRANCH THE KEY ARRIVES THROUGH. A row without a key, or one
  // shaped differently from the candidate, is an ordering this cannot read —
  // which is the same state as an unreachable board and takes the same answer.
  const theirs = cut.key;
  const mine = keyOf(board.id, verdict);
  if (!Array.isArray(theirs) || !Array.isArray(mine)) return true;
  if (!theirs.length || theirs.length !== mine.length) return true;
  if (mine.some((n) => typeof n !== "number" || !Number.isFinite(n))) return true;
  if (theirs.some((n) => typeof n !== "number" || !Number.isFinite(n))) return true;

  // AND NOTHING AFTER THIS. beats() is the answer, including the one case where
  // it does not fail open: a run level with the cut row on EVERY element gets
  // false, because stored rows break their last tie on id — oldest first — and
  // a candidate has no id, so it genuinely does not displace an equal run.
  //
  // An exception was written here and then removed. Offering on a total tie
  // looks generous and is the same mistake this whole file was refactored to
  // stop making: it is a ranking decision, taken by the client, about a rule the
  // server owns. "You did not displace them" is a CORRECT answer rather than a
  // lost record, and the moment this file starts having opinions about ties it
  // has two homes for the ordering again.
  return beats(mine, theirs);
}

// A run qualifies if it beats ANY board. ONE REQUEST, which is what makes the
// fail-open rule a single condition rather than a partial-failure matrix: with
// three separate reads, "two boards answered and one did not" is a state this
// function would have to have an opinion about, and every opinion there is a
// chance to hide a record by accident.
export async function qualifies(verdict, fetcher = fetch) {
  const mine = BOARDS.filter((b) => b.eligible(verdict));
  // Not eligible anywhere is the one confident "no": an unfinished night, or a
  // loss on a day when only wins are ranked. Nothing was fetched, so nothing
  // could have failed.
  if (!mine.length) return { show: false, why: "not-eligible" };

  let body = null;
  try {
    const r = await fetcher(api("api/leaderboard"), { cache: "no-store" });
    body = await r.json();
    if (!r.ok || !body || body.ok !== true) throw new Error("leaderboard " + r.status);
  } catch {
    // FAIL OPEN, and this is the branch to be most careful with: offline, API
    // down, or the player installed the PWA and is on a train. Hiding the
    // button here discards a real record and the player never finds out it
    // happened.
    return { show: true, why: "unreachable" };
  }

  const boards = body.boards;
  if (!boards || typeof boards !== "object") return { show: true, why: "unreadable" };

  for (const b of mine) {
    const board = boards[b.id];
    // A board the response does not describe is a board this cannot rank
    // against, which is the same state as not having read it at all.
    if (!board) return { show: true, why: b.id + "-missing" };
    // `full` IS THE SERVER'S ANSWER, not a count to re-derive. An empty board —
    // full false, cut null, which is where the game is today — has no cut line
    // to be under, so everything qualifies.
    if (!board.full) return { show: true, why: b.id + "-not-full" };
    if (beatsCut(verdict, b, board.cut)) return { show: true, why: b.id };
  }
  return { show: false, why: "below-every-cut" };
}

// COUNTED IN CODE POINTS. "".length counts UTF-16 units, so 34 skull emoji
// measure 68 and a naive cap truncates one in half. The server's cleanName is
// the rule and it does exactly this; the input is a courtesy that agrees with
// it rather than a second, different rule.
export function clip(raw) {
  if (typeof raw !== "string") return "";
  const points = [...raw.trim()];
  return points.length > NAME_LIMIT ? points.slice(0, NAME_LIMIT).join("") : points.join("");
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Sent, and what came back said in one line. Every refusal the server can give
// is a sentence a player can act on: already there, could not be verified,
// could not be reached. None of them is a stack trace.
async function send(night, name, say, out, button) {
  button.disabled = true;
  out.textContent = say("submit-sending");
  out.className = "submit-said";
  let body = null;
  try {
    const r = await fetch(api("api/run"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ night, name }),
    });
    body = await r.json();
  } catch {
    // The network, not the run. Re-enabled, because this is the one failure
    // that is worth pressing again.
    out.textContent = say("submit-offline");
    out.className = "submit-said submit-said--off";
    button.disabled = false;
    return;
  }
  if (body && body.ok === true) {
    out.textContent = say("submit-ok");
    out.className = "submit-said submit-said--ok";
    const link = el("a", "btn", say("submit-view"));
    link.href = "ledger.html";
    out.after(link);
    return;
  }
  // DUPLICATE IS NOT AN ERROR AND IS NOT RETRIED. The night is already on the
  // board; pressing again cannot change that, so the button stays down.
  const reason = body && body.reason;
  out.textContent = say(reason === "duplicate" ? "submit-dup" : "submit-refused");
  out.className = "submit-said" + (reason === "duplicate" ? "" : " submit-said--off");
}

// Two steps on purpose. The card of a run that has just ended is not the place
// for a text field nobody asked for, so the first press is the consent and the
// name only appears after it.
function offer(box, night, say) {
  box.textContent = "";
  const open = el("button", "btn submit-open", say("submit-offer"));
  open.type = "button";
  open.addEventListener("click", () => {
    box.textContent = "";
    const row = el("div", "submit-row");
    const input = el("input", "submit-name");
    input.type = "text";
    input.placeholder = say("submit-name");
    input.maxLength = NAME_LIMIT * 2;   // a courtesy stop; clip() is the rule
    input.setAttribute("aria-label", say("submit-name"));
    const go = el("button", "btn btn--primary", say("submit-send"));
    go.type = "button";
    const said = el("p", "submit-said");
    row.appendChild(input);
    row.appendChild(go);
    box.appendChild(row);
    box.appendChild(said);
    go.addEventListener("click", () => send(night, clip(input.value), say, said, go));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
    input.focus();
  });
  box.appendChild(open);
}

// Mounted synchronously and revealed later: the card must not wait on a network
// read to appear, and a button that pops in after the ranking is known is
// better than a card that hangs while it is fetched.
export function mountSubmit(card, night, say) {
  if (!night || !night.verdict) return null;
  // AN UNFINISHED NIGHT IS NEVER OFFERED, and it is refused here rather than
  // left to the board rules: /api/run rejects it anyway, but a button that can
  // only ever earn a refusal should not be drawn. Today gameOver is the only
  // caller so this cannot fire — which is exactly why it is a line and not an
  // assumption.
  if (night.verdict.status === "playing") return null;
  const box = el("div", "submit");
  box.hidden = true;
  card.appendChild(box);
  qualifies(night.verdict).then((verdictOnOffering) => {
    if (!verdictOnOffering.show) return;
    offer(box, night, say);
    box.hidden = false;
  }).catch(() => {
    // Even the decision failing resolves towards showing it.
    offer(box, night, say);
    box.hidden = false;
  });
  return box;
}
