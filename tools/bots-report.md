# Bot report — 1000 seeds per policy

Produced by `tools/bots.html` (open it on a static server; `?seeds=N` to change
the count, `?from=S` for a disjoint batch). Deterministic: the same seed replays
the same night, and a rerun of the same batch gives the same table. Regenerate
after any change to the tables, the engine, or the map.

Companion pages: `tools/sweep.html` replays the same seeds against a patched
relic table, so two rows differ by exactly one number; `tools/diagnose.html`
prints the seal funnel stage by stage. Both patch data **in memory** and write
nothing.

## Batch A — seeds 1..1000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight | ever held banner | villager gift |
|---|---|---|---|---|---|---|---|---|---|---|
| hunter  | **32.8 %** | 328 | 0   | 1  | 658 | 13  | 1.5 %  | 5.33  | 10.6 % | 49.1 % |
| duelist | 0.4 %      | 0   | 4   | 1  | 960 | 35  | 4.5 %  | 7.04  | 10.4 % | 46.6 % |
| **adept**   | **22.4 %** | 0 | **224** | 0 | 718 | 58 | **28.3 %** | **11.77** | 34.4 % | 60.0 % |
| turtle  | 0 %        | 0   | 0   | 64 | 936 | 0   | 6.4 %  | 4.56  | 7.3 %  | 51.1 % |
| camper  | 0 %        | 0   | 0   | 0  | 537 | 463 | 46.3 % | 0.25  | 3.1 %  | 62.7 % |

## Batch B — seeds 5001..6000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight |
|---|---|---|---|---|---|---|---|---|
| hunter  | 36.1 % | 359 | 2   | 1  | 623 | 15  | 1.8 %  | 5.00  |
| duelist | 0.4 %  | 0   | 4   | 1  | 942 | 53  | 6.0 %  | 7.02  |
| **adept**   | **24.3 %** | 0 | **243** | 1 | 702 | 54 | **29.8 %** | **11.86** |
| turtle  | 0 %    | 0   | 0   | 81 | 919 | 0   | 8.1 %  | 4.47  |
| camper  | 0 %    | 0   | 0   | 0  | 493 | 507 | 50.7 % | 0.23  |

The policies share one survival floor — eat when hurt, run when badly hurt,
spend a talisman on a pack that would actually hurt — because without it every
bot dies on turn five and measures only the first five turns. They differ in
where they want to be standing, and only the hunter performs the burial rite.

---

# Issue #22 phase 1 — tuning the seal by the banner's odds

The brief was to raise the duelist's seal into a 1.5–2.5 % band by tuning the
banner's odds in the relic table, on the theory that banner supply was the
bottleneck. **That theory was wrong**, the shipped table is unchanged, and the
sweep below is what disproved it.

Every row replays the same seeds and differs only in the relic table. Duelist,
2000 seeds per row, one relic tile (土地廟) as shipped:

| banner % | relic table | ever held banner | seals | seal % |
|---|---|---|---|---|
| **15** (shipped) | 糯米 40 / 攝魂幡 15 / — 45 | 10.5 % | 7  | **0.35 %** |
| 40 | 糯米 40 / 攝魂幡 40 / — 20 | 20.8 % | 10 | 0.50 % |
| 60 | 糯米 40 / 攝魂幡 60 | 25.6 % | 9  | 0.45 % |
| 100 | 攝魂幡 100 | 30.7 % | 10 | 0.50 % |

At 100 % — every rummage at the shrine yielding the banner, the limit of the
lever — the seal is still 0.5 %. Past 60 % the odds are paid for out of the 糯米
in the same table, so midnight arrivals *fall* from 5.1 % to 2.9 %: the lever
fights itself.

The unconstrained falsification, to be certain: banner at 60 % **and** two more
tiles converted to the relic table, putting the banner in **94.8 %** of hands at
midnight. Seal: **0.40 %**, unmoved, across two disjoint 3000-seed batches. The
attack histogram spiked at 6 — 七星劍 doubled with an empty other hand — because
the tiles converted were the ones that supplied talismans. Ten search tiles,
four tables: supply can only be moved, not created.

---

# Issue #22 phase 2 — fixing the instrument

The user's ruling was **option C: fix the instrument first.** Phase 1's funnel
said 95 % of duelist runs never reached midnight, which is a statement about the
duelist rather than about the game. So: a policy that plays the seal line
properly, and a re-measurement. No data or engine changes — `tools/` only.

## What the first duelist was getting wrong

Three mistakes, and all three are the difference:

**1. It did not know searching is repeatable.** A room can be rummaged every
turn you stand in it. The banner is one tile in twenty paying 15 % a rummage, so
the play is to *stand on* 土地廟 and keep looking, not to wander hoping to cross
it. The old duelist wandered. The adept camps — and because that table is also
40 % 糯米, the camp that hunts the banner feeds the camper. One decision fixes
supply and survival together.

