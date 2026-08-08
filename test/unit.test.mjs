// The middleware asks very little of a response, and these tests give it exactly that and nothing
// else. Two reasons for going under the servers here.
//
// One: an HTTP/2 request. `earlyHints: true` only sends a 103 when the request arrived over HTTP/2,
// and express does not speak HTTP/2, so the only case tested through a server is the one where
// nothing is sent. The interesting half of that rule lives here.
//
// Two: the paths a well-behaved server never takes. A chunk of a type nobody expected, an end()
// called with a callback, a writeEarlyHints that throws, a shouldCache of your own that throws. A
// cache is allowed to give up on remembering a page; it is never allowed to take the page with it.

import test from 'node:test';
import assert from 'node:assert';
import { ssrCaching } from '../dist/esm/index.js';

/** Enough of a node response for what the middleware touches, and a record of what it did. */
function fakeResponse(extra = {}) {
  const headers = new Map();
  const res = {
    statusCode: 200,
    headersSent: false,
    written: [],
    ended: false,
    hints: [],
    getHeader: (name) => headers.get(name.toLowerCase()),
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
      return res;
    },
    write(chunk) {
      res.written.push(chunk);
      return true;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
        res.written.push(chunk);
      }
      res.ended = true;
      return res;
    },
    ...extra,
  };
  return res;
}

const request = (over = {}) => ({
  method: 'GET',
  url: '/page',
  headers: {},
  httpVersionMajor: 1,
  ...over,
});

/** Drives one request through the cache. Everything below is synchronous, so this can be too. */
function through(cache, req, render, res = fakeResponse()) {
  cache(req, res, () => render?.(req, res));
  return res;
}

const html = '<html><head><link rel="stylesheet" href="/s.css"></head><body>page</body></html>';
const renderHtml = (req, res) => {
  res.setHeader('content-type', 'text/html;charset=UTF-8');
  res.end(html);
};

// --- 103 Early Hints, the half a server cannot show ---------------------------------------------

test('over HTTP/2 a miss carries the links, once a page has taught them', () => {
  const cache = ssrCaching({ ttl: 60_000, earlyHints: true });
  const hintsOn = () => {
    const res = fakeResponse();
    res.writeEarlyHints = (hints) => res.hints.push(hints);
    return res;
  };

  // nothing has been stored yet, so there is nothing honest to announce
  const first = through(
    cache,
    request({ url: '/one', httpVersionMajor: 2 }),
    renderHtml,
    hintsOn(),
  );
  assert.deepStrictEqual(first.hints, []);

  // a different page, so a miss again, and by now the links are known
  const second = through(
    cache,
    request({ url: '/two', httpVersionMajor: 2 }),
    renderHtml,
    hintsOn(),
  );
  assert.deepStrictEqual(second.hints, [{ link: ['</s.css>; rel=preload; as=style'] }]);
  assert.strictEqual(cache.stats().hinted, 1);

  // a hit has no render to overlap with, so it gets none
  const hit = through(cache, request({ url: '/two', httpVersionMajor: 2 }), renderHtml, hintsOn());
  assert.deepStrictEqual(hit.hints, []);
  assert.strictEqual(cache.stats().hinted, 1);
});

test('true means HTTP/2 only, always means whatever the proxy in front decided', () => {
  for (const [setting, expected] of [
    [true, 0],
    ['always', 1],
  ]) {
    const cache = ssrCaching({ ttl: 60_000, earlyHints: setting });
    const hintsOn = () => {
      const res = fakeResponse();
      res.writeEarlyHints = (hints) => res.hints.push(hints);
      return res;
    };
    through(cache, request({ url: '/one' }), renderHtml, hintsOn());
    const second = through(cache, request({ url: '/two' }), renderHtml, hintsOn());
    assert.strictEqual(cache.stats().hinted, expected, `earlyHints: ${setting}`);
    assert.strictEqual(second.hints.length, expected);
  }
});

test('a server with no writeEarlyHints is simply not asked', () => {
  const cache = ssrCaching({ ttl: 60_000, earlyHints: 'always' });
  through(cache, request({ url: '/one' }), renderHtml);
  const second = through(cache, request({ url: '/two' }), renderHtml);
  assert.strictEqual(second.ended, true);
  assert.strictEqual(cache.stats().hinted, 0);
});

