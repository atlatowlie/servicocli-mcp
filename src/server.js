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
 *     inputSchema, handler }.
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
import { tools as jobTools } from './tools/jobs.js';
import { tools as formTools } from './tools/forms.js';

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
    invoiceTools, jobTools, formTools,
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

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Array.from(reg.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

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
      const result = await tool.handler(args || {});
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
