/* v8.6.1 testleri: aracı kurum geçmiş dosyası (ör. Midas) — biçim doğrulama, plan (yeni/değişecek/dokunulmayacak),
 * uygulama (yalnız dosyadaki varlıkların alım-satımı değişir, bütçe ve diğer varlıklar durur), saatle gün içi sıra, tam varlık bilgisi,
 * temizlenmiş portföyde de çalışma, arayüz girişleri ve sürüm 8.6.1. Ağ gerekmez. */
(function () {
  var fs = require('fs'), path = require('path');
  var S = require('../js/sample.js'), PF = require('../js/portfolio.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  var n = 0; function uid() { return 'id' + (++n); }

  function seeded() {
    var s = S.emptyState('2026-11'); s.isExample = false;
    s.accounts.push({ id: 'acc1', name: 'Maaş hesabı', type: 'bank', currency: 'TRY', balance: 3103682, emergency: true, inNetWorth: true });
    s.transactions.push({ id: 'tx1', date: '2026-11-02', description: 'Market', amount: -18459, category: 'Market', source: 'elle', accountId: 'acc1' });
    s.assets = [
      { id: 'a-ktv', name: 'KTV fonu', symbol: 'KTV', cls: 'sukuk', risk: 'safe', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV', halal: { status: 'uygun', note: 'kira sertifikası', source: 'TEFAS', date: '2026-11-18' } },
      { id: 'a-bim', name: 'BIMAS', symbol: 'BIMAS', cls: 'other', risk: 'risky', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: null, halal: { status: 'bilinmiyor', note: '', source: '', date: null } },
      { id: 'a-gold', name: 'Fiziki gram altın', symbol: 'ALTIN', cls: 'gold', risk: 'medium', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'metal:XAU' }
    ];
    s.trades = [
      { id: 't1', assetId: 'a-ktv', date: '2026-09-30', side: 'buy', qty: 25000000000, price: 7996840, fee: 0, currency: 'TRY', fxRate: null, note: 'eski', source: 'elle' },
      { id: 't2', assetId: 'a-bim', date: '2026-10-12', side: 'buy', qty: 400000000, price: 397750000, fee: 0, currency: 'TRY', fxRate: null, note: '', source: 'elle' },
      { id: 't3', assetId: 'a-gold', date: '2024-01-15', side: 'buy', qty: 11100000000, price: 2720000000, fee: 0, currency: 'TRY', fxRate: null, note: '', source: 'elle' }
    ];
    return S.validateState(clone(s));
  }
  function file() {
    return { format: 'finans-pusulasi-araci-kurum', version: 1, broker: 'Midas', source: 'Midas emir geçmişi (test)',
      assets: [
        { symbol: 'KTV', name: 'KTV — kira sertifikası fonu', cls: 'sukuk', risk: 'safe', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV', halal: { status: 'uygun', note: '', source: '', date: null } },
        { symbol: 'BIMAS', name: 'BIMAS (BIST)', cls: 'katilim_stock', risk: 'risky', currency: 'TRY', lot: 'whole', priceKey: 'bist:BIMAS', halal: { status: 'uygun', note: 'XKTUM', source: 'BIST', date: '2026-11-18' } },
        { symbol: 'SPUS', name: 'SPUS ETF', cls: 'halal_etf', risk: 'risky', currency: 'USD', lot: 'fraction', priceKey: 'td:SPUS', halal: { status: 'uygun', note: '', source: '', date: null } }
      ],
      trades: [
        { symbol: 'KTV', date: '2026-09-30', time: '16:29:23', side: 'buy', qty: 25000000000, price: 7996840, fee: 0, currency: 'TRY', fxRate: null, note: 'Midas: Fon emri, 16:29:23' },
        { symbol: 'KTV', date: '2026-11-03', time: '15:34:42', side: 'buy', qty: 103800000000, price: 8257081, fee: 0, currency: 'TRY', fxRate: null, note: 'Midas: Fon emri, 15:34:42' },
        { symbol: 'KTV', date: '2026-11-03', time: '11:49:33', side: 'sell', qty: 10000000000, price: 8248892, fee: 0, currency: 'TRY', fxRate: null, note: 'Midas: Fon emri, 11:49:33' },
        { symbol: 'BIMAS', date: '2026-10-12', time: '13:21:51', side: 'buy', qty: 400000000, price: 397750000, fee: 0, currency: 'TRY', fxRate: null, note: 'Midas: Piyasa emri, 13:21:51' },
        { symbol: 'BIMAS', date: '2026-11-17', time: '20:47:32', side: 'sell', qty: 400000000, price: 390000000, fee: 0, currency: 'TRY', fxRate: null, note: 'Midas: Zarar durdur emri, 20:47:32' },
        { symbol: 'SPUS', date: '2026-10-20', time: '13:16:51', side: 'buy', qty: 338983051, price: 59000000, fee: 150, currency: 'USD', fxRate: 4958, note: 'Midas: Limit emri, 13:16:51' }
      ] };
  }

  test('Biçim: isBrokerFile ve doğrulama (sürüm, sembol, para birimi, kur, saat, eksik varlık)', function () {
    ok(PF.isBrokerFile(file())); ok(!PF.isBrokerFile({ schema: 4 })); eq(PF.brokerFileErrors(file()), []);
    var f = file(); f.version = 2; ok(PF.brokerFileErrors(f).join().indexOf('sürüm') >= 0);
    f = file(); f.trades[5].fxRate = null; ok(/kur eksik/.test(PF.brokerFileErrors(f).join()));
    f = file(); f.trades[0].time = '25:00'; ok(/saat hatalı/.test(PF.brokerFileErrors(f).join()));
    f = file(); f.trades.push({ symbol: 'XXX', date: '2026-10-01', side: 'buy', qty: 1, price: 1, currency: 'TRY' }); ok(/varlığı dosyada yok/.test(PF.brokerFileErrors(f).join()));
    f = file(); f.assets[2].priceKey = 'bist:SPUS'; ok(/fiyat kaynağı/.test(PF.brokerFileErrors(f).join()));
    f = file(); f.trades[4].qty = 500000000; ok(/fazla/.test(PF.brokerImportPlan(seeded(), f).errors.join()));
  });

  test('Plan: mevcut KTV/BIMAS değişecek, SPUS yeni; altın ve bütçe dokunulmaz listesinde', function () {
    var p = PF.brokerImportPlan(seeded(), file());
    eq(p.errors, []); eq(p.added, 1); eq(p.replaced, 2); eq(p.removedTrades, 2); eq(p.trades, 6);
    eq(p.kept, [{ name: 'Fiziki gram altın', trades: 1 }]);
    var ktv = p.rows.find(function (r) { return r.symbol === 'KTV'; }); eq([ktv.action, ktv.oldTrades, ktv.newTrades, ktv.qty, ktv.open], ['replace', 1, 3, 118800000000, true]);
    var bim = p.rows.find(function (r) { return r.symbol === 'BIMAS'; }); eq(bim.open, false);
  });

  test('Uygula: dosyadaki varlıkların işlemleri değişir, kimlik/stop korunur, çıplak alanlar tamamlanır; altın ve bütçe aynen kalır', function () {
    var s = seeded(); s.assets[0].stop = { price: 7000000, mode: 'price', setAt: '2026-11-20T10:00:00Z', reason: 'x', midas: true };
    var before = clone({ tx: s.transactions, acc: s.accounts, gold: s.assets[2], gt: s.trades[2] });
    PF.applyBrokerImport(s, file(), uid); s = S.validateState(clone(s));
    eq(clone({ tx: s.transactions, acc: s.accounts, gold: s.assets.find(function (a) { return a.id === 'a-gold'; }), gt: s.trades.find(function (t) { return t.id === 't3'; }) }).tx, before.tx);
    ok(s.trades.some(function (t) { return t.id === 't3'; }), 'altın işlemi durur');
    ok(!s.trades.some(function (t) { return t.id === 't1' || t.id === 't2'; }), 'eski Midas işlemleri kalkar');
    var ktv = s.assets.find(function (a) { return a.id === 'a-ktv'; }); ok(ktv && ktv.stop && ktv.stop.price === 7000000, 'kimlik ve stop korunur');
    var bim = s.assets.find(function (a) { return a.id === 'a-bim'; }); eq([bim.priceKey, bim.cls, bim.halal.status], ['bist:BIMAS', 'katilim_stock', 'uygun']);
    var spus = s.assets.find(function (a) { return a.symbol === 'SPUS'; }); eq([spus.currency, spus.priceKey, spus.cls, spus.lot, spus.tracking], ['USD', 'td:SPUS', 'halal_etf', 'fraction', 'trades']);
    eq(s.trades.filter(function (t) { return t.assetId === spus.id; })[0].fee, 150);
    ok(s.trades.every(function (t) { return t.assetId === 'a-gold' || (t.time && /^Midas: /.test(t.note)); }), 'saat ve not');
    eq(s.trades.length, 7);
  });

  test('Saat: aynı gün satış (11:49) alıştan (15:34) önce sıralanır; adet ve maliyet doğru', function () {
    var s = seeded(); PF.applyBrokerImport(s, file(), uid); s = S.validateState(clone(s));
    var ktv = s.assets.find(function (a) { return a.id === 'a-ktv'; });
    var ts = PF.sortTrades(PF.tradesOf(s, ktv.id)); eq(ts.map(function (t) { return t.time; }), ['16:29:23', '11:49:33', '15:34:42']);
    var lg = PF.position(s, ktv, '2026-11-25').ledger; eq(lg.units, 118800000000);
    // satış 250 adetlik ilk alımın ortalamasından düşülür: gerçekleşen = 100×(8,248892−7,99684)
    eq(lg.realizedTL, Math.round(100 * (8.248892 - 7.99684) * 100));
  });

  test('Temizlenmiş portföyde: hepsi yeni açılır; ikinci uygulama aynı sonucu verir (mükerrer oluşmaz)', function () {
    var s = seeded(); PF.wipeHoldings(s);
    var p = PF.brokerImportPlan(s, file()); eq([p.added, p.replaced, p.kept.length], [3, 0, 0]);
    PF.applyBrokerImport(s, file(), uid); s = S.validateState(clone(s)); eq([s.assets.length, s.trades.length], [3, 6]);
    PF.applyBrokerImport(s, file(), uid); s = S.validateState(clone(s)); eq([s.assets.length, s.trades.length], [3, 6]);
    eq(s.transactions.length, 1);
  });

  test('Hatalı dosya: applyBrokerImport hata verir ve durumu değiştirmez; elle izlenen varlık reddedilir', function () {
    var s = seeded(), snap = JSON.stringify(s), f = file(); f.trades[5].fxRate = 0;
    var threw = false; try { PF.applyBrokerImport(s, f, uid); } catch (e) { threw = true; } ok(threw); eq(JSON.stringify(s), snap);
    s.assets[1].tracking = 'manual'; s.trades = s.trades.filter(function (t) { return t.assetId !== 'a-bim'; });
    ok(/elle değerle/.test(PF.brokerImportPlan(s, file()).errors.join()));
  });

  test('Doğrulama: işlem saati isteğe bağlı; hatalı saat silinir, geçerli saat kalır', function () {
    var s = seeded(); s.trades[0].time = '16:29:23'; s.trades[1].time = 'öğlen';
    s = S.validateState(clone(s)); eq(s.trades[0].time, '16:29:23'); ok(s.trades[1].time === undefined);
  });

  test('Arayüz: Veri ekle\'de «Aracı kurum geçmişini uygula», önizleme penceresi, yedek + otomatik kopya, Geri al; yanlış düğmeden de güvenli yol', function () {
    var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    ok(/data-pick="\.json,application\/json"><b>🏦 Aracı kurum geçmişini uygula/.test(app));
    ok(/function openBrokerImportDialog/.test(app) && /Değişecek/.test(app) && /Dokunulmayacak/.test(app));
    ok(/finans-yedek-araci-kurum-oncesi-/.test(app) && /geçmişi uygulanmadan önce/.test(app));
    ok(/PF\.applyBrokerImport\(s, obj, S\.uid\)/.test(app) && /mutate\(function \(s\) \{ PF\.applyBrokerImport/.test(app));
    ok(/PF\.isBrokerFile\(obj\)\) \{ brk = true; openBrokerImportDialog/.test(app), 'Yedekten geri yükle ile seçilse de geri yükleme yapılmaz');
    ok(/readBrokerFile\(file\)\.then/.test(app));
  });

  test('Sürüm: index.html ve sw.js 8.8.0; aracı kurum işlevleri dışa açık', function () {
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(/VERSION = '8\.8\.0'/.test(sw)); ok(idx.indexOf('js/app.js?v=8.8.0') > 0); ok(idx.indexOf('8.6.0') < 0);
    ['isBrokerFile', 'brokerFileErrors', 'brokerImportPlan', 'applyBrokerImport'].forEach(function (k) { ok(typeof PF[k] === 'function', k); });
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.6.1 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
