// Sound. Every cue is synthesised from oscillators and a noise buffer, and can
// be overridden by a recorded file without any caller changing.
//
// The site ships asset-free: with no assets/audio/manifest.json present the
// fetch 404s, nothing loads, and every cue synthesises exactly as before. Drop
// a manifest and the named cues play from file instead. Synthesis is never
// removed — it is the fallback when a file is missing, fails to decode, or has
// not finished loading yet, because a cue must never be able to hold up a turn.
//
// Muted by default. The first noise a browser game makes should be one the
// player asked for, and there is no `prefers-reduced-sound` to lean on, so the
// toggle is how sound gets turned *on*.

const KEY = "zitp:muted";

let ctx = null;
let master = null;
let noiseBuffer = null;
let bedNoise = null;
let muted = readMuted();

function readMuted() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true; // storage blocked (private mode, embedded) — stay quiet
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = !!next;
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    /* setting just won't survive the reload */
  }
  if (master) master.gain.value = muted ? 0 : 1;
  // Un-muting is itself a click, which is exactly the gesture a browser wants
  // before it will let a page make noise — so open the context here.
  if (!muted) {
    audio();
    // Nothing is built while muted, so anything that was supposed to be
    // running has to be built now rather than waiting for the next event.
    if (bedWanted) startAmbience();
    if (murmurWanted) startMurmur(murmurWanted);
  } else {
    tearDownBed();
    tearDownMurmur();
  }
  return muted;
}

// Created lazily and always resumed: browsers hand you a suspended context
// until a user gesture, and every caller here runs from a click or a keypress.
function audio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    // Fire and forget: cues synthesise until this lands, and forever if it
    // never does.
    loadManifest(ctx);
  } catch {
    ctx = null;
  }
  return ctx;
}

// Nothing plays while muted, and nothing is even built — no context is opened
// for a player who never turns sound on.
function live() {
  if (muted) return null;
  return audio();
}

