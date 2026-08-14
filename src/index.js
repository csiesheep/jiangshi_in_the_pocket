// Cloudflare Worker: path-prefix router in front of the static assets.
// `run_worker_first: true` (wrangler.jsonc) sends every request here before
// asset matching, so we can strip the `/zombie_in_the_pocket` prefix and
// still serve from the bare *.workers.dev root while testing.
//
// The public path segment is independent of the repo / Worker name — change
// PREFIX alone to move the site to a different path.
const PREFIX = "/zombie_in_the_pocket";
const ORIGIN = "https://games.csiesheep.com";
const CANONICAL = ORIGIN + PREFIX + "/";

// robots.txt and sitemap.xml must live at the host ROOT (crawlers only honour
// robots.txt at the domain root), which is outside the app prefix.
const ROBOTS_TXT = "Sitemap: " + ORIGIN + "/sitemap.xml\n";

const PAGES = ["", "game", "rulebook", "credits"]; // "" = the menu / index
const SITEMAP_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  PAGES.map(
    (p) =>
      "  <url>\n" +
      "    <loc>" + CANONICAL + (p ? p + ".html" : "") + "</loc>\n" +
      "  </url>\n"
  ).join("") +
  "</urlset>\n";

// TODO (Phase 5 — deploy): add /ads.txt (AdSense pub id) and the Search
// Console site-verification path once those tokens exist. See the
// betrayal_sound_effect repo's src/index.js for the exact pattern.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/robots.txt") {
      return new Response(ROBOTS_TXT, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/sitemap.xml") {
      return new Response(SITEMAP_XML, {
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    }

    if (url.pathname === "/" || url.pathname === PREFIX) {
      url.pathname = PREFIX + "/";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith(PREFIX + "/")) {
      url.pathname = url.pathname.slice(PREFIX.length) || "/";
      return env.ASSETS.fetch(new Request(url, request));
    }

    return new Response("Not found", { status: 404 });
  },
};
