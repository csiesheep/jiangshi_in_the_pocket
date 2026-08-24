// What the house remembers. Two counters in localStorage and one line on the
// menu — deliberately the smallest possible version of this.
//
// It is not a scoreboard. A scoreboard invites you to improve it, and this is
// meant to do the opposite: give the cold open one sentence that says you have
// been here before and it did not go well. So the numbers are spelled out in
// words, there is no "best" anything, and the line is a sentence rather than a
// row of figures.
//
// No sync and no server. Clearing site data clears it, and the house forgetting
// you is thematically fine.

// The `jitp:` prefix is not cosmetic. Every game on games.csiesheep.com
// shares one origin and localStorage is origin-scoped, so a key named for
// the sibling is the SAME key — these read and wrote Grave Errand's.
const TAKEN_KEY = "jitp:deaths";
const LEFT_KEY = "jitp:escapes";

function read(key) {
  try {
    const n = parseInt(localStorage.getItem(key) || "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0; // storage blocked: the house has no memory, which is survivable
  }
}

function bump(key) {
  try {
    localStorage.setItem(key, String(read(key) + 1));
  } catch {
    /* nothing to do and nothing lost */
  }
}

// Called once per finished run, from the verdict.
export function recordVerdict(won) {
  bump(won ? LEFT_KEY : TAKEN_KEY);
}

export function tally() {
  return { taken: read(TAKEN_KEY), left: read(LEFT_KEY) };
}

// Words, not digits. "Taken: 4" is a statistic; "four times" is something
// somebody says. Past twelve the digits are honest again — nobody reads
// "seventeen times" as a sentence, and by then the number is the point.
// The house's memory of you, as one sentence.
//
// `t` is theme.tallyLine. Without it this returns "" — the same answer it gives
// a first-time visitor — because a menu that says "left-many" is worse than a
// menu that says nothing, and this line was always optional furniture.
function spell(t, n) {
  const words = t.words || [];
  return words[n] || String(n);
}

function times(t, n) {
  if (n === 1) return t["once"] || "once";
  if (n === 2) return t["twice"] || "twice";
  return fill(t["times"] || "{n} times", { n: spell(t, n) });
}

function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, (whole, k) =>
    values[k] === undefined ? whole : values[k]);
}

// The whole feature, as a string. Empty when the house has never met you —
// a first visit should carry no history, and an empty string is how the caller
// is told to render nothing at all.
export function houseLine(t) {
  if (!t) return "";
  const { taken, left } = tally();
  if (!taken && !left) return "";
  if (!taken) {
    return left === 1
      ? (t["left-once"] || "")
      : fill(t["left-many"] || "", { n: times(t, left) });
  }
  const kept = fill(t["taken"] || "", { n: times(t, taken) });
  if (!left) return kept;
  return `${kept} ${fill(t["walked-out"] || "", { n: times(t, left) })}`;
}