// Math.random is fine here and nowhere else in this codebase: this is audio
// texture, not game state, and it never touches the seeded run.
function noise(c) {
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const frames = Math.floor(c.sampleRate * 0.5);
  noiseBuffer = c.createBuffer(1, frames, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// Held sounds need a longer buffer than struck ones: half a second of noise is
// fine for a burst and audibly ticks once you loop it. Eight seconds does not.
function longNoise(c) {
  if (bedNoise && bedNoise.sampleRate === c.sampleRate) return bedNoise;
  const frames = Math.floor(c.sampleRate * 8);
  bedNoise = c.createBuffer(1, frames, c.sampleRate);
  const data = bedNoise.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return bedNoise;
}

// ---- Recorded cues, when there are any --------------------------------------
// name -> AudioBuffer. Populated once, lazily, the first time the context opens
// (which is always behind a user gesture, so decoding is allowed).
const samples = new Map();
let manifestState = "idle"; // idle | loading | done

async function loadManifest(c) {
  if (manifestState !== "idle") return;
  manifestState = "loading";
  try {
    // Deliberately ordinary caching. force-cache pins a 404, which would mean
    // anyone who loaded the site before cues existed keeps the "no audio here"
    // answer forever and never hears a thing.
    const res = await fetch("assets/audio/manifest.json");
    if (!res.ok) throw new Error(`no manifest (${res.status})`);
    const manifest = await res.json();
    // A cue is one file, or a list of takes to choose between — footsteps want
    // variation or the third one in a row starts sounding like a machine.
    await Promise.all(
      Object.entries(manifest).map(async ([name, entry]) => {
        const files = Array.isArray(entry) ? entry : [entry];
        const takes = await Promise.all(
          files.map(async (file) => {
            try {
              const r = await fetch(`assets/audio/${file}`);
              if (!r.ok) return null;
              return await c.decodeAudioData(await r.arrayBuffer());
            } catch {
              return null; // this take stays out; the others may still land
            }
          })
        );
        const usable = takes.filter(Boolean);
        if (usable.length) samples.set(name, usable);
      })
    );
  } catch {
    /* no manifest at all: everything stays synthesised, which is the default */
  }
  manifestState = "done";
}

// Play a recorded cue if one is loaded. Returns false when there is nothing to
// play, which is the signal for the caller to synthesise instead.
function sample(name, gain = 1, delay = 0) {
  const c = live();
  if (!c || !samples.has(name)) return false;
  const takes = samples.get(name);
  const src = c.createBufferSource();
  // Math.random is fine here for the same reason it is fine in noise(): this
  // picks a take, never a game outcome, and never touches the seeded run.
  src.buffer = takes[takes.length === 1 ? 0 : Math.floor(Math.random() * takes.length)];
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(c.currentTime + delay);
  return true;
}

function envelope(c, peak, attack, decay) {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

// A dry hinge giving way: narrow band of noise sliding up and back down.
export function doorCreak() {
  if (sample("door", weight(0.85, 1))) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;

  // A frightened door takes longer to give up: the sweep stretches with dread,
  // so the same hinge sounds more reluctant late in a bad run.
  const slow = weight(1, 1.45);
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 9;
  band.frequency.setValueAtTime(430, t);
  band.frequency.exponentialRampToValueAtTime(1350, t + 0.17 * slow);
  band.frequency.exponentialRampToValueAtTime(620, t + 0.32 * slow);

  const g = envelope(c, 0.13, 0.05, 0.29 * slow);
  src.connect(band).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.42 * slow);
}

// The scare's sting: two detuned saws hauled upward. Bigger packs go higher and
// louder, so the sound carries the same information as the picture.
export function combatSting(count = 3) {
  if (sample("sting")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const weight = Math.min(Math.max((count - 3) / 3, 0), 1);
  const top = 620 + weight * 380;

  const g = envelope(c, 0.1 + weight * 0.05, 0.03, 0.34);
  for (const detune of [-11, 11]) {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(top, t + 0.3);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.38);
  }
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 220;
  g.connect(hp).connect(master);
}

// The blow landing: a low body dropping away under a short burst of grit.
// The blow, plus what it was struck with. The impact itself is the recorded
// cue; the weapon is a short layer over the top of it, so the same file serves
// every weapon and a billhook still does not sound like a plank.
export function combatHit(count = 3, weapon = null) {
  weaponLayer(weapon);
  if (sample("hit")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const weight = Math.min(Math.max((count - 3) / 3, 0), 1);

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(170 + weight * 40, t);
  osc.frequency.exponentialRampToValueAtTime(46, t + 0.22);
  const body = envelope(c, 0.22 + weight * 0.08, 0.008, 0.24);
  osc.connect(body).connect(master);
  osc.start(t);
  osc.stop(t + 0.3);

  const src = c.createBufferSource();
  src.buffer = noise(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1800;
  const grit = envelope(c, 0.14, 0.005, 0.11);
  src.connect(lp).connect(grit).connect(master);
  src.start(t);
  src.stop(t + 0.16);
}

// Metal rings after the hit, wood cracks with it, the saw tears through. Bare
// hands add nothing — that is the point of being bare-handed.
const WEAPON_TONE = {
  machete: "metal", "golf-club": "metal",
  "board-nails": "wood", "grisly-femur": "wood",
  chainsaw: "saw",
};

function weaponLayer(weapon) {
  const tone = WEAPON_TONE[weapon];
  if (!tone) return;
  if (sample(`swing-${tone}`)) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;

  if (tone === "saw") {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.34);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 3.5;
    bp.frequency.value = 1500;
    const g = envelope(c, 0.13, 0.02, 0.34);
    osc.connect(bp).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
    return;
  }

  const metal = tone === "metal";
  const osc = c.createOscillator();
  osc.type = metal ? "triangle" : "square";
  osc.frequency.setValueAtTime(metal ? 2100 : 420, t);
  if (!metal) osc.frequency.exponentialRampToValueAtTime(160, t + 0.09);
  const g = envelope(c, metal ? 0.07 : 0.1, 0.004, metal ? 0.38 : 0.1);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + (metal ? 0.45 : 0.15));
}

// The hour striking eleven: one slow, low toll. Deliberately a single strike
// rather than a running tick — a loop would need starting, stopping and
// tearing down across restarts and game over, for a sound nobody asked to
// keep hearing.
export function tollBell() {
  if (sample("bell")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  for (const [freq, gain, len] of [[110, 0.15, 1.9], [164.8, 0.07, 1.5], [220, 0.04, 1.1]]) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + len + 0.05);
  }
}

// ---- Cues the map was missing ----------------------------------------------
// Each of these is a hook the issue named. They synthesise today and will play
// a recording the moment one is named in the manifest, without a caller change.

// The risen coming through a wall: a snarl over the wall giving way. This is
// the crash #35 left open — the hole appeared in silence.
export function breakThrough() {
  if (sample("break")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;

  // Masonry: a broad noise burst, low and dropping.
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(2600, t);
  lp.frequency.exponentialRampToValueAtTime(280, t + 0.5);
  const crash = envelope(c, 0.26, 0.006, 0.52);
  src.connect(lp).connect(crash).connect(master);
  src.start(t);
  src.stop(t + 0.6);

  // The snarl behind it: a growl that sags rather than rises.
  const growl = c.createOscillator();
  growl.type = "sawtooth";
  growl.frequency.setValueAtTime(132, t + 0.05);
  growl.frequency.exponentialRampToValueAtTime(58, t + 0.46);
  const throat = c.createBiquadFilter();
  throat.type = "lowpass";
  throat.frequency.value = 700;
  const gv = envelope(c, 0.16, 0.07, 0.42);
  growl.connect(throat).connect(gv).connect(master);
  growl.start(t + 0.05);
  growl.stop(t + 0.56);
}

// Cowering: a held breath let go. Noise through a moving bandpass, no pitch —
// the one cue here that should sound like a person rather than a thing.
export function cowerBreath() {
  if (sample("cower")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 2.2;
  band.frequency.setValueAtTime(900, t);
  band.frequency.exponentialRampToValueAtTime(430, t + 0.75);
  const g = envelope(c, 0.1, 0.22, 0.62);
  src.connect(band).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.9);
}

// Picking something up, by class rather than by item: nine items, five sounds.
// Metal rings, wood knocks, liquid sloshes, the saw coughs, and everything else
// is a small dry find.
const ITEM_CUE = {
  machete: "metal", "golf-club": "metal",
  "board-nails": "wood", "grisly-femur": "wood",
  chainsaw: "engine",
  oil: "liquid", gasoline: "liquid", "can-of-soda": "liquid",
  candle: "small",
};

export function itemPickup(itemId) {
  const kind = ITEM_CUE[itemId] || "small";
  if (sample(`item-${kind}`)) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;

  if (kind === "engine") {
    // A sputter that fails to catch: pulsing saw under a lowpass.
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(78, t);
    osc.frequency.linearRampToValueAtTime(120, t + 0.1);
    osc.frequency.linearRampToValueAtTime(64, t + 0.34);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = envelope(c, 0.15, 0.02, 0.34);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
    return;
  }

  if (kind === "liquid") {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 5;
    band.frequency.setValueAtTime(700, t);
    band.frequency.exponentialRampToValueAtTime(1500, t + 0.13);
    band.frequency.exponentialRampToValueAtTime(600, t + 0.24);
    const g = envelope(c, 0.11, 0.02, 0.24);
    src.connect(band).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.3);
    return;
  }

  // metal rings high and long, wood knocks low and short, small sits between.
  const [freq, peak, decay, type] =
    kind === "metal" ? [1750, 0.1, 0.42, "triangle"]
    : kind === "wood" ? [320, 0.14, 0.13, "square"]
    : [900, 0.09, 0.16, "triangle"];
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (kind === "wood") osc.frequency.exponentialRampToValueAtTime(180, t + 0.1);
  const g = envelope(c, peak, 0.005, decay);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + decay + 0.06);
}

