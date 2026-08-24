"""The 義莊, read out of index.html and drawn.

Shared by make_social.py (the 1200x630 link card) and make_icons.py (the PWA
icons). It lives here rather than in either of them because there are now two
things that have to show the same building, and the only way to guarantee that
is for both to read the same source: the `titlehouse` SVG on the cold open.

What is shared is the BUILDING, and only the building: the path parser and the
element walk. Lighting is not shared and deliberately so — the card is a wide
night scene and an app icon is a square badge, they want different glows in
different places, and an early draft of this file that hoisted glow() too
proved the point by quietly changing the card's falloff.

There is no SVG rasteriser on this machine (no ImageMagick, Inkscape, rsvg or
Node), which is why this renderer exists at all. It handles exactly what the
drawing uses: paths (M L H V C Q Z, absolute and relative), rects, ellipses, a
fill inherited from the enclosing <g>, and a flat opacity.
"""
from PIL import Image, ImageDraw
import re

# The titlehouse viewBox.
VB_W, VB_H = 320, 180

# A gradient cannot be painted by this renderer, so each one resolves to the
# tone it averages out to. Only the lantern haloes are worth more than that, and
# callers paint those properly as real glows.
GRADIENT = {
    "url(#ti-door)": (58, 42, 18),
    "url(#ti-wall)": (10, 15, 20),
}

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


def draw_house(html, scale, alpha=245):
    """Paint the gate at `scale` onto a transparent canvas of the whole viewBox.

    Returns (image, lanterns). The lanterns come back as viewBox-space
    (cx, cy, rx, ry) rather than being drawn, because a flat ellipse is not what
    they are — the caller blooms them additively once the art is placed.
    """
    art_w, art_h = round(VB_W * scale), round(VB_H * scale)
    art = Image.new("RGBA", (art_w, art_h), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art)
    lanterns = []

    for tag, raw, fill, op in titlehouse_elements(html):
        if fill == "url(#ti-lantern)":
            lanterns.append((float(attr(raw, "cx")), float(attr(raw, "cy")),
                             float(attr(raw, "rx")), float(attr(raw, "ry"))))
            continue
        colour = GRADIENT.get(fill) or hex_rgb(fill if fill and fill.startswith("#") else "#000")
        rgba = colour + (round(alpha * op),)
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

    return art, lanterns
