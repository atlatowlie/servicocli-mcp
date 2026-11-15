/**
 * test/apiClient.test.js — exercises the HTTPS wrapper.
 *
 * We monkey-patch the global `fetch` import path indirectly by spinning
 * a real HTTP server on 127.0.0.1 and pointing SERVICO_API_BASE at it.
 * This catches more bugs than a mocked fetch (real network framing,
 * real header parsing, real content-type handling).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { FormData } from 'undici';

import {
  apiRequest, getApiKey, getApiBase, getTimeoutMs, ApiClientError, __internal,
} from '../src/apiClient.js';

const VALID_KEY = 'sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_abcd';

/**
 * Spin a tiny one-shot HTTP server and run `fn(base)` with the base URL.
 * Closes after fn resolves/rejects. Each test gets its own server so
 * state never leaks between cases.
 */
function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { handler(req, res, body); }
        catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { code: 'test_err', message: err.message } }));
        }
      });
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}/api/v1`;
      try {
        const out = await fn(base);
        server.close(() => resolve(out));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

// ─── Key format validation ────────────────────────────────────────────

test('getApiKey: throws when missing', () => {
  assert.throws(() => getApiKey({}), (e) => {
    return e instanceof ApiClientError && e.code === 'config_error'
      && /required/i.test(e.message);
  });
});

test('getApiKey: throws when malformed (wrong prefix)', () => {
  assert.throws(() => getApiKey({ SERVICO_API_KEY: 'pk_live_xxxx' }),
    (e) => e.code === 'config_error' && /malformed/i.test(e.message));
});

test('getApiKey: throws when malformed (wrong checksum length)', () => {
  // 3-hex checksum instead of 4
  const bad = 'sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_abc';
  assert.throws(() => getApiKey({ SERVICO_API_KEY: bad }),
    (e) => e.code === 'config_error');
});

test('getApiKey: accepts sk_live_ format', () => {
  const k = 'sk_live_AaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa_1234';
  assert.equal(getApiKey({ SERVICO_API_KEY: k }), k);
});

test('getApiKey: accepts sk_test_ format', () => {
  assert.equal(getApiKey({ SERVICO_API_KEY: VALID_KEY }), VALID_KEY);
});

test('getApiKey: rejects whitespace-padded key', () => {
  assert.throws(() => getApiKey({ SERVICO_API_KEY: ` ${VALID_KEY} ` }),
    (e) => e.code === 'config_error');
});

// ─── Base URL validation ───────────────────────────────────────────────

test('getApiBase: defaults to app.servicocrm.com', () => {
  assert.equal(getApiBase({}), 'https://app.servicocrm.com/api/v1');
});

test('getApiBase: trims trailing slashes', () => {
  assert.equal(getApiBase({ SERVICO_API_BASE: 'https://x.example.com/api/v1///' }),
    'https://x.example.com/api/v1');
});

test('getApiBase: rejects non-https for non-local hosts', () => {
  assert.throws(() => getApiBase({ SERVICO_API_BASE: 'http://example.com/api/v1' }),
    (e) => e.code === 'config_error' && /https/i.test(e.message));
});

test('getApiBase: allows http for localhost', () => {
  assert.equal(getApiBase({ SERVICO_API_BASE: 'http://localhost:3000/api/v1' }),
    'http://localhost:3000/api/v1');
});

test('getApiBase: allows http for 127.0.0.1', () => {
  assert.equal(getApiBase({ SERVICO_API_BASE: 'http://127.0.0.1:3000/api/v1' }),
    'http://127.0.0.1:3000/api/v1');
});

test('getApiBase: rejects bogus URLs', () => {
  assert.throws(() => getApiBase({ SERVICO_API_BASE: 'not a url' }),
    (e) => e.code === 'config_error');
});

// ─── Timeout config ────────────────────────────────────────────────────

test('getTimeoutMs: default is 30s', () => {
  assert.equal(getTimeoutMs({}), 30_000);
});

test('getTimeoutMs: respects override', () => {
  assert.equal(getTimeoutMs({ SERVICO_TIMEOUT_MS: '5000' }), 5_000);
});

test('getTimeoutMs: falls back on garbage values', () => {
  assert.equal(getTimeoutMs({ SERVICO_TIMEOUT_MS: 'abc' }), 30_000);
  assert.equal(getTimeoutMs({ SERVICO_TIMEOUT_MS: '-1' }), 30_000);
  // Cap at 5 min — anything above that falls back
  assert.equal(getTimeoutMs({ SERVICO_TIMEOUT_MS: '999999999' }), 30_000);
});

// ─── Live request: auth header is set ──────────────────────────────────

test('apiRequest: sends Authorization: Bearer header', async () => {
  let seenAuth = null;
  let seenUA = null;
  await withServer((req, res, _body) => {
    seenAuth = req.headers['authorization'];
    seenUA = req.headers['user-agent'];
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-request-id', 'req_test_123');
    res.end(JSON.stringify({ data: { ok: true }, meta: { request_id: 'req_test_123' } }));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    const out = await apiRequest({ method: 'GET', path: '/ping', env });
    assert.equal(out.data.ok, true);
    assert.equal(out.request_id, 'req_test_123');
  });
  assert.equal(seenAuth, `Bearer ${VALID_KEY}`);
  assert.match(seenUA, /^servicocli-mcp\//);
});

// ─── Error mapping: 4xx with API error body ────────────────────────────

test('apiRequest: 4xx maps to API error code + propagates request_id', async () => {
  await withServer((req, res) => {
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: {
        code: 'insufficient_scope',
        message: 'This key lacks customers:write',
        request_id: 'req_abc',
      },
    }));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await assert.rejects(
      () => apiRequest({ method: 'POST', path: '/customers', body: {}, env }),
      (err) => {
        assert.equal(err.code, 'insufficient_scope');
        assert.equal(err.status, 403);
        assert.equal(err.requestId, 'req_abc');
        assert.match(err.toAgentMessage(), /insufficient_scope/);
        assert.match(err.toAgentMessage(), /req_abc/);
        return true;
      }
    );
  });
});

// ─── 5xx maps to UPSTREAM_ERROR (stable internal code) ────────────────

test('apiRequest: 5xx maps to UPSTREAM_ERROR', async () => {
  await withServer((req, res) => {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: { code: 'server_error', message: 'DB down', request_id: 'r_x' },
    }));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await assert.rejects(
      () => apiRequest({ method: 'GET', path: '/customers', env }),
      (err) => err.code === 'UPSTREAM_ERROR' && err.status === 503
    );
  });
});

// ─── Non-JSON response (HTML proxy page etc) ──────────────────────────

test('apiRequest: rejects non-JSON content-type', async () => {
  await withServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html');
    res.end('<html>captive portal login</html>');
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await assert.rejects(
      () => apiRequest({ method: 'GET', path: '/customers', env }),
      (err) => err.code === 'PROTOCOL_ERROR' && /text\/html/.test(err.message)
    );
  });
});

test('apiRequest: non-JSON error never echoes body bytes', async () => {
  await withServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html');
    res.end('SECRET-BODY-CONTENT');
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await assert.rejects(
      () => apiRequest({ method: 'GET', path: '/x', env }),
      (err) => !/SECRET-BODY/.test(err.message)
    );
  });
});

test('apiRequest: 401 with string error body maps to invalid_api_key', async () => {
  await withServer((req, res) => {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid or expired API key' }));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await assert.rejects(
      () => apiRequest({ method: 'GET', path: '/me', env }),
      (err) => err.code === 'invalid_api_key' && err.status === 401
        && err.message === 'Invalid or expired API key'
    );
  });
});

test('apiRequest: string error on 400 and 418 derives codes from status', async () => {
  for (const [status, code] of [[400, 'bad_request'], [418, 'http_418']]) {
    await withServer((req, res) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'nope' }));
    }, async (base) => {
      const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
      await assert.rejects(
        () => apiRequest({ method: 'GET', path: '/x', env }),
        (err) => err.code === code && err.message === 'nope'
      );
    });
  }
});

for (const status of [429, 425]) {
  test(`apiRequest: ${status} surfaces Retry-After header`, async () => {
    await withServer((req, res) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.setHeader('retry-after', '7');
      res.end(JSON.stringify({ error: { code: 'rate_limited', message: 'Slow down' } }));
    }, async (base) => {
      const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
      await assert.rejects(
        () => apiRequest({ method: 'GET', path: '/x', env }),
        (err) => err.code === 'rate_limited' && err.retryAfter === 7
          && /retry after 7 s/.test(err.message)
      );
    });
  });
}

test('apiRequest: binary accepts any non-JSON type (e.g. Word) and returns base64', async () => {
  await withServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.end(Buffer.from('docbytes'));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    const out = await apiRequest({ method: 'GET', path: '/f', binary: true, env });
    assert.match(out.mime_type, /wordprocessingml/);
    assert.equal(Buffer.from(out.content_base64, 'base64').toString(), 'docbytes');
  });
});

test('apiRequest: binary over the size cap throws invalid_input', async () => {
  await withServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/pdf');
    res.end(Buffer.alloc(10 * 1024 * 1024 + 1));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await assert.rejects(
      () => apiRequest({ method: 'GET', path: '/f', binary: true, env }),
      (err) => err instanceof ApiClientError && err.code === 'invalid_input'
    );
  });
});

// ─── Network error (connection refused) ───────────────────────────────

test('apiRequest: network failure maps to NETWORK_ERROR', async () => {
  // Port 1 is privileged — connection refused. Skip if running as root.
  const env = {
    SERVICO_API_KEY: VALID_KEY,
    SERVICO_API_BASE: 'http://127.0.0.1:1/api/v1',
    SERVICO_TIMEOUT_MS: '2000',
  };
  await assert.rejects(
    () => apiRequest({ method: 'GET', path: '/customers', env }),
    (err) => err.code === 'NETWORK_ERROR'
  );
});

// ─── Redirect handling: 3xx never silently followed ───────────────────

test('apiRequest: 3xx redirect is rejected, not followed', async () => {
  await withServer((req, res) => {
    res.statusCode = 302;
    res.setHeader('location', 'https://evil.example.com/steal');
    res.setHeader('content-type', 'application/json');
    res.end('{}');
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await assert.rejects(
      () => apiRequest({ method: 'GET', path: '/customers', env }),
      (err) => err.code === 'UPSTREAM_ERROR' && err.status === 302
    );
  });
});

// ─── Query string handling ────────────────────────────────────────────

test('apiRequest: encodes query params and skips empties', async () => {
  let seenUrl = null;
  await withServer((req, res, _body) => {
    seenUrl = req.url;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [], meta: { request_id: 'r', page: { has_more: false, next_cursor: null } } }));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await apiRequest({
      method: 'GET',
      path: '/customers',
      query: { cursor: 'abc def', limit: 10, empty: '', skip: undefined, alsoskip: null },
      env,
    });
  });
  assert.match(seenUrl, /^\/api\/v1\/customers\?/);
  assert.match(seenUrl, /cursor=abc\+def|cursor=abc%20def/);
  assert.match(seenUrl, /limit=10/);
  assert.ok(!/empty=/.test(seenUrl));
  assert.ok(!/skip=/.test(seenUrl));
});

// ─── List response unwrap ─────────────────────────────────────────────

test('apiRequest: list response returns { data, next_cursor, has_more }', async () => {
  await withServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      data: [{ id: 'c1' }, { id: 'c2' }],
      meta: { request_id: 'r1', page: { has_more: true, next_cursor: 'cur_xyz' } },
    }));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    const out = await apiRequest({ method: 'GET', path: '/customers', env });
    assert.deepEqual(out.data.length, 2);
    assert.equal(out.next_cursor, 'cur_xyz');
    assert.equal(out.has_more, true);
    assert.equal(out.request_id, 'r1');
  });
});

// ─── Bad path argument ────────────────────────────────────────────────

test('apiRequest: throws if path does not start with /', async () => {
  await assert.rejects(
    () => apiRequest({
      method: 'GET',
      path: 'customers',
      env: { SERVICO_API_KEY: VALID_KEY },
    }),
    /must start with/
  );
});

// ─── Idempotency header propagates ────────────────────────────────────

test('apiRequest: caller-supplied headers reach the server', async () => {
  let seenIdem = null;
  await withServer((req, res) => {
    seenIdem = req.headers['idempotency-key'];
    res.setHeader('content-type', 'application/json');
    res.statusCode = 201;
    res.end(JSON.stringify({ data: { id: 'c1' }, meta: { request_id: 'r' } }));
  }, async (base) => {
    const env = { SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base };
    await apiRequest({
      method: 'POST',
      path: '/customers',
      body: { name: 'Test' },
      headers: { 'Idempotency-Key': 'abc-123-defghijklmno' },
      env,
    });
  });
  assert.equal(seenIdem, 'abc-123-defghijklmno');
});

// ─── Retry with back-off ──────────────────────────────────────────────

/** Server that replies from a script, one entry per request; records headers. */
function scripted(steps) {
  const seen = [];
  const handler = (req, res) => {
    seen.push({ method: req.method, headers: req.headers });
    const step = steps[Math.min(seen.length - 1, steps.length - 1)];
    res.statusCode = step.status;
    res.setHeader('content-type', 'application/json');
    for (const [k, v] of Object.entries(step.headers || {})) res.setHeader(k, v);
    res.end(JSON.stringify(step.body || { data: { ok: true }, meta: { request_id: 'r' } }));
  };
  return { seen, handler };
}
const errBody = (code) => ({ error: { code, message: code } });
function sleeper() {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}
const retryEnv = (base, extra = {}) => ({ SERVICO_API_KEY: VALID_KEY, SERVICO_API_BASE: base, ...extra });

test('retry: 429 rate_limited then 200 waits Retry-After once', async () => {
  const { seen, handler } = scripted([
    { status: 429, headers: { 'retry-after': '3' }, body: errBody('rate_limited') },
    { status: 200 },
  ]);
  const s = sleeper();
  await withServer(handler, async (base) => {
    const out = await apiRequest({ method: 'GET', path: '/customers', env: retryEnv(base), sleep: s.sleep });
    assert.deepEqual(out.data, { ok: true });
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(s.waits, [3000]);
});

test('retry: 429 quota_exceeded and daily_limit_reached are surfaced at once', async () => {
  for (const code of ['quota_exceeded', 'daily_limit_reached']) {
    const { seen, handler } = scripted([
      { status: 429, headers: { 'retry-after': '3600' }, body: errBody(code) },
    ]);
    const s = sleeper();
    await withServer(handler, async (base) => {
      await assert.rejects(
        apiRequest({ method: 'GET', path: '/customers', env: retryEnv(base), sleep: s.sleep }),
        (e) => e.code === code && e.retryAfter === 3600 && /retry after 3600 s/.test(e.message));
    });
    assert.equal(seen.length, 1);
    assert.equal(s.waits.length, 0);
  }
});

test('retry: GET 503, 503, 200 succeeds after 2 retries with back-off', async () => {
  const { seen, handler } = scripted([{ status: 503 }, { status: 503 }, { status: 200 }]);
  const s = sleeper();
  await withServer(handler, async (base) => {
    const out = await apiRequest({
      method: 'GET', path: '/customers', env: retryEnv(base), sleep: s.sleep, random: () => 0.5,
    });
    assert.deepEqual(out.data, { ok: true });
  });
  assert.equal(seen.length, 3);
  assert.deepEqual(s.waits, [250, 500]); // full jitter: 0.5 * (500, 1000)
});

test('retry: POST without Idempotency-Key is not retried after 503', async () => {
  const { seen, handler } = scripted([{ status: 503 }, { status: 200 }]);
  const s = sleeper();
  await withServer(handler, async (base) => {
    await assert.rejects(
      apiRequest({ method: 'POST', path: '/customers', body: {}, env: retryEnv(base), sleep: s.sleep }),
      (e) => e.status === 503 && !/attempts/.test(e.message));
  });
  assert.equal(seen.length, 1);
});

test('retry: POST with key retries 503 with the identical key', async () => {
  const { seen, handler } = scripted([{ status: 503 }, { status: 200 }]);
  const s = sleeper();
  await withServer(handler, async (base) => {
    await apiRequest({
      method: 'POST', path: '/customers', body: {}, headers: { 'Idempotency-Key': 'key-1234567890abcdef' },
      env: retryEnv(base), sleep: s.sleep,
    });
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].headers['idempotency-key'], 'key-1234567890abcdef');
  assert.equal(seen[1].headers['idempotency-key'], 'key-1234567890abcdef');
});

test('retry: 425 request_in_progress then 200 retries with the same key', async () => {
  const { seen, handler } = scripted([
    { status: 425, headers: { 'retry-after': '1' }, body: errBody('request_in_progress') },
    { status: 200 },
  ]);
  const s = sleeper();
  await withServer(handler, async (base) => {
    await apiRequest({
      method: 'POST', path: '/invoices', body: {}, headers: { 'Idempotency-Key': 'key-1234567890abcdef' },
      env: retryEnv(base), sleep: s.sleep,
    });
  });
  assert.deepEqual(s.waits, [1000]);
  assert.equal(seen[1].headers['idempotency-key'], 'key-1234567890abcdef');
});

test('retry: uploads and 500 are never retried; other 4xx neither', async () => {
  for (const [status, body] of [[500, undefined], [404, errBody('not_found')]]) {
    const { seen, handler } = scripted([{ status, body }, { status: 200 }]);
    await withServer(handler, async (base) => {
      await assert.rejects(apiRequest({
        method: 'GET', path: '/x', env: retryEnv(base), sleep: sleeper().sleep,
      }));
    });
    assert.equal(seen.length, 1);
  }
  const { seen, handler } = scripted([{ status: 503 }, { status: 200 }]);
  await withServer(handler, async (base) => {
    await assert.rejects(apiRequest({
      method: 'POST', path: '/expenses/e/attachments', body: new FormData(),
      headers: { 'Idempotency-Key': 'key-1234567890abcdef' },
      env: retryEnv(base), sleep: sleeper().sleep,
    }), (e) => e.status === 503);
  });
  assert.equal(seen.length, 1);
});

test('retry: Retry-After beyond the budget fails without sleeping', async () => {
  const { seen, handler } = scripted([
    { status: 429, headers: { 'retry-after': '15' }, body: errBody('rate_limited') },
    { status: 200 },
  ]);
  const s = sleeper();
  await withServer(handler, async (base) => {
    await assert.rejects(
      apiRequest({ method: 'GET', path: '/x', env: retryEnv(base, { SERVICO_RETRY_BUDGET_MS: '5000' }), sleep: s.sleep }),
      (e) => e.status === 429 && /retry after 15 s/.test(e.message));
  });
  assert.equal(seen.length, 1);
  assert.equal(s.waits.length, 0);
});

test('retry: gives up after SERVICO_MAX_RETRIES and notes the attempts', async () => {
  const { seen, handler } = scripted([{ status: 503 }]);
  await withServer(handler, async (base) => {
    await assert.rejects(
      apiRequest({ method: 'GET', path: '/x', env: retryEnv(base, { SERVICO_MAX_RETRIES: '2' }), sleep: sleeper().sleep }),
      (e) => e.status === 503 && e.attempts === 3 && /gave up after 3 attempts/.test(e.message));
  });
  assert.equal(seen.length, 3);
});

test('retry: SERVICO_MAX_RETRIES=0 and SERVICO_RETRY_BUDGET_MS=0 disable retry', async () => {
  for (const extra of [{ SERVICO_MAX_RETRIES: '0' }, { SERVICO_RETRY_BUDGET_MS: '0' }]) {
    const { seen, handler } = scripted([{ status: 503 }, { status: 200 }]);
    await withServer(handler, async (base) => {
      await assert.rejects(
        apiRequest({ method: 'GET', path: '/x', env: retryEnv(base, extra), sleep: sleeper().sleep }),
        (e) => e.status === 503);
    });
    assert.equal(seen.length, 1);
  }
});

test('retry: GET network error is retried, POST without key is not', async () => {
  // Nothing listens on this port: connection refused on every attempt.
  const env = retryEnv('http://127.0.0.1:1/api/v1', { SERVICO_MAX_RETRIES: '1' });
  const s = sleeper();
  await assert.rejects(
    apiRequest({ method: 'GET', path: '/x', env, sleep: s.sleep, random: () => 0.5 }),
    (e) => e.code === 'NETWORK_ERROR' && e.attempts === 2);
  assert.equal(s.waits.length, 1);
  const s2 = sleeper();
  await assert.rejects(
    apiRequest({ method: 'POST', path: '/x', body: {}, env, sleep: s2.sleep }),
    (e) => e.code === 'NETWORK_ERROR');
  assert.equal(s2.waits.length, 0);
});

// ─── Internal constants sanity ─────────────────────────────────────────

test('KEY_REGEX matches the expected key shape', () => {
  assert.ok(__internal.KEY_REGEX.test(VALID_KEY));
  assert.ok(!__internal.KEY_REGEX.test('sk_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_abcd'));
});
