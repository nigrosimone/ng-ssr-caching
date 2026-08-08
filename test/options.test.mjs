// The options the readme lists, and the moments a page stops being servable. Same rule as the file
// beside this one: a case is only believed when express and fulmine answer the same thing.

import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { both, renderer } from './helpers.mjs';
import { weakEtag } from '../dist/esm/index.js';

const { counter, page, reset } = renderer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the validator ------------------------------------------------------------------------------

test('weakEtag is the validator express would have produced', async () => {
  // No cache in front here. Express hashes the document on every request and this package hashes it
  // once at store time, so the two have to produce the same string or a hit would hand the client a
  // validator it has never seen and the 304 below would never happen.
  const bodies = ['x', '<html><body>hello</body></html>', 'ünïcode 🌦️ '.repeat(64)];
  const app = express();
  app.get('/:i', (req, res) => res.type('html').send(bodies[Number(req.params.i)]));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;

  for (const [i, body] of bodies.entries()) {
    const response = await fetch(`http://localhost:${port}/${i}`);
    await response.text();
    assert.strictEqual(weakEtag(Buffer.from(body)), response.headers.get('etag'), `body #${i}`);
  }
  server.close();
});

test('an empty body has a validator too, and it is the well-known one', () => {
  assert.strictEqual(weakEtag(Buffer.alloc(0)), 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"');
  // the same page always hashes to the same thing, and two different ones do not collide
  assert.strictEqual(weakEtag(Buffer.from('page')), weakEtag(Buffer.from('page')));
  assert.notStrictEqual(weakEtag(Buffer.from('page')), weakEtag(Buffer.from('pagf')));
});

// --- reading the Cookie header ------------------------------------------------------------------

both(
  'a cookie header that is malformed, or missing altogether',
  // With bypassCookies configured, every request goes through the parser, including the ones that
  // carry nothing and the ones that carry nonsense. Getting this wrong in either direction is a
  // leak or a cache that never fills, so the odd shapes are worth naming.
  { ttl: 60_000, bypassCookies: ['session'] },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      // the common case on a cookie-configured application: a visitor who has none yet
      const none = await get('/page');
      await none.text();
      // a segment with no `=` at all is a name with an empty value, not a parse error
      const flag = await get('/page', { headers: { cookie: 'justaflag' } });
      await flag.text();
      // empty segments, from a trailing or doubled semicolon
      const empty = await get('/page', { headers: { cookie: ';;theme=dark;' } });
      await empty.text();
      // and the one that matters: a valueless cookie is still a cookie by that name
      const valueless = await get('/page', { headers: { cookie: 'session' } });
      await valueless.text();
      // whitespace around the name is the header's, not the name's
      const spaced = await get('/page', { headers: { cookie: 'ga=1;   session=alice' } });
      await spaced.text();

      return {
        rendered: counter.rendered,
        noneMark: none.headers.get('x-ssr-cache'),
        flagMark: flag.headers.get('x-ssr-cache'),
        emptyMark: empty.headers.get('x-ssr-cache'),
        valuelessMark: valueless.headers.get('x-ssr-cache'),
        spacedMark: spaced.headers.get('x-ssr-cache'),
        entries: cache.stats().entries,
      };
    },
    expect: {
      // one render for the miss, one each for the two that bypassed
      rendered: 3,
      noneMark: 'MISS',
      flagMark: 'HIT',
      emptyMark: 'HIT',
      valuelessMark: 'BYPASS',
      spacedMark: 'BYPASS',
      entries: 1,
    },
  },
);

// --- who decides what is stored -------------------------------------------------------------------

