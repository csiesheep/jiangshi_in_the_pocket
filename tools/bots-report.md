# Bot report — 1000 seeds per policy

Produced by `tools/bots.html` (open it on a static server; `?seeds=N` to change
the count). Deterministic: the same seed replays the same night, and a rerun of
the same batch gives the same table. Regenerate after any change to the tables,
the engine, or the map.

Companion pages: `tools/sweep.html` replays the same seeds against a patched
relic table, so two rows differ by exactly one number; `tools/diagnose.html`
prints the seal funnel stage by stage. Both patch data **in memory** and write
nothing.

Run against `8da5ee3` + the `hadBanner` fix below.

| policy | win % | burial | seal | survived | died | king | reached midnight | avg atk @ midnight | ever held banner | villager gift |
|---|---|---|---|---|---|---|---|---|---|---|
| hunter  | **32.8 %** | 328 | 0 | 1  | 658 | 13  | 1.5 %  | 5.33 | 10.6 % | 49.1 % |
| duelist | 0.4 %      | 0   | 4 | 1  | 960 | 35  | 4.5 %  | 7.04 | 10.4 % | 46.6 % |
| turtle  | 0 %        | 0   | 0 | 64 | 936 | 0   | 6.4 %  | 4.56 | 7.3 %  | 51.1 % |
| camper  | 0 %        | 0   | 0 | 0  | 537 | 463 | 46.3 % | 0.25 | 3.1 %  | 62.7 % |

The policies share one survival floor — eat when hurt, run when badly hurt,
spend a talisman on a pack that would actually hurt — because without it every
bot dies on turn five and measures only the first five turns. They differ in
where they want to be standing, and only the hunter performs the burial rite.

## Against what the design expected

**"Camper and turtle ≈ never win" — confirmed.** Zero wins in 2000 nights
between them. The turtle does reach `SURVIVED` 6.4 % of the time, which is
neither a win nor a loss and is exactly what 活水 is for.

**"Banner-less midnight ≈ always fatal" — confirmed, emphatically.** The camper
reaches midnight in 46.3 % of runs, more than any other policy, and converts
none of it: average attack 0.25 against a threshold of 12, and 463 deaths to
the King. Standing still keeps you alive and leaves you with nothing to meet
him with.

**"The seal is rarer than the burial but reachable" — reachable, but the ratio
is far past 'rarer'.** 4 seals in 1000 duelist nights against 328 burials in
1000 hunter nights: about eighty to one.

**"The villager route contributes to the kit" — not as designed.** Gifts are
taken in about half of all runs, but the breakdown says what they are:

    protective-charm   565      (9 PM)
    truefire-talisman   52      (10 PM)
    fivethunder-talisman 2      (11 PM)

The two gifts that feed the seal are the 10 PM and 11 PM ones, and runs mostly
end before those bands. In practice the villager is a route to the **charm**,
not to the kit. The camper — the only policy that reliably survives into the
late bands — is also the only one that sees a meaningful number of talisman
gifts (204 truefire, 24 fivethunder), and it has no attack to use them with.

---

# Issue #22 — tuning the seal to ~2 %

The brief was to raise the duelist's seal into a 1.5–2.5 % band by tuning the
banner's odds in the relic table, on the theory from the section above that
banner supply is the bottleneck.

**That theory is wrong, and the sweep below is what disproves it.** No value of
the banner's odds reaches the band. The shipped table is therefore **unchanged**,
and this section is the report the issue asked for in that case.

## What was measured

Every row replays the same seeds and differs only in the relic table. Duelist,
2000 seeds per row, one relic tile (土地廟) as shipped:

| banner % | relic table | ever held banner | seals | seal % |
|---|---|---|---|---|
| **15** (shipped) | 糯米 40 / 攝魂幡 15 / — 45 | 10.5 % | 7  | **0.35 %** |
| 40 | 糯米 40 / 攝魂幡 40 / — 20 | 20.8 % | 10 | 0.50 % |
| 60 | 糯米 40 / 攝魂幡 60 | 25.6 % | 9  | 0.45 % |
| 100 | 攝魂幡 100 | 30.7 % | 10 | 0.50 % |

Quadrupling the odds moves the seal by about two runs in two thousand. At 100 %
— every rummage at the shrine yielding the banner, which is not a design so
much as the limit of the lever — the seal is still **0.5 %**, a third of the way
to the band's floor.

Note what else that column does: `reached midnight` *falls* from 5.1 % to 2.9 %
across the sweep. Past 60 % the banner is being paid for out of the 糯米 in the
same table, and the rice was buying survival. **The lever fights itself.**