// The relic, found. The one unambiguously good thing that happens in this game,
// so it is the one cue that rises.
export function relicFound() {
  if (sample("relic")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  [[392, 0], [523.25, 0.09], [659.25, 0.18]].forEach(([freq, delay]) => {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(0.1, t + delay + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.85);
    osc.connect(g).connect(master);
    osc.start(t + delay);
    osc.stop(t + delay + 0.9);
  });
}

// Crossing the seam: a soft swell as the world changes temperature.
export function seamCross() {
  if (sample("seam")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(320, t);
  band.frequency.exponentialRampToValueAtTime(1600, t + 0.55);
  const g = envelope(c, 0.09, 0.3, 0.4);
  src.connect(band).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.78);
}

// The two endings. Both are slow — whatever just happened, it is over.
export function verdictSting(won) {
  if (sample(won ? "win" : "death")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  // Losing falls: a minor drop. Winning settles onto an open fifth at dawn.
  const voices = won ? [[196, 1.9], [293.66, 1.7], [392, 1.5]] : [[147, 2.2], [138.6, 2.0]];
  voices.forEach(([freq, len], i) => {
    const osc = c.createOscillator();
    osc.type = won ? "triangle" : "sawtooth";
    osc.frequency.setValueAtTime(freq, t);
    if (!won) osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + len);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = won ? 2200 : 620;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.06);
    g.gain.exponentialRampToValueAtTime(won ? 0.09 : 0.13, t + i * 0.06 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t + i * 0.06);
    osc.stop(t + len + 0.05);
  });
}

