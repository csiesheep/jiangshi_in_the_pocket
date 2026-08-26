# The fourteen, redrawn — design, before any pixels

Phase 1 of #88, revised after the user's rulings. **No art exists yet and none
will until this is approved.**

## What was ruled

1. **The true cinematic register** — most of the object in darkness, one edge
   lit. Not the lit-object compromise this document first proposed.
2. **The pack shows three cells**, sidebar stays at 300px.
3. **神主牌 is mostly dark**, hard light down the left, base in shadow.

Ruling 1 stands unchanged below and the whole set is designed to it. Ruling 3 is
answered in §4. **Ruling 2 was made on a number I got wrong, and §2 is the
correction** — it is first because it is the one that should change a decision.

---

## 2. Three cells does not buy 64px. It buys 51px.

I priced the three-cell option as the way to reach 64px icons. That was wrong,
and the error was mine: I described the pack cell as "62 × 62 holding a 37px
icon with 12px of air" and treated the air as a fixed property of the cell. It
is not. It is a percentage, and it is the actual lever.

    css/style.css:886   .cellicon { width: 62%; height: 62%; }

The icon is 62% of its cell face. Everything else follows from the grid:

- sidebar column **300px**, `.panel` border 1px + padding 14px each side, and
  `box-sizing: border-box` globally → grid content width **270px**
- `gap: 8px`, `n` columns → cell = (270 − 8(n−1)) / n, face = cell − 2

| cells | cell | face | icon @ 62% | icon @ 90% |
|---|---|---|---|---|
| **4 — today** | 61.5 | 59.5 | **36.9** | 53.6 |
| **3 — as ruled** | 84.7 | 82.7 | **51.3** | 74.4 |
| 2 — the old 田 | **131.0** | 129.0 | 80.0 | — |

The formula is not a model: at two columns it returns **131.0px**, and the
comment left in the stylesheet when that layout was removed says the 2×2 cells
"came out 131px". It reproduces a measured number from the repo exactly.

So the three-cell ruling delivers **51px**, not the 64px it was offered as
buying. And the comparison that was never put in front of the user:

> **Four cells at 90% fill is 53.6px — larger than three cells at today's fill
> (51.3px).** Four cells at 85% is 50.6px, which is the three-cell size to
> within a pixel.

Keeping four cells and spending the padding is *more* icon than the ruling
bought, with no capacity question, no conflict with #61, and no guard touched.
The only thing it spends is the air inside the cell, which is what makes the
cell read as a frame — a real cost, but one contained inside the cell.

Reaching a true **64px needs three cells at 77% fill**. That is the only route
to 64, and it still owes the answer in §3.

**One number in this document is not measured**: that the true register needs
~64px. That was my judgement, not an observation, and it is the premise the
expensive path rests on. §5 proposes settling it with one drawing before the
other thirteen are committed.

---

## 3. Four items, three cells

The count is not a layout constant. It is derived, deliberately, and guarded:

    js/render.js:581    el.style.setProperty("--pack-cells", String(RULES.MAX_ITEMS));
    js/engine.js:51     MAX_ITEMS: 4, // the tablet is exempt

and `tests/stage.test.js:615`, *"the grid takes its cell count from the engine,
not from a number here"*, which fails if any digit 0–9 is hard-coded into the
loop. The comment above the renderer names this exact failure: **a grid that
disagrees with the engine about how much you can carry is a worse bug than an
ugly grid.** Three cells over a four-item pack is that disagreement, and the
guard exists to stop it. So there are only three real answers:

**(i) `MAX_ITEMS` becomes 3.** The grid follows on its own, guard stays green,
one row, no #61 conflict. **But this is a balance change, not a layout change**,
and `tools/pack-4-reachability.md` already priced it: the winning kit's
transient peak is 攝魂幡 + 血符 + 真火符 = **three slots**, before the buff
consumes the talisman. A three-slot pack still fits the seal exactly — with zero
room for rice at that moment, and rice is health. That document's own tripwire
is the seal falling under ~0.5%, at which point "the ending is drifting from
hidden toward vanishing"; it was 1.0–1.3% when written. Cutting to three slots
pushes the same lever again.

