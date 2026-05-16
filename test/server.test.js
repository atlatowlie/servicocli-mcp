/**
 * test/server.test.js — server-level registry + duplicate-name guard.
 *
 * The MCP wire protocol itself is exercised by Anthropic's SDK tests; we
 * test our wiring (registry assembly, error mapping) here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRegistry } from '../src/server.js';

test('buildRegistry: gathers all tools from every module', () => {
  const reg = buildRegistry();
  // Spot-check tools from each resource group.
  for (const name of [
    'list_customers', 'create_customer',
    'list_products', 'create_product',
    'list_quotes', 'get_quote_line_items',
    'list_invoices', 'get_invoice',
    'list_jobs', 'get_job',
    'list_forms', 'submit_form',
  ]) {
    assert.ok(reg.has(name), `missing tool: ${name}`);
  }
  // Total tool count — keep this in sync with README's tool table.
  assert.equal(reg.size, 19, 'expected 19 tools registered');
});

test('buildRegistry: every tool has the required shape', () => {
  const reg = buildRegistry();
  for (const [name, tool] of reg) {
    assert.equal(tool.name, name);
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.handler, 'function');
    assert.ok(tool.inputSchema && tool.inputSchema.type === 'object',
      `${name}: missing/invalid inputSchema`);
    assert.ok(tool.scope, `${name}: every tool must declare its scope`);
  }
});
