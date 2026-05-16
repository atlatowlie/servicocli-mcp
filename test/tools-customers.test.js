/**
 * test/tools-customers.test.js — customer tools shape + path + body.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tools } from '../src/tools/customers.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

function byName(name) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

test('customer tool schemas are valid + strict', () => {
  for (const t of tools) {
    assertValidToolSchema(t.inputSchema, t.name);
    assert.ok(t.description.length > 20, `${t.name}: description too short`);
    assert.equal(typeof t.handler, 'function', `${t.name}: handler must be a function`);
  }
});

test('list_customers: GET /customers with query', async () => {
  const { recorded } = await callTool(byName('list_customers'),
    { cursor: 'cur_x', limit: 50 });
  assert.equal(recorded.method, 'GET');
  assert.match(recorded.url, /^\/api\/v1\/customers\?/);
  assert.match(recorded.url, /cursor=cur_x/);
  assert.match(recorded.url, /limit=50/);
});

test('list_customers: no query string when args omitted', async () => {
  const { recorded } = await callTool(byName('list_customers'), {});
  assert.equal(recorded.method, 'GET');
  // either no '?' at all, or trailing '?' with no params
  assert.match(recorded.url, /^\/api\/v1\/customers\??$/);
});

test('get_customer: encodes path id', async () => {
  const { recorded } = await callTool(byName('get_customer'),
    { id: 'abc/def' });
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/api/v1/customers/abc%2Fdef');
});

test('create_customer: POST /customers with body + Idempotency-Key', async () => {
  const { recorded } = await callTool(byName('create_customer'),
    { name: 'Acme Co', email: 'sales@acme.com' });
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.url, '/api/v1/customers');
  assert.equal(recorded.body.name, 'Acme Co');
  assert.equal(recorded.body.email, 'sales@acme.com');
  assert.ok(recorded.headers['idempotency-key'], 'auto-generated idempotency key missing');
  assert.ok(recorded.headers['idempotency-key'].length >= 16);
  // user-supplied idempotency_key should not leak into the body
  assert.ok(!('idempotency_key' in recorded.body));
});

test('create_customer: caller-supplied idempotency_key wins', async () => {
  const myKey = 'my-custom-idem-1234567890';
  const { recorded } = await callTool(byName('create_customer'),
    { name: 'Acme Co', idempotency_key: myKey });
  assert.equal(recorded.headers['idempotency-key'], myKey);
});

test('update_customer: PATCH /customers/:id with body', async () => {
  const { recorded } = await callTool(byName('update_customer'),
    { id: 'cust-123', name: 'New Name', status: 'inactive' });
  assert.equal(recorded.method, 'PATCH');
  assert.equal(recorded.url, '/api/v1/customers/cust-123');
  assert.equal(recorded.body.name, 'New Name');
  assert.equal(recorded.body.status, 'inactive');
  assert.ok(!('id' in recorded.body), 'id should not be in body');
});
