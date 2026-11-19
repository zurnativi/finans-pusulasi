/* calc.js — Finansal hesap motoru. Tüm tutarlar tam sayı kuruş; oranlar baz puan (10000 = %100). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'));
  else root.Calc = factory(root.Money);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var RISK = { safe: 'Güvenli', medium: 'Orta', risky: 'Riskli' };
  var ASSET_CLASSES = {
    cash: { label: 'Nakit / Katılım hesabı', risk: 'safe', emergency: true },
    gold: { label: 'Altın', risk: 'medium', emergency: false },
    katilim_fund: { label: 'Katılım fonu', risk: 'medium', emergency: false },
    sukuk: { label: 'Kira sertifikası (sukuk) fonu', risk: 'safe', emergency: false },
    halal_etf: { label: 'Helal ETF (ör. SPUS, HLAL)', risk: 'risky', emergency: false },
    katilim_stock: { label: 'Katılım endeksi hissesi', risk: 'risky', emergency: false },
    crypto: { label: 'Kripto para', risk: 'risky', emergency: false },
    other: { label: 'Diğer', risk: 'medium', emergency: false }
  };

  /* ---------- Tarih yardımcıları ---------- */
  function monthIndex(ym) { // "2026-11" -> mutlak ay sayısı
    var m = /^(\d{4})-(\d{2})$/.exec(ym || '');
    if (!m) throw new Error('Geçersiz ay: ' + ym);
    var mo = +m[2]; if (mo < 1 || mo > 12) throw new Error('Geçersiz ay: ' + ym);
    return (+m[1]) * 12 + (mo - 1);
  }
  function ymFromIndex(i) { var y = Math.floor(i / 12), mo = i % 12 + 1; return y + '-' + (mo < 10 ? '0' : '') + mo; }
  function monthsBetween(fromYm, toYm) { return monthIndex(toYm) - monthIndex(fromYm); }
  function currentYm(d) { d = d || new Date(); var mo = d.getMonth() + 1; return d.getFullYear() + '-' + (mo < 10 ? '0' : '') + mo; }

  /* ---------- Bütçe ---------- */
  function budget(state) {
    var incomes = (state.incomes || []).map(function (x) { return x.amount; });
    var fixed = [], variable = [];
    (state.expenses || []).forEach(function (e) { (e.type === 'fixed' ? fixed : variable).push(e.amount); });
    var income = M.sum(incomes), fixedT = M.sum(fixed), varT = M.sum(variable);
    var expense = M.add(fixedT, varT);
    var surplus = M.sub(income, expense);
    return {
      income: income, fixed: fixedT, variable: varT, expense: expense, surplus: surplus,
      savingsRateBp: M.ratioBp(surplus, income),
      fixedRatioBp: M.ratioBp(fixedT, income),
      variableRatioBp: M.ratioBp(varT, income)
    };
  }

  /* ---------- Varlıklar ---------- */
  function assets(state) {
    var byRisk = { safe: 0, medium: 0, risky: 0 }, emByRisk = { safe: 0, medium: 0, risky: 0 }, byClass = {}, emergencyEligible = 0, total = 0;
    (state.assets || []).forEach(function (a) {
      var risk = a.risk || (ASSET_CLASSES[a.cls] || ASSET_CLASSES.other).risk;
      byRisk[risk] = M.add(byRisk[risk], a.value);
      byClass[a.cls] = M.add(byClass[a.cls] || 0, a.value);
      if (a.emergency) { emergencyEligible = M.add(emergencyEligible, a.value); emByRisk[risk] = M.add(emByRisk[risk], a.value); }
      total = M.add(total, a.value);
    });
    var debts = M.sum((state.debts || []).map(function (d) { return d.amount; }));
    return { total: total, debts: debts, netWorth: M.sub(total, debts), byRisk: byRisk, emByRisk: emByRisk, byClass: byClass, emergencyEligible: emergencyEligible };
  }

  /* ---------- Acil durum fonu ---------- */
  function emergency(state, b, a) {
    var months = state.settings.emergencyMonths;
    var target = M.mulRatio(b.expense, months, 1);
    var current = Math.min(a.emergencyEligible, target);
    var shortfall = M.sub(target, current);
    return { months: months, target: target, current: current, shortfall: shortfall,
      progressBp: target ? M.ratioBp(current, target) : 10000,
      coverMonthsX100: b.expense ? M.mulRatio(a.emergencyEligible, 100, b.expense) : 0 };
  }

  /* ---------- Hedefe göre hedef dağılım (süzülme yolu / glide path) ----------
   * Hedefe kalan süre kısaldıkça riskli pay azalır. Çapa noktaları arasında doğrusal geçiş yapılır. */
  var GLIDE = [ // [kalan ay, güvenli bp, orta bp, riskli bp]
    [0, 10000, 0, 0],
    [12, 8000, 2000, 0],
    [36, 5500, 3000, 1500],
    [60, 4000, 3500, 2500]
  ];
  function targetAllocation(monthsLeft, glide) {
    var G = glide || GLIDE; // isteğe bağlı farklı süzülme yolu (hedef başına profil)
    var m = Math.max(0, monthsLeft);
    if (m >= G[G.length - 1][0]) { var l = G[G.length - 1]; return { safe: l[1], medium: l[2], risky: l[3] }; }
    for (var i = 1; i < G.length; i++) {
      var lo = G[i - 1], hi = G[i];
      if (m <= hi[0]) {
        var t = (m - lo[0]) / (hi[0] - lo[0]);
        var risky = Math.round(lo[3] + (hi[3] - lo[3]) * t);
        var medium = Math.round(lo[2] + (hi[2] - lo[2]) * t);
        return { safe: 10000 - risky - medium, medium: medium, risky: risky };
      }
    }
  }

  /* ---------- Bu ayın planı ----------
   * Sıra: 1) acil fon eksikse fazlanın belirlenen payı acil fona; 2) kalan, hedef dağılıma göre. Kuruşu kuruşuna dağıtılır. */
  /* Ortak kural (Ana sayfa planı, projeksiyon ve Portföy dengelemesi aynı kuralı kullanır):
   * "Önce acil durum fonu" risk kuralı açıksa ve acil fon eksikse riskli alım önerilmez; o pay güvenli/orta kovaya kayar. */
  function riskyBlocked(state, em) {
    var rr = (state && state.settings && state.settings.riskRules) || {};
    return rr.emergencyFirst !== false && !!em && em.shortfall > 0;
  }
  function shareBp(state) { var v = state && state.settings ? state.settings.emergencyShareBp : null; return typeof v === 'number' && v >= 0 && v <= 10000 ? v : 5000; }
  function monthlyPlan(state, b, em, alloc) {
    var surplus = Math.max(0, b.surplus);
    var toEmergency = 0;
    if (em.shortfall > 0 && surplus > 0) toEmergency = Math.min(em.shortfall, M.mulBp(surplus, shareBp(state)));
    var toInvest = M.sub(surplus, toEmergency);
    var blocked = riskyBlocked(state, em);
    var w = blocked ? [alloc.safe, alloc.medium, 0] : [alloc.safe, alloc.medium, alloc.risky];
    if (blocked && w[0] + w[1] === 0) w = [1, 0, 0];
    var parts = M.allocate(toInvest, w);
    return { surplus: surplus, toEmergency: toEmergency, toInvest: toInvest, safe: parts[0], medium: parts[1], risky: parts[2],
      riskyBlocked: blocked, riskyHeld: blocked ? M.allocate(toInvest, [alloc.safe, alloc.medium, alloc.risky])[2] : 0,
      deficit: b.surplus < 0 ? -b.surplus : 0 };
  }

  /* ---------- Hedef ilerlemesi ---------- */
  function goalStatus(state, a, em, nowYm) {
    var g = state.goal;
    var monthsLeft = Math.max(0, monthsBetween(nowYm, g.targetYm));
    var forGoal = Math.max(0, M.sub(a.netWorth, em.current)); // acil fon ayrıldıktan sonra kalan
    var remaining = Math.max(0, M.sub(g.target, forGoal));
    var neededMonthly = monthsLeft > 0 ? M.mulRatio(remaining, 1, monthsLeft) : remaining; // getirisiz basit ihtiyaç
    return { name: g.name, target: g.target, targetYm: g.targetYm, monthsLeft: monthsLeft, current: forGoal,
      remaining: remaining, progressBp: g.target ? Math.min(10000, M.ratioBp(forGoal, g.target)) : 0, neededMonthly: neededMonthly };
  }

  /* ---------- Projeksiyon (bugünün parasıyla = reel) ----------
   * Senaryo getirileri REEL yıllık getiri varsayımıdır (enflasyon üstü/altı). Aylık katkı reel olarak sabit kabul edilir
   * (yani maaş ve katkı enflasyonla birlikte artar). Hedef tutarı da bugünün fiyatıyla düşünülür.
   * Nominal değer = reel × (1+enflasyon)^(yıl). Her ay sonuç kuruşa yuvarlanır. */
  function monthlyRate(annualBp) { return Math.pow(1 + annualBp / 10000, 1 / 12) - 1; }
  function project(opts) {
    // opts: start{safe,medium,risky} (acil fon HARİÇ yatırım kovaları), reserveStart (acil fon), monthlyContribution,
    //       emergencyTopUp (acil fona tamamlanacak toplam), emergencyShareBp (acil fon dolana kadar katkının acile giden payı; yoksa %100),
    //       blockRiskyUntilEmergency (acil fon dolana kadar riskli pay güvenli/orta kovaya), months, monthsToGoal, returnsBp{safe,medium,risky}, inflationBp
    // Acil fon reel olarak sabit kabul edilir (katılım hesabı ≈ enflasyon kadar kâr payı varsayımı).
    // Taşma koruması: tüm toplamlar doymalı (M.satAdd); 10 trilyon TL üstü "çok büyük" olarak işaretlenir, hesap asla hata atmaz.
    var S = M.satAdd, F = M.satMulFloat;
    var bal = { safe: M.clampK(opts.start.safe), medium: M.clampK(opts.start.medium), risky: M.clampK(opts.start.risky) };
    var reserve = M.clampK(opts.reserveStart || 0);
    var r = { safe: monthlyRate(opts.returnsBp.safe), medium: monthlyRate(opts.returnsBp.medium), risky: monthlyRate(opts.returnsBp.risky) };
    var series = [], infM = monthlyRate(opts.inflationBp || 0), infFactor = 1, capped = false;
    var emLeft = M.clampK(opts.emergencyTopUp || 0);
    var share = opts.emergencyShareBp == null ? 10000 : Math.max(0, Math.min(10000, Math.round(opts.emergencyShareBp)));
    var contrib = M.clampK(opts.monthlyContribution || 0);
    function push(m) {
      var inv = S(bal.safe, bal.medium, bal.risky), tot = S(inv, reserve);
      var p = { m: m, invest: inv, reserve: reserve, total: tot, nominalTotal: F(tot, infFactor), nominalInvest: F(inv, infFactor) };
      if (M.isCapped(p.nominalTotal) || M.isCapped(tot)) { p.capped = true; capped = true; }
      series.push(p);
    }
    push(0);
    for (var m = 1; m <= opts.months; m++) {
      ['safe', 'medium', 'risky'].forEach(function (k) { bal[k] = S(bal[k], F(bal[k], r[k])); });
      var c = contrib;
      var em = emLeft > 0 && c > 0 ? Math.min(emLeft, share >= 10000 ? c : M.mulBp(c, share)) : 0;
      emLeft = emLeft - em; reserve = S(reserve, em); c = c - em;
      var al = targetAllocation(opts.monthsToGoal - m, opts.glide);
      var w = [al.safe, al.medium, al.risky];
      if (opts.blockRiskyUntilEmergency && emLeft > 0) { w = [al.safe, al.medium, 0]; if (w[0] + w[1] === 0) w = [1, 0, 0]; }
      var parts = M.allocate(c, w);
      bal.safe = S(bal.safe, parts[0]); bal.medium = S(bal.medium, parts[1]); bal.risky = S(bal.risky, parts[2]);
      infFactor *= (1 + infM); if (!isFinite(infFactor)) infFactor = Number.MAX_VALUE;
      push(m);
    }
    series.capped = capped;
    return series;
  }
  function firstMonthReaching(series, target) {
    for (var i = 0; i < series.length; i++) if (series[i].invest >= target) return series[i].m;
    return null;
  }

  var DEFAULT_SCENARIOS = {
    pessimistic: { label: 'Kötümser', returnsBp: { safe: -300, medium: -500, risky: -1500 } },
    base: { label: 'Temel', returnsBp: { safe: 0, medium: 300, risky: 600 } },
    optimistic: { label: 'İyimser', returnsBp: { safe: 200, medium: 700, risky: 1200 } }
  };

  /* ---------- Gerçekleşen harcamalar (işlemler) ---------- */
  function monthActuals(transactions, ym) {
    var inc = 0, exp = 0, byCat = {};
    (transactions || []).forEach(function (t) {
      if (!t.date || t.date.slice(0, 7) !== ym) return;
      if (t.category === 'Transfer') return; // hesaplar arası / kart borcu ödemesi: çift sayımı önle
      if (t.amount >= 0) inc = M.add(inc, t.amount);
      else { exp = M.add(exp, -t.amount); byCat[t.category || 'Diğer'] = M.add(byCat[t.category || 'Diğer'] || 0, -t.amount); }
    });
    return { income: inc, expense: exp, net: M.sub(inc, exp), byCategory: byCat };
  }

  /* ---------- Hepsini bir arada ---------- */
  function analyze(state, nowYm) {
    nowYm = nowYm || currentYm();
    var b = budget(state), a = assets(state), em = emergency(state, b, a);
    var g = goalStatus(state, a, em, nowYm);
    var alloc = targetAllocation(g.monthsLeft);
    var plan = monthlyPlan(state, b, em, alloc);
    // Acil fon olarak ayrılan tutar, ilgili risk kovalarından orantılı düşülür; kalan = hedef için yatırım kısmı
    var resParts = M.allocate(em.current, [a.emByRisk.safe, a.emByRisk.medium, a.emByRisk.risky]);
    var invest = { safe: M.sub(a.byRisk.safe, resParts[0]), medium: M.sub(a.byRisk.medium, resParts[1]), risky: M.sub(a.byRisk.risky, resParts[2]) };
    // Borçlar yatırım kovalarından değil net değerden düşülür; projeksiyon başlangıcında güvenli kovadan düşülür
    var investTotal = M.add(invest.safe, invest.medium, invest.risky);
    var currentAlloc = { safe: M.ratioBp(invest.safe, investTotal), medium: M.ratioBp(invest.medium, investTotal), risky: M.ratioBp(invest.risky, investTotal) };
    var startBuckets = { safe: M.sub(invest.safe, Math.min(invest.safe, a.debts)), medium: invest.medium, risky: invest.risky };
    var horizon = Math.max(g.monthsLeft, 12) + 24;
    var scenarios = {};
    var sc = state.settings.scenarios || DEFAULT_SCENARIOS;
    Object.keys(sc).forEach(function (key) {
      var series = project({ start: startBuckets, reserveStart: em.current, monthlyContribution: plan.surplus, emergencyTopUp: em.shortfall,
        emergencyShareBp: shareBp(state), blockRiskyUntilEmergency: riskyBlocked(state, em), months: horizon, monthsToGoal: g.monthsLeft, returnsBp: sc[key].returnsBp, inflationBp: state.settings.inflationBp });
      var atGoal = series[Math.min(g.monthsLeft, series.length - 1)];
      scenarios[key] = { label: sc[key].label, returnsBp: sc[key].returnsBp, series: series, atGoal: atGoal.invest, atGoalNominal: atGoal.nominalInvest, capped: !!series.capped,
        reachMonth: firstMonthReaching(series, g.target) };
    });
    // Sapma uyarıları (rebalans)
    var drift = { safe: currentAlloc.safe - alloc.safe, medium: currentAlloc.medium - alloc.medium, risky: currentAlloc.risky - alloc.risky };
    return { nowYm: nowYm, budget: b, assets: a, emergency: em, goal: g, targetAlloc: alloc, currentAlloc: currentAlloc, invest: invest, investTotal: investTotal, drift: drift,
      plan: plan, scenarios: scenarios, actuals: monthActuals(state.transactions, nowYm) };
  }

  /* ---------- Bu ay ne yapmalıyım? (sade öneri listesi) ---------- */
  function actions(an) {
    var out = [];
    if (an.budget.surplus < 0) out.push({ level: 'danger', text: 'Giderlerin gelirinden ' + M.format(-an.budget.surplus, { noDecimals: true }) + ' fazla. Önce değişken giderleri azalt; bu ay yatırım yapma.' });
    var em = an.emergency;
    if (an.plan.toEmergency > 0) out.push({ level: 'warn', text: 'Bu ay ' + M.format(an.plan.toEmergency, { noDecimals: true }) + ' tutarını acil durum fonuna (katılım hesabı / vadesiz TL) ayır. Kalan eksik: ' + M.format(em.shortfall, { noDecimals: true }) + '.' });
    else if (em.shortfall > 0) out.push({ level: 'warn', text: 'Acil durum fonunda ' + M.format(em.shortfall, { noDecimals: true }) + ' eksik var' + (an.budget.surplus <= 0 ? '. Bu ay artan para olmadığı için ayrılamıyor; önce açığı kapat.' : '. Ayarlar\'da acil fona giden payı artırabilirsin.') });
    else if (em.target > 0) out.push({ level: 'ok', text: 'Acil durum fonun tamam (' + em.months + ' aylık gider). Harika!' });
    if (an.plan.toInvest > 0) out.push({ level: 'info', text: 'Hedefin için ' + M.format(an.plan.toInvest, { noDecimals: true }) + ' yatır: güvenli ' + M.format(an.plan.safe, { noDecimals: true }) + ', orta ' + M.format(an.plan.medium, { noDecimals: true }) + (an.plan.riskyBlocked ? ' (acil fon dolana kadar riskliye yok).' : ', riskli ' + M.format(an.plan.risky, { noDecimals: true }) + '.') });
    var big = (an.investTotal > 0) ? ['safe', 'medium', 'risky'].filter(function (k) { return Math.abs(an.drift[k]) >= 1000; }) : [];
    if (big.length) out.push({ level: 'info', text: 'Portföy dağılımın hedeften %10\'dan fazla sapmış (' + big.map(function (k) { return RISK[k] + (an.drift[k] > 0 ? ' fazla' : ' eksik'); }).join(', ') + '). Yeni yatırımları eksik olan tarafa yönlendirerek dengele.' });
    if (an.budget.income > 0 && an.budget.savingsRateBp < 1000 && an.budget.surplus >= 0) out.push({ level: 'warn', text: 'Tasarruf oranın %10\'un altında. Hedefe ulaşmak zorlaşabilir.' });
    return out;
  }

  return { RISK: RISK, ASSET_CLASSES: ASSET_CLASSES, GLIDE: GLIDE, DEFAULT_SCENARIOS: DEFAULT_SCENARIOS,
    budget: budget, assets: assets, emergency: emergency, targetAllocation: targetAllocation, monthlyPlan: monthlyPlan,
    goalStatus: goalStatus, project: project, monthlyRate: monthlyRate, firstMonthReaching: firstMonthReaching, monthActuals: monthActuals,
    analyze: analyze, actions: actions, riskyBlocked: riskyBlocked, emergencyShareBp: shareBp, monthIndex: monthIndex, ymFromIndex: ymFromIndex, monthsBetween: monthsBetween, currentYm: currentYm };
});
