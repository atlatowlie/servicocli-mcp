/**
 * test/tools-jobs-invoices.test.js — the added job tools (status, files,
 * arrivals, selections) and invoice payment reads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tools as jobTools } from '../src/tools/jobs.js';
import { tools as invoiceTools } from '../src/tools/invoices.js';
import { assertValidToolSchema, callTool } from './_helpers.js';

const byName = (name) => [...jobTools, ...invoiceTools].find((t) => t.name === name);
const KEY = 'idem-key-0123456789';

test('schema is valid for the added tools', () => {
  for (const t of [...jobTools, ...invoiceTools]) assertValidToolSchema(t.inputSchema, t.name);
});

test('invoice payments: GET list and one payment', async () => {
  let r = await callTool(byName('list_invoice_payments'), { id: 'inv1' });
  assert.equal(r.recorded.url, '/api/v1/invoices/inv1/payments');
  r = await callTool(byName('get_invoice_payment'), { id: 'inv1', payment_id: 'p/1' });
  assert.equal(r.recorded.url, '/api/v1/invoices/inv1/payments/p%2F1');
  assert.equal(r.recorded.method, 'GET');
});

test('set_job_status: POST /jobs/:id/status with body and Idempotency-Key', async () => {
  const { recorded } = await callTool(byName('set_job_status'),
    { id: 'j1', status: 'on_hold', sub_status: 'waiting', idempotency_key: KEY });
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.url, '/api/v1/jobs/j1/status');
  assert.deepEqual(recorded.body, { status: 'on_hold', sub_status: 'waiting' });
  assert.equal(recorded.headers['idempotency-key'], KEY);
  const auto = await callTool(byName('set_job_status'), { id: 'j1', status: 'done' });
  assert.match(auto.recorded.headers['idempotency-key'], /^[A-Za-z0-9_-]{16,64}$/);
});

test('list_job_files: media flag becomes media=1 and filters pass through', async () => {
  const { recorded } = await callTool(byName('list_job_files'),
    { id: 'j1', media: true, tag: 'before', category: 'photo', task_id: 't1', room_id: 'r1' });
  const url = new URL(recorded.url, 'http://x');
  assert.equal(url.pathname, '/api/v1/jobs/j1/files');
  assert.deepEqual(Object.fromEntries(url.searchParams),
    { media: '1', tag: 'before', category: 'photo', task_id: 't1', room_id: 'r1' });
  const none = await callTool(byName('list_job_files'), { id: 'j1', media: false });
  assert.equal(none.recorded.url, '/api/v1/jobs/j1/files');
});

test('list_job_arrivals and record_job_arrival', async () => {
  let r = await callTool(byName('list_job_arrivals'), { id: 'j1', days: 7 });
  assert.equal(r.recorded.url, '/api/v1/jobs/j1/arrivals?days=7');
  r = await callTool(byName('record_job_arrival'),
    { id: 'j1', arrived_at: '2026-11-14T10:00:00Z', source: 'manual', accuracy_band: 'lt50', idempotency_key: KEY });
  assert.equal(r.recorded.method, 'POST');
  assert.equal(r.recorded.url, '/api/v1/jobs/j1/arrivals');
  assert.deepEqual(r.recorded.body, { arrived_at: '2026-11-14T10:00:00Z', source: 'manual', accuracy_band: 'lt50' });
  assert.equal(r.recorded.headers['idempotency-key'], KEY);
});

test('list_job_selections: GET /jobs/:jobId/selections', async () => {
  const { recorded } = await callTool(byName('list_job_selections'), { job_id: 'j1' });
  assert.equal(recorded.url, '/api/v1/jobs/j1/selections');
});

test('upload_job_file: sends multipart with the file and fields, no JSON content type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'servico-upload-'));
  const file = join(dir, 'front.jpg');
  await writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  const { recorded } = await callTool(byName('upload_job_file'),
    { id: 'j1', file_path: file, category: 'photo', tag: 'before', client_upload_id: 'up-1' });
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.url, '/api/v1/jobs/j1/files');
  assert.match(recorded.headers['content-type'], /^multipart\/form-data; boundary=/);
  const raw = String(recorded.body);
  assert.match(raw, /name="files"; filename="front.jpg"/);
  assert.match(raw, /name="category"\r\n\r\nphoto/);
  assert.match(raw, /name="tag"\r\n\r\nbefore/);
  assert.match(raw, /name="client_upload_id"\r\n\r\nup-1/);
});

test('upload_job_file: refuses a directory, a missing path, a symlink to a directory and an empty file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'servico-upload-'));
  const empty = join(dir, 'empty.jpg');
  await writeFile(empty, '');
  const sub = join(dir, 'sub');
  await mkdir(sub);
  const link = join(dir, 'link');
  await symlink(sub, link);
  for (const file_path of [dir, join(dir, 'nope.jpg'), link, empty]) {
    await assert.rejects(
      () => callTool(byName('upload_job_file'), { id: 'j1', file_path, category: 'photo' }),
      (err) => err.code === 'invalid_input',
      file_path,
    );
  }
});
