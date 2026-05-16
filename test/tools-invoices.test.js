/**
 * test/tools-invoices.test.js — invoice tools.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tools } from '../src/tools/invoices.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

function byName(name) {
  return tools.find((x) => x.name === name);
}

test('invoice tool schemas are valid', () => {
  for (const t of tools) assertValidToolSchema(t.inputSchema, t.name);
});

test('list_invoices: GET /invoices', async () => {
  const { recorded } = await callTool(byName('list_invoices'), {});
  assert.equal(recorded.method, 'GET');
  assert.match(recorded.url, /^\/api\/v1\/invoices/);
});

test('get_invoice: GET /invoices/:id', async () => {
  const { recorded } = await callTool(byName('get_invoice'), { id: 'inv-42' });
  assert.equal(recorded.url, '/api/v1/invoices/inv-42');
});
