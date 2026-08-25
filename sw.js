// Service worker. The game is entirely static, so full offline play costs
// nothing but care about the update path.
//
// CACHE IS DERIVED, NOT CHOSEN. It is a hash of the shell's blobs, written by
// tools/record_shell.py — run that after committing a shell change and commit
// sw.js with it. Do not edit the name: tests/shell.test.js recomputes the
// derivation and a hand-typed one fails.
//
// The name is still the version, and that is the failure mode worth designing
// against: a new deploy fills a new cache and activate deletes every older one,
// so nobody is stranded on a stale shell. A cache-first worker with one
// immortal name means players keep a build forever and every later fix is
// invisible to them.
//
// It used to be a number a person picked, and twice two branches independently
// picked the same one for different shells — both correct, both internally
// consistent, both green. A counter cannot see that. A hash of the content
// cannot collide by accident, and nobody has to remember to increment it.
//
// The prefix has to be unique per game, and that is not cosmetic. Every game on
// games.csiesheep.com shares one origin, and Cache Storage is partitioned by
// origin rather than by path — so the sibling's worker sees this cache in
// caches.keys() too. Since activate deletes every name that is not its own, two
// games sharing a prefix would evict each other on every visit: offline play
// broken on both, and the whole shell re-fetched each time. Keep "jiangshi-".

const CACHE = "jiangshi-1f0f2fc7";

// A fingerprint of every file in SHELL, checked by tests/shell.test.js.
//
// The rule this replaced — bump CACHE when anything in SHELL changes — was
// true and documented at the top of this file and got missed anyway (#28),
// because the coupling runs from the file you are editing to a file you have no
// reason to open. So it is a failing test now instead of a sentence.
//
// Hashed from the BLOBS (git show HEAD:), not the working tree. This project
// was fingerprinting a CRLF checkout while git stores and the CDN serve LF, so
// the record described bytes no player was ever sent and flipped by worktree.
// The blob is the same on every machine, which matters more now that the cache
// name is derived from these hashes: a working-tree-derived name would differ
// per machine for identical content and evict every player's cache on each
// deploy, silently.
//
// Generated. Run tools/record_shell.py rather than editing by hand.
//
// Only SHELL is covered. data/ and assets/audio/ are served network first (see
// RUNTIME below), so they reach players without a bump; it is the cache-first
// shell that goes stale, and a new tiles.json against an old engine.js is
// exactly the mismatch #28 shipped.
const SHELL_DIGEST = {
  "./":                                     "0e80592383",
  "index.html":                             "0e80592383",
  "game.html":                              "9445dfbf79",
  "rulebook.html":                          "76baac288c",
  "tiles.html":                             "4223b8bd14",
  "credits.html":                           "44405f11d9",
  "manifest.webmanifest":                   "60800d6b98",
  "favicon.svg":                            "6c904341b6",
  "css/style.css":                          "2d43a280be",
  "js/app.js":                              "3c0e819335",
  "js/eventstage.js":                       "9b2b92a8d9",
  "js/engine.js":                           "07ae6d5cf9",
  "js/board.js":                            "766fddc50b",
  "js/render.js":                           "0401438c07",
  "js/audio.js":                            "048485f39d",
  "js/menu.js":                             "8430882653",
  "js/tiles.js":                            "50b050f809",
  "js/shell.js":                            "6ef98e1c6c",
  "js/tally.js":                            "6d9c240fc0",
  "js/epilogue.js":                         "a0348584ac",
  "js/lang.js":                             "1e7b3f3b4a",
  "js/rulebook.js":                         "11dd15125f",
  "assets/icons.svg":                       "de08aa097b",
  "assets/fonts/imfellenglish-latin.woff2": "248300df16",
  "assets/icons/icon-192.png":              "83b7d80dc2",
  "assets/icons/icon-512.png":              "8114a3228c",
  "assets/icons/icon-192-maskable.png":     "62f6319064",
  "assets/icons/icon-512-maskable.png":     "2ac5be310e",
};

// Everything needed to open the game with no network. Relative paths on
// purpose: this ships under a subpath (…/jiangshi_in_the_pocket/) and absolute
// ones would silently point at the domain root.
const SHELL = [
  "./",
  "index.html",
  "game.html",
  "rulebook.html",
  "tiles.html",
  "credits.html",
  "manifest.webmanifest",
  "favicon.svg",
  "css/style.css",
  "js/app.js",
  "js/eventstage.js",
  "js/engine.js",
  "js/board.js",
  "js/render.js",
  "js/audio.js",
  "js/menu.js",
  "js/tiles.js",
  "js/shell.js",
  "js/tally.js",
  "js/epilogue.js",
  "js/lang.js",
  "js/rulebook.js",
  "assets/icons.svg",
  "assets/fonts/imfellenglish-latin.woff2",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  // Both shapes, not just the plain pair. An installed app that goes offline
  // and re-reads its icon should find the one the launcher actually uses, and
  // a maskable icon is what every Android launcher asks for first.
  "assets/icons/icon-192-maskable.png",
  "assets/icons/icon-512-maskable.png",
];

// Data and audio are fetched at runtime and cached as they are used, rather
// than listed above: a first visit should not pay for twelve audio files it may
// never hear, and install must not fail because one optional file 404s.
const RUNTIME = /\/(data|assets\/audio)\//;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll is atomic — one 404 fails the whole install — so each file is
      // added on its own and a missing optional one costs only itself.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch anything off-site

  // The app.js data fetches ask for `no-cache` deliberately: a re-theme or a
  // rules fix has to reach players who already have the old JSON. Honour that
  // through the worker — network first, cache only as the fallback — or the
  // caching layer would quietly undo the revalidation it was designed around.
  const wantsRevalidation = req.cache === "no-cache" || req.cache === "reload";

  if (wantsRevalidation || RUNTIME.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // The shell: cache first, and refill in the background so the next launch is
  // current without this one waiting on the network.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
