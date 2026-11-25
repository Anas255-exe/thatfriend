// NudgeBee: approval-gated runbooks + autonomous recovery for the booking pipeline.
// ThatFriend treats every checkout like a production change:
//   • high-value checkout  → NudgeBee workflow with an approval task (human-in-the-loop)
//   • provider outage       → incident sent to NudgeBee + self-healing runbook (retry → failover provider)
// When NUDGEBEE_WEBHOOK_URL is set we trigger the real workflow webhook (POST /webhook/:workflowId, X-Webhook-Secret).
// Otherwise the same runbook runs locally so the demo still shows the full autonomous loop.
import crypto from 'node:crypto';
import { config } from './config.js';

export const nudgeStatus = { mode: config.nudgebeeWebhook ? 'nudgebee' : 'local-runbook', events: 0, lastError: null };
const pendingApprovals = new Map(); // token -> {resolve, meta}

async function postWebhook(payload) {
  if (!config.nudgebeeWebhook) return { ok: false, local: true };
  try {
    const r = await fetch(config.nudgebeeWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.nudgebeeSecret ? { 'X-Webhook-Secret': config.nudgebeeSecret } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    nudgeStatus.lastError = r.ok ? null : `webhook ${r.status}`;
    return { ok: r.ok };
  } catch (e) { nudgeStatus.lastError = e.message; return { ok: false }; }
}

/** Fire-and-forget operational event (booking started/failed/recovered, payment authorized…). */
export async function emitEvent(type, data) {
  nudgeStatus.events++;
  return postWebhook({ source: 'thatfriend', type, at: new Date().toISOString(), ...data });
}

/**
 * Approval gate. Triggers the NudgeBee approval workflow; the workflow's approval step calls back
 * POST /api/nudgebee/approval/:token {approved:true}. The organizer can also approve in chat.
 */
export function requestApproval(meta, { onRequested } = {}) {
  const token = crypto.randomBytes(9).toString('hex');
  const callback = `${config.publicUrl}/api/nudgebee/approval/${token}`;
  const p = new Promise(resolve => pendingApprovals.set(token, { resolve, meta }));
  postWebhook({ source: 'thatfriend', type: 'approval_required', runbook: 'high-value-trip-checkout', approval_callback: callback, ...meta });
  onRequested?.(token, callback);
  return { token, wait: p };
}

export function resolveApproval(token, approved, by = 'nudgebee') {
  const p = pendingApprovals.get(token);
  if (!p) return false;
  pendingApprovals.delete(token);
  p.resolve({ approved: !!approved, by });
  return true;
}

export function pendingApprovalFor(tripId) {
  for (const [token, p] of pendingApprovals) if (p.meta.tripId === tripId) return token;
  return null;
}

/**
 * Self-healing booking runbook: retry with backoff, then fail over to an alternate provider.
 * `attempt(provider)` must throw on failure.
 */
export async function runBookingRunbook(item, attempt, log) {
  const providers = [item.provider, ...(ALTERNATES[item.kind] || [])];
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    for (let tryNo = 1; tryNo <= 2; tryNo++) {
      try {
        const res = await attempt(provider);
        if (i > 0 || tryNo > 1) {
          await log(`🐝 NudgeBee runbook recovered "${item.title}" via ${provider}`, 'done');
          emitEvent('booking_recovered', { item: item.title, provider });
        }
        return { ...res, provider };
      } catch (e) {
        await log(`⚠️ ${provider} failed (${e.message}) — runbook step ${i + 1}.${tryNo}`, 'act');
        emitEvent('booking_failed', { item: item.title, provider, error: e.message, attempt: tryNo });
        await new Promise(r => setTimeout(r, 300 * tryNo));
      }
    }
    if (i < providers.length - 1) await log(`🐝 NudgeBee runbook: failing over ${item.kind} to ${providers[i + 1]}`, 'think');
  }
  throw new Error(`all providers failed for ${item.title}`);
}

const ALTERNATES = {
  transport: ['BusSandbox-Alt', 'RailSandbox-Alt'],
  stay: ['StaySandbox-Alt'],
  local: ['CabSandbox-Alt'],
  activity: ['TicketsSandbox-Alt'],
};