both(
  'shouldCache has the last word, after the built-in refusals',
  {
    ttl: 60_000,
    // the handler says so on the way out, which is the only thing both servers spell the same way
    shouldCache: (req, res) => res.getHeader('x-draft') !== 'yes',
  },
  {
    setup(app) {
      app.get(
        '/draft',
        page((req, res) => res.setHeader('x-draft', 'yes')),
      );
      app.get('/published', page());
    },
    async run({ get, cache }) {
      reset();
      await (await get('/draft')).text();
      const draftAgain = await get('/draft');
      await draftAgain.text();
      await (await get('/published')).text();
      const publishedAgain = await get('/published');
      await publishedAgain.text();
      return {
        rendered: counter.rendered,
        draftMark: draftAgain.headers.get('x-ssr-cache'),
        publishedMark: publishedAgain.headers.get('x-ssr-cache'),
        keys: cache.keys(),
      };
    },
    expect: {
      rendered: 3,
      draftMark: 'MISS',
      publishedMark: 'HIT',
      keys: ['GET /published'],
    },
  },
);

both(
  'private is refused, and no-cache is not, because it is not the same instruction',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get(
        '/personal',
        page((req, res) => res.setHeader('cache-control', 'private, max-age=0')),
      );
      // no-cache means "ask me before reusing it", not "do not keep it": the entry is stored, and
      // the directive is replayed so the client still knows to revalidate
      app.get(
        '/revalidated',
        page((req, res) => res.setHeader('cache-control', 'no-cache, must-revalidate')),
      );
    },
    async run({ get, cache }) {
      reset();
      await (await get('/personal')).text();
      const personal = await get('/personal');
      await personal.text();
      await (await get('/revalidated')).text();
      const revalidated = await get('/revalidated');
      await revalidated.text();
      return {
        rendered: counter.rendered,
        personalMark: personal.headers.get('x-ssr-cache'),
        revalidatedMark: revalidated.headers.get('x-ssr-cache'),
        revalidatedControl: revalidated.headers.get('cache-control'),
        keys: cache.keys(),
      };
    },
    expect: {
      rendered: 3,
      personalMark: 'MISS',
      revalidatedMark: 'HIT',
      revalidatedControl: 'no-cache, must-revalidate',
      keys: ['GET /revalidated'],
    },
  },
);

both(
  'a header the handler set is replayed only if it belongs to the page',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get(
        '/page',
        page((req, res) => {
          res.setHeader('content-language', 'it');
          res.setHeader('link', '</styles.css>; rel=preload; as=style');
          res.setHeader('vary', 'accept-encoding');
          // not in the replay list: a hit does not carry it, which is worth knowing before you set
          // a security header inside the render rather than in a middleware in front of this one
          res.setHeader('x-rendered-by', 'the handler');
        }),
      );
    },
    async run({ get }) {
      const first = await get('/page');
      await first.text();
      const hit = await get('/page');
      await hit.text();
      return {
        mark: hit.headers.get('x-ssr-cache'),
        contentLanguage: hit.headers.get('content-language'),
        link: hit.headers.get('link'),
        vary: hit.headers.get('vary'),
        custom: hit.headers.get('x-rendered-by'),
        firstCustom: first.headers.get('x-rendered-by'),
      };
    },
    expect: {
      mark: 'HIT',
      contentLanguage: 'it',
      link: '</styles.css>; rel=preload; as=style',
      vary: 'accept-encoding',
      custom: null,
      firstCustom: 'the handler',
    },
  },
);

// --- what the cache says about itself ---------------------------------------------------------

both(
  'header false says nothing at all, and still caches',
  { ttl: 60_000, header: false },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      await (await get('/page')).text();
      const second = await get('/page');
      return {
        rendered: counter.rendered,
        mark: second.headers.get('x-ssr-cache'),
        body: await second.text(),
        entries: cache.stats().entries,
      };
    },
    expect: {
      rendered: 1,
      mark: null,
      body: '<html><body>rendered /page</body></html>',
      entries: 1,
    },
  },
);

both(
  'the header can be called something else',
  { ttl: 60_000, header: 'x-page-cache' },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get }) {
      await (await get('/page')).text();
      const second = await get('/page');
      await second.text();
      return {
        named: second.headers.get('x-page-cache'),
        default: second.headers.get('x-ssr-cache'),
      };
    },
    expect: { named: 'HIT', default: null },
  },
);

