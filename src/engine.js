// ThatFriend trip engine: channel-agnostic state machine.
// BRIEF → PLANNING → FRIENDS → APPROVAL → OTP → BOOKING → DONE
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { askJSON, askText, llmStatus } from './llm.js';
import {
  extractBriefOffline, planOptionsOffline, refineOffline, totalOf,
  friendReplyOffline, parseFriendReplyOffline, catalogFor,
} from './fallback.js';
import { buildCart, PaymentSession, bookItem, upiCollectLink } from './booking.js';
import { config } from './config.js';
import { getFlags, recordTraits, experimentVariant, trackEvent, flushEvents } from './flags.js';

/** Live results of the invite_style A/B/n experiment. */
class Experiment {
  constructor() { this.v = {}; }
  bucket(k) { return (this.v[k] ||= { sent: 0, replied: 0, yes: 0, totalSecs: 0 }); }
  record(variant, event, secs) {
    const b = this.bucket(variant);
    if (event === 'sent') b.sent++;
    else { b.replied++; if (event === 'yes') b.yes++; b.totalSecs += secs || 0; }
  }
  summary() {
    return Object.fromEntries(Object.entries(this.v).map(([k, b]) => [k, {
      ...b, yesRate: b.sent ? Math.round((b.yes / b.sent) * 100) : 0, avgReplySecs: b.replied ? Math.round(b.totalSecs / b.replied) : null,
    }]));
  }
}
import { translate, LANGS, sarvamEnabled } from './sarvam.js';
import { requestApproval, resolveApproval, pendingApprovalFor, runBookingRunbook, emitEvent } from './nudgebee.js';

const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const SYSTEM = `You are ThatFriend, an AI travel agent for Indian friend groups. You plan trips end-to-end:
itinerary, friend consensus, and bookings. Prices are realistic for India in INR. Be concise and warm.`;

export class Engine extends EventEmitter {
  constructor() {
    super();
    this.users = new Map();   // key -> {key, name, channel, chatId}
    this.trips = new Map();   // tripId -> trip
    this.queues = new Map();  // key -> promise chain (serialize per user)
    this.botUsername = '';
    this.experiment = new Experiment();
  }

  // ---------- plumbing ----------
  registerUser(key, name, channel, chatId) {
    const u = this.users.get(key) || { key, name, channel, chatId };
    if (name) u.name = name;
    u.channel = channel; u.chatId = chatId;
    this.users.set(key, u);
    return u;
  }
  send(to, text, buttons) { this.emit('message', { to, text, buttons }); }

  /** Flagsmith flags for a user (identity = user key, traits = channel/role/language). */
  flagsFor(key, role) {
    const u = this.users.get(key) || {};
    return getFlags(key, { channel: u.channel, role, language: u.lang || 'en-IN', name: u.name });
  }

  /** Voice note (Sarvam TTS) — channel adapters turn this into a Telegram voice note / browser audio. */
  voice(to, text, lang = 'en-IN', kind = 'note') { this.emit('voice', { to, text, lang, kind }); }
  log(trip, text, kind = 'info') {
    const entry = { t: Date.now(), tripId: trip?.id, text, kind, backend: llmStatus.backend };
    trip?.log.push(entry);
    this.emit('log', entry);
  }
  tripOf(key) {
    for (const t of this.trips.values()) if (t.organizer === key && t.stage !== 'ARCHIVED') return t;
    return null;
  }
  friendTripOf(key) {
    for (const t of this.trips.values()) if (t.stage !== 'ARCHIVED' && t.friends.some(f => f.key === key)) return t;
    return null;
  }
  snapshot(trip) {
    if (!trip) return null;
    const { payment, ...rest } = trip;
    return { ...rest, payment: payment && { id: payment.id, status: payment.status, total: payment.cart.total } };
  }

  /** Entry point for every inbound message/button press from any channel. */
  handle(key, text, meta = {}) {
    const prev = this.queues.get(key) || Promise.resolve();
    const next = prev.then(() => this._handle(key, String(text || '').trim(), meta)).catch(e => {
      console.error('[engine]', e);
      this.send(key, '😵 Something glitched on my side — say that again?');
    });
    this.queues.set(key, next);
    return next;
  }

