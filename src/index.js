// Cloudflare Worker: path-prefix router in front of the static assets.
// `run_worker_first: true` (wrangler.jsonc) sends every request here before
// asset matching, so we can strip the `/jiangshi_in_the_pocket` prefix and
// still serve from the bare *.workers.dev root while testing.
//
// The public path segment is independent of the repo / Worker name — change
// PREFIX alone to move the site to a different path.
import { handleRun, handleBoard, handleStats } from "./run.js";

const PREFIX = "/jiangshi_in_the_pocket";

// Has this actually shipped? One flag, one place, and it is deliberately next
// to PREFIX because both answer "where does this site stand in the world".
//
// It exists because the seo suite needs to know which way round to check the
// noindex. Pre-ship the pages MUST carry it — indexing a half-built reskin
// would put a byte-for-byte duplicate in front of the real game — and
// post-ship they must not. Both directions are real bugs and a test can only
// catch one of them at a time, so the flag says which.
//
// Flipped on 2026-08-24, in the same commit as removing the meta tags, which is
// the only way the suite stays green: true with the tags still present fails
// five tests, and the tags gone with this false fails one.
export const SHIPPED = true;
const ORIGIN = "https://games.csiesheep.com";
const CANONICAL = ORIGIN + PREFIX + "/";

// This Worker is attached by path-scoped Routes, so it only ever sees requests
// under PREFIX — the host root (`/robots.txt`, `/sitemap.xml`, `/ads.txt`) is
// served by the games-hub Worker and never reaches us. Crawlers only honour
// robots.txt and ads.txt at the domain root, so those two stay the hub's job;
// what we can own is a prefix-scoped sitemap, linked from the hub's sitemap
// index or submitted to Search Console directly.
const PAGES = ["", "game", "rulebook", "tiles", "credits", "ledger"]; // "" = the menu / index
// Every page that carries a <link rel=canonical> belongs here and nothing else
// does. Tiles was missing, which is the failure mode a hand-kept list has: the
// page shipped, the canonical shipped, and the one line that tells a crawler it
// exists did not.

// Extensionless URLs: the static-asset handler 307s `/game.html` -> `/game`, so
// the bare form is where a crawler actually lands. Page <link rel=canonical>
// tags match these exactly. Internal hrefs keep `.html` so the site still works
// off a plain local static server, which has no such rewriting.
const SITEMAP_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  PAGES.map(
    (p) => "  <url>\n    <loc>" + CANONICAL + p + "</loc>\n  </url>\n"
  ).join("") +
  "</urlset>\n";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The leaderboard's verifier (#143). BEFORE the asset passthrough, because
    // /api/* is not a file and must never reach env.ASSETS — an unmatched asset
    // path 404s from the static handler, which would turn "the API is not wired"
    // into "that page does not exist" and cost somebody an afternoon.
    if (url.pathname === PREFIX + "/api/run") {
      return handleRun(request, env);
    }

    // The boards. One path segment names which, so adding a fourth board is a
    // line in BOARDS rather than a line here.
    const board = url.pathname.startsWith(PREFIX + "/api/board/")
      ? url.pathname.slice((PREFIX + "/api/board/").length)
      : null;
    if (board) return handleBoard(request, env, board);

    if (url.pathname === PREFIX + "/api/stats") {
      return handleStats(env);
    }

    if (url.pathname === PREFIX + "/sitemap.xml") {
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
      const response = await env.ASSETS.fetch(new Request(url, request));

      // The static-asset handler redirects .html requests to their
      // extensionless equivalent, but it builds Location from the url we just
      // stripped the prefix off - so /jiangshi_in_the_pocket/game.html points at
      // a bare /game, which escapes this Worker and 404s on the hub. Put the
      // prefix back on any same-origin redirect it hands us.
      const location = response.headers.get("location");
      if (location) {
        const target = new URL(location, url);
        if (
          target.origin === url.origin &&
          target.pathname !== PREFIX &&
          !target.pathname.startsWith(PREFIX + "/")
        ) {
          target.pathname = PREFIX + target.pathname;
          const headers = new Headers(response.headers);
          headers.set("location", target.toString());
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        }
      }

      return response;
    }

    return new Response("Not found", { status: 404 });
  },
};
