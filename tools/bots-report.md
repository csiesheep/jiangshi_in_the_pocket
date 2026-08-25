# Bot report — 1000 seeds per policy

Produced by `tools/bots.html` (`?seeds=N`, `?from=S` for a disjoint batch).
Deterministic: the same seed replays the same night. Regenerate after any change
to the tables, the engine, or the map.

Companions: `tools/diagnose.html` prints the seal funnel stage by stage;
`tools/sweep.html` replays the same seeds against a patched relic table. Both
patch data in memory and write nothing. Lever pricing for #43 is in
`tools/lever-pricing.md`.

**Measured after #43 option A** — 攝魂幡 2 % at the shrine, and the bar at 14
(13 carrying the 神主牌).

## Batch A — seeds 1..1000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight |
|---|---|---|---|---|---|---|---|---|
| hunter  | **34.4 %** | 344 | 0 | 1  | 592 | 63  | 6.4 %  | 4.77 |
| duelist | 0.1 %      | 0   | 1 | 0  | 926 | 73  | 7.7 %  | 7.84 |
| **adept**   | **1.7 %** | 0 | **17** | 0 | 671 | 312 | **32.9 %** | 9.16 |
| turtle  | 0 %        | 0   | 0 | 53 | 947 | 0   | 5.3 %  | 5.00 |
| camper  | 0 %        | 0   | 0 | 0  | 624 | 376 | 37.6 % | 1.83 |

## Batch B — seeds 5001..6000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight |
|---|---|---|---|---|---|---|---|---|
| hunter  | 37.4 % | 374 | 0 | 1  | 540 | 85  | 8.6 %  | 3.80 |
| duelist | 0.1 %  | 0   | 1 | 1  | 913 | 85  | 8.7 %  | 7.37 |
| **adept**   | **1.7 %** | 0 | **17** | 2 | 653 | 328 | **34.7 %** | 9.03 |
| turtle  | 0 %    | 0   | 0 | 66 | 934 | 0   | 6.6 %  | 4.82 |
| camper  | 0 %    | 0   | 0 | 0  | 620 | 380 | 38.0 % | 1.99 |

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

- **鎮屍 (seal)**: 1.7 % for a player who knows the recipe, and effectively zero
  for anyone who does not — the other four policies score 1 seal between them
  per 1000 nights, down from 14–15.
- **鎮墓 (burial)**: 34.4 / 37.4 %, untouched by any of this.
- **活水 (survived)**: the turtle's 5.3–6.6 %, untouched.
- Everything else is a loss, and the King now takes 31–33 % of adept nights
  where he used to take 5 %: the runs that would have sealed now arrive and fall
  short. That is the ending being hidden rather than removed — the door is still
  reached, and what happens there is simply usually not enough.

## Against what the design expected

**"Camper and turtle ≈ never win" — still true**, zero across 4000 nights.

**"Banner-less midnight ≈ always fatal" — now the ordinary case**, and by
design: 76–79 % of arrivals have no banner at all.

**"鎮屍 is hidden" — true again by the number as well as the presentation**, at
1.7 % against the 0.4 % it measured when the ruling was made.
