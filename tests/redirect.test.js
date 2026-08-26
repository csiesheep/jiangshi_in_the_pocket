// #84 — the worker must never answer a navigation with a redirected response.
//
// The live bug, and the first one this project shipped to a real player on a
// real phone: "This site can't be reached" moving between pages on iPhone
// Chrome. Four links, each individually correct:
//
//   1. every page links with the .html suffix (index.html -> game.html)
//   2. production 307s every .html path to its clean URL (game.html -> game)
//   3. so install cached a response carrying `redirected: true` — legally,
//      silently, with no error anywhere
//   4. and the cache-first handler served that to a NAVIGATION, which a service
//      worker may not do. The browser refuses it and shows its own error page.
//
// Why nothing caught it: without a worker installed, navigation goes straight
// to the network and works perfectly. Every check anyone ran was on a fresh
// profile or a local server that does not redirect. It reproduces only against
// production with a worker already controlling the page — which is where it was
// finally reproduced, ending at chrome-error://chromewebdata/.
//
// So this suite asserts the property rather than the symptom: NOTHING THE
// WORKER STORES MAY CARRY `redirected: true`. Enforced at the moment of
// storage, so a poisoned entry cannot exist to be served.

import { test, assert, eq, suite } from "./harness.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "ddbfcc56");

const NO_STORE = { cache: "no-store" };
const sw = await fetch("../sw.js", NO_STORE).then((r) => r.text());

// sw.js is a service worker, not a module — it cannot be imported here. So the
// one function that carries the fix is LIFTED OUT OF THE SHIPPED SOURCE and
// run, rather than grepped for. A test that only checked the text would pass
// against a `storable` that had stopped working.
function lift(name) {
  const start = sw.indexOf("async function " + name + "(");
  assert(start !== -1, "sw.js no longer defines " + name + " — #84's fix is gone");
  const end = sw.indexOf("\nfunction keep(", start);
  assert(end !== -1, "could not find the end of " + name);
  // Back up to the function's own closing brace. The gap before `keep` holds
  // its comment block, and a trailing ")" appended after a line comment lands
  // INSIDE it — which is a syntax error rather than a silent pass, and is how
  // this was caught, but only because the import threw loudly.
  const chunk = sw.slice(start, end);
  const close = chunk.lastIndexOf("}");
  assert(close !== -1, "no closing brace found for " + name);
  return new Function("return (" + chunk.slice(0, close + 1) + ")")();
}
const storable = lift("storable");

// A Response's `redirected` is read-only and only the fetch stack can set it,
// so a genuine one cannot be built here. Duck-typing exercises the real code
// path instead: storable touches exactly redirected, blob, status, statusText
// and headers, and this supplies all five.
function pretend({ redirected, status = 200, body = "<!doctype html><title>x</title>" }) {
  return {
    redirected,
    status,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/html" }),
    blob: async () => new Blob([body], { type: "text/html" }),
  };
}

test("#84: a redirected response is rebuilt before it can be stored", async () => {
  const out = await storable(pretend({ redirected: true }));
  eq(out.redirected, false, "still flagged redirected — a navigation would be refused");
  eq(out.status, 200, "status must survive the rebuild");
  const text = await out.text();
  assert(text.indexOf("doctype") !== -1, "the body must survive the rebuild");
  eq(out.headers.get("content-type"), "text/html", "headers must survive the rebuild");
});

// The other direction, which is what stops the fix from being "return a new
// Response always": an ordinary response must pass through untouched, because
// rebuilding every response would cost a blob round-trip on every asset and
// would quietly drop response types that cannot be reconstructed.
test("#84: an ordinary response is passed through untouched", async () => {
  const original = pretend({ redirected: false });
  const out = await storable(original);
  assert(out === original, "a clean response should not be rebuilt at all");
});

// The property that actually protects players, stated about the code rather
// than about one function: there is exactly one way into the cache, and it is
// the one that rebuilds. cache.add() is the trap — it fetches and stores in a
// single step, so it CANNOT rebuild, and it is what shipped #84.
test("#84: every write to the cache goes through the rebuild", async () => {
  const body = sw.split("\n").filter((l) => l.trim().slice(0, 2) !== "//").join("\n");

  assert(body.indexOf("cache.add(") === -1 && body.indexOf(".addAll(") === -1,
    "cache.add/addAll store whatever the fetch returned and cannot rebuild it — that is #84");

  // Every put must be the one inside keep(). Counted rather than eyeballed: if
  // a second bare put appears, this fails and names the count.
  const puts = body.split(".put(").length - 1;
  eq(puts, 1, "expected exactly one cache.put in sw.js, inside keep(); found " + puts);

  const keepAt = body.indexOf("function keep(");
  const putAt = body.indexOf(".put(");
  assert(keepAt !== -1 && putAt > keepAt, "the only put must live inside keep()");
});

// And the navigation arm, which is why the fix holds even if the cache were
// somehow poisoned by a future change: a navigation asks the network first, and
// a 307 comes back as an opaqueredirect the browser is allowed to follow.
test("#84: navigations are answered from the network first", () => {
  const body = sw.split("\n").filter((l) => l.trim().slice(0, 2) !== "//").join("\n");
  const nav = body.indexOf('req.mode === "navigate"');
  assert(nav !== -1, "sw.js no longer special-cases navigations");

  const arm = body.slice(nav, nav + 700);
  const fetchAt = arm.indexOf("fetch(req)");
  const matchAt = arm.indexOf("caches.match(req)");
  assert(fetchAt !== -1, "the navigation arm must reach the network");
  assert(matchAt === -1 || fetchAt < matchAt,
    "the cache is consulted before the network for a navigation — that is cache-first again");
});
