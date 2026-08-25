import { test, assert, eq } from "./harness.js";

const NO_STORE = { cache: "no-store" };

// ---- The SHELL digest guard ---------------------------------------------------
// sw.js has said "bump CACHE when anything in SHELL changes" at the top of the
// file since it was written, and #28 shipped three SHELL files without a bump
// anyway. The rule was not unclear — it was unreachable. The coupling runs from
// the file you are editing to a file you have no reason to open, so a rule that
// only appears once you are already thinking about caching protects nothing.
//
// So the reminder becomes a failure. Every SHELL file is hashed and the result
// recorded in sw.js next to CACHE; changing any of them turns this red until
// sw.js is edited, and sw.js is exactly where the bump lives.
//
// WHY THIS PARTICULAR BUG BITES, which is worth stating because it is not
// obvious from either file alone:
//
//   - The SHELL is served CACHE FIRST, refilled in the background. A returning
//     player with the worker installed runs the OLD code on the launch after a
//     deploy; the new code lands for the launch after that.
//   - data/ and assets/audio/ are served NETWORK FIRST (the RUNTIME regex),
//     cache only as a fallback, because app.js asks for them with `no-cache`
//     and the worker honours that.
//
// Those two together are the whole hazard. Ship a tiles.json change beside an
// engine.js change without bumping, and a returning player gets the NEW tile
// data — it came over the network — against the OLD engine, out of cache. That
// is exactly what #28 did. Data files are deliberately not covered by this
// digest: being network first, they reach players on their own and need no
// bump. It is the code that goes stale, so it is the code that is fingerprinted.
const sw = await fetch("../sw.js", NO_STORE).then((r) => r.text());

const CACHE = (sw.match(/const CACHE\s*=\s*"([^"]+)"/) || [])[1];
const SHELL = parseShell(sw);
const RECORDED = parseDigest(sw);

// Both of these read the source as text rather than importing it: sw.js is a
// service worker, not a module, and seo.test.js already reads src/index.js the
// same way to find SHIPPED.
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

// Ten hex characters of SHA-256. Bytes rather than text, because the shell
// carries a font and four PNGs.
async function fingerprint(path) {
  const buf = await fetch(`../${path === "./" ? "" : path}`, NO_STORE).then((r) => r.arrayBuffer());
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}

// The whole comparison, as a pure function of two maps, so the guard can be
// tested against fabricated input as well as against the real shell. A guard
// that has only ever been seen passing is not known to fail.
export function compare(recorded, actual, cacheName) {
  if (!recorded) return { ok: false, missing: true, changed: [], added: [], removed: [] };
  const changed = [];
  const added = [];
  const removed = [];
  for (const [path, hash] of Object.entries(actual)) {
    if (!(path in recorded)) added.push(path);
    else if (recorded[path] !== hash) changed.push(path);
  }
  for (const path of Object.keys(recorded)) {
    if (path !== "@cache" && !(path in actual)) removed.push(path);
  }
  // The version is bound INTO the fingerprint, and that is what makes the bump
  // compulsory rather than merely suggested. Paste the new hashes without
  // touching CACHE and this line is still red.
  const cacheMismatch = recorded["@cache"] !== cacheName;
  // Recording the block for the first time is not the same event as changing a
  // shell file, and it must not advise a bump: nothing has gone stale, so a new
  // version would evict every installed player's cache for nothing.
  const bootstrap = Object.keys(recorded).filter((k) => k !== "@cache").length === 0;
  return { ok: !changed.length && !added.length && !removed.length && !cacheMismatch,
           changed, added, removed, cacheMismatch, bootstrap,
           recordedCache: recorded["@cache"] };
}

// "jiangshi-v23" -> "jiangshi-v24". The suggestion has to be a real next value
// or the copy-paste block is a riddle rather than a fix.
export function nextCacheName(name) {
  return String(name).replace(/(\d+)$/, (n) => String(Number(n) + 1));
}

// The failure message is the whole point of the exercise: it names what moved,
// says what to do about it, and prints the exact block to paste. A guard that
// only says "digest mismatch" has moved the problem rather than solved it.
function fixText(result, actual, cacheName) {
  // A first recording keeps the version it is describing; a real change earns
  // the next one.
  const first = result.missing || result.bootstrap;
  const next = first ? cacheName : nextCacheName(cacheName);
  const lines = [];
  if (result.missing) lines.push("sw.js has no SHELL_DIGEST block.");
  else if (result.bootstrap) lines.push("SHELL_DIGEST is empty — recording the shell for the first time.");
  if (result.changed.length) lines.push(`changed: ${result.changed.join(", ")}`);
  if (result.added.length) lines.push(`added to SHELL: ${result.added.join(", ")}`);
  if (result.removed.length) lines.push(`removed from SHELL: ${result.removed.join(", ")}`);
  if (result.cacheMismatch && !result.missing) {
    lines.push(`CACHE is "${cacheName}" but the digest was recorded under "${result.recordedCache}".`);
  }
  lines.push("");
  lines.push(first
    ? `In sw.js, leave CACHE at "${cacheName}" — nothing has gone stale — and record:`
    : `In sw.js: set CACHE to "${next}", then replace SHELL_DIGEST with:`);
  lines.push("");
  lines.push(block(actual, next));
  if (!first) {
    lines.push("");
    lines.push("(The version is part of the fingerprint, so pasting this without");
    lines.push(" bumping CACHE stays red. Choosing a different name is fine —");
    lines.push(" bump it, re-run, and paste the block this prints then.)");
  }
  return lines.join("\n");
}

