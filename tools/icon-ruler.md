# What the icon separability numbers actually measure (#88, #89)

A measurement note, not a proposal. The guard is
`tests/stage.test.js` — its thresholds live there and are deliberately not
repeated here, because two copies of a number is how one of them goes stale.
This records what the numbers mean and what they were, so the next person
reading a `col` figure knows what they are holding.

`tools/icon-bench.html` reports the same figures on demand and mirrors the
guard's rasteriser exactly.

---

## The identity that explains most of it

`col` is a mean over **the whole icon box**, empty panel included.

Where neither icon has ink, both composite onto the same `#1b1e24` panel, so
the per-pixel distance there is **exactly zero** — not small, zero. Both sums
run over the same pixels and differ only in their divisor. So:

    colBOX  =  colINK  ×  (union of inked pixels / box area)

That is an identity, checkable by reading `pair()` in the bench, not a model.
Everything below follows from it.

**A pair's whole-box colour score is its true colour distance scaled down by how
much of the box the two drawings cover between them.** Two icons can be
enormously far apart where they actually ink and still score mid-table, purely
because they leave most of the box bare.

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

Implied union coverage, straight from the identity: weapons 0.35 of the box,
goods 0.28, papers 0.26.

### The register's price, against the pre-#88 sheet

Measured with the bench's `?src=` control at 18px:

| | colBOX | colINK |
|---|---|---|
| weapons before | 28.2 | 80.7 |
| weapons after | 26.3 | 75.4 |
| goods (all six) before | 18.4 | 43.4 |
| goods (all six) after | 19.3 | 49.9 |

The weapons paid about 2 points whole-box and 5 inked going into the dark
register. The goods came out **ahead on both**, because the redraw fixed the
pair that was worst in the old sheet.

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

**2. What actually costs the goods is OVERLAP, not size.** By the identity, a
low `colBOX` with a healthy `colINK` means a small union — and a small union
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

**Compare the same ids both times.** A five-icon family measured against a
six-icon one is not a comparison. A "regression from 25.4 to 19.2" reported
during #88 was exactly this: the old family included 神主牌, whose worst pair sat
at 18.4 — tighter than anything in the set being called a regression. Withdrawn
in `e909b33`.

**Get a control before calling anything a regression.** `git show
SHA:assets/icons.svg > tools/old.svg`, then `?src=old.svg` on the bench. It takes
a minute and it is the difference between a measurement and an impression.

**Look at the contact sheet.** Both floors passed on a set of #89 drawings that
were unidentifiable fireballs. No numeric guard here measures whether a thing
looks like what it is.
