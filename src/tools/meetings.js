/**
 * tools/meetings.js — meetings and rep availability.
 *
 * Scopes: meetings:read, meetings:write. Meetings created here always
 * start as "scheduled"; outcomes are recorded in Servico by a person.
 */

import { randomUUID } from 'node:crypto';

import { apiRequest } from '../apiClient.js';
import { IDEMPOTENCY_KEY_SCHEMA } from './_shared.js';

const MEETING_TYPES = [
  'first_visit', 'follow_up', 'contract_signing', 'project_kickoff', 'site_checkin', 'final_walkthrough',
];

export const tools = [
  {
    name: 'list_meetings',
    description:
      'List meetings (paginated), by scheduled time. Filter by job_id and a from/to window ' +
      '(date or ISO-8601). A user limited to their own jobs sees colleagues\' meetings as "Busy" blocks.',
    scope: 'meetings:read',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        job_id: { type: 'string' },
        from: { type: 'string', description: 'YYYY-MM-DD or ISO-8601.' },
        to: { type: 'string', description: 'YYYY-MM-DD or ISO-8601.' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
    handler(args) {
      return apiRequest({ method: 'GET', path: '/meetings', query: {
        job_id: args?.job_id, from: args?.from, to: args?.to, cursor: args?.cursor, limit: args?.limit,
      } });
    },
  },

  {
    name: 'get_meeting',
    description: 'Fetch one meeting by id.',
    scope: 'meetings:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', minLength: 1 } },
    },
    handler({ id }) {
      return apiRequest({ method: 'GET', path: `/meetings/${encodeURIComponent(id)}` });
    },
  },

  {
    name: 'create_job_meeting',
    description:
      'Book a meeting on a job (type and scheduled_at required). It starts as "scheduled" and ' +
      'reminders are queued as in the app. Refused (409 schedule_conflict) if a listed rep is ' +
      'already booked, and (409 first_visit_exists) for a second first visit. Check ' +
      'get_availability first.',
    scope: 'meetings:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['job_id', 'type', 'scheduled_at'],
      properties: {
        job_id: { type: 'string', minLength: 1, description: 'Job UUID.' },
        type: { type: 'string', enum: MEETING_TYPES },
        scheduled_at: { type: 'string', description: 'ISO-8601 start.' },
        duration_min: { type: 'integer', minimum: 1, maximum: 480 },
        location: { type: 'string', maxLength: 500 },
        notes: { type: 'string', maxLength: 5000 },
        rep_id: { type: 'string', description: 'Primary rep (user id).' },
        rep_ids: { type: 'array', items: { type: 'string' }, description: 'Additional reps (user ids).' },
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    handler({ job_id, idempotency_key = randomUUID(), ...body }) {
      return apiRequest({ method: 'POST', path: `/jobs/${encodeURIComponent(job_id)}/meetings`, body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },

  {
    name: 'get_availability',
    description:
      'Free time slots for one rep on one company-local day, for a meeting of duration_min ' +
      '(default 60), using the same availability rules as the booking screen. Also says whether ' +
      'the day is closed.',
    scope: 'meetings:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['user_id', 'date'],
      properties: {
        user_id: { type: 'string', minLength: 1 },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD.' },
        duration_min: { type: 'integer', minimum: 1 },
      },
    },
    handler(query) {
      return apiRequest({ method: 'GET', path: '/availability', query });
    },
  },
];
