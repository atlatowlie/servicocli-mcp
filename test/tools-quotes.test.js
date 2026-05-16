/**
 * test/tools-quotes.test.js — quote tools.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tools } from '../src/tools/quotes.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

function byName(name) {
  return tools.find((x) => x.name === name);
}

test('quote tool schemas are valid', () => {
  for (const t of tools) assertValidToolSchema(t.inputSchema, t.name);
});

test('quote tools are all read-only (no POST/PATCH/DELETE)', async () => {
  // Smoke each handler — every one should issue a GET.
  for (const t of tools) {
    const fakeArgs = t.name === 'get_quote_line_items'
      ? { quote_id: 'q1' }
      : t.name === 'get_quote'
        ? { id: 'q1' } : {};
    const { recorded } = await callTool(t, fakeArgs);
    assert.equal(recorded.method, 'GET', `${t.name} unexpectedly issued ${recorded.method}`);
  }
});

test('list_quotes: GET /quotes with pagination', async () => {
  const { recorded } = await callTool(byName('list_quotes'),
    { cursor: 'cur_a', limit: 10 });
  assert.match(recorded.url, /^\/api\/v1\/quotes\?/);
});

test('get_quote: GET /quotes/:id', async () => {
  const { recorded } = await callTool(byName('get_quote'), { id: 'qt-1' });
  assert.equal(recorded.url, '/api/v1/quotes/qt-1');
});

test('get_quote_line_items: GET /quotes/:id/line-items', async () => {
  const { recorded } = await callTool(byName('get_quote_line_items'),
    { quote_id: 'qt-7' });
  assert.equal(recorded.url, '/api/v1/quotes/qt-7/line-items');
});
