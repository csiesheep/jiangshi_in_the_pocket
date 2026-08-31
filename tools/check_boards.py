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


def insert_from_run():
    """Pull the INSERT out of src/run.js, for the same reason the SELECTs come
    out of src/boards.js: so what is executed here is what the Worker sends.

    It is written as three concatenated string literals in the source, which is
    why this joins three groups rather than matching one.
    """
    src = io.open(os.path.join(ROOT, "src", "run.js"), encoding="utf-8").read()
    m = re.search(r'"(INSERT INTO runs \([^"]*)"\s*\+\s*"([^"]*)"\s*\+\s*"([^"]*)"', src)
    if not m:
        raise SystemExit("could not read the INSERT out of src/run.js")
    return m.group(1) + m.group(2) + m.group(3)


def check_insert(db):
    """Run the shipped INSERT against the real table, and check ORDER not just
    length.

    THE FIRST VERSION OF THIS WAS CIRCULAR AND PASSED A SABOTAGE. It wrote with
    the column list extracted from the INSERT and then READ BACK USING THE SAME
    LIST — so swapping `turn` and `hour` in that list swapped them on both sides
    and cancelled out. It caught a length mismatch, which raises anyway, and
    nothing else.

    The fix is to say what each column should CONTAIN, by name, independently of
    any order. Each binding is then checked against the expectation for the
    column it is paired with, so a swapped list pairs 9 with `hour` and is
    caught. The values are chosen to be distinct — no two columns share one, or
    a swap between them would be invisible.
    """
    sql = insert_from_run()
    cols = [c.strip() for c in sql[sql.index("(") + 1:sql.index(")")].split(",")]

    # What belongs in each column, keyed by NAME. Written from the schema, not
    # from the INSERT, and deliberately all different from one another.
    WANT = {
        "name": "nm", "night": '{"v":1}', "seed": 4242, "actions": 22,
        "outcome": "LOSS_HEALTH", "status": "lost", "loss_reason": "health",
        "turn": 9, "hour": 21, "health": 3, "kills": 2, "found": 1,
        "tablet": 0, "verified_by": "deadbeef",
    }
    if len(cols) != sql.count("?"):
        print("FAIL insert: %d columns, %d placeholders" % (len(cols), sql.count("?")))
        return False
    unknown = [c for c in cols if c not in WANT]
    if unknown:
        print("FAIL insert: column(s) this check does not know: %s" % ", ".join(unknown))
        return False

    # Bindings in the ORDER src/run.js passes them. A swap in the column list
    # now mispairs against WANT and is caught below.
    order = ["name", "night", "seed", "actions", "outcome", "status", "loss_reason",
             "turn", "hour", "health", "kills", "found", "tablet", "verified_by"]
    params = [WANT[c] for c in order]

    db.execute(sql, params)
    ok = True
    for column, sent in zip(cols, params):
        if sent != WANT[column]:
            print("FAIL insert: column %s receives %r, which belongs in %s"
                  % (column, sent,
                     next(k for k, v in WANT.items() if v == sent)))
            ok = False
    # And read it back by name, so the table agrees too.
    row = list(db.execute("SELECT %s FROM runs WHERE seed = 4242"
                          % ",".join(WANT)))[0]
    for column, stored in zip(WANT, row):
        if stored != WANT[column]:
            print("FAIL insert: %s stored %r, wanted %r" % (column, stored, WANT[column]))
            ok = False
    if ok:
        print("ok   insert -> %d columns, every value in its own column" % len(cols))
    db.execute("DELETE FROM runs WHERE seed = 4242")
    return ok


def sql_from_boards():
    """Rebuild the board queries from js/boardkey.js's TERMS.

    THIS USED TO READ THE SQL AS A LITERAL. Since #146 the queries are GENERATED
    in src/boards.js from one ordering, so the client's comparison and the
    database's ORDER BY cannot disagree — and this file re-derives the query
    from the same TERMS instead of reading it.

    WHAT THAT COSTS IS NARROWER THAN IT LOOKS, and the first version of this
    note overstated it — which mattered, because a note that oversells a
    weakness invites someone to "restore" the older, weaker checker.

      still proved   the ORDERING is the ruled one, against a real database,
                     with rows planted to discriminate
      still proved   A WRONG TERMS IS CAUGHT. The expectations below —
                     expect_burial, expect_seal, expect_kills — are hand-written
                     Python sorts stating the ruling, and they do NOT read TERMS.
                     They cannot move with it. Demonstrated: delete the
                     survivors-first term from TERMS and this exits 1 with
                     "FAIL kills (kills DESC, survivors first, health DESC)".
      not proved     that the exact string src/boards.js emits is the string
                     executed here.

    So the only thing given up is the case where the two GENERATORS disagree
    while TERMS is right — which cannot make the shipped query wrong, only mean
    this file tested a near-neighbour of it. The alternative was a literal SQL
    that CAN disagree with the key; a product that cannot be wrong beats a check
    that cannot be fooled.
    """
    src = io.open(os.path.join(ROOT, "js", "boardkey.js"), encoding="utf-8").read()
    block = src[src.index("export const TERMS"):src.index("export function sqlTerm")]

    def terms_for(board):
        seg = block[block.index(board + ":"):]
        seg = seg[:seg.index("]")]
        out = []
        for m in re.finditer(r"\{([^}]*)\}", seg):
            body = m.group(1)
            field = re.search(r'field:\s*"([^"]+)"', body).group(1)
            eq = re.search(r'equals:\s*"([^"]+)"', body)
            inv = "invert: true" in body
            base = "(%s = '%s')" % (field, eq.group(1)) if eq else field
            out.append(("-" + base) if inv else base)
        return out

    where = {
        "burial": "outcome = 'WIN_BURIAL'",
        "seal": "outcome = 'WIN_SEAL'",
        "kills": "status <> 'playing'",
    }
    shown = ("id, name, outcome, status, turn, hour, health, kills, found, "
             "tablet, created_at")
    out = {}
    for board, key in (("burial", "BURIAL"), ("seal", "SEAL"), ("kills", "KILLS")):
        t = terms_for(board)
        if not t:
            raise SystemExit("no terms parsed for the %s board" % board)
        cols = ", ".join("%s AS k%d" % (e, i) for i, e in enumerate(t))
        order = ", ".join("k%d ASC" % i for i in range(len(t))) + ", id ASC"
        out[key] = ("SELECT %s, %s FROM runs WHERE %s ORDER BY %s LIMIT ?"
                    % (shown, cols, where[board], order))
    out["STATS"] = io.open(os.path.join(ROOT, "src", "boards.js"), encoding="utf-8")         .read().split("export const STATS = `")[1].split("`")[0]
    return out


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
    ok = check_insert(db)
    plant(db)

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
