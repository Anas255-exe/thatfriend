// Headless end-to-end run (offline planner unless LLM_MODE=auto is set).
process.env.LLM_MODE ||= 'offline';
const { config } = await import('../src/config.js');
config.bookingDelayMs = 10;
const { Engine } = await import('../src/engine.js');
const { setOverride } = await import('../src/flags.js');

const e = new Engine();
const ORG = 'web:organizer';
let otp = null;
const out = [], cards = [];
e.on('message', m => { if (!m.echo) out.push(m); });
e.on('cards', c => cards.push(c));
e.on('sms', s => { otp = s.text.match(/\d{6}/)[0]; });
e.on('log', l => console.log('   ·', l.text));
const say = async (key, text) => { console.log(`\n> ${key}: ${text}`); await e.handle(key, text, { channel: 'web', name: key === ORG ? 'Zoya' : undefined }); };
const last = (key) => out.filter(m => m.to === key).at(-1)?.text || '';
const assert = (c, msg) => { if (!c) { console.error('❌ FAIL:', msg); process.exit(1); } console.log('✔', msg); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ---- trip: ask everyone first, then merge ----
e.registerUser(ORG, 'Zoya', 'web', ORG);
await say(ORG, 'plan kashmir next weekend w Aman, Riya and Kabir, 15k each');
const t = e.tripOf(ORG);
assert(t.brief.destination?.toLowerCase().includes('kashmir'), 'destination = Kashmir');
assert(t.stage === 'PREFS', 'asks friends for their take BEFORE planning');
assert(/bet|squad/i.test(out.find(m => m.to === ORG)?.text || ''), 'gen z tone in organizer reply');
assert(/vibe/i.test(last('web:friend-aman')), 'Aman got a vibe-check DM');
await say('web:friend-aman', 'bro snow is a must, gondola type stuff. budget flexible');
await say('web:friend-riya', 'budget tight yaar, cute cafes and sunset photo spots pls, no touristy traps');
await say('web:friend-kabir', 'pure veg food and no early mornings, chill pace');
await wait(50);
assert(t.stage === 'PLANNING' && t.options.length === 2, 'merged 2 options after everyone replied');
assert(t.merge.length === 3 && t.merge.every(m => m.who && m.how), 'shows who wanted what → what i did');
assert(t.options[0].spots.some(s => /gulmarg|sonamarg|dal|pahalgam|nishat|pari|doodh/i.test(s.name)), 'real Kashmir spots in plan');
await wait(3000); // card enrichment (photos/maps)
assert(cards.length && cards[0].cards.every(c => c.links.some(l => /google\.com\/maps/.test(l.url))), 'place cards carry Google Maps links');
console.log('   photos on cards:', cards[0].cards.filter(c => c.photo).length, '/', cards[0].cards.length);
await say(ORG, 'pick:A');
assert(t.chosen?.id === 'A', 'option A locked');
await say(ORG, 'ask_squad');
assert(t.stage === 'FRIENDS', 'final 👍 sent to squad');
for (const f of ['aman', 'riya', 'kabir']) await say(`web:friend-${f}`, "i'm in");
await wait(50);
assert(t.stage === 'APPROVAL' && t.cart.total > 0, `cart ₹${t.cart?.total}`);

// ---- guardrails ----
setOverride('payments_enabled', { enabled: false });
await say(ORG, 'approve');
assert(t.stage === 'APPROVAL' && !otp && /paused/i.test(last(ORG)), 'kill switch payments_enabled=OFF blocks checkout');
setOverride('payments_enabled', null);
setOverride('auto_book_limit', { enabled: true, value: 10000 });
setOverride('booking_failure_drill', { enabled: true });
await say(ORG, 'approve');
assert(t.stage === 'GATE', 'NudgeBee approval gate');
await say(ORG, 'nb_approve'); await wait(50);
assert(t.stage === 'OTP' && otp, 'OTP requested');
await say(ORG, '000000');
assert(/wrong OTP/.test(last(ORG)), 'wrong OTP rejected');
await say(ORG, otp);
assert(t.stage === 'DONE' && t.confirmations.every(c => c.status === 'confirmed'), `${t.confirmations.length} bookings confirmed`);
assert(t.confirmations.find(c => c.kind === 'stay').provider.endsWith('-Alt'), 'runbook failed over the stay');
assert(/upi:\/\/pay/.test(last('web:friend-riya')), 'friends got UPI share');
setOverride('auto_book_limit', null); setOverride('booking_failure_drill', null);

// ---- meetup mode ----
const ORG2 = 'web:organizer2';
e.registerUser(ORG2, 'Ishaan', 'web', ORG2);
await say(ORG2, 'dinner + movie saturday w Dev and Sana in bangalore');
const m = e.tripOf(ORG2);
assert(m.brief.kind === 'meetup' && m.stage === 'PREFS', 'meetup detected, vibe check sent');
await say('web:friend-dev', 'something chill, cafe vibes, after 7pm');
await say('web:friend-sana', 'budget 800 max, no loud bars');
await wait(50);
assert(m.stage === 'PLANNING' && m.options[0].spots.length, `meetup plan: ${m.options[0].spots.map(s => s.name).join(' → ')}`);
console.log('\n✅ E2E PASSED');
process.exit(0);
