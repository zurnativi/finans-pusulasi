/* sample.js — Boş durum, ÖRNEK veri, şema sürümleri (göç) ve yedek dosyası doğrulama. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./ledger.js'), require('./money.js'), require('./portfolio.js'));
  else root.Sample = factory(root.Calc, root.Ledger, root.Money, root.Portfolio);
})(typeof self !== 'undefined' ? self : this, function (C, L, M, PF) {
  'use strict';
  var SCHEMA_VERSION = 3;
  /* Resmi örnek veri sürümü: eski ÖRNEK kayıtlar (isExample) bu sayıdan küçükse yenilenir; gerçek kullanıcı verisine dokunulmaz. */
  var EXAMPLE_REVISION = 2;
  /* v1 → v2: hesaplar, transferler, kurlar, kategori sınırları, düzenli ödemeler, taksitler, yıllık giderler eklendi. */
  var V2_DEFAULTS = { accounts: [], transfers: [], rates: {}, limits: {}, recurring: [], installments: [], sinkingFunds: [] };
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  /* v2 → v3: alım-satım işlemleri, fiyat geçmişi, TÜFE serisi, çoklu hedef, risk kuralları, dengeleme bantları, helal etiketi (varlık/hesap alanı). */
  function goalsFrom(goal) { return [{ id: 'g-ana', name: goal.name, target: goal.target, targetYm: goal.targetYm, glide: 'standard', shareBp: 10000 }]; }
  function defaultSettings() {
    return { emergencyMonths: 6, emergencyShareBp: 5000, inflationBp: 2500, view: 'simple',
      scenarios: JSON.parse(JSON.stringify(C.DEFAULT_SCENARIOS)),
      riskRules: JSON.parse(JSON.stringify(PF.DEFAULT_RULES)), rebalance: { tierBandBp: 500, assetBandBp: 300 } };
  }
  function addMonths(ym, n) { return C.ymFromIndex(C.monthIndex(ym) + n); }
  function todayYmd(d) { d = d || new Date(); var mo = d.getMonth() + 1, da = d.getDate(); return d.getFullYear() + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da; }
  function emptyState(nowYm) {
    nowYm = nowYm || C.currentYm();
    var s = { schema: SCHEMA_VERSION, isExample: false, updatedAt: null, incomes: [], expenses: [], assets: [], debts: [], transactions: [],
      goal: { name: 'Ev peşinatı', target: 0, targetYm: addMonths(nowYm, 60) }, settings: defaultSettings() };
    Object.keys(V2_DEFAULTS).forEach(function (k) { s[k] = JSON.parse(JSON.stringify(V2_DEFAULTS[k])); });
    s.trades = []; s.prices = {}; s.cpi = []; s.goals = goalsFrom(s.goal);
    return s;
  }

  /* ÖRNEK veri: her özelliği gösterir. today: "YYYY-AA-GG" (verilmezse bugün). Bu ayın işlemleri bugünden ileri tarihli olmaz. */
  function exampleState(nowYm, today) {
    today = today || (nowYm ? nowYm + '-' + String(Math.min(28, new Date().getDate())).padStart(2, '0') : todayYmd());
    nowYm = nowYm || today.slice(0, 7);
    var tDay = +today.slice(8);
    var s = emptyState(nowYm);
    s.isExample = true;
    s.exampleRevision = EXAMPLE_REVISION;
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
    s.goals = goalsFrom(s.goal);

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
    examplePortfolio(s, acc, nowYm, today);
    return s;
  }

  /* ---------- ÖRNEK portföy: alım-satım geçmişi, fiyat geçmişi, TÜFE, 3 hedef, helal etiketleri ----------
   * Tüm fiyatlar, kurlar ve TÜFE oranları UYDURMADIR (kaynak alanında "ÖRNEK" ve at damgası yazar); yalnızca özellikleri göstermek içindir. */
  function addDays(ymd, n) { var d = new Date((L.dayIndex(ymd) + n) * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function atOf(ymd) { return ymd + 'T18:00:00+03:00'; }
  /* Yalnızca resmi örnek veri (isExample) ve zaten v3 kaydı, daha eski örnek sürümü. Göç halindeki v1/v2 ve gerçek kullanıcı verisi yenilenmez. */
  function shouldRefreshExample(raw) {
    return !!(raw && raw.isExample && raw.schema === SCHEMA_VERSION && (raw.exampleRevision || 0) < EXAMPLE_REVISION);
  }
  function examplePortfolio(s, acc, nowYm, today) {
    var EX = 'ÖRNEK (gerçek fiyat değil)', H = function (st, note) { return { status: st, note: note + ' (örnek etiket — kendin doğrula)', source: 'Örnek veri', date: today }; };
    var gEv = { id: uid(), name: 'Ev peşinatı', target: 150000000, targetYm: addMonths(nowYm, 60), glide: 'standard', shareBp: 6000 };
    var gAraba = { id: uid(), name: 'Araba peşinatı', target: 9500000, targetYm: addMonths(nowYm, 24), glide: 'conservative', shareBp: 2500 };
    var gEmek = { id: uid(), name: 'Emeklilik', target: 500000000, targetYm: addMonths(nowYm, 300), glide: 'aggressive', shareBp: 1500 };
    s.goals = [gEv, gAraba, gEmek];
    s.goal = { name: gEv.name, target: gEv.target, targetYm: gEv.targetYm };
    function A(o) { var a = { id: uid(), emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: null, withinTierBp: null, goalId: null }; Object.keys(o).forEach(function (k) { a[k] = o[k]; }); return a; }
    var ktv = A({ name: 'Katılım fonu (örnek: KTV)', symbol: 'KTV', cls: 'katilim_fund', risk: 'medium', halal: H('uygun', 'Katılım fonu, danışma kurulu onaylı') });
    var ktn = A({ name: 'Katılım fonu (örnek: KTN)', symbol: 'KTN', cls: 'katilim_fund', risk: 'medium', halal: H('uygun', 'Katılım fonu, danışma kurulu onaylı') });
    var gold = A({ name: 'Fiziki gram altın (örnek)', symbol: 'ALTIN', cls: 'gold', risk: 'medium', priceKey: 'metal:XAU', halal: H('uygun', 'Fiziki altın, peşin alım') });
    var silver = A({ name: 'Fiziki gram gümüş (örnek)', symbol: 'GUMUS', cls: 'other', risk: 'medium', priceKey: 'metal:XAG', halal: H('uygun', 'Fiziki gümüş, peşin alım') });
    var asels = A({ name: 'Katılım endeksi hissesi (örnek: ASELS)', symbol: 'ASELS', cls: 'katilim_stock', risk: 'risky', lot: 'whole', withinTierBp: 2500, halal: H('uygun', 'Katılım endeksinde') });
    var eregl = A({ name: 'Katılım endeksi hissesi (örnek: EREGL)', symbol: 'EREGL', cls: 'katilim_stock', risk: 'risky', lot: 'whole', withinTierBp: 1500, halal: H('uygun', 'Katılım endeksinde') });
    var spus = A({ name: 'SPUS — helal ETF (örnek)', symbol: 'SPUS', cls: 'halal_etf', risk: 'risky', currency: 'USD', lot: 'whole', priceKey: 'td:SPUS', goalId: gEmek.id, withinTierBp: 3500, halal: H('uygun', 'S&P 500 Shariah endeksini izler') });
    var hlal = A({ name: 'HLAL — helal ETF (örnek)', symbol: 'HLAL', cls: 'halal_etf', risk: 'risky', currency: 'USD', lot: 'whole', priceKey: 'td:HLAL', goalId: gEmek.id, withinTierBp: 2500, halal: H('uygun', 'ABD helal hisse endeksini izler') });
    var btc = A({ name: 'Bitcoin (örnek)', symbol: 'BTC', cls: 'crypto', risk: 'risky', priceKey: 'cg:bitcoin', halal: H('supheli', 'Âlimler arasında görüş ayrılığı var') });
    var eth = A({ name: 'Ethereum (örnek)', symbol: 'ETH', cls: 'crypto', risk: 'risky', priceKey: 'cg:ethereum', halal: H('supheli', 'Âlimler arasında görüş ayrılığı var') });
    var sukuk = A({ name: 'Kira sertifikası fonu (örnek)', cls: 'sukuk', risk: 'safe', tracking: 'manual', value: 4000000, halal: H('uygun', 'Kira sertifikası (sukuk) fonu') });
    var mmf = A({ name: 'Para piyasası fonu — faizli (örnek)', cls: 'other', risk: 'safe', tracking: 'manual', value: 1000000, halal: H('uygun_degil', 'Faiz geliri içerir') });
    s.assets = [ktv, ktn, gold, silver, asels, eregl, spus, hlal, btc, eth, sukuk, mmf];
    var q = function (x) { return PF.parseScaled(x, 8); }, pr = function (x) { return PF.parseScaled(x, 6); };
    function T(a, mBack, day, side, qty, price, fee, fx) {
      var d = L.ymdOf(addMonths(nowYm, -mBack), day); if (d > today) d = today;
      var t = { id: uid(), assetId: a.id, date: d, side: side, qty: q(qty), price: pr(price), fee: fee || 0, currency: a.currency, fxRate: a.currency === 'TRY' ? null : fx, note: '', source: 'örnek' };
      s.trades.push(t); return t;
    }
    s.trades = [];
    /* KTV — 18 ay, düzenli alım + kârlı kısmi satış */
    T(ktv, 18, 10, 'buy', '12000', '2,52', 0);
    T(ktv, 16, 11, 'buy', '5000', '2,58', 0);
    T(ktv, 14, 9, 'buy', '5000', '2,64', 0);
    T(ktv, 12, 10, 'buy', '5000', '2,70', 0);
    T(ktv, 10, 12, 'buy', '8000', '2,85', 0);
    T(ktv, 8, 8, 'buy', '4000', '2,94', 0);
    T(ktv, 6, 8, 'sell', '5000', '3,00', 0);
    T(ktv, 4, 8, 'buy', '4000', '3,06', 0);
    T(ktv, 2, 7, 'buy', '4000', '3,12', 0);
    /* KTN */
    T(ktn, 15, 14, 'buy', '8000', '2,35', 0);
    T(ktn, 12, 16, 'buy', '4000', '2,45', 0);
    T(ktn, 9, 15, 'buy', '4000', '2,55', 0);
    T(ktn, 6, 14, 'buy', '3000', '2,65', 0);
    T(ktn, 3, 13, 'buy', '3000', '2,75', 0);
    /* Gram altın */
    T(gold, 14, 20, 'buy', '8', '3050', 0);
    T(gold, 8, 18, 'buy', '4', '3800', 0);
    T(gold, 3, 16, 'buy', '3', '4800', 0);
    /* Gram gümüş + kârlı kısmi satış */
    T(silver, 12, 6, 'buy', '150', '40,00', 0);
    T(silver, 6, 7, 'buy', '150', '50,00', 0);
    T(silver, 2, 5, 'sell', '30', '58,00', 0);
    /* ASELS + kârlı kısmi satış (komisyonlu) */
    T(asels, 12, 5, 'buy', '200', '62,40', 1248);
    T(asels, 7, 9, 'buy', '100', '78,00', 780);
    T(asels, 3, 11, 'sell', '50', '95,00', 475);
    /* EREGL */
    T(eregl, 10, 8, 'buy', '200', '34,00', 680);
    T(eregl, 4, 10, 'buy', '150', '42,00', 630);
    /* SPUS (USD, emeklilik) */
    T(spus, 18, 15, 'buy', '20', '38,50', 100, 3350);
    T(spus, 10, 14, 'buy', '15', '42,10', 100, 3780);
    T(spus, 4, 6, 'buy', '10', '44,80', 100, 4080);
    /* HLAL (USD, emeklilik) */
    T(hlal, 16, 12, 'buy', '10', '42,00', 100, 3420);
    T(hlal, 8, 10, 'buy', '8', '47,00', 100, 3850);
    T(hlal, 3, 9, 'buy', '6', '50,50', 100, 4120);
    /* Bitcoin / Ethereum (şüpheli etiket) */
    T(btc, 12, 3, 'buy', '0,003', '1800000', 2000);
    T(btc, 7, 3, 'buy', '0,002', '2400000', 3000);
    T(eth, 11, 4, 'buy', '0,08', '70000', 1500);
    T(eth, 5, 5, 'buy', '0,05', '95000', 1500);

    /* Aylık fiyat geçmişi (ay sonları) + dün: doğrusal örnek seri. Her noktada kaynak=ÖRNEK ve saat damgası var. */
    s.prices = {};
    function series(key, cur, fromVal, toVal, months) {
      var a = pr(fromVal), b = pr(toVal);
      for (var i = months; i >= 1; i--) {
        var ym = addMonths(nowYm, -i), d = L.ymdOf(ym, 31), v = a + Math.round((b - a) * (months - i) / months);
        PF.addPricePoint(s.prices, key, cur, { d: d, p: v, src: EX, at: atOf(d) });
      }
      var y = addDays(today, -1);
      PF.addPricePoint(s.prices, key, cur, { d: y, p: b, src: EX, at: atOf(y) });
    }
    series('m:' + ktv.id, 'TRY', '2,40', '3,18', 24);
    series('m:' + ktn.id, 'TRY', '2,20', '2,85', 24);
    series('td:SPUS', 'USD', '36,00', '46,20', 24);
    series('td:HLAL', 'USD', '40,00', '52,40', 24);
    series('metal:XAU', 'TRY', '2600', '5400', 24);
    series('metal:XAG', 'TRY', '32,00', '62,00', 24);
    series('m:' + asels.id, 'TRY', '55,00', '101,50', 24);
    series('m:' + eregl.id, 'TRY', '28,00', '48,20', 24);
    series('cg:bitcoin', 'TRY', '1500000', '3000000', 24);
    series('cg:ethereum', 'TRY', '60000', '120000', 24);
    series('fx:USD', 'TRY', '32,00', '42,50', 24);
    series('fx:EUR', 'TRY', '35,00', '49,00', 24);
    series('idx:XU100', 'PT', '9000', '11500', 24);
    /* TÜFE (aylık % değişim, örnek seri) — son 24 ay, bu ay henüz açıklanmamış gibi */
    s.cpi = [];
    for (var i = 24; i >= 1; i--) s.cpi.push({ ym: addMonths(nowYm, -i), bp: 150 + ((i * 37) % 120) });
    acc.katilim.halal = H('uygun', 'Katılım bankası, kâr payı'); acc.bank.halal = H('uygun', 'Vadesiz hesap, faiz işlemiyor');
    acc.gold.halal = H('uygun', 'Katılım bankası altın hesabı'); acc.usd.halal = H('uygun', 'Nakit döviz');
    s.settings.riskRules = JSON.parse(JSON.stringify(PF.DEFAULT_RULES));
    s.settings.rebalance = { tierBandBp: 500, assetBandBp: 300 };
    PF.sync(s, today);
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
    if (s.schema === 2) {
      if (!Array.isArray(s.trades)) s.trades = [];
      if (!s.prices || typeof s.prices !== 'object' || Array.isArray(s.prices)) s.prices = {};
      if (!Array.isArray(s.cpi)) s.cpi = [];
      if (!Array.isArray(s.goals) || !s.goals.length) s.goals = s.goal ? goalsFrom(s.goal) : [];
      // Eski kurlardan fiyat geçmişine ilk nokta (kaynak: kullanıcı girişi) — kıyas ve varlık fiyatları için
      if (s.rates && typeof s.rates === 'object') ['USD', 'EUR'].forEach(function (c) { var r = s.rates[c]; if (r && Number.isInteger(r.rate) && r.rate > 0 && L.isYmd(r.date)) PF.addPricePoint(s.prices, 'fx:' + c, 'TRY', { d: r.date, p: PF.fxPriceFromKurus(r.rate), src: 'Kullanıcı girişi (kur)', at: null }); });
      if (s.rates && s.rates.XAU && Number.isInteger(s.rates.XAU.rate) && s.rates.XAU.rate > 0 && L.isYmd(s.rates.XAU.date)) PF.addPricePoint(s.prices, 'metal:XAU', 'TRY', { d: s.rates.XAU.date, p: PF.fxPriceFromKurus(s.rates.XAU.rate), src: 'Kullanıcı girişi (kur)', at: null });
      s.schema = 3;
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
    // Net varlık geçmişi (isteğe bağlı, yalnızca grafik için): geçersiz noktalar sessizce atılır, tarihler sıralı ve tekil tutulur
    if (s.nwHistory != null) {
      var nwBy = {};
      (Array.isArray(s.nwHistory) ? s.nwHistory : []).forEach(function (p) { if (p && typeof p.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.d) && isK(p.v)) nwBy[p.d] = p.v; });
      s.nwHistory = Object.keys(nwBy).sort().slice(-400).map(function (d) { return { d: d, v: nwBy[d] }; });
    }
    ['incomes', 'expenses', 'assets', 'debts', 'transactions', 'accounts', 'transfers', 'recurring', 'installments', 'sinkingFunds', 'trades', 'cpi', 'goals'].forEach(function (k) { if (!Array.isArray(s[k])) errs.push(k + ' listesi eksik'); });
    ['rates', 'limits', 'prices'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) errs.push(k + ' bilgisi eksik'); });
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
      // ---- v3: portföy ----
      var HS = PF.HALAL;
      function badHalal(h) { return h != null && (typeof h !== 'object' || !HS[h.status] || (h.note != null && (typeof h.note !== 'string' || h.note.length > 300)) || (h.source != null && (typeof h.source !== 'string' || h.source.length > 300)) || (h.date != null && !L.isYmd(h.date))); }
      s.accounts.forEach(function (a, i) { if (badHalal(a.halal)) errs.push('Hesap ' + (i + 1) + ': helal etiketi hatalı'); });
      var goalIds = {}, shareSum = 0;
      if (!s.goals.length) errs.push('En az bir hedef olmalı');
      s.goals.forEach(function (g, i) {
        var n = 'Hedef ' + (i + 1);
        if (!isStr(g.id, 64) || goalIds[g.id]) errs.push(n + ': kimlik hatalı/tekrarlı'); goalIds[g.id] = true;
        if (!isStr(g.name, 60)) errs.push(n + ': ad hatalı');
        if (!isK(g.target) || g.target < 0) errs.push(n + ': tutar hatalı');
        if (!L.isYm(g.targetYm)) errs.push(n + ': tarih hatalı');
        if (!PF.GLIDES[g.glide]) errs.push(n + ': risk profili hatalı');
        if (!isPosInt(g.shareBp, 0, 10000)) errs.push(n + ': pay hatalı (%0–100)'); else shareSum += g.shareBp;
      });
      if (shareSum > 10000) errs.push('Hedeflerin aylık birikimden aldığı payların toplamı %100\'ü geçemez (şu an %' + (shareSum / 100) + ')');
      var assetIds = {};
      s.assets.forEach(function (a, i) {
        var n = 'Varlık ' + (i + 1);
        if (a.id != null) { if (assetIds[a.id]) errs.push(n + ': kimlik tekrarlı'); assetIds[a.id] = a; }
        if (a.cls != null && !C.ASSET_CLASSES[a.cls]) errs.push(n + ': tür hatalı');
        if (a.tracking != null && a.tracking !== 'manual' && a.tracking !== 'trades') errs.push(n + ': izleme biçimi hatalı');
        if (a.tracking === 'trades' && !isStr(a.id, 64)) errs.push(n + ': kimlik gerekli');
        if (a.currency != null && ['TRY', 'USD', 'EUR'].indexOf(a.currency) < 0) errs.push(n + ': para birimi hatalı');
        if (a.symbol != null && a.symbol !== '' && !isStr(a.symbol, 30)) errs.push(n + ': sembol hatalı');
        if (a.lot != null && !PF.LOTS[a.lot]) errs.push(n + ': adet türü hatalı');
        if (a.priceKey != null) { var ki = PF.keyInfo(a.priceKey); if (!ki || ki.kind === 'manual') errs.push(n + ': fiyat kaynağı hatalı'); else if (ki.cur !== (a.currency || 'TRY')) errs.push(n + ': fiyat kaynağının para birimi (' + ki.cur + ') varlığınkiyle aynı olmalı'); }
        if (a.withinTierBp != null && !isPosInt(a.withinTierBp, 0, 10000)) errs.push(n + ': hedef payı hatalı (%0–100)');
        if (a.goalId != null && !goalIds[a.goalId]) errs.push(n + ': bağlı hedef bulunamadı');
        if (badHalal(a.halal)) errs.push(n + ': helal etiketi hatalı');
      });
      var tradeIds = {}, byAsset = {};
      s.trades.forEach(function (t, i) {
        var n = 'Alım-satım ' + (i + 1), a = assetIds[t.assetId];
        if (!isStr(t.id, 64) || tradeIds[t.id]) errs.push(n + ': kimlik hatalı/tekrarlı'); tradeIds[t.id] = true;
        if (!a) { errs.push(n + ': varlık bulunamadı'); return; }
        if (a.tracking !== 'trades') errs.push(n + ': varlık alım-satımla izlenmiyor');
        if (!L.isYmd(t.date)) errs.push(n + ': tarih hatalı');
        if (t.side !== 'buy' && t.side !== 'sell') errs.push(n + ': alış/satış hatalı');
        if (!isK(t.qty) || t.qty <= 0) errs.push(n + ': adet hatalı');
        if (!isK(t.price) || t.price <= 0) errs.push(n + ': fiyat hatalı');
        if (!isK(t.fee) || t.fee < 0) errs.push(n + ': komisyon hatalı');
        if (t.currency !== (a.currency || 'TRY')) errs.push(n + ': para birimi varlığınkiyle aynı olmalı');
        else if (t.currency !== 'TRY' && (!isK(t.fxRate) || t.fxRate <= 0)) errs.push(n + ': işlem günündeki kur gerekli');
        if (t.currency === 'TRY' && t.fxRate != null) errs.push(n + ': TL işlemde kur olmaz');
        if (t.note != null && (typeof t.note !== 'string' || t.note.length > 200)) errs.push(n + ': not hatalı');
        (byAsset[t.assetId] = byAsset[t.assetId] || []).push(t);
      });
      if (!errs.length) Object.keys(byAsset).forEach(function (id) { var lg = PF.ledger(byAsset[id]); lg.errors.forEach(function (e) { errs.push(assetIds[id].name + ': ' + e); }); });
      Object.keys(s.prices).forEach(function (k) {
        var h = s.prices[k], ki = PF.keyInfo(k);
        if (!ki) { errs.push('Fiyat: bilinmeyen kaynak ' + k); return; }
        if (!h || !Array.isArray(h.points)) { errs.push('Fiyat ' + k + ': liste eksik'); return; }
        var prev = '';
        h.points.forEach(function (pt) {
          if (!pt || !L.isYmd(pt.d) || !isK(pt.p) || pt.p <= 0) errs.push('Fiyat ' + k + ': nokta hatalı');
          else if (pt.d <= prev) errs.push('Fiyat ' + k + ': tarihler sıralı ve tekil olmalı');
          else prev = pt.d;
          if (pt && pt.src != null && (typeof pt.src !== 'string' || pt.src.length > 160)) errs.push('Fiyat ' + k + ': kaynak hatalı');
        });
      });
      var cpiSeen = {};
      s.cpi.forEach(function (c, i) { if (!c || !L.isYm(c.ym) || cpiSeen[c.ym] || !Number.isInteger(c.bp) || c.bp < -5000 || c.bp > 20000) errs.push('TÜFE ' + (i + 1) + ': ay veya oran hatalı'); else cpiSeen[c.ym] = true; });
      var rr = s.settings && s.settings.riskRules;
      if (rr != null && (typeof rr !== 'object' || (rr.maxAssetBp != null && !isPosInt(rr.maxAssetBp, 500, 10000)) || (rr.maxRiskyBp != null && !isPosInt(rr.maxRiskyBp, 0, 10000)) || (rr.minPositions != null && !isPosInt(rr.minPositions, 1, 20)) || (rr.emergencyFirst != null && typeof rr.emergencyFirst !== 'boolean'))) errs.push('Risk kuralları hatalı');
      var rb = s.settings && s.settings.rebalance;
      if (rb != null && (typeof rb !== 'object' || !isPosInt(rb.tierBandBp, 0, 5000) || !isPosInt(rb.assetBandBp, 0, 5000))) errs.push('Dengeleme ayarı hatalı');
      if (!s.goal || !isK(s.goal.target) || !/^\d{4}-\d{2}$/.test(s.goal.targetYm || '')) errs.push('Hedef bilgisi hatalı');
      if (!s.settings || !Number.isInteger(s.settings.emergencyMonths)) errs.push('Ayarlar hatalı');
    }
    if (errs.length) throw new Error(errs.slice(0, 8).join('; ') + (errs.length > 8 ? ' …' : ''));
    var d = defaultSettings();
    Object.keys(d).forEach(function (k) { if (s.settings[k] == null) s.settings[k] = d[k]; });
    Object.keys(d.riskRules).forEach(function (k) { if (s.settings.riskRules[k] == null) s.settings.riskRules[k] = d.riskRules[k]; });
    PF.sync(s);
    return s;
  }
  return { SCHEMA_VERSION: SCHEMA_VERSION, EXAMPLE_REVISION: EXAMPLE_REVISION, uid: uid, addDays: addDays, emptyState: emptyState, exampleState: exampleState, validateState: validateState, migrate: migrate,
    defaultSettings: defaultSettings, addMonths: addMonths, todayYmd: todayYmd, shouldRefreshExample: shouldRefreshExample };
});
