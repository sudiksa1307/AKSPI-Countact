require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const Stripe = require('stripe');
const store = require('./config/store');
const orders = require('./lib/orders');
const mcf = require('./lib/mcf');

const app = express();
const PORT = Number(process.env.PORT) || 4242;

let stripeClient = null;
function stripe() {
  if (!stripeClient && process.env.STRIPE_SECRET_KEY) {
    stripeClient = (Stripe.default || Stripe)(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ── Stripe webhook ─────────────────────────────────────────────
// Must be registered BEFORE express.json() so the raw body is kept
// for signature verification.
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe() || !secret) return res.status(503).send('Webhook not configured');

  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    console.warn('⚠️  Webhook signature verification failed:', String(err.message).split('\n')[0]);
    return res.status(400).send('Invalid signature');
  }

  try {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object;
      if (session.payment_status !== 'paid') {
        // e.g. delayed payment methods: wait for async_payment_succeeded
        await orders.markEventSeen(event.id);
        return res.json({ received: true, pending: true });
      }
      await fulfil(event.id, session.id);
    } else if (event.type === 'checkout.session.async_payment_failed') {
      console.log(`Payment failed for session ${event.data.object.id}`);
      await orders.markEventSeen(event.id);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err);
    res.status(500).send('Webhook handler error'); // Stripe will retry
  }
});

async function fulfil(eventId, sessionId) {
  if (orders.getOrderBySession(sessionId)) {
    await orders.markEventSeen(eventId);
    return; // already fulfilled — duplicate delivery or second event type
  }
  // Re-fetch from Stripe so we trust Stripe's record, not the event payload alone.
  const s = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
  if (s.payment_status !== 'paid') return;

  const item = s.line_items?.data?.[0];
  const qty = item?.quantity || Number(s.metadata?.quantity) || 0;
  const expectedSubtotal = (store.product.priceCents || 0) * qty;
  const priceMismatch = s.metadata?.product_id !== store.product.id || s.amount_subtotal !== expectedSubtotal;
  if (priceMismatch) {
    console.warn(`⚠️  Session ${s.id}: subtotal ${s.amount_subtotal} differs from expected ${expectedSubtotal}. Flagged for review.`);
  }

  const sd = s.collected_information?.shipping_details || s.shipping_details || null;
  const addr = sd?.address || null;
  const { created, order } = await orders.recordPaidOrder(eventId, {
    sessionId: s.id,
    paymentIntent: s.payment_intent,
    productId: s.metadata?.product_id,
    quantity: qty,
    currency: s.currency,
    subtotal: s.amount_subtotal,
    shipping: s.total_details?.amount_shipping ?? 0,
    tax: s.total_details?.amount_tax ?? 0,
    total: s.amount_total,
    email: s.customer_details?.email || null,
    shipTo: sd?.name || null,
    shippingAddress: addr
      ? { name: sd.name, line1: addr.line1, line2: addr.line2 || null, city: addr.city, state: addr.state, postalCode: addr.postal_code, country: addr.country }
      : null,
    phone: s.customer_details?.phone || null,
    fulfillment: { status: store.mcf.enabled ? 'pending' : 'manual', attempts: 0 },
    livemode: s.livemode,
    needsReview: priceMismatch,
  });
  if (created) {
    console.log(`✅ Order ${order.orderNumber} recorded for session ${s.id} (${qty} × dispenser)`);
    if (store.mcf.enabled) {
      // Don't block (or fail) the webhook: the order is already safely recorded,
      // and the background worker retries anything that doesn't go through.
      mcf.submit(order).catch((e) => console.error('MCF submit error:', e.message));
    } else {
      console.log(`   Amazon MCF is off — ship ${order.orderNumber} manually.`);
    }
  }
}

app.use(express.json({ limit: '10kb' }));

// ── Public config ──────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store').json(store.publicConfig());
});

