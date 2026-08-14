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

export function report() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  const summary = `TESTS: ${passed} passed, ${failed} failed`;
  console.log(summary);
  for (const r of results) {
    if (r.ok) console.log(`  ok  ${r.name}`);
    else console.error(`FAIL  ${r.name}\n      ${r.err.message}`);
  }

  document.title = failed === 0 ? `PASS (${passed})` : `FAIL (${failed})`;

  const root = document.getElementById("out") || document.body;
  const h = document.createElement("h1");
  h.textContent = summary;
  h.style.color = failed === 0 ? "#7fb539" : "#e0523f";
  root.appendChild(h);
  const ul = document.createElement("ul");
  for (const r of results) {
    const li = document.createElement("li");
    li.textContent = (r.ok ? "✓ " : "✗ ") + r.name + (r.ok ? "" : " — " + r.err.message);
    li.style.color = r.ok ? "#9aa0aa" : "#e0523f";
    ul.appendChild(li);
  }
  root.appendChild(ul);

  return { passed, failed };
}
