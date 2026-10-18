// ─────────────────────────────────────────────────────────────
// Countact store configuration — the ONE place pricing lives.
// Values come from environment variables (see .env.example).
// The browser never sends a price; the server always uses these.
// ─────────────────────────────────────────────────────────────

function int(name) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || String(v).trim() === '' ? fallback : String(v).trim();
}

const product = {
  id: 'countact-dispenser',
  name: 'Countact Dispenser',
  description:
    'Two-sided dispenser for sealed five-pack contact lens strips, with separate left and right counts.',
  // Selling price in the smallest currency unit (e.g. cents). REQUIRED to sell.
  priceCents: int('PRODUCT_PRICE_CENTS'),
  currency: str('CURRENCY', 'usd').toLowerCase(),
  maxQuantity: int('MAX_QUANTITY_PER_ORDER') || 5,
  image: '/assets/img/dispenser-exterior.png',
};

const shipping = {
  // Flat shipping rate in cents. "0" is valid (free shipping). Unset = not configured.
  flatRateCents: int('SHIPPING_FLAT_RATE_CENTS'),
  label: str('SHIPPING_LABEL', 'Standard shipping'),
  minDays: int('SHIPPING_MIN_DAYS') || 5,
  maxDays: int('SHIPPING_MAX_DAYS') || 8,
  allowedCountries: str('SHIPPING_COUNTRIES', 'US')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
};

// TAX_MODE:
//   automatic – Stripe Tax calculates tax from the shipping address (Stripe Tax must be enabled)
//   rate      – apply a Stripe Tax Rate you created (STRIPE_TAX_RATE_ID)
//   none      – explicitly no tax collected (you are responsible for this decision)
const tax = {
  mode: str('TAX_MODE', '').toLowerCase(),
  rateId: str('STRIPE_TAX_RATE_ID'),
  // Display-only percentage for the "rate" mode summary (e.g. 8.25). Stripe applies the real rate.
  displayPercent: process.env.TAX_DISPLAY_PERCENT ? Number(process.env.TAX_DISPLAY_PERCENT) : null,
};

const links = {
  // Where the app's "Reorder contacts" button sends people. Separate from buying the dispenser.
  reorderContactsUrl: str('REORDER_CONTACTS_URL'),
};

// ── Amazon Multi-Channel Fulfillment (MCF) ───────────────────
// After a verified payment, the order's shipping details are sent to Amazon
// (Selling Partner API → Fulfillment Outbound) so Amazon ships it from FBA stock.
const mcf = {
  enabled: str('MCF_ENABLED', 'false').toLowerCase() === 'true',
  sellerSku: str('MCF_SELLER_SKU'),
  region: str('MCF_REGION', 'na').toLowerCase(), // na | eu | fe
  sandbox: str('MCF_SANDBOX', 'false').toLowerCase() === 'true',
  shippingSpeed: str('MCF_SHIPPING_SPEED', 'Standard'), // Standard | Expedited | Priority
  fulfillmentPolicy: str('MCF_FULFILLMENT_POLICY', 'FillOrKill'), // FillOrKill | FillAll | FillAllAvailable
  orderComment: str('MCF_ORDER_COMMENT', 'Thank you for your order!'),
  clientId: str('SPAPI_LWA_CLIENT_ID'),
  clientSecret: str('SPAPI_LWA_CLIENT_SECRET'),
  refreshToken: str('SPAPI_REFRESH_TOKEN'),
  maxAttempts: int('MCF_MAX_ATTEMPTS') || 8,
  retryMinutes: int('MCF_RETRY_MINUTES') || 5,
  adminToken: str('ADMIN_TOKEN'),
  // Test hooks (point at a local mock instead of Amazon)
  apiBaseOverride: str('MCF_API_BASE'),
  lwaUrlOverride: str('MCF_LWA_URL'),
};

function mcfProblems() {
  const p = [];
  if (!mcf.sellerSku) p.push('MCF_SELLER_SKU is not set (the SKU of this product in your Amazon FBA inventory).');
  if (!mcf.clientId) p.push('SPAPI_LWA_CLIENT_ID is not set.');
  if (!mcf.clientSecret) p.push('SPAPI_LWA_CLIENT_SECRET is not set.');
  if (!mcf.refreshToken) p.push('SPAPI_REFRESH_TOKEN is not set.');
  if (!['na', 'eu', 'fe'].includes(mcf.region)) p.push('MCF_REGION must be na, eu or fe.');
  if (!['Standard', 'Expedited', 'Priority'].includes(mcf.shippingSpeed))
    p.push('MCF_SHIPPING_SPEED must be Standard, Expedited or Priority.');
  return p;
}

function siteUrl() {
  return str('SITE_URL', `http://localhost:${process.env.PORT || 4242}`).replace(/\/$/, '');
}

// Returns a list of human-readable problems. Empty list = checkout can run.
function checkoutProblems() {
  const p = [];
  const sk = str('STRIPE_SECRET_KEY');
  if (!sk) p.push('STRIPE_SECRET_KEY is not set.');
  else if (!/^(sk|rk)_(test|live)_/.test(sk)) p.push('STRIPE_SECRET_KEY does not look like a Stripe key.');
  if (!str('STRIPE_WEBHOOK_SECRET')) p.push('STRIPE_WEBHOOK_SECRET is not set (needed to confirm payments).');
  if (product.priceCents === null || product.priceCents < 50)
    p.push('PRODUCT_PRICE_CENTS is not set (selling price).');
  if (shipping.flatRateCents === null) p.push('SHIPPING_FLAT_RATE_CENTS is not set.');
  if (!['automatic', 'rate', 'none'].includes(tax.mode))
    p.push('TAX_MODE must be "automatic", "rate" or "none".');
  if (tax.mode === 'rate' && !tax.rateId) p.push('TAX_MODE=rate requires STRIPE_TAX_RATE_ID.');
  return p;
}

function isLiveMode() {
  return str('STRIPE_SECRET_KEY').includes('_live_');
}

// Safe-to-share subset for the browser.
function publicConfig() {
  const problems = checkoutProblems();
  return {
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      currency: product.currency,
      maxQuantity: product.maxQuantity,
      image: product.image,
    },
    shipping: {
      configured: shipping.flatRateCents !== null,
      flatRateCents: shipping.flatRateCents,
      label: shipping.label,
      minDays: shipping.minDays,
      maxDays: shipping.maxDays,
      countries: shipping.allowedCountries,
    },
    tax: { mode: tax.mode || null, displayPercent: tax.displayPercent },
    links: { reorderContactsUrl: links.reorderContactsUrl || null },
    checkout: {
      ready: problems.length === 0,
      problems,
      mode: isLiveMode() ? 'live' : 'test',
    },
  };
}

module.exports = { product, shipping, tax, links, mcf, mcfProblems, siteUrl, checkoutProblems, publicConfig, isLiveMode };
