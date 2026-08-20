// Menu page. The links are plain <a> elements and work with this file absent —
// everything here is atmosphere, and none of it is allowed to stand between a
// player and the Start button.

import { tollBell, isMuted } from "./audio.js";

// Far enough apart to be a house settling rather than a metronome.
const BELL_MS = 20000;

let started = false;

// Browsers will not let a page make noise before it is touched, and they are
// right to. The first interaction of any kind opens the door; after that the
// bell keeps its own time.
//
// The mute setting is the game's own — same localStorage key, same silence. A
// player who has never turned sound on hears nothing here either, which is the
// correct default rather than a missing feature: tollBell() builds no nodes
// while muted.
function begin() {
  if (started) return;
  started = true;
  const ring = () => {
    if (!isMuted()) tollBell();
    // setTimeout rather than setInterval: a tab that was backgrounded for ten
    // minutes should not come back to ten bells queued up.
    window.setTimeout(ring, BELL_MS);
  };
  window.setTimeout(ring, 1800);
}

for (const evt of ["pointerdown", "pointermove", "keydown", "touchstart"]) {
  window.addEventListener(evt, begin, { once: true, passive: true });
}
