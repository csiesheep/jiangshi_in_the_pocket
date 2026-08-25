# Bot report — 1000 seeds per policy

Produced by `tools/bots.html` (`?seeds=N`, `?from=S` for a disjoint batch).
Deterministic: the same seed replays the same night. Regenerate after any change
to the tables, the engine, or the map.

Companions: `tools/sweep.html` replays the same seeds against a patched relic
table; `tools/diagnose.html` prints the seal funnel stage by stage. Both patch
data in memory and write nothing.

**Measured after #28** — cowering removed, the shrine's prayer removed, 石敢當
warded, and the indoor heal moved from 帳房 to 香堂.

## Batch A — seeds 1..1000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight | ever held banner |
|---|---|---|---|---|---|---|---|---|---|
| hunter  | **33.7 %** | 336 | 1   | 1  | 650 | 12  | 1.5 %  | 5.67  | 10.7 % |
| duelist | 0.6 %      | 0   | 6   | 0  | 971 | 23  | 2.9 %  | 8.03  | 12.7 % |
| **adept**   | **23.0 %** | 0 | **230** | 5 | 710 | 55 | **29.2 %** | **11.80** | 37.6 % |
| turtle  | 0 %        | 0   | 0   | 31 | 969 | 0   | 3.1 %  | 4.97  | 8.0 %  |
| camper  | 0 %        | 0   | 0   | 0  | 713 | 287 | 28.7 % | 0.82  | 3.5 %  |

## Batch B — seeds 5001..6000

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight |
|---|---|---|---|---|---|---|---|---|
| hunter  | 36.6 % | 365 | 1 | 1  | 621 | 12  | 1.4 %  | 5.21  |
| duelist | 0.2 %  | 0   | 2 | 1  | 972 | 25  | 3.0 %  | 7.30  |
| **adept**   | **26.6 %** | 0 | **266** | 6 | 685 | 43 | **31.6 %** | **12.04** |
| turtle  | 0 %    | 0   | 0 | 36 | 964 | 0   | 3.6 %  | 4.69  |
| camper  | 0 %    | 0   | 0 | 0  | 711 | 289 | 28.9 % | 0.99  |

## Before and after the redesign

Same seeds, same policies, so every difference is the three rule changes.

| policy | before (A / B) | after (A / B) | |
|---|---|---|---|
| hunter burial  | 328 / 359 | 336 / 365 | **flat** |
| adept seal     | 224 / 243 | 230 / 266 | **flat to slightly up** |
| duelist seal   | 4 / 4     | 6 / 2     | noise either side of nothing |
| turtle survived| 64 / 81   | 31 / 36   | **halved** |
| camper → King  | 463 / 507 | 287 / 289 | **collapsed** |

**The hunter did not drop.** This was the expected casualty — it lost the
prayer, its only mitigation for the grave staying buried in the deck. It is flat
across both batches, inside a standard deviation either way. The prayer was
worth close to nothing to it, and the funnel says why: the hunter reaches
midnight 1.5 % of the time, so it wins by burying *early*, and the prayer only
paid when the grave was still in the stack late — a case that mostly did not
arrive before the night did.

**The adept held, having lost three free turns and gained a square.** It gave up
three event-free turns it could carry anywhere and got one place that is
event-free forever. Net: unchanged to slightly better. That is the redesign
working exactly as ruled — safety moved from inventory to geography without
moving the difficulty.

**The two policies that had nothing but charges lost the most.** The camper's
midnight arrivals fell 46.3 % → 28.7 % and its deaths-by-health rose 537 → 713;
the turtle's survivals halved. Neither had anywhere to be. Standing still was a
plan while three charges could absorb the worst three draws of a night; without
them it is just standing still. The camper also lost a little geometry: the
indoor heal moved to 香堂, which has two exits where 帳房 had three, so it corners
itself more often.

Net: **the redesign cost the policies that carried safety and cost nothing to
the policy that knows where to stand.** That is the shape the amendment asked
for.

## One thing the amendment does not settle

The ward stops the **event**. 破牆 is not an event draw — it is triggered by
standing in a dead end — so as written the breach still reaches the stone. It
is not hypothetical:

| | breaches taken while standing on the ward, per 1000 nights |
|---|---|
| hunter | 307 (A) / 445 (B) |
| adept  | 280 (A) / 432 (B) |

石敢當 has four exits, but `isDeadEnd` turns true once every opening leads to a
tile already on the table — so late in the night, exactly when the adept is
waiting there with a finished kit, the safe square can start taking 5-count
packs.

Measured both ways (`?wardBlocksBreach=1`, a counterfactual switch, never the
shipped rule):

| | shipped (ward stops events only) | counterfactual (ward stops the breach too) |
|---|---|---|
| adept seal | 230 | 240 |
| hunter burial | 336 | 336 |
| hunter reaches midnight | 1.5 % | 4.4 % |

**The ruling is worth about one point** on the headline, so it can go either way
without disturbing the balance. Raising it because the amendment's stated intent
— "safety is now a place you travel to" — reads oddly against a safe place that
takes 4 damage a turn at eleven o'clock, and because 破牆 is a jiangshi coming
through the wall, which is the exact thing a 石敢當 is for. Implemented
literally, and flagged rather than assumed.

## Against what the design expected

**"Camper and turtle ≈ never win" — still confirmed**, and more so than before:
zero wins across 4000 nights, with both policies materially worse off.

**"Banner-less midnight ≈ always fatal" — confirmed.** The camper still reaches
midnight more often than anyone but the adept and converts none of it: average
attack 0.82 against a threshold of 12.

**The seal is a ~25 % ending for a player who knows the recipe**, and the
knowledge it needs is unchanged by the redesign: rooms can be rummaged every
turn you stand in them, talismans are consumed, 七星劍 is in the weapon table —
and now, that there is one square on the map where nothing comes.
