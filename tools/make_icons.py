"""The app icons: the gate, square.

    python tools/make_icons.py

The four PNGs the manifest points at were still the fork's — a Western pitched
roof with a chimney, which is a fine icon for the game this one is not. Anyone
installing 口袋裡的殭屍 got a suburban house on their home screen.

Same source as the social card and the cold open: the `titlehouse` SVG in
index.html, read through tools/silhouette.py. Three surfaces, one building, and
no way for them to drift.

Two shapes, because Android asks for two:
  icon-NNN.png           the drawing edge to edge, cropped square
  icon-NNN-maskable.png  the same scene inset, so a launcher that clips it to a
                         circle takes the padding and not the roofline

Needs Pillow. No SVG rasteriser on this machine, hence silhouette.py.
"""
from PIL import Image, ImageDraw, ImageFilter
import pathlib, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from silhouette import VB_W, VB_H, draw_house

OUT_DIR = pathlib.Path("assets/icons")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# The square window onto the drawing. The gate centres on x=160 (its two
# lanterns sit at 128 and 192) and the building runs from y=74 to the bottom
# edge. 146 wide is the smallest box that still shows a full sweep of eaves
# above the lanterns — and the eaves are the whole point, because a dark shape
# with two red lamps on it could be anything, while a curved roof could not.
CROP_W = CROP_H = 146

# The cold open's ground, sampled over the crop's own vertical span rather than
# the full page — an icon showing the bottom third of the scene should carry the
# bottom third of the sky, not a compressed copy of all of it.
STOPS = [(0.0, (7, 10, 16)), (0.44, (10, 13, 19)), (1.0, (18, 22, 29))]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky(size, y0, y1):
    """The page gradient, sampled between two fractions of its height."""
    w, h = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y0 + (y1 - y0) * (y / (h - 1))
        for i in range(len(STOPS) - 1):
            t0, c0 = STOPS[i]
            t1, c1 = STOPS[i + 1]
            if t0 <= t <= t1:
                d.line([(0, y), (w, y)], fill=lerp(c0, c1, (t - t0) / (t1 - t0)))
                break
    return img


def glow(size, cx, cy, rx, ry, colour, alpha, falloff=1.0):
    """A radial-gradient layer, painted small and blurred back up.

    Deliberately a separate copy from the one in make_social.py rather than a
    third thing hoisted into silhouette.py. The blur radius has to scale with
    the canvas — the card's is tuned for 1200px and would turn a 192px icon into
    a smear — so "the same function" would need a parameter that means something
    different to each caller, which is two functions wearing one name.
    """
    w, h = size
    s = 2
    layer = Image.new("L", (max(1, w // s), max(1, h // s)), 0)
    ld = ImageDraw.Draw(layer)
    steps = 42
    for i in range(steps, 0, -1):
        f = i / steps
        v = int(alpha * 255 * ((1 - f) ** falloff))
        ld.ellipse([(cx - rx * f) / s, (cy - ry * f) / s,
                    (cx + rx * f) / s, (cy + ry * f) / s], fill=v)
    layer = layer.resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(w / 42))
    return Image.new("RGB", size, colour), layer


def render(px, crop):
    """One icon. `crop` is the size of the square window onto the drawing, in
    viewBox units — a bigger window is a wider shot of the same gate.

    The art is always full bleed. That is the whole trick to a maskable icon:
    a launcher may clip it to a circle, so the answer is to zoom OUT until the
    gate sits inside the safe middle, never to shrink the picture onto a
    background — that leaves a rectangle of art with visible edges, which is
    exactly what a mask will cut a bite out of.
    """
    crop_x, crop_y = 160 - crop / 2, VB_H - crop
    img = sky((px, px), max(0.0, crop_y / VB_H), 1.0)

    scale = px / crop
    house, lanterns = draw_house(pathlib.Path("index.html").read_text(encoding="utf-8"), scale)

    # The window into the full-viewBox art. crop_y can sit above the drawing on
    # the wide shot, which is only sky, so the paste is offset instead of cropped.
    left = round(crop_x * scale)
    top = round(crop_y * scale)
    sx, sy = max(0, left), max(0, top)
    dx, dy = sx - left, sy - top
    piece = house.crop((sx, sy, min(house.width, sx + px - dx), min(house.height, sy + px - dy)))

    # The moon, before the building, so the roofline cuts into it.
    tint, mask = glow((px, px), px * 0.80, px * 0.12, px * 0.42, px * 0.30,
                      (220, 233, 247), 0.26)
    img.paste(tint, (0, 0), mask)

    img.paste(piece, (dx, dy), piece)

    # The lanterns last and additively, the way the page blooms them.
    for cx, cy, rx, ry in lanterns:
        gx, gy = cx * scale - left, cy * scale - top
        tint, mask = glow((px, px), gx, gy, rx * scale * 2.4, ry * scale * 2.4,
                          (255, 154, 60), 0.42, falloff=1.3)
        img.paste(tint, (0, 0), mask)

    return img


# The wide shot for maskable: the same 146-unit framing divided by the 0.8 the
# spec reserves, so everything that mattered in the tight shot now sits inside
# the safe circle with the extra falling outside it as scenery.
MASKABLE_CROP = round(CROP_W / 0.8)

for px in (192, 512):
    for maskable in (False, True):
        img = render(px, MASKABLE_CROP if maskable else CROP_W)
        name = f"icon-{px}{'-maskable' if maskable else ''}.png"
        img.save(OUT_DIR / name, optimize=True)
        print(f"{OUT_DIR / name}  {(OUT_DIR / name).stat().st_size:,} bytes  {img.size}")
