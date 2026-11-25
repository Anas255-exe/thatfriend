// ThatFriend engine: channel-agnostic state machine.
// BRIEF → PREFS (ask every friend first) → PLANNING (merge + research) → FRIENDS (final 👍)
//       → APPROVAL → [GATE] → OTP → BOOKING → DONE
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { askJSON, askText, llmStatus } from './llm.js';
import { extractBriefOffline, parseFriendReplyOffline } from './fallback.js';
import { GENZ, parsePrefs, researchOptions, refinePlan, offlineOptions, planCards } from './planner.js';
import { buildCart, PaymentSession, bookItem, upiCollectLink } from './booking.js';
import { config } from './config.js';
import { getFlags, recordTraits, experimentVariant, trackEvent, flushEvents } from './flags.js';
import { translate, LANGS } from './sarvam.js';
import { requestApproval, resolveApproval, pendingApprovalFor, runBookingRunbook, emitEvent } from './nudgebee.js';

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

const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const MEETUP_RE = /\b(meet ?up|hang ?out|dinner|lunch|brunch|movie|cafe|café|party|drinks|chill (?:sesh|plan)|catch ?up|night out|bowling|game night)\b/i;

// AI persona agents used to simulate friends who aren't on Telegram yet (demo).
const PERSONAS = [
  { vibe: 'adventure + snow freak, ok spending a bit more, wants the big-ticket experiences', offline: 'bro snow is a MUST 🏔️ gondola/skiing type stuff. budget thoda flexible hai, bas boring mat banana' },
  { vibe: 'budget-conscious, loves aesthetic cafés + photo spots, hates touristy traps', offline: 'budget tight hai yaar 😭 cheap stay is fine. cute cafés + sunset spots for pics pls, no touristy traps' },
  { vibe: 'foodie, pure veg, hates waking up early, wants chill', offline: 'im in for the food fr 🍜 but pure veg pls. and NO 5am wake ups, chill pace only' },
  { vibe: 'party person, wants nightlife and music', offline: 'need at least one proper night out 🎶 rest i’m easy' },
];

