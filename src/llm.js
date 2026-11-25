// LLM layer: Claude Code in headless mode (`claude -p`), using the user's Claude account.
// Every call degrades gracefully to the offline planner so a live demo never stalls.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { config } from './config.js';
import { sarvamChat, sarvamEnabled } from './sarvam.js';

export const llmStatus = { backend: 'unknown', lastError: null, calls: 0, failures: 0 };
let claudeDisabledUntil = 0;

function runClaude(prompt, system) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', '--output-format', 'json',
      '--model', config.claudeModel,
      '--tools', '',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--setting-sources', '',
    ];
    if (system) args.push('--system-prompt', system);
    // Strip host-session variables so the child uses its own login instead of this host's socket.
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^CLAUDE_CODE_(SESSION|HOST|MESSAGING|CHILD|SDK|ENTRYPOINT)/.test(k)) delete env[k];
    const child = spawn(config.claudeBin, args, { cwd: os.tmpdir(), env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude timed out')); }, config.llmTimeoutMs);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(String(j.result || 'claude error')));
        resolve(String(j.result ?? ''));
      } catch {
        reject(new Error((err || out || 'no output from claude').slice(0, 300)));
      }
    });
    child.stdin.end(prompt);
  });
}

/** LLM chain: Claude Code → Sarvam-105b → null (caller uses offline planner). */
export async function askText(prompt, system) {
  const viaClaude = await askClaude(prompt, system);
  if (viaClaude) return viaClaude;
  if (config.llmMode !== 'offline' && sarvamEnabled()) {
    const viaSarvam = await sarvamChat(prompt, system);
    if (viaSarvam) { llmStatus.backend = 'sarvam-105b'; return viaSarvam; }
  }
  llmStatus.backend = 'offline';
  return null;
}

async function askClaude(prompt, system) {
  if (config.llmMode === 'offline' || Date.now() < claudeDisabledUntil) return null;
  llmStatus.calls++;
  try {
    const text = await runClaude(prompt, system);
    llmStatus.backend = 'claude-code';
    llmStatus.lastError = null;
    return text.trim();
  } catch (e) {
    llmStatus.failures++;
    llmStatus.lastError = e.message;
    llmStatus.backend = 'offline';
    // Not logged in / not installed: stop trying for a while so the demo stays snappy.
    if (/logged in|ENOENT|login/i.test(e.message)) claudeDisabledUntil = Date.now() + 5 * 60_000;
    console.warn('[llm] Claude Code unavailable, using offline planner:', e.message);
    return null;
  }
}

/** Ask Claude for JSON. Returns parsed object or null. */
export async function askJSON(prompt, system) {
  const sys = (system ? system + '\n\n' : '') +
    'Respond with ONLY a single valid JSON value. No markdown fences, no commentary.';
  const text = await askText(prompt, sys);
  if (!text) return null;
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  try { return JSON.parse(m ? m[0] : text); } catch {
    llmStatus.lastError = 'unparseable JSON from model';
    return null;
  }
}

/** OpenAI-compatible bridge: lets ZeroClaw (or anything) use Claude Code as its model. */
export async function chatCompletion(messages) {
  const system = messages.filter(m => m.role === 'system').map(m => flat(m.content)).join('\n\n');
  const convo = messages.filter(m => m.role !== 'system')
    .map(m => `${m.role.toUpperCase()}: ${flat(m.content)}`).join('\n\n');
  const text = await askText(convo + '\n\nASSISTANT:', system || undefined);
  return text ?? "I'm running in offline mode right now — Claude Code isn't logged in on this machine. Run `claude` once and log in, then try again.";
}

function flat(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => p.text || '').join('');
  return String(c ?? '');
}
