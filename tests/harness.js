// Tiny zero-dependency test harness. Runs in the browser (no Node on this
// machine). Reports to the DOM and the console; sets a machine-readable
// summary line ("TESTS: X passed, Y failed") and document.title so results
// can be read back headlessly.

// The one staleness this file cannot otherwise see. The suite-count guard below
// catches a cached SUITE, but it lives here — so a cached harness ships a cached
// guard, and the run comes back green with the old rules quietly applied. That
// is not hypothetical: the async fix was invisible on an origin holding the
// pre-fix harness, and a five-file-stale digest printed GREEN on another for the
// same reason. A wrong red costs time; a wrong green costs trust in every
// earlier result too.
//
// So the harness asks the disk who it is. The running module knows its own id;
// the file on disk declares one; if they differ, the module in memory is older
// than the file and NOTHING it reports can be relied on.
//
// Stamped by tools/record_shell.py from harness.js's own blob hash, so nobody
// has to remember to change it. Set by hand it still works — forgetting only
// costs the protection, it cannot produce a wrong answer.
export const HARNESS_ID = "3a7a116b";

// Pulled out so both directions can be tested without a network.
// Anchored to the DECLARATION line, and that is load-bearing rather than tidy:
// unanchored, this pattern also matches the copies of itself further down this
// file, and record_shell.py rewrote the replacement literal inside stampFor —
// so the stamper corrupted its own neutraliser and the hash chased its own
// tail. Both sides anchor the same way now, and the suite compares them.
const STAMP = /^export const HARNESS_ID = "([^"]*)";$/m;
const STAMP_ALL = /^export const HARNESS_ID = "[^"]*";$/gm;
const BLANK_DECL = "export const HARNESS_ID = " + '"";';

export function harnessIdFrom(src) {
  const m = String(src).match(STAMP);
  return m ? m[1] : null;
}

// What the id SHOULD be for this source: a hash of the file with the stamp line
// blanked, because otherwise it would be hashing itself.
//
// This is the half that stops the guard from quietly retiring. Comparing the
// running id against the disk id catches a stale module — but edit this file
// and forget to restamp, and both copies carry the same stale value, so they
// agree, the check passes, and nothing is being guarded. A verifier that can
// quietly verify nothing is worse than no verifier, and that sentence was
// already in this file while the verifier's own verifier had the hole.
//
// tools/record_shell.py computes exactly this. If the two drift apart the suite
// fails, which is the same arrangement derive_name and deriveName already have.
export async function stampFor(src) {
  const neutral = String(src).replace(STAMP_ALL, BLANK_DECL);
  const bytes = new TextEncoder().encode(neutral);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 8);
}

async function harnessIsCurrent() {
  try {
    const src = await fetch(new URL(import.meta.url), { cache: "no-store" }).then((r) => r.text());
    const disk = harnessIdFrom(src);
    // No marker on disk means an older harness than this check — nothing to
    // compare against, and inventing a failure would be worse than staying quiet.
    if (disk === null) return { ok: true };
    return { ok: disk === HARNESS_ID, disk, running: HARNESS_ID };
  } catch {
    return { ok: true }; // cannot reach the file; not evidence of anything
  }
}

// ---- Which suites actually loaded, and which copy of each -----------------
// The declared-count guard below catches a suite that did not run. It cannot
// catch a suite that ran the WRONG COPY when the counts happen to match — which
// is not hypothetical: a stale data.test.js once reported "game.html has no
// #copy-replay", a string that exists nowhere in the tree, and the totals
// agreed so nothing complained. A guard that reports a true-sounding falsehood
// is worse than one that stays quiet.
//
// So every suite states which copy of itself is speaking. The stamp is written
// by tools/record_shell.py from the file's own content, exactly as HARNESS_ID
// is, and report() compares what SPOKE against what is on disk. A stale module
// carries the old stamp and the file carries the new one, so they disagree.
const suiteStamps = new Map();

const fileOf = (u) => {
  try { return new URL(u, location.href).pathname.split("/").pop(); }
  catch { return String(u); }
};

// Called once at the top of each suite: suite(import.meta.url, "<stamp>").
export function suite(url, stamp) {
  suiteStamps.set(fileOf(url), String(stamp));
}

// What each suite actually registered when it was imported. Exported so the
// live check can be a test rather than only a banner.
export function registeredSuites() {
  return Object.fromEntries(suiteStamps);
}

