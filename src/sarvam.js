// Sarvam AI: Indian-language voice + translation + LLM.
// Docs: https://docs.sarvam.ai  (auth header: api-subscription-key)
import { config } from './config.js';

const BASE = 'https://api.sarvam.ai';
export const sarvamStatus = { lastError: null, calls: 0 };

export const LANGS = {
  'en-IN': { name: 'English', speaker: 'priya' },
  'hi-IN': { name: 'Hindi', speaker: 'shubh' },
  'ta-IN': { name: 'Tamil', speaker: 'kavitha' },
  'te-IN': { name: 'Telugu', speaker: 'rahul' },
  'kn-IN': { name: 'Kannada', speaker: 'aditya' },
  'ml-IN': { name: 'Malayalam', speaker: 'anand' },
  'bn-IN': { name: 'Bengali', speaker: 'ritu' },
  'mr-IN': { name: 'Marathi', speaker: 'rohan' },
  'gu-IN': { name: 'Gujarati', speaker: 'neha' },
  'pa-IN': { name: 'Punjabi', speaker: 'simran' },
  'od-IN': { name: 'Odia', speaker: 'pooja' },
};

export const sarvamEnabled = () => !!config.sarvamKey;

async function call(path, init) {
  sarvamStatus.calls++;
  const r = await fetch(BASE + path, { ...init, headers: { 'api-subscription-key': config.sarvamKey, ...(init.headers || {}) } });
  if (!r.ok) {
    const t = await r.text();
    sarvamStatus.lastError = `${path} ${r.status}: ${t.slice(0, 200)}`;
    throw new Error(sarvamStatus.lastError);
  }
  sarvamStatus.lastError = null;
  return r.json();
}

/** Strip markdown/emoji/URLs so TTS reads naturally. */
export function speakable(text) {
  return String(text)
    .replace(/upi:\/\/\S+|https?:\/\/\S+/g, '')
    .replace(/\*/g, '')
    .replace(/₹\s?([\d,]+)/g, '$1 rupees')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\n{2,}/g, '. ').replace(/\n/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 2400);
}

/**
 * Text → speech. Returns { buffer, mime, ext }.
 * format 'opus' (Telegram voice note) | 'mp3' (browser playback).
 */
export async function tts(text, lang = 'en-IN', format = 'mp3') {
  if (!sarvamEnabled()) return null;
  const body = {
    text: speakable(text),
    language_code: LANGS[lang] ? lang : 'en-IN',
    model: 'bulbul:v3',
    speaker: (LANGS[lang] || LANGS['en-IN']).speaker,
    pace: 1.05,
    output_audio_codec: format,
    speech_sample_rate: format === 'opus' ? 48000 : 24000,
  };
  try {
    const j = await call('/text-to-speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const buffer = Buffer.concat((j.audios || []).map(a => Buffer.from(a, 'base64')));
    return { buffer, mime: format === 'opus' ? 'audio/ogg' : 'audio/mpeg', ext: format === 'opus' ? 'ogg' : 'mp3' };
  } catch (e) { console.warn('[sarvam] tts failed:', e.message); return null; }
}

/** Speech → text. Accepts OGG/Opus (Telegram voice), webm (browser), wav, mp3… Returns { transcript, language }. */
export async function stt(buffer, filename = 'voice.ogg', mime = 'audio/ogg') {
  if (!sarvamEnabled()) return null;
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime }), filename);
  fd.append('model', 'saaras:v4');
  fd.append('mode', 'transcribe');
  fd.append('language_code', 'unknown');
  fd.append('keyterms', JSON.stringify(['ThatFriend', 'Ooty', 'Goa', 'Manali', 'Coorg', 'OTP', 'UPI']));
  try {
    const j = await call('/speech-to-text', { method: 'POST', body: fd });
    return { transcript: j.transcript || '', language: j.language_code || null };
  } catch (e) { console.warn('[sarvam] stt failed:', e.message); return null; }
}

/** Translate (English ⇄ Indian languages). Code-mixed mode sounds like real friends texting. */
export async function translate(text, target, source = 'en-IN') {
  if (!sarvamEnabled() || !text || target === source || !LANGS[target]) return null;
  try {
    const chunks = String(text).match(/[\s\S]{1,950}(?:\n|$)|[\s\S]{1,950}/g) || [];
    const out = [];
    for (const c of chunks) {
      const j = await call('/translate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: c, source_language_code: source, target_language_code: target, model: 'mayura:v1', mode: 'code-mixed' }),
      });
      out.push(j.translated_text);
    }
    return out.join('\n');
  } catch (e) { console.warn('[sarvam] translate failed:', e.message); return null; }
}

/** Sarvam-105b chat: second LLM in the fallback chain (Claude Code → Sarvam → offline). */
export async function sarvamChat(prompt, system) {
  if (!sarvamEnabled()) return null;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  try {
    const j = await call('/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sarvam-105b', messages, reasoning_effort: 'low', max_tokens: 4096, temperature: 0.4 }),
    });
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) { console.warn('[sarvam] chat failed:', e.message); return null; }
}
