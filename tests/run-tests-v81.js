/* v8.1 testleri: güncellik (zamanlama ↔ workflow cron eşitliği), sunucu anlık görüntüsü (belirleyicilik, gizlilik, dosya adı), uyarı üretimi,
 * senaryo özeti, Python/JS satır eşitliği. Çalıştırma: node tests/run-tests-v81.js (run-tests.js de çalıştırır). Ağ erişimi gerekmez. */
(function () {
  var fs = require('fs'), path = require('path'), cp = require('child_process');
  var F = require('../js/freshness.js'), SN = require('../js/snapshot.js'), AN = require('../js/analysis.js'), MD = require('../js/mdata.js');
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  var MIN = 60000, H = 3600000, D = 86400000, ROOT = path.join(__dirname, '..');

  /* ---------- 1. Güncellik ---------- */
  function expand(field, lo, hi) { // 5 alanlı cron'un tek alanını aç: *, a,b, a-b
    var out = {}; String(field).split(',').forEach(function (p) { if (p === '*') { for (var i = lo; i <= hi; i++) out[i] = 1; } else if (/^\d+-\d+$/.test(p)) { var a = p.split('-').map(Number); for (var j = a[0]; j <= a[1]; j++) out[j] = 1; } else out[+p] = 1; });
    return out;
  }
  function cronSlots(file, weekStart) { // bir haftadaki tüm tetik zamanları (UTC ms)
    var y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8'), crons = [], re = /^\s*-\s*cron:\s*'([^']+)'/gm, m;
    while ((m = re.exec(y))) crons.push(m[1].trim().split(/\s+/));
    var out = [];
    for (var d = 0; d < 7; d++) { var day = weekStart + d * D, dow = new Date(day).getUTCDay();
      crons.forEach(function (c) { var mi = expand(c[0], 0, 59), hr = expand(c[1], 0, 23), dw = expand(c[4].replace(/^7$/, '0'), 0, 6); if (!dw[dow]) return; for (var h = 0; h < 24; h++) if (hr[h]) for (var mm = 0; mm < 60; mm++) if (mi[mm]) out.push(day + h * H + mm * MIN); }); }
    return out.sort(function (a, b) { return a - b; });
  }
  var WEEK0 = Date.parse('2026-11-16T00:00:00Z'); // pazartesi
  function schedSlots(job) { var o = []; for (var d = 0; d < 7; d++) { var day = WEEK0 + d * D; o = o.concat(F.SCHEDULE[job].slots(day, new Date(day).getUTCDay())); } return o.sort(function (a, b) { return a - b; }); }
  [['news', 'market-news.yml'], ['crypto', 'market-crypto.yml'], ['intraday', 'market-intraday.yml'], ['daily', 'market-data.yml']].forEach(function (p) {
    test('Güncellik: ' + p[0] + ' zamanlaması ' + p[1] + ' cron satırlarıyla birebir aynı (bir haftalık tüm tetikler)', function () {
      var a = cronSlots(p[1], WEEK0), b = schedSlots(p[0]); ok(a.length > 0, 'cron okunamadı'); eq(b.map(function (x) { return new Date(x).toISOString(); }), a.map(function (x) { return new Date(x).toISOString(); }));
    });
  });
  test('Güncellik: son beklenen çalışma doğru (haber 06:47Z → 06:47; gün başı geri sarma; hafta sonu daily Cuma 15:40Z)', function () {
    eq(new Date(F.lastExpected('news', Date.parse('2026-11-18T06:50:00Z'))).toISOString(), '2026-11-18T06:47:00.000Z');
    eq(new Date(F.lastExpected('news', Date.parse('2026-11-18T00:05:00Z'))).toISOString(), '2026-11-17T23:47:00.000Z');
    eq(new Date(F.lastExpected('daily', Date.parse('2026-11-22T12:00:00Z'))).toISOString(), '2026-11-20T15:40:00.000Z');
  });
  test('Güncellik: ok / geç / durmuş / yok durumları; başarısız çalışma "ok" sayılmaz; günlük derleme saatlik veriyi tazeler', function () {
    var now = Date.parse('2026-11-18T07:00:00Z'), iso = function (ms) { return new Date(ms).toISOString(); };
    var allOk = { news: { generatedAt: iso(now - 10 * MIN), ok: true }, crypto: { generatedAt: iso(now - 40 * MIN), ok: true }, intraday: { generatedAt: iso(now - 50 * MIN), ok: true }, daily: { generatedAt: iso(now - 5 * H), ok: true } };
    var e = F.evaluate(allOk, now); eq(e.worst, 'ok'); eq(e.jobs.length, 4);
    var soft = JSON.parse(JSON.stringify(allOk)); soft.news.generatedAt = iso(now - 30 * MIN); eq(F.evaluate(soft, now).worst, 'ok', 'tek kaçan tetik (30 dk) alarm vermemeli');
    var late = JSON.parse(JSON.stringify(allOk)); late.news.generatedAt = iso(now - 90 * MIN); var e2 = F.evaluate(late, now); eq(e2.worst, 'late', '90 dk önceki haber verisi gecikmeli'); ok(e2.lateCount === 1);
    var stale = JSON.parse(JSON.stringify(allOk)); stale.news.generatedAt = iso(now - 20 * H); var e3 = F.evaluate(stale, now); eq(e3.worst, 'stale'); ok(e3.banner && /Haber/.test(e3.banner.text), 'uyarı şeridi metni');
    var wk = F.evaluate({ news: allOk.news, crypto: allOk.crypto, intraday: { generatedAt: '2026-11-20T15:50:00Z', ok: true }, daily: { generatedAt: '2026-11-20T15:50:00Z', ok: true } }, Date.parse('2026-11-22T14:00:00Z')); eq(wk.jobs.filter(function (j) { return j.id === 'daily'; })[0].state, 'ok', 'hafta sonu günlük derleme beklenmez');
    var failed = JSON.parse(JSON.stringify(allOk)); failed.news = { generatedAt: iso(now - 5 * MIN), ok: false }; ok(F.evaluate(failed, now).jobs.filter(function (j) { return j.id === 'news'; })[0].state !== 'ok');
    var none = F.evaluate({}, now); ok(none.jobs.every(function (j) { return j.state === 'missing'; }), 'bilgi yokken uydurma "ok" yok');
  });
  test('Güncellik: ageText ve kaynak değerlendirmesi', function () {
    eq(F.ageText(20 * 1000), 'şimdi'); eq(F.ageText(12 * MIN), '12 dk önce'); eq(F.ageText(5 * H), '5 sa önce'); eq(F.ageText(3 * D), '3 gün önce'); eq(F.ageText(null), '—');
  });

  /* ---------- 2. Sunucu anlık görüntüsü ---------- */
  var REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ta-reference.json'), 'utf8')).series.ASELS.input;
  function fixtureSeries() {
    var bars = REF.d.map(function (d, i) { return [d, REF.o[i], REF.h[i], REF.l[i], REF.c[i], REF.v[i]]; }).map(function (r) { return { d: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }; });
    return { key: 'bist:ASELS', kind: 'stock', name: 'ASELS — Aselsan', currency: 'TRY', bars: bars, checks: MD.checkBars(bars, 'stock', { today: bars[bars.length - 1].d }), katilim: ['XKTUM'], sym: 'ASELS' };
  }
  function snapOf(at) { var s = fixtureSeries(), A = AN.analyze(s, { halal: SN.halalBase('bist:ASELS', s) }); A.series = s; A.ctx = {}; return SN.compact(A, { at: at }); }
  test('Anlık görüntü: aynı girdi → aynı çıktı (yalnız "at" değişir); gerekli alanlar var; skor 0–100', function () {
    var a = snapOf('2026-11-18T07:00:00Z'), b = snapOf('2026-11-18T07:00:00Z'); eq(a, b);
    var c = snapOf('2026-11-18T08:00:00Z'), x = JSON.parse(JSON.stringify(c)); x.at = a.at; eq(x, a, 'at dışında fark olmamalı');
    ['key', 'name', 'kind', 'total', 'confidence', 'stance', 'price', 'currency', 'lastDate', 'at', 'plans', 'halal'].forEach(function (k) { ok(a[k] !== undefined, 'alan ' + k); });
    ok(a.total >= 0 && a.total <= 100); eq(a.key, 'bist:ASELS'); eq(a.v, SN.VERSION);
  });
  test('Anlık görüntü: portföy/adet/tutar/maliyet alanı YOK (herkese açık depo); boyut makul', function () {
    var j = JSON.stringify(snapOf('2026-11-18T07:00:00Z'));
    ['holdings', 'qty', 'quantity', 'lots', 'cost', 'maliyet', 'adet', 'portfolio', 'ledger'].forEach(function (w) { ok(!new RegExp('"' + w + '"', 'i').test(j), 'yasak alan: ' + w); });
    ok(j.length < 60000, 'boyut ' + j.length);
  });
  test('Anlık görüntü: Snap.row ↔ tools/publish.py snap_row birebir aynı (indeks satırı)', function () {
    var s = snapOf('2026-11-18T07:00:00Z'), js = SN.row(s);
    var out = cp.execFileSync('python3', ['-c', 'import sys,json;sys.path.insert(0,"tools");import publish;print(json.dumps(publish.snap_row(json.load(sys.stdin)),sort_keys=True))'], { cwd: ROOT, input: JSON.stringify(s) }).toString();
    var py = JSON.parse(out), a = {}; Object.keys(js).sort().forEach(function (k) { a[k] = js[k] === undefined ? null : js[k]; }); eq(py, JSON.parse(JSON.stringify(a)));
  });
  test('Anlık görüntü: fileOf güvenli ve evrendeki tüm anahtarlar için tekil', function () {
    var pc = require('../tools/precompute.js'), keys = ['bist:ASELS', 'bist:EREGL', 'idx:XU100', 'metal:XAU', 'fx:USD', 'us:SPUS', 'tefas:KTV', 'cg:bitcoin', 'cg:binancecoin'];
    var seen = {}; keys.forEach(function (k) { var f = SN.fileOf(k); ok(/^[a-z0-9._-]+$/i.test(f), 'güvenli ad: ' + f); ok(!seen[f], 'çakışma ' + f); seen[f] = 1; });
    ok(typeof pc.universe === 'function');
  });
  test('Anlık görüntü: çevrimdışı/engelli veri için halalBase ve context yan etkisiz (ağ yok → boş bağlam hatası fırlatmaz)', function () {
    var s = fixtureSeries(), ctx = { halal: SN.halalBase('bist:ASELS', s) }; ok(ctx.halal && ctx.halal.status, 'helal durumu');
    var A = AN.analyze(s, ctx); ok(A.total != null);
  });

  /* ---------- 3. Uyarı üretimi ---------- */
  test('Uyarı: ölçüt varlıkta skor ≥15 puan düşünce VEYA görünüm zayıfa dönünce "yüksek" uyarı; sıradan hissede ya da veri engelliyse YOK; kimlik tekil', function () {
    var pc = require('../tools/precompute.js');
    function mk(key, total, code, blocked) { return { key: key, name: key + ' — x', total: total, blocked: !!blocked, stance: { code: code, label: code }, plans: null }; }
    var prev = { 'idx:XU100': mk('idx:XU100', 70, 'good'), 'bist:ASELS': mk('bist:ASELS', 80, 'good') };
    var out = pc.changeAlerts([mk('idx:XU100', 52, 'weak'), mk('bist:ASELS', 30, 'weak')], prev);
    ok(out.length >= 1 && out.every(function (a) { return a.sev === 'high' && a.cat === 'analysis'; }), JSON.stringify(out));
    ok(!out.some(function (a) { return /ASELS/.test(a.id); }), 'sıradan hisse için piyasa geneli uyarı yok');
    eq(new Set(out.map(function (a) { return a.id; })).size, out.length, 'kimlikler tekil');
    eq(pc.changeAlerts([mk('idx:XU100', 40, 'weak', true)], prev), [], 'engelli analiz uyarı üretmez');
    eq(pc.changeAlerts([mk('idx:XU100', 66, 'good')], prev), [], 'küçük değişim uyarı üretmez');
  });
  test('Uyarı: izleme listesine özel uyarı yalnız WATCH_SYMBOLS + helal + engelsiz iken; stop altı ve ilk hedef; "sat" demez', function () {
    var pc = require('../tools/precompute.js'), old = process.env.WATCH_SYMBOLS; process.env.WATCH_SYMBOLS = 'ASELS';
    try {
      function mk(sym, price, halalOk, blocked) { return { key: 'bist:' + sym, name: sym, total: 50, blocked: blocked, halalOk: halalOk, price: price, lastDate: '2026-11-18', plans: { conservative: { stop: 100, targets: [{ p: 150 }, { p: 200, minor: true }] } } }; }
      var a = pc.watchAlerts([mk('ASELS', 95, true, false), mk('EREGL', 95, true, false)]); eq(a.length, 1); ok(/stop/.test(a[0].title) && /ASELS/.test(a[0].title));
      var b = pc.watchAlerts([mk('ASELS', 155, true, false)]); eq(b.length, 1); ok(/hedef/.test(b[0].title)); ok(!/\bsat\b(?!"|ma)/i.test(b[0].body.replace(/"Sat"[^.]*\./i, '')), 'tavsiye dili yok: ' + b[0].body);
      eq(pc.watchAlerts([mk('ASELS', 95, false, false)]), [], 'helal değilse yok'); eq(pc.watchAlerts([mk('ASELS', 95, true, true)]), [], 'engelliyse yok'); eq(pc.watchAlerts([mk('ASELS', 120, true, false)]), [], 'seviye aşılmadıysa yok');
    } finally { if (old === undefined) delete process.env.WATCH_SYMBOLS; else process.env.WATCH_SYMBOLS = old; }
  });

  /* ---------- 4. Senaryo özeti ---------- */
  test('Senaryo: olay beklentisi/olasılık yalnız gerçek kaynaktan; olasılık yoksa null (uydurma yok); varlık etkileri portföysüz', function () {
    var sc = require('../tools/scenarios.js'), now = Date.parse('2026-11-18T06:00:00Z');
    var cal = { items: [{ id: 'fomc-2026-12-09', type: 'fomc', title: 'FOMC faiz kararı', date: '2026-12-09', time: '19:00', impact: 'high', kind: 'decision' }, { id: 'x1', type: 'data', title: 'Sıradan veri', date: '2026-11-20', impact: 'low' }] };
    var o = sc.build(cal, {}, now); ok(o && Array.isArray(o.events), 'events'); o.events.forEach(function (e) { (e.scenarios || []).forEach(function (s) { ok(s.prob === null, 'kaynaksız olasılık uydurulmamalı: ' + s.id + ' ' + s.prob); }); });
    ok(!JSON.stringify(o).match(/"(holdings|qty|portfolio)"/i), 'portföy alanı yok');
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.1 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
