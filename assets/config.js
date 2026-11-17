(function (root) {
  'use strict';
  const REF_BINGX = 'https://bingxdao.com/invite/A7WGNX/';
  const config = Object.freeze({ REF_BINGX });
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.CSConfig = config;
})(typeof globalThis === 'object' ? globalThis : this);
