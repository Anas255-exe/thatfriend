// Telegram channel adapter (Bot API, zero dependencies).
// native mode: long-polls getUpdates. zeroclaw mode: ZeroClaw owns inbound; we only push outbound.
import { config } from './config.js';
import { tts, stt, sarvamEnabled, LANGS } from './sarvam.js';

const toLang = (code) => { const l = `${String(code).slice(0, 2)}-IN`; return LANGS[l] ? l : 'en-IN'; };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const toHtml = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

export function startTelegram(engine) {
  const token = config.telegramToken;
  if (!token) { console.log('[telegram] TELEGRAM_BOT_TOKEN not set — Telegram disabled (web demo still works).'); return null; }
  const api = async (method, body) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(`${method}: ${j.description}`);
    return j.result;
  };

  api('getMe').then(me => {
    engine.botUsername = me.username;
    console.log(`[telegram] connected as @${me.username} (${config.telegramMode} mode)`);
  }).catch(e => console.error('[telegram] getMe failed:', e.message));

  engine.on('message', ({ to, text, buttons, echo }) => {
    if (echo || !to.startsWith('telegram:')) return;
    const chat_id = to.slice('telegram:'.length);
    const reply_markup = buttons ? { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.label, callback_data: b.data.slice(0, 64) }))) } : undefined;
    api('sendMessage', { chat_id, text: toHtml(text), parse_mode: 'HTML', reply_markup, link_preview_options: { is_disabled: true } })
      .catch(e => console.error('[telegram] send failed:', e.message));
  });
  engine.on('sms', ({ to, text }) => {
    if (!to.startsWith('telegram:')) return;
    api('sendMessage', { chat_id: to.slice(9), text: '📱 ' + text }).catch(() => {});
  });

  // Voice notes via Sarvam TTS. Opus → native Telegram voice bubble; MP3 audio as fallback.
  const upload = async (method, chat_id, field, file, extra = {}) => {
    const fd = new FormData();
    fd.append('chat_id', String(chat_id));
    for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
    fd.append(field, new Blob([file.buffer], { type: file.mime }), `thatfriend.${file.ext}`);
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.ok) throw new Error(`${method}: ${j.description}`);
  };
  async function sendVoice(chat_id, text, lang, caption) {
    if (!sarvamEnabled()) return false;
    const opus = await tts(text, lang, 'opus');
    try { if (opus) { await upload('sendVoice', chat_id, 'voice', opus, caption ? { caption } : {}); return true; } } catch (e) { console.warn('[telegram] sendVoice opus failed, trying mp3:', e.message); }
    const mp3 = await tts(text, lang, 'mp3');
    if (mp3) { await upload('sendAudio', chat_id, 'audio', mp3, { title: 'ThatFriend', ...(caption ? { caption } : {}) }); return true; }
    return false;
  }
  engine.on('voice', ({ to, text, lang }) => {
    if (!to.startsWith('telegram:')) return;
    sendVoice(to.slice(9), text, lang).catch(e => console.error('[telegram] voice failed:', e.message));
  });
  // "Calls" without telephony: a ring message + a voice note; the friend answers with a voice note (walkie-talkie).
  engine.on('call', async ({ to, text, lang, name }) => {
    if (!to.startsWith('telegram:')) return;
    const chat_id = to.slice(9);
    await api('sendMessage', { chat_id, text: `📞 ThatFriend is calling ${name}…\nHold the 🎙️ mic to answer with a voice note.` }).catch(() => {});
    const ok = await sendVoice(chat_id, text, lang, '📞 ThatFriend · voice call').catch(() => false);
    if (!ok) engine.emit('message', { to, text: `🔇 (Voice is off: add SARVAM_API_KEY to hear this as a voice note)` });
  });

  async function onVoiceMessage(m, key) {
    if (!sarvamEnabled()) return engine.send(key, '🎙️ I got your voice note, but voice needs a Sarvam API key on the server. Please type it for now 🙏');
    api('sendChatAction', { chat_id: m.chat.id, action: 'typing' }).catch(() => {});
    const file = await api('getFile', { file_id: (m.voice || m.audio).file_id });
    const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)).arrayBuffer());
    const res = await stt(buf, 'voice.ogg', m.voice?.mime_type || 'audio/ogg');
    if (!res?.transcript) return engine.send(key, "😅 Couldn't catch that, mind typing it?");
    engine.handleVoice(key, res.transcript, res.language, { channel: 'telegram', name: m.from.first_name, chatId: m.chat.id });
  }

  if (config.telegramMode !== 'native') return { api };

  let offset = 0, stopped = false;
  (async function poll() {
    while (!stopped) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message && (u.message.voice || u.message.audio)) {
            const m = u.message;
            const key = `telegram:${m.chat.id}`;
            const usr = engine.registerUser(key, m.from.first_name, 'telegram', m.chat.id);
            if (m.from.language_code && !usr.lang) usr.lang = toLang(m.from.language_code);
            onVoiceMessage(m, key).catch(e => console.error('[telegram] voice in failed:', e.message));
          } else if (u.message?.text) {
            const m = u.message;
            const key = `telegram:${m.chat.id}`;
            const usr = engine.registerUser(key, m.from.first_name, 'telegram', m.chat.id);
            if (m.from.language_code && !usr.lang) usr.lang = toLang(m.from.language_code);
            api('sendChatAction', { chat_id: m.chat.id, action: 'typing' }).catch(() => {});
            engine.handle(key, m.text, { channel: 'telegram' });
          } else if (u.callback_query) {
            const q = u.callback_query;
            const key = `telegram:${q.message.chat.id}`;
            engine.registerUser(key, q.from.first_name, 'telegram', q.message.chat.id);
            api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
            engine.handle(key, q.data, { channel: 'telegram' });
          }
        }
      } catch (e) {
        console.error('[telegram] poll error:', e.message);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  })();
  return { api, stop: () => (stopped = true) };
}
