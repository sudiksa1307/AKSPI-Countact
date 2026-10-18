# Countact website & store

Marketing site, interactive app demo and Stripe Checkout store for the Countact dispenser.
Node.js + Express server, plain HTML/CSS/JS front end (no build step).

```
countact/
├─ server.js                 Express server: config API, Stripe Checkout, webhook, order status
├─ config/store.js           ★ Central price / shipping / tax / links config (reads .env)
├─ lib/orders.js             File-backed order store with duplicate protection
├─ .env.example              All settings, documented
└─ public/
   ├─ index.html             Home: hero, demo video, Meet Countact, How it works, gallery, Explore the App, specs, FAQ
   ├─ shop.html              Product page: gallery, description, features, price, quantity, Add to Cart, Buy Now
   ├─ cart.html              Cart: edit quantity, remove, subtotal, shipping, tax, total
   ├─ checkout.html          Order review before payment → Stripe Checkout
   ├─ order-confirmation.html  Shown ONLY after the verified webhook records payment
   ├─ js/site.js             Header/footer, cart, lightbox, summary helpers
   ├─ js/app-demo.js         Interactive app demo (simulated device data)
   ├─ js/shop.js             Product page logic
   ├─ css/styles.css         Mint / teal / white theme, responsive
   └─ assets/
      ├─ img/                Images cropped from the supplied concept sheet (PNG + WebP, native resolution)
      ├─ video/              60-second demo video (MP4, streaming-optimised) + poster frame
      └─ logo/               Eye logo, green and white variants (placeholder — see below)
```

## 1. Run the site

Requires Node.js 18 or newer.

```bash
cd countact
npm install
cp .env.example .env
npm start
```

Open http://localhost:4242. With an empty `.env` the whole site works, and the shop, cart and
checkout pages show **"Checkout requires configuration"** with the list of missing settings.
The Pay button stays disabled — there is no fake success path.

## 2. Configure Stripe test mode

1. Create or sign in to a Stripe account and stay in **Test mode** (toggle in the Dashboard).
2. Developers → API keys → copy the **Secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY`.
3. Set the selling price, shipping and tax in `.env`, e.g.:

   ```
   PRODUCT_PRICE_CENTS=4000         # $40.00 — the only place the price is set
   SHIPPING_FLAT_RATE_CENTS=0       # free shipping (e.g. 500 = $5.00 flat rate)
   SHIPPING_COUNTRIES=US
   TAX_MODE=none                    # simplest for a first local test
   ```

   Tax options:
   - `TAX_MODE=automatic` — Stripe Tax computes tax from the shipping address. Enable Stripe Tax and
     add your tax registrations in the Dashboard first, or session creation will fail.
   - `TAX_MODE=rate` — create a Tax Rate in Stripe (Product catalog → Tax rates) and set
     `STRIPE_TAX_RATE_ID=txr_…`. Optionally `TAX_DISPLAY_PERCENT` to show it on the cart.
   - `TAX_MODE=none` — no tax collected. Only use this if it is correct for your business.

4. Optional: `REORDER_CONTACTS_URL=https://your-lens-retailer.example` for the app's
   **Reorder contacts** button.

## 3. Receive webhooks locally (required to confirm orders)

