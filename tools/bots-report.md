# Bot report — 1000 seeds per policy

Produced by `tools/bots.html` (`?seeds=N`, `?from=S` for a disjoint batch).
Deterministic: the same seed replays the same night. Regenerate after any change
to the tables, the engine, or the map.

Companions: `tools/sweep.html` replays the same seeds against a patched relic
table; `tools/diagnose.html` prints the seal funnel stage by stage. Both patch
data in memory and write nothing.

**Measured after #31** — equipment hands: the weapon and 護身符 live outside the
backpack, and one weapon is carried ever.

## Batch A — seeds 1..1000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight | ever held banner |
|---|---|---|---|---|---|---|---|---|---|
| hunter  | **34.7 %** | 344 | 3   | 1  | 622 | 30  | 3.4 %  | 6.29  | 10.7 % |
| duelist | 1.1 %      | 0   | 11  | 0  | 927 | 62  | 7.5 %  | 8.87  | 12.9 % |
| **adept**   | **25.0 %** | 0 | **250** | 5 | 689 | 56 | **31.2 %** | **11.86** | 38.6 % |
| turtle  | 0 %        | 0   | 0   | 53 | 947 | 0   | 5.3 %  | 5.26  | 8.0 %  |
| camper  | 0 %        | 0   | 0   | 0  | 627 | 373 | 37.3 % | 1.86  | 3.5 %  |

## Batch B — seeds 5001..6000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight |
|---|---|---|---|---|---|---|---|---|
| hunter  | 38.0 % | 374 | 6 | 1  | 589 | 30  | 3.7 %  | 6.38  |
| duelist | 0.9 %  | 0   | 9 | 1  | 915 | 75  | 8.6 %  | 8.45  |
| **adept**   | **29.0 %** | 0 | **290** | 6 | 659 | 45 | **34.1 %** | **12.06** |
| turtle  | 0 %    | 0   | 0 | 65 | 935 | 0   | 6.5 %  | 5.09  |
| camper  | 0 %    | 0   | 0 | 0  | 620 | 380 | 38.0 % | 2.00  |

## Before and after the hands

Same seeds, same policies. Every difference is #31.

| policy | before (A / B) | after (A / B) | |
|---|---|---|---|
| hunter burial   | 336 / 365 | 344 / 374 | up a little |
| adept seal      | 230 / 266 | 250 / 290 | **up ~2 pp** |
| duelist seal    | 6 / 2     | 11 / 9    | up, off a tiny base |
| turtle survived | 31 / 36   | 53 / 65   | **up ~70 %** |
| camper → King   | 287 / 289 | 373 / 380 | **up ~30 %** |

**Everything got easier, and in one direction: survival.** The camper reaches
midnight 28.7 % → 37.3 %; the turtle's survivals rose by two thirds; even the
hunter, which barely sees midnight, gained. Nobody's *attack* moved much — the
adept's average at midnight is 11.86 against 11.80 before.

The reason is not the weapon. It is the pack. Taking the sword and 護身符 out of
it turned a bag that was half equipment into a bag that is nearly all medicine:
the same six slots now carry two more rice, and rice is health. The charm helps
in the same direction and more reliably than before — it used to compete for a
slot and could be crowded out, and now it is simply worn.

So the honest description of #31 is that it is **a difficulty reduction that
arrived as an inventory change**, and it was not asked for. The amendment
flagged the mechanism ("pack pressure drops — kept at 6 per the literal ruling,
shrinking it is a separate decision") without a number attached. Here is the
number.

## Pricing the pack, since that decision is now live

Adept and hunter, 1000 seeds, `MAX_ITEMS` varied and nothing else:

| pack | adept seal | adept reaches midnight | hunter burial |
|---|---|---|---|
| **6** (shipped) | 250 | 31.2 % | 344 |
| 5 | 245 | 30.7 % | 343 |
| 4 | 208 | 26.3 % | 334 |

**Shrinking to five buys back almost nothing** — half a point of seal, and the
hunter does not move at all. The hands freed roughly two slots of pressure and
taking one back does not undo them. **Four is where it bites**: the adept drops
4 pp and its midnight arrivals fall by a fifth.

So if the intent is to hold the pre-#31 difficulty, five is not the lever —
four is, and four is a bigger change than "one fewer slot" sounds. If the intent
is that equipment simply stopped competing with medicine, six is already right
and the extra survival is the feature.

## A consequence worth naming: weapon rooms no longer dry up

`missChance` used to climb 10 → 35 → 60 → 85 as swords accumulated — every blade
you owned raised the chance the next rummage handed back a room you had already
looted, and that was what made weapon tables self-limiting.

One weapon ever ends it. You can hold at most one, so the miss reaches 35 and
stops, and a weapon table stays 65 % productive all night. Swapping is now the
only way a weapon room disappoints you, and swapping is a choice.

**Open question for the user**, flagged rather than assumed: the amendment says
the replaced weapon is *left behind and gone*. Implemented literally, "gone"
means gone from your hands — the search table can still offer it later, because
nothing tracks destroyed items. If "gone" was meant as gone from the night, that
is a small change (treat left-behind blades like uniques already held) and it
would restore the old 10 → 35 → 60 → 85 curve as a side effect, since each
abandoned sword would also stop turning up. Not built: it adds a rule the
amendment did not state.

## Against what the design expected

**"Camper and turtle ≈ never win" — still true**, and still zero across 4000
nights, though both are now materially harder to kill.

**"Banner-less midnight ≈ always fatal" — confirmed.** The camper reaches
midnight in 37–38 % of runs and converts none: average attack 1.86 against a
threshold of 12.

**The seal is a ~25–29 % ending for a player who knows the recipe.** The
knowledge it needs is unchanged: rooms can be rummaged every turn you stand in
them, talismans are consumed, 七星劍 is in the weapon table, one square on the
map draws nothing — and now, that the blade you leave behind does not come back
to your hand.
