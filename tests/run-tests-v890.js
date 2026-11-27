/* v8.9.0 testleri: geçmiş performans (getiri, düşüş/toparlanma, dönemler, aylık, DCA/XIRR, TÜFE), Monte Carlo (tekrarlanabilir tohum,
 * yüzdelikler, olasılıklar, hedef ve gereken aylık tutar), stres eşlemesi, kayıt özeti (cleanPerf/compare), dosyalar ve sürüm. */
'use strict';
var fs = require('fs'), path = require('path');
module.exports.run = function () {
  var P = require('../js/perf.js'), L = require('../js/lab.js'), H = require('../js/help.js'), IB = require('../js/inbox.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= (tol || 1e-9))) throw new Error((msg || '') + ' beklenen ≈' + b + ', gelen ' + a); }
  function rd(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
  function days(from, n, fn) { var out = [], d = P.dayNum(from); for (var i = 0; i < n; i++) out.push({ d: P.ymdOf(d + i), c: fn(i) }); return out; }

  test('Hizalama: ortak başlangıç (en geç başlayan), tatil önceki kapanışla doldurulur (≤ 7 gün), uzun boşlukta gün atılır', function () {
    var a = [{ d: '2026-01-01', c: 10 }, { d: '2026-01-02', c: 11 }, { d: '2026-01-05', c: 12 }, { d: '2026-01-06', c: 13 }];
    var b = [{ d: '2026-01-02', c: 100 }, { d: '2026-01-03', c: 101 }, { d: '2026-01-06', c: 103 }];
    var r = P.align([a, b]);
    eq(r.dates, ['2026-01-02', '2026-01-03', '2026-01-05', '2026-01-06']); eq(r.px[0], [11, 11, 12, 13]); eq(r.px[1], [100, 101, 101, 103]);
    var c = [{ d: '2026-01-02', c: 1 }, { d: '2026-01-20', c: 2 }, { d: '2026-01-21', c: 3 }], r2 = P.align([c, days('2026-01-02', 20, function (i) { return 1 + i; })]);
    eq(r2.dates, ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-20', '2026-01-21'], 'boşluk > 7 gün atlanmalı');
  });
  test('Değer serisi: al-tut 50/50 (A ikiye katlanır, B sabit) → 1,5; aylık dengeleme elle hesapla aynı', function () {
    var dates = ['2026-01-30', '2026-01-31', '2026-02-02', '2026-02-27', '2026-03-02'], A = [1, 1.2, 1.2, 1.5, 2], B = [1, 1, 1, 1, 1];
    var bh = P.navOf(dates, [A, B], [5000, 5000], 'none'); near(bh[bh.length - 1], 1.5, 1e-12, 'al-tut');
    var mo = P.navOf(dates, [A, B], [1, 1], 'month');
    // 31.01: 0.5*1.2+0.5 = 1.1; 02.02 yeni ay → 1.1 dengelenir (A 0.55/1.2 adet); 27.02: 0.55*1.5/1.2+0.55 = 1.2375; 02.03: değer önce eski adetlerle 0.55*2/1.2+0.55 = 1.41667 + … → 0.6875*2/1.5+0.55
    near(mo[1], 1.1, 1e-12); near(mo[3], 1.2375, 1e-12); near(mo[4], 0.55 * 2 / 1.2 + 0.55, 1e-12);
    var q = P.navOf(dates, [A, B], [1, 1], 'quarter'); near(q[4], 1.5, 1e-12, 'aynı çeyrekte dengeleme yok → al-tut ile aynı');
  });
  test('Düşüş ve toparlanma: 100→120→90→100→130: −%25, zirve/dip/toparlanma tarihleri ve gün sayıları', function () {
    var d = ['2026-01-01', '2026-01-10', '2026-01-20', '2026-02-01', '2026-02-15'], v = [100, 120, 90, 100, 130], r = P.drawdown(d, v);
    near(r.mdd, -0.25); eq([r.peak, r.trough, r.recovered], ['2026-01-10', '2026-01-20', '2026-02-15']); eq([r.fallDays, r.recDays, r.underDays], [10, 26, 36]); eq(r.current, 0);
    var r2 = P.drawdown(d.slice(0, 4), v.slice(0, 4)); eq(r2.recovered, null); eq(r2.recDays, null); near(r2.current, 100 / 120 - 1);
  });
  test('İstatistik: sabit büyüme → oynaklık 0, Sharpe yok; tam 2 yıl %21 → yıllık ≈ %10; Sortino eşiği (TÜFE) uygulanır', function () {
    var n = 731, g = Math.pow(1.21, 1 / (n - 1)), d = days('2024-01-01', n, function () { return 0; }).map(function (x) { return x.d; }), v = d.map(function (_, i) { return Math.pow(g, i); });
    var s = P.stats(d, v, { hurdle: 0 }); near(s.total, 0.21, 1e-9); near(s.cagr, Math.pow(1.21, 365.25 / 730) - 1, 1e-9); ok(s.annualized); near(s.vol, 0, 1e-12); eq(s.sharpe, null);
    var r = P.rng(3), v2 = [1]; for (var i = 1; i < n; i++) v2.push(v2[i - 1] * (1 + (r() - 0.5) * 0.04));
    var a = P.stats(d, v2, { hurdle: 0 }), b = P.stats(d, v2, { hurdle: 0.3 }); ok(b.sharpe < a.sharpe && b.sortino < a.sortino, 'eşik yükselince Sharpe/Sortino düşmeli'); ok(a.vol > 0.15 && a.vol < 0.22, 'oynaklık ' + a.vol + ' (beklenen ≈ 0,04/√12·√252 = 0,183)');
  });
  test('Dönem getirisi: 1 ay doğru başlangıç günü; veri yetmeyen dönem null (veri yetersiz); Maks = ilk gün', function () {
    var s = days('2026-01-01', 90, function (i) { return 100 + i; }), d = s.map(function (x) { return x.d; }), v = s.map(function (x) { return x.c; });
    var r = P.periodRet(d, v, 1); eq(r.from, '2026-02-28'); near(r.r, v[89] / v[58] - 1);
    eq(P.periodRet(d, v, 6), null); eq(P.periodRet(d, v, 0).from, '2026-01-01'); eq(P.addMonths('2026-03-31', -1), '2026-02-28'); eq(P.addMonths('2026-01-15', -13), '2024-12-15');
  });
  test('Aylık getiriler + en iyi/kötü ay (eksik ilk/son ay hariç)', function () {
    var d = ['2026-01-15', '2026-01-31', '2026-02-10', '2026-02-28', '2026-03-31', '2026-04-05'], v = [100, 110, 99, 121, 108.9, 110];
    var m = P.monthly(d, v); eq(m.map(function (x) { return x.ym; }), ['2026-01', '2026-02', '2026-03', '2026-04']);
    near(m[0].r, 0.1); near(m[1].r, 0.1); near(m[2].r, -0.1); ok(m[0].partialStart && m[3].partialEnd);
    var bw = P.bestWorstMonth(m); eq([bw.best.ym, bw.worst.ym, bw.pos, bw.n], ['2026-02', '2026-03', 1, 2]);
  });
  test('DCA: sabit fiyatta değer = yatırılan, XIRR ≈ 0; fiyat sonda 2 katı → değer 2 kat; XIRR: −100 → +110 bir yılda = %10', function () {
    var s = days('2026-01-01', 120, function () { return 50; }), d = s.map(function (x) { return x.d; }), v = s.map(function (x) { return x.c; });
    var r = P.dca(d, v, 1000, 100); eq(r.invested, 1000 + 100 * 3); near(r.value, 1300, 1e-9); near(r.irr, 0, 1e-6); eq(r.n, 4);
    var v2 = v.slice(); v2[v2.length - 1] = 100; var r2 = P.dca(d, v2, 1000, 100); near(r2.value, 2600, 1e-9); ok(r2.irr > 1, 'yüksek yıllık getiri');
    near(P.xirr([{ t: 0, cf: -100 }, { t: 1, cf: 110 }]), 0.1, 1e-7); near(P.xirr([{ t: 0, cf: -100 }, { t: 0.5, cf: -100 }, { t: 1, cf: 215 }]), P.xirr([{ t: 0, cf: -100 }, { t: 0.5, cf: -100 }, { t: 1, cf: 215 }]), 0);
    eq(P.xirr([{ t: 0, cf: -100 }]), null);
  });
  test('TÜFE: aylık %1 sabit → 12 ay çarpanı 1,01^12; ay içi gün oranı; açıklanmamış ay son 12 ay ortalamasıyla TAHMİN (est) işaretli', function () {
    var ms = []; for (var y = 2024; y <= 2025; y++) for (var m = 1; m <= 12; m++) ms.push({ ym: y + '-' + String(m).padStart(2, '0'), m: 1 });
    var C = P.cpiPrep(ms); near(C.y12, Math.pow(1.01, 12) - 1, 1e-12); near(C.avgM, 0.01, 1e-12);
    var f = P.cpiFactor(C, '2024-01-31', '2025-01-31'); near(f.f, Math.pow(1.01, 12), 1e-12); eq(f.est, false);
    var f2 = P.cpiFactor(C, '2025-01-31', '2026-03-31'); near(f2.f, Math.pow(1.01, 14), 1e-12); eq(f2.est, true);
    eq(P.cpiPrep(ms.slice(0, 5)), null); eq(P.cpiFactor(C, '2023-05-01', '2024-05-01'), null);
  });
  test('Yüzdelik: doğrusal ara değer; rastgele sayı tohumla tekrarlanır', function () {
    near(P.quantile([1, 2, 3, 4], 0.5), 2.5); near(P.quantile([10, 0, 5], 0.25), 2.5); near(P.quantile([7], 0.95), 7);
    var a = P.rng(42), b = P.rng(42), xs = [], ys = []; for (var i = 0; i < 5; i++) { xs.push(a()); ys.push(b()); } eq(xs, ys); ok(xs.every(function (x) { return x >= 0 && x < 1; }));
  });
  test('Monte Carlo: sabit günlük getiri → A, B kesin; tüm yüzdelikler eşit; zarar olasılığı 0; aynı tohum = aynı sonuç', function () {
    var r = 0.001, rp = []; for (var i = 0; i < 300; i++) rp.push(r);
    var mc = P.monteCarlo({ rp: rp, rx: rp.map(function () { return 0; }), months: 24, paths: 200, seed: 7 }), gM = Math.pow(1 + r, 21);
    near(mc.A[11], Math.pow(gM, 12), 1e-4); var Bx = 0; for (var k = 0; k < 12; k++) Bx = Bx * gM + 1; near(mc.B[11], Bx, 1e-3);
    var s = P.summaryAt(mc, 12, 10000, 500, 0); near(s.p5, s.p95, 1e-6); near(s.p50, 10000 * Math.pow(gM, 12) + 500 * Bx, 0.05); eq(s.pLoss, 0); eq(s.pBeatUsd, 1); eq(s.invested, 16000);
    var r2 = P.rng(9), rp2 = []; for (var j = 0; j < 400; j++) rp2.push((r2() - 0.49) * 0.03);
    var m1 = P.monteCarlo({ rp: rp2, months: 12, paths: 300, seed: 5 }), m2 = P.monteCarlo({ rp: rp2, months: 12, paths: 300, seed: 5 }), m3 = P.monteCarlo({ rp: rp2, months: 12, paths: 300, seed: 6 });
    eq(Array.from(m1.A.slice(0, 50)), Array.from(m2.A.slice(0, 50))); ok(Array.from(m1.A.slice(0, 50)).join() !== Array.from(m3.A.slice(0, 50)).join());
    var t = P.summaryAt(m1, 12, 1000, 0, null); ok(t.p5 <= t.p25 && t.p25 <= t.p50 && t.p50 <= t.p75 && t.p75 <= t.p95, 'yüzdelik sırası'); eq(t.pBeatUsd, null); eq(t.pBeatInfl, null);
    ok(P.monteCarlo({ rp: rp.slice(0, 30) }).error, 'kısa geçmiş → hata');
  });
  test('Monte Carlo: temkinli kaydırma (drift) sabit seride yıllık büyümeyi tam hedefe çeker; dolar yolu (X, BX) ve "doları yenme"', function () {
    var rp = []; for (var i = 0; i < 300; i++) rp.push(0.004);
    var mc = P.monteCarlo({ rp: rp, months: 24, paths: 50, seed: 1, drift: 0.3 }); near(mc.A[11], 1.3, 1e-4); near(mc.A[23], 1.69, 1e-4);
    var rx = rp.map(function () { return 0.002; }), m2 = P.monteCarlo({ rp: rp.map(function () { return 0.001; }), rx: rx, months: 12, paths: 20, seed: 1 });
    near(m2.X[11], Math.pow(1.002, 252), 1e-3); eq(P.summaryAt(m2, 12, 100, 10, null).pBeatUsd, 0, 'portföy dolardan yavaş büyüyor');
    near(P.inflInvested(12, 100, 0, 0.3), 130, 1e-9); eq(P.invested(12, 100, 10), 220);
  });
  test('Hedef: sabit getiride gereken aylık tutar kesin; o tutarla olasılık %100, biraz azıyla %0; dolar hedefi kur yoluyla büyür', function () {
    var rp = []; for (var i = 0; i < 300; i++) rp.push(0.0005);
    var mc = P.monteCarlo({ rp: rp, rx: rp.map(function () { return 0.001; }), months: 60, paths: 100, seed: 3 }), m = 36;
    var c = P.requiredContrib(mc, m, 10000, 100000, 'TRY', 1, 0.75); ok(c > 0);
    eq(P.goalProb(mc, m, 10000, c * 1.0001, 100000, 'TRY', 1), 1); eq(P.goalProb(mc, m, 10000, c * 0.999, 100000, 'TRY', 1), 0);
    var cU = P.requiredContrib(mc, m, 10000, 3000, 'USD', 40, 0.5); ok(cU > P.requiredContrib(mc, m, 10000, 120000, 'TRY', 1, 0.5), 'kur artışı hedefi büyütür');
    eq(P.requiredContrib(mc, m, 1e9, 100000, 'TRY', 1, 0.9), 0, 'zaten yeterli → 0');
    var mcNoX = P.monteCarlo({ rp: rp, months: 12, paths: 10 }); eq(P.goalProb(mcNoX, 12, 1, 1, 10, 'USD', 40), null);
  });
  test('Hız: 5.000 yol × 120 ay (Monte Carlo) Node\'da < 1,5 sn', function () {
    var r = P.rng(1), rp = [], rx = []; for (var i = 0; i < 750; i++) { rp.push((r() - 0.48) * 0.03); rx.push((r() - 0.45) * 0.01); }
    var t = Date.now(), mc = P.monteCarlo({ rp: rp, rx: rx, months: 120, paths: 5000, seed: 20261127 }), ms = Date.now() - t; ok(!mc.error && ms < 1500, ms + ' ms');
    var t2 = Date.now(); P.summaryAt(mc, 60, 10000, 1000, 0.3); P.fan(mc, 10000, 1000, 2); ok(Date.now() - t2 < 1500, 'özet + yelpaze yavaş');
  });
  test('Beta ve stres: eşleme türleri (BIST beta, altın = ons × kur, ABD = beta × S&P × kur, nakit 0), ağırlık ve kapsam', function () {
    var f = [], a = []; for (var i = 0; i < 100; i++) { var x = Math.sin(i) * 0.01; f.push(x); a.push(1.5 * x); } near(P.beta(a, f), 1.5, 1e-12); eq(P.beta(a.slice(0, 10), f.slice(0, 10)), null);
    var F = { XU100: -0.2, USDTRY: 0.4, XAUUSD: -0.02, XAGUSD: null, SPY: 0.01 };
    near(P.shockOf({ type: 'xu100', beta: 1.2 }, F), -0.24); near(P.shockOf({ type: 'gold' }, F), 0.98 * 1.4 - 1); near(P.shockOf({ type: 'spy', beta: 2 }, F), 1.02 * 1.4 - 1); eq(P.shockOf({ type: 'silver' }, F), null); eq(P.shockOf({ type: 'cash' }, F), 0);
    var s = P.stress([{ name: 'A', w: 5000, map: { type: 'xu100', beta: 1 } }, { name: 'B', w: 3000, map: { type: 'usd' } }, { name: 'C', w: 2000, map: { type: 'silver' } }], F);
    near(s.r, (5000 * -0.2 + 3000 * 0.4) / 8000); near(s.coverage, 0.8); eq(s.missing, ['C']); near(s.usd, (1 + s.r) / 1.4 - 1);
  });
  test('Kayıt: geçmiş/gelecek özeti (perf) temizlenir ve korunur; bozuk alan atılır; karşılaştırmaya gelir', function () {
    var base = { id: 'lpabc123', name: 'X', positions: [], filters: L.defaultFilters() };
    var c = L.cleanOne(Object.assign({}, base, { perf: { at: '2026-11-27T08:00:00Z', r1y: 0.31, rMax: 0.9, cagr: 0.25, mdd: -0.18, vol: 0.2, sharpe: 0.4, mc12: { p5: -0.1, p50: 0.2, p95: 0.6, pLoss: 0.18, x: 'kötü' }, mc36: { p50: 0.8, pLoss: 0.08 }, evil: '<script>' } }));
    eq(c.perf.r1y, 0.31); eq(c.perf.mc12, { p5: -0.1, p50: 0.2, p95: 0.6, pLoss: 0.18 }); ok(!('evil' in c.perf));
    eq(L.cleanOne(Object.assign({}, base, { perf: 'bozuk' })).perf, null); eq(L.cleanOne(base).perf, null);
    eq(L.compare([c], [null])[0].perf.mc12.p50, 0.2);
  });
  test('Yardım kutuları: dört yeni bölüm başlığı doğru yardıma eşlenir', function () {
    eq(H.find('Geçmiş performans: bu portföy ne kazandırırdı?', 'analiz', 'olustur'), 'lab-past'); eq(H.find('Gelecek tahmini: ne kazandırabilir?', 'analiz', 'portfoylerim'), 'lab-future');
    eq(H.find('Stres testi: kriz senaryoları', 'analiz', 'olustur'), 'lab-stress'); eq(H.find('Hedef hesaplayıcı', 'analiz', 'olustur'), 'lab-goal');
    ['lab-past', 'lab-future', 'lab-stress', 'lab-goal'].forEach(function (k) { var e = H.entries[k]; ok(e && e.n && e.u && e.r, k + ' eksik'); });
  });
  test('Referans veriler: TÜFE (TÜİK/TCMB, ≥ 24 ay, kaynak + tarih) ve kriz dönemleri (gerçek faktör getirileri, kaynak)', function () {
    var t = JSON.parse(rd('refdata/tufe.json')); ok(t.months.length >= 24 && /TCMB/.test(t.source) && /^\d{4}-\d{2}-\d{2}T/.test(t.fetchedAt));
    t.months.forEach(function (m) { ok(/^\d{4}-\d{2}$/.test(m.ym) && typeof m.m === 'number' && m.m > -10 && m.m < 30, 'TÜFE satırı ' + JSON.stringify(m)); });
    var C = P.cpiPrep(t.months); ok(C && C.y12 > 0 && C.y12 < 2);
    var s = JSON.parse(rd('refdata/stres.json')); ok(s.windows.length >= 4 && /Yahoo/.test(s.source));
    s.windows.forEach(function (w) { ok(w.from < w.to && w.label && w.f && typeof w.f.XU100 === 'number' && typeof w.f.USDTRY === 'number', w.id); });
    var py = rd('tools/fetch_market_data.py'); ok(/def tufe_job/.test(py) && /def parse_tufe/.test(py) && /index\['tufe'\] = tufe_job\(\)/.test(py), 'günlük iş TÜFE\'yi tazelemeli');
  });
  test('Sayfa ve kabuk: perf.js / perf-ui.js lab-ui.js\'ten önce; perf-worker kabukta; CSP worker izni; sürüm 8.9.0 her yerde; migrate.js aynı', function () {
    var idx = rd('index.html'), sw = rd('sw.js');
    var a = idx.indexOf('js/perf.js?v=8.9.0'), b = idx.indexOf('js/perf-ui.js?v=8.9.0'), c = idx.indexOf('js/lab-ui.js?v=8.9.0'); ok(a > 0 && b > a && c > b, 'sıra');
    ['perf', 'perf-ui', 'perf-worker'].forEach(function (f) { ok(sw.indexOf("'" + f + "'") > 0, f + ' kabukta'); });
    ok(/worker-src 'self'/.test(idx)); eq(IB.APP_VERSION, '8.9.0'); ok(/VERSION = '8\.9\.0'/.test(sw)); ok(idx.indexOf('?v=8.8.3') < 0 && idx.indexOf('css/style.css?v=8.9.0') > 0);
    ok(/importScripts\('perf\.js'/.test(rd('js/perf-worker.js'))); ok(/sifirdan-midas-v2-2026-11-25/.test(rd('js/migrate.js')));
    var ui = rd('js/perf-ui.js'); ok(/geleceğin garantisi değildir/.test(ui) && /söz değildir/.test(ui) && /Veri yetersiz/.test(ui), 'uyarılar ve veri yetersiz metni');
  });

  return Promise.resolve(tests.map(function (t) { try { t.fn(); return { name: t.name, ok: true }; } catch (e) { return { name: t.name, ok: false, err: e.message }; } }));
};
if (require.main === module) module.exports.run().then(function (r) { var p = r.filter(function (x) { return x.ok; }).length; r.forEach(function (x) { console.log((x.ok ? '✓ ' : '✗ ') + x.name + (x.ok ? '' : '  → ' + x.err)); }); console.log(p + '/' + r.length); if (p !== r.length) process.exit(1); });
