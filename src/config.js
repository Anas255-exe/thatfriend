import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependencies).
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  // Claude desktop app bundles Claude Code here on Windows.
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Claude-Data');
  try {
    for (const pkg of fs.readdirSync(base)) {
      const cc = path.join(base, pkg, 'claude-code');
      if (!fs.existsSync(cc)) continue;
      const versions = fs.readdirSync(cc).sort().reverse();
      for (const v of versions) {
        for (const h of fs.readdirSync(path.join(cc, v))) {
          const exe = path.join(cc, v, h, 'claude.exe');
          if (fs.existsSync(exe)) return exe;
        }
      }
    }
  } catch { /* not on desktop-app Windows */ }
  return 'claude';
}

export const config = {
  port: Number(process.env.PORT || 8787),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8787}`,
  claudeBin: findClaude(),
  claudeModel: process.env.CLAUDE_MODEL || 'sonnet',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 120000),
  // 'auto' = try Claude Code, fall back to the offline planner. 'offline' = never call Claude.
  llmMode: process.env.LLM_MODE || 'auto',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  // native  = this server long-polls Telegram itself.
  // zeroclaw = ZeroClaw owns Telegram inbound and calls /api/agent/message; we only push outbound.
  telegramMode: process.env.TELEGRAM_MODE || 'native',
  simulateMissingFriends: (process.env.SIMULATE_FRIENDS || 'true') === 'true',
  friendWaitMs: Number(process.env.FRIEND_WAIT_MS || 0),
  // Sarvam AI (TTS / STT / translate / sarvam-105b chat)
  sarvamKey: process.env.SARVAM_API_KEY || '',
  // Flagsmith (client-side environment key)
  flagsmithKey: process.env.FLAGSMITH_ENVIRONMENT_KEY || '',
  flagsmithUrl: process.env.FLAGSMITH_API_URL || 'https://edge.api.flagsmith.com',
  // NudgeBee workflow webhook (POST /webhook/:workflowId) + secret
  nudgebeeWebhook: process.env.NUDGEBEE_WEBHOOK_URL || '',
  nudgebeeSecret: process.env.NUDGEBEE_WEBHOOK_SECRET || '',
  // Languages for demo friends, in order (Aman, Riya, Kabir…)
  friendLangs: (process.env.DEMO_FRIEND_LANGS || 'hi-IN,ta-IN,en-IN').split(',').map(s => s.trim()),
};
