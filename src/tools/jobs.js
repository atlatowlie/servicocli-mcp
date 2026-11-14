import { randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { FormData } from 'undici';

import { apiRequest, ApiClientError } from '../apiClient.js';
import { IDEMPOTENCY_KEY_SCHEMA } from './_shared.js';

// Servico refuses a job file over 500 MiB (backend routes/jobFiles.js).
export const MAX_JOB_FILE_BYTES = 500 * 1024 * 1024;

const JOB_FILE_TAGS = ['before', 'after', 'progress'];

export const tools = [
  {
    name: 'list_jobs',
    description:
      'List jobs (paginated). Includes title, address, status, sub_status, ' +
      'assigned rep id, and end_date. Use update_job to edit permitted fields.',
    scope: 'jobs:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: '/jobs',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
  },

  {
    name: 'get_job',
    description: 'Fetch a single job by UUID with full details (SKU, source, type, etc.).',
    scope: 'jobs:read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Job UUID.' },
      },
    },
    async handler(args) {
      return apiRequest({
        method: 'GET',
        path: `/jobs/${encodeURIComponent(args.id)}`,
      });
    },
  },
  {
    name: 'update_job',
    description: 'Update the supplied fields on an existing job.',
    scope: 'jobs:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id', 'changes'],
      properties: {
        id: { type: 'string', minLength: 1 },
        changes: { type: 'object', minProperties: 1, description: 'Job fields accepted by PATCH /jobs/{id}, such as title, address, or status.' },
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    handler({ id, changes, idempotency_key = randomUUID() }) {
      return apiRequest({ method: 'PATCH', path: '/jobs/' + encodeURIComponent(id), body: changes,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },

  {
    name: 'set_job_status',
    description:
      'Move a job to a new status (submitted, in_progress, on_hold, done, cancelled) through ' +
      'Servico\'s status rules. A status with sub-statuses needs sub_status. Servico refuses ' +
      'done with an unpaid balance, unsettled payment or missing rep split, and cancelled with a ' +
      'live invoice; the refusal says why. Moving to done or cancelled triggers the same side ' +
      'effects as in the app (webhooks, reminders, cancelling cascades).',
    scope: 'jobs:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id', 'status'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Job UUID.' },
        status: { type: 'string', enum: ['submitted', 'in_progress', 'on_hold', 'done', 'cancelled'] },
        sub_status: { type: ['string', 'null'] },
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    handler({ id, idempotency_key = randomUUID(), ...body }) {
      return apiRequest({ method: 'POST', path: `/jobs/${encodeURIComponent(id)}/status`, body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },

  {
    name: 'list_job_files',
    description:
      'List the files (photos, videos, documents) on a job. media=true returns only photos and ' +
      'videos, newest first. Receipts and supplier bills are left out for users who may not see ' +
      'them. Returns file records, not bytes. Needs the Project Management module.',
    scope: 'jobs:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Job UUID.' },
        media: { type: 'boolean', description: 'Only photos and videos.' },
        tag: { type: 'string', enum: JOB_FILE_TAGS },
        category: { type: 'string', description: 'Only files of this category (for example photo or document).' },
        task_id: { type: 'string' },
        room_id: { type: 'string' },
      },
    },
    handler({ id, media, ...query }) {
      return apiRequest({ method: 'GET', path: `/jobs/${encodeURIComponent(id)}/files`,
        query: { ...query, media: media ? '1' : undefined } });
    },
  },

  {
    name: 'upload_job_file',
    description:
      'Upload one file from this computer to a job. Give the local path of a regular file ' +
      '(photo JPG/PNG/GIF/WebP/HEIC, video MP4/MOV/WebM, PDF; Word, Excel or CSV only with ' +
      'category "document"; category "photo" accepts media only). Up to 500 MiB. A category is ' +
      'required. Repeat client_upload_id on a retry to avoid a duplicate. Large files may need a ' +
      'higher SERVICO_TIMEOUT_MS. Needs the Project Management module.',
    scope: 'jobs:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id', 'file_path', 'category'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Job UUID.' },
        file_path: { type: 'string', minLength: 1, description: 'Path of a regular file on this computer.' },
        category: { type: 'string', minLength: 1, description: 'File category, for example photo or document.' },
        task_id: { type: 'string' },
        room_id: { type: 'string' },
        tag: { type: 'string', enum: JOB_FILE_TAGS },
        captured_at: { type: 'string', description: 'When it was taken (ISO-8601).' },
        capture_lat: { type: 'number', minimum: -90, maximum: 90 },
        capture_lng: { type: 'number', minimum: -180, maximum: 180 },
        capture_accuracy_m: { type: 'number', minimum: 0, maximum: 100000 },
        client_upload_id: {
          type: 'string', minLength: 1, maxLength: 128,
          description: 'Letters, digits, dots, dashes, underscores or colons. Same id again returns the existing file.',
        },
      },
    },
    async handler({ id, file_path, ...fields }) {
      let info;
      try { info = await stat(file_path); } catch {
        throw new ApiClientError({ code: 'invalid_input', message: 'file_path does not exist or cannot be read.' });
      }
      if (!info.isFile()) {
        throw new ApiClientError({ code: 'invalid_input', message: 'file_path must be a regular file.' });
      }
      if (info.size === 0) {
        throw new ApiClientError({ code: 'invalid_input', message: 'The file is empty.' });
      }
      if (info.size > MAX_JOB_FILE_BYTES) {
        throw new ApiClientError({ code: 'invalid_input', message: 'The file exceeds the 500 MiB limit.' });
      }
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null && value !== '') body.append(key, String(value));
      }
      body.append('files', await openAsBlob(file_path), basename(file_path));
      return apiRequest({ method: 'POST', path: `/jobs/${encodeURIComponent(id)}/files`, body });
    },
  },

  {
    name: 'list_job_arrivals',
    description:
      'List "arrived" records reported by the field phones for a job, newest first (id, user, ' +
      'arrived_at, source). days looks back 1-365 days (default 30). Needs the Project Management module.',
    scope: 'jobs:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Job UUID.' },
        days: { type: 'integer', minimum: 1, maximum: 365 },
      },
    },
    handler({ id, days }) {
      return apiRequest({ method: 'GET', path: `/jobs/${encodeURIComponent(id)}/arrivals`, query: { days } });
    },
  },

  {
    name: 'record_job_arrival',
    description:
      'Record that the key\'s bound user arrived at a job. Only for a user on the job, only while ' +
      'the job is In Progress; a second arrival within 2 hours is ignored (deduped). No ' +
      'coordinates are accepted. A key not bound to a user is refused. Needs the Project Management module.',
    scope: 'jobs:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id', 'arrived_at', 'source'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Job UUID.' },
        arrived_at: { type: 'string', description: 'ISO-8601 time of arrival, not in the future.' },
        source: { type: 'string', enum: ['geofence', 'foreground', 'manual'] },
        accuracy_band: { type: 'string', enum: ['lt50', 'lt150', 'gt150'] },
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
      },
    },
    handler({ id, idempotency_key = randomUUID(), ...body }) {
      return apiRequest({ method: 'POST', path: `/jobs/${encodeURIComponent(id)}/arrivals`, body,
        headers: { 'Idempotency-Key': idempotency_key } });
    },
  },

  {
    name: 'list_job_selections',
    description:
      'What still needs choosing on a job: { slots, unmapped, orphaned }. Slots are the product ' +
      'decisions on the job\'s invoices (status selected or pending, with the chosen product), ' +
      'unmapped are invoice lines with no slot, orphaned are decided slots whose line is gone. ' +
      'Read-only; choosing a product is done in Servico.',
    scope: 'selections:read',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['job_id'],
      properties: { job_id: { type: 'string', minLength: 1, description: 'Job UUID.' } },
    },
    handler({ job_id }) {
      return apiRequest({ method: 'GET', path: `/jobs/${encodeURIComponent(job_id)}/selections` });
    },
  },
];
