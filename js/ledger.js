/* ledger.js — Bütçe motoru v2: kategori sınırları, düzenli ödemeler, kredi kartı ve taksitler, aylık karşılaştırma,
 * yıllık/düzensiz giderler (kumbara), çoklu hesap ve para birimi.
 * Tüm tutarlar TAM SAYI: TL = kuruş, USD/EUR = sent, gram altın = 0,01 gram. Kurlar: 1 birimin kuruş karşılığı (tam sayı).
 * Fonksiyonlar saftır (DOM yok); "bugün" her zaman parametre olarak verilir, böylece test edilebilir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'), require('./calc.js'));
  else root.Ledger = factory(root.Money, root.Calc);
})(typeof self !== 'undefined' ? self : this, function (M, C) {
  'use strict';

  /* ---------- Tarih yardımcıları ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function daysInMonth(ym) { var p = ym.split('-'); return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(); }
  function ymdOf(ym, day) { C.monthIndex(ym); var d = Math.min(Math.max(1, day | 0), daysInMonth(ym)); return ym + '-' + pad(d); } // 31 → ayın son günü
  function dayIndex(ymd) { var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); if (!p) throw new Error('Geçersiz tarih: ' + ymd); return Math.round(Date.UTC(+p[1], +p[2] - 1, +p[3]) / 86400000); }
  function daysBetween(a, b) { return dayIndex(b) - dayIndex(a); }
  function addMonthsYm(ym, n) { return C.ymFromIndex(C.monthIndex(ym) + n); }
  function isYm(v) { return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v); }
  function isYmd(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; var ym = v.slice(0, 7); return isYm(ym) && +v.slice(8) >= 1 && +v.slice(8) <= daysInMonth(ym); }

  /* ---------- Para birimleri ve kurlar ---------- */
  var CURRENCIES = {
    TRY: { label: 'Türk lirası (TL)', short: 'TL' },
    USD: { label: 'ABD doları (USD)', short: 'USD' },
    EUR: { label: 'Euro (EUR)', short: 'EUR' },
    XAU: { label: 'Gram altın', short: 'gr altın' }
  };
  /* Döviz/altın tutarını TL kuruşa çevirir. minor: sent veya 0,01 gram; rate: 1 birim = rate kuruş. Kur yoksa null. */
  function toTRY(minor, cur, rates) {
    M.assertKurus(minor);
    if (cur === 'TRY') return minor;
    if (!CURRENCIES[cur]) throw new Error('Bilinmeyen para birimi: ' + cur);
    var r = rates && rates[cur];
    if (!r || !Number.isInteger(r.rate) || r.rate <= 0) return null;
    return M.mulRatio(minor, r.rate, 100);
  }
  function formatCur(minor, cur, opts) {
    if (cur === 'TRY' || !cur) return M.format(minor, opts);
    return M.format(minor, { symbol: false }) + ' ' + CURRENCIES[cur].short;
  }
  function rateAgeDays(rates, cur, todayYmd) { var r = rates && rates[cur]; if (!r || !r.date) return null; return daysBetween(r.date, todayYmd); }

  /* ---------- Hesaplar ---------- */
  var ACCOUNT_TYPES = {
    bank: { label: 'Banka hesabı (vadesiz)', risk: 'safe', emergency: true, cls: 'cash' },
    katilim: { label: 'Katılım hesabı', risk: 'safe', emergency: true, cls: 'cash' },
    cash: { label: 'Nakit (cüzdan, kasa)', risk: 'safe', emergency: true, cls: 'cash' },
    gold: { label: 'Altın hesabı / fiziki altın', risk: 'medium', emergency: false, cls: 'gold', currency: 'XAU' },
    card: { label: 'Kredi kartı', risk: 'safe', emergency: false, cls: 'cash', currency: 'TRY' }
  };
  function accountTL(acc, rates) { return toTRY(acc.balance, acc.currency, rates); }

  /* ---------- Taksitler ---------- */
  /* Toplamı taksit sayısına kuruşu kuruşuna böler: artan kuruşlar ilk taksitlere 1'er eklenir. Parçaların toplamı = toplam. */
  function installmentParts(total, count) {
    M.assertKurus(total);
    if (!Number.isInteger(count) || count < 1) throw new Error('Taksit sayısı hatalı');
    var base = Math.floor(total / count), r = total - base * count, out = [];
    for (var i = 0; i < count; i++) out.push(base + (i < r ? 1 : 0));
    return out;
  }
  function installmentSchedule(plan) {
    return installmentParts(plan.total, plan.count).map(function (amt, i) { return { ym: addMonthsYm(plan.firstYm, i), no: i + 1, amount: amt }; });
  }
  /* nowYm'e göre durum: bu ayki taksit, kalan (bu ay dahil), gelecek (bu aydan sonra), biten */
  function installmentStatus(plan, nowYm) {
    var sch = installmentSchedule(plan), thisMonth = 0, remaining = 0, future = 0, remainingCount = 0, paidCount = 0, paid = 0;
    sch.forEach(function (x) {
      if (x.ym < nowYm) { paidCount++; paid = M.add(paid, x.amount); }
      else { remainingCount++; remaining = M.add(remaining, x.amount); if (x.ym === nowYm) thisMonth = x.amount; else future = M.add(future, x.amount); }
    });
    return { schedule: sch, thisMonth: thisMonth, remaining: remaining, remainingCount: remainingCount, future: future, paid: paid, paidCount: paidCount,
      lastYm: sch[sch.length - 1].ym, done: remainingCount === 0, notStarted: plan.firstYm > nowYm, perInstallment: sch[0].amount };
  }
  /* Önümüzdeki aylar için toplam taksit yükü (tüm kartlar) */
  function installmentBurden(state, fromYm, months) {
    var out = [];
    for (var i = 0; i < months; i++) out.push({ ym: addMonthsYm(fromYm, i), total: 0, byCard: {} });
    (state.installments || []).forEach(function (p) {
      installmentSchedule(p).forEach(function (x) {
        var k = C.monthIndex(x.ym) - C.monthIndex(fromYm);
        if (k < 0 || k >= months) return;
        out[k].total = M.add(out[k].total, x.amount);
        out[k].byCard[p.cardId] = M.add(out[k].byCard[p.cardId] || 0, x.amount);
      });
    });
    return out;
  }
  function futureInstallmentsForCard(state, cardId, nowYm) {
    return M.sum((state.installments || []).filter(function (p) { return p.cardId === cardId; }).map(function (p) { return installmentStatus(p, nowYm).future; }));
  }
  /* Ekstredeki "TAKSİT 2/6", "2/6 TK", "(3/12)", "3. TAKSIT / 12" gibi ifadeleri okur */
  function detectInstallment(desc) {
    var s = String(desc || '');
    var m = /(?:^|[^\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/.exec(s);
    if (!m || !/taks|tks|tk\b|\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)|\d{1,2}\s*\/\s*\d{1,2}\s*(tk|taks)/i.test(s)) return null;
    var k = +m[1], n = +m[2];
    if (n < 2 || n > 60 || k < 1 || k > n) return null;
    return { no: k, count: n };
  }

  /* ---------- Kredi kartı: kesim ve son ödeme ---------- */
  function cardDueDate(statementYm, statementDay, dueDay) {
    var due = dueDay > statementDay ? ymdOf(statementYm, dueDay) : ymdOf(addMonthsYm(statementYm, 1), dueDay);
    return due;
  }
  function nextStatementDate(todayYmd, statementDay) {
    var ym = todayYmd.slice(0, 7), d = ymdOf(ym, statementDay);
    return d >= todayYmd ? d : ymdOf(addMonthsYm(ym, 1), statementDay);
  }
  function cardStatus(state, acc, todayYmd) {
    var c = acc.card || {}, nowYm = todayYmd.slice(0, 7);
    var debtNow = Math.max(0, -acc.balance);
    var future = futureInstallmentsForCard(state, acc.id, nowYm);
    var used = M.add(debtNow, future);
    var st = c.statementYm ? { ym: c.statementYm, date: ymdOf(c.statementYm, c.statementDay), due: cardDueDate(c.statementYm, c.statementDay, c.dueDay) } : null;
    var remaining = Math.max(0, M.sub(c.statementDebt || 0, c.paid || 0));
    var daysLeft = st ? daysBetween(todayYmd, st.due) : null;
    var level = !st || remaining === 0 ? 'ok' : daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'today' : daysLeft <= (c.remindDays == null ? 3 : c.remindDays) ? 'soon' : 'later';
    return { debtNow: debtNow, futureInstallments: future, used: used, limit: c.limit || 0, available: M.sub(c.limit || 0, used),
      usageBp: c.limit ? M.ratioBp(used, c.limit) : 0, statement: st, statementDebt: c.statementDebt || 0, paid: c.paid || 0, remaining: remaining,
      daysLeft: daysLeft, level: level, nextStatement: nextStatementDate(todayYmd, c.statementDay || 1) };
  }

  /* ---------- Kategori bütçe sınırları ----------
   * ok: %80'in altı · warn: %80 – %100 (dahil) · over: %100'ü aştı. Karşılaştırmalar tam sayı (BigInt) ile, yuvarlama yok. */
  function limitLevel(spent, limit) {
    if (!limit || limit <= 0) return null;
    var S = BigInt(spent), L = BigInt(limit);
    if (S > L) return 'over';
    if (S * 100n >= L * 80n) return 'warn';
    return 'ok';
  }
  function limitStatus(spent, limit) {
    var lv = limitLevel(spent, limit);
    if (!lv) return null;
    return { spent: spent, limit: limit, remaining: M.sub(limit, spent), usedBp: M.ratioBp(spent, limit), level: lv, atLimit: spent === limit };
  }
  function categoryLimits(state, ym, todayYmd) {
    var act = C.monthActuals(state.transactions, ym), limits = state.limits || {}, out = [];
    var pending = {};
    occurrencesForMonth(state, ym, todayYmd).forEach(function (o) {
      if (o.amount < 0 && (o.status !== 'paid' && o.status !== 'skipped')) pending[o.item.category] = M.add(pending[o.item.category] || 0, -o.amount);
    });
    var dim = daysInMonth(ym), day = todayYmd.slice(0, 7) === ym ? +todayYmd.slice(8) : (ym < todayYmd.slice(0, 7) ? dim : 0);
    Object.keys(limits).forEach(function (cat) {
      var lim = limits[cat]; if (!lim) return;
      var spent = act.byCategory[cat] || 0, st = limitStatus(spent, lim);
      var expected = pending[cat] || 0, projected = M.add(spent, expected);
      st.category = cat; st.expected = expected; st.projected = projected; st.projectedLevel = limitLevel(projected, lim);
      st.pace = day > 0 && day < dim ? M.mulRatio(spent, dim, day) : spent; // doğrusal tahmin (bilgi amaçlı)
      // Tek ay sonu tahmini (temkinli): "harcanan + bekleyen düzenli ödemeler" ile "bu hızla" tahmininden büyük olanı
      st.estimate = Math.max(projected, st.pace); st.estimateLevel = limitLevel(st.estimate, lim);
      out.push(st);
    });
    var rank = { over: 0, warn: 1, ok: 2 };
    return out.sort(function (a, b) { return rank[a.level] - rank[b.level] || b.usedBp - a.usedBp || (a.category < b.category ? -1 : 1); });
  }

  /* ---------- Düzenli ödemeler ve abonelikler ---------- */
  var FREQS = { monthly: { label: 'Her ay', every: 1 }, yearly: { label: 'Her yıl', every: 12 }, custom: { label: 'Her N ayda bir', every: null } };
  function everyOf(item) { return item.freq === 'custom' ? item.everyMonths : FREQS[item.freq].every; }
  function occurrence(item, ym) {
    if (item.active === false || ym < item.startYm || (item.endYm && ym > item.endYm)) return null;
    var diff = C.monthIndex(ym) - C.monthIndex(item.startYm), ev = everyOf(item);
    if (diff % ev !== 0) return null;
    return { date: ymdOf(ym, item.day), period: ym };
  }
  function signedAmount(item) { return item.direction === 'income' ? item.amount : -item.amount; }
  function tokens(s) {
    return String(s || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/[^a-z0-9çğöşü]+/g, ' ').split(' ').filter(function (w) { return w.length >= 3; });
  }
  function overlap(a, b) { var A = tokens(a), B = tokens(b); return A.some(function (w) { return B.some(function (v) { return v.indexOf(w) === 0 || w.indexOf(v) === 0; }); }); }
  /* Gerçek bir işlemin bu ödemeye ait olup olmadığı: aynı yön, tarih ±7 gün, tutar ±%10, ve kategori veya açıklama benzerliği */
  function matchScore(item, occ, t) {
    if (t.recurringId || t.category === 'Transfer') return -1;
    var sa = signedAmount(item);
    if ((t.amount < 0) !== (sa < 0)) return -1;
    var dd = Math.abs(daysBetween(occ.date, t.date)); if (dd > 7) return -1;
    var diff = Math.abs(Math.abs(t.amount) - item.amount), tol = Math.max(100, M.mulRatio(item.amount, 1, 10));
    if (diff > tol) return -1;
    var cat = t.category === item.category, ov = overlap(t.description, item.name);
    if (!cat && !ov) return -1;
    return (diff === 0 ? 30 : 10) + (cat ? 20 : 0) + (ov ? 20 : 0) - dd;
  }
  function findMatch(item, occ, transactions, used) {
    var best = null, bs = -1;
    (transactions || []).forEach(function (t) { if (used[t.id]) return; var s = matchScore(item, occ, t); if (s > bs) { bs = s; best = t; } });
    return best;
  }
  /* Bir ayın tüm düzenli ödemeleri ve durumları. status: paid | matched | skipped | overdue | today | soon | later */
  function occurrencesForMonth(state, ym, todayYmd) {
    var txs = state.transactions || [], used = {}, out = [];
    txs.forEach(function (t) { if (t.recurringId) used[t.id] = true; });
    (state.recurring || []).forEach(function (item) {
      var occ = occurrence(item, ym); if (!occ) return;
      var linked = txs.find(function (t) { return t.recurringId === item.id && t.period === ym; });
      var o = { item: item, date: occ.date, period: ym, amount: signedAmount(item), daysLeft: daysBetween(todayYmd, occ.date), tx: linked || null, match: null };
      if (linked) o.status = 'paid';
      else if ((item.skipped || []).indexOf(ym) >= 0) o.status = 'skipped';
      else {
        var m = findMatch(item, occ, txs, used);
        if (m) { used[m.id] = true; o.match = m; o.status = 'matched'; }
        else o.status = o.daysLeft < 0 ? 'overdue' : o.daysLeft === 0 ? 'today' : o.daysLeft <= (item.remindDays == null ? 3 : item.remindDays) ? 'soon' : 'later';
      }
      out.push(o);
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  /* "Bu ayın beklenen kayıtlarını oluştur" planı: eşleşen gerçek işlem varsa ona BAĞLA (yeni kayıt yok), yoksa beklenen kayıt OLUŞTUR.
   * Ödenmiş/atlanmış olanlar dokunulmaz. İki kez çalıştırmak ikinci kez hiçbir şey üretmez (idempotent). */
  function generationPlan(state, ym, todayYmd) {
    var create = [], link = [];
    occurrencesForMonth(state, ym, todayYmd).forEach(function (o) {
      if (o.status === 'paid' || o.status === 'skipped') return;
      if (o.match) link.push({ item: o.item, period: ym, txId: o.match.id });
      else create.push({ item: o.item, period: ym, tx: { date: o.date, description: o.item.name, amount: o.amount, category: o.item.category,
        source: 'düzenli', recurringId: o.item.id, period: ym, accountId: o.item.accountId || undefined } });
    });
    return { create: create, link: link };
  }
  function applyGeneration(state, plan, uid) {
    plan.link.forEach(function (l) { var t = state.transactions.find(function (x) { return x.id === l.txId; }); if (t && !t.recurringId) { t.recurringId = l.item.id; t.period = l.period; } });
    plan.create.forEach(function (c) {
      if (state.transactions.some(function (t) { return t.recurringId === c.item.id && t.period === c.period; })) return; // çift kayıt koruması
      var tx = JSON.parse(JSON.stringify(c.tx)); tx.id = uid(); state.transactions.push(tx);
    });
    return state;
  }
  /* İçe aktarılan gerçek satırlar, önceden "düzenli" olarak oluşturulmuş beklenen kayıtlarla eşleşirse işaretlenir:
   * kaydedilince beklenen kayıt silinir, gerçek işlem onun yerine geçer (çift sayım olmaz). */
  function reconcileImported(rows, transactions) {
    var used = {};
    rows.forEach(function (r) {
      r.replaces = null;
      if (!Number.isInteger(r.amount) || !r.date || !isYmd(r.date)) return;
      var best = null, bs = -1;
      (transactions || []).forEach(function (t) {
        if (used[t.id] || t.source !== 'düzenli' || !t.recurringId) return;
        if ((t.amount < 0) !== (r.amount < 0)) return;
        var dd = Math.abs(daysBetween(t.date, r.date)); if (dd > 7) return;
        var diff = Math.abs(Math.abs(t.amount) - Math.abs(r.amount)), tol = Math.max(100, M.mulRatio(Math.abs(t.amount), 1, 10));
        if (diff > tol) return;
        if (!overlap(t.description, r.description) && t.category !== r.category) return;
        var s = (diff === 0 ? 30 : 10) + (overlap(t.description, r.description) ? 20 : 0) - dd;
        if (s > bs) { bs = s; best = t; }
      });
      if (best) { used[best.id] = true; r.replaces = { id: best.id, recurringId: best.recurringId, period: best.period, description: best.description, amount: best.amount }; }
    });
    return rows;
  }

  /* ---------- Yaklaşan ödemeler (düzenli + kart + yıllık giderler) ---------- */
  function upcoming(state, todayYmd, horizonDays) {
    horizonDays = horizonDays == null ? 30 : horizonDays;
    var nowYm = todayYmd.slice(0, 7), out = [];
    for (var k = -1; k <= 2; k++) {
      occurrencesForMonth(state, addMonthsYm(nowYm, k), todayYmd).forEach(function (o) {
        if (o.status === 'paid' || o.status === 'skipped' || o.status === 'matched') return;
        if (o.daysLeft > horizonDays || o.daysLeft < -45) return;
        out.push({ kind: 'recurring', id: o.item.id, period: o.period, title: o.item.name, date: o.date, amount: o.amount, daysLeft: o.daysLeft, level: o.status, category: o.item.category });
      });
    }
    (state.accounts || []).forEach(function (a) {
      if (a.type !== 'card' || !a.card) return;
      var cs = cardStatus(state, a, todayYmd);
      if (!cs.statement || cs.remaining === 0 || cs.daysLeft > horizonDays) return;
      out.push({ kind: 'card', id: a.id, title: a.name + ' — son ödeme', date: cs.statement.due, amount: -cs.remaining, daysLeft: cs.daysLeft, level: cs.level });
    });
    (state.sinkingFunds || []).forEach(function (f) {
      var p = sinkingPlan(f, nowYm);
      if (p.monthsLeft < 0 || p.monthsLeft > 1) return;
      var date = ymdOf(f.dueYm, f.day || 1), dl = daysBetween(todayYmd, date);
      if (dl > horizonDays) return;
      out.push({ kind: 'sinking', id: f.id, title: f.name + ' (yıllık gider)', date: date, amount: -f.amount, daysLeft: dl,
        level: dl < 0 ? 'overdue' : dl === 0 ? 'today' : dl <= 7 ? 'soon' : 'later', ready: p.ready });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function badgeCount(list) { return list.filter(function (x) { return x.level === 'overdue' || x.level === 'today' || x.level === 'soon'; }).length; }

  /* ---------- Yıllık ve düzensiz giderler (kumbara / sinking fund) ----------
   * Ödeme ayına kadar (bu ay dahil, ödeme ayı hariç) n = max(1, ay farkı) eşit katkı. Kalan tutar kuruşu kuruşuna bölünür;
   * artan kuruşlar ilk aylara 1'er eklenir, böylece katkıların toplamı kalan tutara TAM eşittir. */
  function sinkingPlan(f, nowYm) {
    var monthsLeft = C.monthsBetween(nowYm, f.dueYm);
    var setThisMonth = f.setAsideYm === nowYm ? (f.setAsideAmount || 0) : 0;
    var remainingStart = Math.max(0, M.sub(f.amount, M.sub(f.saved, setThisMonth))); // ay başındaki kalan
    var n = Math.max(1, monthsLeft);
    var parts = remainingStart > 0 ? installmentParts(remainingStart, n) : [0];
    var remaining = Math.max(0, M.sub(f.amount, f.saved));
    return { monthsLeft: monthsLeft, contributions: n, remaining: remaining, monthlyNeed: parts[0], later: parts.length > 1 ? parts[parts.length - 1] : 0,
      parts: parts, doneThisMonth: f.setAsideYm === nowYm, toSetAsideNow: f.setAsideYm === nowYm ? 0 : Math.min(parts[0], remaining),
      progressBp: f.amount ? Math.min(10000, M.ratioBp(f.saved, f.amount)) : 0, ready: f.saved >= f.amount, overdue: monthsLeft < 0,
      steadyMonthly: M.mulRatio(f.amount, 1, f.everyMonths || 12) };
  }
  function sinkingTotals(state, nowYm) {
    var need = 0, saved = 0, target = 0, steady = 0;
    (state.sinkingFunds || []).forEach(function (f) { var p = sinkingPlan(f, nowYm); need = M.add(need, p.monthlyNeed); saved = M.add(saved, f.saved); target = M.add(target, f.amount); steady = M.add(steady, p.steadyMonthly); });
    return { monthlyNeed: need, saved: saved, target: target, steadyMonthly: steady };
  }

  /* ---------- Aylık karşılaştırma ve trend ---------- */
  function actualsUntil(transactions, ym, day) {
    return C.monthActuals((transactions || []).filter(function (t) { return t.date && t.date.slice(0, 7) === ym && +t.date.slice(8, 10) <= day; }), ym);
  }
  function monthSeries(transactions, endYm, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) { var ym = addMonthsYm(endYm, -i), a = C.monthActuals(transactions, ym); out.push({ ym: ym, income: a.income, expense: a.expense, byCategory: a.byCategory }); }
    return out;
  }
  function pctChangeBp(cur, base) { if (!base) return null; return M.mulRatio(M.sub(cur, base), 10000, base); }
  /* Bu ay (bugüne kadar) — geçen ayın aynı dönemi — geçen ay (tam) — önceki 3 tam ayın ortalaması */
  function compareMonths(transactions, todayYmd) {
    var ym = todayYmd.slice(0, 7), day = +todayYmd.slice(8), prev = addMonthsYm(ym, -1);
    var cur = actualsUntil(transactions, ym, day), prevSame = actualsUntil(transactions, prev, Math.min(day, daysInMonth(prev))), prevFull = C.monthActuals(transactions, prev);
    var last3 = [1, 2, 3].map(function (k) { return C.monthActuals(transactions, addMonthsYm(ym, -k)); });
    var cats = {};
    [cur, prevFull].concat(last3).forEach(function (a) { Object.keys(a.byCategory).forEach(function (c) { cats[c] = 1; }); });
    var rows = Object.keys(cats).map(function (c) {
      var cv = cur.byCategory[c] || 0, ps = prevSame.byCategory[c] || 0, pf = prevFull.byCategory[c] || 0;
      var sum3 = M.sum(last3.map(function (a) { return a.byCategory[c] || 0; })), avg3 = M.mulRatio(sum3, 1, 3);
      return { category: c, current: cv, prevSamePeriod: ps, prevFull: pf, avg3: avg3, diffSame: M.sub(cv, ps), diffSameBp: pctChangeBp(cv, ps), vsAvgBp: pctChangeBp(cv, avg3) };
    }).sort(function (a, b) { return b.current - a.current || b.avg3 - a.avg3 || (a.category < b.category ? -1 : 1); });
    var sum3t = M.sum(last3.map(function (a) { return a.expense; }));
    return { ym: ym, prevYm: prev, day: day, daysInMonth: daysInMonth(ym), total: { current: cur.expense, prevSamePeriod: prevSame.expense, prevFull: prevFull.expense,
      avg3: M.mulRatio(sum3t, 1, 3), diffSame: M.sub(cur.expense, prevSame.expense), diffSameBp: pctChangeBp(cur.expense, prevSame.expense) }, rows: rows,
      hasHistory: last3.some(function (a) { return a.expense > 0; }) };
  }
  /* Sade içgörüler: { level, text } — eşikler: en az %10 ve 100 TL fark */
  function insights(cmp, fmt) {
    var out = [], T = cmp.total;
    if (!cmp.hasHistory) return [{ level: 'info', text: 'Karşılaştırma için önceki aylara ait işlem yok. Geçmiş ekstreleri "Veri ekle" ile aktarırsan burada değişimleri görürsün.' }];
    if (T.prevSamePeriod > 0) {
      var up = T.diffSame > 0;
      out.push({ level: Math.abs(T.diffSameBp) < 1000 ? 'ok' : up ? 'warn' : 'ok', text: 'Bu ay şu ana kadar ' + fmt(T.current) + ' harcadın. Geçen ayın aynı döneminde (' + cmp.day + ' gün) ' + fmt(T.prevSamePeriod) + ' idi: ' +
        (Math.abs(T.diffSameBp) < 100 ? 'neredeyse aynı.' : '%' + Math.round(Math.abs(T.diffSameBp) / 100) + (up ? ' daha fazla.' : ' daha az.')) });
    }
    var big = cmp.rows.filter(function (r) { return r.diffSameBp != null && Math.abs(r.diffSame) >= 10000 && Math.abs(r.diffSameBp) >= 1000; });
    var inc = big.filter(function (r) { return r.diffSame > 0; }).sort(function (a, b) { return b.diffSame - a.diffSame; })[0];
    var dec = big.filter(function (r) { return r.diffSame < 0; }).sort(function (a, b) { return a.diffSame - b.diffSame; })[0];
    if (inc) out.push({ level: 'warn', text: inc.category + ' harcaman geçen ayın aynı dönemine göre ' + fmt(inc.diffSame) + ' arttı (%' + Math.round(inc.diffSameBp / 100) + ').' });
    if (dec) out.push({ level: 'ok', text: dec.category + ' harcaman geçen ayın aynı dönemine göre ' + fmt(-dec.diffSame) + ' azaldı. Güzel!' });
    cmp.rows.forEach(function (r) {
      if (cmp.day < cmp.daysInMonth && r.avg3 >= 10000 && r.current > r.avg3) out.push({ level: 'warn', text: r.category + ' harcaman ayın daha ' + cmp.day + '. gününde son 3 ayın aylık ortalamasını (' + fmt(r.avg3) + ') geçti.' });
    });
    return out.slice(0, 6);
  }

  /* ---------- Net varlık ve analiz entegrasyonu ----------
   * Hesaplar sanal "varlık" olarak, kart borçları + gelecek taksitler sanal "borç" olarak, kumbara katkısı sanal sabit gider olarak
   * mevcut hesap motoruna (calc.analyze) verilir. Böylece acil fon, hedef ve plan hesapları tek yerden ve tutarlı yapılır. */
  function accountsSummary(state, todayYmd) {
    var nowYm = todayYmd.slice(0, 7), rows = [], assetsTL = 0, cardDebt = 0, futureInst = 0, missing = {}, byCur = {};
    (state.accounts || []).forEach(function (a) {
      var v = accountTL(a, state.rates);
      byCur[a.currency] = M.add(byCur[a.currency] || 0, a.balance);
      if (v == null) { missing[a.currency] = true; rows.push({ acc: a, tl: null }); return; }
      var r = { acc: a, tl: v };
      if (a.type === 'card') { r.future = futureInstallmentsForCard(state, a.id, nowYm); futureInst = M.add(futureInst, r.future); if (v < 0) cardDebt = M.add(cardDebt, -v); else assetsTL = M.add(assetsTL, v); }
      else if (a.inNetWorth !== false) assetsTL = M.add(assetsTL, v);
      rows.push(r);
    });
    // Kartı olmayan (silinmiş değil, kart atanmamış) taksit olamaz; doğrulama engeller.
    return { rows: rows, assetsTL: assetsTL, cardDebt: cardDebt, futureInstallments: futureInst, netTL: M.sub(assetsTL, M.add(cardDebt, futureInst)), missingRates: Object.keys(missing), byCurrency: byCur };
  }
  function effectiveState(state, todayYmd) {
    var nowYm = todayYmd.slice(0, 7), s = {};
    Object.keys(state).forEach(function (k) { s[k] = state[k]; });
    var extraAssets = [], extraDebts = [];
    (state.accounts || []).forEach(function (a) {
      var v = accountTL(a, state.rates); if (v == null) return;
      var t = ACCOUNT_TYPES[a.type];
      if (a.type === 'card') {
        var fut = futureInstallmentsForCard(state, a.id, nowYm), debt = M.add(Math.max(0, -v), fut);
        if (debt > 0) extraDebts.push({ id: 'acc:' + a.id, name: a.name + ' (kart borcu + gelecek taksitler)', amount: debt, auto: true });
        if (v > 0) extraAssets.push({ id: 'acc:' + a.id, name: a.name, cls: 'cash', risk: 'safe', emergency: false, value: v, auto: true });
        return;
      }
      if (a.inNetWorth === false) return;
      extraAssets.push({ id: 'acc:' + a.id, name: a.name, cls: t.cls, risk: a.risk || t.risk, emergency: !!a.emergency, value: Math.max(0, v), auto: true });
    });
    s.assets = (state.assets || []).concat(extraAssets);
    s.debts = (state.debts || []).concat(extraDebts);
    var sink = sinkingTotals(state, nowYm).monthlyNeed;
    s.expenses = (state.expenses || []).slice();
    if (sink > 0) s.expenses.push({ id: 'auto:sinking', name: 'Yıllık giderler için aylık ayırma (otomatik)', type: 'fixed', amount: sink, auto: true });
    var inst = installmentBurden(state, nowYm, 1)[0].total;
    if (inst > 0) s.expenses.push({ id: 'auto:installments', name: 'Kredi kartı taksitleri (bu ay, otomatik)', type: 'fixed', amount: inst, auto: true });
    return s;
  }

  return { CURRENCIES: CURRENCIES, ACCOUNT_TYPES: ACCOUNT_TYPES, FREQS: FREQS,
    daysInMonth: daysInMonth, ymdOf: ymdOf, dayIndex: dayIndex, daysBetween: daysBetween, addMonthsYm: addMonthsYm, isYm: isYm, isYmd: isYmd,
    toTRY: toTRY, formatCur: formatCur, rateAgeDays: rateAgeDays, accountTL: accountTL,
    installmentParts: installmentParts, installmentSchedule: installmentSchedule, installmentStatus: installmentStatus, installmentBurden: installmentBurden,
    futureInstallmentsForCard: futureInstallmentsForCard, detectInstallment: detectInstallment,
    cardDueDate: cardDueDate, nextStatementDate: nextStatementDate, cardStatus: cardStatus,
    limitLevel: limitLevel, limitStatus: limitStatus, categoryLimits: categoryLimits,
    occurrence: occurrence, signedAmount: signedAmount, matchScore: matchScore, occurrencesForMonth: occurrencesForMonth,
    generationPlan: generationPlan, applyGeneration: applyGeneration, reconcileImported: reconcileImported, upcoming: upcoming, badgeCount: badgeCount,
    sinkingPlan: sinkingPlan, sinkingTotals: sinkingTotals,
    actualsUntil: actualsUntil, monthSeries: monthSeries, compareMonths: compareMonths, insights: insights,
    accountsSummary: accountsSummary, effectiveState: effectiveState };
});
