// Offline planner: deterministic, believable plans so the demo works with zero network / no login.
const CATALOG = {
  ooty: {
    name: 'Ooty', region: 'Nilgiris, Tamil Nadu',
    transport: [
      { mode: 'Overnight Volvo sleeper bus', op: 'KSRTC Airavat Club Class', cost: 1400 },
      { mode: 'Train + Nilgiri toy train', op: 'Mysuru Exp → Mettupalayam, then NMR toy train', cost: 1100 },
      { mode: 'Self-drive SUV (split)', op: 'Zoomcar XUV700', cost: 2600 },
    ],
    stays: [
      { name: 'Fernhills Pine Cottages', type: 'Cottage w/ bonfire', perNight: 1500 },
      { name: 'Sterling Fern Hill', type: 'Resort', perNight: 2600 },
      { name: 'Zostel Ooty', type: 'Hostel private room', perNight: 750 },
    ],
    activities: [
      { name: 'Nilgiri Mountain Railway (Ooty → Coonoor)', cost: 350 },
      { name: 'Pykara Lake boating + falls', cost: 450 },
      { name: 'Doddabetta Peak sunrise trip', cost: 300 },
      { name: 'Avalanche Lake jeep safari', cost: 900 },
      { name: 'Tea Factory & chocolate tour', cost: 250 },
      { name: 'Botanical Garden + Rose Garden', cost: 150 },
    ],
    local: { detail: 'Innova with driver, 2 days', cost: 1200 },
  },
  goa: {
    name: 'Goa', region: 'North Goa',
    transport: [
      { mode: 'Flight', op: 'IndiGo 6E-xxx return', cost: 6200 },
      { mode: 'Overnight train', op: 'Vasco Express 3AC', cost: 1800 },
      { mode: 'Sleeper bus', op: 'Paulo Travels', cost: 2200 },
    ],
    stays: [
      { name: 'Vagator Bay Villa', type: 'Private pool villa', perNight: 2400 },
      { name: 'Anjuna Beach Resort', type: 'Resort', perNight: 1800 },
      { name: 'The Hosteller Anjuna', type: 'Hostel private room', perNight: 900 },
    ],
    activities: [
      { name: 'Grande Island snorkeling trip', cost: 1500 },
      { name: 'Sunset cruise on the Mandovi', cost: 700 },
      { name: 'Scooter rentals (2 days)', cost: 500 },
      { name: 'Fort Aguada + Chapora fort trail', cost: 200 },
      { name: 'Saturday Night Market, Arpora', cost: 0 },
    ],
    local: { detail: 'Scooters + 1 airport cab', cost: 900 },
  },
  manali: {
    name: 'Manali', region: 'Himachal Pradesh',
    transport: [
      { mode: 'Flight + cab', op: 'Delhi → Bhuntar + cab', cost: 7800 },
      { mode: 'Volvo from Delhi', op: 'HRTC Himsuta', cost: 1700 },
      { mode: 'Self-drive', op: 'Rental SUV from Delhi', cost: 3500 },
    ],
    stays: [
      { name: 'Old Manali Riverside Cottage', type: 'Cottage', perNight: 1800 },
      { name: 'Span Resort', type: 'Resort', perNight: 3200 },
      { name: 'Zostel Manali', type: 'Hostel private room', perNight: 800 },
    ],
    activities: [
      { name: 'Solang Valley paragliding', cost: 2500 },
      { name: 'Atal Tunnel + Sissu day trip', cost: 900 },
      { name: 'Jogini Falls trek', cost: 0 },
      { name: 'Beas river rafting', cost: 800 },
      { name: 'Hadimba Temple + Mall Road', cost: 0 },
    ],
    local: { detail: 'Tempo traveller with driver', cost: 1500 },
  },
  coorg: {
    name: 'Coorg', region: 'Kodagu, Karnataka',
    transport: [
      { mode: 'Self-drive (split)', op: 'Zoomcar Creta', cost: 1800 },
      { mode: 'KSRTC Rajahamsa', op: 'Bengaluru → Madikeri', cost: 800 },
      { mode: 'Private cab (split)', op: 'Savaari Innova', cost: 2400 },
    ],
    stays: [
      { name: 'Coffee Estate Homestay', type: 'Plantation homestay', perNight: 1700 },
      { name: 'Club Mahindra Madikeri', type: 'Resort', perNight: 3000 },
      { name: 'Hilltop Backpackers', type: 'Hostel private room', perNight: 700 },
    ],
    activities: [
      { name: 'Coffee plantation walk', cost: 400 },
      { name: 'Barapole river rafting', cost: 1200 },
      { name: 'Abbey Falls + Raja\'s Seat sunset', cost: 100 },
      { name: 'Dubare elephant camp', cost: 600 },
      { name: 'Tadiandamol trek', cost: 300 },
    ],
    local: { detail: 'Jeep for estate roads', cost: 900 },
  },
};

