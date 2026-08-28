// Rendering — reflects game + board state into the DOM. No game logic here.

import { RULES, effectiveAttack, clockTime, dread, heldIds, heldCount,
         attackWith, bestSword, held, equippedWeapon, equippedCharm,
         swordAttack } from "./engine.js";
import { cellKey, currentTile, listMoves } from "./board.js";
import { combatSting, doorCreak, tollBell, breakThrough, itemPickup, footsteps, setDread,
         watchDrum, hopThud,
         cardTurn, doorwayTick, duckForScare, wallThump, phantomScratch, shovel, heartbeat,
         setScoreHour, buzz,
         setSpace, wickHiss, setScoreRelief, splintering, startPounding, stopPounding,
         floodMurmur } from "./audio.js";

const DIR_CLASS = { N: "n", E: "e", S: "s", W: "w" };
const DIRS = ["N", "E", "S", "W"];
const DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const ARROW = { N: "↑", E: "→", S: "↓", W: "←" };
const ARROW_KEY = { ArrowUp: "N", ArrowRight: "E", ArrowDown: "S", ArrowLeft: "W" };

// The live choice set, whichever surface it is on. Board moves and window cards
// never coexist — renderActions routes to one or the other — and this asserts
// it rather than trusting it.
function currentChoices() {
  const doorways = [...document.querySelectorAll(".doorway")];
  const cards = [...document.querySelectorAll("#actions .action")];
  if (doorways.length && cards.length) {
    console.warn("jiangshi: doorways and action cards on screen together");
  }
  return doorways.length ? doorways : cards;
}

// Rooms that share one drawing. Empty for the twenty-tile set — every room is
// its own place — but the lookup stays, because a set with two of anything
// wants it back and the call sites already go through it.
const ICON_ALIAS = {};
const SCENE_ALIAS = ICON_ALIAS;
// Scenes paint themselves rather than being drawn in currentColor (#62): they
// carry their own fills and end with a currentColor veil, so the world cast and
// the dusk dial still reach them. They must not be dimmed the way line art is,
// which is what the class is for.
//
// All twenty are painted. The check stays rather than being deleted: it is what
// a scene added later falls through, and falling through to the line-art
// treatment is the safe direction — a new drawing rendered faint is a smaller
// problem than a line drawing rendered at full opacity over the floor.
const SCENE_RICH = new Set([
  "gatehouse", "apothecary", "woodshed", "sutra-hall", "mourning-hall",
  "courtyard", "blacksmith", "counting-room", "incense-hall", "sealed-crypt",
  "back-steps", "dry-well", "bamboo-grove", "memorial-arch", "pavilion",
  "pagoda-tree", "stone-ward", "stream", "earth-god-shrine", "mass-grave",
]);

// The sprite injector lives in ./icons.js now, and is re-exported here so the
// pages that already import it from render.js keep working.
export { loadIcons } from "./icons.js";

// Exported for the tile gallery, which needs the same sprite handling.
export function icon(kind, id, cls) {
  const symbol = `${kind}-${ICON_ALIAS[id] || id}`;
  const sym = document.getElementById(symbol);
  if (!sym) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  // Inherit the symbol's own viewBox. The line-art icons are 24x24, but the
  // painted scenes are 96x96 — hardcoding 24 scaled a scene into a quarter of
  // the box, and worse, a 24 outer box around a 96 symbol referenced across
  // the sprite boundary dropped the scenes' gradient paint servers, so the oil
  // lamp glow and the vignette vanished and every indoor tile went flat. The
  // old line art carried no gradients, which is why the mismatch stayed hidden
  // until the twenty new scenes.
  svg.setAttribute("viewBox", sym.getAttribute("viewBox") || "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${symbol}`);
  svg.appendChild(use);
  return svg;
}

// A GHOST OF A SYMBOL: the same drawing, rendered as an outline.
//
// It cannot go through icon(), and that was tested rather than assumed. icon()
// builds <svg><use href="#sym"/></svg>, and <use> clones into a SHADOW TREE
// that document selectors cannot reach — a rule like `.handghost * { fill:
// none }` matches nothing there, and the painted drawing comes out painted.
// Rendered both ways side by side: through <use> the tablet and the charm
// stayed fully painted; INLINED, the same rule turned them into line drawings.
//
// Only INHERITED properties cross into a shadow tree, and fill does not
// inherit into an element carrying its own fill="...". So the symbol's children
// are cloned in directly, where ordinary CSS reaches them.
//
// <defs> is skipped on the way in: it would duplicate gradient ids into the
// document, and a drawing with its fills overridden has no use for them.
// Exported so the guard in stage.test.js can call the REAL function rather than
// scan its source for the shape of one. What it protects is a mechanism, and a
// source scan of a mechanism is a spelling check.
export function ghostIcon(kind, id, cls) {
  const sym = document.getElementById(`${kind}-${ICON_ALIAS[id] || id}`);
  if (!sym) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("viewBox", sym.getAttribute("viewBox") || "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const child of sym.children) {
    if (child.tagName.toLowerCase() === "defs") continue;
    svg.appendChild(child.cloneNode(true));
  }
  return svg;
}

// Interface icons for anything outside the board — the sprite builder itself
// stays private.
// A UI string without being handed the game, for the same reason `drawing`
// exists: a leaf that builds one attribute should not have the run threaded
// down through six layers to reach it. The fallback is for a caller that runs
// before any HUD has been drawn -- the suite, in practice -- and it is a last
// resort rather than a translation: an accessible name in the wrong language is
// bad, and no accessible name at all on a control that stops the game is worse.
export function uiText(key, fallback) {
  if (!drawing) return fallback != null ? fallback : key;
  return ui(drawing, key);
}

export function uiIcon(name, cls) {
  return icon("ui", name, cls);
}

// The hour, in whatever the theme calls hours. English wants "11 PM"; Chinese
// wants 十一點 and no meridiem at all, which is why the half is its own key and
// is allowed to be empty.
export function formatHour(hour) {
  return ui(drawing, "hour", { n: hour - 12 });
}

// Same wording as formatHour, with the minutes the deck has spent. Midnight is
// the one that would read wrong as PM — and midnight is where this game ends,
// so it is worth getting right.
export function formatClock(c) {
  return ui(drawing, "clock", {
    time: c.label,
    half: ui(drawing, c.hour24 >= 24 ? "half-am" : "half-pm"),
  }).trim();
}

// Health is capped at the starting ten, but the bar is drawn the same way it
// always was: hearts show damage against the starting health while the number
// stays small, and fall back to a count once it does not.
const HEART_BASELINE = RULES.START_HEALTH;
const MAX_HEARTS = 10;

// Health, items and the hour are all diffed here rather than at the dozens of
// places that change them: renderHud sees every state refresh, so one hook
// catches damage from fights, flee costs and events alike.
let pendingMoves = [];
let movePrompt = "";
let lastHealth = null;
let lastItems = [];
// The run currently being drawn. Set on every HUD render, which happens before
// anything else here draws, so the handful of leaf functions that build a
// fragment without being handed `game` can still look a word up. Threading it
// down through six layers to reach one aria-label would be the worse trade.
let drawing = null;
const LOW_HEALTH = 2;

export function renderHud(game) {
  drawing = game;
  const health = game.state.health;
  if (lastHealth != null && health < lastHealth) damageFeedback();
  lastHealth = health;

  // One class; the pulse itself is CSS. Only while alive — the body should not
  // be beating under the you-died overlay.
  document.body.classList.toggle(
    "low-health",
    health > 0 && health <= LOW_HEALTH && game.state.status === "playing"
  );

  for (const id of ["stat-health"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = ui(game, id);
  }
  renderHealth(game.state);
  renderAttack(game);
  renderPoison(game.state);
  renderHour(game.state);

  // Which slots are new has to be worked out before the panel is rebuilt.
  // The pack is {id: count} now, so ask the engine for the ids rather than
  // treating it as a list — a talisman stack is one id however deep it is.
  const nowHeld = heldIds(game.state);
  const arrived = nowHeld.filter((id) => !lastItems.includes(id));
  lastItems = nowHeld.slice();
  renderHands(game);
  renderBackpack(game);
  // The sound goes with the pickup, not with the animation — reduced motion
  // skips the flare, and a player who turned sound on still hears the find.
  for (const id of arrived) itemPickup(id);
  if (arrived.length) flourish(arrived);
}

// A new item announces itself: the slot pops and its icon flares gold. Nothing
// marks a loss — dropping and spending are quiet on purpose.
function flourish(arrived) {
  if (reducedMotion()) return;
  const rows = [...document.querySelectorAll("#hud-items .slot")];
  for (const id of arrived) {
    const row = rows.find((r) => {
      const use = r.querySelector("use");
      return use && use.getAttribute("href") === `#item-${id}`;
    });
    if (!row || typeof row.animate !== "function") continue;
    row.animate(
      [
        { transform: "scale(.9)", borderColor: "var(--gold)", boxShadow: "0 0 0 rgba(201,162,75,0)" },
        { transform: "scale(1.06)", borderColor: "var(--gold)", boxShadow: "0 0 18px rgba(201,162,75,.55)", offset: 0.35 },
        { transform: "scale(1)", borderColor: "var(--border)", boxShadow: "0 0 0 rgba(201,162,75,0)" },
      ],
      { duration: 620, easing: "cubic-bezier(.2,.8,.3,1)" }
    );
    const icon = row.querySelector(".itemicon");
    if (icon && typeof icon.animate === "function") {
      icon.animate(
        [{ transform: "scale(.8) rotate(-8deg)" }, { transform: "scale(1.18) rotate(4deg)", offset: 0.4 }, { transform: "scale(1) rotate(0)" }],
        { duration: 620, easing: "cubic-bezier(.2,.8,.3,1)" }
      );
    }
  }
}

// Icons are decorative; every stat carries its value as text for screen readers.
function srOnly(text) {
  const el = document.createElement("span");
  el.className = "sr-only";
  el.textContent = text;
  return el;
}

function statBox(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = "";
  return el;
}

function renderHealth(s) {
  const el = statBox("hud-health");
  if (!el) return;

  if (s.health > MAX_HEARTS) {
    const heart = icon("stat", "heart", "staticon heart heart--full");
    if (heart) el.appendChild(heart);
    const n = document.createElement("span");
    n.className = "statnum";
    n.textContent = `×${s.health}`;
    n.setAttribute("aria-hidden", "true");
    el.appendChild(n);
  } else {
    const slots = Math.max(s.health, HEART_BASELINE);
    for (let i = 0; i < slots; i++) {
      const full = i < s.health;
      const heart = icon("stat", "heart", `staticon heart heart--${full ? "full" : "empty"}`);
      if (heart) el.appendChild(heart);
    }
  }
  el.appendChild(srOnly(String(s.health)));
}

// The best you could reach without spending anything you do not hold, and what
// it would cost you to reach it. attackWith() is free, so this is allowed to
// ask it once per talisman on every render — that is the whole reason the
// engine split preview from commit.
//
// Reported as a ceiling rather than a recommendation. The fight window is where
// the real arithmetic is priced against a real pack; this only answers the
// question the panel is for, which is "how hard can I hit if it comes to it".
function attackCeiling(game) {
  const s = game.state;
  const talismans = heldIds(s).filter((id) => {
    const d = s.itemsById[id];
    return d && d.cat === "magic" && d.attack != null;
  });
  const banner = held(s, "soul-banner");
  let best = { attack: effectiveAttack(s), spends: [] };
  for (const b of banner ? [false, true] : [false]) {
    for (const t of [null, ...talismans]) {
      const use = {};
      if (b) use.banner = true;
      if (t) use.talisman = t;
      const attack = attackWith(s, use);
      if (attack > best.attack) {
        best = { attack, spends: [...(b ? ["soul-banner"] : []), ...(t ? [t] : [])] };
      }
    }
  }
  return best;
}

// The clock panel no longer carries an Attack number (#55) — it was the second
// copy of one, and the first lives on the weapon in the hands panel where the
// thing producing it lives. statBox returns nothing now and this returns early,
// which is why the function stays: the element is a choice, not a guarantee, and
// putting it back should be enough to bring the number back with it.
function renderAttack(game) {
  const s = game.state;
  const el = statBox("hud-attack");
  if (!el) return;
  const attack = effectiveAttack(s);
  const swordId = bestSword(s);
  const buffed = swordId ? !!s.buffed[swordId] : false;

  const sword = icon("stat", "sword", "staticon sword" + (buffed ? " sword--buffed" : ""));
  if (sword) el.appendChild(sword);
  const n = document.createElement("span");
  n.className = "statnum" + (buffed ? " statnum--buffed" : "");
  n.textContent = String(attack);
  n.setAttribute("aria-hidden", "true");
  el.appendChild(n);

  // What is in your hand, said in full: which blade, and whether a 真火符 is
  // burnt into it. Bare-handed is zero and the sword IS the number, so there is
  // no bonus to describe — only a blade, or the absence of one.
  const held0 = !swordId
    ? ui(game, "attack-bare")
    : ui(game, buffed ? "attack-buffed" : "attack-held",
         { item: itemName(game, swordId), n: attack });

  const top = attackCeiling(game);
  if (top.attack > attack) {
    const more = document.createElement("span");
    more.className = "statmore";
    more.setAttribute("aria-hidden", "true");
    more.textContent = ui(game, "attack-ceiling", { n: top.attack });
    el.appendChild(more);
    const spent = top.spends.map((id) => itemName(game, id)).join(" and ");
    const said = ui(game, "attack-upto", { held: held0, n: top.attack, spent });
    el.title = said;
    el.appendChild(srOnly(said));
    return;
  }
  el.title = held0;
  el.appendChild(srOnly(held0));
}


// 中毒: shown only while it is true. The tick itself is announced by the turn
// loop — this is the standing reminder that it has not stopped, which is the
// part a number in a log cannot do.
function renderPoison(s) {
  const el = document.getElementById("hud-poison");
  if (!el) return;
  el.textContent = "";
  const on = !!s.poisoned && s.status === "playing";
  el.hidden = !on;
  if (!on) return;
  const mark = document.createElement("span");
  mark.className = "poisonglyph";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "中毒";
  el.appendChild(mark);
  const rate = document.createElement("span");
  rate.className = "poisonrate";
  rate.setAttribute("aria-hidden", "true");
  rate.textContent = `−${RULES.POISON_PER_TURN} each turn`;
  el.appendChild(rate);
  el.appendChild(srOnly(`中毒: losing ${RULES.POISON_PER_TURN} health at the start of every turn until it is drawn out`));
}

// THE CLOCK IS THE DIGITS. The analog face went with the panel merge: a dial
// and a numeral beside it were two clocks saying one time, and on a phone the
// one that reads at a glance is the one with digits. The hand sweep and the
// face-shake went with it — everything below still works from the reading.
let lastHour = null;

function renderHour(s) {
  const el = statBox("hud-hour");
  if (!el) return;
  const c = clockTime(s);

  const reading = formatClock(c);
  const side = document.createElement("div");
  side.className = "clockread";
  side.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "statnum clocknum";
  text.textContent = reading;
  side.appendChild(text);
  el.appendChild(side);

  // Built from the same reading as the visible text, so the two cannot drift,
  // and carrying what the pips show — a hand position is not something to
  // announce as a shape.
  el.appendChild(srOnly(ui(drawing, "clock-said",
    { time: reading, phrase: cardsLeftPhrase(c) })));

  // The light now follows the minute hand, not the hour: one number out to CSS
  // and every dial in the light model moves with it, a sliver per card drawn.
  const body = document.body;
  const dusk = c.elapsed / c.span;
  body.style.setProperty("--dusk", dusk.toFixed(4));

  // Dusk is only the clock. Dread is the whole situation — how late, how hurt,
  // how bloody the hour has been, how little deck is left, whether you are
  // carrying the thing they want. Published alongside --dusk so CSS consumers
  // come free, and handed to the audio bed so wind and picture agree.
  const fear = dread(s);
  body.style.setProperty("--dread", fear.toFixed(4));
  setDread(fear);

  // The score thickens by an hour and then, at eleven, stops. Driven from the
  // same place the light and the wind are, so the three never disagree about
  // what time it is.
  setScoreHour(s.hour);
  // And falls back a layer while the room is letting go. Same dial, same
  // place: the light, the wind and the music are never told different things.
  setScoreRelief(s.relief || 0);

  // The hour class stays for the jobs a gradient cannot do — the last hour's
  // change of register, and strikeEleven keying off the turn. timePasses loses
  // at midnight before it can increment past 23, so 9/10/11 covers every state
  // a player can be looking at; the clamp is belt and braces.
  const hour = Math.min(Math.max(s.hour - 12, 9), 11);
  for (const h of [9, 10, 11]) body.classList.toggle(`hour-${h}`, h === hour);

  const turned = lastHour != null && lastHour !== s.hour;
  lastHour = s.hour;
  if (turned) {
    // 更鼓. Somebody out in the village is still walking the watches and still
    // striking the number of the one that has begun, which is the one piece of
    // evidence all night that anyone else is alive out there. Ten o'clock is
    // two, eleven is three — the count is the information, and it is the same
    // drum that will strike at 三更.
    watchDrum(s.hour - RULES.START_HOUR + 1);
  }
  // The shake moved from the dial to the digits, because the dial is gone and
  // the moment still has to land somewhere the eye is already looking.
  if (turned && s.hour === RULES.FINAL_HOUR) strikeEleven(text);
}

// Restored: this feeds the CLOCK'S ACCESSIBLE NAME, not the dial, and it was
// deleted by accident along with the dial's own helpers. The visible reading
// and the spoken one carry the same fact in the form each channel can carry —
// removing the face changed nothing about that.
function cardsLeftPhrase(c) {
  if (c.left === 0) return ui(drawing, "turns-left-none");
  // Two keys, not a suffix: English pluralises and Chinese does not, and a
  // format string cannot serve both without one of them reading wrong.
  return c.left === 1
    ? ui(drawing, "turns-left-one")
    : ui(drawing, "turns-left-many", { n: c.left });
}

// The last hour, called out. The ambient palette shift is handled by the hour
// class; this is the punctuation on top of it.
//
// Takes the digits now that the dial is gone. The log line, the caption and the
// bell never needed an element — only the shake does, and it has to happen on
// something the player is already reading.
function strikeEleven(target) {
  const table = (drawing && drawing.data && drawing.data.theme && drawing.data.theme.lines) || {};
  const line = table["strike-eleven"] || "strike-eleven";
  log(line, "bad");
  // The one line the issue insists must stay visible, and rightly: it is the
  // moment the game tells you how it ends.
  caption(line, "toll");
  tollBell();
  if (reducedMotion() || !target || typeof target.animate !== "function") return;
  target.animate(
    [
      { transform: "rotate(0deg) scale(1)" },
      { transform: "rotate(-9deg) scale(1.18)", offset: 0.25 },
      { transform: "rotate(8deg) scale(1.14)", offset: 0.55 },
      { transform: "rotate(-3deg) scale(1.06)", offset: 0.8 },
      { transform: "rotate(0deg) scale(1)" },
    ],
    { duration: 900, easing: "ease-in-out" }
  );
}


// ---- 裝備 / Equipment ----------------------------------------------------------
// What you are WEARING AND HOLDING, which the second amendment made a different
// question from what you are carrying. Three slots that are not pack slots, so
// the pack goes back to being luggage and this panel is the reason that reads.
//
// 左手 the blade, 身上 the 護身符, 右手 the 神主牌 (#75). The user named the middle
// and the right; the left is the only slot left for a weapon, and the blade is
// drawn in the same place it always was — what changed is its LABEL, since it
// used to be called the right hand.
//
// All three are drawn even when empty, and that is the point of starting the
// night here: bare-handed is ZERO attack, not "one plus whatever you find", and
// an empty hand said out loud on turn one is the clearest way to teach a rule
// the source game did not have.
//
// THE TABLET IS RENDERED HERE, NOT STORED HERE. state.tablet stays the slotless
// boolean it has always been: it never counts against MAX_ITEMS, cannot be
// dropped and cannot be swapped. This reverses the note that used to sit on
// renderRelic — that a slot would say it competes with a sword — and the reason
// it is safe to reverse is that these are not pack slots. Nothing here competes
// with anything; the panel says what you have, and the pack says what it costs.
function renderHands(game) {
  const el = document.getElementById("hud-hands");
  if (!el) return;
  const s = game.state;
  el.textContent = "";
  el.appendChild(handSlot(game, "weapon", equippedWeapon(s)));
  el.appendChild(handSlot(game, "charm", equippedCharm(s)));
  el.appendChild(handSlot(game, "relic", s.tablet ? "relic" : null));
}

// One slot. The weapon slot also carries the number, because the number IS the
// weapon here — a sword is your attack outright rather than a bonus on top of
// one, and 真火符 burned into the steel is worth a point that has to show
// somewhere the player will look before a replace prompt asks about it.
//
// The 神主牌 passes `id` as the literal "relic" rather than an item id, because
// it is not an item: there is no row for it in items.json and never was.
function handSlot(game, slot, id) {
  const s = game.state;
  const isRelic = slot === "relic";
  const box = document.createElement("div");
  box.className = `hand hand--${slot}` + (id ? "" : " hand--bare");

  const label = document.createElement("span");
  label.className = "handlabel";
  label.textContent = ui(game, "hand-" + slot);
  box.appendChild(label);

  // The picture row is ALWAYS present, even when there is nothing to put in it.
  // The reserve was originally for the NAMES — with the row omitted on empty
  // slots, "empty" sat at three different heights across three slots meant to
  // read as one row. The names are gone now, so the reserve is re-derived
  // rather than inherited: it keeps the three pictures on one line, and keeps
  // the labels above and the attack numeral below aligned across the row. Its
  // height comes from --handicon in the stylesheet, so there is one place that
  // says how big a slot picture is.
  //
  // No stand-in figure on the empty ones. It was tried at 18x26 and read as a
  // smudge rather than a body — the label 身上 already says what the slot is.
  const slotArt = document.createElement(id ? "button" : "span");
  slotArt.className = "handart";
  if (id) slotArt.type = "button";

  // A FAINT OUTLINE OF WHAT GOES HERE, on an empty slot (#91), and it is
  // teaching rather than decoration. Taking the names out of these slots removed the only thing that
  // told a new player what each one is FOR: nobody arriving at a fresh nine
  // o'clock had any way to know the right hand is where 神主牌 goes, and that
  // tablet is the whole errand. The ghost is the only teaching signal left here,
  // so it is built to be read.
  //
  // WHICH SYMBOL, AND WHY NOT THE OBVIOUS ONE FOR THE BLADE. 身上 takes only a
  // 護身符 and 右手 takes only the 神主牌, so ghosting their own drawings is
  // simply true. 左手 takes any of four blades, so ghosting one of them would
  // name a favourite and tell a lie about which. It gets stat-sword instead --
  // the generic diagonal blade the attack stat already uses, which means the
  // game has a "a weapon" glyph and this is it, drawn muted there for the same
  // reason it is drawn muted here.
  if (!id) {
    const ghost = isRelic
      ? ghostIcon("ui", "relic", "handghost")
      : ghostIcon(slot === "weapon" ? "stat" : "item",
                  slot === "weapon" ? "sword" : "protective-charm", "handghost");
    // icon() already marks it aria-hidden. Saying so here because it matters:
    // the sr-only line right below already says the slot is empty, and a ghost
    // that announced itself would have a screen reader call the slot empty and
    // then name a sword.
    if (ghost) slotArt.appendChild(ghost);
  }
  // #89: a blade carrying 真火符 draws its BURNING self. Until now the picture was
  // byte-identical burnt or not, so the only cue that your steel was on fire was
  // a gold numeral — which says nothing unless you already know gold means
  // something. The picture is the fact now.
  //
  // Falls back to the unburnt symbol if a burnt one is missing, so a gap
  // degrades to the old behaviour rather than to an empty slot. The guard in
  // stage.test.js is what keeps that fallback from quietly becoming the live
  // path: it fails if any of the four burnt drawings is absent or is too close
  // to the blade it came from.
  const onFire = !isRelic && !!id && !!(s.buffed && s.buffed[id]);
  const art = isRelic
    ? (id ? uiIcon("relic", "handicon") : null)
    : (id ? (onFire ? icon("item", id + "-burnt", "handicon") : null)
            || icon("item", id, "handicon")
          : null);
  if (art) slotArt.appendChild(art);
  box.appendChild(slotArt);

  // THE NAME IS NO LONGER PRINTED UNDER THE PICTURE. The slots now work the way
  // the pack already did: picture only, with the name and what it does arriving
  // when you point at one — and on a tap, which is the same gesture the pack
  // cells take.
  //
  // Which makes the PICTURE load-bearing here for the first time. Until now
  // every slot carried its name in both languages underneath, so recognition
  // never rested on the drawing in this panel. It does now, which is most of
  // why the picture got bigger at the same time.
  //
  // The machinery is the pack's, not a second copy of it: same .celltip, same
  // reveal rules, and the same cell--open class the document-level
  // closeAllCells() already looks for. A slot tooltip on its own class would
  // not close when a pack cell opened and you would get two on screen at once.
  const slotName = id
    ? (isRelic ? ui(game, "relic-name") : itemName(game, id))
    : ui(game, slot === "weapon" ? "hand-bare" : "hand-empty");
  // The accessible name stays on the control whether or not the tooltip shows,
  // exactly as the pack cells do it. Losing the visible name must not take the
  // spoken one with it.
  const slotEffect = id && !isRelic ? itemEffect(game, id) : "";
  slotArt.setAttribute("aria-label", slotEffect ? slotName + " — " + slotEffect : slotName);

  if (id) {
    const tip = document.createElement("div");
    tip.className = "celltip";
    tip.setAttribute("role", "tooltip");
    const tipName = document.createElement("p");
    tipName.className = "tipname";
    tipName.textContent = slotName;
    tip.appendChild(tipName);
    if (slotEffect) {
      const e = document.createElement("p");
      e.className = "tipeffect";
      e.textContent = slotEffect;
      tip.appendChild(e);
    }
    const blurb = (game.data.theme.itemBlurbs || {})[isRelic ? "relic" : id] || "";
    if (blurb) {
      const b = document.createElement("p");
      b.className = "tipblurb";
      b.textContent = blurb;
      tip.appendChild(b);
    }
    box.appendChild(tip);

    // The touch path, identical to the pack's: a tap REVEALS rather than acts,
    // and closes anything else that is open first.
    slotArt.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = box.classList.contains("cell--open");
      closeAllCells();
      if (!open) box.classList.add("cell--open");
    });
  }

  if (slot === "weapon") {
    const n = id ? swordAttack(s, id) : RULES.START_ATTACK;
    const num = document.createElement("span");
    num.className = "handattack";
    num.textContent = String(n);
    // The buff is permanent and belongs to this blade — leave the sword and the
    // point goes with it. Marked here so the replace prompt is not the first
    // time anybody hears about it.
    if (id && s.buffed && s.buffed[id]) {
      num.classList.add("handattack--buffed");
      num.appendChild(srOnly(ui(game, "hand-buffed")));
    }
    box.appendChild(num);
    // Spoken as a sentence: the visual is a label, a name and a bare numeral
    // three elements apart, which reads as three unrelated facts aloud.
    box.appendChild(srOnly(ui(game, id ? "hand-weapon-said" : "hand-weapon-bare", {
      item: id ? itemName(game, id) : "", n,
    })));
  } else if (isRelic) {
    box.appendChild(srOnly(ui(game, id ? "hand-relic-said" : "hand-relic-bare", {
      item: ui(game, "relic-name"),
    })));
  } else {
    box.appendChild(srOnly(ui(game, id ? "hand-charm-said" : "hand-charm-bare", {
      item: id ? itemName(game, id) : "",
    })));
  }
  return box;
}

