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
const CALM_KEY = "zitp:calm";

let ctx = null;
let master = null;
let limiter = null;
let world = null;
let weather = null;
let dry = null;
let send = null;
let convolver = null;
// Transparent: well above anything the cues put out, so the filter does
// nothing at all until it is asked to.
const OPEN_HZ = 20000;
const MUFFLED_HZ = 520;
let noiseBuffer = null;
let bedNoise = null;
let muted = readMuted();
let calm = readCalm();

function readMuted() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true; // storage blocked (private mode, embedded) — stay quiet
  }
}

// ---- Calm mode ---------------------------------------------------------------
// The scares, the blood, the phantoms and the buzzing are the point of all this
// work, and they are also a wall for players who want the game without the
// assault. This is the way past it.
//
// Deliberately NOT the same thing as prefers-reduced-motion. That is an OS
// setting about vestibular safety; this is a choice about intensity. Someone
// can want full animation and no jump scares, or the reverse, so they are two
// independent gates and every effect checks both.
//
// Lives here beside the mute flag because this is the module that already owns
// persisted preferences, and because the audio side needs it too — render
// imports it, and audio cannot import render.
function readCalm() {
  try {
    return localStorage.getItem(CALM_KEY) === "1";
  } catch {
    return false; // storage blocked: the game is what it is
  }
}

export function isCalm() {
  return calm;
}

export function setCalm(next) {
  calm = !!next;
  try {
    localStorage.setItem(CALM_KEY, calm ? "1" : "0");
  } catch {
    /* the setting simply will not survive a reload */
  }
  if (typeof document !== "undefined") {
    document.body.classList.toggle("calm", calm);
  }
  // The beds are already running; they move to the new level rather than
  // restarting, so switching mid-run is not itself an event.
  applyBedLevel();
  applyScore();
  return calm;
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
  if (dry) dry.gain.value = muted ? 0 : 1;
  // Un-muting is itself a click, which is exactly the gesture a browser wants
  // before it will let a page make noise — so open the context here.
  if (!muted) {
    audio();
    // Nothing is built while muted, so anything that was supposed to be
    // running has to be built now rather than waiting for the next event.
    if (bedWanted) startAmbience();
    if (murmurWanted) startMurmur(murmurWanted);
    if (scoreWanted) { buildScore(); applyScore(); }
    // No fade: there is nothing to fade from, and the first cue after unmuting
    // should already be in the right room.
    applySpace(0);
  } else {
    tearDownBed();
    tearDownMurmur();
    tearDownScore();
    // The convolver is left alone. It holds no oscillators and costs nothing
    // with silence going into it, and the impulse it holds is still the right
    // one for wherever the player is standing.
  }
  return muted;
}