// Pure, so both directions can be tested without a network.
//
// An UNSTAMPED file on disk is "no opinion" — it predates this guard and
// accusing it would be inventing a failure. A stamped file whose suite
// registered nothing, or registered a different stamp, is stale: the copy that
// ran is older than the copy being served.
export function staleSuites(ran, onDisk) {
  const bad = [];
  for (const [name, disk] of Object.entries(onDisk)) {
    if (disk === null || disk === undefined) continue;
    const spoke = ran[name];
    if (spoke === undefined) bad.push(`${name} — the copy that ran is older than the stamp`);
    else if (spoke !== disk) bad.push(`${name} — ran "${spoke}", disk has "${disk}"`);
  }
  return bad;
}

const results = [];

// Async bodies settle after test() has already returned, so their outcomes are
// collected here and report() waits on them before counting anything.
//
// This was a hole rather than a design: test() called fn() inside a synchronous
// try/catch, which cannot see a promise reject, so every
// `test(name, async () => …)` was recorded as a pass whatever it asserted.
// Measured rather than reasoned about — a probe registering one synchronous
// failure and one asynchronous failure reported exactly one. Several suites
// here carry async tests that had therefore never once been checked. A verifier
// that can quietly verify nothing is worse than no verifier.
const settling = [];

export function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      // Recorded in registration order so the report stays readable, then
      // corrected in place if the promise rejects.
      const entry = { name, ok: true };
      results.push(entry);
      settling.push(out.then(null, (err) => {
        const why = asSkip(err);
        if (why) { entry.skipped = why; return; }
        entry.ok = false;
        entry.err = err instanceof Error ? err : new Error(String(err));
      }));
      return;
    }
    results.push({ name, ok: true });
  } catch (err) {
    const why = asSkip(err);
    if (why) results.push({ name, ok: true, skipped: why });
    else results.push({ name, ok: false, err });
  }
}

// A TEST THAT COULD NOT RUN IS NOT A TEST THAT PASSED (#98).
//
// Two stage tests measure a subject against a panel sized by var(--tile),
// which is clamp(96px, 28vh, 285px). In a browser pane that never composites,
// innerWidth and innerHeight are 0, --tile resolves to the empty string, and
// those tests correctly refused to pass vacuously — so they FAILED. Green
// therefore depended on the verifier's window: green for a reviewer with a
// pane, red for one without, on identical bytes.
//
// Failing was the right instinct and the wrong state. The danger is not one
// phantom chased; it is FAIL (2) becoming the expected reading, with a real
// third failure hiding inside it. This project already has one standing red
// everybody skims past — the shell digest — and two is where that becomes a
// habit.
//
// So: skipped tests are counted, listed, and named in the title. They are NOT
// added to the pass count, because "PASS (330)" must never include something
// nobody checked. The reason is mandatory and should name the CAUSE — a
// zero-width window — so the next person does not go debugging the stage.
// Thrown, not pushed. A test body cannot register its own result — test() has
// already decided to record one by the time the body runs — so the skip is a
// marked throw that the runner converts. That also makes it work identically in
// an async body, where the only channel out is a rejection.
const SKIPPED = "__skipped__";

export function skipUnless(cond, reason) {
  if (cond) return;
  if (!reason) throw new Error("skipUnless needs a reason naming the cause");
  const e = new Error(reason);
  e[SKIPPED] = true;
  throw e;
}

function asSkip(err) {
  return err && err[SKIPPED] ? String(err.message) : null;
}

