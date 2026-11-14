# servicocli-mcp

A local **MCP server** that exposes the [Servico CRM](https://app.servicocrm.com) tenant API (`/api/v1/*`) as typed tool calls for LLM agents like Claude Desktop, Cursor, and any other [Model Context Protocol](https://modelcontextprotocol.io) host.

It runs on your machine as a subprocess of the agent. Your Servico API key never leaves your environment. Each user runs their own isolated instance — there is no shared server, no telemetry, and no opportunity for cross-tenant exposure.

---

## Install

Requires **Node.js 22.19 or newer** (the pinned HTTP client, undici 8, needs it).

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
| `list_jobs_references` | Page through job references. | `jobs:references:read` or `jobs:read`, and Expense Management |
| `list_suppliers_references` | Page through supplier references. | `suppliers:read` and Expense Management |
| `list_contractor_directory` | List contractor IDs, names and maintained aliases. | `expenses:read` and contractor visibility |
| `list_expense_attachments` | List filenames, IDs and original fingerprints. | `expenses:read` |
| `download_expense_attachment` | Read a receipt as base64, up to 10 MiB. | `expenses:read` |
| `upload_expense_attachment` | Attach a PDF or image from base64, up to 10 MiB. | `expenses:write` |
| `list_expense_references` | Page through a stable expense snapshot; filter by invoice number, issuer ID or job ID. | `expenses:read` |
| `list_job_expenses` | List job expenses. | `expenses:read` |
| `create_job_expense` | Create a job expense. | `expenses:write` |
| `list_expense_payments` | List recorded payments on a job expense. | `expenses:read` |
| `record_expense_payment` | Record a payment already made on a job expense. | `expenses:write` |
| `refund_expense_payment` | Record a refund against an existing expense payment. | `expenses:write` |
| `list_suppliers` | List active suppliers and order contacts. | `suppliers:read` |
| `create_supplier` | Create a supplier. | `suppliers:write` |
| `replace_supplier` | Replace supplier details. | `suppliers:write` |
| `update_job` | Update fields on an existing job. | `jobs:write` |
| `get_api_context` | Read tenant identity and authorization context. | Authenticated key |
| `list_jobs` | Paginate jobs. | `jobs:read` |
| `get_job` | Fetch one job. | `jobs:read` |
| `list_invoice_payments` | List the payments on an invoice. | `payments:read` |
| `get_invoice_payment` | Fetch one payment on an invoice. | `payments:read` |
| `set_job_status` | Move a job's status through Servico's status rules. | `jobs:write` |
| `list_job_files` | List a job's files (photos, videos, documents). | `jobs:read` |
| `upload_job_file` | Upload one local file (up to 500 MiB) to a job. | `jobs:write` |
| `list_job_arrivals` | List "arrived" records on a job. | `jobs:read` |
| `record_job_arrival` | Record the bound user's arrival at a job. | `jobs:write` |
| `list_job_selections` | What a job still needs chosen (slots, unmapped lines). | `selections:read` |
| `get_schedule` | Tasks starting in a date range (max 62 days). | `schedule:read` |
| `get_job_schedule` | One job's schedule, arrival windows and conflicts. | `schedule:read` |
| `reschedule_task` | Change one task's start, duration, due date or arrival window. | `schedule:write` |
| `list_tasks` | Paginate project tasks; filter by job, status, assignee. | `tasks:read` |
| `get_task` | Fetch one project task. | `tasks:read` |
| `create_task` | Create a task on a job. | `tasks:create` (or legacy `tasks:write`) |
| `update_task` | Update fields on a task. | `tasks:create` (or legacy `tasks:write`) |
| `list_time_blocks` | Paginate time blocks (time off / busy time). | `time_blocks:read` |
| `get_time_block` | Fetch one time block. | `time_blocks:read` |
| `create_time_block` | Put a time block on a user's calendar. | `time_blocks:write` |
| `update_time_block` | Change a time block. | `time_blocks:write` |
| `list_meetings` | Paginate meetings; filter by job and date window. | `meetings:read` |
| `get_meeting` | Fetch one meeting. | `meetings:read` |
| `create_job_meeting` | Book a meeting on a job. | `meetings:write` |
| `get_availability` | Free slots for one rep on one day. | `meetings:read` |
| `list_users` | List active staff (id, name, email, phone, role). | `users:read` |
| `list_catalogue_products` | Search the selections catalogue of supplier products. | `catalogue:read` |
| `list_approvals` | List Servi's pending approvals (pending only). | `approvals:read` |
| `approve_approval` | Approve a pending approval. Needs a person to confirm. | `approvals:write` |
| `reject_approval` | Reject a pending approval. Needs a person to confirm. | `approvals:write` |
| `list_forms` | Paginate form templates. | `forms:read` |
| `get_form` | Form template + its field schema. | `forms:read` |
| `list_form_responses` | Paginate responses for a template. | `forms:read` |
| `submit_form` | Submit a new form response. | `forms:write` |

**Approvals need a person.** `approve_approval` and `reject_approval` make Servico act for real (text a customer, email a supplier, mark a task done), so the AI cannot decide on its own. Before any API call the server asks you through your client's confirmation prompt (MCP elicitation) and waits for an explicit yes. If your client does not support confirmation prompts, or you answer no, decline or cancel, nothing is sent to Servico and the tool returns an error. In that case decide the approval in Servico itself. Tool descriptions say this too, so the model knows it cannot self-approve.

The same prompt guards `override: true` on `create_time_block` and `update_time_block`: booking over a conflicting task or meeting is sent only after a person says yes.

**Not exposed on purpose:** creating or editing quotes and invoices, recording payments, marking an invoice sent, product prices, whole-job schedule changes (anchor date, preview, auto-arrange), deleting tasks or time blocks, the project agent routes and inbound webhooks.

**Pagination** for standard list tools accepts `limit` (1-100, default 25) and the `next_cursor` from the previous page's response. `list_catalogue_products` pages by `page` and `limit` (up to 200) and returns `total`. Reference lists accept 1–200 records (default 100). Keep the last complete catalog until the new snapshot reaches a null cursor. If a cursor expires, restart at the first page.

**Writes** auto-generate an idempotency key (UUID v4) if you don't pass one (expense writes require you to supply one). Keys are 16-64 characters from `A-Za-z0-9_-`. To re-try safely or to dedupe across retries, supply `idempotency_key` yourself.

---

## Security model

This server is a **local client**. It does not add new attack surface to your Servico tenant:

1. **No shared state.** Every user runs their own subprocess, with their own API key, in their own environment. There is no central server hosting any user's credentials.
2. **API key never leaves your machine.** It travels from `process.env.SERVICO_API_KEY` → `Authorization: Bearer` header → Servico's API. Nothing else reads it. Logs that go to stderr never include the key.
3. **HTTPS-only outbound.** Non-HTTPS bases are rejected, except for `localhost`/`127.0.0.1` for local development. Redirects are never followed (the client uses manual redirect handling and rejects any 3xx) so a malicious DNS response cannot exfiltrate the key to a third party.
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
| `SERVICO_MAX_RETRIES` | no | `3` | Automatic retries after the first attempt. `0` turns retry off. |
| `SERVICO_RETRY_BUDGET_MS` | no | `45000` | Total time one tool call may spend waiting to retry. `0` turns retry off. |

### Automatic retry

The client retries by itself, so an agent call does not fail on a short hiccup:

- **Retried:** HTTP 429 `rate_limited` (the per-minute limit), HTTP 425 `request_in_progress`, and, when safe, network errors, timeouts and HTTP 502/503/504.
- **Never retried:** 429 `quota_exceeded` and `daily_limit_reached` (waiting seconds does not help; the error says when it resets), any other 4xx, HTTP 500 (the outcome is unknown) and `upload_expense_attachment` after an unclear failure.
- **Safe means:** reads (GET) always; a write (POST/PATCH/PUT/DELETE) only when it carries an `Idempotency-Key`, and every attempt sends the same key, so the API replays the first result instead of doing the work twice. A 425 means the first attempt with that key is still running; the client waits and asks again with the same key.
- **Timing:** the `Retry-After` header (seconds or a date) is honoured. If it is longer than 20 s, or does not fit in the time budget, the client does not wait and returns the error ("retry after N s") at once. With no header it backs off exponentially with full jitter (500 ms, 1 s, 2 s, up to 20 s).
- After the last attempt the final error is returned with "gave up after N attempts".

---

## Troubleshooting

**`config_error: SERVICO_API_KEY env var required`**
The agent didn't pass the key through. Re-check the `env` block in your MCP config and restart the agent.

**`config_error: SERVICO_API_KEY appears malformed`**
The expected format is `sk_(live|test)_<32 chars>_<4 hex>`. Check for stray whitespace or copy-paste artifacts (curly quotes, line breaks).

**`[invalid_api_key] Invalid or expired API key` (HTTP 401)**
The key is well-formed but Servico doesn't recognize it. It may have been revoked, or you may be pointing at the wrong tenant. Generate a fresh key.

**`403 insufficient_scope`**
The tool needs a scope your key wasn't created with. Either grant the scope on the existing key, or mint a new key with the broader scope set. See the table above.

**`404 not_found`**
The resource doesn't exist in your tenant, OR your tenant doesn't have the API enabled. A company admin can turn it on in **Settings → API keys**.

**`429 rate_limited`**
You exceeded the per-tenant API rate limit. Slow down or wait — the API sends a `Retry-After` header (also on 425 responses), which the error message surfaces as "retry after N s".

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
npm test
npm run lint
npm run audit:high
npm run pack:check
```

## License

MIT. See [LICENSE](./LICENSE).
