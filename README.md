# servicocli-mcp

A local **MCP server** that exposes the [Servico CRM](https://app.servicocrm.com) tenant API (`/api/v1/*`) as typed tool calls for LLM agents like Claude Desktop, Cursor, and any other [Model Context Protocol](https://modelcontextprotocol.io) host.

It runs on your machine as a subprocess of the agent. Your Servico API key never leaves your environment. Each user runs their own isolated instance — there is no shared server, no telemetry, and no opportunity for cross-tenant exposure.

---

## Install

You don't have to clone or build anything — `npx` runs the latest published version:

```bash
npx -y @servicocrm/servicocli-mcp
```

It will exit immediately if `SERVICO_API_KEY` is not set; the agent's spawn config supplies it (see below).

## Getting an API key

1. Sign in to your Servico tenant at `https://app.servicocrm.com`.
2. Go to **Settings → API Keys**.
3. Click **Create key**, give it a label (e.g. "claude-desktop"), and pick the scopes you want (e.g. `customers:read`, `quotes:read`).
4. Copy the key — it's shown only once. Format: `sk_live_<32 chars>_<4 hex>` (or `sk_test_…` in a sandbox tenant).

To **revoke** a key, return to the same screen and click Revoke next to the row. Revocations take effect immediately.

To **rotate**, create a new key, update your agent config, then revoke the old one.

---

## Configure Claude Desktop

Edit `claude_desktop_config.json` (see [Anthropic's docs](https://modelcontextprotocol.io/quickstart/user) for the platform-specific path — usually `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows) and add:

```json
{
  "mcpServers": {
    "servico": {
      "command": "npx",
      "args": ["-y", "@servicocrm/servicocli-mcp"],
      "env": {
        "SERVICO_API_KEY": "sk_live_REPLACE_ME"
      }
    }
  }
}
```

Restart Claude Desktop. The "servico" server should appear in the MCP indicator at the bottom of the chat window. Try asking *"list my 5 most recent customers"*.

## Configure Cursor

Edit `~/.cursor/mcp.json` (or **Cursor Settings → MCP**):

```json
{
  "mcpServers": {
    "servico": {
      "command": "npx",
      "args": ["-y", "@servicocrm/servicocli-mcp"],
      "env": {
        "SERVICO_API_KEY": "sk_live_REPLACE_ME"
      }
    }
  }
}
```

Restart Cursor.

---

## Available tools

| Tool | Description | Required scope |
|------|-------------|----------------|
| `list_customers` | Paginate customers, newest first. | `customers:read` |
| `get_customer` | Fetch one customer by id. | `customers:read` |
| `create_customer` | Create a customer (Idempotency-Key auto-set). | `customers:write` |
| `update_customer` | PATCH a customer; only fields you supply change. | `customers:write` |
| `list_products` | Paginate catalog products. | `products:read` |
| `get_product` | Fetch one product by integer id. | `products:read` |
| `create_product` | Create a catalog product. | `products:write` |
| `update_product` | PATCH a catalog product. | `products:write` |
| `list_quotes` | Paginate quotes. | `quotes:read` |
| `get_quote` | Fetch one quote (header fields). | `quotes:read` |
| `get_quote_line_items` | Line items for a quote. | `quotes:read` |
| `list_invoices` | Paginate invoices. | `invoices:read` |
| `get_invoice` | Fetch one invoice. | `invoices:read` |
| `list_jobs` | Paginate jobs. | `jobs:read` |
| `get_job` | Fetch one job. | `jobs:read` |
| `list_forms` | Paginate form templates. | `forms:read` |
| `get_form` | Form template + its field schema. | `forms:read` |
| `list_form_responses` | Paginate responses for a template. | `forms:read` |
| `submit_form` | Submit a new form response. | `forms:write` |

**Pagination** works the same on every list tool: pass `limit` (1-100, default 25) and the `next_cursor` from the previous page's response.

**Writes** auto-generate an idempotency key (UUID v4) if you don't pass one. To re-try safely or to dedupe across retries, supply `idempotency_key` yourself.

---

## Security model

This server is a **local client**. It does not add new attack surface to your Servico tenant:

1. **No shared state.** Every user runs their own subprocess, with their own API key, in their own environment. There is no central server hosting any user's credentials.
2. **API key never leaves your machine.** It travels from `process.env.SERVICO_API_KEY` → `Authorization: Bearer` header → Servico's API. Nothing else reads it. Logs that go to stderr never include the key.
3. **HTTPS-only outbound.** Non-HTTPS bases are rejected, except for `localhost`/`127.0.0.1` for local development. Redirects are disabled (max=0) so a malicious DNS response cannot exfiltrate the key to a third party.
4. **JSON-only.** Non-JSON responses (e.g. HTML captive portal pages) are rejected rather than silently parsed.
5. **No `postinstall`, no telemetry, no analytics.** Pinned versions in `package-lock.json`; CI fails on lockfile drift.
6. **Server-side scopes** are enforced by Servico — even if the local client misbehaves, an unscoped key cannot do unscoped things.

Treat your API key like a password. Use the smallest set of scopes that lets the agent do useful work; rotate keys you've shared with others.

---

## Configuration reference

| Env var | Required | Default | Notes |
|---|---|---|---|
| `SERVICO_API_KEY` | yes | — | `sk_live_…` or `sk_test_…` |
| `SERVICO_API_BASE` | no | `https://app.servicocrm.com/api/v1` | Override for sandbox/staging |
| `SERVICO_TIMEOUT_MS` | no | `30000` | Per-request timeout in ms |

---

## Troubleshooting

**`config_error: SERVICO_API_KEY env var required`**
The agent didn't pass the key through. Re-check the `env` block in your MCP config and restart the agent.

**`config_error: SERVICO_API_KEY appears malformed`**
The expected format is `sk_(live|test)_<32 chars>_<4 hex>`. Check for stray whitespace or copy-paste artifacts (curly quotes, line breaks).

**`401 invalid_api_key`**
The key is well-formed but Servico doesn't recognize it. It may have been revoked, or you may be pointing at the wrong tenant. Generate a fresh key.

**`403 insufficient_scope`**
The tool needs a scope your key wasn't created with. Either grant the scope on the existing key, or mint a new key with the broader scope set. See the table above.

**`404 not_found`**
The resource doesn't exist in your tenant, OR your tenant doesn't have `api_v1_enabled` turned on. Contact Servico support to opt in.

**`429 rate_limited`**
You exceeded the per-tenant API rate limit. Slow down or wait — the API returns `retry-after` in the error payload.

**`PROTOCOL_ERROR: Expected application/json … but got text/html`**
You're not talking to the API. Check `SERVICO_API_BASE` — most often this means you pointed at the marketing site or a captive portal.

**MCP server fails to start in Claude Desktop**
The host logs to `~/Library/Logs/Claude/mcp-server-servico.log` (macOS). Tail that file — the first line tells you which env var is missing.

---

## Contributing

This is a thin client. Issues and PRs welcome at <https://github.com/atlatowlie/servicocli-mcp>.

Development:

```bash
git clone https://github.com/atlatowlie/servicocli-mcp
cd servicocli-mcp
npm ci
npm test           # 58 tests, ~2s
npm run lint
npm run audit:high
npm run pack:check
```

## License

MIT. See [LICENSE](./LICENSE).