// The pack expanded into one entry per slot, in the order the engine charges
// them: a magic stack takes a single row, everything else takes one row per
// unit. Empty slots are rendered too, so the six-slot ceiling is visible
// rather than implied. Effects are derived from the theme, so a re-theme or a
// stat change needs no edit here.
function slotRows(state) {
  const rows = [];
  for (const id of heldIds(state)) {
    const def = state.itemsById[id];
    const n = def && def.cat === "magic" ? 1 : heldCount(state, id);
    for (let i = 0; i < n; i++) rows.push(id);
  }
  return rows;
}

// ---- The pack, as 田 ------------------------------------------------------------
// Four cells of pictures. The name and what it does arrive when you point at
// one, which is the whole ruling: the panel stops being a list of labels and
// becomes a thing you look at, and the words are there when you want them.
//
// The cell count comes from RULES.MAX_ITEMS and is never written down here. The
// pack has already been six and is now four, and the seal-reachability question
// could move it again — a grid that disagrees with the engine about how much you
// can carry is a worse bug than an ugly grid.
//
// Empty cells are drawn as empty, for the same reason both hands are drawn empty
// at nine o'clock: the limit is a rule, and a rule you can see costs nothing to
// teach.
function renderBackpack(game) {
  const s = game.state;
  const el = document.getElementById("hud-items");
  if (!el) return;
  el.textContent = "";
  // The strip is as wide as the engine says the pack is. Same reason the loop
  // below asks rather than assumes: this has been six and is now four, and the
  // CSS should not be the one place that disagrees.
  el.style.setProperty("--pack-cells", String(RULES.MAX_ITEMS));
  // One entry per SLOT, and a slot is not a unit: a talisman stack fills one
  // cell whatever its count, while three rice fill three.
  const rows = slotRows(s);
  for (let i = 0; i < RULES.MAX_ITEMS; i++) {
    el.appendChild(rows[i] ? packCell(game, rows[i], i) : emptyCell(game));
  }
}

// One cell: a picture, a count if it stacks, and the words behind it.
//
// The structure is deliberate. The face is a <button> so it is reachable by
// keyboard and announced as a control; the tooltip is its SIBLING rather than
// its child, because the Use control lives in the tooltip and a button inside a
// button is not a thing. The cell reveals on :hover, on :focus-within — which is
// what carries both the keyboard path and, because the tooltip stays open while
// Use has focus, the second action — and on an explicit toggle for touch.
function packCell(game, id, index) {
  const s = game.state;
  const def = s.itemsById[id] || {};
  const n = def.cat === "magic" ? heldCount(s, id) : 1;
  const name = itemName(game, id);
  const effect = itemEffect(game, id);
  const blurb = (game.data.theme.itemBlurbs || {})[id] || "";

  const cell = document.createElement("div");
  cell.className = "cell";

  const face = document.createElement("button");
  face.type = "button";
  face.className = "cellface";
  // The accessible name carries the item AND the count whether or not the
  // tooltip is showing. A picture-only cell that only says what it is when
  // hovered is a cell a screen reader never learns anything from, and the count
  // used to live in the name text that this design removed.
  const said = n > 1 ? ui(game, "pack-said-many", { item: name, n }) : name;
  face.setAttribute("aria-label", effect ? `${said} — ${effect}` : said);

  const art = icon("item", id, "cellicon");
  if (art) face.appendChild(art);

  if (n > 1) {
    const badge = document.createElement("span");
    badge.className = "cellcount";
    badge.textContent = `×${n}`;
    // Said in words as well: "×3" is a picture, and the pack has to be playable
    // without seeing it.
    badge.setAttribute("aria-hidden", "true");
    face.appendChild(badge);
  }
  cell.appendChild(face);

  const tip = document.createElement("div");
  tip.className = "celltip";
  tip.setAttribute("role", "tooltip");
  const tipName = document.createElement("p");
  tipName.className = "tipname";
  tipName.textContent = n > 1 ? `${name} ×${n}` : name;
  tip.appendChild(tipName);
  if (effect) {
    const e = document.createElement("p");
    e.className = "tipeffect";
    e.textContent = effect;
    tip.appendChild(e);
  }
  if (blurb) {
    const b = document.createElement("p");
    b.className = "tipblurb";
    b.textContent = blurb;
    tip.appendChild(b);
  }

  cell.appendChild(tip);

  // Use, VISIBLE AT REST (#53). It was inside the reveal panel, which made the
  // action wait on discovering the gesture — a picture whose only control is
  // behind a hover reads as decoration, which is what the ruling says it did.
  //
  // Every occupied cell carries one. The pack can only spend medicine and 硃砂;
  // a talisman is spent by the fight that prices it, and the banner by the
  // strike. So the others get the control DISABLED with the reason rather than
  // no control at all — "there is no button here" and "the button is not for
  // this" look identical, and only one of them is true.
  const isCinnabar = id === "cinnabar";
  const isTruefire = id === "truefire-talisman";
  const buff = isTruefire ? buffState(game) : null;
  // WHAT THE PACK CAN ACTUALLY SPEND, which is not the same as cat: "medicine"
  // (#86). 黑狗血 is filed as medicine and its effect is ESCAPE_FIGHT, so
  // outside a fight useMedicine finds no heal, no cure and no gamble, drops it
  // and returns ok — the item is destroyed for nothing. Pressing Use on it took
  // one of thirteen items off a player and moved nothing at all.
  //
  // So the question is what the item DOES here, not what shelf it sits on: a
  // medicine the pack can spend is one that heals, cures or gambles. Anything
  // else is spent by the fight that needs it, which is exactly what
  // use-elsewhere already says and what #53 established for talismans.
  const spendsHere = spendsFromPack(def);
  const spendable = isCinnabar || isTruefire || spendsHere;
  const canUse = isCinnabar ? cinnabarTargets(game).length > 0
    : isTruefire ? buff.ok
    : spendsHere;
  const use = document.createElement("button");
  use.type = "button";
  use.className = "cellact";
  // 真火符 gets its own word, and that is not decoration. A fight card already
  // says "Burn the 真火符" and means THROW IT AT THEM; this burns it into the
  // steel and the blade keeps it. Two different actions cannot share a verb on
  // the same item — that ambiguity is what #68 was filed for.
  // 硃砂 is the one button that does not spend when pressed — it opens a picker
  // and asks which talisman to copy — so it says so rather than promising the
  // same thing the others promise.
  use.textContent = ui(game, isTruefire ? "use-buff" : isCinnabar ? "use-grind" : "use");
  use.disabled = !canUse || typeof packUse !== "function";
  const swordName =
    buff && buff.sword ? itemName(game, buff.sword) : "";
  use.setAttribute("aria-label", canUse
    ? ui(game, isTruefire ? "use-buff-said" : "use-item", { item: name, sword: swordName })
    : isTruefire
      ? ui(game, "buff-" + buff.why, { item: name, sword: swordName })
      : ui(game, spendable ? "use-blocked" : "use-elsewhere", { item: name }));
  use.title = canUse
    ? ""
    : isTruefire
      ? ui(game, "buff-" + buff.why + "-title", { item: name, sword: swordName })
      : ui(game, spendable ? "use-blocked-title" : "use-elsewhere-title");
  use.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof packUse === "function") packUse(id);
  });
  cell.appendChild(use);


  // The touch path. A tap has to REVEAL rather than act — the item stays usable
  // in a second action, which is the Use control inside the tooltip — so the
  // face toggles the cell open and does nothing else. On a pointer device this
  // is redundant with :hover and harmless.
  face.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = cell.classList.contains("cell--open");
    closeAllCells();
    if (!open) cell.classList.add("cell--open");
  });
  return cell;
}

function emptyCell(game) {
  const cell = document.createElement("div");
  cell.className = "cell cell--empty";
  const face = document.createElement("span");
  face.className = "cellface";
  face.textContent = "";
  face.setAttribute("aria-label", ui(game, "slot-empty"));
  cell.appendChild(face);
  return cell;
}

function closeAllCells() {
  for (const c of document.querySelectorAll(".cell--open")) c.classList.remove("cell--open");
}

// One listener for the whole document rather than one per cell: the panel is
// rebuilt on every refresh, and a handler registered per cell would be
// registered again every turn.
if (typeof document !== "undefined") {
  document.addEventListener("click", closeAllCells);
}

// The pack can spend medicine, and spending is a turn-loop action — but the
// panel is rebuilt by refresh(), which knows nothing about the turn loop. So
// the app registers the handler once and the rows call it.
let packUse = null;
export function onPackUse(fn) {
  packUse = fn;
}


// WHAT THE PACK CAN ACTUALLY SPEND, in one place (#86).
//
// Not the same question as cat: "medicine". 黑狗血 is filed as medicine and its
// effect is ESCAPE_FIGHT, so outside a fight useMedicine finds no heal, no cure
// and no gamble, drops it and returns ok — pressing Use destroyed one of
// thirteen items and moved nothing. What the item DOES here is the question,
// not what shelf it sits on.
//
// Written once because it was written twice: the cell asked one way and
// packSlot asked another, and two copies of one decision is how they come
// apart. Anything this refuses is spent by the fight that needs it, which is
// what use-elsewhere already says.
function spendsFromPack(def) {
  if (!def || def.cat !== "medicine") return false;
  return def.heal != null || !!def.cures || !!def.gamble;
}

// One filled slot. Talismans carry a ×N because the stack is the slot; anything
// else is one unit per row and a count there would be a lie.
function packSlot(game, id, opts = {}) {
  const s = game.state;
  const def = s.itemsById[id] || {};
  const row = document.createElement("div");
  row.className = "slot";

  const art = icon("item", id, "itemicon");
  if (art) row.appendChild(art);

  const text = document.createElement("span");
  text.className = "slottext";

  const name = document.createElement("span");
  name.className = "slotname";
  name.textContent = itemName(game, id);
  const n = heldCount(s, id);
  if (def.cat === "magic" && n > 1) {
    const tally = document.createElement("span");
    tally.className = "slotcount";
    tally.textContent = `×${n}`;
    // Said in words too: "×3" is a picture, and the pack has to be playable
    // without seeing it.
    tally.setAttribute("aria-label", ui(game, "slot-stack", { n }));
    name.appendChild(tally);
  }
  text.appendChild(name);

  const effect = itemEffect(game, id);
  if (effect) {
    const eff = document.createElement("span");
    eff.className = "sloteffect";
    eff.textContent = effect;
    text.appendChild(eff);
  }
  row.appendChild(text);

  // What the pack itself can spend: medicine, and 硃砂. Both are used outside a
  // fight and neither has anything to do with one — the weapons and talismans
  // are spent by the fight that needs them, in the window that prices them.
  //
  // 硃砂 needs a target, so its button opens a picker rather than resolving.
  // It is greyed with a reason when there is nothing to paint: grinding it over
  // an empty pack would be a wasted item and a surprise.
  const isCinnabar = id === "cinnabar";
  const canUse = isCinnabar ? cinnabarTargets(game).length > 0 : spendsFromPack(def);
  if (!opts.plain && (isCinnabar || spendsFromPack(def)) && typeof opts.onUse === "function") {
    const use = document.createElement("button");
    use.type = "button";
    use.className = "slotuse";
    use.textContent = ui(game, "use");
    use.disabled = !canUse;
    use.setAttribute(
      "aria-label",
      canUse
        ? ui(game, "use-item", { item: itemName(game, id) })
        : ui(game, "use-blocked", { item: itemName(game, id) })
    );
    if (!canUse) use.title = ui(game, "use-blocked-title");
    use.addEventListener("click", () => opts.onUse(id));
    row.appendChild(use);
  }
  return row;
}

// What 硃砂 can be ground over: a talisman you actually hold, and not itself.
// The same two rules useCinnabar enforces, asked before the button is offered
// so an offered use never refuses.
// Can the 真火符 in the pack go into the blade in your hand? (#70)
//
// The engine has always been able to do this — E.buffSword, and the tests for
// it — and until now no button in the game reached it, so the item card was
// advertising an action nobody could take. #68 removed the promise; this is the
// other half, which is the half the user asked for: 鎮屍 needs a blade carrying
// one, and without this control the ending was unreachable by a human.
//
// Each failure carries its own sentence rather than a dead control. "There is
// no button here" and "the button is not for this right now" look identical to
// a player and only one of them is true — the rule #53 was filed over.
export function buffState(game) {
  const s = game.state;
  const sword = equippedWeapon(s);
  if (!sword) return { ok: false, why: "no-sword", sword: null };
  // One per blade, which is what keeps the ceiling where the design put it:
  // 七星劍 3 + 1, and 硃砂 cannot pump a sword past it by copying the paper.
  if (s.buffed && s.buffed[sword]) return { ok: false, why: "already", sword };
  return { ok: true, why: null, sword };
}

export function cinnabarTargets(game) {
  const s = game.state;
  return heldIds(s).filter((id) => {
    const d = s.itemsById[id];
    return d && d.cat === "magic" && id !== "cinnabar";
  });
}

// The 硃砂 picker. Same sheet as the drop dialog, and a dismissal that costs
// nothing: choosing not to grind it is a real answer, so Escape and the way out
// both leave the item in the pack.
export function showCinnabarDialog(game, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "notecard dropcard";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-labelledby", "cinnabar-title");

  const sheet = document.createElement("div");
  sheet.className = "notesheet";

  const h = document.createElement("h2");
  h.id = "cinnabar-title";
  h.textContent = ui(game, "cinnabar-title", { item: itemName(game, "cinnabar") });
  sheet.appendChild(h);

  const lede = document.createElement("p");
  const n = (game.state.itemsById["cinnabar"] || {}).n || 2;
  lede.textContent = ui(game, "cinnabar-lede", { n });
  sheet.appendChild(lede);

  const list = document.createElement("div");
  list.className = "droplist";
  for (const id of cinnabarTargets(game)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn dropchoice";
    const have = heldCount(game.state, id);
    btn.textContent = ui(game, "cinnabar-choice",
      { item: itemName(game, id), have, after: have + n });
    btn.addEventListener("click", () => {
      done();
      if (opts.onPick) opts.onPick(id);
    });
    list.appendChild(btn);
  }
  sheet.appendChild(list);

  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn dropleave";
  leave.textContent = ui(game, "cinnabar-leave");
  sheet.appendChild(leave);

  wrap.appendChild(sheet);
  document.body.appendChild(wrap);

  const done = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { done(); if (opts.onLeave) opts.onLeave(); }
  };
  leave.addEventListener("click", () => { done(); if (opts.onLeave) opts.onLeave(); });
  document.addEventListener("keydown", onKey);
  const first = list.querySelector("button");
  (first || leave).focus();
  return done;
}