// Created lazily and always resumed: browsers hand you a suspended context
// until a user gesture, and every caller here runs from a click or a keypress.
function audio() {
  if (ctx) {
    // Not while the page is hidden. Timers still fire in a background tab, so
    // a delayed beat arriving after sleep() suspended the context would resume
    // it and play into an empty room — the one way the throttling could undo
    // itself. Coming back into view resumes it deliberately.
    if (ctx.state === "suspended" && !document.hidden) ctx.resume().catch(() => {});
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    // A limiter, last in the chain before the speakers. Two jobs, both of them
    // about the hardware most people will actually use: stings stop clipping
    // when several land together, and the make-up keeps the quiet bed above a
    // phone's noise floor instead of under it.
    //
    // Gentle settings on purpose — this is a safety net, not a sound. A hard
    // ratio here would pump the bed every time a door creaked.
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(limiter);

    // Two buses under the one mute. `master` is everything at your ear —
    // breathing, your own footsteps, the cues that are happening to you. `world`
    // is everything happening somewhere else, and it runs through a lowpass
    // that is transparent until something closes it.
    //
    // The split exists so cowering can muffle the house without muffling the
    // sound of you holding your breath in it. #78 wants this routing too, for
    // placing sounds rather than dulling them; the bus is built here because
    // this is the issue that first needed it.
    world = ctx.createBiquadFilter();
    world.type = "lowpass";
    world.frequency.value = OPEN_HZ;
    world.Q.value = 0.4;
    world.connect(master);

    // A third bus that the reverb send does not tap. The beds live here: they
    // are already a recorded room, and running a room through a room only
    // smears it. Muted in tandem with master rather than routed through it,
    // because the send hangs off master and anything upstream of that point
    // cannot be kept out of it.
    dry = ctx.createGain();
    dry.gain.value = muted ? 0 : 1;
    dry.connect(limiter);

    // `weather` is to `dry` what `world` is to `master`: the same muffling, for
    // the sounds that skip the reverb. muffle() drives both.
    weather = ctx.createBiquadFilter();
    weather.type = "lowpass";
    weather.frequency.value = OPEN_HZ;
    weather.Q.value = 0.4;
    weather.connect(dry);

    buildSpace(ctx);
    master.connect(send);
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
function sample(name, gain = 1, delay = 0, bus = null) {
  const c = live();
  if (!c || !samples.has(name)) return false;
  const takes = samples.get(name);
  const src = c.createBufferSource();
  // Math.random is fine here for the same reason it is fine in noise(): this
  // picks a take, never a game outcome, and never touches the seeded run.
  src.buffer = takes[takes.length === 1 ? 0 : Math.floor(Math.random() * takes.length)];
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(bus || master);
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
export function doorCreak(dir = null) {
  const out = dir ? placed(dir, master) : master;
  if (sample("door", weight(0.85, 1), 0, out)) return;
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
  src.connect(band).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.42 * slow);
}

// The scare's sting: two detuned saws hauled upward. Bigger packs go higher and
// louder, so the sound carries the same information as the picture.
export function combatSting(count = 3) {
  // Recorded when the manifest names one; the oscillators below are the fallback.
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
  src.connect(band).connect(g).connect(dry || master);
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
export function footsteps(surface = "indoor", dir = null) {
  const cue = surface === "outdoor" ? "step-grass" : "step-wood";
  // Your own steps: at your ear, but they still come from the door you used.
  const out = dir ? placed(dir, master) : master;
  // Heavier and slower as dread rises: the same walk, taken worse.
  sample(cue, weight(0.5, 0.72), 0, out);
  sample(cue, weight(0.4, 0.6), weight(0.19, 0.25), out);
}

// A wick nearly losing it: a short breath of noise pulled downward, and a
// small catch at the end where it takes again. Goes to master, which means it
// goes through the room — the candle is in here with you, and out on the patio
// it should sound like it.
export function wickHiss() {
  const c = live();
  if (!c) return;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.1;
  // Falling, because that is the whole information: the flame is losing
  // height. A rising hiss would read as it flaring up.
  band.frequency.setValueAtTime(2600, t);
  band.frequency.exponentialRampToValueAtTime(620, t + 0.42);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.008, t + 0.4);
  // The catch: it comes back, not quite all the way.
  g.gain.exponentialRampToValueAtTime(0.022, t + 0.72);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);

  src.connect(band).connect(g).connect(master);
  src.loop = true; // half a second of noise under a one-second breath
  src.start(t);
  src.stop(t + 1.1);
}

// ---- Sleeping ----------------------------------------------------------------
// A hidden tab should not be running an audio graph. Suspending the context
// stops its clock and its processing outright — cheaper than tearing anything
// down and, unlike a teardown, it comes back exactly where it left off.
//
// Nothing is torn down deliberately. The wanted/running split exists so that
// muting can free the nodes, but this is not a mute: the player has not asked
// for silence, they have looked away, and everything should be where they left
// it when they look back. Suspending gives that for free.
export function sleep(on) {
  if (!ctx) return false; // never opened: nothing to put to sleep
  if (on) {
    if (ctx.state === "running") ctx.suspend().catch(() => {});
    return true;
  }
  if (ctx.state === "suspended" && !muted) ctx.resume().catch(() => {});
  return false;
}

// ---- Haptics ------------------------------------------------------------------
// Not sound, so the mute toggle does not govern it — a player who silenced the
// game did not ask their phone to stop moving. It gets its own switch, which
// the calm-mode issue will own.
//
// navigator.vibrate is absent on desktop and ignored by browsers that dislike
// it; both are fine, this is decoration.
let hapticsOn = true;

export function setHaptics(on) {
  hapticsOn = !!on;
}

export function buzz(pattern) {
  if (!hapticsOn || calm) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* a browser that would rather not; nothing here depends on it */
  }
}