**(ii) A second row, 3 + 1.** Conflicts with #61, where this user explicitly
ruled the pack into a 1×4 strip and away from the 2×2 田.

**(iii) Three cells, capacity four.** The fourth item exists with no cell. This
is the case the guard was written against, and I will not implement it.

**My recommendation is none of the three: keep four cells and raise the fill.**
It yields more icon than the ruling asked for, and §2 is why. If the user wants
64px specifically, the honest price is (i) — three cells at 77% fill *and* a
pack that holds three — and that is a ruling about the seal, not about layout,
so it should be taken with `pack-4-reachability.md` in hand.

---

## 4. What is left of the tablet exception

Nothing, as written — the coordinator is right. "The only item allowed to be
mostly dark" said something when the other thirteen were lit. Under the true
register it is the house style and the sentence is empty.

**So the exception goes further rather than retiring: 神主牌 is the only object
not lit by your lantern.**

The stylesheet already names two lights, and names them exactly this way:

    css/style.css:2752   --film-tungsten: #c98a4b;   /* the lantern: the living's light */
    css/style.css:2753   --film-moon:     #9fb2ab;   /* corpse-green white: the other light */

Thirteen objects are lit by the tungsten — they are held, carried, and yours.
The tablet is lit by the moon. It is not in your hands, it is on an altar in a
room your lamp does not reach, and it is the reason you are in the building. A
cold light on it is the difference stated in the vocabulary the film language
already has, rather than asserted in a caption.

Two consequences that make this more than a colour swap. The incised characters
are cinnabar-filled, and cinnabar under corpse-green goes brown and dead — which
is the dulled, flaked reading the object wants anyway. And the tablet is the
only item that casts **no** shadow toward you, because the light is behind and
above it rather than over your shoulder.

If the user would rather have consistency, the fallback is that the tablet is
lit like the rest and the exception simply retires. But stated is stated: my
call is the second light.

---

## 5. The blade guard, with numbers

This is the guard most likely to go red, and the standing rule is fix the art,
not the test. Here is what it actually measures (`tests/stage.test.js:713–749`):

- **`sil` ≥ 12** — fraction of pixels whose **alpha** differs, at 18/26/37px
- **`col` ≥ 25** — mean per-pixel Euclidean RGB distance, composited on
  `#1b1e24` (`--panel`, not `--bg-2`; my first draft named the wrong ground)
- **`inkPct`** between 4 and 70 at 18px, also on **alpha**

**Two of the three are immune to this change.** `sil` and `inkPct` read alpha
only, so darkening an icon does not move them at all. The current 14.2%
silhouette margin survives the register change untouched. Only `col` is at risk.

**A model, checked against the repo's own recorded numbers.** Today all four
blades are effectively one colour (`--gold #c9a24b`), so two icons differ only
where one has ink and the other does not, and

    col ≈ sil% × distance(gold, panel) = 14.2% × 221.9 = 31.5

against a recorded minimum of **28.4** — the model over-predicts by 11%, which
is antialiasing at the alpha > 96 threshold. Close enough to reason with, and it
exposes something worth saying plainly: **today the colour floor is not an
independent axis. It is the silhouette floor times 222.** `sil 14.2` and
`col 28.4` are the same fact stated twice, which is why the margin above 25 is
only 3.4 on a set of bright icons.

**Under a dark register the two axes separate for the first time.** The body sits
near the panel and contributes almost nothing; all distance lives in the lit
passage. For a pair of blades, with tungsten at distance 208.5 from the panel:

    col ≈ 2 × (lit area unique to each blade) × 208.5

so `col ≥ 25` requires **each blade's uniquely-lit area ≥ 6.0% of its icon box**
— 19px at 18px, 41px at 26px, 82px at 37px.

That yields the one design constraint that decides whether this works:

> **A hairline highlight fails. A lit plane passes.** A 1px edge highlight down
> an 18px icon is 5.6% of the box; two disjoint ones give col ≈ 23 and go red. A
> lit plane of 2 × 14px is 8.6% each; two disjoint give col ≈ 36 and pass
> comfortably.

So each blade carries a **lit mass**, not a lit line, and the four masses sit in
four different places. Placement, not hue, is what separates dark objects — and
a dark set with divergent lit geometry can clear this floor by a wider margin
than the current gold set does, because the current set has no signal except its
outline.

