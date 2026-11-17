(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.watchCoin(root.document, root.MutationObserver, root.CSReferral);
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function watchCoin(document, Observer, referral) {
    const name = document.getElementById('detailName'), slot = document.getElementById('coinReferral');
    if (!name || !slot || !referral) return;
    const update = () => referral.mount(slot, 'coin', 'Открыть ' + name.textContent.trim() + ' на BingX');
    update();
    new Observer(update).observe(name, { childList: true, characterData: true, subtree: true });
  }
  return { watchCoin };
});
