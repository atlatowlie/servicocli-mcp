/**
 * test/tools-jobs.test.js — job tools.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tools } from '../src/tools/jobs.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

function byName(name) {
  return tools.find((x) => x.name === name);
}

test('job tool schemas are valid', () => {
  for (const t of tools) assertValidToolSchema(t.inputSchema, t.name);
});

test('list_jobs: GET /jobs', async () => {
  const { recorded } = await callTool(byName('list_jobs'), { limit: 3 });
  assert.equal(recorded.method, 'GET');
  assert.match(recorded.url, /^\/api\/v1\/jobs\?limit=3/);
});

test('get_job: GET /jobs/:id', async () => {
  const { recorded } = await callTool(byName('get_job'), { id: 'job-xx' });
  assert.equal(recorded.url, '/api/v1/jobs/job-xx');
});
