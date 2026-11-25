// Flagsmith feature flags, evaluated per user (identity) with traits.
// Flip a flag in the Flagsmith dashboard → ThatFriend changes behaviour for that user, no redeploy.
import { config } from './config.js';

// Every flag ThatFriend understands, with safe defaults used when Flagsmith is unset/unreachable.
export const FLAG_DEFS = {
  // 🛑 Kill switches: flip OFF in Flagsmith to stop the agent instantly, no redeploy.
  payments_enabled:      { enabled: true,  value: null,  desc: 'KILL SWITCH: allow the agent to charge the card' },
  autonomous_booking:    { enabled: true,  value: null,  desc: 'KILL SWITCH: let the agent book by itself (off = drafts the cart only)' },
  friend_outreach:       { enabled: true,  value: null,  desc: 'KILL SWITCH: let the agent message friends on your behalf' },
  // 🧪 A/B/n experiment: how ThatFriend invites each friend (text | voice_note | call)
  invite_style:          { enabled: true,  value: 'call', desc: 'A/B/n experiment: invite friends by text, voice_note or call' },
  voice_notes:          { enabled: true,  value: null,  desc: 'Send Sarvam TTS voice notes alongside texts' },
  voice_calls:           { enabled: true,  value: null,  desc: 'Let ThatFriend "call" friends (voice-note walkie-talkie / in-browser call)' },
  friend_translation:    { enabled: true,  value: null,  desc: "Message each friend in their own language (Sarvam translate)" },
  simulate_friends:      { enabled: true,  value: null,  desc: "AI personas answer for friends who haven't joined" },
  auto_book_limit:       { enabled: true,  value: 60000, desc: 'Checkouts above this ₹ need a NudgeBee approval-gated runbook' },
  llm_chain:             { enabled: true,  value: 'claude,sarvam,offline', desc: 'LLM fallback order' },
  booking_failure_drill: { enabled: false, value: null,  desc: 'Inject a provider outage to demo the self-healing booking runbook' },
};

export const flagStatus = { source: config.flagsmithKey ? 'flagsmith' : 'defaults', lastError: null };
const cache = new Map(); // identity -> {at, flags}
const overrides = {};    // live overrides from the demo UI (flag -> {enabled, value})

function parse(json) {
  const list = Array.isArray(json) ? json : json?.flags || [];
  const out = {};
  for (const f of list) {
    const name = f.feature?.name || f.feature_name || f.name;
    if (!name) continue;
    out[name] = { enabled: !!f.enabled, value: f.feature_state_value ?? f.value ?? null };
  }
  return out;
}

export async function getFlags(identity = 'anonymous', traits = {}) {
  const hit = cache.get(identity);
  let remote = {};
  if (hit && Date.now() - hit.at < 5000) remote = hit.flags;
  else if (config.flagsmithKey) {
    try {
      const r = await fetch(`${config.flagsmithUrl}/api/v1/identities/`, {
        method: 'POST',
        headers: { 'X-Environment-Key': config.flagsmithKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          identifier: identity,
          traits: Object.entries(traits).filter(([, v]) => v !== undefined && v !== null).map(([trait_key, trait_value]) => ({ trait_key, trait_value })),
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) throw new Error(`Flagsmith ${r.status}`);
      remote = parse(await r.json());
      cache.set(identity, { at: Date.now(), flags: remote });
      flagStatus.source = 'flagsmith'; flagStatus.lastError = null;
    } catch (e) {
      flagStatus.lastError = e.message;
      flagStatus.source = 'defaults (flagsmith unreachable)';
      remote = hit?.flags || {};
    }
  }
  const flags = {};
  for (const [k, d] of Object.entries(FLAG_DEFS)) flags[k] = { ...d, ...(remote[k] || {}), ...(overrides[k] || {}), source: overrides[k] ? 'override' : remote[k] ? 'flagsmith' : 'default' };
  return flags;
}

export function setOverride(name, patch) {
  if (!FLAG_DEFS[name]) return false;
  if (patch === null) delete overrides[name]; else overrides[name] = { ...(overrides[name] || {}), ...patch };
  cache.clear();
  return true;
}

// ---------- Flagsmith Experimentation (official Node SDK, events enabled) ----------
let sdk = null;
async function client() {
  if (!config.flagsmithKey) return null;
  if (sdk) return sdk;
  try {
    const mod = await import('@flagsmith/nodejs');
    const Flagsmith = mod.Flagsmith || mod.default?.Flagsmith || mod.default;
    sdk = new Flagsmith({ environmentKey: config.flagsmithKey, enableEvents: true, requestTimeoutSeconds: 5 });
  } catch (e) { console.warn('[flagsmith] SDK unavailable:', e.message); sdk = null; }
  return sdk;
}

/** Experiment variant for an identity: records a $flag_exposure event in Flagsmith Experimentation. */
export async function experimentVariant(feature, identity, traits = {}) {
  const c = await client();
  if (!c) return null;
  try {
    const f = await c.getExperimentFlag(feature, identity, traits);
    return f?.enabled ? (f.value ?? null) : null;
  } catch (e) { console.warn('[flagsmith] getExperimentFlag failed:', e.message); return null; }
}

/** Conversion event for the experiment's metrics (e.g. friend_said_yes, friend_reply_seconds). */
export async function trackEvent(event, identity, value) {
  const c = await client();
  if (!c) return false;
  try { c.trackEvent(event, { identifier: identity, ...(value !== undefined ? { value } : {}) }); return true; }
  catch (e) { console.warn('[flagsmith] trackEvent failed:', e.message); return false; }
}

export async function flushEvents() { const c = await client(); if (c) await c.flushEvents().catch(() => {}); }

/** Write traits back to the user's Flagsmith identity (experiment outcomes show up in the dashboard). */
export async function recordTraits(identity, traits) {
  if (!config.flagsmithKey) return false;
  try {
    const r = await fetch(`${config.flagsmithUrl}/api/v1/identities/`, {
      method: 'POST',
      headers: { 'X-Environment-Key': config.flagsmithKey, 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: identity, traits: Object.entries(traits).map(([trait_key, trait_value]) => ({ trait_key, trait_value })) }),
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch { return false; }
}

export const isOn =async (identity, name, traits) => (await getFlags(identity, traits))[name]?.enabled;
export const valueOf = async (identity, name, traits) => (await getFlags(identity, traits))[name]?.value;
