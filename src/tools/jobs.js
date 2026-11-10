import { randomUUID } from 'node:crypto';

import { apiRequest } from '../apiClient.js';

export const tools = [
  {
    name: 'list_jobs',
    description:
      'List jobs (paginated). Includes title, address, status, sub_status, ' +
      'assigned rep id, and end_date. Use update_job to edit permitted fields.',
    scope: 'jobs:read',
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
        path: '/jobs',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'get_job',
    description: 'Fetch a single job by UUID with full details (SKU, source, type, etc.).',
    scope: 'jobs:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Job UUID.' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/jobs/${encodeURIComponent(args.id)}`,
      });
    },
  },
  {
    name: 'update_job',
    description: 'Update the supplied fields on an existing job.',
    scope: 'jobs:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id', 'changes'],
      properties: {
        id: { type: 'string', minLength: 1 },
        changes: { type: 'object', minProperties: 1, description: 'Job fields accepted by PATCH /jobs/{id}, such as title, address, or status.' },
        idempotency_key: { type: 'string', minLength: 16, maxLength: 64 },
      },
    },
    handler({ id, changes, idempotency_key = randomUUID() }) {
      return apiRequest({ method: 'PATCH', path: '/jobs/' + encodeURIComponent(id), body: changes,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },
];
