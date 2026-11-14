/**
 * tools/users.js — staff roster.
 *
 * Scope: users:read (the key's user also needs permission to manage users).
 */

import { apiRequest } from '../apiClient.js';

export const tools = [
  {
    name: 'list_users',
    description:
      'List the active staff of the company (not paginated): id, name, email, phone and role. ' +
      'Use the ids for rep, assignee and availability arguments.',
    scope: 'users:read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler() {
      return apiRequest({ method: 'GET', path: '/users' });
    },
  },
];
