# Is 鎮屍 still reachable at a four-slot pack? (#47)

> **Written before #47 landed, and left as written.** The reachability answer
> held — the pack is not what stops a seal. The tripwires quoted below reason
> against a "< 2 %" target that has since been superseded; neither fired.

Answered before any code, as asked. **Yes — reachable, and without a discard
order anyone would have to be clever to find.** The reasoning, from the rules as
they actually stand after the hands (#31), option A (#43) and the sword (#46).

## Where each piece of the recipe lives

Six things are needed. Only two of them are ever in the pack at once.

| piece | where it lives | pack slots at midnight |
|---|---|---|
| 七星劍 | right hand (`hands.weapon`) — `isEquipment` | **0** |
| 真火符 burned into it | `state.buffed[sword]`; the talisman was consumed | **0** |
| 攝魂幡 | pack — `cat: "relic"`, so not equipment | **1** |
| 血符 | pack — `cat: "magic"`, one slot per id | **1** |
| 神主牌 | `state.tablet`, explicitly slotless | **0** |
| 護身符 (optional) | left hand — `isEquipment` | **0** |

**The standing requirement is two slots**, not six. The hands took the sword and
the charm out of the pack, the buff is state rather than an item, and the tablet
was never counted.

## The tightest moment is three slots, not two

The transient peak is the instant before the sword is buffed, when a player may
hold 攝魂幡 + 血符 + 真火符 — three ids, three slots, because magic stacks only
by id. Buffing consumes the 真火符 and returns the third slot.

Three of four leaves one for rice. Four of four is reachable and fine: a full
pack that finds something returns `OFFER_DROP`, the player picks, and rice is
always droppable. The engine never chooses, so there is no order in which the
game silently discards the thing you needed.

## So what does the cut actually cost?

Rice. At six slots the winning kit left four slots for rice; at four it leaves
two, and briefly one while the buff is pending. Rice is health, so this is a
survival cut wearing an inventory change — the same shape as #31 in reverse, and
the same shape as #46.

That means the seal will fall again, but through the arrivals term rather than
the conversion term: fewer runs reach the door, not fewer succeed once there.

## What I will watch for, and stop on

- **Seal collapsing rather than falling.** It is already 1.0–1.3 % after #46,
  below the 1.7 % option A was tuned to. If four slots pushes it under ~0.5 %,
  the ending is drifting from "hidden" toward "vanishing", and that is worth the
  user's attention before it is worth mine.
- **活水 taking another disproportionate hit.** The turtle lost a quarter of its
  survivals to #46 alone. It is the ending with the least margin.

Neither is a reason not to land the ruling. Both are reasons to report the cost
plainly, which is what the user asked for when they ruled with the numbers in
hand.

## One thing the ruling does invalidate

§13's "starting rice plus a full duel kit is exactly 6 of 6" already died with
the hands and was re-derived as "the duel kit costs two pack slots". That row
stays true at four slots — two is still two — but its companion assertion, that
one slot remains spare, becomes *three* spare of four rather than one of six.
The test reads `freeSlots` rather than a literal, so it will fail with the real
number rather than a stale one, and I will re-derive it there.
