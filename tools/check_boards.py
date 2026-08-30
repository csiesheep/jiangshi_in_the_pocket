"""Run the leaderboard's boards against a real database.

    python tools/check_boards.py

WHY THIS EXISTS RATHER THAN A TEST IN tests/. There is no SQLite in a browser,
so the suite cannot execute a query — it could only assert that the text of one
looks right, and a guard over the TEXT of a query passes just as happily on a
query that returns nothing. So the boards are checked where a database is.

THE SQL IS READ OUT OF src/boards.js, not restated here. A copy in this file
would drift from the one that ships, and then this would be verifying a query
nobody runs. Same argument as tests/ reading constants out of the source.

The rows below are planted to DISCRIMINATE rather than to be plausible: each
one exists to separate two orderings that a wrong query would confuse. A row
that cannot change the answer is not evidence.

And the expected orderings are DERIVED from the ruling in Python rather than
pasted from what SQL printed — see the block above plant(). A pasted expectation
turns this file into a mirror the moment a board changes.
"""
import io
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sql_from_boards():
    """Pull the exported template literals out of src/boards.js.

    Anchored on `export const NAME = \\`...\\`` so a comment mentioning one of
    these names cannot be mistaken for a definition — the same anchoring lesson
    record_shell.py's stamper learned when an unanchored pattern rewrote its own
    neutraliser.
    """
    src = io.open(os.path.join(ROOT, "src", "boards.js"), encoding="utf-8").read()
    found = dict(re.findall(r"^export const (\w+) = `([^`]*)`", src, re.M))
    want = ["BURIAL", "SEAL", "KILLS", "STATS"]
    missing = [w for w in want if w not in found]
    if missing:
        raise SystemExit("could not read %s out of src/boards.js" % ", ".join(missing))
    return found


COLUMNS = ("name,night,seed,actions,outcome,status,loss_reason,"
           "turn,hour,health,kills,found,tablet,verified_by")

# name, outcome, status, loss_reason, turn, health, kills
PLANTED = [
    # Two burials on the SAME turn, different health: separates "turn only"
    # from "turn then health".
    ("early-hurt", "WIN_BURIAL", "won", None, 12, 2, 3),
    ("early-well", "WIN_BURIAL", "won", None, 12, 8, 1),
    # A later burial with the best health of all: catches a query that sorts on
    # health first, which would put this at the top of the burial board.
    ("late-best",  "WIN_BURIAL", "won", None, 27, 10, 0),
    # Two seals: health alone decides.
    ("seal-low",   "WIN_SEAL",   "won", None, 20, 1, 4),
    ("seal-high",  "WIN_SEAL",   "won", None, 26, 9, 0),
    # THE FOUR ROWS THE THIRD BOARD EXISTS FOR: all on six kills, two survived
    # and two did not, and dead-7hp has MORE health than either survivor. If
    # health outranked survival it would sort above them, so this set separates
    # "survivors first" from "health first" — which no plausible-looking row
    # can do on its own.
    ("fell-6",     "LOSS_HEALTH", "lost", "health", 9, 0, 6),
    ("lived-6",    "WIN_SEAL",    "won",  None,     22, 3, 6),
    ("dead-7hp",   "LOSS_KING",  "lost", "midnight", 30, 7, 6),
    ("lived-thin", "WIN_BURIAL", "won",  None,       25, 1, 6),
]


# ---- What the ruling says, in Python -----------------------------------------
# THE EXPECTATIONS ARE DERIVED, NOT PASTED. A literal list carries no record of
# where it came from, so the cheapest way to make this file pass after a board
# legitimately changes is to paste the new output — and at that moment the check
# stops being a check and becomes a mirror.
#
# So each ordering is written out HERE from the ruling's own wording and
# compared against what SQL returns: two independent implementations of one
# spec.
#
# THE LIMIT OF THAT, said plainly: two implementations can share a MISREADING of
# the spec. If I misread "survivors before the fallen" I would very likely
# misread it the same way twice and both sides would agree while both were
# wrong. What rules that out is not this comparison — it is sabotaging the SQL
# and watching this go red, which is why that step is not optional.
#
# `id ASC` is every board's last term, and here it is the position in PLANTED:
# rows are inserted in that order, so the oldest run is the earliest entry.
# Python's sort is stable, so leaving it implicit is the same thing.
def _rows():
    return [dict(name=n, outcome=o, status=st, turn=t, health=h, kills=k)
            for n, o, st, _r, t, h, k in PLANTED]


