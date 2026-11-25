/* v8.7.4 testleri: düzeltilmiş Midas tarihleriyle ikinci tam sıfırlama (sifirdan-midas-v2-2026-11-25) — eski iki numarayı kapsar; v8.7.3'ü uygulamış cihazda da
 * çalışır; ilk sıfırlamanın güvenlik kopyası (24 saat dolmadıysa) üzerine yazılmaz; düzeltilmiş dosyada zarar durdur/limit satışı alışla aynı güne düşmez. */
(function () {
  var fs = require('fs'), path = require('path');
  var S = require('../js/sample.js'), IB = require('../js/inbox.js'), MG = require('../js/migrate.js'), BG = require('../js/bgwatch.js'), PF = require('../js/portfolio.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  var FILE = '/workspace/finans-import/midas-2026-11-25/finans-midas-portfoy-2026-11-25.json';
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  test('Tanım: yeni numara ve yeni dosya; önceki iki numarayı kapsar; anahtar 32 bayt', function () {
    eq(MG.ITEMS.length, 1); var it = MG.ITEMS[0];
    eq(it.id, 'sifirdan-midas-v2-2026-11-25'); eq(it.editId, 'midas-sifirdan-v2-2026-11-25'); eq(it.path, 'bg/tek-seferlik-2.enc.json'); ok(it.reset);
    eq(it.supersedes, ['sifirdan-midas-2026-11-25', 'midas-only-2026-11-25']); eq(BG.unb64u(it.key).length, 32);
  });
  test('Güvenlik kopyası: 24 saat dolmamış eski kopya varsa üzerine yazılmaz (asıl sıfırlama öncesi hâl korunur)', function () {
    var mg = fs.readFileSync(path.join(ROOT, 'js', 'migrate.js'), 'utf8');
    ok(/Store\.getSecret\(SAFETY\)[\s\S]{0,120}if \(old && old\.state && Date\.now\(\) - Date\.parse\(old\.at \|\| 0\) < SAFETY_MS\) return null;/.test(mg));
  });
  test('Düzeltilmiş dosya: 54 işlem, 20 varlık; emirli satışlar alış günüyle çakışmaz; DRVN 2023; açık pozisyonlar aynı', function () {
    if (!fs.existsSync(FILE)) return; // dosya kutuda; depo dışı ortamda atlanır
    var f = JSON.parse(fs.readFileSync(FILE, 'utf8')); eq(f.trades.length, 54); eq(f.assets.length, 20);
    var days = {}; f.trades.forEach(function (t) { var k = t.symbol + ' ' + t.date; (days[k] = days[k] || {})[t.side] = (days[k][t.side] || []).concat(t.orderType); });
    var same = Object.keys(days).filter(function (k) { return days[k].buy && days[k].sell; });
    eq(same, ['ENJSA 2026-09-28'], 'yalnız iki piyasa emri'); ok(days['ENJSA 2026-09-28'].sell.every(function (o) { return o === 'Piyasa'; }));
    eq(f.trades.filter(function (t) { return t.symbol === 'DRVN'; }).map(function (t) { return t.date; }).sort(), ['2023-02-08', '2023-03-31']);
    var s = S.emptyState('2026-11'); s.isExample = false;
    IB.apply(s, { format: IB.FORMAT, version: 1, id: 'test-v874-1', ops: [{ op: 'holdings-wipe' }, { op: 'broker-replace', file: f }] }, S.uid);
    var v = S.validateState(s), open = {};
    v.assets.forEach(function (a) { var l = PF.position(v, a, '2026-11-25').ledger; ok(!l.errors || !l.errors.length, a.symbol + ' hata'); if (l.units > 0) open[a.symbol] = l.units / 1e8; });
    eq(open, { KPC: 122, KTV: 7169, SPUS: 13.53417903 });
  });
  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.7.4 testi geçti'); if (passed !== results.length) process.exit(1);
  });
})();
