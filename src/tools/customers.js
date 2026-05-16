/**
 * tools/customers.js — customer-resource tools.
 *
 * Each tool exports the schema MCP needs (name, description, inputSchema)
 * plus a `handler(args)` that:
 *   - returns the unwrapped resource (the `data` field of the API envelope)
 *   - throws ApiClientError on any failure (the server.js dispatcher
 *     maps that to the MCP error response)
 *
 * Scopes (info only — enforced server-side):
 *   read:  customers:read
 *   write: customers:write
 */

import { apiRequest } from '../apiClient.js';

/** Shared cursor/limit shape for list endpoints. */
const PAGINATION_PROPS = {
  cursor: {
    type: 'string',
    description:
      'Opaque pagination cursor from a previous list response. Omit on first page.',
  },
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 25,
    description: 'Max records to return (1-100, default 25).',
  },
};

export const tools = [
  {
    name: 'list_customers',
    description:
      'List customers in your Servico tenant. Returns paginated results sorted ' +
      'by created_at DESC. Deleted customers are excluded. Use the returned ' +
      '`next_cursor` to fetch subsequent pages.',
    scope: 'customers:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...PAGINATION_PROPS },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: '/customers',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'get_customer',
    description:
      'Fetch a single customer by id. Returns 404 if the id is not found ' +
      'in your tenant (which is also how deleted customers appear).',
    scope: 'customers:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description: 'Customer UUID.',
        },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/customers/${encodeURIComponent(args.id)}`,
      });
    },
  },

  {
    name: 'create_customer',
    description:
      'Create a new customer. `name` is required (1-200 chars). Email is ' +
      'normalized to lowercase; phone is normalized to E.164 — unparseable ' +
      'phone numbers are rejected with a 400. Requires the customers:write scope.',
    scope: 'customers:write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        email: { type: 'string', maxLength: 320 },
        phone: { type: 'string', maxLength: 40, description: 'Will be normalized to E.164.' },
        address: { type: 'string', maxLength: 500 },
        status: { type: 'string', enum: ['active', 'inactive'], default: 'active' },
        idempotency_key: {
          type: 'string',
          minLength: 16,
          maxLength: 200,
          description:
            'Idempotency-Key for the write. Strongly recommended — replays ' +
            'with the same key return the cached response. If omitted, ' +
            'a UUID is generated client-side.',
        },
      },
    },
    async handler(args) {
      const { idempotency_key, ...body } = args || {};
      const idem = idempotency_key || crypto.randomUUID();
      return apiRequest({
        method: 'POST',
        path: '/customers',
        body,
        headers: { 'Idempotency-Key': idem },
      });
    },
  },

  {
    name: 'update_customer',
    description:
      'Update a customer (PATCH semantics — only the fields you supply are ' +
      'changed). At least one field besides `id` must be provided. ' +
      'Requires customers:write scope.',
    scope: 'customers:write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        email: { type: ['string', 'null'], maxLength: 320 },
        phone: { type: ['string', 'null'], maxLength: 40 },
        address: { type: ['string', 'null'], maxLength: 500 },
        status: { type: 'string', enum: ['active', 'inactive'] },
        idempotency_key: { type: 'string', minLength: 16, maxLength: 200 },
      },
    },
    async handler(args) {
      const { id, idempotency_key, ...body } = args || {};
      const idem = idempotency_key || crypto.randomUUID();
      return apiRequest({
        method: 'PATCH',
        path: `/customers/${encodeURIComponent(id)}`,
        body,
        headers: { 'Idempotency-Key': idem },
      });
    },
  },
];
