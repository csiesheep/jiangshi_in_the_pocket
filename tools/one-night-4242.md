# One night, seed 4242

Played through the UI at normal speed, calm off, fast off. `game.html?seed=4242`.
Died at 10:06 PM, twelve turns into thirty — 傷重不治, the tablet on me, unburied.

**What I could not do:** the browser pane would not composite frames, so I read
this night, I did not watch it. Every claim below about text, timing and
sequence is from the live page. Nothing below is a claim about how it looked.

**Which build this was.** Corrected after the fact, and worth saying plainly
because getting this wrong is a habit this project has paid for twice: the night
was served from the read-only `-be` worktree, which sat at **`d7043d2`** —
SEVEN commits behind `origin/main`, not six, and one older than the `1bad884`
first recorded here. The extra commit is #63's per-suite stamps, which touches
`tests/` and `tools/` only: `git diff d7043d2 1bad884 -- js/ data/` is empty, so
the game played is byte-identical to `1bad884`'s and the account stands as
written. The other six are #65's four creatures, #60's thirteen refined icons,
and the CSS, `render.js`, `sw.js` and `stage.test.js` that came with them —
**none of them touch `engine.js`, `app.js` or `epilogue.js`.** So the rules, the numbers and
the text I played are byte-identical to what ships; only the art was stale, and
the art was invisible to me anyway. The three defects at the bottom were
re-checked against `origin/main`'s blobs, not this checkout, and are live there
at the same lines.

That leaves a real hole somebody else has to fill: **nobody has looked at the
new creatures or the new icons in a played run.** I am the wrong session to
close that, twice over.

## What happened

I went north on turn one and walked straight into the 停柩房 — the tablet room,
first door I tried. Something was already up. Bare-handed the fight cost 4 of my
10, and it bought the whole room: the tablet, and a nail that opened 屍毒 in my
arm. Turn two of thirty and I had the thing the note sent me for.

That was the high point. The rest of the night was me paying for it.

I fled the 香堂 and the 藥鋪 rather than pay 4 again, then paid 4 anyway at the
柴房 because I had to have a weapon — and it gave me the 戒刀, attack 1, the
worst blade in the game. Four health for one point of attack. The 鐵匠鋪 gave me
the 銅錢劍 (2), the 靈堂 gave me the 真火符, and somewhere in there I ate the last
of my rice to stay upright.

One turn later the 靈堂 said: *"Someone is still alive in here, and hurt. You
have nothing to give them."* I had eaten what would have saved them, to buy a
fight. Nobody scripted that. It fell out of the arithmetic, and it is the best
moment in the game.

At 9:48, at 3 health, a breach offered me a fight for **no damage** if I spent
the 真火符. I took it. The very next search handed me the **七星劍**, attack 3 —
the blade the talisman exists to burn into. The game did not have to be that
neat about it.

Then it was quick. The 七星劍 made fights free — *"They do not touch you"* — but
free fights do not heal you, and a nail had opened the 屍毒 again. I ran east to
the 藥鋪, the medicine room, arrived on 1 health, and found that its medicine
only comes out at the *end* of a turn I could not survive the *start* of.

Both remaining buttons were labelled **"this kills you."** I fought.

## Against what the tables implied

**0.63 forced choices per run.** I got two in twelve turns, and neither was a
choice. Both were blade swaps — 2 over 1, then 3 over 2 — and the arithmetic
answers before you do. The prompt itself is excellent: both options priced by
attack, and *"stays here for good"* said out loud, so nobody drops a sword by
accident. But a decision between two numbers on one scale is not a decision.
The number undersells how often the prompt appears and oversells how hard it
lands. **The real decisions of my night were never counted by anything**: pay 4
or run at 6 health, and whether to spend the talisman. Those are the ones I am
still thinking about.

**A seal at 11–13% — rare or ordinary?** I cannot answer from the far side; I
never reached midnight. But I can say what the table cannot: by 9:48, turn 9 of
30, I was holding attack 3 and a 真火符. **The kit did not feel rare.** What
failed was health, not assembly. So 11–13% does not read as "the seal is hard to
build" — it reads as "few players live long enough to use one." Those are
different feelings, and the second is the better one.

**~9.6s of staging across thirty turns — tense or waiting?** I cannot report the
feeling, for the reason at the top. I can report the shape. Ordinary beats are
620–850ms and never once made me wonder. The breach is
`1250 + 900 + 950 = 3100ms` ([app.js:108](../js/app.js:108)) before a button
appears, and **twice I concluded the game had stalled and went back to look.**
Both times it was a breach staging. The budget is not spread evenly — it is
concentrated on the one event that earns it — but 3.1 seconds is sitting right
on the line where tense turns into *did I miss a click.*

**Does the loss read as "you were short" or "the game took it from you"?** Not
the King — I never got there. But the loss I did take reads as *you were short*,
unmistakably, and the game works hard to make it so. Every option all night was
priced before I clicked it: −4, −2, −1, none. At the end it went further and
wrote **"this kills you"** on both doors rather than let me discover it. I can
name the three decisions that killed me — the 4 I paid for an attack-1 knife,
the rice I ate instead of carrying, the talisman I threw one turn early — and
none of them were made for me. Nothing was taken.

## One thing the UI got wrong, that I fell for

The fight option reading **"真火符 True Fire Talisman — attack 3"** *throws* the
talisman and consumes it. It is not `buffSword`, which bakes a permanent +1 into
the blade ([engine.js:899](../js/engine.js:899)). I wrote this engine and I read
that button as the permanent buff at the table. A player who has read the
rulebook on burning a talisman into a sword will read it the same way. The
label is true and still misleads, because the game has two things called
spending a 真火符 and this button looks like the other one.

## Three defects the verdict card is shipping

Found by dying, not by measuring. The closing screen told me three things that
were false.

1. **"nothing in your hands"** — I died holding the 七星劍, and the HUD said so
   on the same screen. `bestWeapon` in [epilogue.js:39](../js/epilogue.js:39)
   walks `heldIds` (the pack) instead of `carriedIds` (pack **plus hands**). The
   regression is from #31 moving equipment out of the pack — and `carriedIds`'s
   own comment at [engine.js:602](../js/engine.js:602) names *"the epilogue's
   tally"* as its intended caller. The helper was written for this and the call
   site was never switched. One identifier.

2. **"0 of the jiangshi put down"** — I won six fights. `tally.putDown` is
   initialised at [app.js:187](../js/app.js:187) and printed at
   [app.js:1303](../js/app.js:1303), and **nothing in the repository ever
   increments it.** Every run that has ever ended, win or lose, has reported
   zero.

3. **"1 item found"** — I found four (戒刀, 銅錢劍, 真火符, 七星劍). `tally.found`
   increments at exactly two sites: taking the tablet
   ([app.js:483](../js/app.js:483)) and the villager's gift
   ([app.js:845](../js/app.js:845)). **Ordinary searching — the main verb of the
   game — never counts.**

All three are on the screen the player is most likely to screenshot and send to
somebody. Nothing is fixed here; this is a report.
