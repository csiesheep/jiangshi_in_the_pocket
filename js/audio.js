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

// The `jitp:` prefix is not cosmetic. Every game on games.csiesheep.com
// shares one origin and localStorage is origin-scoped, so a key named for
// the sibling is the SAME key — these read and wrote Grave Errand's.
const KEY = "jitp:muted";

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

// SOUND IS ON BY DEFAULT (#107). It was off, and the user asked why they could
// not hear anything - which is the report that found the real hole: the sound
// button went with the whole utility panel in #73, leaving the M key as the only
// switch in the game. There is no M key on a phone, so a phone player could
// never turn sound on at all. A horror game that is silent unless you find an
// undocumented keyboard shortcut is silent.
//
// NO CONTROL BUTTON, by ruling. M stays, and that matters: it is the only way a
// desktop player can quiet this quickly, and the ruling was about a button.
// Anyone on a phone who wants silence still has the browser's own tab mute,
// which is the honest cost of the ruling and is written down rather than argued
// with.
//
// A STORED "1" STILL MUTES, and that is deliberate rather than incidental. It
// means somebody chose silence, and a choice outranks a default.
//
// WHY THE CALM-MODE PRECEDENT DIRECTLY BELOW DOES NOT APPLY HERE. #72 retired
// calm mode by making the default AUTHORITATIVE and never reading the stored key
// again. That is the opposite of what this does, and the two look identical
// enough that copying it would seem like consistency. The difference is the way
// out: calm mode had NONE - players sat in the de-fanged game for three days
// with nothing left to switch it off, so the stored key had to be abandoned to
// free them. Mute has M. Ignoring a stored "1" here would not free anybody; it
// would override somebody who deliberately asked for quiet, every single load.
function readMuted() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? false : stored === "1";
  } catch {
    // AND THE SAME ANSWER WHEN STORAGE IS BLOCKED. This used to return true, on
    // the reasoning "private mode, embedded - stay quiet". The embedded case was
    // considered and does not apply: this game is not embedded in anyone else's
    // page, it is the whole page. What the old branch actually did was give a
    // private-mode player a DIFFERENT GAME - silent, with no stored preference
    // to explain it and no button to fix it.
    return false;
  }
}

