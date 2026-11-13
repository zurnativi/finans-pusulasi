/* sample.js — Boş durum, ÖRNEK veri ve yedek dosyası doğrulama/şema. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.Sample = factory(root.Calc);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var SCHEMA_VERSION = 1;
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function defaultSettings() {
    return { emergencyMonths: 6, emergencyShareBp: 5000, inflationBp: 2500, view: 'simple',
      scenarios: JSON.parse(JSON.stringify(C.DEFAULT_SCENARIOS)) };
  }
  function addMonths(ym, n) { return C.ymFromIndex(C.monthIndex(ym) + n); }
  function emptyState(nowYm) {
    nowYm = nowYm || C.currentYm();
    return { schema: SCHEMA_VERSION, isExample: false, updatedAt: null, incomes: [], expenses: [], assets: [], debts: [], transactions: [],
      goal: { name: 'Ev peşinatı', target: 0, targetYm: addMonths(nowYm, 60) }, settings: defaultSettings() };
  }
  function exampleState(nowYm) {
    nowYm = nowYm || C.currentYm();
    var s = emptyState(nowYm);
    s.isExample = true;
    s.incomes = [{ id: uid(), name: 'Maaş (net)', amount: 6000000 }];
    s.expenses = [
      { id: uid(), name: 'Kira', type: 'fixed', amount: 2000000 },
      { id: uid(), name: 'Faturalar (elektrik, su, doğalgaz, internet)', type: 'fixed', amount: 450000 },
      { id: uid(), name: 'Ulaşım', type: 'fixed', amount: 350000 },
      { id: uid(), name: 'Market (temel)', type: 'fixed', amount: 550000 },
      { id: uid(), name: 'Sigorta / diğer sabit', type: 'fixed', amount: 150000 },
      { id: uid(), name: 'Dışarıda yemek, eğlence', type: 'variable', amount: 400000 },
      { id: uid(), name: 'Giyim, kişisel bakım', type: 'variable', amount: 300000 },
      { id: uid(), name: 'Beklenmeyen / diğer', type: 'variable', amount: 300000 }
    ];
    s.assets = [
      { id: uid(), name: 'Katılım hesabı (vadesiz TL)', cls: 'cash', risk: 'safe', emergency: true, value: 10000000 },
      { id: uid(), name: 'Altın (gram)', cls: 'gold', risk: 'medium', emergency: false, value: 12000000 },
      { id: uid(), name: 'Katılım fonu', cls: 'katilim_fund', risk: 'medium', emergency: false, value: 10000000 },
      { id: uid(), name: 'Helal ETF (ör. SPUS)', cls: 'halal_etf', risk: 'risky', emergency: false, value: 8000000 }
    ];
    s.goal = { name: 'Ev peşinatı', target: 150000000, targetYm: addMonths(nowYm, 60) };
    var y = nowYm;
    s.transactions = [
      { id: uid(), date: y + '-01', description: 'Maaş', amount: 6000000, category: 'Gelir', source: 'örnek' },
      { id: uid(), date: y + '-02', description: 'Kira', amount: -2000000, category: 'Kira/Konut', source: 'örnek' },
      { id: uid(), date: y + '-03', description: 'Market alışverişi', amount: -184590, category: 'Market', source: 'örnek' },
      { id: uid(), date: y + '-05', description: 'Elektrik faturası', amount: -96040, category: 'Faturalar', source: 'örnek' },
      { id: uid(), date: y + '-07', description: 'Akaryakıt', amount: -150000, category: 'Ulaşım', source: 'örnek' },
      { id: uid(), date: y + '-09', description: 'Restoran', amount: -85000, category: 'Yeme-içme', source: 'örnek' }
    ];
    return s;
  }

  /* Yedek dosyasını sıkı doğrular; hatalıysa açıklayıcı hata fırlatır (bozuk veri asla yüklenmez). */
  function validateState(s) {
    var errs = [];
    function isK(v) { return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER; }
    if (!s || typeof s !== 'object') throw new Error('Dosya geçerli bir yedek değil');
    if (s.schema !== SCHEMA_VERSION) errs.push('Desteklenmeyen sürüm: ' + s.schema);
    ['incomes', 'expenses', 'assets', 'debts', 'transactions'].forEach(function (k) { if (!Array.isArray(s[k])) errs.push(k + ' listesi eksik'); });
    if (!errs.length) {
      s.incomes.forEach(function (x, i) { if (!isK(x.amount) || x.amount < 0) errs.push('Gelir ' + (i + 1) + ': tutar hatalı'); });
      s.expenses.forEach(function (x, i) { if (!isK(x.amount) || x.amount < 0) errs.push('Gider ' + (i + 1) + ': tutar hatalı'); if (x.type !== 'fixed' && x.type !== 'variable') errs.push('Gider ' + (i + 1) + ': tür hatalı'); });
      s.assets.forEach(function (x, i) { if (!isK(x.value) || x.value < 0) errs.push('Varlık ' + (i + 1) + ': değer hatalı'); if (['safe', 'medium', 'risky'].indexOf(x.risk) < 0) errs.push('Varlık ' + (i + 1) + ': risk hatalı'); });
      s.debts.forEach(function (x, i) { if (!isK(x.amount) || x.amount < 0) errs.push('Borç ' + (i + 1) + ': tutar hatalı'); });
      s.transactions.forEach(function (x, i) { if (!isK(x.amount)) errs.push('İşlem ' + (i + 1) + ': tutar hatalı'); if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '')) errs.push('İşlem ' + (i + 1) + ': tarih hatalı'); });
      if (!s.goal || !isK(s.goal.target) || !/^\d{4}-\d{2}$/.test(s.goal.targetYm || '')) errs.push('Hedef bilgisi hatalı');
      if (!s.settings || !Number.isInteger(s.settings.emergencyMonths)) errs.push('Ayarlar hatalı');
    }
    if (errs.length) throw new Error(errs.slice(0, 8).join('; ') + (errs.length > 8 ? ' …' : ''));
    var d = defaultSettings();
    Object.keys(d).forEach(function (k) { if (s.settings[k] == null) s.settings[k] = d[k]; });
    return s;
  }
  return { SCHEMA_VERSION: SCHEMA_VERSION, uid: uid, emptyState: emptyState, exampleState: exampleState, validateState: validateState, defaultSettings: defaultSettings, addMonths: addMonths };
});
