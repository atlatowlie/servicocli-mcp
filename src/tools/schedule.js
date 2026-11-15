/**
 * tools/schedule.js — schedule reads and the single-task reschedule.
 *
 * Scopes: schedule:read, schedule:write. Moving a whole job's schedule
 * (anchor date, preview, auto-arrange) is not exposed here.
 */

import { randomUUID } from 'node:crypto';

import { apiRequest } from '../apiClient.js';
import { IDEMPOTENCY_KEY_SCHEMA } from './_shared.js';

const YMD = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const instant = (description) => ({ type: ['string', 'null'], description });

export const tools = [
  {
    name: 'get_schedule',
    description:
      'Tasks scheduled between two company-local dates (from and to, YYYY-MM-DD, inclusive, at ' +
      'most 62 days), earliest first, up to 500. A task is included when it STARTS inside the ' +
      'range. Meetings are not included (use list_meetings). Optional filters: user_id, job_id.',
    scope: 'schedule:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      properties: {
        from: { ...YMD, description: 'First day, YYYY-MM-DD.' },
        to: { ...YMD, description: 'Last day, YYYY-MM-DD.' },
        user_id: { type: 'string' },
        job_id: { type: 'string' },
      },
    },
    handler(query) {
      return apiRequest({ method: 'GET', path: '/schedule', query });
    },
  },

  {
    name: 'get_job_schedule',
    description:
      'One job\'s whole schedule: the project start date, every task with its dates and per-day ' +
      'arrival windows, and the current schedule conflicts. Needs the Project Management module.',
    scope: 'schedule:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', minLength: 1, description: 'Job UUID.' } },
    },
    handler({ id }) {
      return apiRequest({ method: 'GET', path: `/jobs/${encodeURIComponent(id)}/schedule` });
    },
  },

  {
    name: 'reschedule_task',
    description:
      'Change one task\'s schedule: start time, duration, work days, lead days, due date, arrival ' +
      'window or trade category. Send only what changes; null clears a value. Refused (409) if the ' +
      'task is schedule-locked or the new slot overlaps the assignee\'s meeting. A duration needs ' +
      'a start or arrival window. Needs the Project Management module.',
    scope: 'schedule:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'], minProperties: 2,
      properties: {
        id: { type: 'string', minLength: 1, description: 'Task id.' },
        scheduled_at: instant('Start, ISO-8601, or null to unschedule.'),
        duration_minutes: { type: ['integer', 'null'], minimum: 1 },
        work_duration_days: { type: ['integer', 'null'], minimum: 1 },
        lead_days: { type: ['integer', 'null'], minimum: 0 },
        due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
        arrival_window_start: instant('Arrival window start, ISO-8601, or null.'),
        arrival_window_end: instant('Arrival window end, ISO-8601, or null.'),
        trade_category: { type: ['string', 'null'], maxLength: 100 },
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    handler({ id, idempotency_key = randomUUID(), ...body }) {
      return apiRequest({ method: 'PATCH', path: `/tasks/${encodeURIComponent(id)}/schedule`, body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },
];