// ---- Calm mode, retired (#72) -------------------------------------------------
// It was an intensity opt-out: full animation, no faces arriving. The user ruled
// it gone — default off, nothing switches it, and that is expected — after being
// stuck in it three days running with no way back, which is the whole reason
// #62's mark existed.
//
// The READ goes with the switch, and that is the load-bearing half. Anyone whose
// browser still holds jitp:calm = "1" would otherwise be locked in the de-fanged
// game forever with nothing left to turn it off. The default is authoritative
// now rather than a starting value a stale key can override, so the key is
// simply never consulted again.
//
// prefers-reduced-motion is untouched and still honoured on its own. That was
// always the separate axis — vestibular safety rather than intensity — and it
// is the one that remains.


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
    if (murmurWanted) startMurmur(murmurWanted);
    if (watchWanted) startWatch();
    if (scoreWanted) { buildScore(); applyScore(); }
    if (poundWanted) startPounding(poundWanted);
    // No fade: there is nothing to fade from, and the first cue after unmuting
    // should already be in the right room.
    applySpace(0);
  } else {
    tearDownMurmur();
    tearDownWatch();
    tearDownScore();
    stopPounding();
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
    // The split exists so a scene can muffle the house without muffling what
    // is happening at your ear. #78 wants this routing too, for placing sounds
    // rather than dulling them; the bus is built here because this is the
    // issue that first needed it.
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
export function combatSting(count = 3, dir = null) {
  const c = live();
  if (!c) return;
  // Panned when the game knows where they came from — a break-in has a wall, a
  // card fight does not. The sting is the one cue that has to carry direction
  // even when the picture cannot: calm mode and reduced motion both drop the
  // faces, and this is what is left to say which side of the room it is.
  const out = dir ? placed(dir, master) : master;
  // Recorded when the manifest names one; the oscillators below are the fallback.
  if (sample("sting", 1, 0, out)) return;
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
  g.connect(hp).connect(out);
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
// The layer over the impact, so the same recorded blow serves every sword and a
// 七星劍 still does not land like a 桃木劍. Ids are the jiangshi set; the
// inherited map was the other game's, which meant no sword in this game got a
// layer at all and every blow landed identically.
const WEAPON_TONE = {
  "precept-knife": "metal", "coin-sword": "metal", "sevenstar-sword": "metal",
  "peachwood-sword": "wood",
};

function weaponLayer(weapon) {
  const tone = WEAPON_TONE[weapon];
  if (!tone) return;
  if (sample(`swing-${tone}`)) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;

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

// ---- The jiangshi cue set ---------------------------------------------------
// Four sounds this setting needs that the inherited set had no word for. All
// synthesised, and every one of them can be replaced by a recording the moment
// the manifest names it — the same contract every other cue here honours.
//
// Synthesised on purpose rather than for want of a pack. Three of these four
// are sounds a general-purpose effects library cannot serve honestly: a
// watchman's drum is a specific instrument struck a specific number of times, a
// hop is a rhythm rather than an impact, and a talisman is a piece of paper
// moving fast. Something close-ish would be worse than a synth written for the
// moment it plays in.

// How much of the aggressive cues survives calm mode. Not silence: calm turns
// off the assault — the faces, the blood, the buzzing — and keeps the
// information, because a player who cannot see what is coming still has to
// hear that something is. The same policy the scare sting has always followed.
// (Said "the pack" until #92: there is no pack now, one creature at one of four
// strengths, so the cue announces a thing rather than a number of them.)

function bite() {
  return 1;
}

// Long enough that two strikes are two events rather than a flam, short enough
// that three of them are still one announcement.
const DRUM_GAP = 0.62;

// 更鼓, the watch drum. The night is divided into watches and a man walks the
// village striking the number of the one that has begun — so this is struck N
// times, not once, and the count IS the information.
//
// A drum, not a bell: skin over a shallow wooden body. The stick is a short
// filtered click, the skin is a pitch that falls away fast, and the body is a
// low resonance under both. Struck cues in this file are usually recordings;
// this one is not, because a drum struck three times is three events with a
// rhythm between them, and a single file would fix that rhythm forever.
export function watchDrum(strikes = 1) {
  const c = live();
  if (!c) return;
  const t0 = c.currentTime;
  for (let i = 0; i < strikes; i++) {
    if (sample("drum", 0.9, i * DRUM_GAP)) continue;
    const t = t0 + i * DRUM_GAP;
    // The skin: a low sine dropping about a fifth in a tenth of a second. That
    // fall is what stops it reading as a bell — a bell holds its pitch.
    const skin = c.createOscillator();
    skin.type = "sine";
    skin.frequency.setValueAtTime(96, t);
    skin.frequency.exponentialRampToValueAtTime(58, t + 0.11);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.26, t + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    skin.connect(sg).connect(master);
    skin.start(t);
    skin.stop(t + 0.7);

    // The stick on the skin: a very short band of noise, high enough to read as
    // wood and short enough not to become a hiss.
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700;
    bp.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.09, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.1);

    // The body it is all happening inside.
    const body = c.createOscillator();
    body.type = "triangle";
    body.frequency.value = 150;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.05, t + 0.012);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    body.connect(bg).connect(master);
    body.start(t);
    body.stop(t + 0.35);
  }
}

// The hop. They do not walk — the limbs have set, so they come at you with both
// feet together, and that rhythm is the whole signature of the thing.
//
// Two halves per hop: the landing, and the robe catching up with it a beat
// later. Repeated per body in the pack with a little drift between them, so a
// pack lands like a pack and not like one animal with loud feet.
// `beats` is an explicit rhythm in seconds, and it is how the four 僵屍 tiers
// are told apart with the sound alone. That matters more than it looks: in calm
// mode the faces never arrive at any tier, so the rhythm and the set-dressing
// are the ONLY things carrying how bad this is — which is information, and calm
// takes away the assault rather than the information.
//
// Without it the hops are evenly spaced with a little drift, which is what every
// caller that does not care about tiers still gets.
export function hopThud(count = 1, dir = null, beats = null) {
  const c = live();
  if (!c) return;
  const out = dir ? placed(dir, master) : master;
  const t0 = c.currentTime;
  const pattern = Array.isArray(beats) && beats.length ? beats : null;
  const hops = pattern ? pattern.length : Math.max(1, Math.min(count, 4));
  const scale = bite();

  for (let i = 0; i < hops; i++) {
    // Drift, not randomness of consequence: this is texture and never touches
    // the seeded run, the same licence noise() takes. A given rhythm is played
    // as written — the drift is what makes an unshaped volley sound alive, and
    // it is exactly what would blur an off-beat into the beat before it.
    const t = pattern ? t0 + pattern[i] : t0 + i * (0.19 + Math.random() * 0.05);
    if (sample("hop", 0.85 * scale, t - t0, out)) continue;

    // The landing: dead weight onto boards. Almost no attack and no ring — a
    // body that has stopped being able to flex does not bounce.
    const thud = c.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(126, t);
    thud.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.3 * scale, t + 0.008);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    thud.connect(tg).connect(out);
    thud.start(t);
    thud.stop(t + 0.3);

    // The floor taking it.
    const knock = c.createBufferSource();
    knock.buffer = noise(c);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const kg = c.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.11 * scale, t + 0.004);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    knock.connect(lp).connect(kg).connect(out);
    knock.start(t);
    knock.stop(t + 0.12);

    // Grave clothes, arriving just after the body did.
    const cloth = c.createBufferSource();
    cloth.buffer = noise(c);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2400;
    const cg = c.createGain();
    const ct = t + 0.045;
    cg.gain.setValueAtTime(0.0001, ct);
    cg.gain.exponentialRampToValueAtTime(0.035 * scale, ct + 0.02);
    cg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.15);
    cloth.connect(hp).connect(cg).connect(out);
    cloth.start(ct);
    cloth.stop(ct + 0.18);
  }
}

