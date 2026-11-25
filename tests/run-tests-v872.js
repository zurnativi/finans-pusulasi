/* v8.7.2 testleri: tek seferlik yerleşik düzenleme (her cihazda, arka plan izleme olmadan) — gerçek veride altın dahil tüm varlıklar silinip yalnız dosyadakiler
 * gelir, bütçe durur; örnek/boş veride örnek bütçe de bırakılmaz; girdi değişmez; uzaktan kutu ile aynı numara iki kez uygulanmaz; sayfa/kabuk bağlantıları, sürüm 8.7.2. */
(function () {
  var fs = require('fs'), path = require('path');
  var S = require('../js/sample.js'), IB = require('../js/inbox.js'), MG = require('../js/migrate.js'), BG = require('../js/bgwatch.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  var n = 0; function uid() { return 'id' + (++n); }
  function real() {
    var s = S.emptyState('2026-11'); s.isExample = false;
    s.accounts.push({ id: 'acc1', name: 'Maaş hesabı', type: 'bank', currency: 'TRY', balance: 3103682, emergency: true, inNetWorth: true });
    s.transactions.push({ id: 'tx1', date: '2026-11-02', description: 'Market', amount: -18459, category: 'Market', source: 'elle', accountId: 'acc1' });
    s.assets = [{ id: 'a-gold', name: 'Fiziki gram altın', symbol: 'ALTIN', cls: 'gold', risk: 'medium', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'metal:XAU' }];
    s.trades = [{ id: 't3', assetId: 'a-gold', date: '2024-01-15', side: 'buy', qty: 11100000000, price: 2720000000, fee: 0, currency: 'TRY', fxRate: null, note: '', source: 'elle' }];
    return S.validateState(clone(s));
  }
  function edit() {
    return { format: IB.FORMAT, version: 1, id: 'midas-only-2026-11-25', title: 'Yalnız Midas', ops: [{ op: 'holdings-wipe' }, { op: 'broker-replace', file: { format: 'finans-pusulasi-araci-kurum', version: 1, broker: 'Midas', source: 't',
      assets: [{ symbol: 'KTV', name: 'KTV', cls: 'sukuk', risk: 'safe', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV' }], trades: [{ symbol: 'KTV', date: '2026-11-03', side: 'buy', qty: 71690000000, price: 8228300, fee: 0, currency: 'TRY', fxRate: null }] } }] };
  }
  test('Gerçek veri: altın dahil eski varlıklar silinir, yalnız dosyadakiler; bütçe durur; girdi değişmez', function () {
    var s = real(), before = JSON.stringify(s), r = MG.prepare(s, edit(), S, '2026-11', uid), v = S.validateState(r.state);
    eq(JSON.stringify(s), before, 'girdi değişmez'); ok(!r.fromExample);
    eq(v.assets.map(function (a) { return a.symbol; }), ['KTV']); eq(v.trades.length, 1); eq(v.accounts.length, 1); eq(v.transactions.length, 1);
    ok(/^Tüm varlıklar temizlendi: 1 varlık, 1 alım-satım/.test(r.lines[0]), r.lines[0]);
  });
  test('Örnek veri / hiç veri yok: örnek bütçe bırakılmaz, yalnız Midas yüklenir, artık örnek değil; görünüm ayarı korunur', function () {
    var ex = S.exampleState(); ex.settings.view = 'detailed';
    var r = MG.prepare(ex, edit(), S, '2026-11', uid), v = S.validateState(r.state);
    ok(r.fromExample && r.lines[0] === 'Örnek veri kaldırıldı'); eq(v.isExample, false); eq(v.assets.length, 1); eq(v.transactions.length, 0); eq(v.settings.view, 'detailed');
    var r2 = MG.prepare(null, edit(), S, '2026-11', uid); eq(S.validateState(r2.state).trades.length, 1);
    var e2 = MG.prepare(S.emptyState('2026-11'), edit(), S, '2026-11', uid); ok(!e2.fromExample); eq(S.validateState(e2.state).assets.length, 1);
  });
  test('Tanım: tek kayıt midas-only-2026-11-25, anahtar 32 bayt, dosya market-data bg/ altında; kutu kaydıyla eşleşir', function () {
    eq(MG.ITEMS.length, 1); eq(MG.ITEMS[0].id, 'sifirdan-midas-2026-11-25'); eq(MG.ITEMS[0].editId, 'midas-only-2026-11-25'); ok(MG.ITEMS[0].supersedes.indexOf('midas-only-2026-11-25') >= 0); eq(BG.unb64u(MG.ITEMS[0].key).length, 32);
    ok(/^bg\/[a-z0-9.-]+\.enc\.json$/.test(MG.ITEMS[0].path) && MG.RAW.indexOf('/market-data/') > 0); ok(MG.ITEMS[0].path.indexOf('midas') < 0, 'yol adında içerik ipucu yok');
    eq(IB.APP_VERSION, '8.7.3');
  });
  test('Arayüz: app.js yerleşik düzenlemeyi başlatır (kopya + mutate); kutu aynı numarayı tekrar uygulamaz; sayfa ve kabukta migrate.js', function () {
    var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), ui = fs.readFileSync(path.join(ROOT, 'js', 'bgwatch-ui.js'), 'utf8'), mg = fs.readFileSync(path.join(ROOT, 'js', 'migrate.js'), 'utf8');
    ok(/window\.Migrate\.start\(\{ state: function \(\) \{ return state; \}, mutate: mutate, resetAll: resetAll, toast: toast, uid: S\.uid, snapshot:/.test(app));
    var iS = mg.indexOf("X.snapshot('Tek seferlik düzenleme öncesi: '"), iM = mg.indexOf('X.mutate(function (s)'); ok(iS > 0 && iM > iS, 'önce kopya');
    ok(/inboxDone\(item\.id\)/.test(mg) && /lsSet\(LS \+ item\.id/.test(mg), 'kutu uyguladıysa atla; numarayı kaydet');
    ok(/MG\.locked\(edit\.id\)\) return null/.test(ui) && /MG\.isDone\(edit\.id\)\) return Promise\.resolve\(recordExternal/.test(ui));
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(idx.indexOf('js/migrate.js?v=8.7.3') > idx.indexOf('js/inbox.js?v=8.7.3') && idx.indexOf('js/migrate.js') < idx.indexOf('js/app.js')); ok(/'migrate'/.test(sw) && /VERSION = '8\.7\.3'/.test(sw) && /skipWaiting/.test(sw));
  });
  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.7.2 testi geçti'); if (passed !== results.length) process.exit(1);
  });
})();
