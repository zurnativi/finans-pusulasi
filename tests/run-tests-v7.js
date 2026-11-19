/* v7 testleri: Portföy Analizi motoru — göstergeler (TA-Lib referansı), grafik yapısı, veri katmanı ve doğrulama, skor/plan/sağlık/oluşturucu.
 * Çalıştırma: node tests/run-tests-v7.js (run-tests.js de sonunda bunu çalıştırır). Ağ erişimi gerekmez. */
(function () {
  var fs = require('fs'), npath = require('path');
  var TA = require('../js/ta.js'), ST = require('../js/structure.js'), MD = require('../js/mdata.js'), AN = require('../js/analysis.js'), S = require('../js/sample.js');
  var REF = JSON.parse(fs.readFileSync(npath.join(__dirname, 'fixtures', 'ta-reference.json'), 'utf8'));
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '') + ' beklenen ≈' + b + ', gelen ' + a); }
  function lastN(a) { for (var i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; }

  /* ---------- 1. Göstergeler: TA-Lib 0.8.3 / pandas_ta / bağımsız uygulama referansına karşı (ASELS ve BTCUSDT gerçek verisi) ---------- */
  // Karşılaştırma: referansın dolu olduğu her noktada bizim değer de dolu olmalı ve göreli fark ≤ 1e-8
  function cmpSeries(ours, ref, label, opts) {
    opts = opts || {}; var n = 0, mx = 0;
    for (var i = 0; i < ref.length; i++) {
      if (ref[i] == null) continue;
      if (ours[i] == null) throw new Error(label + ': ' + i + '. noktada değer yok (referans ' + ref[i] + ')');
      var d = Math.abs(ours[i] - ref[i]) / Math.max(1, Math.abs(ref[i])); if (d > mx) mx = d; n++;
      if (d > (opts.tol || 1e-8)) throw new Error(label + ': ' + i + '. noktada fark ' + d.toExponential(2) + ' (bizim ' + ours[i] + ', referans ' + ref[i] + ')');
    }
    if (n < (opts.minN || 50)) throw new Error(label + ': yalnızca ' + n + ' nokta karşılaştırıldı');
    return mx;
  }
  var IND = {
    SMA20: function (I) { return TA.sma(I.c, 20); }, EMA20: function (I) { return TA.ema(I.c, 20); }, EMA50: function (I) { return TA.ema(I.c, 50); }, WMA10: function (I) { return TA.wma(I.c, 10); },
    RSI14: function (I) { return TA.rsi(I.c, 14); }, MACD: function (I) { return TA.macd(I.c).macd; }, MACDsignal: function (I) { return TA.macd(I.c).signal; }, MACDhist: function (I) { return TA.macd(I.c).hist; },
    ATR14: function (I) { return TA.atr(I.h, I.l, I.c, 14); }, TRANGE: function (I) { return TA.trueRange(I.h, I.l, I.c); },
    BBupper: function (I) { return TA.bollinger(I.c, 20, 2).upper; }, BBlower: function (I) { return TA.bollinger(I.c, 20, 2).lower; }, BBmid: function (I) { return TA.bollinger(I.c, 20, 2).mid; },
    ADX14: function (I) { return TA.adx(I.h, I.l, I.c, 14).adx; }, PLUS_DI14: function (I) { return TA.adx(I.h, I.l, I.c, 14).pdi; }, MINUS_DI14: function (I) { return TA.adx(I.h, I.l, I.c, 14).mdi; },
    STOCHk: function (I) { return TA.stoch(I.h, I.l, I.c, 14, 3, 3).k; }, STOCHd: function (I) { return TA.stoch(I.h, I.l, I.c, 14, 3, 3).d; },
    STOCHRSIfastk: function (I) { return TA.stochRsi(I.c, 14, 14, 3, 3).raw; }, STOCHRSIfastd: function (I) { return TA.stochRsi(I.c, 14, 14, 3, 3).k; },
    OBV: function (I) { return TA.obv(I.c, I.v); }, CCI20: function (I) { return TA.cci(I.h, I.l, I.c, 20); }, WILLR14: function (I) { return TA.willr(I.h, I.l, I.c, 14); }, MFI14: function (I) { return TA.mfi(I.h, I.l, I.c, I.v, 14); },
    ROC10: function (I) { return TA.roc(I.c, 10); }, STDDEV20: function (I) { return TA.stdev(I.c, 20, 0); },
    ICH_tenkan: function (I) { return TA.ichimoku(I.h, I.l, I.c).tenkan; }, ICH_kijun: function (I) { return TA.ichimoku(I.h, I.l, I.c).kijun; }, ICH_spanA: function (I) { return TA.ichimoku(I.h, I.l, I.c).senkouA; }, ICH_spanB: function (I) { return TA.ichimoku(I.h, I.l, I.c).senkouB; },
    ST10_3: function (I) { return TA.supertrend(I.h, I.l, I.c, 10, 3).line; }, ST10_3dir: function (I) { return TA.supertrend(I.h, I.l, I.c, 10, 3).dir; },
    VWAPanch0: function (I) { return TA.vwapAnchored(I.h, I.l, I.c, I.v, 0); }
  };
  Object.keys(REF.series).forEach(function (sn) {
    Object.keys(IND).forEach(function (k) {
      test('Gösterge ' + k + ' = referans (' + sn + ', ' + REF.series[sn].input.c.length + ' gün)', function () {
        var R = REF.series[sn]; ok(R.ref[k], 'referans yok: ' + k); cmpSeries(IND[k](R.input), R.ref[k], sn + ' ' + k);
      });
    });
  });
  test('Referans dosyası tüm göstergeleri kapsıyor (test edilmeyen referans yok)', function () {
    Object.keys(REF.series).forEach(function (sn) { Object.keys(REF.series[sn].ref).forEach(function (k) { ok(IND[k], 'test edilmeyen referans: ' + k); }); });
  });
  test('Göstergeler: el hesabı küçük örnekler (SMA, EMA tohumu, RSI sınırları, ATR ilk değer)', function () {
    var c = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    eq(TA.sma(c, 3).slice(0, 4), [null, null, 2, 3]);
    var e = TA.ema(c, 3); eq(e[2], 2); near(e[3], 3, 1e-12); // SMA tohumlu, k=0.5: 2 + 0.5*(4-2) = 3
    var up = []; for (var i = 0; i < 30; i++) up.push(100 + i); eq(lastN(TA.rsi(up, 14)), 100, 'hep yükselen seride RSI 100');
    var dn = up.slice().reverse(); eq(lastN(TA.rsi(dn, 14)), 0, 'hep düşen seride RSI 0');
    var h = [], l = [], cc = []; for (i = 0; i < 20; i++) { h.push(11); l.push(9); cc.push(10); } near(lastN(TA.atr(h, l, cc, 14)), 2, 1e-12, 'sabit aralıkta ATR = aralık');
  });
  test('İstatistik: en büyük düşüş, CAGR, korelasyon, beta, doğrusal regresyon', function () {
    var md = TA.maxDrawdown([100, 120, 90, 130, 65, 70]); near(md.mdd, -0.5, 1e-12); eq(md.from, 3); eq(md.to, 4);
    near(TA.cagr([100, 121], 730), 0.1, 1e-3, 'iki yılda %21 → yıllık ≈ %10');
    near(TA.correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12); near(TA.correlation([1, 2, 3, 4], [8, 6, 4, 2]), -1, 1e-12);
    var lr = TA.linreg([0, 1, 2, 3], [1, 3, 5, 7]); near(lr.slope, 2, 1e-12); near(lr.intercept, 1, 1e-12);
    var a = [], b = []; for (var i = 0; i < 50; i++) { var r = Math.sin(i) * 0.01; a.push(r * 2); b.push(r); } near(TA.beta(a, b), 2, 1e-9, 'beta');
  });
  test('Hacim profili: POC en çok hacmin olduğu fiyat aralığında, değer alanı POC\'u kapsar', function () {
    var h = [], l = [], v = []; for (var i = 0; i < 120; i++) { var p = i % 10 === 0 ? 150 : 100 + (i % 7); h.push(p + 1); l.push(p - 1); v.push(i % 10 === 0 ? 10 : 1000); }
    var vp = TA.volumeProfile(h, l, v, 120, 24); ok(vp.poc > 98 && vp.poc < 108, 'POC ' + vp.poc); ok(vp.vaLow <= vp.poc && vp.vaHigh >= vp.poc);
  });

  /* ---------- 2. Grafik yapısı (sentetik, sonucu bilinen şekiller) ---------- */
  // Dalga noktalarından mum dizisi üret (doğrusal ara değer, sabit ±0,5 fitil)
  function mkPath(points, wick) {
    var c = []; for (var k = 0; k < points.length - 1; k++) { var a = points[k], b = points[k + 1]; for (var i = a[0]; i < b[0]; i++) c.push(a[1] + (b[1] - a[1]) * (i - a[0]) / (b[0] - a[0])); }
    c.push(points[points.length - 1][1]); var w = wick == null ? 0.5 : wick;
    return { c: c, o: c.map(function (x, i) { return i ? c[i - 1] : x; }), h: c.map(function (x, i) { return Math.max(x, i ? c[i - 1] : x) + w; }), l: c.map(function (x, i) { return Math.min(x, i ? c[i - 1] : x) - w; }), v: c.map(function () { return 1000; }) };
  }
  function bars(p, start) { var d0 = Date.UTC(2024, 0, 1), out = [], j = 0; for (var i = 0; out.length < p.c.length; i++) { var dt = new Date(d0 + i * 86400000); if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue; out.push({ d: dt.toISOString().slice(0, 10), o: p.o[j], h: p.h[j], l: p.l[j], c: p.c[j], v: p.v[j] }); j++; } return out; }
  test('Pivotlar: soldan katı, sağdan eşitliğe izin veren tepe/dip', function () {
    var h = [1, 2, 3, 2, 1, 2, 5, 5, 4, 3, 2], l = h.map(function (x) { return x - 1; });
    var pv = ST.pivots(h, l, 2, 2), hi = pv.filter(function (p) { return p.type === 'H'; }).map(function (p) { return p.i; });
    ok(hi.indexOf(2) >= 0, 'i=2 tepe'); ok(hi.indexOf(6) >= 0, 'i=6 tepe (sağdaki eşit tepe kabul)'); ok(hi.indexOf(7) < 0, 'i=7 soldan katı değil');
  });
  test('Zikzak: ATR eşiğinden küçük dalgalar yok sayılır, tepe/dip sırayla gelir', function () {
    var p = mkPath([[0, 100], [20, 120], [25, 118], [30, 121], [50, 100], [70, 125]]), atr = p.c.map(function () { return 2; });
    var sw = ST.zigzag(p.h, p.l, atr, 2.5);
    for (var i = 1; i < sw.length; i++) ok(sw[i].type !== sw[i - 1].type, 'ardışık aynı tür');
    ok(!sw.some(function (s) { return s.i === 25; }), '2 puanlık geri çekilme (eşik 5) salınım sayılmamalı');
    ok(sw.some(function (s) { return s.type === 'H' && s.i >= 29 && s.i <= 31; }) && sw.some(function (s) { return s.type === 'L' && s.i >= 49 && s.i <= 51; }), JSON.stringify(sw));
  });
  test('Destek/direnç bölgesi: üç kez dönülen seviye güçlü bölge olur, genişliği ≤ 1 ATR', function () {
    var p = mkPath([[0, 110], [15, 100], [30, 112], [45, 100.4], [60, 113], [75, 99.8], [95, 120], [100, 118]]), atr = p.c.map(function () { return 2; });
    var z = ST.zones(p.h, p.l, p.c, atr), s = z.filter(function (x) { return x.lo <= 100 && x.hi >= 99.5; })[0];
    ok(s, 'bölge bulunamadı: ' + JSON.stringify(z.map(function (x) { return [x.lo, x.hi, x.touches]; })));
    ok(s.touches >= 3, 'dokunuş ' + s.touches); ok(s.hi - s.lo <= 2 + 1e-9, 'genişlik ' + (s.hi - s.lo));
    var nr = ST.nearest(z, 118, 'support'); ok(nr && nr.hi < 118, 'en yakın destek fiyatın altında');
  });
  test('Trend çizgisi: yükselen diplerden geçen ve kapanışla kırılmamış destek çizgisi', function () {
    var p = mkPath([[0, 100], [12, 110], [24, 104], [36, 116], [48, 108], [60, 122], [72, 112], [84, 128], [90, 124]]), atr = p.c.map(function () { return 2; });
    var T = ST.trendlines(p.h, p.l, p.c, atr); ok(T.support, 'destek çizgisi yok'); ok(T.support.slope > 0, 'eğim pozitif olmalı'); ok(T.support.touches >= 3, 'dokunuş ' + T.support.touches);
    ok(T.support.value < p.c[p.c.length - 1], 'çizgi fiyatın altında'); near(ST.lineAt(T.support, T.support.a.i), T.support.a.p, 1e-9);
  });
  test('Fibonacci: son onaylı salınımdan %38,2 / %50 / %61,8 geri çekilme ve uzantılar', function () {
    var sw = [{ i: 10, p: 100, type: 'L' }, { i: 40, p: 200, type: 'H' }, { i: 50, p: 180, type: 'L', tentative: true }];
    var f = ST.fibonacci(sw, 5); ok(f && f.up, 'yükseliş salınımı'); var r = {}; f.retr.forEach(function (x) { r[x.r] = x.p; });
    near(r[0.382], 161.8, 1e-9); near(r[0.5], 150, 1e-9); near(r[0.618], 138.2, 1e-9);
    var e = {}; f.ext.forEach(function (x) { e[x.r] = x.p; }); near(e[1.618], 261.8, 1e-9);
    eq(ST.fibonacci([{ i: 1, p: 100, type: 'L' }, { i: 5, p: 104, type: 'H' }], 5), null, '3 ATR\'den küçük salınım için Fibonacci yok');
  });
  function col(p) { return { h: p.h, l: p.l, c: p.c, v: p.v, o: p.o }; }
  function flat(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
  test('Formasyon: ikili tepe (boyun kırılmış → onaylandı, hedef = boyun − derinlik)', function () {
    var p = mkPath([[0, 90], [20, 110], [35, 100], [50, 110.3], [62, 97]]), sw = [{ i: 0, p: 90, type: 'L' }, { i: 20, p: 110.5, type: 'H' }, { i: 35, p: 99.5, type: 'L' }, { i: 50, p: 110.8, type: 'H' }];
    var P = ST.patterns(col(p), sw, flat(p.c.length, 2), null), d = P.filter(function (x) { return x.type === 'double_top'; })[0];
    ok(d, 'ikili tepe bulunamadı: ' + JSON.stringify(P.map(function (x) { return x.type; }))); eq(d.status, 'onaylandı'); near(d.target, 99.5 - (110.65 - 99.5), 1e-9); ok(d.dir === -1 && d.invalidation > 110.8);
  });
  test('Formasyon: ikili dip oluşuyor (boyun kırılmadı → güven ≤ 55)', function () {
    var p = mkPath([[0, 120], [20, 100], [35, 110], [50, 100.2], [58, 106]]), sw = [{ i: 0, p: 120, type: 'H' }, { i: 20, p: 99.5, type: 'L' }, { i: 35, p: 110.5, type: 'H' }, { i: 50, p: 99.7, type: 'L' }];
    var d = ST.patterns(col(p), sw, flat(p.c.length, 2), null).filter(function (x) { return x.type === 'double_bottom'; })[0];
    ok(d, 'ikili dip yok'); eq(d.status, 'oluşuyor'); ok(d.conf <= 55, 'onaysız formasyon güveni ' + d.conf);
  });
  test('Formasyon: omuz-baş-omuz ve ters OBO', function () {
    var sw = [{ i: 0, p: 100, type: 'L' }, { i: 10, p: 110, type: 'H' }, { i: 20, p: 102, type: 'L' }, { i: 30, p: 118, type: 'H' }, { i: 40, p: 102, type: 'L' }, { i: 50, p: 110.5, type: 'H' }];
    var p = mkPath([[0, 100], [10, 110], [20, 102], [30, 118], [40, 102], [50, 110.5], [60, 99]]);
    var hs = ST.patterns(col(p), sw.slice(1), flat(p.c.length, 2), null).filter(function (x) { return x.type === 'head_shoulders'; })[0];
    ok(hs, 'OBO yok'); eq(hs.status, 'onaylandı'); near(hs.target, 102 - 16, 1e-9);
    var inv = sw.slice(1).map(function (s) { return { i: s.i, p: 220 - s.p, type: s.type === 'H' ? 'L' : 'H' }; }), pi = mkPath([[0, 120], [10, 110], [20, 118], [30, 102], [40, 118], [50, 109.5], [60, 121]]);
    ok(ST.patterns(col(pi), inv, flat(pi.c.length, 2), null).some(function (x) { return x.type === 'inv_head_shoulders' && x.status === 'onaylandı'; }), 'TOBO yok');
  });
  test('Formasyon: yükselen üçgen (yatay tepeler, yükselen dipler)', function () {
    var pts = [[0, 100], [10, 120], [20, 104], [30, 120.2], [40, 108], [50, 119.9], [60, 112], [64, 116]], p = mkPath(pts);
    var sw = pts.slice(0, 7).map(function (x, i) { return { i: x[0], p: x[1], type: i % 2 ? 'H' : 'L' }; });
    var t = ST.patterns(col(p), sw, flat(p.c.length, 2), null).filter(function (x) { return x.type === 'asc_triangle'; })[0];
    ok(t, 'yükselen üçgen yok'); eq(t.status, 'oluşuyor'); ok(t.targetUp > 120, 'yukarı hedef');
  });
  test('Formasyon: boğa bayrağı (güçlü direk + sığ geri çekilme)', function () {
    var p = mkPath([[0, 100], [40, 100.5], [50, 130], [62, 124], [66, 125]]), atr = flat(p.c.length, 2);
    var sw = [{ i: 40, p: 100, type: 'L' }, { i: 50, p: 130.5, type: 'H' }, { i: 62, p: 123.5, type: 'L', tentative: true }];
    var f = ST.patterns(col(p), sw, atr, null).filter(function (x) { return x.type === 'bull_flag'; })[0];
    ok(f, 'bayrak yok'); eq(f.status, 'oluşuyor'); ok(f.target > 130, 'hedef direk boyu kadar yukarı');
  });
  test('Uyumsuzluk: fiyat daha düşük dip, RSI daha yüksek dip → pozitif uyumsuzluk', function () {
    var h = [], l = [], osc = [];
    for (var i = 0; i < 40; i++) { var base = i < 10 ? 110 - i : i < 15 ? 100 + (i - 10) * 2 : i < 25 ? 110 - (i - 15) * 1.2 : 98 + (i - 25) * 0.8; h.push(base + 0.5); l.push(base - 0.5); osc.push(i === 10 ? 25 : i === 25 ? 35 : 45); }
    var d = ST.divergences(h, l, osc); ok(d.some(function (x) { return x.type === 'bull'; }), JSON.stringify(d));
    ok(!ST.divergences(h, l, osc.map(function (x, i) { return i === 25 ? 20 : x; })).some(function (x) { return x.type === 'bull'; }), 'RSI de düşük dip yaptıysa uyumsuzluk yok');
  });

  /* ---------- 3. Veri katmanı ve doğrulama ---------- */
  test('Ayrıştırıcılar: market-data dosyası, Binance mumları (kapanmamış mum işaretli), TEFAS geçmişi', function () {
    var md = MD.parseMd({ cols: ['d', 'o', 'h', 'l', 'c', 'v'], bars: [['2026-11-16', 1, 2, 0.5, 1.5, 100], ['2026-11-17', 1.5, 2.5, 1, 2, null]] });
    eq(md.bars[1], { d: '2026-11-17', o: 1.5, h: 2.5, l: 1, c: 2, v: null });
    var now = Date.UTC(2026, 10, 17, 12), k = MD.parseBinanceKlines([[Date.UTC(2026, 10, 16), '1', '2', '0.5', '1.5', '10', Date.UTC(2026, 10, 16, 23, 59, 59, 999)], [Date.UTC(2026, 10, 17), '1.5', '2', '1', '1.8', '5', Date.UTC(2026, 10, 17, 23, 59, 59, 999)]], now);
    eq(k.length, 2); ok(!k[0].partial && k[1].partial, 'son mum kapanmadı olarak işaretlenmeli'); eq(k[0].c, 1.5);
    var t = MD.parseTefasHistory({ history: [{ date: '2026-11-14', price: 8.3, size: 1, investors: 5 }, { date: '2026-11-13', price: 8.2, size: 1, investors: 5 }] });
    eq(t.map(function (b) { return b.d; }), ['2026-11-13', '2026-11-14'], 'tarih sırasına dizilmeli'); eq(t[1].c, 8.3); eq(t[1].o, null);
  });
  test('Canlı fiyat birleştirme: yeni gün eklenir, aynı gün değiştirilir (fark %), eski/eksik fiyat yok sayılır', function () {
    var b = [{ d: '2026-11-16', o: 1, h: 2, l: 1, c: 1.5, v: 1 }];
    eq(MD.mergeLive(b, { d: '2026-11-17', o: 1.5, h: 1.7, l: 1.4, c: 1.6, v: 3 }).action, 'append');
    var r = MD.mergeLive(b, { d: '2026-11-16', o: 1, h: 2, l: 1, c: 1.65, v: 2 }); eq(r.action, 'replace'); near(r.diffPct, 10, 1e-9); eq(r.bars.length, 1); ok(r.bars[0].live);
    eq(MD.mergeLive(b, { d: '2026-11-15', o: 1, h: 2, l: 1, c: 1, v: 1 }).action, 'older'); eq(MD.mergeLive(b, { d: '2026-11-17', c: 1.6 }).action, 'incomplete');
  });
  test('Kullanıcı OHLCV içe aktarımı: TR başlıklar, 1.234,56 sayılar, gg.aa.yyyy tarih; yalnız kapanış', function () {
    var r = MD.parseOhlcText('Tarih;Açılış;En Yüksek;En Düşük;Kapanış;Hacim\n17.11.2026;1.351,75;1.353,75;1.340,5;1.341,5;30.164.715\n14.11.2026;1.340;1.360;1.330;1.351,75;1000\nbozuk;satır');
    eq(r.bars.length, 2); eq(r.bars[0].d, '2026-11-14'); eq(r.bars[1].c, 1341.5); eq(r.bars[1].v, 30164715); ok(!r.closeOnly); eq(r.skipped, 1);
    var e = MD.parseOhlcText('Date,Close\n2026-11-13,1,234.56\n'); ok(e.bars.length === 0 || e.closeOnly, 'virgüllü CSV belirsizliği');
    var c = MD.parseOhlcText('Date\tClose\n2026-11-13\t1,234.56\n2026-11-14\t1,240.00'); ok(c.closeOnly); eq(c.bars[0].c, 1234.56);
  });
  function goodBars(n, start, step) { var p = []; for (var i = 0; i < n; i++) p.push([i, start + Math.sin(i / 5) * 3 + i * (step || 0)]); var pp = mkPath([[0, start], [n - 1, start + (n - 1) * (step || 0.05)]]); pp.c = pp.c.map(function (x, i) { return x + Math.sin(i / 5) * 2; }); pp.o = pp.c.map(function (x, i) { return i ? pp.c[i - 1] : x; }); pp.h = pp.c.map(function (x, i) { return Math.max(x, pp.o[i]) + 0.6; }); pp.l = pp.c.map(function (x, i) { return Math.min(x, pp.o[i]) - 0.6; }); return bars(pp); }
  test('Veri kontrolü: sağlıklı seri tamamen "ok"', function () {
    var b = goodBars(300, 100), ch = MD.checkBars(b, 'stock', { today: b[b.length - 1].d });
    eq(MD.worstLevel(ch), 'ok', JSON.stringify(ch.filter(function (c) { return c.level !== 'ok'; })));
  });
  test('Veri kontrolü: az veri, tarih sırası, tutarsız mum, BIST %10 sınırı, eski veri, gelecek tarih', function () {
    var b = goodBars(300, 100), t = b[b.length - 1].d;
    eq(MD.checkBars(b.slice(0, 40), 'stock', { today: b[39].d }).filter(function (c) { return c.id === 'count'; })[0].level, 'fail');
    var sw = b.slice(); var tmp = sw[100]; sw[100] = sw[101]; sw[101] = tmp; eq(MD.checkBars(sw, 'stock', { today: t }).filter(function (c) { return c.id === 'order'; })[0].level, 'fail');
    var bad = JSON.parse(JSON.stringify(b)); bad[290].h = bad[290].l - 1; eq(MD.checkBars(bad, 'stock', { today: t }).filter(function (c) { return c.id === 'ohlc'; })[0].level, 'warn');
    var j = JSON.parse(JSON.stringify(b)); for (var i = 280; i < 300; i++) { j[i].c *= 1.2; j[i].o *= 1.2; j[i].h *= 1.2; j[i].l *= 1.2; }
    var jc = MD.checkBars(j, 'stock', { today: t }).filter(function (c) { return c.id === 'jumps'; })[0]; eq(jc.level, 'warn', 'son 60 günde %10 üstü hareket'); ok(/BIST/.test(jc.msg));
    eq(MD.checkBars(j, 'stock', { today: t, splits: [[j[280].d, 1.2]] }).filter(function (c) { return c.id === 'jumps'; })[0].level, 'ok', 'bölünme günü muaf');
    eq(MD.checkBars(b, 'stock', { today: '2027-01-15' }).filter(function (c) { return c.id === 'fresh'; })[0].level, 'fail', 'eski veri');
    eq(MD.checkBars(b, 'stock', { today: '2020-01-01' }).filter(function (c) { return c.id === 'fresh'; })[0].level, 'fail', 'gelecek tarih');
  });
  test('Veri kontrolü: ikinci kaynak (İş Yatırım) — son günler uyuşmazsa hata, yalnız eski sabit fark bilgi', function () {
    var b = goodBars(300, 100), t = b[b.length - 1].d;
    eq(MD.checkBars(b, 'stock', { today: t, crossCheck: { source: 'İş Yatırım', compared: 50, maxAbsDiffPct: 2.1, recentMaxAbsDiffPct: 1.9, over05: 40 } }).filter(function (c) { return c.id === 'cross'; })[0].level, 'fail');
    eq(MD.checkBars(b, 'stock', { today: t, crossCheck: { source: 'İş Yatırım', compared: 50, maxAbsDiffPct: 1.8, recentMaxAbsDiffPct: 0, over05: 30, recentCompared: 5 } }).filter(function (c) { return c.id === 'cross'; })[0].level, 'info');
    eq(MD.checkBars(b, 'stock', { today: t, liveMerge: { action: 'replace', diffPct: 4.2 } }).filter(function (c) { return c.id === 'live'; })[0].level, 'warn');
  });
  test('İş günü hesabı ve tarih yardımcıları (TSİ)', function () {
    eq(MD.businessDaysBetween('2026-11-13', '2026-11-16'), 1, 'Cuma → Pazartesi 1 iş günü'); eq(MD.businessDaysBetween('2026-11-16', '2026-11-16'), 0);
    eq(MD.ymdOfMs(Date.UTC(2026, 10, 16, 22, 30), 3), '2026-11-17', 'UTC 22:30 = TSİ ertesi gün');
  });

  /* ---------- 4. Analiz: skorlar, planlar, satış kuralı, sağlık, oluşturucu ---------- */
  function series(b, kind, extra) { var s = { key: 'test:X', kind: kind || 'stock', name: 'Test', currency: 'TRY', bars: b, checks: MD.checkBars(b, kind || 'stock', { today: b[b.length - 1].d }) }; Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; }); return s; }
  var UP = bars(mkPath([[0, 100], [40, 130], [60, 118], [100, 150], [120, 138], [170, 175], [190, 162], [240, 200], [255, 190], [270, 205]]));
  var DOWN = bars(mkPath([[0, 200], [40, 170], [60, 182], [100, 150], [120, 162], [170, 125], [190, 138], [240, 100], [255, 110], [270, 96]]));
  test('Skor: düzenli yükselen trend > düzenli düşen trend; skorlar 0-100 ve sentez ağırlıkları belgeli', function () {
    var a = AN.analyze(series(UP), { halal: { status: 'uygun' } }), b = AN.analyze(series(DOWN), { halal: { status: 'uygun' } });
    ok(a.scores.trend.score >= 65, 'yükselişte trend ' + a.scores.trend.score); ok(b.scores.trend.score <= 35, 'düşüşte trend ' + b.scores.trend.score); ok(a.total > b.total);
    [a, b].forEach(function (A) { ok(A.total >= 0 && A.total <= 100); var w = A.synthesis.parts.reduce(function (s, p) { return s + p.wEff; }, 0); near(w, 1, 1e-9, 'ağırlıklar toplamı'); near(A.synthesis.parts.reduce(function (s, p) { return s + p.contrib; }, 0), A.total, 0.5, 'toplam = katkılar'); });
    ok(a.synthesis.missing.indexOf(AN.SUB_LABEL.value) >= 0, 'temel veri yoksa eksik olarak raporlanmalı'); ok(a.confReasons.some(function (r) { return /Temel/.test(r); }), 'güven gerekçesi');
  });
  test('Ağırlık tabloları: her tür için toplam 100', function () {
    Object.keys(AN.WEIGHTS).forEach(function (k) { eq(Object.keys(AN.WEIGHTS[k]).reduce(function (s, x) { return s + AN.WEIGHTS[k][x]; }, 0), 100, k); });
    eq(Object.keys(AN.HEALTH_W).reduce(function (s, x) { return s + AN.HEALTH_W[x]; }, 0), 100, 'sağlık');
  });
  test('Plan: seviyeler yapıdan — stop < giriş < hedefler; stop destek bölgesinin altında; sabit yüzde değil', function () {
    var A = AN.analyze(series(UP), { halal: { status: 'uygun' } }), seen = 0;
    ['conservative', 'aggressive'].forEach(function (k) {
      var p = A.plans[k]; if (!p) return; seen++;
      ok(p.stop < p.entryLo && p.entryLo <= p.entryHi, k + ' sıra'); p.targets.forEach(function (t) { ok(t.p > p.entryHi, k + ' hedef girişin üstünde'); });
      if (p.targets.length) { var t0 = p.targets[0]; near(t0.rr, (t0.p - p.entry) / (p.entry - p.stop), 1e-9, 'R/Ö formülü'); }
      eq(p.ok, p.rr != null && p.rr >= 1.5, 'R/Ö ≥ 1,5 kuralı');
    });
    ok(seen >= 1, 'en az bir plan olmalı: ' + A.plans.notes.join(' '));
    var c = A.plans.conservative; if (c) ok(A.zones.some(function (z) { return c.stop <= z.lo; }) || A.swings.some(function (s) { return s.type === 'L' && c.stop < s.p; }), 'stop bir bölgenin/dibin altında olmalı');
    var B = AN.analyze(series(bars(mkPath([[0, 100], [30, 140], [45, 120], [90, 160], [110, 135], [150, 170], [160, 165]]))), { halal: { status: 'uygun' } });
    var r1 = A.plans.conservative && A.plans.conservative.riskPct, r2 = B.plans.conservative && B.plans.conservative.riskPct;
    if (r1 && r2) ok(Math.abs(r1 - r2) > 1e-4, 'farklı yapılar farklı stop mesafesi vermeli (sabit yüzde değil)');
  });
  test('Helal kapısı: uygun olmayan varlıkta plan işaretlenir, skor değişmez', function () {
    var a = AN.analyze(series(UP), { halal: { status: 'uygun' } }), b = AN.analyze(series(UP), { halal: { status: 'supheli', label: 'Şüpheli' } });
    eq(a.total, b.total, 'helal skoru toplamı etkilememeli'); ok(a.halalOk && !b.halalOk); ok(b.plans.halalNote && /Helal filtresi/.test(b.plans.halalNote)); ok(!a.plans.halalNote);
  });
  test('Bloklama: veri hatası (eski veri) veya < 30 gün → sinyal yok', function () {
    var s = series(UP); s.checks = MD.checkBars(UP, 'stock', { today: '2027-06-01' }); var A = AN.analyze(s, { halal: { status: 'uygun' } });
    ok(A.blocked); eq(A.stance.code, 'nosignal'); ok(A.plans.blockedNote);
    var B = AN.analyze(series(UP.slice(0, 20)), {}); ok(B.blocked && B.total === null);
  });
  function fakeA(o) {
    var n = 50, rsi = flat(n, 60), hist = flat(n, 0.5);
    return Object.assign({ blocked: false, total: 50, scores: { trend: { score: 50 } }, price: 100, atr: 2, zones: [], ind: { rsi: rsi, macd: { hist: hist }, supertrend: null }, divergences: [], patterns: [], swings: [] }, o || {});
  }
  test('Satış kuralı: "azalt" yalnızca dirençte + en az iki yorulma kanıtı', function () {
    var rsi = flat(50, 60); rsi[47] = 76; rsi[48] = 74; rsi[49] = 69; var hist = flat(50, 0.5); hist[48] = 0.2; hist[49] = -0.1;
    var res = [{ lo: 99, hi: 101, mid: 100, highs: 2 }], bear = [{ type: 'bear', fresh: true }];
    eq(AN.stance(fakeA({ zones: res, ind: { rsi: rsi, macd: { hist: hist }, supertrend: null }, divergences: bear }), true).hold.code, 'trim', 'dirençte 3 kanıt → azalt');
    eq(AN.stance(fakeA({ zones: [], ind: { rsi: rsi, macd: { hist: hist }, supertrend: null }, divergences: bear }), true).hold.code, 'hold', 'direnç yoksa satma');
    eq(AN.stance(fakeA({ zones: res, divergences: bear }), true).hold.code, 'hold', 'tek kanıt yetmez');
    var r = AN.stance(fakeA({ scores: { trend: { score: 75 } }, total: 72, zones: [{ lo: 96, hi: 98.5, mid: 97.2, highs: 2 }], swings: [{ type: 'L', p: 95, i: 40 }] }), true);
    eq(r.hold.code, 'raise', 'kırılmış direnç + güçlü trend → hedef yükselt'); near(r.hold.trail, 94, 1e-9, 'iz süren stop = son dip − 0,5 ATR');
    ok(!AN.stance(fakeA(), false).hold, 'elde değilse pozisyon önerisi yok');
  });
  test('TradingView çapraz doğrulama: aynı mumda tolerans içi ✓, dışı ⚠, farklı günde karşılaştırma yok', function () {
    var A = AN.analyze(series(UP), {}), I = A.ind, tv = { RSI: lastN(I.rsi) + 0.5, ATR: lastN(I.atr) * 1.01, SMA50: lastN(I.sma50) * 1.02 };
    var x = AN.crossVerify(I, tv, A.price, true), byName = {}; x.rows.forEach(function (r) { byName[r.name] = r.ok; });
    ok(x.compared >= 3, 'karşılaştırılan ' + x.compared); ok(Object.keys(byName).some(function (k) { return /RSI/.test(k) && byName[k]; }), 'RSI tolerans içi');
    ok(Object.keys(byName).some(function (k) { return /SMA\(50\)/.test(k) && !byName[k]; }), 'SMA50 %2 fark yakalanmalı');
    eq(AN.crossVerify(I, tv, A.price, false).compared, 0);
  });
  test('Düşük oynaklıklı fon: momentum uygulanamaz (güven düşmez), Sharpe değerlendirilmez', function () {
    var b = []; for (var i = 0; i < 300; i++) b.push(8 * Math.pow(1.0012, i)); var bb = bars({ c: b, o: b.map(function () { return null; }), h: b.map(function () { return null; }), l: b.map(function () { return null; }), v: b.map(function () { return null; }) });
    var s = series(bb, 'fund', { closeOnly: true, fund: { type: 'Kira Sertifikası', returns: { y1: 40, m6: 18 }, risk: { score: 1 }, size: 5e9, investors: 10000 } }); s.checks = MD.checkBars(bb, 'fund', { today: bb[bb.length - 1].d, closeOnly: true });
    var A = AN.analyze(s, { halal: { status: 'uygun' } }); eq(A.scores.momentum.score, null); ok(A.scores.momentum.na);
    ok(!A.confReasons.some(function (r) { return /Momentum hesaplanamadı/.test(r); }), 'uygulanamaz momentum güveni düşürmemeli');
    ok(A.scores.value.ev.some(function (e) { return /Sharpe\/Sortino değerlendirilmedi/.test(e.t); }), 'Sharpe atlanmalı');
  });
  test('Portföy sağlık skoru: iyi portföy > kötü portföy; düzeltmeler bağlantılı; eksik ölçüt dağıtılır', function () {
    var good = { positions: [{ name: 'A', value: 300, tier: 'safe', halal: 'uygun', liquid: true }, { name: 'B', value: 300, tier: 'medium', halal: 'uygun', liquid: true }, { name: 'C', value: 250, tier: 'risky', halal: 'uygun', liquid: true }, { name: 'D', value: 150, tier: 'medium', halal: 'uygun', liquid: true }],
      target: { safe: 3000, medium: 4500, risky: 2500 }, current: { safe: 3000, medium: 4500, risky: 2500 }, emergency: { have: 100, need: 100 }, rules: { ok: 4, total: 4 }, fees: 1, invested: 1000, perf: null, profile: 'medium', maxSingleBp: 3000 };
    var bad = JSON.parse(JSON.stringify(good)); bad.positions = [{ name: 'X', value: 900, tier: 'risky', halal: 'uygun_degil', liquid: true }, { name: 'Y', value: 100, tier: 'safe', halal: 'bilinmiyor', liquid: false }];
    bad.current = { safe: 1000, medium: 0, risky: 9000 }; bad.emergency = { have: 10, need: 100 }; bad.rules = { ok: 1, total: 4 }; bad.fees = 50;
    var G = AN.health(good), B = AN.health(bad);
    ok(G.total > B.total + 25, 'iyi ' + G.total + ' kötü ' + B.total); ok(/[AB]/.test(G.grade)); ok(/[DE]/.test(B.grade));
    ok(B.fixes.length >= 3 && B.fixes.every(function (f) { return /^#/.test(f.link); }), 'düzeltmeler bağlantılı'); ok(B.missing.length >= 1 && B.coverage < 1, 'oynaklık/performans eksik');
    ok(B.scores.halal.score < 50, 'helal uyum düşük'); ok(B.scores.concentration.score < 50, 'yoğunlaşma düşük');
  });
  test('Portföy riski: korelasyon matrisi, etkin varlık sayısı, oynaklık', function () {
    var a = bars(mkPath([[0, 100], [150, 130]])), b = a.map(function (x) { return { d: x.d, c: 200 - x.c + Math.sin(x.c) }; });
    var r = AN.portfolioRisk([a, a.map(function (x) { return { d: x.d, c: x.c * 2 }; })], [1, 1]); near(r.corr[0][1], 1, 1e-9); near(r.nEffCorr, 1, 1e-6, 'aynı varlık ×2 = etkin 1 varlık');
    ok(AN.portfolioRisk([a.slice(0, 30), b.slice(0, 30)], [1, 1]).error, 'az ortak gün hatası');
  });
  function fund(code, type, y1, size, islamic, extra) { return Object.assign({ code: code, name: code + ' fonu', type: type, returns: { y1: y1 }, size: size, tags: { islamic: islamic }, risk: { score: 2 }, active: true }, extra || {}); }
  var FUNDS = [fund('KPP', 'Katılım Para Piyasası', 45, 9e9, true), fund('KKS', 'Kira Sertifikası', 44, 3e9, true), fund('FPP', 'Para Piyasası', 50, 2e10, false),
    fund('KHS', 'Katılım Hisse Senedi', 60, 1e9, true), fund('HSF', 'Hisse Senedi', 90, 5e9, false), fund('KKR', 'Katılım Karma', 38, 6e8, true), fund('KAL', 'Katılım Değerli Madenler', 30, 7e8, true, { name: 'Altın katılım fonu' }), fund('TSF', 'Katılım Hisse Senedi', 99, 1e9, true, { liquidation_notice: 'var' })];
  var STOCKS = [{ name: 'AAA', description: 'A şirketi', close: 50, SMA200: 40, SMA50: 45, 'Perf.6M': 20, return_on_equity: 30, debt_to_equity: 0.5, price_earnings_ttm: 10, RSI: 60, average_volume_30d_calc: 5e6 },
    { name: 'BBB', description: 'B şirketi', close: 5, SMA200: 6, SMA50: 5.5, 'Perf.6M': -10, RSI: 40, average_volume_30d_calc: 1e5 }];
  test('Portföy oluşturucu: yalnız İslami etiketli fonlar, kripto yok, toplam %100, profil tablosu', function () {
    ['short', 'medium', 'long'].forEach(function (h) { ['low', 'medium', 'high'].forEach(function (r) {
      var R = AN.buildPortfolio({ horizon: h, risk: r, halal: true, usd: true }, { funds: FUNDS, stocks: STOCKS });
      eq(R.blocks.reduce(function (s, b) { return s + b.weightBp; }, 0), 10000, h + '/' + r + ' toplam');
      eq([R.tiers.safe, R.tiers.medium, R.tiers.risky], AN.TIER_MATRIX[h][r]);
      R.blocks.forEach(function (b) {
        ok(b.item.cls !== 'crypto' && !/^cg:/.test(b.item.key || ''), 'kripto olmamalı');
        if (/^tefas:/.test(b.item.key || '')) { var f = FUNDS.filter(function (x) { return 'tefas:' + x.code === b.item.key; })[0]; ok(f.tags.islamic, 'faizli fon seçildi: ' + f.code); ok(!f.liquidation_notice, 'tasfiyedeki fon seçildi'); }
        if (/^bist:/.test(b.item.key || '')) ok(b.item.key === 'bist:AAA', 'zayıf/likit olmayan hisse seçildi: ' + b.item.key);
      });
      eq(R.glide, AN.GLIDE_FOR_RISK[r]);
    }); });
    var low = AN.buildPortfolio({ horizon: 'short', risk: 'low', usd: true }, { funds: FUNDS, stocks: STOCKS }); ok(!low.blocks.some(function (b) { return b.tier === 'risky'; }), 'kısa/düşük profilde riskli yok');
    var tl = AN.buildPortfolio({ horizon: 'long', risk: 'high', usd: false }, { funds: FUNDS, stocks: STOCKS }); ok(!tl.blocks.some(function (b) { return b.item.currency === 'USD'; }), 'yalnız TL seçilince dolar ETF yok');
    ok(AN.buildPortfolio({ horizon: 'medium', risk: 'medium' }, { funds: [], stocks: [] }).blocks.some(function (b) { return b.item.generic; }), 'veri yoksa genel öneri işaretli');
  });
  test('Geçmiş test: aylık dengeleme, CAGR/oynaklık/düşüş tutarlı', function () {
    var a = bars(mkPath([[0, 100], [500, 200]])).map(function (x) { return { d: x.d, c: x.c }; }), b = a.map(function (x) { return { d: x.d, c: 100 }; });
    var bt = AN.backtest([a, b], [5000, 5000]); ok(!bt.error, bt.error); near(bt.nav[0].c, 1, 1e-12); ok(bt.nav[bt.nav.length - 1].c > 1.3 && bt.nav[bt.nav.length - 1].c < 1.6, 'son değer ' + bt.nav[bt.nav.length - 1].c);
    ok(bt.mdd <= 0 && bt.mdd > -0.01, 'düşüşsüz seride MDD ≈ 0'); ok(bt.cagr > 0);
    ok(AN.backtest([a.slice(0, 50)], [1]).error, 'az veri hatası');
  });
  test('Durum doğrulama: analiz tercihleri temizlenir (izleme listesi ≤ 50, geçersiz anahtar atılır, helal her zaman açık)', function () {
    var wl = [{ key: 'bist:ASELS', name: 'ASELS' }, { key: 'bist:ASELS', name: 'tekrar' }, { key: 'javascript:alert(1)', name: 'x' }, { key: 'tefas:KTV', name: 'KTV', addedAt: '2026-11-17' }];
    for (var i = 0; i < 60; i++) wl.push({ key: 'bist:S' + i, name: 'S' + i });
    var c = S.cleanAnalysis({ watchlist: wl, profile: { horizon: 'long', risk: 'çok', halal: false, usd: false } });
    eq(c.watchlist.length, 50); eq(c.watchlist[0].key, 'bist:ASELS'); eq(c.watchlist[1].key, 'tefas:KTV'); eq(c.watchlist[1].addedAt, '2026-11-17');
    eq(c.profile, { horizon: 'long', usd: false, halal: true }); eq(S.cleanAnalysis('bozuk'), { watchlist: [], profile: {} });
  });

  function run() {
    var results = [], chain = Promise.resolve();
    tests.forEach(function (t) { chain = chain.then(function () { return Promise.resolve().then(t.fn); }).then(function () { results.push({ name: t.name, ok: true }); }, function (e) { results.push({ name: t.name, ok: false, err: e.message }); }); });
    return chain.then(function () { return results; });
  }
  module.exports = { run: run };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v7 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
