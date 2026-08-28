// Can a player actually win the game?
//
// #70. 鎮屍 was unwinnable by a human for as long as the bar sat above 11, and
// nothing noticed. Not for want of information: tests/data.test.js already
// asserted "no button in js/ calls buffSword", and js/render.js already carried
// a paragraph explaining the capability was unreachable. Both were correct.
// Both concluded "so do not advertise it". Neither asked "so what is the
// ceiling, and is it above the bar?"
//
// THE INFORMATION WAS NEVER MISSING. THE INFERENCE WAS. So this suite asserts
// the OUTCOME rather than the premise — a guard that says "nothing calls X" can
// be true while the game is unwinnable, and a guard that computes the best kit
// a player can carry and compares it to the bar cannot be satisfied vacuously.
//
// Two rules this file follows, both learned the hard way here:
//
// 1. ASSEMBLE, DO NOT ARITHMETIC. attackWith() is a preview: it honours
//    `banner: true` and a talisman id WITHOUT checking either is held, because
//    the UI calls it four times while the player is still deciding. §13's
//    ceiling test passes it unheld loadouts, so it would report the same
//    ceiling if the pack held one slot. Everything here picks the kit up first
//    and checks the pickup succeeded, so the pack size is load-bearing.
//
// 2. DERIVE REACHABILITY, DO NOT DECLARE IT. Whether 真火符 can be burned into
//    a blade is read out of the shipped sources, not written down here. The day
//    the button exists this suite notices on its own, and nobody has to
//    remember to come back and flip a constant.

import * as E from "../js/engine.js";
import { test, assert, eq, suite } from "./harness.js";

// Which copy of this suite is speaking. Stamped by tools/record_shell.py;
// report() compares it against the file on disk, so a stale module is caught
// even when the test count happens to match.
suite(import.meta.url, "ab5ca996");

const NO_STORE = { cache: "no-store" };

const [items, search, events, tiles] = await Promise.all([
  fetch("../data/items.json", NO_STORE).then((r) => r.json()),
  fetch("../data/search.json", NO_STORE).then((r) => r.json()),
  fetch("../data/events.json", NO_STORE).then((r) => r.json()),
  fetch("../data/tiles.json", NO_STORE).then((r) => r.json()),
]);
const DATA = { items, search, events, tiles };

// The files a player's fingers can reach. tools/ is deliberately absent: the
// bots are an instrument, not a player, and the whole of #70 is what happens
// when the instrument's reach is mistaken for the player's.
const SHIPPED = ["app.js", "render.js", "board.js", "menu.js", "shell.js"];
const shipped = Object.fromEntries(
  await Promise.all(
    SHIPPED.map(async (f) => [f, await fetch("../js/" + f, NO_STORE).then((r) => r.text())])
  )
);

// NL is built rather than written. A backslash-n in this repository has twice
// arrived as a literal newline in transit — it did so while this very function
// was being written — and a split on a mangled separator fails silently in the
// direction that matters: it stops finding call sites, the buff reads as
// unreachable, and the suite goes red for a reason nobody can see. Built from a
// char code, there is no escape left to mangle.
const NL = String.fromCharCode(10);

// COMMENTS STRIPPED FIRST, and that is not tidiness. js/render.js carries a
// paragraph explaining that buffSword is unreachable, and the moment somebody
// writes "E.buffSword(state, id)" inside such a paragraph — describing the
// call that does not exist — a raw scan would declare the capability reachable
// and this whole suite would go green against an unwinnable game. That is the
// exact failure mode stage.test.js has hit three times: the comment explaining
// a rule contains the word the rule forbids.
//
// Line comments only. A capability reached from inside a block comment is not
// reached, and if that ever becomes a real question the answer is a parser,
// not a cleverer regex.
function codeOf(src) {
  return src
    .split(NL)
    .filter((line) => line.trim().slice(0, 2) !== "//")
    .join(NL);
}

