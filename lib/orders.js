// Minimal file-backed order store. Good for local testing and small deployments;
// swap for a real database before production volume.
// Guarantees: one order per Stripe Checkout Session, and each webhook event
// is processed at most once, even if Stripe retries delivery.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'orders.json');

let state = null;
let chain = Promise.resolve(); // serialize writes within this process

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = { orders: {}, processedEvents: {} };
  }
  state.orders ||= {};
  state.processedEvents ||= {};
  return state;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE); // atomic replace
}

function withLock(fn) {
  const run = chain.then(() => fn(load()));
  chain = run.catch(() => {});
  return run;
}

function getOrderBySession(sessionId) {
  return load().orders[sessionId] || null;
}

// Records a paid order exactly once. Returns { created, order }.
function recordPaidOrder(eventId, order) {
  return withLock((s) => {
    if (s.processedEvents[eventId]) {
      return { created: false, duplicateEvent: true, order: s.orders[order.sessionId] || null };
    }
    s.processedEvents[eventId] = new Date().toISOString();
    if (s.orders[order.sessionId]) {
      persist();
      return { created: false, order: s.orders[order.sessionId] };
    }
    const n = Object.keys(s.orders).length + 1;
    const record = { ...order, orderNumber: 'CT-' + String(1000 + n), createdAt: new Date().toISOString() };
    s.orders[order.sessionId] = record;
    persist();
    return { created: true, order: record };
  });
}

// Merge fields into an existing order (used for fulfillment status/tracking).
function updateOrder(sessionId, patch) {
  return withLock((s) => {
    const o = s.orders[sessionId];
    if (!o) return null;
    Object.assign(o, typeof patch === 'function' ? patch(o) : patch);
    persist();
    return o;
  });
}

function listOrders() {
  return Object.values(load().orders);
}

function getOrderByNumber(orderNumber) {
  return listOrders().find((o) => o.orderNumber === orderNumber) || null;
}

function markEventSeen(eventId) {
  return withLock((s) => {
    if (s.processedEvents[eventId]) return false;
    s.processedEvents[eventId] = new Date().toISOString();
    persist();
    return true;
  });
}

module.exports = { getOrderBySession, getOrderByNumber, listOrders, updateOrder, recordPaidOrder, markEventSeen };
