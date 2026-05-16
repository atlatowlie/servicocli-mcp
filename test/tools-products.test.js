/**
 * test/tools-products.test.js — product tools shape + path + body.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tools } from '../src/tools/products.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

function byName(name) {
  return tools.find((x) => x.name === name);
}

test('product tool schemas are valid', () => {
  for (const t of tools) assertValidToolSchema(t.inputSchema, t.name);
});

test('list_products: GET /products', async () => {
  const { recorded } = await callTool(byName('list_products'), { limit: 5 });
  assert.equal(recorded.method, 'GET');
  assert.match(recorded.url, /^\/api\/v1\/products\?limit=5/);
});

test('get_product: integer id in path', async () => {
  const { recorded } = await callTool(byName('get_product'), { id: 42 });
  assert.equal(recorded.url, '/api/v1/products/42');
});

test('create_product: POST with required fields', async () => {
  const { recorded } = await callTool(byName('create_product'),
    { name: 'Window Repair', category: 'glazing', cost: 120, item_type: 'labor' });
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.url, '/api/v1/products');
  assert.equal(recorded.body.name, 'Window Repair');
  assert.equal(recorded.body.category, 'glazing');
  assert.equal(recorded.body.cost, 120);
  assert.equal(recorded.body.item_type, 'labor');
  assert.ok(recorded.headers['idempotency-key']);
});

test('update_product: PATCH with integer id', async () => {
  const { recorded } = await callTool(byName('update_product'),
    { id: 7, sale_price: 99.50 });
  assert.equal(recorded.method, 'PATCH');
  assert.equal(recorded.url, '/api/v1/products/7');
  assert.equal(recorded.body.sale_price, 99.5);
});

test('create_product input schema enumerates item_type values', () => {
  const t = byName('create_product');
  assert.deepEqual(
    t.inputSchema.properties.item_type.enum,
    ['product', 'supply', 'labor', 'equipment'],
  );
});
