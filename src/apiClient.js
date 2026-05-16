/**
 * apiClient.js — thin HTTPS wrapper for the Servico /api/v1/* surface.
 *
 * Responsibilities:
 *   1. Read + validate SERVICO_API_KEY (format-check before sending it
 *      over the wire — catches obvious paste errors locally).
 *   2. Attach Authorization, User-Agent, and JSON Content-Type headers.
 *   3. Enforce a request timeout (default 30s, configurable via env).
 *   4. Disable HTTP redirects entirely (max=0). The API surface is
 *      same-origin; any redirect = misconfiguration or attack.
 *   5. Reject responses whose Content-Type isn't application/json — the
 *      Servico API is JSON-only; an HTML response means we hit a captive
 *      portal / proxy / login page, not the API. Surface it as an error
 *      rather than try to parse it.
 *   6. Map errors to MCP-style error objects that include the API's
 *      error.code + error.message + request_id for traceability.
 *
 * Auth-key format spec (design doc §2.1):
 *   sk_(live|test)_<32 url-safe chars>_<4 hex chars>
 *
 * The 4-hex-char suffix is a checksum the server validates; we only
 * pre-check the overall shape so an obviously malformed key fails fast
 * with a clear message instead of getting an opaque 401.
 */

import { fetch, Agent } from 'undici';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DEFAULT_BASE = 'https://app.servicocrm.com/api/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const KEY_REGEX = /^sk_(live|test)_[A-Za-z0-9_-]{32}_[a-f0-9]{4}$/;

// Resolve package version once at import. Used in User-Agent so the API
// side can correlate client versions to support tickets / bug reports.
function readPackageVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const VERSION = readPackageVersion();

/**
 * Read + validate the API key from process.env. Throws an MCP-shaped
 * error if missing or malformed; the caller surfaces this to the LLM
 * (and ultimately the user) so they can fix it.
 */
export function getApiKey(env = process.env) {
  const key = env.SERVICO_API_KEY;
  if (!key) {
    throw new ApiClientError({
      code: 'config_error',
      message:
        'SERVICO_API_KEY env var required. Get one from Settings → API Keys ' +
        'in your Servico tenant.',
    });
  }
  if (!KEY_REGEX.test(key)) {
    throw new ApiClientError({
      code: 'config_error',
      message:
        'SERVICO_API_KEY appears malformed. Expected format: ' +
        'sk_(live|test)_<32 chars>_<4 hex>. Check for stray whitespace or quotes.',
    });
  }
  return key;
}

export function getApiBase(env = process.env) {
  const base = env.SERVICO_API_BASE || DEFAULT_BASE;
  // Reject non-https except for explicit local-dev http://localhost or
  // 127.0.0.1. Keeps a typo'd base from leaking the bearer token over
  // plaintext to some random host.
  let u;
  try { u = new URL(base); } catch {
    throw new ApiClientError({
      code: 'config_error',
      message: `SERVICO_API_BASE is not a valid URL: ${base}`,
    });
  }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) {
    throw new ApiClientError({
      code: 'config_error',
      message:
        `SERVICO_API_BASE must use https:// (http:// is only allowed for ` +
        `localhost/127.0.0.1 in dev). Got: ${base}`,
    });
  }
  return base.replace(/\/+$/, '');
}

export function getTimeoutMs(env = process.env) {
  const raw = env.SERVICO_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 300_000) return DEFAULT_TIMEOUT_MS;
  return Math.floor(n);
}

/**
 * Custom error class so callers can branch on `err.code` (the canonical
 * stable code) and `err.requestId` (for traceability with Servico
 * support). Anything else is a programming bug; let it bubble.
 */
export class ApiClientError extends Error {
  constructor({ code, message, status, requestId, details }) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.requestId = requestId || null;
    this.details = details;
  }
  /** Render as a single string suitable for surfacing to the LLM. */
  toAgentMessage() {
    const parts = [`[${this.code}]`, this.message];
    if (this.requestId) parts.push(`(request_id: ${this.requestId})`);
    return parts.join(' ');
  }
}

/**
 * Build an undici Agent that:
 *   - Disables auto-follow on redirects (max=0). The API is single-origin;
 *     any 3xx is a misconfiguration or a hijack attempt and should surface.
 *   - Caps connect/headers timeouts to the configured per-request timeout.
 *
 * Memoized per-(timeout) so we don't create new agents per request, which
 * would defeat connection pooling and the keep-alive savings.
 */
const agentCache = new Map();
function getAgent(timeoutMs) {
  const cached = agentCache.get(timeoutMs);
  if (cached) return cached;
  const agent = new Agent({
    connectTimeout: Math.min(timeoutMs, 10_000),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    maxRedirections: 0,
  });
  agentCache.set(timeoutMs, agent);
  return agent;
}

/**
 * Build the canonical request headers. `extra` is merged last so callers
 * can override (Idempotency-Key etc.).
 *
 * NEVER log the Authorization value. The User-Agent is intentionally
 * verbose so the API logs make support tickets easy.
 */
function buildHeaders(apiKey, extra) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': `servicocli-mcp/${VERSION} (+https://github.com/atlatowlie/servicocli-mcp)`,
    ...(extra || {}),
  };
}

