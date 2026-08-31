// The three boards and the stats strip, as SQL (#143).
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

// ---- 速葬 — the fastest burial ------------------------------------------------
// WIN_BURIAL only. Turns ascending: the whole point of the board is that the
// tablet went into the ground early. Health descending breaks a tie, because
// two burials on the same turn are separated by what they cost.
export const BURIAL = `
  SELECT id, name, turn, health, created_at
    FROM runs
   WHERE outcome = 'WIN_BURIAL'
   ORDER BY turn ASC, health DESC, id ASC
   LIMIT ?`;

// ---- 鎮屍 — the sealing ------------------------------------------------------
// WIN_SEAL only, health descending. No turn term: sealing him is not a race,
// it is a question of what you had left when it was done.
export const SEAL = `
  SELECT id, name, health, turn, created_at
    FROM runs
   WHERE outcome = 'WIN_SEAL'
   ORDER BY health DESC, id ASC
   LIMIT ?`;

// ---- 除魔 — what was put down -------------------------------------------------
// Any completed run, and this is the board the schema deliberately shipped
// without an index for, because the middle term is not a column.
//
// "SURVIVORS BEFORE THE FALLEN" IS AN ORDERING OVER A DERIVED VALUE. Written as
// `status = 'lost'` it yields 0 for a run that ended won or over and 1 for one
// that ended lost, so ASC puts survivors first. The alternatives — a CASE, or
// `status != 'lost' DESC` — sort identically and would each want a differently
// shaped index, which is exactly why this waited for the query to exist.
//
// `status <> 'playing'` is defensive rather than necessary: /api/run refuses an
// unfinished night, so no such row should exist. If one ever does, it is a bug
// and it should not be silently ranked.
export const KILLS = `
  SELECT id, name, kills, status, health, created_at
    FROM runs
   WHERE status <> 'playing'
   ORDER BY kills DESC, (status = 'lost') ASC, health DESC, id ASC
   LIMIT ?`;

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
