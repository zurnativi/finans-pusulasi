/* v7.1 testleri: sağ kenar etiket yerleşimi, gün içi mum birleştirme, haber/KAP önbellek ayrıştırma, Katılım endeksi, seviye uyarıları.
 * Çalıştırma: node tests/run-tests-v71.js (run-tests.js de sonunda çalıştırır). Ağ erişimi gerekmez. */
(function () {
  var LL = require('../js/labellayout.js');
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '') + ' beklenen ≈' + b + ', gelen ' + a); }

  /* ---------- 1. Etiket yerleşimi ---------- */
  function noOverlap(placed, gap) { var ys = placed.map(function (x) { return x.yy; }).sort(function (a, b) { return a - b; }); for (var i = 1; i < ys.length; i++) ok(ys[i] - ys[i - 1] >= gap - 1e-6, 'çakışma: ' + ys[i - 1] + ' / ' + ys[i]); }
  test('Etiket yerleşimi: çakışma yoksa yerinden oynamaz; yakın etiketler en az aralıkla ayrılır', function () {
    var r = LL.layout([{ y: 50, pr: 1 }, { y: 200, pr: 1 }, { y: 350, pr: 1 }], 0, 400, 16);
    eq(r.placed.map(function (x) { return x.yy; }), [50, 200, 350]);
    r = LL.layout([{ y: 100, pr: 1 }, { y: 104, pr: 1 }, { y: 106, pr: 1 }, { y: 300, pr: 1 }], 0, 400, 16);
    noOverlap(r.placed, 16); near(r.placed[1].yy, (100 + 104 + 106) / 3, 1e-9, 'küme ortalamaya ortalanır');
    eq(r.placed[3].yy, 300);
  });
  test('Etiket yerleşimi: sınır içinde kalır, sıra korunur, kapasite aşılınca düşük öncelik atılır', function () {
    var items = []; for (var i = 0; i < 40; i++) items.push({ y: 10 + i * 2, pr: i === 7 ? 100 : i % 5, id: i });
    var r = LL.layout(items, 0, 160, 16); noOverlap(r.placed, 16);
    ok(r.placed.length === 11, 'kapasite 11, gelen ' + r.placed.length); ok(r.dropped.length === 29);
    ok(r.placed.some(function (x) { return x.id === 7; }), 'en önemli etiket korunur');
    r.placed.forEach(function (x) { ok(x.yy >= 0 && x.yy <= 160, 'sınır dışı ' + x.yy); });
    for (var k = 1; k < r.placed.length; k++) ok(r.placed[k].y >= r.placed[k - 1].y, 'fiyat sırası bozuldu');
    r = LL.layout([{ y: 1, pr: 1 }, { y: 2, pr: 1 }, { y: 3, pr: 1 }], 0, 400, 16); eq(r.placed.map(function (x) { return x.yy; }), [0, 16, 32], 'üst sınıra yaslanır');
    r = LL.layout([{ y: 399, pr: 1 }, { y: 398, pr: 1 }], 0, 400, 16); noOverlap(r.placed, 16); ok(Math.max.apply(null, r.placed.map(function (x) { return x.yy; })) <= 400);
    r = LL.layout([{ y: -50, pr: 9 }, { y: NaN, pr: 9 }, { y: 20, pr: 1 }], 0, 400, 16); eq(r.placed.length, 1, 'görünür alan dışındaki seviye etikete girmez'); eq(r.dropped.length, 2);
  });
  test('Etiket yerleşimi: rastgele 500 deneme — hiç çakışma/sınır ihlali yok', function () {
    var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var t = 0; t < 500; t++) {
      var n = 1 + Math.floor(rnd() * 25), H = 80 + rnd() * 500, gap = 12 + rnd() * 8, items = [];
      for (var i = 0; i < n; i++) items.push({ y: rnd() * H, pr: Math.floor(rnd() * 100) });
      var r = LL.layout(items, 0, H, gap); noOverlap(r.placed, gap);
      r.placed.forEach(function (x) { ok(x.yy >= -1e-9 && x.yy <= H + 1e-9, 'sınır'); });
      eq(r.placed.length + r.dropped.length, n, 'kayıp etiket');
    }
  });

  /* ---------- 2. Gün içi mumlar ---------- */
  var MD = require('../js/mdata.js'), AN = require('../js/analysis.js'), AL = require('../js/alerts.js'), S = require('../js/sample.js');
  function tsi(y, m, d, hh, mm) { return Date.UTC(y, m - 1, d, hh - 3, mm) / 1000; }
  function bistHourly(days, seed) { // BIST: 09:30 … 17:30 (Yahoo 60 dk düzeni), iş günleri
    var out = [], p = 100, dt = new Date(Date.UTC(2026, 6, 1)); seed = seed || 3; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    while (out.length < days * 9) {
      var w = dt.getUTCDay();
      if (w !== 0 && w !== 6) { var hrs = [[9, 30], [10, 30], [11, 30], [12, 30], [13, 30], [14, 30], [15, 30], [16, 30], [17, 30]];
        hrs.forEach(function (h) { var o = p, c = p * (1 + (rnd() - 0.48) * 0.01), hi = Math.max(o, c) * (1 + rnd() * 0.003), lo = Math.min(o, c) * (1 - rnd() * 0.003); out.push([tsi(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), h[0], h[1]), o, hi, lo, c, 1000 + Math.round(rnd() * 5000)]); p = c; }); }
      dt.setUTCDate(dt.getUTCDate() + 1);
    }
    return out;
  }
  test('Saatlik dosya ayrıştırma: TSİ etiketleri, sıra; 4S birleştirme BIST seans yarıları (13:30 öncesi/sonrası) ve UTC 4 saatlik dilimler', function () {
    var j = { bars: bistHourly(3), currency: 'TRY', fetchedAt: '2026-07-04T10:00:00Z' }, r = MD.parseH1(j);
    eq(r.bars[0].d, '2026-07-01 09:30'); eq(r.bars[8].d, '2026-07-01 17:30'); eq(r.bars.length, 27);
    var last = j.bars[j.bars.length - 1], snap = [last[0] + 1800, 77, 77, 77, 77, 0], r2 = MD.parseH1({ bars: j.bars.concat([snap]) });
    eq(r2.bars.length, 27, 'Yahoo 18:00 hacimsiz kapanış mumu ayrı mum olmaz'); eq(r2.bars[26].c, 77, 'kapanış fiyatı son saatlik mumun kapanışı olur'); eq(r2.bars[26].h, Math.max(last[2], 77));
    var g = MD.aggregate(r.bars, 'bist'); eq(g.length, 6, 'günde 2 dilim'); eq(g[0].d, '2026-07-01 09:30'); eq(g[1].d, '2026-07-01 13:30'); eq(g[0].n, 4); eq(g[1].n, 5);
    var day = r.bars.slice(0, 9), a = g[0], b = g[1];
    eq(a.o, day[0].o); eq(a.c, day[3].c); eq(b.c, day[8].c); eq(a.h, Math.max.apply(null, day.slice(0, 4).map(function (x) { return x.h; }))); eq(b.l, Math.min.apply(null, day.slice(4).map(function (x) { return x.l; })));
    eq(a.v, day.slice(0, 4).reduce(function (s2, x) { return s2 + x.v; }, 0), 'hacim toplamı');
    var fx = []; for (var i = 0; i < 24; i++) fx.push({ t: Date.UTC(2026, 6, 1, i) , d: MD.labelOfMs(Date.UTC(2026, 6, 1, i)), o: 1, h: 2, l: 0.5, c: 1 + i, v: null });
    var g2 = MD.aggregate(fx, '24h'); eq(g2.length, 6); eq(g2[0].c, 4); eq(g2[5].c, 24); eq(g2[0].d, '2026-07-01 03:00', 'UTC 00 → TSİ 03');
    var part = MD.aggregate(r.bars.slice(0, 7), 'bist', Date.UTC(2026, 6, 1, 13)); ok(part[1].partial, 'süren seans yarısı kapanmamış işaretlenir'); ok(!part[0].partial);
  });
  test('Binance gün içi: kapanmamış mum işaretlenir; gün içi veri kontrolleri (az veri, sıra, eskime)', function () {
    var now = Date.UTC(2026, 10, 17, 12, 30), arr = []; for (var i = 0; i < 100; i++) { var t0 = now - (99 - i) * 3600000 - 1800000; arr.push([t0, '10', '11', '9', '10.5', '5', t0 + 3599999]); }
    var b = MD.parseBinanceIntraday(arr, now); ok(b[99].partial && !b[98].partial);
    var c = MD.checkIntraday(b, 'crypto', '1h', { nowMs: now }); eq(MD.worstLevel(c), 'warn', '100 mum → 200 ortalama uyarısı'); ok(c.some(function (x) { return x.id === 'fresh' && x.level === 'ok'; }));
    c = MD.checkIntraday(b, 'crypto', '1h', { nowMs: now + 10 * 3600000 }); ok(c.some(function (x) { return x.id === 'fresh' && x.level === 'fail'; }), '10 saatlik eski kripto mumu → hata');
    c = MD.checkIntraday(b.slice(0, 40), 'crypto', '1h', { nowMs: now }); ok(c.some(function (x) { return x.id === 'count' && x.level === 'fail'; }));
    var bad = b.slice(); bad[50] = Object.assign({}, bad[49]); c = MD.checkIntraday(bad, 'crypto', '1h', { nowMs: now }); ok(c.some(function (x) { return x.id === 'order' && x.level === 'fail'; }), 'tekrar eden mum');
    var h = MD.parseH1({ bars: bistHourly(30) }).bars, c2 = MD.checkIntraday(h, 'stock', '1h', { nowMs: Date.UTC(2026, 7, 20, 9) }); ok(c2.some(function (x) { return x.id === 'fresh' && x.level === 'fail'; }), 'haftalarca eski BIST verisi → hata');
    c2 = MD.checkIntraday(h, 'stock', '1h', { nowMs: h[h.length - 1].t + 2 * 3600000 }); ok(c2.some(function (x) { return x.id === 'fresh' && x.level === 'ok'; }));
  });
  test('Gün içi analiz: aynı motor; metinler "mum", yalnız teknik alt skorlar, yıllıklaştırma ölçülen mum sayısıyla; günlük analiz etkilenmez', function () {
    var h = MD.parseH1({ bars: bistHourly(60) }).bars, ser = { key: 'bist:TEST', kind: 'stock', tf: '1h', name: 'TEST', currency: 'TRY', bars: h, checks: MD.checkIntraday(h, 'stock', '1h', { nowMs: h[h.length - 1].t + 1800000 }) };
    var A = AN.analyze(ser, { halal: { status: 'uygun', label: 'Uygun' } });
    eq(A.tf, '1h'); ok(!A.blocked, A.blockReasons.join(' ')); ok(A.total >= 0 && A.total <= 100);
    ok(A.scores.value.na && A.scores.rel.na && A.scores.liquidity.na, 'temel/göreli/likidite gün içinde uygulanmaz');
    ok(!A.confReasons.some(function (r) { return /hesaplanamadı/.test(r); }), 'uygulanamayan alt skor güveni düşürmez');
    var txt = JSON.stringify(A.scores.trend.ev) + JSON.stringify(A.scores.risk.ev); ok(/mumluk/.test(txt) && !/günlük ortalama/.test(txt), 'gün içi metin: ' + txt.slice(0, 120));
    ok(/xcheck|Gün içi/.test(A.xcheck.note), 'TradingView karşılaştırması gün içinde yapılmaz');
    // Yıllık oynaklık: günde 10 mum → 2520 periyot (252 kullanılsaydı ~3,16 kat düşük çıkardı)
    var ret = []; for (var i = h.length - 60; i < h.length; i++) ret.push(Math.log(h[i].c / h[i - 1].c)); var m = ret.reduce(function (s2, x) { return s2 + x; }, 0) / ret.length, sd = Math.sqrt(ret.reduce(function (s2, x) { return s2 + (x - m) * (x - m); }, 0) / (ret.length - 1));
    var volTxt = A.scores.risk.vol; near(volTxt, sd * Math.sqrt(2268), sd * Math.sqrt(2268) * 0.02, 'yıllık oynaklık');
    var D = AN.analyze({ key: 'bist:TEST', kind: 'stock', name: 'TEST', currency: 'TRY', bars: h.map(function (b, i) { return Object.assign({}, b, { d: '2025-' + String(1 + Math.floor(i / 28) % 12).padStart(2, '0') + '-' + String(1 + i % 28).padStart(2, '0') }); }).slice(0, 300).sort(function (a, b) { return a.d < b.d ? -1 : 1; }), checks: [] }, {});
    eq(D.tf, '1d'); ok(/günlük/.test(JSON.stringify(D.scores.trend.ev)), 'günlük metin geri döner');
  });
  test('Haber konusu eşlemesi', function () {
    eq(MD.newsTopicOf('metal:XAU'), 'gold'); eq(MD.newsTopicOf('fx:USD'), 'fx'); eq(MD.newsTopicOf('cg:bitcoin'), 'crypto'); eq(MD.newsTopicOf('idx:XKTUM'), 'market'); eq(MD.newsTopicOf('bist:ASELS'), null); eq(MD.newsTopicOf('tefas:KTV'), null);
    eq(MD.describe('idx:XKTUM').label, 'Katılım Tüm endeksi');
  });

  /* ---------- 3. Seviye uyarıları ---------- */
  test('Uyarı: yön kurulumda belirlenir; yalnız gerçek fiyatla ve bir kez tetiklenir', function () {
    var a = AL.make({ key: 'bist:ASELS', name: 'ASELS', price: 306.24, refPrice: 341.5, label: 'Stop' }, '2026-11-17T10:00:00Z'), b = AL.make({ key: 'bist:ASELS', name: 'ASELS', price: 354, refPrice: 341.5, label: 'Hedef 1' });
    eq(a.dir, 'below'); eq(b.dir, 'above');
    var r = AL.evaluate([a, b], { 'bist:ASELS': { price: 330, at: 'x', source: 'TV' } }, '2026-11-17T11:00:00Z'); eq(r.fired.length, 0); eq(r.alerts[0].lastPrice, 330);
    r = AL.evaluate(r.alerts, { 'bist:ASELS': { price: 354, source: 'TV' } }, '2026-11-17T12:00:00Z'); eq(r.fired.length, 1); eq(r.fired[0].label, 'Hedef 1'); eq(r.fired[0].firedPrice, 354);
    var r2 = AL.evaluate(r.alerts, { 'bist:ASELS': { price: 360 } }, '2026-11-17T13:00:00Z'); eq(r2.fired.length, 0, 'tekrar tetiklenmez');
    r2 = AL.evaluate(r.alerts, { 'bist:ASELS': { price: 300 } }, 'z'); eq(r2.fired.length, 1); eq(r2.fired[0].label, 'Stop');
    eq(AL.evaluate([a], {}, 'z').fired.length, 0, 'fiyat yoksa beklemede'); eq(AL.evaluate([a], { 'bist:ASELS': { price: NaN } }, 'z').fired.length, 0);
    var re = AL.rearm(r.fired[0], 350); eq(re.dir, 'above'); ok(!re.triggeredAt); ok(re.id !== r.fired[0].id);
    var threw = 0; try { AL.make({ key: 'bist:ASELS', price: 10, refPrice: null }); } catch (e) { threw++; } try { AL.make({ key: 'bist:ASELS', price: -1, refPrice: 5 }); } catch (e) { threw++; } try { AL.make({ key: 'kötü', price: 1, refPrice: 2 }); } catch (e) { threw++; } eq(threw, 3);
  });
  test('Uyarı listesi doğrulama (durum dosyası / eşitleme): bozuk kayıtlar atılır, en fazla 50', function () {
    var list = [{ id: 'a', key: 'bist:ASELS', price: 1, dir: 'above' }, { id: 'a', key: 'bist:ASELS', price: 1, dir: 'above' }, { id: 'b', key: 'x:y', price: 1, dir: 'above' }, { id: 'c', key: 'cg:bitcoin', price: 0, dir: 'below' }, { id: 'd', key: 'cg:bitcoin', price: 5, dir: 'yukarı' }, null, 'x'];
    for (var i = 0; i < 70; i++) list.push({ id: 'z' + i, key: 'tefas:KTV', price: 8 + i, dir: 'below', name: 'KTV' });
    var c = AL.clean(list); eq(c.length, 50); eq(c[0].id, 'a'); ok(c.every(function (x) { return x.id !== 'b' && x.id !== 'c' && x.id !== 'd'; }));
    var st = S.cleanAnalysis({ watchlist: [], alerts: list }); eq(st.alerts.length, 50); eq(S.cleanAnalysis({ watchlist: [] }).alerts, undefined, 'uyarı alanı yoksa eklenmez');
  });

  function run() {
    var results = [], chain = Promise.resolve();
    tests.forEach(function (t) { chain = chain.then(function () { return Promise.resolve().then(t.fn); }).then(function () { results.push({ name: t.name, ok: true }); }, function (e) { results.push({ name: t.name, ok: false, err: e.message }); }); });
    return chain.then(function () { return results; });
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v7.1 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