## Why odds cannot work — the funnel

`tools/diagnose.html`, duelist, 3000 seeds, shipped odds, two disjoint batches:

|  | seeds 1–3000 | seeds 5001–8000 |
|---|---|---|
| ever held the banner | 10.8 % | 10.7 % |
| **reached midnight at all** | **4.9 %** | **4.8 %** |
| …of arrivals, had found the banner | 35.8 % | 35.4 % |
| …of arrivals, sealed | 7.4 % | 4.9 % |
| …of arrivals, short of the threshold | 89.2 % | 92.4 % |
| median shortfall | 4 attack | 4 attack |

Two things fall out of this that the earlier report missed.

**The banner is not scarce among the people who matter.** Overall 10.8 % of runs
find it — but among runs that actually *reach midnight* it is 35.8 %. Banner
possession is a marker of a night that went well, not a lottery imposed on it.

**The dominant filter is dying, not drawing.** 95 % of duelist runs never see
midnight. Multiply it out and the shipped 0.35 % is fully explained:
4.9 % reach midnight × 35.8 % hold the banner × ~21 % of those clear the bar.
Even handing a banner to **every** arrival leaves 4.9 % × 21 % ≈ **1 %** — still
under the band, with the lever pinned at its maximum.

## The ceiling probe

To be sure the arithmetic wasn't hiding something, the constraint was removed
outright: banner at 60 %, and two further tiles converted to the relic table —
three relic tiles instead of one, far past anything the issue authorised, purely
to see what the number does.

| | batch A (1–3000) | batch B (5001–8000) |
|---|---|---|
| ever held the banner | 84.2 % | 83.5 % |
| **holding it at midnight** | **94.8 %** | **95.5 %** |
| sealed | 12 | 12 |
| **seal %** | **0.40 %** | **0.40 %** |

The banner in ninety-five hands out of a hundred, and the seal does not move.

The histogram says why — a spike of 97 arrivals at exactly **attack 6**, which is
七星劍 doubled with *nothing in the other hand*. The two tiles converted to relic
were 誦經堂 and 靈堂, and those were the tiles that supplied talismans. The map
has ten search tiles and four tables competing over them: **every tile given to
the relic table is taken from the weapons, medicine or talismans the same seal
needs.** Supply cannot be created by reallocation, only moved.

## What would actually move the number

The seal rate is `midnight arrivals × kit completeness at midnight`, and it is
currently `4.9 % × 7.4 %`. To reach 2 %:

- **hold conversion, raise arrivals** → need ~27 % of runs reaching midnight,
  5½× today. That is a difficulty change, and it moves the burial with it.
- **hold arrivals, raise conversion** → need ~41 % of arrivals kitted, against
  7.4 % today, with a median shortfall of 4 attack to close.

For the second: dropping `KING_THRESHOLD_WITH_TABLET` from 11 to 10 is the
largest cut available — 10 is the floor, because the best banner-less kit is 9
and the invariant *every winning line spends the banner* dies at 9. Reading the
shipped histogram at threshold 10 gives 10.8 % conversion, so about **0.53 %**.
Not close, and it spends the whole margin of a load-bearing invariant.

So the honest answer is that ~2 % is not reachable by tuning. It needs either
the duelist to survive the night materially more often, or the kit to be
assembled from fewer scarce parts — both design changes, and both the user's
call rather than a tuning pass.

**One caveat worth stating plainly.** The target is defined against *this bot*,
which dies 95 % of the time. A duelist that played better would raise the seal
with no data change at all, because the measurement and the thing measured are
the same object. That is an argument for improving the policy — but not while a
number derived from it is being used as an acceptance criterion, because then
the instrument is being tuned to the target.

## A defect found while doing this

`playNight` reported `hadBanner` by reading the pack *after* `midnight()`
resolved — but resolving midnight spends the banner, so the flag read false for
exactly the runs that used one. The funnel printed "4 arrivals holding the
banner" beside "11 seals", which is impossible: 9 is the ceiling without it.

It is captured before the call now, and `run()` no longer needs the
`|| atMidnight >= 10` fallback that had been papering over it. The headline
table above is unaffected — the bug touched only an internal counter — and
reruns byte-identical to the previous report, which is the check that no data
moved underneath this work.

## The shipped relic table, unchanged

```json
"relic": [
  { "id": "sticky-rice", "p": 40 },
  { "id": "soul-banner", "p": 15 },
  { "id": null,          "p": 45 }
]
```

§13's "~7 searches for 攝魂幡" therefore still derives, and the invariant suite
needed no amendment.
