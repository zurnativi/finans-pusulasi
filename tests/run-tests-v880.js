/* v8.8.0 testleri: Portföy Laboratuvarı (oluşturucu + kayıtlı sanal portföyler) ve her bölümde "Nasıl kullanılır?" yardım kutuları.
 * Skor, dağılım, seviyeler (alım durumu), filtre birleşimleri (Döviz / Dolar bazlı helal ETF / Yalnız TL), sanal alım, değerleme, emir dolumu, kaydet/yükle, veri koruması. */
'use strict';
var fs = require('fs'), path = require('path');
module.exports.run = function () {
  var L = require('../js/lab.js'), S = require('../js/sample.js'), H = require('../js/help.js'), IB = require('../js/inbox.js'), MG = require('../js/migrate.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function rd(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
  // gerçekçi sahte anlık görüntü (snapshot.compact biçimi)
  function snap(o) {
    o = o || {}; var price = o.price || 100, atr = o.atr != null ? o.atr : price * 0.02;
    var plan = o.plan === null ? null : Object.assign({ entryLo: price * 0.97, entryHi: price * 1.0, stop: price * 0.92, targets: [{ p: price * 1.12, rr: 2 }, { p: price * 1.2, rr: 3 }], rr: 2, how: 'destek bölgesi' }, o.plan || {});
    return { name: o.name || 'X', kind: o.kind || 'stock', total: o.total === undefined ? 70 : o.total, confidence: 70, blocked: !!o.blocked, blockReasons: o.blocked ? ['test'] : [],
      scores: Object.assign({ trend: 70, momentum: 65, risk: 60, value: 55, rel: 60, liquidity: o.liq != null ? o.liq : 70 }, o.scores || {}),
      plans: plan ? { conservative: plan, aggressive: null } : {}, ind: { atr: atr, atrPct: atr / price, rsi: 50 }, halal: o.halal || { status: 'uygun', label: 'Uygun' }, price: price, currency: o.currency || 'TRY' };
  }
  function cand(key, o) { o = o || {}; var cls = L.classOfKey(key), s = snap(o); return { key: key, name: o.name || key, cls: cls, tier: o.tier, cur: cls === 'fx' ? 'FX' : s.currency === 'USD' ? 'USD' : 'TRY', halal: s.halal, snap: s, price: s.price, sector: o.sector || null, fundType: o.fundType || null, liq: o.size ? { size: o.size } : null, vol1y: o.vol1y }; }
  function universe() {
    var c = [];
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach(function (x, i) { c.push(cand('bist:' + x + 'XXX', { total: 60 + i * 4, sector: i % 3 === 0 ? 'Finance' : i % 3 === 1 ? 'Energy Minerals' : 'Utilities', price: 50 + i })); });
    c.push(cand('bist:FAIZ', { total: 95, halal: { status: 'uygun_degil', label: 'Faizli' } }));
    c.push(cand('tefas:PPK', { kind: 'fund', total: 80, tier: 'safe', plan: null, atr: 0.001, price: 1, size: 5e9, fundType: 'Para Piyasası' }));
    c.push(cand('tefas:KRS', { kind: 'fund', total: 75, tier: 'safe', plan: null, atr: 0.001, price: 1, size: 3e9, fundType: 'Kira Sertifikası' }));
    c.push(cand('tefas:ALT', { kind: 'fund', total: 65, tier: 'medium', price: 10, size: 2e9, fundType: 'Altın', name: 'ALTIN KATILIM FONU' }));
    c.push(cand('metal:XAU', { kind: 'metal', total: 62, price: 4000 }));
    c.push(cand('fx:USD', { kind: 'fx', total: 55, price: 42 }));
    c.push(cand('us:SPUS', { kind: 'etf', total: 68, price: 50, currency: 'USD' }));
    c.push(cand('us:HLAL', { kind: 'etf', total: 66, price: 55, currency: 'USD' }));
    c.push(cand('cg:bitcoin', { kind: 'crypto', total: 72, price: 90000, currency: 'USD', halal: { status: 'supheli', label: 'Şüpheli' } }));
    return c;
  }
  function f0(over) { return L.cleanFilters(Object.assign(L.defaultFilters(), over || {})); }
  function sumW(d) { return d.positions.reduce(function (s, p) { return s + p.weightBp; }, 0) + d.cashBp; }

  /* ---- filtreler ---- */
  test('Standart filtre: Dengeli profil, helal AÇIK, kripto kapalı; profiller filtreleri otomatik ayarlar', function () {
    var f = L.defaultFilters(); eq(f.profile, 'dengeli'); ok(f.halal === true && f.classes.crypto === false && f.usdEtf === true);
    var m = L.applyProfile(f, 'muhafazakar'); eq(m.risk, 'low'); eq(m.count, 6); eq(m.maxSingleBp, 3000); ok(L.profileMatches(m));
    var a = L.applyProfile(f, 'agresif'); eq(a.risk, 'high'); eq(a.horizon, 'long'); ok(m.halal === true && a.halal === true, 'profil helal filtresini kapatmaz');
    var c = L.cleanFilters(Object.assign({}, m, { count: 12 })); ok(!L.profileMatches(c), 'değiştirilince profil artık eşleşmez (Özel)');
  });
  test('Döviz / Dolar bazlı helal ETF / Yalnız TL araçlar birbirini DIŞLAMAZ: ETF + Yalnız TL birlikte seçilir ve ikisi de korunur', function () {
    var f = f0({ tlOnly: true, usdEtf: true, fx: false }); ok(f.tlOnly && f.usdEtf, 'temizleme birini kapatmamalı');
    var R = L.resolveFilters(f); ok(R.allow.etf === true && R.allow.fx === false && R.allow.crypto === false); eq(R.fxCapBp, L.FX_CAP_BP);
    ok(R.info.some(function (i) { return i.code === 'tl-plus' && /istisna/.test(i.text); }), 'bilgi notu');
    var R3 = L.resolveFilters(f0({ tlOnly: true, usdEtf: true, fx: true })); ok(R3.allow.etf && R3.allow.fx && R3.info.some(function (i) { return i.code === 'tl-all'; }), 'üçü birlikte');
    var R1 = L.resolveFilters(f0({ tlOnly: true, usdEtf: false, fx: false })); ok(!R1.allow.etf && !R1.allow.fx && R1.fxCapBp == null && R1.info.some(function (i) { return i.code === 'tl-only'; }));
    var R0 = L.resolveFilters(f0({ tlOnly: false, usdEtf: true, fx: true })); ok(R0.allow.etf && R0.allow.fx && R0.fxCapBp == null);
  });
  test('Çelişkili birleşimler sessizce yok sayılmaz: helal+kripto, Yalnız TL+kripto, sınıf yok, kısa vade+yüksek risk, sayı×sınır<100, sektör+BIST kapalı', function () {
    function codes(o) { var R = L.resolveFilters(f0(o)); return R.warnings.map(function (w) { return w.code; }); }
    ok(codes({ classes: { bist: true, fund: true, gold: true, crypto: true } }).indexOf('halal-crypto') >= 0);
    var R = L.resolveFilters(f0({ halal: false, tlOnly: true, classes: { bist: true, fund: true, gold: true, crypto: true } })); ok(!R.allow.crypto && R.warnings.some(function (w) { return w.code === 'tl-crypto'; }) && R.warnings.some(function (w) { return w.code === 'halal-off'; }));
    ok(codes({ classes: { bist: false, fund: false, gold: false, crypto: false }, fx: false, usdEtf: false }).indexOf('no-class') >= 0);
    ok(codes({ horizon: 'short', risk: 'high' }).indexOf('short-high') >= 0);
    ok(codes({ count: 3, maxSingleBp: 2000 }).indexOf('cap-count') >= 0);
    ok(codes({ sectors: ['Finance'], classes: { bist: false, fund: true, gold: true, crypto: false } }).indexOf('sector-nobist') >= 0);
    ok(codes({ risk: 'low', classes: { bist: true, fund: false, gold: false, crypto: false }, fx: false }).indexOf('low-nosafe') >= 0);
  });
  test('Aday filtresi: faizli ("uygun değil") hiçbir ayarda girmez; helal filtresi şüpheliyi çıkarır; kapalıyken şüpheli girer; Yalnız TL ETF\'i yalnız istisnayla alır', function () {
    var U = universe();
    var on = L.filterCandidates(U, f0({ classes: { bist: true, fund: true, gold: true, crypto: true } }));
    ok(!on.kept.some(function (c) { return c.key === 'bist:FAIZ' || c.key === 'cg:bitcoin'; }));
    ok(on.excluded.some(function (x) { return x.key === 'bist:FAIZ' && /Helal değil/.test(x.reason); }), 'neden yazılır');
    var off = L.filterCandidates(U, f0({ halal: false, classes: { bist: true, fund: true, gold: true, crypto: true } }));
    ok(off.kept.some(function (c) { return c.key === 'cg:bitcoin'; }) && !off.kept.some(function (c) { return c.key === 'bist:FAIZ'; }));
    var tl = L.filterCandidates(U, f0({ tlOnly: true, usdEtf: false, fx: false })); ok(!tl.kept.some(function (c) { return c.cls === 'etf' || c.cls === 'fx'; }));
    var tle = L.filterCandidates(U, f0({ tlOnly: true, usdEtf: true, fx: false })); ok(tle.kept.some(function (c) { return c.cls === 'etf'; }) && !tle.kept.some(function (c) { return c.cls === 'fx'; }));
  });
  /* ---- skor ---- */
  test('Varlık skoru: motorun skoru + bileşenleri; veri yoksa / engelliyse null ("veri yetersiz"), uydurulmaz', function () {
    var s = L.assetScore(snap({ total: 72 })); eq(s.score, 72); ok(s.parts.length >= 5 && s.parts.every(function (p) { return p.w > 0; }));
    ok(L.assetScore(snap({ total: null })).score === null); ok(L.assetScore(snap({ blocked: true })).score === null); ok(L.assetScore(null).score === null);
    ok(/Veri/.test(L.assetScore(snap({ blocked: true })).reason));
  });
  test('Portföy skoru 0-100: ağırlıklar toplamı 100, bileşenler şeffaf; kalite yoksa veya kapsam < %50 ise skor yok', function () {
    eq(Object.keys(L.PSCORE_W).reduce(function (s, k) { return s + L.PSCORE_W[k]; }, 0), 100);
    var pos = [{ weightBp: 5000, score: 80, entry: { code: 'now', rrNow: 2 }, liq: 70, halal: { status: 'uygun' } }, { weightBp: 5000, score: 60, entry: { code: 'wait', rrNow: 1 }, liq: 50, halal: { status: 'uygun' } }];
    var r = L.portfolioScore({ positions: pos, risk: { vol: 0.1, mdd: -0.1, nEffCorr: 1.8 }, profileRisk: 'medium' });
    ok(r.total >= 0 && r.total <= 100 && r.parts.length === 7 && r.parts.every(function (p) { return typeof p.ev === 'string'; }), JSON.stringify(r));
    var noQ = L.portfolioScore({ positions: pos.map(function (p) { return Object.assign({}, p, { score: null }); }), risk: null, profileRisk: 'medium' }); ok(noQ.total === null && /Veri yetersiz/.test(noQ.reason));
    var bad = L.portfolioScore({ positions: [{ weightBp: 10000, score: 70, entry: { code: 'now' }, halal: { status: 'uygun_degil' } }], risk: null }); ok(bad.parts.filter(function (p) { return p.k === 'halal'; })[0].score <= 40);
  });
  /* ---- seviyeler ---- */
  test('Alım durumu: bölgede ve R/Ö ≥ 1,5 → "şimdi"; üstündeyse → "şu seviyeye gelirse al" (bekleyen emir = bölge üstü); stop altı → "yapı bozuldu"', function () {
    var s = snap({ price: 100 }); var e = L.entryStatus(s, 99, 'bist'); eq(e.code, 'now'); ok(e.rrNow >= 1.5 && e.stop === 92 && e.t1 > 99);
    var w = L.entryStatus(s, 108, 'bist'); eq(w.code, 'wait'); ok(w.buyHi === 100 && /gelirse al/.test(w.label));
    var b = L.entryStatus(s, 90, 'bist'); eq(b.code, 'broken');
    var lowRR = L.entryStatus(snap({ price: 100, plan: { targets: [{ p: 103, rr: 1 }] } }), 100, 'bist'); eq(lowRR.code, 'wait'); ok(lowRR.buyHi < 100, 'bölgenin alt yarısı');
  });
  test('Alım durumu: stopa çok yakın girişte R/Ö şişmez (risk en az 0,5×ATR); düşük oynaklıklı fon → şimdi; güçlü trend + plan yok → iz süren stop', function () {
    var e = L.entryStatus(snap({ price: 100, atr: 4, plan: { stop: 99.9, targets: [{ p: 104 }] } }), 100, 'bist'); ok(e.rrNow <= 2.01, 'R/Ö ' + e.rrNow);
    eq(L.entryStatus(snap({ kind: 'fund', plan: null, atr: 0.001, price: 1 }), 1, 'fund').code, 'now');
    var t = L.entryStatus(snap({ plan: null, total: 70, atr: 2, price: 100 }), 100, 'bist'); eq(t.code, 'trail'); eq(t.stop, 95);
    eq(L.entryStatus(snap({ plan: null, total: 40, atr: 2 }), 100, 'bist').code, 'none');
  });
  /* ---- dağılım ---- */
  test('Dağılım: toplam tam 10.000 baz puan; tek varlık sınırı aşılmaz; faizli/kripto (helal açık) yok; aynı sektörden en fazla 2 hisse', function () {
    ['muhafazakar', 'dengeli', 'agresif'].forEach(function (pf) {
      var d = L.build(universe(), L.applyProfile(L.defaultFilters(), pf));
      eq(sumW(d), 10000, pf); ok(d.positions.every(function (p) { return p.weightBp <= d.filters.maxSingleBp; }), pf + ' sınır');
      ok(!d.positions.some(function (p) { return p.key === 'bist:FAIZ' || p.cls === 'crypto'; }), pf);
      var sec = {}; d.positions.filter(function (p) { return p.cls === 'bist'; }).forEach(function (p) { sec[p.sector] = (sec[p.sector] || 0) + 1; }); ok(Object.keys(sec).every(function (k) { return sec[k] <= 2; }), pf + ' sektör');
    });
  });
  test('Dağılım: risk asla artırılmaz — riskli sınıflar kapalıyken pay daha güvenli gruba/nakde gider; muhafazakâr profilde riskli pay ≤ tablo payı', function () {
    var d = L.build(universe(), f0({ classes: { bist: false, fund: true, gold: true, crypto: false }, usdEtf: false, fx: false }));
    eq(sumW(d), 10000); ok(!d.positions.some(function (p) { return p.tier === 'risky'; }) && d.notes.some(function (n) { return /risk artırılmaz/.test(n); }));
    var m = L.build(universe(), L.applyProfile(L.defaultFilters(), 'muhafazakar')), tm = d.tierTarget;
    var risky = m.positions.filter(function (p) { return p.tier === 'risky'; }).reduce(function (s, p) { return s + p.weightBp; }, 0); ok(risky <= m.tierTarget.risky, 'riskli ' + risky + ' > ' + m.tierTarget.risky); void tm;
  });
  test('Dağılım: Yalnız TL + ETF istisnası → dövize bağlı toplam pay ≤ %30; alım bölgesindekiler öne alınır', function () {
    var d = L.build(universe(), f0({ tlOnly: true, usdEtf: true, fx: true, risk: 'high', horizon: 'long', count: 10, maxSingleBp: 2000 }));
    var fxw = d.positions.filter(function (p) { return L.isForeign(p.cls); }).reduce(function (s, p) { return s + p.weightBp; }, 0); ok(fxw <= L.FX_CAP_BP, 'döviz payı ' + fxw); eq(sumW(d), 10000);
    var nowShare = d.positions.filter(function (p) { return p.entry.code === 'now' || p.entry.code === 'trail'; }).length / d.positions.length; ok(nowShare >= 0.5, 'şimdi alınabilir oranı ' + nowShare);
  });
  test('Fon grubu: gözlenen oynaklıkla düzeltilir (para piyasası gibi davranan "serbest" fon → güvenli; altın fonu orta kalır)', function () {
    eq(L.fundTierByVol('medium', 0.015, 'KISA VADELİ KATILIM SERBEST FON'), 'safe'); eq(L.fundTierByVol('medium', 0.015, 'ALTIN KATILIM FONU'), 'medium'); eq(L.fundTierByVol('risky', 0.05, 'X'), 'medium'); eq(L.fundTierByVol('medium', null, 'X'), 'medium');
    eq(L.fundTier({ type: 'Para Piyasası', name: 'A' }), 'safe'); eq(L.fundTier({ type: '', name: 'X PORTFÖY PARA PİYASASI KATILIM FONU' }), 'safe', 'büyük harfli Türkçe ad'); ok(L.isGoldName('NUROL PORTFÖY ALTIN KATILIM FONU') && L.isGoldName('gümüş') && !L.isGoldName('PARA PİYASASI') && !L.isGoldName('KUVEYT TÜRK PORTFÖY ALTINCI KATILIM SERBEST (DÖVİZ-AVRO) FON') && L.isGoldName('KUVEYT TÜRK PORTFÖY ALTIN KATILIM FONU')); eq(L.fundTier({ type: 'Hisse Senedi', name: 'B' }), 'risky');
  });
  /* ---- sanal alım ve takip ---- */
  test('Sanal alım: tutar varsa "şimdi" olanlar oluşturma fiyatından alınır (adet lot adımına göre aşağı), bekleyenler emir; kuruş kaybolmaz', function () {
    var d = L.build(universe(), L.defaultFilters()), A = L.allocate(d, 10000000, 42, '2026-11-25T12:00:00+03:00');
    eq(A.investedK + A.pendingK + A.cashK, 10000000, 'kuruş dengesi');
    A.positions.forEach(function (p) { if (p.status === 'held') { ok(p.units > 0 && p.costK <= p.budgetK && p.filledAt, p.key); if (p.cls === 'bist') ok(Number.isInteger(p.units)); } if (p.status === 'pending' && p.limit != null) ok(p.limit === p.entry.buyHi); });
    var M = L.allocate(d, null, 42, '2026-11-25T12:00:00+03:00'); ok(M.amountK === null && M.positions.every(function (p) { return p.status === 'model' && p.units === 0; }), 'tutarsız = model');
  });
  test('Değerleme ve K/Z (TL ve %), dolar bazlıda kur; bekleyen emir sonraki günlük mumda dolar (açılış altındaysa açılıştan), oluşturma günü sayılmaz', function () {
    var d = L.build(universe(), f0({ tlOnly: false })), A = L.allocate(d, 10000000, 40, '2026-11-25T12:00:00+03:00'), P = L.makeRecord(d, A, { name: 'T', at: '2026-11-25T12:00:00+03:00' });
    var q = {}; P.positions.forEach(function (p) { q[p.key] = { price: p.price0 * 1.1 }; }); var V = L.valuate(P, q, 40);
    ok(V.totalK > P.amountK && V.pnlK > 0 && Math.abs(V.pnlPct - V.pnlK / P.amountK) < 1e-9);
    var pend = { status: 'pending', limit: 100, cur: 'TRY', budgetK: 100000, cls: 'bist' };
    eq(L.scanFill(pend, [{ d: '2026-11-25', o: 99, h: 101, l: 95, c: 100 }], '2026-11-25'), null, 'oluşturma günü sayılmaz');
    var fl = L.scanFill(pend, [{ d: '2026-11-26', o: 98, h: 101, l: 95, c: 100 }], '2026-11-25'); eq(fl.price, 98); eq(fl.d, '2026-11-26');
    var fl2 = L.scanFill(pend, [{ d: '2026-11-26', o: 103, h: 104, l: 99, c: 100 }], '2026-11-25'); eq(fl2.price, 100);
    var Q = { positions: [{ key: 'bist:X', status: 'pending', limit: 100, cur: 'TRY', budgetK: 100000, cls: 'bist', events: [] }], cashK: 0 };
    ok(L.applyFill(Q, 'bist:X', { d: '2026-11-26', price: 98, fx: 1 })); eq(Q.positions[0].units, 10); eq(Q.positions[0].costK, 98000); eq(Q.cashK, 2000);
  });
  test('Kaydet / yükle: cleanList gidiş-dönüş aynı; bozuk kayıt, tekrar eden kimlik ve sınır aşımı ayıklanır; günde tek değer noktası', function () {
    var d = L.build(universe(), L.defaultFilters()), A = L.allocate(d, 5000000, 42, '2026-11-25T12:00:00+03:00'), P = L.makeRecord(d, A, { name: 'Deneme', at: '2026-11-25T12:00:00+03:00' });
    P.id = 'lpTEST01'; L.addHistory(P, '2026-11-25', L.valuate(P, {}, 42)); L.addHistory(P, '2026-11-25', L.valuate(P, {}, 42)); eq(P.history.length, 1);
    var round = L.cleanList(JSON.parse(JSON.stringify([P]))); eq(round.length, 1); eq(L.cleanList(round), round, 'idempotent');
    eq(round[0].positions.length, P.positions.length); eq(round[0].amountK, 5000000); eq(round[0].name, 'Deneme');
    eq(L.cleanList([P, P, { id: 'x' }, null, { id: '<script>', name: 'k' }]).length, 1);
    var many = []; for (var i = 0; i < 40; i++) many.push(Object.assign({}, P, { id: 'lpT' + String(1000 + i) })); eq(L.cleanList(many).length, L.MAX_PORTFOLIOS);
  });
  test('Veri koruması: validateState kayıtlı portföyleri korur ve temizler; gerçek varlık/işlem/bütçe etkilenmez; eski veride alan yoksa eklenmez', function () {
    var s = S.emptyState('2026-11'); var before = JSON.stringify({ a: s.assets, t: s.trades, b: s.budget });
    var d = L.build(universe(), L.defaultFilters()), P = L.makeRecord(d, L.allocate(d, 5000000, 42, '2026-11-25T12:00:00+03:00'), { name: 'K', at: '2026-11-25T12:00:00+03:00' }); P.id = 'lpKEEP01';
    s.labPortfolios = [P, { bozuk: true }]; var v = S.validateState(JSON.parse(JSON.stringify(s)));
    eq(v.labPortfolios.length, 1); eq(v.labPortfolios[0].id, 'lpKEEP01'); eq(JSON.stringify({ a: v.assets, t: v.trades, b: v.budget }), before);
    var old = S.validateState(S.emptyState('2026-11')); ok(!('labPortfolios' in old), 'eski veri değişmez');
    var src = rd('js/lab-ui.js'); ok(/s\.labPortfolios = \(s\.labPortfolios \|\| \[\]\)/.test(src) || /s\.labPortfolios =/.test(src)); ok(!/s\.trades\.push|s\.assets\.push/.test(src), 'oluşturucu gerçek işlem/varlık eklemez');
  });
  test('Yeniden dengeleme (≥ 5 puan sapma) ve karşılaştırma tablosu', function () {
    var P = { amountK: 1000000, positions: [{ key: 'a', name: 'A', status: 'held', weightBp: 5000, units: 1, costK: 500000 }, { key: 'b', name: 'B', status: 'held', weightBp: 5000, units: 1, costK: 500000 }], cashK: 0, filters: L.defaultFilters() };
    var V = { rows: [{ valueK: 800000 }, { valueK: 400000 }], totalK: 1200000 }; var r = L.rebalance(P, V); ok(r.length === 2 && r.some(function (x) { return x.d > 0; }) && r.some(function (x) { return x.d < 0; }));
    var c = L.compare([Object.assign({ id: 'x', name: 'X', score: { total: 70, grade: 'B' }, risk: { vol: 0.1, mdd: -0.1 } }, P)], [{ totalK: 1200000, pnlPct: 0.2 }]); eq(c[0].pnlPct, 0.2); eq(c[0].held, 2);
  });
  /* ---- yardım kutuları ---- */
  test('Yardım: her bölüm başlığının (h2) "Nasıl kullanılır?" kaydı var; her kayıtta ne işe yarar / nasıl / en iyi / en kötü / risk', function () {
    var files = ['js/app.js', 'js/portfolio-ui.js', 'js/analysis-ui.js', 'js/lab-ui.js', 'js/hub-ui.js', 'js/reports-ui.js', 'js/security-ui.js', 'js/bgwatch-ui.js', 'js/personal.js'];
    var TAB = { 'js/portfolio-ui.js': ['portfoy'], 'js/analysis-ui.js': ['analiz'], 'js/lab-ui.js': ['analiz'], 'js/hub-ui.js': ['haberler', 'ozet'], 'js/reports-ui.js': ['raporlar'], 'js/security-ui.js': ['guvenlik'], 'js/bgwatch-ui.js': ['ayarlar'], 'js/personal.js': ['ozet'] };
    var APP = ['ozet', 'butce', 'odemeler', 'hesaplar', 'islemler', 'veri', 'asistan', 'ayarlar'], miss = [], n = 0;
    files.forEach(function (f) {
      var src = rd(f), re = /<h2[^>]*>([^<'"]{2,80})/g, m;
      while ((m = re.exec(src))) { var t = H.norm(m[1].replace(/\\'/g, "'")); if (!t || /^(\s|\+)/.test(m[1])) continue; n++; var tabs = TAB[f] || APP; if (!tabs.some(function (tb) { return H.find(t, tb); })) miss.push(f + ': ' + t); }
    });
    ok(n > 100, 'başlık sayısı ' + n); eq(miss, [], 'yardımı olmayan başlıklar');
    Object.keys(H.entries).forEach(function (k) { var e = H.entries[k]; ok(e.n && e.u && e.b && e.w && e.r && Array.isArray(e.o), 'eksik alan: ' + k); });
    ['ozet', 'butce', 'odemeler', 'hesaplar', 'islemler', 'veri', 'asistan', 'ayarlar', 'guvenlik', 'gecmis', 'portfoy', 'analiz', 'haberler', 'raporlar'].forEach(function (t) { ok(H.pageId(t, ''), 'sayfa yardımı yok: ' + t); });
    ok(H.pageId('analiz', 'olustur') === 'page:analiz/olustur' && H.pageId('analiz', 'portfoylerim') === 'page:analiz/portfoylerim');
  });
  test('Yardım: oluşturucu filtrelerinin hepsi (profil, helal, vade, risk, sınıflar, Döviz/ETF/Yalnız TL, sayı, sınır, skor, likidite, hemen alınabilir pay, sektör) açıklanır; kutular kapalı başlar', function () {
    var e = H.entries['lab-filters'], names = e.o.map(function (x) { return x[0]; }).join('|');
    ['Muhafazakâr', 'Dengeli', 'Agresif', 'Helal filtresi', 'Vade', 'Risk', 'Varlık sınıfları', 'Döviz', 'Dolar bazlı helal ETF dahil', 'Yalnız TL araçlar', 'Varlık sayısı', 'Tek varlık üst sınırı', 'En düşük analiz skoru', 'Likidite', 'Hemen alınabilir pay hedefi', 'Alım bölgesindekileri', 'Sektör'].forEach(function (k) { ok(names.indexOf(k) >= 0, 'yok: ' + k); });
    ok(/birlikte seçilebilir/.test(e.o.filter(function (x) { return x[0] === 'Yalnız TL araçlar'; })[0][1]));
    var src = rd('js/help.js'); ok(/d\.className = 'help-box'/.test(src) && !/d\.open = true;\s*\n\s*d\.addEventListener/.test(src.replace('if (openState[key]) d.open = true;', '')), 'kapalı başlar');
    var html = H.html(e); ok(/En iyi seçim/.test(html) && /En kötü seçim/.test(html) && /Riskler/.test(html) && html.indexOf('<script') < 0);
  });
  /* ---- dokunulmayanlar ve sürüm ---- */
  test('Dokunulmayanlar: sıfırlama numarası/dosyası aynı; arka plan izleme yeni alanı göndermez; sürüm 8.8.2 her yerde', function () {
    eq(MG.ITEMS.length, 1); eq(MG.ITEMS[0].id, 'sifirdan-midas-v2-2026-11-25'); eq(MG.ITEMS[0].path, 'bg/tek-seferlik-2.enc.json');
    ok(rd('js/bgwatch.js').indexOf('labPortfolios') < 0, 'bgwatch kayıtlı portföyleri yüklemez');
    var sw = rd('sw.js'), idx = rd('index.html'); eq(IB.APP_VERSION, '8.8.2'); ok(/VERSION = '8\.8\.2'/.test(sw)); ok(idx.indexOf('?v=8.8.0') < 0 && idx.indexOf('css/style.css?v=8.8.2') > 0);
    ['lab', 'lab-ui', 'help'].forEach(function (f) { ok(idx.indexOf('js/' + f + '.js?v=8.8.2') > 0, f + ' sayfada'); ok(sw.indexOf("'" + f + "'") > 0, f + ' kabukta'); });
    ok(idx.indexOf('js/analysis.js') < idx.indexOf('js/lab.js') && idx.indexOf('js/lab-ui.js') < idx.indexOf('js/analysis-ui.js') && idx.indexOf('js/help.js') < idx.indexOf('js/app.js'));
    var au = rd('js/analysis-ui.js'); ok(/\['portfoylerim', 'Kayıtlı portföylerim'\]/.test(au) && /olustur: builderPage, portfoylerim: labPage/.test(au));
    ok(/AUI\.onChange\(el\)/.test(rd('js/app.js')) && /window\.Help\.inject\(vw, tab, sub\)/.test(rd('js/app.js')));
  });
  return Promise.resolve(tests.map(function (t) { try { t.fn(); return { name: t.name, ok: true }; } catch (e) { return { name: t.name, ok: false, err: e.message }; } }));
};
if (require.main === module) module.exports.run().then(function (r) { var p = r.filter(function (x) { return x.ok; }).length; r.forEach(function (x) { console.log((x.ok ? '✓ ' : '✗ ') + x.name + (x.ok ? '' : '  → ' + x.err)); }); console.log('\n' + p + '/' + r.length + ' v8.8.0 testi geçti'); if (p !== r.length) process.exit(1); });
