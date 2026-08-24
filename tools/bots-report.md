# Bot report — 1000 seeds per policy

Produced by `tools/bots.html` (open it on a static server; `?seeds=N` to change
the count). Deterministic: the same seed replays the same night, and a rerun of
the same batch gives the same table. Regenerate after any change to the tables,
the engine, or the map.

Run against `cc4a6c2`.

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
1000 hunter nights: about eighty to one. The cause is visible in the same
table — **the banner is only ever held in ~10 % of runs.** 攝魂幡 sits in the
relic table, the relic table is rolled by exactly one tile (土地廟), and every
winning seal line spends the banner. That single bottleneck caps the seal
before survival is even considered.

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

## The question these numbers were built to answer

The fuzz's 95 % death rate on a floor policy is not the whole story: a policy
that actually chases the burial wins a third of its nights. So the night is
harsh but not unfair — **for the burial line.**

The seal line is the one worth a decision. As shipped it is a 0.4 % ending
gated behind a 10 % item, and the design intends it as a hidden ending rather
than a common one. Whether 0.4 % is "hidden" or "unreachable" is a design call,
not a measurement, and the lever is obvious: the relic table is rolled by one
tile in twenty.
