# Driving the real UI from a session, and where it stops

Written after an attempt to render a **winning** verdict card failed. It did not
fail for want of trying, and the four walls it hit are all still there. Anyone
attempting this again starts four walls further along by reading this.

## Why anyone would want to

The verdict card is the screen a player screenshots. Its record is **three false
statements shipped while 280 tests passed** (#66) — "nothing in your hands"
while holding 七星劍, "0 of the jiangshi put down" after six won fights, "1 item
found" after finding four. Every one was invisible to the suites and to
thousands of bot runs, because the bots call the engine and read `outcome` and
nothing ever rendered the ending.

So the card is worth *looking at*, per outcome. Status as of writing:

| ending | rendered and read by anybody? |
|---|---|
| 傷重不治 loss | **yes** — played, twice |
| 埋葬 burial | **no** |
| 鎮屍 seal | **no** |
| loss to the King | **no** |

The burial has never been seen. The seal and the King are further out of reach
than the burial was, and "the burial is unresolved" should not be read as
implying the other two are fine.

This is **not** evidence the game cannot be won. `tools/bots-report.md` puts the
hunter's burials at **322 and 342 per 1000** across two disjoint batches,
computed from the same engine the UI drives. It is evidence that nothing has
ever *rendered* the win.

(Cited from the report rather than from memory: the figure 314 was in flight
during this work and is the hunter's rate under a *forced always-give-rice*
variant, not the shipped policy. Two numbers, one digit apart in the mind, from
different measurements — which is the whole reason to quote a source.)

## The four blockers, in the order they bite

**1. The letter modal.** The night opens on the folded note. It carries no
`data-kind` button, so a driver looking only for action buttons sees an empty
board and concludes the game is broken. Dismiss it by clicking the button whose
text is the theme's fold-away string.

**2. The stage exits on a KEY, not a click.** `js/eventstage.js` attaches
`keydown` to **window, in capture**, and `click` to the stage element. A driver
synthesising clicks at `.board-pane` does nothing at all — the panel is not the
listener. `window.dispatchEvent(new KeyboardEvent("keydown", {key: " "}))` is
the reliable way out, and it is the same "press anything" a player gets.

This one cost another session five separate failures, each looking like a wedged
UI: creature panel up, an attack on screen, zero actionable elements, clicks
moving nothing. The game was working and waiting for a key.

**3. Finite animations never settle.** In a browser pane that does not
composite, animations do not advance — `currentTime` stays 0 while `playState`
reports `"running"`. Anything the game `await`s on an animation's `finished`
promise therefore never resolves, and no amount of clicking or keying helps.
Measured on a live page: **all 13 animations at `currentTime: 0`, 10 of them
infinite.**

The unblock is `animation.finish()`, which seeks the effect to its end and
resolves the promise directly:

```js
for (const a of document.getAnimations()) {
  try {
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    if (!t || t.iterations === Infinity) continue;   // finish() throws on these
    a.finish();
  } catch (e) { /* one refusing must not stop the rest */ }
}
```

**The guard is load-bearing.** `finish()` throws `InvalidStateError` on an
infinite animation, and this page runs ten ambient loops. Unguarded, the first
one kills the sweep and the whole technique looks like it failed.

**4. Timer service is tied to evaluation windows.** This is the wall, and it is
not the one it looks like.

`setTimeout(40)` measures at ~1000ms — a real, reproducible 25x clamp. That
number is true and it is **not the constraint**; blocker 3 is, and you can make
the pump infinitely fast without resolving a promise that never settles.

Past that, the deeper limit: a detached `setTimeout` chain advances **almost
nothing while nobody is evaluating**. Steps observed "between" polls turn out to
have happened *during* them. A dedicated burst loop — driving as hard as it can
inside one call — reached the tool's 30-second ceiling having advanced
**exactly one game turn**.

## The arithmetic that ends it

    ~1 turn per 30-second call
    15-30 turns per night
    ~1 night in 5 reaches a burial
    no partial credit: a night that dies at turn 28 yields nothing

That is 100+ calls of pure driving for one screenshot. The attempt was stopped
there deliberately rather than abandoned — the cost was computed before it was
spent, not after.

## What would actually close it

- **A pane that composites.** Every one of the four is downstream of hidden.
- **A headless run outside the pane**, where timers are not clamped and
  animations settle.
- **The user playing one game and burying the tablet**, which costs about five
  minutes and settles the burial card completely.

The third is by far the cheapest and is the recommendation on record.

## The method note worth keeping

Detect the ending from **game state**, never from the overlay's layout.
`g.state.status !== "playing"` is the detector; the DOM is then the thing being
*verified* rather than the thing being *detected*. Two sessions made opposite
errors from `offsetParent` on the same element — one counted a single loss eight
times by ignoring visibility, the other counted a real ending as zero by
trusting it. `offsetParent` answers a question about an element's own layout,
and both read it as answering a question about the player.