export class Engine extends EventEmitter {
  constructor() {
    super();
    this.users = new Map();
    this.trips = new Map();
    this.queues = new Map();
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
  cards(to, cards, intro) { if (cards?.length) this.emit('cards', { to, cards, intro }); }
  flagsFor(key, role) {
    const u = this.users.get(key) || {};
    return getFlags(key, { channel: u.channel, role, language: u.lang || 'en-IN', name: u.name });
  }
  voice(to, text, lang = 'en-IN', kind = 'note') { this.emit('voice', { to, text, lang, kind }); }
  log(trip, text, kind = 'info') {
    const entry = { t: Date.now(), tripId: trip?.id, text, kind, backend: llmStatus.backend };
    trip?.log.push(entry);
    this.emit('log', entry);
  }
  tripOf(key) { for (const t of this.trips.values()) if (t.organizer === key && t.stage !== 'ARCHIVED') return t; return null; }
  friendTripOf(key) { for (const t of this.trips.values()) if (t.stage !== 'ARCHIVED' && t.friends.some(f => f.key === key)) return t; return null; }
  snapshot(trip) {
    if (!trip) return null;
    const { payment, ...rest } = trip;
    return { ...rest, payment: payment && { id: payment.id, status: payment.status, total: payment.cart.total } };
  }
  orgName(trip) { return this.users.get(trip.organizer)?.name || 'ur friend'; }
  what(trip) { return trip.brief.kind === 'meetup' ? (trip.brief.activity || 'meetup') : `${trip.brief.destination} trip`; }

  handle(key, text, meta = {}) {
    const prev = this.queues.get(key) || Promise.resolve();
    const next = prev.then(() => this._handle(key, String(text || '').trim(), meta)).catch(e => {
      console.error('[engine]', e);
      this.send(key, 'oops my brain lagged for a sec 😵 say that again?');
    });
    this.queues.set(key, next);
    return next;
  }

  async _handle(key, text, meta) {
    const user = this.users.get(key) || this.registerUser(key, meta.name || 'Friend', meta.channel || 'web', meta.chatId);
    const join = text.match(/^\/start\s+join_([A-Za-z0-9]+)/);
    if (join) return this.friendJoin(user, join[1]);

    if (/^\/(start|help)$/i.test(text)) {
      return this.send(key, `yo ${user.name} 👋 i'm *ThatFriend*, basically the friend who actually books stuff so nobody else has to 😮‍💨\n\njust text me like:\n“kashmir next weekend w aman, riya n kabir, 15k each”\nor “dinner + movie saturday w the gang in blr”\n\ni'll ask everyone what they want, merge it, show u real spots w pics + maps, n book it all once u say yes ✅`);
    }
    if (/^\/(new|reset)$/i.test(text)) {
      const t = this.tripOf(key); if (t) t.stage = 'ARCHIVED';
      return this.send(key, 'clean slate 🧹 where we going / what we doing?');
    }
    if (/^\/status$/i.test(text)) return this.sendStatus(key);

    // A friend talking to the bot?
    const ft = this.friendTripOf(key);
    if (ft && !this.tripOf(key)) {
      const f = ft.friends.find(x => x.key === key);
      if (ft.stage === 'PREFS' && f && !f.prefs) return this.friendPrefs(ft, f, text);
      if (ft.stage === 'FRIENDS' && f && f.status !== 'replied') return this.friendReply(ft, f, text);
      return this.send(key, ft.stage === 'DONE' ? `ur all set for the ${this.what(ft)} 🎒 confirmations are up there ☝️` :
        `got u 🙌 ${this.orgName(ft)} n i are on it, i'll ping u when it's locked`);
    }

    let trip = this.tripOf(key);
    if (!trip) trip = this.newTrip(key);
    switch (trip.stage) {
      case 'BRIEF': return this.onBrief(trip, text);
      case 'PREFS': return this.onPrefsStage(trip, text);
      case 'PLANNING': return this.onPlanning(trip, text);
      case 'FRIENDS': return this.onFriendsStage(trip, text);
      case 'APPROVAL': return this.onApproval(trip, text);
      case 'GATE': return this.onGate(trip, text);
      case 'OTP': return this.onOtp(trip, text);
      case 'BOOKING': return this.send(key, 'booking rn, 2 sec ⏳');
      case 'DONE':
        if (/new|another|plan|trip|meet/i.test(text)) { trip.stage = 'ARCHIVED'; return this._handle(key, text, meta); }
        return this.send(key, `ur ${this.what(trip)} is booked ✅ send /new for the next one`);
    }
  }

  newTrip(organizer) {
    const trip = { id: crypto.randomBytes(4).toString('hex'), organizer, stage: 'BRIEF', brief: {}, merge: [], options: [], chosen: null,
      friends: [], cart: null, payment: null, confirmations: [], log: [], createdAt: Date.now() };
    this.trips.set(trip.id, trip);
    this.emit('trip', this.snapshot(trip));
    return trip;
  }
  touch(trip) { this.emit('trip', this.snapshot(trip)); }

  // ---------- BRIEF ----------
  async onBrief(trip, text) {
    const key = trip.organizer;
    this.log(trip, '🧠 reading the request…', 'think');
    let brief = await askJSON(
      `Current brief: ${JSON.stringify(trip.brief)}\nNew message from organizer: "${text}"\n` +
      `Return the updated brief JSON: {"kind":"trip"|"meetup","destination":str|null (trip),"city":str|null (meetup city, default from context),` +
      `"activity":str|null (meetup e.g. "dinner + movie"),"origin":str|null,"when":str|null,"nights":num|null,"budgetPerPerson":num|null,"totalBudget":num|null,` +
      `"groupSize":num|null (incl organizer),"friends":[first names, excl organizer],"preferences":[organizer's own asks]}. ` +
      `"15k"=15000. "Uti"/"Ooti"=Ooty. A meetup is a same-city hangout (dinner, movie, cafe, party). Keep previous values unless changed.`, GENZ);
    brief = brief ? { ...trip.brief, ...clean(brief) } : { ...extractBriefOffline(text, trip.brief), kind: trip.brief.kind || (MEETUP_RE.test(text) ? 'meetup' : 'trip') };
    if (brief.kind === 'meetup' && !brief.city) brief.city = (text.match(/\b(?:in|at)\s+(blr|bangalore|bengaluru|delhi|mumbai|pune|hyderabad|chennai|gurgaon|noida)\b/i) || [])[1] || 'Bengaluru';
    if (brief.kind === 'meetup' && !brief.activity) brief.activity = (text.match(MEETUP_RE) || [])[0] || 'hangout';
    if (brief.totalBudget && brief.groupSize && !brief.budgetPerPerson) brief.budgetPerPerson = Math.round(brief.totalBudget / brief.groupSize);
    if (brief.friends?.length && (!brief.groupSize || brief.groupSize < brief.friends.length + 1)) brief.groupSize = brief.friends.length + 1;
    trip.brief = brief;
    this.touch(trip);

    const meetup = brief.kind === 'meetup';
    const missing = [];
    if (!meetup && !brief.destination) missing.push('where to');
    if (!meetup && !brief.budgetPerPerson && !brief.totalBudget) missing.push('budget (per head or total)');
    if (!brief.friends?.length && !brief.groupSize) missing.push("who's coming (names so i can text them)");
    if (missing.length) return this.send(key, `ok ok i'm in 🔥 just need ${missing.join(' + ')} n we're cooking`);

    brief.when ||= meetup ? 'this saturday evening' : 'next weekend';
    if (!meetup) { brief.origin ||= 'Bengaluru'; brief.nights ||= 2; }
    if (meetup && !brief.budgetPerPerson) brief.budgetPerPerson = 1500;
    if (!brief.friends?.length) brief.friends = ['Aman', 'Riya', 'Kabir', 'Sana', 'Dev'].slice(0, Math.max(1, brief.groupSize - 1));
    trip.friends = brief.friends.map((n, i) => ({ name: n, key: null, status: 'pending', simulated: false, lang: config.friendLangs[i % config.friendLangs.length] || 'en-IN' }));

    const head = meetup
      ? `bet 🫡 ${brief.activity} · ${brief.city} · ${brief.when} · w ${brief.friends.join(', ')}`
      : `bet 🫡 ${brief.destination} · ${brief.when} · ${brief.nights} nights · ${inr(brief.budgetPerPerson)}/head · w ${brief.friends.join(', ')}`;
    this.send(key, `${head}\n\nbefore i plan anything lemme ask the squad what they actually want, so nobody's like “yaar mujhe toh ye nahi karna tha” later 😤\nsliding into their DMs rn 📲`);
    return this.askPrefs(trip);
  }

  // ---------- PREFS: ask every friend first ----------
  async askPrefs(trip) {
    const orgFlags = await this.flagsFor(trip.organizer, 'organizer');
    if (!orgFlags.friend_outreach.enabled) {
      this.log(trip, '🛑 Flagsmith kill switch friend_outreach = OFF → not messaging anyone', 'think');
      this.send(trip.organizer, `🛑 heads up: friend outreach is switched off by ur admin (Flagsmith kill switch), so i can't DM anyone rn.\ni'll plan off what u told me 👇`);
      return this.makeOptions(trip);
    }
    trip.stage = 'PREFS';
    this.touch(trip);
    this.log(trip, `📨 asking ${trip.friends.length} friends what they want, on ${this.orgName(trip)}'s behalf`, 'act');
    if (this.users.get(trip.organizer)?.channel === 'telegram' && this.botUsername) {
      const link = `https://t.me/${this.botUsername}?start=join_${trip.id}`;
      this.send(trip.organizer, `drop this in the group chat 👇 when they tap it i'll vibe-check each of them privately:\n${link}`,
        config.simulateMissingFriends ? [[{ label: "🤖 simulate friends who haven't joined", data: 'sim_friends' }], [{ label: '⏭️ plan w whoever replied', data: 'plan_now' }]] : [[{ label: '⏭️ plan w whoever replied', data: 'plan_now' }]]);
    } else {
      for (const f of trip.friends) {
        f.key ||= `web:friend-${f.name.toLowerCase()}`;
        this.registerUser(f.key, f.name, 'web', f.key);
        await this.askFriendPrefs(trip, f).catch(e => console.error('[prefs]', e));
      }
    }
  }

  async askFriendPrefs(trip, f) {
    const org = this.orgName(trip);
    const b = trip.brief;
    f.status = 'asked'; f.askedAt = Date.now();
    const u = this.users.get(f.key); if (u) u.lang ||= f.lang;
    this.emit('friend', { tripId: trip.id, friend: f });
    const flags = await this.flagsFor(f.key, 'friend');
    const lang = f.lang || 'en-IN';
    let text = b.kind === 'meetup'
      ? `heyy ${f.name} 👋 it's ThatFriend, ${org}'s plan buddy\n${org} wants a *${b.activity}* w the gang · ${b.when} · ${b.city}\n\nquick vibe check before i lock anything 👇\n• what kinda place? (café, food, drinks, movie, games…)\n• what time works for u?\n• budget per head?\n• any hard no?\n\njust text me like u'd text ${org} 😌`
      : `heyy ${f.name} 👋 it's ThatFriend, ${org}'s plan buddy\n${org}'s planning *${b.destination}* w the squad · ${b.when} · ~${inr(b.budgetPerPerson)}/head\n\nbefore i lock anything, tell me ur vibe 👇\n• what do u wanna do? (snow, chill cafés, food, adventure, party…)\n• any must-do?\n• any hard no?\n• budget cool or tight?\n\njust text me like u'd text ${org} 😌`;
    if (lang !== 'en-IN' && flags.friend_translation.enabled) {
      const t = await translate(text, lang);
      if (t) { text = `${t}\n\n— ${LANGS[lang].name} · via Sarvam`; this.log(trip, `🌐 Sarvam translated ${f.name}'s DM to ${LANGS[lang].name}`, 'act'); }
    }
    this.send(f.key, text, [[{ label: "😔 can't make it", data: "sorry can't make it this time" }]]);

    // 🧪 Flagsmith A/B/n experiment on how we reach each friend: text | voice_note | call
    const spoken = b.kind === 'meetup'
      ? `hey ${f.name}! ${org} is planning a ${b.activity} with the gang, ${b.when}. what kind of place do you want, what time works, and anything you don't want? just reply here.`
      : `hey ${f.name}! ${org} is planning ${b.destination} with the squad, ${b.when}, around ${b.budgetPerPerson} rupees each. what's your vibe, any must-do, anything you don't want? just reply here.`;
    const expValue = flags.invite_style.source === 'override' ? null : await experimentVariant('invite_style', f.key, { role: 'friend', language: lang });
    const style = flags.invite_style.enabled ? String(expValue || flags.invite_style.value || 'call') : (flags.voice_calls.enabled ? 'call' : flags.voice_notes.enabled ? 'voice_note' : 'text');
    const forced = flags.invite_style.source === 'override';
    f.variant = forced ? null : style;
    if (!forced) this.experiment.record(style, 'sent');
    this.log(trip, `🧪 Flagsmith experiment invite_style → ${f.name} gets "${style}"`, 'think');
    recordTraits(f.key, { invite_variant: style, trip_id: trip.id });
    const script = async () => (lang !== 'en-IN' && flags.friend_translation.enabled ? (await translate(spoken, lang)) || spoken : spoken);
    if (style === 'call' && flags.voice_calls.enabled) {
      this.log(trip, `📞 calling ${f.name} (${LANGS[lang]?.name || lang}), voice-note call, no telephony needed`, 'act');
      this.emit('call', { to: f.key, tripId: trip.id, name: f.name, text: await script(), lang });
    } else if (style !== 'text' && flags.voice_notes.enabled) {
      this.voice(f.key, await script(), lang);
    }
  }

  friendJoin(user, tripId) {
    const trip = this.trips.get(tripId);
    if (!trip || !['PREFS', 'FRIENDS'].includes(trip.stage)) return this.send(user.key, 'that link expired 😅 but hiii, say hi anytime');
    let slot = trip.friends.find(f => f.key === user.key) ||
      trip.friends.find(f => !f.key && f.name.toLowerCase().startsWith(user.name.toLowerCase().slice(0, 3))) ||
      trip.friends.find(f => !f.key);
    if (!slot) { slot = { name: user.name, key: null, status: 'pending' }; trip.friends.push(slot); }
    slot.key = user.key; slot.name = user.name || slot.name;
    if (user.lang) slot.lang = user.lang;
    this.log(trip, `🔗 ${slot.name} joined via the link`, 'act');
    return trip.stage === 'PREFS' ? this.askFriendPrefs(trip, slot) : this.askFinalCheck(trip, slot);
  }

  async onPrefsStage(trip, text) {
    if (/^sim_friends$/i.test(text)) return this.simulateFriends(trip, 'prefs');
    if (/^(plan_now|plan|go|go ahead|skip)$/i.test(text)) return this.makeOptions(trip);
    // organizer adding their own asks while waiting
    trip.brief.preferences = [...(trip.brief.preferences || []), text];
    const waiting = trip.friends.filter(f => !f.prefs).map(f => f.name);
    this.send(trip.organizer, `noted ✍️ still waiting on ${waiting.join(', ') || 'nobody'}. say “go” n i'll plan w whoever replied`, [[{ label: '⏭️ plan now', data: 'plan_now' }]]);
  }

  async friendPrefs(trip, f, text) {
    if (f.prefs) return;
    f.prefsText = text; f.status = 'replied';
    f.prefs = await parsePrefs(f.name, text, trip.brief);
    f.vote = f.prefs.in === false ? 'no' : 'yes';
    this.experimentOutcome(f);
    this.emit('friend', { tripId: trip.id, friend: f });
    this.touch(trip);
    this.log(trip, `💬 ${f.name}: "${text.slice(0, 80)}"`, 'act');
    if (!f.simulated) this.send(f.key, f.vote === 'no' ? 'aww noo 🥲 next time fr. i’ll let them know' : `noted 🫡 i'll mix this into the plan n send it over for a final 👍`);
    this.send(trip.organizer, f.vote === 'no' ? `😔 *${f.name}* can't make it this time` : `📩 *${f.name}*: “${text.slice(0, 120)}”${f.prefs.summary ? `\n→ ${f.prefs.summary}` : ''}`);
    if (trip.friends.every(x => x.prefs) && trip.stage === 'PREFS') return this.makeOptions(trip);
  }

  experimentOutcome(f) {
    if (!f.variant || f.counted) return;
    f.counted = true;
    const secs = Math.round((Date.now() - (f.askedAt || Date.now())) / 1000);
    this.experiment.record(f.variant, f.vote === 'yes' ? 'yes' : 'replied', secs);
    recordTraits(f.key, { invite_variant: f.variant, invite_vote: f.vote, reply_seconds: secs });
    trackEvent('friend_replied', f.key, secs);
    if (f.vote === 'yes') trackEvent('friend_said_yes', f.key, 1);
    flushEvents();
    this.emit('experiment', this.experiment.summary());
  }

  async simulateFriends(trip, phase) {
    if (!(await this.flagsFor(trip.organizer, 'organizer')).simulate_friends.enabled) {
      return this.send(trip.organizer, "🚩 friend simulation is off for u in Flagsmith, waiting on the real squad");
    }
    const pending = trip.friends.filter(f => (phase === 'prefs' ? !f.prefs : f.status !== 'replied') && !f.simulating);
    if (!pending.length) return;
    for (const f of pending) {
      f.simulated = true; f.simulating = true;
      f.key ||= `sim:${trip.id}:${f.name.toLowerCase()}`;
      this.registerUser(f.key, f.name, 'sim', null);
      if (f.status !== 'asked') { f.status = 'asked'; f.askedAt = Date.now(); this.emit('friend', { tripId: trip.id, friend: f }); }
    }
    if (this.users.get(trip.organizer)?.channel !== 'web') this.send(trip.organizer, `🤖 simulating ${pending.map(f => f.name).join(', ')} w AI personas for the demo…`);
    Promise.all(pending.map((f) => this.simulateFriend(trip, f, trip.friends.indexOf(f), phase))).catch(e => console.error(e));
  }

  /** AI persona agent: Claude role-plays the friend (demo when real friends aren't on Telegram). */
  async simulateFriend(trip, f, i, phase) {
    const p = PERSONAS[i % PERSONAS.length];
    this.log(trip, `🤖 persona agent for ${f.name} (${p.vibe.split(',')[0]})`, 'think');
    const b = trip.brief;
    const ask = phase === 'prefs'
      ? `ThatFriend (your friend's AI planner) asked what you want for ${b.kind === 'meetup' ? `a ${b.activity} in ${b.city} ${b.when}` : `a ${b.destination} trip ${b.when}, ~₹${b.budgetPerPerson}/head`}: your vibe, must-do, hard no, budget.`
      : `ThatFriend sent the final plan: ${trip.chosen.title}, ~₹${trip.chosen.totalPerPerson}/head, ${[trip.chosen.stay?.name, ...trip.chosen.spots.map(s => s.name)].filter(Boolean).slice(0, 4).join(', ')}. Are you in?`;
    const text = await askText(`You are ${f.name}, a ${p.vibe} Indian Gen Z friend. ${ask} Reply like a real WhatsApp text: max 25 words, Hinglish ok, 1 emoji max. Just the message.`);
    const reply = text || (phase === 'prefs' ? p.offline : 'yesss im in 🙌');
    await new Promise(r => setTimeout(r, 600 + i * 700));
    this.emit('message', { to: f.key, from: f.key, text: reply, echo: true });
    f.simulating = false;
    if (phase === 'prefs') await this.friendPrefs(trip, f, reply); else if (f.status !== 'replied') await this.friendReply(trip, f, reply);
  }

  // ---------- PLANNING: merge everyone + research ----------
  async makeOptions(trip, feedback = '') {
    trip.stage = 'PLANNING';
    this.touch(trip);
    const b = trip.brief;
    const live = config.llmMode !== 'offline';
    this.send(trip.organizer, live ? `ok merging everyone's takes + checking real reviews online 🔎 gimme ~30 sec` : `merging everyone's takes 🧩 one sec`);
    this.log(trip, `🔎 researching ${b.kind === 'meetup' ? b.city : b.destination} (web search + reviews) and merging ${trip.friends.filter(f => f.prefs).length} opinions…`, 'think');
    let res = live ? await researchOptions(trip, this.orgName(trip), feedback).catch(e => (console.error(e), null)) : null;
    if (!res) { res = offlineOptions(trip, this.orgName(trip)); if (res) this.log(trip, '📦 used the offline backup (real, well-known spots)', 'info'); }
    if (!res) return this.send(trip.organizer, `ngl i couldn't pull good options for ${b.destination} rn 😅 try again in a min, or pick: Kashmir, Ooty, Goa, Manali`);
    trip.merge = res.merge || [];
    trip.options = res.options;
    this.log(trip, `✅ ${trip.options.length} options ready (${llmStatus.backend})`, 'done');
    this.touch(trip);

    const merge = trip.merge.length ? `here's what the squad wanted → what i did 👇\n${trip.merge.map(m => `• *${m.who}*: ${m.wanted} → ${m.how}`).join('\n')}\n\n` : '';
    const lines = trip.options.map(o =>
      `*${o.id}. ${o.title}* · ${inr(o.totalPerPerson)}/head ${o.withinBudget ? '✅' : '⚠️ over budget'}\n${o.vibe}\n` +
      (o.kind === 'meetup' ? `🕖 ${o.when}\n📍 ${o.spots.map(s => s.name).join(' → ')}` : `${o.transport ? '🚆 ' + o.transport.mode + '\n' : ''}${o.stay ? '🏡 ' + o.stay.name + '\n' : ''}📸 ${o.spots.slice(0, 4).map(s => s.name).join(', ')}`));
    this.send(trip.organizer, `${merge}${lines.join('\n\n')}\n\nspots for option A below w pics 👇 pick one or tell me what to change`,
      [trip.options.map(o => ({ label: `go w ${o.id}`, data: `pick:${o.id}` })), [{ label: '👀 show B spots', data: 'show:B' }]]);
    this.cards(trip.organizer, await planCards(trip.options[0]), `option A spots`);
  }

  async onPlanning(trip, text) {
    const show = text.match(/^show:([AB])$/i);
    if (show) { const o = trip.options.find(x => x.id === show[1].toUpperCase()); if (o) return this.cards(trip.organizer, await planCards(o), `option ${o.id} spots`); }
    const pick = text.match(/^(?:pick:)?\s*(?:go w |option\s*)?([ab12])\s*$/i);
    if (pick) {
      const id = { 1: 'A', 2: 'B' }[pick[1]] || pick[1].toUpperCase();
      const o = trip.options.find(x => x.id === id);
      if (o) { trip.chosen = structuredClone(o); this.touch(trip); return this.showChosen(trip); }
    }
    if (/^(ask_squad|final check|ask (the )?(squad|friends))/i.test(text) && trip.chosen) return this.askSquadFinal(trip);
    if (/^(skip_friends|approve|book it|looks good)/i.test(text) && trip.chosen) return this.toApproval(trip);
    if (/^tweak$/i.test(text)) return this.send(trip.organizer, 'say less, what should i change? ✏️');
    if (!trip.chosen) return this.makeOptions(trip, text);
    await this.refine(trip, text, 'organizer');
    return this.showChosen(trip, 'updated ✨');
  }

  async refine(trip, feedback, who) {
    this.log(trip, `✏️ tweaking: "${feedback.slice(0, 60)}"`, 'think');
    const res = config.llmMode !== 'offline' ? await refinePlan(trip, feedback, who).catch(() => null) : null;
    if (res) { trip.chosen = res.plan; this.log(trip, `✅ updated: ${res.changes.join('; ')}`, 'done'); }
    else { (trip.chosen.notes ||= []).push(`${who}: ${feedback.slice(0, 80)}`); this.log(trip, `📝 noted "${feedback.slice(0, 60)}"`, 'info'); }
    this.touch(trip);
    return res?.changes || [`noted: ${feedback.slice(0, 60)}`];
  }

  async showChosen(trip, header) {
    const o = trip.chosen;
    const days = o.days.map(d => `*${o.kind === 'meetup' ? '' : 'day ' + d.day + ' · '}${d.title}*\n${d.items.map(i => '  • ' + i).join('\n')}`).join('\n');
    const others = trip.friends.filter(f => f.vote !== 'no').map(f => f.name).join(', ');
    this.send(trip.organizer, `${header || `locked *${o.title}* 🔒`}\n\n${days}\n\n💸 *${inr(o.totalPerPerson)}/head* (budget ${inr(trip.brief.budgetPerPerson)})\n\nsend this to ${others || 'the squad'} for a final 👍?`,
      [[{ label: '👥 final check w squad', data: 'ask_squad' }, { label: '✏️ tweak', data: 'tweak' }], [{ label: '✅ skip, book it', data: 'skip_friends' }]]);
    this.cards(trip.organizer, await planCards(o), 'the spots');
  }

  // ---------- FRIENDS: final 👍 on the merged plan ----------
  async askSquadFinal(trip) {
    const going = trip.friends.filter(f => f.vote !== 'no');
    if (!going.length) return this.toApproval(trip);
    trip.stage = 'FRIENDS';
    for (const f of going) { f.status = 'pending'; delete f.counted; }
    this.touch(trip);
    this.log(trip, `📨 sending the merged plan to ${going.map(f => f.name).join(', ')} for a final 👍`, 'act');
    const cards = await planCards(trip.chosen, 4);
    for (const f of going) if (f.key && !f.key.startsWith('sim:')) await this.askFinalCheck(trip, f, cards);
    if (this.users.get(trip.organizer)?.channel === 'telegram' && going.some(f => !f.key || f.key.startsWith('sim:')))
      this.send(trip.organizer, `sent to whoever's on telegram 📲`, [[{ label: '🤖 simulate the rest', data: 'sim_friends' }]]);
    else this.send(trip.organizer, `sent it to the squad 📲 i'll handle the back n forth`);
  }

  async askFinalCheck(trip, f, cards) {
    const o = trip.chosen;
    f.status = 'asked';
    this.emit('friend', { tripId: trip.id, friend: f });
    const yours = f.prefs?.summary ? `\nu said: “${f.prefs.summary}” → kept that in ✅` : '';
    this.send(f.key, `ok here's the final plan 👇 *${o.title}* · ${o.when || this.what(trip)}\n💸 ~${inr(o.totalPerPerson)}/head${yours}\n\nu in? 🙌`,
      [[{ label: "👍 i'm in", data: "i'm in" }, { label: '🤔 maybe', data: 'maybe' }, { label: '👎 out', data: "can't make it" }]]);
    this.cards(f.key, cards || await planCards(o, 4));
  }

  async onFriendsStage(trip, text) {
    if (/^sim_friends$/i.test(text)) return this.simulateFriends(trip, 'final');
    if (/^(skip_friends|approve|go ahead|go)$/i.test(text)) return this.toApproval(trip);
    const waiting = trip.friends.filter(f => f.vote !== 'no' && f.status !== 'replied').map(f => f.name);
    this.send(trip.organizer, `still waiting on ${waiting.join(', ') || 'nobody'} ⏳ i'll nudge them. say “go” to skip`);
  }

  async friendReply(trip, f, text) {
    if (f.status === 'replied') return;
    f.status = 'replied';
    const parsed = (await askJSON(`A friend replied to the final plan: "${text}". Return {"vote":"yes"|"no"|"maybe","request":"short request or empty"}.`, GENZ)) || parseFriendReplyOffline(text);
    f.vote = parsed.vote || 'yes'; f.request = parsed.request || ''; f.reply = text;
    this.emit('friend', { tripId: trip.id, friend: f });
    this.touch(trip);
    const emoji = { yes: '✅', no: '❌', maybe: '🤔' }[f.vote] || '✅';
    this.log(trip, `${emoji} ${f.name}: "${text.slice(0, 70)}"`, 'act');
    if (!f.simulated) this.send(f.key, f.vote === 'no' ? 'np, next time fr 💙' : `yayy 🙌 i'll book n send ur share`);
    this.send(trip.organizer, `${emoji} *${f.name}* ${f.vote === 'yes' ? "is in" : f.vote === 'no' ? 'is out' : 'is a maybe'}${f.request ? `, wants: ${f.request}` : ''}`);
    const going = trip.friends.filter(x => x.prefs?.in !== false);
    if (going.every(x => x.status === 'replied') && !trip.squadDone) { trip.squadDone = true; await this.squadDone(trip); }
  }

  async squadDone(trip) {
    const going = trip.friends.filter(f => f.vote !== 'no');
    const requests = trip.friends.filter(f => f.request).map(f => `${f.name}: ${f.request}`);
    trip.brief.groupSize = going.length + 1;
    let changes = [];
    if (requests.length) changes = await this.refine(trip, requests.join('; '), 'the friends');
    this.send(trip.organizer, `squad's locked 🔒 ${going.length + 1} of u going${changes.length ? `\nsmall tweaks: ${changes.join('; ')}` : ''}`);
    return this.toApproval(trip);
  }

  // ---------- APPROVAL / PAYMENT ----------
  toApproval(trip) {
    trip.stage = 'APPROVAL';
    const n = trip.brief.groupSize || trip.friends.filter(f => f.vote !== 'no').length + 1;
    trip.cart = buildCart(trip.chosen, n);
    this.touch(trip);
    const c = trip.cart;
    const lines = c.items.map(i => `${i.icon} ${i.title} · ${inr(i.amount)}`).join('\n');
    this.send(trip.organizer,
      `🧾 final damage for the ${this.what(trip)}:\n\n${lines}\n\n*${inr(c.total)} total* → ${inr(c.perPerson)}/head × ${n}${trip.chosen.foodPerPerson ? `\n(food ~${inr(trip.chosen.foodPerPerson)}/head is pay as u go)` : ''}\n\nsay the word n i'll book it all on ur card (xx4242), then collect everyone's share on UPI 💸`,
      [[{ label: '✅ book it', data: 'approve' }, { label: '✏️ tweak', data: 'tweak' }]]);
  }

  async onApproval(trip, text) {
    if (/^(approve|yes|book|go|confirm|ok|haan|done|book it)/i.test(text)) {
      const flags = await this.flagsFor(trip.organizer, 'organizer');
      if (!flags.autonomous_booking.enabled) {
        this.log(trip, '🛑 Flagsmith kill switch autonomous_booking = OFF → cart only', 'think');
        const list = trip.cart.items.map(i => `☐ ${i.icon} ${i.title} (${i.detail}) · ${inr(i.amount)}`).join('\n');
        return this.send(trip.organizer, `🛑 auto-booking is switched off by ur admin (Flagsmith kill switch), so i won't book myself.\nhere's ur ready-to-book list:\n\n${list}\n\n*${inr(trip.cart.total)}*. tap again once it's back on n i'll take over`, [[{ label: '🔁 try again', data: 'approve' }]]);
      }
      if (!flags.payments_enabled.enabled) {
        this.log(trip, '🛑 Flagsmith kill switch payments_enabled = OFF → checkout blocked', 'think');
        emitEvent('payment_blocked_by_kill_switch', { tripId: trip.id, amount: trip.cart.total });
        return this.send(trip.organizer, `🛑 payments are paused by ur admin (Flagsmith kill switch).\nno money moved, cart's saved (${inr(trip.cart.total)}). tap again once it's back on`, [[{ label: '🔁 try again', data: 'approve' }]]);
      }
      const limit = Number(flags.auto_book_limit.value) || Infinity;
      if (flags.auto_book_limit.enabled && trip.cart.total > limit) {
        trip.stage = 'GATE';
        this.touch(trip);
        this.log(trip, `🚩 Flagsmith auto_book_limit = ${inr(limit)} → ${inr(trip.cart.total)} needs sign-off`, 'think');
        const { wait } = requestApproval({ tripId: trip.id, amount: trip.cart.total, limit, destination: trip.brief.destination || trip.brief.city, items: trip.cart.items.length });
        this.log(trip, '🐝 NudgeBee approval workflow started', 'act');
        this.send(trip.organizer, `🐝 that's ${inr(trip.cart.total)}, above ur ${inr(limit)} auto-book limit (Flagsmith).\nopened an approval in NudgeBee. approve it there or sign off here:`, [[{ label: '✅ sign off', data: 'nb_approve' }, { label: '✋ hold', data: 'nb_reject' }]]);
        wait.then(r => r.approved ? this.startPayment(trip, r.by) : (trip.stage = 'APPROVAL', this.touch(trip), this.send(trip.organizer, `✋ checkout on hold (${r.by}). tweak or try again`)));
        return;
      }
      return this.startPayment(trip);
    }
    if (/^tweak$/i.test(text)) return this.send(trip.organizer, 'what should i change? ✏️');
    trip.stage = 'PLANNING';
    await this.refine(trip, text, 'organizer');
    return this.toApproval(trip);
  }

  onGate(trip, text) {
    const token = pendingApprovalFor(trip.id);
    if (/^(nb_approve|approve|sign off|yes)/i.test(text) && token) return void resolveApproval(token, true, 'organizer in chat');
    if (/^(nb_reject|hold|no)/i.test(text) && token) return void resolveApproval(token, false, 'organizer in chat');
    this.send(trip.organizer, 'waiting on the NudgeBee approval ⏳ or tap sign off', [[{ label: '✅ sign off', data: 'nb_approve' }]]);
  }

  startPayment(trip, approvedBy) {
    if (approvedBy) this.log(trip, `✅ approved by ${approvedBy}`, 'done');
    trip.payment = new PaymentSession(trip.cart, this.orgName(trip));
    trip.stage = 'OTP';
    this.touch(trip);
    this.log(trip, `💳 payment intent ${trip.payment.id} for ${inr(trip.cart.total)} (SANDBOX)`, 'act');
    emitEvent('payment_intent_created', { tripId: trip.id, amount: trip.cart.total });
    this.send(trip.organizer, `💳 charging ${inr(trip.cart.total)} on xx4242 for ${trip.cart.items.length} bookings in one go\nur bank just sent an otp, drop it here 🔐 (text or voice note)`);
    this.emit('sms', { to: trip.organizer, text: trip.payment.smsText() });
  }

  async onOtp(trip, text) {
    const code = text.replace(/\D/g, '');
    if (code.length !== 6) return this.send(trip.organizer, 'need the 6-digit otp from ur bank 🔐');
    const v = trip.payment.verify(code);
    if (!v.ok) {
      if (trip.payment.status === 'failed' || trip.payment.status === 'expired') { trip.stage = 'APPROVAL'; this.touch(trip); return this.send(trip.organizer, `❌ payment ${v.reason}. tap to retry`, [[{ label: '🔁 retry', data: 'approve' }]]); }
      return this.send(trip.organizer, `❌ ${v.reason}, ${v.remaining} tries left`);
    }
    trip.stage = 'BOOKING';
    this.touch(trip);
    this.log(trip, '✅ payment authorized, booking everything…', 'done');
    this.send(trip.organizer, 'payment went through ✅ booking everything rn 🚀');
    emitEvent('payment_authorized', { tripId: trip.id, amount: trip.cart.total });
    const flags = await this.flagsFor(trip.organizer, 'organizer');
    const drill = flags.booking_failure_drill.enabled;
    if (drill) this.log(trip, '🚩 Flagsmith booking_failure_drill ON → the stay provider will go down mid-booking', 'think');
    trip.confirmations = [];
    for (const item of trip.cart.items) {
      this.log(trip, `⏳ ${item.provider}: ${item.title}`, 'act');
      this.emit('booking', { tripId: trip.id, item, status: 'in_progress' });
      try {
        const res = await runBookingRunbook(item, (provider) => bookItem(item, provider, { delayMs: config.bookingDelayMs ?? 900, outage: drill && item.kind === 'stay' }), async (t, k) => this.log(trip, t, k));
        const conf = { ...item, provider: res.provider, ref: res.ref, status: 'confirmed' };
        trip.confirmations.push(conf);
        this.log(trip, `✅ ${conf.provider}: ${conf.title} → ${conf.ref}`, 'done');
        this.emit('booking', { tripId: trip.id, item: conf, status: 'confirmed' });
      } catch (e) {
        this.log(trip, `❌ ${item.title}: ${e.message}, escalated to NudgeBee`, 'act');
        emitEvent('booking_escalated', { tripId: trip.id, item: item.title });
        trip.confirmations.push({ ...item, status: 'failed', ref: 'PENDING' });
      }
    }
    emitEvent('trip_booked', { tripId: trip.id, confirmations: trip.confirmations.length });
    trip.stage = 'DONE';
    this.touch(trip);
    const conf = trip.confirmations.map(c => `${c.icon} ${c.title}\n   ref *${c.ref}*`).join('\n');
    this.send(trip.organizer, `🎉 DONE. ${this.what(trip)} is booked fr\n\n${conf}\n\npaid ${inr(trip.cart.total)}, sent everyone their share (${inr(trip.cart.perPerson)}) on UPI.\nu didn't have to be *that friend* today 😎`);
    const orgFlags = await this.flagsFor(trip.organizer, 'organizer');
    if (orgFlags.voice_notes.enabled) this.voice(trip.organizer, `done! your ${this.what(trip)} is booked. I paid ${trip.cart.total} rupees and sent everyone their share. you didn't have to be that friend today.`, this.users.get(trip.organizer)?.lang || 'en-IN');
    const orgName = this.orgName(trip);
    for (const f of trip.friends.filter(f => f.vote !== 'no' && f.key)) {
      this.send(f.key, `🎒 ur booked for the *${this.what(trip)}*!\n${trip.confirmations.slice(0, 2).map(c => `${c.icon} ${c.title} · ${c.ref}`).join('\n')}\n\nur share: *${inr(trip.cart.perPerson)}* → tap to pay ${orgName}:\n${upiCollectLink(orgName, trip.cart.perPerson, this.what(trip))}`);
      const ff = await this.flagsFor(f.key, 'friend');
      if (ff.voice_notes.enabled) {
        const line = `you're booked for the ${this.what(trip)}! your share is ${trip.cart.perPerson} rupees, I sent a UPI request from ${orgName}.`;
        const lang = f.lang || 'en-IN';
        this.voice(f.key, lang !== 'en-IN' && ff.friend_translation.enabled ? (await translate(line, lang)) || line : line, lang);
      }
    }
  }

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
    if (!t) return this.send(key, 'nothing planned rn, where we going? 🌍');
    this.send(key, `📋 ${this.what(t)} · stage: ${t.stage.toLowerCase()}\n👥 ${t.friends.map(f => `${f.name} ${f.vote === 'no' ? '❌' : f.prefs ? '✅' : '⏳'}`).join('  ')}\n🧠 brain: ${llmStatus.backend}`);
  }
}

function clean(o) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) r[k] = v;
  return r;
}
