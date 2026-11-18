/* v8 testleri: haber puanlama/tekilleştirme/eşleştirme, olay beklentisi ve olasılıkları, bildirim motoru (birleştirme, yükselme, çözülme, sessiz saat),
 * duygu durumu kartı, Python/JS kural eşitliği. Çalıştırma: node tests/run-tests-v8.js (run-tests.js de çalıştırır). Ağ erişimi gerekmez. */
(function () {
  var N = require('../js/news.js'), EV = require('../js/events.js'), NT = require('../js/notify.js'), MO = require('../js/mood.js');
  var cp = require('child_process'), path = require('path'), fs = require('fs');
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  var NOW = Date.parse('2026-11-17T09:00:00Z'), H = 3600000, D = 86400000;
  function iso(ms) { return new Date(ms).toISOString().replace('.000', ''); }
  function hold(key, name, cls, value, extra) { return Object.assign({ key: key, name: name, sym: null, cls: cls, value: value, halal: 'uygun' }, extra || {}); }

  /* ---------- 1. Haber puanlama ---------- */
  test('Haber: kriz/karar anahtar kelimesi sert katman sayılır, sıradan haber düşük kalır', function () {
    var a = N.scoreTitle('Central bank emergency rate hike shocks markets'), b = N.scoreTitle('Yeni telefon modeli tanıtıldı');
    ok(a.hard && a.score >= 55, 'sert katman: ' + JSON.stringify(a)); ok(b.score === 0 && !b.hard, 'sıradan haber 0 puan');
  });
  test('Haber: "kritik" yalnız sert katman VE (resmî kurum veya ≥2 ayrı kaynak) ile; tek kaynak en fazla yüksek, yumuşak anahtar kelimeler en fazla orta', function () {
    var t = 'Emergency rate hike: central bank shocks markets with crisis decision';
    var one = N.importance({ t: t, s: 'X', a: iso(NOW - H), srcs: [{ s: 'X' }] }, NOW); ok(one.level !== 'critical', 'tek kaynak kritik olamaz: ' + one.level);
    var two = N.importance({ t: t, s: 'X', a: iso(NOW - H), srcs: [{ s: 'X' }, { s: 'Y' }] }, NOW); ok(two.level === 'critical', 'iki kaynak + sert katman kritik: ' + two.level);
    var off = N.importance({ t: t, s: 'Fed', o: 'Fed', a: iso(NOW - H), srcs: [{ s: 'Fed' }] }, NOW); ok(off.level === 'critical', 'resmî kurum kritik');
    var soft = N.importance({ t: 'Shoe Prices Hit a Record High Amid Inflation and Increased Tariffs', s: 'NYT', a: iso(NOW - H), srcs: [{ s: 'NYT' }] }, NOW);
    ok(!soft.hard && soft.level === 'medium', 'yumuşak anahtar kelimelerin toplamı tek kaynakta en fazla orta: ' + soft.level + ' ' + soft.score);
  });
  test('Haber: aynı olayı veren başlıklar tek öğede birleşir ve kaynaklar toplanır; farklı haberler birleşmez', function () {
    var items = [{ t: 'Fed faizi sabit tuttu, Powell enflasyon uyarısı yaptı', s: 'A', u: 'https://a/1', a: iso(NOW - 3 * H) }, { t: 'Fed faizi sabit tuttu: Powell enflasyon uyarısı yaptı', s: 'B', u: 'https://b/1', a: iso(NOW - 2 * H) },
      { t: 'Bitcoin 70 bin doları aştı', s: 'C', u: 'https://c/1', a: iso(NOW - H) }, { t: 'Fed faizi sabit tuttu, Powell enflasyon uyarısı yaptı', s: 'A', u: 'https://a/1', a: iso(NOW - 3 * H) }];
    var out = N.dedupe(items); eq(out.length, 2); var fed = out.filter(function (x) { return /Fed/.test(x.t); })[0]; eq(fed.srcs.map(function (s) { return s.s; }).sort(), ['A', 'B']);
  });
  test('Haber: portföy eşleştirme — doğrudan (başlıkta adı/sembolü) ve dolaylı (konu → varlık grubu); eşleşmeyen yok', function () {
    var h = [hold('bist:ASELS', 'Aselsan', 'katilim_stock', 500000, { sym: 'ASELS' }), hold('metal:XAU', 'Fiziki gram altın', 'gold', 300000), hold('cg:bitcoin', 'Bitcoin', 'crypto', 100000, { sym: 'BTC' })];
    var m = N.matchHoldings({ t: 'ASELS yeni sözleşme imzaladı' }, h); ok(m.some(function (x) { return x.h.key === 'bist:ASELS' && x.kind === 'direct'; }), 'doğrudan');
    var g = N.matchHoldings({ t: 'Gold surges as Fed signals rate cut' }, h); ok(g.some(function (x) { return x.h.key === 'metal:XAU'; }), 'altın dolaylı: ' + JSON.stringify(g.map(function (x) { return x.h.key + x.kind; })));
    eq(N.matchHoldings({ t: 'Yeni telefon modeli tanıtıldı' }, h), []);
    var ex = N.exposure(m, 900000); ok(ex.direct && ex.bp === Math.round(500000 * 10000 / 900000), 'pay hesabı');
  });
  test('Haber: KAP — yalnız elindeki hisse için; önem bildirim türünden gelir ve resmî kaynak olarak işaretlenir', function () {
    var h = [hold('bist:ASELS', 'Aselsan', 'katilim_stock', 500000, { sym: 'ASELS' })];
    var out = N.process([{ t: 'ASELS — Önemli Gelişme', u: 'https://kap/1', s: 'KAP', a: iso(NOW - H), kap: { tag: 'ozel_durum', tone: 'info', key: 'bist:ASELS', sym: 'ASELS' } }], h, NOW);
    ok(out[0].mine && out[0].matches[0].kind === 'direct', 'KAP eşleşti'); ok(out[0].imp.notes[0].indexOf('resmî') > 0, 'resmî etiket');
  });

  /* ---------- 2. Olaylar ve olasılıklar ---------- */
  var FED = { id: 'fomc:2026-12-09', type: 'fomc', title: 'FOMC', date: '2026-12-09', impact: 'high', time: null };
  var PROBS = { items: [{ id: 'fed:2026-12-09', region: 'fed', decisionDate: '2026-12-09', url: 'https://k', outcomes: [{ label: 'Kesinti 25 bp', p: 0.02 }, { label: 'Faiz sabit', p: 0.10 }, { label: 'Artırım 25 bp', p: 0.80 }, { label: 'Artırım >25 bp', p: 0.04 }] }] };
  test('Olay: Fed olasılığı Kalshi sonuçlarından toplanır ve %100\'e normalize edilir; kaynak etiketi taşır', function () {
    var pr = EV.probsFor(FED, { probs: PROBS }); ok(pr && pr.source.indexOf('Kalshi') === 0, 'kaynak');
    var s = pr.by.cut + pr.by.hold + pr.by.hike; ok(Math.abs(s - 1) < 1e-9, 'toplam 1: ' + s); ok(Math.abs(pr.by.hike - 0.84 / 0.96) < 1e-9, 'artırım toplamı 25 + >25');
  });
  test('Olay: kaynak olmayan olay için olasılık uydurulmaz (TCMB kararı → null; veri yoksa → null)', function () {
    eq(EV.probsFor({ id: 'cbrt_ppk:2026-12-10', type: 'cbrt_ppk', date: '2026-12-10' }, { probs: PROBS }), null);
    eq(EV.probsFor(FED, { probs: { items: [] } }), null); eq(EV.probsFor(FED, {}), null);
  });
  test('Olay: beklenti metni piyasa verisinden gelir, yönü toplam olasılıkla verir', function () {
    var e = EV.expectation(FED, { probs: PROBS }); ok(e && /Artırım %88/.test(e.text) || /Artırım %8[0-9]/.test(e.text), e && e.text); eq(e.code, 'hike'); ok(e.src.name === 'Kalshi');
    eq(EV.expectation({ id: 'x', type: 'fomc', date: '2027-02-02' }, { probs: PROBS }), null);
  });
  test('Olay: ABD TÜFE merdiveninden eşik olasılıkları tutarlı (aşağı + beklentiye yakın + yukarı = 1)', function () {
    var ladder = { id: 'cpi', kind: 'ladder', url: 'https://k', impliedMedian: 3.2, ladder: [{ above: 3.0, p: 0.9 }, { above: 3.1, p: 0.7 }, { above: 3.2, p: 0.5 }, { above: 3.3, p: 0.25 }, { above: 3.4, p: 0.1 }] };
    var pr = EV.probsFor({ type: 'us_cpi', date: '2026-12-10' }, { probs: { items: [ladder] } }); ok(pr, 'üretildi'); var s = pr.by.below + pr.by.inline + pr.by.above; ok(Math.abs(s - 1) < 1e-9, 'toplam ' + s);
    ok(pr.by.above === 0.5 && Math.abs(pr.by.below - 0.3) < 1e-9, JSON.stringify(pr.by));
  });
  test('Olay: yaklaşan olaylar TSİ günüyle hesaplanır (T-1, bugün, geçmiş)', function () {
    var cal = { events: [{ id: 'a', type: 'fomc', title: 'a', date: '2026-11-18', impact: 'high' }, { id: 'b', type: 'fomc', title: 'b', date: '2026-11-17', impact: 'high' }, { id: 'c', type: 'fomc', title: 'c', date: '2026-10-01', impact: 'high' }, { id: 'd', type: 'fomc', title: 'd', date: '2027-06-01', impact: 'high' }] };
    var u = EV.upcoming(cal, Date.parse('2026-11-17T21:30:00Z') /* TSİ 18 Kasım 00:30 */, 30); eq(u.map(function (e) { return e.id + ':' + e.phase; }), ['b:past', 'a:today']);
    var u2 = EV.upcoming(cal, Date.parse('2026-11-17T09:00:00Z'), 30); eq(u2.map(function (e) { return e.id + ':' + e.phase; }), ['b:today', 'a:tomorrow']);
  });
  test('Olay: beklenti sapması — aynı birim, %10 eşiği; işsizlikte yüksek = zayıf; birim uyuşmazsa hesaplanmaz', function () {
    var s = EV.surprise({ title: 'USD — Core Retail Sales m/m', forecast: '0.4%', actual: '0.9%' }); ok(s && s.code === 'above' && s.material, 'üstünde');
    ok(EV.surprise({ title: 'USD — CPI m/m', forecast: '0.3%', actual: '0.3%' }).code === 'inline', 'aynı');
    eq(EV.surprise({ title: 'x', forecast: '0.4%', actual: '12K' }), null); eq(EV.surprise({ title: 'x', forecast: null, actual: '1%' }), null);
    ok(/işsizlik/.test(EV.surprise({ title: 'USD — Unemployment Rate', forecast: '4.1%', actual: '4.4%' }).text), 'işsizlik notu');
  });
  test('Olay: faiz sürprizi 25 bp altında "beklentiyle aynı"', function () {
    eq(EV.rateSurprise(-1.0, -1.0).code, 'inline'); eq(EV.rateSurprise(-3.0, -1.5).code, 'hawkish'); eq(EV.rateSurprise(0, -0.5).code, 'dovish'); eq(EV.rateSurprise(null, 1), null);
  });
  test('Olay: tarihsel benzer — n ≤ 5 ise "küçük örnek" işaretlenir, olmayan sınıf için null', function () {
    var an = { groups: { turkey_shock: { n: 4, assets: { XU100: { d1: { n: 4, median: -0.03 }, d5: { n: 4 }, d20: { n: 4 } } } } }, events: [{ group: 'turkey_shock', date: '2025-03-19', title: 'x' }] };
    var r = EV.analogRows(an, 'turkey_shock', ['tr_equity']); ok(r.small && r.n === 4 && r.rows.length === 1, JSON.stringify(r)); eq(EV.analogRows(an, 'nope', ['tr_equity']), null);
  });
  test('Olay: senaryo → portföy etkisi varlık değerine göre ağırlıklanır; etkisi tanımsız grup "sınırlı" sayılır', function () {
    var sc = { effects: { tr_equity: { d: 'down', t: 'x' }, gold: { d: 'up', t: 'y' } } }, h = [hold('a', 'A', 'katilim_stock', 600), hold('b', 'B', 'gold', 300), hold('c', 'C', 'crypto', 100)];
    var im = EV.holdingImpact(sc, h); ok(Math.abs(im.pct.down - 0.6) < 1e-9 && Math.abs(im.pct.up - 0.3) < 1e-9 && Math.abs(im.pct.flat - 0.1) < 1e-9, JSON.stringify(im.pct));
  });

  /* ---------- 3. Bildirim motoru ---------- */
  function ctxBase(extra) { return Object.assign({ now: NOW, settings: NT.cleanSettings(null), hold: [], nw: [], isExample: false, nwIsSynthetic: false, risk: [], emergency: null, health: null, moves: [], fired: [], stale: [], news: [], events: [], hub: {}, server: [], meta: { halal: {}, health: null, expect: {} } }, extra || {}); }
  function nwSeries(vals) { return vals.map(function (v, i) { return { d: new Date(Date.parse('2026-11-01') + i * D).toISOString().slice(0, 10), v: v }; }); }
  test('Bildirim: net varlık düşüşü eşiklere göre kritik/yüksek/orta; örnek/sentetik veride üretilmez', function () {
    function sev(vals, extra) { var r = NT.evaluate(ctxBase(Object.assign({ nw: nwSeries(vals) }, extra))); var c = r.cands.filter(function (x) { return /^dd:/.test(x.id); })[0]; return c ? c.sev : null; }
    eq(sev([100, 101, 102, 103, 104, 99]), null); ok(sev([100, 100, 100, 100, 100, 94]) === 'medium', 'orta'); ok(sev([100, 100, 100, 100, 100, 88]) === 'high', 'yüksek'); ok(sev([100, 100, 100, 100, 100, 75]) === 'critical', 'kritik');
    eq(sev([100, 100, 100, 100, 100, 70], { isExample: true }), null); eq(sev([100, 100, 100, 100, 100, 70], { nwIsSynthetic: true }), null);
  });
  test('Bildirim: kişisel (portföy) uyarı kimliği ve metni varlık/tutar içerir ama ntfy gövdesi yalnız başlık+metin (sunucu uyarıları zaten özel veri içermez)', function () {
    var it = { sev: 'critical', title: 'T', body: 'B  x\n y' }; var p = NT.push(it); eq(Object.keys(p).sort(), ['message', 'priority', 'title']); ok(p.priority === 5 && p.message === 'B x y');
  });
  test('Bildirim: birleştirme — aynı kimlik tekrar eklenmez, daha ağır olunca yükselir ve okunmamış olur', function () {
    var log = NT.cleanLog(null), c = { id: 'x:1', cat: 'portfolio', sev: 'medium', title: 'T', body: 'b', at: NOW, why: [], sources: [], assets: [] };
    var f1 = NT.merge(log, [c], NOW); eq(f1.length, 1); NT.markRead(log, 'x:1', NOW);
    var f2 = NT.merge(log, [c], NOW + H); eq(f2.length, 0); eq(log.items.length, 1); ok(NT.isRead(log, log.items[0]), 'okunmuş kalır');
    var f3 = NT.merge(log, [Object.assign({}, c, { sev: 'high' })], NOW + 2 * H); eq(f3.map(function (x) { return x.why; }), ['escalated']); ok(!NT.isRead(log, log.items[0]), 'yükselince tekrar okunmamış');
  });
  test('Bildirim: durum türü uyarı koşul bitince çözülür, tekrarlayınca yeniden etkinleşir; çözülen etkin listede görünmez', function () {
    var log = NT.cleanLog(null), S = NT.cleanSettings(null), c = { id: 'risk:halal:danger', cat: 'portfolio', sev: 'high', state: true, title: 'T', body: 'b', at: NOW };
    NT.merge(log, [c], NOW); NT.merge(log, [], NOW + H); ok(log.items[0].resolvedAt, 'çözüldü'); eq(NT.visible(log, S, NOW + H).length, 0); eq(NT.visible(log, S, NOW + H, { history: true }).length, 1);
    var f = NT.merge(log, [c], NOW + 2 * H); eq(f.map(function (x) { return x.why; }), ['again']); ok(!log.items[0].resolvedAt && log.items[0].count === 2);
  });
  test('Bildirim: kapat → aynı önemde tekrar çıkmaz, daha ağır olursa çıkar; ertele → süre dolana dek gizli', function () {
    var log = NT.cleanLog(null), S = NT.cleanSettings(null), c = { id: 'n:1', cat: 'news', sev: 'high', title: 'T', body: 'b', at: NOW };
    NT.merge(log, [c], NOW); NT.dismiss(log, 'n:1'); eq(log.items.length, 0); eq(NT.merge(log, [c], NOW + H).length, 0); eq(NT.merge(log, [Object.assign({}, c, { sev: 'critical' })], NOW + 2 * H).length, 1);
    NT.snooze(log, 'n:1', NOW + 5 * H); eq(NT.visible(log, S, NOW + 3 * H).length, 0); eq(NT.visible(log, S, NOW + 6 * H).length, 1);
  });
  test('Bildirim: sessiz saatler TSİ ile hesaplanır (gece yarısını aşan aralık); kritik isteğe bağlı geçer; kategori eşiği uygulanır', function () {
    var S = NT.cleanSettings({ quiet: { on: true, from: '23:00', to: '08:00', critBypass: true } });
    ok(NT.inQuiet(S, Date.parse('2026-11-17T21:30:00Z')), 'TSİ 00:30 sessiz'); ok(!NT.inQuiet(S, Date.parse('2026-11-17T09:00:00Z')), 'TSİ 12:00 sessiz değil'); ok(!NT.inQuiet(S, Date.parse('2026-11-17T19:59:00Z')), 'TSİ 22:59 sessiz değil'); ok(NT.inQuiet(S, Date.parse('2026-11-17T20:00:00Z')), 'TSİ 23:00 sessiz');
    var log = NT.cleanLog(null), q = Date.parse('2026-11-17T21:30:00Z'), cs = [{ id: 'a', cat: 'news', sev: 'critical', title: 'a', body: '', at: q }, { id: 'b', cat: 'news', sev: 'high', title: 'b', body: '', at: q }, { id: 'c', cat: 'data', sev: 'high', title: 'c', body: '', at: q }];
    var fresh = NT.merge(log, cs, q); eq(NT.deliverable(log, fresh, S, q).map(function (x) { return x.id; }), ['a']);
    var S2 = NT.cleanSettings({ quiet: { on: false } }); eq(NT.deliverable(log, fresh, S2, q).map(function (x) { return x.id; }).sort(), ['a', 'b']); // veri kalitesi yalnız kritikte dışarı çıkar
  });
  test('Bildirim: haber → bildirim kuralları (kritik+portföy=kritik; yalnız konu eşleşen yüksek haber akışta kalır; KAP yalnız elindeki hisse)', function () {
    var h = [hold('metal:XAU', 'Fiziki gram altın', 'gold', 300000), hold('bist:ASELS', 'Aselsan', 'katilim_stock', 500000, { sym: 'ASELS' })];
    var t1 = 'Emergency rate hike: central bank shocks gold markets with crisis decision', t2 = 'Gold slides as dollar firms, inflation worries grow amid tariffs and war';
    var news = N.process([{ t: t1, s: 'X', u: 'https://x/1', a: iso(NOW - H) }, { t: t1, s: 'Y', u: 'https://y/1', a: iso(NOW - H) }, { t: t2, s: 'Z', u: 'https://z/1', a: iso(NOW - H) }], h, NOW);
    var r = NT.evaluate(ctxBase({ hold: h, news: news })), ns = r.cands.filter(function (c) { return c.cat === 'news'; });
    ok(ns.some(function (c) { return c.sev === 'critical'; }), 'kritik üretildi: ' + JSON.stringify(ns.map(function (c) { return c.sev + c.title.slice(0, 20); }))); ok(ns.every(function (c) { return c.sources.length >= 1 && c.why.length >= 1; }), 'kaynak ve neden var');
  });
  test('Bildirim: T-1 olay bildirimi beklentiyi anlık görüntüye kaydeder; sonuç gelince beklentiyle karşılaştırılır', function () {
    var cal = { events: [{ id: 'fomc:2026-11-18', type: 'fomc', title: 'FOMC', date: '2026-11-18', impact: 'high', source: { name: 'Fed' } }] };
    var probs = { items: [{ id: 'f', region: 'fed', decisionDate: '2026-11-18', url: 'https://k', outcomes: [{ label: 'Faiz sabit', p: 0.9 }, { label: 'Artırım 25 bp', p: 0.1 }] }] };
    var hub = { calendar: cal, probs: probs }, evs = EV.upcoming(cal, NOW, 14), r = NT.evaluate(ctxBase({ events: evs, hub: hub }));
    var c = r.cands.filter(function (x) { return x.id === 'event:fomc:2026-11-18:T1'; })[0]; ok(c && c.sev === 'high' && /Yarın/.test(c.title), 'T-1 üretildi'); eq(r.metaPatch.expect['fomc:2026-11-18'].code, 'hold');
    var NOW2 = NOW + 2 * D, hub2 = { calendar: cal, probs: probs, analogs: { events: [{ auto: true, group: 'fed_hike', date: '2026-11-18', title: 'Fed faiz kararı (+25 bp)' }] } };
    var r2 = NT.evaluate(ctxBase({ now: NOW2, hub: hub2, meta: { halal: {}, health: null, expect: { 'fomc:2026-11-18': { code: 'hold', deltaBp: 0, at: NOW } } } }));
    var res = r2.cands.filter(function (x) { return x.id === 'result:fomc:2026-11-18'; })[0]; ok(res && res.sev === 'high' && /değil/.test(res.body), 'beklenti sapması: ' + (res && res.body));
  });
  test('Bildirim: iş akışı (sunucu) uyarısı kişiselleştirilir ve kaynağı korunur; bilinmeyen önem düzeyi atılır', function () {
    var h = [hold('cg:bitcoin', 'Bitcoin', 'crypto', 100000, { sym: 'BTC' })];
    var r = NT.evaluate(ctxBase({ hold: h, server: [{ id: 'mkt:BTCUSD:2026-11-17', sev: 'high', cat: 'market', title: 'Bitcoin sert hareket: %-9,0', body: 'Kaynak: Yahoo', at: iso(NOW - H), url: null }, { id: 'zzz', sev: 'weird', cat: 'market', title: 'x', body: '', at: iso(NOW) }] }));
    var s = r.cands.filter(function (c) { return c.origin === 'workflow'; }); eq(s.length, 1); ok(/Bitcoin/.test(s[0].body) && /portföyün/.test(s[0].body), 'etkilenen varlık eklendi: ' + s[0].body);
  });
  test('Bildirim: ayar ve günlük temizleyicileri bozuk veride çökmez; ntfy konu adı doğrulanır', function () {
    var S = NT.cleanSettings({ cats: { news: { on: 'x', push: 'bogus' } }, quiet: { from: '99:99' }, ntfy: { topic: 'kısa', on: true }, thr: { ddMedium: -5 } });
    ok(S.cats.news.push === 'high' || S.cats.news.push === NT.DEFAULT_SETTINGS.cats.news.push, 'varsayılana döner'); ok(/^\d\d:\d\d$/.test(S.quiet.from), 'saat geçerli'); eq(S.ntfy.topic, ''); ok(S.thr.ddMedium > 0, 'eşik pozitif');
    ok(NT.TOPIC_RE.test('fp-9k2x7q4m1c8d') && !NT.TOPIC_RE.test('kısa') && !NT.TOPIC_RE.test('a b c d e f g h') && !NT.TOPIC_RE.test('ab'), 'konu regex');
    var L = NT.cleanLog({ items: [{ id: 1 }, null, { id: 'ok', cat: 'news', sev: 'high', title: 'T', body: 'b', lastAt: NOW }], read: 'x' }); eq(L.items.length, 1); eq(typeof L.read, 'object');
  });

  /* ---------- 4. Duygu durumu ---------- */
  function nwDays(vals, start) { return vals.map(function (v, i) { return { d: new Date(Date.parse(start || '2026-09-01') + i * D).toISOString().slice(0, 10), v: v }; }); }
  test('Duygu: zirveden ≥%10 düşüş "baskı altında", sakin seyir "sakin", sert yükseliş "coşkulu"; örnek veride hesaplanmaz', function () {
    var down = nwDays([100, 101, 102, 103, 104, 100, 96, 93, 91, 90]), calm = nwDays([100, 100.2, 100.1, 100.4, 100.3, 100.5, 100.4, 100.6]), up = nwDays([100].concat(Array.from({ length: 30 }, function (_, i) { return 100 + (i + 1) * 0.8; })));
    eq(MO.assess({ nw: down, checkins: [] }).state.id, 'stress'); eq(MO.assess({ nw: calm, checkins: [] }).state.id, 'calm'); eq(MO.assess({ nw: up, checkins: [] }).state.id, 'euphoria');
    var ex = MO.assess({ nw: down, isExample: true, checkins: [] }); eq(ex.state.id, 'nodata'); ok(ex.notice, 'örnek veri notu');
    eq(MO.assess({ nw: nwDays([100, 99]), checkins: [] }).state.id, 'nodata');
  });
  test('Duygu: öneriler duyguya göre; "sat/al" talimatı vermez; kontrol listesi ve kaynaklar var; her kaynak DOI/URL taşır', function () {
    var a = MO.assess({ nw: nwDays([100, 101, 102, 103, 104, 100, 96, 93, 91, 90]), checkins: [{ d: '2026-09-10', m: 'fear', t: 1 }], risk: [], emergency: { current: 1, target: 10 } });
    ok(a.tips.length >= 3 && a.checklist.length >= 5 && a.refs.length >= 4, 'içerik'); ok(a.refs.every(function (r) { return /^https?:\/\//.test(r.url) && r.cite && r.claim; }), 'kaynaklar');
    var txt = a.tips.join(' ').toLowerCase() + a.emotions.map(function (e) { return e.why; }).join(' ').toLowerCase(); ok(!/\b(hemen sat|sat\b(?!ış)|satın al\b)/.test(txt.replace(/satış|satma|satmak|sattı/g, '')), 'talimat yok: ' + txt.slice(0, 200));
  });
  test('Duygu: check-in günde bir kayıt (üzerine yazar), geçersiz duygu yok sayılır, en çok 200 kayıt', function () {
    var l = MO.addCheckin([], 'fear', '2026-11-17', null, 0.12, 1); l = MO.addCheckin(l, 'calm', '2026-11-17', null, 0.12, 2); eq(l.length, 1); eq(l[0].m, 'calm');
    eq(MO.addCheckin(l, 'bogus', '2026-11-18').length, 1); var big = []; for (var i = 0; i < 250; i++) big = MO.addCheckin(big, 'calm', new Date(Date.parse('2026-01-01') + i * D).toISOString().slice(0, 10)); eq(big.length, 200);
  });
  test('Duygu: toparlanma gerçekleri veriden gelir (kaynak ve saat taşır); veri yoksa boş', function () {
    var rec = { generatedAt: '2026-11-17T04:00:00Z', assets: { XU100: { label: 'BIST 100 (TL, nominal)', from: '2000-01-03', to: '2026-11-16', url: 'https://y', thr: { '10': { n: 25, medianDaysToRecover: 84, maxDaysToRecover: 1148 }, '20': { n: 13, medianDaysToRecover: 263 } } } } };
    var f = MO.recoveryFacts(rec, 0.12); ok(f.length >= 1 && f[0].src && f[0].src.url && /84 gün/.test(f[0].text) && !/undefined/.test(f[0].text), JSON.stringify(f)); eq(MO.recoveryFacts(null, 0.12), []);
    rec.assets.XU100.thr['10'].episodes = [{ depth: -0.15, daysToRecover: 100 }, { depth: -0.18, daysToRecover: 200 }, { depth: -0.5, daysToRecover: 900 }, { depth: -0.12, daysToRecover: null }];
    var f2 = MO.recoveryFacts(rec, 0.16); ok(f2[0].k === 'sim' && f2[0].n === 2 && f2[0].src.url === 'https://y' && /n ≤ 5/.test(f2[0].text), 'benzer derinlik: ' + JSON.stringify(f2[0]));
  });

  /* ---------- 5. Python ↔ JS kural eşitliği ---------- */
  test('Kural eşitliği: iş akışındaki (Python) puanlama ile uygulamadaki (JS) puanlama aynı sonucu verir', function () {
    var py = path.join(__dirname, '..', 'tools', 'fetch_hub.py'); if (!fs.existsSync(py)) return;
    var titles = ['Emergency rate hike: central bank shocks markets', 'Shoe Prices Hit a Record High Amid Inflation and Increased Tariffs', 'TCMB faiz kararını açıkladı', 'Fed holds rates steady as inflation cools', 'Bitcoin 70 bin doları aştı', 'Yeni telefon modeli tanıtıldı', 'Türkiye kredi notu görünümü negatife çevrildi', 'Erdoğan seçim kararı açıkladı', 'Savaş ve tarife gerilimi sürüyor, petrol sert yükseldi', 'S&P 500 rekor kırdı'];
    var code = 'import sys,json\nsys.path.insert(0,"' + path.join(__dirname, '..', 'tools').replace(/\\/g, '/') + '")\nimport fetch_hub as F\nr=F.load_rules()\nprint(json.dumps([[F.score_title(t,r)[0],bool(F.score_title(t,r)[2])] for t in json.loads(sys.stdin.read())]))';
    var res = cp.spawnSync('python3', ['-c', code], { input: JSON.stringify(titles), encoding: 'utf8' });
    if (res.error || res.status !== 0) { if (res.error && res.error.code === 'ENOENT') return; throw new Error('python hata: ' + (res.stderr || res.error)); }
    var got = JSON.parse(res.stdout); titles.forEach(function (t, i) { var j = N.scoreTitle(t); if (j.score !== got[i][0] || !!j.hard !== got[i][1]) throw new Error('Ayrışma: "' + t + '" JS=' + j.score + '/' + j.hard + ' PY=' + got[i][0] + '/' + got[i][1]); });
  });
  test('Kural dosyası: js/newsrules.js, tools/news_rules.json ile birebir (üretilmiş dosya güncel)', function () {
    var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'news_rules.json'), 'utf8')); var R = JSON.parse(JSON.stringify(require('../js/newsrules.js'))); delete json._doc; delete R._doc; ok(JSON.stringify(R) === JSON.stringify(json), 'newsrules.js güncel değil: python3 tools/gen_rules.py çalıştır');
  });
  test('Analog olay listesi: her olayın tarihi geçerli, grubu bilinen, kaynak bağlantısı https', function () {
    var ev = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'analog_events.json'), 'utf8')); var list = ev.events || ev; ok(list.length >= 10, 'olay sayısı'); var groups = Object.keys(EV.ANALOG_LABEL);
    list.forEach(function (e) { ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date), 'tarih ' + e.date); ok(groups.indexOf(e.group) >= 0, 'grup ' + e.group); ok(/^https:\/\//.test(e.src || ''), 'kaynak ' + e.title); });
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e.message }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