def expect_burial():
    """WIN_BURIAL only, turns ascending, then health descending."""
    rows = [r for r in _rows() if r["outcome"] == "WIN_BURIAL"]
    rows.sort(key=lambda r: (r["turn"], -r["health"]))
    return [r["name"] for r in rows]


def expect_seal():
    """WIN_SEAL only, health descending."""
    rows = [r for r in _rows() if r["outcome"] == "WIN_SEAL"]
    rows.sort(key=lambda r: -r["health"])
    return [r["name"] for r in rows]


def expect_kills():
    """Any completed run: kills descending, survivors before the fallen, then
    health descending — the ruling's wording, with "the fallen" read as a run
    whose status is lost."""
    rows = [r for r in _rows() if r["status"] != "playing"]
    rows.sort(key=lambda r: (-r["kills"], 1 if r["status"] == "lost" else 0, -r["health"]))
    return [r["name"] for r in rows]


def expect_stats():
    """Four counts: nights, burials, seals, deaths."""
    rows = _rows()
    return [len(rows),
            sum(1 for r in rows if r["outcome"] == "WIN_BURIAL"),
            sum(1 for r in rows if r["outcome"] == "WIN_SEAL"),
            sum(1 for r in rows if r["status"] == "lost")]


def plant(db):
    rows = []
    for name, outcome, status, reason, turn, health, kills in PLANTED:
        rows.append((name, '{"v":1,"seed":1,"actions":[]}', 1, 0, outcome, status,
                     reason, turn, 23, health, kills, 0,
                     1 if outcome == "WIN_BURIAL" else 0, "test"))
    db.executemany(
        "INSERT INTO runs (%s) VALUES (%s)" % (COLUMNS, ",".join("?" * 14)), rows)


def names(db, sql, limit=50):
    return [r[1] for r in db.execute(sql.replace("?", str(limit)))]


def check(label, got, want):
    if got != want:
        print("FAIL %s\n  got  %s\n  want %s" % (label, got, want))
        return False
    print("ok   %s -> %s" % (label, got))
    return True


def main():
    q = sql_from_boards()
    db = sqlite3.connect(":memory:")
    db.executescript(io.open(os.path.join(ROOT, "sql", "schema.sql"),
                             encoding="utf-8").read())
    plant(db)

    ok = True
    # 速葬: turn ascending, then health descending. late-best has the best
    # health in the table and must still come last.
    # NOTE lived-thin and lived-6 appear here and on the seal board as well as
    # on the kills board. That is not contamination — a burial with six kills is
    # a real run — and the hand-written expectations were WRONG on the first
    # pass for forgetting it. That is why they are no longer hand-written.
    ok &= check("burial (turn ASC, health DESC)", names(db, q["BURIAL"]),
                expect_burial())
    # 鎮屍: health descending, and turn must not enter into it.
    ok &= check("seal (health DESC)", names(db, q["SEAL"]), expect_seal())
    # 除魔: the four six-kill rows are what this board is for — dead-7hp has
    # more health than either survivor and must still sort below both.
    ok &= check("kills (kills DESC, survivors first, health DESC)",
                names(db, q["KILLS"]), expect_kills())

    stats = list(db.execute(q["STATS"]))[0]
    ok &= check("stats (nights, burials, seals, deaths)", list(stats), expect_stats())

    # Does the burial board actually reach its index, or is it sorting by hand?
    plan = " ".join(str(r[-1]) for r in
                    db.execute("EXPLAIN QUERY PLAN " + q["BURIAL"].replace("?", "50")))
    if "runs_burial" not in plan:
        print("FAIL burial query does not use runs_burial\n  plan: %s" % plan)
        ok = False
    else:
        print("ok   burial uses its index -> %s" % plan.strip())

    print("\n%s" % ("all boards agree with the ruling" if ok else "A BOARD IS WRONG"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
