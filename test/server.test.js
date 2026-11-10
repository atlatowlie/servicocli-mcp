/**
 * test/server.test.js — server-level registry + duplicate-name guard.
 *
 * The MCP wire protocol itself is exercised by Anthropic's SDK tests; we
 * test our wiring (registry assembly, error mapping) here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { callTool } from './_helpers.js';
import { buildRegistry, visibleTools } from '../src/server.js';

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
  assert.equal(reg.size, 35, 'expected 35 tools registered');
});

test('buildRegistry: every tool has the required shape', () => {
  const reg = buildRegistry();
  for (const [name, tool] of reg) {
    assert.equal(tool.name, name);
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.handler, 'function');
    assert.ok(tool.inputSchema && tool.inputSchema.type === 'object',
      `${name}: missing/invalid inputSchema`);
    assert.ok(tool.scope || (name === 'get_api_context' && tool.scope === null), `${name}: every tool must declare its scope`);
  }
});

test('get_api_context reads the authenticated key identity', async () => {
  const { recorded } = await callTool(buildRegistry().get('get_api_context'), {});
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/api/v1/me');
});

for (const resource of ['jobs', 'suppliers']) {
  test('list reference pages for ' + resource, async () => {
    const tool = buildRegistry().get('list_' + resource + '_references');
    const { recorded } = await callTool(tool, { limit: 2, cursor: 'opaque' });
    const url = new URL(recorded.url, 'https://localhost');
    assert.equal(url.pathname, '/api/v1/' + resource);
    assert.deepEqual(Object.fromEntries(url.searchParams), { view: 'references', limit: '2', cursor: 'opaque' });
  });
}

test('tool discovery follows the reference grants returned by Servico', () => {
  const keys = visibleTools(buildRegistry(), { reference_only: true, scopes: ['jobs:references:read'] });
  assert.deepEqual(keys.map(tool => tool.name), ['get_api_context', 'list_jobs_references']);
  const legacy = visibleTools(buildRegistry(), { scopes: ['read'] });
  assert.ok(legacy.some(tool => tool.name === 'list_jobs'));
  assert.ok(!legacy.some(tool => tool.reference));
});

test('ordinary supplier and job grants expose the matching operations', async () => {
  const registry = buildRegistry();
  const names = scopes => visibleTools(registry, { scopes }).map(tool => tool.name);
  assert.ok(names(['suppliers:read']).includes('list_suppliers'));
  assert.ok(!names(['suppliers:read']).includes('create_supplier'));
  assert.ok(names(['jobs:write']).includes('update_job'));
  for (const [name, method, args, path] of [
    ['list_suppliers','GET',{},'/suppliers'],
    ['create_supplier','POST',{ company_name:'Test', status:'active' },'/suppliers'],
    ['replace_supplier','PUT',{ id:'s1', company_name:'New name' },'/suppliers/s1'],
    ['update_job','PATCH',{ id:'j1', changes:{ title:'New title' } },'/jobs/j1'],
  ]) {
    const { recorded } = await callTool(registry.get(name), args);
    assert.equal(recorded.method, method);
    assert.equal(recorded.url, '/api/v1' + path);
    if (method !== 'GET') assert.ok(recorded.headers['idempotency-key']);
  }
});

test('expense tools require an explicit scope and send writes with a stable retry key', async () => {
  const registry = buildRegistry();
  const names = scopes => visibleTools(registry, {scopes}).map(tool => tool.name);
  assert.ok(!names(['read','jobs:write']).includes('list_job_expenses'));
  assert.ok(!names(['expenses:read']).includes('record_expense_payment'));
  const idem = 'expense-payment-test-001';
  for (const [name, args, url] of [
    ['create_job_expense',{job_id:'j',description:'Sample',amount:100},'/jobs/j/expenses'],
    ['record_expense_payment',{expense_id:'e',amount:30,payment_method:'cash'},'/expenses/e/payments'],
    ['refund_expense_payment',{expense_id:'e',payment_id:'p',amount:10},'/expenses/e/payments/p/refund'],
  ]) {
    const {recorded} = await callTool(registry.get(name), {...args,idempotency_key:idem});
    assert.equal(recorded.url, '/api/v1' + url);
    assert.equal(recorded.method, 'POST');
    assert.equal(recorded.headers['idempotency-key'], idem);
    assert.equal(recorded.body.amount, args.amount);
  }
});
