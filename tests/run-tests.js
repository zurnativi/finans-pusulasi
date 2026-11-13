/* Çalıştırma: node tests/run-tests.js  (tarayıcıda: tests/tests.html) */
(function (root) {
  var isNode = typeof module === 'object' && module.exports;
  var M = isNode ? require('../js/money.js') : root.Money;
  var C = isNode ? require('../js/calc.js') : root.Calc;
  var P = isNode ? require('../js/importparse.js') : root.ImportParse;
  var S = isNode ? require('../js/sample.js') : root.Sample;
  var L = isNode ? require('../js/ledger.js') : root.Ledger;
  var V1 = isNode ? require('./fixture-v1.js') : root.FIXTURE_V1;
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
  var st = S.validateState(JSON.parse(JSON.stringify(V1))); // v1 örnek yedeği, v2'ye göç ettirilmiş hâliyle (regresyon)
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
    var tcn = P.totalsCheck([{ include: true, amount: -631588 }, { include: true, amount: 300000 }], 331588); ok(tcn.match && tcn.byNet && tcn.diff === 0, 'ödemeler düşülmüş ekstre toplamı');
    ok(!P.totalsCheck([{ include: true, amount: -631588 }, { include: true, amount: 300000 }], 331500).match);
  });

  test('fiş OCR gürültüsü', function () {
    var r = P.parseReceiptText('ÖRNEK MARKET\nTARİH: 12.11.2026\nEKMEK %1 *7,50\nSÜT 1L S1  *32,50\nDETERJAN 520  *17,50\nTOPKDV *4,12\nTOPLAM *57,:50\nNAKIT *60,00');
    eq(r.docTotal, 5750); eq(r.rows.map(function (x) { return x.description; }), ['EKMEK', 'SÜT 1L', 'DETERJAN']);
  });


  // ================= Bütçe v2 (ledger.js) =================
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var nid = 0, uidT = function () { return 't' + (++nid); };

  // ---- Para birimi ----
  test('kur çevirme: USD, EUR, gram altın', function () {
    var rates = { USD: { rate: 4250, date: '2026-11-13' }, EUR: { rate: 4900, date: '2026-11-13' }, XAU: { rate: 540000, date: '2026-11-13' } };
    eq(L.toTRY(100000, 'USD', rates), 4250000);          // 1.000 USD × 42,50 = 42.500 TL
    eq(L.toTRY(1250, 'XAU', rates), 6750000);            // 12,50 gr × 5.400 = 67.500 TL
    eq(L.toTRY(1, 'USD', { USD: { rate: 4257, date: '2026-11-13' } }), 43); // 0,01 USD × 42,57 = 0,4257 TL → 43 kuruş
    eq(L.toTRY(-1, 'USD', { USD: { rate: 4257, date: '2026-11-13' } }), -43);
    eq(L.toTRY(12345, 'TRY', {}), 12345);
    eq(L.toTRY(100, 'EUR', {}), null, 'kur yoksa null');
    eq(L.toTRY(100, 'EUR', { EUR: { rate: 0, date: '2026-11-13' } }), null, 'sıfır kur geçersiz');
    eq(L.formatCur(1250, 'XAU'), '12,50 gr altın'); eq(L.formatCur(100000, 'USD'), '1.000,00 USD'); eq(L.rateAgeDays(rates, 'USD', '2026-11-20'), 7);
  });
  test('kur çevirme float hatası yok (büyük tutar)', function () { eq(L.toTRY(123456789012, 'USD', { USD: { rate: 4250, date: '2026-01-01' } }), 5246913533010); });

  // ---- Taksit ----
  test('taksit bölme: toplam korunur, kuruşlar ilk taksitlere', function () {
    eq(L.installmentParts(2499999, 6), [416667, 416667, 416667, 416666, 416666, 416666]);
    eq(L.installmentParts(4200000, 12).every(function (x) { return x === 350000; }), true);
    eq(L.installmentParts(100, 3), [34, 33, 33]); eq(L.installmentParts(5, 1), [5]);
    for (var i = 0; i < 300; i++) { var t = Math.floor(Math.random() * 1e10) + 60, n = 1 + Math.floor(Math.random() * 60); var p = L.installmentParts(t, n); eq(M.sum(p), t); ok(p[0] - p[n - 1] <= 1); }
  });
  test('taksit durumu: bu ay, kalan, gelecek', function () {
    var plan = { total: 4200000, count: 12, firstYm: '2026-07' }, s = L.installmentStatus(plan, '2026-11');
    eq(s.paidCount, 4); eq(s.thisMonth, 350000); eq(s.remainingCount, 8); eq(s.remaining, 2800000); eq(s.future, 2450000); eq(s.lastYm, '2027-06');
    eq(M.add(s.paid, s.remaining), plan.total);
    var done = L.installmentStatus(plan, '2027-07'); ok(done.done); eq(done.remaining, 0);
    var nys = L.installmentStatus({ total: 300, count: 3, firstYm: '2027-01' }, '2026-11'); ok(nys.notStarted); eq(nys.thisMonth, 0); eq(nys.future, 300);
  });
  test('aylık taksit yükü (tüm kartlar)', function () {
    var st2 = { installments: [{ cardId: 'a', total: 600, count: 3, firstYm: '2026-11' }, { cardId: 'b', total: 1000, count: 2, firstYm: '2026-12' }] };
    var b = L.installmentBurden(st2, '2026-11', 4);
    eq(b.map(function (x) { return x.total; }), [200, 700, 700, 0]); eq(b[1].byCard, { a: 200, b: 500 });
    eq(L.futureInstallmentsForCard(st2, 'a', '2026-11'), 400);
  });
  test('ekstrede taksit ifadesini tanıma', function () {
    eq(L.detectInstallment('MEDIAMARKT TAKSİT 2/6'), { no: 2, count: 6 }); eq(L.detectInstallment('TEKNOSA 3/12 TK'), { no: 3, count: 12 });
    eq(L.detectInstallment('IKEA (1/6)'), { no: 1, count: 6 }); eq(L.detectInstallment('Taksit 02/06 Boyner'), { no: 2, count: 6 });
    eq(L.detectInstallment('Market 13/11'), null); eq(L.detectInstallment('TAKSIT 7/6'), null); eq(L.detectInstallment('13/11/2026 TAKSİT'), null);
  });

  // ---- Kredi kartı ----
  test('kart son ödeme tarihi', function () {
    eq(L.cardDueDate('2026-11', 5, 15), '2026-11-15'); eq(L.cardDueDate('2026-11', 25, 5), '2026-12-05');
    eq(L.cardDueDate('2027-01', 20, 31), '2027-01-31'); eq(L.cardDueDate('2027-01', 31, 28), '2027-02-28'); eq(L.cardDueDate('2028-01', 31, 30), '2028-02-29');
    eq(L.nextStatementDate('2026-11-13', 5), '2026-12-05'); eq(L.nextStatementDate('2026-11-13', 20), '2026-11-20'); eq(L.nextStatementDate('2027-02-10', 31), '2027-02-28');
  });
  test('kart durumu: kalan ekstre borcu, limit, uyarı', function () {
    var card = { id: 'c', type: 'card', currency: 'TRY', balance: -1073050, card: { statementDay: 5, dueDay: 15, limit: 8000000, statementDebt: 1248050, statementYm: '2026-11', paid: 500000, remindDays: 3 } };
    var st2 = { accounts: [card], installments: [{ cardId: 'c', total: 600000, count: 3, firstYm: '2026-11' }] };
    var cs = L.cardStatus(st2, card, '2026-11-13');
    eq(cs.remaining, 748050); eq(cs.daysLeft, 2); eq(cs.level, 'soon'); eq(cs.futureInstallments, 400000); eq(cs.used, 1473050); eq(cs.available, 6526950);
    eq(L.cardStatus(st2, card, '2026-11-01').level, 'later'); eq(L.cardStatus(st2, card, '2026-11-15').level, 'today'); eq(L.cardStatus(st2, card, '2026-11-16').level, 'overdue');
    card.card.paid = 1248050; eq(L.cardStatus(st2, card, '2026-11-16').level, 'ok');
  });

  // ---- Kategori sınırları ----
  test('sınır uyarı eşikleri (%80 ve %100) kesin', function () {
    eq(L.limitLevel(7999, 10000), 'ok'); eq(L.limitLevel(8000, 10000), 'warn'); eq(L.limitLevel(10000, 10000), 'warn'); eq(L.limitLevel(10001, 10000), 'over');
    eq(L.limitLevel(79999, 100000), 'ok', '%79,999 yuvarlanıp uyarı vermemeli'); eq(L.limitLevel(0, 0), null);
    eq(L.limitLevel(9007199254740991, 9007199254740990), 'over');
    var s = L.limitStatus(12000, 10000); eq(s.remaining, -2000); eq(s.usedBp, 12000); ok(L.limitStatus(10000, 10000).atLimit);
  });
  test('kategori sınırı: harcanan + bekleyen düzenli ödeme', function () {
    var st2 = { transactions: [{ id: 'x', date: '2026-11-03', amount: -50000, category: 'Abonelik/Eğlence' }, { id: 'y', date: '2026-11-04', amount: -500000, category: 'Market' }],
      limits: { 'Abonelik/Eğlence': 65000, 'Market': 600000, 'Giyim': 0 },
      recurring: [{ id: 'r', name: 'Dizi platformu', direction: 'expense', amount: 20000, category: 'Abonelik/Eğlence', freq: 'monthly', day: 20, startYm: '2026-01', skipped: [] }] };
    var cl = L.categoryLimits(st2, '2026-11', '2026-11-13');
    eq(cl.length, 2); eq(cl[0].category, 'Market'); eq(cl[0].level, 'warn');
    var ab = cl[1]; eq(ab.level, 'ok'); eq(ab.expected, 20000); eq(ab.projected, 70000); eq(ab.projectedLevel, 'over');
  });

  // ---- Düzenli ödemeler ----
  var RC = { id: 'r1', name: 'Kira', direction: 'expense', amount: 2000000, category: 'Kira/Konut', freq: 'monthly', everyMonths: 1, day: 31, startYm: '2026-09', endYm: '2027-02', skipped: [], remindDays: 3 };
  test('düzenli ödeme tarihleri: aylık, yıllık, N ayda bir, ay sonu', function () {
    eq(L.occurrence(RC, '2026-08'), null); eq(L.occurrence(RC, '2026-09').date, '2026-09-30'); eq(L.occurrence(RC, '2027-02').date, '2027-02-28'); eq(L.occurrence(RC, '2027-03'), null);
    var y = { freq: 'yearly', day: 15, startYm: '2026-03' }; eq(L.occurrence(y, '2027-03').date, '2027-03-15'); eq(L.occurrence(y, '2027-04'), null);
    var c = { freq: 'custom', everyMonths: 3, day: 1, startYm: '2026-11' }; eq(['2026-11', '2026-12', '2027-01', '2027-02'].map(function (m) { return !!L.occurrence(c, m); }), [true, false, false, true]);
    eq(L.occurrence({ freq: 'monthly', day: 1, startYm: '2026-01', active: false }, '2026-11'), null);
  });
  test('düzenli ödeme durumları ve eşleşme', function () {
    var st2 = { recurring: [clone(RC), { id: 'r2', name: 'Elektrik faturası', direction: 'expense', amount: 95000, category: 'Faturalar', freq: 'monthly', day: 5, startYm: '2026-01', skipped: [] },
      { id: 'r3', name: 'İnternet', direction: 'expense', amount: 45000, category: 'Faturalar', freq: 'monthly', day: 15, startYm: '2026-01', skipped: [] },
      { id: 'r4', name: 'Spor salonu', direction: 'expense', amount: 80000, category: 'Diğer', freq: 'monthly', day: 1, startYm: '2026-01', skipped: ['2026-11'] }],
      transactions: [{ id: 'k', date: '2026-11-02', amount: -2000000, category: 'Kira/Konut', recurringId: 'r1', period: '2026-11', description: 'Kira' },
        { id: 'e', date: '2026-11-06', amount: -96040, category: 'Faturalar', description: 'ENERJISA ELEKTRIK' },
        { id: 'z', date: '2026-11-06', amount: -96040, category: 'Market', description: 'Migros' }] };
    var occ = L.occurrencesForMonth(st2, '2026-11', '2026-11-13'), by = {}; occ.forEach(function (o) { by[o.item.id] = o; });
    eq(by.r1.status, 'paid'); eq(by.r2.status, 'matched'); eq(by.r2.match.id, 'e'); eq(by.r3.status, 'soon'); eq(by.r4.status, 'skipped');
    eq(L.occurrencesForMonth(st2, '2026-11', '2026-11-10').find(function (o) { return o.item.id === 'r3'; }).status, 'later');
    eq(L.occurrencesForMonth(st2, '2026-11', '2026-11-16').find(function (o) { return o.item.id === 'r3'; }).status, 'overdue');
    // %10 toleransın dışı eşleşmez
    eq(L.matchScore(st2.recurring[1], { date: '2026-11-05' }, { date: '2026-11-05', amount: -110000, category: 'Faturalar', description: 'Elektrik' }), -1);
    eq(L.matchScore(st2.recurring[1], { date: '2026-11-05' }, { date: '2026-11-20', amount: -95000, category: 'Faturalar', description: 'Elektrik' }), -1, '7 günden uzak');
    eq(L.matchScore(st2.recurring[1], { date: '2026-11-05' }, { date: '2026-11-05', amount: 95000, category: 'Faturalar', description: 'Elektrik' }), -1, 'yön farklı');
  });
  test('beklenen kayıt oluşturma: eşleşene bağlar, çift sayım yok, tekrar çalıştırınca boş', function () {
    var st2 = { recurring: [{ id: 'r2', name: 'Elektrik faturası', direction: 'expense', amount: 95000, category: 'Faturalar', freq: 'monthly', day: 5, startYm: '2026-01', skipped: [] },
      { id: 'r3', name: 'İnternet', direction: 'expense', amount: 45000, category: 'Faturalar', freq: 'monthly', day: 15, startYm: '2026-01', skipped: [] }],
      transactions: [{ id: 'e', date: '2026-11-06', amount: -96040, category: 'Faturalar', description: 'Elektrik' }] };
    var plan = L.generationPlan(st2, '2026-11', '2026-11-13');
    eq(plan.link.length, 1); eq(plan.link[0].txId, 'e'); eq(plan.create.length, 1); eq(plan.create[0].tx.amount, -45000); eq(plan.create[0].tx.date, '2026-11-15');
    L.applyGeneration(st2, plan, uidT);
    eq(st2.transactions.length, 2); eq(st2.transactions[0].recurringId, 'r2');
    eq(C.monthActuals(st2.transactions, '2026-11').expense, 141040, 'elektrik bir kez sayılır');
    var again = L.generationPlan(st2, '2026-11', '2026-11-13'); eq(again.create.length + again.link.length, 0);
    L.applyGeneration(st2, plan, uidT); eq(st2.transactions.length, 2, 'aynı plan iki kez uygulansa da çift kayıt yok');
  });
  test('içe aktarılan gerçek işlem beklenen kaydın yerine geçer', function () {
    var txs = [{ id: 'g', date: '2026-11-15', amount: -45000, category: 'Faturalar', description: 'İnternet', source: 'düzenli', recurringId: 'r3', period: '2026-11' }];
    var rows = [{ date: '2026-11-16', amount: -45000, description: 'TURK TELEKOM INTERNET', category: 'Faturalar' }, { date: '2026-11-16', amount: -45000, description: 'Kitap', category: 'Eğitim' }];
    L.reconcileImported(rows, txs); eq(rows[0].replaces.id, 'g'); eq(rows[1].replaces, null);
    var rows2 = [{ date: '2026-11-16', amount: -45000, description: 'internet', category: 'Faturalar' }, { date: '2026-11-17', amount: -45000, description: 'internet', category: 'Faturalar' }];
    L.reconcileImported(rows2, txs); eq(rows2.filter(function (r) { return r.replaces; }).length, 1, 'bir beklenen kayıt yalnızca bir kez değiştirilir');
  });
  test('yaklaşan ödemeler ve rozet sayısı', function () {
    var ex = S.exampleState('2026-11', '2026-11-13');
    var up = L.upcoming(ex, '2026-11-13', 30);
    ok(up.length > 0); ok(up.every(function (x, i) { return i === 0 || up[i - 1].date <= x.date; }), 'tarih sıralı');
    ok(up.some(function (x) { return x.kind === 'card' && x.level === 'soon' && x.amount === -748050; }), 'kart son ödeme uyarısı');
    ok(up.some(function (x) { return x.kind === 'recurring' && x.title.indexOf('Müzik') === 0 && x.level === 'soon'; }), 'abonelik hatırlatması');
    ok(!up.some(function (x) { return x.title === 'Kira' && x.period === '2026-11'; }), 'bu ay ödenen kira listede yok');
    ok(up.some(function (x) { return x.title === 'Kira' && x.period === '2026-12' && x.level === 'later'; }), 'gelecek ayın kirası listede');
    ok(!up.some(function (x) { return x.title === 'Elektrik faturası' && x.period === '2026-11'; }), 'eşleşen fatura listede yok');
    ok(L.badgeCount(up) >= 2);
  });

  // ---- Yıllık giderler (kumbara) ----
  test('kumbara: aylık ayırma tam ve kuruşu kuruşuna', function () {
    var f = { amount: 1800000, saved: 900000, dueYm: '2027-04', everyMonths: 12 }, p = L.sinkingPlan(f, '2026-11');
    eq(p.contributions, 5); eq(p.monthlyNeed, 180000); eq(p.remaining, 900000); eq(M.sum(p.parts), 900000); eq(p.progressBp, 5000); eq(p.steadyMonthly, 150000);
    var g = { amount: 1000000, saved: 0, dueYm: '2027-02', everyMonths: 12 }, q = L.sinkingPlan(g, '2026-11'); // 10.000 TL / 3 ay
    eq(q.parts, [333334, 333333, 333333]); eq(M.sum(q.parts), 1000000); eq(q.monthlyNeed, 333334);
    eq(L.sinkingPlan({ amount: 50000, saved: 10000, dueYm: '2026-11', everyMonths: 12 }, '2026-11').monthlyNeed, 40000, 'ödeme ayı geldiyse kalanın tamamı');
    ok(L.sinkingPlan({ amount: 50000, saved: 10000, dueYm: '2026-09', everyMonths: 12 }, '2026-11').overdue);
    var r = L.sinkingPlan({ amount: 50000, saved: 60000, dueYm: '2027-09', everyMonths: 12 }, '2026-11'); ok(r.ready); eq(r.monthlyNeed, 0); eq(r.progressBp, 10000);
  });
  test('kumbara: bu ay ayrılınca aylık ihtiyaç değişmez, "şimdi ayır" sıfırlanır', function () {
    var f = { amount: 1000000, saved: 0, dueYm: '2027-02', everyMonths: 12 }, before = L.sinkingPlan(f, '2026-11');
    f.saved = before.toSetAsideNow; f.setAsideYm = '2026-11'; f.setAsideAmount = before.toSetAsideNow;
    var after = L.sinkingPlan(f, '2026-11'); eq(after.monthlyNeed, before.monthlyNeed); eq(after.toSetAsideNow, 0); ok(after.doneThisMonth);
    var next = L.sinkingPlan(f, '2026-12'); eq(next.monthlyNeed, 333333); eq(M.add(f.saved, M.mulRatio(next.monthlyNeed, 2, 1)), 1000000, 'kalan iki ayda tam kapanır');
  });

  // ---- Aylık karşılaştırma ----
  test('aylık karşılaştırma: aynı dönem, geçen ay, 3 ay ortalaması', function () {
    var txs = [
      { date: '2026-08-05', amount: -30000, category: 'Market' }, { date: '2026-09-05', amount: -60000, category: 'Market' },
      { date: '2026-10-05', amount: -90000, category: 'Market' }, { date: '2026-10-20', amount: -10000, category: 'Market' },
      { date: '2026-11-03', amount: -120000, category: 'Market' }, { date: '2026-11-20', amount: -5000, category: 'Market' },
      { date: '2026-11-04', amount: -1000, category: 'Transfer' }];
    var c = L.compareMonths(txs, '2026-11-13'), m = c.rows[0];
    eq(m.category, 'Market'); eq(m.current, 120000, 'bugünden sonraki işlem sayılmaz'); eq(m.prevSamePeriod, 90000); eq(m.prevFull, 100000);
    eq(m.avg3, 63333); eq(m.diffSame, 30000); eq(m.diffSameBp, 3333); eq(c.total.current, 120000);
    var ins = L.insights(c, function (k) { return M.format(k, { noDecimals: true }); });
    ok(ins.some(function (x) { return /Market harcaman geçen ayın aynı dönemine göre 300 TL arttı/.test(x.text); }));
    ok(ins.some(function (x) { return /ortalamasını/.test(x.text); }));
    eq(L.monthSeries(txs, '2026-11', 4).map(function (x) { return x.expense; }), [30000, 60000, 100000, 125000]);
    eq(L.insights(L.compareMonths([], '2026-11-13'), String)[0].level, 'info');
  });

  // ---- Hesaplar ve net varlık ----
  test('hesaplar: TL karşılığı, kart borcu ve gelecek taksitler net varlıktan düşer', function () {
    var st2 = { rates: { USD: { rate: 4000, date: '2026-11-13' } }, installments: [{ cardId: 'c', total: 300000, count: 3, firstYm: '2026-11' }],
      accounts: [{ id: 'a', type: 'bank', currency: 'TRY', balance: 1000000, emergency: true }, { id: 'u', type: 'cash', currency: 'USD', balance: 10000 },
        { id: 'e', type: 'cash', currency: 'EUR', balance: 10000 }, { id: 'c', type: 'card', currency: 'TRY', balance: -50000, card: { statementDay: 1, dueDay: 10, limit: 0, statementDebt: 0, paid: 0 } }] };
    var s = L.accountsSummary(st2, '2026-11-13');
    eq(s.assetsTL, 1400000); eq(s.cardDebt, 50000); eq(s.futureInstallments, 200000); eq(s.netTL, 1150000); eq(s.missingRates, ['EUR']);
    var eff = L.effectiveState({ assets: [], debts: [], expenses: [], accounts: st2.accounts, rates: st2.rates, installments: st2.installments, sinkingFunds: [] }, '2026-11-13');
    var a = C.assets(eff); eq(a.total, 1400000); eq(a.debts, 250000); eq(a.netWorth, 1150000); eq(a.emergencyEligible, 1000000);
  });
  test('analiz: kumbara ve taksitler aylık plana dahil, plan toplamı korunur', function () {
    var ex = S.exampleState('2026-11', '2026-11-13'), eff = L.effectiveState(ex, '2026-11-13'), an2 = C.analyze(eff, '2026-11');
    var sink = L.sinkingTotals(ex, '2026-11').monthlyNeed;
    eq(sink, 180000 + 60000 + 100000 + 250000);
    ok(eff.expenses.some(function (e) { return e.id === 'auto:sinking' && e.amount === sink; }));
    var inst = L.installmentBurden(ex, '2026-11', 1)[0].total; eq(inst, 350000 + 416667, 'telefon 5/12 + buzdolabı 2/6');
    ok(eff.expenses.some(function (e) { return e.id === 'auto:installments' && e.amount === inst; }));
    eq(an2.budget.expense, M.add(C.budget(ex).expense, sink, inst));
    var p = an2.plan; eq(M.add(p.toEmergency, p.safe, p.medium, p.risky), p.surplus);
    eq(M.add(an2.investTotal, an2.emergency.current), an2.assets.total);
    eq(ex.expenses.filter(function (e) { return e.auto; }).length, 0, 'sanal kalemler asıl veriye yazılmaz');
  });

  // ---- Şema göçü ve doğrulama ----
  test('göç: v1 yedeği eksiksiz yüklenir ve sonuçlar değişmez', function () {
    var v1 = clone(V1), before = C.analyze(clone(V1), '2026-11');
    var m = S.validateState(v1);
    eq(m.schema, 2); eq(m.migratedFrom, 1); eq(m.accounts, []); eq(m.recurring, []); eq(m.rates, {}); eq(m.limits, {});
    eq(m.transactions.length, V1.transactions.length); eq(m.incomes, V1.incomes); eq(m.assets, V1.assets); eq(m.goal, V1.goal);
    var after = C.analyze(L.effectiveState(m, '2026-11-13'), '2026-11');
    eq(after.budget, before.budget); eq(after.assets.netWorth, before.assets.netWorth); eq(after.plan, before.plan);
  });
  test('göç: yeni sürüm ve bozuk sürüm reddedilir', function () {
    var threw = ''; try { var x = clone(V1); x.schema = 3; S.validateState(x); } catch (e) { threw = e.message; } ok(/daha yeni/.test(threw), threw);
    threw = ''; try { var y = clone(V1); delete y.schema; S.validateState(y); } catch (e) { threw = e.message; } ok(/Sürüm/.test(threw), threw);
  });
  test('örnek veri (v2) doğrulamadan geçer ve yedek gidiş-dönüşü aynı', function () {
    var ex = S.exampleState('2026-11', '2026-11-13'), back = S.validateState(JSON.parse(JSON.stringify(ex)));
    eq(back.accounts.length, 6); eq(back.recurring.length, 7); eq(back.installments.length, 2); eq(back.sinkingFunds.length, 4); eq(JSON.stringify(back), JSON.stringify(ex));
    ok(ex.transactions.every(function (t) { return t.date <= '2026-11-13'; }), 'bu ayın örnek işlemleri gelecekte değil');
  });
  test('sıkı doğrulama yeni alanlardaki hataları yakalar', function () {
    var base = S.exampleState('2026-11', '2026-11-13');
    function bad(fn, re) { var s = clone(base); fn(s); var m = ''; try { S.validateState(s); } catch (e) { m = e.message; } ok(re.test(m), 'beklenen hata: ' + re + ' gelen: ' + m); }
    bad(function (s) { s.accounts[0].balance = -1; }, /eksi/);
    bad(function (s) { s.accounts[0].balance = 1.5; }, /bakiye/);
    bad(function (s) { s.accounts[0].currency = 'GBP'; }, /para birimi/);
    bad(function (s) { s.transfers[0].toId = s.transfers[0].fromId; }, /aynı hesaba/);
    bad(function (s) { s.transfers[0].amountTo = 1; }, /eşit olmalı/);
    bad(function (s) { s.installments[0].cardId = 'yok'; }, /kart/);
    bad(function (s) { s.installments[0].count = 0; }, /taksit sayısı/);
    bad(function (s) { s.recurring[0].day = 32; }, /gün/);
    bad(function (s) { s.recurring[0].freq = 'weekly'; }, /sıklık/);
    bad(function (s) { s.transactions[0].recurringId = 'yok'; }, /düzenli ödeme bulunamadı/);
    bad(function (s) { var t = clone(s.transactions[0]); t.id = 'dup'; s.transactions.push(t); }, /iki kez/);
    bad(function (s) { s.sinkingFunds[0].dueYm = '2026-13'; }, /ödeme ayı/);
    bad(function (s) { s.rates.USD.rate = -5; }, /Kur USD/);
    bad(function (s) { s.limits.Market = -100; }, /Sınır/);
    bad(function (s) { s.accounts[5].card.dueDay = 0; }, /son ödeme/);
  });

  var passed = results.filter(function (r) { return r.ok; }).length;
  if (isNode) {
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' test geçti');
    if (passed !== results.length) process.exit(1);
  } else { root.TEST_RESULTS = results; }
})(typeof self !== 'undefined' ? self : this);