function block(actual, cacheName) {
  const width = Math.max(...Object.keys(actual).map((k) => k.length)) + 2;
  const rows = [`  ${'"@cache":'.padEnd(width + 1)} "${cacheName}",`];
  for (const [path, hash] of Object.entries(actual)) {
    rows.push(`  ${`"${path}":`.padEnd(width + 1)} "${hash}",`);
  }
  return ["const SHELL_DIGEST = {", ...rows, "};"].join("\n");
}

async function fingerprintShell() {
  const actual = {};
  for (const path of SHELL) actual[path] = await fingerprint(path);
  return actual;
}

test("shell: every file in SHELL is the one the cache version was cut for", async () => {
  assert(CACHE, "sw.js should declare a CACHE name");
  assert(SHELL.length > 10, `SHELL should list the whole shell, got ${SHELL.length}`);
  const actual = await fingerprintShell();
  const result = compare(RECORDED, actual, CACHE);
  assert(result.ok, `the shell has moved since ${CACHE} was cut.\n\n${fixText(result, actual, CACHE)}\n`);
});

// ---- The guard on the guard ---------------------------------------------------
// Both directions, as with the staleness guard: it has to go red for the thing
// it exists to catch, and green once that thing is put right.
test("shell: a first recording is told to keep the version, not bump it", () => {
  // Bumping on the bootstrap would evict every installed player's cache to
  // describe a shell that had not moved.
  const r = compare({ "@cache": "jiangshi-v9" }, { "js/engine.js": "aaaaaaaaaa" }, "jiangshi-v9");
  eq(r.bootstrap, true);
  const text = fixText(r, { "js/engine.js": "aaaaaaaaaa" }, "jiangshi-v9");
  assert(text.includes('leave CACHE at "jiangshi-v9"'), `a bootstrap must not advise a bump:\n${text}`);
  assert(!text.includes("jiangshi-v10"), "and must not name a next version at all");
});

test("shell: a changed file is caught, and named", () => {
  const recorded = { "@cache": "jiangshi-v9", "js/engine.js": "aaaaaaaaaa", "css/style.css": "bbbbbbbbbb" };
  const actual = { "js/engine.js": "cccccccccc", "css/style.css": "bbbbbbbbbb" };
  const r = compare(recorded, actual, "jiangshi-v9");
  eq(r.ok, false, "an edited shell file must not pass");
  eq(r.changed, ["js/engine.js"], "and the message has to say which one");
  assert(fixText(r, actual, "jiangshi-v9").includes("js/engine.js"),
    "the fix text names the file that moved");
});

test("shell: updating the hashes without bumping CACHE is still red", () => {
  // The failure mode the digest exists to prevent, one level up: a developer
  // who pastes the new fingerprints and leaves the version alone has recorded
  // the change without shipping it to anyone holding the old cache.
  const actual = { "js/engine.js": "cccccccccc" };
  const pastedButNotBumped = { "@cache": "jiangshi-v10", "js/engine.js": "cccccccccc" };
  const r = compare(pastedButNotBumped, actual, "jiangshi-v9");
  eq(r.changed, [], "the hashes themselves are right");
  eq(r.cacheMismatch, true, "but the version they were recorded under is not the one shipping");
  eq(r.ok, false);
});

test("shell: bumped and updated together goes green", () => {
  const actual = { "js/engine.js": "cccccccccc" };
  const r = compare({ "@cache": "jiangshi-v10", "js/engine.js": "cccccccccc" }, actual, "jiangshi-v10");
  eq(r.ok, true, "the only way through is to do both");
});

test("shell: a file added to or dropped from SHELL is caught too", () => {
  const base = { "@cache": "jiangshi-v9", "js/engine.js": "aaaaaaaaaa" };
  const added = compare(base, { "js/engine.js": "aaaaaaaaaa", "js/new.js": "dddddddddd" }, "jiangshi-v9");
  eq(added.added, ["js/new.js"]);
  eq(added.ok, false);
  const gone = compare({ ...base, "js/old.js": "eeeeeeeeee" }, { "js/engine.js": "aaaaaaaaaa" }, "jiangshi-v9");
  eq(gone.removed, ["js/old.js"]);
  eq(gone.ok, false);
});

test("shell: the suggested next version is a real one", () => {
  eq(nextCacheName("jiangshi-v23"), "jiangshi-v24");
  eq(nextCacheName("jiangshi-v9"), "jiangshi-v10");
  // A name with no trailing number is left alone rather than mangled; the
  // message still tells you to bump, it just cannot guess to what.
  eq(nextCacheName("jiangshi"), "jiangshi");
});
