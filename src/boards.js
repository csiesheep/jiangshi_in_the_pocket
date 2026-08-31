import { TERMS, sqlTerm } from "../js/boardkey.js";

// The three boards and the stats strip, as SQL (#143, #146).
//
// THE QUERIES LIVE HERE AND NOWHERE ELSE. tools/check_boards.py reads these
// exact strings out of this file and runs them against a real sqlite loaded
// from sql/schema.sql — so the thing that is tested is the thing that ships,
// rather than a copy in a test that can drift away from it.
//
// Run it after touching anything below:
//
//     python tools/check_boards.py
//
// WHY THAT IS NOT IN THE BROWSER SUITE. There is no SQLite in the browser, so
// tests/ cannot execute a query — it could only assert that the text of one
// looks right, which is the shape of guard that passes on a query returning
// nothing. The verification has to be where a database is, and the only
// database available without an account is sqlite in a Python process.

// ---- The three boards, GENERATED from one ordering ---------------------------
// The ORDER BY is built from js/boardkey.js's TERMS, and so are the k0..kn
// columns each row carries. They cannot disagree because they are the same
// list: the query orders by the key columns, ascending, in order.
//
// That is the whole point. Writing `ORDER BY kills DESC, (status='lost') ASC`
// here and a matching comparison in the client would be two hand-maintained
// things that must agree — the identical failure BOARD_SIZE was moved here to
// fix, one layer down and invisible when it goes wrong, because ties do not
// announce themselves.
//
// 速葬 — WIN_BURIAL only, and turns ascending: the point of the board is that
// the tablet went into the ground early. Health breaks the tie, because two
// burials on the same turn are separated by what they cost.
//
// 鎮屍 — WIN_SEAL only, health alone. Sealing him is not a race; it is a
// question of what you had left when it was done.
//
// 除魔 — any completed run. `status <> 'playing'` is defensive rather than
// necessary: /api/run refuses an unfinished night, so no such row should exist,
// and if one ever does it is a bug and should not be silently ranked.
const WHERE = {
  burial: "outcome = 'WIN_BURIAL'",
  seal: "outcome = 'WIN_SEAL'",
  kills: "status <> 'playing'",
};

// The row fields a board returns. `night` is deliberately absent — it is a few
// KB per row and no board needs it.
const SHOWN = "id, name, outcome, status, turn, hour, health, kills, found, tablet, created_at";

function boardSql(board) {
  const terms = TERMS[board];
  const cols = terms.map((t, i) => sqlTerm(t) + " AS k" + i);
  // EVERY KEY COLUMN ASCENDING, because the terms are already normalised so
  // that smaller is better. One direction for every element of every board.
  //
  // `id ASC` last and NOT part of the key: it breaks ties between stored rows,
  // oldest first, and a candidate has no id to compare with. See beats().
  const order = terms.map((_, i) => "k" + i + " ASC").concat("id ASC");
  return `
  SELECT ${SHOWN}, ${cols.join(", ")}
    FROM runs
   WHERE ${WHERE[board]}
   ORDER BY ${order.join(", ")}
   LIMIT ?`;
}

export const BURIAL = boardSql("burial");
export const SEAL = boardSql("seal");
export const KILLS = boardSql("kills");

// ---- The strip ---------------------------------------------------------------
// Four counts in one pass rather than four queries. SUM over a boolean is
// SQLite's idiom for a conditional count and it reads better than four
// COUNT(*) FILTER clauses.
export const STATS = `
  SELECT COUNT(*)                        AS nights,
         SUM(outcome = 'WIN_BURIAL')     AS burials,
         SUM(outcome = 'WIN_SEAL')       AS seals,
         SUM(status  = 'lost')           AS deaths
    FROM runs`;

// EVERY BOARD BREAKS ITS LAST TIE ON id, and that is not decoration. Without it
// two rows equal on every sorted column come back in whatever order the storage
// engine feels like, which means a leaderboard that reorders itself between two
// identical requests. `id` ascending makes the older run win a dead heat, which
// is also the fair answer.

// ---- Routing table ------------------------------------------------------------
// Name to query, so src/index.js can dispatch on a path segment without a
// switch that has to be kept in step with the exports above. A board that is
// not in here is not reachable, which is the behaviour we want for a typo.
export const BOARDS = { burial: BURIAL, seal: SEAL, kills: KILLS };

// How many rows a board returns when the caller does not say. Not unbounded:
// `night` is a few KB per row and none of the boards select it, but an
// unbounded LIMIT is still a way to ask the database to sort the whole table.
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// ---- How long a board is, and why the number lives here -----------------------
// THE CUT LINE IS THE 50th ROW. A board holds this many; a run that would not
// reach the last place on any board is not worth offering the leaderboard for,
// and a board with fewer rows than this has no cut line at all — everything
// qualifies until it fills.
//
// IT IS DEFINED HERE AND SHIPPED IN THE RESPONSE, and that is the whole point
// of writing it down rather than leaving it to the caller. A client that knows
// "50" because somebody typed 50 into it owns a policy it did not decide: the
// day this becomes 100, the server fills a hundred places and the client still
// stops offering at fifty, and nothing anywhere says they disagree. The client
// should be able to READ the rule, not restate it.
//
// See the note by `cut` in run.js for the part this does NOT solve: knowing how
// long the board is does not tell a client how to compare against its last row.
export const BOARD_SIZE = 50;
