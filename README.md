# 三更：殭屍 — The Third Watch: The Jiangshi

A solo horror board game in the browser. **[Play it](https://games.csiesheep.com/jiangshi_in_the_pocket/)**

It is nine at night in a village that has locked its doors. At the end of it
stands a 義莊 — a corpse hostel — holding one coffin nobody has come to claim.
Find the dead man's ancestral tablet among the rooms, carry it out through the
moon gate, and put it back in the ground at the mass grave before the third
watch. Or be standing and armed when he comes for you.

Thirty turns of six minutes each. Twenty rooms, dealt face down and laid one at
a time, so the village is a different shape every night. Playable in English and
繁體中文.

Static site — HTML/CSS/vanilla JS, no backend, no framework, no dependencies —
served through a Cloudflare Worker with static assets, the same stack as
[betrayal_sound_effect](https://github.com/csiesheep/betrayal_sound_effect).

> **Clean-room build.** The rules and numbers come from *Zombie in my Pocket*
> (2007) by **Jeremiah Lee** — game mechanics aren't copyrightable, so they
> carry over untouched. Everything expressive is ours: the title, the setting,
> every room and item name, all flavour text and all art. Design notes live in
> the Obsidian vault under `Projects/jiangshi in the pocket`.

## Structure

```
index.html        the menu — 開始 · 規則 · 圖板 · 關於
game.html         the game: board, the seven places, the hour, the log
rulebook.html     the full rules, playable as a page
tiles.html        the twenty rooms, drawn and described
credits.html      original-designer credit and licence attribution

css/style.css     every style and every theme token
js/               see below
data/             mechanics (tiles · items · search · events)
                  + display strings (theme.json, theme.zh-TW.json)
tools/            Python build and asset scripts
tests/            the suite — runs in a browser, no runner, no dependencies
src/index.js      the Cloudflare prefix router, and the sitemap
sw.js             the service worker: SHELL, its digest, and CACHE
```

### `js/`

| | |
|---|---|
| `engine.js` | the rules — pure functions over a state object, no DOM, no fetch |
| `board.js` | the dual grid (indoor + outdoor), tile placement and rotation |
| `app.js` | the turn loop, wiring input to the engine and back out to the page |
| `render.js` | state reflected into the DOM; no game logic lives here |
| `eventstage.js` | the full-screen moment where a room answers you |
| `audio.js` | every cue synthesised from oscillators and a noise buffer |
| `lang.js` · `langswitch.js` | which language the house speaks, and the control that changes it |
| `tilewords.js` | the words on a tile card, with no DOM in them |
| `icons.js` · `epilogue.js` · `tally.js` · `shell.js` | the sprite, the last line, what the house remembers, install/fullscreen |
| `reach.js` · `robot.js` | a reachability walker and a robot that plays the page — tools, not game code |

## Two things that will bite you

**Every player-visible string lives in `data/theme.json`, and nowhere else.**
Title, tagline, twenty room names, thirteen item names, and a flavour line per
event per hour. `data/theme.zh-TW.json` is an *overlay*: it is merged key by key
over the base, so a partial translation shows what it has and falls back to
English for the rest — which is what makes translating incremental and means a
broken language file cannot break the game. `rulebook.html` has its Chinese as a
whole document (`data/rulebook.zh-TW.html`) rather than as keys, and is the one
place that must be kept in step by hand.

**Two build steps must be re-run, and only a test catches you if you forget.**

```bash
python tools/render_tiles.py    # after changing data/tiles.json or data/theme.json
python tools/record_shell.py    # after changing anything in SHELL
```

`record_shell.py` hashes the *committed* blobs and stamps a build id into
`js/shell.js` — which is itself in SHELL — so it needs **two passes with a
commit between**. It will tell you when. The suite fails if either is stale;
nothing else does.

## Running it locally

No build step to serve it and no Node on the dev machine — any static server
works:

```bash
python -m http.server 8788
```

Then open `http://localhost:8788/`.

- `/tests/` runs the whole suite in the page — **378 tests**, zero dependencies,
  and it prints the pass/fail count into the document title.
- `game.html?seed=123` replays a deterministic run.
- The service worker serves SHELL cache-first, so **a private window is the
  reliable way to see changed JS** on a device you have already visited.

## Testing, and the house style

Guards here are expected to have been **failed on purpose at least once**.
A negative assertion that has never gone red is not weak evidence — it is none,
and this repo has shipped several: a selector that matched a container instead
of its contents and passed inside its own tolerance; a check whose two operands
never mentioned each other, so every key passed forever; a rule that could only
be reached with a mouse, verified entirely with synthetic taps.

So when you add a check, break the thing it guards and watch it name the fault.
If it cannot be made to fail, it is not protecting anything.

## Credits

Rules based on *Zombie in my Pocket* by Jeremiah Lee, released free under
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).
Unofficial and unaffiliated. A separate commercial edition of a similarly named
game exists from a different publisher; this is related to neither.

Some sound is from two CC0 packs by [Kenney](https://kenney.nl); every audio
file, its source and its licence are logged in `assets/audio/CREDITS.txt`.