// ---- Placing a sound ---------------------------------------------------------
// One owner for "where did that come from". Cues take a compass direction and
// this turns it into a node to connect to; nothing else in the file knows what
// a pan value is.
//
// East right, west left, and deliberately gentle: half, not hard. A hard pan
// puts a sound outside the listener's head, which is wrong for something on the
// other side of a wall you are standing next to.
//
// North and south both sit centre, because stereo genuinely cannot place front
// from back — but south is the wall behind you, and things behind you are
// duller. A little top taken off is the honest version of that difference;
// making it quieter would just sound further away.
const PAN_BY_DIR = { E: 0.5, W: -0.5, N: 0, S: 0 };
const BEHIND_HZ = 1500;

function placed(dir, bus) {
  const c = live();
  const out = bus || master;
  if (!c) return out;

  let head = out;
  if (dir === "S") {
    const dull = c.createBiquadFilter();
    dull.type = "lowpass";
    dull.frequency.value = BEHIND_HZ;
    dull.connect(head);
    head = dull;
  }
  if (typeof c.createStereoPanner === "function") {
    const p = c.createStereoPanner();
    p.pan.value = PAN_BY_DIR[dir] ?? 0;
    p.connect(head);
    head = p;
  }
  return head;
}

// Something heavy hitting a wall from the other side. Panned, because hearing
// WHICH wall is the entire point — a thump with no direction is just a noise,
// and the player already knows something is wrong.
//
// pan is -1 at the west wall, +1 at the east; north and south sit centre, which
// is honest rather than a shortcoming. Stereo cannot place front from back, and
// faking it with volume would only make a north thump sound quieter.
export function wallThump(dir = "N", force = 1) {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  // `force` is the second, harder knock of the staged break-in (#96): the same
  // knock leaned on, not a different sound. A new sample for "the same thing
  // again but worse" is how a cue set stops being legible.
  const push = Math.min(2, Math.max(0.5, force));
  // Through a wall, so it belongs to the house rather than to you.
  const out = placed(dir, world || master);

  // The knock: low, almost no attack, so it reads as coming through a wall
  // rather than happening in the room.
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(96 * (1 + (push - 1) * 0.12), t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.3);
  const body = envelope(c, weight(0.2, 0.3) * push, 0.012, 0.32);
  osc.connect(body).connect(out);
  osc.start(t);
  osc.stop(t + 0.4);

  // Plaster and grit shaken loose with it.
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const grit = envelope(c, 0.07 * push, 0.008, 0.22);
  src.connect(lp).connect(grit).connect(out);
  src.start(t);
  src.stop(t + 0.3);
}

// A phantom: something dragging along a wall that has nothing behind it. Drier
// and thinner than the real thump so it does not read as a break-in about to
// happen — it is meant to be doubted, not acted on.
export function phantomScratch(dir = "N") {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const out = placed(dir, world || master);

  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 6;
  band.frequency.setValueAtTime(1500, t);
  band.frequency.exponentialRampToValueAtTime(760, t + 0.42);
  // Quiet on purpose. A phantom you cannot quite dismiss is worth more than one
  // that makes you look.
  const g = envelope(c, 0.05, 0.09, 0.4);
  src.connect(band).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.55);
}

// A shovel going in and coming out. Grit on the way down, a duller weight on
// the way up — the two halves are what make it read as work rather than a hit.
export function shovel() {
  if (sample("shovel")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(2200, t);
  bp.frequency.exponentialRampToValueAtTime(700, t + 0.26);
  const cut = envelope(c, 0.12, 0.01, 0.26);
  src.connect(bp).connect(cut).connect(master);
  src.start(t);
  src.stop(t + 0.32);

  // The earth landing.
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, t + 0.2);
  osc.frequency.exponentialRampToValueAtTime(52, t + 0.44);
  const thud = envelope(c, 0.1, 0.02, 0.24);
  osc.connect(thud).connect(master);
  osc.start(t + 0.2);
  osc.stop(t + 0.5);
}

