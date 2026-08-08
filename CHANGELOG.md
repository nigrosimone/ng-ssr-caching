# Changelog

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
