"""Render og-image.png from the design in og-image.svg.

Social scrapers (Facebook, X, Slack, LinkedIn) ignore SVG, so og:image has to
be a raster file. There is no SVG rasteriser on the dev machine -- no
ImageMagick, Inkscape, rsvg or Node -- so rather than add a toolchain this
redraws the same small design with Pillow, which is available.

og-image.svg stays the design source of truth. If you change it, change this to
match and re-run:

    python tools/make_og_image.py

Excluded from the asset upload via .assetsignore.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630

BG_INNER = (0x14, 0x16, 0x1A)
BG_OUTER = (0x0A, 0x0B, 0x0D)
TEXT = (0xE6, 0xE3, 0xDC)
MUTED = (0x9A, 0xA0, 0xAA)
ACCENT = (0x7F, 0xB5, 0x39)
BLOOD = (0xB5, 0x39, 0x2F)

STROKE = 9
ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = Path("C:/Windows/Fonts")

TITLE = "Grave Errand"
TAGLINE = "Find the relic. Bury it before midnight."
DOMAIN = "games.csiesheep.com"


def font(names, size):
    """First available font from `names`, else Pillow's default."""
    for name in names:
        path = FONT_DIR / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


def background():
    """Radial gradient centred on the top edge, as in the SVG."""
    # radial_gradient is centre-origin, so build it double height and keep the
    # bottom half -- that puts the bright centre on row 0.
    grad = Image.radial_gradient("L").resize((W, H * 2)).crop((0, H, W, H * 2))
    return Image.composite(
        Image.new("RGB", (W, H), BG_OUTER),  # mask 255, the outer edge
        Image.new("RGB", (W, H), BG_INNER),  # mask 0, the centre
        grad,
    )


def headstone(draw):
    """The same mark as favicon.svg: an arched stone, a cross, and the ground."""
    left, right = 556, 644
    top, base = 150, 232
    radius = (right - left) // 2

    # Arched top: a semicircle centred on (600, top).
    draw.arc(
        [left, top - radius, right, top + radius],
        start=180,
        end=360,
        fill=ACCENT,
        width=STROKE,
    )
    draw.line([left, top, left, base], fill=ACCENT, width=STROKE)
    draw.line([right, top, right, base], fill=ACCENT, width=STROKE)
    draw.line([left, base, right, base], fill=ACCENT, width=STROKE)

    # The relic's mark.
    draw.line([600, 176, 600, 210], fill=ACCENT, width=STROKE)
    draw.line([583, 193, 617, 193], fill=ACCENT, width=STROKE)

    # Ground line, in dried blood.
    draw.line([520, base, 680, base], fill=BLOOD, width=STROKE)


def main():
    img = background()
    draw = ImageDraw.Draw(img)
    headstone(draw)

    # anchor="ms" is middle-baseline, matching the SVG's text-anchor + y.
    draw.text(
        (600, 360),
        TITLE,
        font=font(["georgiab.ttf", "times.ttf"], 96),
        fill=TEXT,
        anchor="ms",
    )
    draw.text(
        (600, 426),
        TAGLINE,
        font=font(["segoeui.ttf", "arial.ttf"], 34),
        fill=MUTED,
        anchor="ms",
    )
    draw.text(
        (600, 560),
        DOMAIN,
        font=font(["segoeui.ttf", "arial.ttf"], 24),
        fill=ACCENT,
        anchor="ms",
    )

    out = ROOT / "og-image.png"
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({out.stat().st_size:,} bytes, {W}x{H})")


if __name__ == "__main__":
    main()
