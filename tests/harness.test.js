import { test, assert, eq, HARNESS_ID, harnessIdFrom, stampFor } from "./harness.js";

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
