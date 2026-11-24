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

  test('fiş: gerçek BİM düzeni — KDV tablosu ve miktar satırı kalem sayılmaz', function () {
    var txt = 'BIM BIRLESIK MAGAZALAR A.S.\nABDURRAHMANGAZI MAH. SAMANDIRA\nV.D. BUYUK MUKELLEFLER 1750051846\nTARIH : 12.11.2026 SAAT : 18:42\nFIS NO : 0087\n' +
      'SUT 1 LT %1 *34,50\nEKMEK %1 *12,50\nDOMATES KG %1 *48,75\n2 AD X 22,50\nYUMURTA 10LU %1 *45,00\nDETERJAN 4 KG %20 *189,90\nPEYNIR BEYAZ %1 *129,95\n' +
      'TOPKDV *33,29\nTOPLAM *460,60\nKREDI KARTI *460,60\nKDV ORANI MATRAH KDV\n%1 267,03 2,67\n%20 158,25 31,65\nZ NO:1234 EKU NO:0001\nMERSIS NO:0175005184600014';
    var r = P.parseReceiptText(txt);
    eq(r.merchant, 'BİM'); eq(r.category, 'Market'); eq(r.date, '2026-11-12'); eq(r.docTotal, 46060);
    eq(r.rows.map(function (x) { return x.description; }), ['SUT 1 LT', 'EKMEK', 'DOMATES KG', 'YUMURTA 10LU', 'DETERJAN 4 KG', 'PEYNIR BEYAZ']);
    eq(r.itemsSum, 46060); ok(r.matches);
    r.rows.forEach(function (x) { ok(x.category === 'Market'); ok(x.date === '2026-11-12'); });
  });
  test('fiş: A101/Migros, nokta ondalık, eksik virgül, indirim satırı, GENEL TOPLAM', function () {
    var r = P.parseReceiptText('MIGROS TICARET A.S.\n13/11/26 20:15\nMUZ YERLI %1 *59.90\nCIKOLATA %10 *42 50\nARA TOPLAM *102,40\nINDIRIM -10,00\nGENEL TOPLAM *92,40\nBANKA KARTI *92,40');
    eq(r.merchant, 'Migros'); eq(r.date, '2026-11-13'); eq(r.docTotal, 9240);
    eq(r.rows.map(function (x) { return x.amount; }), [-5990, -4250, 1000]);
    r.rows.forEach(function (x) { x.include = true; }); ok(P.totalsCheck(r.rows, r.docTotal).match, 'indirim sonrası toplam tutar');
    var a = P.parseReceiptText('A101 YENI MAGAZACILIK A.S.\nTARIH:01-10-2026\nSU 5 LT %1 *25,00\nT0PLAM *25,00');
    eq(a.merchant, 'A101'); eq(a.date, '2026-10-01'); eq(a.docTotal, 2500); eq(a.rows.length, 1);
  });
  test('fiş: OCR gürültüsü, TOPLAM önce, yıldızsız satır notu, tarih ortada', function () {
    var r = P.parseReceiptText('ŞOK MARKETLER T.A.Ş.\nFIS NO 12  12 . 11 . 2026\nPEYNIR ¥1 *89,90\nZEYTIN 64,50\nTOPLAM *154,40\nNAKIT *200,00\nPARA USTU *45,60');
    eq(r.merchant, 'ŞOK'); eq(r.date, '2026-11-12'); eq(r.docTotal, 15440); eq(r.rows.length, 2);
    ok(/yıldızsız/.test(r.rows[1].note)); ok(r.matches);
    eq(P.parseReceiptText('BIM\nSUT 1 LT & *34,50\nPEYNIR %1 | *10,00\nTOPLAM *44,50').rows.map(function (x) { return x.description; }), ['SUT 1 LT', 'PEYNIR']);
  });
  test('fiş: hiçbir şey okunamazsa yine düzenlenebilir satır', function () {
    var r = P.parseReceiptText('~~ ## bulanik ~~\n....');
    eq(r.rows.length, 0); eq(r.docTotal, null);
    var fb = P.receiptFallbackRows(r, '2026-11-14');
    eq(fb.length, 1); eq(fb[0].date, '2026-11-14'); eq(fb[0].amount, null); ok(fb[0].manual);
    var r2 = P.parseReceiptText('KAFE ORNEK\n14.11.2026\nTOPLAM 85,00');
    var fb2 = P.receiptFallbackRows(r2, '2026-11-14'); eq(fb2[0].amount, -8500); eq(fb2[0].description, 'KAFE ORNEK alışverişi');
    eq(P.parseReceiptText('').rows.length, 0); eq(P.parseReceiptText(null).rows.length, 0);
  });

  test('onay toplamı satırlardan hesaplanır, belge toplamı kopyalanmaz', function () {
    var rows = [{ include: true, amount: -750 }, { include: true, amount: -3250 }, { include: true, amount: -1750 }];
    var tc = P.totalsCheck(rows, 5750);
    eq(tc.computed, 5750); eq(tc.rowSum, -5750); eq(tc.count, 3); ok(tc.match); eq(tc.diff, 0);
    var tcCopy = P.totalsCheck(rows, 99999);
    eq(tcCopy.computed, 5750, 'belge toplamı değişince satır toplamı değişmez'); eq(tcCopy.rowSum, -5750); ok(!tcCopy.match);
    eq(tcCopy.diff, 5750 - 99999);
    rows[0].include = false;
    var tcOff = P.totalsCheck(rows, 5750);
    eq(tcOff.computed, 5000); eq(tcOff.count, 2); ok(!tcOff.match); eq(tcOff.diff, 5000 - 5750);
    var empty = P.totalsCheck([], 5750);
    eq(empty.computed, 0); eq(empty.rowSum, 0); eq(empty.count, 0); ok(!empty.match);
    var noDoc = P.totalsCheck([{ include: true, amount: -1000 }, { include: true, amount: -500 }], null);
    eq(noDoc.computed, 1500); eq(noDoc.rowSum, -1500); ok(noDoc.docTotal == null);
    var skip = P.totalsCheck([{ include: true, amount: -1000 }, { include: false, amount: -500 }, { include: true, amount: null }, { include: true, amount: -250 }], 1250);
    eq(skip.computed, 1250); eq(skip.count, 2); ok(skip.match);
    // seçim veya tutar değişince canlı güncellenir
    var live = [{ include: true, amount: -2000 }, { include: true, amount: -3000 }];
    eq(P.totalsCheck(live, 5000).computed, 5000);
    live[1].amount = -3500;
    var afterEdit = P.totalsCheck(live, 5000);
    eq(afterEdit.computed, 5500); ok(!afterEdit.match); eq(afterEdit.diff, 500);
  });

  test('yedek tek satır fişteki TOPLAM’dan işaretlenir, toplam yine satırdan gelir', function () {
    var rec = P.parseReceiptText('KAFE ORNEK\n14.11.2026\nTOPLAM 85,00');
    var fb = P.receiptFallbackRows(rec, '2026-11-14');
    eq(fb.length, 1); eq(fb[0].amount, -8500); ok(fb[0].fromDocTotal);
    ok(/TOPLAM/.test(fb[0].note) && /kalem/.test(fb[0].note));
    var tc = P.totalsCheck([{ include: true, amount: fb[0].amount, fromDocTotal: true }], rec.docTotal);
    eq(tc.computed, 8500); eq(tc.rowSum, -8500); eq(tc.fromDocTotal, 1); ok(tc.match);
    // satır tutarı değişince computed belge toplamına yapışmaz
    var edited = [{ include: true, amount: -8000, fromDocTotal: false }];
    var tc2 = P.totalsCheck(edited, rec.docTotal);
    eq(tc2.computed, 8000); eq(tc2.fromDocTotal, 0); ok(!tc2.match); eq(tc2.diff, 8000 - 8500);
    var blank = P.receiptFallbackRows(P.parseReceiptText('~~ bulanik ~~'), '2026-11-14');
    ok(!blank[0].fromDocTotal); eq(blank[0].amount, null);
  });

  test('karışık gelir-gider onayında fark net üzerindendir', function () {
    var rows = [{ include: true, amount: -631588 }, { include: true, amount: 300000 }];
    var tc = P.totalsCheck(rows, 331588);
    eq(tc.computed, 331588); eq(tc.rowSum, -331588); eq(tc.expense, 631588); eq(tc.income, 300000);
    ok(tc.match && tc.byNet); eq(tc.diff, 0);
    var tcb = P.totalsCheck(rows, 331500);
    ok(!tcb.match); eq(tcb.computed, 331588, 'uyuşmasa da computed satır toplamıdır'); eq(tcb.diff, 88);
    var onlyInc = P.totalsCheck([{ include: true, amount: 10000 }], 10000);
    eq(onlyInc.computed, 10000); ok(onlyInc.match);
    // gider toplamı belgeyle tutuyor, net tutmuyorsa gösterilen computed giderlerdir (yanıltıcı net değil)
    var charges = [{ include: true, amount: -34990 }, { include: true, amount: -119900 }, { include: true, amount: -24550 }, { include: true, amount: 200000 }, { include: true, amount: -5999 }];
    var tcc = P.totalsCheck(charges, 185439);
    eq(tcc.expense, 185439); eq(tcc.net, 14561); eq(tcc.computed, 185439); ok(tcc.match && !tcc.byNet && !tcc.computedIsNet);
    var tcm = P.totalsCheck(charges, 99999);
    eq(tcm.computed, 185439, 'uyuşmasa da computed satırlardan'); ok(!tcm.match); eq(tcm.diff, 185439 - 99999);
  });


  test('fiş: gölgede iki sütun okunan fiş satır satır eşleşir, tire işaret sayılmaz', function () {
    var txt = 'BIM BIRLESIİK MAĞAZALAR A.S.\nTARIH : 12.11.2026 SAAT : 18:42\nFIS NO : 0087\nSUT 1LT S1 — *34,50\nEKMEK S1 —*12,50\nDOMATES KG S1 — *48,75\n2 AD X 22,50\n\nYUMURTA 10LU\nDETERJAN 4 KG\nPEYNIR BEYAZ\n\nS1 — *45,00\n820 *189,90\nS1 ( *129,95\n\nTOPKDV\nTOPLAM\nKREDİ KARTI\n\nE33,29\n*460,60\n*460,60\n\nKDV ORANI MATRAH\n&1 267,03\n20 158,25';
    var r = P.parseReceiptText(txt);
    eq(r.docTotal, 46060); eq(r.rows.length, 6); ok(r.rows.every(function (x) { return x.amount < 0; }), 'hepsi gider'); ok(r.matches, 'toplam tutar');
    eq(r.rows.map(function (x) { return x.description; }), ['SUT 1LT', 'EKMEK', 'DOMATES KG', 'YUMURTA 10LU', 'DETERJAN 4 KG', 'PEYNIR BEYAZ']); eq(r.rows[5].amount, -12995);
    eq(P.parseReceiptText('BIM\nEKMEK 5 *1,00\nSUT 5 *2,00\nPEYNIR 5 *3,00\nTOPLAM *6,00').rows.map(function (x) { return x.description; }), ['EKMEK', 'SUT', 'PEYNIR']);
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
    eq(m.schema, S.SCHEMA_VERSION); eq(m._sync, { stamps: {}, tomb: {} }); eq(m.settings.backupReminderDays, 7); eq(m.migratedFrom, 1); eq(m.trades, []); eq(m.goals.length, 1); eq(m.goals[0].shareBp, 10000); eq(m.accounts, []); eq(m.recurring, []); eq(m.rates, {}); eq(m.limits, {});
    eq(m.transactions.length, V1.transactions.length); eq(m.incomes, V1.incomes); eq(m.assets, V1.assets); eq(m.goal, V1.goal);
    var after = C.analyze(L.effectiveState(m, '2026-11-13'), '2026-11');
    eq(after.budget, before.budget); eq(after.assets.netWorth, before.assets.netWorth); eq(after.plan, before.plan);
  });
  test('göç: yeni sürüm ve bozuk sürüm reddedilir', function () {
    var threw = ''; try { var x = clone(V1); x.schema = S.SCHEMA_VERSION + 1; S.validateState(x); } catch (e) { threw = e.message; } ok(/daha yeni/.test(threw), threw);
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

  // ================= v3: Portföy yönetimi =================
  var PF = isNode ? require('../js/portfolio.js') : root.Portfolio;
  var PR = isNode ? require('../js/prices.js') : root.Prices;
  var Q = PF.QS, PP = PF.PS;
  function near(a, b, tol, msg) { if (a == null || Math.abs(a - b) > tol) throw new Error((msg || '') + ' beklenen ≈' + b + ', gelen ' + a); }
  function tr(id, asset, date, side, qty, price, fee, cur, fx) { var t = { id: id, assetId: asset, date: date, side: side, qty: qty, price: price, fee: fee || 0, currency: cur || 'TRY', note: '' }; if (fx) t.fxRate = fx; return t; }

  test('parseScaled adet/fiyat (TR/EN, binlik, yuvarlama)', function () {
    eq(PF.parseScaled('1,5', 8), 150000000); eq(PF.parseScaled('0,00012345', 8), 12345); eq(PF.parseScaled('1.234,5678', 6), 1234567800);
    eq(PF.parseScaled('1,234.56', 6), 1234560000); eq(PF.parseScaled('1.234', 6), 1234000000); eq(PF.parseScaled('0.125', 6), 125000);
    eq(PF.parseScaled('2,1234567', 6), 2123457); eq(PF.parseScaled('10 adet', 8), 10 * Q); eq(PF.parseScaled(50.368, 6), 50368000);
    eq(PF.parseScaled('abc', 6), null); eq(PF.parseScaled('1,2,3', 6), null); eq(PF.parseScaled('', 6), null); eq(PF.parseScaled('-3', 8), -3 * Q);
  });
  test('valueMinor ve qtyForAmount kesin', function () {
    eq(PF.valueMinor(10 * Q, 145200000), 145200); eq(PF.valueMinor(Q / 3 | 0, 3 * PP), 100); eq(PF.valueMinor(12345, 3000000000000), 37035);
    eq(PF.qtyForAmount(100000, 300 * PP, true), 333333333); ok(PF.valueMinor(PF.qtyForAmount(100000, 300 * PP, true), 300 * PP) <= 100000, 'aşağı yuvarlama tutarı aşmaz');
    eq(PF.formatScaled(123456789, 8), '1,23456789'); eq(PF.fmtQty(15 * Q), '15'); eq(PF.fmtPrice(3180000), '3,18'); eq(PF.fmtPrice(5400 * PP), '5.400,00');
  });
  test('ağırlıklı ortalama maliyet, gerçekleşen kâr, komisyon', function () {
    var lg = PF.ledger([tr('1', 'a', '2026-01-02', 'buy', 10 * Q, 100 * PP, 1000), tr('2', 'a', '2026-02-02', 'buy', 10 * Q, 120 * PP, 0), tr('3', 'a', '2026-03-02', 'sell', 5 * Q, 130 * PP, 500)]);
    eq(lg.units, 15 * Q); eq(lg.costTL, 165750); eq(lg.realizedTL, 9250); eq(lg.feesTL, 1500); eq(lg.boughtTL, 221000); eq(lg.soldTL, 64500); eq(lg.avgPrice, 110500000); eq(lg.errors, []);
  });
  test('aynı gün önce alış; fazla satış hata', function () {
    var lg = PF.ledger([tr('2', 'a', '2026-01-02', 'sell', 5 * Q, 10 * PP), tr('1', 'a', '2026-01-02', 'buy', 5 * Q, 9 * PP)]);
    eq(lg.errors, []); eq(lg.units, 0); eq(lg.realizedTL, 500); eq(lg.costTL, 0);
    var bad = PF.ledger([tr('1', 'a', '2026-01-02', 'buy', 5 * Q, 9 * PP), tr('2', 'a', '2026-01-03', 'sell', 6 * Q, 10 * PP)]); eq(bad.errors.length, 1);
  });
  test('döviz işlem: TL maliyet işlem günü kuruyla, gerçekleşen kâr kur farkı dahil', function () {
    var lg = PF.ledger([tr('1', 'u', '2026-01-02', 'buy', 2 * Q, 50 * PP, 0, 'USD', 4000), tr('2', 'u', '2026-06-02', 'sell', 1 * Q, 50 * PP, 0, 'USD', 4500)]);
    eq(lg.costNative, 5000); eq(lg.costTL, 200000); eq(lg.realizedNative, 0); eq(lg.realizedTL, 25000);
  });
  test('pozisyon: piyasa değeri, gerçekleşmemiş kâr, kur yoksa maliyete düşer', function () {
    var s = S.emptyState(); s.rates = { USD: { rate: 5000, date: '2026-11-10' } };
    s.assets = [{ id: 'x', name: 'X', cls: 'halal_etf', risk: 'risky', emergency: false, value: 0, tracking: 'trades', currency: 'USD', lot: 'whole', priceKey: 'td:X', halal: { status: 'uygun' } }];
    s.trades = [tr('1', 'x', '2026-01-02', 'buy', 10 * Q, 20 * PP, 100, 'USD', 4000)];
    PF.addPricePoint(s.prices, 'td:X', 'USD', { d: '2026-11-10', p: 25 * PP, src: 'test' });
    var p = PF.position(s, s.assets[0], '2026-11-13'); eq(p.mvNative, 25000); eq(p.mvTL, 1250000); eq(p.ledger.costTL, 804000); eq(p.unrealizedTL, 446000);
    PF.sync(s, '2026-11-13'); eq(s.assets[0].value, 1250000); eq(s.assets[0].valueBasis, 'market');
    delete s.rates.USD; PF.sync(s, '2026-11-13'); eq(s.assets[0].value, 804000); eq(s.assets[0].valueBasis, 'cost');
  });
  test('XIRR bilinen değerler', function () {
    near(PF.xirr([{ date: '2025-01-01', amount: -100000 }, { date: '2026-01-01', amount: 110000 }]), 0.10, 1e-9);
    var r2 = PF.xirr([{ date: '2024-01-01', amount: -100000 }, { date: '2025-01-01', amount: -100000 }, { date: '2026-01-01', amount: 230000 }]); near(-100000 * Math.pow(1 + r2, 731 / 365) - 100000 * (1 + r2) + 230000, 0, 1e-6, 'NPV sıfır'); near(r2, 0.0968, 0.0001);
    eq(PF.xirr([{ date: '2025-01-01', amount: -100 }]), null); eq(PF.xirr([{ date: '2025-01-01', amount: 100 }, { date: '2025-02-01', amount: 100 }]), null);
  });
  test('TWR: akışlardan bağımsız, yıllıklandırma 365 gün üstü', function () {
    var t = PF.twr([{ date: '2025-01-01', value: 1000, flow: 1000 }, { date: '2025-06-01', value: 1100, flow: 0 }, { date: '2025-07-01', value: 2200, flow: 1000 }, { date: '2025-12-31', value: 2310, flow: 0 }]);
    near(t.period, 0.26, 1e-12); eq(t.annualized, null); eq(t.periods, 3);
    var t2 = PF.twr([{ date: '2024-01-01', value: 100, flow: 100 }, { date: '2026-01-01', value: 121, flow: 0 }]); near(t2.annualized, 0.0997, 0.0005);
  });
  test('Enflasyon çarpanı: tam aylar, aradaki boşluk, son ay eksik', function () {
    var cpi = [{ ym: '2026-01', bp: 300 }, { ym: '2026-02', bp: 200 }];
    near(PF.inflationFactor(cpi, '2025-12-31', '2026-02-28').factor, 1.03 * 1.02, 1e-12);
    var p = PF.inflationFactor(cpi, '2025-12-31', '2026-03-31'); near(p.factor, 1.0506, 1e-9); ok(p.partial); eq(p.missing, ['2026-03']);
    eq(PF.inflationFactor([{ ym: '2026-02', bp: 200 }, { ym: '2026-03', bp: 100 }], '2025-12-31', '2026-03-31').factor, null);
    near(PF.realReturn(0.5, 1.5), 0, 1e-12);
  });
  test('Kıyas simülasyonu: aynı paralar aynı günlerde', function () {
    var pts = [{ d: '2026-01-01', p: 100 * PP }, { d: '2026-06-01', p: 50 * PP }, { d: '2026-11-01', p: 110 * PP }];
    var r = PF.simulateBenchmark([{ date: '2026-01-01', amount: 100000 }, { date: '2026-06-01', amount: 100000 }, { date: '2026-06-20', amount: -50000 }], pts, '2026-11-10');
    eq(r.ok, true); eq(r.units, 2000000000); eq(r.finalTL, 220000); ok(r.approx, '7 günden eski fiyat → yaklaşık');
    eq(PF.simulateBenchmark([{ date: '2025-01-01', amount: 1000 }], pts, '2026-11-10').ok, false);
  });
  test('Süzülme yolu profilleri her satırda %100', function () {
    Object.keys(PF.GLIDES).forEach(function (k) { PF.GLIDES[k].path.forEach(function (r) { eq(r[1] + r[2] + r[3], 10000, k); }); [0, 6, 24, 48, 120].forEach(function (m) { var a = C.targetAllocation(m, PF.GLIDES[k].path); eq(a.safe + a.medium + a.risky, 10000, k + ' ' + m); }); });
    eq(C.targetAllocation(36), C.targetAllocation(36, PF.GLIDES.standard.path));
  });
  function exampleAn() { var ex = S.exampleState('2026-11', '2026-11-13'), eff = L.effectiveState(ex, '2026-11-13'), an = C.analyze(eff, '2026-11'); return { ex: ex, eff: eff, an: an }; }
  test('Çoklu hedef raporu: paylar toplamı korur, hedef dağılımı %100', function () {
    var x = exampleAn(), r = PF.goalsReport(x.eff, x.an);
    eq(r.goals.length, 3); eq(M.sum(r.goals.map(function (g) { return g.fromPool; })) + r.unallocated, r.unassigned);
    eq(M.sum(r.goals.map(function (g) { return g.monthly; })) + r.unallocatedMonthly, x.an.plan.surplus);
    var t = r.combinedTarget; eq(t.safe + t.medium + t.risky, 10000);
    ok(r.goals[0].assigned === 0 && r.goals[2].assigned > 0, 'atanmış varlık emeklilik hedefinde');
  });
  test('Tek hedef (eski düzen): patchAnalysis hiçbir şeyi değiştirmez', function () {
    var x = exampleAn(); x.eff.goals = [{ id: 'g', name: 'Ev', target: 150000000, targetYm: '2031-11', glide: 'standard', shareBp: 10000 }]; x.eff.assets.forEach(function (a) { delete a.goalId; });
    var an = C.analyze(x.eff, '2026-11'), before = JSON.stringify(an); ok(PF.legacyEquivalent(x.eff));
    PF.patchAnalysis(an, x.eff, PF.goalsReport(x.eff, an)); eq(JSON.stringify(an), before);
  });
  function pos(id, tier, v, halal, priceTL, lot) { return { id: id, name: id, tier: tier, valueTL: v, isAccount: false, asset: { id: id }, halal: halal || 'uygun', withinBp: null, priceTL: priceTL || null, price: priceTL ? { p: priceTL } : null, lot: lot || 'fraction', currency: 'TRY', fx: 100 }; }
  test('Dengeleme: önce yeni para, tam lot, artan nakit', function () {
    var r = PF.rebalance([pos('A', 'safe', 60000), pos('B', 'risky', 40000, 'uygun', 3 * PP, 'whole')], { safe: 5000, medium: 0, risky: 5000 }, 20000);
    eq(r.buys.length, 1); eq(r.buys[0].pos.id, 'B'); eq(r.buys[0].buyTL, 20000); eq(r.buys[0].units, 66 * Q); eq(r.buys[0].cashLeft, 200); eq(r.leftoverCash, 200);
    eq(M.sum(r.rows.map(function (x) { return x.buyTL; })), 20000);
  });
  test('Dengeleme: satış emri yok, fazla "gözden geçir"', function () {
    var r = PF.rebalance([pos('A', 'safe', 80000), pos('B', 'risky', 20000)], { safe: 5000, medium: 0, risky: 5000 }, 0);
    eq(r.buys.length, 0); eq(r.reviews.length, 1); eq(r.reviews[0].pos.id, 'A'); eq(r.reviews[0].excess, 30000); ok(r.needsRebalance);
  });
  test('Dengeleme: helal olmayan alınmaz, hedefi 0; şüpheli de; etiketsiz sabit', function () {
    var r = PF.rebalance([pos('A', 'risky', 10000, 'uygun'), pos('X', 'risky', 10000, 'uygun_degil'), pos('Y', 'risky', 5000, 'supheli'), pos('U', 'risky', 5000, 'bilinmiyor')], { safe: 0, medium: 0, risky: 10000 }, 10000);
    var by = {}; r.rows.forEach(function (x) { by[x.pos.id] = x; });
    eq(by.X.buyTL, 0); eq(by.X.target, 0); ok(by.X.review); eq(by.X.reason, 'Helal uygun değil'); eq(by.Y.buyTL, 0); ok(by.Y.review); eq(by.U.buyTL, 0); eq(by.U.target, 5000); eq(by.A.buyTL, 10000);
  });
  test('Dengeleme: acil fon eksikse riskli alım yok; kademe boşsa genel helal öneri', function () {
    var r = PF.rebalance([pos('A', 'safe', 10000), pos('B', 'risky', 0)], { safe: 5000, medium: 0, risky: 5000 }, 10000, { blockRisky: true });
    ok(r.rows.every(function (x) { return x.pos.tier !== 'risky' || x.buyTL === 0; })); ok(r.notes.length >= 1);
    var g = PF.rebalance([pos('A', 'safe', 10000)], { safe: 5000, medium: 5000, risky: 0 }, 10000);
    var gen = g.buys.filter(function (x) { return x.pos.generic; }); eq(gen.length, 1); eq(gen[0].pos.tier, 'medium'); eq(gen[0].buyTL, 10000);
  });
  test('Risk kuralları: tek varlık, riskli sınır, çeşitlendirme, helal', function () {
    var an = { emergency: { shortfall: 0, months: 6 } };
    var r = PF.riskReport({ settings: {} }, an, [pos('A', 'risky', 80000), pos('B', 'safe', 10000, 'uygun_degil'), pos('C', 'safe', 10000)]);
    var by = {}; r.items.forEach(function (i) { by[i.id] = i; });
    eq(by.maxAsset.level, 'danger'); eq(by.maxRisky.level, 'warn'); eq(by.maxRisky.valueBp, 8000); eq(by.concentration.level, 'warn'); eq(by.halal.level, 'danger'); eq(by.emergency.level, 'ok'); eq(r.worst, 'danger');
    var r2 = PF.riskReport({ settings: { riskRules: { maxAssetBp: 9000, maxRiskyBp: 9000 } } }, { emergency: { shortfall: 500, months: 1 } }, [pos('A', 'risky', 80000), pos('C', 'safe', 20000)]);
    eq(r2.items[0].level, 'warn'); eq(r2.items[1].level, 'ok');
  });
  test('Fiyat kontrolü: sıçrama onayı, gelecek tarih, eskime', function () {
    var old = { d: '2026-11-10', p: 100 * PP };
    eq(PF.checkPrice(105 * PP, old, 'fund', '2026-11-11', '2026-11-13').needsConfirm, false);
    var j = PF.checkPrice(130 * PP, old, 'fund', '2026-11-11', '2026-11-13'); ok(j.needsConfirm); eq(j.jumpBp, 3000);
    eq(PF.checkPrice(130 * PP, old, 'crypto', '2026-11-11', '2026-11-13').needsConfirm, true); eq(PF.checkPrice(120 * PP, old, 'crypto', '2026-11-11', '2026-11-13').needsConfirm, false);
    eq(PF.checkPrice(100 * PP, old, 'fund', '2026-11-20', '2026-11-13').valid, false); eq(PF.checkPrice(0, old, 'fund').valid, false);
    ok(PF.checkPrice(101 * PP, old, 'fund', '2026-11-01', '2026-11-13').needsConfirm, 'eski tarihli');
    eq(PF.staleness({ d: '2026-11-12', p: 1 }, 'crypto', '2026-11-13').level, 'ok'); eq(PF.staleness({ d: '2026-11-09', p: 1 }, 'crypto', '2026-11-13').level, 'warn');
    eq(PF.staleness({ d: '2026-10-01', p: 1 }, 'fx', '2026-11-13').level, 'old'); eq(PF.staleness(null, 'fx', '2026-11-13').level, 'none');
  });
  test('Ons → gram altın ve çapraz kontrol', function () {
    var g = PF.gramFromOunce(3887600098, 50368000); near(g / PP, 3887.600098 * 50.368 / 31.1034768, 0.000001);
    eq(PF.crossCheck(6279530000, g, 200).ok, true); eq(PF.crossCheck(100, 110, 150).ok, false);
  });
  test('Fiyat geçmişi: tarih başına tek nokta, sıralı, priceAt', function () {
    var pr = {}; PF.addPricePoint(pr, 'fx:USD', 'TRY', { d: '2026-02-01', p: 2 }); PF.addPricePoint(pr, 'fx:USD', 'TRY', { d: '2026-01-01', p: 1 }); PF.addPricePoint(pr, 'fx:USD', 'TRY', { d: '2026-02-01', p: 3 });
    eq(pr['fx:USD'].points.map(function (x) { return x.p; }), [1, 3]); eq(PF.priceAt(pr['fx:USD'].points, '2026-01-15').p, 1); eq(PF.priceAt(pr['fx:USD'].points, '2025-12-01'), null);
  });
  test('Örnek portföy tutarlı: hesaplar kuruşu kuruşuna, getiri raporu hesaplanır', function () {
    var x = exampleAn(), sm = PF.summary(x.ex, '2026-11-13');
    sm.rows.forEach(function (r) { eq(r.ledger.errors, []); eq(r.asset.value, r.mvTL); });
    eq(sm.totalPLTL, M.add(sm.unrealizedTL, sm.realizedTL));
    var rr = PF.returnsReport(x.ex, '2026-11-13'); ok(rr.twr && rr.xirr != null && rr.inflation.partial); ok(rr.benchmarks.every(function (b) { return b.sim.ok; }), 'kıyaslar hesaplanır');
    var p = PF.positions(x.ex, x.eff, x.an, '2026-11-13'); eq(M.sum(p.map(function (q) { return q.valueTL; })), M.sub(x.an.assets.total, x.an.emergency.current));
  });
  test('Örnek portföy dolu ve tutarlı: 3 hedef, zengin geçmiş, getiri bugünkü değer eşleşir, uyarı ve sapma var', function () {
    var x = exampleAn(), ex = x.ex, sm = PF.summary(ex, '2026-11-13'), rr = PF.returnsReport(ex, '2026-11-13');
    eq(ex.exampleRevision, S.EXAMPLE_REVISION);
    eq(ex.goals.length, 3);
    eq(ex.goals.map(function (g) { return g.name; }).join(','), 'Ev peşinatı,Araba peşinatı,Emeklilik');
    eq(M.sum(ex.goals.map(function (g) { return g.shareBp; })), 10000);
    ok(ex.assets.length >= 10 && ex.assets.length <= 12, '10–12 varlık, gelen: ' + ex.assets.length);
    ok(ex.trades.length >= 24, '12–18 aylık geçmiş, işlem sayısı: ' + ex.trades.length);
    ok(ex.trades.filter(function (t) { return t.side === 'sell'; }).length >= 2);
    ok(ex.trades.some(function (t) { return t.fee > 0; }));
    ok(ex.trades.every(function (t) { return t.source === 'örnek' && t.date <= '2026-11-13' && t.date >= '2025-05-01'; }));
    var syms = ex.assets.map(function (a) { return a.symbol; });
    ['KTV', 'KTN', 'ALTIN', 'GUMUS', 'ASELS', 'EREGL', 'SPUS', 'HLAL', 'BTC', 'ETH'].forEach(function (s) { ok(syms.indexOf(s) >= 0, s); });
    sm.rows.forEach(function (r) {
      eq(r.ledger.errors, []);
      eq(r.asset.value, r.mvTL);
      ok(r.price && /ÖRNEK/.test(r.price.src), r.asset.name + ' fiyat kaynağı ÖRNEK');
      ok(r.price.at && /\+03:00$/.test(r.price.at), r.asset.name + ' saat damgası');
    });
    ok(sm.realizedTL > 0, 'satışlardan gerçekleşen kâr');
    eq(rr.valueNow, sm.mvTL, 'getiri bugünkü değer = alım-satımlı portföy toplamı');
    ok(rr.twr && rr.xirr != null && rr.realTwr != null && rr.inflation.partial);
    ok(rr.benchmarks.every(function (b) { return b.sim.ok; }), 'altın/dolar/BIST kıyasları');
    var pos = PF.positions(ex, x.eff, x.an, '2026-11-13');
    var risk = PF.riskReport(ex, x.an, pos);
    var warns = risk.items.filter(function (i) { return i.level === 'warn' || i.level === 'danger'; });
    ok(warns.length >= 1 && warns.length <= 2, '1–2 tetiklenen uyarı, gelen: ' + warns.map(function (w) { return w.id + ':' + w.level; }).join(','));
    ok(warns.some(function (w) { return w.id === 'halal'; }) && warns.some(function (w) { return w.id === 'emergency'; }));
    var tgt = PF.goalsReport(x.eff, x.an).combinedTarget;
    var rb = PF.rebalance(pos, tgt, 0, { tierBandBp: 500, assetBandBp: 300 });
    ok(rb.needsRebalance, 'hedeften sapma var, dengeleme önerisi çıkar');
    ok(S.shouldRefreshExample({ isExample: true, schema: 3, exampleRevision: 1 }));
    ok(!S.shouldRefreshExample({ isExample: true, schema: 3, exampleRevision: S.EXAMPLE_REVISION }));
    ok(!S.shouldRefreshExample({ isExample: false, schema: 3, exampleRevision: 1 }), 'gerçek veri yenilenmez');
    ok(!S.shouldRefreshExample({ isExample: true, schema: 2 }), 'v2 göç kaydı otomatik yenilenmez');
  });
  test('Göç v2 → v3: kurlardan fiyat noktası, varsayılan hedef, eski veri korunur', function () {
    var v2 = S.exampleState('2026-11', '2026-11-13'); v2.schema = 2; delete v2.trades; delete v2.prices; delete v2.cpi; delete v2.goals; v2.assets = v2.assets.filter(function (a) { return a.tracking !== 'trades'; }).map(function (a) { return { id: a.id, name: a.name, cls: a.cls === 'crypto' ? 'other' : a.cls, risk: a.risk, emergency: a.emergency, value: a.value }; }); v2.accounts.forEach(function (a) { delete a.halal; }); delete v2.settings.riskRules; delete v2.settings.rebalance;
    var m = S.validateState(S.migrate(clone(v2)));
    eq(m.schema, S.SCHEMA_VERSION); eq(m.migratedFrom, 2); eq(m.goals.length, 1); eq(m.goals[0].target, v2.goal.target); eq(m.trades, []); eq(m.cpi, []);
    eq(m.prices['fx:USD'].points[0].p, v2.rates.USD.rate * 10000); eq(m.assets.length, v2.assets.length); eq(m.settings.riskRules.maxAssetBp, 3000);
  });
  test('v3 doğrulaması: işlem, hedef, fiyat alanlarındaki hataları yakalar', function () {
    var base = S.exampleState('2026-11', '2026-11-13');
    function bad(fn, re) { var s = clone(base); fn(s); var m = ''; try { S.validateState(s); } catch (e) { m = e.message; } ok(re.test(m), 'beklenen hata: ' + re + ' gelen: ' + m); }
    bad(function (s) { s.trades[0].assetId = 'yok'; }, /varlık/i);
    bad(function (s) { s.trades[0].qty = 1.5; }, /adet/i);
    bad(function (s) { s.trades.push(tr('zz', s.trades[0].assetId, '2026-11-12', 'sell', 1e6 * Q, PP)); }, /fazla/);
    bad(function (s) { s.goals[1].shareBp = 9000; }, /pay/i);
    bad(function (s) { s.goals[1].glide = 'uçuk'; }, /profil|süzülme/i);
    bad(function (s) { s.prices['fx:USD'].points.push({ d: '2020-01-01', p: 1, src: 'x' }); }, /sıra/i);
    bad(function (s) { s.assets[0].halal.status = 'belki'; }, /helal/i);
    var ok2 = clone(base); S.validateState(ok2);
  });
  test('Aracı kurum tablosu: sütun tanıma, satırlar, toplam kontrolü', function () {
    var rows = [['Hesap ekstresi'], ['İşlem Tarihi', 'Menkul', 'İşlem Türü', 'Adet', 'Fiyat', 'Komisyon', 'Tutar'], ['12.11.2026', 'ASELS', 'Alış', '10', '145,20', '2,18', '1.452,00'], ['13.11.2026', 'TUPRS', 'Satış', '5', '200,00', '1,00', '1.000,00'], ['', 'Toplam', '', '', '', '', '2.452,00']];
    var map = PF.detectTradeColumns(rows); eq(map.headerRow, 1); eq([map.date, map.symbol, map.side, map.qty, map.price, map.fee, map.total], [0, 1, 2, 3, 4, 5, 6]);
    var t = PF.tradeRowsFromTable(rows, map, P.parseDate); eq(t.length, 2); eq(t[0].date, '2026-11-12'); eq(t[0].side, 'buy'); eq(t[0].qty, 10 * Q); eq(t[0].price, 145200000); eq(t[0].fee, 218); eq(t[1].side, 'sell');
    t.forEach(function (r) { r.currency = 'TRY'; r.include = true; PF.validateTradeRow(r, '2026-11-13'); }); eq(t[0].errors, []); eq(t[0].calc.writtenOk, true); eq(t[0].calc.cash, 145418); eq(t[1].calc.cash, 99900);
    var c = PF.tradeTotalsCheck([t[0]], 145418); ok(c.match); eq(c.by, 'buys'); var cg = PF.tradeTotalsCheck([t[0]], 145200); ok(cg.match); eq(cg.by, 'grossBuys'); var cn = PF.tradeTotalsCheck(t, 45200); ok(cn.match); eq(cn.by, 'grossNet'); var c2 = PF.tradeTotalsCheck(t, 1); ok(!c2.match); eq(c2.computed, 45200); eq(c2.diff, 45199);
  });
  test('Metin ve yapay zekâ çıktısından alım-satım okuma', function () {
    var r = PF.parseTradeText('12.11.2026 ASELS ALIŞ 10 145,20 1.452,00\nboş satır\n13.11.2026 SPUS SATIŞ 2 USD 45,50 91,00', P.parseDate);
    eq(r.length, 2); eq(r[0].symbol, 'ASELS'); eq(r[0].qty, 10 * Q); eq(r[0].written, 145200); eq(r[1].side, 'sell'); eq(r[1].currency, 'USD');
    var sw = PF.parseTradeText('12.11.2026 ASELS ALIŞ 10 145,2 1.500,00', P.parseDate); eq(sw[0].qty, 10 * Q); eq(PF.validateTradeRow(Object.assign(sw[0], { currency: 'TRY' }), '2026-11-13').warnings.length, 1, 'tutmayan tutar uyarılır');
    var ai = PF.rowsFromAiTrades('```json\n{"trades":[{"date":"2026-11-12","symbol":"KTV","side":"alış","qty":"1000","price":"3,18","fee":"0","total":"3180"}],"total":"3.180,00"}\n```', P.parseDate);
    eq(ai.rows.length, 1); eq(ai.rows[0].side, 'buy'); eq(ai.rows[0].price, 3180000); eq(ai.docTotal, 318000);
    eq(PF.normSide('Alış'), 'buy'); eq(PF.normSide('SATIŞ'), 'sell'); eq(PF.normSide('?'), null); eq(PF.normCur('TL'), 'TRY');
  });
  test('Fiyat listesi içe aktarma ve varlık eşleme', function () {
    var rows = [['Fon Kodu', 'Fiyat', 'Tarih'], ['KTV', '3,25', '13.11.2026'], ['ASELS', '102,00', '13.11.2026']];
    var m = PF.detectPriceColumns(rows), p = PF.priceRowsFromTable(rows, m, P.parseDate); eq(p.length, 2); eq(p[0].price, 3250000); eq(p[0].date, '2026-11-13');
    var ex = S.exampleState('2026-11', '2026-11-13'); ok(PF.matchAsset(ex, 'ktv')); ok(PF.matchAsset(ex, 'ASELS')); eq(PF.matchAsset(ex, 'YOKBÖYLE'), null);
  });
  test('Fiyat kaynağı ayrıştırıcıları (gerçek yanıt örnekleri)', function () {
    var fr = PR.parseFrankfurter({ amount: 1, base: 'USD', date: '2026-11-13', rates: { EUR: 0.90481, TRY: 50.368 } }); eq(fr.USD, 50368000); eq(fr.EUR, Math.round(50.368 / 0.90481 * 1e6)); eq(fr.date, '2026-11-13');
    var tg = PR.parseTruncgil({ Update_Date: '2026-11-14 16:20:01', USD: { Buying: 50.3596, Selling: 50.3716 }, GRA: { Buying: 6279.53, Selling: 6280.54 }, GUMUS: { Buying: 79.1 }, XU100: { Selling: 11842.82 } });
    eq(tg.XAU, 6279530000); eq(tg.USD, 50359600); eq(tg.XU100, 11842820000); eq(tg.date, '2026-11-14'); eq(tg.EUR, null);
    var g = PR.parseGoldApi({ currency: 'USD', price: 3887.600098, symbol: 'XAU', updatedAt: '2026-11-14T22:20:25Z' }); eq(g.usdPerOz, 3887600098); eq(g.date, '2026-11-15');
    var cg = PR.parseCoinGecko({ bitcoin: { 'try': 3359200, last_updated_at: 1794662429 } }, ['bitcoin', 'ethereum']); eq(cg.bitcoin.p, 3359200 * PP); eq(cg.ethereum, undefined);
    var td = PR.parseTwelve({ symbol: 'SPUS', currency: 'USD', datetime: '2026-11-13', close: '45.12000' }); eq(td.p, 45120000);
    var threw = false; try { PR.parseTwelve({ code: 401, message: 'apikey', status: 'error' }); } catch (e) { threw = true; } ok(threw);
    eq(PR.parseFawazGold({ date: '2025-06-30', xau: { 'try': 130846.95975494 } }).p, Math.round(130846.959755 / 31.1034768 * 1e6));
    eq(PR.parseFxSeries({ rates: { '2026-01-02': { TRY: 43.1 }, '2026-01-01': { TRY: 43 } } }).map(function (x) { return x.d; }), ['2026-01-01', '2026-01-02']);
    threw = false; try { PR.parseFrankfurter({ rates: {} }); } catch (e) { threw = true; } ok(threw, 'bozuk yanıt reddedilir');
  });

  // ---- v4: grafik verisi (net varlık geçmişi) ----
  var CD = isNode ? require('../js/chartdata.js') : root.ChartData;
  test('Net varlık geçmişi: kayıt, aynı gün üzerine yazma, gelecek tarih silinir', function () {
    var r = CD.record([], '2026-11-14', 100000); eq(r.list, [{ d: '2026-11-14', v: 100000 }]); ok(r.changed);
    r = CD.record(r.list, '2026-11-14', 100050); eq(r.list.length, 1); eq(r.list[0].v, 100050);
    r = CD.record([{ d: '2026-12-01', v: 5 }, { d: '2026-11-10', v: 7 }], '2026-11-14', 9); eq(r.list, [{ d: '2026-11-10', v: 7 }, { d: '2026-11-14', v: 9 }]);
    r = CD.record([{ d: 'x', v: 1 }, { d: '2026-11-01', v: 1.5 }, null], '2026-11-14', 3); eq(r.list, [{ d: '2026-11-14', v: 3 }]);
  });
  test('Net varlık geçmişi: 120 günden eskisi ay sonuna indirgenir', function () {
    var list = []; for (var i = 0; i < 300; i++) list.push({ d: CD.addDays('2026-01-01', i), v: i * 100 });
    var out = CD.prune(list, '2026-10-27'), cut = CD.addDays('2026-10-27', -120);
    var old = out.filter(function (p) { return p.d < cut; });
    ok(old.every(function (p) { return CD.addDays(p.d, 1).slice(8) === '01' || p.d.slice(0, 7) === cut.slice(0, 7); }), 'eski noktalar ay sonu');
    eq(out.filter(function (p) { return p.d >= cut; }).length, list.filter(function (p) { return p.d >= cut; }).length);
  });
  test('Örnek geçmiş bugünün değeriyle TAM biter, tam sayı ve sıralı', function () {
    var h = CD.synthExample(12345678901, '2026-11-14');
    eq(h[h.length - 1], { d: '2026-11-14', v: 12345678901 });
    ok(h.every(function (p, i) { return Number.isSafeInteger(p.v) && p.v > 0 && (i === 0 || h[i - 1].d < p.d); }));
    eq(JSON.stringify(CD.synthExample(500000, '2026-11-14')), JSON.stringify(CD.synthExample(500000, '2026-11-14')), 'deterministik');
  });
  test('Zaman aralığı ve değişim (kuruş, yuvarlamasız)', function () {
    var h = [{ d: '2026-01-31', v: 100000 }, { d: '2026-09-30', v: 150000 }, { d: '2026-10-20', v: 160000 }, { d: '2026-11-14', v: 170001 }];
    eq(CD.inRange(h, '1A', '2026-11-14').map(function (p) { return p.d; }), ['2026-09-30', '2026-10-20', '2026-11-14']);
    eq(CD.inRange(h, 'Tümü', '2026-11-14').length, 4);
    eq(CD.change(CD.inRange(h, 'Tümü', '2026-11-14')), { abs: 70001, bp: M.ratioBp(70001, 100000) });
    eq(CD.change([{ d: '2026-11-14', v: 5 }]), { abs: 0, bp: null });
  });
  test('validateState net varlık geçmişini temizler ve korur', function () {
    var s = S.exampleState(); s.nwHistory = [{ d: '2026-11-02', v: 5 }, { d: 'bozuk', v: 1 }, { d: '2026-11-01', v: 4 }, { d: '2026-11-02', v: 6 }];
    var v = S.validateState(JSON.parse(JSON.stringify(s))); eq(v.nwHistory, [{ d: '2026-11-01', v: 4 }, { d: '2026-11-02', v: 6 }]);
    var e = S.validateState(JSON.parse(JSON.stringify(S.emptyState()))); ok(e.nwHistory == null, 'yoksa eklenmez');
  });

  var passed = results.filter(function (r) { return r.ok; }).length;
  if (isNode) {
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' test geçti');
    if (passed !== results.length) process.exit(1);
    console.log('\n— v5 (şifreleme, eşitleme, kilit, temettü/bedelsiz, fiyat kaynakları) —');
    require('./run-tests-v5.js').run().then(function (r5) {
      var p5 = r5.filter(function (r) { return r.ok; }).length;
      r5.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
      console.log('\n' + p5 + '/' + r5.length + ' v5 testi geçti');
      if (p5 !== r5.length) process.exit(1);
      console.log('\n— v6 (denetim düzeltmeleri: kart ekstresi, acil fon, taşma, ortak risk kuralı, örnek veri/eşitleme, ekler) —');
      return require('./run-tests-v6.js').run().then(function (r6) {
        var p6 = r6.filter(function (r) { return r.ok; }).length;
        r6.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
        console.log('\n' + p6 + '/' + r6.length + ' v6 testi geçti');
        if (p6 !== r6.length) process.exit(1);
        console.log('\n— v7 (Portföy Analizi: göstergeler TA-Lib referansı, grafik yapısı, veri doğrulama, skor/plan/sağlık/oluşturucu) —');
        return require('./run-tests-v7.js').run().then(function (r7) {
          var p7 = r7.filter(function (r) { return r.ok; }).length;
          r7.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
          console.log('\n' + p7 + '/' + r7.length + ' v7 testi geçti');
          if (p7 !== r7.length) process.exit(1);
          console.log('\n— v7.1 (etiket yerleşimi, gün içi mumlar, KAP/haber önbelleği, Katılım endeksi, seviye uyarıları) —');
          return require('./run-tests-v71.js').run().then(function (r71) {
            var p71 = r71.filter(function (r) { return r.ok; }).length;
            r71.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
            console.log('\n' + p71 + '/' + r71.length + ' v7.1 testi geçti');
            if (p71 !== r71.length) process.exit(1);
            console.log('\n— v8 (haber puanlama/eşleştirme, olay beklentisi ve olasılıkları, bildirim motoru, duygu durumu, Python/JS kural eşitliği) —');
            return require('./run-tests-v8.js').run().then(function (r8) {
              var p8 = r8.filter(function (r) { return r.ok; }).length;
              r8.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
              console.log('\n' + p8 + '/' + r8.length + ' v8 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length));
              if (p8 !== r8.length) process.exit(1);
              console.log('\n— v8.1 (güncellik ↔ cron eşitliği, sunucu anlık görüntüsü, uyarı üretimi, senaryo özeti) —');
              return require('./run-tests-v81.js').run().then(function (r81) {
                var p81 = r81.filter(function (r) { return r.ok; }).length;
                r81.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
                console.log('\n' + p81 + '/' + r81.length + ' v8.1 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8 + p81) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length + r81.length));
                if (p81 !== r81.length) process.exit(1);
                console.log('\n— v8.2 (arka plan portföy izleme: şifreleme, kurulum dizgesi, yük gizliliği, kontrol motoru, iş betiği, akış/depo denetimi) —');
                return require('./run-tests-v82.js').run().then(function (r82) {
                  var p82 = r82.filter(function (r) { return r.ok; }).length;
                  r82.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
                  console.log('\n' + p82 + '/' + r82.length + ' v8.2 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8 + p81 + p82) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length + r81.length + r82.length));
                  if (p82 !== r82.length) process.exit(1);
                  console.log('\n— v8.3 (şifreli kişisel veri paketi: gidiş-dönüş, yanlış parola, örnek veri değişimi, uygulandı atlama, betik, depo denetimi) —');
                  return require('./run-tests-v83.js').run().then(function (r83) {
                    var p83 = r83.filter(function (r) { return r.ok; }).length;
                    r83.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
                    console.log('\n' + p83 + '/' + r83.length + ' v8.3 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8 + p81 + p82 + p83) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length + r81.length + r82.length + r83.length));
                    if (p83 !== r83.length) process.exit(1);
                    console.log('\n— v8.4 (canlı fiyatla tek değerleme, kapanan/işlemsiz pozisyonlar, komisyon/BSMV kırılımı, düzeltme doğrulaması, değişiklik geçmişi ve geri al) —');
                    return require('./run-tests-v84.js').run().then(function (r84) {
                      var p84 = r84.filter(function (r) { return r.ok; }).length;
                      r84.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
                      console.log('\n' + p84 + '/' + r84.length + ' v8.4 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8 + p81 + p82 + p83 + p84) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length + r81.length + r82.length + r83.length + r84.length));
                      if (p84 !== r84.length) process.exit(1);
                      console.log('\n— v8.5 (seans raporları: BIST/ABD/kripto saatleri ve tatiller, zarar durdur (stop) uyarıları, işlem gerekçe notları) —');
                      return require('./run-tests-v85.js').run().then(function (r85) {
                        var p85 = r85.filter(function (r) { return r.ok; }).length;
                        r85.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
                        console.log('\n' + p85 + '/' + r85.length + ' v8.5 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8 + p81 + p82 + p83 + p84 + p85) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length + r81.length + r82.length + r83.length + r84.length + r85.length));
                        if (p85 !== r85.length) process.exit(1);
                        console.log('\n— v8.6 (tüm varlıkları temizle: bütçe durur, otomatik yedek ve geri al, boş portföy) —');
                        return require('./run-tests-v86.js').run().then(function (r86) {
                          var p86 = r86.filter(function (r) { return r.ok; }).length;
                          r86.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
                          console.log('\n' + p86 + '/' + r86.length + ' v8.6 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8 + p81 + p82 + p83 + p84 + p85 + p86) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length + r81.length + r82.length + r83.length + r84.length + r85.length + r86.length));
                          if (p86 !== r86.length) process.exit(1);
                          console.log('\n— v8.6.1 (aracı kurum geçmiş dosyası: önizleme, yalnız o varlıklar değişir, saatle gün içi sıra) —');
                          return require('./run-tests-v861.js').run().then(function (r861) {
                            var p861 = r861.filter(function (r) { return r.ok; }).length;
                            r861.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
                            console.log('\n' + p861 + '/' + r861.length + ' v8.6.1 testi geçti · toplam ' + (passed + p5 + p6 + p7 + p71 + p8 + p81 + p82 + p83 + p84 + p85 + p86 + p861) + '/' + (results.length + r5.length + r6.length + r7.length + r71.length + r8.length + r81.length + r82.length + r83.length + r84.length + r85.length + r86.length + r861.length));
                            if (p861 !== r861.length) process.exit(1);
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  } else { root.TEST_RESULTS = results; }
})(typeof self !== 'undefined' ? self : this);
