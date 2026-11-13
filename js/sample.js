/* sample.js — Boş durum, ÖRNEK veri, şema sürümleri (göç) ve yedek dosyası doğrulama. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./ledger.js'), require('./money.js'));
  else root.Sample = factory(root.Calc, root.Ledger, root.Money);
})(typeof self !== 'undefined' ? self : this, function (C, L, M) {
  'use strict';
  var SCHEMA_VERSION = 2;
  /* v1 → v2: hesaplar, transferler, kurlar, kategori sınırları, düzenli ödemeler, taksitler, yıllık giderler eklendi. */
  var V2_DEFAULTS = { accounts: [], transfers: [], rates: {}, limits: {}, recurring: [], installments: [], sinkingFunds: [] };
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function defaultSettings() {
    return { emergencyMonths: 6, emergencyShareBp: 5000, inflationBp: 2500, view: 'simple',
      scenarios: JSON.parse(JSON.stringify(C.DEFAULT_SCENARIOS)) };
  }
  function addMonths(ym, n) { return C.ymFromIndex(C.monthIndex(ym) + n); }
  function todayYmd(d) { d = d || new Date(); var mo = d.getMonth() + 1, da = d.getDate(); return d.getFullYear() + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da; }
  function emptyState(nowYm) {
    nowYm = nowYm || C.currentYm();
    var s = { schema: SCHEMA_VERSION, isExample: false, updatedAt: null, incomes: [], expenses: [], assets: [], debts: [], transactions: [],
      goal: { name: 'Ev peşinatı', target: 0, targetYm: addMonths(nowYm, 60) }, settings: defaultSettings() };
    Object.keys(V2_DEFAULTS).forEach(function (k) { s[k] = JSON.parse(JSON.stringify(V2_DEFAULTS[k])); });
    return s;
  }

  /* ÖRNEK veri: her özelliği gösterir. today: "YYYY-AA-GG" (verilmezse bugün). Bu ayın işlemleri bugünden ileri tarihli olmaz. */
  function exampleState(nowYm, today) {
    today = today || (nowYm ? nowYm + '-' + String(Math.min(28, new Date().getDate())).padStart(2, '0') : todayYmd());
    nowYm = nowYm || today.slice(0, 7);
    var tDay = +today.slice(8);
    var s = emptyState(nowYm);
    s.isExample = true;
    s.incomes = [{ id: uid(), name: 'Maaş (net)', amount: 6000000 }, { id: uid(), name: 'Ek gelir (serbest iş)', amount: 800000 }];
    s.expenses = [
      { id: uid(), name: 'Kira', type: 'fixed', amount: 2000000 },
      { id: uid(), name: 'Faturalar (elektrik, su, doğalgaz, internet)', type: 'fixed', amount: 450000 },
      { id: uid(), name: 'Ulaşım', type: 'fixed', amount: 350000 },
      { id: uid(), name: 'Market (temel)', type: 'fixed', amount: 550000 },
      { id: uid(), name: 'Diğer sabit (aidat, telefon)', type: 'fixed', amount: 150000 },
      { id: uid(), name: 'Dışarıda yemek, eğlence', type: 'variable', amount: 400000 },
      { id: uid(), name: 'Giyim, kişisel bakım', type: 'variable', amount: 300000 },
      { id: uid(), name: 'Beklenmeyen / diğer', type: 'variable', amount: 300000 }
    ];
    s.assets = [
      { id: uid(), name: 'Katılım fonu', cls: 'katilim_fund', risk: 'medium', emergency: false, value: 10000000 },
      { id: uid(), name: 'Helal ETF (ör. SPUS)', cls: 'halal_etf', risk: 'risky', emergency: false, value: 8000000 }
    ];
    s.goal = { name: 'Ev peşinatı', target: 150000000, targetYm: addMonths(nowYm, 60) };
    s.rates = { USD: { rate: 4250, date: today }, EUR: { rate: 4900, date: today }, XAU: { rate: 540000, date: today } };

    // Hesaplar
    var stmtYm = tDay >= 5 ? nowYm : addMonths(nowYm, -1);
    var acc = {
      katilim: { id: uid(), name: 'Katılım hesabı (vadesiz TL)', type: 'katilim', currency: 'TRY', balance: 6000000, emergency: true, inNetWorth: true },
      bank: { id: uid(), name: 'Maaş hesabı', type: 'bank', currency: 'TRY', balance: 1850000, emergency: true, inNetWorth: true },
      cash: { id: uid(), name: 'Cüzdan (nakit)', type: 'cash', currency: 'TRY', balance: 250000, emergency: true, inNetWorth: true },
      usd: { id: uid(), name: 'Dolar (nakit)', type: 'cash', currency: 'USD', balance: 100000, emergency: false, inNetWorth: true, risk: 'safe' },
      gold: { id: uid(), name: 'Altın hesabı (katılım bankası)', type: 'gold', currency: 'XAU', balance: 2000, emergency: false, inNetWorth: true },
      card: { id: uid(), name: 'Kredi kartı (örnek banka)', type: 'card', currency: 'TRY', balance: -1073050, emergency: false, inNetWorth: true,
        card: { statementDay: 5, dueDay: 15, limit: 8000000, statementDebt: 1248050, statementYm: stmtYm, paid: 500000, remindDays: 3 } }
    };
    s.accounts = [acc.katilim, acc.bank, acc.cash, acc.usd, acc.gold, acc.card];
    var payDate = L.ymdOf(stmtYm, Math.min(6, stmtYm === nowYm ? tDay : 31));
    s.transfers = [
      { id: uid(), date: payDate, fromId: acc.bank.id, toId: acc.card.id, amountFrom: 500000, amountTo: 500000, note: 'Kart borcu ödemesi (kısmi)', paidApplied: 500000 },
      { id: uid(), date: L.ymdOf(addMonths(nowYm, -1), 20), fromId: acc.katilim.id, toId: acc.gold.id, amountFrom: 1080000, amountTo: 200, note: '2 gram altın alımı', paidApplied: 0 }
    ];

    // Kategori sınırları
    s.limits = { 'Market': 600000, 'Yeme-içme': 300000, 'Ulaşım': 400000, 'Giyim': 250000, 'Abonelik/Eğlence': 100000, 'Alışveriş': 300000 };

    // Düzenli ödemeler
    var R = {
      salary: { id: uid(), name: 'Maaş', direction: 'income', amount: 6000000, category: 'Gelir', freq: 'monthly', everyMonths: 1, day: 1, startYm: addMonths(nowYm, -3), endYm: null, remindDays: 0, active: true, skipped: [], accountId: acc.bank.id },
      rent: { id: uid(), name: 'Kira', direction: 'expense', amount: 2000000, category: 'Kira/Konut', freq: 'monthly', everyMonths: 1, day: 2, startYm: addMonths(nowYm, -3), endYm: null, remindDays: 3, active: true, skipped: [], accountId: acc.bank.id },
      elec: { id: uid(), name: 'Elektrik faturası', direction: 'expense', amount: 95000, category: 'Faturalar', freq: 'monthly', everyMonths: 1, day: 5, startYm: addMonths(nowYm, -3), endYm: null, remindDays: 3, active: true, skipped: [], accountId: null },
      net: { id: uid(), name: 'İnternet (ev)', direction: 'expense', amount: 45000, category: 'Faturalar', freq: 'monthly', everyMonths: 1, day: 20, startYm: addMonths(nowYm, -3), endYm: null, remindDays: 3, active: true, skipped: [], accountId: null },
      music: { id: uid(), name: 'Müzik aboneliği (Spotify)', direction: 'expense', amount: 9999, category: 'Abonelik/Eğlence', freq: 'monthly', everyMonths: 1, day: Math.min(28, tDay + 2), startYm: addMonths(nowYm, -3), endYm: null, remindDays: 3, active: true, skipped: [], accountId: acc.card.id },
      water: { id: uid(), name: 'Su faturası (2 ayda bir)', direction: 'expense', amount: 38000, category: 'Faturalar', freq: 'custom', everyMonths: 2, day: 10, startYm: addMonths(nowYm, -1), endYm: null, remindDays: 3, active: true, skipped: [], accountId: null },
      cloud: { id: uid(), name: 'Bulut depolama (yıllık)', direction: 'expense', amount: 119900, category: 'Abonelik/Eğlence', freq: 'yearly', everyMonths: 12, day: 25, startYm: addMonths(nowYm, -11), endYm: null, remindDays: 7, active: true, skipped: [], accountId: acc.card.id }
    };
    s.recurring = [R.salary, R.rent, R.elec, R.net, R.music, R.water, R.cloud];

    // Taksitler (kredi kartında)
    s.installments = [
      { id: uid(), cardId: acc.card.id, description: 'Telefon', category: 'Alışveriş', total: 4200000, count: 12, firstYm: addMonths(nowYm, -4) },
      { id: uid(), cardId: acc.card.id, description: 'Buzdolabı', category: 'Alışveriş', total: 2499999, count: 6, firstYm: addMonths(nowYm, -1) }
    ];

    // Yıllık ve düzensiz giderler (kumbara)
    s.sinkingFunds = [
      { id: uid(), name: 'Kasko ve trafik sigortası', category: 'Ulaşım', amount: 1800000, saved: 900000, dueYm: addMonths(nowYm, 5), day: 1, everyMonths: 12 },
      { id: uid(), name: 'Motorlu taşıtlar vergisi (MTV, 1. taksit)', category: 'Diğer', amount: 300000, saved: 180000, dueYm: addMonths(nowYm, 2), day: 1, everyMonths: 6 },
      { id: uid(), name: 'Kurban Bayramı (kurban + harçlıklar)', category: 'Bağış/Zekat', amount: 800000, saved: 200000, dueYm: addMonths(nowYm, 6), day: 1, everyMonths: 12 },
      { id: uid(), name: 'Yaz tatili', category: 'Diğer', amount: 3000000, saved: 1000000, dueYm: addMonths(nowYm, 8), day: 1, everyMonths: 12 }
    ];

    // İşlemler: son 3 tam ay + bu ay (bugüne kadar)
    var T = [];
    function tx(ym, day, desc, amount, cat, extra) {
      if (ym === nowYm && day > tDay) day = tDay;
      var t = { id: uid(), date: L.ymdOf(ym, day), description: desc, amount: amount, category: cat, source: 'örnek' };
      if (extra) Object.keys(extra).forEach(function (k) { t[k] = extra[k]; });
      T.push(t);
    }
    function rec(item, ym, amount) { return { recurringId: item.id, period: ym, accountId: item.accountId || undefined }; }
    var past = [ // [market1, market2, yeme, ulaşım, giyim, alışveriş, elektrik]
      [310000, 210000, 210000, 320000, 0, 120000, 88000],
      [325000, 240000, 240000, 300000, 180000, 0, 91000],
      [330000, 260000, 260000, 340000, 95000, 230000, 94000]
    ];
    [3, 2, 1].forEach(function (k, i) {
      var ym = addMonths(nowYm, -k), p = past[i];
      tx(ym, 1, 'Maaş', 6000000, 'Gelir', rec(R.salary, ym));
      tx(ym, 2, 'Kira', -2000000, 'Kira/Konut', rec(R.rent, ym));
      tx(ym, 4, 'Migros alışverişi', -p[0], 'Market', { accountId: acc.card.id });
      tx(ym, 5, 'Elektrik faturası', -p[6], 'Faturalar', rec(R.elec, ym));
      tx(ym, 9, 'Akaryakıt (Opet)', -p[3], 'Ulaşım', { accountId: acc.card.id });
      tx(ym, 12, 'Restoran ve kafe', -p[2], 'Yeme-içme');
      tx(ym, 15, 'Müzik aboneliği (Spotify)', -9999, 'Abonelik/Eğlence', rec(R.music, ym));
      tx(ym, 18, 'A101 ve manav', -p[1], 'Market');
      tx(ym, 20, 'İnternet (ev)', -45000, 'Faturalar', rec(R.net, ym));
      if (p[4]) tx(ym, 22, 'LC Waikiki', -p[4], 'Giyim', { accountId: acc.card.id });
      if (p[5]) tx(ym, 24, 'Trendyol siparişi', -p[5], 'Alışveriş', { accountId: acc.card.id });
      if (ym === R.water.startYm) tx(ym, 10, 'Su faturası', -36500, 'Faturalar', rec(R.water, ym));
    });
    tx(nowYm, 1, 'Maaş', 6000000, 'Gelir', rec(R.salary, nowYm));
    tx(nowYm, 2, 'Kira', -2000000, 'Kira/Konut', rec(R.rent, nowYm));
    tx(nowYm, 3, 'Market alışverişi (Migros)', -184590, 'Market', { accountId: acc.card.id });
    tx(nowYm, 4, 'Yemeksepeti siparişi', -142000, 'Yeme-içme', { accountId: acc.card.id });
    tx(nowYm, 5, 'Elektrik faturası', -96040, 'Faturalar');            // bilinçli olarak bağlanmadı: "eşleşen işlem bulundu" örneği
    tx(nowYm, 6, 'BİM alışverişi', -210000, 'Market');
    tx(nowYm, 7, 'Akaryakıt (Opet)', -150000, 'Ulaşım', { accountId: acc.card.id });
    tx(nowYm, 8, 'Kahve (Starbucks)', -82000, 'Yeme-içme', { accountId: acc.card.id });
    tx(nowYm, 8, 'Manav', -115000, 'Market');
    tx(nowYm, 9, 'Restoran', -85000, 'Yeme-içme');
    s.transactions = T;
    return s;
  }

  /* ---------- Şema göçü (eski sürüm verisi ve yedekleri) ----------
   * Yerinde (in-place) çalışır; bilinmeyen/yeni sürüm reddedilir. Var olan hiçbir veri silinmez. */
  function migrate(s) {
    if (!s || typeof s !== 'object') throw new Error('Dosya geçerli bir yedek değil');
    if (typeof s.schema !== 'number' || !Number.isInteger(s.schema)) throw new Error('Sürüm bilgisi yok veya hatalı');
    if (s.schema > SCHEMA_VERSION) throw new Error('Bu veri uygulamanın daha yeni bir sürümüyle oluşturulmuş (v' + s.schema + '). Uygulamayı güncelleyip tekrar dene.');
    if (s.schema < 1) throw new Error('Desteklenmeyen sürüm: ' + s.schema);
    var from = s.schema;
    if (s.schema === 1) {
      Object.keys(V2_DEFAULTS).forEach(function (k) { if (s[k] == null) s[k] = JSON.parse(JSON.stringify(V2_DEFAULTS[k])); });
      s.schema = 2;
    }
    if (from !== s.schema) s.migratedFrom = from;
    return s;
  }

  /* Yedek dosyasını / kayıtlı veriyi sıkı doğrular; hatalıysa açıklayıcı hata fırlatır (bozuk veri asla yüklenmez). */
  function validateState(s) {
    var errs = [];
    function isK(v) { return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER; }
    function isPosInt(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }
    function isStr(v, max) { return typeof v === 'string' && v.trim().length > 0 && v.length <= (max || 200); }
    migrate(s);
    ['incomes', 'expenses', 'assets', 'debts', 'transactions', 'accounts', 'transfers', 'recurring', 'installments', 'sinkingFunds'].forEach(function (k) { if (!Array.isArray(s[k])) errs.push(k + ' listesi eksik'); });
    ['rates', 'limits'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) errs.push(k + ' bilgisi eksik'); });
    if (!errs.length) {
      s.incomes.forEach(function (x, i) { if (!isK(x.amount) || x.amount < 0) errs.push('Gelir ' + (i + 1) + ': tutar hatalı'); });
      s.expenses.forEach(function (x, i) { if (!isK(x.amount) || x.amount < 0) errs.push('Gider ' + (i + 1) + ': tutar hatalı'); if (x.type !== 'fixed' && x.type !== 'variable') errs.push('Gider ' + (i + 1) + ': tür hatalı'); });
      s.assets.forEach(function (x, i) { if (!isK(x.value) || x.value < 0) errs.push('Varlık ' + (i + 1) + ': değer hatalı'); if (['safe', 'medium', 'risky'].indexOf(x.risk) < 0) errs.push('Varlık ' + (i + 1) + ': risk hatalı'); });
      s.debts.forEach(function (x, i) { if (!isK(x.amount) || x.amount < 0) errs.push('Borç ' + (i + 1) + ': tutar hatalı'); });
      // Kurlar
      Object.keys(s.rates).forEach(function (c) {
        var r = s.rates[c];
        if (c === 'TRY' || !L.CURRENCIES[c]) errs.push('Kur: bilinmeyen para birimi ' + c);
        else if (!r || !isK(r.rate) || r.rate <= 0 || !L.isYmd(r.date)) errs.push('Kur ' + c + ': değer veya tarih hatalı');
      });
      // Hesaplar
      var accIds = {}, cardIds = {};
      s.accounts.forEach(function (a, i) {
        var n = 'Hesap ' + (i + 1);
        if (!isStr(a.id, 64) || accIds[a.id]) errs.push(n + ': kimlik hatalı/tekrarlı'); accIds[a.id] = a;
        if (!isStr(a.name, 120)) errs.push(n + ': ad hatalı');
        if (!L.ACCOUNT_TYPES[a.type]) errs.push(n + ': tür hatalı');
        if (!L.CURRENCIES[a.currency]) errs.push(n + ': para birimi hatalı');
        if (a.type === 'gold' && a.currency !== 'XAU') errs.push(n + ': altın hesabı gram altın olmalı');
        if (a.type === 'card' && a.currency !== 'TRY') errs.push(n + ': kredi kartı TL olmalı');
        if (!isK(a.balance)) errs.push(n + ': bakiye hatalı');
        else if (a.balance < 0 && a.type !== 'card') errs.push(n + ': yalnızca kredi kartı bakiyesi eksi olabilir');
        if (a.risk != null && ['safe', 'medium', 'risky'].indexOf(a.risk) < 0) errs.push(n + ': risk hatalı');
        if (a.type === 'card') {
          cardIds[a.id] = true;
          var c = a.card;
          if (!c || !isPosInt(c.statementDay, 1, 31) || !isPosInt(c.dueDay, 1, 31)) errs.push(n + ': kesim/son ödeme günü hatalı');
          else {
            if (!isK(c.limit) || c.limit < 0) errs.push(n + ': limit hatalı');
            if (!isK(c.statementDebt) || c.statementDebt < 0) errs.push(n + ': ekstre borcu hatalı');
            if (!isK(c.paid) || c.paid < 0) errs.push(n + ': ödenen tutar hatalı');
            if (c.statementYm != null && !L.isYm(c.statementYm)) errs.push(n + ': ekstre ayı hatalı');
            if (c.remindDays != null && !isPosInt(c.remindDays, 0, 31)) errs.push(n + ': hatırlatma günü hatalı');
          }
        } else if (a.card != null) errs.push(n + ': kart bilgisi yalnızca kredi kartında olur');
      });
      // Transferler
      s.transfers.forEach(function (t, i) {
        var n = 'Transfer ' + (i + 1);
        if (!isStr(t.id, 64)) errs.push(n + ': kimlik hatalı');
        if (!L.isYmd(t.date)) errs.push(n + ': tarih hatalı');
        if (!accIds[t.fromId] || !accIds[t.toId]) errs.push(n + ': hesap bulunamadı');
        else if (t.fromId === t.toId) errs.push(n + ': aynı hesaba transfer olmaz');
        if (!isK(t.amountFrom) || t.amountFrom <= 0 || !isK(t.amountTo) || t.amountTo <= 0) errs.push(n + ': tutar hatalı');
        else if (accIds[t.fromId] && accIds[t.toId] && accIds[t.fromId].currency === accIds[t.toId].currency && t.amountFrom !== t.amountTo) errs.push(n + ': aynı para biriminde giden ve gelen tutar eşit olmalı');
        if (t.paidApplied != null && (!isK(t.paidApplied) || t.paidApplied < 0)) errs.push(n + ': kart ödeme bilgisi hatalı');
      });
      // Sınırlar
      Object.keys(s.limits).forEach(function (c) { if (!isStr(c, 60) || !isK(s.limits[c]) || s.limits[c] < 0) errs.push('Sınır "' + c + '": tutar hatalı'); });
      // Düzenli ödemeler
      var recIds = {};
      s.recurring.forEach(function (r, i) {
        var n = 'Düzenli ödeme ' + (i + 1);
        if (!isStr(r.id, 64) || recIds[r.id]) errs.push(n + ': kimlik hatalı/tekrarlı'); recIds[r.id] = true;
        if (!isStr(r.name, 120)) errs.push(n + ': ad hatalı');
        if (r.direction !== 'income' && r.direction !== 'expense') errs.push(n + ': yön hatalı');
        if (!isK(r.amount) || r.amount <= 0) errs.push(n + ': tutar sıfırdan büyük olmalı');
        if (!isStr(r.category, 60)) errs.push(n + ': kategori hatalı');
        if (!L.FREQS[r.freq]) errs.push(n + ': sıklık hatalı');
        if (r.freq === 'custom' && !isPosInt(r.everyMonths, 1, 120)) errs.push(n + ': kaç ayda bir bilgisi hatalı (1–120)');
        if (!isPosInt(r.day, 1, 31)) errs.push(n + ': gün hatalı (1–31)');
        if (!L.isYm(r.startYm)) errs.push(n + ': başlangıç ayı hatalı');
        if (r.endYm != null && (!L.isYm(r.endYm) || r.endYm < r.startYm)) errs.push(n + ': bitiş ayı hatalı');
        if (r.remindDays != null && !isPosInt(r.remindDays, 0, 31)) errs.push(n + ': hatırlatma günü hatalı');
        if (!Array.isArray(r.skipped) || r.skipped.some(function (y) { return !L.isYm(y); })) errs.push(n + ': atlanan aylar hatalı');
        if (r.accountId != null && !accIds[r.accountId]) errs.push(n + ': hesap bulunamadı');
      });
      // İşlemler
      var periodSeen = {};
      s.transactions.forEach(function (x, i) {
        var n = 'İşlem ' + (i + 1);
        if (!isK(x.amount)) errs.push(n + ': tutar hatalı');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '')) errs.push(n + ': tarih hatalı');
        if (x.accountId != null && !accIds[x.accountId]) errs.push(n + ': hesap bulunamadı');
        if (x.recurringId != null) {
          if (!recIds[x.recurringId]) errs.push(n + ': bağlı düzenli ödeme bulunamadı');
          if (!L.isYm(x.period)) errs.push(n + ': dönem hatalı');
          var key = x.recurringId + '|' + x.period;
          if (periodSeen[key]) errs.push(n + ': aynı düzenli ödeme aynı ay için iki kez kaydedilmiş'); periodSeen[key] = true;
        }
      });
      // Taksitler
      s.installments.forEach(function (p, i) {
        var n = 'Taksit ' + (i + 1);
        if (!isStr(p.id, 64)) errs.push(n + ': kimlik hatalı');
        if (!cardIds[p.cardId]) errs.push(n + ': kredi kartı bulunamadı');
        if (!isStr(p.description, 120)) errs.push(n + ': açıklama hatalı');
        if (!isK(p.total) || p.total <= 0) errs.push(n + ': toplam tutar hatalı');
        if (!isPosInt(p.count, 1, 60)) errs.push(n + ': taksit sayısı hatalı (1–60)');
        else if (isK(p.total) && p.total < p.count) errs.push(n + ': taksit başına tutar 1 kuruştan az olamaz');
        if (!L.isYm(p.firstYm)) errs.push(n + ': ilk taksit ayı hatalı');
      });
      // Yıllık giderler
      s.sinkingFunds.forEach(function (f, i) {
        var n = 'Yıllık gider ' + (i + 1);
        if (!isStr(f.id, 64)) errs.push(n + ': kimlik hatalı');
        if (!isStr(f.name, 120)) errs.push(n + ': ad hatalı');
        if (!isK(f.amount) || f.amount <= 0) errs.push(n + ': tutar hatalı');
        if (!isK(f.saved) || f.saved < 0) errs.push(n + ': biriken tutar hatalı');
        if (!L.isYm(f.dueYm)) errs.push(n + ': ödeme ayı hatalı');
        if (!isPosInt(f.everyMonths, 1, 120)) errs.push(n + ': tekrar süresi hatalı (1–120 ay)');
        if (f.setAsideYm != null && (!L.isYm(f.setAsideYm) || !isK(f.setAsideAmount) || f.setAsideAmount < 0)) errs.push(n + ': bu ay ayrılan bilgisi hatalı');
      });
      if (!s.goal || !isK(s.goal.target) || !/^\d{4}-\d{2}$/.test(s.goal.targetYm || '')) errs.push('Hedef bilgisi hatalı');
      if (!s.settings || !Number.isInteger(s.settings.emergencyMonths)) errs.push('Ayarlar hatalı');
    }
    if (errs.length) throw new Error(errs.slice(0, 8).join('; ') + (errs.length > 8 ? ' …' : ''));
    var d = defaultSettings();
    Object.keys(d).forEach(function (k) { if (s.settings[k] == null) s.settings[k] = d[k]; });
    return s;
  }
  return { SCHEMA_VERSION: SCHEMA_VERSION, uid: uid, emptyState: emptyState, exampleState: exampleState, validateState: validateState, migrate: migrate,
    defaultSettings: defaultSettings, addMonths: addMonths, todayYmd: todayYmd };
});
