(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./config.js') : root.CSConfig);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.CSReferral = api; api.install(root.document, root); }
})(typeof globalThis === 'object' ? globalThis : this, function (config) {
  'use strict';
  const { REF_BINGX } = config;
  const RISK = 'Не инвестиционная рекомендация. Торговля фьючерсами связана с высоким риском потери капитала';
  const placements = Object.freeze(['header', 'footer', 'coin', 'table', 'signal-oi', 'signal-funding', 'signal-cvd',
    'report-top', 'report-bottom', 'exchange', 'mobile']);
  const KEY = 'cs-referral-clicks-v1';
  const SHARDS = 'cs-referral-clicks-v2:';
  let fallbackSequence = 0;
  function shardKey() {
    try { return SHARDS + globalThis.crypto.randomUUID(); } catch (_) { /* older or non-secure browser context */ }
    let entropy;
    try { entropy = [...globalThis.crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(36)).join('-'); }
    catch (_) { entropy = Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2); }
    // This ID separates optional local counters; it is never an authentication or security token.
    return SHARDS + 'fallback-' + Date.now().toString(36) + '-' + (++fallbackSequence).toString(36) + '-' + entropy;
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  function block(placement, label) {
    if (!placements.includes(placement)) throw Error('Unknown placement');
    return '<aside class="referral-block" aria-label="Реклама BingX">' +
      '<a class="referral-link" data-referral="bingx" data-placement="' + escape(placement) + '" href="' + escape(REF_BINGX) +
      '" target="_blank" rel="sponsored noopener noreferrer">' + escape(label) + '</a>' +
      '<small class="referral-disclosure">Реферальная ссылка</small><p class="referral-risk">' + escape(RISK) + '</p></aside>';
  }
  function createTracker(storage, emit = () => {}) {
    // Each document writes its own record, so simultaneous tabs never overwrite each other.
    // The old v1 record is read as a baseline and is never rewritten by this version.
    const values = {};
    const shard = shardKey();
    let observed = {};
    const add = (total, parsed) => {
      for (const key of placements) if (Number.isSafeInteger(parsed?.[key]) && parsed[key] >= 0) {
        total[key] = Math.min(1e9, (total[key] || 0) + parsed[key]);
      }
    };
    const counts = () => {
      try {
        const total = {};
        const read = key => {
          try { add(total, JSON.parse(storage?.getItem(key) || '{}')); } catch (_) { /* ignore malformed records */ }
        };
        read(KEY);
        for (let i = 0; i < storage?.length; i++) {
          const key = storage.key(i);
          if (key?.startsWith(SHARDS) && key !== shard) read(key);
        }
        observed = total;
      } catch (_) { /* Keep last observed totals if storage becomes unavailable. */ }
      const total = { ...observed };
      add(total, values);
      return total;
    };
    return {
      count(placement) {
        if (!placements.includes(placement)) return;
        values[placement] = Math.min(1e9, (values[placement] || 0) + 1);
        try { if (shard) storage?.setItem(shard, JSON.stringify(values)); } catch (_) { /* storage may be disabled */ }
        try { emit({ exchange: 'bingx', placement }); } catch (_) { /* analytics must never block the link */ }
      },
      counts
    };
  }
  function clickHandler(tracker, updated = () => {}) {
    return event => {
      if (!((event.type === 'click' && event.button === 0) || (event.type === 'auxclick' && event.button === 1))) return;
      const anchor = event.target?.closest?.('a[data-referral="bingx"][data-placement]');
      if (!anchor || anchor.getAttribute('href') !== REF_BINGX || !placements.includes(anchor.dataset.placement)) return;
      tracker.count(anchor.dataset.placement);
      if (anchor.dataset.placement === 'table') event.stopPropagation?.();
      updated();
    };
  }
  function mount(slot, placement, label) {
    slot.innerHTML = block(placement, label); // Every variable in block() is escaped; no external HTML.
    slot.dataset.bingxReady = 'true';
  }
  function hydrate(document) {
    for (const slot of document.querySelectorAll('[data-bingx-placement]')) {
      if (slot.dataset.bingxReady) continue;
      mount(slot, slot.dataset.bingxPlacement, slot.dataset.bingxLabel || 'Торговать на BingX');
    }
  }
  function installMobile(document, host) {
    const panel = document.getElementById('bingxMobile'), close = document.getElementById('bingxMobileClose');
    if (!panel || !close || typeof host.matchMedia !== 'function') return;
    const media = host.matchMedia('(max-width:700px)');
    let dismissed = false;
    try { dismissed = host.sessionStorage.getItem('cs-bingx-mobile-dismissed') === '1'; } catch (_) { /* optional preference */ }
    const update = () => {
      const visible = media.matches && !dismissed;
      panel.hidden = !visible;
      document.body.classList.toggle('referral-dock-open', visible);
    };
    close.addEventListener('click', () => {
      dismissed = true;
      try { host.sessionStorage.setItem('cs-bingx-mobile-dismissed', '1'); } catch (_) { /* preference stays in memory */ }
      update();
    });
    media.addEventListener('change', update);
    update();
  }
  function install(document, host) {
    if (!document || document.__csReferralInstalled) return;
    document.__csReferralInstalled = true;
    let storage;
    try { storage = host.localStorage; } catch (_) { /* privacy mode */ }
    const emit = data => {
      if (typeof host.umami?.track === 'function') host.umami.track('referral_click', data);
      else if (typeof host.plausible === 'function') host.plausible('referral_click', { props: data });
    };
    const tracker = createTracker(storage, emit);
    const update = () => {
      for (const panel of document.querySelectorAll('[data-referral-counts]')) {
        const counts = tracker.counts();
        panel.innerHTML = '<table><thead><tr><th>Место</th><th>Клики в этом браузере</th></tr></thead><tbody>' +
          placements.map(p => '<tr><th scope="row">' + escape(p) + '</th><td>' + (counts[p] || 0) + '</td></tr>').join('') +
          '</tbody></table>';
      }
      for (const el of document.querySelectorAll('[data-referral-analytics-status]')) {
        el.textContent = typeof host.umami?.track === 'function' || typeof host.plausible === 'function' ?
          'Подключён внешний сборщик событий. Показанные ниже числа — только локальные.' :
          'Общий сборщик не подключён. Ниже только клики этого браузера, не статистика всех посетителей.';
      }
    };
    document.addEventListener('click', clickHandler(tracker, update), true);
    document.addEventListener('auxclick', clickHandler(tracker, update), true);
    host.addEventListener?.('storage', event => {
      if (event.key === null || event.key === KEY || event.key?.startsWith(SHARDS)) update();
    });
    hydrate(document); update(); installMobile(document, host);
  }
  return { block, placements, RISK, createTracker, clickHandler, mount, hydrate, install, installMobile };
});