// Walking into the next room. Two steps, because one reads as a stumble and
// three as a corridor, and the surface follows the world — boards inside,
// grass out the back. That is the same distinction the floors draw, heard
// rather than seen, and it is why these are the one cue with no synthesised
// fallback: a convincing footstep is not something two oscillators do, and a
// bad one is worse than silence.
export function footsteps(world = "indoor") {
  const cue = world === "outdoor" ? "step-grass" : "step-wood";
  // Heavier and slower as dread rises: the same walk, taken worse.
  sample(cue, weight(0.5, 0.72));
  sample(cue, weight(0.4, 0.6), weight(0.19, 0.25));
}

// Something heavy hitting a wall from the other side. Panned, because hearing
// WHICH wall is the entire point — a thump with no direction is just a noise,
// and the player already knows something is wrong.
//
// pan is -1 at the west wall, +1 at the east; north and south sit centre, which
// is honest rather than a shortcoming. Stereo cannot place front from back, and
// faking it with volume would only make a north thump sound quieter.
export function wallThump(pan = 0) {
  const c = live();
  if (!c) return;
  const t = c.currentTime;

  // StereoPannerNode is not everywhere. Without one the thump still lands, it
  // just lands in the middle.
  let out = master;
  if (typeof c.createStereoPanner === "function") {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(master);
    out = p;
  }

  // The knock: low, almost no attack, so it reads as coming through a wall
  // rather than happening in the room.
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(96, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.3);
  const body = envelope(c, weight(0.2, 0.3), 0.012, 0.32);
  osc.connect(body).connect(out);
  osc.start(t);
  osc.stop(t + 0.4);

  // Plaster and grit shaken loose with it.
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const grit = envelope(c, 0.07, 0.008, 0.22);
  src.connect(lp).connect(grit).connect(out);
  src.start(t);
  src.stop(t + 0.3);
}