// 符咒 leaving your hand: paper, moving fast. Three overlapping bursts of
// filtered noise with very short envelopes — a flutter is not one sound, it is
// several edges close together, and one burst reads as a hiss instead.
//
// Bright, dry and quiet. It has to sit under the fight rather than announce
// itself: the talisman is what you spent, not what happened.
export function paperFlutter() {
  if (sample("paper", 0.8)) return;
  const c = live();
  if (!c) return;
  const t0 = c.currentTime;
  for (const [at, peak, hz] of [[0, 0.07, 3400], [0.045, 0.055, 4600], [0.085, 0.04, 2800]]) {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = hz;
    bp.Q.value = 1.1;
    const g = c.createGain();
    const t = t0 + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.09);
  }
}

// 殭屍王, arriving. Deliberately not the combat sting: that one rises, because a
// pack is coming at you and the question is how fast. This one falls. He is not
// hurrying, and there is nothing to decide about whether he arrives.
//
// A long descending tone with a second voice under it, and a thin metallic
// shimmer over the top that outlasts them both — the room, after the door has
// already opened.
export function kingArrives() {
  if (sample("king")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const scale = bite();

  for (const [from, to, gain, len] of [[300, 74, 0.13, 2.4], [212, 52, 0.08, 2.6]]) {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + len * 0.8);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * scale, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + len);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + len + 0.1);
  }

  // The shimmer, held past the fall. Sent to the room's reverb rather than
  // straight out, so it arrives as something the building is doing.
  const shine = c.createBufferSource();
  shine.buffer = noise(c);
  shine.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 5200;
  bp.Q.value = 6;
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.025 * scale, t + 0.9);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 3.1);
  shine.connect(bp).connect(sg).connect(send || master);
  shine.start(t);
  shine.stop(t + 3.2);
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

  // Debris. The crash is the wall arriving; this is the wall still coming down
  // afterwards, which is what makes it a collapse rather than a hit. Six pieces
  // over most of a second at fixed offsets, the smaller ones landing last.
  const rubble = [[0.09, 0.7], [0.17, 0.45], [0.26, 0.85], [0.38, 0.4], [0.52, 0.6], [0.71, 0.3]];
  for (const [at, size] of rubble) {
    const piece = c.createBufferSource();
    piece.buffer = noise(c);
    const shape = c.createBiquadFilter();
    shape.type = "bandpass";
    shape.Q.value = 1.1;
    shape.frequency.value = 240 + (1 - size) * 900;
    const pg = c.createGain();
    pg.gain.setValueAtTime(0.0001, t + at);
    pg.gain.exponentialRampToValueAtTime(0.03 * size, t + at + 0.008);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.09 + size * 0.1);
    piece.connect(shape).connect(pg).connect(master);
    piece.start(t + at);
    piece.stop(t + at + 0.3);
  }
}

// Wood and plaster giving up in small pieces. Short, dry and bright — the
// opposite of the knock, which is low and comes through the wall. A splinter is
// the wall itself failing, so it happens on your side of it and takes no
// muffling at all.
//
// Synthesised rather than sourced, and that is a deliberate exception to the
// rule that struck cues are recordings. A pop this short is two envelopes and a
// filter; a recording of one is mostly the room it was recorded in, and three
// of them have to differ audibly or the wall sounds like a machine — which
// costs three files to do badly and one function to do well.
export function splinter(dir = null, hardness = 0.5) {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const out = dir ? placed(dir, master) : master;
  const h = Math.min(1, Math.max(0, hardness));

  // The crack itself: a very short band of noise, high and gone.
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.6;
  // Harder cracks sit higher. The spread is what stops three in a row from
  // sounding like one sample played three times.
  band.frequency.setValueAtTime(1500 + h * 1700, t);
  band.frequency.exponentialRampToValueAtTime(700 + h * 500, t + 0.09);
  const g = envelope(c, 0.05 + h * 0.05, 0.003, 0.1 + h * 0.06);
  src.connect(band).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.2);

  // And the timber under it: one low click, so the crack has a wall behind it
  // rather than floating.
  const thud = c.createOscillator();
  thud.type = "triangle";
  thud.frequency.setValueAtTime(210 - h * 60, t);
  thud.frequency.exponentialRampToValueAtTime(90, t + 0.07);
  const tg = envelope(c, 0.05, 0.004, 0.08);
  thud.connect(tg).connect(out);
  thud.start(t);
  thud.stop(t + 0.12);
}

