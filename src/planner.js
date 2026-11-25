// Planner: merges everyone's opinions into a plan using real, review-backed places.
// Live: Claude Code + WebSearch/WebFetch. Offline: curated real spots (src/curated.js).
import { askJSON } from './llm.js';
import { tripCatalog, meetupCatalog } from './curated.js';
import { enrichAll, toCard } from './places.js';

export const GENZ = `You are ThatFriend, an AI friend for Indian Gen Z friend groups that plans trips and meetups and books them.
Voice: text like a real 20-something Indian friend. Lowercase is fine, short lines, light Hinglish (yaar, bro, scene, vibe, fr, lowkey),
1-2 emojis max per message. Never sound corporate or like a travel brochure ("embark", "nestled", "curated experience",
"I'd be happy to" are banned). Be honest about trade-offs.`;

const TAGS = ['snow', 'adventure', 'chill', 'budget', 'food', 'veg', 'nonveg', 'party', 'photos', 'offbeat', 'nature', 'cafe', 'movie', 'luxury', 'shopping', 'roadtrip', 'social'];

// ---------- opinions ----------
export function parsePrefsOffline(text) {
  const t = (text || '').toLowerCase();
  const out = new Set();
  const map = {
    snow: /snow|ski|gondola|glacier|cold/, adventure: /adventure|trek|hike|paraglid|raft|thrill|safari/, chill: /chill|relax|lazy|slow|peace|calm|sleep/,
    budget: /budget|cheap|tight|broke|kam|paisa|save/, food: /food|eat|khana|foodie|wazwan|biryani|street/, veg: /\bveg\b|vegetarian|jain|pure veg/,
    party: /party|club|drink|beer|bar|night ?life/, photos: /photo|pic|insta|aesthetic|view|sunset|reel/, offbeat: /offbeat|less touristy|hidden|crowd/,
    nature: /nature|lake|green|meadow|valley|forest/, cafe: /cafe|café|coffee|chai/, movie: /movie|film|cinema/, luxury: /luxury|fancy|splurge|5 ?star/,
    shopping: /shop|market|thrift/, roadtrip: /road ?trip|drive/,
  };
  for (const [k, re] of Object.entries(map)) if (re.test(t)) out.add(k);
  const no = /(can'?t|cannot|not coming|count me out|skip|nahi aa|out this time)/.test(t);
  const hardNo = (t.match(/(?:no|not|hate|avoid|nahi)\s+([a-z ]{3,25})/) || [])[1] || '';
  return { in: !no, vibes: [...out], mustDo: [], hardNo: hardNo ? [hardNo.trim()] : [], budget: out.has('budget') ? 'tight' : 'ok', summary: text.slice(0, 140) };
}

export async function parsePrefs(name, text, brief) {
  const j = await askJSON(
    `${name} replied about the ${brief.kind === 'meetup' ? 'meetup' : 'trip'} to ${brief.destination || brief.city}: "${text}"\n` +
    `Return {"in":true|false,"vibes":[from ${JSON.stringify(TAGS)}],"mustDo":[short],"hardNo":[short],"budget":"tight"|"ok"|"flexible","summary":"<=12 words, gen z tone"}`, GENZ);
  return j && typeof j === 'object' ? { ...parsePrefsOffline(text), ...j } : parsePrefsOffline(text);
}

// ---------- research + merge ----------
function peopleBlock(trip, orgName) {
  const rows = [`${orgName} (organizer): ${(trip.brief.preferences || []).join(', ') || 'no specific asks'}`];
  for (const f of trip.friends) if (f.prefs && f.prefs.in !== false) rows.push(`${f.name}: "${f.prefsText}" → vibes ${f.prefs.vibes?.join('/') || '-'}; must-do ${f.prefs.mustDo?.join(', ') || '-'}; hard no ${f.prefs.hardNo?.join(', ') || '-'}; budget ${f.prefs.budget}`);
  return rows.join('\n');
}

const SPOT = `{"name":str,"area":str,"why":"<=18 words, what reviewers/locals rate it for","review":"<=14 words, paraphrase of a typical review","rating":"e.g. 4.6/5 (Google) or empty","costPerPerson":num,"source":"url of the page you used","website":"official url or empty","image":"direct image url from that page or empty"}`;

export async function researchOptions(trip, orgName, feedback = '') {
  const b = trip.brief;
  const meetup = b.kind === 'meetup';
  const prompt =
    `Plan for an Indian friend group. Use web search to check what people ACTUALLY recommend (Google/TripAdvisor reviews, Reddit threads, recent blogs). ` +
    `Only real places that exist and are open; prefer well-reviewed spots over generic tourist traps.\n\n` +
    `Brief: ${JSON.stringify(b)}\nWhat everyone said:\n${peopleBlock(trip, orgName)}\n${feedback ? `Organizer feedback: "${feedback}"\n` : ''}\n` +
    `Merge everyone's opinions into ONE best plan (option A) plus one alternative (option B). Respect hard no's. Option A MUST fit the per-person budget (trim or swap things, say so in merge). Every stay, café and restaurant must be ONE specific named property you found (e.g. "Hotel X, Area"), never a generic "houseboat or guesthouse". ` +
    `HARD RULES: (1) every stay/venue/café must be a SPECIFIC named property (e.g. "Hotel Grand Mumtaz, Srinagar"), never a generic "guesthouse or houseboat"; give its real rating. ` +
    `(2) option A must fit the per-person budget; get there with cheaper transport (train/bus), budget-but-well-reviewed stays, fewer paid activities. Option B can stretch. ` +
    `(3) "merge" has one row per friend who gave input (skip the organizer if they had no asks); "wanted" and "how" in casual gen z lowercase, e.g. {"who":"Kabir","wanted":"no 5am + veg food","how":"shikara at 9am, veg dhaba picks ✅"}. ` +
    `(4) "image": a direct .jpg/.png/.webp url of that exact place if you saw one, else "". ` +
    `Return JSON: {"merge":[{"who":name,"wanted":"<=8 words","how":"<=12 words"}],"options":[` +
    (meetup
      ? `{"id":"A","title":"<=5 words","vibe":"<=8 words gen z","when":"best day/time that works","spots":[3-4 ${SPOT}],"food":[1-2 ${SPOT}],"days":[{"day":1,"title":str,"items":[timeline strings]}]}`
      : `{"id":"A","title":"<=5 words","vibe":"<=8 words gen z","transport":{"mode":str,"detail":str,"costPerPerson":num},"stay":${SPOT.replace('"costPerPerson":num', '"costPerPerson":num (whole stay, per person, rooms shared by 2)')},"spots":[4-6 ${SPOT}],"food":[2-3 ${SPOT}],"localTravel":{"detail":str,"costPerPerson":num},"foodPerPerson":num,"days":[{"day":n,"title":str,"items":[str]}]}`) +
    `, {...option B same shape}]}. Prices realistic INR for ${b.when || 'the dates'}. Per-person budget ₹${b.budgetPerPerson || '?'}.`;
  const j = await askJSON(prompt, GENZ, { web: true });
  if (!j?.options?.length) return null;
  return { merge: Array.isArray(j.merge) ? j.merge : [], options: j.options.slice(0, 2).map((o, i) => normalizePlan(o, b, i)) };
}

export async function refinePlan(trip, feedback, who) {
  const j = await askJSON(
    `Current plan JSON: ${JSON.stringify(stripMedia(trip.chosen))}\nBrief: ${JSON.stringify(trip.brief)}\nFeedback from ${who}: "${feedback}"\n` +
    `Update the plan. If you add/swap places, use web search and only use real, well-reviewed places. ` +
    `Return {"plan":<same schema>,"changes":["<=10 words each, gen z tone"]}.`, GENZ, { web: true });
  if (!j?.plan) return null;
  const p = normalizePlan(j.plan, trip.brief, 0);
  p.id = trip.chosen.id;
  return { plan: p, changes: j.changes || [] };
}

// ---------- offline (curated, no internet) ----------
export function offlineOptions(trip, orgName) {
  const b = trip.brief;
  const want = new Set([...(b.preferences || []).flatMap(p => parsePrefsOffline(p).vibes), ...trip.friends.flatMap(f => f.prefs?.vibes || [])]);
  const tight = trip.friends.some(f => f.prefs?.budget === 'tight') || (b.budgetPerPerson && b.budgetPerPerson < 12000);
  const score = (x) => (x.tags || []).filter(t => want.has(t)).length;
  const merge = trip.friends.filter(f => f.prefs && f.prefs.in !== false).map(f => {
    const v = f.prefs.vibes?.[0];
    const how = v === 'budget' ? 'kept the budget stay + free spots' : v === 'veg' ? 'veg-friendly food picks' : v ? `added ${v} stuff` : 'kept it balanced';
    return { who: f.name, wanted: f.prefs.summary || f.prefs.vibes?.join(', ') || 'anything works', how };
  });
  if (b.kind === 'meetup') {
    const cat = meetupCatalog(b.city || b.destination);
    const v = [...cat.venues].sort((a, z) => score(z) - score(a));
    const a = [...cat.activities].sort((a, z) => score(z) - score(a));
    const mk = (id, title, vibe, picks) => normalizePlan({ id, title, vibe, when: b.when || 'saturday evening', spots: picks.map(s => ({ ...s, costPerPerson: s.cost })), food: [], days: [{ day: 1, title: b.when || 'the plan', items: picks.map((s, i) => `${['6:00 pm', '8:00 pm', '10:00 pm'][i] || ''} ${s.name}`.trim()) }] }, b, 0);
    return { merge, options: [mk('A', 'the squad special', 'something for everyone fr', [a[0], v[0]]), mk('B', 'low-key + cheap', 'broke but make it fun', [a.find(x => x.cost === 0) || a[1], v.find(x => (x.tags || []).includes('budget')) || v[1]])] };
  }
  const cat = tripCatalog(b.destination);
  if (!cat) return null;
  const nights = b.nights || 2;
  const places = [...cat.places].sort((a, z) => score(z) - score(a));
  const stays = [...cat.stays].sort((a, z) => (tight ? a.perNight - z.perNight : score(z) - score(a)));
  const build = (id, title, vibe, stay, tr, picks) => normalizePlan({
    id, title, vibe,
    transport: { mode: tr.mode, detail: `${b.origin || cat.origin} ⇄ ${cat.name} · ${tr.detail}`, costPerPerson: tr.cost },
    stay: { ...stay, costPerPerson: Math.round(stay.perNight * nights / 2) },
    spots: picks.map(p => ({ ...p, costPerPerson: p.cost })), food: cat.food,
    localTravel: { detail: 'shared cab for sightseeing days', costPerPerson: 1500 }, foodPerPerson: 900 * (nights + 1),
    days: Array.from({ length: nights + 1 }, (_, d) => ({ day: d + 1, title: d === 0 ? 'land + settle in' : d === nights ? 'last views + home' : `explore day ${d}`, items: picks.slice(d * 2, d * 2 + 2).map(p => p.name).concat(d === 0 ? [`check in at ${stay.name}`] : []) })),
  }, b, 0);
  const cheapTr = [...cat.transport].sort((a, z) => a.cost - z.cost)[0];
  return { merge, options: [
    build('A', 'the merged plan', 'everyone gets their thing', stays[0], tight ? cheapTr : cat.transport[0], places.slice(0, 5)),
    build('B', 'budget mode', 'same fun, less damage', [...cat.stays].sort((a, z) => a.perNight - z.perNight)[0], cheapTr, places.filter(p => p.cost <= 500).slice(0, 4).concat(places.slice(0, 1))),
  ] };
}

// ---------- shape ----------
const num = (v, d = 0) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
const spot = (s, kind) => s && s.name ? ({ name: String(s.name), area: s.area || '', why: s.why || '', review: s.review || '', rating: s.rating || '', costPerPerson: num(s.costPerPerson ?? s.cost), source: s.source || '', website: s.website || '', image: s.image || '', type: s.type || s.kind || '', kind }) : null;

export function normalizePlan(p, brief, i) {
  const meetup = brief.kind === 'meetup';
  const out = {
    id: ['A', 'B', 'C'][i] && p.id ? p.id : ['A', 'B', 'C'][i],
    kind: meetup ? 'meetup' : 'trip',
    title: p.title || (meetup ? 'the plan' : 'the trip'),
    vibe: p.vibe || '',
    when: p.when || brief.when || '',
    destination: brief.destination || brief.city || '',
    nights: meetup ? 0 : num(p.nights, brief.nights || 2),
    transport: !meetup && p.transport ? { mode: p.transport.mode || 'Travel', detail: p.transport.detail || '', costPerPerson: num(p.transport.costPerPerson) } : null,
    stay: !meetup ? spot(p.stay, 'stay') : null,
    spots: (p.spots || p.activities || []).map(s => spot(s, meetup ? 'venue' : 'place')).filter(Boolean).slice(0, 6),
    food: (p.food || []).map(s => spot(s, 'food')).filter(Boolean).slice(0, 3),
    localTravel: !meetup && p.localTravel ? { detail: p.localTravel.detail || '', costPerPerson: num(p.localTravel.costPerPerson) } : null,
    foodPerPerson: meetup ? 0 : num(p.foodPerPerson, 900 * ((brief.nights || 2) + 1)),
    days: Array.isArray(p.days) ? p.days.map((d, j) => ({ day: num(d.day, j + 1), title: d.title || `day ${j + 1}`, items: (d.items || []).map(String).slice(0, 6) })) : [],
    notes: p.notes || [],
  };
  if (out.stay) out.stay.nights = out.nights;
  out.totalPerPerson = totalOf(out);
  out.withinBudget = out.totalPerPerson <= (brief.budgetPerPerson || Infinity);
  return out;
}

export function totalOf(p) {
  return (p.transport?.costPerPerson || 0) + (p.stay?.costPerPerson || 0) + (p.localTravel?.costPerPerson || 0) + (p.foodPerPerson || 0) +
    (p.spots || []).reduce((s, x) => s + (x.costPerPerson || 0), 0);
}

function stripMedia(p) { return JSON.parse(JSON.stringify(p, (k, v) => (k === 'photo' || k === 'maps' ? undefined : v))); }

/** Enrich a plan's stay / spots / food with photos + maps, then build chat cards. */
export async function planCards(plan, max = 7) {
  const area = plan.destination;
  const items = [plan.stay, ...plan.spots, ...plan.food].filter(Boolean);
  await enrichAll(items, area);
  const label = (s) => s.kind === 'stay' ? '🏡' : s.kind === 'food' ? '🍜' : s.kind === 'venue' ? '📍' : '📸';
  return items.slice(0, max).map(s => toCard(s, label(s)));
}