// The event window arriving: a card turned over. Short and papery, well under
// the cues it introduces — this is punctuation, not an announcement.
export function cardTurn() {
  if (sample("card")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(2600, t);
  band.frequency.exponentialRampToValueAtTime(900, t + 0.13);
  const g = envelope(c, 0.05, 0.004, 0.13);
  src.connect(band).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.18);
}

// Landing on a doorway with the keyboard. Deliberately tied to focus and not to
// hover: a tick that fires every time the pointer crosses a door is not an
// affordance, it is a fly in the room.
export function doorwayTick() {
  if (sample("tick")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1180, t);
  osc.frequency.exponentialRampToValueAtTime(760, t + 0.05);
  const g = envelope(c, 0.035, 0.003, 0.05);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.09);
}

// ---- Beds: the two sounds that run instead of firing -------------------------
// Everything above is struck and forgotten. These are held, which makes them a
// different problem: they have to survive a mute, a new game and a game over
// without stacking, leaking, or outliving the run they belong to.
//
// The rule is that *wanted* and *running* are separate. The flags say what the
// game wants; the nodes say what the context is currently doing. Muting tears
// the nodes down but leaves the wanting intact, so switching sound back on
// mid-run restores exactly what should be there.

let bed = null; // { src, gain, filter, lfo }
let bedWanted = false;
let dread = 0; // 0 at nine o'clock, 1 at midnight

// Wind, synthesised rather than sourced — and not for want of a file. Noise
// through a moving filter loops seamlessly by construction, weighs nothing, and
// can follow the clock: a recording is the same wind at nine as at midnight.
export function startAmbience() {
  bedWanted = true;
  const c = live();
  if (!c || bed) return;

  const src = c.createBufferSource();
  src.buffer = longNoise(c);
  src.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.7;
  filter.frequency.value = 320;

  const gain = c.createGain();
  gain.gain.value = 0.0001;

  // The wind breathes. Without this it is a hiss; with it, it is weather.
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.055;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 150;
  lfo.connect(lfoDepth).connect(filter.frequency);

  src.connect(filter).connect(gain).connect(master);
  src.start();
  lfo.start();
  // Fade in. Sound arriving at full strength announces itself as a sound
  // effect; weather is just suddenly noticed. Unless the room is currently
  // being held quiet for a scare, in which case it stays down and unduck()
  // brings it back with everything else.
  if (!ducked) gain.gain.exponentialRampToValueAtTime(bedLevel(), c.currentTime + 3.5);

  bed = { src, gain, filter, lfo };
}

function bedLevel() {
  // Quiet, and quietest early: this has to sit under everything else or it
  // stops being a bed and starts being a noise.
  return 0.012 + dread * 0.03;
}

// How much heavier a one-shot plays when the game is frightened. Deliberately
// mild — this should be felt across a run rather than noticed in a moment, and
// a cue that doubles in volume is a bug report, not atmosphere.
function weight(lo, hi) {
  return lo + (hi - lo) * dread;
}

// The tension director's number, from engine dread(). Everything atmospheric
// reads this rather than inventing its own sense of intensity, which is what
// keeps the wind, the dark and the cues agreeing about the same moment.
export function setDread(x) {
  dread = Math.min(Math.max(Number(x) || 0, 0), 1);
  if (!bed) return;
  const c = live();
  if (!c) return;
  bed.gain.gain.linearRampToValueAtTime(bedLevel(), c.currentTime + 2);
  bed.filter.frequency.linearRampToValueAtTime(320 + dread * 210, c.currentTime + 2);
}

function tearDownBed() {
  if (!bed) return;
  try {
    bed.src.stop();
    bed.lfo.stop();
  } catch {
    /* already stopped */
  }
  bed = null;
}

