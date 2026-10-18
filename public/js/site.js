// Shared site behaviour: header/footer, config, cart, money, lightbox, toast.
(function () {
  const C = (window.Countact = window.Countact || {});

  // ── Safe storage (falls back to memory if blocked) ───────────
  const mem = {};
  C.store = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); }
      catch { return k in mem ? mem[k] : fallback; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem[k] = v; } },
    remove(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
  };

  // ── Config (single source: server /api/config) ───────────────
  let cfgPromise = null;
  C.config = function () {
    if (!cfgPromise) {
      cfgPromise = fetch('/api/config', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
        .catch(() => ({
          offline: true,
          product: { id: 'countact-dispenser', name: 'Countact Dispenser', priceCents: null, currency: 'usd', maxQuantity: 5, image: '/assets/img/dispenser-exterior.png' },
          shipping: { configured: false }, tax: { mode: null }, links: { reorderContactsUrl: null },
          checkout: { ready: false, problems: ['The store server is not reachable. Start it with "npm start".'], mode: 'test' },
        }));
    }
    return cfgPromise;
  };

  C.money = function (cents, currency) {
    if (cents === null || cents === undefined) return '—';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100); }
    catch { return '$' + (cents / 100).toFixed(2); }
  };

  // ── Cart (single product; quantity only — never a price) ─────
  const CART_KEY = 'countact.cart.v1';
  C.cart = {
    get() { const c = C.store.get(CART_KEY, null); return c && Number.isInteger(c.qty) && c.qty > 0 ? c : { productId: 'countact-dispenser', qty: 0 }; },
    setQty(qty, max) {
      const q = Math.max(0, Math.min(max || 99, Math.floor(Number(qty) || 0)));
      if (q === 0) C.store.remove(CART_KEY); else C.store.set(CART_KEY, { productId: 'countact-dispenser', qty: q });
      C.updateCartBadge();
      return q;
    },
    add(qty, max) { return this.setQty(this.get().qty + qty, max); },
    clear() { C.store.remove(CART_KEY); C.updateCartBadge(); },
  };
  C.updateCartBadge = function () {
    const n = C.cart.get().qty;
    document.querySelectorAll('.cart-count').forEach((el) => { el.textContent = n; el.hidden = n === 0; });
    document.querySelectorAll('.cart-link').forEach((el) => el.setAttribute('aria-label', `Cart, ${n} item${n === 1 ? '' : 's'}`));
  };

  // ── Order summary (display only; the server and Stripe compute the real charge) ─
  C.summaryHTML = function (cfg, qty) {
    const p = cfg.product, cur = p.currency;
    const sub = p.priceCents ? p.priceCents * qty : null;
    const ship = cfg.shipping.configured ? cfg.shipping.flatRateCents : null;
    let taxLabel = 'Tax', taxVal, taxNote = '', total = null;
    const mode = cfg.tax.mode;
    if (mode === 'none') { taxVal = C.money(0, cur); if (sub !== null && ship !== null) total = sub + ship; }
    else if (mode === 'rate' && cfg.tax.displayPercent && sub !== null) {
      const t = Math.round(sub * cfg.tax.displayPercent / 100);
      taxLabel = `Tax (${cfg.tax.displayPercent}%)`; taxVal = C.money(t, cur);
      if (ship !== null) total = sub + ship + t;
    } else if (mode === 'automatic' || mode === 'rate') {
      taxVal = 'At payment'; taxNote = 'Sales tax is calculated from your shipping address on the secure Stripe page and shown there, with the final total, before you pay.';
    } else { taxVal = 'Not configured'; }
    const totalLabel = total !== null ? 'Total' : 'Total before tax';
    const totalVal = total !== null ? C.money(total, cur) : sub !== null && ship !== null ? C.money(sub + ship, cur) : '—';
    return `
      <dl>
        <dt>Countact Dispenser × ${qty}</dt><dd>${sub !== null ? C.money(sub, cur) : 'Price not set'}</dd>
        <dt>${cfg.shipping.configured ? (cfg.shipping.label || 'Shipping') : 'Shipping'}</dt><dd>${ship === null ? 'Not configured' : ship === 0 ? 'Free' : C.money(ship, cur)}</dd>
        <dt>${taxLabel}</dt><dd>${taxVal}</dd>
        <dt class="total">${totalLabel}</dt><dd class="total">${totalVal}</dd>
      </dl>
      ${taxNote ? `<p class="small muted">${taxNote}</p>` : ''}`;
  };

  C.configNoticeHTML = function (cfg) {
    if (cfg.checkout.ready) {
      return cfg.checkout.mode === 'test'
        ? '<div class="notice notice-info small"><strong>Stripe test mode</strong> — no real charges. Test card: 4242 4242 4242 4242, any future date, any CVC.</div>'
        : '';
    }
    return `<div class="notice notice-warn small"><strong>Checkout requires configuration.</strong> Payment is disabled until setup is complete:<ul>${cfg.checkout.problems.map((x) => `<li>${String(x).replace(/</g, '&lt;')}</li>`).join('')}</ul></div>`;
  };

  // Starts Stripe Checkout. Only quantity is sent; the server sets the price.
  C.startCheckout = async function (qty, btn, source) {
    C.store.set('countact.checkoutSource', source || 'cart');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Opening secure checkout…';
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'countact-dispenser', quantity: qty }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) throw new Error((data.error || 'Checkout could not start.') + (data.problems ? ' ' + data.problems.join(' ') : ''));
      location.assign(data.url);
    } catch (err) {
      btn.disabled = false; btn.textContent = label;
      C.toast(String(err.message).replace(/</g, '&lt;'), 6000);
    }
  };

  // ── Header / footer ──────────────────────────────────────────
  const page = document.body.dataset.page || '';
  const cartSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>';
  const header = document.getElementById('site-header');
  if (header) {
    const cur = (p) => (page === p ? ' aria-current="page"' : '');
    header.className = 'site-header';
    header.innerHTML = `
      <div class="container nav">
        <a class="brand" href="/" aria-label="Countact home"><img src="/assets/logo/countact-eye-green.svg" alt="" width="36" height="36"><span>Countact</span></a>
        <button class="menu-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <ul class="nav-links" id="nav-links">
          <li><a href="/#demo">Watch demo</a></li>
          <li><a href="/#meet"${cur('meet')}>Meet Countact</a></li>
          <li><a href="/#how">How it works</a></li>
          <li><a href="/#app">Explore the App</a></li>
          <li><a href="/shop"${cur('shop')}>Shop</a></li>
        </ul>
        <div class="nav-actions">
          <a class="cart-link" href="/cart"${cur('cart')}>${cartSvg}<span class="cart-count" hidden>0</span></a>
          <a class="btn btn-primary" href="/shop">Buy<span class="label-long">Countact</span></a>
        </div>
      </div>`;
    const t = header.querySelector('.menu-toggle');
    const links = header.querySelector('.nav-links');
    t.addEventListener('click', () => { const o = links.classList.toggle('open'); t.setAttribute('aria-expanded', o); });
    links.addEventListener('click', (e) => { if (e.target.closest('a')) { links.classList.remove('open'); t.setAttribute('aria-expanded', 'false'); } });
  }
  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand"><img src="/assets/logo/countact-eye-white.svg" alt="" width="34" height="34">Countact</div>
            <p>A two-sided dispenser for sealed five-pack contact lens strips, with a separate count for each eye.</p>
            <a class="btn btn-primary" href="/shop">Buy Countact</a>
          </div>
          <div><h4>Product</h4><ul>
            <li><a href="/#demo">Watch the demo</a></li><li><a href="/#meet">Meet Countact</a></li><li><a href="/#how">How it works</a></li>
            <li><a href="/#app">Explore the App</a></li><li><a href="/#specs">Concept specifications</a></li></ul></div>
          <div><h4>Store</h4><ul>
            <li><a href="/shop">Shop</a></li><li><a href="/cart">Cart</a></li>
            <li><a href="/#faq">Questions</a></li></ul></div>
        </div>
        <div class="footer-base">
          <p><strong>Concept product.</strong> Countact is in development. The mechanism, dimensions, dispensing and counting shown on this site are concept specifications that require prototype testing; illustrations show a proposed arrangement, not a working device. App screens and sensor data on this site are simulated demos.</p>
          <p>Countact dispenses lens strips you already own; it does not sell or prescribe contact lenses. Follow your eye-care professional's guidance on lens wear and replacement.</p>
          <p>© ${new Date().getFullYear()} Countact.</p>
        </div>
      </div>`;
  }
  C.updateCartBadge();
  window.addEventListener('storage', (e) => { if (e.key === CART_KEY) C.updateCartBadge(); });

  // ── Toast ────────────────────────────────────────────────────
  C.toast = function (html, ms = 3600) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.innerHTML = html;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };

  // ── Lightbox (any [data-lightbox] element; group via data-group) ─
  let lb, lbImg, lbTitle, lbCap, lbStage, items = [], idx = 0, lastFocus = null;
  function buildLightbox() {
    lb = document.createElement('div');
    lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Image viewer');
    lb.innerHTML = `
      <div class="lb-top">
        <div class="lb-title"></div>
        <button class="lb-btn lb-zoom" type="button">Zoom 100%</button>
        <a class="lb-btn lb-open" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;text-decoration:none">Open full size</a>
        <button class="lb-btn lb-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="lb-stage"><img alt=""></div>
      <button class="lb-btn lb-nav lb-prev" type="button" aria-label="Previous image">‹</button>
      <button class="lb-btn lb-nav lb-next" type="button" aria-label="Next image">›</button>
      <div class="lb-caption"></div>`;
    document.body.appendChild(lb);
    lbImg = lb.querySelector('img'); lbTitle = lb.querySelector('.lb-title'); lbCap = lb.querySelector('.lb-caption'); lbStage = lb.querySelector('.lb-stage');
    const toggleZoom = () => { const z = lbStage.classList.toggle('zoomed'); lb.querySelector('.lb-zoom').textContent = z ? 'Fit to screen' : 'Zoom 100%'; };
    lb.querySelector('.lb-zoom').onclick = toggleZoom;
    lbImg.onclick = toggleZoom;
    lb.querySelector('.lb-close').onclick = close;
    lb.querySelector('.lb-prev').onclick = () => show(idx - 1);
    lb.querySelector('.lb-next').onclick = () => show(idx + 1);
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target === lbStage) close(); });
    document.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(idx - 1);
      if (e.key === 'ArrowRight') show(idx + 1);
    });
  }
  function show(i) {
    idx = (i + items.length) % items.length;
    const it = items[idx];
    lbStage.classList.remove('zoomed'); lb.querySelector('.lb-zoom').textContent = 'Zoom 100%';
    lbImg.src = it.src; lbImg.alt = it.alt;
    lbTitle.textContent = it.title; lbCap.textContent = it.caption + (items.length > 1 ? `  (${idx + 1} of ${items.length})` : '');
    lb.querySelector('.lb-open').href = it.src;
    lb.querySelectorAll('.lb-nav').forEach((b) => (b.style.display = items.length > 1 ? '' : 'none'));
  }
  function close() { lb.classList.remove('open'); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  C.openLightbox = function (list, start) {
    if (!lb) buildLightbox();
    items = list; lastFocus = document.activeElement;
    lb.classList.add('open'); document.body.style.overflow = 'hidden';
    show(start || 0);
    lb.querySelector('.lb-close').focus();
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-lightbox]');
    if (!el) return;
    e.preventDefault();
    const group = el.dataset.group;
    const nodes = group ? [...document.querySelectorAll(`[data-lightbox][data-group="${group}"]`)] : [el];
    const list = nodes.map((n) => ({ src: n.dataset.lightbox, title: n.dataset.title || '', caption: n.dataset.caption || '', alt: n.querySelector('img')?.alt || n.dataset.title || '' }));
    C.openLightbox(list, nodes.indexOf(el));
  });
})();
