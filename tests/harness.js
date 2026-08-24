// Tiny zero-dependency test harness. Runs in the browser (no Node on this
// machine). Reports to the DOM and the console; sets a machine-readable
// summary line ("TESTS: X passed, Y failed") and document.title so results
// can be read back headlessly.

const results = [];

export function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
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
        out[name] = (text.match(/^test\(/gm) || []).length;
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
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  const summary = `TESTS: ${passed} passed, ${failed} failed`;
  console.log(summary);

  // Did every test that exists on disk actually run?
  let stale = null;
  if (suites.length) {
    const declared = await declaredCounts(suites);
    const known = Object.values(declared).filter((n) => n !== null);
    if (known.length === suites.length) {
      const expected = known.reduce((n, c) => n + c, 0);
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
    if (r.ok) console.log(`  ok  ${r.name}`);
    else console.error(`FAIL  ${r.name}\n      ${r.err.message}`);
  }

  document.title = stale
    ? `STALE (${results.length}/${stale.expected})`
    : failed === 0
      ? `PASS (${passed})`
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
    warn.textContent =
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
