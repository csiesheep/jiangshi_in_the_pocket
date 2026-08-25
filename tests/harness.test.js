import { test, assert, eq, HARNESS_ID, harnessIdFrom, stampFor, suite,
         staleSuites, registeredSuites } from "./harness.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "cdcf8495");

const NO_STORE = { cache: "no-store" };

// ---- The guard on the guard's guard ------------------------------------------
// harness.js carries the staleness check for every suite, which means it cannot
// use that check on itself: a cached harness runs a cached guard and reports a
// confident green under the old rules. It has happened twice — once hiding the
// async fix, once printing GREEN against a five-file-stale digest.
//
// So the harness compares its own id against the file on disk. These tests cover
// the comparison in both directions without a network, and then check the real
// thing: that the harness this page is running IS the one the server has.

test("harness: it knows its own id, and can read one out of a file", () => {
  assert(HARNESS_ID, "the running harness declares an id");
  eq(harnessIdFrom('export const HARNESS_ID = "abc123";'), "abc123");
  eq(harnessIdFrom('const HARNESS_ID = "abc123";'), null, "only the exported form counts");
  // An older harness than this check declares nothing, and that must read as
  // "no opinion" rather than as a failure — inventing one would be worse than
  // staying quiet.
  eq(harnessIdFrom("// a harness from before any of this"), null);
});

test("harness: a disagreement is what a stale run looks like", () => {
  // The comparison report() makes, in both directions.
  const running = "aaaa";
  eq(harnessIdFrom('export const HARNESS_ID = "aaaa";') === running, true, "same file, same id");
  eq(harnessIdFrom('export const HARNESS_ID = "bbbb";') === running, false, "a newer file on disk");
});

// #42. Comparing the running id against the disk id catches a stale module, but
// it cannot catch a stamp that stopped being maintained: edit harness.js and
// forget to restamp, and both copies carry the same stale value, agree, pass,
// and guard nothing. So the id is checked against the FILE's content, not
// against a second copy of itself.
test("harness: the stamp is a hash of the harness, and is checked against it", async () => {
  const src = await fetch("./harness.js", NO_STORE).then((r) => r.text());
  const want = await stampFor(src);
  eq(HARNESS_ID, want,
    `harness.js has changed since it was stamped ("${HARNESS_ID}" vs "${want}"). ` +
    `Run python tools/record_shell.py — until then the staleness check compares ` +
    `two copies of the same stale id and protects nothing. ` +
    `(If this checkout has CRLF line endings the hash will differ for that reason instead.)`);
});

test("harness: the stamp moves when the file does, and ignores the stamp line", async () => {
  const body = 'export const HARNESS_ID = "%ID%";\nfunction a() { return 1; }\n';
  const withA = body.replace("%ID%", "aaaaaaaa");
  const withB = body.replace("%ID%", "bbbbbbbb");
  // The id in the file must not affect the answer, or the hash would chase its
  // own tail and every restamp would produce a different value again.
  eq(await stampFor(withA), await stampFor(withB), "the stamp line itself is blanked before hashing");

  // Any other edit must change it, or an edited harness could keep a stamp that
  // no longer describes it.
  const edited = withA.replace("return 1", "return 2");
  assert(await stampFor(withA) !== await stampFor(edited), "a real edit moves the stamp");

  // An unstamped harness is a real failure here, unlike in the disk comparison
  // where a missing marker correctly reads as "no opinion": there an old harness
  // cannot be blamed for a check it predates, whereas here it means the guard is
  // inert, which is the whole defect.
  const unstamped = 'export const HARNESS_ID = "unstamped";\nfunction a() { return 1; }\n';
  assert(await stampFor(unstamped) !== "unstamped", "'unstamped' is not a hash of anything");
});

test("harness: the one running here is the one on disk", async () => {
  // The check itself, for real. If this fails, every other line in this report
  // was produced by a harness the server has since replaced — and the count is
  // not to be trusted, which is why report() refuses to print one.
  const src = await fetch("./harness.js", NO_STORE).then((r) => r.text());
  const disk = harnessIdFrom(src);
  assert(disk !== null, "harness.js on disk should declare an id");
  eq(disk, HARNESS_ID,
    `running "${HARNESS_ID}" against a disk copy of "${disk}" — reload from an unused host:port`);
});

// ---- The third blind spot (#63) ----------------------------------------------
// The declared-count guard catches a suite that did not run. It cannot catch a
// suite that ran the WRONG COPY when the counts match — a stale data.test.js
// once reported "game.html has no #copy-replay", a string that exists nowhere
// in the tree, and the totals agreed so nothing complained.
//
// Every suite now says which copy of itself is speaking, and report() compares
// that against the file on disk. These exercise the comparison directly; the
// live case is the first test in this file's neighbour, and the failing
// direction was demonstrated by serving a stale suite on purpose.
test("suites: a stale copy is caught even when the count matches", () => {
  const ran = { "data.test.js": "aaaaaaaa", "engine.test.js": "bbbbbbbb" };
  const disk = { "data.test.js": "cccccccc", "engine.test.js": "bbbbbbbb" };
  const bad = staleSuites(ran, disk);
  eq(bad.length, 1, "one suite disagrees");
  assert(/data\.test\.js/.test(bad[0]), `and it names itself: ${bad[0]}`);
  assert(/aaaaaaaa/.test(bad[0]) && /cccccccc/.test(bad[0]),
    "with both stamps, so the reader can tell which way round it is");
});

test("suites: a suite that never registered is stale, not absent", () => {
  // The exact shape of the bug: the module in memory predates the stamp, so it
  // registers nothing while the file on disk carries one.
  const bad = staleSuites({}, { "data.test.js": "cccccccc" });
  eq(bad.length, 1);
  assert(/older than the stamp/.test(bad[0]), bad[0]);
});

test("suites: an unstamped file is no opinion, not an accusation", () => {
  // A suite predating this guard cannot be blamed for a check it does not know
  // about — inventing a failure there would be worse than staying quiet.
  eq(staleSuites({}, { "old.test.js": null }), []);
  eq(staleSuites({ "old.test.js": "aaaaaaaa" }, { "old.test.js": undefined }), []);
});

test("suites: agreement is silence", () => {
  const same = { "a.test.js": "11111111", "b.test.js": "22222222" };
  eq(staleSuites(same, same), []);
});

test("suites: every suite running here is the one on disk", async () => {
  // The check itself, for real. If this fails, some suite above ran a copy the
  // server has since replaced, and its results describe a file that is no
  // longer there — which is exactly how a failure once named an element that
  // exists nowhere in the tree.
  const ran = registeredSuites();
  const names = Object.keys(ran);
  assert(names.length >= 8, `every suite should register a stamp, saw ${names.length}`);

  const onDisk = {};
  for (const name of names) {
    const src = await fetch(`./${name}`, NO_STORE).then((r) => r.text());
    const m = src.match(/^suite\(import\.meta\.url, "([^"]*)"\);$/m);
    onDisk[name] = m ? m[1] : null;
  }
  eq(staleSuites(ran, onDisk), [], "a suite here is older than the file being served");
});
