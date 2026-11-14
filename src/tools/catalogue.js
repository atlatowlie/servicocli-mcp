/**
 * tools/catalogue.js — the Selections catalogue (supplier products).
 *
 * Scope: catalogue:read. This is the curated supplier catalogue that job
 * selections choose from, not the priced products list (list_products).
 */

import { apiRequest } from '../apiClient.js';

export const tools = [
  {
    name: 'list_catalogue_products',
    description:
      'Search the selections catalogue of supplier products (active ones only), by name. ' +
      'Filter by category (includes its sub-categories) or search text (name, model or supplier ' +
      'SKU). Paged with page/limit (limit up to 200, default 50); returns total. Not the priced ' +
      'products list: see list_products for that.',
    scope: 'catalogue:read',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        category: { type: 'string', description: 'Category slug.' },
        search: { type: 'string' },
        page: { type: 'integer', minimum: 1, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
    handler(args) {
      return apiRequest({ method: 'GET', path: '/catalogue/products', query: {
        category: args?.category, search: args?.search, page: args?.page, limit: args?.limit,
      } });
    },
  },
];
