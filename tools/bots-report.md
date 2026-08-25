# Bot report — 1000 seeds per policy

Produced by `tools/bots.html` (`?seeds=N`, `?from=S` for a disjoint batch).
Deterministic: the same seed replays the same night. Regenerate after any change
to the tables, the engine, or the map.

Companions: `tools/sweep.html` replays the same seeds against a patched relic
table; `tools/diagnose.html` prints the seal funnel stage by stage. Both patch
data in memory and write nothing.

**Measured after #31, #35 and #36 together** — equipment hands, 石敢當 stopping
破牆, and abandoned blades leaving the night. One measurement of the final
world, taken from a detached read-only checkout on a fresh origin.

## Batch A — seeds 1..1000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight | ever held banner |
|---|---|---|---|---|---|---|---|---|---|
| hunter  | **34.7 %** | 344 | 3   | 1  | 593 | 59  | 6.3 %  | 5.16  | 10.7 % |
| duelist | 1.1 %      | 0   | 11  | 0  | 926 | 63  | 7.7 %  | 8.86  | 13.0 % |
| **adept**   | **25.9 %** | 0 | **259** | 5 | 680 | 56 | **32.0 %** | **11.88** | 38.6 % |
| turtle  | 0 %        | 0   | 0   | 53 | 947 | 0   | 5.3 %  | 5.26  | 8.0 %  |
| camper  | 0 %        | 0   | 0   | 0  | 627 | 373 | 37.3 % | 1.86  | 3.5 %  |

## Batch B — seeds 5001..6000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight |
|---|---|---|---|---|---|---|---|---|
| hunter  | 38.0 % | 374 | 6 | 1  | 541 | 78  | 8.5 %  | 4.27  |
| duelist | 0.9 %  | 0   | 9 | 1  | 914 | 76  | 8.7 %  | 8.39  |
| **adept**   | **29.9 %** | 0 | **299** | 6 | 650 | 45 | **35.0 %** | **12.08** |
| turtle  | 0 %    | 0   | 0 | 65 | 935 | 0   | 6.5 %  | 5.09  |
| camper  | 0 %    | 0   | 0 | 0  | 620 | 380 | 38.0 % | 2.00  |

## What each of the three changes actually did

Same seeds throughout, so every difference is the rule named.

| | hunter burial | adept seal | hunter reaches midnight |
|---|---|---|---|
| before the hands (#28 world) | 336 / 365 | 230 / 266 | 1.5 % / 1.4 % |
| **#31** hands | 344 / 374 | 250 / 290 | 3.4 % / 3.7 % |
| **#35** ward blocks 破牆 | 344 / 374 | 259 / 299 | 6.3 % / 8.5 % |
| **#36** abandoned blades | 344 / 374 | 259 / 299 | 6.3 % / 8.5 % |

**#31 (the hands) was the difficulty change**, and it landed on survival rather
than on power: attack at midnight barely moved, but the pack stopped being half
equipment and became nearly all medicine. Everyone lived longer.

**#35 (the ward) is worth about a point of seal and doubles the hunter's
midnight arrivals** — 1.5 % → 6.3 % across the whole arc. That second number is
the interesting one and it is not about the adept at all: the hunter blunders
into dead ends far more often than it plans to, and a corner that no longer
kills it is a corner it walks out of. Its burials do not move, because a hunter
that reaches midnight has already failed to bury anything — the deaths simply
move from `LOSS_HEALTH` to `LOSS_KING` (30 → 59, 30 → 78).

**#36 (abandoned blades) measured no change at all**, in either batch, to any
policy — the tables are byte-identical to the #35 run. That is the correct
result rather than a suspicious one, and it is worth writing down why:

- `search` consumes exactly one draw from the stream whatever the outcome, so
  turning an OFFER_REPLACE into a NOTHING does not shift a single later roll.
- The only re-findable blade is one you already put down, which by construction
  you judged worse than what you are holding. Pre-#36 the bot was offered it and
  declined; post-#36 it is not offered. Same state either way.

So #36's value is not in the bot numbers. It is in the dry-up curve it restores
for a human, and in the map making sense — the sword you abandoned is lying in a
room, not circulating.

## Weapon rooms dry up again

`missChance` climbs 10 → 35 → 60 → 85 once more. #31 had nearly killed it: one
weapon in hand meant the miss stopped at 35 and a weapon table stayed 65 %
productive all night. #36 restores the curve by changing what "spoken for"
means, and the restored version is the better one — it counts blades that
*passed through* your hands rather than blades you are implausibly carrying at
once, which is what the old rule had to pretend.

## Pricing the pack, re-measured in this world

The amendment flagged that the hands drop pack pressure and left the size open.
Adept and hunter, 1000 seeds, `MAX_ITEMS` varied and nothing else:

| pack | adept seal | adept reaches midnight | hunter burial |
|---|---|---|---|
| **6** (shipped) | 259 | 32.0 % | 344 |
| 5 | 254 | 31.5 % | 343 |
| 4 | 218 | 27.2 % | 334 |

**Five buys back almost nothing** — half a point of seal, and the hunter does not
move. The hands freed roughly two slots of pressure and taking one back does not
undo them. **Four is where it bites**: the adept drops 4 pp and its midnight
arrivals fall by a sixth.

So if the intent is to hold the pre-#31 difficulty, five is not the lever and
four is a bigger change than "one fewer slot" sounds. If the intent is that
equipment simply stopped competing with medicine, six is already right and the
extra survival is the feature. Unchanged conclusion from the #31 measurement,
now taken in the world that actually ships.

## Against what the design expected

**"Camper and turtle ≈ never win" — still true**, zero across 4000 nights, though
both are materially harder to kill than before the hands.

**"Banner-less midnight ≈ always fatal" — confirmed.** The camper reaches
midnight in 37–38 % of runs and converts none: average attack 1.86 against a
threshold of 12.

**The seal is a ~26–30 % ending for a player who knows the recipe.** What that
knowledge now amounts to: rooms can be rummaged every turn you stand in them,
talismans are consumed, 七星劍 is in the weapon table, one square on the map draws
nothing and is not a trap — and the blade you leave behind is not coming back.
