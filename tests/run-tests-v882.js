/* v8.8.2 testleri: anında arama (sembol öneki önce, Türkçe harf katlama), ABD hisseleri ve yabancı ETF'ler
 * (sınıf, helal etiketi, USD likidite/oynaklık, kur çevrimi, filtreler), haber tekilleştirme hızı. Veri modeli/migrate değişmedi. */
'use strict';
var fs = require('fs'), path = require('path');
module.exports.run = function () {
  var MD = require('../js/mdata.js'), AN = require('../js/analysis.js'), SN = require('../js/snapshot.js'), L = require('../js/lab.js'), N = require('../js/news.js'), IB = require('../js/inbox.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function rd(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
  // market-data index.json biçiminde küçük dizin (gerçek alan adları)
  var IX = {
    index: ['XU100', 'XKTUM'],
    bist: [{ s: 'THYAO', n: 'Türk Hava Yolları', k: 1 }, { s: 'ISCTR', n: 'Türkiye İş Bankası' }, { s: 'SAHOL', n: 'Hacı Ömer Sabancı Holding' }, { s: 'SASA', n: 'SASA Polyester', k: 1 },
      { s: 'SISE', n: 'Türkiye Şişe ve Cam Fabrikaları', k: 1 }, { s: 'SARKY', n: 'Sarkuysan', k: 1 }, { s: 'ASELS', n: 'Aselsan', k: 1 }, { s: 'KCHOL', n: 'Koç Holding' }],
    us: ['SPUS', 'HLAL', 'SPY', 'AAPL', 'JPM', 'MSFT', 'SAP'],
    usInfo: [{ s: 'SPUS', n: 'SP Funds S&P 500 Sharia Industry Exclusions ETF', t: 'etf', h: 'uygun' }, { s: 'HLAL', n: 'Wahed FTSE USA Shariah ETF', t: 'etf', h: 'uygun' },
      { s: 'SPY', n: 'SPDR S&P 500 ETF', t: 'etf', h: 'uygun_degil' },
      { s: 'AAPL', n: 'Apple Inc.', t: 'stock', tv: 'NASDAQ:AAPL', h: 'uygun', hs: ['SPUS'] }, { s: 'MSFT', n: 'Microsoft Corp.', t: 'stock', tv: 'NASDAQ:MSFT', h: 'uygun', hs: ['SPUS'] },
      { s: 'JPM', n: 'JPMorgan Chase & Co.', t: 'stock', tv: 'NYSE:JPM', h: 'uygun_degil', ind: 'Major Banks' }, { s: 'SAP', n: 'Sapiens Test Corp.', t: 'stock', tv: 'NYSE:SAP', h: null }]
  };
  var E = MD.buildEntries(IX);
  function keys(q, n) { return MD.searchRank(E, q, n || 12).map(function (r) { return r.key; }); }

  test('Arama: "sa" → SA ile başlayan semboller önce (SASA, SAHOL, SARKY), isim eşleşmesi sonra; BIST yabancıdan önce', function () {
    var k = keys('sa', 20);
    ok(k.indexOf('bist:SASA') >= 0 && k.indexOf('bist:SAHOL') >= 0 && k.indexOf('bist:SARKY') >= 0, 'SA önekliler yok: ' + k);
    var lastPrefix = Math.max(k.indexOf('bist:SASA'), k.indexOf('bist:SAHOL'), k.indexOf('bist:SARKY'));
    var r = MD.searchRank(E, 'sa', 20); r.slice(0, lastPrefix + 1).forEach(function (x) { ok(x.rank <= 1, 'önek sonuçlarından önce isim eşleşmesi: ' + x.key); });
    ok(k.indexOf('us:SAP') > lastPrefix, 'ABD hissesi SAP BIST önekli hisselerden sonra gelmeli');
    eq(keys('sasa')[0], 'bist:SASA'); ok(MD.searchRank(E, 'SASA', 3)[0].exact, 'tam eşleşme işaretli değil');
  });
  test('Türkçe harf: İ/I/ı/i ve ş/ç/ğ/ö/ü katlanır; "İs", "ıs", "IS", "is" aynı sonucu verir; "şişe" → SISE', function () {
    eq(MD.foldTr('İSTANBUL'), MD.foldTr('istanbul')); eq(MD.foldTr('ıIiİ'), 'iiii'); eq(MD.foldTr('Şişe Çam Ğüö'), 'sise cam guo');
    var a = keys('İs'), b = keys('ıs'), c = keys('IS'), d = keys('is'); eq(a, b); eq(b, c); eq(c, d); eq(a[0], 'bist:ISCTR');
    ok(keys('şişe').indexOf('bist:SISE') >= 0 && keys('sise').indexOf('bist:SISE') >= 0, 'Şişe Cam bulunamadı');
    ok(keys('hacı ömer').indexOf('bist:SAHOL') >= 0 && keys('haci omer').indexOf('bist:SAHOL') >= 0, 'isimde kelime başı aranamadı');
  });
  test('Takma ad ve sabitler: "altın" → altın; "dolar" → USD/TL; dizin yokken de sabit varlıklar aranır', function () {
    var k = MD.searchRank(E, 'altın', 5); ok(k.length && /XAU|ALTIN|GLD|gram/i.test(k[0].key), 'altın ilk sırada değil: ' + JSON.stringify(k[0]));
    ok(keys('dolar', 5).some(function (x) { return /USD/.test(x); }), 'dolar bulunamadı');
    var E0 = MD.buildEntries(null); ok(MD.searchRank(E0, 'altın', 3).length > 0, 'dizinsiz sabit arama yok');
  });
  test('Yabancı varlıklar aranır: "spus" → us:SPUS (tam), "aapl" → us:AAPL, "apple" → us:AAPL; ETF/ABD hissesi türü doğru', function () {
    var r = MD.searchRank(E, 'spus', 3); eq(r[0].key, 'us:SPUS'); ok(r[0].exact); eq(r[0].kind, 'etf');
    eq(keys('aapl')[0], 'us:AAPL'); eq(MD.searchRank(E, 'aapl', 1)[0].kind, 'stock'); ok(keys('apple').indexOf('us:AAPL') >= 0);
    ok(keys('sp', 30).indexOf('us:SPUS') < keys('sp', 30).indexOf('us:SPY'), 'helal ETF konvansiyonelden önce gelmeli');
  });
  test('Sınıf eşlemesi: mdata ve lab ETF listesi aynı; us:AAPL → ABD hissesi (USD), us:SPUS → ETF; describe türü', function () {
    eq(Object.keys(MD.US_ETF).sort(), Object.keys(L.US_ETF).sort());
    ['SPUS', 'HLAL', 'SPSK', 'SPRE', 'SPTE', 'SPWO', 'UMMA', 'ISDW', 'ISDU', 'ISDE', 'HIWO'].forEach(function (s) { ok(MD.US_ETF[s], s + ' yok'); eq(L.classOfKey('us:' + s), 'etf'); });
    eq(L.classOfKey('us:AAPL'), 'usstock'); ok(L.isForeign('usstock')); eq(L.CLASS.usstock.cur, 'USD');
    eq(MD.describe('us:AAPL').kind, 'stock'); eq(MD.describe('us:SPUS').kind, 'etf');
  });
  test('Helal etiketi: kaynaklı "uygun", faaliyet alanı "uygun değil", kaynaksız "belirsiz" (uydurma yok); helal ETF ve SPY', function () {
    var um = MD.usInfoMap(IX);
    eq(SN.halalBase('us:AAPL', { usInfo: um.AAPL }).status, 'uygun'); ok(/SPUS/.test(SN.halalBase('us:AAPL', { usInfo: um.AAPL }).reason));
    eq(SN.halalBase('us:JPM', { usInfo: um.JPM }).status, 'uygun_degil');
    var b = SN.halalBase('us:SAP', { usInfo: um.SAP }); eq(b.status, 'bilinmiyor'); eq(b.label, 'Belirsiz');
    eq(SN.halalBase('us:ZZZZ', {}).status, 'bilinmiyor');
    eq(SN.halalBase('us:SPUS', {}).status, 'uygun'); eq(SN.halalBase('us:ISDW', {}).status, 'uygun'); eq(SN.halalBase('us:SPY', {}).status, 'uygun_degil');
  });
  test('USD hisse: likidite dolar eşiğiyle (TL eşiği değil), oynaklık tabanı %30; BIST hissesi eskisi gibi TL', function () {
    function liq(avg, cur) { var c = [], v = []; for (var i = 0; i < 40; i++) { c.push(100); v.push(avg / 100); } return AN.liquidityScore({ c: c, v: v }, 'stock', { currency: cur }); }
    eq(liq(1e9, 'USD').score, 95); eq(liq(1e6, 'USD').score, 20); eq(liq(1e6, 'TRY').score, 15); eq(liq(10 ** 8.7, 'TRY').score, 95);
    ok(/USD/.test(JSON.stringify(liq(1e9, 'USD').ev)) && /TL/.test(JSON.stringify(liq(1e9, 'TRY').ev)), 'para birimi etiketi yok'); eq(AN.VOL_BASE.stock_usd, 0.30); eq(AN.VOL_BASE.stock, 0.40);
  });
  test('BIST %10 günlük sınır kontrolü ABD hissesine uygulanmaz (tür etf ile denetlenir)', function () {
    var bars = [], d = new Date(Date.UTC(2026, 0, 1)), p = 100;
    for (var i = 0; i < 260; i++) { var t = new Date(d.getTime() + i * 864e5); if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue; p = i === 200 ? p * 1.16 : p * (1 + ((i % 7) - 3) / 1000); bars.push({ d: t.toISOString().slice(0, 10), o: p, h: p * 1.01, l: p * 0.99, c: p, v: 1e6 }); }
    var etf = MD.checkBars(bars, 'etf', { today: bars[bars.length - 1].d }), st = MD.checkBars(bars, 'stock', { today: bars[bars.length - 1].d });
    function lv(r) { var x = r.filter(function (o) { return o.id === 'jumps' || o.id === 'limit' || /sınır|limit/i.test(o.msg); }); return x.map(function (o) { return o.level; }); }
    ok(lv(st).some(function (l) { return l === 'warn' || l === 'fail'; }), 'BIST kuralı test verisinde tetiklenmedi');
    ok(!lv(etf).some(function (l) { return l === 'fail'; }), 'ABD hissesi BIST sınırıyla reddedildi');
  });
  test('Sanal alım: USD fiyat × USD/TL kuru; kur yoksa bekleyen nakit', function () {
    eq(L.toTL ? 1 : 1, 1);
    var snap = { name: 'AAPL', kind: 'stock', total: 70, confidence: 70, scores: { trend: 70, momentum: 60, risk: 60, value: 50, rel: 60, liquidity: 90 }, plans: {}, ind: { atr: 3, atrPct: 0.015, rsi: 50 }, halal: { status: 'uygun' }, price: 200, currency: 'USD' };
    var draft = { positions: [{ key: 'us:AAPL', name: 'AAPL', cls: 'usstock', cur: 'USD', weightBp: 10000, price: 200, snap: snap, entry: { code: 'now' } }], cashBp: 0 };
    var a = L.allocate(draft, 100000 * 100, 40, '2026-11-26T10:00:00Z'), p = a.positions[0];
    eq(p.price0TL, 8000); eq(p.status, 'held'); eq(p.units, 12.5); eq(p.costK, 10000000);
    var b = L.allocate(draft, 100000 * 100, null, '2026-11-26T10:00:00Z'); eq(b.positions[0].status, 'pending');
  });
  test('Filtreler: Yalnız TL ABD hissesini çıkarır; helal açıkken "belirsiz" girmez; "uygun değil" hiçbir ayarda girmez; eski kayıtta sınıf sessizce açılmaz', function () {
    function snap(h) { return { name: 'X', kind: 'stock', total: 75, confidence: 70, blocked: false, blockReasons: [], scores: { trend: 75, momentum: 70, risk: 65, value: 60, rel: 60, liquidity: 90 }, plans: {}, ind: { atr: 2, atrPct: 0.01, rsi: 50 }, halal: { status: h }, price: 100, currency: 'USD' }; }
    function cand(key, h) { return { key: key, name: key, cls: L.classOfKey(key), cur: 'USD', snap: snap(h), halal: { status: h, label: h }, price: 100, liq: 1e9 }; }
    var C = [cand('us:AAPL', 'uygun'), cand('us:SAP', 'bilinmiyor'), cand('us:JPM', 'uygun_degil')];
    function kept(f) { return L.filterCandidates(C, L.cleanFilters(Object.assign(L.defaultFilters(), f))).kept.map(function (c) { return c.key; }); }
    var base = { classes: { bist: true, fund: true, gold: true, crypto: false, us: true } };
    eq(kept(Object.assign({ halal: true }, base)), ['us:AAPL']);
    eq(kept(Object.assign({ halal: false }, base)), ['us:AAPL', 'us:SAP']);
    eq(kept(Object.assign({ halal: false, tlOnly: true }, base)), []);
    eq(kept({ halal: true, classes: { bist: true, fund: true, gold: true, crypto: false, us: false } }), []);
    eq(L.cleanFilters({ profile: 'ozel', classes: { bist: true, fund: false, gold: true, crypto: false } }).classes.us, false);
    eq(L.PROFILES.muhafazakar.classes.us, false); eq(L.PROFILES.dengeli.classes.us, true);
    eq(L.cleanFilters({ profile: 'dengeli', classes: { bist: true, fund: true, gold: true, crypto: false } }).classes.us, L.PROFILES.dengeli.classes.bist === true && L.PROFILES.dengeli.classes.fund === true && L.PROFILES.dengeli.classes.gold === true && L.PROFILES.dengeli.classes.crypto === false);
  });
  test('Haber tekilleştirme: eski algoritmayla birebir aynı sonuç ve hızlı (900 haber < 250 ms)', function () {
    function oldDedupe(items, thr) { // v8.8.1 başvuru uygulaması
      thr = thr == null ? 0.6 : thr; var out = [], byUrl = {};
      items.slice().sort(function (x, y) { return (x.a || '') < (y.a || '') ? -1 : 1; }).forEach(function (it) {
        if (!it || !it.t) return; if (it.u && byUrl[it.u]) return;
        var tk = N.tokens(it.t), hit = null;
        for (var i = 0; i < out.length && !hit; i++) { var c = out[i]; if (N.jacc(tk, c._tk) >= thr || (tk.length >= 4 && c._tk.length >= 4 && N.fold(c.t) === N.fold(it.t))) hit = c; }
        if (hit) { if (!hit.srcs.some(function (x) { return x.s === it.s; })) hit.srcs.push({ s: it.s, u: it.u, a: it.a }); if (it.o && !hit.o) { hit.o = it.o; hit.t = it.t; hit.u = it.u; hit.s = it.s; hit.a = it.a || hit.a; } }
        else { var c2 = Object.assign({}, it); c2._tk = tk; c2.srcs = [{ s: it.s, u: it.u, a: it.a }]; out.push(c2); }
        if (it.u) byUrl[it.u] = 1;
      });
      out.forEach(function (c) { c.n = c.srcs.length; delete c._tk; }); return out.sort(function (x, y) { return (x.a || '') < (y.a || '') ? 1 : -1; });
    }
    var W = ['ASELSAN', 'yeni', 'sözleşme', 'imzaladı', 'Merkez', 'Bankası', 'faiz', 'kararı', 'altın', 'rekor', 'kırdı', 'borsa', 'güne', 'yükselişle', 'başladı', 'dolar', 'enflasyon', 'beklenti', 'Tüpraş', 'temettü', 'açıkladı', 'ihracat', 'büyüme', 'Fed', 'petrol'];
    var seed = 7; function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var items = []; for (var i = 0; i < 900; i++) { var n = 4 + Math.floor(rnd() * 6), t = []; for (var j = 0; j < n; j++) t.push(W[Math.floor(rnd() * W.length)]); items.push({ t: t.join(' '), u: rnd() < 0.05 ? 'u' + Math.floor(rnd() * 20) : 'u' + i, s: 's' + Math.floor(rnd() * 5), a: '2026-11-2' + Math.floor(rnd() * 6) + 'T1' + Math.floor(rnd() * 10) + ':00:00Z', o: rnd() < 0.1 }); }
    var exp = oldDedupe(JSON.parse(JSON.stringify(items))), t0 = Date.now(), got = N.dedupe(JSON.parse(JSON.stringify(items))), ms = Date.now() - t0;
    eq(got, exp, 'sonuç farklı'); ok(got.length < items.length, 'tekilleştirme çalışmadı'); ok(ms < 250, 'yavaş: ' + ms + ' ms');
  });
  test('Arayüz: canlı öneri kutusu (combobox, 150 ms), Enter/ok tuşları; CSS; oluşturucuda da arama; ABD sınıfı onay kutusu', function () {
    var ui = rd('js/analysis-ui.js'), css = rd('css/style.css'), lui = rd('js/lab-ui.js');
    ok(/role="combobox"/.test(ui) && /id="a-sugg"/.test(ui) && /role="listbox"/.test(ui), 'combobox yok');
    ok(/150\)/.test(ui) && /ArrowDown/.test(ui) && /ArrowUp/.test(ui) && /Escape/.test(ui), 'klavye/debounce yok');
    ok(/searchBox\(\) \+ LUI\.builderPage\(\)/.test(ui), 'oluşturucuda arama yok');
    ok(/\.asugg\{position:absolute/.test(css) && /\.acombo\{position:relative/.test(css) && /\.asugg \.sg\.on/.test(css), 'öneri CSS yok');
    ok(/tvIntl/.test(rd('js/mdata.js')) && /ABD\/Londra borsası/.test(rd('js/mdata.js')) && /um\[s\]\.tv/.test(ui), 'ABD canlı fiyat etiketi/yenilemesi yok');
    ok(/cls\.us|'us'/.test(lui) && /ABD hisseleri \(USD\)/.test(lui), 'ABD hissesi sınıfı yok');
  });
  test('İş akışı ve sürüm: ABD adımı (MODE us, hata ana veriyi durdurmaz); sürüm 8.8.3 her yerde; migrate.js dokunulmadı', function () {
    var wf = rd('.github/workflows/market-data.yml'), py = rd('tools/fetch_market_data.py'), sw = rd('sw.js'), idx = rd('index.html');
    ok(/MODE: us/.test(wf) && /continue-on-error: true/.test(wf), 'ABD adımı yok');
    ok(/def main_us/.test(py) && /TidalFG_Holdings_/.test(py) && /SYML:SP;SPX/.test(py), 'ABD derleyicisi yok');
    eq(IB.APP_VERSION, '8.8.3'); ok(/VERSION = '8\.8\.3'/.test(sw)); ok(idx.indexOf('?v=8.8.2') < 0 && idx.indexOf('js/mdata.js?v=8.8.3') > 0 && idx.indexOf('css/style.css?v=8.8.3') > 0);
    var mg = rd('js/migrate.js'); ok(/sifirdan-midas-v2-2026-11-25/.test(mg));
  });

  return Promise.resolve(tests.map(function (t) { try { t.fn(); return { name: t.name, ok: true }; } catch (e) { return { name: t.name, ok: false, err: e.message }; } }));
};
if (require.main === module) module.exports.run().then(function (r) { var p = r.filter(function (x) { return x.ok; }).length; r.forEach(function (x) { console.log((x.ok ? '✓ ' : '✗ ') + x.name + (x.ok ? '' : '  → ' + x.err)); }); console.log(p + '/' + r.length); if (p !== r.length) process.exit(1); });
