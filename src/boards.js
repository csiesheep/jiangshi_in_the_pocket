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
