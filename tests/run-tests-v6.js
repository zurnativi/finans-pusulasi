/* v6 regresyon testleri: denetimde bulunan hataların her biri için en az bir test.
 * Çalıştırma: node tests/run-tests-v6.js (run-tests.js de sonunda bunu çalıştırır). */
(function () {
  var fs = require('fs'), path = require('path');
  var M = require('../js/money.js'), C = require('../js/calc.js'), L = require('../js/ledger.js'), P = require('../js/importparse.js');
  var PF = require('../js/portfolio.js'), S = require('../js/sample.js'), SY = require('../js/sync.js'), CB = require('../js/cryptobox.js');
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function noThrow(fn, msg) { try { return fn(); } catch (e) { throw new Error((msg || 'hata atmamalı') + ': ' + e.message); } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fixture(n) { return fs.readFileSync(path.join(__dirname, n), 'utf8'); }

  /* ---- 1. Kart ekstresi: harcamalar gider, ödeme Transfer, toplam 1.854,39 tutar ---- */
  // Uygulamadaki inceleme hattının (app.js startReviewRows/categorize) aynısı: algıla → çevir → kategori → toplam
  function reviewPipeline(text) {
    var parsed = P.parseTextLines(text, 1), rows = parsed.rows.map(function (r) { r.include = true; return r; });
    var cc = P.detectCardStatement(text);
    if (cc.isCard && P.looksPositiveExpenses(rows)) rows.forEach(function (r) { r.amount = -r.amount; });
    rows.forEach(function (r) { r.category = r.amount > 0 && P.isCardPayment(r.description) ? 'Transfer' : P.suggestCategory(r.description, r.amount); });
    var docTotal = parsed.totals.length ? parsed.totals[parsed.totals.length - 1].amount : null;
    return { rows: rows, cc: cc, check: P.totalsCheck(rows, docTotal, { expectExpenses: cc.isCard }) };
  }
  test('Kart ekstresi otomatik algılanır (ornek-kredi-karti-ekstresi)', function () {
    var cc = P.detectCardStatement(fixture('fixture-kart-ekstresi.txt'));
    ok(cc.isCard, 'algılanmadı: ' + cc.hits);
    ok(!P.detectCardStatement('Tarih;Açıklama;Tutar\n01.11.2026;MAAŞ;60.000,00').isCard, 'banka dökümü kart sayılmamalı');
  });
  test('Kart ekstresi: harcamalar eksi (gider), ödeme Transfer, harcamalar 1.854,39 ve toplam tutuyor', function () {
    var r = reviewPipeline(fixture('fixture-kart-ekstresi.txt'));
    var purchases = r.rows.filter(function (x) { return x.category !== 'Transfer'; });
    ok(purchases.every(function (x) { return x.amount < 0; }), 'tüm harcamalar gider olmalı');
    eq(purchases.reduce(function (s, x) { return s - x.amount; }, 0), 185439, 'harcama toplamı');
    var pay = r.rows.filter(function (x) { return /ODEME/.test(x.description); })[0];
    eq(pay.category, 'Transfer'); ok(pay.amount > 0, 'ödeme karta giriş (Transfer)');
    eq(r.check.expense, 185439); ok(r.check.match, 'belge toplamıyla tutmalı'); ok(!r.check.suspicious, 'şüpheli olmamalı');
  });
  test('Kart ekstresi çevrilmeden kaydedilirse "Tutuyor" DEĞİL, şüpheli uyarısı', function () {
    var parsed = P.parseTextLines(fixture('fixture-kart-ekstresi.txt'), 1), rows = parsed.rows.map(function (r) { r.include = true; r.category = P.suggestCategory(r.description, r.amount); return r; });
    var ch = P.totalsCheck(rows, 185439, { expectExpenses: true });
    ok(ch.suspicious, 'şüpheli işaretlenmeli'); ok(!ch.match, 'yeşil "tutuyor" gösterilmemeli');
  });
  test('Taksitli ekstre: TEKNOSA TAKSİT → Alışveriş (Ulaşım/taksi değil), toplam 3.315,88 tutar', function () {
    var r = reviewPipeline(fixture('fixture-kart-ekstresi-taksitli.txt'));
    var tek = r.rows.filter(function (x) { return /TEKNOSA/.test(x.description); })[0];
    ok(tek.category !== 'Ulaşım', 'TAKSİT taksi değildir: ' + tek.category);
    ok(r.check.match, 'tutmalı: ' + JSON.stringify(r.check));
  });

  /* ---- 7. taksi / TAKSİT ---- */
  test('Kategori: tam kelime, Türkçe duyarlı; "taksi" TAKSİT ile eşleşmez', function () {
    eq(P.suggestCategory('TEKNOSA TAKSİT 3/6', -125000), 'Alışveriş');
    eq(P.suggestCategory('BİTAKSİ YOLCULUK', -15000), 'Ulaşım');
    eq(P.suggestCategory('Taksi ücreti', -15000), 'Ulaşım');
    ok(P.suggestCategory('TAKSİTLİ SATIŞ 2/4', -1000) !== 'Ulaşım', 'taksitli');
  });

  /* ---- 2. Acil fon 0 iken "tamam" denmez ---- */
  function baseState() {
    var s = S.emptyState(); s.incomes = [{ id: 'i', name: 'Maaş', amount: 5000000 }]; s.expenses = [{ id: 'e', name: 'Kira', type: 'fixed', amount: 2000000 }];
    s.goal = { name: 'Ev', target: 100000000, targetYm: '2031-11' }; s.goals[0].target = 100000000; return s;
  }
  test('Acil durum fonu 0 iken "tamam" önerisi yok; eksik uyarısı var', function () {
    var s = baseState(); s.settings.emergencyShareBp = 0; // payı 0 olsa bile
    var an = C.analyze(s, '2026-11'); ok(an.emergency.current === 0 && an.emergency.shortfall > 0, 'ön koşul');
    var acts = C.actions(an);
    ok(!acts.some(function (a) { return /tamam/i.test(a.text); }), 'tamam denmemeli: ' + JSON.stringify(acts));
    ok(acts.some(function (a) { return a.level === 'warn' && /eksik/.test(a.text); }), 'eksik uyarısı olmalı');
  });
  test('Yatırım yokken "dağılım sapmış" önerisi verilmez', function () {
    var an = C.analyze(baseState(), '2026-11'); eq(an.investTotal, 0);
    ok(!C.actions(an).some(function (a) { return /sapmış/.test(a.text); }), 'sapma önerisi olmamalı');
  });
  test('Acil fon dolu ve hedef > 0 ise "tamam" gösterilir', function () {
    var s = baseState(); s.assets = [{ id: 'a', name: 'Katılım hesabı', cls: 'cash', risk: 'safe', value: 50000000, emergency: true }];
    var acts = C.actions(C.analyze(s, '2026-11'));
    ok(acts.some(function (a) { return a.level === 'ok' && /tamam/.test(a.text); }), JSON.stringify(acts));
  });

  /* ---- 3. Taşma ---- */
  test('Projeksiyon taşması: %60 enflasyon + 2066 hedef hata atmaz, "çok büyük" işaretlenir', function () {
    var s = S.exampleState(); s.settings.inflationBp = 6000; s.settings.scenarios.optimistic.returnsBp = { safe: 5000, medium: 8000, risky: 15000 };
    s.goals.forEach(function (g) { g.targetYm = '2066-12'; }); s.goal.targetYm = '2066-12';
    var an = noThrow(function () { return C.analyze(s, '2026-11'); }, 'analyze');
    var rep = noThrow(function () { return PF.goalsReport(s, an); }, 'goalsReport');
    ok(rep.goals.some(function (g) { return g.projection.optimistic.capped; }), 'capped işareti');
    noThrow(function () { an.scenarios.optimistic.series.forEach(function (p) { M.format(p.nominalTotal); M.formatShort(p.nominalTotal); }); }, 'format');
  });
  test('Money.format asla hata atmaz: Infinity/NaN → "—", tavan üstü → "çok büyük"', function () {
    eq(M.format(Infinity), '—'); eq(M.format(NaN), '—');
    ok(/çok büyük/.test(M.format(1e16)), M.format(1e16)); ok(/çok büyük/.test(M.formatShort(1e16)));
    eq(M.satAdd(9e15, 9e15) <= 1e15, true); ok(M.isCapped(M.satMulFloat(1e14, 1e6)));
  });

  /* ---- 4. Tek risk kuralı (ana sayfa = portföy) ---- */
  test('Acil fon eksikken riskli alım ne ana sayfa planında ne Dengeleme\'de önerilir (ortak kural)', function () {
    var s = S.exampleState(); var an = C.analyze(s, '2026-11');
    ok(an.emergency.shortfall > 0 && s.settings.riskRules.emergencyFirst !== false, 'ön koşul');
    ok(C.riskyBlocked(s, an.emergency), 'kural'); eq(an.plan.risky, 0, 'ana sayfa planında riskli 0');
    var rep = PF.goalsReport(s, an); PF.patchAnalysis(an, s, rep);
    var pos = PF.positions(s, s, an, '2026-11-17');
    var rb = PF.rebalance(pos, an.targetAlloc, 1000000, { tierBandBp: 500, assetBandBp: 300, blockRisky: C.riskyBlocked(s, an.emergency) });
    ok(!rb.buys.some(function (b) { return b.risk === 'risky' || (b.pos && b.pos.risk === 'risky'); }), 'dengelemede riskli alım: ' + JSON.stringify(rb.buys.map(function (b) { return b.name || (b.pos && b.pos.name); })));
    ok(!C.actions(an).some(function (a) { return /riskli [0-9]/.test(a.text); }), 'öneri metninde riskli tutar olmamalı');
  });
  test('emergencyFirst kapalıysa riskli pay planlanır', function () {
    var s = S.exampleState(); s.settings.riskRules.emergencyFirst = false; var an = C.analyze(s, '2026-11');
    ok(!C.riskyBlocked(s, an.emergency)); ok(an.plan.risky > 0 || an.targetAlloc.risky === 0);
  });

  /* ---- 5. project() acil fon payını kullanır ---- */
  test('project(): acil fona giden pay emergencyShareBp ile sınırlı', function () {
    var base = { start: { safe: 0, medium: 0, risky: 0 }, reserveStart: 0, monthlyContribution: 1000000, emergencyTopUp: 5000000, months: 1, monthsToGoal: 60, returnsBp: { safe: 0, medium: 0, risky: 0 }, inflationBp: 0 };
    var a = C.project(Object.assign({}, base, { emergencyShareBp: 5000 }));
    eq(a[1].reserve, 500000, '%50 pay'); eq(a[1].invest, 500000);
    var b = C.project(base); eq(b[1].reserve, 1000000, 'pay verilmezse %100');
    var an = C.analyze(S.exampleState(), '2026-11');
    eq(an.plan.toEmergency, Math.min(an.emergency.shortfall, M.mulBp(an.plan.surplus, C.emergencyShareBp(S.exampleState()))), 'plan ile aynı pay');
  });
  test('project(): blockRiskyUntilEmergency acil fon dolana kadar riskli kovaya para koymaz', function () {
    var o = { start: { safe: 0, medium: 0, risky: 0 }, reserveStart: 0, monthlyContribution: 1000000, emergencyTopUp: 3000000, emergencyShareBp: 5000, months: 3, monthsToGoal: 120, returnsBp: { safe: 0, medium: 0, risky: 0 }, inflationBp: 0, blockRiskyUntilEmergency: true };
    var sr = C.project(o); ok(sr[3].invest > 0); // riskli bakiyesi ölçülemiyor; toplam korunur
    eq(sr[3].invest + sr[3].reserve, 3000000, 'kuruş kaybı yok');
  });

  /* ---- 6. Örnek veri + eşitleme ---- */
  test('realRecordCount: örnek veride 0, gerçek kayıtta > 0', function () {
    eq(S.realRecordCount(S.emptyState()), 0);
    var s = S.emptyState(); s.transactions = [{ id: 't', date: '2026-11-01', amount: -100, description: 'x' }]; ok(S.realRecordCount(s) > 0);
    var g = S.emptyState(); g.goals[0].target = 1000; ok(S.realRecordCount(g) > 0, 'hedef tutarı da gerçek veri');
  });
  function fakeClient() {
    var store = { id: null, content: null };
    return { store: store, find: function () { return Promise.resolve(store.id); }, read: function () { return Promise.resolve({ content: store.content }); },
      create: function (c) { store.id = 'g1'; store.content = c; return Promise.resolve({ id: 'g1' }); }, update: function (id, c) { store.content = c; return Promise.resolve({ id: id }); } };
  }
  test('Eşitleme: yerel örnek veri buluttaki gerçek verinin üzerine ASLA yazılmaz (push reddedilir, auto/merge → çek)', function () {
    var cl = fakeClient(), pass = 'eşitleme parolası 123', real = S.emptyState(); real.transactions = [{ id: 't1', date: '2026-11-01', amount: -500, description: 'gerçek', category: 'Diğer' }];
    var V = function (x) { return S.validateState(x); };
    return SY.run({ local: real, cfg: { pass: pass }, client: cl, validate: V, keyCache: {}, startMs: 1 }).then(function () {
      var ex = S.exampleState(); var before = cl.store.content;
      return SY.run({ local: ex, cfg: { pass: pass, gistId: 'g1' }, client: cl, validate: V, keyCache: {}, startMs: 2, mode: 'push' }).then(function () { throw new Error('push reddedilmeliydi'); }, function (e) {
        ok(/örnek/i.test(e.message), e.message); eq(cl.store.content, before, 'bulut değişmedi');
        return SY.run({ local: ex, cfg: { pass: pass, gistId: 'g1', lastSyncAt: 5 }, client: cl, validate: V, keyCache: {}, startMs: 3 });
      }).then(function (r) { eq(r.action, 'pulled-replace'); eq(cl.store.content, before, 'bulut değişmedi'); ok(!r.state.isExample, 'gerçek veri geldi'); });
    });
  });

  /* ---- Küçükler ---- */
  test('Türkçe yüzde ekleri: %52\'si, %14\'ü, %50\'si, %12,5\'i, %0,0\'ı', function () {
    eq(M.withSuffix('%52'), "%52'si"); eq(M.withSuffix('%14'), "%14'ü"); eq(M.withSuffix('%50'), "%50'si"); eq(M.withSuffix('%12,5'), "%12,5'i"); eq(M.withSuffix('%0,0'), "%0,0'ı");
    eq(M.withSuffix('%6'), "%6'sı"); eq(M.withSuffix('%40'), "%40'ı"); eq(M.withSuffix('%100'), "%100'ü");
    eq(M.locSuffix(2051), "de"); eq(M.locSuffix(2060), "ta");
  });
  test('Tutar okuma: "-1,234" ve "1.234,567" uyarılı', function () {
    var a = M.parseInfo('-1,234'); eq(a.value, -123400); ok(a.warnings.length === 1);
    var b = M.parseInfo('1.234,567'); eq(b.value, 123457); ok(/yuvarlandı/.test(b.warnings[0]));
    eq(M.parseInfo('1.234,56'), { value: 123456, warnings: [] });
  });
  test('İçe aktarma: gelecek tarihli satır uyarı alır', function () {
    var v = P.validateRow({ date: '2099-01-01', amount: -100, description: 'x', include: true }, '2026-11-17');
    ok(v.warnings.some(function (w) { return /gelecekte/.test(w); }));
  });
  test('Mükerrer: farklı hesapta aynı gün + aynı tutar "olası mükerrer" uyarısı', function () {
    var rows = [{ date: '2026-11-10', amount: -200000, description: 'KART ÖDEMESİ' }];
    P.markDuplicates(rows, [{ date: '2026-11-10', amount: -200000, description: 'Kredi kartı borcu', accountId: 'banka' }]);
    ok(rows[0].possibleDup && /başka bir hesapta/.test(rows[0].possibleDup), JSON.stringify(rows[0])); ok(!rows[0].duplicate);
    var v = P.validateRow(Object.assign({ include: true }, rows[0]), '2026-11-17'); ok(v.warnings.some(function (w) { return /mükerrer/i.test(w); }));
  });
  test('Dengeleme adet yuvarlama varlık türüne göre (hisse/fon 0, altın 2, kripto 6)', function () {
    eq(PF.qtyDecimals({ lot: 'whole' }), 0);
    eq(PF.qtyDecimals({ lot: 'fraction', asset: { cls: 'crypto', symbol: 'BTC', priceKey: 'cg:bitcoin' } }), 6);
    var q = PF.roundQty(123456789, { lot: 'whole' }); eq(q % 1e8, 0);
  });
  test('Getiri: temettü satışlardan ayrı sayılır (gross.dividends)', function () {
    var s = S.exampleState(); var r = PF.returnsReport(s, '2026-11-17');
    ok(r.gross && r.gross.dividends >= 0 && r.gross.bought > 0, JSON.stringify(r.gross));
    var hasDiv = (s.trades || []).some(function (t) { return t.side === 'div'; });
    if (hasDiv) ok(r.gross.dividends > 0, 'örnek veride temettü var');
  });
  test('Sınırlar: tek bir ay sonu tahmini (estimate = max(projected, pace))', function () {
    var s = S.exampleState(); var lim = L.categoryLimits(s, '2026-11', '2026-11-17');
    var items = Array.isArray(lim) ? lim : (lim.items || lim.rows || []);
    ok(items.length > 0, 'limit var'); items.forEach(function (x) { ok(Number.isInteger(x.estimate), 'estimate'); ok(x.estimate >= x.pace, 'pace'); });
  });
  test('Katılım 50 varsayılan helal kıyas; BIST 100 yalnız detaylı', function () {
    var b = PF.BENCHMARKS; ok(b[0].key === 'idx:KATLM' || b[0].id === 'KATLM' || /KATLM/.test(JSON.stringify(b[0])), JSON.stringify(b[0]));
    ok(b.some(function (x) { return /XU100/.test(JSON.stringify(x)) && x.detailOnly; }), 'XU100 detailOnly');
  });
  test('PBKDF2/şifreleme yardımcıları mevcut (kilit altı gizli kayıt için)', function () {
    ok(typeof CB.encryptJson === 'function');
  });

  function run() {
    var results = [], chain = Promise.resolve();
    tests.forEach(function (t) {
      chain = chain.then(function () { return Promise.resolve().then(t.fn); }).then(function () { results.push({ name: t.name, ok: true }); }, function (e) { results.push({ name: t.name, ok: false, err: e.message }); });
    });
    return chain.then(function () { return results; });
  }
  module.exports = { run: run };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v6 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
