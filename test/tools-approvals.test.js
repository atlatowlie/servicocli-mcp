/**
 * test/tools-approvals.test.js — approvals: list, and the human-confirmation
 * rule for approve/reject (confirmed -> API called; declined or unsupported
 * -> no API call at all).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { tools, describeApproval } from '../src/tools/approvals.js';
import { makeToolContext } from '../src/server.js';
import { assertValidToolSchema, callTool, VALID_KEY } from './_helpers.js';

const byName = (name) => tools.find((t) => t.name === name);
const PENDING = {
  id: 7, action_type: 'client.status_update', required_permission: null,
  action_payload: { display: { customerName: 'Nanette Lee', jobLabel: '#123 Kitchen' } },
};

test('schemas are valid and decision tools are marked', () => {
  for (const t of tools) assertValidToolSchema(t.inputSchema, t.name);
  for (const name of ['approve_approval', 'reject_approval']) {
    assert.equal(byName(name).requiresHumanConfirmation, true);
    assert.match(byName(name).description, /REQUIRES HUMAN CONFIRMATION/);
  }
  assert.ok(!byName('list_approvals').requiresHumanConfirmation);
});

test('list_approvals: GET /approvals?limit=', async () => {
  const { recorded } = await callTool(byName('list_approvals'), { limit: 20 });
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/api/v1/approvals?limit=20');
});

test('describeApproval picks readable labels from display or payload', () => {
  assert.equal(describeApproval(PENDING), 'Nanette Lee / #123 Kitchen');
  assert.equal(describeApproval({ action_payload: { taskTitle: 'Grout' } }), 'Grout');
  assert.equal(describeApproval({}), '');
});

/** A server that records every request and lists one pending approval. */
async function run(tool, args, ctx) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: req.method === 'GET' ? [PENDING] : { id: 7, status: 'approved' }, meta: { request_id: 'r' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = { k: process.env.SERVICO_API_KEY, b: process.env.SERVICO_API_BASE };
  process.env.SERVICO_API_KEY = VALID_KEY;
  process.env.SERVICO_API_BASE = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    let result; let error;
    try { result = await tool.handler(args, ctx); } catch (err) { error = err; }
    return { calls, result, error };
  } finally {
    process.env.SERVICO_API_KEY = prev.k;
    if (prev.b === undefined) delete process.env.SERVICO_API_BASE; else process.env.SERVICO_API_BASE = prev.b;
    await new Promise((r) => server.close(r));
  }
}

test('approve_approval: confirmed -> shows what is decided, then POSTs /approvals/:id/approve', async () => {
  const asked = [];
  const ctx = { confirm: async (message) => { asked.push(message); return true; } };
  const { calls, error } = await run(byName('approve_approval'),
    { id: 7, reason: 'ok', idempotency_key: 'idem-key-0123456789' }, ctx);
  assert.equal(error, undefined);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /#7: client\.status_update \(Nanette Lee \/ #123 Kitchen\)/);
  assert.match(asked[0], /send the customer a job status update/);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`),
    ['GET /api/v1/approvals?limit=200', 'POST /api/v1/approvals/7/approve']);
  assert.deepEqual(calls[1].body, { reason: 'ok' });
  assert.equal(calls[1].headers['idempotency-key'], 'idem-key-0123456789');
});

test('reject_approval: confirmed -> POSTs /approvals/:id/reject', async () => {
  const { calls } = await run(byName('reject_approval'), { id: '7' }, { confirm: async () => true });
  assert.equal(calls.at(-1).url, '/api/v1/approvals/7/reject');
});

test('declined, cancelled or unsupported confirmation -> error and NO decision call', async () => {
  for (const ctx of [{ confirm: async () => false }, {}, undefined]) {
    for (const name of ['approve_approval', 'reject_approval']) {
      const { calls, error } = await run(byName(name), { id: 7 }, ctx);
      assert.equal(error?.code, 'confirmation_required');
      assert.match(error.toAgentMessage(), /person must confirm.*decide it in Servico/);
      assert.ok(calls.every((c) => c.method === 'GET'), 'only the read to describe the item');
    }
  }
});

test('an id missing from the pending list is still asked about, with the id only', async () => {
  const asked = [];
  await run(byName('approve_approval'), { id: 999 }, { confirm: async (m) => { asked.push(m); return false; } });
  assert.match(asked[0], /#999 \(not found in the pending list/);
});

test('makeToolContext.confirm: needs elicitation support and an explicit yes', async () => {
  const fake = (caps, reply) => ({
    getClientCapabilities: () => caps,
    elicitInput: async () => { if (reply instanceof Error) throw reply; return reply; },
  });
  const form = { elicitation: { form: {} } };
  const yes = { action: 'accept', content: { confirm: true } };
  assert.equal(await makeToolContext(fake(form, yes)).confirm('m'), true);
  assert.equal(await makeToolContext(fake(undefined, yes)).confirm('m'), false);
  assert.equal(await makeToolContext(fake({ elicitation: { url: {} } }, yes)).confirm('m'), false);
  assert.equal(await makeToolContext(fake(form, { action: 'accept', content: { confirm: false } })).confirm('m'), false);
  assert.equal(await makeToolContext(fake(form, { action: 'decline' })).confirm('m'), false);
  assert.equal(await makeToolContext(fake(form, { action: 'cancel' })).confirm('m'), false);
  assert.equal(await makeToolContext(fake(form, new Error('boom'))).confirm('m'), false);
});
