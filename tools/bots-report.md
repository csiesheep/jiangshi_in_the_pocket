# Bot report — 1000 seeds per policy

> ## ⚠ EVERY 鎮屍 FIGURE BELOW IS VOID (#70, 2026-08-25)
>
> The bots reach the seal through `E.buffSword`, and **no button in the game
> has ever called it** — `git log --all -S"buffSword" -- js/app.js` is empty.
> Verified by exhaustive enumeration of every reachable loadout: a player's
> ceiling is **11** (七星劍 3, doubled by 攝魂幡, plus 血符 5). The bar is 13,
> or 12 carrying the 神主牌. **鎮屍 has been unwinnable by a human since the bar
> went above 11.**
>
> Measured, 800 identical seeds with the buff removed: the adept's seal goes
> **91 → 0**, the duelist's **3 → 0**. Not reduced. Zero.
>
> What that does and does not invalidate:
>
> | figures | status |
> |---|---|
> | every seal rate, and the whole seal funnel below | **void** — measured through a door players cannot open |
> | burial rates | **approximately sound** — hunter 265 → 261 over 800 seeds, about 1.5 % relative |
> | reaching midnight, for kit-building policies | **materially off** — adept 175 → 143, about 18 % |
> | average attack at midnight | **off** — adept 11.11 → 9.55 |
>
> Nothing here is rewritten. The numbers stand as the honest record of what was
> measured; this banner marks what they describe, which is a game with one more
> door in it than the one that ships. Awaiting the user's ruling between
> building the affordance, lowering the bar, or something else.

Produced by `tools/bots.html` (`?seeds=N`, `?from=S` for a disjoint batch).
Deterministic: the same seed replays the same night. Regenerate after any change
to the tables, the engine, or the map.

Companions: `tools/diagnose.html` prints the seal funnel stage by stage;
`tools/sweep.html` replays the same seeds against a patched relic table. Both
patch data in memory and write nothing. Lever pricing for #43 is in
`tools/lever-pricing.md`.