/**
 * Core request. Returns the unwrapped `data` field of the standard
 * envelope, or throws ApiClientError on any non-2xx, network error, or
 * non-JSON response.
 *
 * `query` is a flat object → URLSearchParams. `body` is anything
 * JSON-serializable (only for non-GET methods). Both optional.
 *
 * `pathParams` is used to validate that path segments don't contain
 * unencoded slashes/spaces — caller is responsible for encoding values
 * via `encodeURIComponent` before substitution, but we sanity-check here.
 */
export async function apiRequest({
  method,
  path,
  query,
  body,
  headers,
  env = process.env,
}) {
  if (!method || !path) {
    throw new Error('apiRequest: method and path are required');
  }
  if (!path.startsWith('/')) {
    throw new Error(`apiRequest: path must start with '/' (got: ${path})`);
  }
  const apiKey = getApiKey(env);
  const base = getApiBase(env);
  const timeoutMs = getTimeoutMs(env);

  let url = base + path;
  if (query && typeof query === 'object') {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      usp.append(k, String(v));
    }
    const qs = usp.toString();
    if (qs) url += `?${qs}`;
  }

  const init = {
    method,
    headers: buildHeaders(apiKey, headers),
    dispatcher: getAgent(timeoutMs),
    redirect: 'manual',
    // Per-request abort fallback in case undici timeouts don't fire (e.g.
    // a stuck stream after headers). Belt-and-braces.
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Network-layer failure: DNS, TLS, refused, timeout, abort.
    throw new ApiClientError({
      code: 'NETWORK_ERROR',
      message: `Network error calling ${method} ${path}: ${err.message || err}`,
      details: { cause: String(err.message || err) },
    });
  }

  // Reject redirects explicitly — getAgent sets maxRedirections=0, so
  // a 3xx surfaces here. The Servico API never legitimately redirects.
  if (res.status >= 300 && res.status < 400) {
    throw new ApiClientError({
      code: 'UPSTREAM_ERROR',
      status: res.status,
      message: `Unexpected ${res.status} redirect calling ${method} ${path}. ` +
               'The Servico API does not redirect; check SERVICO_API_BASE.',
    });
  }

  // Content-type check. Anything other than application/json (with optional
  // charset) means we're not talking to the API — could be a captive
  // portal, proxy error page, or a misconfigured base URL pointing at the
  // marketing site. Surface it rather than try to parse HTML.
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    let snippet = '';
    try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new ApiClientError({
      code: res.status >= 500 ? 'UPSTREAM_ERROR'
        : res.status >= 400 ? 'UPSTREAM_ERROR' : 'PROTOCOL_ERROR',
      status: res.status,
      message:
        `Expected application/json response but got "${ct || '(none)'}" ` +
        `(status ${res.status}). First 200 bytes: ${JSON.stringify(snippet)}. ` +
        'Check SERVICO_API_BASE.',
      requestId: res.headers.get('x-request-id'),
    });
  }

  let parsed;
  try {
    parsed = await res.json();
  } catch (err) {
    throw new ApiClientError({
      code: 'PROTOCOL_ERROR',
      status: res.status,
      message: `Failed to parse JSON response from ${method} ${path}: ${err.message}`,
      requestId: res.headers.get('x-request-id'),
    });
  }

  const requestId =
    (parsed && parsed.meta && parsed.meta.request_id) ||
    (parsed && parsed.error && parsed.error.request_id) ||
    res.headers.get('x-request-id') ||
    null;

  if (!res.ok) {
    // Error envelope per API spec: { error: { code, message, request_id } }
    const errBody = parsed && parsed.error ? parsed.error : null;
    const apiCode = (errBody && errBody.code) || 'unknown_error';
    const apiMsg = (errBody && errBody.message) || `HTTP ${res.status}`;
    // 5xx maps to UPSTREAM_ERROR; 4xx keeps the API's stable code so
    // the LLM can branch on e.g. 'insufficient_scope' or 'rate_limited'.
    const code = res.status >= 500 ? 'UPSTREAM_ERROR' : apiCode;
    throw new ApiClientError({
      code,
      status: res.status,
      message: apiMsg,
      requestId,
      details: errBody || null,
    });
  }

  // Success: unwrap `data` (resource view) — agents care about the
  // resource itself, not the envelope. Surface paging meta inline when
  // present so list tools can return cursor/has_more without burdening
  // the agent with our envelope shape.
  if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'data')) {
    const data = parsed.data;
    const meta = parsed.meta || {};
    if (meta.page && (meta.page.next_cursor !== undefined || meta.page.has_more !== undefined)) {
      // List response: return { data, next_cursor, has_more }
      return {
        data,
        next_cursor: meta.page.next_cursor || null,
        has_more: !!meta.page.has_more,
        request_id: requestId,
      };
    }
    return { data, request_id: requestId };
  }

  // Shouldn't happen on /api/v1/*, but if we ever see a non-enveloped
  // body, return it as-is to be forward-compatible.
  return parsed;
}

// Exported for tests.
export const __internal = { KEY_REGEX, DEFAULT_BASE, DEFAULT_TIMEOUT_MS, VERSION };
