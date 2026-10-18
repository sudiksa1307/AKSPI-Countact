// Amazon Multi-Channel Fulfillment (MCF) via the Selling Partner API.
// Flow: paid order → createFulfillmentOrder (Amazon ships from FBA stock)
//       → periodically getFulfillmentOrder to pull status + tracking.
//
// Safe to retry: the order number is used as Amazon's sellerFulfillmentOrderId,
// and we check whether Amazon already has the order before creating it.

const store = require('../config/store');
const orders = require('./orders');

const HOSTS = {
  na: 'sellingpartnerapi-na.amazon.com',
  eu: 'sellingpartnerapi-eu.amazon.com',
  fe: 'sellingpartnerapi-fe.amazon.com',
};

function apiBase() {
  const { mcf } = store;
  if (mcf.apiBaseOverride) return mcf.apiBaseOverride.replace(/\/$/, '');
  const host = HOSTS[mcf.region] || HOSTS.na;
  return 'https://' + (mcf.sandbox ? 'sandbox.' : '') + host;
}

// ── Login with Amazon access token (cached) ───────────────────
let token = { value: null, expiresAt: 0 };
async function accessToken() {
  if (token.value && Date.now() < token.expiresAt - 60_000) return token.value;
  const { mcf } = store;
  const res = await fetch(mcf.lwaUrlOverride || 'https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: mcf.refreshToken,
      client_id: mcf.clientId,
      client_secret: mcf.clientSecret,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Amazon login failed (${res.status}): ${data.error_description || data.error || 'unknown'}`);
  }
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

async function spapi(method, path, body) {
  const res = await fetch(apiBase() + path, {
    method,
    headers: {
      'x-amz-access-token': await accessToken(),
      'Content-Type': 'application/json',
      'User-Agent': 'countact-site/1.0 (Language=JavaScript)',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) token = { value: null, expiresAt: 0 };
  return { status: res.status, ok: res.ok, data };
}

function errText(r) {
  const e = r.data?.errors?.[0];
  return `HTTP ${r.status}${e ? ` ${e.code}: ${e.message}` : ''}`;
}

// ── Build the Amazon request from our order ───────────────────
function buildFulfillmentOrder(order) {
  const a = order.shippingAddress;
  if (!a || !a.line1 || !a.city || !a.postalCode || !a.country || !a.name) {
    throw new Error('Order has no complete shipping address.');
  }
  return {
    sellerFulfillmentOrderId: order.orderNumber,
    displayableOrderId: order.orderNumber,
    displayableOrderDate: order.createdAt,
    displayableOrderComment: store.mcf.orderComment,
    shippingSpeedCategory: store.mcf.shippingSpeed,
    fulfillmentPolicy: store.mcf.fulfillmentPolicy,
    destinationAddress: {
      name: a.name,
      addressLine1: a.line1,
      ...(a.line2 ? { addressLine2: a.line2 } : {}),
      city: a.city,
      stateOrRegion: a.state || '',
      postalCode: a.postalCode,
      countryCode: a.country,
      ...(order.phone ? { phone: order.phone } : {}),
    },
    items: [
      {
        sellerSku: store.mcf.sellerSku,
        sellerFulfillmentOrderItemId: order.orderNumber + '-1',
        quantity: order.quantity,
      },
    ],
    ...(order.email ? { notificationEmails: [order.email] } : {}),
  };
}

function extractTracking(payload) {
  const out = [];
  for (const sh of payload?.fulfillmentShipments || []) {
    for (const pkg of sh.fulfillmentShipmentPackage || []) {
      if (pkg.trackingNumber) out.push({ carrier: pkg.carrierCode || null, trackingNumber: pkg.trackingNumber });
    }
  }
  return out;
}

const fid = (order) => encodeURIComponent(order.orderNumber);

// ── Submit one order to Amazon (idempotent) ───────────────────
async function submit(order) {
  const now = () => new Date().toISOString();
  const { mcf } = store;
  const f = order.fulfillment || {};
  const attempts = (f.attempts || 0) + 1;

  try {
    const problems = store.mcfProblems();
    if (problems.length) throw new Error('MCF not configured: ' + problems.join(' '));

    // Already at Amazon (e.g. our earlier call timed out after Amazon accepted it)?
    const existing = await spapi('GET', `/fba/outbound/2020-07-01/fulfillmentOrders/${fid(order)}`);
    if (!existing.ok) {
      const req = buildFulfillmentOrder(order);
      const created = await spapi('POST', '/fba/outbound/2020-07-01/fulfillmentOrders', req);
      if (!created.ok) throw new Error('Amazon rejected the order: ' + errText(created));
    }
    await orders.updateOrder(order.sessionId, {
      fulfillment: { ...f, status: 'submitted', attempts, submittedAt: f.submittedAt || now(), lastError: null, lastTriedAt: now() },
    });
    console.log(`📦 ${order.orderNumber} sent to Amazon MCF`);
    return true;
  } catch (err) {
    const gaveUp = attempts >= mcf.maxAttempts;
    await orders.updateOrder(order.sessionId, {
      fulfillment: { ...f, status: gaveUp ? 'needs_attention' : 'retrying', attempts, lastError: String(err.message).slice(0, 500), lastTriedAt: now() },
    });
    console.error(`❌ ${order.orderNumber} MCF attempt ${attempts}/${mcf.maxAttempts} failed: ${err.message}`);
    return false;
  }
}

// ── Pull status + tracking for submitted orders ───────────────
async function syncStatus(order) {
  const r = await spapi('GET', `/fba/outbound/2020-07-01/fulfillmentOrders/${fid(order)}`);
  if (!r.ok) return false;
  const fo = r.data?.payload?.fulfillmentOrder || {};
  const tracking = extractTracking(r.data?.payload);
  const amazonStatus = fo.fulfillmentOrderStatus || null; // RECEIVED, PLANNING, PROCESSING, COMPLETE, CANCELLED, UNFULFILLABLE, INVALID...
  const f = order.fulfillment || {};
  const terminalBad = ['CANCELLED', 'UNFULFILLABLE', 'INVALID'].includes(amazonStatus);
  await orders.updateOrder(order.sessionId, {
    fulfillment: {
      ...f,
      amazonStatus,
      tracking,
      status: amazonStatus === 'COMPLETE' ? 'shipped' : terminalBad ? 'needs_attention' : f.status,
      lastError: terminalBad ? `Amazon status ${amazonStatus}` : f.lastError || null,
      syncedAt: new Date().toISOString(),
    },
  });
  return true;
}

// One pass: submit anything pending/retrying that is due, sync everything in flight.
async function runOnce() {
  if (!store.mcf.enabled) return;
  const dueMs = store.mcf.retryMinutes * 60_000;
  for (const o of orders.listOrders()) {
    const f = o.fulfillment || {};
    if (f.status === 'pending') await submit(o);
    else if (f.status === 'retrying' && Date.now() - Date.parse(f.lastTriedAt || 0) >= dueMs) await submit(o);
    else if (f.status === 'submitted') await syncStatus(o).catch((e) => console.error('MCF sync error:', e.message));
  }
}

let timer = null;
function startWorker() {
  if (!store.mcf.enabled || timer) return;
  const every = Math.max(1, store.mcf.retryMinutes) * 60_000;
  timer = setInterval(() => runOnce().catch((e) => console.error('MCF worker error:', e.message)), every);
  timer.unref();
  setTimeout(() => runOnce().catch(() => {}), 5_000).unref(); // catch up after a restart
}

module.exports = { submit, syncStatus, runOnce, startWorker, buildFulfillmentOrder, extractTracking };
