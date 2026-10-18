(function () {
  const C = window.Countact;
  const $ = (id) => document.getElementById(id);

  // ── Gallery ──────────────────────────────────────────────────
  const imgs = [
    ['dispenser-exterior', 'Exterior', 'Countact dispenser exterior with L and R buttons and inventory display'],
    ['cutaway-mechanism', 'Left side mechanism (cutaway)', 'Cutaway of the strip pusher, retaining gate, spring return and exit sensors'],
    ['how-it-works', 'How it works', 'Press L or R, remove the strip, sensors confirm and the count updates'],
    ['removable-holders', 'Removable holders', 'Full-height removable left holder, 130 mm'],
    ['five-pack-strip', 'Sealed five-pack strip', 'Sealed five-pack strip, approx. 150 × 45 × 8 mm'],
    ['cabinet-dimensions', 'Cabinet dimensions', 'Cabinet, 120 × 205 × 140 mm'],
    ['mobile-app-counter', 'Mobile app', 'App showing left and right counts'],
  ].map(([f, title, alt]) => ({ src: `/assets/img/${f}.png`, thumb: `/assets/img/${f}.webp`, title, alt, caption: alt }));
  let cur = 0;
  const thumbs = $('pg-thumbs');
  thumbs.innerHTML = imgs.map((im, i) => `<button type="button" role="listitem" data-i="${i}" aria-label="Show ${im.title}" aria-current="${i === 0}"><img src="${im.thumb}" alt="" loading="lazy"></button>`).join('');
  thumbs.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cur = Number(b.dataset.i);
    $('pg-main-img').src = imgs[cur].src; $('pg-main-img').alt = imgs[cur].alt;
    thumbs.querySelectorAll('button').forEach((t, i) => t.setAttribute('aria-current', i === cur));
  });
  $('pg-main').addEventListener('click', () => C.openLightbox(imgs, cur));

  // ── Price / config ───────────────────────────────────────────
  const qtyEl = $('qty');
  let max = 5, cfg = null;

  C.config().then((c) => {
    cfg = c;
    const p = c.product;
    max = p.maxQuantity || 5;
    qtyEl.max = max;
    $('qty-help').textContent = `Max ${max} per order`;
    if (p.priceCents) {
      $('price').textContent = C.money(p.priceCents, p.currency);
    } else {
      $('price-box').innerHTML = '<span class="price-na">Price not yet configured</span>';
    }
    if (c.shipping.configured) {
      $('ship-line').textContent = c.shipping.flatRateCents === 0
        ? `Free ${c.shipping.label.toLowerCase()} · ${c.shipping.minDays}–${c.shipping.maxDays} business days`
        : `${c.shipping.label}: ${C.money(c.shipping.flatRateCents, p.currency)} per order · ${c.shipping.minDays}–${c.shipping.maxDays} business days`;
    } else {
      $('ship-line').textContent = 'Shipping rates not yet configured.';
    }
    if (!c.checkout.ready) {
      const n = $('config-notice'); n.hidden = false;
      n.className = 'notice notice-warn small';
      n.innerHTML = `<strong>Checkout requires configuration.</strong> You can add to your cart, but payment is disabled until the store owner finishes setup:<ul>${c.checkout.problems.map((x) => `<li>${x.replace(/</g, '&lt;')}</li>`).join('')}</ul>`;
    } else if (c.checkout.mode === 'test') {
      const n = $('config-notice'); n.hidden = false;
      n.className = 'notice notice-info small';
      n.innerHTML = '<strong>Stripe test mode.</strong> No real charges. Use test card 4242 4242 4242 4242.';
    }
  });

  const clamp = (v) => Math.max(1, Math.min(max, Math.floor(Number(v) || 1)));
  document.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => { qtyEl.value = clamp(Number(qtyEl.value) + Number(b.dataset.step)); }));
  qtyEl.addEventListener('change', () => { qtyEl.value = clamp(qtyEl.value); });

  $('buy-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const want = clamp(qtyEl.value);
    const before = C.cart.get().qty;
    const after = C.cart.add(want, max);
    const added = after - before;
    if (added <= 0) C.toast(`Your cart already has the maximum of ${max}. <a href="/cart">View cart</a>`);
    else C.toast(`Added ${added} to cart${after - before < want ? ` (max ${max} per order)` : ''}. <a href="/cart">View cart →</a>`);
  });

  $('buy-now').addEventListener('click', () => {
    location.href = '/checkout?qty=' + clamp(qtyEl.value);
  });
})();