// ── Create Checkout Session ────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const problems = store.checkoutProblems();
  if (problems.length) {
    return res.status(503).json({ error: 'Checkout requires configuration.', problems });
  }

  // Only the quantity comes from the browser. Price is always server-side.
  const qty = Number(req.body?.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > store.product.maxQuantity) {
    return res.status(400).json({ error: `Quantity must be a whole number from 1 to ${store.product.maxQuantity}.` });
  }
  if (req.body?.productId && req.body.productId !== store.product.id) {
    return res.status(400).json({ error: 'Unknown product.' });
  }

  const base = store.siteUrl();
  const { product, shipping, tax } = store;
  const lineItem = {
    quantity: qty,
    price_data: {
      currency: product.currency,
      unit_amount: product.priceCents,
      product_data: {
        name: product.name,
        description: 'Concept product — see site for prototype disclosure.',
        images: base.startsWith('https://') ? [base + product.image] : undefined,
      },
      ...(tax.mode === 'automatic' ? { tax_behavior: 'exclusive' } : {}),
    },
    ...(tax.mode === 'rate' ? { tax_rates: [tax.rateId] } : {}),
  };

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [lineItem],
      shipping_address_collection: { allowed_countries: shipping.allowedCountries },
      phone_number_collection: { enabled: true },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: shipping.label,
            fixed_amount: { amount: shipping.flatRateCents, currency: product.currency },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: shipping.minDays },
              maximum: { unit: 'business_day', value: shipping.maxDays },
            },
            ...(tax.mode === 'automatic' ? { tax_behavior: 'exclusive' } : {}),
          },
        },
      ],
      ...(tax.mode === 'automatic' ? { automatic_tax: { enabled: true } } : {}),
      metadata: { product_id: product.id, quantity: String(qty) },
      success_url: `${base}/order-confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/cart.html?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err.message);
    res.status(502).json({ error: 'Could not start checkout. ' + (err.raw?.message || err.message) });
  }
});

// ── Order status for the confirmation page ─────────────────────
// "paid" is returned ONLY after the verified webhook recorded the order.
app.get('/api/order', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = String(req.query.session_id || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ status: 'invalid' });

  const order = orders.getOrderBySession(id);
  if (order) {
    const { orderNumber, quantity, currency, subtotal, shipping, tax, total, email, createdAt, livemode } = order;
    const f = order.fulfillment || {};
    const maskedEmail = email ? email.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : null;
    return res.json({
      status: 'paid',
      order: { orderNumber, quantity, currency, subtotal, shipping, tax, total, email: maskedEmail, createdAt, livemode },
      fulfillment: { status: f.status || null, tracking: f.tracking || [] },
    });
  }
  if (!stripe()) return res.json({ status: 'unconfigured' });
  try {
    const s = await stripe().checkout.sessions.retrieve(id);
    if (s.status === 'expired') return res.json({ status: 'expired' });
    if (s.status === 'open') return res.json({ status: 'open' });
    // complete but webhook not yet received/verified
    return res.json({ status: s.payment_status === 'paid' ? 'confirming' : 'processing' });
  } catch {
    return res.status(404).json({ status: 'not_found' });
  }
});

// ── Admin: see orders + fulfillment state, retry a stuck order ─
// Protected by ADMIN_TOKEN (send as "Authorization: Bearer <token>"). Disabled if unset.
function adminOnly(req, res, next) {
  const t = store.mcf.adminToken;
  if (!t) return res.status(503).json({ error: 'Set ADMIN_TOKEN in .env to use the admin API.' });
  if (req.headers.authorization !== 'Bearer ' + t) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
app.get('/api/admin/orders', adminOnly, (req, res) => {
  res.json(
    orders.listOrders().map((o) => ({
      orderNumber: o.orderNumber, createdAt: o.createdAt, quantity: o.quantity, total: o.total,
      shipTo: o.shipTo, needsReview: o.needsReview, fulfillment: o.fulfillment,
    }))
  );
});
app.post('/api/admin/orders/:orderNumber/retry', adminOnly, async (req, res) => {
  const o = orders.getOrderByNumber(req.params.orderNumber);
  if (!o) return res.status(404).json({ error: 'No such order.' });
  if (!store.mcf.enabled) return res.status(400).json({ error: 'MCF_ENABLED is not true.' });
  await orders.updateOrder(o.sessionId, (cur) => ({ fulfillment: { ...(cur.fulfillment || {}), attempts: 0 } }));
  const ok = await mcf.submit(orders.getOrderBySession(o.sessionId));
  res.json({ ok, fulfillment: orders.getOrderBySession(o.sessionId).fulfillment });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

app.listen(PORT, () => {
  const problems = store.checkoutProblems();
  console.log(`Countact running at ${store.siteUrl()}  (Stripe ${store.isLiveMode() ? 'LIVE' : 'test'} mode)`);
  if (problems.length) {
    console.log('⚠️  Checkout is disabled until configured:');
    problems.forEach((p) => console.log('   • ' + p));
  }
  if (store.mcf.enabled) {
    const mp = store.mcfProblems();
    if (mp.length) {
      console.log('⚠️  Amazon MCF is enabled but not fully configured:');
      mp.forEach((p) => console.log('   • ' + p));
    } else {
      console.log(`Amazon MCF on (${store.mcf.sandbox ? 'sandbox' : 'live'}, region ${store.mcf.region}, SKU ${store.mcf.sellerSku})`);
    }
    mcf.startWorker();
  } else {
    console.log('Amazon MCF is off (MCF_ENABLED=false) — paid orders must be shipped manually.');
  }
});
