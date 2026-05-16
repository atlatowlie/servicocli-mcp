/**
 * test/_helpers.js — shared test rigging.
 *
 * Spins a real HTTP server so tools' handlers are exercised end-to-end
 * (path templating + query encoding + body shape + header propagation).
 * No mocks beyond the server fixture itself.
 */

import http from 'node:http';
import assert from 'node:assert/strict';

export const VALID_KEY = 'sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_abcd';

/**
 * Run a single request against a captured handler. The handler records
 * (method, url, body, headers) so the test can assert on what the tool
 * sent. Returns whatever JSON body the handler chose to reply with,
 * defaulting to a minimal { data, meta }.
 */
export function recordingServer({ status = 200, replyBody } = {}) {
  const recorded = { method: null, url: null, body: null, headers: null };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      recorded.method = req.method;
      recorded.url = req.url;
      recorded.headers = req.headers;
      try { recorded.body = body ? JSON.parse(body) : null; }
      catch { recorded.body = body; }
      const reply = replyBody || { data: { ok: true }, meta: { request_id: 'r_test' } };
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        base: `http://127.0.0.1:${port}/api/v1`,
        recorded,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/**
 * Validate that an object looks like a JSON Schema for a tool input —
 * type=object, additionalProperties=false (the strict-mode safety net),
 * and required fields all appear in properties.
 */
export function assertValidToolSchema(schema, toolName) {
  assert.equal(schema.type, 'object', `${toolName}: schema.type must be 'object'`);
  assert.equal(schema.additionalProperties, false,
    `${toolName}: must set additionalProperties=false to reject unknown args`);
  if (schema.required) {
    for (const r of schema.required) {
      assert.ok(schema.properties && schema.properties[r],
        `${toolName}: required field '${r}' not in properties`);
    }
  }
}

/**
 * Call a single tool against a recording server and return both the
 * tool's return value and the recording. Sets the test env vars in
 * process.env (and restores after) since apiClient reads from
 * process.env by default — and tool handlers don't accept an env arg.
 */
export async function callTool(tool, args, opts = {}) {
  const srv = await recordingServer(opts);
  const prevKey = process.env.SERVICO_API_KEY;
  const prevBase = process.env.SERVICO_API_BASE;
  process.env.SERVICO_API_KEY = VALID_KEY;
  process.env.SERVICO_API_BASE = srv.base;
  try {
    const out = await tool.handler(args);
    return { out, recorded: srv.recorded };
  } finally {
    if (prevKey === undefined) delete process.env.SERVICO_API_KEY;
    else process.env.SERVICO_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.SERVICO_API_BASE;
    else process.env.SERVICO_API_BASE = prevBase;
    await srv.close();
  }
}
