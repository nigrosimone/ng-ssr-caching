# Changelog

## [22.3.0](https://github.com/nigrosimone/ng-ssr-caching/compare/v22.2.0...v22.3.0) (2026-11-12)

### 🚀 Features

- compress keeps a brotli and a gzip copy of a stored page, so a hit is not compressed again ([bc38b2a](https://github.com/nigrosimone/ng-ssr-caching/commit/bc38b2abe9cc088d3e1d15e7fe34e2c5976e416c))
- **test:** add more test ([f660dcb](https://github.com/nigrosimone/ng-ssr-caching/commit/f660dcb56213895bfdd00ba88f49e957c504adac))
- **test:** add more test ([4df5518](https://github.com/nigrosimone/ng-ssr-caching/commit/4df55182b87fa1bbbd49d8c13431766f7047b9a4))

### 📝 Documentation

- update section header for clarity in README ([ef8a9e7](https://github.com/nigrosimone/ng-ssr-caching/commit/ef8a9e70bf4195aecfb8a2998c4394a4da67be6b))
- the examples ship what they built, and serve it without a dev server ([333d0cf](https://github.com/nigrosimone/ng-ssr-caching/commit/333d0cfb738cfef58bf8abafc7d991a49507c69a))
- an angular example too, and both open on stackblitz ([8ec39fe](https://github.com/nigrosimone/ng-ssr-caching/commit/8ec39fe47466a84919c0bf2fad4c10f8bec7a50c))
- a runnable react example, ready to open on stackblitz ([77c56ca](https://github.com/nigrosimone/ng-ssr-caching/commit/77c56ca22d73302fef764d4fcce5025afec9725c))

### 🧹 Chores

- coverage ([14c9dc5](https://github.com/nigrosimone/ng-ssr-caching/commit/14c9dc5f4649e4ce7338de5085028babdd33a8b9))
- the angular dev server cache does not belong in the repo ([9b58ca7](https://github.com/nigrosimone/ng-ssr-caching/commit/9b58ca79f3dbe1ee654ced458d82b9252322b981))
- the example lockfile is not ours to format ([9b90df9](https://github.com/nigrosimone/ng-ssr-caching/commit/9b90df9a489f4c1fb926df2891e9856c90316445))

**Full Changelog**: https://github.com/nigrosimone/ng-ssr-caching/compare/v22.2.0...v22.3.0

## [22.2.0](https://github.com/nigrosimone/ng-ssr-caching/compare/v22.1.0...v22.2.0) (2026-08-08)

### 🚀 Features

- a miss can announce the page assets in a 103, and the pieces are exported ([636eea5](https://github.com/nigrosimone/ng-ssr-caching/commit/636eea52e2bb8307be1ed3f22ae8174696ec4b6d))

### 🧹 Chores

- typescript 6.0 ([5fb4cbe](https://github.com/nigrosimone/ng-ssr-caching/commit/5fb4cbe77b23e61b679db6311cb3b166391b8c4a))

**Full Changelog**: https://github.com/nigrosimone/ng-ssr-caching/compare/v22.1.0...v22.2.0

## [22.1.0](https://github.com/nigrosimone/ng-ssr-caching/compare/v22.0.0...v22.1.0) (2026-08-08)

### 🚀 Features

- refuse Authorization, named session cookies, and a Vary on either ([f325454](https://github.com/nigrosimone/ng-ssr-caching/commit/f3254548bd2dffd34b3cdc5424bc7f9ab62bc6be))

### 📝 Documentation

- update Fulmine link in README ([77a5b77](https://github.com/nigrosimone/ng-ssr-caching/commit/77a5b77303f06c2a17ba06d2eb617785bca561f7))
- update README ([bfe486f](https://github.com/nigrosimone/ng-ssr-caching/commit/bfe486fed58a849f748524fafd8a7eced9bc89a1))

### 🤖 CI

- release from the workflow npm trusts, with provenance ([01bdfce](https://github.com/nigrosimone/ng-ssr-caching/commit/01bdfce366d6998fdfe309478c835a1950cfa7fb))

**Full Changelog**: https://github.com/nigrosimone/ng-ssr-caching/compare/v22.0.0...v22.1.0

## 22.0.0

First release.

### 🚀 Features

- Caches server-rendered pages behind an Express middleware, so a page is rendered once and served
  from memory after that.
- The ETag and the Content-Length are computed when the page is stored and replayed from the entry,
  which is what keeps a hit from hashing the whole document again. Measured on a 28 KB Angular page:
  a hit costs 262µs on Express and 175µs on Fulmine, against 17.2ms for the render it replaces.
- Answers `304 Not Modified` when the client already holds the page.
- TTL with optional stale-while-revalidate, a bounded store with least-recently-served eviction, and
  a body-size ceiling above which a page is served but not remembered.
- `stats()`, `purge(key?)` and `keys()` on the middleware itself.

### 🛡️ Refusals, all deliberate

- Never stores a non-200, a response carrying `Set-Cookie`, or one whose `Cache-Control` says
  `no-store` or `private`.
- Never stores an already-compressed response. Response wrappers nest in reverse registration order,
  so a cache registered before `compression()` would capture gzip and replay it as HTML; it declines
  and says so once instead.
- `key` returning `null` bypasses the cache entirely, which is where a signed-in visitor belongs.

### ✅ Tested

- Thirteen cases, each run against Express and against Fulmine with the outputs compared, so the
  compatibility claim is a test rather than a sentence.