  async _handle(key, text, meta) {
    const user = this.users.get(key) || this.registerUser(key, meta.name || 'Friend', meta.channel || 'web', meta.chatId);

    // Deep link: /start join_<tripId>
    const join = text.match(/^\/start\s+join_([A-Za-z0-9]+)/);
    if (join) return this.friendJoin(user, join[1]);

    if (/^\/(start|help)$/i.test(text)) {
      return this.send(key, `Hey ${user.name}! 👋 I'm *ThatFriend* — the friend who plans AND books the whole trip, so nobody else has to.\n\nJust tell me something like:\n"Plan Ooty next weekend, 15k per person, 4 of us — me, Aman, Riya and Kabir"\n\nI'll draft itineraries, check with your friends for you, and book everything once you approve. ✨`);
    }
    if (/^\/(new|reset)$/i.test(text)) {
      const t = this.tripOf(key); if (t) t.stage = 'ARCHIVED';
      return this.send(key, '🧹 Fresh start! Where are we going?');
    }
    if (/^\/status$/i.test(text)) return this.sendStatus(key);

    // Friend replying to a squad poll?
    const ft = this.friendTripOf(key);
    if (ft && ft.stage === 'FRIENDS') {
      const f = ft.friends.find(x => x.key === key);
      if (f && f.status !== 'replied') return this.friendReply(ft, f, text);
    }
    if (ft && !this.tripOf(key)) {
      return this.send(key, ft.stage === 'DONE' ? `🎒 You're all set for ${ft.brief.destination}! Check your confirmation above.` :
        `👌 Got it. ${this.users.get(ft.organizer)?.name || 'Your friend'} and I are handling the rest — I'll ping you when it's booked.`);
    }

    let trip = this.tripOf(key);
    if (!trip) trip = this.newTrip(key);

    switch (trip.stage) {
      case 'BRIEF': return this.onBrief(trip, text);
      case 'PLANNING': return this.onPlanning(trip, text);
      case 'FRIENDS': return this.onFriendsStage(trip, text);
      case 'APPROVAL': return this.onApproval(trip, text);
      case 'GATE': return this.onGate(trip, text);
      case 'OTP': return this.onOtp(trip, text);
      case 'BOOKING': return this.send(key, '⏳ Booking in progress — hang tight!');
      case 'DONE': {
        if (/new|another|plan/i.test(text)) { trip.stage = 'ARCHIVED'; return this._handle(key, text, meta); }
        return this.send(key, `✅ Your ${trip.brief.destination} trip is booked. Send /new to plan another one.`);
      }
    }
  }

  newTrip(organizer) {
    const trip = {
      id: crypto.randomBytes(4).toString('hex'),
      organizer, stage: 'BRIEF', brief: {}, options: [], chosen: null,
      friends: [], cart: null, payment: null, confirmations: [], log: [], createdAt: Date.now(),
    };
    this.trips.set(trip.id, trip);
    this.emit('trip', this.snapshot(trip));
    return trip;
  }
  touch(trip) { this.emit('trip', this.snapshot(trip)); }

  // ---------- BRIEF ----------
  async onBrief(trip, text) {
    const key = trip.organizer;
    this.log(trip, '🧠 Reading your request…', 'think');
    let brief = await askJSON(
      `Current trip brief (JSON): ${JSON.stringify(trip.brief)}\nNew message from organizer: "${text}"\n\n` +
      `Update and return the brief as JSON with keys: destination (string|null), origin (string|null, default null), when (string|null), ` +
      `nights (number|null), budgetPerPerson (number INR|null), totalBudget (number INR|null), groupSize (number|null, includes organizer), ` +
      `friends (array of friend first names, excluding organizer), preferences (array of short strings). ` +
      `Indian slang: "15k" = 15000. "Uti"/"Ooti" = Ooty. Keep previous values unless changed.`, SYSTEM);
    brief = brief ? { ...trip.brief, ...clean(brief) } : extractBriefOffline(text, trip.brief);
    if (brief.totalBudget && brief.groupSize && !brief.budgetPerPerson) brief.budgetPerPerson = Math.round(brief.totalBudget / brief.groupSize);
    if (brief.friends?.length && (!brief.groupSize || brief.groupSize < brief.friends.length + 1)) brief.groupSize = brief.friends.length + 1;
    trip.brief = brief;
    this.touch(trip);

    const missing = [];
    if (!brief.destination) missing.push('where to');
    if (!brief.budgetPerPerson && !brief.totalBudget) missing.push('budget (per person or total)');
    if (!brief.groupSize) missing.push('how many people (and their names, so I can text them)');
    if (missing.length) {
      return this.send(key, `Love it! Just need: ${missing.join(', ')}. 🙏`);
    }
    // Sensible defaults instead of more questions.
    brief.origin ||= 'Bengaluru';
    brief.nights ||= 2;
    brief.when ||= 'next weekend';
    if (!brief.friends?.length) brief.friends = defaultFriendNames(brief.groupSize - 1);
    const organizerName = this.users.get(key)?.name || 'You';
    this.send(key, `Got it ✍️\n📍 ${brief.destination} from ${brief.origin}\n🗓 ${brief.when}, ${brief.nights} nights\n👥 ${organizerName} + ${brief.friends.join(', ')}\n💰 ${inr(brief.budgetPerPerson)} per person\n\nDrafting 3 itineraries for you…`);
    trip.friends = brief.friends.map((n, i) => ({ name: n, key: null, status: 'pending', simulated: false, lang: config.friendLangs[i % config.friendLangs.length] || 'en-IN' }));
    await this.makeOptions(trip);
  }