**THE CONSOLIDATED MEASUREMENT (#49)** — one reading of the world that the
hands, the ward, the blades, option A, the sword, the pack, the event stage and
the shrine all built. Everything below the arc table is the per-lever history,
kept so "what did each change cost" and "where does the game sit" are both
answerable.

## Where the game sits — batch A, seeds 1..1000

Four endings now, not five: 見到天亮 is unreachable since #56 removed 溪澗's
running-water rule, and the column is kept only to show it reading zero.

| policy | burial | seal | survived | died | King | reached midnight | atk @ midnight |
|---|---|---|---|---|---|---|---|
| hunter  | **322** | 0  | 0 | 632 | 46  | 4.6 %  | 3.83  |
| duelist | 0   | 4  | 0 | 971 | 25  | 3.0 %  | 8.13  |
| **adept**   | 0 | **113** | 0 | 783 | 104 | 21.7 % | 11.11 |
| turtle  | 0   | 0  | **0** | 969 | 31  | 3.1 %  | 5.00  |
| camper  | 0   | 0  | 0 | 732 | 268 | 26.8 % | 1.59  |

## Batch B, seeds 5001..6000

| policy | burial | seal | survived | died | King | reached midnight | atk @ midnight |
|---|---|---|---|---|---|---|---|
| hunter  | **342** | 0  | 0 | 593 | 65  | 6.5 %  | 3.12  |
| duelist | 0   | 1  | 0 | 959 | 40  | 4.3 %  | 7.51  |
| **adept**   | 0 | **128** | 0 | 770 | 102 | 23.0 % | 11.28 |
| turtle  | 0   | 0  | **0** | 968 | 32  | 3.2 %  | 4.31  |
| camper  | 0   | 0  | 0 | 719 | 281 | 28.1 % | 1.78  |

## What #56 did

| | after #52 | after #56 | |
|---|---|---|---|
| **adept seal** | 35 / 42 (3.5 / 4.2 %) | **113 / 128 (11.3 / 12.8 %)** | roughly tripled |
| **turtle 見到天亮** | 31 / 32 | **0 / 0** | the ending is gone |
| turtle → King | 0 / 0 | 31 / 32 | exactly the survivals, transferred |
| hunter burial | 322 / 342 | 322 / 342 | **unmoved** |
| adept reaches midnight | 21.7 / 23.0 % | 21.7 / 23.0 % | **unmoved** |
| adept atk @ midnight | 11.11 / 11.28 | 11.11 / 11.28 | **unmoved** |

**Only the conversion term moved**, and that is what a bar change is: the same
players arrive with the same kit and more of them clear it. Arrivals and attack
are identical to the run, which also means the one instrument change in this
pass — the adept no longer detours off 溪澗 before midnight, since the tile has
no rule to detour from — cost nothing measurable.

**鎮屍 is now 11.3–12.8 %.** For scale: 26 % before option A, 1.7 % after it,
0.9 % after the sword and the pack, 3.5–4.2 % after the shrine, and this. The
bar meeting the ceiling is the largest single lever measured all week, because
it does not make the kit easier to assemble — it makes an already-assembled kit
sufficient more often, and the adept assembles well.

**見到天亮 reads zero because it cannot happen**, not because nobody managed it.
The turtle still stands in 溪澗 all night, unchanged on purpose, and now meets
him there like everybody else: its 31–32 survivals became 31–32 deaths to the
King, one for one.

## The whole week in one table

Same seeds throughout, so every column is the rule named and nothing else.

| | pre-A | after A | after #46 | after #47 | now (#52) |
|---|---|---|---|---|---|
| | hands/ward/blades | bar 14/13, 幡 2 % | 七星劍 10 % | pack 4 | 幡 10 % |
| **hunter burial** | 344 / 374 | 344 / 374 | 330 / 354 | 322 / 342 | **322 / 342** |
| **adept seal** | 259 / 299 | 17 / 17 | 10 / 13 | 9 / 10 | **35 / 42** |
| **turtle 活水** | 53 / 66 | 53 / 66 | 40 / 46 | 31 / 33 | **31 / 32** |
| adept reaches midnight | 32.0 / 35.0 % | 32.9 / 34.7 % | 26.1 / 27.4 % | 23.3 / 24.3 % | **21.7 / 23.0 %** |
| adept atk @ midnight | 11.88 / 12.08 | 9.16 / 9.03 | 9.11 / 8.93 | 9.08 / 8.91 | **11.11 / 11.28** |

Read down the rows rather than across the columns. Each column looks small; the
rows do not.

- **鎮墓 (burial) has held.** 344 → 322 and 374 → 342, about 6–9 % lost, all of
  it to the sword and the pack. Nothing was ever aimed at it.
- **鎮屍 (seal) went 26 % → 1.7 % → 0.9 % → 3.5 %.** Deliberately placed at
  1.7 %, drifted to half that as a side effect of two rulings about swords and
  slots, and is now above where it was ruled to be.
- **活水 (survived) has been halved and never recovered.** 53 → 31. It is
  downstream of the sword and the food, so it absorbed both cuts and no later
  ruling gave anything back. Of the five endings it has the least room left.
- **Arrivals fell by a third while attack at the door came back.** Two different
  levers wearing the same clothes: the pack and the sword decide how many
  players reach midnight, the banner and the bar decide what happens there.

## #48 as a control — it moved nothing

FE's pack UI is presentation, so it must not touch a number. Checked by running
today's code with the banner rolled back to 2 %, which reproduces the post-#47
world exactly:

| | post-#47, before #48 | today's code, 幡 back at 2 % |
|---|---|---|
| hunter | 322 burial, 631 died, 47 King, 4.7 % | **identical** |
| duelist | 970 died, 30 King, 3.2 % | **identical** |
| adept | 9 seals, 767 died, 224 King, 23.3 % | **identical** |
| turtle | 31 survived, 969 died, 3.1 % | **identical** |
| camper | 730 died, 270 King, 27.0 % | **identical** |

Every figure matches to the run. The control holds.

## What the four-slot pack actually costs

New in this pass, because the pack is a lever now and "it is tighter" is not a
number. `forced choices` counts finds that arrived at a full pack; `paid with
food` is the subset paid for with 糯米; `starved after` is the share of runs that
later stood at 3 health or less with nothing to eat, having paid that way.

| policy | forced choices / run | paid with food | starved after |
|---|---|---|---|
| hunter  | 0.28 | 0.24 | 9.9 / 10.2 % |
| duelist | 0.40 | 0.34 | 19.8 / 22.0 % |
| adept   | 0.63 | 0.49 | 15.5 / 15.3 % |
| turtle  | 0.18 | 0.17 | 13.2 / 15.3 % |
| camper  | 3.07 | 1.72 | 18.8 / 21.4 % |

**About one adept run in six** ends hungry and out of food after paying for a
find with a meal. That is the pack cut expressed as the thing it does, rather
than as a slot count.

The camper's three forced choices a night are the same fact from the other end:
standing still and rummaging one room is the fastest way to fill a small pack,
and it converts none of it — 1.59 attack against a bar of 13.

*The approximation is stated rather than hidden.* "Needed it later" is counted
as the case that actually kills runs — hungry with nothing to eat — not every
possible regret. A run that dropped a talisman it would have thrown at midnight
is not counted.

## The trade, resolved

There was a real conflict here between two of the same user's rulings — 鎮屍
"under 2 %" in the morning, 攝魂幡 at 10 % in the afternoon, which the measurement
put at 3.5–4.2 %. It has been decided, with the curve below in front of them:
**keep the shrine at 10 % and accept the seal where it lands.** A shrine worth
walking to beat the lower number.

**So "< 2 %" is superseded.** Anything still stating it — including the per-lever
history further down this file, and tools/lever-pricing.md, both of which were
written while it stood — is a record of what was true then, not a target now.

§9 is untouched by any of this. 鎮屍 is still never explained and never
announced; it is simply no longer rare to the point of vanishing.

**What the choice cost**, for the record: the seal went from where option A
deliberately placed it (1.7 %) to roughly twice that. Nothing else moved — #52
touches the conversion term only, so burial, 活水 and camper arrivals are
unchanged to the run. The mechanism is entirely "three times as many players
arrive holding a banner": attack at the door went 9.08 → 11.11.

**The curve is kept in case it is ever revisited.** The bar cannot help — 14
already makes the 神主牌 compulsory and 15 would make 鎮屍 impossible rather than
hidden — so the shrine's odds are the only dial that does not cost survival:

| 攝魂幡 | adept seal |
|---|---|
| 2 % | 0.9 % |
| 3 % | 1.5 % |
| 4 % | 2.1 % |
| 5 % | 2.4 % |
| **10 %** | **3.5 / 4.2 % — chosen** |

Three per cent was the most that would have bought both. It was not chosen, and
the reason is on the record rather than inferable from the number.

---

# Per-lever history

What each change cost on its own, kept because "where does it sit" and "what did
that one do" are different questions.

**Everything below is a snapshot, true when it was taken.** Several of these
sections reason against a "< 2 %" target for 鎮屍 that has since been superseded
(see *The trade, resolved*, above), and one of them offers advice — restore the
seal to 1.7 % — that the user has now declined. They are left as written rather
than rewritten: a record that gets edited to agree with the present stops being
a record. The tables at the top of this file are the current numbers.

## What option A cost

Same seeds, so every difference is the two constants and one table value.

| | before A | after A | |
|---|---|---|---|
| **adept seal** | 259 / 299 | **17 / 17** | the target: 25.9 % → 1.7 %, both batches |
| hunter burial | 344 / 374 | 344 / 374 | **identical** |
| turtle survived | 53 / 66 | 53 / 66 | **identical** |
| camper → King | 373 / 380 | 376 / 380 | +3 / +0 |
| adept reaches midnight | 32.0 / 35.0 % | 32.9 / 34.7 % | +0.9 / −0.3 |
| adept attack at midnight | 11.88 / 12.08 | 9.16 / 9.03 | the mechanism, not a side effect |

Burials and survivals are untouched to the run. The only number that moved
materially other than the seal is the attack players bring to the door, and that
is the change itself: most arrivals no longer hold a banner.

## The funnel — what actually stops a seal now

`tools/diagnose.html`, adept, both batches, on the landed world. This answers
the question directly: **option A left P(reach the door) alone and cut P(what
you brought was enough) from ~81 % to ~5 %.**

| stage | batch A | batch B |
|---|---|---|
| reached midnight | 329 (32.9 %) | 347 (34.7 %) |
| …not standing in 活水 | 329 | 345 (2 presented nothing) |
| …七星劍 in hand | 97.6 % | 95.7 % |
| …with 真火符 burned in | 90.3 % | 89.9 % |
| …**攝魂幡 to spend** | **24.3 %** | **21.3 %** |
| …a heavy talisman | 94.8 % | 96.0 % |
| …**carrying the 神主牌** | **40.7 %** | **47.0 %** |
| …all five at once | 7.6 % | 7.8 % |
| …**cleared the bar** | **5.2 %** | **4.9 %** |

Before A, the same conditional was 259/320 ≈ 81 % and 299/350 ≈ 85 %.

**Two gates carry the whole reduction**, and they are the two the ruling chose:
the banner (24 %, down from 84 %) and the tablet (41–47 %, unchanged in absolute
terms but now compulsory rather than a discount). Sword, buff and talisman all
sit at 90–98 % — a competent player still assembles those almost every time,
which is the point: the ending is gated on the two things you have to go out of
your way for, not on ordinary competence.

**One detail sharper than the recipe suggests.** All five pieces at once happens
7.6 % of the time, but only 5.2 % clear the bar. The gap is players holding 五雷
(4) rather than 血符 (5): 8 + 4 = 12, one short of 13. So the fifth piece is not
"a heavy talisman", it is **血符 specifically** — the one that costs a point of
your own blood at the door. Six things, not five, if you count the tablet.

## What #46 cost — 七星劍 15 % → 10 %

Landed after option A and measured against it, since the sword is in the seal
recipe and the two interact. The five points went to the weapon table's blank,
so the sword got rarer without the junk blades getting commoner — under #36 that
second route would have compounded the dry-up curve rather than isolating the
lever.

| | after A | after #46 | |
|---|---|---|---|
| **hunter burial** | 344 / 374 | **330 / 354** | −14 / −20 |
| **turtle survived (活水)** | 53 / 66 | **40 / 46** | −13 / −20, the largest proportional hit |
| adept reaches midnight | 32.9 / 34.7 % | **26.1 / 27.4 %** | −6.8 / −7.3 points |
| camper reaches midnight | 37.6 / 38.0 % | 35.4 / 35.5 % | −2.2 / −2.5 |
| adept seal | 17 / 17 (1.7 %) | **10 / 13 (1.0 / 1.3 %)** | −7 / −4 |
| adept attack at midnight | 9.16 / 9.03 | 9.11 / 8.93 | unmoved |

**This is the expensive lever behaving exactly as priced**, and the pricing
report said so before it was chosen: sword supply is what keeps you alive, so
starving it starves survival. The 5 % experiment cost 29 burials; 10 % costs
14–20, which is about the proportional half you would expect.

Two things worth the user seeing rather than discovering:

**活水 took the biggest relative hit.** Turtle survivals fell by a quarter to a
third (53 → 40, 66 → 46). It is a whole ending, and nothing about #46 was aimed
at it — the turtle simply fights the same nights with a worse blade. Burials
fell 4–5 % relative, which is the milder version of the same thing.

**The seal went further under target than the ruling asked for.** It was 1.7 %
and at target after option A; it is now 1.0 % and 1.3 %. Still inside "< 2 %", so
nothing is broken — but the ending was already where the user put it, and this
change moved it another third of the way down as a side effect of a decision
about swords. If 1.7 % was the intended resting place, 攝魂幡 could go back from
2 % to 3 % to recover it without touching survival at all; the pricing table has
that row (banner 3 + bar 13/13 was 7.0/5.9, but banner 3 at bar 14/13 is not yet
measured and would be a single cheap run).

## What #47 cost — the pack from six to four

| | after #46 | after #47 | |
|---|---|---|---|
| hunter burial | 330 / 354 | 322 / 342 | −8 / −12 |
| **turtle survived (活水)** | 40 / 46 | **31 / 33** | −9 / −13 |
| camper reaches midnight | 35.4 / 35.5 % | **27.0 / 28.2 %** | −8.4 / −7.3 points |
| adept reaches midnight | 26.1 / 27.4 % | 23.3 / 24.3 % | −2.8 / −3.1 |
| adept seal | 10 / 13 | **9 / 10 (0.9 / 1.0 %)** | −1 / −3 |
| adept attack at midnight | 9.11 / 8.93 | 9.08 / 8.91 | unmoved |

Exactly the predicted shape: the loss is in the **arrivals** term, not the
conversion term. Attack at the door has not moved across either change — players
who get there are as well armed as ever. Fewer of them get there.

## The three changes together, which is the part worth looking at

Each was ruled separately and each is defensible on its own. Stacked, same seeds
throughout:

| | post-A | after #46 | after #47 | total |
|---|---|---|---|---|
| hunter burial | 344 / 374 | 330 / 354 | 322 / 342 | **−6 % / −9 %** |
| **turtle survived (活水)** | 53 / 66 | 40 / 46 | 31 / 33 | **−42 % / −50 %** |
| adept reaches midnight | 32.9 / 34.7 % | 26.1 / 27.4 % | 23.3 / 24.3 % | **−29 % / −30 %** |
| adept seal | 17 / 17 (1.7 %) | 10 / 13 | 9 / 10 (0.9 / 1.0 %) | **−47 % / −41 %** |

**活水 has been halved.** It was never the target of either ruling — the turtle
simply fights the same nights with a worse sword and less food. It is a whole
ending, and of the five it now has the least room left: 31–33 nights in a
thousand.

**The seal sits at 0.9–1.0 %, against the 1.7 % option A was deliberately tuned
to.** Still inside the "< 2 %" the user asked for, and still above the ~0.5 %
tripwire where I would have stopped rather than continued. But it arrived there
as a side effect of two decisions about swords and slots, not as a decision
about the seal — and it is now roughly half of where it was consciously placed.

Neither of these is a reason not to have landed the rulings. Both are the kind
of thing that is easy to miss when changes land one at a time and each looks
small, which is why they are here in one table.

**If the user wants the seal back at 1.7 % it costs nothing elsewhere**: 攝魂幡
from 2 % to 3 % moves the conversion term only, and the pricing work showed
banner odds leave burial and survival untouched. 活水 has no equally free lever —
it is downstream of the sword and the food, so recovering it means giving back
part of #46 or #47.

## Where the endings sit now

**No numbers here.** This section used to restate them in prose beside the
tables, and it went stale the moment #46 landed — it was still claiming the seal
was 1.7 % and 活水 "untouched" two paragraphs below a table showing 活水 halved.
A reader who trusted the summary would have taken away the opposite of the
finding.

That is the same defect as a digest describing bytes nobody is served, and the
fix is the same one: not a second copy kept in step, but no second copy. **The
tables above are the numbers.** What belongs here is only what a table cannot
say:

- **鎮屍 (seal)** is hidden again by the number as well as by §9, and it is now
  hidden further than it was deliberately placed — see the stacked table.
  Effectively zero for anyone not following the recipe: the other four policies
  score one seal between them per thousand nights, against 14–15 before.
- **鎮墓 (burial)** is the ending the game is actually about, and it has taken
  the least damage of any of them, because nothing aimed at it.
- **活水 (survived)** is the one with the least room left. Nothing was ever
  aimed at it either, and it lost the most proportionally — it is downstream of
  the sword and the food, so every change to those lands on it.
- The King takes most adept nights now. The runs that would have sealed still
  reach the door and fall short, which is what "hidden" looks like from the
  inside: not a locked ending, an ending you usually cannot pay for.

## Against what the design expected

No figures restated here — the tables at the top are the figures, and a prose
copy of them is a thing that goes stale while looking authoritative. This
section is only for the claims the design made that a table cannot settle.

**"Camper and turtle ≈ never win" — still true**, and now true by a wider
margin than when it was written: zero wins across every batch, with both
policies materially harder to keep alive than they were.

**"Banner-less midnight ≈ always fatal" — still the ordinary case**, though
less lopsided since #52. The banner is what decides the exchange, and the
proportion arriving with one is now a design dial rather than an accident.

**"鎮屍 is hidden"** — hidden by §9 as it always was, and hidden by the number
only as far as the shrine's odds allow. That is the live conflict above, not a
settled property.

**"The villager route contributes to the kit"** — still the weakest of the
original claims, and untouched by any of this week's rulings. Worth re-measuring
if it ever matters, rather than assumed either way.
