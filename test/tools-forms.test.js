/**
 * test/tools-forms.test.js — form tools (read templates + submit).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tools } from '../src/tools/forms.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

function byName(name) {
  return tools.find((x) => x.name === name);
}

test('form tool schemas are valid', () => {
  for (const t of tools) assertValidToolSchema(t.inputSchema, t.name);
});

test('list_forms: GET /forms', async () => {
  const { recorded } = await callTool(byName('list_forms'), {});
  assert.equal(recorded.method, 'GET');
  assert.match(recorded.url, /^\/api\/v1\/forms/);
});

test('get_form: GET /forms/:id', async () => {
  const { recorded } = await callTool(byName('get_form'), { id: 'fm-1' });
  assert.equal(recorded.url, '/api/v1/forms/fm-1');
});

test('list_form_responses: GET /forms/:id/responses', async () => {
  const { recorded } = await callTool(byName('list_form_responses'),
    { form_id: 'fm-2', cursor: 'c', limit: 25 });
  assert.match(recorded.url, /^\/api\/v1\/forms\/fm-2\/responses\?/);
});

test('submit_form: POST /forms/:id/submissions with Idempotency-Key', async () => {
  const { recorded } = await callTool(byName('submit_form'),
    {
      form_id: 'fm-3',
      ref_type: 'job',
      ref_id: 'job-99',
      values: { name: 'Jane', score: 5 },
    });
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.url, '/api/v1/forms/fm-3/submissions');
  assert.equal(recorded.body.ref_type, 'job');
  assert.equal(recorded.body.ref_id, 'job-99');
  assert.deepEqual(recorded.body.values, { name: 'Jane', score: 5 });
  assert.ok(recorded.headers['idempotency-key']);
  // form_id should not be in the body — it goes in the path
  assert.ok(!('form_id' in recorded.body));
});

test('submit_form: ref_type enum is enforced by the schema', () => {
  const t = byName('submit_form');
  assert.deepEqual(
    t.inputSchema.properties.ref_type.enum,
    ['job', 'customer', 'contractor'],
  );
});
