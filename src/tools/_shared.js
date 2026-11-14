/**
 * tools/_shared.js — schema fragments shared by every write tool.
 *
 * The server (backend middleware/idempotency.js) requires an
 * Idempotency-Key of 16-64 chars from [A-Za-z0-9_-]. A client-generated
 * UUID v4 (36 chars) satisfies this.
 */

export const IDEMPOTENCY_KEY_SCHEMA = Object.freeze({
  type: 'string',
  minLength: 16,
  maxLength: 64,
  pattern: '^[A-Za-z0-9_-]{16,64}$',
  description:
    'Idempotency key (16-64 chars: letters, digits, "_" or "-"). Reuse the ' +
    'same key when retrying the same write; replays return the cached ' +
    'response. If omitted where optional, a UUID is generated client-side.',
});