function itemEffect(game, id) {
  const it = game.state.itemsById[id];
  if (!it) return "";
  const bits = [];
  // Weapons ARE the attack, so they are stated absolutely: "attack 3", never
  // "+3". A talisman genuinely does add, and says so.
  const eff = (k, v) => fill(((game.data.theme.effects || {})[k]) || k, v);
  if (it.cat === "weapon" && it.attack != null) bits.push(eff("weapon-attack", { n: it.attack }));
  else if (it.attack != null) bits.push(eff("talisman-attack", { n: it.attack }));
  // Advertised again (#70). This line was removed by #68 because it named an
  // action no button reached — the pack only spent medicine and 硃砂, and a
  // fight only ever threw. The button exists now, in the pack, on this very
  // item, so the card is telling the truth when it says this.
  if (it.buffSword) bits.push(eff("buff-sword", { n: it.buffSword }));
  if (it.costHp) bits.push(eff("cost-hp", { n: it.costHp }));
  if (it.effect === "DUPLICATE_TALISMAN") bits.push(eff("duplicate", { n: it.n || 2 }));
  if (it.effect === "DOUBLE_SWORD") bits.push(eff("double-sword"));
  if (it.effect === "ESCAPE_FIGHT") bits.push(eff("escape"));
  if (it.heal != null) bits.push(eff("heal", { n: it.heal }));
  // The gamble is named rather than averaged. A player deciding whether to
  // swallow it needs both faces, not their mean.
  if (it.gamble) {
    bits.push(it.gamble.map((f) => `${f.hp > 0 ? "+" : ""}${f.hp}`).join(eff("gamble-join")));
  }
  if (it.cures === "POISON") bits.push(eff("cures-poison"));
  if (it.damageReduction) bits.push(eff("damage-reduction", { n: it.damageReduction }));
  return bits.join(eff("join"));
}

// What each wall of the room you're standing in is currently doing. Passability
// is taken from listMoves() rather than re-derived, so the picture can never
// disagree with the buttons.
//
// Five states, because this ruleset allows a door to open onto a neighbour's
// blank wall:
//   wall     — no opening at all
//   shut     — an opening with unexplored space beyond; nothing to show behind it
//   open     — a passage into an explored room; that room is shown, half-seen
//   blocked  — an opening that leads nowhere (a door facing a wall, or no tiles
//              left to place). Drawn shut, because you cannot use it.
//   outside  — the arrow door, before the seam is placed
function edgeStates(game) {
  const board = game.board;
  const tile = currentTile(board);
  // A seam "cross" move shares its direction with the arrow door, and is pushed
  // after the per-direction moves, so it legitimately wins here.
  const byDir = new Map(listMoves(board).map((m) => [m.dir, m]));

  const out = {};
  for (const dir of DIRS) {
    const hole = tile.holes.includes(dir);
    const door = tile.exits.includes(dir);
    const move = byDir.get(dir);
    const type = move && move.type;

    // The arrow edge is a passage that is not one of the tile's own doors: the
    // Veranda joins the house along its seam edge, which is absent from its
    // exit list. Without this the way home renders as blank wall.
    const arrow = dir === tile.exteriorDir || dir === tile.seamDir;

    if (!hole && !door && !arrow) {
      out[dir] = { kind: "wall", state: "wall", neighbour: null };
      continue;
    }

    let state = "blocked";
    let neighbour = null;

    if (type === "move" || type === "cross") {
      state = "open";
      const to = move.to;
      neighbour = board.worlds[to.world].get(cellKey(to.x, to.y)) || null;
    } else if (type === "outside") {
      state = "outside";
    } else if (type === "explore") {
      state = "shut";
    } else {
      // No move offered. Either a door onto an explored neighbour's wall, or an
      // unexplored edge with an empty tile stack.
      const [dx, dy] = DELTA[dir];
      state = board.worlds[tile.world].get(cellKey(tile.x + dx, tile.y + dy)) ? "blocked" : "shut";
    }

    out[dir] = {
      kind: hole ? "broken" : "door",
      arrow,
      crossesWorld: type === "cross",
      state,
      neighbour,
    };
  }
  return out;
}

// Only the room you're in, centred, with a half-glimpse of each explored room
// you could step into. Nothing behind a shut door.
export function renderBoard(game) {
  const board = game.board;
  const el = document.getElementById("board");

  // Belt and braces alongside the ResizeObserver: a pane can change size for
  // reasons no observer notification reliably lands for, and a board rendered
  // at a stale tile size is very visible. fitBoard early-returns when nothing
  // moved, so this costs one clientWidth read per render.
  fitBoard();

  // Read before the wipe: clearing the board destroys the focused hotspot and
  // drops focus to <body>, which would strand a keyboard player mid-turn.
  const active = document.activeElement;
  const focusedDir =
    active && active.classList && active.classList.contains("doorway") ? active.dataset.dir : null;

  el.innerHTML = "";

  const tile = currentTile(board);
  const edges = edgeStates(game);

  // Which half of the map you are standing in, carried on the board so the cast
  // reaches floors, walls and all fourteen scenes from one place.
  el.classList.toggle("board--indoor", board.player.world === "indoor");
  el.classList.toggle("board--outdoor", board.player.world === "outdoor");
  // The same fact told to the ear: inside is a small dark room, outside is
  // distance. Sent from here rather than from the seam crossing so that a
  // reload, a new game and the first render all land in the right space —
  // seamCross() only fires on the one move that changes world.
  setSpace(board.player.world);
  const pane = el.closest(".board-pane");
  if (pane) {
    pane.classList.toggle("pane--indoor", board.player.world === "indoor");
    pane.classList.toggle("pane--outdoor", board.player.world === "outdoor");
  }

  const view = document.createElement("div");
  view.className = "focus";

  for (const dir of DIRS) {
    const e = edges[dir];
    const slot = document.createElement("div");
    slot.className = `focus-slot focus-slot--${DIR_CLASS[dir]}`;
    if (e.state === "open" && e.neighbour) slot.appendChild(halfRoom(game, e, dir));
    // A way out with nothing placed behind it yet: the only dark on this board
    // that is a doorway rather than a wall. Marked here because this is where
    // the edge is known, and read by standing() much later.
    else if (e.kind !== "wall") slot.dataset.unopened = "";
    view.appendChild(slot);
  }

  const centre = document.createElement("div");
  centre.className = "focus-centre";
  centre.appendChild(centreRoom(game, tile, edges));
  view.appendChild(centre);

  el.appendChild(view);

  // renderBoard rebuilds .focus from scratch, so hotspots cannot be attached
  // once and kept — they are re-applied from the pending list every rebuild.
  // A wall that is mid-failure has no board state to be rebuilt from, so the
  // sequence puts its art back rather than losing it to a refresh.
  restoreBreachWall();

  if (pendingMoves.length) {
    mountDoorways(el);
    // Put focus back on the same doorway. `focusedDir` was read before the wipe
    // below cleared the board — by this point activeElement is already <body>.
    if (focusedDir) {
      const again = el.querySelector(`.doorway[data-dir="${focusedDir}"]`);
      if (again) again.focus();
    }
  }
}

// Movement choices, drawn on the doorways they refer to. Real buttons in
// N/E/S/W order inside a labelled group, so the spoken experience matches what
// the panel used to give.
function clearDoorways() {
  for (const g of document.querySelectorAll(".doorways")) g.remove();
}

function mountDoorways(boardEl) {
  const box = boardEl.querySelector(".focus-centre .tilebox");
  if (!box) return;

  const group = document.createElement("div");
  group.className = "doorways";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", movePrompt || ui(drawing, "ways-out"));

  for (const dir of DIRS) {
    const move = pendingMoves.find((m) => m.dir === dir);
    if (!move) continue;
    const hot = document.createElement("button");
    hot.type = "button";
    hot.className = `doorway ${DIR_CLASS[dir]}` + (move.primary ? " doorway--explore" : "");
    hot.dataset.dir = dir;
    hot.dataset.kind = "move";
    // The accessible name stays the full old label, so nothing regressed for a
    // screen reader when this moved off the panel.
    hot.setAttribute("aria-label", move.label);
    // The number chip is absolutely positioned into the button's corner, so it
    // stays a direct child and out of the flex flow.
    const n = pendingMoves.indexOf(move);
    if (n < 9) {
      const k = document.createElement("kbd");
      k.textContent = String(n + 1);
      k.setAttribute("aria-hidden", "true");
      hot.appendChild(k);
    }
    // The "?" that used to sit beside the arrow is gone with the button skin it
    // belonged to. Unexplored now reads from the arrow itself — the bright
    // green, and the drift only it has — so the mark is one less thing sitting
    // on top of the door.

    // The arrow points the way out, and is the whole of the control now.
    const arrow = document.createElement("span");
    arrow.className = "doorway-arrow";
    arrow.setAttribute("aria-hidden", "true");
    const chev = icon("ui", "chevron", "doorway-chev");
    if (chev) arrow.appendChild(chev);
    else arrow.textContent = ARROW[dir]; // no sprite: the text arrow still points
    // First child, so the flex direction can put it on the outward side.
    hot.insertBefore(arrow, hot.firstChild);

    hot.addEventListener("click", move.onClick);
    // Focus, not hover: a tick every time the pointer crosses a door would be
    // a fly in the room rather than an affordance.
    hot.addEventListener("focus", doorwayTick);
    group.appendChild(hot);
  }

  // Staying put, drawn where staying put happens. It gets the middle of the
  // room rather than a card in the panel for two reasons: the panel would have
  // to open alongside the doorways, which is the one combination this file
  // warns about, and a choice that lives in a different place from the others
  // stops being one of the same set of choices. The centre is nominally the
  // footprints' — they are decoration and this is not.
  const stay = pendingMoves.find((m) => m.kind === "stay");
  if (stay) {
    const hot = document.createElement("button");
    hot.type = "button";
    hot.className = "doorway doorway--stay";
    hot.dataset.kind = "stay";
    hot.setAttribute("aria-label", stay.label);
    const n = pendingMoves.indexOf(stay);
    if (n < 9) {
      const k = document.createElement("kbd");
      k.textContent = String(n + 1);
      k.setAttribute("aria-hidden", "true");
      hot.appendChild(k);
    }
    // THE WORD (#74), and this is the third pass at this control. It has been a
    // disc, then a bare mark so it would not be the only boxed thing on a board
    // of bare arrows, then footprints because the user could not SEE it — and
    // now a word, because they can see it and cannot read it. Twice running the
    // subordinate-and-unboxed constraint has lost to legibility, so a word it
    // is: louder than a mark, which is the point.
    //
    // Still not boxed, and still quieter than the arrows by COLOUR alone, which
    // is where the design has always put the subordination. No sprite to fall
    // back from any more — text IS the control now, so there is nothing left to
    // fail to load.
    const face = document.createElement("span");
    face.className = "doorway-face doorway-face--word";
    face.setAttribute("aria-hidden", "true");
    face.textContent = ui(drawing, "stay-mark");
    hot.appendChild(face);
    hot.addEventListener("click", stay.onClick);
    hot.addEventListener("focus", doorwayTick);
    group.appendChild(hot);
  }

  box.appendChild(group);
}

// ---- The scare -------------------------------------------------------------
// A full-window flash of the risen before the combat choices appear. Unlike
// animateEntry this one is *awaited* — the actions land after the fade — so it
// has to resolve in every circumstance or the turn would stall: no art, no
// Web Animations, reduced motion, all resolve immediately.
//
// The caller clears the action list before calling this, so during the flash
// there are no buttons to click and none for the global number keys to find.
// That is what stops a player mashing 1 from firing whatever appears
// underneath.
// ---- The full-screen scare: NOTHING CALLS ANY OF THIS (#97) -----------------
//
// Everything from here to the end of scareNow is unreachable as of #97, which
// took the full-screen picture out of the only path that ever ran it. The two
// names below this block that DO still have live callers are:
//
//   SCARE_TIERS / scareTier   -- announceFight reads `beats` for the hop
//                                rhythm, and packRow reads `cls` for the
//                                King's threshold picture. Both are live.
//   scare-n3..n6 (the sprite) -- creaturePanel draws them. The symbols are the
//                                creature now and are not affected by any of
//                                this.
//
// `lead` and `at` on SCARE_TIERS were read only by scareNow and are now dead
// fields on a live table.
//
// KEPT RATHER THAN DELETED, DELIBERATELY, and the decision is not mine to make
// alone: the SCARE_SLOTS note below is a dated ruling that this choreography is
// recorded nowhere else, and #97's scope — whether the full-screen scare is
// gone from every route or only from the jiangshi event — was put to the user
// and has not come back. Deleting it would answer that question by making it
// expensive to reverse. What is NOT acceptable is it sitting here unmarked,
// which is the same argument the SCARE_SLOTS note makes about itself.
const SCARE_BASE_MS = 300;

// Where each of the risen stands, in order. One face for the smallest pack, up
// to six, so a three-zombie dead end and a six-zombie card do not land
// identically. Fixed rather than random: a seeded run is meant to replay the
// same, and Math.random here would make the same fight look different twice.
// [x%, y%, scale, share of the run before it appears]
// RETIRED 2026-08-28 by #92, and kept rather than deleted.
//
// Six seats at 1.00 down to 0.58, for the picture this game used to draw: n
// jiangshi came through the wall and n faces arrived, at different distances,
// with per-slot tilt and handedness so that six of them read as a crowd rather
// than one head stamped six times. It was a good solution to that problem.
//
// That problem is gone. n is one creature's 攻擊力 now, so only INDEX ZERO is
// ever read, and the other five entries are dead. They are marked and left
// because the choreography here is not trivial and is not recorded anywhere
// else: the lead scale, the entry direction, the per-slot delays and the tilt
// table are what a crowd would need again.
//
// TO BRING IT BACK, and this got harder in #97: it used to be "read `faces`
// from something other than the constant 1 in jumpScare". jumpScare is gone —
// it became announceFight, which has no picture — so a crowd now needs
// scareNow called from somewhere as well, and something to decide that a fight
// deserves a full-screen layer when the creature panel already shows it. The
// table is still the only record of the choreography; the one-line restore is
// not.
//
// What is NOT acceptable is this table sitting unmarked while one index is
// read, because the next person to open it will conclude the crowd still
// exists and write code that expects six.
const SCARE_SLOTS = [
  [50, 50, 1.0, 0.0],
  [21, 38, 0.62, 0.1],
  [79, 43, 0.66, 0.16],
  [33, 74, 0.54, 0.22],
  [69, 76, 0.58, 0.28],
  [50, 21, 0.5, 0.34],
];

// ---- Film grain --------------------------------------------------------------
// Lives here rather than in eventstage.js because BOTH full-screen registers
// need it — the event scenes and the scare — and eventstage already imports
// from this file. Putting it the other way round would make a cycle.
//
// Film grain, and it is what makes the rest read as photographed rather than
// drawn. Rendered ONCE from a fixed seed: a grain that reseeds every frame is a
// strobe wearing a respectable name, and this project has a real guard against
// those now.
export function grain(inner, opacity) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "evs-grain");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("preserveAspectRatio", "none");
  const id = "grain-" + Math.random().toString(36).slice(2, 9);
  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id", id);
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  const turb = document.createElementNS(NS, "feTurbulence");
  turb.setAttribute("type", "fractalNoise");
  turb.setAttribute("baseFrequency", "0.9");
  turb.setAttribute("numOctaves", "3");
  turb.setAttribute("seed", "7");
  turb.setAttribute("stitchTiles", "stitch");
  filter.appendChild(turb);
  // Desaturate the noise. Coloured grain is video noise; film grain is silver.
  const mat = document.createElementNS(NS, "feColorMatrix");
  mat.setAttribute("type", "saturate");
  mat.setAttribute("values", "0");
  filter.appendChild(mat);
  svg.appendChild(filter);
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("width", "100%");
  rect.setAttribute("height", "100%");
  rect.setAttribute("filter", "url(#" + id + ")");
  rect.setAttribute("opacity", String(opacity == null ? 0.22 : opacity));
  svg.appendChild(rect);
  inner.appendChild(svg);
  return svg;
}

// ---- The four 僵屍 -------------------------------------------------------------
// Strength is HOW IT ARRIVES, not just how many faces. n runs 3 to 6 and each
// is its own staging: 白殭 is a stiff thing at the door and 飛殭 is already on
// top of you, with the grammar escalating on every axis at once — how close it
// lands, how late it commits, the rhythm of the hops, and how much the room
// gives up about it.
//
// The names are design vocabulary and never reach a player: no strings, ASCII
// class names only, per the glossary contract.
//
// `lead` is the scale the front face enters at, which is the whole of "distance
// is the tier" — under reduced motion it becomes the held scale, because that is
// the one axis that survives with no movement at all. `at` is how late the front
// face commits, as a fraction of the envelope. `beats` is the hop rhythm in
// seconds, and it is what carries the tier in calm mode where no face arrives.
//
// NO NEW TIME. Every tier plays inside SCARE_BASE_MS + weight×200, the envelope
// that was already written for this band — #33 capped the thirty-times tax and
// this does not reopen it.
const SCARE_TIERS = {
  3: { cls: "n3", lead: 0.82, at: 0.34, beats: [0, 0.26] },
  4: { cls: "n4", lead: 1.00, at: 0.22, beats: [0, 0.16, 0.32] },
  // The fourth hop lands off the grid on purpose — three even and one late is
  // the first rhythm that does not resolve, and an unresolved rhythm is the
  // sound of something that is not walking.
  5: { cls: "n5", lead: 1.16, at: 0.12, beats: [0, 0.11, 0.22, 0.30] },
  6: { cls: "n6", lead: 1.42, at: 0.00, beats: [0, 0.07, 0.14, 0.21, 0.28] },
};

// What the room gives up, by tier — restaged into the film. Cumulative on
// purpose: the lantern never comes back up, and nothing a lower tier gave away
// is taken back by a higher one.
//
// 白殭 is a GLIMPSE: backlit in a doorway, and the 符 on its brow still moving.
// 黑殭 is closer and lacquered, and the paper is gone. 跳殭 brings the hop, so
// it brings smear and a single shudder of the frame — POSITION only, never
// luminance, and once. 飛殭 fills the frame: breath on the glass and eyeshine
// that rises to a held value and stays there.
//
// The eyes GLOW and never flash, at any tier, under any gate. That is not a
// preference and there is a test on it.
const SCARE_DRESSING = {
  n3: ["dim", "backlit"],
  n4: ["dim", "backlit", "frost", "lacquer"],
  n5: ["dim", "frost", "close", "smear"],
  n6: ["dim", "frost", "close", "gutter", "breath"],
};

function scareTier(count) {
  const n = Math.max(3, Math.min(Number(count) || 3, 6));
  return SCARE_TIERS[n];
}

// Painted on whether or not the faces are coming, and aria-hidden throughout:
// the log has already said what walked in, and a second telling in the only
// channel a screen-reader player has would be noise rather than atmosphere.
function dressScare(el, tier) {
  for (const part of SCARE_DRESSING[tier.cls] || []) {
    const n = document.createElement("span");
    n.className = `scare-${part}`;
    n.setAttribute("aria-hidden", "true");
    el.appendChild(n);
  }
}

// Where they come from, when the game knows. A card fight is a pack that is
// simply there and gets the centred burst it always had; a break-in came
// through a particular wall, and the difference between "they are here" and
// "they came through THERE" is the entire reason this exists.
//
// The slots stay exactly where they were — same fixed positions, same
// determinism — and the direction is one extra transform axis on the way in:
// the faces enter from that edge of the screen rather than scaling up in place.
// How far off true each slot sits. Small: these are bodies that have stopped
// bending, so the variation is in how they are STANDING rather than in how they
// are moving, and a head at twelve degrees reads as falling over.
const FACE_TILT = [0, -5, 4, -7, 6, -3];

const SCARE_ENTRY = {
  N: [0, -34],
  S: [0, 34],
  E: [38, 0],
  W: [-38, 0],
};

