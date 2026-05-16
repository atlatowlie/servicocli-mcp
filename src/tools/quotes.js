/**
 * tools/quotes.js — read-only quote tools.
 *
 * Quotes are read-only in v1 of the Servico API. Use get_quote_line_items
 * to fetch the line items for a quote (separate call so the list endpoint
 * stays slim — most agents browsing quotes don't need all the line items).
 *
 * Scope: quotes:read
 */

import { apiRequest } from '../apiClient.js';

export const tools = [
  {
    name: 'list_quotes',
    description:
      'List quotes (paginated). Includes status (draft, sent, accepted, ' +
      'rejected, signed), totals, and customer-side denormalized fields. ' +
      'Read-only — quotes are created in the Servico UI.',
    scope: 'quotes:read',
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
        path: '/quotes',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'get_quote',
    description:
      'Fetch a single quote by UUID. Returns the full quote record ' +
      'including terms, descriptions, signed_at timestamp, etc. (but NOT ' +
      'line items — use get_quote_line_items for those).',
    scope: 'quotes:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Quote UUID.' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/quotes/${encodeURIComponent(args.id)}`,
      });
    },
  },

  {
    name: 'get_quote_line_items',
    description:
      'List the line items for a single quote, sorted by sort_order ASC. ' +
      'Tenant-scoped — returns 404 if the parent quote is not in your tenant.',
    scope: 'quotes:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['quote_id'],
      properties: {
        quote_id: { type: 'string', minLength: 1, description: 'Parent quote UUID.' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/quotes/${encodeURIComponent(args.quote_id)}/line-items`,
      });
    },
  },
];
