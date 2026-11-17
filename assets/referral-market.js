(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    api.watchCoin(root.document, root.MutationObserver, root.CSReferral);
    api.watchTables(root.document, root.MutationObserver, root.CSReferral);
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function watchCoin(document, Observer, referral) {
    const name = document.getElementById('detailName'), slot = document.getElementById('coinReferral');
    if (!name || !slot || !referral) return;
    const update = () => referral.mount(slot, 'coin', 'Открыть ' + name.textContent.trim() + ' на BingX');
    update();
    new Observer(update).observe(name, { childList: true, characterData: true, subtree: true });
  }
  function watchTables(document, Observer, referral) {
    if (!referral) return;
    for (const body of document.querySelectorAll('tbody[data-bingx-table]')) {
      const update = () => {
        for (const row of body.querySelectorAll('tr[data-id]')) {
          if (row.querySelector('.referral-trade-cell')) continue;
          const cell = document.createElement('td');
          cell.className = 'referral-trade-cell';
          referral.mount(cell, 'table', 'Торговать');
          row.appendChild(cell);
        }
      };
      update();
      new Observer(update).observe(body, { childList: true });
    }
  }
  return { watchCoin, watchTables };
});
