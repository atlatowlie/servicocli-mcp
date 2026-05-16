#!/usr/bin/env node
/**
 * bin/servicocli-mcp.js — executable entry point.
 *
 * Spawned by Claude Desktop / Cursor / etc. via the MCP `command` field.
 * stdin/stdout are reserved for JSON-RPC; all logging goes to stderr.
 *
 * We unhandledRejection-trap so a thrown handler doesn't take down the
 * process silently — the MCP host sees the stream close and reports it,
 * but it's much easier to debug with the stack visible on stderr.
 */

import { main } from '../src/server.js';

process.on('unhandledRejection', (err) => {
  process.stderr.write(
    `[servicocli-mcp] unhandledRejection: ${err && err.stack || err}\n`
  );
  // Exit non-zero so the host knows we crashed (not a clean disconnect).
  process.exit(1);
});

main().catch((err) => {
  process.stderr.write(
    `[servicocli-mcp] fatal: ${err && err.stack || err}\n`
  );
  process.exit(1);
});
