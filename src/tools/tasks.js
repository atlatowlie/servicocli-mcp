/**
 * tools/tasks.js — project task tools (list, get, create, update).
 *
 * Scopes: tasks:read; create/update need tasks:create (the legacy
 * tasks:write is accepted too). Deleting a task is not exposed. All need
 * the Project Management module.
 */

import { randomUUID } from 'node:crypto';

import { apiRequest } from '../apiClient.js';
import { IDEMPOTENCY_KEY_SCHEMA } from './_shared.js';

const STATUS = ['todo', 'in_progress', 'done', 'blocked'];

const writable = {
  title: { type: 'string', minLength: 1, maxLength: 500 },
  description: { type: ['string', 'null'], maxLength: 5000 },
  assigned_to: { type: ['string', 'null'], description: 'User id (assigned_to_type "user").' },
  assigned_to_type: { type: 'string', enum: ['user', 'contractor'] },
  assigned_to_contractor: { type: ['string', 'null'], description: 'Contractor id (assigned_to_type "contractor").' },
  status: { type: 'string', enum: STATUS },
  due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD.' },
  scheduled_at: { type: ['string', 'null'], description: 'Start, ISO-8601.' },
  duration_minutes: { type: ['integer', 'null'], minimum: 0, description: 'Needs scheduled_at or arrival_window_start.' },
  phase_id: { type: ['string', 'null'] },
  parent_task_id: { type: ['string', 'null'] },
  sort_order: { type: 'integer' },
  schedule_tentative: { type: 'boolean', description: 'Pencilled-in date, not sent to the contractor until confirmed.' },
};

export const tools = [
  {
    name: 'list_tasks',
    description:
      'List project tasks (paginated), optionally for one job, status or assignee. Cancelled tasks ' +
      'are hidden. Includes title, status, assignee, dates and duration.',
    scope: 'tasks:read',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        job_id: { type: 'string' },
        status: { type: 'string', enum: STATUS },
        assigned_to: { type: 'string', description: 'User id.' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
    handler(args) {
      return apiRequest({ method: 'GET', path: '/tasks', query: {
        job_id: args?.job_id, status: args?.status, assigned_to: args?.assigned_to,
        cursor: args?.cursor, limit: args?.limit,
      } });
    },
  },

  {
    name: 'get_task',
    description: 'Fetch one project task by id.',
    scope: 'tasks:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', minLength: 1 } },
    },
    handler({ id }) {
      return apiRequest({ method: 'GET', path: `/tasks/${encodeURIComponent(id)}` });
    },
  },

  {
    name: 'create_task',
    description:
      'Create a task on a job (job_id and title required). The assignee is notified. Refused (409) ' +
      'if the scheduled slot overlaps the assignee\'s meeting.',
    scope: 'tasks:create',
    alsoScopes: ['tasks:write'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['job_id', 'title'],
      properties: {
        job_id: { type: 'string', minLength: 1 },
        ...writable,
        arrival_window_start: { type: ['string', 'null'], description: 'ISO-8601.' },
        arrival_window_end: { type: ['string', 'null'], description: 'ISO-8601.' },
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    handler({ idempotency_key = randomUUID(), ...body }) {
      return apiRequest({ method: 'POST', path: '/tasks', body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },

  {
    name: 'update_task',
    description:
      'Update fields on a task; only what you send changes. Changing the date or duration of a ' +
      'schedule-locked task is refused (409). Use reschedule_task for arrival windows and lead days.',
    scope: 'tasks:create',
    alsoScopes: ['tasks:write'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'], minProperties: 2,
      properties: {
        id: { type: 'string', minLength: 1 },
        ...writable,
        completed_at: { type: ['string', 'null'], description: 'ISO-8601.' },
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    handler({ id, idempotency_key = randomUUID(), ...body }) {
      return apiRequest({ method: 'PATCH', path: `/tasks/${encodeURIComponent(id)}`, body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },
];
