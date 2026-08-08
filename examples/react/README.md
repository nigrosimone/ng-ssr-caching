# React SSR, cached

The weather app from [lissy93/framework-benchmarks](https://github.com/lissy93/framework-benchmarks/tree/main/apps/react) (MIT),
rendered on the server by Express and kept by `ng-ssr-caching`.

**[Open it on StackBlitz](https://stackblitz.com/github/nigrosimone/ng-ssr-caching/tree/main/examples/react)**, or here:

```bash
npm install
npm run dev
```

Then load the page twice and watch the `x-ssr-cache` header go from `MISS` to `HIT`. `/api/cache`
reports what the cache has been doing.

## What was changed, and why

The upstream app is client-side only: it fetches the weather in an effect, which never runs during
a server render. Rendered as it stands it would produce an empty shell, and an empty shell is
nothing to cache, so this example would demonstrate nothing.

So three things are different here:

- `src/entry-server.jsx` fetches the weather and renders the tree with it. That is what makes a
  render cost something worth saving: about 440 ms, most of it waiting on the weather API.
- The result is written into the page as `window.__SSR_STATE__`, and `src/main.jsx` hydrates from
  it, so the browser does not fetch what the server already has. Angular calls this the
  TransferState; React has no name for it and every application writes it out by hand.
- `WeatherService` lost its mock paths, which read `window` and `navigator` in the constructor and
  therefore could not run on a server at all.

## The part worth reading

`server.js`, and in it the two lines that matter:

```js
const cache = ssrCaching({ ttl: 30_000, earlyHints: true });
app.use(cache);
```

The `ttl` is short on purpose. This page carries live weather, and caching rendered HTML means
caching the data inside it, so the number comes from how stale the weather may be rather than from
how stable the markup is.
