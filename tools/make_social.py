"""The social card: the cold open, held still.

    python tools/make_social.py

Not a logo on a background. The promise a pasted link makes should be the thing
the player actually gets, so this is the same gate, the same light and the same
title as index.html — the difference is that the fog is not moving.

The previous version transcribed the silhouette into a hand-written polygon and
noted that it was safe because the old house was all straight lines. The 義莊 is
not: it has swept eaves, and a transcription would have to be redone by hand
every time the roofline moved. So this reads the `titlehouse` SVG out of
index.html and draws it — a small renderer for the handful of things that
drawing actually uses. The card cannot drift from the page any more, because it
is the page.

Needs Pillow to draw and fontTools to unpack the site's woff2. There is no SVG
rasteriser on this machine (no ImageMagick, Inkscape, rsvg or Node), which is
why the renderer below exists at all.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import pathlib, tempfile, re, math

W, H = 1200, 630
OUT = pathlib.Path("assets/social-jiangshi.png")
OUT.parent.mkdir(parents=True, exist_ok=True)

# Pillow cannot read woff2, so the site's own font is unpacked to a temporary
# ttf. Using the shipped file rather than a system Georgia matters: the card and
# the page have to be the same letterforms.
def title_font_path():
    from fontTools.ttLib import TTFont

    f = TTFont("assets/fonts/imfellenglish-latin.woff2")
    f.flavor = None
    tmp = pathlib.Path(tempfile.gettempdir()) / "imfellenglish-social.ttf"
    f.save(tmp)
    return str(tmp)


FONT = title_font_path()
# IM Fell carries no CJK, and the page falls back to a Song serif for the name.
# MingLiU is the same shape of face as the "Noto Serif TC, Songti TC" the
# stylesheet asks for, so the card and the page agree about the letterforms.
CJK = "C:/Windows/Fonts/mingliu.ttc"

# ---- the ground ------------------------------------------------------------
# linear-gradient(180deg, #070a10 0%, #0a0d13 44%, #12161d 100%), read off the
# cold open's own rule so the two cannot drift apart.
STOPS = [(0.0, (7, 10, 16)), (0.44, (10, 13, 19)), (1.0, (18, 22, 29))]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


img = Image.new("RGB", (W, H))
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / (H - 1)
    for i in range(len(STOPS) - 1):
        t0, c0 = STOPS[i]
        t1, c1 = STOPS[i + 1]
        if t0 <= t <= t1:
            d.line([(0, y), (W, y)], fill=lerp(c0, c1, (t - t0) / (t1 - t0)))
            break


def glow(size, cx, cy, rx, ry, colour, alpha, falloff=1.0):
    """One radial-gradient layer, painted at quarter scale and blurred back up —
    the smooth ramp costs nothing that way and looks the same."""
    s = 4
    layer = Image.new("L", (max(1, size[0] // s), max(1, size[1] // s)), 0)
    ld = ImageDraw.Draw(layer)
    steps = 42
    for i in range(steps, 0, -1):
        f = i / steps
        v = int(alpha * 255 * ((1 - f) ** falloff))
        ld.ellipse(
            [(cx - rx * f) / s, (cy - ry * f) / s, (cx + rx * f) / s, (cy + ry * f) / s],
            fill=v,
        )
    layer = layer.resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(18))
    tint = Image.new("RGB", size, colour)
    return tint, layer


# ---- the light -------------------------------------------------------------
# The moon high and to the right, the two gate lanterns low and warm fighting
# it, and cold air pooling on the ground. Same four layers as .titlescene.
for cx, cy, rx, ry, colour, alpha in [
    (W * 0.78, H * 0.14, W * 0.30, H * 0.22, (220, 233, 247), 0.30),
    (W * 0.78, H * 0.14, W * 0.70, H * 0.46, (150, 178, 208), 0.13),
    (W * 0.50, H * 1.00, W * 1.50, H * 0.56, (96, 116, 146), 0.26),
    (W * 0.50, H * 0.96, W * 0.50, H * 0.34, (232, 140, 80), 0.16),
]:
    tint, mask = glow((W, H), cx, cy, rx, ry, colour, alpha)
    img.paste(tint, (0, 0), mask)

# ---- the fog ---------------------------------------------------------------
# Two banks, at the heights the cold open puts them, caught mid-drift.
for cx, cy, rx, ry, alpha in [
    (W * 0.30, H * 1.04, W * 0.36, H * 0.34, 0.11),
    (W * 0.72, H * 1.04, W * 0.30, H * 0.31, 0.09),
    (W * 0.60, H * 0.80, W * 0.33, H * 0.22, 0.07),
]:
    tint, mask = glow((W, H), cx, cy, rx, ry, (150, 152, 160), alpha, falloff=1.6)
    img.paste(tint, (0, 0), mask)


# ---- a very small SVG renderer ---------------------------------------------
# Only what the titlehouse drawing uses: paths (M L H V C Q Z, absolute and
# relative), rects, ellipses, a fill inherited from the enclosing <g>, and a
# flat opacity. Curves are flattened to 16 segments, which at this scale is
# under a pixel of error.
NUM = re.compile(r"-?\d*\.?\d+(?:e-?\d+)?")


def flatten_cubic(p0, p1, p2, p3, n=16):
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return out


def flatten_quad(p0, p1, p2, n=12):
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def parse_path(dstr):
    """Return a list of subpaths, each a list of points."""
    tokens = re.findall(r"[MmLlHhVvCcQqZz]|" + NUM.pattern, dstr)
    subs, cur = [], []
    x = y = 0.0
    start = (0.0, 0.0)
    i = 0
    cmd = None
    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                if cur:
                    subs.append(cur)
                    cur = []
                x, y = start
                continue
        # implicit repeat keeps the last command; M repeats as L
        eff = cmd
        if cmd == "M":
            eff = "M" if not cur else "L"
        elif cmd == "m":
            eff = "m" if not cur else "l"

        def take(n):
            nonlocal i
            vals = [float(v) for v in tokens[i:i + n]]
            i += n
            return vals

        if eff in "Mm":
            dx, dy = take(2)
            x, y = (dx, dy) if eff == "M" else (x + dx, y + dy)
            start = (x, y)
            cur = [(x, y)]
        elif eff in "Ll":
            dx, dy = take(2)
            x, y = (dx, dy) if eff == "L" else (x + dx, y + dy)
            cur.append((x, y))
        elif eff in "Hh":
            (dx,) = take(1)
            x = dx if eff == "H" else x + dx
            cur.append((x, y))
        elif eff in "Vv":
            (dy,) = take(1)
            y = dy if eff == "V" else y + dy
            cur.append((x, y))
        elif eff in "Cc":
            a, b, c, e, f, g = take(6)
            if eff == "c":
                a, b, c, e, f, g = x + a, y + b, x + c, y + e, x + f, y + g
            cur += flatten_cubic((x, y), (a, b), (c, e), (f, g))
            x, y = f, g
        elif eff in "Qq":
            a, b, f, g = take(4)
            if eff == "q":
                a, b, f, g = x + a, y + b, x + f, y + g
            cur += flatten_quad((x, y), (a, b), (f, g))
            x, y = f, g
        else:
            i += 1
    if cur:
        subs.append(cur)
    return subs


def hex_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def attr(tag, name, default=None):
    m = re.search(r'\b%s="([^"]*)"' % name, tag)
    return m.group(1) if m else default


def titlehouse_elements(html):
    """Elements of the titlehouse svg, in document order, with fill resolved."""
    svg = re.search(r'<svg class="titlehouse".*?</svg>', html, re.S).group(0)
    svg = re.sub(r"<defs>.*?</defs>", "", svg, flags=re.S)
    out, stack = [], []
    for m in re.finditer(r"<(/?)(g|path|rect|ellipse)\b([^>]*?)(/?)>", svg):
        closing, tag, body, self_close = m.groups()
        if tag == "g":
            if closing:
                if stack:
                    stack.pop()
            else:
                stack.append(attr("<" + body + ">", "fill"))
            continue
        if closing:
            continue
        raw = "<" + body + ">"
        fill = attr(raw, "fill")
        if fill is None:
            fill = next((f for f in reversed(stack) if f), None)
        out.append((tag, raw, fill, float(attr(raw, "opacity", "1"))))
    return out


# ---- the gate --------------------------------------------------------------
# The page's own box, worked out for a 1200x630 window rather than guessed at.
# .titlehouse is width min(1100px, 168vw) by height min(58vh, 420px), sitting on
# the bottom edge — so at this size it is a 1100x365 window onto the art. Then
# preserveAspectRatio="xMidYMax slice" fills that window by the larger scale and
# anchors the drawing to its bottom, which crops the roofline rather than
# letterboxing it.
VB_W, VB_H = 320, 180
BOX_W, BOX_H = min(1100, round(W * 1.68)), min(round(H * 0.58), 420)
scale = max(BOX_W / VB_W, BOX_H / VB_H)
art_w, art_h = round(VB_W * scale), round(VB_H * scale)

art = Image.new("RGBA", (art_w, art_h), (0, 0, 0, 0))
ad = ImageDraw.Draw(art)
html = pathlib.Path("index.html").read_text(encoding="utf-8")

# A gradient cannot be painted by this renderer, so each one resolves to the
# tone it averages out to. Only the lantern haloes are worth more than that, and
# they are painted properly further down.
GRADIENT = {
    "url(#ti-door)": (58, 42, 18),
    "url(#ti-wall)": (10, 15, 20),
}

lanterns = []  # drawn as real glows afterwards, not as flat ellipses
for tag, raw, fill, op in titlehouse_elements(html):
    if fill == "url(#ti-lantern)":
        lanterns.append((float(attr(raw, "cx")), float(attr(raw, "cy")),
                         float(attr(raw, "rx")), float(attr(raw, "ry"))))
        continue
    colour = GRADIENT.get(fill) or hex_rgb(fill if fill and fill.startswith("#") else "#000")
    rgba = colour + (round(245 * op),)
    if tag == "path":
        for sub in parse_path(attr(raw, "d")):
            if len(sub) >= 3:
                ad.polygon([(px * scale, py * scale) for px, py in sub], fill=rgba)
    elif tag == "rect":
        x, y = float(attr(raw, "x", 0)), float(attr(raw, "y", 0))
        w, h = float(attr(raw, "width")), float(attr(raw, "height"))
        ad.rectangle([x * scale, y * scale, (x + w) * scale, (y + h) * scale], fill=rgba)
    elif tag == "ellipse":
        cx, cy = float(attr(raw, "cx")), float(attr(raw, "cy"))
        rx, ry = float(attr(raw, "rx")), float(attr(raw, "ry"))
        ad.ellipse([(cx - rx) * scale, (cy - ry) * scale,
                    (cx + rx) * scale, (cy + ry) * scale], fill=rgba)

# xMid, YMax: centred sideways, bottom-aligned, and clipped to the box.
ox = max(0, (art_w - BOX_W) // 2)
crop = art.crop((ox, art_h - BOX_H, ox + BOX_W, art_h))
img.paste(crop, ((W - BOX_W) // 2, H - BOX_H), crop)

# The lantern haloes go on last and additively, so they bloom over the gate the
# way the radial gradient does on the page rather than sitting on it as discs.
for cx, cy, rx, ry in lanterns:
    px = (W - BOX_W) // 2 + cx * scale - ox
    py = H - BOX_H + (cy * scale - (art_h - BOX_H))
    tint, mask = glow((W, H), px, py, rx * scale * 1.8, ry * scale * 1.8,
                      (255, 154, 60), 0.34, falloff=1.4)
    img.paste(tint, (0, 0), mask)

# ---- the words -------------------------------------------------------------
name = ImageFont.truetype(CJK, 104)
gloss = ImageFont.truetype(FONT, 31)
sub = ImageFont.truetype(FONT, 34)

TEXT = (240, 238, 232)
GOLD = (201, 162, 75)
MUTED = (154, 160, 170)


def tracked(text, font, y, fill, track=0):
    """Centred, with letter-spacing — the title lockup is spaced on the page and
    a card that is not would read as a different wordmark."""
    widths = [d.textbbox((0, 0), ch, font=font)[2] for ch in text]
    total = sum(widths) + track * (len(text) - 1)
    x = (W - total) / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=font, fill=fill)
        x += w + track


tracked("口袋裡的殭屍", name, 58, TEXT, track=17)
tracked("JIANGSHI IN THE POCKET", gloss, 196, GOLD, track=9)
tracked("Lay him to rest, or be standing when he arrives.", sub, 246, MUTED)

img.save(OUT, optimize=True)
print(f"{OUT}  {OUT.stat().st_size:,} bytes  {img.size}")