  async makeOptions(trip, feedback = '') {
    const b = trip.brief;
    this.log(trip, `🗺️ Generating 3 itineraries for ${b.destination} via ${config.llmMode === 'offline' ? 'offline planner' : 'Claude Code'}…`, 'think');
    const ref = catalogFor(b.destination);
    const llm = await askJSON(
      `Trip brief: ${JSON.stringify(b)}\n${feedback ? `Organizer feedback on previous options: "${feedback}"\n` : ''}` +
      `Reference price points (INR, adjust as realistic): ${JSON.stringify({ transport: ref.transport, stays: ref.stays, activities: ref.activities })}\n\n` +
      `Return a JSON array of exactly 3 distinct itinerary options (e.g. chill / adventure / budget). Each option: ` +
      `{"id":"A"|"B"|"C","title":str,"vibe":str (max 8 words),"destination":str,"nights":num,` +
      `"transport":{"mode":str,"detail":str,"costPerPerson":num},"stay":{"name":str,"type":str,"nights":num,"costPerPerson":num},` +
      `"activities":[{"name":str,"costPerPerson":num}],"localTravel":{"detail":str,"costPerPerson":num},"foodPerPerson":num,` +
      `"days":[{"day":num,"title":str,"items":[str]}]}. Costs are per person, rooms shared by 2. At least one option must fit the per-person budget.`, SYSTEM);
    const fallback = planOptionsOffline(b);
    let options = Array.isArray(llm) && llm.length ? llm.slice(0, 3).map((p, i) => normalizePlan(p, fallback[i], b, i)) : fallback;
    trip.options = options;
    trip.stage = 'PLANNING';
    this.log(trip, `✅ ${options.length} itineraries ready (${llmStatus.backend})`, 'done');
    this.touch(trip);
    const lines = options.map(o =>
      `*${o.id}. ${o.title}* — ${inr(o.totalPerPerson)}/person ${o.withinBudget ? '✅' : '⚠️ over budget'}\n   ${o.vibe}\n   🚌 ${o.transport.mode} · 🏡 ${o.stay.name}\n   🎯 ${o.activities.slice(0, 3).map(a => a.name).join(', ')}`);
    this.send(trip.organizer, `Here are 3 ways to do ${b.destination} 👇\n\n${lines.join('\n\n')}\n\nPick one, or tell me what to change ("cheaper stay", "add a trek"…).`,
      [options.map(o => ({ label: `Pick ${o.id}`, data: `pick:${o.id}` }))]);
  }

  // ---------- PLANNING ----------
  async onPlanning(trip, text) {
    const pick = text.match(/^(?:pick:)?\s*(?:option\s*)?([abc123])\s*$/i);
    if (pick) {
      const id = { 1: 'A', 2: 'B', 3: 'C' }[pick[1]] || pick[1].toUpperCase();
      const o = trip.options.find(x => x.id === id);
      if (o) { trip.chosen = structuredClone(o); this.touch(trip); return this.showChosen(trip); }
    }
    if (/^(ask_squad|ask (the )?(squad|friends|group))/i.test(text) && trip.chosen) return this.askSquad(trip);
    if (/^(skip_friends|approve|book it|looks good|go ahead)/i.test(text) && trip.chosen) return this.toApproval(trip);
    if (/^tweak$/i.test(text)) return this.send(trip.organizer, 'Sure — what should I change? ✏️');
    if (!trip.chosen) return this.makeOptions(trip, text);
    await this.refine(trip, text, 'organizer');
    return this.showChosen(trip);
  }

  async refine(trip, feedback, who) {
    this.log(trip, `✏️ Adjusting plan: "${feedback.slice(0, 60)}"`, 'think');
    const llm = await askJSON(
      `Current plan JSON: ${JSON.stringify(trip.chosen)}\nBrief: ${JSON.stringify(trip.brief)}\nFeedback from ${who}: "${feedback}"\n\n` +
      `Return {"plan": <updated plan, same schema>, "changes": [short strings describing what changed]}. Keep within budget where possible.`, SYSTEM);
    let res;
    if (llm?.plan) res = { plan: normalizePlan(llm.plan, trip.chosen, trip.brief, 0), changes: llm.changes || [] };
    else res = refineOffline(trip.chosen, feedback, trip.brief);
    res.plan.id = trip.chosen.id;
    trip.chosen = res.plan;
    this.log(trip, `✅ Plan updated: ${res.changes.join('; ')}`, 'done');
    this.touch(trip);
    return res.changes;
  }

  showChosen(trip, header) {
    const o = trip.chosen;
    const days = o.days.map(d => `*Day ${d.day} — ${d.title}*\n${d.items.map(i => '  • ' + i).join('\n')}`).join('\n');
    const notes = o.notes?.length ? `\n📝 ${o.notes.slice(-3).join(' · ')}` : '';
    this.send(trip.organizer,
      `${header || `🎯 *${o.title}* it is!`}\n\n${days}\n\n💸 *${inr(o.totalPerPerson)} per person* (budget ${inr(trip.brief.budgetPerPerson)})${notes}\n\nWant me to check with ${trip.friends.map(f => f.name).join(', ')} — so you don't have to?`,
      [[{ label: '👥 Ask the squad', data: 'ask_squad' }, { label: '✏️ Tweak', data: 'tweak' }], [{ label: '✅ Skip & approve', data: 'skip_friends' }]]);
  }

