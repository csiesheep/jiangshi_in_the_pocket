// The WORDS on a tile card, with no DOM anywhere in them (#136).
//
// Every function here is a pure function of (def, world, theme) returning
// strings. That was already true of the versions these were lifted from — they
// were pure, they just lived in js/tiles.js beside the code that writes them
// into elements, so nothing else could reach them.
//
// WHY THEY ARE OUT HERE NOW. tiles.html is pre-rendered ahead of time
// (#134) and the build could only emit the parts that were a direct lookup: the
// intro, the section headings, the twenty names. The per-tile sentences stayed
// behind because reproducing them would have meant a SECOND implementation of
// this logic in the build, and two implementations of the same ten branches
// drift the first time either is touched. Separating them from the DOM is the
// first half of fixing that, and it is worth doing on its own: what a tile card
// SAYS is now testable without building a card.
//
// Nothing about the rules changed in the move. If you are comparing against the
// old js/tiles.js, the branches, their order and their fallbacks are identical.

const SEARCH_KEY = {
  weapon: "search-weapon", magic: "search-magic",
  medicine: "search-medicine", relic: "search-relic",
};

export function fill(line, values) {
  if (!line) return line;
  return String(line).replace(/\{(\w+)\}/g, (whole, k) =>
    values && values[k] !== undefined ? values[k] : whole);
}

// One lookup for this page, same contract as the game's: the key comes back if
// it is missing, so a gap is a thing you can see rather than a blank card.
export function note(theme, key, values) {
  const table = (theme && theme.tileNotes) || {};
  return fill(table[key] || key, values);
}

export function page(theme, key, values) {
  const table = (theme && theme.tilesPage) || {};
  return fill(table[key] || key, values);
}

export function dirWord(theme, dir) {
  return ((theme && theme.ui) || {})[`dir-${dir}`] || dir;
}

// A tile's display name.
export function tileName(theme, id) {
  return (theme && theme.tiles && theme.tiles[id]) || id;
}

// The sentence beside the plan. The drawing and the words say the same thing on
// purpose: the drawing is faster to compare across twenty cards, the words
// survive being read aloud.
export function doorsSentence(def, theme) {
  const named = (def.exits || []).map((d) => dirWord(theme, d));
  return (named.length === 4
    ? note(theme, "doors-all")
    : note(theme, "doors-some", { dirs: named.join(note(theme, "doors-join")) })) +
    (def.seam ? note(theme, "doors-seam", { dir: dirWord(theme, def.seam) }) : "") +
    note(theme, "doors-end");
}

// [label, className, isCjk] per chip.
export function chipsFor(def, theme) {
  const chips = [];
  const w = (k) => page(theme, k);
  if (def.search) {
    chips.push([w("chip-" + def.search), `tilechip--${def.search}`, true]);
  }
  if (def.onTurnEnd === "HEAL_1") chips.push([w("chip-heal"), "", false]);
  if ((def.flags || []).includes("WARDED")) chips.push([w("chip-no-events"), "", false]);
  if (def.action) chips.push([w("chip-once"), "", false]);
  if (def.goal) chips.push([w("chip-goal"), "tilechip--goal", false]);
  if (def.start) chips.push([w("chip-start"), "", false]);
  if (def.exteriorDoor) chips.push([w("chip-moon-gate"), "", false]);
  if (def.seam) chips.push([w("chip-seam"), "", false]);
  if (!chips.length) chips.push([w("chip-transit"), "", false]);
  return chips;
}

export function noteFor(def, world, theme) {
  const notes = [];
  // The word for the 神主牌, taken from the theme so this page and the board
  // cannot end up calling it two different things.
  const tablet = (theme && theme.actions && theme.actions.tablet) || "tablet";

  // Both decks have a `start` tile, but they mean different things: one is
  // where the night begins, the other is what goes down the moment you step
  // outside. Two cards reading "Where you begin" would just be confusing.
  if (def.start) {
    notes.push(note(theme, world === "indoor" ? "start-indoor" : "start-outdoor"));
  }
  if (def.search) {
    // No "best of its kind" line: every room sharing a category rolls the
    // identical table, so saying otherwise would teach a rule the game lacks.
    notes.push(SEARCH_KEY[def.search]
      ? note(theme, SEARCH_KEY[def.search])
      : note(theme, "search-other", { what: def.search }));
  }
  if (def.exteriorDoor) {
    notes.push(note(theme, "moon-gate", { dir: dirWord(theme, def.exteriorDoor) }));
  }
  if (def.seam) notes.push(note(theme, "seam"));
  for (const f of def.flags || []) {
    // RUNNING_WATER went with #56 and no tile carries it any more; the branch
    // is gone rather than left describing a flag nothing can have.
    notes.push(f === "WARDED" ? note(theme, "warded") : note(theme, "unknown", { what: f }));
  }
  // No tile carries an `action` since the post-launch redesign took the
  // prayer and the coil, but the branch stays: the field is still read, and a
  // tile that grows one should say so rather than say nothing.
  if (def.action) notes.push(note(theme, "unknown", { what: def.action }));
  if (def.goal) {
    const key = def.goal === "TAKE_TABLET" ? "take-tablet"
      : def.goal === "BURY_TABLET" ? "bury-tablet" : null;
    notes.push(key ? note(theme, key, { tablet }) : note(theme, "unknown", { what: def.goal }));
  }
  if (def.onTurnEnd) {
    notes.push(def.onTurnEnd === "HEAL_1"
      ? note(theme, "heal-1")
      : note(theme, "unknown", { what: def.onTurnEnd }));
  }
  return notes;
}

// Everything a card says about one tile, in one call. This is the shape a
// renderer of any kind wants — the page builds elements out of it, and anything
// pre-rendering the page needs exactly these strings and nothing else.
export function tileWords(def, world, theme) {
  return {
    id: def.id,
    name: tileName(theme, def.id),
    doors: doorsSentence(def, theme),
    chips: chipsFor(def, theme).map(([label]) => label),
    notes: noteFor(def, world, theme),
  };
}