test('a writeEarlyHints that throws costs the hint and not the page', () => {
  const cache = ssrCaching({ ttl: 60_000, earlyHints: 'always' });
  const refusing = () => {
    const res = fakeResponse();
    res.writeEarlyHints = () => {
      throw new Error('this socket will not take an informational response');
    };
    return res;
  };
  through(cache, request({ url: '/one' }), renderHtml, refusing());
  const second = through(cache, request({ url: '/two' }), renderHtml, refusing());
  assert.strictEqual(second.ended, true);
  assert.strictEqual(String(second.written[0]), html);
  assert.strictEqual(cache.stats().hinted, 0);
});

test('links are learned from a page, not from whatever was stored first', () => {
  const cache = ssrCaching({ ttl: 60_000, earlyHints: 'always' });
  const hintsOn = () => {
    const res = fakeResponse();
    res.writeEarlyHints = (hints) => res.hints.push(hints);
    return res;
  };

  // json, and json that happens to contain a link tag in a string at that
  through(
    cache,
    request({ url: '/api/data' }),
    (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"snippet":"<link rel=\\"stylesheet\\" href=\\"/nope.css\\">"}');
    },
    hintsOn(),
  );
  const afterJson = through(cache, request({ url: '/other' }), renderHtml, hintsOn());
  assert.deepStrictEqual(afterJson.hints, [], 'a json response taught it nothing');

  // and now that an html page has been through, the links are the html page's
  const afterHtml = through(cache, request({ url: '/third' }), renderHtml, hintsOn());
  assert.deepStrictEqual(afterHtml.hints, [{ link: ['</s.css>; rel=preload; as=style'] }]);
});

// --- giving up on remembering, without giving up on the response --------------------------------

test('a chunk of a type this does not understand is passed on, and the page is not stored', () => {
  const cache = ssrCaching({ ttl: 60_000 });
  const odd = { toString: () => 'not a buffer and not a string' };
  const res = through(cache, request(), (req, response) => {
    response.setHeader('content-type', 'text/html');
    response.write('<html>');
    response.write(odd);
    response.end('</html>');
  });

  assert.deepStrictEqual(res.written, ['<html>', odd, '</html>'], 'everything reached the socket');
  assert.strictEqual(cache.stats().stored, 0);
  assert.deepStrictEqual(cache.keys(), []);
});

test('a typed array is a body like any other', () => {
  const cache = ssrCaching({ ttl: 60_000 });
  const bytes = new Uint8Array(Buffer.from('<html>bytes</html>', 'utf8'));
  through(cache, request(), (req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(bytes);
  });
  assert.deepStrictEqual(cache.keys(), ['GET /page']);

  const hit = through(cache, request());
  assert.strictEqual(hit.getHeader('x-ssr-cache'), 'HIT');
  assert.strictEqual(hit.written[0].toString('utf8'), '<html>bytes</html>');
  assert.strictEqual(hit.getHeader('content-length'), '18');
});

test('end(callback) is a callback, not the last chunk of the page', () => {
  const cache = ssrCaching({ ttl: 60_000 });
  let called = false;
  const callback = () => (called = true);
  const res = fakeResponse({
    end(chunk) {
      if (typeof chunk === 'function') chunk();
      else if (chunk !== undefined && chunk !== null) res.written.push(chunk);
      res.ended = true;
      return res;
    },
  });
  through(
    cache,
    request(),
    (req, response) => {
      response.setHeader('content-type', 'text/html');
      response.write('<html>page</html>');
      response.end(callback);
    },
    res,
  );

  assert.strictEqual(called, true, 'the callback still ran');
  const hit = through(cache, request());
  assert.strictEqual(hit.written[0].toString('utf8'), '<html>page</html>');
});

test('a page that outgrows maxBodyBytes mid-stream lets go of what it had', () => {
  const cache = ssrCaching({ ttl: 60_000, maxBodyBytes: 64 });
  const res = through(cache, request(), (req, response) => {
    response.setHeader('content-type', 'text/html');
    for (let i = 0; i < 10; i++) response.write('x'.repeat(16));
    response.end();
  });

  assert.strictEqual(res.written.join('').length, 160, 'the whole page went out');
  assert.strictEqual(cache.stats().stored, 0);
  assert.deepStrictEqual(cache.keys(), []);
});

