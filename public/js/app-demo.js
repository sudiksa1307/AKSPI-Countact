// Countact companion-app DEMO. All device data here is simulated in the browser.
(function () {
  const C = window.Countact;
  const KEY = 'countact.demo.v1';
  const LENSES_PER_STRIP = 5;
  const MAX_STRIPS = 30;

  const SCREENS = [
    ['dashboard', 'Inventory'],
    ['low', 'Low-stock alert'],
    ['refill', 'Refill entry'],
    ['refill-done', 'Refill confirmed'],
    ['history', 'Activity'],
    ['settings', 'Settings'],
    ['notification', 'Notification'],
    ['reorder', 'Reorder'],
    ['offline', 'Disconnected'],
  ];

  const defaults = () => ({
    L: 5, R: 6,
    threshold: { L: 2, R: 2 },
    notifications: true,
    connected: true,
    pending: [],
    lastRefill: null,
    history: [
      { t: Date.now() - 3600e3 * 2, side: 'L', kind: 'dispense', n: 1 },
      { t: Date.now() - 3600e3 * 26, side: 'R', kind: 'dispense', n: 1 },
      { t: Date.now() - 3600e3 * 27, side: 'L', kind: 'dispense', n: 1 },
      { t: Date.now() - 3600e3 * 72, side: 'R', kind: 'refill', n: 6 },
    ],
  });

  let s = Object.assign(defaults(), C.store.get(KEY, {}));
  let screen = 'dashboard';
  let refillDraft = { side: 'L', n: 6 };
  let reorderUrl = null;
  let busy = { L: false, R: false };

  const save = () => C.store.set(KEY, s);
  const $ = (id) => document.getElementById(id);
  const phone = $('phone-screen');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sideName = (x) => (x === 'L' ? 'Left' : 'Right');
  const isLow = (x) => s[x] <= s.threshold[x];
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  };

  C.config().then((cfg) => { reorderUrl = cfg.links?.reorderContactsUrl || null; if (screen === 'reorder') render(); });

  // ── Tabs ─────────────────────────────────────────────────────
  const tabs = $('app-tabs');
  tabs.innerHTML = SCREENS.map(([id, label]) => `<button role="tab" type="button" data-screen="${id}" aria-controls="phone-screen">${label}</button>`).join('');
  $('mini-shots').innerHTML = SCREENS.map(([id, label]) => `<button type="button" data-screen="${id}">${label} →</button>`).join('');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-screen]');
    if (b && (tabs.contains(b) || $('mini-shots').contains(b))) go(b.dataset.screen);
  });

  function go(id) { screen = id; render(); }

  // ── Building blocks ──────────────────────────────────────────
  const header = (title, opts = {}) => `
    <div class="phone-notch"></div>
    <div class="screen">
      <div class="screen-head">
        ${opts.back ? `<button class="app-btn alt" data-act="go" data-to="${opts.back}" style="padding:6px 10px;min-height:32px">‹</button>` : ''}
        <h4 style="flex:1">${title}</h4>
        <span class="conn ${s.connected ? '' : 'off'}"><i></i>${s.connected ? 'Connected' : 'Offline'}</span>
      </div>
      <span class="tag tag-demo" style="align-self:flex-start">Demo data</span>`;
  const eyeCard = (x) => {
    const n = s[x];
    const cls = n === 0 ? 'low empty' : isLow(x) ? 'low' : '';
    return `<div class="eye-card ${cls}"><div class="side">${sideName(x).toUpperCase()}</div><div class="big">${n}</div><div class="sub">strips</div><div class="sub">${n * LENSES_PER_STRIP} lenses</div></div>`;
  };
  const footerNav = () => `
    <div style="margin-top:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding-top:6px">
      ${[['dashboard', 'Home'], ['refill', 'Refill'], ['history', 'Activity'], ['settings', 'Settings']]
        .map(([id, l]) => `<button class="app-btn ${screen === id ? '' : 'alt'}" data-act="go" data-to="${id}" style="padding:9px 4px;font-size:.78rem">${l}</button>`).join('')}
    </div></div>`;

  // ── Screens ──────────────────────────────────────────────────
  const views = {
    dashboard() {
      const lows = ['L', 'R'].filter(isLow);
      return header('Dispense counter') + `
        <div class="eye-cards">${eyeCard('L')}${eyeCard('R')}</div>
        ${lows.length ? `<button class="alert-box" data-act="go" data-to="low" style="text-align:left;cursor:pointer;font:inherit">⚠ ${lows.map(sideName).join(' & ')} running low — tap for details</button>`
          : `<div class="alert-box ok">Both sides above your low-stock levels.</div>`}
        ${s.pending.length ? `<div class="alert-box off">${s.pending.length} dispense event(s) waiting to sync.</div>` : ''}
        <div class="btn-pair"><button class="app-btn" data-act="go" data-to="refill">+ Log refill</button><button class="app-btn alt" data-act="go" data-to="reorder">Reorder contacts</button></div>
        <div class="app-row"><span>Last activity</span><strong class="small">${s.history[0] ? `${sideName(s.history[0].side)} · ${ago(s.history[0].t)}` : '—'}</strong></div>
      ` + footerNav();
    },
    low() {
      const lows = ['L', 'R'].filter(isLow);
      return header('Low stock', { back: 'dashboard' }) + `
        ${lows.length ? lows.map((x) => `
          <div class="alert-box"><strong>${sideName(x)}: ${s[x]} strip${s[x] === 1 ? '' : 's'} left</strong><br>That's ${s[x] * LENSES_PER_STRIP} lenses — at or below your alert level of ${s.threshold[x]} strip${s.threshold[x] === 1 ? '' : 's'}.</div>`).join('')
          : `<div class="alert-box ok">Nothing is low right now. This screen appears when a side reaches its alert level (Left ${s.threshold.L}, Right ${s.threshold.R} strips).</div>
             <button class="app-btn warn" data-act="simulate-low">Simulate low stock</button>`}
        <div class="btn-pair"><button class="app-btn" data-act="go" data-to="reorder">Reorder contacts</button><button class="app-btn alt" data-act="go" data-to="refill">I've refilled</button></div>
        <button class="app-btn alt" data-act="go" data-to="settings">Change alert levels</button>
      ` + footerNav();
    },
    refill() {
      const d = refillDraft;
      return header('Log a refill', { back: 'dashboard' }) + `
        <p class="small" style="margin:0">Loaded new strips into a holder? Add them here so the count stays right.</p>
        <div class="app-row"><span>Holder</span>
          <div class="btn-pair" style="width:150px">
            ${['L', 'R'].map((x) => `<button class="app-btn ${d.side === x ? '' : 'alt'}" data-act="refill-side" data-side="${x}" aria-pressed="${d.side === x}">${x}</button>`).join('')}
          </div></div>
        <div class="app-row"><span>Strips added</span>
          <div class="stepper"><button data-act="refill-n" data-d="-1" aria-label="Fewer strips">−</button><output>${d.n}</output><button data-act="refill-n" data-d="1" aria-label="More strips">+</button></div></div>
        <div class="app-row"><span>New total</span><strong>${Math.min(MAX_STRIPS, s[d.side] + d.n)} strips · ${Math.min(MAX_STRIPS, s[d.side] + d.n) * LENSES_PER_STRIP} lenses</strong></div>
        ${s[d.side] + d.n > MAX_STRIPS ? `<div class="alert-box">Demo holder capacity is capped at ${MAX_STRIPS} strips.</div>` : ''}
        <button class="app-btn" data-act="refill-save">Save refill</button>
      ` + footerNav();
    },
    'refill-done'() {
      const r = s.lastRefill;
      return header('Refill saved', { back: 'dashboard' }) + `
        <div style="text-align:center;padding:10px 0">
          <div style="width:64px;height:64px;border-radius:50%;background:var(--teal-500);color:#fff;font-size:2rem;display:flex;align-items:center;justify-content:center;margin:0 auto 10px">✓</div>
          ${r ? `<strong>${sideName(r.side)} holder: +${r.n} strips</strong><p class="small" style="margin:4px 0 0">Now ${s[r.side]} strips · ${s[r.side] * LENSES_PER_STRIP} lenses</p>`
            : `<strong>No refill logged yet</strong><p class="small">Use Refill entry to add strips.</p>`}
        </div>
        <div class="eye-cards">${eyeCard('L')}${eyeCard('R')}</div>
        <button class="app-btn" data-act="go" data-to="dashboard">Done</button>
      ` + footerNav();
    },
    history() {
      return header('Activity') + `
        <ul class="history">
          ${s.history.slice(0, 40).map((h) => `
            <li><span class="ico">${h.side}</span>
              <span>${h.kind === 'refill' ? `Refilled ${sideName(h.side).toLowerCase()} +${h.n} strips` : h.kind === 'sync' ? `Synced ${h.n} offline dispense(s)` : `Dispensed 1 ${sideName(h.side).toLowerCase()} strip`}</span>
              <time datetime="${new Date(h.t).toISOString()}">${ago(h.t)}</time></li>`).join('') || '<li>No activity yet.</li>'}
        </ul>
      ` + footerNav();
    },
    settings() {
      const th = (x) => `<div class="app-row"><span>${sideName(x)} alert at</span>
        <div class="stepper"><button data-act="th" data-side="${x}" data-d="-1" aria-label="Lower ${sideName(x)} alert level">−</button><output>${s.threshold[x]}</output><button data-act="th" data-side="${x}" data-d="1" aria-label="Raise ${sideName(x)} alert level">+</button></div></div>`;
      return header('Settings') + `
        <p class="small" style="margin:0"><strong>Low-stock alerts</strong> (strips remaining)</p>
        ${th('L')}${th('R')}
        <div class="app-row"><span>Notifications</span><label class="toggle"><input type="checkbox" data-act="notif" ${s.notifications ? 'checked' : ''} aria-label="Notifications"><span></span></label></div>
        <div class="app-row"><span>Device connection <span class="tag tag-demo">Demo</span></span><label class="toggle"><input type="checkbox" data-act="conn" ${s.connected ? 'checked' : ''} aria-label="Simulated device connection"><span></span></label></div>
        <div class="app-row"><span>Lenses per strip</span><strong>${LENSES_PER_STRIP}</strong></div>
        <button class="app-btn alt" data-act="go" data-to="notification">Preview a notification</button>
      ` + footerNav();
    },
    notification() {
      return header('Notifications', { back: 'settings' }) + `
        <p class="small" style="margin:0">This is how a low-stock alert appears on your lock screen.</p>
        <div style="background:linear-gradient(160deg,#0a3d3a,#12a596);border-radius:18px;padding:18px 12px;color:#fff">
          <div style="text-align:center;font-size:2.2rem;font-weight:700;line-height:1">9:41</div>
          <div style="text-align:center;font-size:.8rem;opacity:.8;margin-bottom:12px">Saturday</div>
          <div style="background:rgba(255,255,255,.95);color:var(--ink);border-radius:14px;padding:10px 12px;display:flex;gap:10px">
            <img src="/assets/logo/countact-eye-white.svg" alt="" style="width:30px;height:30px;border-radius:8px;background:var(--teal-500);padding:4px">
            <div class="small"><strong>Countact</strong> · now<br>${isLow('L') ? `Left is down to ${s.L} strip${s.L === 1 ? '' : 's'} (${s.L * 5} lenses).` : isLow('R') ? `Right is down to ${s.R} strip${s.R === 1 ? '' : 's'} (${s.R * 5} lenses).` : `Left is down to ${s.threshold.L} strips (${s.threshold.L * 5} lenses).`} Time to reorder?</div>
          </div>
        </div>
        <button class="app-btn" data-act="push">Send test notification</button>
        ${s.notifications ? '' : '<div class="alert-box off">Notifications are off in Settings.</div>'}
      ` + footerNav();
    },
    reorder() {
      const days = (x) => s[x] * LENSES_PER_STRIP;
      return header('Reorder contacts', { back: 'dashboard' }) + `
        <div class="eye-cards">${eyeCard('L')}${eyeCard('R')}</div>
        <div class="app-row"><span>Estimated supply*</span><strong>L ${days('L')} d · R ${days('R')} d</strong></div>
        <p class="small" style="margin:0;color:var(--ink-3)">*If you use one lens per eye per day. Follow your eye-care professional's wear schedule.</p>
        ${reorderUrl ? `<a class="app-btn" style="text-align:center;text-decoration:none" href="${esc(reorderUrl)}" target="_blank" rel="noopener noreferrer">Open lens retailer ↗</a>
            <p class="small" style="margin:0;color:var(--ink-3)">Opens an outside retailer in a new tab. Countact doesn't sell lenses.</p>`
          : `<button class="app-btn" disabled>Open lens retailer ↗</button>
            <div class="alert-box off">Retailer link not configured. Set <code>REORDER_CONTACTS_URL</code> in <code>.env</code>.</div>`}
      ` + footerNav();
    },
    offline() {
      if (s.connected) {
        return header('Device connection', { back: 'dashboard' }) + `
          <div class="alert-box ok">Your Countact is connected. This screen shows what happens if the link drops.</div>
          <button class="app-btn warn" data-act="disconnect">Simulate disconnect</button>
        ` + footerNav();
      }
      return header('Device offline', { back: 'dashboard' }) + `
        <div style="text-align:center;padding:6px 0">
          <div style="width:60px;height:60px;border-radius:50%;background:#eef2f1;color:var(--ink-3);font-size:1.6rem;display:flex;align-items:center;justify-content:center;margin:0 auto 8px">⦸</div>
          <strong>Can't reach your Countact</strong>
          <p class="small" style="margin:4px 0 0">Showing the last confirmed counts. The device keeps counting and will sync when it reconnects.</p>
        </div>
        <div class="eye-cards" style="opacity:.6">${eyeCard('L')}${eyeCard('R')}</div>
        ${s.pending.length ? `<div class="alert-box off">${s.pending.length} dispense event(s) waiting on the device.</div>` : ''}
        <button class="app-btn" data-act="reconnect">Try to reconnect</button>
      ` + footerNav();
    },
  };

  // ── Render ───────────────────────────────────────────────────
  function render() {
    if (!s.connected && ['dashboard'].includes(screen)) { /* dashboard still visible but marked offline */ }
    phone.innerHTML = views[screen]();
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.screen === screen));
    $('hw-L-count').textContent = s.L; $('hw-R-count').textContent = s.R;
    $('hw-L').disabled = busy.L || s.L === 0; $('hw-R').disabled = busy.R || s.R === 0;
  }

  function log(entry) { s.history.unshift({ t: Date.now(), ...entry }); s.history = s.history.slice(0, 60); }

  function notify(text) {
    if (!s.notifications) return;
    const n = document.createElement('div');
    n.className = 'notif';
    n.innerHTML = `<img src="/assets/logo/countact-eye-white.svg" alt=""><div><strong>Countact</strong> <span class="tag tag-demo">Demo</span><br>${esc(text)}</div>`;
    phone.appendChild(n);
    setTimeout(() => n.remove(), 4200);
  }

  function maybeAlert(x, before) {
    if (before > s.threshold[x] && s[x] <= s.threshold[x]) {
      notify(`${sideName(x)} is down to ${s[x]} strip${s[x] === 1 ? '' : 's'} (${s[x] * 5} lenses).`);
    }
  }

  // ── Simulated hardware ───────────────────────────────────────
  function dispense(x) {
    if (busy[x] || s[x] === 0) return;
    busy[x] = true; render();
    const st = $('hw-status');
    st.textContent = `${sideName(x)}: strip pushed to outlet… waiting for removal (simulated sensors).`;
    setTimeout(() => {
      st.textContent = `${sideName(x)}: both exit sensors confirm the strip was taken.`;
      const before = s[x];
      s[x] -= 1;
      if (s.connected) { log({ side: x, kind: 'dispense', n: 1 }); maybeAlert(x, before); }
      else { s.pending.push({ t: Date.now(), side: x }); st.textContent += ' App is offline — event queued on device.'; }
      busy[x] = false; save(); render();
    }, 900);
  }
  $('hw-L').addEventListener('click', () => dispense('L'));
  $('hw-R').addEventListener('click', () => dispense('R'));

  function reconnect() {
    s.connected = true;
    if (s.pending.length) {
      s.pending.forEach((p) => s.history.unshift({ t: p.t, side: p.side, kind: 'dispense', n: 1 }));
      s.history.sort((a, b) => b.t - a.t);
      notify(`Synced ${s.pending.length} dispense event(s) from your Countact.`);
      s.pending = [];
    }
    ['L', 'R'].forEach((x) => { if (isLow(x)) notify(`${sideName(x)} is at ${s[x]} strip${s[x] === 1 ? '' : 's'}.`); });
  }

  // ── In-app actions ───────────────────────────────────────────
  phone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.act;
    if (a === 'go') return go(b.dataset.to);
    if (a === 'refill-side') { refillDraft.side = b.dataset.side; return render(); }
    if (a === 'refill-n') { refillDraft.n = Math.max(1, Math.min(MAX_STRIPS, refillDraft.n + Number(b.dataset.d))); return render(); }
    if (a === 'refill-save') {
      const x = refillDraft.side; const add = Math.min(MAX_STRIPS - s[x], refillDraft.n);
      s[x] += add; s.lastRefill = { side: x, n: add }; log({ side: x, kind: 'refill', n: add }); save();
      return go('refill-done');
    }
    if (a === 'th') { const x = b.dataset.side; s.threshold[x] = Math.max(0, Math.min(10, s.threshold[x] + Number(b.dataset.d))); save(); return render(); }
    if (a === 'push') { if (!s.notifications) return render(); return notify(`Left is down to ${s.L} strip${s.L === 1 ? '' : 's'}. Time to reorder?`); }
    if (a === 'simulate-low') { s.L = Math.min(s.L, s.threshold.L); save(); return render(); }
    if (a === 'disconnect') { s.connected = false; save(); return render(); }
    if (a === 'reconnect') { reconnect(); save(); return go('dashboard'); }
  });
  phone.addEventListener('change', (e) => {
    const a = e.target.dataset.act;
    if (a === 'notif') { s.notifications = e.target.checked; }
    if (a === 'conn') { if (e.target.checked) reconnect(); else s.connected = false; }
    save(); render();
  });

  $('demo-reset').addEventListener('click', () => { s = defaults(); refillDraft = { side: 'L', n: 6 }; save(); $('hw-status').textContent = 'Demo reset.'; go('dashboard'); });

  render();
})();