// Is there a route from a button to this engine capability? Named per
// capability rather than as a general scan, because "some file mentions the
// word" is not reachability and a vague guard here would be worse than none.
function reachable(fnName) {
  return Object.values(shipped).some((src) => codeOf(src).includes(fnName + "("));
}

const BUFF_REACHABLE = reachable("buffSword");

// Every kit a player can actually carry, ASSEMBLED. Returns the attack each one
// produces, and only counts a loadout whose every piece was picked up
// successfully — so the pack limit, the one-blade hand and the uniqueness rules
// all constrain the answer instead of being assumed away.
function assembledAttacks({ withBuff, only = null }) {
  // ONE GATE, NOT FOUR. `only` used to be applied in four places — the sword
  // filter, the talisman filter, the buff and the banner — and a test that
  // dropped a SWORD exercised exactly one of them. Breaking the talisman filter
  // alone left the whole suite green: a HALF-decorative restriction is
  // invisible, which is the same shape as the vacuity the restriction guard was
  // written to catch.
  //
  // Four copies of a check is four places to forget. Every acquisition goes
  // through take() now, so there is one place the restriction can be wrong and
  // one probe is enough to prove it binds. A fifth gate cannot be added without
  // passing through here.
  const allowed = (id) => !only || only.has(id);
  const take = (s, id) => (allowed(id) ? E.pickUpItem(s, id) : { ok: false, reason: "not-allowed" });

  const swords = items.filter((i) => i.cat === "weapon");
  const talismans = items.filter((i) => i.cat === "magic" && i.attack);
  const out = [];

  for (const sword of swords) {
    for (const banner of [false, true]) {
      for (const tal of [null, ...talismans]) {
        const s = E.newGame(DATA, { seed: 1 });
        // The night starts with rice in most of the pack. A player eats or
        // drops it, so a kit that needs those slots is reachable — but it has
        // to be DONE rather than waved at, or the pack stops constraining.
        for (const id of E.heldIds(s).slice()) E.dropItem(s, id, E.heldCount(s, id));

        if (!take(s, sword.id).ok) continue;
        if (withBuff) {
          if (!take(s, "truefire-talisman").ok) continue;
          if (!E.buffSword(s, sword.id).ok) continue;
        }
        if (banner && !take(s, "soul-banner").ok) continue;
        if (tal && !E.held(s, tal.id) && !take(s, tal.id).ok) continue;

        // Only spend what is genuinely in hand or pack at this moment.
        const useBanner = banner && E.held(s, "soul-banner");
        const useTal = tal && E.held(s, tal.id) ? tal.id : null;
        if (banner && !useBanner) continue;
        if (tal && !useTal) continue;

        out.push(E.attackWith(s, { banner: useBanner, talisman: useTal }));
      }
    }
  }
  return out;
}

// THE BEST A PLAYER CAN DO, over buffed AND unbuffed loadouts.
//
// This used to be assembledAttacks({ withBuff: BUFF_REACHABLE }) alone, which
// is a different question: "the best loadout that HAS the buff". Those agree
// today, because the buff only ever adds, so the buffed maximum is the overall
// maximum — and they agree in a way that hides a hole.
//
// Restrict 真火符 away — precisely the case the restriction exists for, if it
// ever became a villager's gift — and the buffed arm has NO loadouts at all,
// because every candidate `continue`s at the buff. Math.max of nothing is
// -Infinity, so the invariant would have failed with "a player who refuses
// every villager tops out lower than one who accepts": true, and useless. The
// answer a reader needs there is the best UNBUFFED kit a refuser can still
// assemble, which is a number somebody can act on.
//
// The function was not wrong. "None" is an honest answer to "which ceilings are
// reachable WITH the buff". The caller was asking it the wrong question.
function ceilingFor(only) {
  const arms = BUFF_REACHABLE ? [false, true] : [false];
  const all = arms.flatMap((withBuff) => assembledAttacks({ withBuff, only }));
  // No loadout at all means no blade: that is bare-handed, and START_ATTACK is
  // the honest floor rather than an absent number.
  return all.length ? Math.max(...all) : E.RULES.START_ATTACK;
}

