/**
 * server.js — MCP server setup + tool registration.
 *
 * stdio transport: the agent (Claude Desktop, Cursor, etc.) spawns this
 * server as a subprocess and exchanges JSON-RPC over stdin/stdout. No
 * network listener — the only outbound traffic is HTTPS to the Servico
 * API. See README §Security model.
 *
 * Tool dispatch:
 *   - Each tools/*.js exports an array of { name, description, scope,
 *     inputSchema, handler }. handler(args, ctx): ctx.confirm(message)
 *     asks the person through MCP elicitation (tools marked
 *     requiresHumanConfirmation use it).
 *   - On ListTools, we project { name, description, inputSchema } so the
 *     LLM sees what it can do without us leaking internal scope wiring.
 *   - On CallTool, we look up the handler, await it, and serialize the
 *     return value as a single text-content block (the agent receives a
 *     JSON-encoded string — agents parse this back into objects natively).
 *
 * Errors:
 *   - ApiClientError → CallToolResult with isError=true and the
 *     toAgentMessage() string. The agent sees the API's stable error
 *     code + message + request_id and can react accordingly.
 *   - Schema validation errors (handled by the SDK) surface as JSON-RPC
 *     -32602 with the failing field path.
 *   - Anything else → CallToolResult with isError=true and a generic
 *     "internal error" message. The original Error is logged to stderr
 *     for the operator (NOT exposed to the LLM, since exception
 *     messages can leak internal details).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ApiClientError } from './apiClient.js';
import { tools as customerTools } from './tools/customers.js';
import { tools as productTools } from './tools/products.js';
import { tools as quoteTools } from './tools/quotes.js';
import { tools as invoiceTools } from './tools/invoices.js';
import { tools as contextTools } from './tools/context.js';
import { tools as expenseTools } from './tools/expenses.js';
import { tools as supplierTools } from './tools/suppliers.js';
import { tools as jobTools } from './tools/jobs.js';
import { tools as formTools } from './tools/forms.js';
import { tools as scheduleTools } from './tools/schedule.js';
import { tools as taskTools } from './tools/tasks.js';
import { tools as timeBlockTools } from './tools/timeBlocks.js';
import { tools as meetingTools } from './tools/meetings.js';
import { tools as userTools } from './tools/users.js';
import { tools as catalogueTools } from './tools/catalogue.js';
import { tools as approvalTools } from './tools/approvals.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Build the flat tool registry. Tool names are globally unique across
 * modules — we validate that here so a future merge accidentally
 * shadowing a tool fails loudly on startup, not silently at call time.
 */
export function buildRegistry() {
  const groups = [
    customerTools, productTools, quoteTools,
    invoiceTools, jobTools, formTools, contextTools, supplierTools, expenseTools,
    scheduleTools, taskTools, timeBlockTools, meetingTools, userTools, catalogueTools,
    approvalTools,
  ];
  const registry = new Map();
  for (const group of groups) {
    for (const tool of group) {
      if (registry.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      registry.set(tool.name, tool);
    }
  }
  return registry;
}

/**
 * Wire the MCP request handlers onto a fresh Server instance. Exported
 * for tests so they can drive the dispatcher without spinning a
 * transport.
 */
export function visibleTools(registry, context) {
  return Array.from(registry.values()).filter(tool => {
    if (!tool.scope) return true;
    const scopes = context?.scopes || [];
    if (tool.reference || tool.explicitScope) return scopes.includes(tool.scope);
    if (context?.reference_only) return false;
    // `alsoScopes`: other grants the API accepts for the same route (for
    // example tasks:write is the legacy twin of tasks:create).
    return [tool.scope, ...(tool.alsoScopes || [])].some(scope =>
      scopes.includes(scope) || scopes.includes('*') ||
      scopes.includes(scope.split(':')[0] + ':*') ||
      (scope.endsWith(':read') && scopes.includes('read')));
  });
}

const CONFIRM_TIMEOUT_MS = 5 * 60_000;

/**
 * The handler context for tools that need a person in the loop. `confirm`
 * asks the human through the MCP client's elicitation prompt and resolves
 * true only when they accept AND answer yes. A client without form
 * elicitation, a decline, a cancel, a "no", a timeout or any error all
 * resolve false: the caller must then make no API call.
 */
export function makeToolContext(server) {
  return {
    async confirm(message) {
      if (!server.getClientCapabilities()?.elicitation?.form) return false;
      try {
        const res = await server.elicitInput({
          message,
          requestedSchema: {
            type: 'object',
            properties: {
              confirm: {
                type: 'boolean',
                title: 'Confirm',
                description: 'Yes to go ahead, no to cancel.',
                default: false,
              },
            },
            required: ['confirm'],
          },
        }, { timeout: CONFIRM_TIMEOUT_MS });
        return res.action === 'accept' && res.content?.confirm === true;
      } catch {
        return false;
      }
    },
  };
}

const CONTEXT_CACHE_MS = 60_000;

export function createServer({ registry } = {}) {
  const reg = registry || buildRegistry();
  const server = new Server(
    {
      name: 'servicocli-mcp',
      version: readVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // /me is read on every tools/list to filter by scope. Cache a success
  // briefly so hosts that re-list often do not spend a request each time.
  let cachedContext = null;
  let cachedAt = 0;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let available;
    const now = Date.now();
    if (cachedContext && now - cachedAt < CONTEXT_CACHE_MS) {
      available = visibleTools(reg, cachedContext);
    } else {
      try {
        const context = await reg.get('get_api_context')?.handler();
        cachedContext = context?.data || null;
        cachedAt = now;
        available = visibleTools(reg, cachedContext);
      } catch (err) {
        // Bad key, API not enabled, network down: still list get_api_context so
        // the agent can call it and read the real error, instead of the host
        // showing no tools and no reason.
        cachedContext = null;
        process.stderr.write(
          `[servicocli-mcp] tools/list: could not read /me: ${err.message || err}\n`
        );
        available = Array.from(reg.values()).filter((t) => t.name === 'get_api_context');
      }
    }
    return {
      tools: available.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  const toolContext = makeToolContext(server);

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = reg.get(name);
    if (!tool) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Unknown tool: ${name}. Call ListTools to see available tools.`,
        }],
      };
    }
    try {
      const result = await tool.handler(args || {}, toolContext);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      if (err instanceof ApiClientError) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.toAgentMessage() }],
        };
      }
      // Surprise error — log full stack for the operator, return a
      // sanitized message to the agent. Never echo `err.message` back
      // to the LLM directly; it can carry internal paths / config.
      process.stderr.write(
        `[servicocli-mcp] tool=${name} unexpected error: ${err.stack || err.message || err}\n`
      );
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `[internal_error] Tool '${name}' failed unexpectedly. ` +
                `Check the MCP server logs for details.`,
        }],
      };
    }
  });

  return server;
}

/**
 * Start the server on stdio. Called from bin/servicocli-mcp.js. Any
 * top-level config error (missing API key, malformed env) is rendered
 * as a single-line stderr message and a non-zero exit — the host agent
 * surfaces that to the user as "MCP server failed to start".
 */
export async function main() {
  // Eager config validation: we'd rather fail at startup than at the
  // first tool call. The actual key check happens lazily in apiRequest
  // (so tests can run without setting one), but at server boot we
  // require it.
  if (!process.env.SERVICO_API_KEY) {
    process.stderr.write(
      '[servicocli-mcp] SERVICO_API_KEY env var is required. ' +
      'Get one from Settings → API Keys in your Servico tenant.\n'
    );
    process.exit(2);
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes (i.e. parent agent disconnects).
}