// A handful of them, spread out, for the moment the cracks appear and the
// moment something comes through. Fixed offsets: the same wall should fail the
// same way twice.
export function splintering(dir = null, count = 3) {
  const spread = [[0, 0.75], [0.07, 0.35], [0.16, 0.6], [0.26, 0.45], [0.33, 0.8]];
  for (let i = 0; i < Math.min(count, spread.length); i++) {
    const [at, hardness] = spread[i];
    setTimeout(() => splinter(dir, hardness), Math.round(at * 1000));
  }
}

// ---- The wall being worked on -------------------------------------------------
// A held pattern, not a cue: it runs for as long as the fight is open and has to
// come down on every exit from it. Wanted and running are separate for the same
// reason the beds keep them separate — muting frees the timer, and unmuting
// mid-fight has to start it again.
//
// It accelerates. The gap between hits shortens as the fight goes on, which is
// the only thing here saying the wall is closer to giving than it was.
let pounding = null; // { timer } while it is running
let poundWanted = null; // the wall, while the game wants this running

const POUND_START_MS = 900;
const POUND_FLOOR_MS = 420;

export function startPounding(dir = "N") {
  poundWanted = dir;
  if (pounding || !live()) return;
  let hit = 0;
  const beat = () => {
    if (!poundWanted) return;
    // Irregular on purpose. An even pulse is a metronome and a metronome is a
    // machine; something trying to get through a wall does not keep time.
    const jitter = [1, 0.72, 1.15, 0.86, 1.04, 0.78][hit % 6];
    const gap = Math.max(POUND_FLOOR_MS, POUND_START_MS - hit * 55);
    // Ducked means the room has gone quiet for the scare, and the quiet wins
    // over every layer — including this one.
    if (!ducked) wallThump(poundWanted, 0.62 + Math.min(hit, 6) * 0.06);
    hit += 1;
    pounding = { timer: setTimeout(beat, Math.round(gap * jitter)) };
  };
  beat();
}

export function stopPounding() {
  poundWanted = null;
  if (pounding) clearTimeout(pounding.timer);
  pounding = null;
}


// What each thing sounds like coming off a shelf. Every id here is a jiangshi
// item; the inherited map was still the other game's, so a 七星劍 came up
// sounding like a candle and every one of the thirteen fell through to the same
// small rustle.
//
// 桃木劍 is wood because it IS wood — that is the entire point of a peachwood
// sword, and it would be a strange thing for the game to say otherwise. The
// talismans and the banner are paper and get the flutter, which is the same cue
// that plays when one is spent: picking one up and throwing one are the same
// material doing the same thing.
const ITEM_CUE = {
  "precept-knife": "metal", "coin-sword": "metal", "sevenstar-sword": "metal",
  "peachwood-sword": "wood",
  "truefire-talisman": "paper", "fivethunder-talisman": "paper",
  "blood-talisman": "paper", "protective-charm": "paper", "soul-banner": "paper",
  "black-dog-blood": "liquid",
  cinnabar: "small", "sticky-rice": "small", "golden-elixir": "small",
};


