/* v8.4 testleri: canlı fiyatla değerleme (tek değerleme: net varlık = Portföy = döküm), kapanan / işlemsiz pozisyonlar, komisyon kırılımı
 * (komisyon + BSMV/vergi + diğer; alışta maliyete, satışta gelirden), içe aktarmada ayrı vergi/masraf sütunları, kayıt düzeltme doğrulaması,
 * değişiklik geçmişi (eski → yeni) ve geri alma (çakışma ve defter doğrulaması dahil), otomatik fiyat seçimi (uydurma yok, eski rozet).
 * Çalıştırma: node tests/run-tests-v84.js (run-tests.js de çalıştırır). Ağ gerekmez. */
(function () {
  var fs = require('fs'), path = require('path');
  var S = require('../js/sample.js'), PF = require('../js/portfolio.js'), L = require('../js/ledger.js'), C = require('../js/calc.js'), M = require('../js/money.js');
  var H = require('../js/history.js'), AP = require('../js/autoprice.js'), PR = require('../js/prices.js');
  var ROOT = path.join(__dirname, '..'), tests = [], T = '2026-11-24';
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function throws(fn, re, msg) { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error((msg || '') + ' hata metni: ' + e.message); return e; } throw new Error(msg || 'hata bekleniyordu'); }
  function A(id, o) { var a = { id: id, name: id.toUpperCase(), cls: 'katilim_stock', risk: 'risky', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: 'bist:' + id.toUpperCase(), symbol: id.toUpperCase(), withinTierBp: null, goalId: null }; Object.keys(o || {}).forEach(function (k) { a[k] = o[k]; }); return a; }
  function tr(id, assetId, date, side, qty, price, fee, extra) { var t = { id: id, assetId: assetId, date: date, side: side, qty: qty, price: price, fee: fee || 0, currency: 'TRY', fxRate: null, note: '', source: 'elle' }; Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; }); return t; }
  var Q = 100000000, P6 = 1000000; // 1 adet = 1e8, 1 TL fiyat = 1e6
  /* Gerçek veriye benzer: gram altın 111 g, bir fon, açık BIST hissesi, tamamı satılmış hisse, işlemsiz varlık, USD ETF, banka hesabı */
  function realLike() {
    var s = S.emptyState('2026-11'); s.isExample = false;
    s.accounts.push({ id: 'bank', name: 'Ziraat', type: 'bank', currency: 'TRY', balance: 3103682, risk: 'safe', emergency: false, inNetWorth: true });
    s.assets.push(A('altin', { name: 'Fiziki gram altın', cls: 'gold', risk: 'medium', priceKey: 'metal:XAU', symbol: 'ALTIN', lot: 'fraction' }));
    s.assets.push(A('ktv', { name: 'KTV fon', cls: 'sukuk', risk: 'safe', priceKey: 'tefas:KTV', symbol: 'KTV', lot: 'fraction' }));
    s.assets.push(A('bimas')); s.assets.push(A('asels')); s.assets.push(A('drvn', { name: 'DRVN (işlem girilmemiş)' }));
    s.assets.push(A('spus', { name: 'SPUS', cls: 'halal_etf', currency: 'USD', priceKey: 'td:SPUS', symbol: 'SPUS', lot: 'fraction' }));
    s.trades.push(tr('g1', 'altin', '2026-07-18', 'buy', 111 * Q, 7500 * P6, 0));
    s.trades.push(tr('k1', 'ktv', '2026-08-01', 'buy', 7169 * Q, 8 * P6, 0));
    s.trades.push(tr('b1', 'bimas', '2026-09-01', 'buy', 4 * Q, 397.75 * P6, 0));
    s.trades.push(tr('a1', 'asels', '2026-06-01', 'buy', 10 * Q, 100 * P6, 1000)); // 10 TL komisyon
    s.trades.push(tr('a2', 'asels', '2026-10-01', 'sell', 10 * Q, 150 * P6, 1500, { feeParts: { commission: 1000, tax: 500, other: 0 } }));
    var u = tr('u1', 'spus', '2026-08-01', 'buy', 13.5 * Q, 60 * P6, 0); u.currency = 'USD'; u.fxRate = 4100; s.trades.push(u);
    return S.validateState(s);
  }
  function withLive(s) {
    PF.setPrice(s, 'metal:XAU', T, 5797380000, 'Truncgil — Gram Altın (24 ayar/has) ALIŞ', T + 'T20:28:00+03:00');
    PF.setPrice(s, 'tefas:KTV', T, 8410782, 'TEFAS', T + 'T17:28:00Z'); PF.setPrice(s, 'bist:BIMAS', T, 368 * P6, 'TradingView BIST', T + 'T16:12:00Z');
    PF.setPrice(s, 'td:SPUS', T, 54030000, 'TradingView ABD', T + 'T17:28:00Z'); PF.setPrice(s, 'fx:USD', T, 50628000, 'Frankfurter', T + 'T17:28:00Z');
    return S.validateState(s);
  }

  /* ---------- 1) Canlı fiyatla tek değerleme ---------- */
  test('Değerleme: canlı fiyat kaydedilince her varlık adet × son fiyat (× kur) ile değerlenir; kaynak, tarih ve alınma zamanı saklanır', function () {
    var s = withLive(realLike()), rows = PF.valuationRows(s, T), by = {}; rows.forEach(function (r) { by[r.id] = r; });
    eq(by.altin.valueTL, 111 * 579738, 'altın 111 g × 5.797,38'); eq(by.altin.basis, 'market'); eq(by.altin.price.src.indexOf('24 ayar') >= 0, true); ok(by.altin.price.at, 'alınma zamanı');
    eq(by.bimas.valueTL, 4 * 36800); eq(by.ktv.valueTL, Math.round(7169 * 8.410782 * 100));
    eq(s.rates.USD.rate, 5063, 'USD/TL kuru Hesaplar\'a eşitlendi'); eq(by.spus.valueTL, Math.round(72941 * 5063 / 100), 'SPUS USD (13,5 × 54,03 = 729,41 $) × canlı USD/TL 50,63');
    ok(!by.asels && !by.drvn, 'kapanan ve işlemsiz varlık değerleme listesinde yok');
  });
  test('Değerleme: net varlık dökümü, Portföy özeti ve varlık değerleri AYNI rakamı verir (fark yok)', function () {
    var s = withLive(realLike()), sm = PF.summary(s, T), b = L.netWorthBreakdown(s, T), rows = PF.valuationRows(s, T);
    var sumRows = rows.reduce(function (x, r) { return x + r.valueTL; }, 0), sumAssets = s.assets.reduce(function (x, a) { return x + a.value; }, 0);
    eq(sm.mvTL, sumRows); eq(sumAssets, sumRows, 'kaydedilen varlık değerleri'); eq(b.investments, sumRows, 'net varlık dökümündeki yatırımlar'); eq(b.cash, 3103682);
    var an = C.analyze(L.effectiveState(s, T), '2026-11'); eq(b.net, an.assets.netWorth, 'Ana sayfa net varlık');
  });
  test('Değerleme: fiyat yoksa son işlem fiyatı (rozetli), USD kuru yoksa maliyet — hiçbir fiyat uydurulmaz', function () {
    var s = realLike(), rows = PF.valuationRows(s, T), by = {}; rows.forEach(function (r) { by[r.id] = r; });
    ok(by.altin.price.fromTrade, 'işlem fiyatı işaretli'); eq(by.altin.valueTL, 111 * 750000);
    eq(by.spus.basis, 'cost', 'USD/TL kuru yok → maliyet'); var f = AP.freshness(s, T); eq(f.fresh, 0); ok(f.tradePrice >= 3);
  });
  test('Eskime: 10 günlük fon fiyatı ESKİ sayılır; güncel fiyat "güncel" sayılır', function () {
    var s = realLike(); PF.setPrice(s, 'tefas:KTV', '2026-11-10', 8400000, 'TEFAS'); s = S.validateState(s);
    var r = PF.valuationRows(s, T).find(function (x) { return x.id === 'ktv'; }); ok(r.stale.level === 'warn' || r.stale.level === 'old', 'eski rozet: ' + r.stale.level);
    PF.setPrice(s, 'tefas:KTV', T, 8410782, 'TEFAS'); r = PF.valuationRows(S.validateState(s), T).find(function (x) { return x.id === 'ktv'; }); eq(r.stale.level, 'ok');
  });
  test('Otomatik fiyat: güncellenecek anahtarlar açık pozisyonlar + USD/TL + gram altın; kapanan (ASELS) ve işlemsiz (DRVN) alınmaz', function () {
    var k = AP.keysFor(realLike()); ['metal:XAU', 'tefas:KTV', 'bist:BIMAS', 'td:SPUS', 'fx:USD'].forEach(function (x) { ok(k.indexOf(x) >= 0, x); }); ok(k.indexOf('bist:ASELS') < 0 && k.indexOf('bist:DRVN') < 0, k.join(','));
  });
  test('Otomatik fiyat seçimi: geçerli yeni fiyat kabul; yakın tarihli fiyattan büyük sıçrama ve kaynak farkı ONAYA bekler; eski tarihli aday atlanır', function () {
    var s = withLive(realLike());
    var sel = AP.select(s, [{ key: 'bist:BIMAS', p: 370 * P6, d: T }, { key: 'tefas:KTV', p: 20 * P6, d: T }, { key: 'metal:XAU', p: 5800000000, d: T, cross: { label: 'ons', check: { ok: false, diffBp: 900 } } }, { key: 'td:SPUS', p: 50 * P6, d: '2026-11-20' }], T);
    eq(sel.accept.map(function (x) { return x.cand.key; }), ['bist:BIMAS']); eq(sel.held.map(function (x) { return x.cand.key; }).sort(), ['metal:XAU', 'tefas:KTV']); eq(sel.skip.map(function (x) { return x.cand.key; }), ['td:SPUS']);
    var sel2 = AP.select(s, [{ key: 'td:SPUS', p: 55 * P6, d: T, badCurrency: 'EUR' }], T); eq(sel2.held.length, 1);
  });
  test('Kaynak ayrıştırıcılar: TradingView ABD son fiyat (NY işlem günü) ve market-data günlük kapanış; yanlış sembol reddedilir', function () {
    var r = PR.parseTradingViewUs({ data: [{ s: 'AMEX:SPUS', d: [54.03, 'USD', Date.parse('2026-11-24T17:28:00Z') / 1000] }] }, ['SPUS']); eq(r.SPUS.p, 54030000); eq(r.SPUS.date, '2026-11-24'); eq(r.SPUS.currency, 'USD');
    var m = PR.parseMarketDataBars({ symbol: 'SPWO', currency: 'USD', bars: [['2026-11-21', 0, 0, 0, 27.5], ['2026-11-24', 0, 0, 0, 27.825]] }, 'SPWO'); eq(m.p, 27825000); eq(m.date, '2026-11-24');
    throws(function () { PR.parseMarketDataBars({ symbol: 'SPUS', bars: [['2026-11-24', 0, 0, 0, 1]] }, 'SPWO'); }, /başka sembol/);
    ok(/24 ayar\/has/.test(fs.readFileSync(path.join(ROOT, 'js', 'prices.js'), 'utf8')) && /ALIŞ fiyatı/.test(fs.readFileSync(path.join(ROOT, 'js', 'prices.js'), 'utf8')), 'gram altın: has/24 ayar, alış tarafı notu');
  });

  /* ---------- 2) Kapanan ve işlemsiz pozisyonlar ---------- */
  test('Kapanan pozisyon: özet satırlarında yok, kapananlar listesinde ilk alış/son satış ve komisyon dahil gerçekleşen K/Z ile var; toplam K/Z\'ye dahil', function () {
    var s = withLive(realLike()), sm = PF.summary(s, T);
    ok(!sm.rows.some(function (r) { return r.asset.id === 'asels' || r.asset.id === 'drvn'; }), 'açık satırlarda kapanan/işlemsiz yok');
    eq(sm.closedRows.map(function (r) { return r.asset.id; }), ['asels']); eq(sm.idle.map(function (a) { return a.id; }), ['drvn']);
    var cp = PF.closedPositions(s, T); eq(cp.length, 1); eq(cp[0].firstBuy, '2026-06-01'); eq(cp[0].lastSell, '2026-10-01');
    eq(cp[0].realizedTL, (150000 - 1500) - (100000 + 1000), 'satış 1.500 − 15 komisyon − maliyet (1.000 + 10)'); eq(cp[0].feesTL, 2500);
    eq(sm.closedRealizedTL, cp[0].realizedTL); eq(sm.realizedTL, sm.openRealizedTL + sm.closedRealizedTL); eq(sm.totalPLTL, sm.unrealizedTL + sm.realizedTL);
    ok(PF.isClosed(s, s.assets.find(function (a) { return a.id === 'asels'; }))); ok(PF.isIdle(s, s.assets.find(function (a) { return a.id === 'drvn'; })));
  });
  test('Kapanan/işlemsiz varlık analize, dağılıma, sayımlara ve sağlık/risk hesabına girmez; yeniden alış yapılınca açık pozisyona döner', function () {
    var s = withLive(realLike()), e = L.effectiveState(s, T), ids = e.assets.map(function (a) { return a.id; });
    ok(ids.indexOf('asels') < 0 && ids.indexOf('drvn') < 0, ids.join(','));
    var an = C.analyze(e, '2026-11'), pos = PF.positions(s, e, an, T); ok(!pos.some(function (p) { return p.id === 'asels' || p.id === 'drvn'; }));
    s.trades.push(tr('a3', 'asels', '2026-11-20', 'buy', 2 * Q, 160 * P6, 0)); s = S.validateState(s);
    ok(!PF.isClosed(s, s.assets.find(function (a) { return a.id === 'asels'; }))); ok(PF.summary(s, T).rows.some(function (r) { return r.asset.id === 'asels'; }));
  });
  test('Ekran: Varlıklarım listesi kapanan/işlemsiz varlıkları göstermez, "Kapanan pozisyonlar" katlanır bölümü ve işlemsizler için "Alış ekle / Sil" var', function () {
    var pui = fs.readFileSync(path.join(ROOT, 'js', 'portfolio-ui.js'), 'utf8');
    ok(/!PF\.isClosed\(s, a\) && !PF\.isIdle\(s, a\)/.test(pui)); ok(/<details class="card closed-pos"/.test(pui) && /Kapanan pozisyonlar/.test(pui) && /İşlemi girilmemiş varlıklar/.test(pui));
  });

  /* ---------- 3) Komisyon / BSMV / diğer masraf ---------- */
  test('Komisyon: alışta maliyete eklenir, satışta gelirden düşülür; kırılım (komisyon + BSMV + diğer) toplamı tutmuyorsa atılır, fee esastır', function () {
    var s = realLike(), lg = PF.ledger(PF.tradesOf(s, 'asels')); eq(lg.feesTL, 2500); eq(lg.realizedTL, 47500);
    var a2 = s.trades.find(function (t) { return t.id === 'a2'; }); eq(a2.feeParts, { commission: 1000, tax: 500, other: 0 });
    var s2 = realLike(); s2.trades.find(function (t) { return t.id === 'a2'; }).feeParts = { commission: 1, tax: 1, other: 1 }; s2 = S.validateState(s2); ok(!s2.trades.find(function (t) { return t.id === 'a2'; }).feeParts, 'tutmayan kırılım atıldı'); eq(s2.trades.find(function (t) { return t.id === 'a2'; }).fee, 1500);
    eq(PF.tradeCash({ side: 'buy', qty: Q, price: 100 * P6, fee: 1500, currency: 'TRY' }), 11500); eq(PF.tradeCash({ side: 'sell', qty: Q, price: 100 * P6, fee: 1500, currency: 'TRY' }), 8500);
  });
  test('İçe aktarma (CSV): isteğe bağlı Komisyon, BSMV ve Diğer masraf sütunları toplanır ve kırılım saklanır; Komisyon sütunu yoksa 0', function () {
    var rows = [['Tarih', 'Sembol', 'İşlem', 'Adet', 'Fiyat', 'Komisyon', 'BSMV', 'Diğer masraf', 'Tutar', 'Para Birimi'], ['01.10.2026', 'ASELS', 'Satış', '10', '150', '10,00', '0,50', '1,25', '1.488,25', 'TRY']];
    var map = PF.detectTradeColumns(rows); ok(map.fee >= 0 && map.tax >= 0 && map.ofee >= 0, JSON.stringify(map));
    var it = PF.tradeRowsFromTable(rows, map, function (v) { var m = /^(\d\d)\.(\d\d)\.(\d{4})$/.exec(v); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; })[0];
    eq(it.fee, 1175); eq(it.feeParts, { commission: 1000, tax: 50, other: 125 }); eq(it.side, 'sell');
    var rows2 = [['Tarih', 'Sembol', 'İşlem', 'Adet', 'Fiyat', 'Tutar', 'Para Birimi'], ['01.10.2026', 'ASELS', 'Alış', '1', '150', '150', 'TRY']], m2 = PF.detectTradeColumns(rows2);
    eq(PF.tradeRowsFromTable(rows2, m2, function () { return '2026-10-01'; })[0].fee, 0);
    var only = [['Tarih', 'Sembol', 'İşlem', 'Adet', 'Fiyat', 'Masraf']], m3 = PF.detectTradeColumns(only); ok(m3.fee >= 0 && m3.ofee < 0, 'tek "Masraf" sütunu komisyon sayılır');
  });
  test('Ekran: elle giriş formunda Komisyon, BSMV/vergi, Diğer masraf alanları; işlem listesinde komisyon sütunu ve kırılım görünür', function () {
    var pui = fs.readFileSync(path.join(ROOT, 'js', 'portfolio-ui.js'), 'utf8');
    ok(/id="pt-fee"/.test(pui) && /id="pt-tax"/.test(pui) && /id="pt-ofee"/.test(pui)); ok(/Komisyon ve vergi<\/th>/.test(pui) && /feePartsTxt\(t\)/.test(pui));
  });

  /* ---------- 4) Düzeltme, doğrulama, geçmiş, geri al ---------- */
  test('Doğrulama: alışı küçültmek sonraki satışı eldeki adetten fazla yapıyorsa durum reddedilir (açık hata metniyle)', function () {
    var s = realLike(); s.trades.find(function (t) { return t.id === 'a1'; }).qty = 5 * Q;
    throws(function () { S.validateState(s); }, /satış .*eldeki adetten .*fazla/);
  });
  test('Geçmiş: alım-satım düzeltmesi alan alan eski → yeni yazılır; geri alınca eski hâl döner ve defter yeniden hesaplanır', function () {
    var before = realLike(), after = JSON.parse(JSON.stringify(before)), t = after.trades.find(function (x) { return x.id === 'b1'; }); t.qty = 6 * Q; t.fee = 1200; t.feeParts = { commission: 1000, tax: 200, other: 0 }; after = S.validateState(after);
    var ch = H.diff(before, after); eq(ch.length, 1); eq(ch[0].op, 'edit'); eq(ch[0].list, 'trades');
    var f = {}; ch[0].fields.forEach(function (x) { f[x.f] = [x.old, x.new]; }); eq(f.qty, [4 * Q, 6 * Q]); eq(f.fee, [0, 1200]); ok(!f.value && !ch.some(function (c) { return c.list === 'assets'; }), 'türetilen varlık değeri geçmişe yazılmaz');
    var e = H.makeEntry(ch, 'BIMAS düzeltildi', '2026-11-24T17:00:00Z'); ok(e.changes && !e.bulk); ok(/BIMAS alış 2026-09-01/.test(ch[0].label), ch[0].label);
    var st = JSON.parse(JSON.stringify(after)); H.revert(st, e); st = S.validateState(st);
    eq(st.trades.find(function (x) { return x.id === 'b1'; }).qty, 4 * Q); ok(!('feeParts' in st.trades.find(function (x) { return x.id === 'b1'; }))); eq(PF.ledger(PF.tradesOf(st, 'bimas')).units, 4 * Q);
  });
  test('Geçmiş: silme ve ekleme geri alınır (kayıt eski sırasına döner); kayıt sonradan değiştiyse geri alma çakışma der ve hiçbir şey değişmez', function () {
    var a = realLike(), b = JSON.parse(JSON.stringify(a)); b.trades = b.trades.filter(function (x) { return x.id !== 'k1'; }); b.transactions.push({ id: 'tx9', date: T, description: 'Market', amount: -5000, category: 'Market', source: 'elle' });
    var ch = H.diff(a, b), e = H.makeEntry(ch, 'x'); eq(ch.map(function (c) { return c.op; }).sort(), ['add', 'del']);
    var st = JSON.parse(JSON.stringify(b)); H.revert(st, e); eq(st.trades.map(function (x) { return x.id; }), a.trades.map(function (x) { return x.id; })); ok(!st.transactions.some(function (x) { return x.id === 'tx9'; }));
    var st2 = JSON.parse(JSON.stringify(b)); st2.transactions.find(function (x) { return x.id === 'tx9'; }).amount = -7000; var snap = JSON.stringify(st2);
    throws(function () { H.revert(st2, e); }, /sonradan değişti/); eq(JSON.stringify(st2), snap, 'çakışmada durum aynen kaldı');
  });
  test('Geçmiş: alış silmenin geri alınması bile defter doğrulamasından geçer; silinen alış geri gelince satış yine tutarlıdır', function () {
    var a = realLike(), b = JSON.parse(JSON.stringify(a)); b.trades = b.trades.filter(function (x) { return x.id !== 'a2'; }); b = S.validateState(b);
    var e = H.makeEntry(H.diff(a, b), 'satış silindi'), st = JSON.parse(JSON.stringify(b)); H.revert(st, e); st = S.validateState(st); ok(PF.isClosed(st, st.assets.find(function (x) { return x.id === 'asels'; })));
  });
  test('Geçmiş: toplu değişiklik (yedek/veri paketi) yalnızca sayılarla tutulur ve tek tek geri alınamaz; günlük en fazla ' + H.MAX_ENTRIES + ' kayıt', function () {
    var a = realLike(), b = JSON.parse(JSON.stringify(a)); for (var i = 0; i < 80; i++) b.transactions.push({ id: 'b' + i, date: T, description: 'x', amount: -100, category: 'Diğer', source: 'elle' });
    var e = H.makeEntry(H.diff(a, b), 'yedek'); ok(e.bulk && !e.changes); eq(e.counts['transactions:add'], 80); throws(function () { H.revert(b, e); }, /toplu/);
    var log = []; for (var j = 0; j < H.MAX_ENTRIES + 5; j++) log = H.push(log, { id: 'e' + j }); eq(log.length, H.MAX_ENTRIES); eq(log[0].id, 'e5');
  });
  test('Geçmiş: transfer düzeltmesi hesap bakiyelerini de eski → yeni yazar; hesap, taksit, düzenli ödeme ve hedef düzeltmeleri izlenir', function () {
    var a = realLike(); a.accounts.push({ id: 'k2', name: 'Kart', type: 'card', currency: 'TRY', balance: -10000, card: { statementDay: 1, dueDay: 11, limit: 0, statementDebt: 10000, statementYm: '2026-11', paid: 0, remindDays: 3 } }); a = S.validateState(a);
    var b = JSON.parse(JSON.stringify(a)); b.accounts[0].balance -= 5000; b.accounts[1].balance += 5000; b.transfers.push({ id: 'tf1', date: T, fromId: 'bank', toId: 'k2', amountFrom: 5000, amountTo: 5000, note: '', paidApplied: 5000 });
    var ch = H.diff(a, b); eq(ch.filter(function (c) { return c.list === 'accounts'; }).length, 2); eq(ch.filter(function (c) { return c.list === 'transfers' && c.op === 'add'; }).length, 1);
    ['installments', 'recurring', 'goals', 'accounts', 'assets', 'transactions', 'transfers', 'trades'].forEach(function (k) { ok(H.LISTS[k], k + ' izleniyor'); });
  });
  test('Geçmiş: iç içe alanlar (kart bilgileri) alt alan alan yazılır ve geri alınır; yalnız not düzeltilen transfer bakiyelere dokunmaz', function () {
    var a = realLike(); a.accounts.push({ id: 'k2', name: 'Kart', type: 'card', currency: 'TRY', balance: -10000, card: { statementDay: 1, dueDay: 11, limit: 0, statementDebt: 10000, statementYm: '2026-11', paid: 0, remindDays: 3 } }); a = S.validateState(a);
    var b = JSON.parse(JSON.stringify(a)); b.accounts[1].card.paid = 4000; var ch = H.diff(a, b); eq(ch[0].fields.map(function (f) { return f.f; }), ['card.paid']); eq(H.fieldLabel('card.paid'), 'kart bilgileri → ödenen');
    var st = JSON.parse(JSON.stringify(b)); H.revert(st, H.makeEntry(ch, 'x')); eq(st.accounts[1].card, a.accounts[1].card);
    var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'); ok(/if \(moneyChanged\) \{ applyTransfer\(s, y, -1\)/.test(app) && /tx-desc' && !txEdit/.test(app), 'not düzeltmesi bakiyeyi/kart ödemesini değiştirmez; düzeltmede kategori otomatik değişmez');
  });
  test('Ekran: İşlemler, transferler ve alım-satımlarda "Düzenle"; Ayarlar altında "Değişiklik geçmişi" sayfası (eski → yeni, Geri al)', function () {
    var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), pui = fs.readFileSync(path.join(ROOT, 'js', 'portfolio-ui.js'), 'utf8');
    ok(/data-act="tx-edit"/.test(app) && /data-act="tr-edit"/.test(app) && /data-act="pf-edit-trade"/.test(pui)); ok(/gecmis: renderHistory/.test(app) && /data-act="hist-revert"/.test(app) && /<s>/.test(app));
    ok(/ledgerCheck\(s0, tr\.assetId/.test(pui), 'silmeden önce defter kontrolü'); ok(/recordHistory\(before, msg, opts\)/.test(app), 'her mutate geçmişe yazar');
  });

  /* ---------- Sürüm ---------- */
  test('ABD: listede borsası olmayan sembol AMEX/NASDAQ/NYSE/CBOE\'de aranır; ilk bulunan alınır, başka sembol karışmaz', function () {
    var body = JSON.parse(PR.usBody(['DRVN'])); eq(body.symbols.tickers, ['AMEX:DRVN', 'NASDAQ:DRVN', 'NYSE:DRVN', 'CBOE:DRVN']);
    var r = PR.parseTradingViewUs({ data: [{ s: 'NASDAQ:DRVN', d: [17.25, 'USD', 1763928000] }, { s: 'NYSE:DRVN', d: [99, 'USD', 1763928000] }, { s: 'NASDAQ:SPUS', d: [1, 'USD', 0] }] }, ['DRVN']);
    eq(Object.keys(r), ['DRVN']); eq(r.DRVN.p, 17250000);
  });
  test('Birleştirme: tek otomatik fiyat yolu (Portföy açılınca da AutoPrice çalışır); satır içi işlem düzeltmesi geçmişe ve "düzeltildi" işaretine yazılır', function () {
    var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), pui = fs.readFileSync(path.join(ROOT, 'js', 'portfolio-ui.js'), 'utf8');
    ok(/autoPrice: function \(\) \{ return APui \? \(APui\.run\(\{\}\), true\) : false; \}/.test(app), 'PortfolioUI AutoPrice\'a bağlı değil');
    ok(/if \(X\.autoPrice && X\.autoPrice\(\)\) return;/.test(pui), 'Portföy kendi ayrı fiyat çekimini yapıyor');
    ok(/if \(!APui\) \{ \/\/ yedek/.test(app), 'eski zamanlayıcı her zaman çalışıyor (çift çekim)');
    ok(/'tx-save'[\s\S]{0,1200}tx\.editedAt = new Date\(\)\.toISOString\(\)/.test(app) && /değişiklik yok/.test(app));
    eq((app.match(/'tx-edit':/g) || []).length, 1, 'tek tx-edit eylemi');
  });
  test('Sürüm: index.html ve sw.js 8.6.1; autoprice.js ve history.js sayfada ve çevrimdışı kabukta, app.js\'ten önce', function () {
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(/VERSION = '8\.6\.1'/.test(sw) && /'autoprice', 'history'/.test(sw)); ok(idx.indexOf('8.3.1') < 0);
    ok(idx.indexOf('js/history.js?v=8.6.1') > 0 && idx.indexOf('js/history.js') < idx.indexOf('js/app.js') && idx.indexOf('js/autoprice.js') < idx.indexOf('js/app.js'));
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.4 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
