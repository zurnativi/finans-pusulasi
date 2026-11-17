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