const playerCeiling = ceilingFor(null);

// ---- The invariant --------------------------------------------------------

// THE ONE THAT WOULD HAVE CAUGHT #70 ON THE DAY. Everything else in this file
// is detail; this is the question. A game whose best assemblable kit cannot
// meet the bar it is asked to meet has an ending nobody can reach, and no
// amount of measurement will reveal it, because the instrument and the game
// share the assumption.
test("§13: the best kit a player can carry can reach the King's bar", () => {
  const bare = E.RULES.KING_THRESHOLD;
  const carrying = E.RULES.KING_THRESHOLD_WITH_TABLET;

  assert(playerCeiling >= carrying,
    `a player tops out at ${playerCeiling} and the bar is ${carrying} even carrying his ` +
    `name, so 鎮屍 cannot be reached at all` +
    (BUFF_REACHABLE ? "" : " — 真火符 cannot be burned into a blade from any button (#70)"));

  // The design since #56: the bare bar IS the ceiling, so the seal is winnable
  // without his name but only perfectly, and the 神主牌 is an advantage rather
  // than a requirement. If this fails while the one above passes, the seal is
  // reachable but only with the tablet, which is option A's rule returning by
  // accident rather than by ruling.
  assert(playerCeiling >= bare,
    `a player tops out at ${playerCeiling} and the bare bar is ${bare}, so the seal now ` +
    `REQUIRES the 神主牌 — that is option A's rule, and #56 ruled it out`);
});

// CAN A PLAYER WHO REFUSES EVERY VILLAGER STILL FINISH THE GAME?
//
// Three villagers appear, one per band at p:10 each, and refusing one leaves a
// creature at attack 4, 5 or 6 in the room. Refusal is a live policy rather
// than a corner: the shipped bots refuse between 48 and 69 percent of the
// villagers they meet.
//
// A SWEEP CANNOT ANSWER THIS. A policy that never wins tells you the policy is
// bad; it says nothing about whether a winning line exists. That gap is where
// this project has been caught before — two guards correctly recorded that the
// sword buff was unreachable and neither asked whether the game could still be
// finished, and 鎮屍 was unwinnable by a human for a week. So this COMPUTES.
//
// The whole question reduces to one fact: which items can a player reach ONLY
// by accepting a gift? Everything else is unaffected by refusing.
function idsIn(node, into) {
  if (Array.isArray(node)) { for (const v of node) idsIn(v, into); return into; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if ((k === "id" || k === "item") && typeof v === "string") into.add(v);
      else idsIn(v, into);
    }
  }
  return into;
}
const SEARCHABLE = idsIn(search, new Set());
const GIFTS = new Set();
idsIn(events, new Set()); // walked for shape; gifts carry their own key
(function collectGifts(node) {
  if (Array.isArray(node)) return node.forEach(collectGifts);
  if (node && typeof node === "object") {
    if (node.t === "VILLAGER" && node.gift) GIFTS.add(node.gift);
    Object.values(node).forEach(collectGifts);
  }
})(events);
const VILLAGER_ONLY = [...GIFTS].filter((id) => !SEARCHABLE.has(id)).sort();

