/* v8.8.1 testleri: koyu temada tüm metin form alanları (type'sız input dahil) okunur;
 * açık tema bozulmaz. Veri modeli, sıfırlama (migrate.js) ve uzaktan düzenleme değişmedi. */
(function () {
  var fs = require('fs'), path = require('path');
  var IB = require('../js/inbox.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function rd(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

  test('CSS: type\'sız input ve metin türleri koyu/açık temaya uyum sağlar; onay kutusu kuralı bozmaz', function () {
    var css = rd('css/style.css');
    ok(/input:not\(\[type\]\)/.test(css), 'type\'sız input kuralı yok');
    ['text', 'search', 'password', 'number', 'email', 'url', 'tel', 'date', 'month', 'week', 'time', 'datetime-local'].forEach(function (t) {
      ok(css.indexOf('input[type=' + t + ']') >= 0, 'eksik tür: ' + t);
    });
    ok(/:where\(input,select,textarea\)/.test(css), ':where genel kuralı yok');
    ok(/color-scheme:light/.test(css) && /color-scheme:dark/.test(css), 'color-scheme yok');
    ok(/input::placeholder/.test(css) && /textarea::placeholder/.test(css), 'placeholder kuralı yok');
    ok(/select option/.test(css), 'option kuralı yok');
    ok(/input:disabled/.test(css) && /select:disabled/.test(css) && /textarea:disabled/.test(css), 'disabled kuralı yok');
    ok(/-webkit-autofill/.test(css) && /:autofill/.test(css), 'autofill kuralı yok');
    ok(/-webkit-text-fill-color:var\(--ink\)/.test(css), 'autofill metin rengi yok');
    ok(/box-shadow:0 0 0 1000px var\(--bg\) inset/.test(css), 'autofill koyu/açık arka plan örtüsü yok');
    ok(/:where\(input\[type=checkbox\]/.test(css), 'onay kutusu muafiyeti yok');
    /* Eski dar kural tek başına kalmamalı: type=text listesi type'sızı kaçırırdı. */
    ok(!/input\[type=text\],input\[type=date\],input\[type=month\],input\[type=number\],input\[type=password\],input\[type=search\],select,textarea\{background:var\(--bg\);border:1px solid var\(--line\)/.test(css));
  });

  test('Kaynak: şikayet edilen OHLCV "Varlık adı" ve portföy oluşturucu ad/tutar alanları hâlâ type\'sız; kural onlara uyuyor', function () {
    var a = rd('js/analysis-ui.js'), lab = rd('js/lab-ui.js'), rp = rd('js/reports-ui.js');
    ok(/<input id="a-imp-n" required maxlength="40" placeholder="ör\. AAPL">/.test(a), 'a-imp-n');
    ok(/<input id="lab-amt" inputmode="decimal"/.test(lab) && !/<input id="lab-amt"[^>]*type=/.test(lab), 'lab-amt type\'sız');
    ok(/<input id="lab-name" maxlength="60"/.test(lab) && !/<input id="lab-name"[^>]*type=/.test(lab), 'lab-name type\'sız');
    ok(/<input id="rp-st-p" inputmode="decimal"/.test(rp), 'rp-st-p');
    ok(rd('css/style.css').indexOf('input:not([type])') >= 0);
  });

  test('Dokunulmayanlar: migrate.js ve arka plan izleme/kutu yolları aynı; sürüm 8.8.2 her yerde', function () {
    var sw = rd('sw.js'), idx = rd('index.html');
    eq(IB.APP_VERSION, '8.8.2');
    ok(/VERSION = '8\.8\.2'/.test(sw));
    ok(idx.indexOf('?v=8.8.0') < 0 && idx.indexOf('css/style.css?v=8.8.2') > 0 && idx.indexOf('js/app.js?v=8.8.2') > 0);
    var mg = rd('js/migrate.js');
    ok(/sifirdan-midas-v2-2026-11-25/.test(mg) && /tek-seferlik-2\.enc\.json/.test(mg));
    var bg = rd('js/bgwatch.js'), inbox = rd('js/inbox.js');
    ok(/inbox\.v2\.enc\.json/.test(inbox) && /inbox-ack\.enc\.json/.test(inbox));
    ok(/GIST_FILE = 'finans-inbox\.box\.enc\.json'/.test(inbox));
    ok(/bgwatch/.test(idx) && /inbox/.test(sw));
    var blob = idx + sw + mg + bg + inbox + rd('css/style.css');
    ok(!/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|FPBG1\.[A-Za-z0-9_-]{40,}/.test(blob), 'kaynakta sır değeri yok');
    ok(bg.indexOf("SETUP_PREFIX = 'FPBG1.'") >= 0, 'kurulum öneki duruyor');
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) module.exports.run().then(function (r) { var p = r.filter(function (x) { return x.ok; }).length; r.forEach(function (x) { console.log((x.ok ? '✓ ' : '✗ ') + x.name + (x.ok ? '' : '  → ' + x.err)); }); console.log('\n' + p + '/' + r.length + ' v8.8.1 testi geçti'); if (p !== r.length) process.exit(1); });
})();
