/* app.js — Arayüz. Hesaplar calc.js'te, para işlemleri money.js'te (tam sayı kuruş). */
(function () {
  'use strict';
  var M = window.Money, C = window.Calc, P = window.ImportParse, S = window.Sample, Store = window.Store, AI = window.AI;
  var state = null, undoStack = null, aiCfg = Store.loadAi(), chatLog = [], review = null, tab = 'ozet';
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  /* ---------- Yardımcılar ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tl(k) { return M.format(k, { noDecimals: true }); }
  function tl2(k) { return M.format(k); }
  function moneyInputVal(k) { return M.format(k, { symbol: false }); }
  function pct(bp) { return M.formatBp(bp, 0); }
  function tip(text) { return '<button type="button" class="tip" aria-label="Açıklama: ' + esc(text) + '" data-tip="' + esc(text) + '">?</button>'; }
  function todayYmd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function ymLabel(ym) { var a = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']; var p = ym.split('-'); return a[+p[1] - 1] + ' ' + p[0]; }
  function dateLabel(ymd) { var p = ymd.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function monthsLabel(n) { if (n == null) return '—'; var y = Math.floor(n / 12), m = n % 12; return (y ? y + ' yıl ' : '') + (m || !y ? m + ' ay' : ''); }
  function toast(msg, undo) {
    var root = $('#toast-root'); root.innerHTML = '';
    var el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button">Geri al</button>' : '');
    root.appendChild(el);
    if (undo) el.querySelector('button').onclick = function () { undo(); root.innerHTML = ''; };
    clearTimeout(toast.t); toast.t = setTimeout(function () { root.innerHTML = ''; }, undo ? 7000 : 3500);
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if ($('script[data-src="' + src + '"]')) return res();
      var s = document.createElement('script'); s.src = src; s.dataset.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('Kütüphane yüklenemedi: ' + src)); }; document.head.appendChild(s);
    });
  }

  /* ---------- Durum değişikliği: önce kopya al (geri al), sonra doğrula ve kaydet ---------- */
  function mutate(fn, msg) {
    var before = JSON.stringify(state);
    try {
      fn(state);
      S.validateState(JSON.parse(JSON.stringify(state)));
    } catch (e) { state = JSON.parse(before); toast('İşlem yapılmadı: ' + e.message); render(); return false; }
    undoStack = before;
    persist();
    render();
    if (msg) toast(msg, function () { state = JSON.parse(undoStack); undoStack = null; persist(); render(); toast('Geri alındı'); });
    return true;
  }
  function persist() { Store.save(state).catch(function (e) { toast('Kaydedilemedi! Tarayıcı depolaması dolu veya kapalı olabilir: ' + e.message); }); }

  /* ---------- Görünüm (sade/detaylı) ---------- */
  function setView(v) {
    document.body.classList.toggle('detailed', v === 'detailed');
    $('#view-simple').setAttribute('aria-pressed', String(v !== 'detailed'));
    $('#view-detailed').setAttribute('aria-pressed', String(v === 'detailed'));
    if (state && state.settings.view !== v) { state.settings.view = v; persist(); }
  }

  /* ---------- Üst bant ---------- */
  function renderBanner() {
    var b = $('#banner');
    if (state.isExample) {
      b.innerHTML = '<div class="banner example" role="note"><div class="grow"><b>ÖRNEK VERİ</b> — Gördüğün rakamlar örnektir, gerçek değildir. Kendi rakamlarını girmeye hazır olduğunda temizle veya üzerine yaz.</div>' +
        '<button class="btn small" data-act="example-mine">Bunlar artık benim verilerim</button><button class="btn small danger" data-act="example-clear">Örnek veriyi temizle</button></div>';
    } else b.innerHTML = '';
  }

  /* ---------- ÖZET ---------- */
  var RISKCOL = { safe: 'var(--safe)', medium: 'var(--medium)', risky: 'var(--risky)' };
  var HALAL = {
    safe: 'Katılım hesabı (kâr payı), kira sertifikası (sukuk) fonları, katılım para piyasası fonları',
    medium: 'Altın (fiziki veya katılım bankası altın hesabı), altın katılım fonları, karma katılım fonları',
    risky: 'Katılım endeksi hisseleri veya katılım hisse senedi fonları, helal ETF\'ler (ör. SPUS, HLAL)'
  };
  function renderDashboard() {
    var an = C.analyze(state), b = an.budget, a = an.assets, em = an.emergency, g = an.goal, plan = an.plan;
    var noData = !state.incomes.length && !state.expenses.length && !state.assets.length;
    if (noData) {
      return '<h1>Hoş geldin</h1><div class="card"><p>Henüz veri yok. Başlamak için gelir ve giderlerini, sonra birikimlerini gir. İstersen önce örnek veriyle sistemi tanı.</p>' +
        '<div class="row"><a class="btn primary" href="#butce">Gelir ve gider gir</a><a class="btn" href="#varliklar">Birikimlerimi gir</a><a class="btn" href="#veri">Belgeden aktar</a><button class="btn" data-act="load-example">Örnek veriyi yükle</button></div></div>';
    }
    var acts = C.actions(an);
    var h = '<h1>Özet <span class="muted" style="font-size:.9rem;font-weight:400">— ' + esc(ymLabel(an.nowYm)) + '</span></h1>';
    h += '<div class="grid kpis">';
    h += kpi('Net varlığın', tl(a.netWorth), 'Tüm birikimlerin' + (a.debts ? ' − borçların' : '') + '.', 'Sahip olduğun her şeyin bugünkü değeri eksi borçların.');
    h += kpi('Her ay artan para', '<span class="' + (b.surplus < 0 ? 'neg' : 'pos') + '">' + tl(b.surplus) + '</span>', 'Gelirinin ' + pct(Math.max(0, b.savingsRateBp)) + '\'ini biriktiriyorsun.', 'Aylık gelir eksi sabit ve değişken giderler. Yatırıma ayrılabilecek tutar.');
    h += kpi('Acil durum fonu', tl(em.current) + ' <span class="muted" style="font-size:1rem">/ ' + tl(em.target) + '</span>', progress(em.progressBp) + (em.shortfall ? 'Eksik: ' + tl(em.shortfall) : 'Tamamlandı ✓'), em.months + ' aylık giderin kadar, kolay çekilebilir bir kenarda tutulan para. İş kaybı veya sağlık gibi beklenmedik durumlar için.');
    h += kpi(esc(g.name) + ' hedefi', tl(g.current) + ' <span class="muted" style="font-size:1rem">/ ' + tl(g.target) + '</span>', progress(g.progressBp) + 'Hedefe ' + monthsLabel(g.monthsLeft) + ' kaldı (' + esc(ymLabel(g.targetYm)) + ').', 'Acil durum fonu ayrıldıktan sonra kalan birikimin hedefe sayılır. Tutar bugünün fiyatlarıyladır.');
    h += '</div>';

    h += '<div class="grid two" style="margin-top:14px">';
    h += '<section class="card"><h2>Bu ay ne yapmalıyım?</h2><ul class="actions">' + acts.map(function (x) { return '<li class="lv-' + x.level + '"><span>' + esc(x.text) + '</span></li>'; }).join('') + '</ul>';
    h += '<p class="hint detail-only">Kural: Acil fon eksikse aylık fazlanın %' + (state.settings.emergencyShareBp / 100) + '\'i acil fona, kalanı hedef dağılıma göre yatırıma. Dağılım kuruşu kuruşuna yapılır; parçaların toplamı her zaman fazlaya eşittir.</p></section>';

    // Bütçe dağılımı
    var inc = b.income || 1;
    h += '<section class="card"><h2>Paran nereye gidiyor? ' + tip('Gelirinin ne kadarının sabit giderlere, değişken giderlere ve birikime gittiği.') + '</h2>';
    if (b.surplus >= 0) {
      h += '<div class="bar" role="img" aria-label="Sabit ' + pct(b.fixedRatioBp) + ', değişken ' + pct(b.variableRatioBp) + ', birikim ' + pct(b.savingsRateBp) + '">' +
        seg(b.fixed, inc, '#6c7a96') + seg(b.variable, inc, '#a3b1cc') + seg(b.surplus, inc, 'var(--safe)') + '</div>';
    } else h += '<div class="notice danger">Giderler gelirden fazla: ' + tl(-b.surplus) + ' açık var.</div>';
    h += '<div class="legend"><span><i style="background:#6c7a96"></i>Sabit giderler ' + tl(b.fixed) + ' (' + pct(b.fixedRatioBp) + ')</span><span><i style="background:#a3b1cc"></i>Değişken giderler ' + tl(b.variable) + ' (' + pct(b.variableRatioBp) + ')</span><span><i style="background:var(--safe)"></i>Birikim ' + tl(Math.max(0, b.surplus)) + ' (' + pct(Math.max(0, b.savingsRateBp)) + ')</span></div>';
    var act = an.actuals;
    if (act.income || act.expense) {
      h += '<h3>Bu ay gerçekleşen (işlemlerden)</h3><div class="row" style="gap:18px"><span>Gelir: <b class="num pos">' + tl(act.income) + '</b></span><span>Harcama: <b class="num neg">' + tl(act.expense) + '</b></span><span>Plan: <b class="num">' + tl(b.expense) + '</b></span></div>';
      h += '<div class="progress" title="Plana göre harcama"><span style="width:' + Math.min(100, b.expense ? act.expense * 100 / b.expense : 0) + '%;background:' + (act.expense > b.expense ? 'var(--danger)' : 'var(--brand)') + '"></span></div>';
      h += '<p class="hint">Planlanan aylık giderin ' + (b.expense ? pct(M.ratioBp(act.expense, b.expense)) : '—') + '\'i harcandı. "Transfer" kategorisindeki işlemler (hesaplar arası, kart borcu ödemesi) çift sayılmasın diye hariç tutulur.</p>';
    }
    h += '</section>';

    // Dağılım
    h += '<section class="card"><h2>Risk dağılımı: hedef ve şu an ' + tip('Güvenli: değeri az oynar. Orta: altın gibi orta oynaklık. Riskli: hisse/ETF, uzun vadede getirisi yüksek ama kısa vadede düşebilir. Hedefe yaklaştıkça riskli pay otomatik azalır.') + '</h2>';
    h += '<p class="hint">Acil durum fonu hariç, hedefe ayrılan ' + tl(an.investTotal) + ' için. Hedefe ' + monthsLabel(g.monthsLeft) + ' kaldığı için önerilen dağılım:</p>';
    ['safe', 'medium', 'risky'].forEach(function (k) {
      h += '<div class="alloc-row"><span>' + C.RISK[k] + '</span><div><div class="bar" title="Hedef"><span style="width:' + an.targetAlloc[k] / 100 + '%;background:' + RISKCOL[k] + '"></span></div>' +
        '<div class="bar" style="margin-top:3px;opacity:.55" title="Şu an"><span style="width:' + an.currentAlloc[k] / 100 + '%;background:' + RISKCOL[k] + '"></span></div></div>' +
        '<span class="num r">' + pct(an.targetAlloc[k]) + ' <span class="muted">/ ' + pct(an.currentAlloc[k]) + '</span></span></div>';
    });
    h += '<p class="hint">Üstteki koyu çubuk hedef, alttaki açık çubuk şu anki durum.</p>';
    h += '<div class="detail-only"><h3>Süzülme yolu (glide path)</h3><table><thead><tr><th>Hedefe kalan</th><th class="r">Güvenli</th><th class="r">Orta</th><th class="r">Riskli</th></tr></thead><tbody>' +
      C.GLIDE.slice().reverse().map(function (r) { return '<tr><td>' + (r[0] ? r[0] + ' ay' + (r[0] === 60 ? ' ve üstü' : '') : 'Hedef ayı') + '</td><td class="r">' + pct(r[1]) + '</td><td class="r">' + pct(r[2]) + '</td><td class="r">' + pct(r[3]) + '</td></tr>'; }).join('') +
      '</tbody></table><p class="hint">Ara aylarda doğrusal geçiş yapılır. Sapma (şu an − hedef): güvenli ' + sbp(an.drift.safe) + ', orta ' + sbp(an.drift.medium) + ', riskli ' + sbp(an.drift.risky) + '.</p></div>';
    h += '</section>';

    // Aylık yatırım planı
    h += '<section class="card"><h2>Bu ayki yatırım planı ' + tip('Aylık artan paranın hangi tür araçlara gideceği. Sadece faizsiz (helal) araçlar önerilir.') + '</h2>';
    if (plan.surplus <= 0) h += '<p>Bu ay yatırım için artan para yok.</p>';
    else {
      h += '<table><tbody>';
      if (plan.toEmergency) h += '<tr><td><b>Acil durum fonu</b><div class="hint">Katılım hesabı (vadesiz/kâr paylı) veya kolay bozulan TL</div></td><td class="r num"><b>' + tl(plan.toEmergency) + '</b></td></tr>';
      ['safe', 'medium', 'risky'].forEach(function (k) { if (plan[k]) h += '<tr><td><b><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + RISKCOL[k] + '"></i> ' + C.RISK[k] + '</b><div class="hint">' + esc(HALAL[k]) + '</div></td><td class="r num"><b>' + tl(plan[k]) + '</b></td></tr>'; });
      h += '<tr><td>Toplam</td><td class="r num"><b>' + tl(plan.surplus) + '</b></td></tr></tbody></table>';
    }
    h += '<p class="hint">Faizli ürünler (mevduat faizi, faizli fon, tahvil/bono, repo) önerilmez. Ürün seçerken danışma kurulu onayına bak.</p></section>';
    h += '</div>';

    // Projeksiyon
    h += renderProjection(an);

    // Detaylı oranlar
    h += '<section class="card detail-only" style="margin-top:14px"><h2>Oranlar ve formüller</h2><div class="tablewrap"><table><thead><tr><th>Gösterge</th><th class="r">Değer</th><th>Formül / yorum</th></tr></thead><tbody>' +
      tr('Tasarruf oranı', pct(b.savingsRateBp), '(Gelir − Gider) ÷ Gelir. %20 ve üstü sağlıklı kabul edilir.') +
      tr('Sabit gider oranı', pct(b.fixedRatioBp), 'Sabit gider ÷ Gelir. %50\'nin altı rahat bir bütçe sayılır.') +
      tr('Acil fonun karşıladığı süre', (em.coverMonthsX100 / 100).toFixed(1).replace('.', ',') + ' ay', 'Acil fona sayılan varlıklar ÷ aylık toplam gider') +
      tr('Acil fon hedefi', tl(em.target), em.months + ' × aylık gider (' + tl(b.expense) + ')') +
      tr('Hedef için gereken aylık birikim (getirisiz)', tl(g.neededMonthly), 'Kalan tutar (' + tl(g.remaining) + ') ÷ kalan ay (' + g.monthsLeft + ')') +
      tr('Aylık fazla bunu karşılıyor mu?', b.surplus >= g.neededMonthly ? '<span class="pill ok">Evet</span>' : '<span class="pill warn">Hayır</span>', 'Getiri hiç olmasa bile hedefe yetişip yetişmeyeceğini gösterir (acil fon önce tamamlanır).') +
      tr('Enflasyon varsayımı', pct(state.settings.inflationBp), 'Yıllık; yalnızca nominal (geleceğin TL\'si) gösterim için. Ayarlardan değiştir.') +
      '</tbody></table></div></section>';
    return h;
  }
  function sbp(bp) { return (bp > 0 ? '+' : '') + (bp / 100).toFixed(1).replace('.', ',') + ' puan'; }
  function tr(a, b, c) { return '<tr><td>' + a + '</td><td class="r num">' + b + '</td><td class="hint">' + c + '</td></tr>'; }
  function seg(v, total, color) { return v > 0 ? '<span style="width:' + (v * 100 / total) + '%;background:' + color + '"></span>' : ''; }
  function progress(bp) { return '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(bp / 100) + '"><span style="width:' + Math.min(100, bp / 100) + '%"></span></div>' + '%' + Math.round(bp / 100) + ' · '; }
  function kpi(label, value, sub, help) { return '<div class="card kpi"><div class="label">' + label + ' ' + tip(help) + '</div><div class="value">' + value + '</div><div class="sub">' + sub + '</div></div>'; }

  function renderProjection(an) {
    var g = an.goal, sc = an.scenarios, keys = ['pessimistic', 'base', 'optimistic'], cols = { pessimistic: 'var(--risky)', base: 'var(--brand)', optimistic: 'var(--safe)' };
    var h = '<section class="card" style="margin-top:14px"><h2>Gelecek tahmini: hedefe ulaşır mıyım? ' + tip('Üç farklı piyasa senaryosuyla birikiminin nasıl büyüyebileceği. Tutarlar bugünün parasıyladır (enflasyondan arındırılmış). Kesin değildir.') + '</h2>';
    var w = 900, hh = 320, padL = 104, padB = 28, padT = 14, n = sc.base.series.length - 1;
    var maxV = Math.max(g.target, sc.optimistic.series[n].invest) * 1.08 || 1;
    function x(m) { return padL + (w - padL - 10) * m / n; }
    function y(v) { return padT + (hh - padT - padB) * (1 - v / maxV); }
    var svg = '<svg viewBox="0 0 ' + w + ' ' + hh + '" role="img" aria-label="Üç senaryoda birikim tahmini grafiği">';
    for (var i = 0; i <= 4; i++) { var v = maxV * i / 4; svg += '<line x1="' + padL + '" x2="' + (w - 10) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (padL - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(M.formatShort(Math.round(v))) + '</text>'; }
    for (var yr = 0; yr * 12 <= n; yr++) svg += '<text x="' + x(yr * 12) + '" y="' + (hh - 8) + '" text-anchor="middle">' + yr + '. yıl</text>';
    if (g.target) svg += '<line x1="' + padL + '" x2="' + (w - 10) + '" y1="' + y(g.target) + '" y2="' + y(g.target) + '" stroke="var(--ink)" stroke-dasharray="5 4"/><text x="' + (w - 12) + '" y="' + (y(g.target) - 5) + '" text-anchor="end" style="fill:var(--ink)">Hedef ' + esc(M.formatShort(g.target)) + '</text>';
    if (g.monthsLeft <= n) svg += '<line x1="' + x(g.monthsLeft) + '" x2="' + x(g.monthsLeft) + '" y1="' + padT + '" y2="' + (hh - padB) + '" stroke="var(--muted)" stroke-dasharray="2 3"/>';
    keys.forEach(function (k) { svg += '<polyline fill="none" stroke="' + cols[k] + '" stroke-width="2.5" points="' + sc[k].series.map(function (p) { return x(p.m).toFixed(1) + ',' + y(p.invest).toFixed(1); }).join(' ') + '"/>'; });
    svg += '</svg>';
    h += '<div class="chart">' + svg + '</div><div class="legend">' + keys.map(function (k) { return '<span><i style="background:' + cols[k] + '"></i>' + sc[k].label + '</span>'; }).join('') + '<span>- - - hedef tutar · dikey çizgi: hedef tarihi</span></div>';
    h += '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Senaryo</th><th class="r">' + esc(ymLabel(g.targetYm)) + '\'de hedefe ayrılan birikim</th><th class="r">Hedefe ulaşma</th><th class="r detail-only">Nominal (geleceğin TL\'si)</th><th class="detail-only">Varsayım (yıllık reel getiri: güvenli / orta / riskli)</th></tr></thead><tbody>';
    keys.forEach(function (k) {
      var s = sc[k], reached = s.reachMonth;
      h += '<tr><td><b style="color:' + cols[k] + '">' + s.label + '</b></td><td class="r num">' + tl(s.atGoal) + '</td><td class="r">' +
        (reached == null ? '<span class="pill warn">' + monthsLabel(n) + ' içinde yok</span>' : reached <= g.monthsLeft ? '<span class="pill ok">' + monthsLabel(reached) + ' sonra ✓</span>' : '<span class="pill warn">' + monthsLabel(reached) + ' sonra (geç)</span>') +
        '</td><td class="r num detail-only">' + tl(s.atGoalNominal) + '</td><td class="detail-only hint">' + ['safe', 'medium', 'risky'].map(function (r) { return sbpPct(s.returnsBp[r]); }).join(' / ') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="hint"><b>Varsayımlar:</b> Tutarlar bugünün parasıyla (reel). Her ay artan para önce acil fonu tamamlar, sonra hedef dağılıma göre yatırılır; aylık katkının enflasyon kadar arttığı ve hedef fiyatının da enflasyonla birlikte yükseldiği kabul edilir. Getiriler enflasyonun <i>üstünde/altında</i> varsayımsal oranlardır, gerçek piyasa verisi değildir.</p>';
    h += '<p class="hint detail-only">Formül: her ay kova<sub>t</sub> = kova<sub>t−1</sub> × (1 + r)<sup>1/12</sup> + katkı payı; her adım kuruşa yuvarlanır. Nominal = reel × (1 + enflasyon %' + (state.settings.inflationBp / 100) + ')<sup>yıl</sup>. Senaryo oranlarını Ayarlar\'dan değiştirebilirsin.</p>';
    return h + '</section>';
  }
  function sbpPct(bp) { return (bp > 0 ? '+' : bp < 0 ? '−' : '') + '%' + (Math.abs(bp) / 100).toString().replace('.', ','); }

  /* ---------- BÜTÇE ---------- */
  function moneyInput(list, id, field, val, label) {
    return '<input class="money" type="text" inputmode="decimal" aria-label="' + esc(label) + '" data-list="' + list + '" data-id="' + id + '" data-field="' + field + '" value="' + esc(moneyInputVal(val)) + '">';
  }
  function textInput(list, id, field, val, label) {
    return '<input type="text" maxlength="120" aria-label="' + esc(label) + '" data-list="' + list + '" data-id="' + id + '" data-field="' + field + '" value="' + esc(val) + '">';
  }
  function delBtn(list, id, name) { return '<button class="btn small danger" data-act="del" data-list="' + list + '" data-id="' + id + '" aria-label="' + esc(name) + ' sil">Sil</button>'; }
  function renderBudget() {
    var b = C.budget(state);
    var h = '<h1>Bütçe</h1><p class="hint">Rakamları kutuya yazman yeterli; değişiklik anında kaydedilir. "1.250,50" veya "1250.50" gibi yazabilirsin.</p><div class="grid two">';
    h += '<section class="card"><h2>Aylık gelirler ' + tip('Eline geçen net tutarlar: maaş, kira geliri, ek iş gibi.') + '</h2><div class="tablewrap"><table><thead><tr><th>Ad</th><th class="r">Aylık tutar (TL)</th><th></th></tr></thead><tbody>';
    state.incomes.forEach(function (x) { h += '<tr><td>' + textInput('incomes', x.id, 'name', x.name, 'Gelir adı') + '</td><td>' + moneyInput('incomes', x.id, 'amount', x.amount, x.name + ' tutarı') + '</td><td>' + delBtn('incomes', x.id, x.name) + '</td></tr>'; });
    h += '</tbody><tfoot><tr><th>Toplam</th><th class="r num">' + tl2(b.income) + '</th><th></th></tr></tfoot></table></div><button class="btn" data-act="add" data-list="incomes">+ Gelir ekle</button></section>';
    h += '<section class="card"><h2>Özet</h2><table><tbody>' +
      '<tr><td>Toplam gelir</td><td class="r num">' + tl2(b.income) + '</td></tr><tr><td>Sabit giderler ' + tip('Her ay neredeyse aynı olan ve kaçınılamayan giderler: kira, fatura, ulaşım, temel market.') + '</td><td class="r num">− ' + tl2(b.fixed) + '</td></tr>' +
      '<tr><td>Değişken giderler ' + tip('Aydan aya değişen ve kısılabilen giderler: dışarıda yemek, eğlence, giyim.') + '</td><td class="r num">− ' + tl2(b.variable) + '</td></tr>' +
      '<tr><th>Aylık artan para</th><th class="r num ' + (b.surplus < 0 ? 'neg' : 'pos') + '">' + tl2(b.surplus) + '</th></tr></tbody></table>' +
      '<p class="hint detail-only">Kontrol: ' + tl2(b.income) + ' − ' + tl2(b.fixed) + ' − ' + tl2(b.variable) + ' = ' + tl2(b.surplus) + ' (kuruş hassasiyetinde)</p></section>';
    h += '</div><section class="card" style="margin-top:14px"><h2>Aylık giderler</h2><div class="tablewrap"><table><thead><tr><th>Ad</th><th>Tür</th><th class="r">Aylık tutar (TL)</th><th></th></tr></thead><tbody>';
    state.expenses.forEach(function (x) {
      h += '<tr><td>' + textInput('expenses', x.id, 'name', x.name, 'Gider adı') + '</td><td><select aria-label="Gider türü" data-list="expenses" data-id="' + x.id + '" data-field="type"><option value="fixed"' + (x.type === 'fixed' ? ' selected' : '') + '>Sabit</option><option value="variable"' + (x.type === 'variable' ? ' selected' : '') + '>Değişken</option></select></td><td>' + moneyInput('expenses', x.id, 'amount', x.amount, x.name + ' tutarı') + '</td><td>' + delBtn('expenses', x.id, x.name) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><th colspan="2">Toplam</th><th class="r num">' + tl2(b.expense) + '</th><th></th></tr></tfoot></table></div><button class="btn" data-act="add" data-list="expenses">+ Gider ekle</button></section>';
    // Gerçekleşen vs plan
    var ym = C.currentYm(), act = C.monthActuals(state.transactions, ym), cats = Object.keys(act.byCategory).sort(function (a, b2) { return act.byCategory[b2] - act.byCategory[a]; });
    h += '<section class="card" style="margin-top:14px"><h2>' + esc(ymLabel(ym)) + ': gerçekleşen harcamalar ' + tip('İşlemler bölümüne girdiğin veya belgeden aktardığın harcamaların kategorilere göre toplamı.') + '</h2>';
    if (!cats.length) h += '<p class="muted">Bu ay için kayıtlı işlem yok. <a href="#veri">Belgeden aktar</a> veya <a href="#islemler">elle ekle</a>.</p>';
    else {
      h += '<table><tbody>' + cats.map(function (c) { return '<tr><td>' + esc(c) + '</td><td style="width:45%"><div class="bar"><span style="width:' + (act.byCategory[c] * 100 / act.expense) + '%;background:var(--brand)"></span></div></td><td class="r num">' + tl2(act.byCategory[c]) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><th>Toplam harcama</th><th></th><th class="r num">' + tl2(act.expense) + '</th></tr><tr><td>Planlanan gider</td><td></td><td class="r num">' + tl2(b.expense) + '</td></tr></tfoot></table>';
    }
    return h + '</section>';
  }

  /* ---------- VARLIKLAR ve HEDEF ---------- */
  function renderAssets() {
    var a = C.assets(state);
    var h = '<h1>Varlıklar ve hedef</h1><p class="hint">Her varlığın bugünkü TL değerini yaz. Uygulama piyasa fiyatı çekmez; değeri sen güncellersin (ör. ayda bir).</p>';
    h += '<section class="card"><h2>Birikimlerim ' + tip('"Acil fon" işaretli varlıklar acil durum fonuna sayılır. Risk seviyesi dağılım hesabında kullanılır.') + '</h2><div class="tablewrap"><table><thead><tr><th>Ad</th><th>Tür</th><th>Risk</th><th>Acil fon</th><th class="r">Değer (TL)</th><th></th></tr></thead><tbody>';
    state.assets.forEach(function (x) {
      h += '<tr><td>' + textInput('assets', x.id, 'name', x.name, 'Varlık adı') + '</td><td><select aria-label="Varlık türü" data-list="assets" data-id="' + x.id + '" data-field="cls">' + Object.keys(C.ASSET_CLASSES).map(function (k) { return '<option value="' + k + '"' + (x.cls === k ? ' selected' : '') + '>' + esc(C.ASSET_CLASSES[k].label) + '</option>'; }).join('') + '</select></td>' +
        '<td><select aria-label="Risk seviyesi" data-list="assets" data-id="' + x.id + '" data-field="risk">' + ['safe', 'medium', 'risky'].map(function (k) { return '<option value="' + k + '"' + (x.risk === k ? ' selected' : '') + '>' + C.RISK[k] + '</option>'; }).join('') + '</select></td>' +
        '<td style="text-align:center"><input type="checkbox" aria-label="Acil fona say" data-list="assets" data-id="' + x.id + '" data-field="emergency"' + (x.emergency ? ' checked' : '') + '></td><td>' + moneyInput('assets', x.id, 'value', x.value, x.name + ' değeri') + '</td><td>' + delBtn('assets', x.id, x.name) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><th colspan="4">Toplam varlık</th><th class="r num">' + tl2(a.total) + '</th><th></th></tr></tfoot></table></div><button class="btn" data-act="add" data-list="assets">+ Varlık ekle</button>';
    h += '<p class="hint">Helal araç örnekleri — Güvenli: katılım hesabı, kira sertifikası fonu. Orta: altın, katılım fonları. Riskli: katılım endeksi hisseleri, SPUS/HLAL gibi helal ETF\'ler. Faizli mevduat/fon/tahvil eklememeni öneririz.</p></section>';
    h += '<section class="card" style="margin-top:14px"><h2>Borçlarım ' + tip('Kredi kartı borcu, taksitler, kişisel borçlar. Net varlıktan düşülür.') + '</h2><div class="tablewrap"><table><thead><tr><th>Ad</th><th class="r">Kalan tutar (TL)</th><th></th></tr></thead><tbody>';
    state.debts.forEach(function (x) { h += '<tr><td>' + textInput('debts', x.id, 'name', x.name, 'Borç adı') + '</td><td>' + moneyInput('debts', x.id, 'amount', x.amount, x.name + ' tutarı') + '</td><td>' + delBtn('debts', x.id, x.name) + '</td></tr>'; });
    if (!state.debts.length) h += '<tr><td colspan="3" class="muted">Borç yok.</td></tr>';
    h += '</tbody></table></div><button class="btn" data-act="add" data-list="debts">+ Borç ekle</button></section>';
    var g = state.goal;
    h += '<section class="card" style="margin-top:14px"><h2>Hedefim ' + tip('Tutarı bugünün fiyatıyla yaz (ör. bugün peşinat kaç TL ise). Uygulama enflasyonu ayrıca hesaba katar.') + '</h2><div class="grid two">' +
      '<div class="field"><label for="g-name">Hedefin adı</label><input id="g-name" type="text" maxlength="60" data-goal="name" value="' + esc(g.name) + '"></div>' +
      '<div class="field"><label for="g-target">Hedef tutar (bugünün parasıyla, TL)</label><input id="g-target" class="money" type="text" inputmode="decimal" data-goal="target" value="' + esc(moneyInputVal(g.target)) + '"></div>' +
      '<div class="field"><label for="g-date">Hedef tarih (ay)</label><input id="g-date" type="month" data-goal="targetYm" value="' + esc(g.targetYm) + '"></div></div></section>';
    return h;
  }

  /* ---------- İŞLEMLER ---------- */
  var txFilter = { ym: null, q: '' };
  function catOptions(sel) { return P.CATEGORIES.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join(''); }
  function renderTransactions() {
    if (!txFilter.ym) txFilter.ym = C.currentYm();
    var months = {}; state.transactions.forEach(function (t) { months[t.date.slice(0, 7)] = 1; }); months[C.currentYm()] = 1;
    var list = state.transactions.filter(function (t) { return (txFilter.ym === 'all' || t.date.slice(0, 7) === txFilter.ym) && (!txFilter.q || P.fold(t.description + ' ' + t.category).indexOf(P.fold(txFilter.q)) >= 0); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var inc = 0, exp = 0; list.forEach(function (t) { if (t.amount >= 0) inc = M.add(inc, t.amount); else exp = M.add(exp, -t.amount); });
    var h = '<h1>İşlemler</h1><section class="card"><h2>Elle işlem ekle</h2><form id="tx-form" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:end" novalidate>' +
      '<div class="field"><label for="tx-date">Tarih</label><input id="tx-date" type="date" required value="' + todayYmd() + '"></div>' +
      '<div class="field"><label for="tx-desc">Açıklama</label><input id="tx-desc" type="text" maxlength="120" placeholder="ör. Migros alışverişi" required></div>' +
      '<div class="field"><label for="tx-amt">Tutar (TL)</label><input id="tx-amt" class="money" type="text" inputmode="decimal" placeholder="0,00" required></div>' +
      '<div class="field"><label for="tx-type">Tür</label><select id="tx-type"><option value="-1">Harcama</option><option value="1">Gelir</option></select></div>' +
      '<div class="field"><label for="tx-cat">Kategori</label><select id="tx-cat">' + catOptions('Diğer') + '</select></div>' +
      '<div class="field"><button class="btn primary" type="submit">Ekle</button></div></form><p class="hint">Daha hızlısı: <a href="#veri">ekstre, fiş, Excel veya fotoğraftan aktar</a>.</p></section>';
    h += '<section class="card" style="margin-top:14px"><div class="row" style="margin-bottom:10px"><label class="sr" for="tx-month">Ay</label><select id="tx-month" style="max-width:200px"><option value="all"' + (txFilter.ym === 'all' ? ' selected' : '') + '>Tüm aylar</option>' +
      Object.keys(months).sort().reverse().map(function (m) { return '<option value="' + m + '"' + (m === txFilter.ym ? ' selected' : '') + '>' + ymLabel(m) + '</option>'; }).join('') + '</select>' +
      '<label class="sr" for="tx-q">Ara</label><input id="tx-q" type="search" placeholder="Ara…" style="max-width:240px" value="' + esc(txFilter.q) + '">' +
      '<span class="muted">' + list.length + ' işlem · Gelir <b class="pos num">' + tl2(inc) + '</b> · Harcama <b class="neg num">' + tl2(exp) + '</b></span></div>';
    if (!list.length) h += '<p class="muted">Bu filtreyle işlem yok.</p>';
    else {
      h += '<div class="tablewrap"><table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Kategori</th><th class="r">Tutar</th><th class="detail-only">Kaynak</th><th></th></tr></thead><tbody>';
      list.slice(0, 500).forEach(function (t) {
        h += '<tr><td class="num">' + dateLabel(t.date) + '</td><td>' + esc(t.description) + '</td><td><select aria-label="Kategori" data-list="transactions" data-id="' + t.id + '" data-field="category">' + catOptions(t.category) + '</select></td>' +
          '<td class="r num ' + (t.amount < 0 ? 'neg' : 'pos') + '">' + tl2(t.amount) + '</td><td class="detail-only hint">' + esc(t.source || '') + '</td><td>' + delBtn('transactions', t.id, t.description) + '</td></tr>';
      });
      h += '</tbody></table></div>' + (list.length > 500 ? '<p class="hint">İlk 500 işlem gösteriliyor; filtreyi daralt.</p>' : '');
    }
    return h + '</section>';
  }

  /* ---------- VERİ EKLE (içe aktarma) ---------- */
  var importOpts = { cc: false, method: 'ai' };
  function aiReady() { var p = AI.PROVIDERS[aiCfg.provider]; return !!(p && (!p.needsKey || (aiCfg.keys || {})[aiCfg.provider])); }
  function renderImport() {
    if (review) return renderReview();
    var p = AI.PROVIDERS[aiCfg.provider];
    var h = '<h1>Veri ekle</h1><p>Dosyanı seç veya buraya sürükle. <b>Hiçbir şey sen onaylamadan kaydedilmez:</b> önce kontrol tablosu açılır, düzeltir, sonra onaylarsın.</p>';
    h += '<div class="choices">' +
      '<a class="choice" href="#islemler" style="text-decoration:none;color:inherit"><b>✍️ Elle gir</b><span>Tek tek işlem ekle</span></a>' +
      '<button class="choice" data-pick=".xlsx,.xls,.csv,.ods,.txt"><b>📊 Excel / CSV</b><span>Banka hareket dökümü, kendi tablon</span></button>' +
      '<button class="choice" data-pick=".pdf,application/pdf"><b>📄 PDF ekstre</b><span>Hesap veya kredi kartı ekstresi</span></button>' +
      '<button class="choice" data-pick="image/*"><b>📷 Fotoğraf / fiş / ekran görüntüsü</b><span>Alışveriş fişi, uygulama ekranı</span></button></div>';
    h += '<div class="drop" id="drop" tabindex="0" role="button" aria-label="Dosya seçmek için tıkla veya dosyayı buraya sürükle"><b>Dosyayı buraya sürükle</b> veya tıklayıp seç<div class="hint">Excel, CSV, PDF, JPG/PNG/WebP. Dosyalar cihazından çıkmaz (yapay zekâ ile okuma seçersen yalnızca seçtiğin sağlayıcıya gönderilir).</div></div>';
    h += '<input type="file" id="file-in" hidden>';
    h += '<section class="card" style="margin-top:14px"><h2>Okuma seçenekleri</h2>' +
      '<label class="row"><input type="checkbox" id="opt-cc"' + (importOpts.cc ? ' checked' : '') + '> Kredi kartı ekstresi: belgede <b>artı</b> görünen tutarlar <b>harcamadır</b> ' + tip('Kredi kartı ekstrelerinde harcamalar genelde eksi işaretsiz yazılır. Bunu işaretlersen artı tutarlar gider, eksi tutarlar (iade/ödeme) gelir sayılır. Kontrol tablosunda tek tıkla da çevirebilirsin.') + '</label>' +
      '<div class="field" style="margin-top:10px"><label for="opt-method">Fotoğraf ve taranmış PDF okuma yöntemi</label><select id="opt-method" style="max-width:520px">' +
      '<option value="ai"' + (importOpts.method === 'ai' ? ' selected' : '') + '>Yapay zekâ ile oku (en iyi sonuç) — ' + esc(p ? p.label : 'sağlayıcı seçilmedi') + '</option>' +
      '<option value="ocr"' + (importOpts.method === 'ocr' ? ' selected' : '') + '>Ücretsiz metin tanıma (OCR, Tesseract) — anahtar gerekmez</option></select>' +
      '<span class="hint">' + (aiReady() ? 'Yapay zekâ hazır.' : 'Yapay zekâ henüz ayarlı değil: <a href="#asistan">Asistan</a> bölümünden ücretsiz bir sağlayıcı (ör. Gemini) ekle veya OCR\'ı seç.') +
      ' OCR ilk kullanımda dil dosyasını internetten indirir (~10 MB); bundan sonra hızlanır. El yazısı ve bulanık fotoğraflarda yapay zekâ daha doğrudur.</span></div>' +
      '<p class="hint">Excel/CSV ve metin içeren PDF\'ler tamamen cihazında, internetsiz okunur.</p></section>';
    h += '<div id="imp-status" role="status" style="margin-top:12px"></div>';
    return h;
  }
  function setStatus(html, kind) { var el = $('#imp-status'); if (el) el.innerHTML = html ? '<div class="notice' + (kind ? ' ' + kind : '') + '">' + html + '</div>' : ''; }
  function busy(text) { setStatus('<span class="spinner"></span> ' + esc(text)); }

  function handleFile(file) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) return setStatus('Dosya çok büyük (30 MB üstü).', 'danger');
    var name = file.name || 'dosya', ext = (name.split('.').pop() || '').toLowerCase();
    var job;
    if (/^(xlsx|xls|csv|ods|txt|tsv)$/.test(ext)) job = importSheet(file);
    else if (ext === 'pdf' || file.type === 'application/pdf') job = importPdf(file);
    else if (/^image\//.test(file.type) || /^(jpe?g|png|webp|gif|bmp)$/.test(ext)) job = importImage(file);
    else if (/^(heic|heif)$/.test(ext)) return setStatus('HEIC (iPhone) fotoğrafları tarayıcıda açılamıyor. Telefonda "Ayarlar > Kamera > Biçimler > En Uyumlu" seç veya ekran görüntüsü al.', 'warn');
    else if (ext === 'json') return setStatus('Yedek dosyası mı? Onu <a href="#ayarlar">Ayarlar ve yedek</a> bölümünden geri yükle.', 'warn');
    else return setStatus('Bu dosya türü desteklenmiyor: .' + esc(ext), 'warn');
    job.catch(function (e) { console.error(e); setStatus('Okunamadı: ' + esc(e.message), 'danger'); });
  }

  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1254').decode(buf); }
  }
  function importSheet(file) {
    busy('Tablo okunuyor…');
    return loadScript('vendor/xlsx.full.min.js').then(function () { return file.arrayBuffer(); }).then(function (buf) {
      var ext = file.name.split('.').pop().toLowerCase(), wb;
      if (ext === 'csv' || ext === 'txt' || ext === 'tsv') wb = XLSX.read(decodeText(buf).replace(/^\uFEFF/, ''), { type: 'string', raw: true });
      else wb = XLSX.read(buf, { type: 'array', cellDates: true });
      var sheets = wb.SheetNames.map(function (n) { return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }; });
      var best = sheets.reduce(function (a, b) { return b.rows.length > a.rows.length ? b : a; }, sheets[0]);
      if (!best || !best.rows.length) throw new Error('Dosyada veri bulunamadı');
      var map = P.detectColumns(best.rows);
      review = { source: file.name, kind: 'tablo', table: { sheets: sheets, sheet: best.name, rows: best.rows, map: map }, cc: importOpts.cc, docTotal: null };
      rebuildFromTable();
      render();
    });
  }
  function rebuildFromTable() {
    var t = review.table;
    var rows = P.rowsFromTable(t.rows, t.map, review.cc ? -1 : 1);
    startReviewRows(rows);
  }
  function startReviewRows(rows) {
    review.rows = rows.map(function (r, i) {
      return { key: i, include: true, date: r.date, rawDate: r.rawDate, description: r.description || '', amount: r.amount, note: r.note || '',
        category: P.suggestCategory(r.description, r.amount || 0), source: r.source };
    });
    revalidate(true);
  }
  function revalidate(initial) {
    var today = todayYmd();
    P.markDuplicates(review.rows, state.transactions);
    review.rows.forEach(function (r) { P.validateRow(r, today); if (initial && (r.duplicate || r.errors.length)) r.include = false; });
  }

  function loadPdfLib() {
    return loadScript('vendor/pdf.min.js').then(function () { return loadScript('vendor/pdf.worker.min.js'); }).then(function () {
      // Worker betiği ana iş parçacığında yüklendi: dosyadan (file://) açıldığında da çalışır.
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      return window.pdfjsLib;
    });
  }
  function pdfText(pdf) {
    var pages = [], chain = Promise.resolve();
    for (var i = 1; i <= pdf.numPages; i++) (function (n) {
      chain = chain.then(function () { return pdf.getPage(n); }).then(function (page) { return page.getTextContent(); }).then(function (tc) {
        var lines = [];
        tc.items.forEach(function (it) {
          if (!it.str || !it.str.trim()) return;
          var y = it.transform[5], x = it.transform[4];
          var line = lines.find(function (l) { return Math.abs(l.y - y) <= 2.5; });
          if (!line) { line = { y: y, items: [] }; lines.push(line); }
          line.items.push({ x: x, s: it.str });
        });
        lines.sort(function (a, b) { return b.y - a.y; });
        pages.push(lines.map(function (l) { return l.items.sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s; }).join(' '); }).join('\n'));
      });
    })(i);
    return chain.then(function () { return pages.join('\n'); });
  }
  function pdfToImages(pdf, maxPages) {
    var out = [], chain = Promise.resolve(), n = Math.min(pdf.numPages, maxPages || 5);
    for (var i = 1; i <= n; i++) (function (k) {
      chain = chain.then(function () { return pdf.getPage(k); }).then(function (page) {
        var vp1 = page.getViewport({ scale: 1 }), scale = Math.min(2.2, 1600 / vp1.width), vp = page.getViewport({ scale: scale });
        var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { out.push(canvasToImg(c)); });
      });
    })(i);
    return chain.then(function () { return out; });
  }
  function canvasToImg(c) { var d = c.toDataURL('image/jpeg', 0.88); return { mime: 'image/jpeg', data: d.split(',')[1], dataUrl: d }; }
  var lastPdf = null;
  function importPdf(file) {
    busy('PDF okunuyor…');
    return loadPdfLib().then(function (lib) { return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: new Uint8Array(buf) }).promise; }); })
      .then(function (pdf) {
        lastPdf = { pdf: pdf, name: file.name };
        return pdfText(pdf).then(function (text) {
          var res = P.parseTextLines(text, importOpts.cc ? -1 : 1);
          if (res.rows.length) {
            review = { source: file.name, kind: 'pdf', cc: importOpts.cc, docTotal: res.totals.length ? res.totals[res.totals.length - 1].amount : null, totalsFound: res.totals, pdfText: text };
            startReviewRows(res.rows); render();
          } else {
            setStatus('Bu PDF\'te otomatik okunabilen işlem satırı bulunamadı (taranmış veya alışılmadık biçim olabilir). ' +
              '<div class="row" style="margin-top:8px"><button class="btn small primary" data-act="pdf-ai">Yapay zekâ ile oku</button><button class="btn small" data-act="pdf-ocr">Ücretsiz OCR ile oku</button></div>', 'warn');
          }
        });
      });
  }
  function readImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 2000, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(canvasToImg(c));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Görsel açılamadı')); };
      img.src = url;
    });
  }
  function importImage(file) {
    busy('Görsel hazırlanıyor…');
    return readImage(file).then(function (img) { return importOpts.method === 'ocr' ? ocrImages([img], file.name) : aiImages([img], file.name); });
  }
  var EXTRACT_PROMPT = 'Bu belgedeki (alışveriş fişi, banka/kredi kartı ekstresi veya uygulama ekran görüntüsü) finansal işlemleri çıkar.\n' +
    'SADECE şu JSON\'u döndür, başka metin yazma:\n{"merchant": "işyeri adı veya null", "date": "YYYY-MM-DD veya null", "total": sayı veya null, "transactions": [{"date": "YYYY-MM-DD", "description": "kısa açıklama", "amount": sayı}]}\n' +
    'Kurallar:\n- Harcama/gider tutarları NEGATİF, gelir/iade/gelen para POZİTİF.\n- Tutarları JSON sayısı olarak nokta ondalıkla yaz (ör. -1250.5). Binlik ayırıcı kullanma.\n' +
    '- Fişte kalemler varsa her kalemi ayrı satır yaz; "total" alanına fişin TOPLAM tutarını (pozitif) yaz. KDV, ara toplam, nakit, para üstü satırlarını işlem olarak yazma.\n' +
    '- Ekstrede "bakiye" sütununu tutar sanma. Dönem borcu/toplam varsa "total" alanına yaz.\n- Tarih yalnızca belgenin başında yazıyorsa her satıra o tarihi koy. Türkiye tarih biçimi GG.AA.YYYY\'dir.\n- Belgede olmayan hiçbir bilgiyi uydurma; okuyamadığın alanı null bırak.';
  function aiImages(images, name) {
    if (!aiReady()) { setStatus('Yapay zekâ ayarlı değil. <a href="#asistan">Asistan</a> bölümünden bir sağlayıcı ve anahtar ekle ya da yöntem olarak OCR\'ı seç.<div class="row" style="margin-top:8px"><button class="btn small" data-act="retry-ocr">Bunun yerine OCR ile oku</button></div>', 'warn'); pendingImages = { images: images, name: name }; return Promise.resolve(); }
    busy(AI.PROVIDERS[aiCfg.provider].label + ' belgeyi okuyor… (birkaç saniye sürebilir)');
    return AI.chat(aiCfg, 'Sen dikkatli bir muhasebe asistanısın. Yalnızca geçerli JSON üretirsin.', [{ role: 'user', text: EXTRACT_PROMPT, images: images }], true).then(function (txt) {
      var res = P.rowsFromAiJson(txt);
      if (!res.rows.length) throw new Error('Belgede işlem bulunamadı.');
      review = { source: name + ' (yapay zekâ: ' + AI.PROVIDERS[aiCfg.provider].label + ')', kind: 'ai', cc: false, docTotal: res.docTotal, preview: images[0].dataUrl };
      startReviewRows(res.rows.map(function (r) { if (r.description && res.merchant && P.fold(r.description).indexOf(P.fold(res.merchant)) < 0 && res.rows.length > 1) r.description = r.description + ' (' + res.merchant + ')'; return r; }));
      render();
    });
  }
  var pendingImages = null;
  function ocrImages(images, name) {
    busy('Ücretsiz OCR yükleniyor… (ilk seferde dil dosyası indirilir)');
    return loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js').catch(function () {
      throw new Error('OCR kütüphanesi indirilemedi. İnternet bağlantını kontrol et veya yapay zekâ ile okumayı dene.');
    }).then(function () {
      var texts = [], chain = Promise.resolve();
      images.forEach(function (im, i) {
        chain = chain.then(function () {
          return Tesseract.recognize(im.dataUrl, 'tur+eng', { logger: function (m) { if (m.status === 'recognizing text') busy('Metin tanınıyor… sayfa ' + (i + 1) + '/' + images.length + ' %' + Math.round(m.progress * 100)); } })
            .then(function (r) { texts.push(r.data.text); });
        });
      });
      return chain.then(function () {
        var text = texts.join('\n'), lines = P.parseTextLines(text, importOpts.cc ? -1 : 1), rec = P.parseReceiptText(text);
        var useLines = lines.rows.length >= 2 && lines.rows.length >= rec.rows.length;
        var rows = useLines ? lines.rows : rec.rows;
        if (!rows.length) throw new Error('Metin tanındı ama işlem satırı çıkarılamadı. Daha net bir fotoğraf dene veya yapay zekâ ile oku.');
        review = { source: name + ' (OCR)', kind: 'ocr', cc: importOpts.cc, docTotal: useLines ? (lines.totals.length ? lines.totals[lines.totals.length - 1].amount : null) : rec.docTotal, preview: images[0].dataUrl, ocrText: text };
        startReviewRows(rows); render();
      });
    });
  }

  /* ---------- KONTROL / ONAY TABLOSU ---------- */
  function renderReview() {
    var r = review, h = '<h1>Kontrol et ve onayla</h1>';
    h += '<p>Kaynak: <b>' + esc(r.source) + '</b>. Satırları kontrol et; yanlış olanı düzelt ya da işaretini kaldır. <b>"Onayla ve kaydet"e basana kadar hiçbir şey kaydedilmez.</b></p>';
    if (r.kind === 'tablo') {
      var t = r.table, cols = Math.max.apply(null, t.rows.slice(0, 40).map(function (x) { return x.length; }).concat([1]));
      var hdr = t.map.headerRow >= 0 ? t.rows[t.map.headerRow] : [];
      function colSel(f, label) {
        var o = '<option value="-1">— yok —</option>';
        for (var c = 0; c < cols; c++) o += '<option value="' + c + '"' + (t.map[f] === c ? ' selected' : '') + '>' + String.fromCharCode(65 + (c % 26)) + (hdr[c] ? ': ' + esc(String(hdr[c]).slice(0, 24)) : '') + '</option>';
        return '<div class="field"><label>' + label + '</label><select data-map="' + f + '">' + o + '</select></div>';
      }
      h += '<details class="card" ' + (r.rows.length ? '' : 'open') + '><summary><b>Sütun eşleştirme</b> <span class="hint">(otomatik bulundu; yanlışsa değiştir)</span></summary><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:10px">' +
        (t.sheets.length > 1 ? '<div class="field"><label>Sayfa</label><select data-map="sheet">' + t.sheets.map(function (s) { return '<option' + (s.name === t.sheet ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></div>' : '') +
        colSel('date', 'Tarih sütunu') + colSel('desc', 'Açıklama sütunu') + colSel('amount', 'Tutar sütunu') + colSel('debit', 'Borç/çıkan sütunu') + colSel('credit', 'Alacak/giren sütunu') +
        '<div class="field"><label>Başlık satırı</label><input type="number" min="0" max="' + t.rows.length + '" data-map="headerRow" value="' + (t.map.headerRow + 1) + '"></div></div></details>';
    }
    if (r.preview) h += '<details class="card" style="margin-top:10px"><summary><b>Belgeyi göster</b> <span class="hint">(karşılaştırmak için)</span></summary><img src="' + r.preview + '" alt="Yüklenen belge" style="max-width:100%;max-height:600px;margin-top:10px;border-radius:8px"></details>';
    h += '<section class="card" style="margin-top:10px" id="rv-summary">' + reviewSummary() + '</section>';
    h += '<section class="card" style="margin-top:10px"><div class="row" style="margin-bottom:10px">' +
      '<button class="btn small" data-act="rv-all">Tümünü seç</button><button class="btn small" data-act="rv-none">Tümünü kaldır</button>' +
      '<button class="btn small" data-act="rv-flip">Seçililerde gelir ↔ gider çevir</button><button class="btn small" data-act="rv-merge">Seçilileri tek işlemde birleştir</button>' +
      '<span class="row" style="gap:6px"><label for="rv-date" class="hint">Seçililere tarih:</label><input type="date" id="rv-date" style="width:auto"><button class="btn small" data-act="rv-setdate">Uygula</button></span>' +
      '<span class="row" style="gap:6px"><label for="rv-cat" class="hint">Seçililere kategori:</label><select id="rv-cat" style="width:auto"><option value="">— seç —</option>' + catOptions('') + '</select><button class="btn small" data-act="rv-setcat">Uygula</button></span></div>';
    h += '<div class="tablewrap"><table class="review"><thead><tr><th><span class="sr">Dahil</span>✓</th><th>Tarih</th><th>Açıklama</th><th class="r">Tutar (TL) ' + tip('Eksi (−) harcama, artı gelir demektir.') + '</th><th>Kategori</th><th>Durum</th></tr></thead><tbody>';
    r.rows.forEach(function (x) {
      h += '<tr data-key="' + x.key + '" class="' + rowClass(x) + '"><td><input type="checkbox" aria-label="Bu satırı dahil et" data-rv="include"' + (x.include ? ' checked' : '') + '></td>' +
        '<td><input type="date" aria-label="Tarih" data-rv="date" value="' + esc(x.date || '') + '" style="min-width:130px">' + (!x.date && x.rawDate ? '<div class="hint">Okunan: ' + esc(x.rawDate) + '</div>' : '') + '</td>' +
        '<td><input type="text" aria-label="Açıklama" data-rv="description" maxlength="120" value="' + esc(x.description) + '" style="min-width:180px"></td>' +
        '<td><input type="text" class="money" inputmode="decimal" aria-label="Tutar" data-rv="amount" value="' + (Number.isInteger(x.amount) ? esc(moneyInputVal(x.amount)) : '') + '" style="min-width:110px"></td>' +
        '<td><select aria-label="Kategori" data-rv="category">' + catOptions(x.category) + '</select></td><td class="rv-status">' + rowStatus(x) + '</td></tr>';
    });
    h += '</tbody></table></div>' + (r.rows.length ? '' : '<p class="muted">Hiç satır çıkarılamadı. Sütun eşleştirmesini kontrol et.</p>') + '</section>';
    h += '<div class="row savebar"><button class="btn primary" data-act="rv-save" id="rv-save">Onayla ve kaydet</button><button class="btn" data-act="rv-cancel">Vazgeç</button></div>';
    if (r.pdfText || r.ocrText) h += '<details class="card detail-only" style="margin-top:14px"><summary>Belgeden okunan ham metin</summary><pre style="white-space:pre-wrap;font-size:.8rem;max-height:400px;overflow:auto">' + esc(r.pdfText || r.ocrText) + '</pre></details>';
    return h;
  }
  function rowClass(x) { return (x.include ? '' : 'excluded ') + (x.include && x.errors.length ? 'has-err' : ''); }
  function rowStatus(x) {
    var s = x.errors.map(function (e) { return '<span class="pill err">' + esc(e) + '</span>'; }).concat(x.warnings.map(function (w) { return '<span class="pill warn" title="' + esc(x.duplicate || '') + '">' + esc(w) + '</span>'; }));
    if (x.note) s.push('<span class="pill info">' + esc(x.note) + '</span>');
    return s.length ? s.join(' ') : '<span class="pill ok">Uygun</span>';
  }
  function reviewSummary() {
    var r = review, tc = P.totalsCheck(r.rows, r.docTotal);
    var errs = r.rows.filter(function (x) { return x.include && x.errors.length; }).length;
    var dups = r.rows.filter(function (x) { return x.duplicate; }).length;
    var h = '<div class="row" style="gap:16px"><span><b>' + r.rows.length + '</b> satır bulundu</span><span><b>' + tc.count + '</b> seçili</span>' +
      (dups ? '<span class="pill warn">' + dups + ' olası mükerrer (seçilmedi)</span>' : '') + (errs ? '<span class="pill err">' + errs + ' seçili satırda hata var</span>' : '') + '</div>' +
      '<div class="row" style="gap:16px;margin-top:8px"><span>Seçili gider: <b class="num neg">' + tl2(tc.expense) + '</b></span><span>Seçili gelir: <b class="num pos">' + tl2(tc.income) + '</b></span><span>Net: <b class="num">' + tl2(tc.net) + '</b></span></div>' +
      '<div class="row" style="margin-top:10px"><label for="rv-total"><b>Belgedeki toplam</b> ' + tip('Fişin TOPLAM\'ı veya ekstrenin dönem borcu. Okunan satırların toplamıyla karşılaştırılır; kuruşu kuruşuna eşleşmeli.') + '</label>' +
      '<input id="rv-total" class="money" type="text" inputmode="decimal" style="max-width:160px" placeholder="isteğe bağlı" value="' + (r.docTotal != null ? esc(moneyInputVal(r.docTotal)) : '') + '">';
    if (r.docTotal != null) h += tc.match ? '<span class="pill ok">Toplam tutuyor ✓</span>' : '<span class="pill err">Fark: ' + tl2(tc.diff) + '</span><span class="hint">Eksik/fazla satır, yanlış okunan tutar veya ekstrede önceki dönem borcu olabilir.</span>';
    h += '</div>';
    if (r.totalsFound && r.totalsFound.length > 1) h += '<p class="hint">Belgede bulunan toplamlar: ' + r.totalsFound.map(function (t) { return esc(t.label) + ' → ' + tl2(t.amount); }).join(' · ') + '</p>';
    return h;
  }
  function refreshReviewRow(x) {
    var tr = $('tr[data-key="' + x.key + '"]'); if (!tr) return;
    tr.className = rowClass(x); $('.rv-status', tr).innerHTML = rowStatus(x);
  }
  function refreshReview() {
    revalidate(false);
    review.rows.forEach(refreshReviewRow);
    var s = $('#rv-summary'); if (s) s.innerHTML = reviewSummary();
    var sel = review.rows.filter(function (x) { return x.include; }), bad = sel.some(function (x) { return x.errors.length; });
    var b = $('#rv-save'); if (b) { b.disabled = !sel.length || bad; b.textContent = bad ? 'Önce hatalı satırları düzelt' : 'Onayla ve ' + sel.length + ' işlemi kaydet'; }
  }
  function saveReview() {
    var sel = review.rows.filter(function (x) { return x.include; });
    if (!sel.length) return;
    if (sel.some(function (x) { return x.errors.length; })) return toast('Hatalı satırlar var.');
    var tc = P.totalsCheck(review.rows, review.docTotal);
    if (review.docTotal != null && !tc.match && !confirm('Seçili satırların toplamı belgedeki toplamla uyuşmuyor (fark ' + tl2(tc.diff) + '). Yine de kaydedilsin mi?')) return;
    var d = sel.filter(function (x) { return x.duplicate; }).length;
    if (d && !confirm(d + ' satır daha önce kaydedilmiş bir işlemle aynı görünüyor. Yine de kaydedilsin mi?')) return;
    var src = review.source;
    var ok = mutate(function (s) {
      sel.forEach(function (x) { s.transactions.push({ id: S.uid(), date: x.date, description: x.description.trim(), amount: x.amount, category: x.category, source: src }); });
    }, sel.length + ' işlem kaydedildi.');
    if (ok) { review = null; location.hash = '#islemler'; }
  }

  /* ---------- YAPAY ZEKÂ ASİSTANI ---------- */
  function contextSummary() {
    var an = C.analyze(state), b = an.budget, l = [];
    l.push('Tarih: ' + ymLabel(an.nowYm) + (state.isExample ? ' (DİKKAT: bunlar ÖRNEK veridir)' : ''));
    l.push('Aylık gelir: ' + tl(b.income) + '; sabit gider: ' + tl(b.fixed) + '; değişken gider: ' + tl(b.variable) + '; aylık fazla: ' + tl(b.surplus) + ' (tasarruf oranı ' + pct(b.savingsRateBp) + ')');
    l.push('Gider kalemleri: ' + state.expenses.map(function (e) { return e.name + ' ' + tl(e.amount) + ' (' + (e.type === 'fixed' ? 'sabit' : 'değişken') + ')'; }).join('; '));
    l.push('Varlıklar: ' + state.assets.map(function (a) { return a.name + ' ' + tl(a.value) + ' [' + C.RISK[a.risk] + (a.emergency ? ', acil fon' : '') + ']'; }).join('; ') + '. Borçlar: ' + (state.debts.length ? state.debts.map(function (d) { return d.name + ' ' + tl(d.amount); }).join('; ') : 'yok'));
    l.push('Net varlık: ' + tl(an.assets.netWorth) + '. Acil fon: ' + tl(an.emergency.current) + ' / hedef ' + tl(an.emergency.target) + ' (' + an.emergency.months + ' aylık gider).');
    l.push('Hedef: ' + state.goal.name + ', ' + tl(an.goal.target) + ' (bugünün parasıyla), tarih ' + ymLabel(an.goal.targetYm) + ', ' + an.goal.monthsLeft + ' ay kaldı, hedefe ayrılan birikim ' + tl(an.goal.current) + '.');
    l.push('Önerilen dağılım: güvenli ' + pct(an.targetAlloc.safe) + ', orta ' + pct(an.targetAlloc.medium) + ', riskli ' + pct(an.targetAlloc.risky) + '; şu an: ' + pct(an.currentAlloc.safe) + '/' + pct(an.currentAlloc.medium) + '/' + pct(an.currentAlloc.risky) + '.');
    l.push('Bu ayın planı: acil fona ' + tl(an.plan.toEmergency) + ', güvenli ' + tl(an.plan.safe) + ', orta ' + tl(an.plan.medium) + ', riskli ' + tl(an.plan.risky) + '.');
    l.push('Projeksiyon (hedef tarihinde, bugünün parasıyla): ' + ['pessimistic', 'base', 'optimistic'].map(function (k) { return an.scenarios[k].label + ' ' + tl(an.scenarios[k].atGoal); }).join(', ') + '. Enflasyon varsayımı ' + pct(state.settings.inflationBp) + '.');
    var act = an.actuals, cats = Object.keys(act.byCategory);
    if (cats.length) l.push('Bu ay gerçekleşen harcama: ' + tl(act.expense) + ' — ' + cats.map(function (c) { return c + ' ' + tl(act.byCategory[c]); }).join('; '));
    return l.join('\n');
  }
  var SYSTEM = 'Sen "Finans Pusulası" uygulamasının Türkçe kişisel finans asistanısın. Her zaman Türkçe, sade ve anlaşılır yaz; finans bilmeyen biri de anlamalı. ' +
    'Kısa paragraflar ve gerektiğinde madde işaretleri kullan. Kullanıcı yalnızca helal (faizsiz) araçlar istiyor: faizli mevduat, faizli fon, tahvil/bono, repo, kredi ile yatırım önerme; ' +
    'katılım hesabı, kira sertifikası (sukuk), altın, katılım fonları, katılım endeksi hisseleri, SPUS/HLAL gibi helal ETF\'ler önerilebilir. Güncel piyasa fiyatı uydurma; bilmiyorsan söyle. ' +
    'Hesap yaparken verilen rakamları kullan ve adım adım göster. Bunun yatırım tavsiyesi olmadığını gerektiğinde kısaca hatırlat.';
  function mdLite(t) { // güvenli basit biçimlendirme: önce kaçış, sonra kalın/liste
    var lines = esc(t).split('\n'), out = '', inList = false;
    lines.forEach(function (l) {
      var m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      l = (m ? m[1] : l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^#{1,4}\s*(.*)$/, '<b>$1</b>');
      if (m) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + l + '</li>'; }
      else { if (inList) { out += '</ul>'; inList = false; } if (l.trim()) out += '<p>' + l + '</p>'; }
    });
    return out + (inList ? '</ul>' : '');
  }
  function renderAssistant() {
    var prov = aiCfg.provider || '', p = AI.PROVIDERS[prov], models = (aiCfg.models || {})[prov] || {};
    var h = '<h1>Yapay zekâ asistanı</h1><div class="grid two"><section class="card"><h2>Sağlayıcı ayarları</h2>' +
      '<div class="notice warn"><b>Anahtarların yalnızca bu cihazda saklanır</b> (tarayıcı depolaması). Yedek dosyasına girmez, hiçbir sunucuya gönderilmez; yalnızca seçtiğin sağlayıcıya istek atılırken kullanılır. Ortak bilgisayarda kullanıyorsan işin bitince anahtarı sil.</div>' +
      '<div class="field"><label for="ai-prov">Sağlayıcı</label><select id="ai-prov"><option value="">— seç —</option>' + Object.keys(AI.PROVIDERS).map(function (k) { return '<option value="' + k + '"' + (k === prov ? ' selected' : '') + '>' + esc(AI.PROVIDERS[k].label) + ' · ' + esc(AI.PROVIDERS[k].free) + '</option>'; }).join('') + '</select></div>';
    if (p) {
      h += '<p class="hint">Tarayıcı erişimi: ' + esc(p.cors) + '</p>';
      if (p.needsKey) h += '<div class="field"><label for="ai-key">API anahtarı</label><div class="row" style="flex-wrap:nowrap"><input id="ai-key" type="password" autocomplete="off" spellcheck="false" value="' + esc((aiCfg.keys || {})[prov] || '') + '"><button class="btn small" data-act="ai-showkey" type="button">Göster</button></div><span class="hint">Anahtar al: <a href="' + p.keyUrl + '" target="_blank" rel="noopener noreferrer">' + esc(p.keyUrl) + '</a></span></div>';
      else h += '<div class="field"><label for="ai-ollama">Ollama adresi</label><input id="ai-ollama" type="text" value="' + esc(aiCfg.ollamaUrl || p.baseUrl) + '"><span class="hint">Kurulum: <a href="' + p.keyUrl + '" target="_blank" rel="noopener noreferrer">ollama.com</a> → <code>ollama pull ' + esc(p.model) + '</code>. Başlatırken <code>OLLAMA_ORIGINS="*"</code> ayarla.</span></div>';
      h += '<div class="field"><label for="ai-model">Sohbet modeli</label><input id="ai-model" type="text" list="ai-models" placeholder="' + esc(p.model) + '" value="' + esc(models.chat || '') + '"><span class="hint">Boş bırakırsan varsayılan: ' + esc(p.model) + '</span></div>' +
        '<div class="field"><label for="ai-vmodel">Belge/fotoğraf okuma modeli</label><input id="ai-vmodel" type="text" list="ai-models" placeholder="' + esc(p.visionModel || p.model) + '" value="' + esc(models.vision || '') + '"><span class="hint">Görsel destekleyen bir model olmalı.</span></div>' +
        '<datalist id="ai-models"></datalist><div class="row"><button class="btn small" data-act="ai-list">Modelleri listele</button><button class="btn small" data-act="ai-test">Bağlantıyı test et</button><button class="btn small danger" data-act="ai-delkey">Bu anahtarı sil</button></div><div id="ai-msg" role="status" class="hint" style="margin-top:8px"></div>';
    }
    h += '<label class="row" style="margin-top:12px"><input type="checkbox" id="ai-ctx"' + (aiCfg.sendContext !== false ? ' checked' : '') + '> Verilerimin özetini soruyla birlikte gönder ' + tip('Asistanın sana özel cevap verebilmesi için bütçe, varlık ve hedef özetin gönderilir. İşaretini kaldırırsan sadece sorun gider.') + '</label>' +
      '<details style="margin-top:6px"><summary class="hint">Gönderilecek özeti gör</summary><pre style="white-space:pre-wrap;font-size:.8rem">' + esc(contextSummary()) + '</pre></details></section>';
    h += '<section class="card"><h2>Sohbet</h2><div class="chat" id="chat">' + (chatLog.length ? chatLog.map(function (m) { return '<div class="msg ' + m.role + '">' + (m.role === 'assistant' ? mdLite(m.text) : esc(m.text)) + '</div>'; }).join('') : '<p class="muted">Bir soru sor veya aşağıdaki hazır sorulardan birini seç.</p>') + '</div>' +
      '<div class="chips">' + ['Bu ay ne yapmalıyım?', 'Bütçemde nerede tasarruf edebilirim?', 'Hedefime zamanında ulaşabilir miyim?', 'Katılım fonu ve kira sertifikası nedir?', 'Grafikteki üç senaryo ne anlama geliyor?'].map(function (q) { return '<button class="chip" data-ask="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
      '<form id="chat-form" class="row" style="flex-wrap:nowrap"><label class="sr" for="chat-in">Soru</label><textarea id="chat-in" rows="2" placeholder="Sorunu yaz… (Enter gönderir)"></textarea><button class="btn primary" type="submit">Gönder</button></form>' +
      '<div class="row" style="margin-top:8px"><button class="btn small" data-act="chat-clear">Sohbeti temizle</button></div><p class="hint">Asistanın cevapları yanlış olabilir; önemli kararlarda rakamları kontrol et. Yatırım tavsiyesi değildir.</p></section></div>';
    return h;
  }
  function saveAiFromForm() {
    var prov = aiCfg.provider; if (!prov) return;
    aiCfg.keys = aiCfg.keys || {}; aiCfg.models = aiCfg.models || {};
    var k = $('#ai-key'); if (k) aiCfg.keys[prov] = k.value.trim();
    var o = $('#ai-ollama'); if (o) aiCfg.ollamaUrl = o.value.trim();
    aiCfg.models[prov] = { chat: ($('#ai-model') || {}).value ? $('#ai-model').value.trim() : '', vision: ($('#ai-vmodel') || {}).value ? $('#ai-vmodel').value.trim() : '' };
    Store.saveAi(aiCfg);
  }
  function ask(q) {
    q = (q || '').trim(); if (!q) return;
    if (!aiReady()) { toast('Önce bir sağlayıcı seçip anahtarını gir.'); return; }
    chatLog.push({ role: 'user', text: q });
    var history = chatLog.filter(function (m) { return m.role !== 'error'; }).slice(-10).map(function (m) { return { role: m.role, text: m.text }; });
    history = history.reduce(function (acc, m) { var last = acc[acc.length - 1]; if (last && last.role === m.role) last.text += '\n\n' + m.text; else acc.push({ role: m.role, text: m.text }); return acc; }, []);
    while (history.length && history[0].role !== 'user') history.shift();
    if (aiCfg.sendContext !== false) history[history.length - 1] = { role: 'user', text: 'Kullanıcının güncel finans özeti (uygulama hesapladı):\n' + contextSummary() + '\n\nSoru: ' + q };
    render();
    var chat = $('#chat'); if (chat) { chat.insertAdjacentHTML('beforeend', '<div class="msg assistant" id="thinking"><span class="spinner"></span> Düşünüyor…</div>'); chat.scrollTop = chat.scrollHeight; }
    AI.chat(aiCfg, SYSTEM, history, false).then(function (t) { chatLog.push({ role: 'assistant', text: t || '(boş yanıt)' }); }, function (e) { chatLog.push({ role: 'error', text: e.message }); })
      .then(function () { if (tab === 'asistan') { render(); var c = $('#chat'); if (c) c.scrollTop = c.scrollHeight; } });
  }

  /* ---------- AYARLAR ve YEDEK ---------- */
  function renderSettings() {
    var st = state.settings, sc = st.scenarios;
    var h = '<h1>Ayarlar ve yedek</h1><div class="grid two"><section class="card"><h2>Yedekleme ' + tip('Verilerin sadece bu tarayıcıda durur. Tarayıcı verisini silersen veya başka cihaza geçersen kaybolmaması için düzenli yedek al.') + '</h2>' +
      '<p>Son kayıt: <b>' + (state.updatedAt ? new Date(state.updatedAt).toLocaleString('tr-TR') : '—') + '</b></p>' +
      '<div class="row"><button class="btn primary" data-act="export">Yedek indir (.json)</button><button class="btn" data-act="import">Yedekten geri yükle</button><input type="file" id="backup-in" accept=".json,application/json" hidden>' +
      '<button class="btn" data-act="export-csv">İşlemleri Excel/CSV olarak indir</button></div>' +
      '<p class="hint">Yedek dosyası API anahtarlarını içermez. Geri yüklemeden önce dosya kontrol edilir; bozuksa hiçbir şey değişmez.</p></section>';
    h += '<section class="card"><h2>Plan ayarları</h2>' +
      '<div class="field"><label for="s-em">Acil durum fonu (kaç aylık gider?)</label><input id="s-em" type="number" min="1" max="24" step="1" data-set="emergencyMonths" value="' + st.emergencyMonths + '"><span class="hint">Genelde 3–6 ay önerilir; tek gelirliysen 6+.</span></div>' +
      '<div class="field"><label for="s-share">Acil fon dolana kadar aylık fazlanın yüzde kaçı acil fona gitsin?</label><input id="s-share" type="number" min="0" max="100" step="5" data-set="emergencyShareBp" value="' + st.emergencyShareBp / 100 + '"></div>' +
      '<div class="field"><label for="s-inf">Yıllık enflasyon varsayımı (%) ' + tip('Sadece "geleceğin TL\'si" ile gösterim için kullanılır. Ana hesaplar bugünün parasıyladır. Kendi beklentini yaz.') + '</label><input id="s-inf" type="number" min="0" max="500" step="0.5" data-set="inflationBp" value="' + st.inflationBp / 100 + '"></div></section>';
    h += '<section class="card detail-only"><h2>Senaryo varsayımları (yıllık reel getiri, %)</h2><p class="hint">Enflasyonun üstündeki (+) veya altındaki (−) yıllık getiri varsayımı. Gerçek piyasa verisi değildir; kendi görüşüne göre değiştir.</p><div class="tablewrap"><table><thead><tr><th>Senaryo</th><th>Güvenli</th><th>Orta</th><th>Riskli</th></tr></thead><tbody>';
    ['pessimistic', 'base', 'optimistic'].forEach(function (k) {
      h += '<tr><td>' + esc(sc[k].label) + '</td>' + ['safe', 'medium', 'risky'].map(function (r) { return '<td><input type="number" step="0.5" min="-90" max="100" aria-label="' + esc(sc[k].label + ' ' + C.RISK[r]) + '" data-scen="' + k + '" data-risk="' + r + '" value="' + sc[k].returnsBp[r] / 100 + '"></td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table></div><button class="btn small" data-act="scen-reset">Varsayılana dön</button></section>';
    h += '<section class="card"><h2>Veri yönetimi</h2><div class="row"><button class="btn" data-act="load-example">Örnek veriyi yükle</button><button class="btn danger" data-act="clear-all">Tüm verileri sil</button></div>' +
      '<p class="hint">Örnek veriyi yüklemek mevcut verilerinin yerine geçer (önce yedek almayı unutma). Silme işlemi API anahtarlarını silmez; onlar Asistan bölümünden silinir.</p>' +
      '<p class="hint detail-only">Uygulama sürümü 1.0 · Veri şeması v' + S.SCHEMA_VERSION + ' · Para hesapları tam sayı kuruşla yapılır · <a href="tests/tests.html">Hesap testlerini çalıştır</a></p></section></div>';
    return h;
  }
  function exportCsv() {
    var rows = [['Tarih', 'Açıklama', 'Kategori', 'Tutar (TL)', 'Kaynak']];
    state.transactions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) { rows.push([dateLabel(t.date), t.description, t.category, M.format(t.amount, { symbol: false }).replace('−', '-'), t.source || '']); });
    var csv = '\uFEFF' + rows.map(function (r) { return r.map(function (c) { c = String(c); if (/^[=+\-@]/.test(c) && !/^-?[\d.,]+$/.test(c)) c = "'" + c; return '"' + c.replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    Store.download('finans-islemler-' + todayYmd() + '.csv', csv, 'text/csv;charset=utf-8');
  }

  /* ---------- Yönlendirme ve çizim ---------- */
  var VIEWS = { ozet: renderDashboard, butce: renderBudget, varliklar: renderAssets, islemler: renderTransactions, veri: renderImport, asistan: renderAssistant, ayarlar: renderSettings };
  function render() {
    renderBanner();
    $$('nav.tabs a').forEach(function (a) { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var html;
    try { html = VIEWS[tab](); } catch (e) { console.error(e); html = '<div class="notice danger">Bu bölüm gösterilirken bir hata oluştu: ' + esc(e.message) + '. Verilerin güvende; Ayarlar\'dan yedek alabilirsin.</div>'; }
    $('#view').innerHTML = html;
    if (tab === 'veri' && review) refreshReview();
  }
  function route() {
    var t = (location.hash || '#ozet').slice(1);
    tab = VIEWS[t] ? t : 'ozet';
    render();
    document.title = ($('nav.tabs a[data-tab="' + tab + '"]').textContent) + ' · Finans Pusulası';
  }

  /* ---------- Olaylar ---------- */
  function findItem(list, id) { return state[list].find(function (x) { return x.id === id; }); }
  function onFieldChange(el) {
    var list = el.dataset.list, id = el.dataset.id, f = el.dataset.field, item = findItem(list, id);
    if (!item) return;
    if (f === 'amount' || f === 'value') {
      var k = M.parse(el.value);
      if (k == null || k < 0) { el.setAttribute('aria-invalid', 'true'); toast('Geçersiz tutar: "' + el.value + '". Örnek: 1.250,50'); return; }
      mutate(function () { item[f] = k; });
    } else if (f === 'name') {
      var v = el.value.trim(); if (!v) { el.setAttribute('aria-invalid', 'true'); toast('Ad boş olamaz'); return; }
      mutate(function () { item.name = v; });
    } else if (f === 'emergency') mutate(function () { item.emergency = el.checked; });
    else if (f === 'cls') mutate(function () { item.cls = el.value; var d = C.ASSET_CLASSES[el.value]; item.risk = d.risk; item.emergency = d.emergency; });
    else if (f === 'risk' || f === 'type' || f === 'category') mutate(function () { item[f] = el.value; });
  }
  function onClick(e) {
    var t = e.target.closest('[data-act],[data-pick],[data-ask]'); if (!t) { if (e.target.closest('#drop')) $('#file-in').click(); return; }
    if (t.dataset.pick) { var fi = $('#file-in'); fi.accept = t.dataset.pick; fi.value = ''; fi.click(); return; }
    if (t.dataset.ask) { ask(t.dataset.ask); return; }
    var act = t.dataset.act;
    var A = {
      'example-clear': function () { if (confirm('Örnek verilerin tamamı silinsin mi? (Sonra kendi verilerini girersin.)')) mutate(function (s) { var n = S.emptyState(); Object.keys(n).forEach(function (k) { s[k] = n[k]; }); s.settings.view = document.body.classList.contains('detailed') ? 'detailed' : 'simple'; }, 'Örnek veri temizlendi.'); },
      'example-mine': function () { mutate(function (s) { s.isExample = false; s.transactions.forEach(function (t2) { if (t2.source === 'örnek') t2.source = 'elle'; }); }, 'Veriler artık senin verilerin olarak işaretlendi.'); },
      'load-example': function () { if (state.incomes.length + state.assets.length + state.transactions.length === 0 || confirm('Mevcut verilerinin yerine örnek veri yüklensin mi?')) mutate(function (s) { var n = S.exampleState(); Object.keys(n).forEach(function (k) { if (k !== 'settings') s[k] = n[k]; }); }, 'Örnek veri yüklendi.'); },
      'clear-all': function () { if (confirm('TÜM veriler bu cihazdan silinecek. Emin misin? (Önce yedek almanı öneririz.)')) mutate(function (s) { var n = S.emptyState(); Object.keys(n).forEach(function (k) { s[k] = n[k]; }); }, 'Tüm veriler silindi.'); },
      'add': function () {
        var l = t.dataset.list;
        mutate(function (s) {
          if (l === 'incomes') s.incomes.push({ id: S.uid(), name: 'Yeni gelir', amount: 0 });
          if (l === 'expenses') s.expenses.push({ id: S.uid(), name: 'Yeni gider', type: 'variable', amount: 0 });
          if (l === 'assets') s.assets.push({ id: S.uid(), name: 'Yeni varlık', cls: 'cash', risk: 'safe', emergency: true, value: 0 });
          if (l === 'debts') s.debts.push({ id: S.uid(), name: 'Yeni borç', amount: 0 });
        });
        var inputs = $$('input[data-list="' + l + '"][data-field="name"]'); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
      },
      'del': function () { var l = t.dataset.list, id = t.dataset.id; mutate(function (s) { s[l] = s[l].filter(function (x) { return x.id !== id; }); }, 'Silindi.'); },
      'export': function () { var copy = JSON.parse(JSON.stringify(state)); copy.exportedAt = new Date().toISOString(); copy.app = 'Finans Pusulası'; Store.download('finans-yedek-' + todayYmd() + '.json', JSON.stringify(copy, null, 2)); toast('Yedek indirildi.'); },
      'import': function () { var b = $('#backup-in'); b.value = ''; b.click(); },
      'export-csv': exportCsv,
      'scen-reset': function () { mutate(function (s) { s.settings.scenarios = JSON.parse(JSON.stringify(C.DEFAULT_SCENARIOS)); }, 'Senaryolar varsayılana döndü.'); },
      'rv-cancel': function () { if (confirm('Kontrol tablosu kapatılsın mı? Hiçbir şey kaydedilmeyecek.')) { review = null; render(); } },
      'rv-save': saveReview,
      'rv-all': function () { review.rows.forEach(function (x) { x.include = true; }); render(); },
      'rv-none': function () { review.rows.forEach(function (x) { x.include = false; }); render(); },
      'rv-flip': function () { review.rows.forEach(function (x) { if (x.include && Number.isInteger(x.amount)) { x.amount = -x.amount; x.category = P.suggestCategory(x.description, x.amount); } }); render(); },
      'rv-setdate': function () { var d = $('#rv-date').value; if (!P.parseDate(d)) return toast('Önce geçerli bir tarih seç.'); review.rows.forEach(function (x) { if (x.include || !x.date) { if (x.include) x.date = d; } }); render(); },
      'rv-setcat': function () { var c = $('#rv-cat').value; if (!c) return toast('Önce bir kategori seç.'); review.rows.forEach(function (x) { if (x.include) x.category = c; }); render(); },
      'rv-merge': function () {
        var sel = review.rows.filter(function (x) { return x.include && Number.isInteger(x.amount); }); if (sel.length < 2) return toast('Birleştirmek için en az 2 satır seç.');
        var total = M.sum(sel.map(function (x) { return x.amount; }));
        var first = sel[0], desc = prompt('Birleşik işlemin açıklaması:', (review.source || '').replace(/\s*\(.*\)$/, '').replace(/\.[a-z]+$/i, '') || 'Alışveriş');
        if (desc == null) return;
        var keep = review.rows.filter(function (x) { return sel.indexOf(x) < 0; });
        keep.unshift({ key: Date.now(), include: true, date: first.date || sel.map(function (x) { return x.date; }).filter(Boolean)[0] || null, description: desc, amount: total, category: first.category, note: sel.length + ' kalem birleştirildi', source: first.source });
        review.rows = keep; revalidate(false); render();
      },
      'pdf-ai': function () { if (!lastPdf) return; busy('Sayfalar görüntüye çevriliyor…'); pdfToImages(lastPdf.pdf, 5).then(function (imgs) { return aiImages(imgs, lastPdf.name); }).catch(function (er) { setStatus('Okunamadı: ' + esc(er.message), 'danger'); }); },
      'pdf-ocr': function () { if (!lastPdf) return; busy('Sayfalar görüntüye çevriliyor…'); pdfToImages(lastPdf.pdf, 5).then(function (imgs) { return ocrImages(imgs, lastPdf.name); }).catch(function (er) { setStatus('Okunamadı: ' + esc(er.message), 'danger'); }); },
      'retry-ocr': function () { if (pendingImages) ocrImages(pendingImages.images, pendingImages.name).catch(function (er) { setStatus('Okunamadı: ' + esc(er.message), 'danger'); }); },
      'ai-showkey': function () { var k = $('#ai-key'); k.type = k.type === 'password' ? 'text' : 'password'; t.textContent = k.type === 'password' ? 'Göster' : 'Gizle'; },
      'ai-delkey': function () { if (aiCfg.keys) delete aiCfg.keys[aiCfg.provider]; Store.saveAi(aiCfg); render(); toast('Anahtar bu cihazdan silindi.'); },
      'ai-list': function () { saveAiFromForm(); var msg = $('#ai-msg'); msg.innerHTML = '<span class="spinner"></span> Modeller alınıyor…'; AI.listModels(aiCfg).then(function (ids) { $('#ai-models').innerHTML = ids.map(function (i) { return '<option value="' + esc(i) + '">'; }).join(''); msg.textContent = ids.length + ' model bulundu. Model kutusuna tıklayınca listeden seçebilirsin.' + (aiCfg.provider === 'openrouter' ? ' Ücretsiz olanların adı ":free" ile biter.' : ''); }, function (er) { msg.textContent = er.message; }); },
      'ai-test': function () { saveAiFromForm(); var msg = $('#ai-msg'); msg.innerHTML = '<span class="spinner"></span> Test ediliyor…'; AI.chat(aiCfg, 'Kısa cevap ver.', [{ role: 'user', text: 'Sadece "Bağlantı tamam" yaz.' }], false).then(function (r) { msg.textContent = '✓ Çalışıyor. Yanıt: ' + String(r).slice(0, 80); }, function (er) { msg.textContent = '✕ ' + er.message; }); },
      'chat-clear': function () { chatLog = []; render(); }
    };
    if (A[act]) A[act]();
  }
  function onChange(e) {
    var el = e.target;
    if (el.dataset.list && el.dataset.field) return onFieldChange(el);
    if (el.dataset.goal) {
      var f = el.dataset.goal;
      if (f === 'target') { var k = M.parse(el.value); if (k == null || k < 0) { el.setAttribute('aria-invalid', 'true'); return toast('Geçersiz tutar'); } return mutate(function (s) { s.goal.target = k; }); }
      if (f === 'targetYm') { if (!/^\d{4}-\d{2}$/.test(el.value)) return toast('Geçerli bir ay seç'); if (el.value < C.currentYm()) { toast('Hedef tarihi geçmişte olamaz'); return render(); } return mutate(function (s) { s.goal.targetYm = el.value; }); }
      if (f === 'name') { var v = el.value.trim(); if (!v) return toast('Ad boş olamaz'); return mutate(function (s) { s.goal.name = v; }); }
    }
    if (el.dataset.set) {
      var n = Number(String(el.value).replace(',', '.')), key = el.dataset.set;
      var lim = { emergencyMonths: [1, 24], emergencyShareBp: [0, 100], inflationBp: [0, 500] }[key];
      if (!isFinite(n) || n < lim[0] || n > lim[1]) { el.setAttribute('aria-invalid', 'true'); return toast('Değer ' + lim[0] + ' ile ' + lim[1] + ' arasında olmalı'); }
      if (key === 'emergencyMonths' && !Number.isInteger(n)) return toast('Tam sayı gir');
      return mutate(function (s) { s.settings[key] = key === 'emergencyMonths' ? n : Math.round(n * 100); }, 'Ayar kaydedildi.');
    }
    if (el.dataset.scen) {
      var v2 = Number(String(el.value).replace(',', '.'));
      if (!isFinite(v2) || v2 < -90 || v2 > 100) return toast('−90 ile 100 arasında bir yüzde gir');
      return mutate(function (s) { s.settings.scenarios[el.dataset.scen].returnsBp[el.dataset.risk] = Math.round(v2 * 100); });
    }
    if (el.dataset.map != null && review && review.table) {
      var t = review.table, m = el.dataset.map;
      if (m === 'sheet') { var sh = t.sheets.find(function (x) { return x.name === el.value; }); t.sheet = sh.name; t.rows = sh.rows; t.map = P.detectColumns(sh.rows); }
      else if (m === 'headerRow') { var hr = parseInt(el.value, 10); if (!(hr >= 0 && hr <= t.rows.length)) return toast('Geçersiz satır'); t.map.headerRow = hr - 1; }
      else t.map[m] = parseInt(el.value, 10);
      rebuildFromTable(); render(); return;
    }
    if (el.dataset.rv && review) {
      var tr = el.closest('tr'), x = review.rows.find(function (r) { return String(r.key) === tr.dataset.key; }), f2 = el.dataset.rv;
      if (f2 === 'include') x.include = el.checked;
      else if (f2 === 'date') x.date = P.parseDate(el.value);
      else if (f2 === 'description') { x.description = el.value; }
      else if (f2 === 'amount') { x.amount = M.parse(el.value); el.setAttribute('aria-invalid', x.amount == null ? 'true' : 'false'); if (x.amount != null) el.value = moneyInputVal(x.amount); }
      else if (f2 === 'category') x.category = el.value;
      refreshReview(); return;
    }
    if (el.id === 'rv-total' && review) { var dt = el.value.trim() ? M.parse(el.value) : null; if (el.value.trim() && dt == null) return toast('Geçersiz toplam'); review.docTotal = dt == null ? null : Math.abs(dt); refreshReview(); return; }
    if (el.id === 'opt-cc') { importOpts.cc = el.checked; return; }
    if (el.id === 'opt-method') { importOpts.method = el.value; return; }
    if (el.id === 'file-in') return handleFile(el.files[0]);
    if (el.id === 'backup-in') return importBackup(el.files[0]);
    if (el.id === 'tx-month') { txFilter.ym = el.value; return render(); }
    if (el.id === 'ai-prov') { aiCfg.provider = el.value; Store.saveAi(aiCfg); return render(); }
    if (el.id === 'ai-key' || el.id === 'ai-model' || el.id === 'ai-vmodel' || el.id === 'ai-ollama') { saveAiFromForm(); return; }
    if (el.id === 'ai-ctx') { aiCfg.sendContext = el.checked; Store.saveAi(aiCfg); return; }
    if (el.id === 'tx-desc') { var amt = M.parse(($('#tx-amt') || {}).value) || -1; $('#tx-cat').value = P.suggestCategory(el.value, Number($('#tx-type').value) * Math.abs(amt)); }
  }
  function importBackup(file) {
    if (!file) return;
    file.text().then(function (txt) {
      var obj; try { obj = JSON.parse(txt); } catch (e) { throw new Error('Dosya JSON değil'); }
      delete obj.exportedAt; delete obj.app;
      S.validateState(obj);
      var msg = 'Yedek dosyası geçerli: ' + obj.incomes.length + ' gelir, ' + obj.expenses.length + ' gider, ' + obj.assets.length + ' varlık, ' + obj.transactions.length + ' işlem.\nMevcut verilerin bu yedekle DEĞİŞTİRİLECEK. Devam edilsin mi?';
      if (!confirm(msg)) return;
      mutate(function (s) { Object.keys(s).forEach(function (k) { delete s[k]; }); Object.keys(obj).forEach(function (k) { s[k] = obj[k]; }); }, 'Yedek geri yüklendi.');
      setView(state.settings.view);
    }).catch(function (e) { toast('Yedek yüklenemedi, hiçbir şey değişmedi: ' + e.message); });
  }
  function onSubmit(e) {
    if (e.target.id === 'tx-form') {
      e.preventDefault();
      var date = P.parseDate($('#tx-date').value), desc = $('#tx-desc').value.trim(), amt = M.parse($('#tx-amt').value), sign = Number($('#tx-type').value);
      var errs = [];
      if (!date) errs.push('tarih'); if (!desc) errs.push('açıklama'); if (amt == null || amt === 0) errs.push('tutar');
      $('#tx-date').setAttribute('aria-invalid', String(!date)); $('#tx-desc').setAttribute('aria-invalid', String(!desc)); $('#tx-amt').setAttribute('aria-invalid', String(amt == null || amt === 0));
      if (errs.length) return toast('Kontrol et: ' + errs.join(', '));
      var tx = { id: S.uid(), date: date, description: desc, amount: sign * Math.abs(amt), category: $('#tx-cat').value, source: 'elle' };
      if (state.transactions.some(function (t) { return P.dupKey(t) === P.dupKey(tx); }) && !confirm('Aynı tarih, tutar ve açıklamayla bir işlem zaten var. Yine de eklensin mi?')) return;
      if (date > todayYmd() && !confirm('Tarih gelecekte. Emin misin?')) return;
      mutate(function (s) { s.transactions.push(tx); }, 'İşlem eklendi: ' + tl2(tx.amount));
    }
    if (e.target.id === 'chat-form') { e.preventDefault(); var q = $('#chat-in').value; ask(q); }
  }

  /* ---------- Başlat ---------- */
  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', function (e) { if (e.target.id === 'tx-q') { txFilter.q = e.target.value; var pos = e.target.selectionStart; render(); var q = $('#tx-q'); q.focus(); q.setSelectionRange(pos, pos); } else if (e.target.getAttribute('aria-invalid') === 'true') e.target.removeAttribute('aria-invalid'); });
    document.addEventListener('keydown', function (e) {
      if (e.target.id === 'chat-in' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
      if (e.target.id === 'drop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#file-in').click(); }
    });
    ['dragover', 'dragenter'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (tab === 'veri' && !review) { e.preventDefault(); var d = $('#drop'); if (d) d.classList.add('over'); } }); });
    document.addEventListener('dragleave', function (e) { var d = $('#drop'); if (d && e.target === d) d.classList.remove('over'); });
    document.addEventListener('drop', function (e) { if (tab === 'veri' && !review) { e.preventDefault(); var d = $('#drop'); if (d) d.classList.remove('over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); } });
    window.addEventListener('paste', function (e) { // Ekran görüntüsünü doğrudan yapıştır (Ctrl+V)
      if (tab !== 'veri' || review) return;
      var item = Array.prototype.find.call(e.clipboardData.items || [], function (i) { return /^image\//.test(i.type); });
      if (item) { e.preventDefault(); var f = item.getAsFile(); handleFile(new File([f], 'yapistirilan-ekran-goruntusu.png', { type: f.type })); }
    });
    $('#view-simple').onclick = function () { setView('simple'); };
    $('#view-detailed').onclick = function () { setView('detailed'); };
    window.addEventListener('hashchange', route);
    Store.load().then(function (s) {
      if (s) {
        try { state = S.validateState(s); }
        catch (e) {
          console.error(e); state = null;
          try { localStorage.setItem('finans-pusulasi:okunamayan-kayit-' + Date.now(), JSON.stringify(s)); } catch (e2) { /* */ }
          toast('Kayıtlı veri doğrulanamadı; eski kayıt ayrı bir anahtara yedeklendi ve örnek veri açıldı. (Hata: ' + e.message + ')');
        }
      }
      if (!state) { state = S.exampleState(); persist(); }
    }).catch(function (e) { console.error(e); state = S.exampleState(); }).then(function () {
      setView(state.settings.view || 'simple');
      route();
    });
  }
  init();
})();
