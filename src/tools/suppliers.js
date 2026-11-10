import { randomUUID } from 'node:crypto';
import { apiRequest } from '../apiClient.js';

const supplierFields = {
  company_name: { type: 'string', minLength: 1, maxLength: 200 },
  status: { enum: ['active', 'inactive'] },
  code: { type: ['string', 'null'] },
  contact_name: { type: ['string', 'null'] },
  email: { type: ['string', 'null'] },
  phone: { type: ['string', 'null'] },
  address: { type: ['string', 'null'] },
  website: { type: ['string', 'null'] },
  notes: { type: ['string', 'null'] },
  categories: { type: 'array', items: { type: 'string' } },
  idempotency_key: { type: 'string', minLength: 16, maxLength: 64 },
};

export const tools = [{
  name: 'list_suppliers',
  description: 'List active suppliers and their order contacts.',
  scope: 'suppliers:read',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  handler() { return apiRequest({ method: 'GET', path: '/suppliers' }); },
}, {
  name: 'create_supplier',
  description: 'Create a supplier in the current tenant.',
  scope: 'suppliers:write',
  inputSchema: { type: 'object', additionalProperties: false, required: ['company_name','status'], properties: supplierFields },
  handler({ idempotency_key = randomUUID(), ...body }) {
    return apiRequest({ method: 'POST', path: '/suppliers', body, headers: { 'Idempotency-Key': idempotency_key } });
  },
}, {
  name: 'replace_supplier',
  description: 'Replace supplier details. Omitted contact details, code, website, address, and notes are cleared. Omitted status and categories are preserved.',
  scope: 'suppliers:write',
  inputSchema: { type: 'object', additionalProperties: false, required: ['id','company_name'],
    properties: { ...supplierFields, id: { type: 'string', minLength: 1 } } },
  handler({ id, idempotency_key = randomUUID(), ...body }) {
    return apiRequest({ method: 'PUT', path: '/suppliers/' + encodeURIComponent(id), body,
      headers: { 'Idempotency-Key': idempotency_key } });
  },
}];
