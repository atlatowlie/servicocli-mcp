/**
 * tools/products.js — catalog_products tools.
 *
 * Note: product ids are integers (SERIAL on the catalog_products table),
 * not UUIDs. The API tolerates a string id and coerces; we keep the
 * schema as `integer` to nudge agents toward the right type.
 *
 * Scopes:
 *   read:  products:read
 *   write: products:write
 */

import { apiRequest } from '../apiClient.js';

const PAGINATION_PROPS = {
  cursor: { type: 'string', description: 'Opaque pagination cursor.' },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
};

export const tools = [
  {
    name: 'list_products',
    description:
      'List catalog products (line-item templates) in your Servico tenant. ' +
      'Archived products are excluded. Paginated by created_at DESC.',
    scope: 'products:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...PAGINATION_PROPS },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: '/products',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'get_product',
    description: 'Fetch a single catalog product by integer id.',
    scope: 'products:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1, description: 'Catalog product id (integer).' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/products/${encodeURIComponent(args.id)}`,
      });
    },
  },

  {
    name: 'create_product',
    description:
      'Create a catalog product. `name` and `category` are required. Numeric ' +
      'fields default to sensible values (cost=0, multiplier_min=2.3, etc.). ' +
      'item_type defaults to "product"; valid values: product, supply, labor, equipment. ' +
      'Requires products:write scope.',
    scope: 'products:write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'category'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        category: { type: 'string', minLength: 1, maxLength: 100 },
        cost: { type: 'number', minimum: 0 },
        unit: { type: 'string', maxLength: 20, default: 'pcs' },
        item_type: {
          type: 'string',
          enum: ['product', 'supply', 'labor', 'equipment'],
          default: 'product',
        },
        multiplier_min: { type: 'number', minimum: 0 },
        min_price: { type: 'number', minimum: 0 },
        sale_price: { type: 'number', minimum: 0 },
        idempotency_key: { type: 'string', minLength: 16, maxLength: 200 },
      },
    },
    async handler(args) {
      const { idempotency_key, ...body } = args || {};
      const idem = idempotency_key || crypto.randomUUID();
      return apiRequest({
        method: 'POST',
        path: '/products',
        body,
        headers: { 'Idempotency-Key': idem },
      });
    },
  },

  {
    name: 'update_product',
    description:
      'PATCH a catalog product. Only the fields you supply are changed. ' +
      'Requires products:write scope.',
    scope: 'products:write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        category: { type: 'string', minLength: 1, maxLength: 100 },
        cost: { type: 'number', minimum: 0 },
        unit: { type: 'string', minLength: 1, maxLength: 20 },
        item_type: { type: 'string', enum: ['product', 'supply', 'labor', 'equipment'] },
        multiplier_min: { type: 'number', minimum: 0 },
        min_price: { type: 'number', minimum: 0 },
        sale_price: { type: 'number', minimum: 0 },
        idempotency_key: { type: 'string', minLength: 16, maxLength: 200 },
      },
    },
    async handler(args) {
      const { id, idempotency_key, ...body } = args || {};
      const idem = idempotency_key || crypto.randomUUID();
      return apiRequest({
        method: 'PATCH',
        path: `/products/${encodeURIComponent(id)}`,
        body,
        headers: { 'Idempotency-Key': idem },
      });
    },
  },
];
