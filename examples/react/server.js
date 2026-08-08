// React SSR on Express, with the page cache in front of the render.
//
// This is the production shape: it serves what `npm run build` produced and imports the built
// render. No dev server in the way, so the cost of a render is the real one and the code below is
// the code you would deploy.
import express from 'express';
import { readFileSync } from 'node:fs';
import { ssrCaching } from 'ng-ssr-caching';
import { render } from './dist/server/entry-server.js';

const template = readFileSync('./dist/client/index.html', 'utf8');
const app = express();

const cache = ssrCaching({
  // short on purpose: this page carries live weather, and caching rendered HTML means caching the
  // data inside it. The number comes from how stale the weather may be, not from how stable the
  // markup is.
  ttl: 30_000,
  // announced on a miss, so the browser fetches the bundle while this server renders. Browsers only
  // act on a 103 over HTTP/2, so over plain HTTP this does nothing and stats().hinted says so.
  earlyHints: true,
});

// before the cache, or it would be cached itself and count as a miss of its own
app.get('/api/cache', (req, res) => res.json(cache.stats()));

app.use(cache);
app.use(express.static('dist/client', { index: false }));

app.use(async (req, res, next) => {
  try {
    const city = new URL(req.originalUrl, 'http://localhost').searchParams.get('city') ?? 'London';
    const { html, state } = await render(city);
    res
      .status(200)
      .set('content-type', 'text/html; charset=utf-8')
      .end(template.replace('<!--ssr-->', html).replace('__SSR_STATE__', state));
  } catch (error) {
    next(error);
  }
});

const port = Number(process.env.PORT) || 5173;
app.listen(port, () => {
  console.log(`\n  ready on http://localhost:${port}`);
  console.log('  reload the page and watch the x-ssr-cache header go from MISS to HIT\n');
});