const GENERIC = (dest) => ({
  name: dest, region: '',
  transport: [
    { mode: 'Train (3AC)', op: 'Best available express', cost: 1600 },
    { mode: 'Flight', op: 'Cheapest return fare', cost: 6000 },
    { mode: 'Sleeper bus', op: 'Top-rated operator', cost: 1300 },
  ],
  stays: [
    { name: `${dest} Boutique Stay`, type: 'Boutique hotel', perNight: 1800 },
    { name: `${dest} Grand Resort`, type: 'Resort', perNight: 3000 },
    { name: `Backpackers ${dest}`, type: 'Hostel private room', perNight: 800 },
  ],
  activities: [
    { name: `${dest} heritage walk`, cost: 300 },
    { name: `Sunset point + local food crawl`, cost: 600 },
    { name: `Day excursion around ${dest}`, cost: 1200 },
    { name: `Adventure activity of the day`, cost: 1500 },
  ],
  local: { detail: 'Cab with driver', cost: 1200 },
});

export function catalogFor(dest = '') {
  const key = dest.toLowerCase().replace(/[^a-z]/g, '');
  if (key.includes('ooty') || key.includes('uti') || key.includes('udhagamandalam') || key.includes('ooti')) return CATALOG.ooty;
  for (const k of Object.keys(CATALOG)) if (key.includes(k)) return CATALOG[k];
  return GENERIC(dest ? dest[0].toUpperCase() + dest.slice(1) : 'Your destination');
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function extractBriefOffline(text, prev = {}) {
  const t = text.toLowerCase();
  const brief = { ...prev };
  const destMatch = text.match(/\b(ooty|uti|ooti|goa|manali|coorg|jaipur|pondicherry|gokarna|kerala|rishikesh|kashmir|srinagar|gulmarg|ladakh|leh|udaipur|varanasi|darjeeling|meghalaya|spiti|kasol|mussoorie|munnar|hampi|andaman)\b/i) ||
    text.match(/\b(?:to|visit)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/);
  if (destMatch) {
    const d = destMatch[1];
    brief.destination = /^(uti|ooti)$/i.test(d) ? 'Ooty' : d[0].toUpperCase() + d.slice(1);
  }
  const money = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|l|lakh)?\s*(?:rs|inr|₹)?\s*(per\s*(?:person|head|pp)|\/\s*person|each|pp|total|overall)?/);
  const allMoney = [...t.matchAll(/(?:₹|rs\.?\s*|inr\s*)?(\d[\d,]*)\s*(k|thousand|lakh|l)?\b\s*(per\s*(?:person|head)|each|pp|\/person|total|overall)?/g)]
    .map(m => {
      let v = Number(m[1].replace(/,/g, ''));
      if (m[2] === 'k' || m[2] === 'thousand') v *= 1000;
      if (m[2] === 'lakh' || m[2] === 'l') v *= 100000;
      return { v, scope: m[3] || '' };
    }).filter(x => x.v >= 2000);
  if (allMoney.length) {
    const m = allMoney[0];
    if (/total|overall/.test(m.scope) || /total|overall/.test(t)) brief.totalBudget = m.v; else brief.budgetPerPerson = m.v;
  }
  void money;
  const ppl = t.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:of us|people|persons|friends|pax|guys|members)/);
  if (ppl) brief.groupSize = Number(ppl[1]) || NUM_WORDS[ppl[1]];
  const with_ = text.match(/\b(?:with|w)\s+([A-Z][a-z]+(?:\s*(?:,|\band\b|&|\bn\b)\s*[A-Z][a-z]+)*)/);
  if (with_) {
    brief.friends = with_[1].split(/\s*(?:,|\band\b|&|\bn\b)\s*/).filter(Boolean);
    brief.groupSize = Math.max(brief.groupSize || 0, brief.friends.length + 1);
  }
  const nights = t.match(/(\d+|two|three|four|five)\s*(?:nights?|n\b)/);
  const days = t.match(/(\d+|two|three|four|five)\s*days?/);
  if (nights) brief.nights = Number(nights[1]) || NUM_WORDS[nights[1]];
  else if (days) brief.nights = Math.max(1, (Number(days[1]) || NUM_WORDS[days[1]]) - 1);
  if (/weekend/.test(t)) { brief.nights = brief.nights || 2; brief.when = /next weekend/.test(t) ? 'next weekend' : 'this weekend'; }
  const from = text.match(/\bfrom\s+([A-Z][a-zA-Z]+)/);
  if (from) brief.origin = from[1];
  if (brief.totalBudget && brief.groupSize && !brief.budgetPerPerson) brief.budgetPerPerson = Math.round(brief.totalBudget / brief.groupSize);
  return brief;
}

