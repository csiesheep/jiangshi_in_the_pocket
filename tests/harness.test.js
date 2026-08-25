import { test, assert, eq, HARNESS_ID, harnessIdFrom } from "./harness.js";

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