  // ---------- FRIENDS ----------
  async askSquad(trip) {
    const orgFlags = await this.flagsFor(trip.organizer, 'organizer');
    if (!orgFlags.friend_outreach.enabled) {
      this.log(trip, '🛑 Flagsmith kill switch friend_outreach = OFF → not messaging anyone', 'think');
      return this.send(trip.organizer, `🛑 Friend outreach is switched off by your admin (Flagsmith kill switch), so I won't message anyone on your behalf right now.\nYou can approve the plan yourself, or try again once it's back on.`,
        [[{ label: '✅ Approve without them', data: 'skip_friends' }, { label: '🔁 Try again', data: 'ask_squad' }]]);
    }
    trip.stage = 'FRIENDS';
    this.touch(trip);
    const org = this.users.get(trip.organizer)?.name || 'Your friend';
    const orgChannel = this.users.get(trip.organizer)?.channel;
    this.log(trip, `📨 Texting ${trip.friends.length} friends on ${org}'s behalf`, 'act');

    // Web demo: friends are pre-wired phones in the simulator.
    // Telegram: friends join via deep link; anyone who hasn't joined gets simulated (demo mode).
    if (orgChannel === 'telegram' && this.botUsername) {
      const link = `https://t.me/${this.botUsername}?start=join_${trip.id}`;
      this.send(trip.organizer, `📨 On it! Drop this link in your group chat — when friends tap it, I'll talk to each of them privately:\n${link}\n\nI'll collect everyone's yes/no and requests and come back to you.`,
        config.simulateMissingFriends ? [[{ label: '🤖 Simulate friends who haven\'t joined', data: 'sim_friends' }]] : undefined);
    } else {
      for (const f of trip.friends) {
        if (!f.key) f.key = `web:friend-${f.name.toLowerCase()}`;
        this.registerUser(f.key, f.name, 'web', f.key);
        await this.pollFriend(trip, f).catch(e => console.error('[poll]', e));
      }
      this.send(trip.organizer, `📨 Texting ${trip.friends.map(f => f.name).join(', ')} now. Sit back — I'll handle the back-and-forth. 😌`);
    }
    if (config.friendWaitMs) setTimeout(() => this.handle(trip.organizer, 'sim_friends'), config.friendWaitMs);
  }

  async pollFriend(trip, f) {
    const org = this.users.get(trip.organizer)?.name || 'Your friend';
    const o = trip.chosen;
    f.status = 'asked';
    const u = this.users.get(f.key);
    if (u) u.lang ||= f.lang;
    this.emit('friend', { tripId: trip.id, friend: f });
    const flags = await this.flagsFor(f.key, 'friend');
    let text =
      `Hey ${f.name}! 👋 I'm ThatFriend, ${org}'s travel assistant.\n${org} is planning *${trip.brief.destination}* (${trip.brief.when}, ${o.nights} nights):\n\n` +
      `🚌 ${o.transport.mode}\n🏡 ${o.stay.name}\n🎯 ${o.activities.map(a => a.name).join(', ')}\n💸 ~${inr(o.totalPerPerson)} per person\n\nAre you in? Any requests?`;
    const lang = f.lang || 'en-IN';
    if (lang !== 'en-IN' && flags.friend_translation.enabled) {
      const t = await translate(text, lang);
      if (t) { text = `${t}\n\n— ${LANGS[lang].name} · translated by Sarvam`; this.log(trip, `🌐 Sarvam translated ${f.name}'s invite to ${LANGS[lang].name}`, 'act'); }
    }
    this.send(f.key, text, [[{ label: "👍 I'm in", data: "I'm in" }, { label: '🤔 Maybe', data: 'maybe' }, { label: "👎 Can't", data: "can't make it" }]]);
    const spoken = `Hey ${f.name}! ${org} is planning a ${o.nights} night trip to ${trip.brief.destination}, ${trip.brief.when}. ` +
      `${o.stay.name}, ${o.activities.slice(0, 2).map(a => a.name).join(' and ')}, about ${o.totalPerPerson} rupees each. Are you in?`;
    // 🧪 Flagsmith A/B/n experiment: each friend (identity) is bucketed into text | voice_note | call.
    // getExperimentFlag records the exposure event for Flagsmith Experimentation.
    const expValue = flags.invite_style.source === 'override' ? null : await experimentVariant('invite_style', f.key, { role: 'friend', language: lang });
    const style = flags.invite_style.enabled ? String(expValue || flags.invite_style.value || 'call') : (flags.voice_calls.enabled ? 'call' : flags.voice_notes.enabled ? 'voice_note' : 'text');
    f.variant = style; f.askedAt = Date.now();
    this.experiment.record(style, 'sent');
    this.log(trip, `🧪 Flagsmith experiment invite_style → ${f.name} gets "${style}"`, 'think');
    recordTraits(f.key, { invite_variant: style, trip_id: trip.id });
    if (style === 'text') {
      // text only
    } else if (style === 'call' && flags.voice_calls.enabled) {
      this.log(trip, `📞 Calling ${f.name} (${LANGS[lang]?.name || lang}) — no telephony: voice-note call`, 'act');
      const script = lang !== 'en-IN' && flags.friend_translation.enabled ? (await translate(spoken, lang)) || spoken : spoken;
      this.emit('call', { to: f.key, tripId: trip.id, name: f.name, text: script, lang });
    } else if (flags.voice_notes.enabled) {
      const script = lang !== 'en-IN' && flags.friend_translation.enabled ? (await translate(spoken, lang)) || spoken : spoken;
      this.voice(f.key, script, lang);
    }
  }

