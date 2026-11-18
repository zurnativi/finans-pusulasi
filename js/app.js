/* app.js — Arayüz. Hesaplar calc.js'te, para işlemleri money.js'te (tam sayı kuruş). */
(function () {
  'use strict';
  var M = window.Money, C = window.Calc, L = window.Ledger, P = window.ImportParse, S = window.Sample, Store = window.Store, AI = window.AI, PF = window.Portfolio, PUI = null, AUI = null, CD = window.ChartData, CH = window.Charts || null, SUI = null, HUI = null, SM = window.SyncMerge, CB = window.CryptoBox;
  var state = null, lastSaved = null, undoStack = null, aiCfg = Store.loadAi(), chatLog = [], review = null, tab = 'ozet';
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  /* ---------- Yardımcılar ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tl(k) { return M.format(k, { noDecimals: true }); }
  function tl2(k) { return M.format(k); }
  function moneyInputVal(k) { return M.format(k, { symbol: false }); }
  function pct(bp) { return M.formatBp(bp, 0); }
  function pctS(bp) { return M.withSuffix(pct(bp)); } // "%52'si", "%14'ü" — Türkçe ek sayıya göre
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
  var scriptCache = {};
  function loadScript(src, timeoutMs) {
    if (scriptCache[src]) return scriptCache[src];
    var pr = new Promise(function (res, rej) {
      var s = document.createElement('script'), done = false;
      var fail = function (why) { if (done) return; done = true; s.remove(); delete scriptCache[src]; rej(new Error('Kütüphane yüklenemedi (' + why + '): ' + src)); };
      var t = setTimeout(function () { fail('zaman aşımı'); }, timeoutMs || 60000);
      s.src = src; s.dataset.src = src; s.async = true;
      s.onload = function () { if (done) return; done = true; clearTimeout(t); res(); };
      s.onerror = function () { clearTimeout(t); fail('ağ hatası'); };
      document.head.appendChild(s);
    });
    scriptCache[src] = pr; return pr;
  }
  function withTimeout(pr, ms, msg) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error(msg)); }, ms);
      pr.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  /* ---------- Durum değişikliği: önce kopya al (geri al), sonra doğrula ve kaydet ---------- */
  function mutate(fn, msg) {
    var before = JSON.stringify(state);
    try {
      fn(state);
      state = S.validateState(JSON.parse(JSON.stringify(state))); // doğrulanmış kopya (alım-satımla izlenen varlık değerleri de güncellenir)
    } catch (e) { state = JSON.parse(before); toast('İşlem yapılmadı: ' + e.message); render(); return false; }
    undoStack = before;
    persist();
    render();
    if (msg) toast(msg, function () { state = JSON.parse(undoStack); undoStack = null; persist(); render(); toast('Geri alındı'); });
    return true;
  }
  /* Net varlık geçmişi: her kayıtta bugünün değeri yazılır (örnek veride geçmiş, bugünün değeriyle biten örnek seri olarak üretilir). */
  function recordNw() {
    if (!CD || !state) return false;
    try {
      var nw = analyzeNow().assets.netWorth, t = today(), before = JSON.stringify(state.nwHistory || []);
      if (state.isExample && (!state.nwExample || !Array.isArray(state.nwHistory) || state.nwHistory.length < 3)) { state.nwHistory = CD.synthExample(nw, t); state.nwExample = true; }
      else {
        if (!state.isExample && state.nwExample) { state.nwHistory = []; delete state.nwExample; } // örnek geçmiş gerçek veriye asla karışmaz
        state.nwHistory = CD.record(state.nwHistory, t, nw).list;
      }
      return JSON.stringify(state.nwHistory) !== before;
    } catch (e) { console.error(e); return false; }
  }
  /* Kaydet: önce son kayıtlı hâlle farkı çıkar ve değişen kayıtlara eşitleme zaman damgası vur (silinene silme izi), sonra yaz.
   * opts.noStamp: eşitlemeden gelen hâl (damgaları zaten doğru) yeniden damgalanmaz. */
  function persist(opts) {
    recordNw();
    try { if (!(opts && opts.noStamp) && lastSaved && SM) SM.stamp(lastSaved, state, Date.now()); else if (SM) SM.stamp(null, state, Date.now()); } catch (e) { console.error(e); }
    lastSaved = JSON.parse(JSON.stringify(state));
    return Store.save(state).then(function () { if (SUI) SUI.onSaved(); }, function (e) { toast('Kaydedilemedi! Tarayıcı depolaması dolu veya kapalı olabilir: ' + e.message); });
  }
  /* Eşitlemeden gelen yeni hâl: olduğu gibi al, damgalama */
  function replaceState(ns) { state = ns; persist({ noStamp: true }); setView(state.settings.view || 'simple'); render(); }
  /* Kopya/yedek geri yükleme: tüm kayıtlar yenisiyle değişir (geri alınabilir, eşitlemede yeni değişiklik sayılır) */
  function restoreState(obj, msg) { mutate(function (s) { Object.keys(s).forEach(function (k) { delete s[k]; }); Object.keys(obj).forEach(function (k) { s[k] = obj[k]; }); }, msg || 'Geri yüklendi.'); setView(state.settings.view); }

  /* ---------- Görünüm (sade/detaylı) ---------- */
  function setView(v) {
    document.body.classList.toggle('detailed', v === 'detailed');
    $('#view-simple').setAttribute('aria-pressed', String(v !== 'detailed'));
    $('#view-detailed').setAttribute('aria-pressed', String(v === 'detailed'));
    if (state && state.settings.view !== v) { state.settings.view = v; persist(); if (tab === 'ozet') { foldOpen = {}; render(); } }
  }

  /* ---------- Üst bant ---------- */
  function renderBanner() {
    var b = $('#banner');
    if (state.isExample) {
      b.innerHTML = '<div class="banner example" role="note"><div class="grow"><b>ÖRNEK VERİ</b> — Gördüğün rakamlar örnektir, gerçek değildir. Kendi rakamlarını girmeye hazır olduğunda temizle veya üzerine yaz.</div>' +
        '<button class="btn small" data-act="example-mine">Bunlar artık benim verilerim</button>' +
        '<button class="btn small" data-act="refresh-example">Örnek veriyi yenile</button>' +
        '<button class="btn small danger" data-act="example-clear">Örnek veriyi temizle</button></div>';
    } else b.innerHTML = '';
    if (SUI) b.innerHTML += SUI.banner();
  }

  /* ---------- ÖZET ---------- */
  var RISKCOL = { safe: 'var(--safe)', medium: 'var(--medium)', risky: 'var(--risky)' };
  var HALAL = {
    safe: 'Katılım hesabı (kâr payı), kira sertifikası (sukuk) fonları, katılım para piyasası fonları',
    medium: 'Altın (fiziki veya katılım bankası altın hesabı), altın katılım fonları, karma katılım fonları',
    risky: 'Katılım endeksi hisseleri veya katılım hisse senedi fonları, helal ETF\'ler (ör. SPUS, HLAL)'
  };
  function renderDashboard() {
    var an = analyzeNow(), b = an.budget, a = an.assets, em = an.emergency, g = an.goal, plan = an.plan;
    var noData = !state.incomes.length && !state.expenses.length && !state.assets.length && !state.accounts.length;
    if (noData) {
      return '<h1>Hoş geldin</h1><div class="card"><p>Henüz veri yok. Başlamak için gelir ve giderlerini, sonra birikimlerini gir. İstersen önce örnek veriyle sistemi tanı.</p>' +
        '<div class="row"><a class="btn primary" href="#butce">Gelir ve gider gir</a><a class="btn" href="#portfoy/varliklar">Birikimlerimi gir</a><a class="btn" href="#veri">Belgeden aktar</a><button class="btn" data-act="load-example">Örnek veriyi yükle</button></div></div>';
    }
    var ex = extraActions(), acts = ex.filter(function (x) { return x.level === 'danger'; }).concat(C.actions(an), ex.filter(function (x) { return x.level !== 'danger'; }));
    var h = '<h1>Ana sayfa <span class="muted" style="font-size:.9rem;font-weight:400">— ' + esc(ymLabel(an.nowYm)) + '</span></h1>';
    // 1) Önce görseller: net varlık eğrisi + birikim halkası, üç alan kartı
    if (HUI) h += HUI.homeCards();
    h += safeSection(function () { return homeHero(an); });
    h += safeSection(function () { return PUI.homeCards(); });
    if (HUI) h += HUI.homeMood();
    // 2) Bu ay ne yapmalıyım? (en önemli 3 öneri; kalanı katlanır)
    var top = acts.slice(0, 3), more = acts.slice(3);
    h += '<section class="card" style="margin-top:14px"><h2>Bu ay ne yapmalıyım?</h2><ul class="actions">' + top.map(actLi).join('') + '</ul>' +
      (more.length ? fold('home-more-acts', '+' + more.length + ' öneri daha', '', '<ul class="actions">' + more.map(actLi).join('') + '</ul>', true) : '') +
      '<p class="hint detail-only">Kural: Acil fon eksikse aylık fazlanın ' + M.withSuffix('%' + String(C.emergencyShareBp(state) / 100).replace('.', ',')) + ' acil fona, kalanı hedef dağılıma göre yatırıma' + (an.plan.riskyBlocked ? '; acil fon dolana kadar riskli alım önerilmez (Portföy → Risk kuralı)' : '') + '. Dağılım kuruşu kuruşuna yapılır; parçaların toplamı her zaman fazlaya eşittir.</p></section>';
    // 3) Akış ve hedef halkaları (görsel)
    h += safeSection(function () { return homeFlow(an); });
    if (SUI) h += safeSection(function () { return SUI.homeCard(); });
    // 4) Ayrıntılar: katlanır bölümler (sade görünümde kapalı, detaylıda açık)
    var act = an.actuals, last6 = [5, 4, 3, 2, 1, 0].map(function (k) { return S.addMonths(an.nowYm, -k); });
    var exp6 = last6.map(function (ym) { return C.monthActuals(state.transactions, ym).expense; });
    var bud = '<div class="grid kpis">';
    bud += kpi('Bu ay harcama', CH ? CH.counter('k-exp', act.expense) : tl(act.expense),
      (b.expense ? 'Planın ' + pctS(M.ratioBp(act.expense, b.expense)) + ' · plan ' + tl(b.expense) : 'Plan yok') + (CH ? CH.spark('sp-exp', { h: 46, type: 'bar', highlightLast: true, label: 'Son 6 ay harcama', labels: last6.map(ymLabel), values: exp6, color: act.expense > b.expense ? 'var(--danger)' : null }) : ''),
      'İşlemlerden bu ay gerçekleşen harcama (Transfer hariç). Küçük çubuklar: son 6 ay; en sağdaki bu ay (henüz bitmedi). Üzerine gelince tutarı görürsün.');
    bud += kpi('Her ay artan para', '<span class="' + (b.surplus < 0 ? 'neg' : 'pos') + '">' + (CH ? CH.counter('k-sur', b.surplus) : tl(b.surplus)) + '</span>', b.surplus < 0 ? 'Giderler gelirden fazla' : 'Gelirinin ' + pctS(Math.max(0, b.savingsRateBp)) + ' birikime.', 'Aylık gelir eksi sabit ve değişken giderler. Yatırıma ayrılabilecek tutar.');
    bud += kpi('Acil durum fonu', (CH ? CH.counter('k-em', em.current) : tl(em.current)) + ' <span class="muted" style="font-size:1rem">/ ' + tl(em.target) + '</span>', progress(em.progressBp) + (em.shortfall ? 'Eksik: ' + tl(em.shortfall) : 'Tamamlandı ✓'), em.months + ' aylık giderin kadar, kolay çekilebilir bir kenarda tutulan para. İş kaybı veya sağlık gibi beklenmedik durumlar için.');
    bud += kpi(esc(g.name) + ' hedefi', (CH ? CH.counter('k-goal', g.current) : tl(g.current)) + ' <span class="muted" style="font-size:1rem">/ ' + tl(g.target) + '</span>', progress(g.progressBp) + monthsLabel(g.monthsLeft) + ' kaldı' + (g.multi ? ' · <a href="#portfoy/hedefler">tüm hedefler (' + state.goals.length + ')</a>' : ''), (g.multi ? 'Birden fazla hedefin var; burada ilki gösterilir. Bu hedefe bağlı varlıklar ve ortak birikimden payı (%' + (state.goals[0].shareBp / 100) + ') sayılır.' : 'Acil durum fonu ayrıldıktan sonra kalan birikimin hedefe sayılır. Tutar bugünün fiyatlarıyladır.') + ' Hedef ayı: ' + ymLabel(g.targetYm) + '.');
    bud += '</div>' + safeSection(renderOverviewExtras);
    h += fold('home-budget', '🧾 Bütçe özeti', 'bu ay harcama ' + tl(act.expense) + (b.expense ? ' · planın ' + pctS(M.ratioBp(act.expense, b.expense)) : ''), bud);
    h += fold('home-plan', '🧭 Risk dağılımı ve yatırım planı', plan.surplus > 0 ? 'bu ay ' + tl(plan.surplus) + ' birikim' : 'bu ay artan para yok', safeSection(function () { return homeRiskPlan(an); }));
    h += fold('home-proj', '🔮 Gelecek tahmini', g.name + ' · ' + monthsLabel(g.monthsLeft) + ' kaldı', safeSection(function () { return renderProjection(an); }));
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
  function actLi(x) { return '<li class="lv-' + x.level + '"><span>' + esc(x.text) + '</span></li>'; }
  /* Bir bölüm hata verirse yalnızca o bölüm uyarı gösterir; sayfanın geri kalanı (ve düzenleme alanları) çalışmaya devam eder. */
  function safeSection(fn) {
    try { return fn(); } catch (e) { console.warn('Bölüm gösterilemedi:', e); return '<div class="notice warn section-err">Bu bölüm gösterilemedi (' + esc(e.message) + '). Diğer bölümler ve düzenleme çalışıyor; değerleri kontrol et (ör. çok uzak hedef tarihi veya çok yüksek enflasyon).</div>'; }
  }
  /* Katlanır bölüm: sade görünümde kapalı, detaylıda açık; kullanıcının açıp kapattığı hatırlanır. */
  var foldOpen = {};
  function fold(id, title, sum, body, small) {
    var open = foldOpen[id] != null ? foldOpen[id] : document.body.classList.contains('detailed');
    return '<details class="fold' + (small ? ' fold-sm' : ' card') + '" data-fold="' + id + '"' + (open ? ' open' : '') + '><summary><b>' + title + '</b>' + (sum ? ' <span class="hint">' + esc(sum) + '</span>' : '') + '</summary><div class="fold-body">' + (open ? body : '') + '</div></details>';
  }
  function homeRiskPlan(an) {
    var plan = an.plan, g = an.goal, multi = !!g.multi;
    var tgtLabel = multi ? 'Hedef (tüm hedeflerinin ağırlıklı ortalaması)' : 'Hedef (' + g.name + ', ' + monthsLabel(g.monthsLeft) + ' kaldı)';
    var h = '<div class="grid two">';
    h += '<section class="card"><h2>Risk dağılımı: hedef ve şu an ' + tip('Güvenli: değeri az oynar. Orta: altın gibi orta oynaklık. Riskli: hisse/ETF, uzun vadede getirisi yüksek ama kısa vadede düşebilir. Hedefe yaklaştıkça riskli pay otomatik azalır. Acil durum fonu hariç, hedefe ayrılan birikim için.') + '</h2>';
    if (CH) h += CH.bars('risk-tiers', { h: 190, horizontal: true, legend: true, label: 'Risk dağılımı: ' + tgtLabel + ' ve şu anki yüzdeler', cats: ['safe', 'medium', 'risky'].map(function (k) { return C.RISK[k]; }),
      pctAxis: true, series: [{ name: multi ? 'Hedef (ortalama)' : 'Hedef', data: ['safe', 'medium', 'risky'].map(function (k) { return an.targetAlloc[k]; }), colors: ['var(--safe)', 'var(--medium)', 'var(--risky)'] },
        { name: 'Şu an', data: ['safe', 'medium', 'risky'].map(function (k) { return an.currentAlloc[k]; }), colors: ['var(--safe)@0.45', 'var(--medium)@0.45', 'var(--risky)@0.45'] }] });
    h += '<p class="hint">' + esc(tgtLabel) + '</p>';
    h += '<div class="legend">' + ['safe', 'medium', 'risky'].map(function (k) { return '<span><i style="background:' + RISKCOL[k] + '"></i>' + C.RISK[k] + ' <b class="num">' + pct(an.targetAlloc[k]) + '</b> <span class="muted">/ şu an ' + pct(an.currentAlloc[k]) + '</span></span>'; }).join('') + '</div>';
    h += '<p class="hint detail-only">Acil fon dışındaki ' + tl(an.investTotal) + ' birikim için. ' + (multi ? 'Her hedefin kendi hedef dağılımı (Portföy → Hedefler) bugünkü payıyla ağırlıklandırılır.' : 'Koyu çubuk hedef, açık çubuk şu anki durum.') + '</p>';
    if (!multi) h += '<div class="detail-only"><h3>Hedefe kalan süreye göre dağılım (süzülme yolu / glide path)</h3><table><thead><tr><th>Hedefe kalan</th><th class="r">Güvenli</th><th class="r">Orta</th><th class="r">Riskli</th></tr></thead><tbody>' +
      C.GLIDE.slice().reverse().map(function (r) { return '<tr><td>' + (r[0] ? r[0] + ' ay' + (r[0] === 60 ? ' ve üstü' : '') : 'Hedef ayı') + '</td><td class="r">' + pct(r[1]) + '</td><td class="r">' + pct(r[2]) + '</td><td class="r">' + pct(r[3]) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    h += '<p class="hint detail-only">Sapma (şu an − hedef): güvenli ' + sbp(an.drift.safe) + ', orta ' + sbp(an.drift.medium) + ', riskli ' + sbp(an.drift.risky) + '.</p></section>';
    h += '<section class="card"><h2>Bu ayki yatırım planı ' + tip('Aylık artan paranın hangi tür araçlara gideceği. Sadece faizsiz (helal) araçlar önerilir. Portföy → Dengeleme aynı kuralı kullanır.') + '</h2>';
    if (plan.surplus <= 0) h += '<p>Bu ay yatırım için artan para yok.</p>';
    else {
      h += '<table><tbody>';
      if (plan.toEmergency) h += '<tr><td><b>Acil durum fonu</b><div class="hint detail-only">Katılım hesabı (vadesiz/kâr paylı) veya kolay bozulan TL</div></td><td class="r num"><b>' + tl(plan.toEmergency) + '</b></td></tr>';
      ['safe', 'medium', 'risky'].forEach(function (k) { if (plan[k]) h += '<tr><td><b><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + RISKCOL[k] + '"></i> ' + C.RISK[k] + '</b><div class="hint detail-only">' + esc(HALAL[k]) + '</div></td><td class="r num"><b>' + tl(plan[k]) + '</b></td></tr>'; });
      h += '<tr><td>Toplam</td><td class="r num"><b>' + tl(plan.surplus) + '</b></td></tr></tbody></table>';
      if (plan.riskyBlocked) h += '<p class="hint">Acil durum fonu dolana kadar riskli alım önerilmez; o pay güvenli ve orta gruba eklendi.</p>';
    }
    h += '<p class="hint">Faizli ürünler (mevduat faizi, faizli fon, tahvil/bono, repo) önerilmez.</p></section>';
    return h + '</div>';
  }
  /* ---------- Ana sayfa canlı grafikleri ---------- */
  var RANGE_TXT = { '1A': 'son 1 ayda', '3A': 'son 3 ayda', '6A': 'son 6 ayda', '1Y': 'son 1 yılda', 'Tümü': 'kayıt başından beri' };
  function changeHtml(ch, label) {
    if (ch.bp == null && !ch.abs) return '<span class="muted">Değişim için en az iki gün gerekir.</span>';
    var up = ch.abs > 0, dn = ch.abs < 0;
    return '<span class="chg ' + (up ? 'pos' : dn ? 'neg' : '') + '">' + (up ? '▲ +' : dn ? '▼ ' : '') + esc(tl(ch.abs)) + (ch.bp != null ? ' (' + (up ? '+' : dn ? '−' : '') + '%' + (Math.abs(ch.bp) / 100).toFixed(1).replace('.', ',') + ')' : '') + '</span> <span class="muted">' + esc(label) + '</span>';
  }
  function homeHero(an) {
    var hist = CD ? CD.normalize(state.nwHistory) : [], nw = an.assets.netWorth, t = today(), tot = an.assets.total || 0;
    var h = '<div class="grid hero-grid"><section class="card hero"><div class="label">Net varlığın ' + tip('Sahip olduğun her şeyin bugünkü değeri eksi borçların. Hesaplar (kurla TL\'ye çevrilmiş), varlıklar, kart borçları ve henüz ekstreye gelmemiş taksitler dahildir. Grafik: her gün kendiliğinden kaydedilen değerler.' + (state.isExample ? ' Örnek veride geçmiş örnek olarak üretilmiştir.' : '')) + '</div>';
    h += '<div class="hero-v">' + (CH ? CH.counter('nw', nw) : esc(tl(nw))) + '</div>';
    if (CH && hist.length >= 2) {
      h += CH.area('nw', { h: 220, label: 'Net varlığın zaman içindeki değişimi', today: t, ranges: true, defaultRange: '6A', series: [{ name: 'Net varlık', data: hist }],
        caption: function (r) { return changeHtml(CD.change(CD.inRange(hist, r, t)), RANGE_TXT[r]); } });
    } else h += '<p class="hint">Net varlığın her gün kendiliğinden kaydedilir; birkaç gün sonra burada canlı bir grafik çıkar.</p>';
    h += '</section>';
    var cls = an.assets.byClass || {}, items = Object.keys(cls).filter(function (k) { return cls[k] > 0; }).sort(function (x, y) { return cls[y] - cls[x]; })
      .map(function (k) { return { name: (C.ASSET_CLASSES[k] || C.ASSET_CLASSES.other).label.replace(/ \(.*\)$/, ''), value: cls[k] }; });
    h += '<section class="card"><h2>Neyin var? ' + tip('Birikimlerinin türlere göre dağılımı (hesaplar dahil). Dilimlerin üzerine gelince ya da dokununca tutarı ve payı görürsün.') + '</h2>';
    if (CH && items.length) h += CH.donut('alloc', { h: 230, label: 'Birikimlerin türlere göre dağılımı', items: items, center: { title: 'toplam', value: tot } });
    else h += '<p class="muted">Henüz varlık yok. <a href="#portfoy/varliklar">Birikimlerini gir</a>.</p>';
    if (tot > 0) h += '<div class="legend">' + ['safe', 'medium', 'risky'].map(function (k) { return '<span><i style="background:' + RISKCOL[k] + '"></i>' + C.RISK[k] + ' ' + pct(M.ratioBp(an.assets.byRisk[k], tot)) + '</span>'; }).join('') + '</div>';
    return h + '</section></div>';
  }
  function homeFlow(an) {
    var b = an.budget, plan = an.plan, em = an.emergency, h = '<div class="grid two" style="margin-top:14px">';
    h += '<section class="card"><h2>Paran nereye gidiyor? ' + tip('Planladığın aylık gelirin sabit giderlere, değişken giderlere ve birikime akışı; birikimin de bu ayki yatırım planına göre nereye gittiği. Akışların üzerine gelince tutarı görürsün.') + '</h2>';
    if (CH && b.income > 0) {
      var nodes, links;
      if (b.surplus >= 0) {
        nodes = [{ name: 'Gelir', color: 'brand', depth: 0 }, { name: 'Sabit giderler', color: '#6c7a96', depth: 1 }, { name: 'Değişken giderler', color: '#a3b1cc', depth: 1 }, { name: 'Birikim', color: 'safe', depth: 1 }];
        links = [{ source: 'Gelir', target: 'Sabit giderler', value: b.fixed }, { source: 'Gelir', target: 'Değişken giderler', value: b.variable }, { source: 'Gelir', target: 'Birikim', value: b.surplus }];
        if (plan.surplus > 0) {
          if (plan.toEmergency) { nodes.push({ name: 'Acil durum fonu', color: 'brand@0.7', depth: 2 }); links.push({ source: 'Birikim', target: 'Acil durum fonu', value: plan.toEmergency }); }
          ['safe', 'medium', 'risky'].forEach(function (k) { if (plan[k] > 0) { nodes.push({ name: C.RISK[k] + ' yatırım', color: k, depth: 2 }); links.push({ source: 'Birikim', target: C.RISK[k] + ' yatırım', value: plan[k] }); } });
        }
      } else {
        nodes = [{ name: 'Gelir', color: 'brand' }, { name: 'Açık', color: 'danger' }, { name: 'Giderler', color: '#6c7a96' }, { name: 'Sabit giderler', color: '#6c7a96' }, { name: 'Değişken giderler', color: '#a3b1cc' }];
        links = [{ source: 'Gelir', target: 'Giderler', value: b.income }, { source: 'Açık', target: 'Giderler', value: -b.surplus }, { source: 'Giderler', target: 'Sabit giderler', value: b.fixed }, { source: 'Giderler', target: 'Değişken giderler', value: b.variable }];
      }
      h += CH.sankey('flow', { h: 270, label: 'Aylık gelirin giderlere ve birikime akışı', nodes: nodes, links: links });
    } else if (!b.income) h += '<p class="muted">Gelir girince akış grafiği çıkar. <a href="#butce">Gelir gir</a></p>';
    if (b.surplus < 0) h += '<div class="notice danger">Giderler gelirden fazla: ' + tl(-b.surplus) + ' açık var.</div>';
    h += '<div class="legend"><span><i style="background:#6c7a96"></i>Sabit ' + tl(b.fixed) + ' (' + pct(b.fixedRatioBp) + ')</span><span><i style="background:#a3b1cc"></i>Değişken ' + tl(b.variable) + ' (' + pct(b.variableRatioBp) + ')</span><span><i style="background:var(--safe)"></i>Birikim ' + tl(Math.max(0, b.surplus)) + ' (' + pct(Math.max(0, b.savingsRateBp)) + ')</span></div>';
    h += '<p class="hint detail-only">"Transfer" kategorisindeki işlemler (hesaplar arası, kart borcu ödemesi) çift sayılmasın diye harcamalara katılmaz.</p></section>';
    // Hedef halkaları
    var rep = null; try { rep = PF.goalsReport(eff(), an); } catch (e) { console.error(e); }
    var rings = [{ key: 'em', name: 'Acil durum fonu', bp: em.progressBp, cur: em.current, target: em.target, sub: em.shortfall ? 'eksik ' + tl(em.shortfall) : 'tamam ✓', color: 'brand', href: '#portfoy/risk' }];
    (rep ? rep.goals : []).forEach(function (r, i) { rings.push({ key: 'g' + i, name: r.goal.name, bp: r.progressBp, cur: r.current, target: r.goal.target, sub: monthsLabel(r.monthsLeft) + ' kaldı' + (r.onTrack ? ' · yolunda' : ' · geride'), color: r.onTrack ? 'safe' : 'medium', href: '#portfoy/hedefler' }); });
    h += '<section class="card"><h2>Hedeflerin ' + tip('Halkalar hedefe ne kadar yaklaştığını gösterir. Yeşil: temel senaryoda hedef tarihine yetişiyor; sarı: geride.') + '</h2><div class="rings">';
    rings.forEach(function (r) {
      h += '<a class="ring-item" href="' + r.href + '">' + (CH ? CH.ring('ring-' + r.key, { h: 118, bp: r.bp, color: r.color, label: r.name + ': yüzde ' + Math.round(r.bp / 100) }) : '<b>%' + Math.round(r.bp / 100) + '</b>') +
        '<b class="ring-n">' + esc(r.name) + '</b><span class="hint num">' + esc(M.formatShort(r.cur)) + ' / ' + esc(M.formatShort(r.target)) + '</span><span class="hint">' + esc(r.sub) + '</span></a>';
    });
    return h + '</div></section></div>';
  }
  function sbp(bp) { return (bp > 0 ? '+' : '') + (bp / 100).toFixed(1).replace('.', ',') + ' puan'; }
  function tr(a, b, c) { return '<tr><td>' + a + '</td><td class="r num">' + b + '</td><td class="hint">' + c + '</td></tr>'; }
  function seg(v, total, color) { return v > 0 ? '<span style="width:' + (v * 100 / total) + '%;background:' + color + '"></span>' : ''; }
  function progress(bp) { return '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(bp / 100) + '"><span style="width:' + Math.min(100, bp / 100) + '%"></span></div>' + '%' + Math.round(bp / 100) + ' · '; }
  function kpi(label, value, sub, help) { return '<div class="card kpi"><div class="label">' + label + ' ' + tip(help) + '</div><div class="value">' + value + '</div><div class="sub">' + sub + '</div></div>'; }

  function renderProjection(an) {
    var g = an.goal, sc = an.scenarios, keys = ['pessimistic', 'base', 'optimistic'], cols = { pessimistic: 'var(--risky)', base: 'var(--brand)', optimistic: 'var(--safe)' };
    var h = '<section class="card" style="margin-top:14px"><h2>Gelecek tahmini: hedefe ulaşır mıyım? ' + tip('Üç farklı piyasa senaryosuyla birikiminin nasıl büyüyebileceği. Tutarlar bugünün parasıyladır (enflasyondan arındırılmış). Kesin değildir.') + '</h2>';
    if (keys.some(function (k) { return sc[k].capped; })) h += '<div class="notice warn">Tahmin çok büyük çıktı (10 trilyon TL üstü). Hedef tarihini veya enflasyon/getiri varsayımını kontrol et; tablo "çok büyük" gösterir.</div>';
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
    if (g.multi) h += '<p class="hint">Bu grafik ilk hedefin (' + esc(g.name) + ') içindir. Tüm hedeflerin tahmini: <a href="#portfoy/hedefler">Portföy Yönetimi → Hedefler</a>.</p>';
    if (CH) h += CH.lines('proj', { h: 300, label: 'Üç senaryoda birikim tahmini grafiği', x: sc.base.series.map(function (p) { return p.m % 12 === 0 ? (p.m / 12) + '. yıl' : (Math.floor(p.m / 12)) + '. yıl ' + (p.m % 12) + '. ay'; }),
      target: g.target || null, goalIndex: g.monthsLeft <= n ? g.monthsLeft : null, series: keys.map(function (k) { return { name: sc[k].label, color: cols[k], data: sc[k].series.map(function (p) { return p.invest; }) }; }) });
    else h += '<div class="chart">' + svg + '</div>';
    h += '<div class="legend detail-only">' + keys.map(function (k) { return '<span><i style="background:' + cols[k] + '"></i>' + sc[k].label + '</span>'; }).join('') + '<span>- - - hedef tutar · dikey çizgi: hedef tarihi</span></div>';
    h += '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Senaryo</th><th class="r">' + esc(ymLabel(g.targetYm)) + '\'' + M.locSuffix(g.targetYm.slice(0, 4)) + ' hedefe ayrılan birikim</th><th class="r">Hedefe ulaşma</th><th class="r detail-only">Nominal (geleceğin TL\'si)</th><th class="detail-only">Varsayım (yıllık reel getiri: güvenli / orta / riskli)</th></tr></thead><tbody>';
    keys.forEach(function (k) {
      var s = sc[k], reached = s.reachMonth;
      h += '<tr><td><b class="scen-' + k + '">' + s.label + '</b></td><td class="r num">' + tl(s.atGoal) + '</td><td class="r">' +
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
  /* Bütçe panosu: son 6 ay gelir/harcama ve bu ayın kategori dağılımı (canlı grafikler) */
  function budgetBoard(b) {
    if (!CH) return '';
    var ym = nowYm(), months = [5, 4, 3, 2, 1, 0].map(function (k) { return S.addMonths(ym, -k); }), acts = months.map(function (m) { return C.monthActuals(state.transactions, m); });
    var cur = acts[5], cats = Object.keys(cur.byCategory).sort(function (x, y) { return cur.byCategory[y] - cur.byCategory[x]; });
    var h = '<div class="grid kpis board-kpis">';
    h += '<div class="card kpi"><div class="label">Aylık gelir (plan)</div><div class="value">' + CH.counter('b-inc', b.income) + '</div></div>';
    h += '<div class="card kpi"><div class="label">Aylık gider (plan)</div><div class="value">' + CH.counter('b-exp', b.expense) + '</div></div>';
    h += '<div class="card kpi"><div class="label">Her ay artan</div><div class="value ' + (b.surplus < 0 ? 'neg' : 'pos') + '">' + CH.counter('b-sur', b.surplus) + '</div><div class="sub">' + progress(Math.max(0, b.savingsRateBp)) + 'tasarruf oranı</div></div>';
    h += '<div class="card kpi"><div class="label">' + esc(ymLabel(ym)) + ' harcanan</div><div class="value">' + CH.counter('b-act', cur.expense) + '</div><div class="sub">' + (b.expense ? 'planın ' + pctS(M.ratioBp(cur.expense, b.expense)) : '') + '</div></div>';
    h += '</div><div class="grid two" style="margin:14px 0">';
    h += '<section class="card"><h2>Son 6 ay: gelen ve giden ' + tip('İşlemlerden (elle veya belgeden) gelen gerçekleşen tutarlar; "Transfer" hariç. Kesikli çubuk: bu ay henüz bitmedi. Çubuğun üzerine gelince ya da dokununca tutarları görürsün.') + '</h2>' +
      CH.bars('b-6m', { h: 250, legend: true, label: 'Son 6 ayın gerçekleşen gelir ve harcamaları', cats: months.map(function (m) { var p = m.split('-'); return ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'][+p[1] - 1]; }),
        series: [{ name: 'Gelir', color: 'safe', data: acts.map(function (a) { return a.income; }), partialIndex: 5 }, { name: 'Harcama', color: 'brand', data: acts.map(function (a) { return a.expense; }), partialIndex: 5 }],
        tipExtra: function (i) { var n = acts[i].net; return '<br>Fark: <b style="color:' + (n < 0 ? 'var(--danger)' : 'inherit') + '">' + esc(tl2(n)) + '</b>'; } }) + '</section>';
    h += '<section class="card"><h2>' + esc(ymLabel(ym)) + ': nereye harcadın? ' + tip('Bu ayki gerçekleşen harcamaların kategorilere dağılımı. Dilime dokununca tutar ve payı çıkar.') + '</h2>' +
      (cats.length ? CH.donut('b-cat', { h: 250, label: 'Bu ayın harcamalarının kategorilere dağılımı', items: cats.map(function (c) { return { name: c, value: cur.byCategory[c] }; }), center: { title: 'harcama', value: cur.expense } })
        : '<p class="muted">Bu ay için kayıtlı harcama yok. <a href="#veri">Belgeden aktar</a> veya <a href="#islemler">elle ekle</a>.</p>') + '</section>';
    return h + '</div>';
  }
  function renderBudget() {
    var E = eff(), b = C.budget(E), autoEx = E.expenses.filter(function (x) { return x.auto; });
    var h = budgetBoard(b) + '<p class="hint">Rakamları kutuya yazman yeterli; değişiklik anında kaydedilir.<span class="detail-only"> "1.250,50" veya "1250.50" gibi yazabilirsin.</span></p><div class="grid two">';
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
    autoEx.forEach(function (x) {
      h += '<tr class="auto"><td>' + esc(x.name) + ' ' + tip(x.id === 'auto:sinking' ? 'Yıllık giderler kumbarası için bu ay ayrılması gereken tutar. Yıllık giderler sekmesinden hesaplanır; burada değiştirilemez.' : 'Kredi kartı taksitlerinin bu ayki toplamı. Kartlar ve taksitler bölümünden hesaplanır. Kart harcamalarını ayrıca gider olarak yazdıysan taksitleri oraya tekrar ekleme.') + '</td><td><span class="pill info">Sabit · otomatik</span></td><td class="r num">' + tl2(x.amount) + '</td><td><a class="btn small" href="' + (x.id === 'auto:sinking' ? '#butce/yillik' : '#odemeler/kartlar') + '">Gör</a></td></tr>';
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
  function debtsCard() {
    var h = '<section class="card" style="margin-top:14px"><h2>Borçlarım ' + tip('Kişisel borçlar, krediler. Kredi kartları ve taksitler Bütçe → Ödemeler\'de izlenir. Net varlıktan düşülür.') + '</h2><div class="tablewrap"><table><thead><tr><th>Ad</th><th class="r">Kalan tutar (TL)</th><th></th></tr></thead><tbody>';
    state.debts.forEach(function (x) { h += '<tr><td>' + textInput('debts', x.id, 'name', x.name, 'Borç adı') + '</td><td>' + moneyInput('debts', x.id, 'amount', x.amount, x.name + ' tutarı') + '</td><td>' + delBtn('debts', x.id, x.name) + '</td></tr>'; });
    if (!state.debts.length) h += '<tr><td colspan="3" class="muted">Borç yok.</td></tr>';
    return h + '</tbody></table></div><button class="btn" data-act="add" data-list="debts">+ Borç ekle</button></section>';
  }

  /* ---------- İŞLEMLER ---------- */
  var txFilter = { ym: null, q: '' };
  function catOptions(sel) { var list = P.CATEGORIES.slice(); if (sel && list.indexOf(sel) < 0) list.push(sel); /* listede olmayan (eski/özel) kategori kaybolmasın */ return list.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join(''); }
  function renderTransactions() {
    if (!txFilter.ym) txFilter.ym = C.currentYm();
    var months = {}; state.transactions.forEach(function (t) { months[t.date.slice(0, 7)] = 1; }); months[C.currentYm()] = 1;
    var list = state.transactions.filter(function (t) { return (txFilter.ym === 'all' || t.date.slice(0, 7) === txFilter.ym) && (!txFilter.q || P.fold(t.description + ' ' + t.category).indexOf(P.fold(txFilter.q)) >= 0); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var inc = 0, exp = 0, trn = 0; list.forEach(function (t) { if (t.category === 'Transfer') trn = M.add(trn, t.amount < 0 ? -t.amount : t.amount); /* hesaplar arası: gelir/gider sayılmaz (özet ve bütçeyle aynı kural) */ else if (t.amount >= 0) inc = M.add(inc, t.amount); else exp = M.add(exp, -t.amount); });
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
      '<span class="muted">' + list.length + ' işlem · Gelir <b class="pos num">' + tl2(inc) + '</b> · Harcama <b class="neg num">' + tl2(exp) + '</b>' + (trn ? ' · Transfer (sayılmaz) <b class="num">' + tl2(trn) + '</b>' : '') + '</span></div>';
    if (!list.length) h += '<p class="muted">Bu filtreyle işlem yok.</p>';
    else {
      h += '<div class="tablewrap"><table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Kategori</th><th class="r">Tutar</th><th class="detail-only">Kaynak</th><th></th></tr></thead><tbody>';
      list.slice(0, 500).forEach(function (t) {
        var acc = t.accountId ? accById(t.accountId) : null;
        h += '<tr><td class="num">' + dateLabel(t.date) + '</td><td>' + esc(t.description) + (t.recurringId ? ' <span class="pill info" title="Düzenli ödemeye bağlı (' + esc(t.period) + ')">🔁 düzenli</span>' : '') + (acc ? '<div class="hint">' + esc(acc.name) + '</div>' : '') + '</td><td><select aria-label="Kategori" data-list="transactions" data-id="' + t.id + '" data-field="category">' + catOptions(t.category) + '</select></td>' +
          '<td class="r num ' + (t.amount < 0 ? 'neg' : 'pos') + '">' + tl2(t.amount) + '</td><td class="detail-only hint">' + esc(t.source || '') + '</td><td>' + delBtn('transactions', t.id, t.description) + '</td></tr>';
      });
      h += '</tbody></table></div>' + (list.length > 500 ? '<p class="hint">İlk 500 işlem gösteriliyor; filtreyi daralt.</p>' : '');
    }
    return h + '</section>';
  }

  /* ---------- VERİ EKLE (içe aktarma) ---------- */
  var importOpts = { cc: false, method: (aiCfg.importMethod === 'ai' || aiCfg.importMethod === 'ocr') ? aiCfg.importMethod : 'auto' };
  function useAiForImages() { return importOpts.method === 'ai' ? aiReady() : importOpts.method === 'auto' ? aiReady() : false; }
  var COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  function aiReady() { var p = AI.PROVIDERS[aiCfg.provider]; return !!(p && (!p.needsKey || (aiCfg.keys || {})[aiCfg.provider])); }
  function renderImport() {
    if (review) return renderReview();
    if (PUI.hasReview()) return PUI.renderImportReview();
    var p = AI.PROVIDERS[aiCfg.provider];
    var h = '<h1>Veri ekle</h1><p>Dosyanı seç veya buraya sürükle. <b>Hiçbir şey sen onaylamadan kaydedilmez:</b> önce kontrol tablosu açılır, düzeltir, sonra onaylarsın.</p>';
    h += PUI.importModes();
    h += '<div class="choices">' +
      '<a class="choice" href="' + (PUI.importKind() === 'trades' ? '#portfoy/islemler' : PUI.importKind() === 'prices' ? '#portfoy/fiyatlar' : '#islemler') + '" style="text-decoration:none;color:inherit"><b>✍️ Elle gir</b><span>' + (PUI.importKind() === 'tx' ? 'Tek tek işlem ekle' : PUI.importKind() === 'trades' ? 'Tek tek alım-satım ekle' : 'Tek tek fiyat gir') + '</span></a>' +
      '<button class="choice" data-pick=".xlsx,.xls,.csv,.ods,.txt"><b>📊 Excel / CSV</b><span>Banka hareket dökümü, kendi tablon</span></button>' +
      '<button class="choice" data-pick=".pdf,application/pdf"><b>📄 PDF ekstre</b><span>Hesap veya kredi kartı ekstresi</span></button>' +
      '<button class="choice" data-pick="image/*,.heic,.heif"><b>📷 Fotoğraf / fiş / ekran görüntüsü</b><span>Alışveriş fişi, uygulama ekranı (galeriden)</span></button>' +
      (COARSE ? '<button class="choice" data-pick="image/*" data-capture="environment"><b>📸 Kamerayla fiş çek</b><span>Fişi düz bir yere koy, yakından ve net çek</span></button>' : '') + '</div>';
    h += '<div class="drop" id="drop" tabindex="0" role="button" aria-label="Dosya seçmek için tıkla veya dosyayı buraya sürükle"><b>Dosyayı buraya sürükle</b> veya tıklayıp seç<div class="hint">Excel, CSV, PDF, JPG/PNG/WebP/HEIC (iPhone). Ekran görüntüsünü Ctrl+V ile de yapıştırabilirsin. Dosyalar cihazından çıkmaz (yapay zekâ ile okuma seçersen yalnızca seçtiğin sağlayıcıya gönderilir).</div></div>';
    h += '<input type="file" id="file-in" hidden>';
    h += '<section class="card" style="margin-top:14px"><h2>Okuma seçenekleri</h2>' +
      '<label class="row"><input type="checkbox" id="opt-cc"' + (importOpts.cc ? ' checked' : '') + '> Kredi kartı ekstresi: belgede <b>artı</b> görünen tutarlar <b>harcamadır</b> ' + tip('Kredi kartı ekstrelerinde harcamalar genelde eksi işaretsiz yazılır. Bunu işaretlersen artı tutarlar gider, eksi tutarlar (iade/ödeme) gelir sayılır. Kontrol tablosunda tek tıkla da çevirebilirsin.') + '</label>' +
      '<div class="field" style="margin-top:10px"><label for="opt-method">Fotoğraf ve taranmış PDF okuma yöntemi</label><select id="opt-method" style="max-width:520px">' +
      '<option value="auto"' + (importOpts.method === 'auto' ? ' selected' : '') + '>Otomatik (önerilen) — ' + (aiReady() ? 'yapay zekâ (' + esc(p.label) + '), olmazsa ücretsiz OCR' : 'ücretsiz OCR; yapay zekâ eklersen onu kullanır') + '</option>' +
      '<option value="ai"' + (importOpts.method === 'ai' ? ' selected' : '') + '>Yapay zekâ ile oku (en iyi sonuç) — ' + esc(p ? p.label : 'sağlayıcı seçilmedi') + '</option>' +
      '<option value="ocr"' + (importOpts.method === 'ocr' ? ' selected' : '') + '>Ücretsiz metin tanıma (OCR, Tesseract) — anahtar gerekmez</option></select>' +
      '<span class="hint">' + (aiReady() ? 'Yapay zekâ hazır.' : 'Yapay zekâ henüz ayarlı değil: <a href="#asistan">Asistan</a> bölümünden ücretsiz bir sağlayıcı (ör. Gemini) ekle veya OCR\'ı seç.') +
      ' Ücretsiz OCR ilk kullanımda ~6 MB okuma dosyası indirir, sonra hızlanır. İnternet yoksa da ilk indirmeden sonra çalışır. Buruşuk, bulanık veya el yazılı fişlerde yapay zekâ daha doğrudur.</span></div>' +
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
    if (PUI.importKind() !== 'tx' && ext !== 'json') job = PUI.handleFile(file);
    else if (/^(xlsx|xls|csv|ods|txt|tsv)$/.test(ext)) job = importSheet(file);
    else if (ext === 'pdf' || file.type === 'application/pdf') job = importPdf(file);
    else if (/^image\//.test(file.type) || /^(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/.test(ext) || (!file.type && !ext)) job = importImage(file);
    else if (ext === 'json') return setStatus('Yedek dosyası mı? Onu <a href="#ayarlar">Ayarlar ve yedek</a> bölümünden geri yükle.', 'warn');
    else return setStatus('Bu dosya türü desteklenmiyor: .' + esc(ext), 'warn');
    job.catch(function (e) { console.warn('İçe aktarma hatası:', e); setStatus('Okunamadı: ' + esc(e.message) + '<div class="hint">Fişi düz bir yüzeye koyup yakından, gölgesiz ve net çekmeyi dene. İstersen <a href="#islemler">elle</a> de girebilirsin.</div>', 'danger'); });
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
    review.cardChecked = review.cardChecked || review.cc; // elle seçilen işaret yeniden otomatik çevrilmez
    var rows = P.rowsFromTable(t.rows, t.map, review.cc ? -1 : 1);
    startReviewRows(rows);
  }
  /* Kredi kartı ekstresi otomatik tespiti: belge metni (veya tablo hücreleri) ekstre ipuçları taşıyorsa ve harcamalar artı yazılmışsa
   * işaretler bir kez otomatik çevrilir (harcama = eksi, "ÖDEME-TEŞEKKÜR" = Transfer). Kullanıcı kontrol tablosunda geri alabilir. */
  function reviewText(r) {
    if (r.pdfText || r.ocrText) return r.pdfText || r.ocrText;
    if (r.table) return r.table.rows.slice(0, 60).map(function (x) { return (x || []).join(' '); }).join('\n') + '\n' + (r.source || '');
    return r.source || '';
  }
  function categorize(x) { return (x.amount > 0 && P.isCardPayment(x.description)) ? 'Transfer' : P.suggestCategory(x.description, x.amount || 0); }
  function setCardMode(on) {
    if (!review || !!review.cc === !!on) return;
    review.cc = !!on;
    if (review.kind === 'tablo') { rebuildFromTable(); return; }
    review.rows.forEach(function (x) { if (Number.isInteger(x.amount)) { x.amount = -x.amount; x.category = categorize(x); } });
    revalidate(false);
  }
  function startReviewRows(rows) {
    var autoFlip = false;
    if (!review.cardChecked) {
      review.cardChecked = true;
      review.cardDetect = P.detectCardStatement(reviewText(review));
      if (review.cardDetect.isCard && !review.cc && !review.receipt && P.looksPositiveExpenses(rows)) {
        autoFlip = true; review.cc = true; review.autoCc = true;
        rows = rows.map(function (r) { var c = Object.assign({}, r); if (Number.isInteger(c.amount)) c.amount = -c.amount; return c; });
      }
    }
    review.rows = rows.map(function (r, i) {
      var x = { key: i, include: true, date: r.date, rawDate: r.rawDate, description: r.description || '', amount: r.amount, note: r.note || '',
        category: null, source: r.source, manual: !!r.manual, fromDocTotal: !!r.fromDocTotal, amountWarn: r.amountWarn };
      x.category = (r.category && r.amount < 0) ? r.category : categorize(x);
      return x;
    });
    revalidate(true);
    return autoFlip;
  }
  function isExpenseDoc(r) { return !!(r.cc || (r.cardDetect && r.cardDetect.isCard) || r.receipt || r.cardId); }
  function revalidate(initial) {
    var today = todayYmd();
    P.markDuplicates(review.rows, state.transactions);
    review.rows.forEach(function (r) {
      P.validateRow(r, today);
      if (initial && (r.duplicate || r.errors.length) && !r.manual) { r.include = false; r.autoEx = !r.duplicate; }
      else if (initial && r.date && r.date > today && !r.manual) { r.include = false; r.futureEx = true; } // gelecek tarihli satır varsayılan olarak seçilmez
      // Hata yüzünden otomatik dışarıda kalan satır düzeltilince kendiliğinden dahil edilir
      else if (!initial && r.autoEx && !r.errors.length) { r.include = true; r.autoEx = false; }
      r.inst = L.detectInstallment(r.description);
    });
    L.reconcileImported(review.rows, state.transactions);
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
  /* ---------- Görsel hazırlama: HEIC → JPEG, EXIF yönü, küçültme, OCR için ön işleme ---------- */
  function sniffHeic(file) {
    return file.slice(0, 32).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf), str = String.fromCharCode.apply(null, b);
      return str.slice(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(str.slice(8, 32));
    }).catch(function () { return false; });
  }
  function decodeBitmap(blob) {
    // EXIF yönü: modern tarayıcılar (Chrome 81+, Safari 13.1+, Firefox 77+) görseli EXIF'e göre döndürerek çizer.
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return decodeViaImg(blob); });
    }
    return decodeViaImg(blob);
  }
  function decodeViaImg(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { res({ width: img.naturalWidth, height: img.naturalHeight, src: img, close: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Görsel açılamadı')); };
      img.src = url;
    });
  }
  function heicToJpeg(file) {
    busy('iPhone (HEIC) fotoğrafı dönüştürülüyor…');
    return loadScript('vendor/heic2any.min.js', 60000).then(function () {
      return withTimeout(window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 }), 90000, 'HEIC dönüştürme zaman aşımına uğradı');
    }).then(function (out) { return Array.isArray(out) ? out[0] : out; }).catch(function (e) {
      console.warn('HEIC dönüştürülemedi', e);
      throw new Error('Bu iPhone fotoğrafı (HEIC) açılamadı. Çözüm: fişin ekran görüntüsünü al ve onu yükle, ya da iPhone\'da Ayarlar > Kamera > Biçimler > "En Uyumlu"yu seç.');
    });
  }
  function readImage(file) {
    return sniffHeic(file).then(function (isHeic) {
      var heic = isHeic || /^image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
      if (!heic) return decodeBitmap(file).catch(function () { throw new Error('Görsel açılamadı. Dosya bozuk olabilir veya bu biçim desteklenmiyor; JPG, PNG veya ekran görüntüsü dene.'); });
      // Safari HEIC'i kendisi açabilir; açamazsa heic2any ile JPEG'e çevir
      return decodeBitmap(file).catch(function () { return heicToJpeg(file).then(decodeBitmap); });
    }).then(function (bmp) {
      var src = bmp.src || bmp, w = bmp.width, h = bmp.height;
      if (!w || !h) throw new Error('Görsel boş görünüyor');
      // Renkli kopya: önizleme ve yapay zekâ için (en fazla 2000 px)
      var s1 = Math.min(1, 2000 / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * s1); c.height = Math.round(h * s1);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      var color = canvasToImg(c);
      // OCR kopyası: uzun kenar 1600–2600 px (küçük ekran görüntüleri büyütülür, büyük kamera fotoğrafları küçültülür)
      var L = Math.max(w, h), target = Math.max(1600, Math.min(2600, L)), s2 = target / L;
      var o = document.createElement('canvas'); o.width = Math.round(w * s2); o.height = Math.round(h * s2);
      var ctx = o.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, o.width, o.height);
      if (bmp.close) try { bmp.close(); } catch (e) { /* */ }
      color.ocrPlain = o.toDataURL('image/png');
      try { preprocessForOcr(o); color.ocrClean = o.toDataURL('image/png'); } catch (e) { console.warn('ön işleme atlandı', e); }
      color.size = [w, h];
      return color;
    });
  }
  /* Gri ton + gölge/ışık düzeltme (arka plana bölme) + kontrast germe. Tesseract kendi eşiklemesini (Otsu) bunun üstüne yapar. */
  function preprocessForOcr(canvas) {
    var w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d', { willReadFrequently: true });
    var bw = Math.max(8, Math.round(w / 24)), bh = Math.max(8, Math.round(h / 24));
    var bg = document.createElement('canvas'); bg.width = bw; bg.height = bh;
    var bctx = bg.getContext('2d'); bctx.filter = 'blur(2px)'; bctx.drawImage(canvas, 0, 0, bw, bh);
    var big = document.createElement('canvas'); big.width = w; big.height = h;
    var gctx = big.getContext('2d'); gctx.imageSmoothingQuality = 'high'; gctx.drawImage(bg, 0, 0, w, h);
    var img = ctx.getImageData(0, 0, w, h), d = img.data, bgd = gctx.getImageData(0, 0, w, h).data;
    var n = w * h, gray = new Uint8ClampedArray(n), hist = new Uint32Array(256);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var y = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      var by = 0.299 * bgd[j] + 0.587 * bgd[j + 1] + 0.114 * bgd[j + 2];
      // Yerel arka plana göre normalleştir: kağıt beyaza, mürekkep koyuya
      var v = by > 8 ? Math.min(255, (y / by) * 235) : y;
      gray[i] = v; hist[gray[i]]++;
    }
    var lo = 0, hi = 255, acc = 0;
    for (var k = 0; k < 256; k++) { acc += hist[k]; if (acc > n * 0.01) { lo = k; break; } }
    acc = 0; for (k = 255; k >= 0; k--) { acc += hist[k]; if (acc > n * 0.02) { hi = k; break; } }
    var range = Math.max(1, hi - lo);
    for (i = 0, j = 0; i < n; i++, j += 4) { var g = (gray[i] - lo) * 255 / range; g = g < 0 ? 0 : g > 255 ? 255 : g; d[j] = d[j + 1] = d[j + 2] = g; d[j + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }
  function importImage(file) {
    busy('Görsel hazırlanıyor…');
    // OCR gerekecekse motoru görselle aynı anda ısıt
    if (!useAiForImages()) getOcrWorker().catch(function () { /* asıl hata ocrImages'ta gösterilir */ });
    return readImage(file).then(function (img) {
      if (useAiForImages()) return aiImages([img], file.name);
      var note = importOpts.method === 'ai' && !aiReady() ? 'Yapay zekâ ayarlı olmadığı için ücretsiz OCR ile okundu.' : '';
      return ocrImages([img], file.name, note);
    });
  }
  var EXTRACT_PROMPT = 'Bu belgedeki (alışveriş fişi, banka/kredi kartı ekstresi veya uygulama ekran görüntüsü) finansal işlemleri çıkar.\n' +
    'SADECE şu JSON\'u döndür, başka metin yazma:\n{"merchant": "işyeri adı veya null", "date": "YYYY-MM-DD veya null", "total": sayı veya null, "transactions": [{"date": "YYYY-MM-DD", "description": "kısa açıklama", "amount": sayı}]}\n' +
    'Kurallar:\n- Harcama/gider tutarları NEGATİF, gelir/iade/gelen para POZİTİF.\n- Tutarları JSON sayısı olarak nokta ondalıkla yaz (ör. -1250.5). Binlik ayırıcı kullanma.\n' +
    '- Fişte kalemler varsa her kalemi ayrı satır yaz; "total" alanına fişin TOPLAM tutarını (pozitif) yaz. KDV, ara toplam, nakit, para üstü satırlarını işlem olarak yazma.\n' +
    '- Ekstrede "bakiye" sütununu tutar sanma. Dönem borcu/toplam varsa "total" alanına yaz.\n- Tarih yalnızca belgenin başında yazıyorsa her satıra o tarihi koy. Türkiye tarih biçimi GG.AA.YYYY\'dir.\n- Belgede olmayan hiçbir bilgiyi uydurma; okuyamadığın alanı null bırak.';
  function aiImages(images, name) {
    if (!aiReady()) return ocrImages(images, name, 'Yapay zekâ ayarlı olmadığı için ücretsiz OCR ile okundu.');
    busy(AI.PROVIDERS[aiCfg.provider].label + ' belgeyi okuyor… (birkaç saniye sürebilir)');
    return AI.chat(aiCfg, 'Sen dikkatli bir muhasebe asistanısın. Yalnızca geçerli JSON üretirsin.', [{ role: 'user', text: EXTRACT_PROMPT, images: images }], true).then(function (txt) {
      var res = P.rowsFromAiJson(txt);
      if (!res.rows.length) throw new Error('Yapay zekâ belgede işlem bulamadı.');
      review = { source: name + ' (yapay zekâ: ' + AI.PROVIDERS[aiCfg.provider].label + ')', kind: 'ai', cc: false, docTotal: res.docTotal, preview: images[0].dataUrl };
      startReviewRows(res.rows.map(function (r) { if (r.description && res.merchant && P.fold(r.description).indexOf(P.fold(res.merchant)) < 0 && res.rows.length > 1) r.description = r.description + ' (' + res.merchant + ')'; return r; }));
      render();
    }).catch(function (e) {
      // Yapay zekâ hata verirse (kota, ağ, anahtar) fişi yine de ücretsiz OCR ile oku
      console.warn('Yapay zekâ okuyamadı, OCR deneniyor', e);
      return ocrImages(images, name, 'Yapay zekâ okuyamadı (' + e.message + '), ücretsiz OCR ile okundu.');
    });
  }
  var pendingImages = null;
  /* ---------- Ücretsiz OCR (Tesseract.js) ----------
   * Kütüphane, motor (wasm) ve Türkçe dil dosyası sitenin kendi vendor/ klasöründen yüklenir (CDN'e bağımlı değil).
   * Site dosyadan (file://) açıldıysa tarayıcı yerel worker'a izin vermediği için jsDelivr CDN kullanılır. */
  var OCR_CDN = { lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1', lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/tur@1.0.0/4.0.0_best_int' };
  function ocrPaths(useCdn) {
    if (useCdn) return OCR_CDN;
    var base = new URL('vendor/tesseract/', location.href).href;
    return { lib: 'vendor/tesseract/tesseract.min.js', worker: base + 'worker.min.js', core: base + 'core', lang: base + 'lang' };
  }
  var ocrWorkerP = null, ocrProgress = null;
  var OCR_STEPS = { 'loading tesseract core': 'OCR motoru yükleniyor', 'initializing tesseract': 'OCR motoru başlatılıyor', 'loading language traineddata': 'Türkçe okuma dosyası yükleniyor',
    'loading language traineddata (from cache)': 'Türkçe okuma dosyası yükleniyor', 'initializing api': 'OCR hazırlanıyor', 'recognizing text': 'Metin okunuyor' };
  function ocrLogger(m) { if (ocrProgress) ocrProgress(m); }
  function createOcrWorker(useCdn) {
    var P0 = ocrPaths(useCdn);
    return loadScript(P0.lib, 60000).then(function () {
      return withTimeout(Tesseract.createWorker('tur', 1, { workerPath: P0.worker, corePath: P0.core, langPath: P0.lang, logger: ocrLogger, errorHandler: function (e) { console.warn('OCR worker:', e); } }),
        180000, 'OCR motoru 3 dakikada hazırlanamadı (yavaş internet olabilir)');
    }).then(function (w) {
      return w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1', user_defined_dpi: '300' }).then(function () { return w; });
    });
  }
  function getOcrWorker() {
    if (ocrWorkerP) return ocrWorkerP;
    var useCdn = location.protocol === 'file:';
    ocrWorkerP = createOcrWorker(useCdn).catch(function (e) {
      if (useCdn) throw e;
      console.warn('Yerel OCR dosyaları yüklenemedi, CDN deneniyor', e);
      return createOcrWorker(true);
    }).catch(function (e) {
      ocrWorkerP = null;
      throw new Error('Ücretsiz OCR başlatılamadı: ' + e.message + '. İnternet bağlantını kontrol edip tekrar dene.');
    });
    return ocrWorkerP;
  }
  function resetOcrWorker() { var p = ocrWorkerP; ocrWorkerP = null; if (p) p.then(function (w) { w.terminate(); }).catch(function () { }); }
  function ocrRecognize(worker, src, label) {
    return withTimeout(worker.recognize(src, { rotateAuto: true }), 150000, 'Metin okuma 2,5 dakikayı aştı').then(function (r) {
      return { text: (r.data && r.data.text) || '', conf: (r.data && r.data.confidence) || 0, label: label };
    });
  }
  function receiptScore(text) {
    var rec = P.parseReceiptText(text);
    return { rec: rec, score: rec.rows.length + (rec.docTotal != null ? 3 : 0) + (rec.matches ? 10 : 0) + (rec.date ? 1 : 0) };
  }
  var lastOcr = null;
  function ocrImages(images, name, note) {
    var startedAt = Date.now();
    ocrProgress = function (m) {
      var label = OCR_STEPS[m.status] || null; if (!label) return;
      var pct = typeof m.progress === 'number' ? ' %' + Math.round(m.progress * 100) : '';
      busy(label + '…' + pct + (images.length > 1 ? ' (sayfa ' + (curPage + 1) + '/' + images.length + ')' : '') + (Date.now() - startedAt > 20000 && m.status !== 'recognizing text' ? ' — ilk seferde biraz sürer' : ''));
    };
    var curPage = 0;
    busy('Ücretsiz OCR hazırlanıyor…');
    return getOcrWorker().then(function (worker) {
      var texts = [], chain = Promise.resolve();
      images.forEach(function (im, i) {
        chain = chain.then(function () {
          curPage = i;
          var first = im.ocrClean || im.ocrPlain || im.dataUrl;
          return ocrRecognize(worker, first, 'temiz').then(function (r1) {
            var s1 = receiptScore(r1.text);
            // Sonuç zayıfsa (toplam tutmadı / satır yok) işlenmemiş kopyayı da dene, daha iyisini al
            if (s1.rec.matches || !(im.ocrClean && im.ocrPlain)) return r1;
            busy('İkinci deneme: görsel farklı ayarla okunuyor…');
            return ocrRecognize(worker, im.ocrPlain, 'ham').then(function (r2) { return receiptScore(r2.text).score > s1.score ? r2 : r1; }, function () { return r1; });
          }).then(function (r) { texts.push(r.text); });
        });
      });
      return chain.then(function () { ocrProgress = null; buildOcrReview(texts.join('\n'), images, name, note); });
    }, function (e) { ocrProgress = null; throw e; }).catch(function (e) {
      ocrProgress = null;
      if (/zaman aşımı|aştı/.test(e.message)) resetOcrWorker();
      throw e;
    });
  }
  function buildOcrReview(text, images, name, note) {
    var lines = P.parseTextLines(text, importOpts.cc ? -1 : 1), rec = P.parseReceiptText(text);
    var useLines = lines.rows.length >= 2 && lines.rows.length > rec.rows.length;
    var rows = useLines ? lines.rows : rec.rows, warn = [];
    if (note) warn.push(note);
    if (!String(text).trim()) warn.push('Görselde okunabilir yazı bulunamadı. Fişi düz bir yere koyup yakından, gölgesiz çekmeyi dene; aşağıdaki satırı elle de doldurabilirsin.');
    var fallback = false;
    if (!rows.length) { rows = P.receiptFallbackRows(rec, todayYmd()); fallback = true; if (String(text).trim()) warn.push(rec.docTotal != null ? 'Kalemler ayrı ayrı okunamadı; fişin TOPLAM tutarı tek satır olarak eklendi. Kontrol et.' : 'Metin okundu ama kalemler ayrıştırılamadı. Okunan ham metin aşağıda; tutarı oradan bakıp satıra yazabilirsin.'); }
    else if (!useLines && rec.docTotal == null) warn.push('Fişin TOPLAM satırı okunamadı, bu yüzden kontrol yapılamadı. Satırları fişle karşılaştır; eksik kalem varsa "+ Satır ekle" ile ekle.');
    else if (!useLines && rec.docTotal != null && !rec.matches) warn.push('Okunan kalemlerin toplamı (' + tl2(rec.itemsSum) + ') fişteki TOPLAM ile (' + tl2(rec.docTotal) + ') tutmuyor. Yanlış okunan satırı düzelt ya da "Fişi tek satır olarak kaydet"e bas.');
    review = { source: name + ' (ücretsiz OCR' + (rec.merchant && !useLines ? ', ' + rec.merchant : '') + ')', kind: 'ocr', receipt: !useLines, cc: importOpts.cc,
      docTotal: useLines ? (lines.totals.length ? lines.totals[lines.totals.length - 1].amount : null) : rec.docTotal, preview: images[0].dataUrl, ocrText: text, ocrWarn: warn, ocrRec: rec, rawOpen: fallback };
    startReviewRows(rows); render();
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
    if (r.ocrWarn && r.ocrWarn.length) h += r.ocrWarn.map(function (w) { return '<div class="notice warn">' + esc(w) + '</div>'; }).join('');
    if (r.cardDetect && r.cardDetect.isCard || r.cc) h += '<div class="notice ' + (r.autoCc ? 'info' : 'warn') + '" id="rv-cc-note">' + (r.autoCc ? '<b>Kredi kartı ekstresi algılandı</b> (' + esc((r.cardDetect.hits || []).join(', ')) + '). Belgede artı yazılan harcamalar <b>gider (−)</b>, "ödeme/teşekkür" satırları <b>Transfer</b> sayıldı.' : (r.cc ? 'Kredi kartı ekstresi olarak okunuyor: artı tutarlar gider sayıldı.' : '<b>Bu belge kredi kartı ekstresine benziyor</b> (' + esc((r.cardDetect.hits || []).join(', ')) + '). Harcamalar gelir görünüyorsa aşağıdaki kutuyu işaretle.')) +
      '<label class="row" style="margin-top:6px"><input type="checkbox" id="rv-cc"' + (r.cc ? ' checked' : '') + '> Kredi kartı ekstresi (artı tutarlar harcama)</label></div>';
    h += '<section class="card" style="margin-top:10px" id="rv-summary">' + reviewSummary() + '</section>';
    if (r.preview) h += '<details class="card" style="margin-top:10px"><summary><b>Belgeyi göster</b> <span class="hint">(karşılaştırmak için)</span></summary><img src="' + r.preview + '" alt="Yüklenen belge" style="max-width:100%;max-height:600px;margin-top:10px;border-radius:8px"></details>';
    h += reviewCardBox();
    h += '<section class="card" style="margin-top:10px"><div class="row" style="margin-bottom:10px">' +
      '<button class="btn small" data-act="rv-all">Tümünü seç</button><button class="btn small" data-act="rv-none">Tümünü kaldır</button>' +
      '<button class="btn small" data-act="rv-flip">Seçililerde gelir ↔ gider çevir</button><button class="btn small" data-act="rv-merge">Seçilileri tek işlemde birleştir</button>' +
      '<button class="btn small" data-act="rv-add">+ Satır ekle</button>' + (r.receipt && r.ocrRec && r.ocrRec.docTotal != null ? '<button class="btn small" data-act="rv-total-only">Fişi tek satır olarak kaydet (' + esc(tl2(r.ocrRec.docTotal)) + ')</button>' : '') +
      '<span class="row" style="gap:6px"><label for="rv-date" class="hint">Seçililere tarih:</label><input type="date" id="rv-date" style="width:auto"><button class="btn small" data-act="rv-setdate">Uygula</button></span>' +
      '<span class="row" style="gap:6px"><label for="rv-cat" class="hint">Seçililere kategori:</label><select id="rv-cat" style="width:auto"><option value="">— seç —</option>' + catOptions('') + '</select><button class="btn small" data-act="rv-setcat">Uygula</button></span></div>';
    h += '<div class="tablewrap"><table class="review"><thead><tr><th><span class="sr">Dahil</span>✓</th><th>Tarih</th><th>Açıklama</th><th class="r">Tutar (TL) ' + tip('Eksi (−) harcama, artı gelir demektir.') + '</th><th>Kategori</th><th>Durum</th></tr></thead><tbody>';
    r.rows.forEach(function (x) {
      h += '<tr data-key="' + x.key + '" class="' + rowClass(x) + '"><td><input type="checkbox" aria-label="Bu satırı dahil et" data-rv="include"' + (x.include ? ' checked' : '') + '></td>' +
        '<td><input type="date" aria-label="Tarih" data-rv="date" value="' + esc(x.date || '') + '" style="min-width:130px">' + (!x.date && x.rawDate ? '<div class="hint">Okunan: ' + esc(x.rawDate) + '</div>' : '') + '</td>' +
        '<td><input type="text" aria-label="Açıklama" data-rv="description" maxlength="120" value="' + esc(x.description) + '" style="min-width:180px"></td>' +
        '<td><input type="text" class="money ' + amtClass(x) + '" inputmode="decimal" aria-label="Tutar" data-rv="amount" value="' + (Number.isInteger(x.amount) ? esc(moneyInputVal(x.amount)) : '') + '" style="min-width:110px"><span class="rv-kind ' + amtClass(x) + '">' + amtKind(x) + '</span></td>' +
        '<td><select aria-label="Kategori" data-rv="category">' + catOptions(x.category) + '</select></td><td class="rv-status">' + rowStatus(x) + '</td></tr>';
    });
    h += '</tbody></table></div>' + (r.rows.length ? '' : '<p class="muted">Hiç satır çıkarılamadı. Sütun eşleştirmesini kontrol et.</p>') + '</section>';
    h += '<div class="row savebar"><button class="btn primary" data-act="rv-save" id="rv-save">Onayla ve kaydet</button><button class="btn" data-act="rv-cancel">Vazgeç</button></div>';
    if (r.pdfText || r.ocrText || r.kind === 'ocr') h += '<details class="card' + (r.kind === 'ocr' ? '' : ' detail-only') + '" style="margin-top:14px"' + (r.rawOpen ? ' open' : '') + ' id="rv-raw"><summary>Belgeden okunan ham metin' + (r.kind === 'ocr' ? ' <span class="hint">(tutarları buradan kontrol edebilirsin)</span>' : '') + '</summary><pre style="white-space:pre-wrap;font-size:.8rem;max-height:400px;overflow:auto">' + esc(r.pdfText || r.ocrText || '(Görselde yazı bulunamadı)') + '</pre></details>';
    return h;
  }
  function amtClass(x) { return !Number.isInteger(x.amount) ? '' : x.category === 'Transfer' ? 'amt-tr' : x.amount < 0 ? 'amt-out' : 'amt-in'; }
  function amtKind(x) { return !Number.isInteger(x.amount) ? '' : x.category === 'Transfer' ? '⇄ Transfer' : x.amount < 0 ? '▼ Gider' : '▲ Gelir'; }
  function rowClass(x) { return (x.include ? '' : 'excluded ') + (x.include && x.errors.length ? 'has-err ' : '') + (x.fromDocTotal ? 'from-doc' : ''); }
  function rowStatus(x) {
    var s = x.errors.map(function (e) { return '<span class="pill err">' + esc(e) + '</span>'; }).concat(x.warnings.map(function (w) { return '<span class="pill warn" title="' + esc(x.duplicate || x.possibleDup || '') + '">' + esc(w) + '</span>'; }));
    if (x.possibleDup && !x.duplicate) s.push('<span class="hint">' + esc(x.possibleDup) + '</span>');
    if (x.fromDocTotal) s.push('<span class="pill warn">Fişteki TOPLAM’dan (kalemlerin toplamı değil)</span>');
    else if (x.note) s.push('<span class="pill info">' + esc(x.note) + '</span>');
    if (x.replaces) s.push('<span class="pill info" title="Kaydedince beklenen kayıt silinir, bu gerçek işlem onun yerine geçer (çift sayım olmaz)">Beklenen "' + esc(x.replaces.description) + '" kaydının yerine geçer</span>');
    if (x.inst) s.push('<span class="pill info">Taksit ' + x.inst.no + '/' + x.inst.count + '</span>');
    return s.length ? s.join(' ') : '<span class="pill ok">Uygun</span>';
  }
  function docTotalLabel(r) {
    if (r.kind === 'ocr' || r.kind === 'ai' || r.receipt) return 'Fişteki toplam';
    if (r.kind === 'pdf') return 'Ekstredeki toplam';
    return 'Belgedeki toplam';
  }
  function reviewSumFormula(sel, tc) {
    if (!sel.length) return '';
    if (sel.length > 12) return ' ' + sel.length + ' kalemin kuruş toplamı ' + tc.computed + ' kuruş.';
    if (tc.income > 0 && tc.expense > 0) return ' Gider ' + tl2(tc.expense) + ' − gelir ' + tl2(tc.income) + ' = net ' + tl2(tc.net) + '.';
    var parts = sel.map(function (x, i) {
      var a = M.format(Math.abs(x.amount), { symbol: false });
      return i === 0 ? a : ((x.amount < 0 === sel[0].amount < 0 ? ' + ' : ' − ') + a);
    });
    return ' ' + parts.join('') + ' = ' + M.format(tc.computed, { symbol: false }) + ' TL.';
  }
  function reviewSummary() {
    var r = review, tc = P.totalsCheck(r.rows, r.docTotal, { expectExpenses: isExpenseDoc(r) });
    var errs = r.rows.filter(function (x) { return x.include && x.errors.length; }).length;
    var dups = r.rows.filter(function (x) { return x.duplicate; }).length;
    var included = r.rows.filter(function (x) { return x.include; }).length;
    var fallbackOnly = tc.fromDocTotal > 0 && tc.fromDocTotal === tc.count && tc.count > 0;
    var label = docTotalLabel(r);
    var countTxt = tc.count === 0 ? 'Seçili geçerli satır yok' :
      ((tc.count === 1 ? '1 kalem' : tc.count + ' kalem tek tek toplandı') + (included > tc.count ? ' (' + (included - tc.count) + ' satırın tutarı yazılmadı)' : ''));
    var computedLabel = (tc.income > 0 && tc.expense > 0) ? (tc.computedIsNet ? 'Seçili satırların net toplamı' : 'Seçili giderlerin toplamı') : 'Seçili satırların toplamı';
    var h = '';
    if (fallbackOnly) h += '<div class="notice warn" id="rv-fallback-note"><b>Dikkat:</b> Kalemler tek tek okunamadı. Aşağıdaki satır, ' + esc(label.toLowerCase()) + ' tutardan geldi; ürün fiyatlarının tek tek toplamı değil. İki tutar bu yüzden aynı görünür. Fişle karşılaştırıp öyle onayla.</div>';
    h += '<p class="hint" style="margin-top:0">Soldaki tutar, seçtiğin satırların fiyatlarının <b>tek tek toplamıdır</b> — belgede yazanı buraya kopyalamıyoruz. Sağdaki, fişte veya ekstrede yazılı toplamdır.</p>';
    h += '<div class="row" style="gap:16px"><span><b>' + r.rows.length + '</b> satır bulundu</span><span><b>' + tc.count + '</b> seçili</span>' +
      (dups ? '<span class="pill warn">' + dups + ' olası mükerrer (seçilmedi)</span>' : '') + (errs ? '<span class="pill err">' + errs + ' seçili satırda hata var</span>' : '') + '</div>';
    h += '<div class="rv-totals">';
    h += '<div class="rv-kpi" id="rv-computed"><div class="label">' + computedLabel + ' ' + tip('Bu tutar belgede yazılı toplamın kopyası değildir. Seçili satırların tutarları kuruş kuruş, tek tek toplanır.') + '</div>' +
      '<div class="value" id="rv-computed-value">' + tl2(tc.computed) + '</div>' +
      '<div class="sub">' + esc(countTxt) + '</div></div>';
    h += '<div class="rv-kpi" id="rv-docbox"><label class="label" for="rv-total">' + esc(label) + ' ' + tip('Fişin veya ekstrenin üzerinde yazılı TOPLAM. Satırların toplamıyla karşılaştırılır; kuruşu kuruşuna eşleşmeli. Yanlış okunduysa düzelt.') + '</label>';
    if (r.docTotal != null) h += '<div class="value" id="rv-doc-value">' + tl2(r.docTotal) + '</div>';
    else h += '<div class="value muted" id="rv-doc-value">Okunamadı</div>';
    h += '<div class="sub">Belgede yazılı olan</div>' +
      '<div class="row" style="margin-top:6px"><span class="hint">Yanlışsa düzelt:</span>' +
      '<input id="rv-total" class="money" type="text" inputmode="decimal" aria-label="' + esc(label) + '" style="max-width:160px" placeholder="belgedeki toplam" value="' + (r.docTotal != null ? esc(moneyInputVal(r.docTotal)) : '') + '"></div></div>';
    var stClass, stText, stSub;
    if (tc.suspicious) {
      stClass = 'err'; stText = '⚠ İşaretler şüpheli'; stSub = tc.suspicious;
    } else if (fallbackOnly && r.docTotal != null) {
      stClass = 'miss'; stText = 'Tek satır fişteki toplamdan'; stSub = 'Kalem kalem toplanmadı, fişle kontrol et.';
    } else if (r.docTotal == null) {
      stClass = 'miss'; stText = 'Belgedeki toplam yok'; stSub = 'Kontrol için yukarıya yaz.';
    } else if (tc.match) {
      stClass = 'ok'; stText = 'Tutuyor ✓'; stSub = tc.byNet ? 'Ödemeler düşülmüş net tutarla.' : (tc.income > 0 && tc.expense > 0 && !tc.computedIsNet ? 'Giderlerin toplamı belgede yazılanla aynı.' : 'Satırların toplamı belgede yazılanla aynı.');
    } else {
      var ad = tc.diff < 0 ? -tc.diff : tc.diff;
      stClass = 'err'; stText = 'Fark: ' + tl2(ad);
      stSub = tc.diff < 0 ? 'Satırların toplamı belgede yazılandan ' + tl2(ad) + ' eksik.' : 'Satırların toplamı belgede yazılandan ' + tl2(ad) + ' fazla.';
    }
    h += '<div class="rv-status-box ' + stClass + '" id="rv-match-status" role="status"><div class="value">' + esc(stText) + '</div><div class="sub">' + esc(stSub) + '</div></div>';
    h += '</div>';
    var selAmt = r.rows.filter(function (x) { return x.include && Number.isInteger(x.amount); });
    h += '<div class="detail-only rv-detail" style="margin-top:14px">';
    h += '<div class="row" style="gap:16px"><span>Seçili gider: <b class="num neg">' + tl2(tc.expense) + '</b></span><span>Seçili gelir: <b class="num pos">' + tl2(tc.income) + '</b></span><span>Net: <b class="num">' + tl2(tc.net) + '</b></span></div>';
    h += '<p class="hint" style="margin-bottom:0">Tüm hesaplar kuruş üzerinden: satır toplamı <span class="formula">' + tc.computed + ' kuruş</span>' + (r.docTotal != null ? ', belgedeki toplam <span class="formula">' + r.docTotal + ' kuruş</span>' : '') + '.' + reviewSumFormula(selAmt, tc) + '</p>';
    if (r.totalsFound && r.totalsFound.length > 1) h += '<p class="hint">Belgede bulunan toplamlar: ' + r.totalsFound.map(function (t) { return esc(t.label) + ' → ' + tl2(t.amount); }).join(' · ') + '</p>';
    h += '</div>';
    return h;
  }

  function refreshReviewRow(x) {
    var tr = $('tr[data-key="' + x.key + '"]'); if (!tr) return;
    tr.className = rowClass(x); $('.rv-status', tr).innerHTML = rowStatus(x);
    var ai = $('input[data-rv="amount"]', tr), ak = $('.rv-kind', tr);
    if (ai) { ai.classList.remove('amt-in', 'amt-out', 'amt-tr'); if (amtClass(x)) ai.classList.add(amtClass(x)); }
    if (ak) { ak.className = 'rv-kind ' + amtClass(x); ak.textContent = amtKind(x); }
    var cb = $('input[data-rv="include"]', tr); if (cb) cb.checked = !!x.include;
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
    var tc = P.totalsCheck(review.rows, review.docTotal, { expectExpenses: isExpenseDoc(review) });
    if (tc.suspicious && !confirm('DİKKAT: ' + tc.suspicious + '\n\nBöyle kaydedersen harcamaların GELİR olarak sayılır. Yine de kaydedilsin mi?')) return;
    if (review.docTotal != null && !tc.match && !tc.suspicious && !confirm('Seçili satırların toplamı belgedeki toplamla uyuşmuyor (fark ' + tl2(tc.diff < 0 ? -tc.diff : tc.diff) + '). Yine de kaydedilsin mi?')) return;
    var d = sel.filter(function (x) { return x.duplicate; }).length;
    if (d && !confirm(d + ' satır daha önce kaydedilmiş bir işlemle aynı görünüyor. Yine de kaydedilsin mi?')) return;
    var src = review.source, cardId = review.cardId || null, mkInst = !!(cardId && review.mkInst), updStmt = !!(cardId && review.updStmt && review.docTotal != null);
    var nRep = 0, nInst = 0, stmtYm = sel.map(function (x) { return x.date.slice(0, 7); }).sort().pop(); // ekstrenin ayı = en yeni işlem ayı
    var ok = mutate(function (s) {
      sel.forEach(function (x) {
        var tx = { id: S.uid(), date: x.date, description: x.description.trim(), amount: x.amount, category: x.category, source: src };
        if (cardId) tx.accountId = cardId;
        if (x.replaces && s.transactions.some(function (t) { return t.id === x.replaces.id; })) { // beklenen düzenli kaydın yerine geç
          s.transactions = s.transactions.filter(function (t) { return t.id !== x.replaces.id; });
          tx.recurringId = x.replaces.recurringId; tx.period = x.replaces.period; nRep++;
        }
        s.transactions.push(tx);
        if (mkInst && x.inst && x.amount < 0) {
          var firstYm = L.addMonthsYm(stmtYm, -(x.inst.no - 1)), desc = x.description.trim().replace(/\s*\(?\b(taksit|tks|tk)\b.*$/i, '').trim() || x.description.trim();
          var exists = s.installments.some(function (p) { return p.cardId === cardId && p.count === x.inst.count && p.firstYm === firstYm && p.description === desc; });
          if (!exists) { s.installments.push({ id: S.uid(), cardId: cardId, description: desc, category: x.category, total: M.mulRatio(-x.amount, x.inst.count, 1), count: x.inst.count, firstYm: firstYm, fromStatement: true }); nInst++; }
        }
      });
      if (updStmt) {
        var c = s.accounts.find(function (a) { return a.id === cardId; });
        c.card.statementDebt = review.docTotal; c.card.statementYm = stmtYm; c.card.paid = 0;
      }
    }, sel.length + ' işlem kaydedildi.' + (nRep ? ' ' + nRep + ' beklenen kayıt gerçeğiyle değiştirildi.' : '') + (nInst ? ' ' + nInst + ' taksit planı eklendi.' : '') + (updStmt ? ' Kart ekstre borcu güncellendi.' : ''));
    if (ok) { review = null; location.hash = '#islemler'; }
  }

  function reviewCardBox() {
    var cs = cards(); if (!cs.length) return '';
    var r = review; if (r.cardId === undefined) { r.cardId = r.cc && cs.length === 1 ? cs[0].id : ''; r.mkInst = true; r.updStmt = r.cc; }
    var nInst = r.rows.filter(function (x) { return x.inst; }).length;
    return '<section class="card" style="margin-top:10px"><h2>Kredi kartı bağlantısı ' + tip('Ekstre bir kredi kartına aitse kartı seç: işlemler o karta bağlanır, taksitli satırlar taksit listesine eklenir, ekstre borcu güncellenir.') + '</h2><div class="row">' +
      '<label for="rv-card">Bu belge hangi karta ait?</label><select id="rv-card" style="max-width:280px">' + accOptions(r.cardId, function (a) { return a.type === 'card'; }, '— karta ait değil —') + '</select></div>' +
      (r.cardId ? '<label class="row" style="margin-top:8px"><input type="checkbox" id="rv-mkinst"' + (r.mkInst ? ' checked' : '') + '> Taksitli satırları (' + nInst + ' adet bulundu) taksit listesine ekle <span class="hint">(toplam = taksit tutarı × taksit sayısı, tahmini; ekstre ayı = en yeni işlem ayı)</span></label>' +
        '<label class="row" style="margin-top:6px"><input type="checkbox" id="rv-stmt"' + (r.updStmt ? ' checked' : '') + (r.docTotal == null ? ' disabled' : '') + '> Kartın son ekstre borcunu belgedeki toplamla (' + (r.docTotal != null ? tl2(r.docTotal) : 'toplam girilmedi') + ') güncelle</label>' : '') + '</section>';
  }

  /* ---------- YAPAY ZEKÂ ASİSTANI ---------- */
  function contextSummary() {
    var an = analyzeNow(), b = an.budget, l = [];
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
    try {
      var t = today(), acs = L.accountsSummary(state, t);
      if (state.accounts.length) l.push('Hesaplar: ' + acs.rows.map(function (r) { return r.acc.name + ' ' + L.formatCur(r.acc.balance, r.acc.currency) + (r.tl != null && r.acc.currency !== 'TRY' ? ' (≈' + tl(r.tl) + ')' : ''); }).join('; ') + '. Kurlar (kullanıcı girdi): ' + Object.keys(state.rates).map(function (c) { return c + ' ' + tl2(state.rates[c].rate) + ' (' + state.rates[c].date + ')'; }).join(', ') + '.');
      var lim = L.categoryLimits(state, nowYm(), t); if (lim.length) l.push('Kategori sınırları (bu ay harcanan/sınır): ' + lim.map(function (x) { return x.category + ' ' + tl(x.spent) + '/' + tl(x.limit) + (x.level !== 'ok' ? ' [' + (x.level === 'over' ? 'AŞILDI' : '%80+') + ']' : ''); }).join('; '));
      var up = L.upcoming(state, t, 30); if (up.length) l.push('Yaklaşan ödemeler (30 gün): ' + up.slice(0, 10).map(function (x) { return x.title + ' ' + tl(Math.abs(x.amount)) + ' ' + x.date + ' (' + daysText(x.daysLeft) + ')'; }).join('; '));
      var ib = L.installmentBurden(state, nowYm(), 3); if (state.installments.length) l.push('Kart taksit yükü: bu ay ' + tl(ib[0].total) + ', gelecek ay ' + tl(ib[1].total) + ', sonraki ay ' + tl(ib[2].total) + '.');
      if (state.sinkingFunds.length) l.push('Yıllık giderler kumbarası: ' + state.sinkingFunds.map(function (f) { return f.name + ' ' + tl(f.saved) + '/' + tl(f.amount) + ' (' + f.dueYm + ')'; }).join('; ') + '. Bu ay ayrılacak toplam ' + tl(L.sinkingTotals(state, nowYm()).monthlyNeed) + '.');
      var ins = L.insights(L.compareMonths(state.transactions, t), tl); l.push('Aylık karşılaştırma: ' + ins.map(function (x) { return x.text; }).join(' '));
    } catch (e) { /* özet eksik kalabilir */ }
    var pc = PUI.contextSummary(); if (pc) l.push(pc);
    if (window.__analysisContext) l.push(window.__analysisContext);
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
      '<p class="hint">Yedek dosyası asistan/fiyat servisi anahtarlarını içermez. Geri yüklemeden önce dosya kontrol edilir; bozuksa hiçbir şey değişmez.</p>' +
      '<p><a class="btn" href="#guvenlik">🔐 Şifreli yedek, otomatik kopyalar, cihazlar arası eşitleme ve uygulama kilidi →</a></p></section>';
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
      '<p class="hint">Örnek veriyi yüklemek mevcut verilerinin yerine geçer (önce yedek almayı unutma). Silme işlemi asistan anahtarlarını silmez; onlar Asistan bölümünden silinir.</p>' +
      '<p class="hint detail-only">Uygulama sürümü 7.1 · Veri şeması v' + S.SCHEMA_VERSION + ' · Para hesapları tam sayı kuruşla yapılır · <a href="tests/tests.html">Hesap testlerini çalıştır</a></p></section></div>';
    return h;
  }
  function exportCsv() {
    var rows = [['Tarih', 'Açıklama', 'Kategori', 'Tutar (TL)', 'Kaynak']];
    state.transactions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) { rows.push([dateLabel(t.date), t.description, t.category, M.format(t.amount, { symbol: false }).replace('−', '-'), t.source || '']); });
    var csv = '\uFEFF' + rows.map(function (r) { return r.map(function (c) { c = String(c); if (/^[=+\-@]/.test(c) && !/^-?[\d.,]+$/.test(c)) c = "'" + c; return '"' + c.replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    Store.download('finans-islemler-' + todayYmd() + '.csv', csv, 'text/csv;charset=utf-8');
  }

  /* =====================================================================
   * BÜTÇE v2 ARAYÜZÜ: sınırlar, düzenli ödemeler, kartlar ve taksitler, karşılaştırma, yıllık giderler, hesaplar ve kurlar.
   * Hesaplar ledger.js'te (saf fonksiyonlar, testli). Burada yalnızca gösterim ve kullanıcı işlemleri var.
   * ===================================================================== */
  function today() { return todayYmd(); }
  function nowYm() { return today().slice(0, 7); }
  function eff() { return L.effectiveState(state, today()); }
  function analyzeNow() { var e = eff(), an = C.analyze(e, nowYm()); try { PF.patchAnalysis(an, e, PF.goalsReport(e, an)); } catch (er) { console.error(er); } return an; }
  function curVal(minor) { return M.format(minor, { symbol: false }); }
  function shortYm(ym) { var a = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']; var p = ym.split('-'); return a[+p[1] - 1] + ' ' + p[0].slice(2); }
  function daysText(d) { return d < 0 ? (-d) + ' gün gecikti' : d === 0 ? 'Bugün' : d === 1 ? 'Yarın' : d + ' gün sonra'; }
  function lvClass(lv) { return lv === 'overdue' || lv === 'today' || lv === 'over' ? 'err' : lv === 'soon' || lv === 'warn' ? 'warn' : lv === 'paid' || lv === 'ok' ? 'ok' : 'info'; }
  function accById(id) { return (state.accounts || []).find(function (a) { return a.id === id; }); }
  function cards() { return (state.accounts || []).filter(function (a) { return a.type === 'card'; }); }
  function accOptions(sel, filter, emptyLabel) {
    return (emptyLabel != null ? '<option value="">' + esc(emptyLabel) + '</option>' : '') + state.accounts.filter(filter || function () { return true; }).map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name) + ' (' + L.CURRENCIES[a.currency].short + ')</option>';
    }).join('');
  }
  function sel(list, id, field, options, cur, label) {
    return '<select aria-label="' + esc(label) + '" data-list="' + list + '" data-id="' + esc(id) + '" data-field="' + field + '">' + options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function numIn(list, id, field, val, label, min, max) { return '<input type="number" inputmode="numeric" min="' + min + '" max="' + max + '" step="1" style="max-width:90px" aria-label="' + esc(label) + '" data-list="' + list + '" data-id="' + esc(id) + '" data-field="' + field + '" value="' + esc(val == null ? '' : val) + '">'; }
  function ymIn(list, id, field, val, label) { return '<input type="month" aria-label="' + esc(label) + '" data-list="' + list + '" data-id="' + esc(id) + '" data-field="' + field + '" value="' + esc(val || '') + '">'; }
  function chk(list, id, field, on, label) { return '<input type="checkbox" aria-label="' + esc(label) + '" data-list="' + list + '" data-id="' + esc(id) + '" data-field="' + field + '"' + (on ? ' checked' : '') + '>'; }
  function catOpts(sel) { var list = P.CATEGORIES.slice(); if (sel && list.indexOf(sel) < 0) list.push(sel); return list.map(function (c) { return [c, c]; }); }
  var sub = '';
  function subtabs(base, items) {
    return '<nav class="subtabs" aria-label="Alt bölümler">' + items.map(function (it) {
      var cur = (sub || '') === it[0];
      return '<a href="#' + base + (it[0] ? '/' + it[0] : '') + '"' + (cur ? ' aria-current="page"' : '') + '>' + it[1] + '</a>';
    }).join('') + '</nav>';
  }
  function bar(bp, color, label) { var w = Math.max(0, Math.min(100, bp / 100)); return '<div class="progress" role="progressbar" aria-label="' + esc(label || '') + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(w) + '"><span style="width:' + w + '%;background:' + color + '"></span></div>'; }

  /* ---------- Ortak parçalar (Özet'te de kullanılır) ---------- */
  function upcomingList(list, max) {
    if (!list.length) return '<p class="muted">Önümüzdeki 30 günde bekleyen ödeme yok. 👍</p>';
    return '<ul class="uplist">' + list.slice(0, max || 999).map(function (x) {
      var act = x.kind === 'recurring' ? '<button class="btn small" data-act="rc-pay" data-id="' + esc(x.id) + '" data-period="' + x.period + '" title="Ödendi olarak işlemlere kaydet">' + (x.amount > 0 ? 'Geldi' : 'Ödendi') + '</button>'
        : x.kind === 'card' ? '<a class="btn small" href="#odemeler/kartlar">Öde</a>' : '<a class="btn small" href="#butce/yillik">Gör</a>';
      return '<li><span class="pill ' + lvClass(x.level) + '">' + daysText(x.daysLeft) + '</span><span class="grow"><b>' + esc(x.title) + '</b> <span class="hint">' + dateLabel(x.date) +
        (x.kind === 'card' ? ' · kalan ekstre borcu' : x.kind === 'sinking' ? (x.ready ? ' · para hazır ✓' : ' · kumbara henüz dolmadı') : '') + '</span></span><b class="num ' + (x.amount < 0 ? 'neg' : 'pos') + '">' + tl2(x.amount) + '</b>' + act + '</li>';
    }).join('') + '</ul>';
  }
  function limitBars(list) {
    return list.map(function (x) {
      var col = x.level === 'over' ? 'var(--danger)' : x.level === 'warn' ? 'var(--medium)' : 'var(--safe)';
      var msg = x.level === 'over' ? 'Sınırı ' + tl(-x.remaining) + ' aştın' : x.atLimit ? 'Sınıra ulaştın' : x.level === 'warn' ? 'Sınıra yaklaştın: ' + tl(x.remaining) + ' kaldı' : tl(x.remaining) + ' kaldı';
      return '<div class="lim"><div class="row" style="justify-content:space-between;gap:6px"><b>' + esc(x.category) + '</b><span class="num">' + tl(x.spent) + ' / ' + tl(x.limit) + '</span></div>' + bar(x.usedBp, col, x.category + ' sınır kullanımı') +
        '<div class="hint"><span class="pill ' + lvClass(x.level) + '">' + (x.level === 'ok' ? 'İyi' : x.level === 'warn' ? '⚠ %80+' : '⚠ Aşıldı') + '</span> ' + msg + ' (' + pct(x.usedBp) + ')' +
        ' · Ay sonu tahmini <b class="num">' + tl(x.estimate) + '</b>' + (x.estimateLevel === 'over' ? ' <b class="neg">(aşacak)</b>' : '') +
        '<span class="detail-only"> (büyük olanı: harcanan + bekleyen düzenli ödeme ' + tl(x.expected || 0) + ' = ' + tl(x.projected) + ' · bu hızla ' + tl(x.pace) + ')</span></div></div>';
    }).join('');
  }
  function extraActions() {
    var out = [], t = today();
    L.categoryLimits(state, nowYm(), t).forEach(function (x) {
      if (x.level === 'over') out.push({ level: 'danger', text: x.category + ' için koyduğun aylık sınırı ' + tl(-x.remaining) + ' aştın. Bu kategoride ay sonuna kadar harcamayı durdurmaya çalış.' });
      else if (x.level === 'warn') out.push({ level: 'warn', text: x.category + ' sınırının ' + pctS(x.usedBp) + 'ne ulaştın; ' + tl(x.remaining) + ' kaldı.' });
    });
    var up = L.upcoming(state, t, 7).filter(function (x) { return x.level === 'overdue' || x.level === 'today' || x.level === 'soon'; });
    if (up.length) out.push({ level: up.some(function (x) { return x.level === 'overdue'; }) ? 'danger' : 'warn', text: up.length + ' ödeme yaklaştı veya gecikti: ' + up.slice(0, 3).map(function (x) { return x.title + ' (' + daysText(x.daysLeft).toLowerCase() + ')'; }).join(', ') + '.' });
    var sk = L.sinkingTotals(state, nowYm());
    var pending = (state.sinkingFunds || []).filter(function (f) { return L.sinkingPlan(f, nowYm()).toSetAsideNow > 0; });
    if (pending.length) out.push({ level: 'info', text: 'Yıllık giderler için bu ay ' + tl(M.sum(pending.map(function (f) { return L.sinkingPlan(f, nowYm()).toSetAsideNow; }))) + ' kenara koy (' + pending.length + ' kalem). Toplam aylık ihtiyaç ' + tl(sk.monthlyNeed) + '.' });
    return out;
  }
  function renderOverviewExtras() {
    var t = today(), up = L.upcoming(state, t, 30), lim = L.categoryLimits(state, nowYm(), t), h = '';
    var cmp = L.compareMonths(state.transactions, t), ins = L.insights(cmp, tl), sk = L.sinkingTotals(state, nowYm()), acs = L.accountsSummary(state, t);
    h += '<div class="grid two" style="margin-top:14px">';
    h += '<section class="card"><h2>Yaklaşan ödemeler ' + tip('Önümüzdeki 30 gün: düzenli ödemeler (kira, fatura, abonelik), kredi kartı son ödeme günü ve yıllık giderler. Kırmızı: gecikti/bugün, sarı: birkaç gün kaldı.') + '</h2>' + upcomingList(up, 5) +
      (up.length > 5 ? '<p class="hint">+' + (up.length - 5) + ' ödeme daha</p>' : '') + '<a class="btn small" href="#odemeler">Tüm ödemeler</a></section>';
    h += '<section class="card"><h2>Harcama sınırları ' + tip('Her kategori için koyduğun aylık sınıra göre bu ayki harcaman. %80\'e gelince sarı, aşınca kırmızı.') + '</h2>' +
      (lim.length ? limitBars(lim.slice(0, 5)) + (lim.length > 5 ? '<p class="hint">+' + (lim.length - 5) + ' kategori daha</p>' : '') : '<p class="muted">Henüz sınır koymadın.</p>') + '<a class="btn small" href="#butce/sinirlar">Sınırları düzenle</a></section>';
    h += '</div><div class="grid two" style="margin-top:14px">';
    h += '<section class="card"><h2>Geçen aya göre ' + tip('Bu ayın bugüne kadarki harcaması, geçen ayın aynı günlerine göre. Ay bitmeden yapılan karşılaştırma bu yüzden adildir.') + '</h2><ul class="actions">' +
      ins.slice(0, 3).map(function (x) { return '<li class="lv-' + x.level + '"><span>' + esc(x.text) + '</span></li>'; }).join('') + '</ul><a class="btn small" href="#butce/karsilastirma" style="margin-top:8px">Ayrıntılı karşılaştırma</a></section>';
    h += '<section class="card"><h2>Yıllık giderler kumbarası ' + tip('Sigorta, vergi, bayram, tatil gibi yılda bir gelen giderler için her ay ayrılan para. Vakti gelince para hazır olur.') + '</h2>' +
      (state.sinkingFunds.length ? '<p>Bu ay kenara koyman gereken: <b class="num">' + tl(sk.monthlyNeed) + '</b></p>' + bar(sk.target ? M.ratioBp(sk.saved, sk.target) : 0, 'var(--brand)', 'Kumbara doluluğu') + '<p class="hint">Biriken ' + tl(sk.saved) + ' / gereken ' + tl(sk.target) + '</p>' : '<p class="muted">Henüz yıllık gider eklemedin.</p>') +
      '<a class="btn small" href="#butce/yillik">Yıllık giderler</a>' +
      (acs.missingRates.length ? '<div class="notice warn">Kur girilmemiş: ' + acs.missingRates.map(function (c) { return L.CURRENCIES[c].short; }).join(', ') + '. Bu hesaplar net varlığa sayılmıyor. <a href="#hesaplar">Kur gir</a></div>' : '') + '</section>';
    return h + '</div>';
  }

  /* ---------- BÜTÇE alt bölümleri ---------- */
  function renderBudgetTab() {
    var h = '<h1>Bütçe</h1>' + subtabs('butce', [['', 'Plan'], ['sinirlar', 'Harcama sınırları'], ['karsilastirma', 'Aylık karşılaştırma'], ['yillik', 'Yıllık giderler']]);
    if (sub === 'sinirlar') return h + renderLimits();
    if (sub === 'karsilastirma') return h + renderCompare();
    if (sub === 'yillik') return h + renderSinking();
    return h + renderBudget();
  }
  function renderLimits() {
    var t = today(), ym = nowYm(), list = L.categoryLimits(state, ym, t), act = C.monthActuals(state.transactions, ym), cmp = L.compareMonths(state.transactions, t), avg = {};
    cmp.rows.forEach(function (r) { avg[r.category] = r.avg3; });
    var h = '<p class="hint">Her kategori için aylık harcama sınırı koy. Harcaman sınırın <b>%80</b>\'ine gelince sarı, <b>aşınca</b> kırmızı uyarı görürsün (Özet\'te de). Harcamalar İşlemler\'den (elle veya belgeden) gelir; "Transfer" sayılmaz.</p>';
    h += '<section class="card"><h2>' + esc(ymLabel(ym)) + ' durumu</h2>' + (list.length ? limitBars(list) : '<p class="muted">Henüz sınır yok. Aşağıdaki tablodan ekle veya "Son 3 ay ortalamasını öner"e bas.</p>') + '</section>';
    var cats = P.CATEGORIES.filter(function (c) { return c !== 'Gelir' && c !== 'Transfer'; }), totLim = 0;
    h += '<section class="card" style="margin-top:14px"><h2>Sınırları ayarla ' + tip('Boş bırakırsan o kategoride sınır yoktur. Tutarı TL olarak yaz, ör. 6.000') + '</h2><div class="tablewrap"><table><thead><tr><th>Kategori</th><th class="r">Bu ay harcanan</th><th class="r">Son 3 ay ortalaması ' + tip('Önceki 3 tam ayın aylık ortalaması (bu ay hariç).') + '</th><th class="r">Aylık sınır (TL)</th></tr></thead><tbody>';
    cats.forEach(function (c) {
      var lim = state.limits[c]; if (lim) totLim = M.add(totLim, lim);
      h += '<tr><td>' + esc(c) + '</td><td class="r num">' + tl2(act.byCategory[c] || 0) + '</td><td class="r num">' + (avg[c] ? tl2(avg[c]) : '—') + '</td><td><input class="money" type="text" inputmode="decimal" style="max-width:150px;margin-left:auto;display:block" aria-label="' + esc(c) + ' aylık sınır" data-limit="' + esc(c) + '" placeholder="sınır yok" value="' + (lim ? esc(curVal(lim)) : '') + '"></td></tr>';
    });
    h += '</tbody><tfoot><tr><th>Toplam sınır</th><th></th><th></th><th class="r num">' + tl2(totLim) + '</th></tr></tfoot></table></div>';
    h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="lim-suggest">Son 3 ay ortalamasını öner</button><button class="btn danger" data-act="lim-clear">Tüm sınırları kaldır</button></div>';
    h += '<p class="hint detail-only">Kural: harcanan × 100 ≥ sınır × 80 → uyarı; harcanan &gt; sınır → aşıldı. Karşılaştırma tam sayı kuruşla yapılır, yuvarlama yoktur. Tek "Ay sonu tahmini" = şu ikisinden büyük olanı: (harcanan + bu ay henüz ödenmemiş düzenli ödemeler) ve "bu hızla" = harcanan × ayın gün sayısı ÷ bugünün günü (yalnızca bilgi).</p></section>';
    return h;
  }
  var cmpCat = 'Toplam';
  function barChart(points, label) {
    if (CH) { var pi = -1; points.forEach(function (p, i) { if (p.partial) pi = i; }); return CH.bars('cmp', { h: 240, label: label, cats: points.map(function (p) { return p.label + (p.partial ? '*' : ''); }), series: [{ name: 'Harcama', data: points.map(function (p) { return p.value; }), color: 'brand', partialIndex: pi, labels: true }] }); }
    var w = 640, hh = 230, padL = 10, padB = 34, padT = 26, n = points.length, maxV = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([1]));
    var bw = (w - padL * 2) / n, svg = '<svg viewBox="0 0 ' + w + ' ' + hh + '" role="img" aria-label="' + esc(label) + '">';
    points.forEach(function (p, i) {
      var bh = Math.round((hh - padT - padB) * p.value / maxV), x = padL + i * bw + bw * 0.18, y = hh - padB - bh;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + bh + '" rx="5" fill="' + (p.partial ? 'var(--info-bg)' : 'var(--brand)') + '" stroke="var(--brand)" stroke-width="' + (p.partial ? 2 : 0) + '"' + (p.partial ? ' stroke-dasharray="5 4"' : '') + '></rect>';
      svg += '<text x="' + (x + bw * 0.32).toFixed(1) + '" y="' + (y - 6) + '" text-anchor="middle">' + esc(M.formatShort(p.value)) + '</text>';
      svg += '<text x="' + (x + bw * 0.32).toFixed(1) + '" y="' + (hh - 12) + '" text-anchor="middle">' + esc(p.label) + (p.partial ? '*' : '') + '</text>';
    });
    return '<div class="chart">' + svg + '</svg></div>';
  }
  function spark(vals) {
    var w = 96, h = 26, mx = Math.max.apply(null, vals.concat([1]));
    var pts = vals.map(function (v, i) { return (2 + i * (w - 4) / (vals.length - 1)).toFixed(1) + ',' + (h - 3 - (h - 6) * v / mx).toFixed(1); }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline fill="none" stroke="var(--brand)" stroke-width="2" points="' + pts + '"/></svg>';
  }
  function chg(bp) { if (bp == null) return '<span class="muted">—</span>'; var c = bp > 1000 ? 'neg' : bp < -1000 ? 'pos' : ''; return '<span class="' + c + '">' + (bp > 0 ? '▲ +' : bp < 0 ? '▼ −' : '') + '%' + Math.round(Math.abs(bp) / 100) + '</span>'; }
  function renderCompare() {
    var t = today(), ym = nowYm(), cmp = L.compareMonths(state.transactions, t), series = L.monthSeries(state.transactions, ym, 6), ins = L.insights(cmp, tl);
    var h = '<section class="card"><h2>Kısaca ' + tip('Ay henüz bitmediği için bu ayı geçen ayın AYNI GÜNLERİYLE karşılaştırıyoruz (ör. 1–13 Kasım ile 1–13 Ekim). Böylece yanıltıcı olmaz.') + '</h2><ul class="actions">' +
      ins.map(function (x) { return '<li class="lv-' + x.level + '"><span>' + esc(x.text) + '</span></li>'; }).join('') + '</ul></section>';
    var cats = ['Toplam'].concat(cmp.rows.map(function (r) { return r.category; }));
    if (cats.indexOf(cmpCat) < 0) cmpCat = 'Toplam';
    h += '<section class="card" style="margin-top:14px"><h2>Son 6 ay: ' + esc(cmpCat) + '</h2><div class="chips" role="group" aria-label="Kategori seç">' + cats.map(function (c) { return '<button class="chip" data-act="cmp-cat" data-cat="' + esc(c) + '" aria-pressed="' + (c === cmpCat) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    h += barChart(series.map(function (s) { return { label: shortYm(s.ym), value: cmpCat === 'Toplam' ? s.expense : (s.byCategory[cmpCat] || 0), partial: s.ym === ym }; }), cmpCat + ' aylık harcama grafiği');
    h += '<p class="hint">* Bu ay henüz bitmedi (kesikli çubuk, ' + cmp.day + '/' + cmp.daysInMonth + ' gün).</p></section>';
    h += '<section class="card" style="margin-top:14px"><h2>Kategorilere göre</h2>';
    if (!cmp.rows.length) h += '<p class="muted">Karşılaştırılacak harcama yok.</p>';
    else {
      h += '<div class="tablewrap"><table><thead><tr><th>Kategori</th><th>Son 6 ay</th><th class="r">Bu ay (' + cmp.day + ' gün)</th><th class="r">Geçen ay aynı dönem</th><th class="r">Değişim</th><th class="r detail-only">Geçen ay (tam)</th><th class="r detail-only">3 ay ortalaması</th><th class="r detail-only">Ortalamaya göre</th></tr></thead><tbody>';
      cmp.rows.forEach(function (r) {
        h += '<tr><td>' + esc(r.category) + '</td><td>' + spark(series.map(function (s) { return s.byCategory[r.category] || 0; })) + '</td><td class="r num">' + tl2(r.current) + '</td><td class="r num">' + tl2(r.prevSamePeriod) + '</td><td class="r num">' + chg(r.diffSameBp) + '</td>' +
          '<td class="r num detail-only">' + tl2(r.prevFull) + '</td><td class="r num detail-only">' + tl2(r.avg3) + '</td><td class="r num detail-only">' + chg(r.vsAvgBp) + '</td></tr>';
      });
      var T = cmp.total;
      h += '</tbody><tfoot><tr><th>Toplam</th><th>' + spark(series.map(function (s) { return s.expense; })) + '</th><th class="r num">' + tl2(T.current) + '</th><th class="r num">' + tl2(T.prevSamePeriod) + '</th><th class="r num">' + chg(T.diffSameBp) + '</th><th class="r num detail-only">' + tl2(T.prevFull) + '</th><th class="r num detail-only">' + tl2(T.avg3) + '</th><th class="detail-only"></th></tr></tfoot></table></div>';
    }
    h += '<p class="hint detail-only">Değişim % = (bu ay − geçen ayın aynı dönemi) ÷ geçen ayın aynı dönemi. 3 ay ortalaması = önceki 3 tam ayın toplamı ÷ 3 (kuruşa yuvarlanır). Transfer kategorisi ve hesaplar arası transferler sayılmaz.</p></section>';
    return h;
  }
  function renderSinking() {
    var ym = nowYm(), tot = L.sinkingTotals(state, ym);
    var h = '<p class="hint">Yılda bir veya birkaç ayda bir gelen büyük giderler (sigorta, vergi, bayram, tatil) için her ay biraz kenara koy; vakti gelince para hazır olur. Bu ay ayrılması gereken toplam, <a href="#butce">bütçe planına</a> otomatik sabit gider olarak eklenir.</p>';
    h += '<div class="grid kpis">' + kpi('Bu ay kenara koy', tl(tot.monthlyNeed), 'Tüm yıllık giderler için', 'Her kalem için: kalan tutar ÷ ödeme ayına kadar kalan ay. Kuruşu kuruşuna bölünür.') +
      kpi('Biriken', tl(tot.saved) + ' <span class="muted" style="font-size:1rem">/ ' + tl(tot.target) + '</span>', bar(tot.target ? M.ratioBp(tot.saved, tot.target) : 0, 'var(--brand)', 'Toplam doluluk'), 'Kumbaralarda şu ana kadar biriktirdiğin toplam.') + '</div>';
    h += '<div class="grid two" style="margin-top:14px">';
    if (!state.sinkingFunds.length) h += '<div class="card"><p class="muted">Henüz yıllık gider yok. Aşağıdan ekle.</p></div>';
    state.sinkingFunds.forEach(function (f) {
      var p = L.sinkingPlan(f, ym);
      h += '<section class="card"><h2>' + esc(f.name) + '</h2>' + bar(p.progressBp, p.ready ? 'var(--safe)' : 'var(--brand)', f.name + ' doluluk') +
        '<p><b class="num">' + tl(f.saved) + '</b> / ' + tl(f.amount) + ' · ' + pct(p.progressBp) + '</p>' +
        '<p class="hint">Ödeme: <b>' + esc(ymLabel(f.dueYm)) + '</b> (' + (p.overdue ? '<span class="neg">tarihi geçti</span>' : p.monthsLeft === 0 ? 'bu ay' : p.monthsLeft + ' ay sonra') + ') · ' + (f.everyMonths === 12 ? 'her yıl' : f.everyMonths + ' ayda bir') + '</p>';
      if (p.ready) h += '<div class="notice">Para hazır ✓ Ödemeyi yapınca "Ödendi" de; kumbara bir sonraki döneme geçer.</div>';
      else if (p.doneThisMonth) h += '<div class="notice">Bu ay ' + tl(f.setAsideAmount) + ' ayrıldı ✓' + (p.contributions > 1 ? ' Sonraki aylarda: ' + tl(p.parts[p.parts.length - 1]) + '/ay' : '') + '</div>';
      else h += '<p>Bu ay ayır: <b class="num">' + tl2(p.toSetAsideNow) + '</b>' + (p.contributions > 1 ? ' <span class="hint">(sonraki aylarda ' + tl2(p.parts[p.parts.length - 1]) + ')</span>' : '') + '</p>';
      h += '<p class="hint detail-only">Formül: ay başındaki kalan ' + tl2(M.sum(p.parts)) + ' ÷ ' + p.contributions + ' ay = ' + p.parts.slice(0, 2).map(tl2).join(', ') + (p.parts.length > 2 ? '…' : '') + ' (artan kuruşlar ilk aylara). Uzun vadeli aylık ortalama: ' + tl2(p.steadyMonthly) + '</p>';
      h += '<div class="row">' + (!p.ready && !p.doneThisMonth && p.toSetAsideNow > 0 ? '<button class="btn small primary" data-act="sf-setaside" data-id="' + esc(f.id) + '">Ayırdım (' + tl(p.toSetAsideNow) + ')</button>' : '') +
        '<button class="btn small" data-act="sf-paid" data-id="' + esc(f.id) + '">Ödendi, sonraki döneme geç</button></div></section>';
    });
    h += '</div><section class="card" style="margin-top:14px"><h2>Yıllık giderleri düzenle</h2><div class="tablewrap"><table><thead><tr><th>Ad</th><th class="r">Tutar (TL)</th><th class="r">Biriken (TL)</th><th>Ödeme ayı</th><th>Tekrar ' + tip('Kaç ayda bir tekrar eder? Yıllık: 12, 6 ayda bir: 6.') + '</th><th class="detail-only">Kategori</th><th></th></tr></thead><tbody>';
    state.sinkingFunds.forEach(function (f) {
      h += '<tr><td>' + textInput('sinkingFunds', f.id, 'name', f.name, 'Ad') + '</td><td>' + moneyInput('sinkingFunds', f.id, 'amount', f.amount, f.name + ' tutarı') + '</td><td>' + moneyInput('sinkingFunds', f.id, 'saved', f.saved, f.name + ' biriken') + '</td><td>' + ymIn('sinkingFunds', f.id, 'dueYm', f.dueYm, 'Ödeme ayı') + '</td><td><div class="row" style="flex-wrap:nowrap;gap:4px">' + numIn('sinkingFunds', f.id, 'everyMonths', f.everyMonths, 'Kaç ayda bir', 1, 120) + ' ay</div></td><td class="detail-only">' + sel('sinkingFunds', f.id, 'category', catOpts(f.category), f.category, 'Kategori') + '</td><td>' + delBtn('sinkingFunds', f.id, f.name) + '</td></tr>';
    });
    h += '</tbody></table></div><button class="btn" data-act="add" data-list="sinkingFunds">+ Yıllık gider ekle</button>' +
      '<p class="hint">Örnekler: kasko/sigorta, emlak vergisi, MTV, bayram harcamaları, kurban, okul masrafları, tatil, yıllık abonelikler. Kumbara parasını katılım hesabında tutabilirsin.</p></section>';
    return h;
  }

  /* ---------- ÖDEMELER ---------- */
  function renderPayments() {
    var h = '<h1>Ödemeler</h1>' + subtabs('odemeler', [['', 'Yaklaşanlar'], ['duzenli', 'Düzenli ödemeler'], ['kartlar', 'Kartlar ve taksitler']]);
    if (sub === 'duzenli') return h + renderRecurring();
    if (sub === 'kartlar') return h + renderCards();
    return h + renderUpcoming();
  }
  var STATUS_TXT = { paid: 'Ödendi ✓', matched: 'Eşleşen işlem bulundu', skipped: 'Bu ay atlandı', overdue: 'Gecikti', today: 'Bugün', soon: 'Yaklaşıyor', later: 'Bekliyor' };
  var payYm = null;
  function renderUpcoming() {
    var t = today(), up = L.upcoming(state, t, 30);
    if (!payYm) payYm = nowYm();
    var h = '<section class="card"><h2>Önümüzdeki 30 gün ' + tip('Düzenli ödemeler, kredi kartı son ödeme günleri ve yıllık giderler. "Ödendi"ye basınca işlemlere kaydedilir ve listeden düşer.') + '</h2>' + upcomingList(up) + notifBox() + '</section>';
    var occ = L.occurrencesForMonth(state, payYm, t), plan = L.generationPlan(state, payYm, t);
    h += '<section class="card" style="margin-top:14px"><div class="row" style="justify-content:space-between"><h2 style="margin:0">' + esc(ymLabel(payYm)) + ' düzenli ödemeleri</h2><div class="row"><button class="btn small" data-act="pay-month" data-d="-1" aria-label="Önceki ay">‹ Önceki</button><button class="btn small" data-act="pay-month" data-d="1" aria-label="Sonraki ay">Sonraki ›</button></div></div>';
    if (!occ.length) h += '<p class="muted">Bu ay için düzenli ödeme yok. <a href="#odemeler/duzenli">Düzenli ödeme ekle</a></p>';
    else {
      h += '<div class="tablewrap"><table><thead><tr><th>Tarih</th><th>Ad</th><th class="r">Tutar</th><th>Durum</th><th></th></tr></thead><tbody>';
      occ.forEach(function (o) {
        var st = o.status, b = '', idp = ' data-id="' + esc(o.item.id) + '" data-period="' + o.period + '"';
        if (st === 'paid') b = '<button class="btn small" data-act="rc-unlink" data-tx="' + esc(o.tx.id) + '">Geri al</button>';
        else if (st === 'matched') b = '<button class="btn small primary" data-act="rc-link"' + idp + ' data-tx="' + esc(o.match.id) + '">Bu işlemle eşleştir</button><button class="btn small" data-act="rc-skip"' + idp + '>Atla</button>';
        else if (st === 'skipped') b = '<button class="btn small" data-act="rc-unskip"' + idp + '>Geri al</button>';
        else b = '<button class="btn small primary" data-act="rc-pay"' + idp + '>' + (o.amount > 0 ? 'Geldi' : 'Ödendi') + '</button><button class="btn small" data-act="rc-skip"' + idp + '>Atla</button>';
        h += '<tr><td class="num">' + dateLabel(o.date) + '</td><td>' + esc(o.item.name) + (st === 'matched' ? '<div class="hint">İşlem: ' + esc(o.match.description) + ' · ' + dateLabel(o.match.date) + ' · ' + tl2(o.match.amount) + '</div>' : '') + (o.tx && o.tx.amount !== o.amount ? '<div class="hint">Gerçekleşen: ' + tl2(o.tx.amount) + '</div>' : '') +
          '</td><td class="r num ' + (o.amount < 0 ? 'neg' : 'pos') + '">' + tl2(o.amount) + '</td><td><span class="pill ' + lvClass(st) + '">' + STATUS_TXT[st] + '</span>' + (st !== 'paid' && st !== 'skipped' && st !== 'matched' ? ' <span class="hint">' + daysText(o.daysLeft) + '</span>' : '') + '</td><td><div class="row" style="gap:6px;flex-wrap:nowrap">' + b + '</div></td></tr>';
      });
      h += '</tbody></table></div>';
      var n = plan.create.length + plan.link.length;
      h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="rc-gen"' + (n ? '' : ' disabled') + '>Bu ayın beklenen kayıtlarını oluştur (' + n + ')</button><span class="hint">' + plan.link.length + ' tanesi mevcut işlemle eşleştirilir, ' + plan.create.length + ' yeni kayıt eklenir. Onay sorulur, çift kayıt oluşmaz; sonradan ekstreyi aktarırsan gerçek işlem beklenen kaydın yerine geçer.</span></div>';
    }
    return h + '</section>';
  }
  function notifBox() {
    if (!('Notification' in window)) return '';
    if (Notification.permission === 'granted') return '<p class="hint">🔔 Tarayıcı hatırlatmaları açık: uygulamayı açtığında yaklaşan ödemeler günde bir kez bildirilir.</p>';
    if (Notification.permission === 'denied') return '<p class="hint">Tarayıcı bildirimleri kapalı (tarayıcı ayarlarından açılabilir). Rozetler ve bu liste yine çalışır.</p>';
    return '<div class="row" style="margin-top:8px"><button class="btn small" data-act="notif-on">🔔 Tarayıcı hatırlatmalarını aç</button><span class="hint">Uygulamayı açtığında yaklaşan ödemeleri bildirir. Site kapalıyken çalışmaz.</span></div>';
  }
  function maybeNotify() {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted' || !state) return;
      var key = 'finans-pusulasi:bildirim', t = today();
      if (localStorage.getItem(key) === t) return;
      var up = L.upcoming(state, t, 3).filter(function (x) { return x.level === 'overdue' || x.level === 'today' || x.level === 'soon'; });
      if (!up.length) return;
      new Notification('Finans Pusulası: ' + up.length + ' ödeme yaklaştı', { body: up.slice(0, 4).map(function (x) { return x.title + ' · ' + daysText(x.daysLeft) + ' · ' + tl(Math.abs(x.amount)); }).join('\n') });
      localStorage.setItem(key, t);
    } catch (e) { /* bildirim desteklenmiyor */ }
  }
  function renderRecurring() {
    var h = '<p class="hint">Kira, faturalar, abonelikler, maaş gibi düzenli tekrarlanan kalemleri bir kez tanımla; her ay beklenen kayıt olarak çıkar, yaklaşınca hatırlatılır. Fatura gibi tutarı değişenlerde yaklaşık tutar yaz; %10 farka ve ±7 güne kadar gerçek işlemle eşleşir.</p>';
    h += '<section class="card"><div class="tablewrap"><table class="rc stack"><thead><tr><th>Ad</th><th>Tür</th><th class="r">Tutar (TL)</th><th>Kategori</th><th>Sıklık ' + tip('Her ay, her yıl veya her N ayda bir (ör. 2 ayda bir su faturası, 3 ayda bir aidat).') + '</th><th>Gün ' + tip('Ayın kaçında? 31 yazarsan kısa aylarda ayın son günü kabul edilir.') + '</th><th>Başlangıç</th><th class="detail-only">Bitiş</th><th class="detail-only">Hesap</th><th class="detail-only">Kaç gün önce hatırlat</th><th>Aktif</th><th></th></tr></thead><tbody>';
    state.recurring.forEach(function (r) {
      h += '<tr><td>' + textInput('recurring', r.id, 'name', r.name, 'Ad') + '</td><td>' + sel('recurring', r.id, 'direction', [['expense', 'Gider'], ['income', 'Gelir']], r.direction, 'Tür') + '</td><td>' + moneyInput('recurring', r.id, 'amount', r.amount, r.name + ' tutarı') + '</td>' +
        '<td>' + sel('recurring', r.id, 'category', catOpts(r.category), r.category, 'Kategori') + '</td><td><div class="row" style="flex-wrap:nowrap;gap:4px">' + sel('recurring', r.id, 'freq', [['monthly', 'Her ay'], ['yearly', 'Her yıl'], ['custom', 'Her N ayda']], r.freq, 'Sıklık') +
        (r.freq === 'custom' ? numIn('recurring', r.id, 'everyMonths', r.everyMonths, 'Kaç ayda bir', 1, 120) : '') + '</div></td><td>' + numIn('recurring', r.id, 'day', r.day, 'Gün', 1, 31) + '</td><td>' + ymIn('recurring', r.id, 'startYm', r.startYm, 'Başlangıç ayı') + '</td>' +
        '<td class="detail-only">' + ymIn('recurring', r.id, 'endYm', r.endYm, 'Bitiş ayı (boş: süresiz)') + '</td><td class="detail-only"><select aria-label="Hesap" data-list="recurring" data-id="' + esc(r.id) + '" data-field="accountId">' + accOptions(r.accountId, null, '— seçilmedi —') + '</select></td>' +
        '<td class="detail-only">' + numIn('recurring', r.id, 'remindDays', r.remindDays == null ? 3 : r.remindDays, 'Hatırlatma günü', 0, 31) + '</td><td style="text-align:center">' + chk('recurring', r.id, 'active', r.active !== false, 'Aktif') + '</td><td>' + delBtn('recurring', r.id, r.name) + '</td></tr>';
    });
    if (!state.recurring.length) h += '<tr><td colspan="12" class="muted">Henüz düzenli ödeme yok.</td></tr>';
    h += '</tbody></table></div><button class="btn" data-act="add" data-list="recurring">+ Düzenli ödeme / abonelik ekle</button></section>';
    var mo = 0, yr = 0;
    state.recurring.forEach(function (r) { if (r.active === false || r.direction !== 'expense') return; var ev = r.freq === 'monthly' ? 1 : r.freq === 'yearly' ? 12 : r.everyMonths; if (ev === 1) mo = M.add(mo, r.amount); yr = M.add(yr, M.mulRatio(r.amount, 12, ev)); });
    h += '<section class="card" style="margin-top:14px"><h2>Özet</h2><p>Her ay tekrarlayan giderlerin: <b class="num">' + tl2(mo) + '</b> · Yıllık toplam düzenli gider: <b class="num">' + tl2(yr) + '</b></p><p class="hint">Yıllık toplam = her kalemin tutarı × (12 ÷ kaç ayda bir). Bütçe planındaki giderlerinle karşılaştırarak eksik kalem var mı kontrol et.</p></section>';
    return h;
  }
  function renderCards() {
    var t = today(), ym = nowYm(), cs = cards(), h = '';
    if (!cs.length) return '<div class="card"><p>Henüz kredi kartı eklemedin. Kart ekleyince kesim ve son ödeme tarihlerini, taksitleri ve limitini takip edebilirsin.</p><button class="btn primary" data-act="add" data-list="accounts" data-type="card">+ Kredi kartı ekle</button></div>';
    cs.forEach(function (a) {
      var s = L.cardStatus(state, a, t), c = a.card;
      h += '<section class="card" style="margin-bottom:14px"><h2>💳 ' + esc(a.name) + '</h2><div class="grid kpis">';
      h += '<div><div class="hint">Son ekstreden kalan borç ' + tip('Son ekstrenin (dönem borcunun) henüz ödenmemiş kısmı. Son ödeme gününe kadar ödenmeli; gecikirse faiz/ceza işler.') + '</div><div class="kpi"><div class="value num">' + tl2(s.remaining) + '</div></div>' +
        (s.statement ? '<span class="pill ' + lvClass(s.level) + '">' + (s.level === 'ok' ? 'Ödendi ✓' : 'Son ödeme ' + dateLabel(s.statement.due) + ' · ' + daysText(s.daysLeft)) + '</span>' : '<span class="hint">Ekstre bilgisi girilmedi</span>') + '</div>';
      h += '<div><div class="hint">Limit kullanımı ' + tip('Kullanılan = güncel borç + henüz ekstreye gelmemiş taksitler. Bankalar limiti böyle düşer.') + '</div><div class="kpi"><div class="value num">' + tl(s.used) + ' <span class="muted" style="font-size:1rem">/ ' + tl(s.limit) + '</span></div></div>' + bar(s.usageBp, s.usageBp > 8000 ? 'var(--danger)' : 'var(--brand)', 'Limit kullanımı') + '<span class="hint">Kullanılabilir: ' + tl(s.available) + '</span></div>';
      h += '<div><div class="hint">Gelecek taksitler ' + tip('Bu aydan sonraki aylarda ekstreye gelecek taksitlerin toplamı. Net varlıktan borç olarak düşülür.') + '</div><div class="kpi"><div class="value num">' + tl(s.futureInstallments) + '</div></div><span class="hint">Sonraki kesim: ' + dateLabel(s.nextStatement) + '</span></div></div>';
      if (s.remaining > 0) h += '<form class="row card-pay" data-cardpay="' + esc(a.id) + '" style="margin-top:12px" novalidate><label for="cp-from-' + esc(a.id) + '" class="hint">Ödeme yap:</label><select id="cp-from-' + esc(a.id) + '" style="max-width:240px">' + accOptions(null, function (x) { return x.type !== 'card' && x.currency === 'TRY'; }) + '</select><input id="cp-amt-' + esc(a.id) + '" class="money" type="text" inputmode="decimal" style="max-width:140px" aria-label="Ödeme tutarı" value="' + esc(curVal(s.remaining)) + '"><button class="btn primary small" type="submit">Öde (transfer)</button><span class="hint">Seçtiğin hesaptan karta transfer olarak kaydedilir; gelir/gider sayılmaz.</span></form>';
      h += '<details style="margin-top:12px"' + (c.statementYm ? '' : ' open') + '><summary><b>Kart ayarları ve son ekstre</b></summary><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-top:10px">' +
        '<div class="field"><label>Kesim günü ' + tip('Ekstrenin kesildiği gün (ayın kaçı).') + '</label>' + numIn('accounts', a.id, 'card.statementDay', c.statementDay, 'Kesim günü', 1, 31) + '</div>' +
        '<div class="field"><label>Son ödeme günü</label>' + numIn('accounts', a.id, 'card.dueDay', c.dueDay, 'Son ödeme günü', 1, 31) + '</div>' +
        '<div class="field"><label>Kart limiti (TL)</label>' + moneyInput('accounts', a.id, 'card.limit', c.limit, 'Kart limiti') + '</div>' +
        '<div class="field"><label>Son ekstre ayı</label>' + ymIn('accounts', a.id, 'card.statementYm', c.statementYm, 'Son ekstre ayı') + '</div>' +
        '<div class="field"><label>Ekstre borcu (TL)</label>' + moneyInput('accounts', a.id, 'card.statementDebt', c.statementDebt, 'Ekstre borcu') + '</div>' +
        '<div class="field"><label>Bu ekstreye ödenen (TL)</label>' + moneyInput('accounts', a.id, 'card.paid', c.paid, 'Ödenen') + '</div>' +
        '<div class="field"><label>Güncel borç (TL) ' + tip('Bankanın gösterdiği güncel borç; henüz ekstreye gelmemiş gelecek taksitler HARİÇ.') + '</label>' + moneyInput('accounts', a.id, 'debt', Math.max(0, -a.balance), 'Güncel borç') + '</div>' +
        '<div class="field"><label>Kaç gün önce hatırlat</label>' + numIn('accounts', a.id, 'card.remindDays', c.remindDays == null ? 3 : c.remindDays, 'Hatırlatma', 0, 31) + '</div></div>' +
        '<p class="hint">Yeni ekstre geldiğinde ayı ve borcu güncelle (ödenen otomatik sıfırlanır). Ekstre PDF\'ini <a href="#veri">Veri ekle</a>\'den aktarırken bu kartı seçersen harcamalar, taksitler ve ekstre borcu otomatik işlenir.</p></details></section>';
    });
    var burden = L.installmentBurden(state, ym, 12);
    h += '<section class="card"><h2>Taksitli alışverişler ' + tip('Toplam tutar taksit sayısına kuruşu kuruşuna bölünür; artan kuruşlar ilk taksitlere eklenir.') + '</h2><div class="tablewrap"><table class="stack"><thead><tr><th>Ne aldın?</th><th>Kart</th><th class="r">Toplam (TL)</th><th>Taksit</th><th>İlk taksit ayı</th><th class="r">Bu ay</th><th class="r">Kalan</th><th>Bitiş</th><th class="detail-only">Kategori</th><th></th></tr></thead><tbody>';
    state.installments.forEach(function (p) {
      var s = L.installmentStatus(p, ym);
      h += '<tr><td>' + textInput('installments', p.id, 'description', p.description, 'Açıklama') + '</td><td><select aria-label="Kart" data-list="installments" data-id="' + esc(p.id) + '" data-field="cardId">' + accOptions(p.cardId, function (x) { return x.type === 'card'; }) + '</select></td>' +
        '<td>' + moneyInput('installments', p.id, 'total', p.total, 'Toplam') + '</td><td>' + numIn('installments', p.id, 'count', p.count, 'Taksit sayısı', 1, 60) + '</td><td>' + ymIn('installments', p.id, 'firstYm', p.firstYm, 'İlk taksit ayı') + '</td>' +
        '<td class="r num">' + (s.thisMonth ? tl2(s.thisMonth) + '<div class="hint">' + (s.paidCount + 1) + '/' + p.count + '. taksit</div>' : s.notStarted ? '<span class="hint">başlamadı</span>' : '—') + '</td><td class="r num">' + (s.done ? '<span class="pill ok">Bitti ✓</span>' : s.remainingCount + ' taksit · ' + tl2(s.remaining)) + '</td><td class="num">' + esc(shortYm(s.lastYm)) + '</td>' +
        '<td class="detail-only">' + sel('installments', p.id, 'category', catOpts(p.category), p.category, 'Kategori') + '</td><td>' + delBtn('installments', p.id, p.description) + '</td></tr>';
    });
    if (!state.installments.length) h += '<tr><td colspan="10" class="muted">Taksitli alışveriş yok.</td></tr>';
    h += '</tbody></table></div><button class="btn" data-act="add" data-list="installments">+ Taksitli alışveriş ekle</button>';
    var maxB = Math.max.apply(null, burden.map(function (b) { return b.total; }).concat([1]));
    h += '<h3>Önümüzdeki 12 ayın taksit yükü</h3><div class="burden">' + burden.map(function (b) { return '<div class="alloc-row"><span>' + esc(shortYm(b.ym)) + '</span><div class="bar"><span style="width:' + (b.total * 100 / maxB) + '%;background:var(--medium)"></span></div><span class="num r">' + tl(b.total) + '</span></div>'; }).join('') + '</div>';
    h += '<p class="hint">Bu ayın taksitleri (' + tl2(burden[0].total) + ') bütçe planına otomatik sabit gider olarak eklenir; ileriki aylarınkiler net varlıktan borç olarak düşülür.</p></section>';
    return h;
  }

  /* ---------- HESAPLAR ve KURLAR ---------- */
  function renderAccounts() {
    var t = today(), s = L.accountsSummary(state, t), h = '<h1>Hesaplar ve kurlar</h1><p class="hint">Banka, katılım, nakit, altın ve kredi kartı hesaplarını ayrı ayrı tut. Döviz ve altın, girdiğin kurla TL\'ye çevrilir. Hesaplar arası para aktarımı (transfer) gelir veya gider sayılmaz.</p>';
    h += '<div class="grid kpis">' + kpi('Hesaplardaki para (TL)', tl(s.assetsTL), 'Tüm hesaplar TL karşılığıyla', 'Kredi kartı dışındaki hesapların bakiyesi, kurla TL\'ye çevrilmiş toplamı.') +
      kpi('Kart borçları', '<span class="neg">' + tl(M.add(s.cardDebt, s.futureInstallments)) + '</span>', 'Güncel ' + tl(s.cardDebt) + ' + gelecek taksit ' + tl(s.futureInstallments), 'Kredi kartlarının güncel borcu ve henüz ekstreye gelmemiş taksitler.') +
      kpi('Hesaplara göre net', tl(s.netTL), 'Özet\'teki net varlığa eklenir', 'Hesaplardaki para eksi kart borçları. Varlıklar bölümündeki fon/hisse gibi yatırımlar bu rakama dahil değildir; Özet\'teki net varlıkta hepsi birlikte hesaplanır.') + '</div>';
    if (s.missingRates.length) h += '<div class="notice warn" style="margin-top:12px">' + s.missingRates.map(function (c) { return L.CURRENCIES[c].label; }).join(', ') + ' için kur girilmemiş. Bu hesaplar toplamlara sayılmıyor; aşağıdan kur gir.</div>';
    h += '<section class="card" style="margin-top:14px"><h2>Hesaplarım</h2><div class="tablewrap"><table class="stack"><thead><tr><th>Ad</th><th>Tür</th><th>Para birimi</th><th class="r">Bakiye ' + tip('Hesabın kendi para biriminde bugünkü bakiyesi (altında gram). Kredi kartında güncel borcu yaz.') + '</th><th class="r">TL karşılığı</th><th>Acil fon ' + tip('İşaretli hesaplar acil durum fonuna sayılır (kolay çekilebilen TL hesaplar önerilir).') + '</th><th class="detail-only">Risk</th><th class="detail-only">Net varlığa say</th><th></th></tr></thead><tbody>';
    var types = Object.keys(L.ACCOUNT_TYPES).map(function (k) { return [k, L.ACCOUNT_TYPES[k].label]; }), curs = Object.keys(L.CURRENCIES).filter(function (k) { return k !== 'XAU'; }).map(function (k) { return [k, L.CURRENCIES[k].label]; });
    s.rows.forEach(function (r) {
      var a = r.acc, isCard = a.type === 'card', fixedCur = isCard || a.type === 'gold';
      h += '<tr><td>' + textInput('accounts', a.id, 'name', a.name, 'Hesap adı') + '</td><td>' + sel('accounts', a.id, 'type', types, a.type, 'Hesap türü') + '</td><td>' + (fixedCur ? esc(L.CURRENCIES[a.currency].label) : sel('accounts', a.id, 'currency', curs, a.currency, 'Para birimi')) + '</td>' +
        '<td>' + (isCard ? '<div class="row" style="flex-wrap:nowrap;gap:4px"><span class="hint">Borç</span>' + moneyInput('accounts', a.id, 'debt', Math.max(0, -a.balance), a.name + ' borcu') + '</div>' : moneyInput('accounts', a.id, 'balance', a.balance, a.name + ' bakiyesi')) + '</td>' +
        '<td class="r num ' + (r.tl != null && r.tl < 0 ? 'neg' : '') + '">' + (r.tl == null ? '<span class="pill warn">Kur yok</span>' : tl2(r.tl)) + '</td><td style="text-align:center">' + (isCard ? '—' : chk('accounts', a.id, 'emergency', a.emergency, 'Acil fona say')) + '</td>' +
        '<td class="detail-only">' + (isCard ? '—' : sel('accounts', a.id, 'risk', [['safe', 'Güvenli'], ['medium', 'Orta'], ['risky', 'Riskli']], a.risk || L.ACCOUNT_TYPES[a.type].risk, 'Risk')) + '</td><td class="detail-only" style="text-align:center">' + (isCard ? '—' : chk('accounts', a.id, 'inNetWorth', a.inNetWorth !== false, 'Net varlığa say')) + '</td><td>' + delBtn('accounts', a.id, a.name) + '</td></tr>';
    });
    if (!s.rows.length) h += '<tr><td colspan="9" class="muted">Henüz hesap yok.</td></tr>';
    h += '</tbody><tfoot><tr><th colspan="4">Toplam (kartlar hariç)</th><th class="r num">' + tl2(s.assetsTL) + '</th><th colspan="4"></th></tr></tfoot></table></div><div class="row"><button class="btn" data-act="add" data-list="accounts">+ Hesap ekle</button><button class="btn" data-act="add" data-list="accounts" data-type="card">+ Kredi kartı ekle</button><button class="btn" data-act="add" data-list="accounts" data-type="gold">+ Altın hesabı ekle</button></div>';
    var byc = Object.keys(s.byCurrency).filter(function (c) { return c !== 'TRY'; });
    if (byc.length) h += '<p class="hint">Döviz/altın varlığın: ' + byc.map(function (c) { return L.formatCur(s.byCurrency[c], c); }).join(' · ') + '</p>';
    h += '<p class="hint">Bakiyeleri ara ara bankandaki rakamla güncelle. Harcama işlemleri bakiyeyi kendiliğinden değiştirmez; transferler ise iki hesabı da otomatik günceller. Faizli vadeli mevduat yerine katılım hesabı, altın hesabı gibi helal seçenekleri tercih et.</p></section>';
    var accs = state.accounts;
    h += '<section class="card" style="margin-top:14px"><h2>Hesaplar arası transfer ' + tip('Kendi hesapların arasında para aktarımı, kart borcu ödemesi, döviz/altın alımı. Gelir veya gider sayılmaz; iki hesabın bakiyesi otomatik güncellenir.') + '</h2>';
    if (accs.length < 2) h += '<p class="muted">Transfer için en az iki hesap gerekir.</p>';
    else {
      h += '<form id="tr-form" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:end" novalidate>' +
        '<div class="field"><label for="tr-date">Tarih</label><input id="tr-date" type="date" value="' + t + '"></div>' +
        '<div class="field"><label for="tr-from">Nereden</label><select id="tr-from">' + accOptions(accs[0].id) + '</select></div>' +
        '<div class="field"><label for="tr-to">Nereye</label><select id="tr-to">' + accOptions(accs[1].id) + '</select></div>' +
        '<div class="field"><label for="tr-amt" id="tr-amt-l">Giden tutar</label><input id="tr-amt" class="money" type="text" inputmode="decimal" placeholder="0,00"></div>' +
        '<div class="field" id="tr-amt2-f"><label for="tr-amt2" id="tr-amt2-l">Gelen tutar</label><input id="tr-amt2" class="money" type="text" inputmode="decimal" placeholder="farklı para biriminde"></div>' +
        '<div class="field"><label for="tr-note">Not</label><input id="tr-note" type="text" maxlength="120" placeholder="ör. kart ödemesi"></div>' +
        '<div class="field"><button class="btn primary" type="submit">Transferi kaydet</button></div></form><p class="hint" id="tr-hint"></p>';
    }
    if (state.transfers.length) {
      h += '<div class="tablewrap"><table class="stack"><thead><tr><th>Tarih</th><th>Nereden → Nereye</th><th class="r">Tutar</th><th>Not</th><th></th></tr></thead><tbody>';
      state.transfers.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : b[1] - a[1]; }).map(function (p) { return p[0]; }).slice(0, 100).forEach(function (x) {
        var f = accById(x.fromId), to = accById(x.toId);
        h += '<tr><td class="num">' + dateLabel(x.date) + '</td><td>' + esc(f ? f.name : '?') + ' → ' + esc(to ? to.name : '?') + '</td><td class="r num">' + esc(L.formatCur(x.amountFrom, f ? f.currency : 'TRY')) + (f && to && f.currency !== to.currency ? ' → ' + esc(L.formatCur(x.amountTo, to.currency)) : '') + '</td><td>' + esc(x.note || '') + '</td><td><button class="btn small danger" data-act="tr-del" data-id="' + esc(x.id) + '">Sil (geri al)</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</section>';
    h += '<section class="card" style="margin-top:14px"><h2>Kurlar ' + tip('Uygulama internetten canlı fiyat ÇEKMEZ. Bankanın veya kuyumcunun ALIŞ kurunu kendin yaz; tarihi otomatik bugüne ayarlanır.') + '</h2><div class="tablewrap"><table><thead><tr><th>Para birimi</th><th class="r">1 birim = ? TL</th><th>Kur tarihi</th><th></th></tr></thead><tbody>';
    ['USD', 'EUR', 'XAU'].forEach(function (c) {
      var r = state.rates[c], age = L.rateAgeDays(state.rates, c, t);
      h += '<tr><td>' + esc(L.CURRENCIES[c].label) + '</td><td><input class="money" type="text" inputmode="decimal" style="max-width:140px;margin-left:auto;display:block" aria-label="' + esc(L.CURRENCIES[c].label) + ' kuru" data-rate="' + c + '" placeholder="girilmedi" value="' + (r ? esc(curVal(r.rate)) : '') + '"></td>' +
        '<td><input type="date" aria-label="' + esc(L.CURRENCIES[c].label) + ' kur tarihi" data-ratedate="' + c + '" value="' + (r ? esc(r.date) : '') + '"' + (r ? '' : ' disabled') + '></td><td>' + (!r ? '<span class="pill warn">Kur yok</span>' : age > 7 ? '<span class="pill warn">' + age + ' gün önce — güncelle</span>' : age < 0 ? '<span class="pill warn">Tarih gelecekte</span>' : '<span class="pill ok">' + (age === 0 ? 'Bugün' : age + ' gün önce') + '</span>') + '</td></tr>';
    });
    h += '</tbody></table></div><p class="hint">Net varlık ve acil fon hesaplarında bu kurlar kullanılır. ' + (state.isExample ? '<b>Örnek veride kurlar uydurmadır, gerçek değildir.</b> ' : '') + 'Kur 7 günden eskiyse uyarı görürsün.</p>' +
      '<p class="hint detail-only">Hesap: TL karşılığı = tutar (0,01 birim) × kur (kuruş) ÷ 100, kuruşa yuvarlanır (yarım kuruş yukarı). Altın 0,01 gram hassasiyetle tutulur.</p></section>';
    return h;
  }
  function trHint() {
    var f = accById(($('#tr-from') || {}).value), to = accById(($('#tr-to') || {}).value), el = $('#tr-amt2-f'), hint = $('#tr-hint');
    if (!f || !to || !el) return;
    var diff = f.currency !== to.currency;
    el.style.display = diff ? '' : 'none';
    $('#tr-amt-l').textContent = 'Giden tutar (' + L.CURRENCIES[f.currency].short + ')';
    $('#tr-amt2-l').textContent = 'Gelen tutar (' + L.CURRENCIES[to.currency].short + ')';
    var amt = M.parse($('#tr-amt').value), msg = '';
    if (diff && amt != null && amt > 0) {
      var a = L.toTRY(amt, f.currency, state.rates), rb = to.currency === 'TRY' ? 100 : (state.rates[to.currency] || {}).rate;
      if (a != null && rb) { var sug = M.mulRatio(a, 100, rb); msg = 'Girdiğin kurlarla yaklaşık ' + L.formatCur(sug, to.currency) + ' eder. Bankanın gerçekte verdiği tutarı yaz.'; $('#tr-amt2').placeholder = curVal(sug); }
    }
    if (to.type === 'card') { var cs = L.cardStatus(state, to, today()); msg += (msg ? ' ' : '') + 'Kart ödemesi: ekstreden kalan ' + tl2(cs.remaining) + '.'; }
    hint.textContent = msg;
  }
  /* Transferi uygula (sign=1) / geri al (sign=-1): bakiyeler ve kart ekstre ödemesi kuruşu kuruşuna güncellenir. */
  function applyTransfer(s, x, sign) {
    var f = s.accounts.find(function (a) { return a.id === x.fromId; }), to = s.accounts.find(function (a) { return a.id === x.toId; });
    if (!f || !to) throw new Error('Hesap bulunamadı');
    f.balance = M.sub(f.balance, sign * x.amountFrom); to.balance = M.add(to.balance, sign * x.amountTo);
    if (to.type === 'card' && to.card) {
      if (sign > 0) { var rem = Math.max(0, M.sub(to.card.statementDebt, to.card.paid)); x.paidApplied = Math.min(rem, x.amountTo); to.card.paid = M.add(to.card.paid, x.paidApplied); }
      else to.card.paid = Math.max(0, M.sub(to.card.paid, x.paidApplied || 0));
    }
    if (f.type !== 'card' && f.balance < 0) throw new Error(f.name + ' bakiyesi yetersiz');
    if (to.type !== 'card' && to.balance < 0) throw new Error(to.name + ' bakiyesi eksiye düşerdi; önce bakiyeyi kontrol et');
  }
  function submitTransfer(fromId, toId, date, amtFrom, amtTo, note) {
    var f = accById(fromId), to = accById(toId), errs = [];
    if (!f || !to) errs.push('hesap'); else if (fromId === toId) return toast('Aynı hesaba transfer yapılamaz.');
    if (!date) errs.push('tarih'); if (amtFrom == null || amtFrom <= 0) errs.push('tutar');
    if (f && to && f.currency === to.currency) amtTo = amtFrom; else if (amtTo == null || amtTo <= 0) errs.push('gelen tutar');
    if (errs.length) return toast('Kontrol et: ' + errs.join(', '));
    var x = { id: S.uid(), date: date, fromId: fromId, toId: toId, amountFrom: amtFrom, amountTo: amtTo, note: note || '', paidApplied: 0 };
    mutate(function (s) { applyTransfer(s, x, 1); s.transfers.push(x); }, 'Transfer kaydedildi: ' + L.formatCur(amtFrom, f.currency) + ' (gelir/gider sayılmaz)');
  }

  /* ---------- Yeni listelerin alan düzenleme kuralları ---------- */
  var V2_LISTS = { accounts: 1, recurring: 1, installments: 1, sinkingFunds: 1 };
  var INT_FIELDS = { day: [1, 31], count: [1, 60], everyMonths: [1, 120], remindDays: [0, 31], 'card.statementDay': [1, 31], 'card.dueDay': [1, 31], 'card.remindDays': [0, 31] };
  var MONEY_FIELDS = { amount: 1, total: 1, saved: 1, 'card.limit': 1, 'card.statementDebt': 1, 'card.paid': 1 };
  var YM_FIELDS = { startYm: 1, endYm: 1, firstYm: 1, dueYm: 1, 'card.statementYm': 1 };
  function setPath(o, path, v) { var p = path.split('.'); if (p.length === 2) o[p[0]][p[1]] = v; else o[path] = v; }
  function onV2FieldChange(el) {
    var list = el.dataset.list, id = el.dataset.id, f = el.dataset.field, item = findItem(list, id);
    if (!item) return;
    function bad(msg) { el.setAttribute('aria-invalid', 'true'); toast(msg); }
    if (MONEY_FIELDS[f] || f === 'balance' || f === 'debt') {
      var k = M.parse(el.value);
      if (k == null || k < 0) return bad('Geçersiz tutar: "' + el.value + '". Örnek: 1.250,50');
      if ((f === 'amount' || f === 'total') && k === 0) return bad('Tutar sıfırdan büyük olmalı');
      if (f === 'debt') return mutate(function () { item.balance = k === 0 ? 0 : -k; });
      return mutate(function () { setPath(item, f, k); });
    }
    if (INT_FIELDS[f]) {
      var n = Number(el.value), lim = INT_FIELDS[f];
      if (!Number.isInteger(n) || n < lim[0] || n > lim[1]) return bad(lim[0] + ' ile ' + lim[1] + ' arasında tam sayı gir');
      return mutate(function () { setPath(item, f, n); });
    }
    if (YM_FIELDS[f]) {
      if (!el.value && (f === 'endYm' || f === 'card.statementYm')) return mutate(function () { setPath(item, f, null); });
      if (!L.isYm(el.value)) return bad('Geçerli bir ay seç');
      return mutate(function () {
        if (f === 'card.statementYm' && item.card.statementYm !== el.value) item.card.paid = 0; // yeni ekstre: ödenen sıfırlanır
        setPath(item, f, el.value);
      }, f === 'card.statementYm' ? 'Yeni ekstre ayı kaydedildi; "ödenen" sıfırlandı.' : null);
    }
    if (f === 'name' || f === 'description') { var v = el.value.trim(); if (!v) return bad('Ad boş olamaz'); return mutate(function () { item[f] = v; }); }
    if (f === 'emergency' || f === 'inNetWorth' || f === 'active') return mutate(function () { item[f] = el.checked; });
    if (f === 'accountId') return mutate(function () { item.accountId = el.value || null; });
    if (f === 'freq') return mutate(function () { item.freq = el.value; item.everyMonths = el.value === 'monthly' ? 1 : el.value === 'yearly' ? 12 : (item.everyMonths > 1 && item.everyMonths !== 12 ? item.everyMonths : 2); });
    if (f === 'type' && list === 'accounts') {
      var nt = el.value, T = L.ACCOUNT_TYPES[nt];
      if (item.type === 'card' && nt !== 'card' && state.installments.some(function (p) { return p.cardId === item.id; })) { toast('Bu kartta taksitler var; önce taksitleri başka karta taşı veya sil.'); return render(); }
      return mutate(function () {
        var curChanged = T.currency && item.currency !== T.currency;
        item.type = nt; item.risk = T.risk; item.emergency = T.emergency;
        if (curChanged) { item.currency = T.currency; item.balance = 0; }
        if (nt === 'card') { if (!item.card) item.card = { statementDay: 1, dueDay: 11, limit: 0, statementDebt: 0, statementYm: null, paid: 0, remindDays: 3 }; if (item.balance > 0) item.balance = 0; }
        else { delete item.card; if (item.balance < 0) item.balance = 0; }
      }, 'Hesap türü değişti; bakiyeyi kontrol et.');
    }
    if (f === 'currency') {
      if (item.currency === el.value) return;
      if (item.balance && !confirm('Para birimi değişince bakiye sıfırlanır (yanlış çevrim olmasın diye). Devam?')) return render();
      return mutate(function () { item.currency = el.value; item.balance = 0; });
    }
    mutate(function () { item[f] = el.value; }); // direction, category, risk, cardId
  }
  function deleteV2(list, id) {
    var item = findItem(list, id); if (!item) return;
    if (list === 'accounts') {
      var nTr = state.transfers.filter(function (x) { return x.fromId === id || x.toId === id; }).length, nIn = state.installments.filter(function (p) { return p.cardId === id; }).length;
      if (nTr || nIn) return toast('Bu hesaba bağlı ' + (nTr ? nTr + ' transfer ' : '') + (nIn ? nIn + ' taksit ' : '') + 'var. Önce onları sil.');
      return mutate(function (s) {
        s.accounts = s.accounts.filter(function (a) { return a.id !== id; });
        s.transactions.forEach(function (t) { if (t.accountId === id) delete t.accountId; });
        s.recurring.forEach(function (r) { if (r.accountId === id) r.accountId = null; });
      }, 'Hesap silindi.');
    }
    if (list === 'recurring') {
      var gen = state.transactions.filter(function (t) { return t.recurringId === id && t.source === 'düzenli'; }).length;
      var dropGen = gen > 0 && confirm('"' + item.name + '" için oluşturulmuş ' + gen + ' beklenen kayıt da silinsin mi? (İptal: kayıtlar normal işlem olarak kalır)');
      return mutate(function (s) {
        s.recurring = s.recurring.filter(function (r) { return r.id !== id; });
        if (dropGen) s.transactions = s.transactions.filter(function (t) { return !(t.recurringId === id && t.source === 'düzenli'); });
        s.transactions.forEach(function (t) { if (t.recurringId === id) { delete t.recurringId; delete t.period; } });
      }, 'Düzenli ödeme silindi.');
    }
    mutate(function (s) { s[list] = s[list].filter(function (x) { return x.id !== id; }); }, 'Silindi.');
  }
  function addV2(list, type) {
    var ym = nowYm(), id = S.uid();
    if (list === 'installments' && !cards().length) return toast('Önce Hesaplar bölümünden bir kredi kartı ekle.');
    mutate(function (s) {
      if (list === 'accounts') {
        var t = type || 'bank', T = L.ACCOUNT_TYPES[t], a = { id: id, name: t === 'card' ? 'Yeni kredi kartı' : t === 'gold' ? 'Altın hesabı' : 'Yeni hesap', type: t, currency: T.currency || 'TRY', balance: 0, emergency: T.emergency, inNetWorth: true, risk: T.risk };
        if (t === 'card') a.card = { statementDay: 1, dueDay: 11, limit: 0, statementDebt: 0, statementYm: null, paid: 0, remindDays: 3 };
        s.accounts.push(a);
      }
      if (list === 'recurring') s.recurring.push({ id: id, name: 'Yeni düzenli ödeme', direction: 'expense', amount: 10000, category: 'Faturalar', freq: 'monthly', everyMonths: 1, day: 1, startYm: ym, endYm: null, remindDays: 3, active: true, skipped: [], accountId: null });
      if (list === 'installments') s.installments.push({ id: id, cardId: cards()[0].id, description: 'Yeni taksitli alışveriş', category: 'Alışveriş', total: 600000, count: 6, firstYm: ym });
      if (list === 'sinkingFunds') s.sinkingFunds.push({ id: id, name: 'Yeni yıllık gider', category: 'Diğer', amount: 1200000, saved: 0, dueYm: L.addMonthsYm(ym, 12), day: 1, everyMonths: 12 });
    });
    var inputs = $$('input[data-list="' + list + '"][data-field="' + (list === 'installments' ? 'description' : 'name') + '"]'); if (inputs.length) { var last = inputs[inputs.length - 1]; last.focus(); last.select(); }
  }
  function recurringTx(item, period, amount) {
    var occ = L.occurrence(item, period) || { date: L.ymdOf(period, item.day) }, t = today();
    var tx = { id: S.uid(), date: occ.date > t ? t : occ.date, description: item.name, amount: amount, category: item.category, source: 'düzenli', recurringId: item.id, period: period };
    if (item.accountId) tx.accountId = item.accountId;
    return tx;
  }
  function v2Actions(t) {
    return {
      'rc-pay': function () {
        var item = findItem('recurring', t.dataset.id), period = t.dataset.period; if (!item) return;
        if (state.transactions.some(function (x) { return x.recurringId === item.id && x.period === period; })) return toast('Bu ay için zaten kayıtlı.');
        var v = prompt('"' + item.name + '" (' + ymLabel(period) + ') tutarı, TL. Fatura gibi değişiyorsa gerçek tutarı yaz:', M.format(item.amount, { symbol: false }));
        if (v == null) return; var k = M.parse(v); if (k == null || k <= 0) return toast('Geçersiz tutar');
        mutate(function (s) { s.transactions.push(recurringTx(item, period, item.direction === 'income' ? k : -k)); }, item.name + ' kaydedildi: ' + tl2(k));
      },
      'rc-link': function () { var id = t.dataset.id, period = t.dataset.period, txId = t.dataset.tx; mutate(function (s) { var x = s.transactions.find(function (q) { return q.id === txId; }); if (!x || x.recurringId) throw new Error('İşlem bulunamadı veya zaten bağlı'); x.recurringId = id; x.period = period; }, 'Eşleştirildi; yeni kayıt eklenmedi (çift sayım yok).'); },
      'rc-unlink': function () {
        var txId = t.dataset.tx, x = state.transactions.find(function (q) { return q.id === txId; }); if (!x) return;
        mutate(function (s) { var q = s.transactions.find(function (z) { return z.id === txId; }); if (q.source === 'düzenli') s.transactions = s.transactions.filter(function (z) { return z.id !== txId; }); else { delete q.recurringId; delete q.period; } }, x.source === 'düzenli' ? 'Kayıt silindi.' : 'Eşleştirme kaldırıldı (işlem duruyor).');
      },
      'rc-skip': function () { var id = t.dataset.id, p = t.dataset.period; mutate(function (s) { var r = s.recurring.find(function (x) { return x.id === id; }); if (r.skipped.indexOf(p) < 0) r.skipped.push(p); }, 'Bu ay atlandı.'); },
      'rc-unskip': function () { var id = t.dataset.id, p = t.dataset.period; mutate(function (s) { var r = s.recurring.find(function (x) { return x.id === id; }); r.skipped = r.skipped.filter(function (y) { return y !== p; }); }); },
      'rc-gen': function () {
        var plan = L.generationPlan(state, payYm, today());
        if (!plan.create.length && !plan.link.length) return toast('Oluşturulacak kayıt yok.');
        var msg = ymLabel(payYm) + ' için:\n' + plan.link.map(function (l) { return '• ' + l.item.name + ': mevcut işlemle eşleştirilecek (yeni kayıt yok)'; }).concat(plan.create.map(function (c) { return '• ' + c.item.name + ': ' + tl2(c.tx.amount) + ' (' + dateLabel(c.tx.date) + ') beklenen kayıt eklenecek'; })).join('\n') + '\n\nOnaylıyor musun?';
        if (!confirm(msg)) return;
        mutate(function (s) { L.applyGeneration(s, plan, S.uid); }, (plan.create.length + plan.link.length) + ' düzenli ödeme işlendi.');
      },
      'pay-month': function () { payYm = L.addMonthsYm(payYm || nowYm(), Number(t.dataset.d)); render(); },
      'notif-on': function () { try { Notification.requestPermission().then(function () { render(); maybeNotify(); }); } catch (e) { toast('Bu tarayıcı bildirimleri desteklemiyor.'); } },
      'sf-setaside': function () {
        var f = findItem('sinkingFunds', t.dataset.id); if (!f) return; var p = L.sinkingPlan(f, nowYm()); if (p.toSetAsideNow <= 0) return;
        mutate(function () { f.saved = M.add(f.saved, p.toSetAsideNow); f.setAsideYm = nowYm(); f.setAsideAmount = p.toSetAsideNow; }, f.name + ' için ' + tl2(p.toSetAsideNow) + ' ayrıldı.');
      },
      'sf-paid': function () {
        var f = findItem('sinkingFunds', t.dataset.id); if (!f) return;
        var nextYm = L.addMonthsYm(f.dueYm, f.everyMonths);
        var v = prompt('"' + f.name + '" için ödediğin tutar (TL). Harcama olarak işlemlere de kaydedilir; kumbara bir sonraki döneme (' + ymLabel(nextYm) + ') geçer:', M.format(f.amount, { symbol: false }));
        if (v == null) return; var k = M.parse(v); if (k == null || k <= 0) return toast('Geçersiz tutar');
        mutate(function (s) {
          s.transactions.push({ id: S.uid(), date: today(), description: f.name, amount: -k, category: f.category || 'Diğer', source: 'yıllık gider' });
          f.saved = Math.max(0, M.sub(f.saved, k)); f.dueYm = nextYm; delete f.setAsideYm; delete f.setAsideAmount;
        }, f.name + ' ödendi; yeni dönem ' + ymLabel(nextYm) + '.');
      },
      'tr-del': function () {
        var x = state.transfers.find(function (q) { return q.id === t.dataset.id; }); if (!x) return;
        if (!confirm('Transfer silinsin mi? İki hesabın bakiyesi eski hâline döner.')) return;
        mutate(function (s) { var y = s.transfers.find(function (q) { return q.id === x.id; }); applyTransfer(s, y, -1); s.transfers = s.transfers.filter(function (q) { return q.id !== x.id; }); }, 'Transfer silindi, bakiyeler geri alındı.');
      },
      'lim-suggest': function () {
        var cmp = L.compareMonths(state.transactions, today()), sug = {};
        cmp.rows.forEach(function (r) { if (r.category !== 'Gelir' && r.category !== 'Transfer' && r.avg3 > 0 && !state.limits[r.category]) sug[r.category] = Math.ceil(r.avg3 / 10000) * 10000; });
        var ks = Object.keys(sug); if (!ks.length) return toast('Önerilecek yeni sınır yok (geçmiş harcama yok veya sınırlar zaten var).');
        if (!confirm('Son 3 ayın ortalamasına göre (100 TL\'ye yukarı yuvarlanmış) öneriler:\n' + ks.map(function (c) { return '• ' + c + ': ' + tl(sug[c]); }).join('\n') + '\n\nEklensin mi?')) return;
        mutate(function (s) { ks.forEach(function (c) { s.limits[c] = sug[c]; }); }, ks.length + ' sınır eklendi.');
      },
      'lim-clear': function () { if (confirm('Tüm kategori sınırları kaldırılsın mı?')) mutate(function (s) { s.limits = {}; }, 'Sınırlar kaldırıldı.'); },
      'cmp-cat': function () { cmpCat = t.dataset.cat; render(); }
    };
  }
  function updateBadge() {
    var a = $('nav.tabs a[data-tab="butce"]'); if (!a || !state) return;
    var n = 0; try { n = L.badgeCount(L.upcoming(state, today(), 30)); } catch (e) { n = 0; }
    var b = $('.badge', a);
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'badge'; a.appendChild(b); }
    b.textContent = n; b.setAttribute('aria-label', n + ' yaklaşan veya geciken ödeme');
  }

  /* ---------- Yönlendirme ve çizim ---------- */
  var VIEWS = { ozet: renderDashboard, butce: renderBudgetTab, odemeler: renderPayments, hesaplar: renderAccounts, islemler: renderTransactions, portfoy: function () { return PUI.renderPortfolio(); }, analiz: function () { return AUI.render(); }, veri: renderImport, haberler: function () { return HUI ? HUI.render() : '<p class="muted">Haber merkezi yüklenemedi.</p>'; }, asistan: renderAssistant, ayarlar: renderSettings, guvenlik: function () { return SUI.renderPage(); } };
  var AREA = { butce: 'butce', odemeler: 'butce', hesaplar: 'butce', islemler: 'butce', ayarlar: 'ayarlar', guvenlik: 'ayarlar' };
  var TITLES = { ozet: 'Ana sayfa', butce: 'Bütçe', odemeler: 'Ödemeler', hesaplar: 'Hesaplar', islemler: 'İşlemler', portfoy: 'Portföy Yönetimi', analiz: 'Portföy Analizi', veri: 'Veri ekle', haberler: 'Haberler ve bildirimler', asistan: 'Yapay zekâ asistanı', ayarlar: 'Ayarlar ve yedek', guvenlik: 'Yedek, eşitleme ve kilit' };
  function areaNav() {
    if (AREA[tab] === 'ayarlar') return '<nav class="areanav" aria-label="Ayar bölümleri">' + [['ayarlar', 'Genel ayarlar'], ['guvenlik', 'Yedek, eşitleme, kilit']].map(function (x) { return '<a href="#' + x[0] + '"' + (tab === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + '</a>'; }).join('') + '</nav>';
    if (AREA[tab] !== 'butce') return '';
    return '<nav class="areanav" aria-label="Bütçe bölümleri">' + [['butce', 'Plan ve sınırlar'], ['odemeler', 'Ödemeler'], ['hesaplar', 'Hesaplar'], ['islemler', 'İşlemler']].map(function (x) {
      return '<a href="#' + x[0] + '"' + (tab === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + '</a>'; }).join('') + '</nav>';
  }
  function render() {
    renderBanner();
    var navTab = AREA[tab] || tab;
    $$('nav.tabs a').forEach(function (a) { if (a.dataset.tab === navTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var html;
    try { html = areaNav() + VIEWS[tab](); } catch (e) { console.error(e); html = '<div class="notice danger">Bu bölüm gösterilirken bir hata oluştu: ' + esc(e.message) + '. Verilerin güvende; Ayarlar\'dan yedek alabilirsin.</div>'; }
    var vw = $('#view'); vw.classList.toggle('fp-enter', CH ? CH.isEntering() : false);
    vw.innerHTML = html;
    stackLabels(vw);
    if (CH) CH.flush();
    if (tab === 'veri' && review) refreshReview();
    if (tab === 'hesaplar') trHint();
    if (tab === 'portfoy') PUI.afterRender();
    if (AUI) AUI.afterRender();
    if (SUI) SUI.afterRender();
    updateBadge();
  }
  /* Dar ekranda kart satırına dönen tablolar: her hücreye sütun başlığını etiket olarak yaz */
  function stackLabels(root) {
    $$('table.stack', root).forEach(function (t) {
      var heads = []; $$('thead th', t).forEach(function (th) { var c = th.cloneNode(true); $$('.tip,.hint', c).forEach(function (x) { x.remove(); }); var n = +(th.getAttribute('colspan') || 1); for (var i = 0; i < n; i++) heads.push(c.textContent.replace(/\s+/g, ' ').trim()); });
      $$('tbody tr', t).forEach(function (tr) { var i = 0; Array.prototype.forEach.call(tr.children, function (td) { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] || ''); i += +(td.getAttribute('colspan') || 1); }); });
    });
  }
  function route() {
    var parts = (location.hash || '#ozet').slice(1).split('/'), t = parts[0];
    if (t === 'varliklar') { location.replace('#portfoy/varliklar'); return; } // eski bağlantılar
    var nt = VIEWS[t] ? t : 'ozet', ns = parts[1] || '';
    if (CH && (nt !== tab || ns !== sub || !route.done)) CH.entering();
    tab = nt; sub = ns; route.done = true;
    render();
    document.title = (TITLES[tab] || 'Finans Pusulası') + ' · Finans Pusulası';
    if (window.scrollY > 200) window.scrollTo(0, 0);
  }

  /* ---------- Olaylar ---------- */
  function findItem(list, id) { return state[list].find(function (x) { return x.id === id; }); }
  function onFieldChange(el) {
    var list = el.dataset.list, id = el.dataset.id, f = el.dataset.field;
    if (V2_LISTS[list]) return onV2FieldChange(el);
    var item = findItem(list, id);
    if (!item) return;
    if (f === 'accountId') return mutate(function () { if (el.value) item.accountId = el.value; else delete item.accountId; });
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
    if (t.dataset.pick) { var fi = $('#file-in'); fi.accept = t.dataset.pick; if (t.dataset.capture) fi.setAttribute('capture', t.dataset.capture); else fi.removeAttribute('capture'); fi.value = ''; fi.click(); return; }
    if (t.dataset.ask) { ask(t.dataset.ask); return; }
    var act = t.dataset.act;
    if (SUI && SUI.onClick(act, t)) return;
    var A = {
      'example-clear': function () { if (confirm('Örnek verilerin tamamı silinsin mi? (Sonra kendi verilerini girersin.)')) mutate(function (s) { var n = S.emptyState(); Object.keys(n).forEach(function (k) { s[k] = n[k]; }); s.settings.view = document.body.classList.contains('detailed') ? 'detailed' : 'simple'; }, 'Örnek veri temizlendi.'); },
      'example-mine': function () { mutate(function (s) { s.isExample = false; s.transactions.forEach(function (t2) { if (t2.source === 'örnek') t2.source = 'elle'; }); if (s.trades) s.trades.forEach(function (t2) { if (t2.source === 'örnek') t2.source = 'elle'; }); }, 'Veriler artık senin verilerin olarak işaretlendi.'); },
      'refresh-example': function () {
        if (!state.isExample) return;
        if (confirm('Örnek veri baştan yüklensin mi? Bu sayfadaki örnek rakamlar (ve üzerlerine yazdıkların) silinir. Kendi gerçek verin varsa iptal et; gerçek veri bu düğmeyle değişmez.')) {
          mutate(function (s) {
            var view = s.settings && s.settings.view, n = S.exampleState();
            Object.keys(n).forEach(function (k) { s[k] = n[k]; });
            if (view) s.settings.view = view;
          }, 'Örnek veri yenilendi.');
        }
      },
      'load-example': function () {
        // Eşitleme açıkken örnek veri yüklenmez: tüm cihazlardaki gerçek veri sessizce değişebilirdi.
        if (SUI && SUI.syncEnabled()) { alert('Eşitleme açıkken örnek veri yüklenemez.\n\nÖrnek veri, eşitlenen tüm cihazlardaki gerçek verilerinin yerine geçebilirdi. Örnek veriyi görmek istiyorsan önce Ayarlar → Yedek, eşitleme, kilit bölümünden eşitlemeyi kapat.'); return; }
        var nReal = S.realRecordCount(state);
        if (nReal > 0) {
          if (!confirm('DİKKAT: Bu cihazda ' + nReal + ' gerçek kaydın var (hesaplar, işlemler, alım-satımlar vb.).\n\nÖrnek veri yüklenirse HEPSİNİN yerine örnek rakamlar geçer. Önce otomatik bir yedek (anlık görüntü) alınacak.\n\nDevam edilsin mi?')) return;
          if (!confirm('Son onay: gerçek verilerinin yerine örnek veri yüklensin mi? (Geri almak için: Ayarlar → Yedek → Anlık görüntüler)')) return;
        }
        var go = function () { mutate(function (s) { var view = s.settings && s.settings.view, n = S.exampleState(); Object.keys(n).forEach(function (k) { s[k] = n[k]; }); if (view) s.settings.view = view; }, 'Örnek veri yüklendi.'); };
        if (nReal > 0 && SUI) SUI.snapshot('Örnek veri yüklenmeden önce').then(go, go); else go();
      },
      'clear-all': function () { if (confirm('TÜM veriler bu cihazdan silinecek. Emin misin? (Önce yedek almanı öneririz; ayrıca otomatik bir kopya alınır.)' + (SUI && SUI.syncEnabled() ? '\n\nDİKKAT: Eşitleme açık — silme diğer cihazlarına da yansır. Yalnızca bu cihazdan silmek için önce Yedek ve güvenlik sayfasından eşitlemeyi kapat.' : ''))) SUI.snapshot('Tümünü silmeden önce').then(function () { mutate(function (s) { var n = S.emptyState(); Object.keys(n).forEach(function (k) { s[k] = n[k]; }); }, 'Tüm veriler silindi.'); }); },
      'add': function () {
        var l = t.dataset.list;
        if (V2_LISTS[l]) return addV2(l, t.dataset.type);
        mutate(function (s) {
          if (l === 'incomes') s.incomes.push({ id: S.uid(), name: 'Yeni gelir', amount: 0 });
          if (l === 'expenses') s.expenses.push({ id: S.uid(), name: 'Yeni gider', type: 'variable', amount: 0 });
          if (l === 'assets') s.assets.push({ id: S.uid(), name: 'Yeni varlık', cls: 'cash', risk: 'safe', emergency: true, value: 0 });
          if (l === 'debts') s.debts.push({ id: S.uid(), name: 'Yeni borç', amount: 0 });
        });
        var inputs = $$('input[data-list="' + l + '"][data-field="name"]'); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
      },
      'del': function () { var l = t.dataset.list, id = t.dataset.id; if (V2_LISTS[l]) return deleteV2(l, id); mutate(function (s) { s[l] = s[l].filter(function (x) { return x.id !== id; }); }, 'Silindi.'); },
      'export': function () { SUI.exportPlain(); },
      'import': function () { var b = $('#backup-in'); b.value = ''; b.click(); },
      'export-csv': exportCsv,
      'scen-reset': function () { mutate(function (s) { s.settings.scenarios = JSON.parse(JSON.stringify(C.DEFAULT_SCENARIOS)); }, 'Senaryolar varsayılana döndü.'); },
      'rv-cancel': function () { if (confirm('Kontrol tablosu kapatılsın mı? Hiçbir şey kaydedilmeyecek.')) { review = null; render(); } },
      'rv-save': saveReview,
      'rv-all': function () { review.rows.forEach(function (x) { x.include = true; }); render(); },
      'rv-none': function () { review.rows.forEach(function (x) { x.include = false; }); render(); },
      'rv-flip': function () { review.rows.forEach(function (x) { if (x.include && Number.isInteger(x.amount)) { x.amount = -x.amount; x.category = categorize(x); } }); render(); },
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
      'rv-add': function () {
        if (!review) return;
        var key = review.rows.reduce(function (m, x) { return Math.max(m, x.key); }, -1) + 1;
        var d = (review.ocrRec && review.ocrRec.date) || (review.rows[0] && review.rows[0].date) || todayYmd();
        review.rows.push({ key: key, include: true, manual: true, date: d, rawDate: '', description: '', amount: null, note: 'Elle eklendi', category: (review.ocrRec && review.ocrRec.category) || 'Diğer', source: 'elle' });
        revalidate(false); render();
        var inp = $('tr[data-key="' + key + '"] input[data-rv="description"]'); if (inp) inp.focus();
      },
      'rv-total-only': function () {
        if (!review || !review.ocrRec) return;
        var rows = P.receiptFallbackRows(review.ocrRec, todayYmd());
        startReviewRows(rows); review.docTotal = review.ocrRec.docTotal; review.ocrWarn = []; render();
      },
      'ai-showkey': function () { var k = $('#ai-key'); k.type = k.type === 'password' ? 'text' : 'password'; t.textContent = k.type === 'password' ? 'Göster' : 'Gizle'; },
      'ai-delkey': function () { if (aiCfg.keys) delete aiCfg.keys[aiCfg.provider]; Store.saveAi(aiCfg); render(); toast('Anahtar bu cihazdan silindi.'); },
      'ai-list': function () { saveAiFromForm(); var msg = $('#ai-msg'); msg.innerHTML = '<span class="spinner"></span> Modeller alınıyor…'; AI.listModels(aiCfg).then(function (ids) { $('#ai-models').innerHTML = ids.map(function (i) { return '<option value="' + esc(i) + '">'; }).join(''); msg.textContent = ids.length + ' model bulundu. Model kutusuna tıklayınca listeden seçebilirsin.' + (aiCfg.provider === 'openrouter' ? ' Ücretsiz olanların adı ":free" ile biter.' : ''); }, function (er) { msg.textContent = er.message; }); },
      'ai-test': function () { saveAiFromForm(); var msg = $('#ai-msg'); msg.innerHTML = '<span class="spinner"></span> Test ediliyor…'; AI.chat(aiCfg, 'Kısa cevap ver.', [{ role: 'user', text: 'Sadece "Bağlantı tamam" yaz.' }], false).then(function (r) { msg.textContent = '✓ Çalışıyor. Yanıt: ' + String(r).slice(0, 80); }, function (er) { msg.textContent = '✕ ' + er.message; }); },
      'chat-clear': function () { chatLog = []; render(); }
    };
    var B = v2Actions(t); Object.keys(B).forEach(function (k) { A[k] = B[k]; });
    var PA = PUI.actions(t); Object.keys(PA).forEach(function (k) { A[k] = PA[k]; });
    if (AUI) { var AA = AUI.actions(t); Object.keys(AA).forEach(function (k) { A[k] = AA[k]; }); }
    if (A[act]) A[act]();
  }
  function onChange(e) {
    var el = e.target;
    if (SUI && SUI.onChange(el)) return;
    if (PUI.onChange(el)) return;
    if (el.dataset.list && el.dataset.field) return onFieldChange(el);
    if (el.dataset.goal) {
      var f = el.dataset.goal;
      if (f === 'target') { var k = M.parse(el.value); if (k == null || k < 0) { el.setAttribute('aria-invalid', 'true'); return toast('Geçersiz tutar'); } return mutate(function (s) { s.goal.target = k; }); }
      if (f === 'targetYm') { if (!/^\d{4}-\d{2}$/.test(el.value)) return toast('Geçerli bir ay seç'); if (el.value < C.currentYm()) { toast('Hedef tarihi geçmişte olamaz'); return render(); } return mutate(function (s) { s.goal.targetYm = el.value; }); }
      if (f === 'name') { var v = el.value.trim(); if (!v) return toast('Ad boş olamaz'); return mutate(function (s) { s.goal.name = v; }); }
    }
    if (el.dataset.limit != null) {
      var cat = el.dataset.limit, raw = el.value.trim();
      if (!raw || M.parse(raw) === 0) return mutate(function (s) { delete s.limits[cat]; }, cat + ' sınırı kaldırıldı.');
      var lk = M.parse(raw); if (lk == null || lk < 0) { el.setAttribute('aria-invalid', 'true'); return toast('Geçersiz tutar'); }
      return mutate(function (s) { s.limits[cat] = lk; });
    }
    if (el.dataset.rate) {
      var cur = el.dataset.rate, rr = el.value.trim();
      if (!rr) { if (!confirm(L.CURRENCIES[cur].label + ' kuru silinsin mi? Bu birimdeki hesaplar toplamlara sayılmaz.')) return render(); return mutate(function (s) { delete s.rates[cur]; }); }
      var rk = M.parse(rr); if (rk == null || rk <= 0) { el.setAttribute('aria-invalid', 'true'); return toast('Geçersiz kur. Örnek: 42,50'); }
      return mutate(function (s) { s.rates[cur] = { rate: rk, date: today() }; PUI.rateEdited(s, cur, rk, today()); }, L.CURRENCIES[cur].label + ' kuru kaydedildi (tarih: bugün).');
    }
    if (el.dataset.ratedate) {
      var c2 = el.dataset.ratedate; if (!L.isYmd(el.value)) return toast('Geçerli bir tarih seç');
      if (el.value > today()) { toast('Kur tarihi gelecekte olamaz'); return render(); }
      return mutate(function (s) { s.rates[c2].date = el.value; });
    }
    if (el.id === 'rv-card' && review) {
      review.cardId = el.value;
      if (el.value && !review.cc && !review.receipt && P.looksPositiveExpenses(review.rows)) { setCardMode(true); review.autoCc = false; toast('Karta ait belge: artı tutarlar harcama (−) olarak çevrildi, ödemeler Transfer sayıldı.'); }
      render(); return;
    }
    if (el.id === 'rv-cc' && review) { setCardMode(el.checked); review.autoCc = false; render(); return; }
    if (el.id === 'rv-mkinst' && review) { review.mkInst = el.checked; return; }
    if (el.id === 'rv-stmt' && review) { review.updStmt = el.checked; return; }
    if (el.id === 'tr-from' || el.id === 'tr-to' || el.id === 'tr-amt') return trHint();
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
      if (f2 === 'include') { x.include = el.checked; x.autoEx = false; }
      else if (f2 === 'date') x.date = P.parseDate(el.value);
      else if (f2 === 'description') { x.description = el.value; }
      else if (f2 === 'amount') { var pinf = M.parseInfo(el.value); x.amount = pinf.value; x.amountWarn = pinf.warnings.length ? pinf.warnings : undefined; if (pinf.warnings.length) toast(pinf.warnings[0]); if (review.receipt && x.amount > 0 && !/^\s*\+/.test(el.value)) x.amount = -x.amount; /* fişte yazılan tutar harcamadır (+ ile gelir) */ if (x.fromDocTotal) x.fromDocTotal = false; el.setAttribute('aria-invalid', x.amount == null ? 'true' : 'false'); if (x.amount != null) el.value = moneyInputVal(x.amount); }
      else if (f2 === 'category') x.category = el.value;
      refreshReview(); return;
    }
    if (el.id === 'rv-total' && review) { var dt = el.value.trim() ? M.parse(el.value) : null; if (el.value.trim() && dt == null) return toast('Geçersiz toplam'); review.docTotal = dt == null ? null : Math.abs(dt); refreshReview(); return; }
    if (el.id === 'opt-cc') { importOpts.cc = el.checked; return; }
    if (el.id === 'opt-method') { importOpts.method = el.value; aiCfg.importMethod = el.value; Store.saveAi(aiCfg); return; }
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
      return CB && CB.isEnvelope(obj) ? SUI.decryptBackup(obj) : obj;
    }).then(function (obj) {
      delete obj.exportedAt; delete obj.app;
      S.validateState(obj);
      var msg = 'Yedek dosyası geçerli' + (obj.migratedFrom ? ' (eski v' + obj.migratedFrom + ' yedeği; yeni sürüme dönüştürüldü, hiçbir veri silinmedi)' : '') + ': ' + obj.incomes.length + ' gelir, ' + obj.expenses.length + ' gider, ' + obj.assets.length + ' varlık, ' + obj.transactions.length + ' işlem, ' +
        obj.accounts.length + ' hesap, ' + obj.recurring.length + ' düzenli ödeme, ' + obj.installments.length + ' taksit, ' + obj.sinkingFunds.length + ' yıllık gider, ' + Object.keys(obj.limits).length + ' sınır, ' + (obj.trades || []).length + ' alım-satım, ' + (obj.goals || []).length + ' hedef, ' + Object.keys(obj.prices || {}).length + ' fiyat serisi.\nMevcut verilerin bu yedekle DEĞİŞTİRİLECEK. Devam edilsin mi?';
      if (!confirm(msg)) return;
      return SUI.snapshot('Yedek geri yüklemeden önce').then(function () { restoreState(obj, 'Yedek geri yüklendi. (Önceki hâlin otomatik kopyalarda.)'); });
    }).catch(function (e) { toast('Yedek yüklenemedi, hiçbir şey değişmedi: ' + e.message); });
  }
  function onSubmit(e) {
    if (PUI.onSubmit(e)) return;
    if (AUI && AUI.onSubmit(e)) return;
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
    if (e.target.id === 'tr-form') {
      e.preventDefault();
      return submitTransfer($('#tr-from').value, $('#tr-to').value, P.parseDate($('#tr-date').value), M.parse($('#tr-amt').value), M.parse($('#tr-amt2').value), $('#tr-note').value.trim());
    }
    if (e.target.dataset && e.target.dataset.cardpay) {
      e.preventDefault();
      var cid = e.target.dataset.cardpay, from = $('#cp-from-' + cid);
      if (!from || !from.value) return toast('Önce Hesaplar bölümünden bir TL hesabı ekle.');
      return submitTransfer(from.value, cid, today(), M.parse($('#cp-amt-' + cid).value), null, 'Kart borcu ödemesi');
    }
    if (e.target.id === 'chat-form') { e.preventDefault(); var q = $('#chat-in').value; ask(q); }
  }

  /* ---------- Başlat ---------- */
  function init() {
    PUI = window.PortfolioUI({
      state: function () { return state; }, mutate: mutate, render: render, toast: toast, esc: esc, tl: tl, tl2: tl2, tip: tip, pct: pct, sbp: sbp, kpi: kpi, progress: progress,
      dateLabel: dateLabel, ymLabel: ymLabel, monthsLabel: monthsLabel, today: today, nowYm: nowYm, eff: eff, sub: function () { return sub; }, subtabs: subtabs, debtsCard: debtsCard,
      loadScript: loadScript, decodeText: decodeText, loadPdfLib: loadPdfLib, pdfText: pdfText, pdfToImages: pdfToImages, readImage: readImage, getOcrWorker: getOcrWorker, ocrRecognize: ocrRecognize,
      aiReady: aiReady, aiCfg: function () { return aiCfg; }, setStatus: setStatus, busy: busy,
      analysisCard: function () { return AUI ? AUI.homeCard() : ''; }
    });
    if (window.AnalysisUI) AUI = window.AnalysisUI({
      state: function () { return state; }, mutate: mutate, render: render, toast: toast, esc: esc, tl: tl, tip: tip, today: today, subtabs: subtabs,
      sub: function () { return sub; }, tab: function () { return tab; }, calc: function () { return PUI.calc(); },
      snapshot: function (r) { return SUI && SUI.snapshot ? SUI.snapshot(r) : Promise.resolve(); }
    });
    if (AUI && AUI.startAlerts) AUI.startAlerts();
    if (window.HubUI && window.News && window.Events && window.Notify && window.Mood && window.HubData) {
      try {
        HUI = window.HubUI({
          state: function () { return state; }, render: function () { if (state) render(); }, toast: toast, esc: esc, tl: tl, tip: tip, today: today,
          sub: function () { return sub; }, tab: function () { return tab; }, calc: function () { return PUI.calc(); }, aui: function () { return AUI; },
          quiet: function (fn) { if (!state) return; fn(state); persist(); }
        });
        if (AUI) AUI.setHub(HUI);
      } catch (e) { console.error(e); HUI = null; }
    }
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    // Katlanır bölümler: açılınca içerik (ve grafikler doğru genişlikte) çizilir; durum hatırlanır
    document.addEventListener('toggle', function (e) { var d = e.target; if (!d || !d.dataset || !d.dataset.fold) return; var was = foldOpen[d.dataset.fold]; foldOpen[d.dataset.fold] = d.open; if (d.open && !d.querySelector('.fold-body').innerHTML) render(); }, true);
    document.addEventListener('input', function (e) { PUI.onInput(e.target); if (e.target.id === 'tr-amt') trHint(); if (e.target.id === 'tx-q') { txFilter.q = e.target.value; var pos = e.target.selectionStart; render(); var q = $('#tx-q'); q.focus(); q.setSelectionRange(pos, pos); } else if (e.target.getAttribute('aria-invalid') === 'true') e.target.removeAttribute('aria-invalid'); });
    document.addEventListener('keydown', function (e) {
      if (e.target.id === 'chat-in' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
      if (e.target.id === 'drop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#file-in').click(); }
    });
    ['dragover', 'dragenter'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (tab === 'veri' && !review && !PUI.hasReview()) { e.preventDefault(); var d = $('#drop'); if (d) d.classList.add('over'); } }); });
    document.addEventListener('dragleave', function (e) { var d = $('#drop'); if (d && e.target === d) d.classList.remove('over'); });
    document.addEventListener('drop', function (e) { if (tab === 'veri' && !review && !PUI.hasReview()) { e.preventDefault(); var d = $('#drop'); if (d) d.classList.remove('over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); } });
    window.addEventListener('paste', function (e) { // Ekran görüntüsünü doğrudan yapıştır (Ctrl+V)
      if (tab !== 'veri' || review || PUI.hasReview()) return;
      var item = Array.prototype.find.call(e.clipboardData.items || [], function (i) { return /^image\//.test(i.type); });
      if (item) { e.preventDefault(); var f = item.getAsFile(); handleFile(new File([f], 'yapistirilan-ekran-goruntusu.png', { type: f.type })); }
    });
    $('#view-simple').onclick = function () { setView('simple'); };
    $('#view-detailed').onclick = function () { setView('detailed'); };
    SUI = window.SecurityUI({
      state: function () { return state; }, mutate: mutate, render: function () { if (state) render(); }, toast: toast, esc: esc, tip: tip, today: today, dateLabel: dateLabel, tab: function () { return tab; },
      replaceState: replaceState, restoreState: restoreState, download: function (n, t) { Store.download(n, t); }, busyToast: function (m) { toast(m); }
    });
    // Kilit: kilit açıksa (veya veri diskte şifreliyse) önce PIN sorulur; anahtar yalnızca bellekte tutulur
    var lockCfg = SUI.lockCfg();
    Store.isLockedOnDisk().catch(function () { return false; }).then(function (enc) {
      if (!lockCfg && !enc) return null;
      $('#view').innerHTML = '';
      return SUI.lockScreen(enc).then(function (key) { if (enc) { Store.setKey(key); return null; } Store.setKey(null); return Store.rekey(key); });
    }).then(loadState, function (e) { console.error(e); toast('Açılamadı: ' + e.message); });
  }
  function loadState() {
    window.addEventListener('hashchange', route);
    Store.load().then(function (s) {
      if (s) {
        var oldSchema = s.schema;
        try {
          if (typeof oldSchema === 'number' && oldSchema < S.SCHEMA_VERSION) {
            var pre = JSON.parse(JSON.stringify(s));
            if (!Store.hasKey()) { try { localStorage.setItem('finans-pusulasi:v' + oldSchema + '-oncesi-yedek', JSON.stringify(pre)); } catch (e3) { /* */ } }
            Store.addSnapshot(pre, 'v' + oldSchema + ' → v' + S.SCHEMA_VERSION + ' sürüm yükseltmesi öncesi', SM ? SM.counts(pre) : null).catch(function (e4) { console.error(e4); });
          }
          var refreshExample = S.shouldRefreshExample(s);
          state = S.validateState(s);
          lastSaved = JSON.parse(JSON.stringify(state));
          if (refreshExample) {
            var view0 = state.settings && state.settings.view;
            state = S.exampleState();
            if (view0) state.settings.view = view0;
            lastSaved = null; persist();
            setTimeout(function () { toast('Örnek veri güncellendi — artık temettü ve bedelsiz örnekleri de var. Bunlar hâlâ örnektir, gerçek verin değil. "Bunlar artık benim verilerim" dersen bir daha otomatik değişmez.'); }, 400);
          }
          else if (oldSchema !== state.schema) { persist(); setTimeout(function () { toast('Verilerin yeni sürüme (v' + state.schema + ') güvenle taşındı. Hiçbir şey silinmedi; eski hâlin "Otomatik kopyalar"da saklandı.'); }, 400); }
        }
        catch (e) {
          console.error(e); state = null;
          if (Store.hasKey()) Store.addSnapshot(s, 'Doğrulanamayan kayıt').catch(function () { });
          else { try { localStorage.setItem('finans-pusulasi:okunamayan-kayit-' + Date.now(), JSON.stringify(s)); } catch (e2) { /* */ } }
          toast('Kayıtlı veri doğrulanamadı; eski kayıt ayrı bir anahtara yedeklendi ve örnek veri açıldı. (Hata: ' + e.message + ')');
        }
      }
      if (!state) { state = S.exampleState(); persist(); }
    }).catch(function (e) { console.error(e); if (e && e.code === 'LOCKED') { location.reload(); return; } state = S.exampleState(); }).then(function () {
      // Gizli anahtarlar (yapay zekâ, Twelve Data, eşitleme): eski açık metin kayıtlar şifreli kayda taşınır
      return Store.migrateSecrets().then(function () { return Store.loadApiKeys(); }).then(function (k) { aiCfg.keys = k.ai; }).catch(function (e) { console.error(e); });
    }).then(function () {
      if (!state) return;
      setView(state.settings.view || 'simple');
      if (recordNw()) persist();
      route();
      maybeNotify();
      if (HUI) HUI.start();
      SUI.start();
      registerSW();
    });
  }
  /* Çevrimdışı kabuk (sw.js). Yalnızca http(s) üzerinde; file:// ile açılınca kaydedilmez.
   * Yeni sürüm bulunursa kendiliğinden geçilmez: "Yeni sürüm hazır" bildirimi çıkar, kullanıcı "Yenile" deyince geçilir. */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var reloading = false;
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      if (!reg) return;
      function prompt(w) {
        if (!w || $('.sw-update')) return;
        var d = document.createElement('div'); d.className = 'sw-update'; d.setAttribute('role', 'status');
        d.innerHTML = '<span>Yeni sürüm hazır. Verilerin etkilenmez.</span><button class="btn small primary" type="button">Yenile</button><button class="btn small" type="button">Sonra</button>';
        d.querySelectorAll('button')[0].onclick = function () { w.postMessage('SKIP_WAITING'); };
        d.querySelectorAll('button')[1].onclick = function () { d.remove(); };
        document.body.appendChild(d);
      }
      if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing; if (!w) return;
        w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
      });
      navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloading) return; reloading = true; location.reload(); });
    }).catch(function (e) { console.warn('Çevrimdışı mod açılamadı:', e && e.message); });
  }
  init();
})();
