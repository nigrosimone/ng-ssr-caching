# Changelog

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
