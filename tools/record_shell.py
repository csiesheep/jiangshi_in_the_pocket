#!/usr/bin/env python3
"""Rewrite sw.js's CACHE and SHELL_DIGEST from the shell's blobs, and restamp
the test harness's identity.

Run it whenever anything in SHELL changes, then commit sw.js with the change:

    python tools/record_shell.py

WHY THIS EXISTS, twice over.

A cache version that a human picks can collide. It did, twice: two branches
independently chose v24 for different shells, then independently chose v26.
Neither side was careless — both read "current is v25" and both were right, and
both were internally consistent, so both were green. A counter cannot detect
that. A name derived from the content can, because two different shells cannot
produce the same name by accident and nobody is choosing anything.

And a fingerprint taken from the working tree describes bytes that depend on the
machine. This project was hashing a CRLF checkout while git stores, and
Cloudflare serves, LF — so the recorded digest described files that existed in
one worktree and nowhere else, and two entries survived in that state for days.
So the bytes hashed here are the BLOB, `git show HEAD:<path>`: the form git
stores, the form the CDN serves, and the only form that is the same everywhere.

That matters more once the name is derived from the digest than it did before.
A working-tree-derived name would differ per machine for identical content, so
every deploy from a differently-configured checkout would silently evict every
player's cache and re-download the shell — worse than the bug it replaces, and
invisible. Blob-sourcing is correctness here, not hygiene.

NOTE: this reads HEAD, so it records what is COMMITTED. Commit the shell change
first, then run this, then commit sw.js. Running it against a dirty tree would
record bytes nobody has yet.
"""

import hashlib
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = "jiangshi-"


def blob(path):
    """The committed bytes — what git stores and the CDN serves."""
    return subprocess.check_output(["git", "-C", ROOT, "show", "HEAD:" + path])


def short(data, n=10):
    return hashlib.sha256(data).hexdigest()[:n]


def shell_paths(src):
    body = src[src.index("const SHELL = [") : src.index("];", src.index("const SHELL = ["))]
    return re.findall(r'"([^"]+)"', body)


def derive_name(rows):
    """The cache name, as a function of the shell and nothing else.

    Kept deliberately simple so the browser can recompute it from the recorded
    block alone and prove the name was not typed by hand. tests/shell.test.js
    reimplements exactly this; if you change it, change both.
    """
    joined = "".join("%s:%s\n" % (path, h) for path, h in rows)
    return PREFIX + hashlib.sha256(joined.encode("utf-8")).hexdigest()[:8]


def render(rows, name):
    width = max(len(p) for p, _ in rows) + 3
    lines = ['  %s "%s",' % (('"' + p + '":').ljust(width), h) for p, h in rows]
    return "const SHELL_DIGEST = {\n" + "\n".join(lines) + "\n};", name


def rewrite(path, fn):
    src = io.open(path, encoding="utf-8", newline="").read()
    out = fn(src)
    if out == src:
        return False
    # newline="" so this never reintroduces the CRLF problem it exists to end.
    io.open(path, "w", encoding="utf-8", newline="").write(out)
    return True


def stamp_harness():
    """Give tests/harness.js an id that changes whenever harness.js changes.

    The harness carries the staleness check for every suite, so it cannot use
    that check on itself — a cached harness ships a cached guard and reports a
    confident green under the old rules. It compares its own id against the file
    on disk instead, which only works if the id moves with the content.

    Hashed from the WORKING TREE here, not the blob, and deliberately: the point
    is to catch a module in memory that is older than the file being served, so
    the id has to change the moment the file does, committed or not. The stamp
    line itself is blanked before hashing, or it would be hashing itself.
    """
    path = os.path.join(ROOT, "tests", "harness.js")
    # Anchored to the declaration LINE. Unanchored it also matched the copies
    # of the pattern inside harness.js itself and rewrote stampFor's own
    # neutraliser — the stamper corrupting the thing that computes the stamp.
    # harness.js anchors identically; shell/harness tests compare the two.
    pattern = re.compile(r'^export const HARNESS_ID = "([^"]*)";$', re.M)

    def fn(src):
        neutral = pattern.sub('export const HARNESS_ID = "";', src)
        want = short(neutral.encode("utf-8"), 8)
        return pattern.sub('export const HARNESS_ID = "%s";' % want, src)

    if not pattern.search(io.open(path, encoding="utf-8", newline="").read()):
        print("  harness.js has no HARNESS_ID marker; skipped")
        return
    changed = rewrite(path, fn)
    print("  tests/harness.js %s" % ("restamped" if changed else "already current"))


