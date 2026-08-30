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

const CACHE = "jiangshi-31b5c909";

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
  "./":                                     "a19d4f9d40",
  "index.html":                             "a19d4f9d40",
  "game.html":                              "82c6fec338",
  "rulebook.html":                          "b53d7ae608",
  "tiles.html":                             "754a7f2ed5",
  "credits.html":                           "067a6ba293",
  "manifest.webmanifest":                   "60800d6b98",
  "favicon.svg":                            "c839cd7868",
  "css/style.css":                          "5185adf152",
  "js/app.js":                              "c290f7283a",
  "js/eventstage.js":                       "386cb3320d",
  "js/engine.js":                           "c4aae264a7",
  "js/board.js":                            "7a0b1caaca",
  "js/night.js":                            "3b42429b66",
  "js/replay.js":                           "3f9cf7779b",
  "js/render.js":                           "fc5e18e1cb",
  "js/icons.js":                            "36c76d4f67",
  "js/audio.js":                            "3384e2df1e",
  "js/menu.js":                             "e53fb78a06",
  "js/tiles.js":                            "ab646b272a",
  "js/tilewords.js":                        "018a50b46a",
  "js/shell.js":                            "608d7d3c7d",
  "js/tally.js":                            "b48bede2e4",
  "js/epilogue.js":                         "21104192de",
  "js/lang.js":                             "1e7b3f3b4a",
  "js/langswitch.js":                       "a2493ab9de",
  "js/rulebook.js":                         "035594a5da",
  "js/credits.js":                          "e6cedc628e",
  "assets/icons.svg":                       "067a1aa6c8",
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
  "js/night.js",
  "js/replay.js",
  "js/render.js",
  "js/icons.js",
  "js/audio.js",
  "js/menu.js",
  "js/tiles.js",
  "js/tilewords.js",
  "js/shell.js",
  "js/tally.js",
  "js/epilogue.js",
  "js/lang.js",
  "js/langswitch.js",
  "js/rulebook.js",
  "js/credits.js",
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

// #84, AND THE ONLY THING IN THIS FILE THAT IS LOAD-BEARING FOR CORRECTNESS.
//
// A Response fetched through a redirect carries `redirected: true`. A service
// worker MAY NOT answer a navigation with one — the browser rejects it and
// shows its own error page instead. Production 307s every .html path to its
// clean URL (game.html -> game), so every document in SHELL came back
// redirected, was cached that way, and the cache-first handler then served it
// to a navigation. Players got "This site can't be reached" moving between
// pages; nothing errored anywhere, because caching a redirected response is
// perfectly legal and only USING it for a navigation is not.
//
// Rebuilding the response drops the flag. Done at the moment of storage rather
// than at the moment of use, so the cache cannot hold a poisoned entry at all
// — the bug becomes impossible rather than handled.
async function storable(res) {
  if (!res || !res.redirected) return res;
  return new Response(await res.blob(), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

// Every write to the cache goes through here. If a second call site is ever
// added that does not, #84 comes back.
function keep(cache, key, res) {
  return storable(res).then((safe) => cache.put(key, safe));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One at a time, not addAll: addAll is atomic, so one 404 would fail the
      // whole install and a missing optional file would cost everything.
      //
      // fetch + keep rather than cache.add, because cache.add stores whatever
      // the fetch returned — including the redirect that caused #84 — and
      // gives no opportunity to rebuild it.
      Promise.all(SHELL.map((url) =>
        fetch(url, { cache: "reload" })
          .then((res) => (res && res.ok ? keep(cache, url, res) : null))
          .catch(() => {})
      ))
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
            caches.open(CACHE).then((c) => keep(c, req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // NAVIGATIONS GO TO THE NETWORK FIRST (#84). Two reasons, and the second is
  // the one that matters.
  //
  // Documents are small and there are five of them, so the cost of asking is
  // low and a stale page is worse than a slow one — a rules fix reaches players
  // on the next tap rather than the launch after next.
  //
  // And a navigation request carries redirect mode "manual", so a 307 comes
  // back as an opaqueredirect that respondWith may hand to the browser to
  // follow. That is the correct way to serve a path production redirects, and
  // it is why this arm cannot reproduce #84 even if the cache were poisoned.
  // The offline fallback still leans on `keep` above to have stored something
  // usable, so this is defence in depth rather than the fix.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => keep(c, req, copy));
          }
          return res;
        })
        // Offline. Whatever is stored for this document, and the start page if
        // this one was never visited — better the game's own shell than the
        // browser's error.
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // Everything else in the shell: cache first, and refill in the background so
  // the next launch is current without this one waiting on the network.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => keep(c, req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