Install the Stripe CLI (https://docs.stripe.com/stripe-cli), then in a second terminal:

```bash
stripe login
stripe listen --forward-to localhost:4242/api/webhook
```

Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` in `.env`, then restart `npm start`.
Leave `stripe listen` running while you test.

## 4. Test a purchase

1. Go to http://localhost:4242/shop, pick a quantity, click **Add to Cart** (or **Buy Now**).
2. In the cart, change quantity / remove, then **Checkout** → review page → **Continue to secure payment**.
3. On Stripe's page use card `4242 4242 4242 4242`, any future expiry, any CVC, any US address.
4. You return to the confirmation page. It shows "Confirming your payment…" until the signed
   `checkout.session.completed` webhook arrives, then the order number and totals.
5. The server log prints `✅ Order CT-1001 recorded…`; orders are saved in `data/orders.json`.

Other cards to try: `4000 0000 0000 9995` (declined), `4000 0025 0000 3155` (3-D Secure).
Click **Back** on Stripe's page to test the cancelled flow (cart stays intact).

To check duplicate protection, run `stripe events resend <evt_id>` — the server acknowledges
it but does not create a second order.

## Amazon fulfillment (MCF) — automatic shipping

Customers can only buy on this site, so paid orders are sent straight to Amazon Multi-Channel
Fulfillment, which picks, packs and ships from your FBA inventory. No Shopify or third-party app needed.

**How it works:** Stripe confirms payment (verified webhook) → the order is saved with the shipping
address → the server calls Amazon's Selling Partner API `createFulfillmentOrder` → every few minutes it
checks Amazon for status and tracking numbers (shown on the confirmation page).
If Amazon is down or rejects an order, it is retried automatically, then flagged `needs_attention`.
Orders are never sent twice (the order number is Amazon's fulfillment ID, and Amazon is checked first).

**One-time setup**
1. Seller Central → Inventory: make sure the Countact SKU exists and has **FBA stock** (MCF ships FBA inventory).
2. Seller Central → Apps & Services → Develop Apps: register a **private** app with the **Amazon Fulfillment** role.
3. Authorize the app for your own seller account to get the **refresh token** (self-authorization).
4. Put the SKU and the three SPAPI_* credentials in `.env`, set `MCF_ENABLED=true`, keep `MCF_SANDBOX=true`
   while testing, then restart. Switch to `MCF_SANDBOX=false` for real orders.

**Checking on orders** (set `ADMIN_TOKEN` first):
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" localhost:4242/api/admin/orders
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" localhost:4242/api/admin/orders/CT-1001/retry
```
Fulfillment states: `pending` → `submitted` → `shipped`, or `retrying` / `needs_attention` / `manual` (MCF off).

**Heads-up:** MCF fees are charged to your seller account per order; Amazon's sandbox returns canned
data, so do a small real order before launch. Shipping addresses are stored in `data/orders.json`
(plain file) — move to a database and protect it before real volume.

## How payment safety works

- The browser sends only a quantity. The server validates it (whole number, 1 – `MAX_QUANTITY_PER_ORDER`)
  and builds the Stripe line item from `config/store.js`, so a tampered price is ignored.
- Card details are entered only on Stripe Checkout; this site never sees them.
- The webhook verifies Stripe's signature on the raw request body, then re-fetches the session from
  Stripe before recording the order. It also cross-checks the subtotal against the configured price
  and flags mismatches (e.g. if the price changed mid-checkout) with `needsReview: true`.
- Each event ID and each Checkout Session is processed once; retries and duplicate events are no-ops.
- `/api/order` returns `paid` only for sessions the webhook recorded. Emails are masked in its response.
- Secrets live only in `.env` (git-ignored). Stripe Checkout shows shipping, tax and the final total
  before the customer pays; the cart and review pages show subtotal and shipping, plus tax when it can
  be known in advance.

## Going live

Switch to live keys (`sk_live_…`), set `SITE_URL` to your https domain, and add a webhook endpoint in
Dashboard → Developers → Webhooks pointing to `https://your-domain/api/webhook` with events
`checkout.session.completed`, `checkout.session.async_payment_succeeded` and
`checkout.session.async_payment_failed`. Use that endpoint's signing secret. Replace the JSON order
store with a database if you'll run multiple server instances.

## Content notes

- **Demo video**: `assets/video/countact-demo.mp4` is the supplied 60-second video, unchanged except
  for moving its index to the start of the file so it begins playing before fully downloading. It
  appears in the "See it in action" section, with links from the hero, the nav, the footer and the shop
  page. It doesn't autoplay because it has sound. To replace it, overwrite the file with the same name.

- **Images** were cropped at native resolution from the supplied concept sheet
  (`assets/img/countact-overview.png` is the full sheet). Nothing is upscaled.
- **Logo**: no logo file was supplied, so `assets/logo/` holds a simple eye mark in green and white.
  Replace those two SVGs (same file names) with the official Countact logo.
- **App screens**: only one app screenshot was supplied (the counter, used in Meet Countact and the
  gallery). The nine app states in **Explore the App** are a live, interactive demo styled to match it.
  If you have real screenshots, add them to `assets/img/` and to the gallery in `index.html`.
- All dimensions and mechanism details are presented as concept specifications, with the prototype
  disclosure on the home page, shop page and footer. No compatibility or certification claims are made.
