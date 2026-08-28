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

So the card is worth *looking at*, per outcome — and **which endings have been
rendered, and what would close the gap, is tracked on issue #96**, not here.
That table is deliberately not copied into this file: two copies of a status
that changes the moment somebody plays a winning game is exactly the drift this
project keeps paying for.

**This file answers a different question: HOW THE ENVIRONMENT DEFEATS A DRIVER.**
#96 is the coverage gap; this is the four walls in the way of closing it.

One thing worth stating here because it constrains everything below: this is
**not** evidence the game cannot be won. `tools/bots-report.md` puts the
hunter's burials at **322 and 342 per 1000** across two disjoint batches,
computed from the same engine the UI drives. Nothing has ever *rendered* a win;
that is all.

(Cited from the report rather than from memory, and that is not a flourish. An
earlier draft of this line said 314 — a real number from this session, one digit
away in the mind, belonging to the hunter under a *forced always-give-rice*
variant rather than the shipped policy. It was caught here only because the act
of committing prompted a check against the source. The same figure reached a
GitHub issue by the same route and was corrected there afterwards. Two people
absorbed it from the same conversation and neither noticed, because a number
taken from a real measurement does not feel like a quotation — it feels like
knowledge.)

## The blockers, in the order they bite

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

**5. Native tab order cannot be verified from any pane we have.** Added after
#98, and stated carefully because the obvious phrasing is wrong.

It is NOT "hidden panes cannot dispatch focus events". Two panes were tried and
they failed differently:

- A pane that does not composite reports `document.hasFocus()` **false**. There,
  `element.focus()` moves `document.activeElement` but fires **no focus event at
  all** — so a handler on `focus` never runs, and a guard that drives focus
  programmatically silently tests nothing.
- A pane that DOES composite reports `hasFocus()` **true**, and still does not
  advance focus on Tab. Measured: seven synthetic Tab keys, `activeElement`
  unchanged, `focusin` count 0 — while a keydown recorder confirmed **three Tab
  keydowns arrived with `defaultPrevented` false**. The keys reach the page,
  nothing swallows them, and the browser's focus manager does not move.

So the useful statement is the negative one: **no pane has verified native tab
order**, and the second measurement is what makes it useful — it rules out the
page's own handlers as the cause. Without it the reading would have been "our
focus containment swallows Tab", which is the opposite conclusion from the same
symptom.

A focus change can be verified for WIRING with a synthetic `FocusEvent`, which
proves the handler runs. It cannot be verified for BEHAVIOUR, which is what a
keyboard player actually gets. Say which of the two a claim covers.

**6. The ending is a thing ON SCREEN. Never `state.status`.** Pressing "play
again" constructs a **new Game** whose `status` is already `"playing"` while the
previous overlay is still mounted. A driver gated on `status !== "playing"`
therefore sees nothing ended, ever: no doorways to press, because the overlay
covers them, and no ending to acknowledge. **Measured at 2155 wasted steps.**

This is the same lesson the method note below records about `offsetParent`,
arriving from the other side. Together they are one rule: **the ending is the
card**, and every attempt to infer it from anywhere else has failed differently
— once by ignoring visibility, once by trusting it, once by trusting status.

**7. A modal can be up while the game is still `"playing"`.** The drop dialog
and the 硃砂 picker both cover the board with a scrim, so every doorway is
hidden and a driver that only hunts doorways spins behind it. **Measured at 9000
steps.** Look for `.notecard` before looking for anything else.

## A driver can produce a confident false finding

Not a wall — the opposite. A worked example of an instrument inventing a result,
kept because it looked exactly like a discovery.

A steering driver scored each action card by the largest number in its text, to
pick the strongest option. That reads a health **cost** as though it were an
attack, so it took the most expensive card every time and every run died inside
the first hour. What it reported was `wentOutside: 0` **across eighteen nights**
— a clean, consistent, plausible finding about the game, which was entirely a
finding about the chooser.

The fix is to stop having an opinion: `.action--primary` is the option the game
itself marks as recommended, and following it is what a player does.

The general form: **when a driver reports that something never happens, suspect
the driver first.** Also compare `js/reach.js`'s `diedAt` tally — recording
which link each run died at, rather than how many reached each link, is what
distinguishes "the chain is blocked" from "the chain leaks everywhere". A
28-sample reading once said the coin-flipping robot could never reach the
tablet; at 665 samples it does.

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
