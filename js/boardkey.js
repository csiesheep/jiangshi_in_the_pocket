// How a leaderboard row is ranked, defined ONCE (#146).
//
// ────────────────────────────────────────────────────────────────────────────
// THE RULE IS THE ORDERING, NOT THE NUMBER.
//
// BOARD_SIZE gave the cut line one home and left the harder half loose: knowing
// WHICH row is last does not tell anyone how to compare against it. The kills
// board sorts kills, then survivors before the fallen, then health — and a
// client comparing kills alone gets every tie wrong, silently.
//
// So the ordering is declared here, and BOTH the SQL and the client's
// comparison are GENERATED from it. Not two lists that must agree — one list,
// two projections. If this file is wrong, everything is wrong together, which
// is the only kind of wrong that gets noticed.
// ────────────────────────────────────────────────────────────────────────────
//
// THE KEY IS OPAQUE ON PURPOSE. A client compares two keys elementwise and must
// never need to know that element 0 is kills or that element 1 encodes whether
// somebody died. The moment an element can be interpreted, someone branches on
// it and the rule has two homes again. So: no field names, booleans folded to
// numbers, and every element normalised so that SMALLER IS BETTER — the same
// direction for every element of every board, so one comparison serves all
// three and no caller has to remember which way round a board runs.

// Each term is DECLARATIVE so that neither projection is hand-written:
//
//   field    the column / verdict field it reads
//   invert   true when larger is better, so the value is negated to make
//            smaller-is-better hold everywhere
//   equals   turns a value into a 0/1 test — `status equals "lost"` is 1 for a
//            run that ended lost, so ascending puts survivors first
//
// `id` IS DELIBERATELY NOT HERE. It breaks ties between STORED rows (oldest
// wins), and a candidate has no id yet — so it is appended to the ORDER BY and
// left out of the key. What that means for a candidate is written on beats().
export const TERMS = {
  burial: [
    { field: "turn" },
    { field: "health", invert: true },
  ],
  seal: [
    { field: "health", invert: true },
  ],
  kills: [
    { field: "kills", invert: true },
    { field: "status", equals: "lost" },
    { field: "health", invert: true },
  ],
};

// The SQL for one term. Only ever fed the literals declared above — no request
// data reaches this, so the quoted value cannot carry anything a caller chose.
export function sqlTerm(t) {
  const base = t.equals !== undefined ? "(" + t.field + " = '" + t.equals + "')" : t.field;
  return t.invert ? "-" + base : base;
}

// The same term, read off a verdict. This is the projection a client uses; the
// one above is the projection the database uses. Both come from TERMS.
export function keyOf(board, v) {
  return (TERMS[board] || []).map((t) => {
    const raw = t.equals !== undefined ? (v[t.field] === t.equals ? 1 : 0) : v[t.field];
    return t.invert ? -raw : raw;
  });
}

// Would `candidate` take the place currently held by `cut`?
//
// TIES LOSE, and that is the rule rather than an accident of the loop. The
// stored rows break their last tie on id — oldest first — so a run arriving now
// is by definition the newest and cannot displace an equal one. Returning false
// on a full tie is the same answer the database would give.
//
// A null cut means the board has not filled: there is no last place to take, so
// everything qualifies.
export function beats(candidate, cut) {
  if (!cut) return true;
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== cut[i]) return candidate[i] < cut[i];
  }
  return false;
}
