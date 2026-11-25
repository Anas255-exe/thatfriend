// SANDBOX booking + payment rail. No real money moves, no real card data is ever accepted.
// Swap these providers for real APIs (IRCTC/redBus/MakeMyTrip/Razorpay) after the hackathon.
import crypto from 'node:crypto';

const rid = (p, n = 6) => p + crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, n);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function buildCart(plan, groupSize) {
  const n = groupSize || 2;
  const rooms = Math.ceil(n / 2);
  const items = [
    { kind: 'transport', icon: '🚌', provider: providerFor(plan.transport.mode), title: plan.transport.mode, detail: plan.transport.detail, qty: n, unit: plan.transport.costPerPerson },
    { kind: 'stay', icon: '🏡', provider: 'StaySandbox', title: plan.stay.name, detail: `${rooms} room(s) × ${plan.stay.nights} night(s) · ${plan.stay.type}`, qty: n, unit: plan.stay.costPerPerson },
    { kind: 'local', icon: '🚕', provider: 'CabSandbox', title: 'Local travel', detail: plan.localTravel.detail, qty: n, unit: plan.localTravel.costPerPerson },
    ...plan.activities.filter(a => a.costPerPerson > 0).map(a => ({ kind: 'activity', icon: '🎟️', provider: 'TicketsSandbox', title: a.name, detail: `${n} tickets`, qty: n, unit: a.costPerPerson })),
  ];
  for (const it of items) it.amount = it.qty * it.unit;
  const total = items.reduce((s, i) => s + i.amount, 0);
  return { items, total, perPerson: Math.round(total / n), currency: 'INR' };
}

function providerFor(mode) {
  if (/flight/i.test(mode)) return 'FlightsSandbox';
  if (/train/i.test(mode)) return 'RailSandbox';
  if (/bus|volvo/i.test(mode)) return 'BusSandbox';
  return 'RentalsSandbox';
}

export class PaymentSession {
  constructor(cart, payerName) {
    this.id = rid('PAY_', 10);
    this.cart = cart;
    this.payer = payerName;
    this.otp = String(crypto.randomInt(100000, 999999));
    this.attempts = 0;
    this.status = 'awaiting_otp';
    this.createdAt = Date.now();
  }
  smsText() {
    return `[SANDBOX BANK] ${this.otp} is your OTP for ₹${this.cart.total.toLocaleString('en-IN')} at ThatFriend Travel. Valid 5 min. Do not share. (Card xx4242 — test card)`;
  }
  verify(code) {
    this.attempts++;
    if (this.status !== 'awaiting_otp') return { ok: false, reason: 'not awaiting OTP' };
    if (Date.now() - this.createdAt > 5 * 60_000) { this.status = 'expired'; return { ok: false, reason: 'OTP expired' }; }
    if (String(code).trim() === this.otp) { this.status = 'authorized'; return { ok: true }; }
    if (this.attempts >= 3) { this.status = 'failed'; return { ok: false, reason: 'too many attempts' }; }
    return { ok: false, reason: 'wrong OTP', remaining: 3 - this.attempts };
  }
}

/** Book one item with one provider (sandbox). `outage` makes that provider fail, for the self-healing drill. */
export async function bookItem(item, provider, { delayMs = 900, outage = false } = {}) {
  await sleep(delayMs);
  if (outage && !provider.endsWith('-Alt')) throw new Error('503 provider unavailable');
  const ref = item.kind === 'transport' ? rid('PNR', 6) : item.kind === 'stay' ? rid('HTL-', 7) : rid('TKT-', 6);
  return { ref };
}

/** Book every cart item one after another, reporting progress. */
export async function executeBookings(cart, onProgress, { delayMs = 900 } = {}) {
  const confirmations = [];
  for (const item of cart.items) {
    await onProgress({ type: 'booking', item, status: 'in_progress' });
    await sleep(delayMs);
    const conf = {
      ...item,
      status: 'confirmed',
      ref: item.kind === 'transport' ? rid('PNR', 6) : item.kind === 'stay' ? rid('HTL-', 7) : rid('TKT-', 6),
    };
    confirmations.push(conf);
    await onProgress({ type: 'booking', item: conf, status: 'confirmed' });
  }
  return confirmations;
}

export function upiCollectLink(payee, amount, note) {
  // Mock UPI collect link (sandbox VPA). Real build: Razorpay/UPI intent.
  return `upi://pay?pa=thatfriend.sandbox@upi&pn=${encodeURIComponent(payee)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
}