// Two beats, close together, low. Under the digging rather than over it: this
// is the thing you notice only once you stop hearing it.
export function heartbeat(strength = 1) {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  for (const [at, gain] of [[0, 0.16], [0.29, 0.11]]) {
    // The fundamental. On earbuds this IS the heartbeat; on a phone speaker,
    // which rolls off below roughly 400Hz, almost none of it survives.
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(64, t + at);
    osc.frequency.exponentialRampToValueAtTime(34, t + at + 0.2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(gain * strength, t + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.24);
    osc.connect(g).connect(dry || master);
    osc.start(t + at);
    osc.stop(t + at + 0.3);

    // A short mid-frequency knock on top, quiet and quick. A speaker that
    // cannot move air at 40Hz can reproduce this, and the ear rebuilds the
    // missing fundamental from it — the beat is still felt as low. Costs
    // earbuds almost nothing because it is brief and well under the body.
    const thump = c.createOscillator();
    thump.type = "triangle";
    thump.frequency.setValueAtTime(305, t + at);
    thump.frequency.exponentialRampToValueAtTime(130, t + at + 0.09);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.0001, t + at);
    tg.gain.exponentialRampToValueAtTime(gain * strength * 0.42, t + at + 0.012);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.11);
    thump.connect(tg).connect(dry || master);
    thump.start(t + at);
    thump.stop(t + at + 0.16);
  }
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
// A recorded loop for a held sound, if the manifest named one. The beds build
// their own buffer source rather than going through sample(), because they loop
// and carry their own filter chain — so this hands back the buffer and lets the
// caller wire it exactly as it wires the synthesised one.
function loopBuffer(name) {
  const takes = samples.get(name);
  return takes && takes.length ? takes[0] : null;
}

export function startAmbience() {
  bedWanted = true;
  const c = live();
  if (!c || bed) return;

  // A recording is a room; noise through a filter is a synthesizer pretending
  // to be one. Take the recording when there is one, and keep the synth as the
  // fallback for a failed load — that rule has not changed.
  const recorded = loopBuffer("bed-wind");
  const src = c.createBufferSource();
  src.buffer = recorded || longNoise(c);
  src.loop = true;

  const filter = c.createBiquadFilter();
  // Recorded room tone is already voiced; a bandpass on top would only take
  // the body out of it. It still passes through a filter node so setDread can
  // move the tone either way, just opened up.
  filter.type = recorded ? "lowpass" : "bandpass";
  filter.Q.value = recorded ? 0.4 : 0.7;
  filter.frequency.value = recorded ? 6000 : 320;

  const gain = c.createGain();
  gain.gain.value = 0.0001;

  // The wind breathes. Without this it is a hiss; with it, it is weather.
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.055;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 150;
  lfo.connect(lfoDepth).connect(filter.frequency);

  src.connect(filter).connect(gain).connect(weather || master);
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
  // stops being a bed and starts being a noise. Calm keeps the weather —
  // silence would be its own kind of wrong — but takes it further down.
  const base = 0.012 + dread * 0.03;
  return calm ? base * 0.55 : base;
}

