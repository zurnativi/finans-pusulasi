/* v8.7.5 testleri: Alım-satım sayfasında tek "Alım-satımlar" bölümü (Tüm işlemler | Açık pozisyonlar | Kapananlar); Varlıklar'daki kapanan pozisyon
 * kopyası ve Genel bakıştaki Defter kopyası kaldırıldı (bağlantı kaldı). Veri modeli, sıfırlama (migrate.js) ve uzaktan düzenleme değişmedi. */
(function () {
  var fs = require('fs'), path = require('path');
  var S = require('../js/sample.js'), IB = require('../js/inbox.js'), MG = require('../js/migrate.js'), PF = require('../js/portfolio.js'), M = require('../js/money.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  var FILE = '/workspace/finans-import/midas-2026-11-25/finans-midas-portfoy-2026-11-25.json';
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function rd(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
  test('Tek bölüm: "Alım-satımlar" üç sekmeli (Tüm işlemler / Açık pozisyonlar / Kapananlar); eski ayrı başlıklar yok', function () {
    var pui = rd('js/portfolio-ui.js');
    ok(/function tradesSection\(c, openH, allH\)/.test(pui) && /id="alim-satimlar"/.test(pui));
    ok(/\['all', 'Tüm işlemler', nT, 'Tümü'\], \['open', 'Açık pozisyonlar', c\.openRows\.length, 'Açık'\], \['closed', 'Kapananlar', cl\.length, 'Kapanan'\]/.test(pui));
    ok(/data-tpanel="all"/.test(pui) && /data-tpanel="open"/.test(pui) && /data-tpanel="closed" id="closed-positions"/.test(pui));
    ok(pui.indexOf('<h2>Tüm alım-satımlar') < 0, 'eski "Tüm alım-satımlar" kartı kalmış'); ok(pui.indexOf('<h2>Pozisyonlar ve kâr/zarar') < 0, 'eski "Pozisyonlar ve kâr/zarar" kartı kalmış');
    ok(pui.indexOf('closedHtml(') < 0, 'kapanan pozisyonlar iki yerde çiziliyor');
    eq((pui.match(/closedPanel\(c\)/g) || []).length, 2, 'closedPanel yalnız tanım + Alım-satımlar bölümü');
  });
  test('Tüm işlemler sekmesinde düzenle/sil düğmeleri ve 300 satır sınırı korunur; sekme değişimi sayfayı yeniden çizmez', function () {
    var pui = rd('js/portfolio-ui.js');
    ok(/data-act="pf-edit-trade"/.test(pui) && /data-act="pf-del-trade"/.test(pui) && /Son 300 işlem gösteriliyor/.test(pui));
    ok(/'pf-tview': function \(\) \{ setTradeView\(t\.dataset\.v\); \}/.test(pui)); ok(/p\.hidden = p\.dataset\.tpanel !== tradeView/.test(pui));
    ok(/'pf-tview-go': function \(\) \{ tradeView = t\.dataset\.v \|\| 'all'; tradeScroll = true; \}/.test(pui));
  });
  test('Varlıklar: kapanan tablo yok, "Alım-satım → Kapananlar" bağlantısı ve işlemsiz varlıklar (Alış ekle / Sil) var; Genel bakışta Defter tablosu tekrar edilmez', function () {
    var pui = rd('js/portfolio-ui.js');
    ok(/h \+= idleHtml\(c\) \+ closedLink\(c\);/.test(pui)); ok(/data-act="pf-tview-go" data-v="closed">Alım-satım → Kapananlar/.test(pui));
    var ov = pui.slice(pui.indexOf('function pOverview(c)'), pui.indexOf('function overviewLinks(c)'));
    ok(ov.indexOf('bookHtml(') < 0 && /overviewLinks\(c\)/.test(ov), 'Genel bakışta Defter tablosu kalmış');
    var as = pui.slice(pui.indexOf('function pAssets(c)'), pui.indexOf('/* ---------- ALIM-SATIM'));
    ok(/bookHtml\(c, true\)/.test(as), 'Varlıklar Defter tablosu (tek kopya) yok');
  });
  test('Kapananlar toplamı (Midas dosyası): kapananlar −3.459,24 + KTV kısmi satış +34,31 = tüm gerçekleşen −3.424,93 TL; açık pozisyonlar KTV/KPC/SPUS', function () {
    if (!fs.existsSync(FILE)) return; // dosya kutuda; depo dışı ortamda atlanır
    var f = JSON.parse(fs.readFileSync(FILE, 'utf8')), s = S.emptyState('2026-11'); s.isExample = false;
    IB.apply(s, { format: IB.FORMAT, version: 1, id: 'test-v875-1', ops: [{ op: 'holdings-wipe' }, { op: 'broker-replace', file: f }] }, S.uid);
    var v = S.validateState(s), cl = PF.closedPositions(v, '2026-11-25');
    var sm = PF.summary(v, '2026-11-25');
    eq(M.sum(cl.map(function (x) { return x.realizedTL; })), -345924, 'kapananlar'); eq(sm.openRealizedTL, 3431, 'KTV kısmi satış'); eq(sm.realizedTL, -342493, 'tüm gerçekleşen');
    var pui = rd('js/portfolio-ui.js'); ok(/Tüm gerçekleşen kâr\/zarar/.test(pui) && /Elindeki varlıkların kısmi satışlarından/.test(pui));
    eq(v.trades.length, 54); eq(v.assets.filter(function (a) { return !PF.isClosed(v, a) && !PF.isIdle(v, a); }).map(function (a) { return a.symbol; }).sort(), ['KPC', 'KTV', 'SPUS']);
  });
  test('Dokunulmayanlar: sıfırlama numarası/dosyası aynı; sürüm 8.7.5 (sayfa, kabuk, uygulama); stil sürümlü', function () {
    var it = MG.ITEMS[0]; eq(MG.ITEMS.length, 1); eq(it.id, 'sifirdan-midas-v2-2026-11-25'); eq(it.path, 'bg/tek-seferlik-2.enc.json');
    var idx = rd('index.html'), sw = rd('sw.js');
    eq(IB.APP_VERSION, '8.7.5'); ok(/VERSION = '8\.7\.5'/.test(sw)); ok(idx.indexOf('css/style.css?v=8.7.5') > 0 && idx.indexOf('js/portfolio-ui.js?v=8.7.5') > 0 && idx.indexOf('?v=8.7.4') < 0);
    ok(/\.trades-hub \.th-seg/.test(rd('css/style.css')));
  });
  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.7.5 testi geçti'); if (passed !== results.length) process.exit(1);
  });
})();
