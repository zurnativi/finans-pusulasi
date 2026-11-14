/* prices.js — Ücretsiz, tarayıcıdan (CORS) erişilebilen fiyat kaynakları. Kasım 2026'da canlı test edildi.
 * Hiçbir fiyat uydurulmaz: kaynak yanıt vermezse o fiyat "alınamadı" olarak gösterilir, eski fiyat aynen kalır.
 * Ayrıştırıcılar saf fonksiyondur (testli); ağ çağrıları yalnızca fetchAll'da. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio.js'));
  else root.Prices = factory(root.Portfolio);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';
  var SOURCES = {
    frankfurter: { label: 'Frankfurter — Avrupa Merkez Bankası referans kurları', site: 'https://frankfurter.dev', what: 'USD/TL, EUR/TL (iş günü, günde bir)' },
    truncgil: { label: 'Truncgil Finans — Türkiye piyasası', site: 'https://finans.truncgil.com', what: 'Gram altın, gram gümüş, BIST 100, döviz (çapraz kontrol)' },
    goldapi: { label: 'gold-api.com — ons altın/gümüş (USD)', site: 'https://gold-api.com', what: 'Gram altın çapraz kontrolü (ons × USD/TL ÷ 31,1035)' },
    coingecko: { label: 'CoinGecko — kripto (TL)', site: 'https://www.coingecko.com', what: 'Kripto paralar' },
    binance: { label: 'Binance — kripto (TL)', site: 'https://www.binance.com', what: 'Kripto (yedek kaynak)' },
    twelvedata: { label: 'Twelve Data — ABD hisse/ETF (ücretsiz anahtar ile)', site: 'https://twelvedata.com', what: 'SPUS, HLAL gibi ABD ETF\'leri' },
    fawaz: { label: 'Currency API (fawazahmed0, jsDelivr) — geçmiş altın', site: 'https://github.com/fawazahmed0/exchange-api', what: 'Geçmiş tarihli ons altın/TL' }
  };
  var URLS = {
    frankfurter: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR',
    truncgil: 'https://finans.truncgil.com/v4/today.json',
    goldXAU: 'https://api.gold-api.com/price/XAU',
    goldXAG: 'https://api.gold-api.com/price/XAG',
    coingecko: function (ids) { return 'https://api.coingecko.com/api/v3/simple/price?ids=' + ids.map(encodeURIComponent).join(',') + '&vs_currencies=try&include_last_updated_at=true'; },
    binance: function (sym) { return 'https://data-api.binance.vision/api/v3/ticker/price?symbol=' + sym; },
    twelve: function (sym, key) { return 'https://api.twelvedata.com/quote?symbol=' + encodeURIComponent(sym) + '&apikey=' + encodeURIComponent(key); },
    fxSeries: function (from, to) { return 'https://api.frankfurter.dev/v1/' + from + '..' + to + '?base=USD&symbols=TRY'; },
    fawaz: function (d) { return 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@' + d + '/v1/currencies/xau.min.json'; },
    cgChart: function (id) { return 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=try&days=365&interval=daily'; }
  };
  var BINANCE = { bitcoin: 'BTCTRY', ethereum: 'ETHTRY', solana: 'SOLTRY', 'avalanche-2': 'AVAXTRY', ripple: 'XRPTRY', 'binancecoin': 'BNBTRY' };
  function p6(v) { var n = PF.parseScaled(v, 6); return n != null && n > 0 ? n : null; }
  function isoToYmdIstanbul(iso) { // ISO zaman damgası → İstanbul (UTC+3) takvim günü
    var t = Date.parse(iso); if (!isFinite(t)) return null; var d = new Date(t + 3 * 3600000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  /* ---------- Ayrıştırıcılar (saf) ---------- */
  function parseFrankfurter(j) {
    if (!j || !j.rates || !/^\d{4}-\d{2}-\d{2}$/.test(j.date || '')) throw new Error('Frankfurter yanıtı beklenen biçimde değil');
    var usd = p6(j.rates.TRY), eurPerUsd = p6(j.rates.EUR);
    if (!usd || !eurPerUsd) throw new Error('Frankfurter: TRY veya EUR kuru yok');
    var eur = PF.mulDiv(usd, PF.PS, eurPerUsd); // TL/EUR = (TL/USD) ÷ (EUR/USD)
    return { date: j.date, USD: usd, EUR: eur };
  }
  function parseTruncgil(j) {
    if (!j || typeof j !== 'object' || !j.Update_Date) throw new Error('Truncgil yanıtı beklenen biçimde değil');
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(j.Update_Date); if (!m) throw new Error('Truncgil: tarih okunamadı');
    function buy(k) { var o = j[k]; return o ? p6(o.Buying) || null : null; }
    function sell(k) { var o = j[k]; return o ? p6(o.Selling) || null : null; }
    return { date: m[1], time: m[2], at: m[1] + 'T' + m[2] + ':00+03:00', USD: buy('USD'), EUR: buy('EUR'), XAU: buy('GRA'), XAG: buy('GUMUS'), XU100: sell('XU100') };
  }
  function parseGoldApi(j) {
    if (!j || j.currency !== 'USD' || !(j.price > 0) || !j.updatedAt) throw new Error('gold-api yanıtı beklenen biçimde değil');
    return { usdPerOz: p6(j.price), at: j.updatedAt, date: isoToYmdIstanbul(j.updatedAt), symbol: j.symbol };
  }
  function parseCoinGecko(j, ids) {
    var out = {}; if (!j || typeof j !== 'object') throw new Error('CoinGecko yanıtı beklenen biçimde değil');
    ids.forEach(function (id) { var o = j[id]; if (o && o['try'] > 0) { var at = o.last_updated_at ? new Date(o.last_updated_at * 1000).toISOString() : null; out[id] = { p: p6(o['try']), at: at, date: at ? isoToYmdIstanbul(at) : null }; } });
    return out;
  }
  function parseBinance(j) { if (!j || !j.price) throw new Error('Binance yanıtı beklenen biçimde değil'); return { p: p6(j.price) }; }
  function parseTwelve(j) {
    if (!j || j.status === 'error' || j.code) throw new Error('Twelve Data: ' + ((j && j.message) || 'hata'));
    if (!j.close || !/^\d{4}-\d{2}-\d{2}/.test(j.datetime || '')) throw new Error('Twelve Data yanıtı beklenen biçimde değil');
    return { p: p6(j.close), date: j.datetime.slice(0, 10), currency: j.currency || 'USD', at: j.last_quote_at ? new Date(j.last_quote_at * 1000).toISOString() : null, name: j.name || '' };
  }
  function parseFxSeries(j) {
    if (!j || !j.rates) throw new Error('Frankfurter geçmiş yanıtı beklenen biçimde değil');
    return Object.keys(j.rates).sort().map(function (d) { return { d: d, p: p6(j.rates[d].TRY) }; }).filter(function (x) { return x.p; });
  }
  function parseFawazGold(j) { // ons altın → TL; gram = ons ÷ 31,1034768
    if (!j || !j.xau || !(j.xau['try'] > 0) || !j.date) throw new Error('Currency API yanıtı beklenen biçimde değil');
    var oz = p6(j.xau['try']); return { d: j.date, p: PF.mulDiv(oz, 10000000, 311034768) };
  }
  function parseCgChart(j) {
    if (!j || !Array.isArray(j.prices)) throw new Error('CoinGecko geçmiş yanıtı beklenen biçimde değil');
    var map = {}; j.prices.forEach(function (x) { var d = isoToYmdIstanbul(new Date(x[0]).toISOString()); if (d && x[1] > 0) map[d] = p6(x[1]); });
    return Object.keys(map).sort().map(function (d) { return { d: d, p: map[d] }; });
  }

  /* ---------- Ağ ---------- */
  function fetchJson(url, ms) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null, t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 12000);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === 'AbortError' ? 'zaman aşımı' : 'bağlantı kurulamadı'); });
  }
  /* İhtiyaç duyulan anahtarları çeker; her biri için aday fiyat (veya hata) döner. Hiçbir şeyi kaydetmez. */
  function fetchAll(keys, cfg) {
    cfg = cfg || {};
    var need = {}; keys.forEach(function (k) { need[k] = true; });
    var res = { candidates: [], errors: [], sources: {} };
    var jobs = [];
    var fr = null, tg = null, gx = null, gs = null;
    function note(src, ok, msg) { res.sources[src] = { ok: ok, msg: msg || '' }; }
    jobs.push(fetchJson(URLS.frankfurter).then(function (j) { fr = parseFrankfurter(j); note('frankfurter', true); }, function (e) { note('frankfurter', false, e.message); }));
    jobs.push(fetchJson(URLS.truncgil).then(function (j) { tg = parseTruncgil(j); note('truncgil', true); }, function (e) { note('truncgil', false, e.message); }));
    if (need['metal:XAU']) jobs.push(fetchJson(URLS.goldXAU).then(function (j) { gx = parseGoldApi(j); note('goldapi', true); }, function (e) { note('goldapi', false, e.message); }));
    if (need['metal:XAG']) jobs.push(fetchJson(URLS.goldXAG).then(function (j) { gs = parseGoldApi(j); }, function () { }));
    var cg = keys.filter(function (k) { return /^cg:/.test(k); }).map(function (k) { return k.slice(3); }), cgRes = {};
    if (cg.length) jobs.push(fetchJson(URLS.coingecko(cg)).then(function (j) { cgRes = parseCoinGecko(j, cg); note('coingecko', true); }, function (e) { note('coingecko', false, e.message); }));
    var td = keys.filter(function (k) { return /^td:/.test(k); }), tdRes = {};
    if (td.length && cfg.twelveKey) td.forEach(function (k) { jobs.push(fetchJson(URLS.twelve(k.slice(3), cfg.twelveKey)).then(function (j) { tdRes[k] = parseTwelve(j); note('twelvedata', true); }, function (e) { tdRes[k] = { error: e.message }; note('twelvedata', false, e.message); })); });
    return Promise.all(jobs).then(function () {
      var binJobs = [];
      cg.forEach(function (id) { if (!cgRes[id] && BINANCE[id]) binJobs.push(fetchJson(URLS.binance(BINANCE[id])).then(function (j) { var b = parseBinance(j); cgRes[id] = { p: b.p, at: new Date().toISOString(), date: isoToYmdIstanbul(new Date().toISOString()), viaBinance: true }; note('binance', true); }, function (e) { note('binance', false, e.message); })); });
      return Promise.all(binJobs);
    }).then(function () {
      var now = new Date().toISOString();
      function add(key, cur, p, d, at, src, extra) { var c = { key: key, cur: cur, p: p, d: d, at: at || now, src: src }; if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; }); res.candidates.push(c); }
      ['USD', 'EUR'].forEach(function (c) {
        var k = 'fx:' + c; if (!need[k]) return;
        if (fr) add(k, 'TRY', fr[c], fr.date, null, SOURCES.frankfurter.label + ' (' + fr.date + ')', { cross: tg && tg[c] ? { label: 'Truncgil alış', p: tg[c], check: PF.crossCheck(fr[c], tg[c], 150) } : null });
        else if (tg && tg[c]) add(k, 'TRY', tg[c], tg.date, tg.at, SOURCES.truncgil.label + ' — alış', { note: 'Avrupa Merkez Bankası kaynağına ulaşılamadı; piyasa alış kuru kullanıldı.' });
        else res.errors.push(c + ' kuru alınamadı');
      });
      if (need['metal:XAU']) {
        var derived = gx && fr ? PF.gramFromOunce(gx.usdPerOz, fr.USD) : null;
        if (tg && tg.XAU) add('metal:XAU', 'TRY', tg.XAU, tg.date, tg.at, SOURCES.truncgil.label + ' — gram altın alış', { cross: derived ? { label: 'Ons × USD/TL ÷ 31,1035', p: derived, check: PF.crossCheck(tg.XAU, derived, 200) } : null });
        else if (derived) add('metal:XAU', 'TRY', derived, gx.date, gx.at, 'gold-api.com ons × Frankfurter USD/TL ÷ 31,1035 (uluslararası fiyat; kuyumcu alışı biraz farklı olabilir)');
        else res.errors.push('Gram altın fiyatı alınamadı');
      }
      if (need['metal:XAG']) {
        var dS = gs && fr ? PF.gramFromOunce(gs.usdPerOz, fr.USD) : null;
        if (tg && tg.XAG) add('metal:XAG', 'TRY', tg.XAG, tg.date, tg.at, SOURCES.truncgil.label + ' — gram gümüş alış', { cross: dS ? { label: 'Ons × USD/TL ÷ 31,1035', p: dS, check: PF.crossCheck(tg.XAG, dS, 300) } : null });
        else if (dS) add('metal:XAG', 'TRY', dS, gs.date, gs.at, 'gold-api.com ons gümüş × USD/TL ÷ 31,1035');
        else res.errors.push('Gram gümüş fiyatı alınamadı');
      }
      if (need['idx:XU100']) { if (tg && tg.XU100) add('idx:XU100', 'PT', tg.XU100, tg.date, tg.at, SOURCES.truncgil.label + ' — BIST 100'); else res.errors.push('BIST 100 değeri alınamadı'); }
      cg.forEach(function (id) { var r = cgRes[id]; if (r && r.p) add('cg:' + id, 'TRY', r.p, r.date, r.at, r.viaBinance ? SOURCES.binance.label : SOURCES.coingecko.label); else res.errors.push(id + ' fiyatı alınamadı'); });
      td.forEach(function (k) {
        if (!cfg.twelveKey) { res.errors.push(k.slice(3) + ': Twelve Data anahtarı girilmedi (ücretsiz alınır); fiyatı elle gir'); return; }
        var r = tdRes[k]; if (r && r.p) add(k, 'USD', r.p, r.date, r.at, SOURCES.twelvedata.label + (r.currency && r.currency !== 'USD' ? ' — DİKKAT para birimi ' + r.currency : ''), r.currency && r.currency !== 'USD' ? { badCurrency: r.currency } : null);
        else res.errors.push(k.slice(3) + ' fiyatı alınamadı' + (r && r.error ? ': ' + r.error : ''));
      });
      return res;
    });
  }
  /* Kıyas ve geçmiş için: USD/TL günlük seri, belirli tarihlerde gram altın, kripto günlük seri */
  function fetchHistory(opts) {
    var out = { series: {}, errors: [] }, jobs = [];
    if (opts.fxFrom) jobs.push(fetchJson(URLS.fxSeries(opts.fxFrom, opts.to), 20000).then(function (j) { out.series['fx:USD'] = parseFxSeries(j); }, function (e) { out.errors.push('USD/TL geçmişi: ' + e.message); }));
    (opts.goldDates || []).slice(0, 60).forEach(function (d) { jobs.push(fetchJson(URLS.fawaz(d), 15000).then(function (j) { var x = parseFawazGold(j); (out.series['metal:XAU'] = out.series['metal:XAU'] || []).push(x); }, function (e) { out.errors.push('Altın ' + d + ': ' + e.message); })); });
    (opts.cryptoIds || []).forEach(function (id) { jobs.push(fetchJson(URLS.cgChart(id), 20000).then(function (j) { out.series['cg:' + id] = parseCgChart(j); }, function (e) { out.errors.push(id + ' geçmişi: ' + e.message); })); });
    return Promise.all(jobs).then(function () { if (out.series['metal:XAU']) out.series['metal:XAU'].sort(function (a, b) { return a.d < b.d ? -1 : 1; }); return out; });
  }
  return { SOURCES: SOURCES, URLS: URLS, BINANCE: BINANCE, parseFrankfurter: parseFrankfurter, parseTruncgil: parseTruncgil, parseGoldApi: parseGoldApi, parseCoinGecko: parseCoinGecko,
    parseBinance: parseBinance, parseTwelve: parseTwelve, parseFxSeries: parseFxSeries, parseFawazGold: parseFawazGold, parseCgChart: parseCgChart, isoToYmdIstanbul: isoToYmdIstanbul,
    fetchJson: fetchJson, fetchAll: fetchAll, fetchHistory: fetchHistory };
});