test('a shouldCache of your own that throws does not take the response with it', () => {
  const cache = ssrCaching({
    ttl: 60_000,
    shouldCache: () => {
      throw new Error('a policy that is wrong about itself');
    },
  });
  const res = through(cache, request(), renderHtml);
  assert.strictEqual(res.ended, true);
  assert.strictEqual(res.written[0], html);
  assert.strictEqual(cache.stats().stored, 0);
});

// --- the refusals a server does not make it easy to reach ---------------------------------------

test('a Vary of * or Authorization is refused, like Cookie', () => {
  for (const vary of ['*', 'Authorization', 'Accept-Encoding, Cookie', 'cookie']) {
    const cache = ssrCaching({ ttl: 60_000 });
    through(cache, request(), (req, res) => {
      res.setHeader('content-type', 'text/html');
      res.setHeader('vary', vary);
      res.end(html);
    });
    assert.deepStrictEqual(cache.keys(), [], `vary: ${vary}`);
  }

  // and one that is only about the bytes on the wire is not a refusal
  const cache = ssrCaching({ ttl: 60_000 });
  through(cache, request(), (req, res) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('vary', 'Accept-Encoding, Accept-Language');
    res.end(html);
  });
  assert.deepStrictEqual(cache.keys(), ['GET /page']);
});

test('originalUrl is what the default key reads, so a mounted app keys on the whole path', () => {
  const cache = ssrCaching({ ttl: 60_000 });
  // express rewrites req.url under app.use('/shop', …) and keeps the full path on originalUrl;
  // keying on the rewritten one would collapse two different pages into one entry
  through(cache, request({ url: '/page', originalUrl: '/shop/page' }), renderHtml);
  assert.deepStrictEqual(cache.keys(), ['GET /shop/page']);
});

test('a hit is served without asking the handler, even when the handler would have failed', () => {
  const cache = ssrCaching({ ttl: 60_000 });
  through(cache, request(), renderHtml);

  let ran = false;
  const hit = through(cache, request(), () => (ran = true));
  assert.strictEqual(ran, false);
  assert.strictEqual(hit.getHeader('x-ssr-cache'), 'HIT');
  assert.strictEqual(hit.getHeader('content-type'), 'text/html;charset=UTF-8');
  assert.strictEqual(hit.getHeader('content-length'), String(Buffer.byteLength(html)));
  assert.match(String(hit.getHeader('etag')), /^W\/"/);
});

// --- the defaults, and a request that barely is one ---------------------------------------------

test('ssrCaching() with nothing passed to it is the table in the readme', () => {
  const cache = ssrCaching();

  through(cache, request(), renderHtml);
  const hit = through(cache, request());
  // header defaults to x-ssr-cache, ttl to a minute, so this is still fresh
  assert.strictEqual(hit.getHeader('x-ssr-cache'), 'HIT');
  // the key defaults to the method and the url
  assert.deepStrictEqual(cache.keys(), ['GET /page']);
  // methods defaults to GET and HEAD, so a POST is not eligible
  const posted = through(cache, request({ method: 'POST' }), renderHtml);
  assert.strictEqual(posted.getHeader('x-ssr-cache'), 'BYPASS');
  // and early hints are off, so nothing was announced even though a page has been stored
  assert.strictEqual(cache.stats().hinted, 0);
});

test('a request that says almost nothing is still given a key', () => {
  // node always fills both of these in. The default key does not rely on that.
  const noUrl = ssrCaching({ ttl: 60_000 });
  through(noUrl, { method: 'GET', headers: {} }, renderHtml);
  assert.deepStrictEqual(noUrl.keys(), ['GET /']);

  const noMethod = ssrCaching({ ttl: 60_000 });
  const res = through(noMethod, { headers: {}, url: '/page' }, renderHtml);
  // a missing method is a GET to the eligibility check, so it has to be a GET to the key as well:
  // read one way there and another way here, the entry would be filed under a name no later
  // request could produce, and the page would be stored once per visit and served to nobody
  assert.strictEqual(res.getHeader('x-ssr-cache'), 'MISS');
  assert.deepStrictEqual(noMethod.keys(), ['GET /page']);

  // and the two now agree well enough to hit
  const hit = through(noMethod, { headers: {}, url: '/page' });
  assert.strictEqual(hit.getHeader('x-ssr-cache'), 'HIT');
});
