# What the icon separability numbers actually measure (#88, #89)

A measurement note, not a proposal. The guard is
`tests/stage.test.js` — its thresholds live there and are deliberately not
repeated here, because two copies of a number is how one of them goes stale.
This records what the numbers mean and what they were, so the next person
reading a `col` figure knows what they are holding.

`tools/icon-bench.html` reports the same figures on demand and mirrors the
guard's rasteriser exactly.

---

## The relationship that explains most of it

`col` is a mean over **the whole icon box**, empty panel included. Where both
icons are fully transparent, both composite onto the same `#1b1e24` panel and
the per-pixel distance is zero. So, approximately:

    colBOX  ≈  colINK  ×  (union of inked pixels / box area)  ×  fringe

**This was first written here as an exact identity and that was wrong.**
ochstractor falsified it in one run: across all 74 pairs at both sizes, the
implied ratio `colBOX / colINK` is *always* above the measured ink union —
systematically, by 0.008 to 0.044, up to 18% relative on the coverage factor.
Zero pairs matched.

The cause is in the rasteriser, and reading `pair()` confirms it. The ink mask
is a **threshold**, `alpha > 96`, but `onPanel` composites the *real* alpha. An
anti-aliased edge pixel at alpha 50 is outside the mask and still composites to
something other than bare panel, so it carries distance while being counted as
uninked. **"Inked" and "contributes distance" are different sets**, and the
algebra only holds for alpha exactly 0. Taking the union over *any* non-zero
coverage overshoots the other way (implied 0.294 against 0.386), so the true
factor sits between the two definitions — which is what partial coverage
contributing partially predicts. The fringe term grows with perimeter per unit
area.

None of that disturbs what the relationship is for. **A pair's whole-box colour
score is its true colour distance scaled down by how much of the box the two
drawings cover between them.** Two icons can be enormously far apart where they
actually ink and still score mid-table, purely because they leave most of the
box bare. That holds whether the factor is exact or approximate, and everything
below rests on it rather than on the arithmetic being tight.

---

## The numbers

Family minima, `colBOX` then `colINK`. The 26px row was measured by ochstractor
on an independent mirror of the rasteriser; the 18px row here, on the bench.

| family | 26px colBOX | 26px colINK | 18px colBOX | 18px colINK |
|---|---|---|---|---|
| weapons (guarded) | 26.6 | 76.1 | 26.3 | 75.4 |
| goods | 19.4 | 69.6 | 19.3 | 61.1 |
| papers | 17.6 | 66.8 | 17.4 | — |

As a fraction of the weapons control, the goods sit at **0.73 under colBOX and
0.91 under colINK**. The gap is real on both, and roughly a third the size the
guard's own column reports.

IMPLIED coverage ratios — `colBOX / colINK`, not measured coverage: weapons
0.35, goods 0.28, papers 0.26. They run a few percent above the real ink unions
for the fringe reason above, so do not read them as "this fraction of the box is
inked" and do not be surprised when measuring coverage directly gives a smaller
number. They are useful as a ratio between families, not as an absolute.

### A minimum is a fragile statistic — look at the distribution

Reporting the family MINIMUM made a compressed family look like an improvement.
The minimum moved because exactly one bad old pair got fixed. The same five ids,
both sheets, all ten pairs, 18px:

| five goods, 18px | before #88 | after |
|---|---|---|
| whole-box range | 25.4 – 50.9 | 19.3 – 31.7 |
| inked range | 68.7 – **162.4** | 61.1 – **87.5** |
| pairs under 26 whole-box | 2 of 10 | 6 of 10 |
| pairs over 100 inked | 3 | 0 |
| median whole-box | 27.4 / 31.2 | 23.2 / 25.6 |

**The whole distribution moved down and compressed**, on both rulers. The old
family had one terrible pair and nine comfortable ones; the new family has no
terrible pair and six mediocre ones. The old set's best pair was 162 inked; the
new set's best is 87.5.

So the honest statement is neither "a regression" nor "no trade". It is: **the
register cost the goods a lot of colour separation, and did not leave any pair
worse than the worst pair it replaced.** Both halves are true and only the pair
of them is the fact.