One rule that follows directly and would otherwise be found the hard way:
**darkness must be painted, not omitted.** A transparent "dark" region reads to
`sil` and `inkPct` as absent rather than dark, and could drop a mostly-dark icon
through the `inkPct > 4` floor. Every dark passage is a painted near-black.

**Before the other thirteen**: draw 七星劍 and 桃木劍 first — the brightest and
the most diffuse, the pair with the least natural separation — and run the
existing guard on those two alone. If they clear 25, the register is proven at
the size it ships at, and that also settles the unmeasured 64px premise from §2.
If they cannot, that is the report with numbers and the user rules again.

---

## 6. Four families

- **The blades** — four objects sharing a job, which must be told apart
  *instantly*, because the replace prompt is permanent (#36). Under this
  register they are told apart by **where the light sits**.
- **The papers** — one sheet with different ink. 真火符, 五雷符 and 血符 are the
  same paper; 硃砂 is what the ink is ground from and should look like its
  source.
- **The goods** — things you consume. Domestic, humble, containers.
- **The two that are not equipment** — 護身符 is worn; 神主牌 is the reason you
  are in the building.

---

## 7. The fourteen

Now written to the true register. Each piece: **what it is** · **what is lit**,
which is both the lighting and the separability mechanism · **the silhouette**.
All thirteen take `--film-tungsten` from the upper left. The tablet does not.

### The blades — four different lit geometries, by construction

**戒刀 Precept Knife** — a monk's short single-edged knife, plain iron, older
than anyone who has held it, the edge honed back until the blade is narrower
than it was made. Cloth-wrapped grip, sweat-darkened. · **Lit along the spine**:
a band across the top edge, the whole flat below it in darkness, the wrap taking
nothing at all. Its lit mass is a *horizontal band at the top*. · A short
straight bar with one blunt-angled tip, thickest at the base — the only blade
with no crossguard.

**桃木劍 Peachwood Sword** — carved from a single peach branch rather than
turned; you can see it was one piece of wood. Pale sapwood gone amber with
handling, darker heart where the cut went deep. Blunt by nature. · **Lit as a
broad soft plane on the lower-left flat** — the widest and only diffuse lit mass
in the set, with no hard boundary anywhere, because wood scatters. It is the one
blade with no specular at all. · A long straight blade with a plain squared
crossguard, wider and flatter than the knife.

**銅錢劍 Coin Sword** — old cash coins lashed to an iron spine with red cord, in
two overlapping rows, unequal: different reigns, different wear. The cord faded
to rust and frayed at the grip. · **Lit as a scatter** — many small disjoint
points down the length, each coin catching the lamp at its own angle, everything
between them dark. Its lit mass is *discontinuous*, which no other blade's is,
and that alone separates it from all three at any size. · A blade-shaped mass
with a scalloped outline and visible square holes.

**七星劍 Seven-Star Sword** — the good one, and it should look like it. Forged
steel, straight, the seven stars of the Dipper inlaid in brass along the fuller.
Well kept; the only blade with no damage. · **Lit along the leading edge** — a
hard cold line at the bottom, plus seven discrete points in a row above it. The
only blade lit *cold* rather than warm, and the brightest object in the set. Its
lit mass is a *bottom edge*, opposite the knife's. · The longest blade, distinct
pommel, wider guard — it reads as *sword* where the knife reads as *tool*.

Pairwise, the four lit masses are top band / broad lower-left plane / scatter /
bottom edge. Overlap is low by construction, which is what §5 requires.

### The papers

All three: a sheet of coarse yellow 黃紙, torn top edge, one soft vertical fold
from being carried, slightly curled. In this register the sheet is dark except
where the fold turns toward the lamp — **the lit passage is the curl**, a bright
vertical band down one side of an otherwise dim page.

**真火符 True Fire Talisman** — vermilion script, and the lower edge *scorched*:
browned, one corner burnt away, a fine ash line. It has already been near fire.
· The scorch is darker than the paper's own shadow, so it reads as a hole rather
than a shade. · A rectangle with one corner missing.

**五雷符 Five Thunder Talisman** — the same sheet, unburnt, script heavier and
more angular: a dense column of vermilion, the most ink of the three. · The ink
column falls in the shadowed half, so it reads as a dark bar beside the lit
curl. · A clean rectangle with a strong central stripe.

**血符 Blood Talisman** — written in blood rather than cinnabar: browner,
thinner, uneven, with one run where a stroke was overloaded, the paper stained
where it soaked in. · Blood is matte and *sinks* — it takes no light even where
it crosses the lit curl, which is exactly what separates it from the other two.
· A rectangle with a ragged, blotted mark; the least regular of the three.

**硃砂 Cinnabar** — not a paper. A small heavy stone dish of ground vermilion,
the powder mounded and dimpled where a brush was dragged through it, a smear on
the rim. · The dish is entirely in darkness; **only the top of the powder mound
is lit**, so the icon is a single bright crescent floating on black. The most
saturated red in the game sits in that crescent. · A low wide oval with a mound
— squat, and the only wide-format object among the papers.

**Red stays where it already lives** — cinnabar and talisman script. Nothing else
in the set uses it.

### The goods

**糯米 Sticky Rice** — a coarse hemp pouch drawn shut with a cord, worn soft and
grubby at the base, slightly slumped because it is half full. · **Lit across the
top of the belly** in a broad gentle gradient that falls away to nothing before
it reaches the base — the softest lit boundary in the set, and the only one with
no edge at all. · A rounded bag pinched at the neck.

**黑狗血 Black Dog Blood** — a small stoppered ceramic bottle, black glaze gone
uneven in the firing, wooden plug bound with cord, the glaze chipped at the
shoulder showing pale clay. · The one **hard specular**: a tight bright point on
the glazed shoulder and a weaker second below. On a black-glazed bottle in
darkness the two points are almost the entire icon, which is what says glazed
rather than matte at 18px. · A narrow neck over a round body.

**金丹 Golden Elixir** — a single pill in a shallow open lacquer box, the pill
faintly cracked and not quite spherical because it was rolled by hand, the box
worn through at the corners. · The only **sphere**: bright top-left, a hard
terminator, and a faint bounce off the box floor lifting the underside. That
bounce is what makes it read as round rather than as a disc at small size. · A
circle in a shallow rectangle.

### The two that are not equipment

**護身符 Protective Charm** — a small folded paper charm in a stitched cloth
sleeve, hung on a cord, worn against the body; the cloth faded where it rubbed
on skin, the stitching uneven. · **Lit along the top fold only**, the body
hanging away into shadow. The cord is dark throughout but must stay in the
silhouette. · A small pouch with a loop above it — the loop is the identifier
and must survive 18px.

**神主牌 Ancestral Tablet** — the object of the night, and heavier than anything
else here. Dark lacquered wood on a separate carved base, the lacquer crazed
with fine age cracks, incised characters filled with cinnabar gone dull and
flaked. Handled once, then left alone a long time. · **Lit by `--film-moon`, not
by your lantern** — a hard cold edge down the left where the light strikes the
lacquer, the face falling to near-black, the characters catching only faintly
and reading brown rather than red under that light, the base in full shadow. It
casts no shadow toward you, because the light is behind it. · An upright slab on
a wider foot — a shape nothing else in the set comes near.

---

## 8. What I need ruled

1. **§2 first — the pack.** Three cells buys 51px, not the 64px it was sold as.
   Four cells at 90% fill buys 53.6px and keeps everything. My recommendation is
   to keep four cells and raise the fill; if 64px is wanted specifically, it
   costs `MAX_ITEMS` = 3, which is a ruling about the seal and belongs with
   `tools/pack-4-reachability.md`.
2. **§4 — the tablet.** Lit by the moon instead of your lantern, which is my
   call, or the exception retires and it is one of fourteen dark objects.
3. Nothing else. Register and darkness are ruled and I am designing to them.

Phase 2 opens by drawing **two** blades and running the existing guard on them,
before the other twelve exist — §5 says why those two. Constraints unchanged:
ids stay, the 18/26/37 floors stay green, red reserved, pure SVG, nothing that
strobes, darkness painted rather than omitted, and a contact sheet looked at
before any measurement is believed.
