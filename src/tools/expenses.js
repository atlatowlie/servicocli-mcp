import { apiRequest } from '../apiClient.js';

const text = { type: 'string' };
const date = { type: 'string', format: 'date' };
const fields = {
  job_id: text, expense_id: text, payment_id: text, description: text, amount: { type: 'number' },
  vendor: text, supplier_id: text, expense_date: date, payment_status: { enum: ['unpaid', 'pending'] },
  payment_method: text, payment_date: date, reference_number: text, notes: text,
  idempotency_key: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$', description: 'Reuse this key when retrying the same entry.' },
};

function schema(names, required) {
  return { type: 'object', additionalProperties: false, required,
    properties: Object.fromEntries(names.map(name => [name, fields[name]])) };
}

export const tools = [
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
    inputSchema: schema(["job_id","description","amount","vendor","supplier_id","expense_date","payment_status","idempotency_key"], ["job_id","description","amount","idempotency_key"]),
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
