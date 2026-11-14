/**
 * tools/invoices.js — read-only invoice tools.
 *
 * This MCP server exposes read tools only for invoices (the Servico API
 * itself also supports invoice writes and payments; they are not exposed
 * here).
 *
 * Scope: invoices:read
 */

import { apiRequest } from '../apiClient.js';

export const tools = [
  {
    name: 'list_invoices',
    description:
      'List invoices in your tenant (paginated). Includes status, amounts ' +
      '(subtotal, tax, total, paid, due), and the linked quote/job ids. Read-only here — this MCP ' +
      'server does not create or edit invoices.',
    scope: 'invoices:read',
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
        path: '/invoices',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'get_invoice',
    description: 'Fetch a single invoice by UUID with full details.',
    scope: 'invoices:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Invoice UUID.' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/invoices/${encodeURIComponent(args.id)}`,
      });
    },
  },
];