  friendJoin(user, tripId) {
    const trip = this.trips.get(tripId);
    if (!trip || trip.stage !== 'FRIENDS') return this.send(user.key, "That invite has expired, but say hi anytime! 👋");
    let slot = trip.friends.find(f => f.key === user.key) ||
      trip.friends.find(f => !f.key && f.name.toLowerCase().startsWith(user.name.toLowerCase().slice(0, 3))) ||
      trip.friends.find(f => !f.key);
    if (!slot) { slot = { name: user.name, key: null, status: 'pending' }; trip.friends.push(slot); }
    slot.key = user.key; slot.name = user.name || slot.name;
    if (user.lang) slot.lang = user.lang;
    this.log(trip, `🔗 ${slot.name} joined via invite link`, 'act');
    return this.pollFriend(trip, slot);
  }

  async onFriendsStage(trip, text) {
    if (/^sim_friends$/i.test(text)) {
      if (!(await this.flagsFor(trip.organizer, 'organizer')).simulate_friends.enabled) {
        return this.send(trip.organizer, "🚩 Friend simulation is switched off for you in Flagsmith. Waiting for your real friends to reply.");
      }
      const pending = trip.friends.filter(f => f.status !== 'replied' && !f.simulating);
      if (!pending.length) return;
      for (const f of pending) {
        f.simulated = true; f.simulating = true;
        if (!f.key) f.key = `sim:${trip.id}:${f.name.toLowerCase()}`;
        this.registerUser(f.key, f.name, 'sim', null);
        if (f.status !== 'asked') { f.status = 'asked'; this.emit('friend', { tripId: trip.id, friend: f }); }
      }
      if (this.users.get(trip.organizer)?.channel !== 'web') this.send(trip.organizer, `🤖 Simulating ${pending.map(f => f.name).join(', ')} with AI personas for the demo…`);
      // Run persona agents in parallel but outside this user's queue, so the organizer stays responsive.
      Promise.all(pending.map((f, i) => this.simulateFriend(trip, f, i))).catch(e => console.error(e));
      return;
    }
    if (/^(skip_friends|approve|go ahead)/i.test(text)) return this.toApproval(trip);
    const waiting = trip.friends.filter(f => f.status !== 'replied').map(f => f.name);
    this.send(trip.organizer, `Still waiting on ${waiting.join(', ') || 'nobody'} ⏳ I'll nudge them. Say "go ahead" to skip waiting.`);
  }

  /** "Subagent" friend: Claude role-plays the friend's reply (demo when real friends aren't on Telegram). */
  async simulateFriend(trip, f, i) {
    const vibes = ['super excited', 'budget-conscious', 'foodie, vegetarian', 'lazy, hates early mornings'];
    this.log(trip, `🤖 Spawning persona agent for ${f.name} (${vibes[i % vibes.length]})`, 'think');
    const text = await askText(
      `You are ${f.name}, a ${vibes[i % vibes.length]} Indian friend in your 20s. Your friend's AI assistant just texted you this trip plan: ` +
      `${trip.brief.destination}, ${trip.chosen.nights} nights, ${trip.chosen.stay.name}, activities: ${trip.chosen.activities.map(a => a.name).join(', ')}, ` +
      `~₹${trip.chosen.totalPerPerson}/person. Reply like a real WhatsApp/Telegram message (max 20 words, Hinglish ok, maybe one request). Just the message.`);
    const reply = text || friendReplyOffline(f.name, i).text;
    await new Promise(r => setTimeout(r, 600 + i * 700));
    this.emit('message', { to: f.key, from: f.key, text: reply, echo: true });
    f.simulating = false;
    if (f.status !== 'replied') await this.friendReply(trip, f, reply);
  }