both(
  'stats and keys report what happened, step by step',
  { ttl: 60_000, maxEntries: 2 },
  {
    setup(app) {
      app.get('/a', page());
      app.get('/b', page());
      app.get('/c', page());
    },
    async run({ get, cache }) {
      await (await get('/a')).text();
      const afterMiss = cache.stats();

      // the validator only exists on a hit: a miss is the handler's own response, and these
      // servers have their own etag turned off
      const hit = await get('/a');
      await hit.text();
      const etag = hit.headers.get('etag');
      await (await get('/a', { headers: { 'if-none-match': etag } })).text();
      const afterHits = cache.stats();

      await (await get('/b')).text();
      await (await get('/a')).text(); // touched, so /b is the least recently served
      await (await get('/c')).text(); // three pages, room for two
      const afterEviction = cache.stats();

      return {
        afterMiss: { ...afterMiss },
        hit: afterHits.hit,
        notModified: afterHits.notModified,
        afterEviction: { ...afterEviction },
        keys: cache.keys(),
        purged: cache.purge(),
        purgedUnknown: cache.purge('GET /nowhere'),
        finally: cache.stats().entries,
      };
    },
    expect: {
      afterMiss: {
        hit: 0,
        stale: 0,
        miss: 1,
        stored: 1,
        evicted: 0,
        notModified: 0,
        entries: 1,
        hinted: 0,
      },
      hit: 2,
      notModified: 1,
      afterEviction: {
        hit: 3,
        stale: 0,
        miss: 3,
        stored: 3,
        evicted: 1,
        notModified: 1,
        entries: 2,
        hinted: 0,
      },
      keys: ['GET /a', 'GET /c'],
      purged: 2,
      purgedUnknown: 0,
      finally: 0,
    },
  },
);

// --- when a page stops being servable -----------------------------------------------------------

both(
  'past the ttl with no stale window, the page is rendered again',
  { ttl: 30 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      await (await get('/page')).text();
      await sleep(80);
      const expired = await get('/page');
      await expired.text();
      const again = await get('/page');
      await again.text();
      return {
        rendered: counter.rendered,
        expiredMark: expired.headers.get('x-ssr-cache'),
        // the fresh render replaced the dead entry rather than piling up beside it
        againMark: again.headers.get('x-ssr-cache'),
        entries: cache.stats().entries,
        stale: cache.stats().stale,
      };
    },
    expect: { rendered: 2, expiredMark: 'MISS', againMark: 'HIT', entries: 1, stale: 0 },
  },
);

both(
  'past the stale window too, the entry is gone rather than stale',
  { ttl: 20, staleWhileRevalidate: 20 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      await (await get('/page')).text();
      await sleep(120);
      const dead = await get('/page');
      await dead.text();
      return {
        rendered: counter.rendered,
        mark: dead.headers.get('x-ssr-cache'),
        stats: { ...cache.stats() },
      };
    },
    expect: {
      rendered: 2,
      mark: 'MISS',
      stats: {
        hit: 0,
        stale: 0,
        miss: 2,
        stored: 2,
        evicted: 0,
        notModified: 0,
        entries: 1,
        hinted: 0,
      },
    },
  },
);

both(
  'a stale hit is served once: the entry goes, so the next request renders',
  { ttl: 20, staleWhileRevalidate: 60_000 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      await (await get('/page')).text();
      await sleep(60);
      const stale = await get('/page');
      await stale.text();
      const after = await get('/page');
      await after.text();
      return {
        rendered: counter.rendered,
        staleMark: stale.headers.get('x-ssr-cache'),
        afterMark: after.headers.get('x-ssr-cache'),
        stale: cache.stats().stale,
      };
    },
    // Serving stale drops the entry and lets this request render, so nobody is served the same
    // stale page twice. The visitor who got it did not wait for the render; the next one gets the
    // new page.
    expect: { rendered: 2, staleMark: 'STALE', afterMark: 'MISS', stale: 1 },
  },
);

