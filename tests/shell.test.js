import { test, assert, eq } from "./harness.js";
import { shouldReloadOnHandover, HANDOVER_GRACE_MS } from "../js/shell.js";

const NO_STORE = { cache: "no-store" };

// ---- The SHELL digest guard ---------------------------------------------------
// sw.js has said "bump CACHE when anything in SHELL changes" at the top of the
// file since it was written, and #28 shipped three SHELL files without a bump
// anyway. The rule was not unclear — it was unreachable: the coupling runs from
// the file you are editing to a file you have no reason to open.
//
// So the reminder became a failure. Then the failure turned out to have two
// holes of its own, and #40 closed both:
//
//   1. A NUMBER A HUMAN PICKS CAN COLLIDE. Two branches independently chose
//      v24 for different shells, then independently chose v26. Both sides
//      followed the rule, both were internally consistent, and both were green
//      — the guard was defeated by being satisfied. So CACHE is no longer
//      chosen. It is derived from the shell, by tools/record_shell.py, and this
//      file recomputes the derivation to prove nobody typed it by hand.
//
//   2. A FINGERPRINT OF THE WORKING TREE DESCRIBES THE WRONG BYTES. It was
//      hashing a CRLF checkout while git stores, and Cloudflare serves, LF, so
//      two entries described files that existed in one worktree and nowhere
//      else. The record is taken from blobs now.
//
// WHAT THIS GUARANTEES, stated as exactly what it is. The record is canonical
// (blob-sourced, identical on every machine); this side can only hash what the
// local server serves. So the check is CHECKOUT AGAINST CANONICAL RECORD — not
// the record against itself. That is a real and useful guarantee, and it is the
// one that would have caught the CRLF drift days earlier, but it is not the
// stronger one and should not be read as if it were.
//
// The derivation half needs no network and no git: it is arithmetic over the
// recorded block, so a hand-edited CACHE fails here even on a stale checkout.
//
// WHY ONLY SHELL. data/ and assets/audio/ are served network first (the RUNTIME
// regex in sw.js), so they reach players without a new cache name. It is the
// cache-first shell that goes stale, and a new tiles.json against an old
// engine.js is exactly the mismatch #28 shipped.
const sw = await fetch("../sw.js", NO_STORE).then((r) => r.text());

const CACHE = (sw.match(/const CACHE\s*=\s*"([^"]+)"/) || [])[1];
const SHELL = parseShell(sw);
const RECORDED = parseDigest(sw);
const PREFIX = "jiangshi-";

