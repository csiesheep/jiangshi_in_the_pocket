# The fourteen, redrawn — design, before any pixels

Phase 1 of #88. **No art exists yet and none will until this is approved.**
Everything below is intent, and the first section is the one that can invalidate
the rest, so it comes first.

---

## 1. The size question, answered with numbers

The brief asks for a realistic Chinese-horror-film register with lighting and
shadow. That register already exists in this game and it works. It works at a
size these icons do not have.

**Measured on the running game, not recalled:**

| Where an item is drawn | Rendered size |
|---|---|
| Pack cell | **37 × 37** |
| Hands / equipment slot | **26 × 26** |
| Found-item row | **18 × 18** |
| Rulebook tables | **≈22 × 22** |

**Measured for the register being asked for** — the four 僵屍 creature sprites,
which are the film language and are agreed to have succeeded:

| | Rendered size |
|---|---|
| Scare art, per figure | **202 – 336** |

That is a factor of six to nine. It is the whole problem, and it is not a matter
of drawing more carefully.

### Why "black swallowing most of it" cannot work at 26px

The scene register is *most of the object in darkness, one edge lit, sockets as
voids*. It reads because the object is large and sits in a lit room that gives
it a ground to be dark against.

An icon has no room for a ground. It sits directly on the panel, which is
near-black. **An object that is mostly black, on near black, at 26px, is an
object that is mostly absent.** No amount of care recovers this; the pixels are
not there to lose.

This is not a prediction — the suite already measures it. The weapon guard
requires any two blades to be at least 25 apart in mean per-pixel colour
distance *composited on the panel*, and at least 12% apart in silhouette, at
18px and 26px. Two mostly-black icons on a near-black panel are close to zero
apart on the first number. **A faithful film-language icon would fail a test
that has been green since #54** — and the standing instruction is to fix the
art, not the test.

It has also been tried. #60 redrew this set toward the painted register, and the
recorded verdict was that it came out as a clean icon set with soft shading
rather than the film language. That was not a failure of execution. It is what
that register becomes when you shrink it.

### What I propose instead

**One light, real material, modelled shadow — but the object stays lit.**

Not darkness with a lit edge. Instead: a *lit object with darkness eating one
side of it*. Same lamp, same world, inverted mass. This is genuinely different
from what ships today — the current set is flat shapes in a single gold — and it
survives 26px, because the thing being read is bright and the shadow is the
accent rather than the substance.

Every one of the fourteen gets:

- **One light direction, shared by all fourteen: warm lantern from the upper
  left.** The indoor tiles are lit by one oil lamp off to the left, and these
  objects are held in those rooms. A single consistent lamp is most of what will
  make them look like one world instead of fourteen drawings.
- **A material, stated as a value relationship rather than a texture.** Steel,
  wood, paper, cord, cloth, glaze, lacquer and ground mineral each relate their
  lit face to their shadow differently. That relationship survives 26px; grain
  and scratches do not.
- **A cast shadow** — short, down and to the right — grounding the object rather
  than floating it.
- **A silhouette that identifies the object with all colour removed.** This is
  the acceptance test, and it is already in the suite.

### The one number I would like ruled

**Raise the pack icon from 37px to 48px.**

It costs nothing. The pack cell's face is already **62 × 62** and holds a 37px
icon with twelve pixels of air on every side. 48px fits inside the existing face
with room to spare — no cell change, no grid change, no sidebar change, four
across as now.

At 48px the modelling has somewhere to live, and the pack becomes the place the
art is actually seen. The 26px hands and the 18px found-row keep the same
symbol, where the interior modelling simply falls away and the silhouette
carries it. **One symbol per item, designed at 18 and enriched for 48** — not
two sets.

If instead the true scene register is wanted — most of the object in darkness —
the smallest size where that reads is around **64px**, and that is a layout
change rather than a swap: four 64px cells need roughly **340px** of grid where
there is **270**, so the sidebar goes from 300 to about 370, or the pack shows
three across and stops showing that you can carry four. **That is the user's
call, not mine to absorb quietly.** My recommendation is 48px and the lit
register.