// THE RESTRICTION HAS TO BIND, AND THAT IS A SEPARATE FACT FROM THE RESULT.
//
// The invariant below leans on eq(refuserCeiling, playerCeiling). Equality is
// green when refusing genuinely costs nothing — and ALSO green if `only` were
// decorative and restricted nothing at all. A vacuous invariant looks exactly
// like a satisfied one, which is this project's oldest recurring failure.
//
// My own falsification did not catch that. I removed 真火符 from the magic
// table, which attacks the DATA: it trips the VILLAGER_ONLY assertion and never
// exercises the restriction. The mechanism was left unproven until the reviewer
// attacked it from the other side — dropping the best sword out of the set
// passed as `only`, which must lower the ceiling if the parameter binds. It
// did: expected 13, got 11.
//
// So that is a test now rather than something someone thought to try once.
test("§13: the item restriction actually restricts", () => {
  const full = ceilingFor(SEARCHABLE);
  const without = new Set([...SEARCHABLE].filter((id) => id !== "sevenstar-sword"));
  const lesser = ceilingFor(without);

  assert(lesser < full,
    `dropping the best blade from the allowed set left the ceiling at ${lesser}, ` +
    "unchanged — `only` is not binding, so the refusal invariant below proves nothing");

  // ONE probe is enough BECAUSE there is one gate. It was not enough when there
  // were four: this test dropped a sword and exercised the sword filter alone,
  // and breaking the talisman filter left the whole suite green. If a second
  // gate ever appears outside take(), this line stops being sufficient and the
  // comment in assembledAttacks is the one to read.

  // AND THE RESTRICTED CEILING MUST STAY A NUMBER. Dropping 真火符 removes every
  // BUFFED loadout — each one `continue`s at the buff — so asking only the
  // buffed arm returns an empty set and Math.max of nothing is -Infinity. The
  // invariant would then fail with "tops out lower than one who accepts": true,
  // and useless to anyone trying to act on it. ceilingFor falls back to the
  // unbuffed arm, which is the number that answers the question.
  const noFire = ceilingFor(new Set([...SEARCHABLE].filter((id) => id !== "truefire-talisman")));
  assert(Number.isFinite(noFire),
    `dropping 真火符 gave ${noFire} rather than a number — the ceiling is being read ` +
    "from the buffed arm alone, which is empty when the buff talisman is barred");
  assert(noFire > 0, `a player barred from 真火符 tops out at ${noFire}, which cannot be right`);
});

test("§13: refusing every villager cannot put the King out of reach", () => {
  // The load-bearing fact, derived rather than stated: of the three gifts, only
  // 護身符 exists nowhere else. Both talismans are in the 符咒 table, so
  // refusing costs a player nothing he cannot find by searching.
  eq(VILLAGER_ONLY, ["protective-charm"],
    "a villager now gives something unobtainable that the seal might need — " +
    "the reachability argument below no longer holds and must be redone");

  // And the one exclusive item CONTRIBUTES NO ATTACK. 護身符 is a charm: it
  // takes a point off damage. It cannot move the number the King is met with,
  // so the ceiling is identical whether you take the gifts or refuse them all.
  const charm = items.find((i) => i.id === "protective-charm");
  assert(charm, "護身符 has gone from items.json");
  eq(charm.attack || 0, 0,
    "護身符 now carries attack, so refusing villagers lowers the ceiling and " +
    "this invariant has to be recomputed rather than reasoned");

  // Computed over the restricted set, not argued from the two facts above.
  const refuserCeiling = ceilingFor(SEARCHABLE);
  eq(refuserCeiling, playerCeiling,
    "a player who refuses every villager tops out lower than one who accepts");
  assert(refuserCeiling >= E.RULES.KING_THRESHOLD,
    `refusing every villager caps a player at ${refuserCeiling} against a bare bar ` +
    `of ${E.RULES.KING_THRESHOLD}: 鎮屍 is unreachable for that player`);

  // 埋葬 needs no item at all — the 神主牌 is taken from the crypt and carried
  // to the ground. Stated here because "winnable" has two answers and only one
  // of them is about attack, and a reader checking this should not have to
  // re-derive that the other is untouched.
  assert(!GIFTS.has("tablet"), "the tablet is a villager gift now, which changes the burial too");
});

// The premise, kept next to its consequence rather than in another file. This
// is the assertion data.test.js already had; the difference is that here it
// stands beside the outcome it implies, so nobody can satisfy it and walk away.
test("§13: what a player can reach is what the shipped code can call", () => {
  const withBuff = Math.max(...assembledAttacks({ withBuff: true }));
  const without = Math.max(...assembledAttacks({ withBuff: false }));

  eq(without, 11, "七星劍 3, doubled by 攝魂幡, plus 血符 5 — no button needed");
  eq(withBuff, 13, "the same kit with the fire burned in, which is the engine's ceiling");
  eq(withBuff - without, 2,
    "the buff is worth 2 at the door, not 1: it is doubled before the talisman is added");

  eq(playerCeiling, BUFF_REACHABLE ? withBuff : without,
    "the ceiling this suite judges by must follow the shipped code, not a constant here");
});

