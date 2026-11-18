/* hubdata.js — Haber merkezi verisini (takvim, olasılıklar, makro, benzer olaylar, toparlanma, haber akışı, iş akışı uyarıları) market-data dalından okur.
 * Veri GitHub Actions'ta üretilir (tools/fetch_hub.py). Ağ yoksa son başarılı kopya (localStorage) gösterilir ve "güncel değil" diye işaretlenir. */
(function () {
  'use strict';
  // İsteğe bağlı dosyalar (v8.1): henüz üretilmediyse hata sayılmaz; güncellik ve sunucu analizi için kullanılır
  var OPTIONAL = { sources: 'news/sources.json', scenarios: 'hub/scenarios.json', analysisIdx: 'analysis/index.json', stNews: 'status/news.json', stIntraday: 'status/intraday.json', stDaily: 'status/daily.json', stCrypto: 'status/crypto.json' };
  var FILES = { calendar: 'hub/calendar.json', probs: 'hub/probs.json', macro: 'hub/macro.json', analogs: 'hub/analogs.json', recovery: 'hub/recovery.json', status: 'hub/status.json', alerts: 'hub/alerts.json', feed: 'news/feed.json' };
  var LS = 'finans-pusulasi:hub:v1', TTL = 5 * 60000, data = null, at = 0, inflight = null;
  function base() { return window.MData.URL.mdIndex.replace(/index\.json$/, ''); }
  function readLS() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } }
  function saveLS(d) { try { localStorage.setItem(LS, JSON.stringify(d)); } catch (e) { try { var s = Object.assign({}, d); delete s.analogs; localStorage.setItem(LS, JSON.stringify(s)); } catch (e2) { /* kota */ } } }
  function load(force) {
    if (inflight) return inflight;
    if (!force && data && Date.now() - at < TTL) return Promise.resolve(data);
    var last = data || readLS() || {}, out = { errors: {}, stale: {}, files: {} };
    var optJobs = Object.keys(OPTIONAL).map(function (k) {
      return window.MData.fetchJson(base() + OPTIONAL[k], { timeout: 20000 }).then(function (j) { out[k] = j; out.files[k] = j && j.generatedAt || null; }, function (e) {
        if (last[k]) { out[k] = last[k]; out.stale[k] = true; out.files[k] = last.files && last.files[k] || null; } else if (e.status !== 404) out.optErrors = (out.optErrors || []).concat(k + ': ' + e.message);
      });
    });
    inflight = Promise.all(optJobs.concat(Object.keys(FILES).map(function (k) {
      return window.MData.fetchJson(base() + FILES[k], { timeout: 20000 }).then(function (j) { out[k] = j; out.files[k] = j && j.generatedAt || null; }, function (e) {
        out.errors[k] = e.message; if (last[k]) { out[k] = last[k]; out.stale[k] = true; out.files[k] = last.files && last.files[k] || null; }
      });
    }))).then(function () {
      out.loadedAt = Date.now(); data = out; at = Date.now(); inflight = null;
      if (Object.keys(out.errors).length < Object.keys(FILES).length) saveLS(out);
      return out;
    }, function (e) { inflight = null; throw e; });
    return inflight;
  }
  function get() { return data || readLS(); }
  function statuses(d) { d = d || get() || {}; return { news: d.stNews, intraday: d.stIntraday, daily: d.stDaily, crypto: d.stCrypto }; }
  window.HubData = { load: load, get: get, FILES: FILES, OPTIONAL: OPTIONAL, base: base, statuses: statuses };
})();
