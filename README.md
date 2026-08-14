# Zombie in the Pocket (working title)

A browser remake of the free print-and-play solo board game *Zombie in my
Pocket* (2007) by **Jeremiah Lee**. Explore a house tile by tile, find the
totem, and bury it in the graveyard before midnight.

Static site — HTML/CSS/vanilla JS, no backend — served through a Cloudflare
Worker with static assets, the same stack as
[betrayal_sound_effect](https://github.com/csiesheep/betrayal_sound_effect).

> **Clean-room build.** Game mechanics and numbers aren't copyrightable and
> carry over from the original; all names, art and flavour text are our own.
> The public-facing title will be changed before shipping. See the design
> notes in the Obsidian vault (`projects/zombie in the pocket`).

## Structure

```
index.html      choice / main menu (Start · Rulebook · Credits · About)
game.html       the game: board + status HUD + log + controls
rulebook.html   playable rules
credits.html    original-designer credit + license attribution
css/style.css   styles + theme tokens
js/             engine (rules) · board · render · app · menu
data/           tiles · cards · items (mechanics) + theme (display strings)
src/index.js    Cloudflare prefix router
```

## Status

Scaffolded. Engine, board and UI not yet implemented.

Target URL: `https://games.csiesheep.com/zombie_in_the_pocket/`

## Credits

Based on *Zombie in my Pocket* by Jeremiah Lee, released free under
CC BY-NC-SA 3.0. This is an unofficial fan remake.
