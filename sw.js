// Service worker. The game is entirely static, so full offline play costs
// nothing but care about the update path.
//
// Bump CACHE when anything in SHELL changes. The name is the version: a new
// deploy fills a new cache, and activate deletes every older one, so nobody is
// stranded on a stale shell. That is the failure mode worth designing against —
// a cache-first worker with one immortal cache name means players keep a build
// forever and every later fix is invisible to them.
//
// The prefix has to be unique per game, and that is not cosmetic. Every game on
// games.csiesheep.com shares one origin, and Cache Storage is partitioned by
// origin rather than by path — so the sibling's worker sees this cache in
// caches.keys() too. Since activate deletes every name that is not its own, two
// games sharing a prefix would evict each other on every visit: offline play
// broken on both, and the whole shell re-fetched each time. Keep "jiangshi-".

const CACHE = "jiangshi-v28";

// A fingerprint of every file in SHELL, checked by tests/shell.test.js.
//
// The line four comments up — bump CACHE when anything in SHELL changes — was
// true and documented and got missed anyway (#28), because it lives in a file
// nobody opens to edit js/engine.js. So it is a failing test now instead of a
// sentence: change a shell file and the suite goes red until this block is
// updated, and updating it means being here, where the bump is.
//
// The version is part of the fingerprint on purpose. Pasting new hashes without
// bumping CACHE leaves the suite red, so the two cannot come apart.
//
// The test prints the replacement block on failure — do not compute it by hand.
//
// Only SHELL is covered. data/ and assets/audio/ are served network first (see
// RUNTIME below), so they reach players without a bump; it is the cache-first
// shell that goes stale, and a new tiles.json against an old engine.js is
// exactly the mismatch #28 shipped.
const SHELL_DIGEST = {
  "@cache":                                 "jiangshi-v28",
  "./":                                     "567fbcc1dc",
  "index.html":                             "567fbcc1dc",
  "game.html":                              "f4926f5f77",
  "rulebook.html":                          "ff98452d4c",
  "tiles.html":                             "4223b8bd14",
  "credits.html":                           "44405f11d9",
  "manifest.webmanifest":                   "60800d6b98",
  "favicon.svg":                            "b60eec3587",
  "css/style.css":                          "607cbe2a9a",
  "js/app.js":                              "4454b1ff5f",
  "js/eventstage.js":                       "591847c434",
  "js/engine.js":                           "8835b662d2",
  "js/board.js":                            "fa1ad58cb1",
  "js/render.js":                           "a5f4658c1e",
  "js/audio.js":                            "30cdbed084",
  "js/menu.js":                             "b264b1ff1a",
  "js/tiles.js":                            "2c0ee7043c",
  "js/shell.js":                            "0aa62a2190",
  "js/tally.js":                            "6d9c240fc0",
  "js/epilogue.js":                         "c08e0636d4",
  "js/lang.js":                             "1e7b3f3b4a",
  "js/rulebook.js":                         "11dd15125f",
  "assets/icons.svg":                       "8a5f0c9f43",
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