  async friendReply(trip, f, text) {
    if (f.status === 'replied') return;
    f.status = 'replied';
    const parsed = (await askJSON(
      `A friend replied to a trip invite: "${text}". Return {"vote":"yes"|"no"|"maybe","request":"short request or empty string"}.`, SYSTEM))
      || parseFriendReplyOffline(text);
    f.status = 'replied'; f.vote = parsed.vote || 'yes'; f.request = parsed.request || ''; f.reply = text;
    if (f.variant) {
      const secs = Math.round((Date.now() - (f.askedAt || Date.now())) / 1000);
      this.experiment.record(f.variant, f.vote === 'yes' ? 'yes' : 'replied', secs);
      recordTraits(f.key, { invite_variant: f.variant, invite_vote: f.vote, reply_seconds: secs });
      // Conversion events for the Flagsmith experiment's metrics.
      trackEvent('friend_replied', f.key, secs);
      if (f.vote === 'yes') trackEvent('friend_said_yes', f.key, 1);
      flushEvents();
      this.emit('experiment', this.experiment.summary());
    }
    this.emit('friend', { tripId: trip.id, friend: f });
    this.touch(trip);
    const emoji = { yes: '✅', no: '❌', maybe: '🤔' }[f.vote] || '✅';
    this.log(trip, `${emoji} ${f.name}: "${text.slice(0, 70)}"`, 'act');
    if (!f.simulated) this.send(f.key, f.vote === 'no' ? "No worries, I'll let them know 💙" : `Noted! 🙌 I'll lock it in and send your share once it's booked.`);
    this.send(trip.organizer, `${emoji} *${f.name}* ${f.vote === 'yes' ? 'is in' : f.vote === 'no' ? "can't make it" : 'is a maybe'}${f.request ? ` — wants: ${f.request}` : ''}`);
    if (trip.friends.every(x => x.vote) && !trip.squadDone) { trip.squadDone = true; await this.squadDone(trip); }
  }

  async squadDone(trip) {
    const going = trip.friends.filter(f => f.vote !== 'no');
    const requests = trip.friends.filter(f => f.request).map(f => `${f.name}: ${f.request}`);
    trip.brief.groupSize = going.length + 1;
    this.log(trip, `🧮 Squad replied: ${going.length + 1} going. Folding in ${requests.length} requests`, 'think');
    let changes = [];
    if (requests.length) changes = await this.refine(trip, requests.join('; '), 'the friends');
    this.send(trip.organizer, `🎉 Everyone's replied! ${going.length + 1} of you are going.${changes.length ? `\nI adjusted the plan: ${changes.join('; ')}.` : ''}`);
    return this.toApproval(trip);
  }

  // ---------- APPROVAL / PAYMENT ----------
  toApproval(trip) {
    trip.stage = 'APPROVAL';
    const n = trip.brief.groupSize || trip.friends.filter(f => f.vote !== 'no').length + 1;
    trip.cart = buildCart(trip.chosen, n);
    this.touch(trip);
    const c = trip.cart;
    const lines = c.items.map(i => `${i.icon} ${i.title} — ${inr(i.amount)}`).join('\n');
    this.send(trip.organizer,
      `🧾 *Final plan: ${trip.chosen.title}, ${trip.brief.destination}*\n\n${lines}\n\n*Total: ${inr(c.total)}* (${inr(c.perPerson)}/person × ${n})\nFood (~${inr(trip.chosen.foodPerPerson)}/person) is pay-as-you-go.\n\n` +
      `Approve and I'll book everything with your saved card (xx4242) and collect each friend's share via UPI.`,
      [[{ label: '✅ Approve & book', data: 'approve' }, { label: '✏️ Tweak', data: 'tweak' }]]);
  }

  async onApproval(trip, text) {
    if (/^(approve|yes|book|go|confirm|ok|haan|done)/i.test(text)) {
      const flags = await this.flagsFor(trip.organizer, 'organizer');
      if (!flags.autonomous_booking.enabled) {
        this.log(trip, '🛑 Flagsmith kill switch autonomous_booking = OFF → drafting cart only', 'think');
        const list = trip.cart.items.map(i => `☐ ${i.icon} ${i.title} (${i.detail}): ${inr(i.amount)}`).join('\n');
        return this.send(trip.organizer, `🛑 Autonomous booking is switched off by your admin (Flagsmith kill switch).\nI won't book anything myself. Here's your ready-to-book checklist:\n\n${list}\n\n*Total ${inr(trip.cart.total)}*. Tap approve again once it's back on and I'll take over.`,
          [[{ label: '🔁 Approve again', data: 'approve' }]]);
      }
      if (!flags.payments_enabled.enabled) {
        this.log(trip, '🛑 Flagsmith kill switch payments_enabled = OFF → checkout blocked', 'think');
        emitEvent('payment_blocked_by_kill_switch', { tripId: trip.id, amount: trip.cart.total });
        return this.send(trip.organizer, `🛑 Payments are paused by your admin (Flagsmith kill switch \`payments_enabled\`).\nNo money moved. Your cart (${inr(trip.cart.total)}) is saved, so tap approve again once payments are back on.`,
          [[{ label: '🔁 Approve again', data: 'approve' }]]);
      }
      const limit = Number(flags.auto_book_limit.value) || Infinity;
      if (flags.auto_book_limit.enabled && trip.cart.total > limit) {
        trip.stage = 'GATE';
        this.touch(trip);
        this.log(trip, `🚩 Flagsmith auto_book_limit = ${inr(limit)} → ${inr(trip.cart.total)} needs sign-off`, 'think');
        const { wait } = requestApproval({ tripId: trip.id, amount: trip.cart.total, limit, destination: trip.brief.destination, items: trip.cart.items.length });
        this.log(trip, `🐝 NudgeBee approval-gated runbook "high-value-trip-checkout" started`, 'act');
        this.send(trip.organizer, `🐝 Heads up: ${inr(trip.cart.total)} is above your auto-book limit of ${inr(limit)} (set in Flagsmith).\nI've opened an approval runbook in NudgeBee. Approve it there, or sign off right here:`,
          [[{ label: '✅ Sign off', data: 'nb_approve' }, { label: '✋ Hold', data: 'nb_reject' }]]);
        wait.then(r => r.approved ? this.startPayment(trip, r.by) : (trip.stage = 'APPROVAL', this.touch(trip), this.send(trip.organizer, `✋ Checkout held (${r.by}). Tweak the plan or approve again.`)));
        return;
      }
      return this.startPayment(trip);
    }
    if (/^tweak$/i.test(text)) return this.send(trip.organizer, 'What should I change? ✏️');
    trip.stage = 'PLANNING';
    await this.refine(trip, text, 'organizer');
    return this.toApproval(trip);
  }

