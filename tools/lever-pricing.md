# Pricing the seal down (#43)

**Nothing here is implemented.** Every number was measured with the levers
patched in memory, in a disposable worktree, and the lever page was deleted
afterwards. This is a menu, not a change.

The user ruled 鎮屍 stays hidden and §9 stays untouched, so the number comes down
to match the name: **adept-line seal under 2 %**, from ~26–30 %, without clawing
back the survival and burial gains from the hands, the ward and the blades.

Two disjoint 1000-seed batches throughout, same discipline as `bots-report.md`.
"Collateral" columns are the things the ruling says must not move.

## What the levers cost

Batch A (seeds 1..1000). Baseline is the shipped game.

| lever | seal % | other seals | hunter burial | turtle surv | adept mid % | adept atk |
|---|---|---|---|---|---|---|
| **baseline** | **25.9** | 14 | 344 | 53 | 32.0 | 11.88 |
| bar 13 / 12 | 20.3 | 9 | 344 | 53 | 32.0 | 11.88 |
| bar 13 / 13 | 16.5 | 7 | 344 | 53 | 32.0 | 11.88 |
| bar 14 / 13 | 6.2 | 2 | 344 | 53 | 32.0 | 11.88 |
| banner 15 → 5 | 14.3 | 5 | 344 | 53 | 32.9 | 10.13 |
| banner 15 → 2 | 7.5 | 3 | 344 | 53 | 32.9 | 9.16 |
| banner 15 → 1 | 4.4 | 2 | 344 | 53 | 33.1 | 8.70 |
| 七星劍 15 → 5 | 12.6 | 7 | **315** | **29** | **15.9** | 11.80 |
| 血符+五雷 20/20 → 5/5 | 14.3 | 10 | **325** | **41** | **20.9** | 11.08 |
| banner +3 instead of ×2 | 20.3 | 11 | 344 | 53 | 32.0 | 11.06 |
| banner +5 instead of ×2 | **26.2** | 24 | 344 | 53 | 32.0 | 12.74 |

**Three findings worth having before choosing.**

**The bar is free but coarse.** Threshold changes touch only the midnight
exchange, so burial, turtle survivals, camper arrivals and adept survival are
bit-identical to baseline — the cleanest lever in the game. But the highest
attack the game can produce is **exactly 13** (七星劍 3, +1 burned in, doubled to
8, plus 血符 5), so the bar has very few useful settings: 12 → 25.9 %, 13 →
16.5 %, 13-with-tablet-only → 6.2 %, 14 → nothing at all. It cannot be tuned
finely on its own.

**Banner supply is almost as free, which I did not expect.** Cutting the shrine's
攝魂幡 odds leaves burial and turtle survivals untouched and *raises* adept
arrivals slightly. The reason is that the banner is hoarded for midnight rather
than spent on the night, so removing it costs the player almost nothing until
the door. That makes it the fine-grained partner the bar lacks.

**Sword and talisman supply are expensive, and should not be used.** 七星劍 at
5 % costs 29 burials and cuts adept arrivals nearly in half — the sword is what
keeps you alive, so starving it starves survival. The heavy talismans are milder
but the same shape. Both violate the "as close to unmoved as the lever allows"
constraint.

**The ×2 is not a lever in the useful direction.** Replacing it with a flat +5
*raises* the seal to 26.2 %, because 4+5+5 = 14 lifts the ceiling above 13.
Only a small flat value reduces anything, and +3 lands where bar 13/12 already
does with more moving parts.

## The finalists

Both batches, in full.

| option | seal % (A) | seal % (B) | other seals | burial (A/B) | turtle (A/B) | adept mid (A/B) |
|---|---|---|---|---|---|---|
| baseline | 25.9 | 29.9 | 14 / 15 | 344 / 374 | 53 / 65 | 32.0 / 35.0 |
| **A — banner 2 + bar 14/13** | **1.7** | **1.7** | 1 / 1 | 344 / 374 | 53 / 66 | 32.9 / 34.7 |
| B — banner 2 + bar 13/13 | 5.1 | 4.1 | 3 / 2 | 344 / 374 | 53 / 66 | 32.9 / 34.7 |
| C — banner 1 + bar 13/13 | 2.9 | 2.2 | 2 / 0 | 344 / 374 | 53 / 66 | 33.1 / 35.2 |
| D — banner 3 + bar 13/13 | 7.0 | 5.9 | 4 / 3 | 344 / 374 | 53 / 66 | 32.9 / 34.7 |
| tablet required + banner 2 | 2.5 | 2.7 | 1 / 2 | 344 / 374 | 53 / 66 | 32.9 / 34.7 |

**Only option A clears the target in both batches**, at 1.7 % and 1.7 %.

Its collateral is as near nothing as the instrument can see: hunter burials
identical in both batches, turtle survivals +0 and +1, camper arrivals +0.3 and
+0.0, adept arrivals +0.9 and −0.3. The seals scored by the *other* policies —
the accidental ones the ruling wants near zero — fall from 14–15 to 1.

The one number that moves visibly is the adept's average attack at midnight,
11.88 → 9.16, and that is the mechanism rather than a side effect: most arrivals
no longer hold a banner.

## Recommendation

**Option A: 攝魂幡 15 % → 2 % in the relic table, and KING_THRESHOLD 12 → 14
(with-tablet 11 → 13).**

It needs **no new rules and no new code** — one number in `data/search.json` and
two constants in `js/engine.js`. Nothing about how the night plays changes.

**What it means in play**, and the reason I would argue for it beyond the
number: because the ceiling is exactly 13, a bar of 14 makes **the 神主牌
mandatory**. The two are equivalent — "bar 14/13" and "unreachable without the
tablet, 13 with it" measured identically in both batches (6.2/6.2 and 8.9/8.9).
So the recipe becomes: his name in your hand, the seven-star sword, a 真火符
burned into it, 攝魂幡, and 血符 — all five, or nothing. For an ending that is
never explained and never announced, "you had to have brought his name" is a
better secret than "you needed a big number".

## The one thing to weigh against it

With the bar at 14, a player who reaches midnight **without** the tablet sees
the §9 comparison card read *your attack 9 / needed 14* — a bar the game cannot
produce. §9 is untouched and no text changes, but that card is the one
player-visible consequence, and it can be read two ways: as the game teaching
that something was missing, or as a number that was never honest.

If that is unacceptable, **option C** (banner 1 % + bar 13/13) keeps every
displayed number at or below the reachable 13 and removes the tablet's discount
instead. It misses the target — 2.9 % and 2.2 % — so it would be accepting
"about 2 %" rather than "under 2 %".

I would take A. C is the honest fallback if the loss card matters more than the
last point of probability.

**Decision is the user's; nothing is landed.**
