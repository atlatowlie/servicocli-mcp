/**
 * tools/timeBlocks.js — time blocks (time off / busy time on a person's calendar).
 *
 * Scopes: time_blocks:read, time_blocks:write. Deleting a block is not exposed.
 */

import { randomUUID } from 'node:crypto';

import { apiRequest, ApiClientError } from '../apiClient.js';
import { IDEMPOTENCY_KEY_SCHEMA } from './_shared.js';

const RECURRENCE = ['none', 'daily', 'weekly', 'monthly'];
const OVERRIDE = {
  type: 'boolean',
  description:
    'Book over a conflicting task or meeting. REQUIRES HUMAN CONFIRMATION: the person is asked ' +
    'to confirm in the client; without a yes nothing is sent.',
};

/** Booking over a conflict is a person's call: ask through ctx.confirm, refuse without a yes. */
async function confirmOverride(body, ctx, what) {
  if (body.override !== true) return;
  const ok = typeof ctx?.confirm === 'function'
    ? await ctx.confirm(`${what}\nThis books over a conflicting task or meeting. Book it anyway?`)
    : false;
  if (!ok) {
    throw new ApiClientError({
      code: 'confirmation_required',
      message: 'Booking over a conflict needs a person to confirm it in a client that supports ' +
        'confirmation prompts, or to do it in Servico itself. Nothing was sent.',
    });
  }
}

export const tools = [
  {
    name: 'list_time_blocks',
    description:
      'List time blocks (paginated). from/to (date or ISO-8601) select every block with an ' +
      'occurrence in the window; repeating blocks are returned once, not expanded. A block may be ' +
      'pending time-off awaiting approval (status).',
    scope: 'time_blocks:read',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        user_id: { type: 'string' },
        from: { type: 'string', description: 'YYYY-MM-DD or ISO-8601.' },
        to: { type: 'string', description: 'YYYY-MM-DD or ISO-8601.' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
    handler(args) {
      return apiRequest({ method: 'GET', path: '/time-blocks', query: {
        user_id: args?.user_id, from: args?.from, to: args?.to, cursor: args?.cursor, limit: args?.limit,
      } });
    },
  },

  {
    name: 'get_time_block',
    description: 'Fetch one time block by id.',
    scope: 'time_blocks:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', minLength: 1 } },
    },
    handler({ id }) {
      return apiRequest({ method: 'GET', path: `/time-blocks/${encodeURIComponent(id)}` });
    },
  },

  {
    name: 'create_time_block',
    description:
      'Put a time block on a user\'s calendar (user_id, title, start_at, end_at). The start cannot ' +
      'be in the past. Overlap with the user\'s task or meeting is refused (409) unless override is ' +
      'true. Time off may be created as pending and wait for approval in Servico.',
    scope: 'time_blocks:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['user_id', 'title', 'start_at', 'end_at'],
      properties: {
        user_id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        start_at: { type: 'string', description: 'ISO-8601.' },
        end_at: { type: 'string', description: 'ISO-8601, after start_at.' },
        recurrence: { type: 'string', enum: RECURRENCE },
        recurrence_until: { type: ['string', 'null'], description: 'Last day of a repeating block.' },
        override: OVERRIDE,
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    requiresHumanConfirmation: 'when override is true',
    async handler({ idempotency_key = randomUUID(), ...body }, ctx) {
      await confirmOverride(body, ctx, `Create time block "${body.title}" ${body.start_at} to ${body.end_at}.`);
      return apiRequest({ method: 'POST', path: '/time-blocks', body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },

  {
    name: 'update_time_block',
    description:
      'Change a time block\'s title, times or recurrence; only what you send changes. Re-timing an ' +
      'active time-off block may send it back to pending approval. Conflicts are refused (409) ' +
      'unless override is true.',
    scope: 'time_blocks:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'], minProperties: 2,
      properties: {
        id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        start_at: { type: 'string', description: 'ISO-8601.' },
        end_at: { type: 'string', description: 'ISO-8601.' },
        recurrence: { type: 'string', enum: RECURRENCE },
        recurrence_until: { type: ['string', 'null'] },
        override: OVERRIDE,
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    requiresHumanConfirmation: 'when override is true',
    async handler({ id, idempotency_key = randomUUID(), ...body }, ctx) {
      await confirmOverride(body, ctx, `Change time block ${id}.`);
      return apiRequest({ method: 'PATCH', path: `/time-blocks/${encodeURIComponent(id)}`, body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },
];