export function itemPickup(itemId) {
  const kind = ITEM_CUE[itemId] || "small";
  if (sample(`item-${kind}`)) return;
  // Paper is paper. Rather than a second synthesis of the same material, this
  // borrows the cue the talismans already have — so the sound of finding one
  // and the sound of spending one agree with each other.
  if (kind === "paper") return void paperFlutter();
  const c = live();
  if (!c) return;
  const t = c.currentTime;

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
  if (!hapticsOn) return;
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

let dread = 0; // 0 at nine o'clock, 1 at midnight

// THE WIND IS GONE (#128), AND THIS IS WHERE THE REASON LIVES.
//
// It was a bed of filtered noise under the whole night, and it was removed on
// the owner's judgement after they heard it AS DESIGNED for the first time.
// That qualifier is the whole record: their first ruling — 感覺只是 noise — was
// made on a build where the score was inaudible, so the bed was being heard
// ALONE, which is the one way it was never meant to be heard. It was written to
// sit UNDER something tonal. Once #126 made the score reach a phone they were
// asked again, heard both layers together, and ruled 還是拿掉 anyway.
//
// So this is not "it read as noise on a broken build". It is a fair hearing of
// the thing in its intended state, and it lost. Anyone tempted to bring the
// wind back should know the obvious objection has already been tested.
//
// WHAT WENT: startAmbience, stopAmbience, tearDownBed, bedLevel, applyBedLevel,
// the bed itself, and the bed's arms in duckForScare and unduck.
//
// WHAT DELIBERATELY STAYED, each for a reason that is not obvious from here:
//
//   setDread   NOT deleted, though the issue suggested it might write to
//              nothing once the bed was gone. It does not. `dread` feeds
//              weight() below, which sets the level and pacing of the door
//              creak, the footsteps and the combat body — deleting the setter
//              would freeze all of them at their calmest for the whole night.
//              A silent flattening of four cues, to remove two lines.
//
//   weather    The bus SURVIVES, and not by default: the murmur connects
//              through it too, so it is not left empty. An empty bus reads as
//              intentional and lasts for months, so this was checked.
//
//   longNoise  Kept for the same reason — the murmur builds its buffer from it.

// A recorded loop for a held sound, if the manifest named one. The beds build
// their own buffer source rather than going through sample(), because they loop
// and carry their own filter chain — so this hands back the buffer and lets the
// caller wire it exactly as it wires the synthesised one.
function loopBuffer(name) {
  const takes = samples.get(name);
  return takes && takes.length ? takes[0] : null;
}

// How much heavier a one-shot plays when the game is frightened. Deliberately
// mild — this should be felt across a run rather than noticed in a moment, and
// a cue that doubles in volume is a bug report, not atmosphere.
function weight(lo, hi) {
  return lo + (hi - lo) * dread;
}

// The tension director's number, from engine dread(). Everything atmospheric
// reads this rather than inventing its own sense of intensity, which is what
// keeps the dark and the cues agreeing about the same moment. It no longer
// moves a bed — see the note above — but it still feeds weight().
export function setDread(x) {
  dread = Math.min(Math.max(Number(x) || 0, 0), 1);
  // His PACE follows dread on its own, at the moment each pass is scheduled.
  // This is only his level, and it is the one held sound left that has one.
  if (watch && !ducked) {
    const c = live();
    if (c) watch.gain.gain.linearRampToValueAtTime(watchLevel(), c.currentTime + 2);
  }
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
let ducked = false;

export function duckForScare() {
  const c = live();
  // Nothing audible means nothing to take away, and a silence nobody can hear
  // is just a delay.
  // The watch counts as audible (#125). After #128 the murmur is the only other
  // held sound, so a guard naming one of the two things it ducks is a trap.
  if (!c || (!murmur && !watch)) return 0;

  ducked = true;
  const t = c.currentTime;
  const fall = DUCK_MS / 1000;
  for (const node of [murmur, watch]) {
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
  if (watch) {
    watch.gain.gain.cancelScheduledValues(t);
    watch.gain.gain.setValueAtTime(Math.max(watch.gain.gain.value, 0.0001), t);
    watch.gain.gain.exponentialRampToValueAtTime(watchLevel(), t + 1.6);
  }
  if (murmur) {
    const weight = Math.min(Math.max((murmurWanted - 3) / 3, 0), 1);
    murmur.gain.gain.cancelScheduledValues(t);
    murmur.gain.gain.setValueAtTime(Math.max(murmur.gain.gain.value, 0.0001), t);
    murmur.gain.gain.exponentialRampToValueAtTime(murmurLevel(weight), t + 0.8);
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
// house. Muffling the room leaves the music where it is, which is what film
// does — the score does not duck because the room has gone quiet.
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
//
// THE OCTAVE WAS NOT ENOUGH, AND IT WAS THE WRONG DEVICE (#126). The paragraph
// above was right that 55Hz and 82Hz do not exist on a phone, and then put the
// rescue partial ONE octave up — at 110Hz and 165Hz, which do not exist on a
// phone either. A phone rolls off hard below roughly 500Hz and many give
// nothing usable under 700. An octave above 55 clears a desktop speaker, not a
// handset, and the handset is where this game is played. The owner played all
// week on an iPhone and never heard the score at all.
//
// Measured on the shipped voices, rendered offline and passed through a
// three-pole highpass standing in for a handset: 3.4% of the score's energy
// survives 500Hz and 2.0% survives 700Hz.
//
// SO EACH NOTE NOW CARRIES CONSECUTIVE HARMONICS, not more octaves. 8f, 9f and
// 10f are the eighth, ninth and tenth harmonics, and the SPACING BETWEEN THEM
// IS THE FUNDAMENTAL — so the ear reconstructs a 55Hz note from partials at
// 440, 495 and 550Hz, none of which is 55Hz and all of which a phone can
// actually move. Octaves alone do not do this: 4f and 8f are consistent with a
// fundamental an octave up, so they add brightness without restoring the note.
//
// WHICH HARMONICS, AND WHY NOT THE FIRST SET I PICKED. The multipliers differ
// per voice because what matters is the RESULTING FREQUENCY, not the harmonic
// number: every partial has to clear the rolloff, so 55Hz needs its 14th and
// 82.4Hz only its 10th. The first attempt used 8f/9f/10f for both, which put
// two of the low voice's three partials at 440 and 495Hz — UNDER the bar it was
// built to clear — and it measured well only because the instrument was wrong.
// See the note at the foot of this block.
//
// Analytic power split, no filter involved, fundamentals included:
//
//   as shipped (octave up)          0.0% above 700Hz
//   8f/9f/10f, first attempt        0.4%
//   14,15,16 / 10,11,12            12.1%
//
// AND THE GAINS WERE RE-WEIGHED, which is not optional. 0.030 and 0.020 were
// balanced by ear on a device that could hear the FUNDAMENTALS — a 1.5:1
// relationship between the two voices. Raising the partials without re-weighing
// delivered 0.127:1 to a phone: the same score, with the balance inverted, which
// is audible and WRONG rather than audible and right. The second voice's
// partials are scaled to put the delivered ratio back where it was set:
// measured 1.499 above 700Hz against an intended 1.5.
//
// THE FUNDAMENTALS STAY. On headphones they are the note and they are why this
// sounds like a room rather than a whistle; the harmonics are what carry it to
// a speaker that cannot reproduce them.
//
// NOTE THE THIRD VOICE IS UNREACHABLE, and has been since the last hour was
// emptied. SCORE_LAYERS never asks for more than 2, so 110Hz is built every run
// and never lit. It is left here rather than deleted because it is the hour-3
// voice the score was designed around, and deleting it would lose the shape of
// the thing; if the layering ever returns it is what returns. It costs two
// oscillators at 0.0001 gain.
//
// HOW THE FIRST ATTEMPT AT THIS FOOLED ITSELF, because the next person measuring
// audio here will reach for the same instrument. It rendered the score offline
// and passed it through cascaded biquad highpasses, reporting 3.4% before and
// 22.4% after. Both numbers were inflated: a biquad highpass has resonant gain
// around its corner, so the filter FLATTERED components sitting just below the
// cutoff — which is exactly where the failing partials were. The tell was the
// wind measuring 111% of its own energy through a passive filter, which is
// impossible. The split above is arithmetic on the known components instead:
// a triangle's odd harmonics fall as 1/n^2, the added partials are single
// sines, and power is amplitude squared. No instrument, nothing to be
// generous.
const SCORE_VOICES = [
  { hz: 55, detune: -6, gain: 0.030, partials: [[2, 0.30], [14, 0.22], [15, 0.18], [16, 0.15]] },
  { hz: 82.4, detune: 5, gain: 0.020, partials: [[2, 0.28], [10, 0.224], [11, 0.179], [12, 0.145]] },
  { hz: 110, detune: -9, gain: 0.013, partials: [[8, 0.20], [9, 0.16], [10, 0.13]] },
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

  const voices = SCORE_VOICES.map(({ hz, detune, gain, partials }) => {
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

    // The partials, quieter, on the same gain so they fade in and out with the
    // note rather than becoming voices of their own — which is what keeps
    // SCORE_LAYERS's count meaning what it says.
    for (const [mult, level] of partials) {
      const up = c.createOscillator();
      up.type = "sine";
      up.frequency.value = hz * mult;
      // Detuned WITH the note, so the whole stack beats together. Scaling the
      // detune by the multiplier keeps the harmonic relationship exact: a fixed
      // cent offset would be a different interval at each partial and the stack
      // would stop pointing at one fundamental.
      up.detune.value = detune;
      lfoDepth.connect(up.detune);
      const ug = c.createGain();
      ug.gain.value = level;
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
    let target = i < scoreWanted ? v.level : 0.0001;
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
  // The watch rides the same hour (#125). One call site, and the two things
  // that empty the last hour are decided next to each other.
  applyWatchHour(hour);
  scoreWanted = SCORE_LAYERS[hour] ?? 0;
  if (scoreWanted === 0) {
    if (score) applyScore();
    return;
  }
  buildScore();
  applyScore();
}

// ---- 打更, the watch being kept (#125) ------------------------------------
// A man is walking the village striking the watches, and this is him between
// the hours rather than on them. watchDrum() is the ANNOUNCEMENT — struck N
// times on the hour, on master, where the count is the information. This is the
// pulse underneath it: one soft strike and the two dry knocks of the 梆子
// behind it, closer together as the night runs out.
//
// IT IS IN THE FICTION, NOT OVER IT. The letter already says 鼓一響他就醒了 —
// the drum is a thing in the village that the game's own text refers to. So it
// goes on the WEATHER bus with the wind, not on master with the score: it is a
// sound in the world, and muffling the room has to muffle it.
//
// WHY NOT REUSE watchDrum(). Different bus, different level, and different job.
// Folding them into one voice would mean editing a cue that currently works, to
// save a few lines, in a session where nobody can hear the result. That trade is
// not worth taking — see the note at the foot of this block.
//
// NO SEPARATE SWITCH. It rides jitp:muted like everything else, and its
// lifecycle hangs off the hour the score already reads, so there is no new call
// site in render.js and no second thing for a player to find and turn off.
const WATCH_GAP_EARLY = 8.0; // seconds between passes at nine
const WATCH_GAP_LATE = 4.5;  // ...and when the night has nearly run out
const CLAP_GAP = 0.17;       // the 梆子 is TWO knocks, and the gap is the instrument
// The shell's two modes: [hz, level, seconds]. Inharmonic on purpose — 762 and
// 1013 are not a ratio of anything, because a drum is not. Both clear 700Hz,
// which is the whole reason they exist.
const SHELL = [[762, 0.14, 0.24], [1013, 0.09, 0.18]];

// Which hours he is still walking. THE LAST HOUR IS EMPTY, and that is not a
// separate decision from the score's — SCORE_LAYERS maps 23 to zero voices for
// the reason written above it: the silence in the last hour is what three hours
// of something under the floor were FOR. A drum still pulsing through it would
// spend that silence.
//
// If the ruling turns out to be that 三更 means midnight rather than eleven,
// this is the one line to change, and nothing else moves.
const WATCH_HOURS = { 21: true, 22: true, 23: false };

let watch = null;        // { gain, timer } while he is out there
let watchWanted = false; // whether the game wants him at all

// One pass: the drum, then the clapper a beat behind it. Deliberately quiet and
// deliberately dull — this is a man two streets away, so there is no stick
// attack to speak of and the top is gone off all of it.
function watchPass(c) {
  if (!watch) return;
  const t = c.currentTime + 0.02;

  // The skin, falling like watchDrum's but softer and slower: distance takes
  // the edge off a drum before it takes the body.
  const skin = c.createOscillator();
  skin.type = "sine";
  skin.frequency.setValueAtTime(88, t);
  skin.frequency.exponentialRampToValueAtTime(54, t + 0.14);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  skin.connect(sg).connect(watch.gain);
  skin.start(t);
  skin.stop(t + 0.8);

  // THE SHELL, AND IT IS WHY THIS IS A DRUM ON A PHONE (#125). The skin above
  // is a pure SINE sweeping 88Hz to 54Hz — a sine has energy at one frequency
  // and nowhere else, so it has NO harmonics and contributes exactly zero above
  // a handset's rolloff. Measured analytically rather than through a filter:
  // 96.4% of this strike's energy was the skin, and none of it reached a phone.
  // What played was the 梆子 alone — two dry ticks and no drum under them.
  //
  // NOT THE SCORE'S FIX. #126 gave the drone consecutive harmonics so the ear
  // reconstructs the fundamental from their spacing. A drum's overtones are
  // INHARMONIC, so that trick is wrong here and would sound like a pitched
  // instrument. This is the wooden body instead: two modes, well above the
  // rolloff, dying faster than the skin does — which is what a struck shell
  // actually does.
  for (const [hz, level, life] of SHELL) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = hz;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + life);
    o.connect(g).connect(watch.gain);
    o.start(t);
    o.stop(t + life + 0.05);
  }

  // 梆子: two knocks of hardwood on hardwood. Short, dry, no pitch to speak
  // of — a bandpass high enough to read as wood and a decay too fast to ring.
  for (let i = 0; i < 2; i++) {
    const at = t + 0.28 + i * CLAP_GAP;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2100;
    bp.Q.value = 1.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    // The second knock is the lighter one. Two identical strikes read as a
    // machine; a hand is never quite even.
    g.gain.exponentialRampToValueAtTime(i === 0 ? 0.22 : 0.16, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    src.connect(bp).connect(g).connect(watch.gain);
    src.start(at);
    src.stop(at + 0.08);
  }

  // The next pass is scheduled from the dread of the moment it is scheduled,
  // not from a fixed table — so the night closing in shortens his round while
  // he is walking it, rather than at a step when the hour changes.
  const gap = weight(WATCH_GAP_EARLY, WATCH_GAP_LATE);
  watch.timer = setTimeout(() => watchPass(c), gap * 1000);
}

function startWatch() {
  const c = live();
  if (!c || watch) return;
  const gain = c.createGain();
  // Six decibels under the score: he is the far side of the village, and the
  // wind he used to sit beneath is gone (#128).
  gain.gain.value = ducked ? 0.0001 : watchLevel();
  gain.connect(weather || master);
  watch = { gain, timer: 0 };
  // Off-beat from the hour so his first strike does not land on top of
  // watchDrum's announcement and read as one drum stuttering.
  watch.timer = setTimeout(() => watchPass(c), 2200);
}

// THE LEVEL, ANCHORED TO SOMETHING THAT STILL EXISTS (#125).
//
// The old value — 0.010 + dread * 0.016 — was chosen to sit under the wind bed,
// and #128 deleted the wind. A constant tuned against a reference that no longer
// exists is not slightly wrong, it is UNANCHORED, so it was re-derived rather
// than nudged.
//
// The reference is now the score, because after #128 it is the only other
// continuous thing in the night. Its delivered level above a handset's rolloff
// is 0.01159 (power sum of the six partials that clear 700Hz — the power sum,
// not the arithmetic one, because sinusoids at different frequencies do not add
// coherently and it is loudness we are aiming at).
//
// THE RATIO IS 6 dB UNDER THE SCORE AT NINE, and I am choosing it rather than
// asking for it. A dB figure is not something to put to somebody who cannot
// hear the thing being measured — that is how the peek floor came to be set
// from a number nobody could perceive. So: a struck transient six decibels
// under the continuous bed is audible without competing with it, which is what
// a man two streets away should be. The strike's own amplitude above the
// rolloff is about 0.275, so:
//
//     0.01159 / 2  =  0.0058 target        0.0058 / 0.275  =  0.021
//
// It rises with dread by the same proportion the old one did — the night
// closing in makes him louder as well as faster.
//
// ADJUST THIS BY EAR. Nobody on this project has heard it; the arithmetic only
// establishes that something arrives, not that it sounds right.
function watchLevel() {
  return 0.021 + dread * 0.013;
}

function tearDownWatch() {
  if (!watch) return;
  clearTimeout(watch.timer);
  try {
    watch.gain.disconnect();
  } catch {
    /* already gone */
  }
  watch = null;
}

// Hung off the hour rather than given its own setter, so renderHour needs no
// new call and the two things that empty the last hour are read from one place.
function applyWatchHour(hour) {
  watchWanted = !!WATCH_HOURS[hour];
  if (!watchWanted) return stopWatch();
  startWatch();
}

// He walks away rather than vanishing. Cutting a repeating sound dead is the
// one thing that would announce it as a sound effect.
function stopWatch() {
  const c = live();
  if (!c || !watch) return tearDownWatch();
  const dying = watch;
  watch = null;
  clearTimeout(dying.timer);
  dying.gain.gain.cancelScheduledValues(c.currentTime);
  dying.gain.gain.setValueAtTime(Math.max(dying.gain.gain.value, 0.0001), c.currentTime);
  dying.gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 2.2);
  setTimeout(() => {
    try {
      dying.gain.disconnect();
    } catch {
      /* fine */
    }
  }, 2500);
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

// `flood` is the moment the hole exists: they are not behind anything any more.
// The loudest the murmur is ever allowed to be, and the headroom for it was
// reserved when the ordinary level was set — everything else sits under this.
let murmurFlooded = false;

export function startMurmur(count = 3, opts = {}) {
  murmurWanted = count || 3;
  if (opts.flood !== undefined) murmurFlooded = !!opts.flood;
  const c = live();
  if (!c || murmur) return;

  const gain = c.createGain();
  gain.gain.value = 0.0001;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  // Opened up when they are through: a lowpass is what "behind a wall" sounds
  // like, and taking it off is the sound of the wall no longer being there.
  filter.frequency.value = murmurFlooded ? 1400 : 340;

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
  if (!ducked) gain.gain.exponentialRampToValueAtTime(murmurLevel(weight), c.currentTime + 1.1);

  murmur = { src, gain, filter, voices };
}

function murmurLevel(weight) {
  return (0.02 + weight * 0.014) * (murmurFlooded ? 1.9 : 1);
}

// Called when the hole opens under an already-running murmur: they were behind
// a wall a moment ago and now they are not, and the mix should say so without
// tearing the loop down and starting it again.
export function floodMurmur() {
  murmurFlooded = true;
  const c = live();
  if (!c || !murmur) return;
  const t = c.currentTime;
  const weight = Math.min(Math.max((murmurWanted - 3) / 3, 0), 1);
  murmur.filter.frequency.cancelScheduledValues(t);
  murmur.filter.frequency.setValueAtTime(murmur.filter.frequency.value, t);
  murmur.filter.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
  if (ducked) return; // the quiet wins; unduck brings it back at the new level
  murmur.gain.gain.cancelScheduledValues(t);
  murmur.gain.gain.setValueAtTime(Math.max(murmur.gain.gain.value, 0.0001), t);
  murmur.gain.gain.exponentialRampToValueAtTime(murmurLevel(weight), t + 0.5);
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
  murmurFlooded = false;
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
