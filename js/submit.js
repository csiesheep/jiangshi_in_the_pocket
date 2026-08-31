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

// Resolved against the page, like the ledger's own reads: production serves
// this under /jiangshi_in_the_pocket/ with the API alongside, a local static
// server has no Worker at all, and the second case has to behave.
const api = (path) => new URL(path, location.href).href;

// HOW DEEP A BOARD GOES BEFORE IT HAS A CUT LINE AT ALL.
//
// THIS IS A CLIENT-SIDE STAND-IN FOR A SERVER POLICY, not the definition. The
// number appears nowhere in src/ — not in boards.js, not in run.js — so today
// the rule deciding who is offered the leaderboard lives only here, while
// looking from the outside like something the server decided. BE is adding it
// to the combined /api/leaderboard response; when that lands, READ IT FROM
// THERE AND DELETE THIS, because a copy of a policy goes stale while still
// looking authoritative.
const CUT = 50;

// Which board a verdict can even be compared against, and on which number.
// `lower` marks a board where a smaller value is the better one.
const BOARDS = [
  { id: "burial", eligible: (v) => v.outcome === "WIN_BURIAL", metric: "turn", lower: true },
  { id: "seal", eligible: (v) => v.outcome === "WIN_SEAL", metric: "health" },
  { id: "kills", eligible: (v) => v.status !== "playing", metric: "kills" },
];

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE A RUN IS RANKED, AND IT IS BUILT TO BE REPLACED.
//
// KNOWING THE CUT ROW DOES NOT TELL YOU HOW TO COMPARE AGAINST IT. boards.js
// sorts the kills board by kills DESC, then survivors before the fallen, then
// health DESC. Writing "would my run beat that row?" here means reimplementing
// that three-level ordering in client code — a second copy of a rule the server
// owns, in the one place where being wrong looks exactly like being right.
//
// So this does NOT encode that precedence, and nothing else in this file may
// either. It compares the primary number only, and every case it cannot settle
// resolves towards offering:
//
//   - equal on the metric        -> offer (the tie is the server's to break)
//   - no cut row                 -> offer
//   - the metric is missing      -> offer
//
// BE is adding a comparable sort key per row: the ordering as an array to be
// compared elementwise WITHOUT knowing what the elements mean. When it lands,
// the body below is replaced by building the same array for this run and
// comparing it against the cut's — and the fail-open branches stay exactly as
// they are, including the new one the rule already covers: A ROW WITH NO KEY,
// OR A RESPONSE WITH NO KEYS AT ALL, IS THE SAME AS NOT BEING ABLE TO READ THE
// CUT LINE. Never hide the button because the ordering could not be understood.
// ─────────────────────────────────────────────────────────────────────────────
function beatsCut(verdict, board, cut) {
  if (!cut) return true;
  const theirs = cut[board.metric];
  const mine = verdict[board.metric];
  if (typeof theirs !== "number" || typeof mine !== "number") return true;
  return board.lower ? mine <= theirs : mine >= theirs;
}

// A run qualifies if it beats ANY board, so one unreachable board must not be
// able to veto the other two — and all three unreachable must not veto at all.
export async function qualifies(verdict, fetcher = fetch) {
  const mine = BOARDS.filter((b) => b.eligible(verdict));
  // Not eligible anywhere is the one confident "no": an unfinished night, or a
  // loss on a day when only wins are ranked. Nothing was fetched, so nothing
  // could have failed.
  if (!mine.length) return { show: false, why: "not-eligible" };

  const answers = await Promise.allSettled(mine.map(async (b) => {
    const r = await fetcher(api("api/board/" + b.id + "?limit=" + CUT), { cache: "no-store" });
    const body = await r.json();
    if (!r.ok || !body || body.ok !== true) throw new Error(b.id + " " + r.status);
    return { board: b, rows: body.rows || [] };
  }));

  for (const a of answers) {
    // FAIL OPEN, and this is the branch to be most careful with: offline, API
    // down, or the player installed the PWA and is on a train. Hiding the
    // button here discards a real record and the player never finds out it
    // happened.
    if (a.status === "rejected") return { show: true, why: "unreachable" };
    const { board, rows } = a.value;
    // A board that is not full yet has no cut line to be under.
    if (rows.length < CUT) return { show: true, why: board.id + "-not-full" };
    if (beatsCut(verdict, board, rows[rows.length - 1])) {
      return { show: true, why: board.id };
    }
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
