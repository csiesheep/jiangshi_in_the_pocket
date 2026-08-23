"""Build the standalone tile-review sheet from the real sprite and the real data.

The gallery at tools/jiangshi-tiles.html fetches those files at load. An artifact
cannot fetch, so this inlines them instead — same three sources, so the sheet
cannot drift from the set it is reviewing.
"""
import io, json, re, sys

ROOT = "."
SPRITE = f"{ROOT}/assets/icons.svg"
TILES  = f"{ROOT}/data/tiles.json"
THEME  = f"{ROOT}/data/modes/jiangshi/theme.json"

sprite = io.open(SPRITE, encoding="utf-8").read()
tiles  = json.load(io.open(TILES, encoding="utf-8"))
theme  = json.load(io.open(THEME, encoding="utf-8"))

WORD = {"N": "north", "E": "east", "S": "south", "W": "west"}
DIRS = ["N", "E", "S", "W"]
WALLS = {"N": (12, 12, 88, 12), "E": (88, 12, 88, 88),
         "S": (12, 88, 88, 88), "W": (12, 12, 12, 88)}

SEARCH_LABEL = {"weapon": "\u6b66\u5668 weapons",
                "magic": "\u7b26\u5492 magic",
                "medicine": "\u4e39\u85e5 medicine"}

def plan(d):
    out = ['<svg class="plan" viewBox="0 0 100 100" role="img" aria-label="door plan">']
    for k in DIRS:
        x1, y1, x2, y2 = WALLS[k]
        out.append(f'<line class="w" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>')
        if k not in d["exits"] and d.get("seam") != k:
            continue
        m = (36, y1, 64, y1) if k in ("N", "S") else (x1, 36, x1, 64)
        cls = "d d--seam" if d.get("seam") == k else "d"
        out.append(f'<line class="{cls}" x1="{m[0]}" y1="{m[1]}" x2="{m[2]}" y2="{m[3]}"/>')
    return "".join(out) + "</svg>"

def chips(d):
    c = []
    if d.get("search"):
        star = " \u2605" if d.get("best") else ""
        c.append(f'<span class="chip chip--{d["search"]}">{SEARCH_LABEL[d["search"]]}{star}</span>')
    if d.get("onTurnEnd") == "HEAL_1":  c.append('<span class="chip chip--heal">+1 health</span>')
    if d.get("once") or d.get("pray"): c.append('<span class="chip">once per night</span>')
    if d.get("sanctuary"):            c.append('<span class="chip chip--heal">no damage</span>')
    if d.get("onResolve"):              c.append('<span class="chip chip--goal">goal</span>')
    if d.get("start"):                  c.append('<span class="chip">start</span>')
    if d.get("exteriorDoor"):           c.append('<span class="chip chip--gate">moon gate</span>')
    if d.get("seam"):                   c.append('<span class="chip chip--gate">seam</span>')
    if not c:                           c.append('<span class="chip">transit</span>')
    return "".join(c)

def exits_line(d):
    named = [WORD[k] for k in d["exits"]]
    s = "All four walls" if len(named) == 4 else ", ".join(named).capitalize()
    if d.get("seam"):
        s += f" \u00b7 {WORD[d['seam']]} seam"
    return s

def card(d, world, n):
    name = theme["tiles"].get(d["id"], d["id"])
    cjk, _, latin = name.partition(" ")
    blurb = theme["tileBlurbs"].get(d["id"], "")
    return f"""<article class="plate">
  <div class="art art--{world}">
    <svg class="scene" viewBox="0 0 96 96" role="img" aria-label="{latin}"><use href="#scene-{d['id']}"/></svg>
    <span class="num">{n:02d}</span>
  </div>
  <div class="body">
    <h3><span class="cjk">{cjk}</span> <span class="latin">{latin}</span></h3>
    <p class="blurb">{blurb}</p>
    <div class="doors">{plan(d)}<span>{exits_line(d)}</span></div>
    <div class="chips">{chips(d)}</div>
  </div>
</article>"""

sections = []
meta = [
    ("indoor", "\u5ba4\u5167", "The village, and the \u7fa9\u838a at the end of it",
     "Beams overhead, a plastered wall, a stone floor running away from you, and one oil lamp off to the left. Ten rooms, all lit the same way."),
    ("outdoor", "\u5ba4\u5916", "The hillside",
     "Sky, the same moon in the same corner, hills on the horizon, cold ground and a band of mist. Ten places, all under one sky."),
]
for world, cjk, latin, note in meta:
    cards = "\n".join(card(d, world, i + 1) for i, d in enumerate(tiles[world]))
    sections.append(f"""<section class="half half--{world}">
  <header class="halfhead">
    <span class="vert" aria-hidden="true">{cjk}</span>
    <div>
      <h2>{latin}</h2>
      <p>{note}</p>
      <p class="count">{len(tiles[world])} tiles</p>
    </div>
  </header>
  <div class="grid">
{cards}
  </div>
</section>""")

# The sprite is the whole game's art. This sheet only reviews the twenty rooms,
# so take the <defs> (the two shells everything is built on) and just the twenty
# symbols it actually draws, rather than inlining every item and UI glyph too.
wanted = {d["id"] for d in tiles["indoor"] + tiles["outdoor"]}
inner = "".join(re.findall(r"<defs>.*?</defs>", sprite, flags=re.S))
for m in re.finditer(r'<symbol id="scene-([a-z-]+)".*?</symbol>', sprite, flags=re.S):
    if m.group(1) in wanted:
        inner += chr(10) + m.group(0)
missing = wanted - set(re.findall(r'<symbol id="scene-([a-z-]+)"', inner))
assert not missing, f"no art for: {sorted(missing)}"

html = io.open(f"{ROOT}/tools/tile_sheet_template.html", encoding="utf-8").read()
html = html.replace("<!--SPRITE-->", '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + inner + "</svg>")
html = html.replace("<!--SECTIONS-->", "\n".join(sections))

# Every non-ASCII character goes out as a numeric entity, so the sheet renders
# the same whether it is served with a charset, opened off disk, or wrapped by a
# host page whose head we do not control. Half the copy on it is Chinese.
html = html.encode("ascii", "xmlcharrefreplace").decode("ascii")

out = sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/tools/tile-sheet.html"
io.open(out, "w", encoding="utf-8", newline="\n").write(html)
print("wrote", out, len(html), "bytes")