// Move a running bed to whatever the level should be now, without restarting
// it. Used when dread moves and when calm is switched mid-run.
function applyBedLevel() {
  const c = live();
  if (!c || !bed) return;
  bed.gain.gain.cancelScheduledValues(c.currentTime);
  bed.gain.gain.setValueAtTime(Math.max(bed.gain.gain.value, 0.0001), c.currentTime);
  bed.gain.gain.exponentialRampToValueAtTime(bedLevel(), c.currentTime + 1.2);
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

// ---- The room you are standing in --------------------------------------------
// A reverb send, so that inside and outside are different *spaces* and not just
// different palettes. Close your eyes on the patio and the footsteps should
// already have told you the walls are gone.
//
// One convolver, fed from master, returning to the limiter — a send, not an
// insert, so the dry cue is never softened by the wet one. The impulse is
// generated here rather than shipped: an IR is a big file for something that is
// noise with a curve on it, and generating it means the two rooms can be tuned
// by numbers instead of by re-recording.
//
// The beds do not go through this. They are on `dry` for that reason: a
// recorded room already has its own, and putting it in another one just makes
// mud. Cues only, which is the whole point — the cue tells you where you are.

const SPACES = {
  // seconds, decay shape, tone, send level, pre-delay
  // Indoor: short and dark. A hallway with the doors shut, not a cathedral —
  // the tail has to be gone before the next syllable of the cue lands or the
  // house starts sounding like a car park.
  indoor: { seconds: 0.5, decay: 3.4, tone: -0.55, level: 0.3, predelay: 0.006 },
  // Outdoor: longer, thinner, and further away. There are no walls to give you
  // a real tail out here, so this is not a room — it is distance, which the ear
  // reads from a late, quiet, top-heavy return.
  outdoor: { seconds: 1.7, decay: 2.1, tone: 0.5, level: 0.55, predelay: 0.026 },
};

// Wanted and loaded, kept apart for the same reason the beds keep them apart:
// nothing is built while muted, so the world can change three times behind a
// mute and the convolver will know nothing about it. `spaceWanted` is where the
// player is; `spaceLoaded` is which impulse is actually in the convolver.
let spaceWanted = "indoor";
let spaceLoaded = null;
let spacePending = null; // a swap already scheduled, so renders do not stack them

// Noise with an exponential decay on it, which is what a room mostly is. Two
// channels, generated independently: a stereo return off a mono cue is what
// makes the space feel wider than the sound that entered it.
//
// `tone` tilts the noise before the decay: negative runs a one-pole lowpass
// over it (dark, absorbent, soft furnishings), positive takes the difference
// instead (thin and airy, which is what distance sounds like once the ground
// has eaten the bottom end).
function impulse(c, { seconds, decay, tone, predelay }) {
  const rate = c.sampleRate;
  const head = Math.floor(rate * predelay);
  const frames = head + Math.floor(rate * seconds);
  const buf = c.createBuffer(2, frames, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let last = 0;
    for (let i = head; i < frames; i++) {
      // Math.random again, and again for texture only: an impulse response is
      // not a game outcome and never touches the seeded run.
      const white = Math.random() * 2 - 1;
      let v = white;
      if (tone < 0) {
        last = last + (white - last) * (1 + tone); // one-pole lowpass
        v = last;
      } else if (tone > 0) {
        v = white - last * tone; // one-pole highpass, by difference
        last = white;
      }
      const t = (i - head) / (frames - head);
      data[i] = v * (1 - t) ** decay;
    }
    // Normalise by the impulse's own energy, which is not decoration: a second
    // of noise convolved with a cue is about fifty times the gain that went in,
    // and unscaled it drove the limiter into pumping the whole mix on every
    // door. Dividing by sqrt(sum of squares) makes the convolution roughly
    // unity, which is what lets `level` below mean a send level instead of a
    // number found by trial. It also stops the long room being louder than the
    // short one purely for being longer.
    let energy = 0;
    for (let i = 0; i < frames; i++) energy += data[i] * data[i];
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < frames; i++) data[i] *= scale;
  }
  return buf;
}

function buildSpace(c) {
  if (send) return;
  send = c.createGain();
  send.gain.value = 0;
  convolver = c.createConvolver();
  // The browser's own normalisation is off because impulse() already does it,
  // to a formula this file controls. Two of them fighting is how a send level
  // stops meaning anything.
  convolver.normalize = false;
  send.connect(convolver);
  // Back in after the mute gain, not before it: the send taps master's output,
  // so the wet path is already muted with everything else and must not be
  // muted twice.
  convolver.connect(limiter);
  setSpace(spaceWanted, 0);
}

// Called on every render, so it has to be cheap and idempotent: only a change
// of world does anything at all.
//
// The impulse is swapped rather than crossfaded between two convolvers. One
// convolver is half the cost on the phones this has to run on, and the swap is
// inaudible because the send is taken to silence first — you cannot hear a tail
// being cut off if there is no tail. That is also why the fade down is faster
// than the fade up: the room you are leaving should be gone by the time the
// door shuts, and the one you are arriving in can take its time.
export function setSpace(world, seconds = 1) {
  spaceWanted = world === "outdoor" ? "outdoor" : "indoor";
  applySpace(seconds);
}