export function planOptionsOffline(brief) {
  const cat = catalogFor(brief.destination);
  const nights = brief.nights || 2;
  const budget = brief.budgetPerPerson || 15000;
  const shapes = [
    { id: 'A', title: 'Cozy & Chill', vibe: 'Slow mornings, bonfire nights, scenic rides', t: 1, s: 0, acts: [0, 1, 4, 5] },
    { id: 'B', title: 'Max Adventure', vibe: 'Early starts, sunrise peaks, jeep safaris', t: 2, s: 0, acts: [2, 3, 1, 0] },
    { id: 'C', title: 'Budget Smart', vibe: 'Same fun, lighter on the wallet', t: 0, s: 2, acts: [0, 5, 2] },
  ];
  return shapes.map(sh => buildPlan(cat, brief, sh, nights, budget));
}

function buildPlan(cat, brief, sh, nights, budget) {
  const tr = cat.transport[sh.t % cat.transport.length];
  const st = cat.stays[sh.s % cat.stays.length];
  const acts = sh.acts.map(i => cat.activities[i % cat.activities.length]).filter((a, i, arr) => arr.indexOf(a) === i);
  const sharing = 2; // rooms shared by 2
  const stayPP = Math.round((st.perNight * nights) / sharing * 2 / 2);
  const foodPP = 900 * (nights + 1);
  const days = [];
  for (let d = 0; d <= nights; d++) {
    const items = [];
    if (d === 0) items.push(`Arrive via ${tr.mode.toLowerCase()}, check in at ${st.name}`);
    const a1 = acts[(d * 2) % acts.length], a2 = acts[(d * 2 + 1) % acts.length];
    if (d < nights || nights === 0) { items.push(a1.name); if (a2 !== a1) items.push(a2.name); }
    if (d === nights) items.push(`Check out, head back by ${tr.mode.toLowerCase()}`);
    else items.push(d === 0 ? 'Dinner + bonfire at the stay' : 'Local food crawl in the evening');
    days.push({ day: d + 1, title: d === 0 ? 'Arrive & settle' : d === nights ? 'Last views & home' : `Explore ${cat.name}`, items });
  }
  const plan = {
    id: sh.id, title: sh.title, vibe: sh.vibe, destination: cat.name, nights,
    transport: { mode: tr.mode, detail: `${brief.origin || 'Bengaluru'} ⇄ ${cat.name} · ${tr.op}`, costPerPerson: tr.cost },
    stay: { name: st.name, type: st.type, nights, costPerPerson: stayPP },
    activities: acts.map(a => ({ name: a.name, costPerPerson: a.cost })),
    localTravel: { detail: cat.local.detail, costPerPerson: cat.local.cost },
    foodPerPerson: foodPP,
    days,
  };
  plan.totalPerPerson = totalOf(plan);
  plan.withinBudget = plan.totalPerPerson <= budget;
  return plan;
}

export function totalOf(p) {
  return (p.transport?.costPerPerson || 0) + (p.stay?.costPerPerson || 0) + (p.localTravel?.costPerPerson || 0) +
    (p.foodPerPerson || 0) + (p.activities || []).reduce((s, a) => s + (a.costPerPerson || 0), 0);
}