  onGate(trip, text) {
    const token = pendingApprovalFor(trip.id);
    if (/^(nb_approve|approve|sign off|yes)/i.test(text) && token) return void resolveApproval(token, true, 'organizer in chat');
    if (/^(nb_reject|hold|no)/i.test(text) && token) return void resolveApproval(token, false, 'organizer in chat');
    this.send(trip.organizer, '⏳ Waiting for the NudgeBee approval runbook. Tap Sign off to approve here.', [[{ label: '✅ Sign off', data: 'nb_approve' }]]);
  }

  startPayment(trip, approvedBy) {
    if (approvedBy) this.log(trip, `✅ Approval granted by ${approvedBy}`, 'done');
    trip.payment = new PaymentSession(trip.cart, this.users.get(trip.organizer)?.name);
    trip.stage = 'OTP';
    this.touch(trip);
    this.log(trip, `💳 Payment intent ${trip.payment.id} for ${inr(trip.cart.total)} (SANDBOX)`, 'act');
    emitEvent('payment_intent_created', { tripId: trip.id, amount: trip.cart.total });
    this.send(trip.organizer, `💳 Charging ${inr(trip.cart.total)} to card xx4242 for ${trip.cart.items.length} bookings in one checkout.\nYour bank just sent an OTP — reply with it here (text or voice note). 🔐`);
    this.emit('sms', { to: trip.organizer, text: trip.payment.smsText() });
  }

  async onOtp(trip, text) {
    const code = text.replace(/\D/g, '');
    if (code.length !== 6) return this.send(trip.organizer, 'Please send the 6-digit OTP from your bank 🔐');
    const v = trip.payment.verify(code);
    if (!v.ok) {
      if (trip.payment.status === 'failed' || trip.payment.status === 'expired') { trip.stage = 'APPROVAL'; this.touch(trip); return this.send(trip.organizer, `❌ Payment ${v.reason}. Tap approve to retry.`, [[{ label: '🔁 Retry', data: 'approve' }]]); }
      return this.send(trip.organizer, `❌ ${v.reason} — ${v.remaining} tries left.`);
    }
    trip.stage = 'BOOKING';
    this.touch(trip);
    this.log(trip, '✅ Payment authorized. Booking all items…', 'done');
    this.send(trip.organizer, '✅ Payment authorized! Booking everything now… 🚀');
    emitEvent('payment_authorized', { tripId: trip.id, amount: trip.cart.total });
    const flags = await this.flagsFor(trip.organizer, 'organizer');
    const drill = flags.booking_failure_drill.enabled;
    if (drill) this.log(trip, '🚩 Flagsmith booking_failure_drill ON → StaySandbox will go down mid-booking', 'think');
    trip.confirmations = [];
    for (const item of trip.cart.items) {
      this.log(trip, `⏳ ${item.provider}: ${item.title}`, 'act');
      this.emit('booking', { tripId: trip.id, item, status: 'in_progress' });
      try {
        const res = await runBookingRunbook(item,
          (provider) => bookItem(item, provider, { delayMs: config.bookingDelayMs ?? 900, outage: drill && item.kind === 'stay' }),
          async (t, k) => this.log(trip, t, k));
        const conf = { ...item, provider: res.provider, ref: res.ref, status: 'confirmed' };
        trip.confirmations.push(conf);
        this.log(trip, `✅ ${conf.provider}: ${conf.title} → ${conf.ref}`, 'done');
        this.emit('booking', { tripId: trip.id, item: conf, status: 'confirmed' });
      } catch (e) {
        this.log(trip, `❌ ${item.title}: ${e.message} — escalated to NudgeBee`, 'act');
        emitEvent('booking_escalated', { tripId: trip.id, item: item.title });
        trip.confirmations.push({ ...item, status: 'failed', ref: 'PENDING' });
      }
    }
    emitEvent('trip_booked', { tripId: trip.id, confirmations: trip.confirmations.length });
    trip.stage = 'DONE';
    this.touch(trip);
    const conf = trip.confirmations.map(c => `${c.icon} ${c.title}\n   ref *${c.ref}*`).join('\n');
    this.send(trip.organizer, `🎉 *All booked!* ${trip.brief.destination}, here you come.\n\n${conf}\n\n💰 Paid ${inr(trip.cart.total)}. I've sent each friend their ${inr(trip.cart.perPerson)} share via UPI request.\nYou didn't have to be "that friend" today. 😎`);
    const orgFlags = await this.flagsFor(trip.organizer, 'organizer');
    if (orgFlags.voice_notes.enabled) this.voice(trip.organizer, `All booked! ${trip.brief.destination}, here you come. I paid ${trip.cart.total} rupees and sent everyone their share. You didn't have to be that friend today.`, this.users.get(trip.organizer)?.lang || 'en-IN');
    const orgName = this.users.get(trip.organizer)?.name || 'the organizer';
    for (const f of trip.friends.filter(f => f.vote !== 'no' && f.key)) {
      this.send(f.key, `🎒 You're booked for *${trip.brief.destination}*!\n${trip.confirmations.slice(0, 2).map(c => `${c.icon} ${c.title} — ${c.ref}`).join('\n')}\n\nYour share: *${inr(trip.cart.perPerson)}* → tap to pay ${orgName}:\n${upiCollectLink(orgName, trip.cart.perPerson, trip.brief.destination + ' trip')}`);
      const ff = await this.flagsFor(f.key, 'friend');
      if (ff.voice_notes.enabled) {
        const line = `You're booked for ${trip.brief.destination}! Your share is ${trip.cart.perPerson} rupees, I've sent a UPI request from ${orgName}.`;
        const lang = f.lang || 'en-IN';
        this.voice(f.key, lang !== 'en-IN' && ff.friend_translation.enabled ? (await translate(line, lang)) || line : line, lang);
      }
    }
  }