---

## 2. Four families, so they read as families

Nothing below is a lone drawing. The set has four groups, and the grouping
should be visible before any individual item is:

- **The blades** — four objects that happen to share a job. Different materials,
  lengths and ages. The only family whose members must be told apart
  *instantly*, because the replace prompt is a permanent decision made on
  recognition.
- **The papers** — one paper with different ink. 真火符, 五雷符 and 血符 are the
  same yellow sheet; what differs is what is written on it and in what. 硃砂 is
  not a paper — it is what the ink is *made of*, and should look like the source
  of the other three.
- **The goods** — things you consume. Domestic, humble, containers.
- **The two that are not equipment** — 護身符 is worn; 神主牌 is the reason you
  are in the building.

---

## 3. The fourteen

Each piece: **what it is** (material, age, what has happened to it) · **how the
light finds it** · **the silhouette with colour removed**.

### The blades

**戒刀 Precept Knife** — a monk's short single-edged knife, plain iron, older
than anyone who has held it, the edge honed back so far that the blade is
narrower than it was made. A cloth-wrapped grip, sweat-darkened. · The lamp runs
a thin hard line down the spine and one broad soft plane on the flat; the wrap
takes no highlight at all and reads as a dark stop. · A short straight bar with
one blunt-angled tip, thickest at the base — the only blade with no crossguard
and no ornament.

**桃木劍 Peachwood Sword** — carved from a single peach branch rather than
turned: you can see it was one piece of wood. Pale sapwood gone amber with
handling, darker heart showing where the cut went deep. Blunt by nature; it was
never meant to cut. · Wood scatters light rather than reflecting it, so there is
no specular line at all — a broad warm lit face and a soft shadow side, which is
what separates it from every metal object here. · A long straight blade with a
plain squared crossguard, wider and flatter than the knife, tapering evenly.

**銅錢劍 Coin Sword** — old cash coins lashed to an iron spine with red cord, in
two overlapping rows. The coins are unequal: different reigns, different wear,
some worn smooth. The cord is faded to rust and frayed where it wraps the grip.
· This is the one that glints — many small round highlights, each coin catching
the lamp at a slightly different angle, against a body that is otherwise dark.
Its light is *broken*, and no other item's is. · A blade-shaped mass with a
scalloped, bumpy outline and a visible square-hole pattern — unmistakable in
pure black.

**七星劍 Seven-Star Sword** — the good one, and it should look like it. Forged
steel, straight, with the seven stars of the Dipper inlaid in brass along the
fuller. Well kept, and the only blade with no damage. · A clean specular line
the full length of the blade, the seven inlays picking up the lamp as small warm
points in a row, and a cold bright edge. It is the brightest object in the set.
· The longest blade, with a distinct pommel and a wider guard — it reads as
*sword* where the knife reads as *tool*.

### The papers

All three share a sheet of coarse yellow 黃紙, torn along the top edge, with one
soft vertical fold from being carried and a slight curl. The lamp catches the
curl. Their difference is the ink.

**真火符 True Fire Talisman** — vermilion script, and the lower edge is
*scorched*: browned, one corner burnt away, a fine ash line. It has already been
near fire. · The burn is the darkest thing on the paper, and the scorch gradient
is the modelling. · A rectangle with one corner missing.

**五雷符 Five Thunder Talisman** — the same sheet, unburnt, the script heavier
and more angular: a dense column of vermilion strokes, the most ink of the
three. · Flat paper, the fold-curl its only relief; the ink mass reads as a dark
vertical bar at small sizes, which is its identifier. · A clean rectangle with a
strong central stripe.