function applySpace(seconds = 1) {
  const next = spaceWanted;
  // A render is not an event — it happens several times over a single move, and
  // without this the fade below would be scheduled once per render, generating
  // a second and a third impulse and stepping the send level as each landed.
  if (next === spaceLoaded || next === spacePending) return;
  const c = live();
  // Muted, or no context yet: `spaceWanted` is already recorded, and unmuting
  // calls back here. Leaving it at that is what stopped this working the first
  // time — the room was set behind a mute, the flag said it had been done, and
  // switching sound on outdoors put you in a hallway.
  if (!c || !send || !convolver) return;

  const spec = SPACES[next];
  const t = c.currentTime;
  const down = Math.min(seconds * 0.35, 0.35);

  send.gain.cancelScheduledValues(t);
  send.gain.setValueAtTime(send.gain.value, t);

  if (!convolver.buffer || seconds <= 0) {
    // First build, or an explicit instant set: nothing is ringing yet.
    spacePending = null;
    spaceLoaded = next;
    convolver.buffer = impulse(c, spec);
    send.gain.linearRampToValueAtTime(spec.level, t + Math.max(seconds, 0.02));
    return;
  }

  spacePending = next;
  send.gain.linearRampToValueAtTime(0, t + down);
  // setTimeout rather than an AudioParam callback because there is no such
  // thing: the buffer swap is a main-thread assignment and has to be scheduled
  // on the main thread's clock.
  setTimeout(() => {
    spacePending = null;
    if (spaceWanted !== next || !convolver) return; // the world changed again mid-fade
    const c2 = live();
    if (!c2) return;
    spaceLoaded = next;
    convolver.buffer = impulse(c2, spec);
    const t2 = c2.currentTime;
    send.gain.cancelScheduledValues(t2);
    send.gain.setValueAtTime(0, t2);
    send.gain.linearRampToValueAtTime(spec.level, t2 + Math.max(seconds - down, 0.1));
  }, down * 1000 + 30);
}

// Shut the house out, or let it back in. Rides the world bus, so what you can
// still hear clearly is whatever is at your ear — which is the point of the
// scene this was built for: you are not out there with them.
export function muffle(on, seconds = 0.45) {
  const c = live();
  if (!c || !world) return;
  const t = c.currentTime;
  for (const f of [world, weather]) {
    if (!f) continue;
    f.frequency.cancelScheduledValues(t);
    f.frequency.setValueAtTime(f.frequency.value, t);
    f.frequency.exponentialRampToValueAtTime(on ? MUFFLED_HZ : OPEN_HZ, t + seconds);
  }
}