  /** Inbound voice (Telegram voice note / browser mic) after Sarvam STT. */
  async handleVoice(key, transcript, language, meta = {}) {
    const u = this.users.get(key) || this.registerUser(key, meta.name || 'Friend', meta.channel || 'web', meta.chatId);
    if (language && LANGS[language]) u.lang = language;
    const ft = this.friendTripOf(key);
    const f = ft?.friends.find(x => x.key === key);
    if (f && language && LANGS[language]) f.lang = language;
    const trip = this.tripOf(key) || ft;
    this.log(trip, `🎙️ Sarvam STT (${LANGS[language]?.name || language || 'auto'}): "${transcript.slice(0, 80)}"`, 'act');
    let text = transcript;
    if (language && language !== 'en-IN' && LANGS[language]) {
      const en = await translate(transcript, 'en-IN', language);
      if (en) { text = en; this.log(trip, `🌐 → "${en.slice(0, 80)}"`, 'act'); }
    }
    return this.handle(key, text, meta);
  }

  sendStatus(key) {
    const t = this.tripOf(key) || this.friendTripOf(key);
    if (!t) return this.send(key, 'No active trip. Tell me where you want to go! 🌍');
    this.send(key, `📋 Trip ${t.id} — ${t.brief.destination || '?'} — stage: ${t.stage}\n👥 ${t.friends.map(f => `${f.name} ${f.status === 'replied' ? ({ yes: '✅', no: '❌', maybe: '🤔' }[f.vote]) : '⏳'}`).join('  ')}\n🧠 LLM: ${llmStatus.backend}`);
  }
}

function clean(o) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) r[k] = v;
  return r;
}

function defaultFriendNames(n) {
  return ['Aman', 'Riya', 'Kabir', 'Sana', 'Dev', 'Isha', 'Arjun', 'Meera'].slice(0, Math.max(0, n));
}

function normalizePlan(p, fb, brief, i) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
  const out = {
    id: ['A', 'B', 'C'][i] || fb.id,
    title: p.title || fb.title,
    vibe: p.vibe || fb.vibe,
    destination: p.destination || brief.destination || fb.destination,
    nights: num(p.nights, fb.nights),
    transport: { mode: p.transport?.mode || fb.transport.mode, detail: p.transport?.detail || fb.transport.detail, costPerPerson: num(p.transport?.costPerPerson, fb.transport.costPerPerson) },
    stay: { name: p.stay?.name || fb.stay.name, type: p.stay?.type || fb.stay.type, nights: num(p.stay?.nights, fb.stay.nights), costPerPerson: num(p.stay?.costPerPerson, fb.stay.costPerPerson) },
    activities: Array.isArray(p.activities) && p.activities.length ? p.activities.slice(0, 6).map(a => ({ name: String(a.name || a), costPerPerson: num(a.costPerPerson, 0) })) : fb.activities,
    localTravel: { detail: p.localTravel?.detail || fb.localTravel.detail, costPerPerson: num(p.localTravel?.costPerPerson, fb.localTravel.costPerPerson) },
    foodPerPerson: num(p.foodPerPerson, fb.foodPerPerson),
    days: Array.isArray(p.days) && p.days.length ? p.days.map((d, j) => ({ day: num(d.day, j + 1), title: d.title || `Day ${j + 1}`, items: (d.items || []).map(String).slice(0, 5) })) : fb.days,
    notes: p.notes || fb.notes || [],
  };
  out.totalPerPerson = totalOf(out);
  out.withinBudget = out.totalPerPerson <= (brief.budgetPerPerson || Infinity);
  return out;
}
