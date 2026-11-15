/**
 * test/tools-expenses.test.js — expense tools without coverage elsewhere.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { tools } from '../src/tools/expenses.js';
import { ApiClientError } from '../src/apiClient.js';
import { assertValidToolSchema, callTool, VALID_KEY } from './_helpers.js';

const byName = (n) => tools.find((t) => t.name === n);

test('expense tool schemas are valid and share the idempotency key schema', () => {
  for (const t of tools) assertValidToolSchema(t.inputSchema, t.name);
  const k = byName('create_job_expense').inputSchema.properties.idempotency_key;
  assert.equal(k.maxLength, 64);
  assert.equal(k.pattern, '^[A-Za-z0-9_-]{16,64}$');
  assert.equal(byName('list_contractor_directory').inputSchema.properties.limit.maximum, 500);
});

test('list_expense_references: GET /expenses with filters', async () => {
  const { recorded } = await callTool(byName('list_expense_references'),
    { invoice_number: 'INV-1', job_id: 'j1', limit: 5, cursor: 'c' });
  const url = new URL(recorded.url, 'http://x');
  assert.equal(recorded.method, 'GET');
  assert.equal(url.pathname, '/api/v1/expenses');
  assert.deepEqual(Object.fromEntries(url.searchParams),
    { invoice_number: 'INV-1', job_id: 'j1', limit: '5', cursor: 'c' });
});

test('list_contractor_directory: GET /contractors with limit/offset', async () => {
  const { recorded } = await callTool(byName('list_contractor_directory'), { limit: 10, offset: 20 });
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/api/v1/contractors?limit=10&offset=20');
});

test('list_job_expenses: GET /jobs/:id/expenses', async () => {
  const { recorded } = await callTool(byName('list_job_expenses'), { job_id: 'j 1' });
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/api/v1/jobs/j%201/expenses');
});

test('list_expense_payments: GET /expenses/:id/payments', async () => {
  const { recorded } = await callTool(byName('list_expense_payments'), { expense_id: 'e1' });
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/api/v1/expenses/e1/payments');
});

test('list_expense_attachments: GET /expenses/:id/attachments', async () => {
  const { recorded } = await callTool(byName('list_expense_attachments'), { expense_id: 'e1' });
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/api/v1/expenses/e1/attachments');
});

test('upload_expense_attachment: multipart POST with file and derived id', async () => {
  const srv = await new Promise((resolve) => {
    const rec = {};
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        rec.method = req.method; rec.url = req.url; rec.type = req.headers['content-type'];
        rec.body = Buffer.concat(chunks).toString('latin1');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: { ok: true } }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ rec, server, base: `http://127.0.0.1:${server.address().port}/api/v1` }));
  });
  const prev = { k: process.env.SERVICO_API_KEY, b: process.env.SERVICO_API_BASE };
  process.env.SERVICO_API_KEY = VALID_KEY;
  process.env.SERVICO_API_BASE = srv.base;
  try {
    await byName('upload_expense_attachment').handler({
      expense_id: 'e1', filename: 'r.pdf', content_base64: Buffer.from('PDFDATA').toString('base64'),
      derived_from_file_id: 'f0',
    });
  } finally {
    process.env.SERVICO_API_KEY = prev.k; process.env.SERVICO_API_BASE = prev.b;
    srv.server.close();
  }
  assert.equal(srv.rec.method, 'POST');
  assert.equal(srv.rec.url, '/api/v1/expenses/e1/attachments');
  assert.match(srv.rec.type, /^multipart\/form-data/);
  assert.match(srv.rec.body, /name="derived_from_file_id"/);
  assert.match(srv.rec.body, /filename="r\.pdf"/);
  assert.match(srv.rec.body, /PDFDATA/);
});

test('upload_expense_attachment: bad base64 throws ApiClientError invalid_input', () => {
  assert.throws(
    () => byName('upload_expense_attachment').handler({ expense_id: 'e1', filename: 'r.pdf', content_base64: 'not base64!!' }),
    (err) => err instanceof ApiClientError && err.code === 'invalid_input' && /base64/.test(err.message),
  );
});

test('download_expense_attachment: GET attachment file as base64', async () => {
  const srv = await new Promise((resolve) => {
    const rec = {};
    const server = http.createServer((req, res) => {
      rec.method = req.method; rec.url = req.url;
      res.setHeader('content-type', 'text/csv');
      res.end('a,b');
    });
    server.listen(0, '127.0.0.1', () => resolve({ rec, server, base: `http://127.0.0.1:${server.address().port}/api/v1` }));
  });
  const prev = { k: process.env.SERVICO_API_KEY, b: process.env.SERVICO_API_BASE };
  process.env.SERVICO_API_KEY = VALID_KEY;
  process.env.SERVICO_API_BASE = srv.base;
  let out;
  try {
    out = await byName('download_expense_attachment').handler({ expense_id: 'e1', file_id: 'f/1' });
  } finally {
    process.env.SERVICO_API_KEY = prev.k; process.env.SERVICO_API_BASE = prev.b;
    srv.server.close();
  }
  assert.equal(srv.rec.method, 'GET');
  assert.equal(srv.rec.url, '/api/v1/expenses/e1/attachments/f%2F1');
  assert.equal(out.mime_type, 'text/csv');
  assert.equal(Buffer.from(out.content_base64, 'base64').toString(), 'a,b');
});
