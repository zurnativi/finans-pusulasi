/* nodefetch.js — Node'da fetch dolandırıcısı: market-data dalı (raw.githubusercontent.com) isteklerini yerel klasöre yönlendirir; gerisi gerçek ağa gider.
 * install(dir, {noNet}) → noNet ise dış istekler reddedilir (testler/çevrimdışı). */
'use strict';
var fs = require('fs'), path = require('path');
var RAW = 'https://raw.githubusercontent.com/zurnativi/finans-pusulasi/market-data/';
function install(dir, o) {
  o = o || {}; var real = globalThis.fetch;
  globalThis.fetch = function (url, init) {
    var u = String(url);
    if (u.indexOf(RAW) === 0) {
      var rel = decodeURIComponent(u.slice(RAW.length).split('?')[0]), p = path.join(dir, rel);
      if (!fs.existsSync(p)) return Promise.resolve(new Response('not found', { status: 404 }));
      return Promise.resolve(new Response(fs.readFileSync(p), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (o.noNet) return Promise.reject(new Error('ağ kapalı (test)'));
    return real(url, init);
  };
}
module.exports = { install: install, RAW: RAW };