// THE GUARD, FAILED ON PURPOSE IN BOTH DIRECTIONS. reachable() decides whether
// this whole suite judges by 11 or by 13, so a broken one is worse than none —
// it would go green against an unwinnable game and nobody would look again.
//
// Both directions matter and only one is obvious. Missing a real call site
// leaves a false alarm, which someone investigates. Counting a COMMENTED call
// site as real is silent: the suite passes, the game stays unwinnable, and the
// evidence that it is broken is the very paragraph explaining why.
test("§13: the reachability probe can tell code from a comment about code", () => {
  const asCode = { "x.js": 'if (ok) E.buffSword(state, id);' };
  const asComment = { "x.js": '// nothing calls E.buffSword(state, id) from any button' };
  const probe = (files) =>
    Object.values(files).some((src) => codeOf(src).includes("buffSword("));

  assert(probe(asCode), "a real call site must register — the guard fails open otherwise");
  assert(!probe(asComment),
    "a commented call registered as reachable: this suite would pass an unwinnable game");

  // And the live one, stated so the failing direction is visible in the output
  // rather than inferred from which assertions ran.
  eq(BUFF_REACHABLE, reachable("buffSword"), "the constant must come from the probe");
});

// The bots are an instrument and instruments may exceed the player — #57's
// squatter earned its result precisely by standing where no player would. What
// they may not do is exceed the player BY DEFAULT and have the output published
// as a description of the shipped game, which is what happened for a month.
//
// So this does not forbid tools/bots.js anything. It pins the rule that the
// difference must be visible: if the bots use a capability no button reaches,
// that fact has to be stated where the numbers are read.
// The other half of the same rule, and the half that needs a guard rather than
// a habit. A LAB policy is legitimate — #57's squatter earned its result by
// standing where no player would, and `tempted` prices a discipline the shipped
// bots have — but its output must never appear in the tables people read as a
// description of the shipped game.
//
// Asserted rather than remembered, because "never in the shipped funnel" is
// exactly the kind of rule that survives until the week somebody is in a hurry.
test("§13: no lab policy appears in the shipped report tables", async () => {
  const bots = await fetch("../tools/bots.js", NO_STORE).then((r) => r.text());
  const report = await fetch("../tools/bots-report.md", NO_STORE).then((r) => r.text());

  const declared = bots.indexOf("export const LAB_POLICIES");
  assert(declared !== -1, "tools/bots.js must declare which policies are lab-only");
  const names = bots
    .slice(declared, bots.indexOf(";", declared))
    .split('"')
    .filter((part, i) => i % 2 === 1);
  assert(names.length >= 1, "LAB_POLICIES is empty — if that is deliberate, delete this test");

  // Only the live tables. Everything below the snapshot line is a dated record
  // and is not a description of the shipped game, so it is not this rule's
  // business — the same boundary the report itself draws.
  const cut = report.indexOf("Everything below is a snapshot");
  const live = cut === -1 ? report : report.slice(0, cut);

  for (const name of names) {
    assert(!live.split(NL).some((line) => line.trim().startsWith("| " + name)),
      `lab policy "${name}" has a row in the shipped tables — it models something ` +
      "no player is, and the numbers there are read as what the game does");
  }
});

test("§13: capability beyond the player is labelled where the numbers are read", async () => {
  const bots = await fetch("../tools/bots.js", NO_STORE).then((r) => r.text());
  const report = await fetch("../tools/bots-report.md", NO_STORE).then((r) => r.text());
  const botsBuff = bots.includes("buffSword(");

  if (!botsBuff || BUFF_REACHABLE) return; // no gap to disclose

  assert(report.includes("buffSword"),
    "the bots reach the seal through a capability no button can, and tools/bots-report.md " +
    "does not say so — the instrument is describing a different game than the one that ships");
});
