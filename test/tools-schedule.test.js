/**
 * test/tools-schedule.test.js — schedule, task, time-block, meeting, user and
 * catalogue tools: one row per tool for method, path, query, body, headers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tools as scheduleTools } from '../src/tools/schedule.js';
import { tools as taskTools } from '../src/tools/tasks.js';
import { tools as timeBlockTools } from '../src/tools/timeBlocks.js';
import { tools as meetingTools } from '../src/tools/meetings.js';
import { tools as userTools } from '../src/tools/users.js';
import { tools as catalogueTools } from '../src/tools/catalogue.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

const all = [...scheduleTools, ...taskTools, ...timeBlockTools, ...meetingTools, ...userTools, ...catalogueTools];
const byName = (name) => all.find((t) => t.name === name);
const KEY = 'idem-key-0123456789';

test('schema is valid for every tool in this group', () => {
  for (const t of all) assertValidToolSchema(t.inputSchema, t.name);
});

// [tool, args, method, path, query, body (null = none), idempotency header expected]
const CASES = [
  ['get_schedule', { from: '2026-11-01', to: '2026-11-07', user_id: 'u1' }, 'GET', '/schedule',
    { from: '2026-11-01', to: '2026-11-07', user_id: 'u1' }, null, false],
  ['get_job_schedule', { id: 'j 1' }, 'GET', '/jobs/j%201/schedule', {}, null, false],
  ['reschedule_task', { id: 't1', scheduled_at: '2026-11-02T14:00:00Z', duration_minutes: 90, idempotency_key: KEY },
    'PATCH', '/tasks/t1/schedule', {}, { scheduled_at: '2026-11-02T14:00:00Z', duration_minutes: 90 }, KEY],
  ['list_tasks', { job_id: 'j1', status: 'todo', assigned_to: 'u1', limit: 5 }, 'GET', '/tasks',
    { job_id: 'j1', status: 'todo', assigned_to: 'u1', limit: '5' }, null, false],
  ['get_task', { id: 't1' }, 'GET', '/tasks/t1', {}, null, false],
  ['create_task', { job_id: 'j1', title: 'Install', idempotency_key: KEY }, 'POST', '/tasks', {},
    { job_id: 'j1', title: 'Install' }, KEY],
  ['update_task', { id: 't1', status: 'done', idempotency_key: KEY }, 'PATCH', '/tasks/t1', {},
    { status: 'done' }, KEY],
  ['list_time_blocks', { user_id: 'u1', from: '2026-11-01', cursor: 'c' }, 'GET', '/time-blocks',
    { user_id: 'u1', from: '2026-11-01', cursor: 'c' }, null, false],
  ['get_time_block', { id: 'b1' }, 'GET', '/time-blocks/b1', {}, null, false],
  ['create_time_block', { user_id: 'u1', title: 'Off', start_at: '2026-12-01T09:00:00Z', end_at: '2026-12-01T17:00:00Z', idempotency_key: KEY },
    'POST', '/time-blocks', {}, { user_id: 'u1', title: 'Off', start_at: '2026-12-01T09:00:00Z', end_at: '2026-12-01T17:00:00Z' }, KEY],
  ['update_time_block', { id: 'b1', title: 'Away', idempotency_key: KEY }, 'PATCH', '/time-blocks/b1', {},
    { title: 'Away' }, KEY],
  ['list_meetings', { job_id: 'j1', from: '2026-11-01', to: '2026-11-30' }, 'GET', '/meetings',
    { job_id: 'j1', from: '2026-11-01', to: '2026-11-30' }, null, false],
  ['get_meeting', { id: 'm1' }, 'GET', '/meetings/m1', {}, null, false],
  ['create_job_meeting', { job_id: 'j1', type: 'first_visit', scheduled_at: '2026-11-20T15:00:00Z', rep_ids: ['u2'], idempotency_key: KEY },
    'POST', '/jobs/j1/meetings', {}, { type: 'first_visit', scheduled_at: '2026-11-20T15:00:00Z', rep_ids: ['u2'] }, KEY],
  ['get_availability', { user_id: 'u1', date: '2026-11-20', duration_min: 45 }, 'GET', '/availability',
    { user_id: 'u1', date: '2026-11-20', duration_min: '45' }, null, false],
  ['list_users', {}, 'GET', '/users', {}, null, false],
  ['list_catalogue_products', { category: 'tile', search: 'a_b', page: 2, limit: 10 }, 'GET', '/catalogue/products',
    { category: 'tile', search: 'a_b', page: '2', limit: '10' }, null, false],
];

for (const [name, args, method, path, query, body, idem] of CASES) {
  test(`${name}: ${method} ${path}`, async () => {
    const { recorded } = await callTool(byName(name), args);
    const url = new URL(recorded.url, 'http://x');
    assert.equal(recorded.method, method);
    assert.equal(url.pathname, '/api/v1' + path);
    assert.deepEqual(Object.fromEntries(url.searchParams), query);
    assert.deepEqual(recorded.body, body);
    if (idem) assert.equal(recorded.headers['idempotency-key'], idem);
    else if (method === 'GET') assert.equal(recorded.headers['idempotency-key'], undefined);
  });
}

test('writes generate an Idempotency-Key when none is given; the key never goes in the body', async () => {
  for (const [name, args] of [
    ['reschedule_task', { id: 't1', due_date: null }],
    ['create_task', { job_id: 'j1', title: 'x' }],
    ['update_task', { id: 't1', title: 'y' }],
    ['create_time_block', { user_id: 'u', title: 't', start_at: 'a', end_at: 'b' }],
    ['update_time_block', { id: 'b', title: 't' }],
    ['create_job_meeting', { job_id: 'j', type: 'follow_up', scheduled_at: 'a' }],
  ]) {
    const { recorded } = await callTool(byName(name), args);
    assert.match(recorded.headers['idempotency-key'], /^[A-Za-z0-9_-]{16,64}$/, name);
    assert.ok(!('idempotency_key' in recorded.body), name);
  }
});

test('task writes are visible with tasks:create or the legacy tasks:write', async () => {
  const { visibleTools, buildRegistry } = await import('../src/server.js');
  const names = (scopes) => visibleTools(buildRegistry(), { scopes }).map((t) => t.name);
  assert.ok(names(['tasks:create']).includes('create_task'));
  assert.ok(names(['tasks:write']).includes('update_task'));
  assert.ok(!names(['tasks:read']).includes('create_task'));
});

test('time blocks: override needs a person to confirm; without a yes nothing is sent', async () => {
  const { tools: tb } = await import('../src/tools/timeBlocks.js');
  const create = tb.find((t) => t.name === 'create_time_block');
  const args = { user_id: 'u', title: 't', start_at: 'a', end_at: 'b', override: true };
  await assert.rejects(() => create.handler(args, undefined), /confirmation_required|needs a person/);
  await assert.rejects(() => create.handler(args, { confirm: async () => false }), /needs a person/);
  const { recorded } = await callTool(create, args, { ctx: { confirm: async () => true } });
  assert.equal(recorded.body.override, true);
});
