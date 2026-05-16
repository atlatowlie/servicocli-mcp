/**
 * tools/forms.js — form-template + form-response tools.
 *
 * Forms are the most common "external integration" surface — a tenant
 * embeds a lead-capture form on their website and pushes submissions
 * into Servico via submit_form. The MCP shape mirrors the API:
 *   - list_forms / get_form — read templates and their field schemas
 *   - list_form_responses — paginate prior submissions
 *   - submit_form — write a new response (Idempotency-Key auto-generated)
 *
 * Scopes:
 *   read:  forms:read
 *   write: forms:write
 */

import { apiRequest } from '../apiClient.js';

export const tools = [
  {
    name: 'list_forms',
    description:
      'List form templates in your tenant. Each row includes id, name, ' +
      'description, scope (job/customer/contractor), and is_active.',
    scope: 'forms:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: '/forms',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'get_form',
    description:
      'Fetch a form template with its field schema bundled in. The ' +
      '`fields` array describes each field (key, label, type, required, ' +
      'options, conditionals) — useful before building a submission.',
    scope: 'forms:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Form template UUID.' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/forms/${encodeURIComponent(args.id)}`,
      });
    },
  },

  {
    name: 'list_form_responses',
    description:
      'Paginate the responses (submissions) for a given form template. ' +
      'Tenant-scoped — returns 404 if the template is not in your tenant.',
    scope: 'forms:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['form_id'],
      properties: {
        form_id: { type: 'string', minLength: 1, description: 'Form template UUID.' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/forms/${encodeURIComponent(args.form_id)}/responses`,
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'submit_form',
    description:
      'Submit a new form response. Required-field validation runs server-side ' +
      'against the template definition; unknown field keys in `values` are ' +
      'silently ignored (the form definition is the contract). `ref_type` ' +
      'must be one of: job, customer, contractor, and the `ref_id` must ' +
      'belong to your tenant. Requires forms:write scope.',
    scope: 'forms:write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['form_id', 'ref_type', 'ref_id'],
      properties: {
        form_id: { type: 'string', minLength: 1, description: 'Form template UUID.' },
        ref_type: {
          type: 'string',
          enum: ['job', 'customer', 'contractor'],
          description: 'The kind of entity this submission references.',
        },
        ref_id: {
          type: 'string',
          minLength: 1,
          description: 'The id of the referenced job/customer/contractor.',
        },
        values: {
          type: 'object',
          description:
            'Object mapping field_key → submitted value. Booleans, numbers, ' +
            'strings, arrays (for multi_select), and file ids are all valid ' +
            'depending on the field_type defined in the template.',
          additionalProperties: true,
        },
        idempotency_key: {
          type: 'string',
          minLength: 16,
          maxLength: 200,
          description: 'If omitted, a UUID is generated client-side.',
        },
      },
    },
    async handler(args) {
      const { form_id, idempotency_key, ...body } = args || {};
      const idem = idempotency_key || crypto.randomUUID();
      return apiRequest({
        method: 'POST',
        path: `/forms/${encodeURIComponent(form_id)}/submissions`,
        body,
        headers: { 'Idempotency-Key': idem },
      });
    },
  },
];
