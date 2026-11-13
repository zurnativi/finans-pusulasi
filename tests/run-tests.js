/* Çalıştırma: node tests/run-tests.js  (tarayıcıda: tests/tests.html) */
(function (root) {
  var isNode = typeof module === 'object' && module.exports;
  var M = isNode ? require('../js/money.js') : root.Money;
  var C = isNode ? require('../js/calc.js') : root.Calc;
  var P = isNode ? require('../js/importparse.js') : root.ImportParse;
  var S = isNode ? require('../js/sample.js') : root.Sample;
  var results = [];
  function test(name, fn) { try { fn(); results.push({ name: name, ok: true }); } catch (e) { results.push({ name: name, ok: false, err: e.message }); } }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }

  // ---- Money ----
  test('parse TR biçimi', function () { eq(M.parse('1.234,56'), 123456); eq(M.parse('1.234.567,8'), 123456780); eq(M.parse('0,05'), 5); });
  test('parse EN biçimi', function () { eq(M.parse('1,234.56'), 123456); eq(M.parse('1234.5'), 123450); });
  test('parse binlik tek ayırıcı', function () { eq(M.parse('1.234'), 123400); eq(M.parse('60.000'), 6000000); eq(M.parse('1.234.567'), 123456700); });
  test('parse negatif biçimler', function () { eq(M.parse('-1.234,56'), -123456); eq(M.parse('(1.234,56)'), -123456); eq(M.parse('1.234,56-'), -123456); eq(M.parse('−50'), -5000); });
  test('parse para birimi ve boşluk', function () { eq(M.parse('₺ 1.500,00'), 150000); eq(M.parse('1 500,00 TL'), 150000); eq(M.parse('250 TL'), 25000); });
  test('parse geçersiz girdiler null', function () { eq(M.parse('abc'), null); eq(M.parse(''), null); eq(M.parse('1,2,3'), null); eq(M.parse('12.34.5'), null); eq(M.parse(null), null); eq(M.parse(NaN), null); });
  test('parse 3+ ondalık yuvarlama', function () { eq(M.parse('0,125'), 13); eq(M.parse('2.345,678'), 234568); });
  test('parse sayı tipi float gürültüsü', function () { eq(M.parse(0.1 + 0.2), 30); eq(M.parse(1234.56), 123456); eq(M.parse(19.99), 1999); });
  test('0.1+0.2 hatası yok', function () { eq(M.add(M.parse('0,1'), M.parse('0,2')), M.parse('0,3')); });
  test('format', function () { eq(M.format(123456), '1.234,56 TL'); eq(M.format(-5), '−0,05 TL'); eq(M.format(6000000, { noDecimals: true }), '60.000 TL'); eq(M.format(150, { noDecimals: true }), '2 TL'); });
  test('parse/format gidiş-dönüş', function () { [0, 1, 99, 100, 123456789, -42].forEach(function (k) { eq(M.parse(M.format(k)), k); }); });
  test('mulRatio yuvarlama', function () { eq(M.mulRatio(100, 1, 3), 33); eq(M.mulRatio(200, 1, 3), 67); eq(M.mulRatio(-200, 1, 3), -67); eq(M.mulBp(10000, 2500), 2500); });
  test('allocate toplamı korur', function () {
    for (var i = 0; i < 200; i++) {
      var t = Math.floor(Math.random() * 1e9), w = [Math.random(), Math.random(), Math.random()];
      eq(M.sum(M.allocate(t, w)), t, 'toplam');
    }
    eq(M.allocate(100, [1, 1, 1]), [34, 33, 33]); eq(M.allocate(0, [1, 2]), [0, 0]); eq(M.allocate(100, [0, 0]), [0, 0]);
  });
  test('assertKurus float reddeder', function () { var threw = false; try { M.add(1.5, 1); } catch (e) { threw = true; } ok(threw); });

  // ---- Tarih ----
  test('parseDate biçimleri', function () {
    eq(P.parseDate('13.11.2026'), '2026-11-13'); eq(P.parseDate('1/2/2026'), '2026-02-01'); eq(P.parseDate('2026-11-13'), '2026-11-13');
    eq(P.parseDate('05.03.26'), '2026-03-05'); eq(P.parseDate('13 Kasım 2026'), '2026-11-13'); eq(P.parseDate(46339), '2026-11-13');
  });
  test('parseDate geçersiz tarihler', function () { eq(P.parseDate('31.02.2026'), null); eq(P.parseDate('29.02.2025'), null); eq(P.parseDate('29.02.2024'), '2024-02-29'); eq(P.parseDate('13.13.2026'), null); eq(P.parseDate('merhaba'), null); });

  // ---- Hesaplar ----
  var st = S.exampleState('2026-11');
  var an = C.analyze(st, '2026-11');
  test('örnek bütçe: fazla 15.000 TL', function () { eq(an.budget.income, 6000000); eq(an.budget.fixed, 3500000); eq(an.budget.variable, 1000000); eq(an.budget.surplus, 1500000); eq(an.budget.savingsRateBp, 2500); });
  test('örnek varlık toplamı 400.000 TL', function () { eq(an.assets.total, 40000000); eq(an.assets.netWorth, 40000000); });
  test('acil fon hedefi = 6 x 45.000', function () { eq(an.emergency.target, 27000000); ok(an.emergency.current <= an.emergency.target); eq(M.add(an.emergency.current, an.emergency.shortfall), an.emergency.target); });
  test('aylık plan toplamı fazlaya eşit', function () { var p = an.plan; eq(M.add(p.toEmergency, p.safe, p.medium, p.risky), p.surplus); });
  test('hedef dağılım her zaman %100', function () { for (var m = -5; m <= 120; m++) { var a = C.targetAllocation(m); eq(a.safe + a.medium + a.risky, 10000, 'ay ' + m); ok(a.safe >= 0 && a.medium >= 0 && a.risky >= 0); } });
  test('hedefe yaklaştıkça risk azalır', function () { var prev = -1; for (var m = 0; m <= 60; m++) { var r = C.targetAllocation(m).risky; ok(r >= prev, 'ay ' + m); prev = r; } eq(C.targetAllocation(0).risky, 0); eq(C.targetAllocation(60).risky, 2500); });
  test('hedef 60 ay sonra', function () { eq(an.goal.monthsLeft, 60); });
  test('yatırım kovaları + acil fon = toplam varlık', function () { eq(M.add(an.investTotal, an.emergency.current), an.assets.total); });
  test('projeksiyon: sıfır getiri, sıfır enflasyon = katkıların toplamı', function () {
    var s = C.project({ start: { safe: 100000, medium: 0, risky: 0 }, reserveStart: 0, monthlyContribution: 1000, emergencyTopUp: 0, months: 12, monthsToGoal: 12, returnsBp: { safe: 0, medium: 0, risky: 0 }, inflationBp: 0 });
    eq(s[12].total, 112000); eq(s[12].nominalTotal, 112000);
  });
  test('projeksiyon: %12 yıllık = 12 ayda tam %12', function () {
    var s = C.project({ start: { safe: 10000000, medium: 0, risky: 0 }, reserveStart: 0, monthlyContribution: 0, months: 12, monthsToGoal: 12, returnsBp: { safe: 1200, medium: 0, risky: 0 }, inflationBp: 0 });
    ok(Math.abs(s[12].total - 11200000) <= 12, 'sonuç ' + s[12].total);
  });
  test('projeksiyon: acil fon önce dolar', function () {
    var s = C.project({ start: { safe: 0, medium: 0, risky: 0 }, reserveStart: 0, monthlyContribution: 1000, emergencyTopUp: 2500, months: 4, monthsToGoal: 60, returnsBp: { safe: 0, medium: 0, risky: 0 }, inflationBp: 0 });
    eq(s[2].reserve, 2000); eq(s[3].reserve, 2500); eq(s[3].invest, 500); eq(s[4].invest, 1500);
  });
  test('senaryolar sıralı: kötümser <= temel <= iyimser', function () { ok(an.scenarios.pessimistic.atGoal <= an.scenarios.base.atGoal && an.scenarios.base.atGoal <= an.scenarios.optimistic.atGoal); });
  test('gider fazlası olunca yatırım yok', function () {
    var s2 = JSON.parse(JSON.stringify(st)); s2.incomes[0].amount = 3000000; var a2 = C.analyze(s2, '2026-11');
    eq(a2.plan.surplus, 0); eq(a2.plan.deficit, 1500000); ok(C.actions(a2)[0].level === 'danger');
  });
  test('monthActuals', function () {
    var r = C.monthActuals([{ date: '2026-11-02', amount: -12345, category: 'Market' }, { date: '2026-11-03', amount: 500000 }, { date: '2026-10-30', amount: -1 }, { date: '2026-11-05', amount: -999, category: 'Transfer' }], '2026-11');
    eq(r.expense, 12345); eq(r.income, 500000); eq(r.byCategory.Market, 12345);
  });

  // ---- İçe aktarma ----
  test('kategori önerisi', function () { eq(P.suggestCategory('MIGROS TİC A.Ş. İSTANBUL', -10000), 'Market'); eq(P.suggestCategory('MAAŞ ÖDEMESİ', 100), 'Gelir'); eq(P.suggestCategory('NETFLIX.COM', -100), 'Abonelik/Eğlence'); eq(P.suggestCategory('xyz', -1), 'Diğer'); eq(P.suggestCategory('ODEME - TESEKKUR EDERIZ', 200000), 'Transfer'); eq(P.CATEGORIES.filter(function (c) { return c === 'Transfer'; }).length, 1); });
  test('mükerrer tespiti', function () {
    var rows = [{ date: '2026-11-01', amount: -100, description: 'Migros' }, { date: '2026-11-01', amount: -100, description: 'MIGROS ' }, { date: '2026-11-02', amount: -100, description: 'Migros' }, { date: '2026-11-03', amount: -5, description: 'A101' }];
    P.markDuplicates(rows, [{ date: '2026-11-03', amount: -5, description: 'a101' }]);
    eq(rows.map(function (r) { return !!r.duplicate; }), [false, true, false, true]);
  });
  test('tablo sütun tespiti + borç/alacak', function () {
    var rows = [['Hesap Özeti'], ['Tarih', 'Açıklama', 'Borç', 'Alacak', 'Bakiye'], ['01.11.2026', 'MIGROS', '1.250,50', '', '10.000,00'], ['02.11.2026', 'MAAŞ', '', '60.000,00', '70.000,00'], ['', 'Toplam', '1.250,50', '60.000,00', '']];
    var map = P.detectColumns(rows); eq([map.headerRow, map.date, map.desc, map.debit, map.credit], [1, 0, 1, 2, 3]);
    var out = P.rowsFromTable(rows, map, 1); eq(out.length, 2); eq(out[0].amount, -125050); eq(out[1].amount, 6000000); eq(out[0].date, '2026-11-01');
  });
  test('tablo tek tutar sütunu, kredi kartı işareti', function () {
    var rows = [['İşlem Tarihi', 'İşyeri', 'Tutar (TL)'], ['03/11/2026', 'OPET', 1500], ['04/11/2026', 'İADE', '-200,00']];
    var map = P.detectColumns(rows); var out = P.rowsFromTable(rows, map, -1); eq(out.map(function (r) { return r.amount; }), [-150000, 20000]);
  });
  test('PDF metin satır ayrıştırma', function () {
    var txt = 'XYZ BANK HESAP EKSTRESİ\n01.11.2026 MIGROS KADIKOY 1.250,50 TL 8.749,50\n02.11.2026 03.11.2026 TURKCELL FATURA 459,90\n13 Kasım 2026 NETFLIX 229,99\nDönem Borcu 1.940,39\nBu satır işlem değil 12,00';
    var r = P.parseTextLines(txt, -1);
    eq(r.rows.length, 3); eq(r.rows[0].amount, -125050); ok(r.rows[0].note); eq(r.rows[1].description, 'TURKCELL FATURA'); eq(r.rows[2].date, '2026-11-13');
    eq(r.totals[0].amount, 194039);
    r.rows.forEach(function (x) { x.include = true; }); var tc = P.totalsCheck(r.rows, 194039); ok(tc.match, 'fark ' + tc.diff);
  });
  test('doğrulama', function () {
    var a = P.validateRow({ date: null, amount: 0, description: '' }, '2026-11-13'); eq(a.errors.length, 2);
    var b = P.validateRow({ date: '2027-01-01', amount: -100, description: 'x' }, '2026-11-13'); eq(b.errors.length, 0); eq(b.warnings[0], 'Tarih gelecekte');
  });
  test('AI JSON çözümleme', function () {
    var r = P.rowsFromAiJson('İşte sonuç:\n```json\n{"merchant":"BİM","date":"12.11.2026","total":"57,50","transactions":[{"description":"Ekmek","amount":"-7,50"},{"description":"Süt","amount":"50,00","type":"gider"}]}\n```');
    eq(r.rows.length, 2); eq(r.rows[0].amount, -750); eq(r.rows[1].amount, -5000); eq(r.rows[0].date, '2026-11-12'); eq(r.docTotal, 5750);
  });

  test('fiş OCR ayrıştırma', function () {
    var txt = 'BİM BİRLEŞİK MAĞAZALAR A.Ş.\nTARİH: 12.11.2026 SAAT: 18:42\nFİŞ NO: 0042\nEKMEK %1 *7,50\nSÜT 1L %1 *32,50\nDETERJAN %20 *17,50\nTOPKDV *4,12\nTOPLAM *57,50\nNAKİT *60,00\nPARA ÜSTÜ *2,50';
    var r = P.parseReceiptText(txt);
    eq(r.date, '2026-11-12'); eq(r.docTotal, 5750); eq(r.rows.length, 3); eq(r.rows.map(function (x) { return x.amount; }), [-750, -3250, -1750]); eq(r.rows[0].description, 'EKMEK');
    r.rows.forEach(function (x) { x.include = true; }); ok(P.totalsCheck(r.rows, r.docTotal).match);
  });

  test('fiş OCR gürültüsü', function () {
    var r = P.parseReceiptText('ÖRNEK MARKET\nTARİH: 12.11.2026\nEKMEK %1 *7,50\nSÜT 1L S1  *32,50\nDETERJAN 520  *17,50\nTOPKDV *4,12\nTOPLAM *57,:50\nNAKIT *60,00');
    eq(r.docTotal, 5750); eq(r.rows.map(function (x) { return x.description; }), ['EKMEK', 'SÜT 1L', 'DETERJAN']);
  });

  var passed = results.filter(function (r) { return r.ok; }).length;
  if (isNode) {
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' test geçti');
    if (passed !== results.length) process.exit(1);
  } else { root.TEST_RESULTS = results; }
})(typeof self !== 'undefined' ? self : this);
