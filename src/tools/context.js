import { apiRequest } from '../apiClient.js';

export const tools = [{
  name: 'get_api_context',
  description: 'Read the tenant identity and authorization context of the current key.',
  scope: null,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler() {
    return apiRequest({ method: 'GET', path: '/me' });
  },
}, ...['jobs', 'suppliers'].map(resource => ({
  name: 'list_' + resource + '_references',
  description: 'Read a page of ' + resource + ' from an authoritative reference snapshot.',
  scope: resource + ':references:read',
  reference: true,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: { type: 'string' } },
  },
  handler(args) {
    return apiRequest({ method: 'GET', path: '/' + resource,
      query: { view: 'references', limit: args?.limit, cursor: args?.cursor } });
  },
}))];
