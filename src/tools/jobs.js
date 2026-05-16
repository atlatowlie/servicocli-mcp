/**
 * tools/jobs.js — read-only job tools.
 *
 * Jobs are read-only in v1. Job creation involves complex workflow state
 * (scheduling, assignment, sub-status transitions) that isn't yet
 * productised on the public API.
 *
 * Scope: jobs:read
 */

import { apiRequest } from '../apiClient.js';

export const tools = [
  {
    name: 'list_jobs',
    description:
      'List jobs (paginated). Includes title, address, status, sub_status, ' +
      'assigned rep id, and end_date. Read-only in v1.',
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
];