// --- conditional requests -------------------------------------------------------------------------

both(
  'if-none-match is a list, and a validator that is not in it gets the page',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      await (await get('/page')).text();
      const hit = await get('/page');
      await hit.text();
      const etag = hit.headers.get('etag');

      const inAList = await get('/page', {
        headers: { 'if-none-match': `W/"deadbeef", ${etag}, W/"cafe"` },
      });
      const staleValidator = await get('/page', { headers: { 'if-none-match': 'W/"deadbeef"' } });

      return {
        listStatus: inAList.status,
        listBody: (await inAList.text()).length,
        listMark: inAList.headers.get('x-ssr-cache'),
        mismatchStatus: staleValidator.status,
        mismatchBody: await staleValidator.text(),
        mismatchMark: staleValidator.headers.get('x-ssr-cache'),
        notModified: cache.stats().notModified,
      };
    },
    expect: {
      listStatus: 304,
      listBody: 0,
      listMark: 'HIT',
      mismatchStatus: 200,
      mismatchBody: '<html><body>rendered /page</body></html>',
      mismatchMark: 'HIT',
      notModified: 1,
    },
  },
);

// --- keys and methods -----------------------------------------------------------------------------

both(
  'a custom key decides what counts as the same page',
  // the query string is a tracking parameter here, not a different page
  { ttl: 60_000, key: (req) => `GET ${(req.originalUrl ?? req.url).split('?')[0]}` },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      const first = await get('/page?utm_source=one');
      const firstBody = await first.text();
      const second = await get('/page?utm_source=two');
      return {
        rendered: counter.rendered,
        mark: second.headers.get('x-ssr-cache'),
        // the second visitor gets the page rendered for the first url, which is the point
        sameBody: (await second.text()) === firstBody,
        keys: cache.keys(),
      };
    },
    expect: { rendered: 1, mark: 'HIT', sameBody: true, keys: ['GET /page'] },
  },
);

both(
  'methods decides what is eligible, and everything else bypasses',
  { ttl: 60_000, methods: ['GET'] },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      await (await get('/page')).text();
      const head = await get('/page', { method: 'HEAD' });
      await head.text();
      return {
        rendered: counter.rendered,
        headMark: head.headers.get('x-ssr-cache'),
        keys: cache.keys(),
      };
    },
    expect: { rendered: 2, headMark: 'BYPASS', keys: ['GET /page'] },
  },
);

both(
  'HEAD is cached under its own key and answered without a body',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      reset();
      await (await get('/page')).text();
      // from a hit, so the validator is the cache's own rather than the handler's absent one
      const pageHit = await get('/page');
      const pageLength = pageHit.headers.get('content-length');
      const pageEtag = pageHit.headers.get('etag');
      await pageHit.text();
      const firstHead = await get('/page', { method: 'HEAD' });
      const secondHead = await get('/page', { method: 'HEAD' });
      return {
        // the default key is the method and the url, so a HEAD does not read the GET's entry and
        // renders once of its own before it starts hitting
        rendered: counter.rendered,
        status: secondHead.status,
        firstMark: firstHead.headers.get('x-ssr-cache'),
        secondMark: secondHead.headers.get('x-ssr-cache'),
        firstBody: (await firstHead.text()).length,
        secondBody: (await secondHead.text()).length,
        // RFC 9110 §8.6: a Content-Length on a HEAD has to be the length the GET would have sent,
        // or not be there at all. The chunk is collected before node drops it for a HEAD, so the
        // entry holds the whole page and the length replayed from it is the GET's.
        cachedLength: secondHead.headers.get('content-length'),
        pageLength,
        // and the same validator as the GET, since it is the same page being described
        sameEtag: secondHead.headers.get('etag') === pageEtag,
        keys: cache.keys(),
      };
    },
    expect: {
      rendered: 2,
      status: 200,
      firstMark: 'MISS',
      secondMark: 'HIT',
      firstBody: 0,
      secondBody: 0,
      cachedLength: '40',
      pageLength: '40',
      sameEtag: true,
      keys: ['GET /page', 'HEAD /page'],
    },
  },
);