Counts near a boundary are the one thing not to over-read here: ochstractor's
independent mirror put "under 26" at 0 and 5 where this bench puts it at 2 and 6,
which is rasterisation drift of a few tenths moving pairs across the line. The
ranges and the direction are identical on both instruments; the counts are not
to a single pair.

### The register's price, against the pre-#88 sheet

Measured with the bench's `?src=` control at 18px:

| | colBOX | colINK |
|---|---|---|
| weapons before | 28.2 | 80.7 |
| weapons after | 26.3 | 75.4 |
| goods (all six) before | 18.4 | 43.4 |
| goods (all six) after | 19.3 | 49.9 |

The weapons paid about 2 points whole-box and 5 inked going into the dark
register. The goods' MINIMUM came out ahead on both, because the redraw fixed
the pair that was worst in the old sheet — but read that line together with the
distribution above, not instead of it. The minimum improved while every other
pair in the family got worse.

---

## Three things this corrects

**1. "col penalises small icons" is true per-icon and does NOT explain the goods
family.** At 26px the goods are the *inkier* family — mean ink 24.4 against the
weapons' 21.5 — so if smallness were the cause they would score higher, and they
do not. The effect is genuine where it was first found: the precept knife at
14.6% ink could not move `col` by recolouring and needed area instead, and
真火符 at 14% ink carries the two highest box-to-ink ratios in the set, 3.79 and
4.06. Sizing 護身符 back up was still the right repair — but for the reason
below, not this one. A wrong mechanism sends the next repair to the wrong place.

**2. What actually costs the goods is OVERLAP, not size.** By the relationship
above, a low `colBOX` with a healthy `colINK` means a small union — and a small union
between two inky icons means they cover *the same* pixels. The goods are compact
shapes centred in the box; the weapons are elongated at different widths. So
`colBOX` is not a colour measurement in isolation: **it conflates colour with
coverage**, and coverage is the same property `sil` is about.

**3. The ruler reorders, it does not merely rescale.** 糯米 / 黑狗血 is the
*worst* silhouette pair in the goods family (6.7) and simultaneously the *best*
colour pair under `colINK` (93.4) — pale rice against a black bottle is about as
far apart as two things in this set get. Whole-box buries that under shared bare
panel and reports a mid-table 28.9. Acting on the whole-box figure alone would
send someone to recolour the pair whose colour is already the family's strongest,
when what is thin about it is shape.

An honest limit on `colINK`, so it is not oversold: it could in principle just
restate silhouette, since non-overlapping regions put bare panel against ink. It
does not — across the goods, sil 6.7 gives the highest `colINK` and sil 22.3
gives 84.5, so the two axes stay independent.

---

## What is not concluded here

The guard is unchanged and nothing above proposes changing it. Two properties
are worth knowing before anyone tunes art to its number again:

- Ordering is preserved between the two columns in every comparison run, so
  `col` is sound as a **comparator**.
- It is not comparable **across icons of different density**, so an absolute
  floor is a harsher bar for a sparse pair than a dense one. The same pair reads
  19.3 one way and 61.1 the other.

Whether that warrants a change to the test is the user's call, not this note's.

---

## Method notes, because two of these were learned the hard way

**Compare the same ids both times, and the same statistic — preferably one that
counts pairs rather than reporting an extreme.** A five-icon family measured
against a six-icon one is not a comparison. A "regression from 25.4 to 19.2" reported
during #88 was exactly this: the old family included 神主牌, whose worst pair sat
at 18.4 — tighter than anything in the set being called a regression. Withdrawn
in `e909b33`. The withdrawal then OVERSHOT in the same way, generalising from a
single improved minimum to "no trade exists"; the distribution above is what
corrects it. Twice in one investigation, one pair was allowed to stand for a
family.

**Get a control before calling anything a regression.** `git show
SHA:assets/icons.svg > tools/old.svg`, then `?src=old.svg` on the bench. It takes
a minute and it is the difference between a measurement and an impression.

**Look at the contact sheet.** Both floors passed on a set of #89 drawings that
were unidentifiable fireballs. No numeric guard here measures whether a thing
looks like what it is.