// A FIGHT ANNOUNCES ITSELF IN SOUND, and then the creature is simply there.
//
// #97, the user's ruling: "for a zombie event, we don't need a full screen
// zombie step." There used to be one here — the tier's figure at full size over
// the whole window — immediately before creaturePanel put the SAME figure on
// the tile with its sentence and its attack, where it stays for the whole
// fight. The player met the creature twice and only the second one could be
// acted against. This is the first meeting, and it is now sound alone.
//
// THE SOUND IS NOT A REMNANT OF THE PICTURE. hopThud carries the tier in its
// rhythm and combatSting carries the DIRECTION, and both were written to work
// with no picture at all: combatSting's own comment says it is the cue that has
// to carry direction WHEN THE PICTURE CANNOT, because calm mode already dropped
// the faces. So this is not a new burden on the audio — it is the case the
// audio was already designed for, now the only case.
//
// duckForScare STAYS, and so does its wait. The room going quiet is the beat
// the creature arrives in, and unduck() inside fightBeat's close() is the only
// caller unduck has: stop ducking here and that becomes a restore of something
// nobody took away.
//
// `from` is passed through rather than validated. Direction is audio's fact —
// placed() maps it and falls back to centre for anything it does not know — and
// the table that used to be checked here existed to aim the faces.
//
// `silent` went with calm mode (#72): it was the only thing that ever set it,
// and the one caller has always passed false.
export function announceFight(count = 0, opts = {}) {
  const from = opts.from || null;
  // The room goes quiet first. duckForScare returns how long to wait — and
  // returns 0 when there is nothing audible to take away, so a muted player
  // waits for nothing at all. A silence nobody can hear is just a delay.
  const quiet = duckForScare();
  const fire = () => {
    const tier = scareTier(count);
    hopThud(count, from, tier.beats);
    combatSting(count, from);
    buzz([26, 50, 90]);
  };
  if (quiet > 0) {
    return new Promise((resolve) => {
      setTimeout(() => { fire(); resolve(); }, quiet);
    });
  }
  fire();
  return Promise.resolve();
}

function scareNow(count, from = null) {
  return new Promise((resolve) => {
    enterScene();
    const endScene = () => leaveScene();
    const tier = scareTier(count);
    // Same rule as the door: the cue is sound, not motion, so it plays whether
    // or not the picture does — and it plays in the tier's rhythm, which is the
    // one channel that reaches every player at every setting.
    hopThud(count, from, tier.beats);
    combatSting(count, from);
    buzz([26, 50, 90]);

    // Reduced motion used to mean no picture at all. It should mean no MOVEMENT
    // — one composition, arrived at rather than travelled to, held for the same
    // envelope. Distance is the tier, and a still frame carries distance
    // perfectly well; what it must not do is move, so the faces are placed at
    // the tier's scale and simply sit there.
    if (reducedMotion()) {
      const still = document.createElement("div");
      still.className = `scare scare--still scare--${tier.cls}`;
      still.setAttribute("aria-hidden", "true");
      dressScare(still, tier);
      const heldFaces = 1; // #92: one creature, at the lead seat. See SCARE_SLOTS.
      for (let i = 0; i < heldFaces; i++) {
        const [hx, hy, hscale] = SCARE_SLOTS[i];
        const held = icon("scare", tier.cls, "scare-art");
        if (!held) break;
        const seat = document.createElement("span");
        seat.className = "scare-face";
        seat.style.left = `${hx}%`;
        seat.style.top = `${hy}%`;
        seat.style.setProperty("--face-scale", String(hscale * (i ? 1 : tier.lead)));
        seat.appendChild(held);
        still.appendChild(seat);
      }
      grain(still, 0.24);
      document.body.appendChild(still);
      setTimeout(() => {
        still.remove();
        endScene();
        resolve();
      }, SCARE_BASE_MS + 200);
      return;
    }

    // A card fight can be followed straight away by a zombie door; never stack.
    const stale = document.querySelector(".scare");
    if (stale) stale.remove();

    if (!document.getElementById("scare-zombie")) { endScene(); return resolve(); } // no art, no hold-up

    const el = document.createElement("div");
    el.className = `scare scare--${tier.cls}`;
    el.setAttribute("aria-hidden", "true");
    dressScare(el, tier);
    document.body.appendChild(el);

    if (typeof el.animate !== "function") {
      el.remove();
      endScene();
      return resolve();
    }

    // Encounters run 3 to 6, so weight across that band rather than from zero.
    const faces = 1; // #92: one creature, at the lead seat. See SCARE_SLOTS.
    const weight = Math.min(Math.max((faces - 3) / 3, 0), 1);
    const duration = SCARE_BASE_MS + Math.round(weight * 200);

    // 跳殭's nails and 飛殭's glow belong to the thing arriving rather than to
    // the room, which is why they are here with the faces and not in the
    // dressing: calm mode takes away what is coming for you and keeps what the
    // room does about it, and a hand at the edge of the frame is the former.
    //
    // Appended before the faces so they sit under them — nails first, then the
    // face on top of them.
    if (tier.cls === "n5" || tier.cls === "n6") {
      const nails = document.createElement("span");
      nails.className = "scare-nails";
      nails.setAttribute("aria-hidden", "true");
      el.appendChild(nails);
    }
    if (tier.cls === "n6") {
      // Animal eyeshine — the flat retroreflective coin you get back from a fox
      // at the edge of a torch beam. It rises once to a held value and stays
      // there for the rest of the scene. It does not blink, and nothing in this
      // file is allowed to make it.
      const glow = document.createElement("span");
      glow.className = "scare-eyeshine";
      glow.setAttribute("aria-hidden", "true");
      el.appendChild(glow);
    }

    for (let i = 0; i < faces; i++) {
      const [x, y, scale, at] = SCARE_SLOTS[i];
      // Each tier is its own creature, not one creature scaled. 白殭 still has
      // its 符, 黑殭 is lacquered and bare, 跳殭 is grave-wax with its jaw open,
      // 飛殭 is rimed and gives light back — and that escalation has to read
      // with the dressing turned off, because at playing brightness the dressing
      // is the quieter half.
      const art = icon("scare", tier.cls, "scare-art");
      if (!art) break;
      const seat = document.createElement("span");
      seat.className = "scare-face";
      seat.style.left = `${x}%`;
      seat.style.top = `${y}%`;
      seat.style.setProperty("--face-scale", String(scale));
      // Angle and handedness per slot, so six of them is a crowd rather than
      // one head stamped six times. Indexed rather than random: a seeded run
      // has to replay to the same picture, and this is presentation reading
      // position, never rng.
      // Its own layer between the seat and the art, because both of those are
      // already animating a transform — the seat by the entry keyframes and the
      // art by 白殭's paper flutter — and a fourth writer of the same property
      // is how one of them silently wins.
      const poser = document.createElement("span");
      poser.className = "scare-pose";
      poser.style.setProperty("--face-tilt", `${FACE_TILT[i % FACE_TILT.length]}deg`);
      poser.style.setProperty("--face-flip", i % 2 ? "-1" : "1");
      poser.appendChild(art);
      seat.appendChild(poser);
      el.appendChild(seat);

      // The one in front lunges; the pack behind snaps in after it. The size
      // itself comes from --face-scale on the width, so these keyframes are a
      // relative nudge around it — multiplying by `scale` here would apply it
      // twice and leave the back row far smaller than intended.
      //
      // With a direction, they arrive from that edge instead: the same landing
      // positions, entered from off-screen on the side the wall is failing. The
      // one in front still comes in largest — it is nearest, and coming through
      // first.
      const [ex, ey] = from ? SCARE_ENTRY[from] : [0, 0];
      // The front face enters at the tier's distance; the pack behind it always
      // snaps in from just off its landing size, because they are the same
      // middle distance at every tier and only the one in front is the news.
      const lead = i ? 0.8 : tier.lead;
      const enterFrom = from
        ? `translate(calc(-50% + ${ex}vw), calc(-50% + ${ey}vh)) scale(${lead})`
        : `translate(-50%, -50%) scale(${lead})`;
      seat.animate(
        [
          { opacity: 0, transform: enterFrom },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
        ],
        {
          duration: Math.round(duration * 0.34),
          // The front face waits for the tier: 白殭 commits late and small,
          // 飛殭 is already there on frame one. The pack keeps the slot delays
          // it always had, so the shape of the burst is unchanged.
          delay: Math.round(duration * (i ? at : tier.at)),
          fill: "backwards",
          easing: "cubic-bezier(.2,.8,.3,1)",
        }
      );
    }

    // The same grain the event scenes carry, so the two full-screen registers are
    // photographed by the same camera.
    grain(el, 0.24);

    const anim = el.animate(
      [
        { opacity: 0 },
        { opacity: 1, offset: 0.16 },
        { opacity: 1, offset: 0.66 },
        { opacity: 0 },
      ],
      { duration, easing: "ease-out" }
    );
    // Resolve once, from whichever comes first. Web Animations do not advance
    // while the document is hidden, so anim.finished hangs for as long as the
    // player has the tab in the background — and the combat choices are gated
    // behind this promise, which would leave the turn frozen on their return.
    // Timers still fire when backgrounded, so one backs the animation up.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.remove();
      endScene();
      resolve();
    };
    anim.finished.then(done).catch(done);
    setTimeout(done, duration + 250);
  });
}

// ---- Sizing the board off the pane, not the viewport ------------------------
// --tile keyed on 19vh, which never saw how wide the column actually was: the
// map stayed the same size whether it had 300px of room or 900px. These
// constants mirror the CSS geometry — the focus is peek + tile + peek across
// with a gap either side — so the tile can be solved from the space available.
const FOCUS_SPAN = 1.70; // peek(.35) + tile(1) + peek(.35), in tiles
// The rooms touch, so there is no gap in the span any more. Kept as a named
// zero rather than folded away: --tile-gap still exists in the CSS for the same
// reason, and the two mirror each other — a gap reintroduced in one place and
// not the other sizes the board wrong in a way nothing here would catch.
const GAP_RATIO = 0;
const GAP_FLOOR = 0;
// How much of the pane's short side the focus claims. Was .88, which left an
// eighth of the pane empty on every side of a board that was already the thing
// the page is for. The rooms no longer float apart, so the board does not need
// air around it to stop reading as one blob — the black walls do that.
const BOARD_FILL = 0.97;
const TILE_MIN = 96;
// 1.5x the old 320. That cap, not the pane, was what limited the board on any
// reasonably sized window: at 320 the room stopped growing while the pane kept
// going, so the map sat small in the middle of its own column. On a pane with
// the height for it a room is now half again as wide and half again as tall.
const TILE_MAX = 480;
// Below this the layout is one column and the pane's height comes from its own
// content — measuring it there would feed the tile back into its own budget.
const TWO_COLUMN = "(min-width: 801px)";

export function fitBoard() {
  const pane = document.querySelector(".board-pane");
  if (!pane) return;

  const root = document.documentElement;
  if (!window.matchMedia || !window.matchMedia(TWO_COLUMN).matches) {
    // Stacked, there is nothing safe to measure: the pane's height comes from
    // its own content, so reading it would feed the tile back into its own
    // budget. And it would not help anyway — with the board above the sidebar
    // it is the sidebar that runs out of room first, not the board. Hand the
    // size back to the CSS clamp, which is what this layout has always used.
    root.style.removeProperty("--tile");
    return;
  }

  // Two columns: both axes are safe. The column is minmax(0, 1fr) so it bounds
  // the board rather than the board setting it, and the row is stretched to a
  // definite height.
  const budget = BOARD_FILL * Math.min(pane.clientWidth, pane.clientHeight);
  if (!(budget > 0)) return;

  // One regime now the rooms touch: the span is all tile. The second term and
  // the floor check below are what the gap used to need, and they fall out to
  // nothing while GAP_RATIO and GAP_FLOOR are zero — left standing so that
  // putting a gap back is a change to two constants and not to the arithmetic.
  let tile = budget / (FOCUS_SPAN + 2 * GAP_RATIO);
  if (GAP_FLOOR > 0 && tile * GAP_RATIO < GAP_FLOOR) {
    tile = (budget - 2 * GAP_FLOOR) / FOCUS_SPAN;
  }
  tile = Math.max(TILE_MIN, Math.min(TILE_MAX, Math.round(tile)));

  if (root.style.getPropertyValue("--tile") === `${tile}px`) return; // no-op writes churn layout
  root.style.setProperty("--tile", `${tile}px`);
}

export function watchBoardSize() {
  fitBoard();
  const pane = document.querySelector(".board-pane");
  if (pane && typeof ResizeObserver === "function") {
    // The pane changes size for reasons the window does not see — the sidebar
    // growing, the layout switching columns — so observe it rather than resize.
    new ResizeObserver(() => fitBoard()).observe(pane);
  }
  window.addEventListener("resize", fitBoard);
}

// Take the choices away without taking the window with them. renderActions([])
// hides the whole pop, which would take the pack row down with it — and the
// pack row is the stage the resolution beat plays on.
export function clearChoices() {
  pushIn(false);
  const el = document.getElementById("actions");
  if (el) el.innerHTML = "";
  pendingMoves = [];
  movePrompt = "";
  clearDoorways();
}

const BEAT_MS = 600;
const FLEE_BEAT_MS = 240;

// Cause, then effect: the weapon crosses the row, and the pack goes down behind
// it. The engine has already resolved by the time this runs — this only holds
// the next render back long enough for the player to see why the number moved.
export function resolveBeat(opts = {}) {
  return new Promise((resolve) => {
    // WHERE THE ENEMY IS, and after #94 that is two different places. The
    // creature panel holds it during a fight; the header row still holds the
    // King at the midnight threshold, which is a different window that does not
    // come through fightBeat and therefore has no panel.
    //
    // This used to read .packfig only, and the figures were not just the target
    // — they were the GATE. The early return below is on `!figs.length`, so
    // emptying that row would have taken the whole resolve beat with it, swing
    // included, rather than merely leaving the swing without a containing
    // block. Worth saying because it is not what it looks like from the CSS.
    const panel = document.querySelector(".creature");
    const row = panel || document.querySelector(".packrow");
    const figs = row
      ? [...row.querySelectorAll(panel ? ".creature-art" : ".packfig")]
      : [];
    // No art, no Web Animations, no motion budget — every one of these skips
    // straight to the outcome rather than stranding the turn.
    if (reducedMotion() || !figs.length || typeof figs[0].animate !== "function") {
      return resolve();
    }

    const flee = opts.mode === "flee";
    const duration = flee ? FLEE_BEAT_MS : BEAT_MS;
    let swing = null;

    if (flee) {
      // They lunge and miss. That is the whole story, and it is 240ms long.
      figs.forEach((f, i) => {
        f.animate(
          [
            { transform: "translateY(0) scale(1)", opacity: 0.9 },
            { transform: "translateY(-6px) scale(1.16)", opacity: 1, offset: 0.45 },
            { transform: "translateY(0) scale(1)", opacity: 0.9 },
          ],
          { duration, delay: i * 14, easing: "ease-out" }
        );
      });
    } else {
      swing = opts.icon ? swingArt(row, opts.icon) : null;
      if (swing) {
        swing.animate(
          [
            { transform: "translate(-40%, -50%) rotate(-46deg)", opacity: 0 },
            { transform: "translate(20%, -50%) rotate(-12deg)", opacity: 1, offset: 0.3 },
            { transform: "translate(120%, -50%) rotate(38deg)", opacity: 1, offset: 0.8 },
            { transform: "translate(150%, -50%) rotate(52deg)", opacity: 0 },
          ],
          { duration: Math.round(duration * 0.62), easing: "cubic-bezier(.3,.1,.2,1)" }
        );
      }
      // Staggered left to right so the blade appears to be what fells them.
      // No per-zombie HP fiction here: the ruleset clears the pack outright, so
      // the row simply empties.
      figs.forEach((f, i) => {
        const lead = figs.length > 1 ? i / (figs.length - 1) : 0;
        f.animate(
          [
            { transform: "translateY(0) rotate(0)", opacity: 0.9 },
            { transform: "translateY(3px) rotate(6deg)", opacity: 0.9, offset: 0.25 },
            { transform: "translateY(26px) rotate(74deg)", opacity: 0 },
          ],
          {
            duration: Math.round(duration * 0.5),
            delay: Math.round(duration * 0.24 + lead * duration * 0.24),
            fill: "forwards",
            easing: "cubic-bezier(.4,0,.7,.4)",
          }
        );
      });
    }

    // Same gate as the jump scare, and for the same reason: animations do not
    // advance while the tab is hidden, so a timer has to be able to finish the
    // beat on its own or the turn never resumes.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      // The swing has no forwards fill, so leaving it mounted would snap the
      // weapon back to full opacity and park it over the row until the next
      // render replaces the head.
      if (swing) swing.remove();
      resolve();
    };
    setTimeout(done, duration + 60);
  });
}

function swingArt(row, iconId) {
  const cut = iconId.indexOf("-");
  if (cut <= 0) return null;
  const art = icon(iconId.slice(0, cut), iconId.slice(cut + 1), "swingart");
  if (!art) return null;
  row.appendChild(art);
  return art;
}

// ---- The burial --------------------------------------------------------------
// The climax used to resolve like any other card: draw, verdict. This wraps the
// draw the way the scare wraps combat — presentation only, the engine untouched
// underneath, and it hands back in every circumstance.
//
// The Family Plot gets the full weight and the Reliquary a lighter version of
// the same shape. Both are the same beat; only the count and the tightening
// differ, because one is finding the thing and the other is finishing.
const DIG_CUTS = { graveyard: 3, temple: 2 };
const DIG_GAP_MS = 640;


export function buryBeat(kind = "graveyard") {
  const full = kind === "graveyard";
  const cuts = DIG_CUTS[kind] || 2;

  return new Promise((resolve) => {
    // The cues play even when the picture does not — the same rule the door and
    // the wall follow.
    if (reducedMotion()) {
      for (let i = 0; i < cuts; i++) setTimeout(shovel, i * DIG_GAP_MS);
      return resolve();
    }

    enterScene();
    if (full) document.body.classList.add("burying");

    const box = document.querySelector(".focus-centre .tilebox");
    const hole = document.createElement("span");
    hole.className = "grave";
    hole.setAttribute("aria-hidden", "true");
    if (box) box.appendChild(hole);

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      hole.remove();
      document.body.classList.remove("burying");
      leaveScene();
      resolve();
    };

    // Each cut deepens the ground a step, with the heart under it. Fixed
    // rhythm rather than a random one: this is the same grave every time.
    for (let i = 0; i < cuts; i++) {
      setTimeout(() => {
        shovel();
        heartbeat(full ? 1 : 0.7);
        hole.style.setProperty("--depth", String((i + 1) / cuts));
      }, i * DIG_GAP_MS);
    }
    // Timer-backed, like every awaited beat here: a hidden tab advances no
    // animations and the turn must never hang on one.
    setTimeout(done, cuts * DIG_GAP_MS + 420);
  });
}