// Both read the source as text rather than importing it: sw.js is a service
// worker, not a module, and seo.test.js already reads src/index.js this way.
function parseShell(src) {
  const body = src.slice(src.indexOf("const SHELL = ["), src.indexOf("];", src.indexOf("const SHELL = [")));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function parseDigest(src) {
  const at = src.indexOf("const SHELL_DIGEST = {");
  if (at < 0) return null;
  const body = src.slice(at, src.indexOf("};", at));
  const out = {};
  for (const m of body.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

async function sha(bytes, n = 10) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}

const bytesOf = (path) =>
  fetch(`../${path === "./" ? "" : path}`, NO_STORE).then((r) => r.arrayBuffer());

// The name, as a function of the shell and nothing else. This reimplements
// record_shell.py's derive_name exactly; if one changes, both change.
export async function deriveName(recorded, order) {
  const joined = order.map((p) => `${p}:${recorded[p]}\n`).join("");
  return PREFIX + (await sha(new TextEncoder().encode(joined), 8));
}

// A pure function of two maps, so the guard can be tested against fabricated
// input as well as against the real shell. A guard only ever seen passing is
// not known to fail.
export function compare(recorded, actual) {
  if (!recorded) return { ok: false, missing: true, changed: [], added: [], removed: [] };
  const changed = [];
  const added = [];
  const removed = [];
  for (const [path, hash] of Object.entries(actual)) {
    if (!(path in recorded)) added.push(path);
    else if (recorded[path] !== hash) changed.push(path);
  }
  for (const path of Object.keys(recorded)) if (!(path in actual)) removed.push(path);
  return { ok: !changed.length && !added.length && !removed.length, changed, added, removed };
}

// FE's idea, with a correction. Detecting CRLF is redundant — a CRLF file
// already fails the digest — but the MESSAGE is the point: #30's own principle
// was that a guard which only says "digest mismatch" has moved the problem
// rather than solved it.
//
// The correction is that "your checkout is CRLF" can be wrong in the other
// direction. If someone records an entry from a CRLF tree, a correct LF
// checkout is the one that fails, and telling that person to fix their checkout
// would send them the wrong way. So this answers WHICH SIDE is wrong.
export async function diagnoseLineEndings(recorded, path, buf) {
  const text = new TextDecoder().decode(buf);
  const enc = new TextEncoder();
  const asLf = await sha(enc.encode(text.replace(/\r\n/g, "\n")));
  const asCrlf = await sha(enc.encode(text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n")));
  if (recorded[path] === asLf) return "this checkout has CRLF line endings; the record is right";
  if (recorded[path] === asCrlf) return "the record was taken from a CRLF checkout; this checkout is right";
  return null;
}

async function fingerprintShell() {
  const actual = {};
  for (const path of SHELL) actual[path] = await sha(await bytesOf(path));
  return actual;
}

test("shell: every file in SHELL is the one the recorded digest describes", async () => {
  assert(CACHE, "sw.js should declare a CACHE name");
  assert(SHELL.length > 10, `SHELL should list the whole shell, got ${SHELL.length}`);
  const actual = await fingerprintShell();
  const result = compare(RECORDED, actual);

  if (!result.ok) {
    const lines = [`the shell has moved since ${CACHE} was recorded.`];
    if (result.changed.length) lines.push(`changed: ${result.changed.join(", ")}`);
    if (result.added.length) lines.push(`added to SHELL: ${result.added.join(", ")}`);
    if (result.removed.length) lines.push(`removed from SHELL: ${result.removed.join(", ")}`);
    for (const path of result.changed) {
      const why = await diagnoseLineEndings(RECORDED, path, await bytesOf(path));
      if (why) lines.push(`  ${path} — ${why}`);
    }
    lines.push("");
    lines.push("Commit the shell change, then: python tools/record_shell.py");
    lines.push("It rewrites CACHE and the digest from the committed blobs; commit sw.js with it.");
    assert(false, lines.join("\n"));
  }
});

// The half that needs no network: a name nobody chose cannot be typed by hand.
test("shell: CACHE is derived from the digest, not picked", async () => {
  assert(RECORDED, "sw.js should carry a SHELL_DIGEST block");
  const want = await deriveName(RECORDED, SHELL);
  eq(CACHE, want,
    `CACHE says "${CACHE}" but the recorded shell derives "${want}" — ` +
    `run python tools/record_shell.py rather than editing the name.`);
});

test("shell: the digest records exactly the files SHELL lists", () => {
  eq(Object.keys(RECORDED).sort(), [...SHELL].sort(),
    "a file in one and not the other means the block was hand-edited");
  assert(!("@cache" in RECORDED),
    "the @cache entry is retired — the derived name carries its own consistency now");
});

// ---- The guard on the guard ---------------------------------------------------
test("shell: a changed file is caught, and named", () => {
  const recorded = { "js/engine.js": "aaaaaaaaaa", "css/style.css": "bbbbbbbbbb" };
  const actual = { "js/engine.js": "cccccccccc", "css/style.css": "bbbbbbbbbb" };
  const r = compare(recorded, actual);
  eq(r.ok, false, "an edited shell file must not pass");
  eq(r.changed, ["js/engine.js"], "and the message has to say which one");
});

test("shell: a file added to or dropped from SHELL is caught too", () => {
  const base = { "js/engine.js": "aaaaaaaaaa" };
  const added = compare(base, { "js/engine.js": "aaaaaaaaaa", "js/new.js": "dddddddddd" });
  eq(added.added, ["js/new.js"]);
  eq(added.ok, false);
  const gone = compare({ ...base, "js/old.js": "eeeeeeeeee" }, { "js/engine.js": "aaaaaaaaaa" });
  eq(gone.removed, ["js/old.js"]);
  eq(gone.ok, false);
});

test("shell: two different shells cannot derive the same name", async () => {
  // The failure that a counter could not catch: two branches, both correct,
  // both internally consistent, both green, same version, different contents.
  const a = await deriveName({ "js/a.js": "1111111111" }, ["js/a.js"]);
  const b = await deriveName({ "js/a.js": "2222222222" }, ["js/a.js"]);
  assert(a !== b, "a name derived from content cannot collide by accident");
  assert(a.startsWith(PREFIX) && a.length > PREFIX.length, `and it is still a cache name: ${a}`);
  // Order is part of it, so a reshuffled SHELL is a different shell.
  const one = await deriveName({ x: "aaaaaaaaaa", y: "bbbbbbbbbb" }, ["x", "y"]);
  const two = await deriveName({ x: "aaaaaaaaaa", y: "bbbbbbbbbb" }, ["y", "x"]);
  assert(one !== two, "and the order the worker installs them in counts");
});

test("shell: line-ending drift is diagnosed, and says which side is wrong", async () => {
  const enc = new TextEncoder();
  const lfBytes = enc.encode("one\ntwo\n");
  const crlfBytes = enc.encode("one\r\ntwo\r\n");
  const lfHash = await sha(lfBytes);
  const crlfHash = await sha(crlfBytes);

  // Served CRLF, recorded LF: the checkout is the broken side.
  const a = await diagnoseLineEndings({ "f.js": lfHash }, "f.js", crlfBytes);
  assert(/this checkout has CRLF/.test(a), `expected a checkout diagnosis, got ${a}`);

  // Served LF, recorded CRLF: the RECORD is the broken side, and telling this
  // person to fix their checkout would send them the wrong way.
  const b = await diagnoseLineEndings({ "f.js": crlfHash }, "f.js", lfBytes);
  assert(/record was taken from a CRLF checkout/.test(b), `expected a record diagnosis, got ${b}`);

  // A genuine content change is not a line-ending problem and must not be
  // dressed up as one.
  const c = await diagnoseLineEndings({ "f.js": "9999999999" }, "f.js", lfBytes);
  eq(c, null, "an ordinary edit gets no line-ending excuse");
});

// ---- The handover (#51) -------------------------------------------------------
// The first visit after a deploy showed the PREVIOUS build, which is how "I
// cannot see the animations" reached us: the shell is cache-first, so the page
// that triggers the update was itself served from the old cache. These read the
// sources as text — the same way seo.test.js reads the Worker — because a
// service-worker handover cannot be exercised headlessly, and an untested claim
// about it would be worse than an honest source assertion.
const shellSrc = await fetch("../js/shell.js", NO_STORE).then((r) => r.text());

test("handover: the worker takes over at once rather than waiting for a spare tab", () => {
  assert(/self\.skipWaiting\(\)/.test(sw), "install should not leave the new worker waiting");
  assert(/self\.clients\.claim\(\)/.test(sw), "activate should claim the pages already open");
});

test("handover: the page is wired to notice a new worker arriving", () => {
  assert(/addEventListener\("controllerchange"/.test(shellSrc),
    "somebody has to notice the new worker arriving");
  assert(/location\.reload\(\)/.test(shellSrc), "and act on it");
});

// The decision itself, exercised rather than asserted to exist. Source-level
// checks can only say a guard is present; these say it is right.
test("handover: it reloads on a fresh load, when a controller has arrived", () => {
  eq(shouldReloadOnHandover({ hasController: true, openedAt: 1000, now: 1200, reloading: false, playing: false }), true);
  // The boundary itself counts as fresh.
  eq(shouldReloadOnHandover({
    hasController: true, openedAt: 0, now: HANDOVER_GRACE_MS, reloading: false,
  }), true, "exactly at the grace is still the opening moments");
});

// The sentence the DoD actually makes: no reload ever interrupts a run in
// progress. The clock is the outer bound for an untouched page; this is the
// question itself, and it is asked directly because the two are only the same
// thing if nobody can take a turn inside ten seconds — and they can.
test("handover: it NEVER reloads a run in progress, however fresh the page", () => {
  eq(shouldReloadOnHandover({
    hasController: true, openedAt: 0, now: 1, reloading: false, playing: true,
  }), false, "one second in, but a turn has been spent — those turns are not saved");
  eq(shouldReloadOnHandover({
    hasController: true, openedAt: 0, now: 9000, reloading: false, playing: true,
  }), false, "second nine, which the clock alone would have allowed");
  // And the same instant without a run is still fine to reload.
  eq(shouldReloadOnHandover({
    hasController: true, openedAt: 0, now: 9000, reloading: false, playing: false,
  }), true, "nobody has touched anything, so nothing is lost");
});

test("handover: it NEVER reloads a page somebody has been sitting on", () => {
  // The constraint that matters: a deploy landing mid-run must not pull the
  // floor out from under a player on turn twenty-two. They get the new build
  // the next time they open it.
  eq(shouldReloadOnHandover({
    hasController: true, openedAt: 0, now: HANDOVER_GRACE_MS + 1, reloading: false,
  }), false, "one millisecond past the grace is already somebody's game");
  eq(shouldReloadOnHandover({
    hasController: true, openedAt: 0, now: 30 * 60 * 1000, reloading: false,
  }), false, "half an hour in, certainly");
});

test("handover: it cannot loop, however many deploys land", () => {
  eq(shouldReloadOnHandover({ hasController: true, openedAt: 0, now: 1, reloading: true }), false,
    "a reload already under way is not a reason for another");
  // And a worker LEAVING is not an arrival: controllerchange fires for both.
  eq(shouldReloadOnHandover({ hasController: false, openedAt: 0, now: 1, reloading: false }), false,
    "no controller means nothing has taken over yet");
});