**血符 Blood Talisman** — written in blood rather than cinnabar: browner,
thinner, uneven, with one run where a stroke was overloaded. The paper around
the strokes is stained where it soaked in. · Blood on paper is matte and
*sinks* — no highlight on the ink at all, which is exactly what separates it
from the other two at any size. · A rectangle with a ragged, blotted mark: the
least regular of the three.

**硃砂 Cinnabar** — not a paper. A small heavy stone dish of ground vermilion,
the powder mounded and dimpled where a brush has been dragged through it, a
smear on the rim. The dish is dull grey stone; the powder is the most saturated
red in the game. · The powder takes light like flour — no specular, a bright top
face, a sharp shadow in the dimple. The dish is dark and grounds it. · A low
wide oval with a mound: squat, and the only wide-format object among the papers.

**Red stays where it is allowed.** Cinnabar and talisman script are the two
places red already lives, and nothing else in the set will use it.

### The goods

**糯米 Sticky Rice** — a coarse hemp pouch drawn shut with a cord, worn soft and
grubby at the base from being set down, slightly slumped because it is half
full. · Cloth is the softest material in the set: a broad gentle gradient over
the belly, a deep fold shadow under the drawstring, no hard edges anywhere. · A
rounded bag pinched at the neck — the softest silhouette of the fourteen.

**黑狗血 Black Dog Blood** — a small stoppered ceramic bottle, black glaze gone
uneven in the firing, a wooden plug bound with cord, the glaze chipped at the
shoulder showing pale clay beneath. · The one object with a *hard specular*: a
tight bright highlight on the glazed shoulder and a second, weaker one lower.
That double glint is what says glazed rather than matte at 18px. · A narrow neck
over a round body — a bottle, unmistakably.

**金丹 Golden Elixir** — a single pill in a shallow open box. The pill's surface
is faintly cracked and not quite spherical, because it was rolled by hand. Old
lacquer box, worn through at the corners. · The pill is the only *sphere* in the
set and gets the full spherical treatment: bright top-left, a terminator, dark
lower right, and a faint bounce coming back off the box floor. That bounce is
what will make it read as three-dimensional at small size. · A circle sitting in
a shallow rectangle.

### The two that are not equipment

**護身符 Protective Charm** — a small folded paper charm in a stitched cloth
sleeve, hung on a cord and worn against the body. The cloth is faded where it
has rubbed on skin; the stitching is uneven. It is the only object here with a
*cord*, and the cord should be part of the silhouette. · Cloth again, but small
and taut rather than slumped: a tight highlight along the top fold, and shadow
where it hangs away. · A small pouch with a loop above it. The loop is the
identifier and must survive at 18px.

**神主牌 Ancestral Tablet** — the object of the night, and it should look
heavier than everything else. Dark lacquered wood on a separate carved base, the
lacquer crazed with fine age cracks, the incised characters filled with cinnabar
that has dulled and flaked. It has been handled, and it has been left alone a
long time. · **This is the one piece that gets closest to the scene register**,
because it is the one object that should read as coming out of the dark: a
bright hard edge down the left where the lamp strikes the lacquer, the face
falling away to near-black, the incised characters catching only faintly, and
the base in full shadow. It is the only item allowed to be mostly dark, because
its silhouette is distinct enough to survive it. · An upright slab on a wider
foot — a shape nothing else in the set comes near.

---

## 4. What I need ruled

1. **The register.** Lit object with shadow eating one side — my recommendation
   — or the true scene register, which needs the size change below.
2. **48px in the pack.** Costs nothing: the cell face is already 62 × 62.
   Without it the modelling has nowhere to live and this becomes #60 again.
3. Only if the true scene register is wanted anyway: **the sidebar goes from 300
   to about 370px, or the pack shows three cells instead of four.** Both are
   layout changes, and both are the user's to rule.

Nothing else is blocked. Phase 2 constraints are unchanged and already recorded:
ids unchanged, the 18/26/37 floors stay green, red reserved, pure SVG, nothing
that strobes, and a contact sheet looked at before any measurement is believed.