// ---- The note in the hall ----------------------------------------------------
// A new player used to learn this game by leaving it — a link to the rulebook,
// read in a browser tab, before any of the atmosphere had started. Horror
// teaches inside the fiction, so the fiction teaches: a folded letter on the
// hall table from whoever sent you.
//
// It says only the three things that decide a run — what you are looking for,
// where it goes, and that the deck is the clock. The rulebook is still the
// reference; this is only the hook.
//
// Real text in a real dialog, not a picture of a letter: a screen reader gets
// exactly what everyone else gets.
export function showNote(note, onClose) {
  const wrap = document.createElement("div");
  wrap.className = "notecard";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-labelledby", "note-title");

  const sheet = document.createElement("div");
  sheet.className = "notesheet";

  const h = document.createElement("h2");
  h.id = "note-title";
  h.textContent = note.title;
  sheet.appendChild(h);

  for (const line of note.lines) {
    const p = document.createElement("p");
    p.textContent = line;
    sheet.appendChild(p);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn--primary notedismiss";
  close.textContent = note.dismiss;
  sheet.appendChild(close);
  wrap.appendChild(sheet);
  document.body.appendChild(wrap);

  const done = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    document.removeEventListener("keydown", onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    // Escape closes it, because a dialog that traps you is a worse first
    // impression than no dialog at all.
    if (e.key === "Escape") done();
  };
  close.addEventListener("click", done);
  document.addEventListener("keydown", onKey);
  close.focus();
  return done;
}

// ---- The pack is full ---------------------------------------------------------
// OFFER_DROP comes back from the engine unresolved on purpose: what to give up
// is a decision, and the engine does not make decisions on the player's behalf.
// This is where that decision gets asked.
//
// One button per SLOT, matching the panel — because a slot is what has to be
// freed. A talisman stack is one slot however deep, so dropping it drops the
// whole stack; that is said on the button rather than discovered afterwards.
// ---- The search reveal (#92) ----------------------------------------------------
//
// A moment in the turn that did not exist before. Searching a room used to
// resolve entirely in the narration: doSearch() writes every outcome to log(),
// #log is sr-only, and nothing else on the screen moved — so a player who
// searched a room and found nothing watched a pause and then the turn ended.
// Screen readers have had the whole story the whole time.
//
// This is not that gap patched with a caption. The panel shows the PICTURE,
// over the room it happened in, which is a thing a line of text cannot do and
// is what the item drawings are for.
//
// IT OWNS THE BEAT. It used to be doSearch's FIND_BEAT_MS, held after the pack
// had already changed. Now the reveal holds, and the caller's onDone runs after
// — so the order the player sees is: you find out, THEN the pack takes it. One
// timer, in one place, rather than a panel life racing a turn timer.
//
// Timer rather than animationend, for caption()'s reason: animations do not
// advance in a hidden tab, and a reveal that never left would sit over the
// board forever — with the turn never ending behind it, since onDone hangs off
// the same timer.
// How many times a run explains that a layer over the board is dismissed. It
// lives here rather than in eventstage.js so there is ONE number and the stage
// imports it. The BUDGETS stay separate on purpose: the stage's hint teaches an
// optional skip, this one teaches a REQUIRED click, and letting either starve
// the other would leave the more necessary lesson untaught.
export const HINT_TIMES = 2;

let revealDone = null;
let revealHintsLeft = HINT_TIMES;
let revealTeardown = null;

// Reset per run, beside the stage's own reset, so a second night explains
// itself again to whoever picked the game up in between.
export function resetRevealHint() {
  revealHintsLeft = HINT_TIMES;
}

// ENDING A REVEAL IS ONE OPERATION, and it has to be, because the CALLBACK carries
// the turn. It is refresh() and renderEndTurn() for a found item, so
// removing the element and leaving anything pending would fire the rest of the
// turn later — into whatever had replaced it. A player quick enough to click a
// doorway while the panel is still up would advance the turn twice and be the
// least likely person to be believed reporting it.
//
// So: unbind, remove and complete together, exactly once. Pre-empting a reveal
// FINISHES it rather than abandoning it — the pack still lands and the turn
// still ends — because dropping the callback would leave the find unpainted and
// the end-turn control unrendered.
function endReveal() {
  if (revealTeardown) {
    const off = revealTeardown;
    revealTeardown = null;
    off();
  }
  for (const el of document.querySelectorAll(".reveal")) el.remove();
  const fn = revealDone;
  revealDone = null;
  if (fn) fn();
}

// For anything that is about to take the space over the tile. One layer over
// the board at a time.
// MORE reachable since #96, not less. While the reveal waited 1300ms this was a
// narrow race; now that it waits indefinitely, a player who ignores it and
// clicks a doorway instead is an ordinary way to play rather than a fast
// finger. The event stage calls this, and the reveal completes on the way past.
export function clearRevealPanel() {
  endReveal();
}

// NOT searchReveal any more. The 神主牌 takes this panel too, and the rite that
// hands it over is not a search -- a function named for one caller is a comment
// that lies as soon as there are two.
//
// opts is either { id } for something out of the pack, or the three pieces
// directly -- { sym, name, blurb } -- for something that is not an item. The
// tablet is the whole reason for the second form: it has no entry in items.json
// on purpose, because it is the object of the night rather than a thing you
// carry, and it must not become one just to be shown.
export function revealPanel(game, opts, onDone) {
  const done = typeof onDone === "function" ? onDone : () => {};
  const pane = document.querySelector(".board-pane");
  if (!pane) return void done();

  // Finishes any reveal still standing, callback and all, before starting this
  // one. Two cannot overlap in a turn as the game stands, but the invariant is
  // cheaper to hold than to reason about each time.
  endReveal();

  const o = opts || {};
  const id = o.id;
  // WHAT IS BEING SHOWN, resolved once. An item answers all three from the
  // sources the pack tooltip already reads, so the panel and the cell cannot
  // drift apart; a caller with no id hands them over itself.
  const sym = o.sym || (id ? ["item", id] : null);
  const name = o.name || (id ? itemName(game, id) : ui(game, "reveal-nothing"));
  // The description the ruling asked for, from itemBlurbs -- whose own _note
  // says these are "said when the thing is found", which is exactly this moment
  // and was until now the one place they were never said. The equipment slot
  // reads the same map under the same "relic" key for the tablet.
  const blurb = o.blurb != null ? o.blurb
    : (id ? (game.data.theme.itemBlurbs || {})[id] || "" : "");

  const el = document.createElement("div");
  el.className = "reveal" + (sym ? "" : " reveal--none") + (o.cls ? " " + o.cls : "");

  // NOT aria-hidden, and that is a decision rather than an inheritance. It was
  // hidden while it dismissed itself, on caption()'s reasoning: log() had
  // already narrated the outcome and a panel that announced itself would say it
  // twice. THAT REASONING DOES NOT SURVIVE THE PANEL BLOCKING. A screen reader
  // user, told what they found and then facing a silent panel that holds the
  // turn until it is clicked, has no way to learn that a click is owed.
  //
  // So it is a control, and its accessible name is the ACTION rather than the
  // item: a button announces its label and not its contents, so the find is not
  // said a second time. It takes focus for the same reason, so the way out is
  // under the keyboard as well as under the cursor.
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", ui(game, "reveal-go"));

  const frame = document.createElement("div");
  frame.className = "revealframe";
  const art = sym ? icon(sym[0], sym[1], "revealicon") : null;
  if (art) frame.appendChild(art);
  el.appendChild(frame);

  const nameEl = document.createElement("p");
  nameEl.className = "revealname";
  // Nothing chosen here varies. The empty-handed LINE varies by turn and stays
  // in the narration where it lives; the panel says the same words every time,
  // so a replayed seed shows the same reveal in the same room without the
  // search stream being touched for flavour.
  nameEl.textContent = name;
  el.appendChild(nameEl);

  // 武器顯示攻擊力 (#92). The number the decision is actually made on: a player
  // holding a 1 and finding a 3 should not have to remember which is which, and
  // the drop dialog already asks them to choose between pictures.
  //
  // Taken from the SAME PLACE the pack tooltip and the replace prompt take it,
  // through itemEffect, rather than reading def.attack and formatting it here.
  // That is what keeps 攻擊力 3 and "attack 3" the same fact rather than two
  // strings that agree until one of them is edited. It follows the same split
  // the rest of the game uses: a weapon IS its attack, a talisman fights AT
  // one, and the theme keeps separate wording for each.
  const def = id ? (game.state.itemsById || {})[id] : null;
  if (def && def.attack != null) {
    const stat = document.createElement("p");
    stat.className = "revealstat";
    stat.textContent = fill(
      ((game.data.theme.effects || {})[def.cat === "weapon" ? "weapon-attack"
                                                           : "talisman-attack"]) || "",
      { n: def.attack });
    if (stat.textContent) el.appendChild(stat);
  }

  if (blurb) {
    const b = document.createElement("p");
    b.className = "revealblurb";
    b.textContent = blurb;
    el.appendChild(b);
  }

  // IT WAITS FOR THE PLAYER NOW (#96) rather than timing out. The timer used to
  // be a safety net: whatever happened, 1300ms later the turn moved on. With it
  // gone the way out is the ONLY way out, so there are TWO of them, taken from
  // the event stage rather than invented again. A click anywhere on the panel,
  // and any key. A failure of one is not a dead game.
  //
  // The key handler is the stage's, down to the parts that are not obvious:
  // modified keys are left alone, Tab still walks the page rather than being
  // trapped, and it listens in CAPTURE so this is dismissed before any
  // page level shortcut sees the key. M for mute in particular must not fire
  // while "press anything" is the way forward.
  const onClick = () => endReveal();
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Tab") return;
    // Swallowed rather than merely handled: the end turn control is mounted the
    // moment this resolves, and a keyup arriving after that could land on a
    // button that did not exist when the key went down.
    e.preventDefault();
    e.stopPropagation();
    endReveal();
  };
  revealTeardown = () => {
    window.removeEventListener("keydown", onKey, true);
    el.removeEventListener("click", onClick);
  };
  window.addEventListener("keydown", onKey, true);
  el.addEventListener("click", onClick);

  // THE HINT, BACK (#92), on the rule it always had: twice a run and then not
  // again. It was removed for an hour by "don't show tap to continue" and
  // restored by "好吧 加上 Tap to continue" -- the words were asked for back,
  // the POLICY was never overturned, so the twice-per-run machinery is
  // unretired rather than replaced by something permanent. Furniture in the
  // middle of the board thirty times a night is still worse than a hint that
  // teaches and stops.
  //
  // IT IS NOT THE ACCESSIBLE NAME, and the two must not be wired together
  // however identical the words are. They were briefly the same string, and
  // switching the visible one off took the name with it: a blocking button that
  // announced nothing. The name is set above, unconditionally, from the same
  // key and by its own line.
  if (revealHintsLeft > 0) {
    revealHintsLeft--;
    const hint = document.createElement("p");
    hint.className = "revealhint";
    hint.textContent = ui(game, "reveal-go");
    // Said once, not twice: the panel's own name already carries these words.
    hint.setAttribute("aria-hidden", "true");
    el.appendChild(hint);
  }

  pane.appendChild(el);
  revealDone = done;
  el.focus({ preventScroll: true });
}

export function showDropDialog(game, foundId, opts = {}) {
  const s = game.state;
  const wrap = document.createElement("div");
  // inkcard/inksheet, NOT dropcard/notesheet, and the split is the point of
  // #98. .notesheet is parchment — cream gradient, dark text, a radius and a
  // shadow — which is right for showNote, because a letter IS paper and the
  // metaphor is doing real work there. Every panel built since #92 is the
  // opposite: dark ink over the room, sized against the board, no frame. This
  // dialog was the last thing wearing the old skin.
  //
  // The classes are deliberately GENERIC so showCinnabarDialog can follow by
  // swapping one string. It is NOT swapped here: that is the user's call and
  // not a tidy-up to slip into this issue.
  wrap.className = "notecard inkcard";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  // NAMED WITHOUT A HEADING, the same split revealPanel makes between what is
  // drawn and what is announced. The visible "You found {item}" is gone
  // because the reveal a second ago said exactly that, at size — but the
  // reveal is DISMISSED by the time this opens, so a screen reader user
  // arriving here would have nothing left telling them which item this is
  // about. So the heading's words become the dialog's accessible name.
  wrap.setAttribute("aria-label", ui(game, "drop-title", { item: itemName(game, foundId) }));

  const sheet = document.createElement("div");
  sheet.className = "inksheet packsheet";

  // THE ASK, IN ONE BAND. This was a heading naming the find, a lede, and then
  // a 74px hero cell of the find with its name under it — three restatements
  // of the panel the player had just been shown and tapped away. The user's
  // ruling was that it is too big; the size was duplication rather than
  // typography, and no font is touched here.
  //
  // The find itself STAYS, as a cell, and that is a kept decision rather than
  // an oversight: it is drawn the same way as the things it is being weighed
  // against, because the question is a comparison and a different idiom on one
  // side of it makes the comparison harder. What goes is its restatement in
  // words, twice, and the vertical stack that put it in its own storey.
  const ask = document.createElement("div");
  ask.className = "dropask";

  const found = document.createElement("div");
  found.className = "cell dropfound";
  const foundFace = document.createElement("div");
  foundFace.className = "cellface";
  const foundArt = icon("item", foundId, "cellicon");
  if (foundArt) foundFace.appendChild(foundArt);
  found.appendChild(foundFace);
  ask.appendChild(found);

  const lede = document.createElement("p");
  lede.className = "dropq";
  lede.textContent = ui(game, "drop-lede");
  ask.appendChild(lede);
  sheet.appendChild(ask);

  // #94: THE PACK, AS THE PACK. This was a list of text buttons — "Drop 糯米",
  // "Drop 五雷符 ×3" — under a picture of the find, which made the player read
  // four sentences to answer a question about five objects. The question is
  // "which of these do I give up for that one", so it is asked between
  // PICTURES, in the same cells the pack itself is drawn in, with the name and
  // what it does arriving on hover and on tap exactly as they do there.
  //
  // The count badge is doing work the prose used to: a stack shares one slot,
  // so dropping one of three frees nothing and the whole stack goes down. "×3"
  // on the cell says that better than a sentence explaining it.
  // Built before the cells so their handlers can close over it. aria-live, so a
  // keyboard user hears each item as they tab across — the same moment a mouse
  // user sees it.
  const detail = document.createElement("div");
  detail.className = "dropdetail";
  detail.setAttribute("aria-live", "polite");
  const detailName = document.createElement("p");
  detailName.className = "dropdetailname";
  const detailEffect = document.createElement("p");
  detailEffect.className = "dropdetaileffect";
  detail.appendChild(detailName);
  detail.appendChild(detailEffect);
  // IT OPENS SAYING WHAT YOU ARE DECIDING FOR. The storey is reserved either
  // way, so an empty default spent a sixth of a panel the user had just asked
  // to be smaller on nothing. The find is otherwise only a picture — the words
  // naming it were what #98 cut as duplication of the reveal — so this is where
  // they earn their place back: not restating the reveal, but standing as the
  // other half of the comparison every cell is being weighed against.
  const restoreFound = () => {
    detailName.textContent = itemName(game, foundId);
    detailEffect.textContent = itemEffect(game, foundId) || "";
  };
  restoreFound();

  // 點兩下 — 先顯示，再確認 (#98). WHICH CELL IS ARMED, held for the whole
  // dialog rather than per cell, because arming one has to disarm the others
  // and no cell can know about its siblings.
  let armed = null;
  const disarm = () => {
    if (!armed) return;
    armed.classList.remove("dropcell--armed");
    const face = armed.querySelector(".cellface");
    if (face) face.setAttribute("aria-pressed", "false");
    armed = null;
    // Back to the find, so the storey never goes blank and never keeps naming
    // an item that is no longer the one under consideration.
    restoreFound();
  };

  const list = document.createElement("div");
  list.className = "droppack";
  // One entry per slot, deduplicated the way the panel is: a stack appears once.
  const seen = new Set();
  for (const id of slotRows(s)) {
    const def = s.itemsById[id] || {};
    const stacked = def.cat === "magic";
    if (stacked && seen.has(id)) continue;
    seen.add(id);
    // COUNT ONLY WHERE COUNTING MEANS A SLOT. heldCount is the total held, but
    // only magic stacks share a slot -- three rice are three cells. Using the
    // raw total put "x2" on BOTH rice cells, which reads as four rice in a pack
    // holding two. This is the pack's own rule and packCell states it the same
    // way; getting it wrong here would have made this dialog disagree with the
    // panel it is drawn to look like.
    const n = stacked ? heldCount(s, id) : 1;
    const whole = stacked && n > 1;
    const nm = itemName(game, id);
    const effect = itemEffect(game, id);

    const cell = document.createElement("div");
    cell.className = "cell dropcell";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cellface";
    // The visible name went into the tooltip, so the spoken one has to stay on
    // the control — and it still says what pressing this DOES, because a cell
    // that only names an item would not tell you it is the thing being given up.
    btn.setAttribute("aria-label", whole
      ? ui(game, "drop-stack", { item: nm, n })
      : ui(game, "drop-one", { item: nm }));
    // ARMED IS SPOKEN AS PRESSED, so the two-tap state reaches a screen reader
    // with no new string in either language — which was the constraint. The
    // detail region is aria-live, so the first tap also reads out the name and
    // the effect: exactly the 先顯示 half, in the channel that has no hover.
    btn.setAttribute("aria-pressed", "false");
    const art = icon("item", id, "cellicon");
    if (art) btn.appendChild(art);
    if (n > 1) {
      const badge = document.createElement("span");
      badge.className = "cellcount";
      badge.textContent = `×${n}`;
      badge.setAttribute("aria-hidden", "true");
      btn.appendChild(badge);
    }
    cell.appendChild(btn);

    // A RESERVED LINE, NOT A FLOATING TIP, and this is the third answer to the
    // same question rather than a preference.
    //
    // #94 gave these cells the pack's own .celltip. In the sidebar that opens
    // upward, which is right because the pack sits low in a tall panel. Here it
    // covered the find, so #94 flipped it downward — and downward covered
    // "leave it where it is", the way OUT, which is worse. #98 moved the find
    // up beside the question, freeing the space above the cells, and I measured
    // the result: the tip stops covering the leave button and starts covering
    // the find again. Both victims come from one cause — a floating box inside
    // a modal this small has nowhere to land that is not on top of something.
    //
    // So the detail gets its own storey below the cells, its height reserved so
    // nothing moves when it fills. Nothing can be covered because nothing
    // overlaps, and that is a property of the layout rather than a position
    // that has to keep being re-chosen.
    const say = n > 1 ? `${nm} ×${n}` : nm;
    const show = () => {
      detailName.textContent = say;
      detailEffect.textContent = effect || "";
    };
    // HOVER AND FOCUS REVEAL. THEY DO NOT ARM, and that distinction is the
    // safety property rather than a detail of it.
    //
    // I built the other version first — hover arms, so on a pointer device the
    // click finds the cell already armed and desktop keeps its single click. It
    // measured correctly on every case I had written down and it was still
    // wrong. HOVER IS NOT AN INTENTIONAL ACT: you hover things by moving the
    // cursor across them on the way somewhere else, so a confirm satisfied by
    // hovering is not a confirm. That design reproduced one-click destruction
    // on desktop while looking like it had fixed it.
    const arm = () => {
      if (armed === cell) return;
      disarm();
      armed = cell;
      cell.classList.add("dropcell--armed");
      btn.setAttribute("aria-pressed", "true");
      show();
    };
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("focus", show);

    // 點兩下 — 先顯示，再確認. The user's ruling, and the reason it holds on
    // EVERY input device rather than only on touch is that this control
    // DESTROYS SOMETHING THE PLAYER CANNOT GET BACK. An arm-then-confirm on an
    // irreversible action is a safety property, not a touch affordance, and it
    // is worth one extra click on any device. Touch is what made the gap
    // visible — there is no hover on a phone, so a player had no way at all to
    // read an item before losing it — but it was never the whole of it. The
    // sidebar has said for a long time that a tap must REVEAL rather than act;
    // this dialog was the one place that acted.
    //
    // A SECOND TAP ON THE SAME CELL COMMITS. A tap on a DIFFERENT cell moves
    // the arming rather than committing, so a mis-aim costs nothing — which is
    // the case worth being careful about and the reason this is compared
    // against the CELL rather than against a boolean.
    //
    // NOT BRANCHED ON POINTER CAPABILITY, and the testing argument is the
    // smaller half of why. A second flow taken only on hardware the suite is
    // not running on is a branch no guard can reach. The larger half is that
    // there is nothing about owning a mouse that makes destroying an item
    // safer.
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (armed !== cell) { arm(); return; }
      done();
      // A stack shares one slot, so dropping one of three frees nothing. Put
      // the whole stack down, then take the find through the ordinary door.
      if (whole) opts.onDropStack && opts.onDropStack(id, n, foundId);
      else opts.onDrop && opts.onDrop(id, foundId);
    });
    list.appendChild(cell);
  }
  sheet.appendChild(list);
  sheet.appendChild(detail);
  // A tap anywhere that is not a cell puts the armed one down again. The cells
  // stopPropagation, so reaching this listener means the tap missed them.
  wrap.addEventListener("click", disarm);

  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn dropleave";
  leave.textContent = ui(game, "drop-leave");
  sheet.appendChild(leave);

  wrap.appendChild(sheet);
  document.body.appendChild(wrap);

  const done = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    // Escape leaves it. Declining a find is a legal answer, so the dialog does
    // not trap you into taking one.
    if (e.key === "Escape") {
      done();
      if (opts.onLeave) opts.onLeave(foundId);
      return;
    }
    // FOCUS CONTAINMENT, which this dialog did not have. It set initial focus
    // and listened for Escape, and that is not the same thing: Tab walked
    // straight out into the board behind the scrim, onto doorways and pack
    // cells that are covered, unclickable and still in the tab order. A
    // keyboard user could leave a modal without answering it and land on
    // controls they cannot see.
    //
    // Escape is deliberately still a way out — declining is a legal answer —
    // so this contains the ring rather than trapping the user.
    if (e.key !== "Tab") return;
    const stops = [...wrap.querySelectorAll("button")].filter((b) => !b.disabled);
    if (!stops.length) return;
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    if (document.activeElement === edge || !wrap.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
    }
  };
  leave.addEventListener("click", () => {
    done();
    if (opts.onLeave) opts.onLeave(foundId);
  });
  document.addEventListener("keydown", onKey);
  const first = list.querySelector("button");
  (first || leave).focus();
  return done;
}