export function stopAmbience() {
  bedWanted = false;
  const c = live();
  if (!c || !bed) return tearDownBed();
  // Let it fall away rather than cutting: a hard stop on a held sound is a
  // click, and the end of a run has enough going on.
  const dying = bed;
  bed = null;
  dying.gain.gain.cancelScheduledValues(c.currentTime);
  dying.gain.gain.setValueAtTime(dying.gain.gain.value, c.currentTime);
  dying.gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.4);
  setTimeout(() => {
    try {
      dying.src.stop();
      dying.lfo.stop();
    } catch {
      /* fine */
    }
  }, 1700);
}

// ---- The quiet before ---------------------------------------------------------
// Cinema's oldest tell: the room goes quiet, and then the thing happens. The
// bed drops out, a beat of true silence holds, and the sting lands into it.
//
// Returns how long the caller should wait before firing — 0 when there is
// nothing to duck, so a muted player waits for nothing and the turn never
// stalls on audio that is not playing.
const DUCK_MS = 150;
const HOLD_MS = 560;
let ducked = false;

export function duckForScare() {
  const c = live();
  // Nothing audible means nothing to take away, and a silence nobody can hear
  // is just a delay.
  if (!c || (!bed && !murmur)) return 0;

  ducked = true;
  const t = c.currentTime;
  const fall = DUCK_MS / 1000;
  for (const node of [bed, murmur]) {
    if (!node) continue;
    const g = node.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
    g.exponentialRampToValueAtTime(0.0001, t + fall);
  }
  return DUCK_MS + HOLD_MS;
}

// Put the room back. Called when the fight is over rather than when the window
// opens: the quiet is meant to hold while the pack stands there.
export function unduck() {
  if (!ducked) return;
  ducked = false;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  if (bed) {
    bed.gain.gain.cancelScheduledValues(t);
    bed.gain.gain.setValueAtTime(Math.max(bed.gain.gain.value, 0.0001), t);
    bed.gain.gain.exponentialRampToValueAtTime(bedLevel(), t + 1.6);
  }
  if (murmur) {
    murmur.gain.gain.cancelScheduledValues(t);
    murmur.gain.gain.setValueAtTime(Math.max(murmur.gain.gain.value, 0.0001), t);
    murmur.gain.gain.exponentialRampToValueAtTime(0.02, t + 0.8);
  }
}

// The pack, breathing, for as long as it is on screen. Pitched under the cues
// so it never competes with the fight it belongs to.
let murmur = null;
let murmurWanted = 0;

export function startMurmur(count = 3) {
  murmurWanted = count || 3;
  const c = live();
  if (!c || murmur) return;

  const gain = c.createGain();
  gain.gain.value = 0.0001;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 340;

  const src = c.createBufferSource();
  src.buffer = longNoise(c);
  src.loop = true;

  // Two detuned voices under the noise: a crowd, not a machine. Bigger packs
  // sit slightly lower and louder, the same information the scare carries.
  const weight = Math.min(Math.max((murmurWanted - 3) / 3, 0), 1);
  const voices = [];
  for (const [freq, detune] of [[62, -7], [77, 9]]) {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq - weight * 8;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start();
    voices.push(osc);
  }
  src.connect(filter);
  filter.connect(gain).connect(master);
  src.start();
  if (!ducked) gain.gain.exponentialRampToValueAtTime(0.02 + weight * 0.014, c.currentTime + 1.1);

  murmur = { src, gain, filter, voices };
}

function tearDownMurmur() {
  if (!murmur) return;
  try {
    murmur.src.stop();
    for (const v of murmur.voices) v.stop();
  } catch {
    /* already stopped */
  }
  murmur = null;
}

export function stopMurmur() {
  murmurWanted = 0;
  const c = live();
  if (!c || !murmur) return tearDownMurmur();
  const dying = murmur;
  murmur = null;
  dying.gain.gain.cancelScheduledValues(c.currentTime);
  dying.gain.gain.setValueAtTime(dying.gain.gain.value, c.currentTime);
  dying.gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
  setTimeout(() => {
    try {
      dying.src.stop();
      for (const v of dying.voices) v.stop();
    } catch {
      /* fine */
    }
  }, 600);
}