// --- bodies -----------------------------------------------------------------------------------

both(
  'a multi-byte page survives being cut in half mid-character',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/page', (req, res) => {
        counter.rendered++;
        res.setHeader('content-type', 'text/html;charset=UTF-8');
        const body = Buffer.from('<html><body>météo 🌦️ oggi</body></html>', 'utf8');
        // 14 lands inside the two bytes of the é, which is the kind of split a real stream makes
        res.write(body.subarray(0, 14));
        res.end(body.subarray(14));
      });
    },
    async run({ get }) {
      reset();
      const first = await get('/page');
      const firstBody = await first.text();
      const hit = await get('/page');
      const hitBody = await hit.text();
      return {
        rendered: counter.rendered,
        same: firstBody === hitBody,
        text: hitBody,
        // bytes, not characters: the emoji alone is four of them
        declared: hit.headers.get('content-length'),
        bytes: String(Buffer.byteLength(hitBody, 'utf8')),
      };
    },
    expect: {
      rendered: 1,
      same: true,
      text: '<html><body>météo 🌦️ oggi</body></html>',
      declared: String(Buffer.byteLength('<html><body>météo 🌦️ oggi</body></html>', 'utf8')),
      bytes: String(Buffer.byteLength('<html><body>météo 🌦️ oggi</body></html>', 'utf8')),
    },
  },
);

both(
  'pages rendered at the same time do not get each others bytes',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/slow/:n', async (req, res) => {
        counter.rendered++;
        // every render is still in flight when the next one starts, which is the only way the
        // wrappers could ever be shared. They are set on the response, so they are not.
        await sleep(40);
        res.setHeader('content-type', 'text/html;charset=UTF-8');
        res.end(`<html><body>page ${req.params.n}</body></html>`);
      });
    },
    async run({ get, cache }) {
      reset();
      const wanted = ['1', '2', '3', '4'];
      const bodies = await Promise.all(
        wanted.map((n) => get(`/slow/${n}`).then((response) => response.text())),
      );
      const hits = await Promise.all(
        wanted.map((n) =>
          get(`/slow/${n}`).then(async (response) => [
            response.headers.get('x-ssr-cache'),
            await response.text(),
          ]),
        ),
      );
      return {
        rendered: counter.rendered,
        eachIsItsOwn: bodies.every((b, i) => b === `<html><body>page ${wanted[i]}</body></html>`),
        hitsMatch: hits.every(([mark, body], i) => mark === 'HIT' && body === bodies[i]),
        // sorted: four renders in flight at once finish in whatever order they finish in, and
        // which one got there first is not what this is about. The eviction test is where order
        // is the point, and there the requests are one after another.
        keys: cache.keys().sort(),
      };
    },
    expect: {
      rendered: 4,
      eachIsItsOwn: true,
      hitsMatch: true,
      keys: ['GET /slow/1', 'GET /slow/2', 'GET /slow/3', 'GET /slow/4'],
    },
  },
);

both(
  'a render that fails is not a page, and is not kept',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/boom', () => {
        counter.rendered++;
        throw new Error('the render failed on purpose');
      });
    },
    async run({ get, cache }) {
      reset();
      const first = await get('/boom');
      await first.text();
      const second = await get('/boom');
      await second.text();
      return {
        rendered: counter.rendered,
        status: second.status,
        mark: second.headers.get('x-ssr-cache'),
        entries: cache.stats().entries,
        stored: cache.stats().stored,
      };
    },
    expect: { rendered: 2, status: 500, mark: 'MISS', entries: 0, stored: 0 },
  },
);