export function assert(cond, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} — expected ${e}, got ${a}`);
}

export function throws(fn, msg = "expected throw") {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(msg);
}

// How many tests each suite FILE declares, read off disk with the cache
// bypassed. Compared against how many actually registered.
//
// This exists because a browser will happily run a stale suite and report a
// confident green. Cache-busting the page URL does not help: tests/index.html
// imports "./engine.test.js" with no query, so the module map reuses whatever
// that URL resolved to on this origin last time, however the page was loaded.
// It has now bitten this project twice — once hiding a fixed data table behind
// a pre-fix copy of the test asserting it, and once reporting a two-test-short
// total as the truth. A verification tool that can silently verify the wrong
// code is worse than no tool, so the count is checked rather than trusted.
//
// Counts `test(` at the start of a line. Every suite here declares tests at top
// level, one per line; a test built inside a loop would undercount, and the
// warning it produced would be a false alarm rather than a missed one.
async function declaredCounts(suites) {
  const out = {};
  await Promise.all(
    suites.map(async (name) => {
      try {
        const res = await fetch(`./${name}?fresh=${Date.now()}`, { cache: "no-store" });
        const text = await res.text();
        const m = text.match(/^suite\(import\.meta\.url, "([^"]*)"\);$/m);
        out[name] = { count: (text.match(/^test\(/gm) || []).length, stamp: m ? m[1] : null };
      } catch {
        out[name] = null; // unreadable: cannot judge, so do not accuse
      }
    })
  );
  return out;
}

// `suites` is the same list index.html imported, in the same order. Pass it and
// the report can tell you the run is stale; omit it and it reports as before.
export async function report(suites = []) {
  // Nothing is counted until every async body has settled.
  await Promise.all(settling);

  // Skips are their own state. Counted out of `passed` deliberately: a run that
  // says "PASS (330)" must not be including tests nobody executed.
  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.length - passed - skipped;

  const summary = `TESTS: ${passed} passed, ${failed} failed` +
    (skipped ? `, ${skipped} skipped` : "");
  console.log(summary);

  // Is this harness itself the one on disk? Asked first, because if it is not
  // then the count below was produced by the wrong rules and comparing it to
  // anything is theatre.
  let stale = null;
  let declaredOnce = null;
  const identity = await harnessIsCurrent();
  if (!identity.ok) {
    stale = {
      kind: "harness",
      registered: results.length,
      expected: results.length,
      message:
        `STALE HARNESS — the browser is running harness.js "${identity.running}" ` +
        `while the file on disk is "${identity.disk}". Every result above was ` +
        `produced by the older rules and none of them can be trusted. ` +
        `Reload from a host:port this browser has not used before.`,
    };
    console.error(stale.message);
  }

  // Is every suite the copy on disk? Asked before the count, because a wrong
  // copy explains a wrong count and not the other way round.
  if (!stale && suites.length) {
    declaredOnce = await declaredCounts(suites);
    const onDisk = {};
    for (const [name, d] of Object.entries(declaredOnce)) onDisk[name] = d && d.stamp;
    const names = staleSuites(Object.fromEntries(suiteStamps), onDisk);
    if (names.length) {
      stale = {
        kind: "suite",
        registered: results.length,
        expected: results.length,
        message:
          `STALE SUITE — the browser ran an older copy of: ${names.join("; ")}. ` +
          `The count matching proves nothing; a stale suite with the same number ` +
          `of tests is invisible to it. Reload from a host:port this browser has ` +
          `not used before.`,
      };
      console.error(stale.message);
    }
  }

  // Did every test that exists on disk actually run?
  if (!stale && suites.length) {
    const declared = declaredOnce || (await declaredCounts(suites));
    const known = Object.values(declared).filter((n) => n !== null);
    if (known.length === suites.length) {
      const expected = known.reduce((n, c) => n + c.count, 0);
      if (expected !== results.length) {
        stale = { expected, registered: results.length, declared };
        console.error(
          `STALE RUN: ${results.length} tests registered, ${expected} declared on disk. ` +
            `The browser is running a cached copy of at least one suite — ` +
            `reload from a host:port this browser has not used before.`,
          declared
        );
      }
    }
  }
  for (const r of results) {
    if (r.skipped) console.warn(`SKIP  ${r.name} — ${r.skipped}`);
    else if (r.ok) console.log(`  ok  ${r.name}`);
    else console.error(`FAIL  ${r.name}\n      ${r.err.message}`);
  }

  document.title = stale
    ? (stale.kind === "harness" ? "STALE HARNESS"
       : stale.kind === "suite" ? "STALE SUITE"
       : `STALE (${results.length}/${stale.expected})`)
    : failed === 0
      ? (skipped ? `PASS (${passed}) ${skipped} SKIPPED` : `PASS (${passed})`)
      : `FAIL (${failed})`;

  // The test page loads no stylesheet — it is deliberately standalone — so these
  // mirror the palette tokens by hand: --accent, --danger, --muted. Keep them in
  // step with :root in css/style.css if those move.
  const root = document.getElementById("out") || document.body;
  const h = document.createElement("h1");
  h.textContent = summary;
  h.style.color = failed === 0 ? "#7fb539" : "#ef6449";
  if (stale) {
    // Louder than a failure, because a failure at least tells you something
    // true about the code. This says the whole report is untrustworthy.
    const warn = document.createElement("p");
    warn.textContent = stale.message ||
      `STALE RUN — ${stale.registered} tests ran, ${stale.expected} exist on disk. ` +
      `A cached suite is being executed; this report cannot be trusted. ` +
      `Reload from a host:port this browser has not used before.`;
    warn.style.cssText =
      "color:#0a0b0d;background:#e8b33a;padding:10px 12px;border-radius:6px;font-weight:600";
    root.appendChild(warn);
  }
  root.appendChild(h);
  const ul = document.createElement("ul");
  for (const r of results) {
    const li = document.createElement("li");
    li.textContent = (r.ok ? "✓ " : "✗ ") + r.name + (r.ok ? "" : " — " + r.err.message);
    li.style.color = r.ok ? "#9aa0aa" : "#ef6449";
    ul.appendChild(li);
  }
  root.appendChild(ul);

  return { passed, failed, stale };
}
