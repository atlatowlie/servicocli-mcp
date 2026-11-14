/**
 * tools/approvals.js — Servi's pending approval queue.
 *
 * Deciding an approval makes Servico act for real (send a customer
 * message, email a supplier, mark a task done...). The AI must not decide
 * alone: approve_approval and reject_approval first ask the person through
 * the MCP client's confirmation prompt (ctx.confirm, MCP elicitation). If
 * the client cannot ask, or the person says no, declines or cancels, NO API
 * call is made and the tool returns an error.
 *
 * Scopes: approvals:read, approvals:write
 */

import { randomUUID } from 'node:crypto';

import { apiRequest, ApiClientError } from '../apiClient.js';
import { IDEMPOTENCY_KEY_SCHEMA } from './_shared.js';

// What approving each action type makes Servico do (backend
// services/agentActionExecutor.js).
const APPROVE_EFFECT = {
  'schedule.auto_arrange': 'rearrange the job\'s task schedule',
  'client.arrival_reminder': 'send the customer an arrival reminder (SMS or email)',
  'client.status_update': 'send the customer a job status update (SMS or email)',
  'task.verify': 'mark the task as done',
  'task.verify_review': 'notify the job\'s rep that a task needs review',
  'task.confirm_arrival': 'record that the crew arrived',
  'order.place': 'email a purchase order to the supplier',
};

const LABEL_KEYS = [
  'taskTitle', 'customerName', 'supplierName', 'jobLabel', 'tradeLabel', 'summary', 'description',
];

const REFUSAL =
  'A person must confirm this in a client that supports confirmation prompts, or decide it in ' +
  'Servico itself. Nothing was changed.';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null;
}

/** Short "what is being decided" line from a pending approval row. */
export function describeApproval(row) {
  const payload = row?.action_payload && typeof row.action_payload === 'object' ? row.action_payload : {};
  const display = payload.display && typeof payload.display === 'object' ? payload.display : {};
  const parts = [];
  for (const key of LABEL_KEYS) {
    const v = text(display[key]) || text(payload[key]);
    if (v && !parts.includes(v)) parts.push(v);
    if (parts.length === 3) break;
  }
  return parts.join(' / ');
}

async function findPending(id) {
  try {
    const res = await apiRequest({ method: 'GET', path: '/approvals', query: { limit: 200 } });
    return (res.data || []).find((row) => String(row.id) === String(id)) || null;
  } catch (err) {
    if (err instanceof ApiClientError) return null; // still ask, with the id only
    throw err;
  }
}

async function decide(decision, { id, reason, idempotency_key = randomUUID() }, ctx) {
  const row = await findPending(id);
  const lines = [];
  if (row) {
    const what = describeApproval(row);
    lines.push(`Servi approval #${row.id}: ${row.action_type}${what ? ` (${what})` : ''}.`);
    if (decision === 'approve') {
      const effect = APPROVE_EFFECT[row.action_type];
      lines.push(effect ? `Approving it will ${effect}.` : 'Approving it makes Servico carry out this action.');
    } else {
      lines.push('Rejecting it declines the suggestion; for some checks Servico then follows up (for example texting the contractor).');
    }
  } else {
    lines.push(`Servi approval #${id} (not found in the pending list, details unavailable).`);
  }
  if (reason) lines.push(`Reason given: ${reason}`);
  lines.push(`${decision === 'approve' ? 'Approve' : 'Reject'} it?`);

  const ok = typeof ctx?.confirm === 'function' ? await ctx.confirm(lines.join('\n')) : false;
  if (!ok) {
    throw new ApiClientError({ code: 'confirmation_required', message: REFUSAL });
  }
  return apiRequest({
    method: 'POST',
    path: `/approvals/${encodeURIComponent(id)}/${decision}`,
    body: reason ? { reason } : {},
    headers: { 'Idempotency-Key': idempotency_key },
  });
}

const decisionSchema = {
  type: 'object', additionalProperties: false, required: ['id'],
  properties: {
    id: { type: ['string', 'integer'], description: 'Approval id from list_approvals.' },
    reason: { type: 'string', maxLength: 2000, description: 'Optional note kept with the decision.' },
    idempotency_key: IDEMPOTENCY_KEY_SCHEMA,
  },
};

export const tools = [
  {
    name: 'list_approvals',
    description:
      'List Servi\'s PENDING approvals only (decided ones are not listed), oldest first, up to 200. ' +
      'Each has id, action_type, action_payload (what it is about), required_permission and created_at.',
    scope: 'approvals:read',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
    },
    handler(args) {
      return apiRequest({ method: 'GET', path: '/approvals', query: { limit: args?.limit } });
    },
  },

  {
    name: 'approve_approval',
    description:
      'Approve a pending Servi approval, which makes Servico carry out the action (for example ' +
      'text a customer or email a supplier). REQUIRES HUMAN CONFIRMATION: the person is asked in ' +
      'their client and you cannot approve on your own. If their client cannot ask, or they say ' +
      'no, nothing happens and this returns an error; tell them to decide it in Servico.',
    scope: 'approvals:write',
    requiresHumanConfirmation: true,
    inputSchema: decisionSchema,
    handler(args, ctx) {
      return decide('approve', args, ctx);
    },
  },

  {
    name: 'reject_approval',
    description:
      'Reject a pending Servi approval. REQUIRES HUMAN CONFIRMATION: the person is asked in their ' +
      'client and you cannot reject on your own. If their client cannot ask, or they say no, ' +
      'nothing happens and this returns an error; tell them to decide it in Servico.',
    scope: 'approvals:write',
    requiresHumanConfirmation: true,
    inputSchema: decisionSchema,
    handler(args, ctx) {
      return decide('reject', args, ctx);
    },
  },
];