// ---- Film stock --------------------------------------------------------------
// Grain and dust, mounted once into the board pane and then left alone. Both
// are decoration in the strictest sense: aria-hidden, pointer-events none, and
// nothing in the game ever reads them.
//
// Fixed mote positions rather than random ones, the same house rule the wall
// dust and the scare faces follow — a shared seed should look the same twice,
// and dust that reshuffles on every render reads as a glitch.
const MOTES = [
  // [x%, y%, drift x, drift y, seconds, delay]
  [38, 62, 22, -52, 15, 0],
  [55, 70, -18, -60, 19, 2.5],
  [46, 55, 30, -40, 13, 6],
  [62, 58, -26, -48, 17, 9],
  [44, 72, 14, -66, 21, 12],
  [58, 48, -20, -34, 16, 4.5],
];

export function mountFilmStock() {
  const pane = document.querySelector(".board-pane");
  if (!pane || pane.querySelector(".grain")) return;

  const grain = document.createElement("div");
  grain.className = "grain";
  grain.setAttribute("aria-hidden", "true");
  pane.appendChild(grain);

  if (reducedMotion()) return; // grain holds a frame; dust does not belong at all

  const motes = document.createElement("div");
  motes.className = "motes";
  motes.setAttribute("aria-hidden", "true");
  for (const [x, y, dx, dy, dur, delay] of MOTES) {
    const m = document.createElement("i");
    m.style.setProperty("--x", `${x}%`);
    m.style.setProperty("--y", `${y}%`);
    m.style.setProperty("--dx", `${dx}px`);
    m.style.setProperty("--dy", `${dy}px`);
    m.style.setProperty("--dur", `${dur}s`);
    m.style.setProperty("--delay", `${delay}s`);
    motes.appendChild(m);
  }
  pane.appendChild(motes);
}

// ---- The stage ---------------------------------------------------------------
// One owner for "which cinematic state are we in". Both tricks here are cheap
// individually and awful together if they disagree — bars sliding out while a
// second set-piece is still running, a push-in released by the wrong window.
// So the state lives in one place and nothing else touches the classes.
//
// Set-pieces nest: a jump scare happens inside a zombie-door sequence, and a
// verdict can land while a fight is still unwinding. Counted rather than
// boolean, so the bars leave when the LAST scene ends rather than the first.
let sceneDepth = 0;

export function enterScene() {
  sceneDepth++;
  document.body.classList.add("staged");
}

export function leaveScene() {
  sceneDepth = Math.max(0, sceneDepth - 1);
  if (sceneDepth === 0) document.body.classList.remove("staged");
}

// Belt and braces for the paths that end a run: whatever was on stage, the
// curtain comes down.
export function clearStage() {
  sceneDepth = 0;
  document.body.classList.remove("staged");
  document.body.classList.remove("pushing");
}

// The board creeps toward you while a decision is open. Slow enough not to
// read as motion, present enough to read as pressure — and released quickly,
// because the relief is the point.
export function pushIn(on) {
  document.body.classList.toggle("pushing", !!on && !reducedMotion());
}

// ---- The unseen --------------------------------------------------------------
// A sound from a direction with nothing behind it, and sometimes something
// crossing a room you are only half looking at.
//
// Deliberately NOT narrated: log() is not called here and the elements are
// aria-hidden. A screen-reader player gets an honest game, because a live
// region that cries wolf is not atmosphere, it is a lie in the only channel
// they have.
export function phantom(dir) {
  phantomScratch(dir);
  if (reducedMotion()) return;

  // If a neighbour happens to lie that way, something passes through it.
  const half = document.querySelector(`.halfroom--${DIR_CLASS[dir]}`);
  if (!half || half.querySelector(".passing")) return;
  const shade = document.createElement("span");
  shade.className = "passing";
  shade.setAttribute("aria-hidden", "true");
  half.appendChild(shade);
  setTimeout(() => shade.remove(), 2600);
}

// ---- Someone standing --------------------------------------------------------
// The phantom escalated: not a shadow crossing a glimpse but a figure in the
// dark of a door nobody has opened yet. It changes nothing, blocks nothing, and
// is never spoken — a screen reader is told about the room, not about this,
// because a narrated ghost is a fact and this is not one.
//
// It leaves the way it arrived: by the board being rebuilt. No fade. Fades are
// how an interface withdraws something; absence is how a thing that was there
// stops being there, and the difference is the whole effect.

export function standing() {
  if (reducedMotion()) return false; // it does not move, but the shock does

  // Only the dark. A slot with a half-room in it is a room you can see into and
  // reason about, and putting a figure there would be information; an empty
  // slot is a door with nothing behind it yet.
  const dark = [...document.querySelectorAll(".focus-slot[data-unopened]")].filter(
    (slot) => !slot.querySelector(".standing")
  );
  if (!dark.length) return false;

  // Which one is not a decision — every empty slot is equally nothing — so the
  // first is as good as any, and picking without a die keeps this out of every
  // rng in the file.
  const shape = icon("scene", "standing", "standing");
  if (!shape) return false;
  shape.setAttribute("aria-hidden", "true");
  dark[0].appendChild(shape);

  // A floor under the "next render", because a player who sets the phone down
  // would otherwise leave it standing there until they came back, and a figure
  // you can study is a sprite. Removed outright — no transition on this element
  // for one to run.
  setTimeout(() => shape.remove(), 9000);
  return true;
}

// ---- The candle gutters ------------------------------------------------------
// The light nearly dies. It means nothing, which is exactly why it works: this
// game's cues are honest, so the one that carries no information is the one
// that makes the room untrustworthy rather than the game unfair.
//
// Driven entirely through the light model — one multiplier, three dials — so
// the vignette, the glow and the peeked half-rooms sag together. That is what
// separates "the candle is failing" from "an element is animating".

const GUTTER_MS = 1100;
const GUTTER_MS_CALM_MOTION = 1800; // the reduced-motion shape is slower
let guttering = false;

// A gutter is 800ms during which room names are below the contrast floor. That
// is affordable while the player is reading, and not affordable while they are
// choosing: if a decision is on screen, the light stays up.
function decisionPending() {
  // All of them, not the first: querySelector would answer for whichever pop
  // happens to come first in the document and miss a second one standing open.
  for (const pop of document.querySelectorAll(".actions-pop")) {
    if (!pop.hidden) return true;
  }
  const focused = document.activeElement;
  // Note what this does NOT gate on: doorways merely being present. They are
  // present for most of every turn, and gating on that would mean the candle
  // never gutters at all. A doorway with focus on it is someone mid-choice; a
  // doorway on screen is just the room.
  return !!(focused && focused.closest && focused.closest(".doorway, .actions-pop"));
}

export function candleGutter() {
  // The sound goes either way. It is not motion, it costs no readability, and
  // a player who cannot see the flame fail should still hear it.
  wickHiss();
  if (guttering || decisionPending()) return;

  const body = document.body;
  if (!body) return;
  guttering = true;
  body.classList.add("guttering");
  // Timer-backed rather than animationend: a hidden tab does not advance
  // animations, and a class that only comes off when the animation finishes
  // would leave the room dark for as long as the player is away.
  setTimeout(() => {
    body.classList.remove("guttering");
    guttering = false;
  }, (reducedMotion() ? GUTTER_MS_CALM_MOTION : GUTTER_MS) + 60);
}

// ---- The wall failing, in stages -----------------------------------------------
// A wall in a film does not become a hole. It takes a knock, then a harder one,
// then it cracks, then something comes through it, and only then does it fall.
// The game already had those moments — a telegraph knock, a scare, a fight, a
// 460ms burst — but nothing joined them up, so it read as three unrelated
// effects and an instant hole.
//
// This is the sequence owner, the same shape the burial has: one module that
// knows every stage, so the stages can share state (which wall, how far gone)
// and so tearing the whole thing down is one call rather than five.
//
// The wall it stages on is a PREDICTION. pickZombieDoorWall is a pure read and
// can be asked early, but fleeing moves the answer — so nothing here punches
// state, and stage five re-anchors the whole sequence onto whatever wall the
// board actually chose. Never punch state early; stage on the guess.

const breakIn = {
  dir: null,
  el: null, // the falling-debris strip, only during the collapse
  // Which wall art is standing in for the wall right now. No board state says
  // "cracked" — the board only knows walls and holes — so this is the sequence
  // remembering what it put there, and renderBoard puts it back after a
  // re-render rather than losing it mid-fight.
  wall: null, // "wall-cracked" | "wall-breached" | null
  grasping: false, // whether the arms should still be reaching after a render
};

// The stage names are the phases of the turn, not the frames of an animation:
// telegraph runs while the card resolves, cracks as the sting lands, pressure
// for as long as the choice is open, collapse on resolution.
// The wall art, standing where an edge mark would. Built and placed exactly
// like every other one — same class, same rotation — so a cracked north wall
// and a cracked east wall need no separate geometry.
// Indoors the wall is lime plaster over mud brick; outdoors it is a hedge. The
// sequence names the stage ("cracked", "breached") and this decides what is
// doing the cracking, read off the tile the player is standing on rather than
// threaded through six call sites.
function breachFamily() {
  const box = document.querySelector(".focus-centre .tilebox");
  return box && box.classList.contains("world--outdoor") ? "hedge" : "wall";
}

function mountBreachWall(dir, symbol) {
  const box = document.querySelector(".focus-centre .tilebox");
  if (!box) return null;
  symbol = symbol.replace(/^(wall|hedge)-/, `${breachFamily()}-`);
  const old = box.querySelector(".edgemark--breach");
  if (old) old.remove();
  const wrap = document.createElement("span");
  wrap.className = `edgemark ${DIR_CLASS[dir] || "n"} edgemark--breach`;
  wrap.setAttribute("aria-hidden", "true"); // describeRoom says it in words
  const art = icon("edge", symbol, "edgeart");
  if (!art) return null;
  wrap.appendChild(art);
  box.appendChild(wrap);
  return wrap;
}

// Called at the end of every board render: the fight is still on, so whatever
// the wall was doing it should still be doing.
function restoreBreachWall() {
  if (!breakIn.dir || !breakIn.wall) return;
  const wrap = mountBreachWall(breakIn.dir, breakIn.wall);
  // And still reaching. Without this the arms come back frozen after any
  // mid-fight render — a heal, anything that refreshes the board —
  // which is a wall that stopped being attacked while the fight is still on.
  if (wrap && breakIn.grasping && !reducedMotion()) wrap.classList.add("edgemark--grasping");
}

// The debris strip. Only the falling pieces live here now — the cracks are the
// wall art above, which is a sprite on the edge grid rather than four rotated
// divs pretending to be one.
function breachEl(dir) {
  const box = document.querySelector(".focus-centre .tilebox");
  if (!box) return null;
  const el = document.createElement("span");
  el.className = `breach breach--${DIR_CLASS[dir] || "n"}`;
  el.setAttribute("aria-hidden", "true");
  box.appendChild(el);
  return el;
}

// Stage 1 — while the card resolves. Two knocks, the second harder and late
// enough to be a second knock rather than an echo.
export function breakInTelegraph(dir) {
  breakIn.dir = dir;
  telegraphWall(dir);
  // The pause is the point. One knock is a noise; a knock, a gap, and a harder
  // knock is something working at it.
  setTimeout(() => telegraphWall(dir, 1.35), 620);
}

// Stage 2 — the sting lands and the wall is visibly losing. In calm mode this
// does nothing at all: the stages collapse back to the single burst at the end,
// which is what calm mode promised.
export function breakInCracks(dir) {
  breakIn.dir = dir || breakIn.dir;
  breakIn.wall = "wall-cracked";
  // The sound of it cracking, panned to the wall. Plays under calm mode too —
  // the branch above returns before this, so calm gets the cracked picture and
  // the cracks are all it gets; the splintering belongs to the full sequence.
  splintering(breakIn.dir, 3);
  const wrap = mountBreachWall(breakIn.dir, breakIn.wall);
  if (wrap && !reducedMotion()) wrap.classList.add("edgemark--cracking");
}

// Stage 3 — the window is open and you are choosing a weapon. The wall stays
// cracked and pounds faintly. Pressure, not an event: nothing here resolves,
// interrupts, or asks for a frame of the player's time.
// Stage three — the hands. Between the cracks and the collapse, arms come
// through and stay there for the length of the fight, which is the single most
// iconic image this game did not have. Pressure, not an event: nothing here
// resolves, interrupts, or asks for a frame of the player's time.
//
// Calm mode keeps the cracked wall and nothing else. Reduced motion gets the
// arms but not the grasping — they are through the wall either way, and that is
// the fact; the reaching is the decoration.
export function breakInPressure() {
  if (!breakIn.dir) return;
  breakIn.wall = "wall-breached";
  breakIn.grasping = true;
  // Coming through costs the wall more of itself, and then it is worked on for
  // as long as the choice is open. The pounding is held — every exit from the
  // fight stops it, and muting frees it — because a wall still being hit after
  // the fight is over is the failure mode a held cue always has.
  splintering(breakIn.dir, 5);
  startPounding(breakIn.dir);
  const wrap = mountBreachWall(breakIn.dir, breakIn.wall);
  if (wrap && !reducedMotion()) wrap.classList.add("edgemark--grasping");
}

// Stage 5 — they followed you. The prediction was wrong, so the whole sequence
// moves: a fast knock and a crack in the room you actually reached, and then
// the collapse happens there.
export function breakInReanchor(dir) {
  breakIn.dir = dir;
  if (reducedMotion()) return Promise.resolve();
  breakInCracks(dir);
  telegraphWall(dir, 1.2);
  // Short — this is a catch-up, not a second telegraph. The player has already
  // had the slow version once this turn.
  return new Promise((resolve) => setTimeout(resolve, 340));
}

// Stage 4 — the collapse. The old animateBreakIn was one 460ms burst on the
// hole art; this widens the cracks first, drops the section in two pieces, and
// only then lets the hole settle in behind it.
export function breakInCollapse(dir) {
  freshHole = dir;
  stopPounding();
  breakThrough();
  // They are not behind anything now. The murmur opens up and steps to the
  // loudest it is ever allowed to be — the one moment the mix reserves that
  // headroom for.
  floodMurmur();
  if (reducedMotion()) {
    breakIn.dir = dir;
    breakInClear();
    return animateBreakIn(dir, { quiet: true }); // the single burst, as before
  }

  // The overlay from stage two is usually gone by now: opening the hole
  // re-renders the board, and renderBoard rebuilds .focus from nothing. So the
  // one that is still standing is only reusable if it survived the render AND
  // is on the wall that actually gave — a prediction that turned out wrong has
  // to be dropped, not collapsed.
  if (!(breakIn.el && breakIn.el.isConnected && breakIn.dir === dir)) {
    if (breakIn.el) breakIn.el.remove();
    breakIn.el = breachEl(dir);
  }
  breakIn.dir = dir;
  breakIn.wall = null; // the wall is going; nothing to restore after this
  breakIn.grasping = false;

  // They pull it down: the arms withdraw an instant before the section goes,
  // which is the difference between the wall failing and the wall being pulled.
  const arms = document.querySelector(".edgemark--breach");
  if (arms) {
    arms.classList.remove("edgemark--grasping", "edgemark--cracking");
    arms.classList.add("edgemark--pulling");
  }

  const el = breakIn.el;
  if (el) {
    el.classList.add("breach--failing");
    // Two chunks, falling inward at different rates — one piece reads as a
    // panel sliding, two read as masonry.
    for (const lead of [0, 1]) {
      const chunk = document.createElement("b");
      chunk.style.setProperty("--lead", String(lead));
      el.appendChild(chunk);
    }
    setTimeout(() => breakInClear(), 620);
  }
  // The burst underneath it, after the pieces have started to go: the hole is
  // what is left when the wall has finished failing, not what replaces it.
  setTimeout(() => animateBreakIn(dir, { quiet: true }), el ? 300 : 0);
  return Promise.resolve();
}

// Always safe to call, and called on every exit from the fight — a flee, a
// verdict, a new game. A wall left pounding forever is the failure mode a held
// effect always has.
export function breakInClear() {
  stopPounding();
  if (breakIn.el) breakIn.el.remove();
  breakIn.el = null;
  breakIn.wall = null;
  breakIn.dir = null;
  breakIn.grasping = false;
  for (const n of document.querySelectorAll(".edgemark--breach")) n.remove();
}

// ---- Telegraphing the zombie door ------------------------------------------
// The wall they are about to come through knocks once, while the card is still
// being read. It is the difference between a stat event and a horror beat: you
// hear where it will happen one beat before it does.
//
// The direction is knowable in advance because isDeadEnd and pickZombieDoorWall
// are pure reads — no state moves here, this only says out loud what the board
// already decided.
export function telegraphWall(dir, force = 1) {
  wallThump(dir, force);
  if (reducedMotion()) return; // the knock stays; the dust is the motion part

  const box = document.querySelector(".focus-centre .tilebox");
  if (!box || typeof box.animate !== "function") return;

  const dust = document.createElement("span");
  dust.className = `wallshake wallshake--${DIR_CLASS[dir] || "n"}`;
  dust.setAttribute("aria-hidden", "true");
  // Fixed offsets rather than random ones: the same warning should look the
  // same twice, the house rule everywhere else here follows.
  for (const [along, delay] of [[22, 0], [40, 90], [58, 40], [76, 140], [88, 200]]) {
    const mote = document.createElement("i");
    mote.style.setProperty("--along", `${along}%`);
    mote.style.animationDelay = `${delay}ms`;
    dust.appendChild(mote);
  }
  box.appendChild(dust);
  setTimeout(() => dust.remove(), 1400);

  // And the wall itself takes the knock, once.
  const edge = box.querySelector(`.edgemark.${DIR_CLASS[dir]}`) || box;
  const [ax, ay] = (dir === "N" || dir === "S" ? [0, dir === "N" ? 2 : -2] : [dir === "W" ? 2 : -2, 0])
    .map((v) => v * force);
  edge.animate(
    [
      { transform: "translate(0, 0)" },
      { transform: `translate(${ax}px, ${ay}px)` },
      { transform: `translate(${-ax * 0.5}px, ${-ay * 0.5}px)` },
      { transform: "translate(0, 0)" },
    ],
    { duration: 260, easing: "ease-out" }
  );
}

// ---- The door onto darkness --------------------------------------------------
// Opening a door on a room nobody has seen is the scare surface of the whole
// game, and it used to cost nothing: click, tile, slide. One beat goes in
// between. The door swings onto black, the hinge sounds, nothing happens for a
// moment, and only then does the light reach in and the room resolve.
//
// Only for the unknown. Walking back into a room you have already stood in
// stays instant — dread is for what you have not seen.
const DARK_HOLD_MS = 600;

export function darkDoorBeat(dir, fear = 0) {
  return new Promise((resolve) => {
    const pane = document.querySelector(".board-pane");
    // The hinge is a cue, not a picture: it plays even when the beat does not.
    // Placed on the wall being opened — this is the door in front of you, not
    // the one you came through.
    doorCreak(dir);
    if (!pane || reducedMotion() || typeof pane.animate !== "function") return resolve();

    const stale = pane.querySelector(".darkdoor");
    if (stale) stale.remove();

    const dark = document.createElement("div");
    dark.className = `darkdoor darkdoor--${DIR_CLASS[dir] || "n"}`;
    dark.setAttribute("aria-hidden", "true");
    pane.appendChild(dark);

    // A frightened door holds longer. Not enough to notice as a delay, enough
    // that a 9 PM door and an 11:40 door are not the same door.
    const hold = Math.round(DARK_HOLD_MS * (1 + fear * 0.55));

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      dark.remove();
      resolve();
    };
    // Timer-backed for the same reason every awaited beat here is: animations
    // do not advance in a hidden tab, and a turn must never hang on one.
    setTimeout(done, hold);
  });
}

// The wall going in. Staged so the damage reads: the ragged edges snap in
// oversized, settle back, and the room takes the knock. The static art is
// already in place underneath, so under reduced motion the hole is simply
// there — nothing is lost by skipping this.
export function animateBreakIn(dir, opts = {}) {
  // Sound first and unconditionally, the same rule the door follows: the cue is
  // the wall coming in, and that happened whether or not the picture plays.
  // `quiet` is for the staged version, which has already played the crash at
  // the top of the collapse — the burst here is the tail of that, not a second
  // wall giving way.
  if (!opts.quiet) breakThrough();
  if (reducedMotion()) return;
  enterScene();
  setTimeout(leaveScene, 1200);
  requestAnimationFrame(() => {
    const art = document.querySelector(`.focus-centre .tilebox .edgemark.${DIR_CLASS[dir]} .edgeart`);
    if (art && typeof art.animate === "function") {
      art.animate(
        [
          { opacity: 0, transform: "scale(.35)" },
          { opacity: 1, transform: "scale(1.3)", offset: 0.32 },
          { opacity: 1, transform: "scale(.96)", offset: 0.62 },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 460, easing: "cubic-bezier(.2,.9,.3,1)" }
      );
    }
    const box = document.querySelector(".focus-centre .tilebox");
    if (box && typeof box.animate === "function") {
      const [dx, dy] = DELTA[dir] || [0, 0];
      // knocked away from the wall that just gave
      box.animate(
        [
          { transform: "translate(0,0)" },
          { transform: `translate(${-dx * 6}px, ${-dy * 6}px)` },
          { transform: `translate(${dx * 3}px, ${dy * 3}px)` },
          { transform: "translate(0,0)" },
        ],
        { duration: 300, easing: "ease-out" }
      );
    }
  });
}