// Somebody walking past, on the other side of a wall. The ordinary footstep
// takes, at a fraction of the gain and routed through the world bus — so when
// the house is muffled these are muffled with it. The same sound as your own
// steps, placed somewhere you are not.
export function passingSteps(surface = "indoor") {
  const cue = surface === "outdoor" ? "step-grass" : "step-wood";
  const bus = world || master;
  sample(cue, 0.2, 0, bus);
  sample(cue, 0.16, 0.34, bus);
  sample(cue, 0.12, 0.7, bus);
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
// Calm still gets the shape of the beat — the room going quiet is not the
// frightening part — but it does not get held there.
const CALM_HOLD_MS = 180;
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
  return DUCK_MS + (calm ? CALM_HOLD_MS : HOLD_MS);
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

// ---- The score, and its ending ----------------------------------------------
// Barely tonal, well under everything, more felt than heard. It thickens by one
// voice an hour — and then at eleven it stops, and does not come back.
//
// That silence is the point of writing it at all. Three hours of something
// under the floor is what makes its absence in the last hour land as a change
// rather than as nothing; a game with no score has no way to take one away.
//
// On master rather than the world bus, deliberately: a score is not in the
// house. Cowering muffles the room and leaves the music where it is, which is
// what film does — the score does not duck because a character is hiding.
//
// A1, its fifth, and the octave. Low, close together, and detuned enough to
// beat slowly against each other rather than sound like a chord.
// The drone. 55Hz and 82Hz carry most of the weight and neither exists on a
// phone speaker, so each note also sounds a quiet partial an octave up, which
// does survive — the ear puts the low note back from it. On earbuds the
// partials sit far enough down to read as timbre rather than as extra notes.
//
// A voice here is a NOTE, not an oscillator, which matters: SCORE_LAYERS counts
// voices to decide how full the hour sounds, and pairing the partials into the
// same entry keeps that count meaning what it says.
const SCORE_VOICES = [
  { hz: 55, detune: -6, gain: 0.030, partial: 0.30 },
  { hz: 82.4, detune: 5, gain: 0.020, partial: 0.28 },
  { hz: 110, detune: -9, gain: 0.013, partial: 0 }, // already above the rolloff
];
// Hour to voice count. The last hour is the empty one.
const SCORE_LAYERS = { 21: 1, 22: 2, 23: 0 };
const SCORE_FADE = 6;

let score = null; // { voices: [{osc, gain}], lfo }
let scoreWanted = 0; // how many voices the game wants; 0 means silence

function buildScore() {
  const c = live();
  if (!c || score) return;

  // One slow shared wobble across the whole score, so the voices drift together
  // instead of each having its own idea of the tempo.
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.037;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 1.6;
  lfo.connect(lfoDepth);

  const voices = SCORE_VOICES.map(({ hz, detune, gain, partial }) => {
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.connect(dry || master);

    const oscs = [];
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz;
    osc.detune.value = detune;
    lfoDepth.connect(osc.detune);
    osc.connect(g);
    osc.start();
    oscs.push(osc);

    // The octave, quieter, on the same gain so it fades in and out with its
    // note rather than becoming a voice of its own.
    if (partial > 0) {
      const up = c.createOscillator();
      up.type = "sine";
      up.frequency.value = hz * 2;
      up.detune.value = detune + 3;
      lfoDepth.connect(up.detune);
      const ug = c.createGain();
      ug.gain.value = partial;
      up.connect(ug).connect(g);
      up.start();
      oscs.push(up);
    }
    return { oscs, gain: g, level: gain };
  });
  lfo.start();
  score = { voices, lfo };
}

function applyScore() {
  const c = live();
  if (!c || !score) return;
  const t = c.currentTime;
  // The newest voice is the one relief takes away — the score falls back an
  // hour for a turn rather than going quiet, so what you hear is the pressure
  // easing rather than the music stopping.
  const top = scoreWanted - 1;
  score.voices.forEach((v, i) => {
    let target = i < scoreWanted ? v.level * (calm ? 0.5 : 1) : 0.0001;
    if (i === top && scoreRelief > 0) target = Math.max(0.0001, target * (1 - scoreRelief));
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), t);
    // Long fades. A voice arriving or leaving should never be an event.
    v.gain.gain.exponentialRampToValueAtTime(target, t + SCORE_FADE);
  });
}

// How much the top layer is pulled back, 0..1, from the engine's relief. Its
// own setter rather than a second argument to setScoreHour, because the hour
// changes seven times a night and this changes every turn.
let scoreRelief = 0;

export function setScoreRelief(x) {
  const next = Math.min(1, Math.max(0, Number(x) || 0));
  if (Math.abs(next - scoreRelief) < 0.01) return;
  scoreRelief = next;
  applyScore();
}

// Called whenever the hour is drawn. Silence at eleven is a stop, not a fade to
// nothing that lingers — but it still takes its six seconds, because the bell
// is what the player should notice, not the music leaving.
export function setScoreHour(hour) {
  scoreWanted = SCORE_LAYERS[hour] ?? 0;
  if (scoreWanted === 0) {
    if (score) applyScore();
    return;
  }
  buildScore();
  applyScore();
}

function tearDownScore() {
  if (!score) return;
  try {
    for (const v of score.voices) for (const o of v.oscs) o.stop();
    score.lfo.stop();
  } catch {
    /* already stopped */
  }
  score = null;
}

export function stopScore() {
  scoreWanted = 0;
  const c = live();
  if (!c || !score) return tearDownScore();
  const dying = score;
  score = null;
  const t = c.currentTime;
  for (const v of dying.voices) {
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), t);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  }
  setTimeout(() => {
    try {
      for (const v of dying.voices) for (const o of v.oscs) o.stop();
      dying.lfo.stop();
    } catch {
      /* fine */
    }
  }, 2200);
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

  const recordedMurmur = loopBuffer("murmur");
  const src = c.createBufferSource();
  src.buffer = recordedMurmur || longNoise(c);
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
  filter.connect(gain).connect(weather || master);
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
