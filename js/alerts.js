/* alerts.js — Seviye uyarıları (saf mantık, testli). Kullanıcı analizdeki bir seviyeden (giriş, stop, hedef, destek/direnç) veya elle uyarı kurar.
 * Yön kurulurken belirlenir: seviye o anki fiyatın üstündeyse "yukarı keserse", altındaysa "aşağı keserse". Her uyarı bir kez tetiklenir (yeniden kurulabilir).
 * Tetikleme yalnızca kaynağı ve saati bilinen gerçek bir fiyatla olur; fiyat alınamazsa uyarı beklemede kalır (uydurma yok). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Alerts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var AKEY = /^(bist|tefas|cg|metal|fx|idx|us|macro|td|imp):[A-Za-z0-9._\-]{1,40}$/, MAX = 50;
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function uid() { return 'al' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function make(o, nowIso) {
    if (!o || !AKEY.test(o.key || '')) throw new Error('Geçersiz varlık');
    if (!num(o.price) || o.price <= 0) throw new Error('Geçersiz seviye');
    if (!num(o.refPrice) || o.refPrice <= 0) throw new Error('Güncel fiyat bilinmiyor; uyarı kurulamaz');
    if (Math.abs(o.price - o.refPrice) / o.refPrice < 1e-6) throw new Error('Seviye güncel fiyata eşit');
    return { id: uid(), key: o.key, name: String(o.name || o.key).slice(0, 80), sym: o.sym ? String(o.sym).slice(0, 20) : null, cur: o.cur === 'USD' ? 'USD' : 'TRY', price: o.price, dir: o.price > o.refPrice ? 'above' : 'below',
      label: String(o.label || 'Seviye').slice(0, 60), refPrice: o.refPrice, createdAt: nowIso || new Date().toISOString(), triggeredAt: null, firedPrice: null, firedSource: null, lastPrice: null, lastAt: null, lastSource: null };
  }
  function hit(a, p) { return a.dir === 'above' ? p >= a.price : p <= a.price; }
  // prices: { key: { price, at, source } } → { alerts (yeni dizi), fired: [uyarı] }
  function evaluate(alerts, prices, nowIso) {
    var fired = [];
    var out = (alerts || []).map(function (a) {
      var q = prices && prices[a.key]; if (a.triggeredAt || !q || !num(q.price) || q.price <= 0) return a;
      var b = Object.assign({}, a, { lastPrice: q.price, lastAt: q.at || nowIso, lastSource: q.source || null });
      if (hit(a, q.price)) { b.triggeredAt = nowIso || new Date().toISOString(); b.firedPrice = q.price; b.firedSource = q.source || null; fired.push(b); }
      return b;
    });
    return { alerts: out, fired: fired };
  }
  function rearm(a, refPrice, nowIso) { if (!num(refPrice) || refPrice <= 0) throw new Error('Güncel fiyat bilinmiyor'); return make({ key: a.key, name: a.name, sym: a.sym, cur: a.cur, price: a.price, label: a.label, refPrice: refPrice }, nowIso); }
  function clean(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (a) {
      if (!a || typeof a !== 'object' || out.length >= MAX) return;
      if (typeof a.id !== 'string' || seen[a.id] || !AKEY.test(a.key || '') || !num(a.price) || a.price <= 0 || (a.dir !== 'above' && a.dir !== 'below')) return;
      seen[a.id] = 1;
      var iso = function (x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) ? x.slice(0, 30) : null; };
      out.push({ id: a.id.slice(0, 40), key: a.key, name: String(a.name || a.key).slice(0, 80), sym: a.sym ? String(a.sym).slice(0, 20) : null, cur: a.cur === 'USD' ? 'USD' : 'TRY', price: a.price, dir: a.dir, label: String(a.label || 'Seviye').slice(0, 60),
        refPrice: num(a.refPrice) ? a.refPrice : null, createdAt: iso(a.createdAt), triggeredAt: iso(a.triggeredAt), firedPrice: num(a.firedPrice) ? a.firedPrice : null, firedSource: a.firedSource ? String(a.firedSource).slice(0, 80) : null,
        lastPrice: num(a.lastPrice) ? a.lastPrice : null, lastAt: iso(a.lastAt), lastSource: a.lastSource ? String(a.lastSource).slice(0, 80) : null });
    });
    return out;
  }
  function active(list) { return (list || []).filter(function (a) { return !a.triggeredAt; }); }
  function distancePct(a, price) { return num(price) && price > 0 ? (a.price / price - 1) * 100 : null; }
  return { make: make, evaluate: evaluate, rearm: rearm, clean: clean, active: active, distancePct: distancePct, MAX: MAX };
});
