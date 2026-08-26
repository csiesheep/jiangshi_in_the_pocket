// The icon sprite, and the one thing every page that draws an icon needs.
//
// Lifted out of render.js so a page can have icons without the board: render.js
// pulls in engine, board and audio, which is the wrong price for a rules page
// that wants thirteen pictures. Both importers get the same copy, so there is
// one place that knows how the sprite gets into a document.

// Inject the icon sprite once, then reference symbols with <use href="#id">.
// External-file <use> references are not dependably supported, so the sprite is
// inlined instead. Icons are decorative: if the fetch fails, tiles fall back to
// their text label and nothing else changes.
export async function loadIcons() {
  try {
    const res = await fetch("assets/icons.svg", { cache: "no-cache" });
    if (!res.ok) return false;
    const holder = document.createElement("div");
    // Hide by size, not `hidden` (display:none). A gradient defined inside a
    // display:none subtree is not rendered, so referencing it as a paint server
    // yields nothing — the scenes' oil-lamp glow and vignette dropped and every
    // painted tile went flat. The eight original scenes only ever used solid
    // fills, so this never showed until the twenty gradient scenes. Zero-size,
    // clipped and off-flow keeps it invisible while the sprite still renders.
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    holder.setAttribute("aria-hidden", "true");
    holder.innerHTML = await res.text();
    document.body.appendChild(holder);
    return true;
  } catch {
    return false;
  }
}