// ---- Taking a hit ----------------------------------------------------------
// A red wash over the board and a short shake. Sits below the jump scare so the
// two do not fight when a fight is what dealt the damage.
// Where the damage came from, when anything knows. Set by the fight or the
// flight just before the health changes, read once, and cleared — a direction
// left lying around would bias the next unrelated hit.
let hurtFrom = null;
export function damageCameFrom(dir) {
  hurtFrom = dir || null;
}

function damageFeedback() {
  // Not sound, so mute does not govern it, and not motion either — a short
  // knock is the one cue a player can feel with the screen away from them.
  buzz(30);
  if (reducedMotion()) return;

  const pane = document.querySelector(".board-pane");
  if (pane && typeof pane.animate === "function") {
    pane.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: "translate(-5px, 2px)" },
        { transform: "translate(4px, -2px)" },
        { transform: "translate(-2px, 1px)" },
        { transform: "translate(0, 0)" },
      ],
      { duration: 160, easing: "ease-out" }
    );
  }

  const existing = document.querySelector(".hitflash");
  if (existing) existing.remove();
  const flash = document.createElement("div");
  // Weighted toward the threat when the threat has a direction — the wall the
  // pack came through, or the door you fled by. Uniform when it does not, which
  // is honest: a card that hurts you came from nowhere in particular.
  flash.className = `hitflash${hurtFrom ? " hitflash--" + DIR_CLASS[hurtFrom] : ""}`;
  flash.setAttribute("aria-hidden", "true");
  document.body.appendChild(flash);
  if (typeof flash.animate !== "function") {
    flash.remove();
    return;
  }
  hurtFrom = null; // one hit, one direction
  const anim = flash.animate(
    [{ opacity: 0 }, { opacity: 0.5, offset: 0.18 }, { opacity: 0 }],
    { duration: 380, easing: "ease-out" }
  );
  let gone = false;
  const clear = () => {
    if (gone) return;
    gone = true;
    flash.remove();
  };
  anim.finished.then(clear).catch(clear);
  // Animations stall while the tab is hidden; never leave a red sheet behind.
  setTimeout(clear, 700);
}

// ---- Moving between rooms --------------------------------------------------
// Three layers, played together after the new room is rendered: the door you
// came through swings open, footprints track from that doorway to where you're
// standing, and the whole view slides one room in the direction travelled.
//
// Purely decorative — state has already changed and nothing waits on these, so
// clicking straight through a move can never desync the board.
const SLIDE_MS = 700;
const DOOR_MS = 300;
const FOOT_MS = 360;
const FOOT_STAGGER = 78;
const OPPOSITE = { N: "S", E: "W", S: "N", W: "E" };

// The one predicate every intense effect asks. Two independent gates: reduced
// motion is the OS saying "do not move things at me", calm is the player saying
// "do not frighten me". Either is enough to hold an effect back, and neither
// implies the other.
function intense() {
  return !reducedMotion();
}

// Exported for the event stage, which needs the same gate and must not grow a
// second opinion about what "reduced motion" means.
export function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Deferred to the next frame on purpose: resolving the room's card refreshes the
// board again, and renderBoard rebuilds .focus from scratch, so animating the
// element that exists right now would animate a node about to be thrown away.
export function animateEntry(dir) {
  const [dx, dy] = DELTA[dir] || [0, 0];
  if (!dx && !dy) return;

  // Sound is not motion, so the hinge is heard even with animation turned off.
  // Only for a real door — a smashed wall has nothing to swing.
  const back = OPPOSITE[dir];
  const backEdge = document.querySelector(`.focus-centre .tilebox .edgemark.${DIR_CLASS[back]}`);
  // The door is behind you now — you came through it — so both the hinge and
  // the steps are placed on the wall you actually used.
  if (backEdge && !backEdge.classList.contains("edgemark--broken")) doorCreak(back);
  // And the walk in, on whatever the floor is here — boards or grass.
  footsteps(
    document.getElementById("board")?.classList.contains("board--outdoor") ? "outdoor" : "indoor",
    back
  );

  if (reducedMotion()) return;

  requestAnimationFrame(() => {
    const view = document.querySelector(".focus");
    if (!view || typeof view.animate !== "function") return;

    slideView(view, dx, dy);

    const box = view.querySelector(".focus-centre .tilebox");
    if (!box) return;
    const back = OPPOSITE[dir]; // the wall you came through, in the new room
    swingDoor(box, back);
    trackFootprints(box, back);
  });
}

function slideView(view, dx, dy) {
  const tile = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tile")) || 170;
  const gap = parseFloat(getComputedStyle(view).rowGap) || 0;
  const step = tile + gap;
  view.animate(
    [
      { transform: `translate(${dx * step}px, ${dy * step}px)` },
      { transform: "translate(0, 0)" },
    ],
    { duration: SLIDE_MS, easing: "cubic-bezier(.22,.61,.36,1)" }
  );
}

// A leaf hinged in the doorway, swinging inward. Skipped for a broken wall —
// there is no door there to open.
function swingDoor(box, back) {
  const edge = box.querySelector(`.edgemark.${DIR_CLASS[back]}`);
  if (!edge || edge.classList.contains("edgemark--broken")) return;

  const swing = document.createElement("span");
  swing.className = `doorswing ${DIR_CLASS[back]}`;
  swing.setAttribute("aria-hidden", "true");
  const leaf = document.createElement("span");
  leaf.className = "leaf";
  swing.appendChild(leaf);
  box.appendChild(swing);

  const anim = leaf.animate(
    [
      { transform: "rotate(0deg)", opacity: 1 },
      { transform: "rotate(74deg)", opacity: 1, offset: 0.75 },
      { transform: "rotate(74deg)", opacity: 0 },
    ],
    { duration: DOOR_MS, easing: "cubic-bezier(.3,.7,.4,1)" }
  );
  anim.finished.then(() => swing.remove()).catch(() => swing.remove());
}

// Footprints from the doorway to the middle of the room, alternating left and
// right of the line of travel, fading in one after another.
function trackFootprints(box, back) {
  const track = document.createElement("span");
  track.className = "steps";
  track.setAttribute("aria-hidden", "true");

  const along = [88, 76, 64, 52]; // percent from the wall, inward
  const count = along.length;
  for (let i = 0; i < count; i++) {
    const foot = document.createElement("span");
    foot.className = "step";
    const side = i % 2 ? 57 : 43; // left/right of the walking line
    const near = along[i];
    if (back === "S") { foot.style.top = `${near}%`; foot.style.left = `${side}%`; }
    else if (back === "N") { foot.style.top = `${100 - near}%`; foot.style.left = `${side}%`; }
    else if (back === "E") { foot.style.left = `${near}%`; foot.style.top = `${side}%`; }
    else { foot.style.left = `${100 - near}%`; foot.style.top = `${side}%`; }
    foot.style.transform = `translate(-50%, -50%) rotate(${back === "N" || back === "S" ? 0 : 90}deg)`;
    track.appendChild(foot);

    foot.animate(
      [{ opacity: 0 }, { opacity: 0.9, offset: 0.35 }, { opacity: 0 }],
      { duration: FOOT_MS, delay: DOOR_MS * 0.5 + i * FOOT_STAGGER, easing: "ease-out" }
    );
  }
  box.appendChild(track);
  setTimeout(() => track.remove(), DOOR_MS * 0.5 + count * FOOT_STAGGER + FOOT_MS + 60);
}

function centreRoom(game, tile, edges) {
  const box = document.createElement("div");
  box.className = `tilebox tilebox--here world--${tile.world}`;
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", describeRoom(game, tile, edges));

  // The aftermath, before the edge marks so it sits under them: a hole is a
  // permanent, two-sided piece of board state, so this draws itself in both
  // rooms and on every visit for the rest of the run. That permanence is the
  // point — the map remembers where a wall came in.
  for (const dir of tile.holes || []) aftermath(box, dir);

  for (const dir of DIRS) {
    const mark = edgeMark(dir, edges[dir], tile.world);
    if (mark) box.appendChild(mark);
  }

  const sceneId = SCENE_ALIAS[tile.id] || tile.id;
  const scene = icon("scene", sceneId, `roomscene${SCENE_RICH.has(sceneId) ? " roomscene--rich" : ""}`);
  if (scene) box.appendChild(scene);

  const name = document.createElement("span");
  name.className = "tilename";
  name.textContent = tileName(game, tile.id);
  name.setAttribute("aria-hidden", "true");
  box.appendChild(name);

  const badges = badgeRow(tileBadges(game, tile));
  if (badges) box.appendChild(badges);
  return box;
}

// ---- The wound in the house ----------------------------------------------------
// What is left after a wall comes in. Three things, and only the first of them
// survives calm mode, because only the first is information: gouges are a map
// telling you a hole is here and can be used, and the other two are dread.
//
// Nothing here plays a sound or takes a frame of the player's time. Aftermath
// is texture, not a beat.

// Which hole the dust is still settling in, if any. Cleared at the start of the
// next turn — dust that hangs forever is not dust, it is a decal.
let freshHole = null;

function aftermath(box, dir) {
  const d = DIR_CLASS[dir] || "n";

  // Claw marks, dragged from the opening toward the middle of the room. Fixed
  // positions like everything else here: the same hole should look the same
  // twice, in this run and in a shared one.
  const gouges = document.createElement("span");
  gouges.className = `gouges gouges--${d}`;
  gouges.setAttribute("aria-hidden", "true");
  for (const [along, reach, tilt] of [[38, 54, -9], [50, 68, 3], [62, 46, 11]]) {
    const line = document.createElement("i");
    line.style.setProperty("--along", `${along}%`);
    line.style.setProperty("--reach", `${reach}%`);
    line.style.setProperty("--tilt", `${tilt}deg`);
    gouges.appendChild(line);
  }
  box.appendChild(gouges);

  if (reducedMotion()) return;

  // The dark beyond it. A hole is not a door: nothing was ever going to close
  // it, and the outside is on the other side of it for the rest of the night.
  // Depth follows the dread dial, so the same opening is a shadow at nine
  // o'clock and a throat at midnight.
  const dark = document.createElement("span");
  dark.className = `holedark holedark--${d}`;
  dark.setAttribute("aria-hidden", "true");
  box.appendChild(dark);

  // And for the turn it was made in, the dust has not settled.
  if (freshHole === dir) {
    const dust = document.createElement("span");
    dust.className = `holedust holedust--${d}`;
    dust.setAttribute("aria-hidden", "true");
    for (const [along, delay, dur] of [[34, 0, 5.5], [46, 900, 7], [55, 400, 6.2], [66, 1500, 5]]) {
      const mote = document.createElement("i");
      mote.style.setProperty("--along", `${along}%`);
      mote.style.animationDelay = `${delay}ms`;
      mote.style.animationDuration = `${dur}s`;
      dust.appendChild(mote);
    }
    box.appendChild(dust);
  }
}

// The turn moves on and the air clears. Called from the start of the next turn
// rather than on a timer: "the rest of this turn" is a game-length, and a
// wall-clock version of it would be wrong at both ends.
export function settleDust() {
  freshHole = null;
}

// What a room does, said on the room. Read off the tile's own definition
// rather than a list of room ids, so a data change carries the badge with it —
// move HEAL_1 to another room and the heart follows.
//
// The two goal badges are stateful, and that is most of their value: the relic
// marker is on the Reliquary only while the relic is still in it, and moves to
// the Family Plot the moment you are carrying it. The board answers "where am
// I going" without being asked.
function tileBadges(game, tile) {
  const def = (tile && tile.def) || {};
  const held = game.state.tablet;
  const out = [];
  if (def.goal === "TAKE_TABLET" && !held) {
    out.push({ kind: "relic", kindName: "ui", id: "relic", say: ui(game, "badge-take") });
  }
  if (def.goal === "BURY_TABLET" && held) {
    out.push({ kind: "relic", kindName: "ui", id: "relic", say: ui(game, "badge-bury") });
  }
  if (def.onTurnEnd === "HEAL_1") {
    out.push({ kind: "hearth", kindName: "stat", id: "heart", say: ui(game, "badge-heal") });
  }
  return out;
}

// Corners only. The centre of a tile belongs to the footprints and the
// hotspots, and the bottom-left is the name's.
function badgeRow(badges) {
  if (!badges.length) return null;
  const row = document.createElement("span");
  row.className = "tilebadges";
  row.setAttribute("aria-hidden", "true"); // describeRoom says it in words
  for (const b of badges) {
    const chip = document.createElement("span");
    chip.className = `tilebadge tilebadge--${b.kind}`;
    const art = icon(b.kindName, b.id, "tilebadge-art");
    if (art) chip.appendChild(art);
    if (b.kind === "hearth") {
      const plus = document.createElement("span");
      plus.className = "tilebadge-num";
      plus.textContent = "+1";
      chip.appendChild(plus);
    }
    row.appendChild(chip);
  }
  return row;
}

// The far half of a neighbour is masked away, so it reads as a room you can see
// into rather than a room you are in.
function halfRoom(game, edge, dir) {
  const half = document.createElement("div");
  half.className = `halfroom halfroom--${DIR_CLASS[dir]} world--${edge.neighbour.world}`;
  if (edge.crossesWorld) half.classList.add("halfroom--across");
  half.setAttribute("aria-hidden", "true"); // already in the centre room's label

  const glimpseId = SCENE_ALIAS[edge.neighbour.id] || edge.neighbour.id;
  const scene = icon("scene", glimpseId, `roomscene${SCENE_RICH.has(glimpseId) ? " roomscene--rich" : ""}`);
  if (scene) half.appendChild(scene);

  const name = document.createElement("span");
  name.className = "tilename";
  name.textContent = tileName(game, edge.neighbour.id);
  half.appendChild(name);

  // Worth more here than on the room you are standing in: this is the board
  // telling you the relic is through that door before you commit the turn.
  // Pinned to the strip rather than to the scene, so the crop cannot eat it.
  const badges = badgeRow(tileBadges(game, edge.neighbour));
  if (badges) half.appendChild(badges);
  return half;
}

// Indoors an edge is a door; outdoors it is a gap in the verge with a track
// running out of it. The hillside has no jambs and no leaves, so drawing it as
// a door was the last thing on the board still describing a house. Same four
// states either way — only the family of art changes.
function edgeMark(dir, edge, world) {
  if (edge.kind === "wall") return null;

  const way = world === "outdoor" ? "path" : "door";
  let symbol;
  let tone;
  if (edge.kind === "broken") {
    symbol = world === "outdoor" ? "hedge-broken" : "wall-broken";
    tone = "broken";
  } else if (edge.arrow && (edge.state === "outside" || edge.crossesWorld)) {
    // The moon gate is the one crossing between the two halves, and it is a
    // moon gate from both sides — so this one does not follow the world.
    symbol = "door-exterior";
    tone = "exterior";
  } else if (edge.state === "open") {
    symbol = `${way}-open`;
    tone = "open";
  } else if (edge.state === "blocked") {
    symbol = `${way}-blocked`;
    tone = "blocked";
  } else {
    symbol = `${way}-closed`;
    tone = "shut";
  }

  const wrap = document.createElement("span");
  wrap.className = `edgemark ${DIR_CLASS[dir]} edgemark--${tone}`;
  wrap.setAttribute("aria-hidden", "true");
  const art = icon("edge", symbol, "edgeart");
  if (art) wrap.appendChild(art);
  return wrap;
}

// One sentence covering the room and all four walls, so the board is playable
// without seeing it.
function describeRoom(game, tile, edges) {
  const parts = [roomWord(game, "here", { room: tileName(game, tile.id) })];
  // The badges are aria-hidden pictures; this is where they are actually said.
  for (const b of tileBadges(game, tile)) parts.push(b.say);
  for (const dir of DIRS) {
    const e = edges[dir];
    const where = dirWord(game, dir);
    if (e.state === "wall") {
      // The one transient thing this sentence reports. A wall being broken
      // through is a fact about the room and it decides what the player does
      // next, so it is said — unlike the phantoms, which are not facts.
      parts.push(roomWord(game,
        breakIn.dir === dir && breakIn.wall ? "wall-failing" : "wall", { dir: where }));
    } else if (e.state === "outside") {
      parts.push(roomWord(game, "outside", { dir: where }));
    } else if (e.state === "open") {
      const thing = roomWord(game,
        e.kind === "broken" ? "thing-broken" : e.arrow ? "thing-arrow" : "thing-open");
      const room = e.neighbour ? tileName(game, e.neighbour.id) : roomWord(game, "somewhere");
      parts.push(roomWord(game, "open", {
        dir: where, thing, room,
        cross: e.crossesWorld ? roomWord(game, "crossing") : "",
      }));
    } else if (e.state === "blocked") {
      const thing = roomWord(game, e.kind === "broken" ? "thing-broken" : "thing-door");
      parts.push(roomWord(game, "blocked", { dir: where, thing }));
    } else {
      const thing = roomWord(game, e.kind === "broken" ? "thing-broken" : "thing-shut");
      parts.push(roomWord(game, "unexplored", { dir: where, thing }));
    }
  }
  return parts.join(" ");
}

export function log(msg, cls = "") {
  const el = document.getElementById("log");
  if (!el) return;
  const p = document.createElement("p");
  if (cls) p.className = cls;
  p.textContent = msg;
  el.prepend(p);
}

export function clearLog() {
  const el = document.getElementById("log");
  if (el) el.innerHTML = "";
}

// A line over the board that fades. Most of what the log used to say is now
// shown rather than told — damage flashes, hearts price the choices, the pack
// falls over, the clock moves. What is left are the moments with no other
// picture: the writing on a card, and the hour striking.
//
// aria-hidden, because log() has already announced it to the live region and
// saying it twice is worse than not seeing it once.
let captionTimer = null;
export function caption(msg, tone = "") {
  const pane = document.querySelector(".board-pane");
  if (!pane || !msg) return;
  const old = pane.querySelector(".caption");
  if (old) old.remove();
  clearTimeout(captionTimer);

  const el = document.createElement("p");
  el.className = `caption${tone ? " caption--" + tone : ""}`;
  el.setAttribute("aria-hidden", "true");
  el.textContent = msg;
  pane.appendChild(el);

  // Timer rather than animationend: animations do not advance in a hidden tab,
  // and a caption that never left would sit over the board forever.
  const life = tone === "toll" ? 5200 : 4200;
  captionTimer = setTimeout(() => el.remove(), life);
}

// Hearts, using the same symbol the status panel does. Zero reads as safe
// rather than as a cost — out-levelling a pack is this ruleset's reward and
// should look like one.
function costRow(hp) {
  const row = document.createElement("span");
  const kind = hp > 0 ? "gain" : hp < 0 ? "cost" : "safe";
  row.className = `action-cost action-cost--${kind}`;
  row.setAttribute("aria-hidden", "true");

  if (hp === 0) {
    row.textContent = ui(drawing, "unharmed");
    return row;
  }
  const n = document.createElement("span");
  n.className = "action-cost-num";
  n.textContent = `${hp > 0 ? "+" : "−"}${Math.abs(hp)}`;
  row.appendChild(n);
  for (let i = 0; i < Math.min(Math.abs(hp), 4); i++) {
    const h = icon("stat", "heart", `costheart costheart--${kind}`);
    if (h) row.appendChild(h);
  }
  return row;
}

// A count of hearts you do not have is not information. Past the point where
// the arithmetic stops mattering, say the only thing that does.
function lethalRow() {
  const row = document.createElement("span");
  row.className = "action-cost action-cost--lethal";
  row.setAttribute("aria-hidden", "true");
  const sk = icon("ui", "skull", "action-skull");
  if (sk) row.appendChild(sk);
  row.appendChild(document.createTextNode(ui(drawing, "kills-you")));
  return row;
}

function costSentence(hp) {
  if (hp === 0) return ui(drawing, "cost-none");
  if (hp > 0) return ui(drawing, "cost-gain", { n: hp });
  return ui(drawing, "cost-loss", { n: Math.abs(hp) });
}

// The window's fixed header. Created once and emptied per render, so the pack
// and prompt can sit outside the scrolling card list.
function windowHead(pop, actionsEl) {
  if (!pop) return null;
  let head = pop.querySelector(".window-head");
  if (!head) {
    head = document.createElement("div");
    head.className = "window-head";
    pop.insertBefore(head, actionsEl);
  }
  head.textContent = "";
  return head;
}

