// Place cards: everything a user needs to judge a spot without leaving the chat.
// Google Maps link (no API key needed) + a photo (the page's own image if research found one,
// otherwise Wikipedia's lead image for well-known places).

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const UA = { 'user-agent': 'ThatFriend/0.2 (hackathon demo; contact via GitHub)' };
// Disk cache so photos found once survive restarts (venue Wi-Fi + Wikipedia can be slow).
const CACHE_FILE = path.join(ROOT, 'data', 'place-cache.json');
const cache = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))); } catch { return []; } })());
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache), null, 1)); } catch {}
  }, 500);
}

export const mapsUrl = (name, area = '') =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, area].filter(Boolean).join(', '))}`;

async function isImage(url) {
  if (!/^https?:\/\//.test(url || '')) return false;
  try {
    const r = await fetch(url, { method: 'HEAD', headers: UA, redirect: 'follow', signal: AbortSignal.timeout(9000) });
    return r.ok && /^image\//.test(r.headers.get('content-type') || '');
  } catch { return false; }
}

/** Pull og:image from a page (hotel / café website found by research). */
async function ogImage(pageUrl) {
  if (!/^https?:\/\//.test(pageUrl || '')) return null;
  try {
    const r = await fetch(pageUrl, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 300_000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
              html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return null;
    const img = new URL(m[1], pageUrl).href;
    return (await isImage(img)) ? img : null;
  } catch { return null; }
}

/** Wikipedia lead image + one-line summary for famous places (Gulmarg, Dal Lake, Pykara Falls…). */
async function wikipedia(name, area) {
  // 1) direct page lookup by title (cheap, not rate-limited like search)
  const direct = await summary(name.replace(/\s+/g, ' ').trim());
  if (direct) return direct;
  // 2) search fallback
  for (const query of [name, `${name} ${area || ''}`.trim()]) {
    const r = await wikipediaOnce(name, query);
    if (r) return r;
    if (!area) break;
  }
  return null;
}

async function summary(title) {
  try {
    const t = title.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1)).join('_');
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}?redirect=true`, { headers: UA, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const sum = await r.json();
    if (sum.type === 'disambiguation' || !(sum?.thumbnail?.source || sum?.originalimage?.source)) return null;
    return { photo: sum.thumbnail?.source || sum.originalimage?.source, blurb: sum.extract ? sum.extract.split('. ')[0] + '.' : null, wiki: sum.content_urls?.desktop?.page || null };
  } catch { return null; }
}

async function wikipediaOnce(name, query) {
  try {
    const q = encodeURIComponent(query);
    const s = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json&origin=*`, { headers: UA, signal: AbortSignal.timeout(9000) }).then(r => r.json());
    const GEN = /^(falls|lake|park|temple|fort|garden|gardens|beach|hill|hills|peak|point|valley|market|road|view|cafe|resort|hotel|trek|river|island|national|museum|palace|boating|ride|tour|with|from)$/;
    const first = name.toLowerCase().split(/\W+/).find(w => w.length >= 3 && !GEN.test(w));
    const title = (s?.query?.search || []).map(x => x.title).find(t => first && t.toLowerCase().includes(first) && !/^list of/i.test(t));
    if (!title) return null;
    const sum = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: UA, signal: AbortSignal.timeout(9000) }).then(r => r.json());
    return { photo: sum?.thumbnail?.source || sum?.originalimage?.source || null, blurb: sum?.extract ? sum.extract.split('. ')[0] + '.' : null, wiki: sum?.content_urls?.desktop?.page || null };
  } catch { return null; }
}

/**
 * Enrich one spot in place: adds maps, photo (when we can find a real one), blurb.
 * spot = { name, area?, why?, review?, rating?, source?, website?, image?, kind }
 */
export async function enrich(spot, area) {
  if (!spot?.name) return spot;
  const k = `${spot.name}|${area}`;
  if (cache.has(k)) return Object.assign(spot, cache.get(k));
  const extra = { maps: mapsUrl(spot.name, spot.area || area) };
  if (spot.image && await isImage(spot.image)) extra.photo = spot.image;
  if (!extra.photo && spot.website) extra.photo = await ogImage(spot.website);
  if (!extra.photo && spot.source && !/tripadvisor|booking\.com|makemytrip|google\./i.test(spot.source)) extra.photo = await ogImage(spot.source);
  if (!extra.photo || !spot.why) {
    // Try the place name, its cleaned-up variants, then its area ("Betaab Valley", "Pahalgam"...).
    const base = spot.name.replace(/\(.*?\)/g, ' ');
    // Stays / food / venues: only their own photo (never a generic area pic that looks like the property).
    const candidates = ['stay', 'food', 'venue'].includes(spot.kind)
      ? []
      : [spot.name, base.split(/[\/,+]| - /)[0], ...(spot.name.match(/\(([^)]+)\)/)?.[1].split(/[\/,]/) || []),
         base.replace(/\b(ride|tour|visit|trip|day|walk|activities|snow|skiing|trek|area|phase \d|\d)\b/gi, ' '),
         base.split(/\s+/).slice(0, 2).join(' '), spot.area?.split(',')[0]];
    for (const c of [...new Set(candidates.map(x => (x || '').replace(/\s+/g, ' ').trim()).filter(x => x.length > 3))]) {
      const w = await wikipedia(c, area);
      if (w?.photo) {
        if (!extra.photo) extra.photo = w.photo;
        if (w.blurb && !spot.why) extra.why = w.blurb;
        if (w.wiki && !spot.source) extra.source = w.wiki;
        break;
      }
    }
  }
  cache.set(k, extra);
  persist();
  return Object.assign(spot, extra);
}

/** Enrich with small concurrency and an overall time budget; every spot always gets a Maps link. */
export async function enrichAll(spots, area, budgetMs = 20000) {
  const list = spots.filter(Boolean);
  for (const s of list) s.maps ||= mapsUrl(s.name, s.area || area);
  const queue = [...list];
  const worker = async () => { while (queue.length) { const s = queue.shift(); await enrich(s, area).catch(() => s); } };
  await Promise.race([Promise.all([worker(), worker(), worker()]), new Promise(r => setTimeout(r, budgetMs))]);
  return list;
}

/** Turn a spot into a chat card (rendered by Telegram + the web demo). */
export function toCard(spot, label) {
  const lines = [];
  if (spot.why) lines.push(spot.why);
  if (spot.review) lines.push(`💬 "${spot.review}"`);
  const meta = [spot.rating ? `⭐ ${spot.rating}` : '', spot.costPerPerson ? `₹${Math.round(spot.costPerPerson).toLocaleString('en-IN')}/person` : '', spot.when || ''].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  const links = [{ label: '📍 Maps', url: spot.maps }];
  if (spot.website) links.push({ label: '🌐 Website', url: spot.website });
  else if (spot.source) links.push({ label: '🔎 Reviews', url: spot.source });
  return { title: `${label ? label + ' ' : ''}${spot.name}`, text: lines.join('\n'), photo: spot.photo || null, links };
}
