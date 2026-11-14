/**
 * tools/invoices.js — read-only invoice tools.
 *
 * This MCP server exposes read tools only for invoices (the Servico API
 * itself also supports invoice writes and payments; they are not exposed
 * here).
 *
 * Payments are readable (payments:read); recording one is not exposed.
 *
 * Scopes: invoices:read, payments:read
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

  {
    name: 'list_invoice_payments',
    description:
      'List the payments recorded on an invoice (not paginated). Read-only here; ' +
      'this server does not record payments.',
    scope: 'payments:read',
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
        path: `/invoices/${encodeURIComponent(args.id)}/payments`,
      });
    },
  },

  {
    name: 'get_invoice_payment',
    description: 'Fetch one payment on an invoice.',
    scope: 'payments:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'payment_id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Invoice UUID.' },
        payment_id: { type: 'string', minLength: 1, description: 'Payment id.' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/invoices/${encodeURIComponent(args.id)}/payments/${encodeURIComponent(args.payment_id)}`,
      });
    },
  },
];
