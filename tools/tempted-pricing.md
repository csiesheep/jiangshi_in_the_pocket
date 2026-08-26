# Pricing the discipline a bot has and a person does not (#70 follow-up)

**A negative result, and it corrects something I wrote three commits ago.**

When #70 closed, I claimed in `tools/bots-report.md` that the seal line was
"binary and total — what you score if you make ONE decision correctly, and zero
if you do not", the decision being whether you keep 真火符 for the blade instead
of throwing it in a fight. **That was wrong, and this is the measurement that
shows it.** The claim has been corrected in the report.

## The question

The bots keep the last 真火符 because `spendableTalismans()` protects it until
the blade has it burned in. A person has to make that call every time a fight
looks bad — and the author of the report failed it, throwing his own one turn
before finding 七星劍 (`tools/one-night-4242.md`).

Since without the buff **no kit a player can carry reaches the bar at all**
(ceiling 11, bar 12 even carrying the 神主牌), the discipline looked like it
should be worth everything.

## The instrument

`tempted` in `tools/bots.js` — LAB ONLY, opt-in by name, never in the shipped
tables. It is the adept with that one discipline removed, parameterised by
`opts.temptedAt`: the predicted fight damage at which the player reaches for the
paper. Low means spends it readily; `Infinity` is the adept.

**A threshold rather than a coin**, so a seed still replays the same night — and
because it models the decision ("how bad does it have to get") rather than
random forgetfulness.

`temptedAt: Infinity` reproduces the adept exactly, 113 and 128, which is the
control: the mechanism is the only difference between the rows below.

## The measurement — 1000 seeds, both batches

Measured twice: once before #71 and once after, because #71 changed what
`resolveCombat` and `midnight` credit you for. **Every figure below reproduces
exactly on both**, as do all ten shipped rows in `bots-report.md` — which is the
checkable form of FE's claim that no legitimate call ever passed an unheld item.
A bot reaching for something it did not hold would have shown up here as a moved
number, and none moved.

| `temptedAt` | seal A | seal B | 真火符 actually thrown (A) |
|---|---|---|---|
| 2 — spends it readily | 114 | 121 | 700 |
| 3 | 113 | 123 | — |
| 4 | 116 | 125 | 441 |
| 5 | 113 | 128 | — |
| 6 | 113 | 128 | — |
| 7 | 113 | 128 | — |
| ∞ — the adept | **113** | **128** | **321** |

## What it says

**The discipline is worth approximately nothing.** Spending the paper as freely
as the model allows moves batch A by +1 and batch B by −7, on a base of 113 and
128. That is inside the spread between the two batches themselves.

**And the adept was never disciplined in the first place.** It throws 真火符
**321 times across 1000 nights** already, because `spendableTalismans()` frees
it the moment the blade is buffed — "already burned in, so free". The lab policy
does not introduce the behaviour, it roughly doubles it, to 700. The seal rate
does not notice.

**So the buff is essential but no particular sheet of paper is.** Both are true
at once and that is the whole resolution:

- neuter `buffSword` entirely and the adept's seals go **91 to 0** — the buff is
  the difference between a reachable ending and an unreachable one
- throw the paper twice as often and the rate does not move — because the night
  is long, 符咒 tables produce more of it, and the blade only needs the fire once

The failure mode I described from my own night — throw it, then find 七星劍 one
turn later — is real and it is *recoverable*. It cost me that run. It does not
cost a run in general.

## What this does to the seal figures

**It removes the caveat I attached to them.** I said the shipped seal rates were
an upper bound on a person playing the same way, on the grounds that a person
would fumble this decision. On this axis they are not an upper bound: the
decision does not matter enough to separate a careful player from a careless
one, and the bots are not modelling a discipline a person lacks.

That does not make the bots a model of a person in general — they still read the
map's roles perfectly, never mis-click, and never get bored. It means **this
particular gap, the one that looked most likely to matter, is not where the
difference lives.** Anyone hunting the player/bot divergence should look
somewhere other than 真火符.

## Method note

The first version of this measurement counted how often the temptation was
*offered* rather than *taken* — 745 firings, seal unchanged — which would have
supported the same conclusion for the wrong reason. 真火符 has attack 1 and
sorts last among talismans, so adding it to the list rarely changes what gets
thrown. Counting actual throws is what turned a flat line into evidence, and it
is also what revealed the 321 the adept was already making.

A lever that moves nothing is exactly the case where you have to prove the lever
is connected.
