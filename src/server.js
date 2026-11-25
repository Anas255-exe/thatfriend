// ThatFriend server: landing page, live web demo (SSE), REST API for ZeroClaw, OpenAI-compatible Claude Code bridge.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { Engine } from './engine.js';
import { startTelegram } from './telegram.js';
import { chatCompletion, llmStatus } from './llm.js';
import { tts, stt, sarvamEnabled, sarvamStatus } from './sarvam.js';
import { getFlags, setOverride, flagStatus, FLAG_DEFS } from './flags.js';
import { nudgeStatus, resolveApproval } from './nudgebee.js';

export const engine = new Engine();
const clients = new Set();
const broadcast = (event, data) => { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
for (const ev of ['message', 'log', 'trip', 'friend', 'sms', 'booking', 'voice', 'call', 'experiment']) engine.on(ev, d => broadcast(ev, d));
const integrations = () => ({
  claude: llmStatus,
  sarvam: { ...sarvamStatus, enabled: sarvamEnabled() },
  flagsmith: { ...flagStatus, configured: !!config.flagsmithKey },
  nudgebee: { ...nudgeStatus, configured: !!config.nudgebeeWebhook },
  telegram: { enabled: !!config.telegramToken, mode: config.telegramMode, bot: engine.botUsername },
});
const readRaw = (req) => new Promise((res, rej) => { const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej); });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } }); });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // Live event stream for the web demo.
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ llm: llmStatus, telegram: !!config.telegramToken, bot: engine.botUsername, integrations: integrations() })}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    // Web demo inbound message (organizer or a friend phone).
    if (url.pathname === '/api/send' && req.method === 'POST') {
      const { user, name, text, silent } = await readBody(req);
      const key = `web:${user}`;
      engine.registerUser(key, name, 'web', key);
      if (!silent) broadcast('message', { to: key, from: key, text, echo: true });
      engine.handle(key, text, { channel: 'web', name });
      return json(res, 200, { ok: true });
    }
    // Sarvam TTS for the browser (204 → client falls back to the browser's own speech synthesis).
    if (url.pathname === '/api/voice/tts') {
      const audio = await tts(url.searchParams.get('text') || '', url.searchParams.get('lang') || 'en-IN', 'mp3');
      if (!audio) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'content-type': audio.mime, 'cache-control': 'no-store' });
      return res.end(audio.buffer);
    }
    // Sarvam STT for the in-browser "call": raw audio body → transcript → engine.
    if (url.pathname === '/api/voice/stt' && req.method === 'POST') {
      const user = url.searchParams.get('user'), name = url.searchParams.get('name');
      const buf = await readRaw(req);
      const r = await stt(buf, 'call.webm', req.headers['content-type'] || 'audio/webm');
      if (!r) return json(res, 200, { transcript: null, reason: 'sarvam not configured' });
      if (user && r.transcript) {
        const key = `web:${user}`;
        engine.registerUser(key, name, 'web', key);
        broadcast('message', { to: key, from: key, text: '🎙️ ' + r.transcript, echo: true });
        engine.handleVoice(key, r.transcript, r.language, { channel: 'web', name });
      }
      return json(res, 200, r);
    }
    // Flagsmith flags (evaluated for an identity) + live overrides from the demo UI.
    if (url.pathname === '/api/flags' && req.method === 'GET') {
      return json(res, 200, { status: flagStatus, defs: FLAG_DEFS, flags: await getFlags(url.searchParams.get('identity') || 'web:organizer', { channel: 'web', role: 'organizer' }) });
    }
    if (url.pathname === '/api/flags' && req.method === 'POST') {
      const { name, enabled, value, clear } = await readBody(req);
      const ok = setOverride(name, clear ? null : { ...(enabled !== undefined ? { enabled } : {}), ...(value !== undefined ? { value } : {}) });
      broadcast('flags', { name });
      return json(res, ok ? 200 : 400, { ok });
    }
    // NudgeBee approval callback (the workflow's approval step / HTTP action calls this).
    const ap = url.pathname.match(/^\/api\/nudgebee\/approval\/([a-f0-9]+)$/);
    if (ap && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const ok = resolveApproval(ap[1], body.approved !== false, 'NudgeBee workflow');
      return json(res, ok ? 200 : 404, { ok });
    }
    if (url.pathname === '/api/integrations') return json(res, 200, integrations());
    if (url.pathname === '/api/experiment') return json(res, 200, engine.experiment.summary());
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      // Only clear web-demo trips; never touch real Telegram conversations.
      for (const t of engine.trips.values()) if (t.organizer.startsWith('web:')) t.stage = 'ARCHIVED';
      broadcast('reset', {});
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/status') {
      return json(res, 200, { llm: llmStatus, telegram: { enabled: !!config.telegramToken, mode: config.telegramMode, bot: engine.botUsername }, trips: [...engine.trips.values()].filter(t => t.stage !== 'ARCHIVED').map(t => engine.snapshot(t)) });
    }
    // ZeroClaw tool endpoint: ZeroClaw receives the Telegram message and forwards it here; we return the reply text.
    if (url.pathname === '/api/agent/message' && req.method === 'POST') {
      const { user_id, name, text } = await readBody(req);
      if (!user_id || !text) return json(res, 400, { error: 'user_id and text required' });
      const key = `telegram:${user_id}`;
      engine.registerUser(key, name || 'Friend', 'telegram', user_id);
      const replies = [];
      const grab = (m) => { if (m.to === key && !m.echo) replies.push(m.text + (m.buttons ? '\n\n' + m.buttons.flat().map(b => `[${b.label}] → reply "${b.data}"`).join('\n') : '')); };
      engine.on('message', grab);
      await engine.handle(key, text, { channel: 'telegram', name });
      engine.off('message', grab);
      return json(res, 200, { reply: replies.join('\n\n———\n\n') || '👍' });
    }
    // OpenAI-compatible bridge so ZeroClaw can use Claude Code (your Claude account) as its model.
    if (url.pathname === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: 'claude-code', object: 'model', owned_by: 'anthropic' }] });
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readBody(req);
      const text = await chatCompletion(body.messages || []);
      const id = 'chatcmpl-' + Date.now();
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'claude-code', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'claude-code', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      return json(res, 200, { id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'claude-code', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    }
    // Static files.
    let p = url.pathname === '/' ? '/index.html' : url.pathname === '/demo' ? '/demo.html' : url.pathname;
    const file = path.join(ROOT, 'public', path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
    if (file.startsWith(path.join(ROOT, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e); json(res, 500, { error: e.message });
  }
});

server.listen(config.port, () => {
  console.log(`\n  🧳 ThatFriend running`);
  console.log(`  Landing page : ${config.publicUrl}/`);
  console.log(`  Live demo    : ${config.publicUrl}/demo`);
  console.log(`  Claude bridge: ${config.publicUrl}/v1/chat/completions  (claude bin: ${config.claudeBin})`);
  console.log(`  LLM mode     : ${config.llmMode}\n`);
  startTelegram(engine);
});
setInterval(() => broadcast('ping', { llm: llmStatus.backend }), 20000);
// Keep the demo alive no matter what: log and carry on.
process.on('uncaughtException', e => console.error('[uncaught]', e));
process.on('unhandledRejection', e => console.error('[unhandled]', e));
