/* v8.7.3 testleri: tam sıfırlama (sifirdan-midas-2026-11-25) — bütçe dahil tüm veri, geçmiş ve kopyalar silinir, yalnız Midas yüklenir;
 * uygulama ayarları (görünüm, bildirim ayarları) durur; v8.7.2'yi uygulamış cihazda da çalışır; eski numara ve kutu tekrar uygulanmaz;
 * güvenlik kopyası tek ve 24 saatlik; Geri al yok. */
(function () {
  var fs = require('fs'), path = require('path');
  var S = require('../js/sample.js'), IB = require('../js/inbox.js'), MG = require('../js/migrate.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  var n = 0; function uid() { return 'id' + (++n); }
  function edit() {
    return { format: IB.FORMAT, version: 1, id: 'midas-only-2026-11-25', title: 'Yalnız Midas', ops: [{ op: 'holdings-wipe' }, { op: 'broker-replace', file: { format: 'finans-pusulasi-araci-kurum', version: 1, broker: 'Midas', source: 't',
      assets: [{ symbol: 'KTV', name: 'KTV', cls: 'sukuk', risk: 'safe', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV' }], trades: [{ symbol: 'KTV', date: '2026-11-03', side: 'buy', qty: 71690000000, price: 8228300, fee: 0, currency: 'TRY', fxRate: null }] } }] };
  }
  var REAL = '/workspace/finans-import/gercek-veri-2026-11-18/finans-pusulasi-gercek-veri-2026-11-18.json';
  function real() {
    var s;
    if (fs.existsSync(REAL)) { s = JSON.parse(fs.readFileSync(REAL, 'utf8')); s = s.data || s.state || s; }
    else {
      s = S.emptyState('2026-11'); s.isExample = false;
      s.accounts.push({ id: 'acc1', name: 'Maaş', type: 'bank', currency: 'TRY', balance: 3103682, emergency: true, inNetWorth: true });
      s.transactions.push({ id: 'tx1', date: '2026-11-02', description: 'Market', amount: -18459, category: 'Market', source: 'elle', accountId: 'acc1' });
    }
    s = S.validateState(clone(s)); s.settings.view = 'detailed'; s.notifSettings = s.notifSettings || {}; s.notifSettings.ntfyTopic = 'konu-test';
    return S.validateState(s);
  }
  test('Tam sıfırlama (gerçek veri): bütçe, hesaplar, transferler, taksitler, düzenliler, hedefler, eski varlık/işlemler silinir; yalnız Midas; girdi değişmez', function () {
    var s = real(), before = JSON.stringify(s), r = MG.prepare(s, edit(), S, '2026-11', uid, true), v = S.validateState(r.state);
    eq(JSON.stringify(s), before, 'girdi değişmez');
    ok(s.transactions.length > 0 || s.accounts.length > 0, 'başlangıçta bütçe var');
    eq(v.transactions.length, 0); eq(v.accounts.length, 0); eq((v.transfers || []).length, 0); eq((v.installments || []).length, 0); eq((v.recurring || []).length, 0); eq(v.goals.length, 1); eq(v.goals[0].target, 0, 'yalnız uygulamanın boş varsayılan hedefi (tutar 0)');
    eq(v.assets.map(function (a) { return a.symbol; }), ['KTV']); eq(v.trades.length, 1); eq(v.isExample, false);
    eq(Object.keys(v.prices || {}).length, 0, 'eski fiyat geçmişi'); eq((v.nwHistory || []).length <= 1, true);
    ok(/^Tüm veriler silindi/.test(r.lines[0]), r.lines[0]); ok(!r.lines.some(function (l) { return /^Tüm varlıklar temizlendi/.test(l); }));
  });
  test('Tam sıfırlama: görünüm ve bildirim ayarları korunur; örnek veride de çalışır (ayar taşınmaz, görünüm durur)', function () {
    var v = S.validateState(MG.prepare(real(), edit(), S, '2026-11', uid, true).state);
    eq(v.settings.view, 'detailed'); eq(v.notifSettings.ntfyTopic, 'konu-test');
    var ex = S.exampleState(); ex.settings.view = 'detailed'; var e = S.validateState(MG.prepare(ex, edit(), S, '2026-11', uid, true).state);
    eq(e.isExample, false); eq(e.transactions.length, 0); eq(e.assets.length, 1); eq(e.settings.view, 'detailed');
    eq(S.validateState(MG.prepare(null, edit(), S, '2026-11', uid, true).state).trades.length, 1);
  });
  test('v8.7.2 sonrası hâl (bütçe + Midas) de sıfırlanır: bütçe gider, Midas bir kez (çift kayıt yok)', function () {
    var s = real(), once = S.validateState(MG.prepare(s, edit(), S, '2026-11', uid, false).state);
    ok(once.transactions.length === s.transactions.length);
    var v = S.validateState(MG.prepare(once, edit(), S, '2026-11', uid, true).state);
    eq(v.transactions.length, 0); eq(v.accounts.length, 0); eq(v.assets.length, 1); eq(v.trades.length, 1);
  });
  test('Tanım: yeni numara, eski numarayı kapsar; aynı şifreli dosya; Geri al yok, tam değiştirme; güvenlik kopyası tek ve 24 saat', function () {
    var it = MG.ITEMS[0]; ok(/^sifirdan-midas/.test(it.id)); ok(it.reset); ok(it.supersedes.indexOf('midas-only-2026-11-25') >= 0); ok(/^bg\/tek-seferlik-\d\.enc\.json$/.test(it.path));
    eq(MG.SAFETY_MS, 24 * 3600000);
    var mg = fs.readFileSync(path.join(ROOT, 'js', 'migrate.js'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    ok(/X\.resetAll\(r\.state, '✓ Sıfırdan yüklendi/.test(mg)); ok(/Store\.setSecret\(SAFETY, \{ at: at/.test(mg) && /Store\.setSecret\(SAFETY, null\)/.test(mg));
    ok(/Store\.deleteSnapshot\(r\.id\)/.test(mg) && /setSecret\('bgwatch-res', null\)/.test(mg), 'anlık görüntüler ve sonuç önbelleği silinir');
    ok(!/prices\)\$/.test(mg), 'fiyat ayarı (anahtar) silinmez');
    ok(!/setSecret\('bgwatch'|lock/.test(mg.replace(/locks?\[|locked|locks/g, '')), 'kilit ve izleme ayarı dokunulmaz');
    ok(/function resetAll\(obj, msg\)[\s\S]*?mutate\([\s\S]*?, null\);[\s\S]*?undoStack = null; try \{ localStorage\.removeItem\(HLOG_KEY\)/.test(app), 'Geri al ve geçmiş kalmaz');
    ok(/locks\[s\] = true/.test(mg) && /lsSet\(LS \+ s,/.test(mg), 'eski numara kilitlenir ve tamam sayılır (kutu/eski kayıt tekrar uygulanmaz)');
  });
  test('Sürüm 8.7.4: sayfa, kabuk ve uygulama sürümü', function () {
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    eq(IB.APP_VERSION, '8.7.4'); ok(/VERSION = '8\.7\.4'/.test(sw)); ok(idx.indexOf('js/migrate.js?v=8.7.4') > 0 && idx.indexOf('?v=8.7.3') < 0);
  });
  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.7.3 testi geçti'); if (passed !== results.length) process.exit(1);
  });
})();
