// A React SSR server with the page cache in front of it.
//
// The point of the example is the two lines that add `ssrCaching`, and what the `x-ssr-cache`
// header says afterwards. Everything else is the ordinary Vite middleware-mode setup: this runs as
// a dev server so it starts in one step, which is what makes it work on StackBlitz.
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { readFileSync } from 'node:fs';
import { ssrCaching } from 'ng-ssr-caching';

const app = express();

const cache = ssrCaching({
  // short, because the page carries live weather: a cache of rendered HTML is a cache of the data
  // inside it, so the ttl is chosen from how stale the data may be, not from how stable the markup is
  ttl: 30_000,
  // announced on a miss, so the browser fetches the bundle while this server renders. Sent only
  // over HTTP/2, where browsers act on it, and a no-op elsewhere
  earlyHints: true,
});
app.use(cache);

// what the cache has been doing, so the page can show it without you opening devtools
app.get('/api/cache', (req, res) => res.json(cache.stats()));

const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' });
app.use(vite.middlewares);

app.use(async (req, res, next) => {
  try {
    const template = await vite.transformIndexHtml(
      req.originalUrl,
      readFileSync('./index.html', 'utf8'),
    );
    const { render } = await vite.ssrLoadModule('/src/entry-server.jsx');

    const city = new URL(req.originalUrl, 'http://localhost').searchParams.get('city') ?? 'London';
    const { html, state } = await render(city);

    res
      .status(200)
      .set('content-type', 'text/html; charset=utf-8')
      .end(template.replace('<!--ssr-->', html).replace('__SSR_STATE__', state));
  } catch (error) {
    vite.ssrFixStacktrace(error);
    next(error);
  }
});

const port = Number(process.env.PORT) || 5173;
app.listen(port, () => {
  console.log(`\n  ready on http://localhost:${port}`);
  console.log('  reload the page and watch the x-ssr-cache header go from MISS to HIT\n');
});