export function refineOffline(plan, feedback, brief) {
  const cat = catalogFor(plan.destination);
  const p = structuredClone(plan);
  const f = feedback.toLowerCase();
  const notes = [];
  if (/cheap|budget|less money|reduce|lower/.test(f)) {
    const s = cat.stays[2]; p.stay = { ...p.stay, name: s.name, type: s.type, costPerPerson: Math.round(s.perNight * p.nights / 2) };
    notes.push(`swapped stay to ${s.name} to save money`);
  }
  if (/luxur|nicer|better stay|resort|upgrade/.test(f)) {
    const s = cat.stays[1]; p.stay = { ...p.stay, name: s.name, type: s.type, costPerPerson: Math.round(s.perNight * p.nights / 2) };
    notes.push(`upgraded stay to ${s.name}`);
  }
  if (/toy train|train/.test(f) && !p.activities.some(a => /railway|toy train/i.test(a.name))) {
    const a = cat.activities.find(x => /railway|train/i.test(x.name)); if (a) { p.activities.push({ name: a.name, costPerPerson: a.cost }); notes.push(`added ${a.name}`); }
  }
  if (/trek|hike|adventure/.test(f)) {
    const a = cat.activities.find(x => /trek|safari|paraglid|raft|peak/i.test(x.name) && !p.activities.some(y => y.name === x.name));
    if (a) { p.activities.push({ name: a.name, costPerPerson: a.cost }); notes.push(`added ${a.name}`); }
  }
  if (/veg|vegetarian|jain/.test(f)) notes.push('noted: vegetarian-friendly stay & restaurants');
  if (/less driving|no long drive|relax|chill/.test(f)) {
    const drop = p.activities.findIndex(a => /safari|excursion|day trip/i.test(a.name));
    if (drop >= 0) notes.push(`dropped ${p.activities.splice(drop, 1)[0].name} to keep it relaxed`);
  }
  if (!notes.length) notes.push(`noted: "${feedback.slice(0, 80)}"`);
  p.notes = [...(p.notes || []), ...notes];
  p.totalPerPerson = totalOf(p);
  p.withinBudget = p.totalPerPerson <= (brief.budgetPerPerson || Infinity);
  return { plan: p, changes: notes };
}

const PERSONAS = [
  { vibe: 'enthusiastic', lines: ['Bro YES 🔥 count me in!', "Finally someone's planning! I'm in 🙌"], extra: ['Can we add a sunrise point?', ''] },
  { vibe: 'budget-conscious', lines: ["I'm in, but can we keep it under budget?", 'Works for me if it stays within budget 🙏'], extra: ['cheaper stay is fine by me'] },
  { vibe: 'foodie', lines: ['Sounds good! Make sure we hit good local food 😋', "I'm in — veg-friendly places please!"], extra: ['vegetarian options please'] },
  { vibe: 'chill', lines: ["I'm in, just don't make me wake up at 5am 😴", 'Okay but less driving pls'], extra: ['less driving'] },
];

export function friendReplyOffline(name, idx) {
  const p = PERSONAS[idx % PERSONAS.length];
  const line = p.lines[(name.length) % p.lines.length];
  return { text: line, vote: 'yes', request: p.extra[0] || '' };
}

export function parseFriendReplyOffline(text) {
  const t = text.toLowerCase();
  const no = /\b(no|can't|cannot|not coming|skip|out|nope|busy)\b/.test(t) && !/\b(in|yes)\b/.test(t);
  const maybe = /\b(maybe|not sure|depends|might)\b/.test(t);
  let request = (t.match(/(?:but|can we|make sure|could we)\s+(.*)/) || [])[1] || '';
  if (!request) {
    const rest = t.replace(/\b(yes|yeah|yep|i'?m in|in|count me in|sure|ok|okay|bro|haan|maybe|not sure)\b[!,.\s]*/g, ' ').replace(/[^\w\s'-]/g, ' ').trim();
    if (rest.split(/\s+/).length >= 2) request = rest;
  }
  return { vote: no ? 'no' : maybe ? 'maybe' : 'yes', request: request.slice(0, 120) };
}
