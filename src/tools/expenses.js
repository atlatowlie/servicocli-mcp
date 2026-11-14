import { Blob } from 'node:buffer';
import { apiRequest, ApiClientError } from '../apiClient.js';
import { IDEMPOTENCY_KEY_SCHEMA } from './_shared.js';

import { FormData } from 'undici';

const text = { type: 'string' };
const date = { type: 'string', format: 'date' };
const fields = {
  derived_from_file_id: text, file_id: text, filename: text, content_base64: { type: 'string', maxLength: 13981016 },
  job_id: text, expense_id: text, payment_id: text, description: text, amount: { type: 'number' },
  vendor: text, supplier_id: text, contractor_id: text, invoice_number: text, invoice_date: date, expense_date: date, payment_status: { enum: ['unpaid', 'pending'] },
  payment_method: text, payment_date: date, reference_number: text, notes: text,
  idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
};

function schema(names, required) {
  return { type: 'object', additionalProperties: false, required,
    properties: Object.fromEntries(names.map(name => [name, fields[name]])) };
}

const invalidInput = message => new ApiClientError({ code: 'invalid_input', message });

const attachments = id => '/expenses/' + encodeURIComponent(id) + '/attachments';

export const tools = [
  {
    name: 'list_expense_references', description: 'Retrieve invoice identity, job and revision IDs. Repeat the filters with each snapshot cursor.',
    scope: 'expenses:read', explicitScope: true,
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      invoice_number: text, supplier_id: text, contractor_id: text, job_id: text, cursor: text,
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    } },
    handler(query) { return apiRequest({ method: 'GET', path: '/expenses', query }); },
  },
  {
    name: 'list_contractor_directory', description: 'List contractor IDs, names and maintained invoice aliases.',
    scope: 'expenses:read', explicitScope: true,
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 500 }, offset: { type: 'integer', minimum: 0 } } },
    handler(query) { return apiRequest({ method: 'GET', path: '/contractors', query }); },
  },
  {
    name: 'list_expense_attachments', description: 'List receipt filenames, IDs and original SHA-256 fingerprints.',
    scope: 'expenses:read', explicitScope: true, inputSchema: schema(['expense_id'], ['expense_id']),
    handler({ expense_id }) { return apiRequest({ method: 'GET', path: attachments(expense_id) }); },
  },
  {
    name: 'download_expense_attachment', description: 'Read a receipt as base64 (up to 10 MiB).',
    scope: 'expenses:read', explicitScope: true, inputSchema: schema(['expense_id','file_id'], ['expense_id','file_id']),
    handler({ expense_id, file_id }) {
      return apiRequest({ method: 'GET', path: attachments(expense_id) + '/' + encodeURIComponent(file_id), binary: true });
    },
  },
  {
    name: 'upload_expense_attachment', description: 'Attach an original PDF or image to an expense (up to 10 MiB).',
    scope: 'expenses:write', explicitScope: true,
    inputSchema: schema(['expense_id','filename','content_base64','derived_from_file_id'], ['expense_id','filename','content_base64']),
    handler({ expense_id, filename, content_base64, derived_from_file_id }) {
      if (content_base64.length > 13981016) throw invalidInput('Attachment exceeds the 10 MiB MCP transfer limit.');
      const bytes = Buffer.from(content_base64, 'base64');
      if (bytes.length > 10 * 1024 * 1024) throw invalidInput('Attachment exceeds the 10 MiB MCP transfer limit.');
      if (bytes.toString('base64') !== content_base64) throw invalidInput('content_base64 is not valid canonical base64 data.');
      const body = new FormData();
      if (derived_from_file_id) body.append('derived_from_file_id', derived_from_file_id);
      body.append('file', new Blob([bytes]), filename);
      return apiRequest({ method: 'POST', path: attachments(expense_id), body });
    },
  },
  {
    name: 'list_job_expenses',
    description: 'List job expenses.',
    scope: 'expenses:read',
    explicitScope: true,
    inputSchema: schema(["job_id"], ["job_id"]),
    handler({ job_id }) {
      return apiRequest({ method: 'GET', path: '/jobs/' + encodeURIComponent(job_id) + '/expenses' });
    },
  },
  {
    name: 'create_job_expense',
    description: 'Create a job expense.',
    scope: 'expenses:write',
    explicitScope: true,
    inputSchema: schema(["job_id","description","amount","vendor","supplier_id","contractor_id","invoice_number","invoice_date","expense_date","payment_status","idempotency_key"], ["job_id","description","amount","idempotency_key"]),
    handler({ job_id, idempotency_key, ...body }) {
      return apiRequest({ method: 'POST', path: '/jobs/' + encodeURIComponent(job_id) + '/expenses', body, headers: { 'Idempotency-Key': idempotency_key } });
    },
  },
  {
    name: 'list_expense_payments',
    description: 'List recorded payments on a job expense.',
    scope: 'expenses:read',
    explicitScope: true,
    inputSchema: schema(["expense_id"], ["expense_id"]),
    handler({ expense_id }) {
      return apiRequest({ method: 'GET', path: '/expenses/' + encodeURIComponent(expense_id) + '/payments' });
    },
  },
  {
    name: 'record_expense_payment',
    description: 'Record a payment already made on a job expense.',
    scope: 'expenses:write',
    explicitScope: true,
    inputSchema: schema(["expense_id","amount","payment_method","payment_date","reference_number","notes","idempotency_key"], ["expense_id","amount","payment_method","idempotency_key"]),
    handler({ expense_id, idempotency_key, ...body }) {
      return apiRequest({ method: 'POST', path: '/expenses/' + encodeURIComponent(expense_id) + '/payments', body, headers: { 'Idempotency-Key': idempotency_key } });
    },
  },
  {
    name: 'refund_expense_payment',
    description: 'Record a refund against an existing expense payment.',
    scope: 'expenses:write',
    explicitScope: true,
    inputSchema: schema(["expense_id","payment_id","amount","payment_method","payment_date","notes","idempotency_key"], ["expense_id","payment_id","amount","idempotency_key"]),
    handler({ expense_id, payment_id, idempotency_key, ...body }) {
      return apiRequest({ method: 'POST', path: '/expenses/' + encodeURIComponent(expense_id) + '/payments/' + encodeURIComponent(payment_id) + '/refund', body, headers: { 'Idempotency-Key': idempotency_key } });
    },
  },
];
