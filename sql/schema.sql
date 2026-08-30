-- The leaderboard's one table (#143).
--
-- Applied once, by hand, by whoever owns the Cloudflare account:
--
--     npx wrangler d1 execute jiangshi-leaderboard --remote --file=sql/schema.sql
--
-- IT LIVES IN A FILE ON PURPOSE. The Worker could create this on first request
-- with CREATE TABLE IF NOT EXISTS and save the command. It does not, because a
-- schema that only exists inside a request path is a schema nobody can READ:
-- there is no file to open to find out what the table is, and a change to it
-- becomes invisible. One extra paste, once, buys a schema with an address.
--
-- EVERY COLUMN HERE IS COMPUTED BY THE SERVER. src/run.js replays the submitted
-- night and scores it; the client's own `verdict` field is never read. So no
-- value below can be set by asking for it.

CREATE TABLE IF NOT EXISTS runs (
  -- INTEGER PRIMARY KEY is SQLite's rowid alias, which is what we want.
  -- AUTOINCREMENT is deliberately absent: it exists to stop an id being reused
  -- after a delete, which matters for external references and does not here.
  id           INTEGER PRIMARY KEY,

  -- WHO. Free text with a cap, and THE CAP IS NOT IN THIS FILE.
  --
  -- The owner ruled free-text names with a maximum length. That maximum is
  -- enforced server-side in src/run.js and is deliberately NOT repeated as a
  -- CHECK here: two copies of one number drift, and the day they disagree the
  -- symptom is a submission that passes validation and is refused by the
  -- database with an error nobody can read. The server is the only writer, so
  -- it is the place the rule belongs.
  --
  -- Nullable because a run may be submitted before it is named, and because
  -- there is no account behind it — no identity is claimed by a row, only a
  -- label somebody typed.
  name         TEXT,

  -- WHAT WAS PLAYED. The whole {v, seed, actions, verdict} envelope, as JSON
  -- text, exactly as submitted.
  --
  -- SIZE: a few KB per row. A 38-action night is around 2-3KB, and long nights
  -- run longer — this is NOT a short string and should not be selected in a
  -- listing query. The three boards below want none of it.
  --
  -- It is kept whole rather than discarded after scoring so a row can be
  -- RE-VERIFIED later: if the engine changes and a score is disputed, the night
  -- can be replayed again. A leaderboard that keeps only the number it computed
  -- cannot ever check its own past.
  night        TEXT NOT NULL,
  seed         INTEGER NOT NULL,
  actions      INTEGER NOT NULL,   -- how many decisions, for sanity not scoring

  -- THE SCORE, which is verdictOf()'s object flattened one column per field.
  -- Flattened rather than left inside `night` because these are what the boards
  -- sort on, and sorting inside a JSON blob is how a leaderboard becomes slow
  -- in a way nobody can index out of.
  outcome      TEXT NOT NULL,      -- WIN_BURIAL | WIN_SEAL | LOSS_KING | LOSS_HEALTH | ...
  status       TEXT NOT NULL,      -- won | lost | over
  loss_reason  TEXT,               -- null unless status = lost
  turn         INTEGER NOT NULL,
  hour         INTEGER NOT NULL,
  health       INTEGER NOT NULL,
  kills        INTEGER NOT NULL,
  found        INTEGER NOT NULL,
  tablet       INTEGER NOT NULL,   -- 0 or 1; SQLite has no boolean

  -- WHICH ENGINE DID THE VERIFYING — AND THIS IS NOT THE SEASON GATE.
  --
  -- It records the build of the server that replayed this night. It cannot tell
  -- you which build the night was PLAYED against, because the submitted
  -- envelope carries no engine stamp: `v` is FORMAT_V, the shape version, which
  -- does not move when the engine's balance does.
  --
  -- FE is adding a client-side build stamp so /api/run can refuse a night from
  -- another balance at the door. When that lands, the gate is that stamp — not
  -- this column. Anyone reading this later and taking verified_by for a season
  -- marker will be segmenting by the wrong thing.
  verified_by  TEXT,

  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---- Indices -----------------------------------------------------------------
-- Two of the three boards are served here. The third is not, and that is a
-- decision rather than an omission — see below.
--
-- ADDING AN INDEX LATER IS NOT A MIGRATION. CREATE INDEX builds a structure
-- beside the table; it rewrites no rows and loses no data. That is why the
-- columns above had to be right the first time and these did not: a column
-- added later is a conversation, an index added later is one line.

-- 速葬 — WIN_BURIAL only, turns ascending then health descending.
CREATE INDEX IF NOT EXISTS runs_burial
  ON runs (outcome, turn ASC, health DESC);

-- 鎮屍 — WIN_SEAL only, health descending.
CREATE INDEX IF NOT EXISTS runs_seal
  ON runs (outcome, health DESC);

-- 除魔 — any completed run: kills descending, survivors before the fallen, then
-- health. NO INDEX YET, on purpose.
--
-- "Survivors before the fallen" is an ordering over a DERIVED value, not over a
-- column: it has to become something like `status = 'lost' ASC` or a CASE, and
-- which one decides the index's shape. I have not written that query yet, and
-- an index built for the wrong expression is not merely useless — it looks
-- authoritative, and the next person assumes the sort was considered.
--
-- So it lands with the query, in #143's second half. This is the one place
-- where guessing would have cost more than waiting.

-- The stats strip is four COUNT(*)s over the whole table and wants no index:
-- SQLite counts rows without one, and a partial index for three of the four
-- would be three structures serving one line of a page.
