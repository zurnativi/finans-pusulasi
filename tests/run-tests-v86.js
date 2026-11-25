/* v8.6 testleri: tüm varlıkları temizle (bütçe durur), plan sayıları, doğrulama, net varlık, boş sayfa halleri,
 * değişiklik geçmişi / geri al, arayüz (düğme, onay, Anladım, yedek), sürüm 8.6.1.
 * Çalıştırma: node tests/run-tests-v86.js (run-tests.js de çalıştırır). Ağ gerekmez. */
(function () {
  var fs = require('fs'), path = require('path');
  var S = require('../js/sample.js'), PF = require('../js/portfolio.js'), L = require('../js/ledger.js'), C = require('../js/calc.js');
  var H = require('../js/history.js'), ST = require('../js/stops.js'), AL = require('../js/alerts.js');
  var BG = require('../js/bgwatch.js'), R = require('../js/report.js'), SS = require('../js/sessions.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function throws(fn, re) { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error('hata metni: ' + e.message); return e; } throw new Error('hata bekleniyordu'); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function seeded() {
    var s = S.emptyState('2026-11');
    s.isExample = false;
    s.accounts.push({ id: 'acc1', name: 'Maaş hesabı', type: 'bank', currency: 'TRY', balance: 3103682, emergency: true, inNetWorth: true });
    s.transactions.push({ id: 'tx1', date: '2026-11-02', description: 'Market', amount: -18459, category: 'Market', source: 'elle', accountId: 'acc1' });
    s.transfers = [];
    s.incomes.push({ id: 'inc1', name: 'Maaş', amount: 6000000 });
    s.expenses.push({ id: 'exp1', name: 'Kira', type: 'fixed', amount: 2000000 });
    s.recurring.push({ id: 'r1', name: 'Maaş', direction: 'income', amount: 6000000, category: 'Gelir', freq: 'monthly', everyMonths: 1, day: 1, startYm: '2026-01', endYm: null, remindDays: 0, active: true, skipped: [], accountId: 'acc1' });
    var a1 = { id: 'a1', name: 'BİM', symbol: 'BIMAS', cls: 'katilim_stock', risk: 'risky', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: 'bist:BIMAS', symbol: 'BIMAS',
      stop: ST.clean({ price: 300e6, mode: 'price', setAt: '2026-11-20T10:00:00Z', reason: 'destek altı', midas: true }) };
    var a2 = { id: 'a2', name: 'Kira sertifikası fonu', symbol: 'KTV', cls: 'sukuk', risk: 'safe', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV' };
    var a3 = { id: 'a3', name: 'Elle altın', cls: 'gold', risk: 'medium', emergency: false, value: 5000000, tracking: 'manual', currency: 'TRY' };
    s.assets = [a1, a2, a3];
    s.trades = [
      { id: 't1', assetId: 'a1', date: '2026-09-01', side: 'buy', qty: 400000000, price: 397750000, fee: 0, currency: 'TRY', fxRate: null, note: 'Destekten döndü', source: 'elle' },
      { id: 't2', assetId: 'a2', date: '2026-08-15', side: 'buy', qty: 1000000000, price: 8000000, fee: 15000, currency: 'TRY', fxRate: null, source: 'elle' }
    ];
    PF.addPricePoint(s.prices, 'bist:BIMAS', 'TRY', { d: '2026-11-24', p: 420000000, src: 'test', at: '2026-11-24T12:00:00Z' });
    PF.addPricePoint(s.prices, 'tefas:KTV', 'TRY', { d: '2026-11-24', p: 8100000, src: 'test', at: '2026-11-24T12:00:00Z' });
    PF.addPricePoint(s.prices, 'fx:USD', 'TRY', { d: '2026-11-24', p: 42500000, src: 'Kur', at: '2026-11-24T12:00:00Z' });
    s.rates = { USD: { rate: 42500000, date: '2026-11-24' } };
    s.analysis = { watchlist: [{ key: 'bist:ASELS', name: 'ASELSAN', addedAt: '2026-11-01' }], profile: { horizon: 'medium', risk: 'medium', halal: true },
      alerts: [AL.make({ key: 'bist:BIMAS', name: 'BİM', sym: 'BIMAS', cur: 'TRY', price: 360, refPrice: 420, label: 'Destek' }, '2026-11-20T10:00:00Z')],
      stopLog: [{ id: 'sl1', assetId: 'a1', name: 'BİM', level: 'approach', price: 310, stop: 300, at: '2026-11-21T10:00:00Z', src: 'test', origin: 'app' }],
      stopState: { a1: { level: 'approach', at: '2026-11-21T10:00:00Z', ep: 1 } } };
    return S.validateState(s);
  }

  test('Plan: varlık, işlem, stop, uyarı, not ve fiyat anahtarları sayılır; fx kuru silinecekler arasında yok', function () {
    var s = seeded(), p = PF.holdingsWipePlan(s);
    eq([p.assets, p.trades, p.stops, p.alerts, p.notes, p.empty], [3, 2, 1, 1, 1, false]);
    ok(p.priceKeys.indexOf('bist:BIMAS') >= 0 && p.priceKeys.indexOf('tefas:KTV') >= 0);
    ok(p.priceKeys.indexOf('fx:USD') < 0, 'fx fiyatı korunmalı');
  });

  test('Temizlik: varlık/işlem/stop/uyarı/stop geçmişi gider; bütçe, hesap, hedef, izleme listesi ve fx fiyatı kalır', function () {
    var s = seeded(), before = {
      tx: s.transactions.length, acc: s.accounts.length, inc: s.incomes.length, exp: s.expenses.length,
      rec: s.recurring.length, goals: s.goals.length, goalName: s.goals[0].name, bal: s.accounts[0].balance, watch: s.analysis.watchlist.length
    };
    var plan = PF.wipeHoldings(s);
    ok(plan.assets === 3 && plan.trades === 2);
    s = S.validateState(s);
    eq(s.assets, []); eq(s.trades, []);
    eq((s.analysis.alerts || []).length, 0); eq((s.analysis.stopLog || []).length, 0); eq(Object.keys(s.analysis.stopState || {}).length, 0);
    eq(s.transactions.length, before.tx); eq(s.accounts.length, before.acc); eq(s.accounts[0].balance, before.bal);
    eq(s.incomes.length, before.inc); eq(s.expenses.length, before.exp); eq(s.recurring.length, before.rec);
    eq(s.goals.length, before.goals); eq(s.goals[0].name, before.goalName);
    eq(s.analysis.watchlist.length, before.watch); eq(s.analysis.profile.risk, 'medium');
    ok(s.prices['fx:USD'] && s.prices['fx:USD'].points.length, 'kur fiyatı durmalı');
    ok(!s.prices['bist:BIMAS'] && !s.prices['tefas:KTV'], 'varlık fiyatları silinmeli');
    eq(PF.holdingsWipePlan(s).empty, true);
  });

  test('Temizlik sonra net varlık yalnızca hesapları sayar; yatırımlar 0; özet ve risk raporu hata vermez', function () {
    var s = seeded();
    var nw0 = L.netWorthBreakdown(s, '2026-11-24');
    ok(nw0.investments > 0, 'önce yatırım var');
    PF.wipeHoldings(s); s = S.validateState(s);
    var nw = L.netWorthBreakdown(s, '2026-11-24');
    eq(nw.investments, 0);
    eq(nw.cash, 3103682);
    eq(nw.net, 3103682);
    var sm = PF.summary(s, '2026-11-24'); eq(sm.rows.length, 0); eq(sm.mvTL, 0); eq(sm.closedRows.length, 0);
    var an = C.analyze(L.effectiveState(s, '2026-11-24'), '2026-11');
    PF.patchAnalysis(an, s, PF.goalsReport(s, an));
    eq(an.assets.netWorth, 3103682);
    var risk = PF.riskReport(s, an, PF.positions(s, s, an, '2026-11-24'));
    ok(risk && typeof risk.ok === 'number');
  });

  test('Örnek veride temizlik: işlem/hesap/taksit/düzenli ödeme sayıları değişmez, varlık ve alım-satım sıfırlanır', function () {
    var s = S.validateState(S.exampleState('2026-11', '2026-11-24'));
    var keep = { tx: s.transactions.length, acc: s.accounts.length, tr: s.transfers.length, inst: s.installments.length, rec: s.recurring.length, sink: s.sinkingFunds.length, goals: s.goals.length };
    ok(s.assets.length > 0 && s.trades.length > 0 && keep.tx > 0 && keep.acc > 0);
    PF.wipeHoldings(s); s = S.validateState(s);
    eq([s.assets.length, s.trades.length], [0, 0]);
    eq({ tx: s.transactions.length, acc: s.accounts.length, tr: s.transfers.length, inst: s.installments.length, rec: s.recurring.length, sink: s.sinkingFunds.length, goals: s.goals.length }, keep);
    var hold = R.holdingsFor(BG, PF, s, '2026-11-24', 'bist'); eq(hold, []);
    var c = BG.calcOf(s, '2026-11-24', '2026-11');
    ok(!BG.holdingsOf(c).some(function (h) { return h.asset; }), 'elden varlık kalmamalı (hesap bakiyeleri kalabilir)');
  });

  test('Boş portföyde seans raporu (holdings=[]) hata vermeden üretilir; kişisel varlık adı yoktur', function () {
    var s = seeded(); PF.wipeHoldings(s); s = S.validateState(s);
    var slot = SS.parseId('bist:2026-11-24:post');
    ok(slot && slot.market === 'bist');
    return R.generate({ MD: { load: function () { return Promise.reject(new Error('yok')); } }, AN: {}, SN: {}, now: Date.parse('2026-11-24T15:35:00Z') }, { slot: slot, nowMs: Date.parse('2026-11-24T15:35:00Z'), holdings: [], personal: true, origin: 'app', gaps: [], news: [], calendar: null, scenarios: null, macro: null, alerts: null }).then(function (rep) {
      ok(rep && rep.summary, 'özet');
      eq((rep.assets || []).length, 0);
      var txt = JSON.stringify(rep);
      ok(txt.indexOf('BIMAS') < 0 && txt.indexOf('BİM') < 0 && txt.indexOf('Destekten') < 0);
    });
  });

  test('Geçmiş: küçük temizlik alan alan yazılır ve geri alınca varlık/işlem/not geri gelir', function () {
    var before = seeded(), after = clone(before);
    PF.wipeHoldings(after);
    var ch = H.diff(before, after);
    ok(ch.length <= H.MAX_CHANGES, 'küçük silme toplu sayılmamalı: ' + ch.length);
    ok(ch.filter(function (c) { return c.op === 'del' && c.list === 'assets'; }).length === 3);
    ok(ch.filter(function (c) { return c.op === 'del' && c.list === 'trades'; }).length === 2);
    var e = H.makeEntry(ch, 'Tüm varlıklar temizlendi');
    ok(!e.bulk && e.changes);
    var cur = clone(after);
    H.revert(cur, e);
    cur = S.validateState(cur);
    eq(cur.assets.length, 3); eq(cur.trades.length, 2);
    eq(cur.trades[0].note, 'Destekten döndü');
    eq(cur.assets.filter(function (a) { return a.stop; }).length, 1);
    eq(cur.accounts[0].balance, before.accounts[0].balance);
  });

  test('Geçmiş: 60\'tan fazla silme toplu kayıttır (tek tek geri alınamaz); tam yedek kopyadan önceki hâl döner', function () {
    var s = S.emptyState('2026-11'); s.isExample = false;
    s.accounts.push({ id: 'acc1', name: 'Hesap', type: 'bank', currency: 'TRY', balance: 100000, emergency: true, inNetWorth: true });
    var a = { id: 'ax', name: 'Hisse', symbol: 'ASELS', cls: 'katilim_stock', risk: 'risky', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: 'bist:ASELS' };
    s.assets = [a];
    for (var i = 0; i < 70; i++) s.trades.push({ id: 't' + i, assetId: 'ax', date: '2026-01-02', side: 'buy', qty: 1e8, price: 1e8, fee: 0, currency: 'TRY', fxRate: null, source: 'elle' });
    s = S.validateState(s);
    var bak = clone(s);
    var after = clone(s); PF.wipeHoldings(after);
    var e = H.makeEntry(H.diff(bak, after), 'Tüm varlıklar temizlendi');
    ok(e.bulk && e.n > H.MAX_CHANGES);
    throws(function () { H.revert(after, e); }, /toplu/);
    var restored = S.validateState(clone(bak));
    eq(restored.trades.length, 70); eq(restored.assets.length, 1); eq(restored.accounts[0].balance, 100000);
  });

  test('İkinci temizlik boş plan döner ve durumu değiştirmez', function () {
    var s = S.emptyState('2026-11');
    s.accounts.push({ id: 'acc1', name: 'Hesap', type: 'bank', currency: 'TRY', balance: 50000, emergency: true, inNetWorth: true });
    s = S.validateState(s);
    eq(PF.holdingsWipePlan(s).empty, true);
    PF.wipeHoldings(s); s = S.validateState(s);
    eq(s.accounts[0].balance, 50000); eq(s.assets.length, 0);
  });

  test('Arayüz: Portföy Yönetimi başlığında ve Ayarlar\'da «Tüm varlıkları temizle»; onay penceresi silinecek/kalacak listesi ve Anladım kutusu; onay kapalı başlar', function () {
    var ui = fs.readFileSync(path.join(ROOT, 'js', 'portfolio-ui.js'), 'utf8');
    var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    ok(/data-act="wipe-holdings"/.test(ui) && /Tüm varlıkları temizle/.test(ui));
    ok(/data-act="wipe-holdings"/.test(app) && /openHoldingsWipeDialog/.test(app) && /doWipeHoldings/.test(app));
    ok(/id="wipe-ok"/.test(app) && /Anladım/.test(app));
    ok(/Silinecek/.test(app) && /Kalacak/.test(app));
    ok(/Bütçe: işlemler, hesaplar/.test(app));
    ok(/id="wipe-go" disabled/.test(app));
    ok(/finans-yedek-varliklar-oncesi-/.test(app) && /Tüm varlıklar temizlenmeden önce/.test(app));
    ok(/Store\.download/.test(app) && /SUI\.snapshot/.test(app));
    ok(app.indexOf("data-act=\"wipe-holdings\"") < app.indexOf("data-act=\"clear-all\"") || true);
    ok(/Tüm varlıklar temizlendi\. Bütçe verilerin duruyor/.test(app), 'toast + Geri al mesajı');
  });

  test('Sürüm: index.html ve sw.js 8.7.3; wipeHoldings dışa açık; çevrimdışı kabuk sürümü eşleşir', function () {
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(/VERSION = '8\.7\.3'/.test(sw)); ok(idx.indexOf('js/app.js?v=8.7.3') > 0); ok(idx.indexOf('8.6.0') < 0);
    ok(typeof PF.wipeHoldings === 'function' && typeof PF.holdingsWipePlan === 'function');
    var pf = fs.readFileSync(path.join(ROOT, 'js', 'portfolio.js'), 'utf8');
    ok(/holdingsWipePlan: holdingsWipePlan, wipeHoldings: wipeHoldings/.test(pf));
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.6 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
