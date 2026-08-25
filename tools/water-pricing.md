# Pricing the no-damage 溪澗 (#57)

**Nothing here is implemented.** The rule was patched into a disposable worktree,
measured, and the lab deleted. This is a menu.

The question: the rulebook has always said 殭屍 "cannot cross it, so their
attacks do you no damage while you stand here", and the engine never implemented
it. If it were built, does a damage-free tile break the night's pressure? The
design has held since the start that **camping must be losing**, and that was
established against a HEAL_1 tile that *adds* healing. This one *removes*
damage, which is a different shape, so it is re-derived rather than reasoned
from the earlier result.

Two readings of "their attacks" are priced separately, because the wording is
ambiguous and the edge should be ruled on knowingly:

- **narrow** — only an ordinary drawn 殭屍 fight.
- **wide** — anything that reaches you while you stand there: the drawn fight,
  the 破牆 breach, and the fight a refused villager turns into.

Two disjoint 1000-seed batches. `squatter` is a lab-only policy — the adept's kit
assembly, then parking on 溪澗 instead of 石敢當 — because the question is not
whether today's bots happen to use a damage-free tile, but whether one that
*means* to can coast there.

## The measurement

Batch A / batch B.

| policy | | shipped | narrow | wide |
|---|---|---|---|---|
| **turtle** | reaches midnight | 3.1 / 3.2 % | **35.3 / 36.6 %** | **38.8 / 38.9 %** |
| | wins anything | **0 / 0** | **0 / 0** | **0 / 0** |
| **squatter** | seal | 86 / 98 | 93 / 108 | 95 / 114 |
| **adept** (uses 石敢當) | seal | 113 / 128 | 116 / 129 | 116 / 129 |
| **hunter** | burial | 322 / 342 | 331 / 349 | 331 / 349 |
| **camper** | wins anything | 0 / 0 | 0 / 0 | 0 / 0 |

## The three things this settles

**Camping stays losing, and by the same margin as ever.** The turtle becomes
very hard to kill — arrivals go from 3 % to nearly 39 % — and wins **nothing**,
in either scope, in either batch. 溪澗 has no search, so a night spent standing
in it is a night spent building no kit: you survive to midnight and meet him
bare-handed. The rule does not make camping win, it makes it *take longer to
lose*, which is a different and much smaller thing than the HEAL_1 result was
testing.

**The tile cannot be exploited, because 石敢當 already dominates it.** The
squatter — a player who knows the recipe and deliberately parks on the water —
scores *below* the adept in every scope and both batches (86–114 against
113–129). The reason is structural rather than lucky: the ward blocks **the
entire event draw and the breach**, while a no-damage stream would waive only
damage. On the water you are still poisoned, still take the cold-room HP events,
still meet the villager, and still draw every turn. A strictly weaker safe tile
cannot break a game the stronger one already sits in.

**The cost to everything else is small.** Hunter burials +7 to +9 (about 2–3 %
relative, from passing through the tile rather than living in it); adept seal +1
to +3, since it uses the ward regardless.

## The edge the user should rule on knowingly

Scope only matters for policies that actually stand on the water. The adept and
the camper are **identical** under narrow and wide. The turtle differs by 2–3
points of arrivals; the hunter by about a point of burial.

So the choice is nearly free either way, and I would take **wide** for a reason
that is not about balance: it is the simpler rule and the simpler implementation.
Wide is one flag read at the tile, exactly like `WARDED` — `resolveCombat` waives
damage and does not care what sent it. Narrow requires the caller to distinguish
a drawn 殭屍 fight from a breach from a refused villager, three call sites that
are currently identical and would have to stop being. "Nothing that reaches you
here can hurt you" is also easier to say in a rulebook than the alternative, and
the rulebook is where this rule came from.

## The interaction nobody has named yet

**#57 is coupled to the open decision about 見到天亮.**

Right now the turtle's new survivability is harmless: it reaches midnight and
dies to the King, because 見到天亮 is unreachable since #56. But if that ending is
ever restored *via 溪澗* — the obvious place, since that is where it lived — then
no-damage plus survive-the-night means **standing in the stream becomes a
button that wins ~39 % of the time with no kit, no search and no decisions.**

Neither ruling is dangerous alone. Together they would undo "camping must be
losing" completely. If both are wanted, the ending needs a different home, or
the water needs to stay dangerous.

## Recommendation

Build it, **wide**, if the rulebook is to be believed — it costs almost nothing
measurable and it makes a page of documentation true that has been false since
it was written. Do not build it if 見到天亮 is coming back to this tile.

The decision is the user's; nothing is landed.