**2. It spent the strike talisman on corridor fights.** Talismans are
`consumed`. The old `fight()` reached for the highest-attack talisman in the
pack whenever a fight would hurt, which is 血符 or 五雷 — the exact item midnight
needs. It won corridors and arrived at the door holding nothing.

**3. It never hunted a sword.** Its want-list was `relic` or `magic` only. The
recipe needs 七星劍, which is in the weapon table, so the kit was unreachable by
construction: average best attack 1.85 over a thousand nights.

Two smaller ones: it burned cower charges at 3 HP in the first hour, when a
charge is worth the draw it skips and the draws get worse every hour; and it
would pay 血符's 1 HP cost at 1 HP, dying on the doorstep instead of reaching
past it for the lighter talisman.

## The adept

Knows the recipe and the map's roles, plans against tiles already on the table,
and takes no dice of its own — it never reads the rng and never sees an undrawn
tile. Deterministic per seed.

The line: arm indoors while the night is young, cross out and camp the shrine
from turn 11, keep the heavy talisman for the King, hoard charges for eleven
o'clock, eat at 5 (at 6 in the last band, since 糯米 heals 3 and eating at 8 is
waste), take the 神主牌 if the crypt turns up and the bar is not yet cleared, and
be standing anywhere but the 溪澗 when the clock runs out.

## The decomposition — which gate moved

    duelist   4.5 % reach midnight  ×   8.9 % kitted on arrival  =  0.4 %
    adept    28.3 % reach midnight  ×  79.2 % kitted on arrival  = 22.4 %   (batch A)
    adept    29.8 % reach midnight  ×  81.5 % kitted on arrival  = 24.3 %   (batch B)

**Both gates moved, and neither explains it alone.** Arrivals ×6.3 from playing
to survive; conversion ×8.9 from actually holding a kit on arrival. The product
is ×56.

The attack histogram at midnight says the recipe is being assembled on purpose
rather than stumbled into — 146 arrivals at exactly 13 (七星劍 buffed, doubled,
plus 血符) and 78 at exactly 12 (the same with 五雷). The failures cluster at 8
and 9: a banner and a sword with nothing in the other hand, or the best a night
without the banner can do.

## What this means for the target

The target was ~2 %. **The competent duelist seals 22.4 % and 24.3 % across two
disjoint batches** — the band is cleared by an order of magnitude, so on the
terms of the ruling the game stands and needs no change.

It is worth saying plainly that clearing a target by 10× is not the same as
hitting it, and it moves the question rather than closing it: the seal is not a
rare ending at all for a player who knows the recipe. It was never gated by
scarcity — it was gated by knowing that rooms can be searched twice, that
talismans are consumed, and that 七星劍 is in a table the old bot never visited.
Whether an ending that common should still be presented as hidden is a design
call, and it is the opposite of the one #7 sent up.

**One caveat on the comparison.** Seal 22.4 % against burial 32.8 % is
*competent duelist vs mediocre hunter* — the hunter has not had the same pass,
and it still spends its strike talisman in corridors and burns charges early. A
fair ending-to-ending ratio needs both policies played equally well, and that
number does not exist yet. The honest reading of this table is "the seal is
reachable for a player who knows how", not "the seal is 1.5× rarer than the
burial".

---

## Against what the design expected

**"Camper and turtle ≈ never win" — confirmed.** Zero wins across 4000 nights
between them, both batches. The turtle reaches `SURVIVED` 6–8 % of the time,
which is neither a win nor a loss and is exactly what 活水 is for.

**"Banner-less midnight ≈ always fatal" — confirmed, emphatically.** The camper
reaches midnight in 46–51 % of runs, more than any other policy, and converts
none of it: average attack 0.25 against a threshold of 12, and 463–507 deaths
to the King. Standing still keeps you alive and leaves you with nothing to meet
him with.

**"The seal is rarer than the burial but reachable" — reachable, and the ratio
was an artefact.** At 80:1 it looked unreachable; measured against a policy that
knows the recipe it is 1.5:1, with the caveat above.

**"The villager route contributes to the kit" — true, but only for someone who
lives to see it.** This corrects the phase-1 reading. The old duelist's gifts
were 540 charms against 3 五雷, which said the villager was a route to the charm
and nothing else. The adept's are:

    protective-charm     668
    truefire-talisman    218
    fivethunder-talisman 173

The two gifts that feed the seal are the 10 PM and 11 PM ones, so whether the
villager matters is entirely a question of whether you are alive in those bands.
The route was never broken — the measurement was taken with a bot that died at
half past nine.