// What you are fighting, present for the whole fight rather than a flash and a
// digit. The scare showed it; this is what it left behind.
//
// ONE FIGURE, AT THE TIER THAT WAS DRAWN (#92). It used to append `count`
// copies of a HARD CODED "n4", which was wrong twice over: the row was the
// multiple-jiangshi picture this issue removes, and the hard-coded id meant the
// header disagreed with the creature in the film at every strength except 4.
// That second half was a bug before this issue existed.
//
// THE ROW ITSELF STAYS even though it now holds one thing, because .swingart
// is absolutely positioned against .packrow: delete the row and the weapon
// crossing it silently loses its containing block.
function packRow(subject) {
  const row = document.createElement("div");
  row.className = "packrow";
  row.setAttribute("aria-hidden", "true"); // the prompt already says what it is
  // THE SUBJECT IS PASSED, NOT INFERRED. A number is a strength and draws that
  // tier; "king" draws the King. Inferring it from the number was how this row
  // came to show the wrong creature at the threshold: the midnight prompt hands
  // it a 1, and clamping 1 into the tier range answers a question nobody asked.
  const fig = subject === "king"
    ? icon("king", "figure", "packfig")
    : icon("scare", scareTier(subject).cls, "packfig");
  if (fig) row.appendChild(fig);
  return row;
}

// ---- The creature panel (#94) -------------------------------------------------
// WHAT YOU ARE LOOKING AT WHILE YOU CHOOSE. It is raised in fightBeat rather
// than in the event stage, and that is the load-bearing decision: every route
// into a fight funnels there — a jiangshi event, the breach, and both villager
// paths — so the villager encounter and the jiangshi encounter are the SAME
// encounter by construction rather than two implementations kept in step.
//
// ITS LIFECYCLE IS NEW. Every other panel here times out or waits for one tap
// and goes; this one stays up until the fight resolves. Its teardown lives in
// fightBeat's close(), beside unduck(), for the reason that closure already
// exists: there are six exits and a fix remembered at each one is a fix missed
// at the next.
//
// AND IT IS NOT A CONTROL. No handler, no tabindex, pointer-events none in the
// stylesheet. After #96 taught every panel in this game to want a tap, this one
// has to visibly not want one, because the taps belong to the cards under it.
const CREATURE_TIERS = { 3: "n3", 4: "n4", 5: "n5", 6: "n6" };
const VILLAGERS_FOR_PANEL = ["villager-a", "villager-b", "villager-c"];

export function clearCreaturePanel() {
  for (const n of document.querySelectorAll(".creature")) n.remove();
}

// `turnedFrom` is the turn the villager was drawn on, or null. When it is set
// the panel OPENS AS THE VILLAGER and he becomes the creature as it arrives —
// which is the transformation, and it costs no beat because the panel has an
// entrance either way. On this one path the entrance has a different first
// frame. The turn is the same value #93 picks the villager with, so the man who
// changes is the man they just saw, with no second source of truth.
export function creaturePanel(n, { turnedFrom = null, reduced = false } = {}) {
  clearCreaturePanel();
  const host = document.querySelector(".board-pane");
  if (!host) return null;
  const tier = CREATURE_TIERS[Math.max(3, Math.min(Number(n) || 3, 6))];

  const el = document.createElement("div");
  el.className = "creature";
  // NOT aria-hidden, and that is a consequence rather than a preference. This
  // panel used to be able to hide itself because ui.fight-prompt said the same
  // thing in the actions header; with the prompt gone the caption below is the
  // ONLY statement of what is standing there, so hiding it would leave a
  // screen-reader player with a list of cards and no enemy. The ART stays
  // hidden — a picture of it adds nothing that the sentence does not say.

  const ink = document.createElement("span");
  ink.className = "creature-ink";
  el.appendChild(ink);

  const art = icon("scare", tier, "creature-art");
  if (art) art.setAttribute("aria-hidden", "true");

  // ONE TEXT, ONCE. 寫一句僵屍的故事,加上攻擊力 — the story and the number are a
  // single caption under the creature, and they are ALSO the prompt: the fight
  // window is given none, because renderActions positions a prompt in the
  // window header, which is a different element in a different place. Two
  // separately positioned texts saying the same thing is the caption fault the
  // user caught when the event line moved onto the event panel.
  const cap = document.createElement("div");
  cap.className = "creature-cap";
  const said = document.createElement("p");
  said.className = "creature-said";
  said.textContent = turnedFrom != null ? creatureLine("turned") : creatureLine(tier);
  const atk = document.createElement("p");
  atk.className = "creature-atk";
  atk.textContent = uiText("creature-attack", `Attack ${n}`).replace("{n}", String(n));
  cap.appendChild(said);
  cap.appendChild(atk);

  if (turnedFrom != null) {
    const who = VILLAGERS_FOR_PANEL[(Number(turnedFrom) || 0) % VILLAGERS_FOR_PANEL.length];
    // .creature-was, NOT .creature-art, and that is load-bearing. resolveBeat
    // collects `.creature-art` inside the panel and animates every one it finds,
    // so leaving the villager under that class made the man they had just
    // watched stop being a person come back at opacity .9 and topple a second
    // time beside the thing he became — and two figures also tripped the
    // pack-stagger branch, giving a crowd's cadence to one creature.
    //
    // He is also REMOVED once his exit finishes, so the panel does not carry a
    // spent node for the rest of the fight. The class is what makes it correct;
    // the removal is what keeps it tidy.
    const was = icon("scene", who, "creature-was");
    if (was && art) {
      el.appendChild(was);
      el.appendChild(art);
      if (!reduced) {
        // He is small and it fills the panel, so the size difference is the
        // effect rather than a problem: the thing gets bigger because it is no
        // longer a person.
        // No translate in these keyframes any more: the centring is in the
        // margins now, so transform belongs to the animation alone.
        const going = was.animate([{ opacity: 1, transform: "scale(.62)" },
                                   { opacity: 0, transform: "scale(1.02)" }],
                                  { duration: 380, easing: "cubic-bezier(.5,0,.75,0)", fill: "both" });
        if (going.finished && going.finished.then) {
          going.finished.then(() => was.remove(), () => {});
        }
        art.animate([{ opacity: 0, transform: "scale(.72)" },
                     { opacity: 1, transform: "scale(1)" }],
                    { duration: 380, delay: 120, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" });
      } else {
        was.remove();
      }
    } else if (art) {
      el.appendChild(art);
    }
  } else if (art) {
    el.appendChild(art);
  }

  el.appendChild(cap);
  host.appendChild(el);
  return el;
}

function creatureLine(tier) {
  const t = (drawing && drawing.data && drawing.data.theme && drawing.data.theme.creatures) || {};
  return t[tier] || "";
}

// The first nine actions get a number-key shortcut. One delegated listener,
// installed on the first render, reads the live button list each keypress.
let keysBound = false;
function bindActionKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > 9) return;
    const b = currentChoices()[n - 1];
    if (b && !b.disabled) {
      e.preventDefault();
      b.click();
    }
  });

  // Arrows drive the doorways, and flee cards by the same dir metadata. Only
  // swallowed when something actually matches, so the page still scrolls
  // otherwise.
  document.addEventListener("keydown", (e) => {
    const dir = ARROW_KEY[e.key];
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const target = currentChoices().find((b) => b.dataset.dir === dir && !b.disabled);
    if (!target) return;
    e.preventDefault();
    target.click();
  });
}

// Render a set of action buttons. `actions` = [{label, onClick, primary?}].
//
// These live in a pop-out over the board rather than a fixed sidebar panel, so
// the choice sits next to what the player is looking at and takes no room when
// there is nothing to decide.
//
// There is deliberately no way to dismiss it. Every state that renders actions
// requires one of them to be chosen — moving is mandatory, a fight must be
// resolved, a zombie door must be given a wall — so a close button or an
// Escape binding would only ever strand the player with no way to act. It
// hides when the list is empty, which is the one moment nothing is being asked.
//
// It is also deliberately not a modal and traps no focus: with no dismiss, a
// focus trap would lock a keyboard player away from New game for the rest of
// the run. Tab reaches the sidebar as normal; the number keys stay bound
// globally.
export function renderActions(actions, prompt = "", opts = {}) {
  const el = document.getElementById("actions");
  const pop = document.getElementById("actions-pop");
  // Keep the keyboard on the turn loop, but don't yank focus out of the
  // sidebar controls if that's where the player put it. Focus may be on a
  // doorway from the previous render, which counts as being in the turn loop.
  const hadFocus =
    el.contains(document.activeElement) ||
    (document.activeElement && document.activeElement.classList.contains("doorway"));
  el.innerHTML = "";
  clearDoorways();
  pendingMoves = [];
  movePrompt = "";

  if (!actions.length) {
    if (pop) pop.hidden = true;
    pushIn(false);
    return;
  }

  // What the board itself can draw: a walk through a named wall, or the choice
  // to stay standing where you are. Staying had to be admitted here — it is an
  // action on the board like any other, and while it was merely "not a move"
  // its presence in the list disqualified the whole step from the doorway path
  // below, which silently cost the game its doorways AND held the push-in on
  // for the entire turn.
  const isWalk = (a) => a.kind === "move" && a.dir;
  const isStay = (a) => a.kind === "stay";
  const boardOnly =
    actions.some(isWalk) && actions.every((a) => isWalk(a) || isStay(a));

  // A decision is open: the board starts closing in. Moves are not a decision
  // in this sense — walking is what you do between them, and a push-in that
  // never released would just be a zoom.
  pushIn(!boardOnly);

  // Moving is the one thing the board can say better than a list. When every
  // choice is one the board can draw, they become the buttons and the panel
  // stays shut.
  if (boardOnly) {
    pendingMoves = actions;
    movePrompt = prompt;
    if (pop) pop.hidden = true;
    const board = document.getElementById("board");
    if (board) mountDoorways(board);
    bindActionKeys();
    if (hadFocus || document.activeElement === document.body) {
      const first =
        document.querySelector(".doorway--explore:not(:disabled)") ||
        document.querySelector(".doorway:not(:disabled)");
      if (first) first.focus();
    }
    // The prompt lived in the panel; with no panel it has to be said somewhere.
    if (prompt) log(prompt);
    return;
  }

  if (pop) pop.hidden = false;

  // The prompt and the pack live in a header that never scrolls, so a six-zombie
  // fight with eight cards scrolls the cards and keeps the enemy in view.
  const head = windowHead(pop, el);
  if (head) {
    if (opts.pack) head.appendChild(packRow(opts.pack));
    if (prompt) {
      const p = document.createElement("p");
      p.className = "prompt";
      p.textContent = prompt;
      head.appendChild(p);
    }
  } else if (prompt) {
    const p = document.createElement("p");
    p.className = "prompt";
    p.textContent = prompt;
    el.appendChild(p);
  }

  // Lethal is judged against the health the player has right now, not the health
  // they had when the choice was assembled — a heal can move it mid-window.
  const kills = (a) =>
    typeof opts.health === "number" &&
    a.cost &&
    typeof a.cost.hp === "number" &&
    a.cost.hp < 0 &&
    -a.cost.hp >= opts.health;

  actions.forEach((a, i) => {
    const fatal = kills(a);
    const b = document.createElement("button");
    b.type = "button";
    b.className =
      "action" +
      (a.primary ? " action--primary" : "") +
      (a.pivotal ? " action--pivotal" : "") +
      (fatal ? " action--lethal" : "");
    if (i < 9) {
      const k = document.createElement("kbd");
      k.textContent = String(i + 1);
      b.appendChild(k);
    }
    // Weapons and items already have art; a fight is far easier to read as a
    // row of weapons than as a row of sentences.
    const cut = a.icon ? a.icon.indexOf("-") : -1;
    const art = cut > 0 ? icon(a.icon.slice(0, cut), a.icon.slice(cut + 1), "action-icon") : null;
    if (art) b.appendChild(art);
    else if (a.dir) {
      const compass = document.createElement("span");
      compass.className = "action-compass";
      compass.setAttribute("aria-hidden", "true");
      compass.textContent = ARROW[a.dir] || "";
      b.appendChild(compass);
    }
    const text = document.createElement("span");
    text.className = "action-text";
    const name = document.createElement("span");
    name.className = "action-label";
    name.textContent = a.label;
    text.appendChild(name);
    // The consequence used to be bolted onto the end of the label. It is its own
    // field now, so it can be styled — and read out — as the separate thing it is.
    if (a.sub) {
      const sub = document.createElement("span");
      sub.className = "action-sub";
      sub.textContent = a.sub;
      text.appendChild(sub);
    }
    // The price, in hearts. Combat is fully deterministic, so there is nothing
    // to hide and no reason to make the player do the arithmetic.
    if (a.cost && typeof a.cost.hp === "number") {
      text.appendChild(fatal ? lethalRow() : costRow(a.cost.hp));
      b.appendChild(
        srOnly(
          fatal
            ? ui(drawing, "cost-lethal", { sentence: costSentence(a.cost.hp) })
            : costSentence(a.cost.hp)
        )
      );
    }
    b.appendChild(text);
    if (a.kind) b.dataset.kind = a.kind;
    if (a.dir) b.dataset.dir = a.dir;
    b.disabled = !!a.disabled;
    b.addEventListener("click", a.onClick);
    el.appendChild(b);
  });
  bindActionKeys();
  // The window arriving is a card being turned over. Sound is not motion, so it
  // plays whether or not the pop-out animates.
  cardTurn();
  if (pop && !reducedMotion() && typeof pop.animate === "function") {
    pop.animate(
      [
        { opacity: 0, transform: "translateX(-50%) translateY(8px) scale(.97)" },
        { opacity: 1, transform: "translateX(-50%) translateY(0) scale(1)" },
      ],
      { duration: 150, easing: "cubic-bezier(.2,.8,.3,1)" }
    );
  }
  if (hadFocus || document.activeElement === document.body) {
    const first =
      el.querySelector(".action--primary:not(:disabled)") ||
      el.querySelector(".action:not(:disabled)");
    if (first) first.focus();
  }
}

// `actions` = [{label, onClick, primary?} | {label, href, primary?}].
// `opts` = { tone: "won" | "lost", summary: [string] }.
//
// The end of a run gets a beat before the verdict: the veil closes over about a
// second and a half, then the card arrives. Under reduced motion both land at
// once — the ceremony is the first thing to go, the information is not.
export function showOverlay(title, sub, actions = [], opts = {}) {
  // The end of a run is the one scene that does not need to hand the stage
  // back — the bars stay up under the veil until a new game clears them.
  enterScene();
  let ov = document.getElementById("overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "overlay";
    document.body.appendChild(ov);
  }
  ov.innerHTML = "";
  ov.className = opts.tone ? `overlay--${opts.tone}` : "";
  ov.classList.toggle("overlay--still", reducedMotion());

  // The endings dress the stage differently before the card arrives. The win
  // gets the game's only sunrise; each loss dies its own death — combat is
  // violent (blood down the veil, a dragged handprint), health is quiet (a
  // pool rising while the vision closes), midnight is cold (no blood at all —
  // a cracked clock and the toll). Fixed drip positions rather than random
  // ones, per the house rule — the same ending should look the same twice.
  const reason = opts.tone === "lost" ? opts.reason || "combat" : null;
  if (reason) ov.classList.add(`overlay--lost-${reason}`);

  if (reason === "combat" && intense()) {
    const blood = document.createElement("div");
    blood.className = "blood";
    blood.setAttribute("aria-hidden", "true");
    // [left %, length px, fall seconds, delay seconds]
    const DRIPS = [
      [6, 300, 8, 1.3], [17, 180, 6.5, 2.2], [29, 380, 9.5, 1.1],
      [43, 220, 7, 3], [58, 330, 8.5, 1.7], [72, 190, 6, 2.6],
      [86, 280, 7.5, 2], [95, 150, 5.5, 3.3],
    ];
    for (const [x, len, dur, delay] of DRIPS) {
      const d = document.createElement("span");
      d.className = "drip";
      d.style.left = `${x}%`;
      d.style.setProperty("--len", `${len}px`);
      d.style.setProperty("--dur", `${dur}s`);
      d.style.setProperty("--delay", `${delay}s`);
      blood.appendChild(d);
    }
    ov.appendChild(blood);
    const hand = icon("verdict", "hand", "verdict-hand");
    if (hand) {
      hand.setAttribute("viewBox", "0 0 90 130"); // not on the 24 grid
      ov.appendChild(hand);
    }
  } else if (reason === "health") {
    // No violence — the wounds were already taken. The dark just rises.
    const pool = document.createElement("div");
    pool.className = "pool";
    pool.setAttribute("aria-hidden", "true");
    ov.appendChild(pool);
  }

  const card = document.createElement("div");
  card.className = "overlay-card";
  if (opts.tone === "won") {
    const scene = icon("verdict", "dawn", "verdict-scene");
    if (scene) {
      scene.setAttribute("viewBox", "0 0 240 120"); // a film frame, not the 24 grid
      card.appendChild(scene);
    }
  }
  if (reason === "midnight") {
    // The clock that killed you, stopped where it caught you, still tolling.
    const wrap = document.createElement("div");
    wrap.className = "tollwrap";
    wrap.setAttribute("aria-hidden", "true");
    const clock = icon("verdict", "midnight", "verdict-midnight");
    if (clock) {
      clock.setAttribute("viewBox", "0 0 96 96");
      wrap.appendChild(clock);
      card.appendChild(wrap);
    }
  }
  const h = document.createElement("h2");
  h.textContent = title;
  card.appendChild(h);
  const p = document.createElement("p");
  p.textContent = sub || "";
  card.appendChild(p);

  // Above the rows, because it is the thing worth reading. The seed sits below
  // both: the sentence is the bait and the seed is the share.
  if (opts.epilogue) {
    const line = document.createElement("p");
    line.className = "verdict-epilogue";
    line.textContent = opts.epilogue;
    card.appendChild(line);
  }

  // 🤫 The comparison. Two numbers, side by side, on the card of a player the
  // King has just killed — and the ONLY place in the game either number is ever
  // shown (spec §9). It is not UI copy: it is the entire discovery mechanism
  // for the hidden ending, and a run that ends here is the one chance anybody
  // gets to learn there was a number to reach. Remove it and 鎮屍 becomes
  // unreachable in practice.
  //
  // Rendered as a table rather than a sentence because it is meant to be read
  // as a measurement — the gap between the two is the information.
  if (opts.compare && opts.compare.length) {
    const cmp = document.createElement("dl");
    cmp.className = "verdict-compare";
    for (const [term, value] of opts.compare) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      cmp.appendChild(dt);
      cmp.appendChild(dd);
    }
    card.appendChild(cmp);
  }

  if (opts.summary && opts.summary.length) {
    const list = document.createElement("ul");
    list.className = "verdict-summary";
    for (const line of opts.summary) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    }
    card.appendChild(list);
  }

  // THE ACTIONS ARE A ROW, AND NEED TO BE ONE (#101). They were appended
  // straight onto the card as siblings of the heading and the summary, held
  // apart by a 4px margin each — which is not an arrangement, it is what you
  // get without one. Two buttons is a different shape from four and wants
  // saying deliberately, so they go in their own element and the CSS treats
  // that element as the row.
  const row = document.createElement("div");
  row.className = "overlay-actions";
  for (const a of actions) {
    const cls = "btn" + (a.primary ? " btn--primary" : "");
    let el;
    if (a.href) {
      el = document.createElement("a");
      el.href = a.href;
    } else {
      el = document.createElement("button");
      el.type = "button";
      el.addEventListener("click", (e) => a.onClick(e.currentTarget));
    }
    el.className = cls;
    el.textContent = a.label;
    row.appendChild(el);
  }
  card.appendChild(row);

  ov.appendChild(card);
  ov.hidden = false;
  const focusMe = ov.querySelector(".btn--primary") || ov.querySelector(".btn");
  if (focusMe) focusMe.focus();
}

export function hideOverlay() {
  const ov = document.getElementById("overlay");
  if (ov) ov.hidden = true;
}

// ---- name helpers ----------------------------------------------------------
export function tileName(game, id) {
  return (game.data.theme.tiles && game.data.theme.tiles[id]) || id;
}
export function itemName(game, id) {
  return (game.data.theme.items && game.data.theme.items[id]) || id;
}

// The same contract app.js keeps: one lookup per surface, keyed on the moment,
// and a missing key returns itself so a gap is visible rather than blank. These
// take `game` because render's functions are not methods — the module draws for
// whichever run it is handed.
function fill(text, values) {
  if (!values) return text;
  return String(text).replace(/\{(\w+)\}/g, (whole, k) =>
    values[k] === undefined ? whole : values[k]);
}

function ui(game, key, values) {
  const table = (game && game.data && game.data.theme && game.data.theme.ui) || {};
  return fill(table[key] || key, values);
}

function roomWord(game, key, values) {
  const table = (game && game.data && game.data.theme && game.data.theme.room) || {};
  return fill(table[key] || key, values);
}

function dirWord(game, dir) {
  return ui(game, `dir-${dir}`);
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