def stamp_suites():
    """Give every test suite an id that changes whenever the suite changes.

    Same argument as stamp_harness, one level out. The declared-count guard
    catches a suite that did not run; it cannot catch a suite that ran the WRONG
    COPY when the counts happen to match — and that is not hypothetical, it once
    reported a missing element that exists nowhere in the tree.

    Working tree again, not the blob: the point is to catch a module in memory
    that is older than the file being served, so the id has to move the moment
    the file does, committed or not.
    """
    import glob

    pattern = re.compile(r'^suite\(import\.meta\.url, "([^"]*)"\);$', re.M)
    for path in sorted(glob.glob(os.path.join(ROOT, "tests", "*.test.js"))):
        src = io.open(path, encoding="utf-8", newline="").read()
        if not pattern.search(src):
            print("  %s has no suite() stamp; skipped" % os.path.basename(path))
            continue

        def fn(s, _pat=pattern):
            neutral = _pat.sub('suite(import.meta.url, "");', s)
            want = short(neutral.encode("utf-8"), 8)
            return _pat.sub('suite(import.meta.url, "%s");' % want, s)

        changed = rewrite(path, fn)
        print("  tests/%s %s" % (os.path.basename(path),
                                 "restamped" if changed else "already current"))


def stamp_build(paths):
    """Give js/shell.js an id that changes whenever any shell file changes.

    THE QUESTION IT ANSWERS: which build is the page actually EXECUTING. The
    service worker's CACHE name answers a different one — which build the worker
    would serve — and the two disagree exactly when it matters, because a page
    keeps the modules it was handed even after a newer worker claims it. So this
    is stamped into a module the page imports, not into sw.js.

    Working tree, not the blob, for the same reason as stamp_harness: the id has
    to move the moment a file does, committed or not, or it cannot catch a stale
    module in memory. The stamp line is blanked before hashing, or it would be
    hashing itself.

    Hashed over every shell file rather than shell.js alone, so a change to
    audio.js — which is what provoked this — moves the number a player can read.
    """
    path = os.path.join(ROOT, "js", "shell.js")
    pattern = re.compile(r'^export const BUILD_ID = "([^"]*)";$', re.M)
    src = io.open(path, encoding="utf-8", newline="").read()
    if not pattern.search(src):
        print("  js/shell.js has no BUILD_ID marker; skipped")
        return

    h = hashlib.sha256()
    for p in paths:
        rel = "index.html" if p == "./" else p
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        try:
            body = io.open(full, "rb").read()
        except IOError:
            continue
        if rel == "js/shell.js":
            body = pattern.sub('export const BUILD_ID = "";',
                               body.decode("utf-8")).encode("utf-8")
        h.update(("%s:" % rel).encode("utf-8"))
        h.update(body)
    want = h.hexdigest()[:8]

    changed = rewrite(path, lambda s: pattern.sub(
        'export const BUILD_ID = "%s";' % want, s))
    print("  js/shell.js BUILD_ID -> %s%s" % (want, "" if changed else " (already current)"))


def main():
    sw = os.path.join(ROOT, "sw.js")
    src = io.open(sw, encoding="utf-8", newline="").read()
    paths = shell_paths(src)

    rows = []
    for p in paths:
        # "./" is the directory index; the bytes are index.html's.
        rows.append((p, short(blob("index.html" if p == "./" else p))))

    name = derive_name(rows)
    block, _ = render(rows, name)

    def fn(s):
        s = re.sub(r'const CACHE = "[^"]*";', 'const CACHE = "%s";' % name, s, count=1)
        start = s.index("const SHELL_DIGEST = {")
        end = s.index("};", start) + 2
        return s[:start] + block + s[end:]

    before = re.search(r'const CACHE = "([^"]*)";', src).group(1)
    changed = rewrite(sw, fn)
    print("sw.js %s" % ("rewritten" if changed else "already current"))
    print("  %d shell files, hashed from HEAD blobs" % len(rows))
    print("  CACHE %s -> %s" % (before, name))
    stamp_build(paths)
    stamp_harness()
    stamp_suites()
    return 0


if __name__ == "__main__":
    sys.exit(main())
