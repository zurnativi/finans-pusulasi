/* hub-ui.js — Haberler bölümü (akış, takvim ve senaryolar, bildirimler, ayarlar), başlıktaki zil, Ana sayfa duygu durumu kartı, varlık sayfası olay kartı.
 * Hesaplar news.js / events.js / notify.js / mood.js'te (testli); veri hubdata.js'te. Bu dosya yalnızca gösterir ve kullanıcı eylemini kaydeder. */
(function () {
  'use strict';
  window.HubUI = function (X) {
    var N = window.News, EV = window.Events, NT = window.Notify, MO = window.Mood, HD = window.HubData, esc = X.esc;
    var ui = { f: { scope: 'all', topic: 'all', region: 'all', imp: 'medium', sort: 'rank', q: '', src: 'all' }, limit: 30, nf: { cat: 'all', sev: 'all', unread: false, hist: false }, open: {}, busy: false, err: null, kap: [], kapAt: 0, runAt: 0, procKey: '', proc: null };
    var TOPICS = (window.NewsRules.topics || []).map(function (t) { return [t.id, t.label]; }).concat([['company', 'Şirket / KAP']]);
    var SEVC = { critical: 'sev-critical', high: 'sev-high', medium: 'sev-medium', info: 'sev-info', low: 'sev-info' };
    var SEVL = { critical: 'Kritik', high: 'Yüksek', medium: 'Orta', info: 'Bilgi', low: 'Düşük' };
    var TAB_HASH = { '': 'akis', takvim: 'takvim', bildirim: 'bildirim', ayar: 'ayar', durum: 'durum' };
    function st() { return X.state(); }
    function settings() { var s = st(); return NT.cleanSettings(s && s.notifSettings); }
    function logOf() { var s = st(); return NT.cleanLog(s && s.notifLog); }
    /* ---------- biçim ---------- */
    function tsi(ms) { return new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' TSİ'; }
    function tsiIso(iso) { var m = iso ? Date.parse(iso) : NaN; return isFinite(m) ? tsi(m) : (iso || '—'); }
    function dmy(ymd) { return ymd ? ymd.slice(8, 10) + '.' + ymd.slice(5, 7) + '.' + ymd.slice(0, 4) : '—'; }
    function rel(ms, now) { var d = (now || Date.now()) - ms, m = Math.round(d / 60000); if (!isFinite(m)) return ''; if (m < 0) return 'şimdi'; if (m < 60) return Math.max(1, m) + ' dk önce'; var h = Math.round(m / 60); if (h < 48) return h + ' sa önce'; return Math.round(h / 24) + ' gün önce'; }
    function url(u) { return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null; }
    function ext(u, text) { var x = url(u); return x ? '<a href="' + esc(x) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + ' ↗</a>' : esc(text); }
    function pc1(x) { return (x * 100).toFixed(1).replace('.', ','); }
    function sg(x, d) { if (x == null || !isFinite(x)) return '—'; return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d == null ? 1 : d).replace('.', ',') + '%'; }
    function sevPill(s) { return '<span class="sev ' + (SEVC[s] || 'sev-info') + '">' + esc(SEVL[s] || s) + '</span>'; }
    function holdings() {
      var c; try { c = X.calc(); } catch (e) { return []; } var A = X.aui();
      return c.pos.filter(function (p) { return p.valueTL > 0 && !p.synthetic; }).map(function (p) {
        var a = p.asset; return { key: (a && A && A.keyOfAsset(a)) || (a ? 'a:' + a.id : 'acc:' + p.name), name: p.name, sym: a ? a.symbol : null, cls: a ? a.cls : 'cash', value: p.valueTL, halal: p.halal, asset: a };
      });
    }
    function total(h) { return h.reduce(function (s, x) { return s + x.value; }, 0); }
    function hasData() { var d = HD.get(); return !!(d && (d.feed || d.calendar)); }

    /* ---------- Veri + motor ---------- */
    function procNews(d, hold) {
      var key = (d.loadedAt || 0) + '|' + hold.map(function (h) { return h.key + h.value; }).join(',') + '|' + ui.kapAt, t = Date.now();
      if (ui.procKey === key && ui.proc) return ui.proc;
      var items = ((d.feed && d.feed.items) || []).concat(ui.kap);
      ui.proc = N.process(items, hold, t); ui.procKey = key; return ui.proc;
    }
    function loadKap(hold) {
      if (Date.now() - ui.kapAt < 10 * 60000) return Promise.resolve();
      var seen = {}, syms = hold.filter(function (h) { return /^bist:/.test(h.key); }).filter(function (h) { var s = h.key.slice(5); if (seen[s]) return false; seen[s] = 1; return true; }).slice(0, 15);
      if (!syms.length) { ui.kap = []; ui.kapAt = Date.now(); return Promise.resolve(); }
      return Promise.all(syms.map(function (h) { var s = h.key.slice(5); return window.MData.kap(s).then(function (j) { return (j.items || []).slice(0, 12).map(function (x) { return { t: s + ' — ' + x.subj, u: 'https://www.kap.org.tr/tr/Bildirim/' + x.i, s: 'KAP', a: new Date(Date.parse(x.at)).toISOString(), r: 'tr', o: 'KAP', kap: { tag: x.tag, tone: x.tone, key: h.key, sym: s } }; }); }, function () { return []; }); }))
        .then(function (arr) { ui.kap = [].concat.apply([], arr); ui.kapAt = Date.now(); });
    }
    function movesOf(s) {
      var out = [], now = Date.now();
      (s.assets || []).forEach(function (a) {
        var pk = a.priceKey && s.prices && s.prices[a.priceKey]; if (!pk || !pk.points || pk.points.length < 2) return; var p1 = pk.points[pk.points.length - 1], p0 = pk.points[pk.points.length - 2];
        if (!(p0.p > 0) || !(p1.p > 0) || EV.daysBetween(p0.d, p1.d) > 5 || EV.daysBetween(p1.d, EV.tsiYmd(now)) > 3) return;
        var tr = (s.trades || []).some(function (t) { return t.assetId === a.id; }); if (!tr) return;
        out.push({ key: a.id, name: a.name, pct: (p1.p - p0.p) / p0.p, asOf: p1.d, prevD: p0.d, src: p1.src || 'Fiyat geçmişi' });
      });
      return out;
    }
    function buildCtx(d, hold) {
      var s = st(), c = null; try { c = X.calc(); } catch (e) { c = null; } var A = X.aui(), now = Date.now();
      var firedList = ((s.analysis && s.analysis.alerts) || []).filter(function (a) { return a.triggeredAt && now - Date.parse(a.triggeredAt) < 7 * 86400000; }).map(function (a) {
        return { id: a.id, at: Date.parse(a.triggeredAt), title: a.name + ': ' + a.label + (a.dir === 'above' ? ' yukarı kesildi' : ' aşağı kesildi'), text: 'Seviye ' + a.price + ' · tetikleyen fiyat ' + a.firedPrice + ' (' + (a.firedSource || 'kaynak yok') + '). Alım/satım kararı vermeden önce güncel analizi aç.', name: a.name, src: a.firedSource, when: a.triggeredAt, href: '#analiz' };
      });
      var staleL = []; if (c) c.pos.forEach(function (p) { if (p.asset && p.asset.tracking === 'trades' && p.ledger && p.ledger.units > 0 && (!p.price || (p.stale && p.stale.level !== 'ok'))) staleL.push({ name: p.name, note: !p.price ? 'fiyat yok' : (p.stale && p.stale.label) || 'eski' }); });
      var procd = procNews(d, hold);
      return { now: now, settings: settings(), hold: hold, nw: s.nwHistory || [], isExample: !!s.isExample, nwIsSynthetic: !!s.nwExample, risk: c ? c.risk.items : [], emergency: c ? c.an.emergency : null, health: A && A.health ? A.health() : null,
        moves: movesOf(s), fired: firedList, stale: staleL, news: procd, events: EV.upcoming(d.calendar, now, 14), hub: { calendar: d.calendar, probs: d.probs, macro: d.macro, analogs: d.analogs, recovery: d.recovery, status: d.status }, server: (d.alerts && d.alerts.items) || [], meta: logOf().meta };
    }
    function deliver(items) {
      var S = settings(); if (!items.length || (X.state() && X.state().isExample)) return; // örnek veride ekran/tarayıcı bildirimi gönderilmez
      items.slice(0, 3).forEach(function (it) { if (it.sev === 'critical') X.toast('🔴 ' + it.title); });
      if (S.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        items.slice(0, 3).forEach(function (it) { var opt = { body: (it.body || '').slice(0, 200), tag: 'fp-' + it.id, silent: it.sev !== 'critical' }; try { new Notification('Finans Pusulası · ' + SEVL[it.sev] + ': ' + it.title.slice(0, 80), opt); } catch (e) { /* desteklenmiyor */ } });
      }
    }
    var running = false;
    function run(force) {
      if (running || !X.state()) return Promise.resolve();
      running = true; ui.busy = true;
      var hold = holdings();
      return Promise.all([HD.load(force).catch(function (e) { ui.err = e.message; return HD.get() || {}; }), loadKap(hold)]).then(function (r) {
        var d = r[0] || {}; ui.err = null; var ctx = buildCtx(d, holdings()), S = ctx.settings, log = logOf(), before = JSON.stringify(log);
        var res = NT.evaluate(ctx), fresh = NT.merge(log, res.cands, ctx.now, res.metaPatch), dl = NT.deliverable(log, fresh, S, ctx.now);
        if (JSON.stringify(log) !== before) X.quiet(function (s) { s.notifLog = log; });
        ui.runAt = ctx.now; deliver(dl);
      }).catch(function (e) { console.error(e); ui.err = e.message; }).then(function () { running = false; ui.busy = false; updateBell(); if (X.tab() === 'haberler' || X.tab() === 'ozet') X.render(); });
    }
    function start() {
      updateBell(); setTimeout(function () { run(false); }, 1500); setInterval(function () { run(false); if (bgOn()) bgPush(); }, 5 * 60000); if (bgOn()) setTimeout(bgPush, 4000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - ui.runAt > 5 * 60000) run(false); });
      document.addEventListener('click', onClick); document.addEventListener('change', onChange); document.addEventListener('input', onInput);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    }

    /* ---------- Zil ---------- */
    function updateBell() {
      var b = document.getElementById('bell-badge'), btn = document.getElementById('bell'); if (!btn || !b || !X.state()) return;
      var c = NT.counts(logOf(), settings(), Date.now());
      b.textContent = c.unread > 99 ? '99+' : String(c.unread); b.hidden = !c.unread; b.className = 'bell-badge ' + (c.maxSev === 'critical' ? 'sev-critical' : c.maxSev === 'high' ? 'sev-high' : 'sev-medium');
      btn.setAttribute('aria-label', c.unread ? 'Bildirimler: ' + c.unread + ' okunmamış' + (c.maxSev === 'critical' ? ', kritik var' : '') : 'Bildirimler: okunmamış yok');
      var p = document.getElementById('bell-panel'); if (p && !p.hidden) p.innerHTML = panelHtml();
    }
    function panelHtml() {
      var log = logOf(), S = settings(), now = Date.now(), list = NT.visible(log, S, now).filter(function (it) { return S.cats[it.cat].on; }).sort(function (a, b) { return NT.SEV[b.sev].rank - NT.SEV[a.sev].rank || b.lastAt - a.lastAt; }).slice(0, 6);
      return '<div class="bp-h"><b>Bildirimler</b><span><button class="btn small" data-hub="readall" type="button">Tümünü okundu yap</button> <button class="btn small" data-hub="closepanel" type="button" aria-label="Kapat">✕</button></span></div>' +
        (list.length ? '<ul class="bp-l">' + list.map(function (it) { return '<li class="' + (NT.isRead(log, it) ? '' : 'unread') + '"><a href="' + esc(it.href || '#haberler/bildirim') + '" data-hub="openn" data-id="' + esc(it.id) + '">' + sevPill(it.sev) + ' <b>' + esc(it.title) + '</b><small>' + esc(rel(it.lastAt, now)) + ' · ' + esc(NT.CATS[it.cat]) + '</small></a></li>'; }).join('') + '</ul>' : '<p class="muted bp-e">Şu an aktif bildirim yok. Portföyün, haberler ve takvim izleniyor.</p>') +
        '<div class="bp-f"><a href="#haberler/bildirim" data-hub="closepanel">Tüm bildirimler</a> · <a href="#haberler/ayar" data-hub="closepanel">Ayarlar</a></div>';
    }
    function togglePanel() { var p = document.getElementById('bell-panel'); if (!p) return; if (p.hidden) { p.innerHTML = panelHtml(); p.hidden = false; document.getElementById('bell').setAttribute('aria-expanded', 'true'); } else closePanel(); }
    function closePanel() { var p = document.getElementById('bell-panel'); if (p && !p.hidden) { p.hidden = true; document.getElementById('bell').setAttribute('aria-expanded', 'false'); } }

    /* ---------- Yardımcı parçalar ---------- */
    function srcLine(d) {
      var f = d.files || {}, g = f.feed || f.calendar || null, errs = Object.keys(d.errors || {}), staleK = Object.keys(d.stale || {});
      return '<p class="hint hub-src">Veri: GitHub Actions ile otomatik üretilir (market-data dalı). Son üretim: ' + esc(g ? tsiIso(g) : '—') + (staleK.length ? ' · <b class="neg">Ağ hatası: ' + esc(staleK.join(', ')) + ' için son kopya gösteriliyor (güncel değil)</b>' : '') + (errs.length && !staleK.length ? ' · <b class="neg">Alınamadı: ' + esc(errs.join(', ')) + '</b>' : '') + '</p>';
    }
    function tabsNav(cur) {
      var nav = [['', 'Haber akışı'], ['takvim', 'Takvim ve senaryolar'], ['bildirim', 'Bildirimler'], ['ayar', 'Bildirim ayarları'], ['durum', 'Kaynaklar ve güncelleme']], c = NT.counts(logOf(), settings(), Date.now());
      return '<nav class="areanav" aria-label="Haberler bölümleri">' + nav.map(function (x) { return '<a href="#haberler' + (x[0] ? '/' + x[0] : '') + '"' + (cur === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + (x[0] === 'bildirim' && c.unread ? ' <span class="cnt">' + c.unread + '</span>' : '') + '</a>'; }).join('') + '</nav>';
    }
    function loading() {
      if (hasData()) return '';
      return '<section class="card"><h2>Veri yükleniyor</h2><p class="muted">' + (ui.err ? '<b class="neg">Haber merkezi verisi alınamadı: ' + esc(ui.err) + '</b>. Bağlantını kontrol et; <button class="btn small" data-hub="refresh" type="button">Yeniden dene</button>' : 'Haberler, takvim ve olasılıklar yükleniyor…') + '</p></section>';
    }
    function groupChip(g, e) { var G = N.GROUPS[g]; return '<span class="gchip d-' + e.d + '" title="' + esc(G.label + ' — ' + e.t) + '">' + EV.DIR_ICON[e.d] + ' ' + esc(G.short) + '</span>'; }
    function pbar(label, p, cls, sub) { var w = Math.max(1, Math.round(p * 100)); return '<div class="pbar ' + (cls || '') + '"><div class="pbar-l"><span>' + esc(label) + '</span><b>%' + (p < 0.1 ? (p * 100).toFixed(1).replace('.', ',') : Math.round(p * 100)) + '</b></div><div class="pbar-t"><i style="width:' + w + '%"></i></div>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>'; }
    function spark(vals, up) {
      if (!vals || vals.length < 2) return ''; var w = 84, h = 24, mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), r = mx - mn || 1;
      var pts = vals.map(function (v, i) { return (i * (w - 2) / (vals.length - 1) + 1).toFixed(1) + ',' + (h - 2 - (v - mn) / r * (h - 4)).toFixed(1); }).join(' ');
      return '<svg class="spark ' + (up ? 'up' : 'dn') + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline fill="none" stroke-width="1.6" points="' + pts + '"/></svg>';
    }

    /* ======================= HABER AKIŞI ======================= */
    function filtered(procd) {
      var f = ui.f, q = N.fold(f.q || ''), rank = { low: 0, medium: 1, high: 2, critical: 3 };
      return procd.filter(function (it) {
        if (f.scope === 'mine' && !it.mine) return false;
        if (f.topic !== 'all' && it.imp.topics.indexOf(f.topic) < 0) return false;
        if (f.region === 'tr' && it.r !== 'tr') return false; if (f.region === 'global' && it.r === 'tr') return false; if (f.region === 'official' && !it.o) return false;
        if (f.imp !== 'all' && rank[it.imp.level] < rank[f.imp] && !(it.mine && it.exp.direct && rank[it.imp.level] >= 1)) return false;
        if (f.src !== 'all' && it.s !== f.src) return false;
        if (q && N.fold(it.t).indexOf(q) < 0) return false; return true;
      }).sort(function (a, b) { return f.sort === 'time' ? ((a.a || '') < (b.a || '') ? 1 : -1) : (b.imp.rank + (b.mine ? 8 : 0)) - (a.imp.rank + (a.mine ? 8 : 0)); });
    }
    function newsItem(it, now) {
      var at = it.a ? Date.parse(it.a) : NaN, badges = [];
      if (it.o) badges.push('<span class="bd off">Resmî · ' + esc(it.o) + '</span>');
      var dir = it.matches.filter(function (m) { return m.kind === 'direct'; }), ind = it.matches.filter(function (m) { return m.kind !== 'direct'; }), byG = {};
      dir.slice(0, 4).forEach(function (m) { badges.push('<span class="bd mine" title="' + esc(m.why) + '">★ Portföyünde: ' + esc(m.h.name) + '</span>'); });
      if (dir.length > 4) badges.push('<span class="bd mine">+' + (dir.length - 4) + ' varlık daha</span>');
      ind.forEach(function (m) { var g = N.groupOf(m.h); (byG[g] = byG[g] || []).push(m); });
      Object.keys(byG).forEach(function (g) { badges.push('<span class="bd topic" title="' + esc(byG[g].map(function (m) { return m.h.name; }).join(', ') + ' — ' + byG[g][0].why) + '">◦ Dolaylı: ' + esc(N.GROUPS[g].short) + (byG[g].length > 1 ? ' (' + byG[g].length + ' varlık)' : ': ' + esc(byG[g][0].h.name)) + '</span>'); });
      if (it.n > 1) badges.push('<span class="bd">' + it.n + ' kaynak</span>');
      var topics = it.imp.topics.map(function (t) { return N.topicLabel(t); });
      return '<li class="nw ' + (SEVC[it.imp.level] || '') + '"><div class="nw-h">' + sevPill(it.imp.level) + ' ' + (url(it.u) ? '<a href="' + esc(it.u) + '" target="_blank" rel="noopener noreferrer">' + esc(it.t) + '</a>' : esc(it.t)) + '</div>' +
        '<div class="nw-m">' + esc(it.s || '') + ' · ' + (isFinite(at) ? esc(rel(at, now)) + ' · ' + esc(tsi(at)) : 'saat yok') + (topics.length ? ' · ' + esc(topics.slice(0, 3).join(', ')) : '') + '</div>' + (badges.length ? '<div class="nw-b">' + badges.join('') + '</div>' : '') +
        '<div class="detail-only nw-d"><small><b>Önem puanı ' + it.imp.score + '/100</b>' + (it.imp.notes.length ? ' — ' + esc(it.imp.notes.join('; ')) : ' — kural eşleşmesi yok (düşük)') + '. Yöntem: anahtar kelime kuralı (yapay zekâ değil).</small>' +
        (it.srcs.length > 1 ? '<small> Diğer kaynaklar: ' + it.srcs.slice(1, 5).map(function (s) { return ext(s.u, s.s); }).join(', ') + '</small>' : '') + '</div></li>';
    }
    function seg(key, cur, opts) { return '<div class="seg" role="group">' + opts.map(function (o) { return '<button type="button" data-hubf="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }
    function opts(list, cur) { return list.map(function (t) { return '<option value="' + t[0] + '"' + (cur === t[0] ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join(''); }
    function renderFeed() {
      var d = HD.get() || {}, hold = holdings(), h = '', now = Date.now(); if (!hasData()) return loading();
      var procd = procNews(d, hold), list = filtered(procd), shown = list.slice(0, ui.limit), f = ui.f, nmine = procd.filter(function (x) { return x.mine && x.imp.level !== 'low'; }).length;
      var hi = procd.filter(function (x) { return (x.imp.level === 'critical' || x.imp.level === 'high') && x.a && now - Date.parse(x.a) < 24 * 3600000; });
      var last = (d.feed && d.feed.generatedAt) || null;
      h += '<section class="card hub-sum"><div class="hub-kpis">' +
        '<div><span class="k">Son 24 saatte kritik/yüksek</span><b class="' + (hi.length ? 'neg' : '') + '">' + hi.length + '</b><small>haber</small></div>' +
        '<div><span class="k">Portföyünle ilgili</span><b>' + nmine + '</b><small>haber (orta ve üstü)</small></div>' +
        '<div><span class="k">Toplam başlık</span><b>' + procd.length + '</b><small>tekrarlar birleştirildi · ' + ((d.feed && d.feed.items && d.feed.items.length) || 0) + ' ham</small></div>' +
        '<div><span class="k">Son güncelleme</span><b class="sm">' + esc(last ? tsiIso(last) : '—') + '</b><small><button class="btn small" data-hub="refresh" type="button"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Yenileniyor…' : 'Yenile') + '</button></small></div></div>' + srcLine(d) + '</section>';
      h += '<section class="card hub-filters" aria-label="Filtreler"><div class="flt">' + seg('scope', f.scope, [['all', 'Tümü'], ['mine', '★ Portföyümle ilgili']]) +
        '<label>Sınıf <select data-hubf="topic">' + opts([['all', 'Hepsi']].concat(TOPICS), f.topic) + '</select></label>' +
        '<label>Bölge <select data-hubf="region">' + opts([['all', 'Hepsi'], ['tr', 'Türkiye'], ['global', 'Küresel'], ['official', 'Yalnız resmî kurum']], f.region) + '</select></label>' +
        '<label>Önem <select data-hubf="imp">' + opts([['critical', 'Yalnız kritik'], ['high', 'Yüksek ve üstü'], ['medium', 'Orta ve üstü'], ['all', 'Hepsi (düşük dahil)']], f.imp) + '</select></label>' +
        '<label>Kaynak <select data-hubf="src">' + opts([['all', 'Hepsi']].concat(srcNames(d).map(function (n) { return [n, n]; })), f.src) + '</select></label>' +
        '<label>Sıra <select data-hubf="sort">' + opts([['rank', 'Önem'], ['time', 'Zaman']], f.sort) + '</select></label>' +
        '<input type="search" id="hub-q" data-hubf="q" placeholder="Haberlerde ara" value="' + esc(f.q) + '" aria-label="Haberlerde ara"></div></section>';
      h += '<section class="card"><h2>Haberler <small class="muted">(' + list.length + ' sonuç)</small></h2>' + (hold.length ? '' : '<p class="hint">Portföyünde varlık yok; “Portföyümle ilgili” etiketleri varlık ekleyince çıkar.</p>') +
        (shown.length ? '<ul class="nwl">' + shown.map(function (it) { return newsItem(it, now); }).join('') + '</ul>' : '<p class="muted">Bu filtrelerle haber yok. ' + (f.imp !== 'all' ? '<button class="btn small" data-hub="allimp" type="button">Düşük önemlileri de göster</button>' : '') + '</p>') +
        (list.length > shown.length ? '<p><button class="btn" data-hub="more" type="button">Daha fazla göster (' + (list.length - shown.length) + ')</button></p>' : '') +
        '<p class="hint">Kaynaklar: TR ve küresel RSS akışları (Bloomberg HT, ForInvest, TRT Haber, Habertürk, Dünya, Ekonomim, BBC, NYT, Guardian, MarketWatch, CNBC, Investing.com), Fed ve ECB basın duyuruları (resmî), elindeki BIST hisseleri için KAP bildirimleri (resmî). Yalnız başlık, bağlantı ve saat saklanır; içerik kopyalanmaz. Önem puanı anahtar kelime kuralıdır; “kritik” için kriz/karar anahtar kelimesi VE (resmî kurum veya en az 2 ayrı kaynak) aranır; “yüksek” için bunlardan biri yeter; tek kaynaklı ve yumuşak anahtar kelimeli haber en fazla “orta” olur.</p></section>';
      return h;
    }

    /* ======================= TAKVİM VE SENARYOLAR ======================= */
    function macroStrip(d) {
      var m = d.macro; if (!m || !m.items) return '<p class="muted">Piyasa verisi alınamadı.</p>';
      return '<div class="mstrip">' + m.items.map(function (i) {
        var up = i.chg1d >= 0, isY = i.k === 'US10Y', val = i.last >= 1000 ? Math.round(i.last).toLocaleString('tr-TR') : i.last.toFixed(2).replace('.', ',');
        return '<div class="mcell" title="' + esc(i.src + ' · ' + tsiIso(i.asOf)) + '"><span class="k">' + esc(i.label) + '</span><b>' + esc(val) + '</b><span class="' + (up ? 'pos' : 'neg') + '">' + sg(i.chg1d) + ' <small class="muted">g.</small></span>' + spark(i.spark, up) + '</div>'; }).join('') + '</div>' +
        '<p class="hint">Kaynak: Yahoo Finance grafik uç noktası (resmî olmayan, gecikmeli olabilir) · ' + esc(tsiIso(m.generatedAt)) + '. Mini grafik son ~40 işlem günüdür. ABD 10 yıllık için % değişim faizin kendi değişimidir (baz puan değil).</p>';
    }
    function rateCards(d) {
      var m = d.macro && d.macro.rates, sv = d.probs && d.probs.survey, out = '';
      if (m) out += '<div class="rcards">' +
        (m.cbrt ? '<div class="rc"><span class="k">TCMB politika faizi</span><b>%' + EV.fmtN(m.cbrt.rate) + '</b><small>' + (m.cbrt.prev != null ? 'önceki %' + EV.fmtN(m.cbrt.prev) + ' · ' : '') + esc(dmy(m.cbrt.since)) + ' · ' + ext(m.cbrt.url, 'TCMB') + '</small></div>' : '') +
        (m.fed ? '<div class="rc"><span class="k">Fed hedef aralığı</span><b>%' + EV.fmtN(m.fed.from) + '–' + EV.fmtN(m.fed.to) + '</b><small>EFFR %' + EV.fmtN(m.fed.effr) + ' (' + esc(dmy(m.fed.asOf)) + ') · ' + ext(m.fed.url, 'NY Fed') + '</small></div>' : '') +
        (m.ecb ? '<div class="rc"><span class="k">ECB mevduat faizi</span><b>%' + EV.fmtN(m.ecb.depositRate) + '</b><small>' + esc(dmy(m.ecb.asOf)) + ' · ' + ext(m.ecb.url, 'ECB') + '</small></div>' : '') + '</div>';
      if (sv && sv.rateSeries) out += '<div class="card-in">' + window.Charts.custom('hub-path', 200, 'TCMB politika faizi beklenti patikası (anket ortalaması)', function (t) {
        var rs = sv.rateSeries, pts = [['Şimdi', sv.currentRate.rate], ['1. toplantı', rs.meeting1], ['2. toplantı', rs.meeting2], ['3. toplantı', rs.meeting3], ['12 ay sonra', rs.m12], ['24 ay sonra', rs.m24]].filter(function (x) { return x[1] != null; });
        return { animation: !window.Charts.reduced(), grid: { left: 40, right: 16, top: 18, bottom: 28 }, tooltip: window.Charts.tooltip(t, { trigger: 'axis', valueFormatter: function (v) { return '%' + EV.fmtN(v); } }), xAxis: { type: 'category', data: pts.map(function (x) { return x[0]; }), axisLabel: { color: t.muted, fontSize: 11 }, axisLine: { lineStyle: { color: t.line } } }, yAxis: { type: 'value', scale: true, axisLabel: { color: t.muted, formatter: '%{value}' }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ type: 'line', data: pts.map(function (x) { return x[1]; }), symbolSize: 8, lineStyle: { width: 3, color: t.brand }, itemStyle: { color: t.brand }, label: { show: true, color: t.ink, fontSize: 11, position: 'top', formatter: function (p) { return '%' + EV.fmtN(p.value); } } }] };
      }) + '<p class="hint">Kaynak: ' + ext(sv.url, 'TCMB Piyasa Katılımcıları Anketi — ' + sv.period) + '. Bu bir <b>beklenti ortalamasıdır, olasılık değildir</b>; katılımcı dağılımı yayımlanmadığı için faiz kararına yüzde olasılık verilemez.' + (sv.stale ? ' <b class="neg">(son alınabilen kopya)</b>' : '') + '</p></div>';
      return out;
    }
    function cpiDist(d) {
      var sv = d.probs && d.probs.survey; if (!sv || !sv.cpi12mDist || !sv.cpi12mDist.length) return '';
      return '<div class="card-in"><h3>12 ay sonrası enflasyon — TCMB’nin yayımladığı olasılık dağılımı</h3>' + sv.cpi12mDist.map(function (b) { return pbar('%' + EV.fmtN(b.lo) + ' – %' + EV.fmtN(b.hi), b.p); }).join('') +
        '<p class="hint">Kaynak: ' + ext(sv.url, 'TCMB PKA ' + sv.period) + ' — katılımcıların olasılık tahminlerinin ortalaması (metinde yalnız en yüksek üç aralık yayımlanır; kalan olasılık diğer aralıklardadır). Cari yıl sonu TÜFE beklentisi %' + EV.fmtN(sv.cpiYearEnd.now) + (sv.usdtry ? ' · yıl sonu USD/TL beklentisi ' + EV.fmtN(sv.usdtry.yearEnd) : '') + '.</p></div>';
    }
    function analogHtml(ar, key, detail) {
      if (!ar) return '<p class="muted"><small>Bu senaryo için tarihsel olay sınıfı yok (uydurma sayı gösterilmez).</small></p>';
      var r0 = ar.rows[0], line = r0 ? esc(ar.label) + ' (n=' + ar.n + '): ' + esc(r0.label) + ' ilk gün <b>' + sg(r0.d1.median) + '</b> · 5 işlem günü ' + sg(r0.d5.median) + ' · 20 işlem günü ' + sg(r0.d20.median) + ' (medyan; ilk gün pozitif oran %' + Math.round((r0.d1.pos || 0) * 100) + ')' : esc(ar.label) + ' (n=' + ar.n + ')';
      var h = '<div class="an">' + line + (ar.small ? '<div class="warnline">n ≤ 5: örnek çok küçük — yorum yapma, olayları tek tek incele.</div>' : '') + '</div>';
      if (detail && ar.rows.length) {
        h += window.Charts.custom('hub-an-' + key, 190, ar.label + ' — varlıklara etkisi (medyan getiri)', function (t) {
          return { animation: !window.Charts.reduced(), grid: { left: 44, right: 10, top: 26, bottom: 30 }, legend: { top: 0, textStyle: { color: t.muted, fontSize: 11 } }, tooltip: window.Charts.tooltip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: function (v) { return v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + '%'; } }),
            xAxis: { type: 'category', data: ar.rows.map(function (r) { return r.label + ' (n=' + r.d1.n + ')'; }), axisLabel: { color: t.muted, fontSize: 10, interval: 0 }, axisLine: { lineStyle: { color: t.line } } }, yAxis: { type: 'value', axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: t.line } } },
            series: [['İlk gün', 'd1'], ['5 işlem günü', 'd5'], ['20 işlem günü', 'd20']].map(function (s, i) { return { name: s[0], type: 'bar', data: ar.rows.map(function (r) { return r[s[1]].median == null ? null : +(r[s[1]].median * 100).toFixed(2); }), itemStyle: { color: t.pal[i] } }; }) };
        });
        h += '<details class="evlist"><summary>' + ar.events.length + ' olayın tamamı (kaynak bağlantılı)</summary><ul class="evl">' + ar.events.slice(-30).map(function (e) { return '<li>' + esc(dmy(e.date)) + ' — ' + esc(e.title) + (e.src ? ' · ' + ext(e.src, 'kaynak') : '') + '</li>'; }).join('') + '</ul><p class="hint">Yöntem: ' + esc(((HD.get() || {}).analogs || {}).method || '') + '</p></details>';
      }
      return h;
    }
    function scenarioTable(ev, d, hold, groups) {
      var pr = EV.probsFor(ev, d), h = '<div class="tablewrap"><table class="sc stack"><thead><tr><th>Senaryo</th><th>Olasılık</th><th>Genel etki (varlık grupları)</th><th>Senin portföyün</th><th>Tarihsel benzer</th></tr></thead><tbody>';
      ev.ti.scen.forEach(function (sc) {
        var p = EV.probOfScenario(sc, pr), im = EV.holdingImpact(sc, hold), ar = sc.analog ? EV.analogRows(d.analogs, sc.analog, groups) : null;
        var effs = Object.keys(sc.effects).filter(function (g) { return groups.indexOf(g) >= 0 || !groups.length; });
        h += '<tr><td data-label="Senaryo"><b>' + esc(sc.label) + '</b></td><td data-label="Olasılık">' + (p != null ? '<b>%' + Math.round(p * 100) + '</b><br><small class="muted">' + esc(pr.source) + '</small>' : '<span class="muted">kaynak yok</span>') + '</td>' +
          '<td data-label="Genel etki">' + effs.map(function (g) { return groupChip(g, sc.effects[g]); }).join(' ') + '<div class="detail-only"><small>' + Object.keys(sc.effects).map(function (g) { return '<b>' + esc(N.GROUPS[g].short) + ':</b> ' + esc(sc.effects[g].t); }).join('<br>') + '</small></div></td>' +
          '<td data-label="Senin portföyün">' + (im.total > 0 ? (im.pct.down > 0 ? '<span class="neg">%' + Math.round(im.pct.down * 100) + ' olumsuz</span> · ' : '') + (im.pct.up > 0 ? '<span class="pos">%' + Math.round(im.pct.up * 100) + ' olumlu</span> · ' : '') + '<span class="muted">%' + Math.round((im.pct.mixed + im.pct.flat) * 100) + ' karışık/sınırlı</span>' : '<span class="muted">varlık yok</span>') + '</td>' +
          '<td data-label="Tarihsel benzer">' + analogHtml(ar, ev.id.replace(/[^a-z0-9]/gi, '') + sc.id, true) + '</td></tr>';
      });
      return h + '</tbody></table></div><p class="hint">Etki sütunu “genel iktisat çerçevesi”dir (yön + gerekçe); kesin sonuç veya tahmin değildir. Beklenti zaten fiyatlandıysa tepki küçük olur: etkiyi <b>beklenti ile sonuç farkı</b> belirler. Sayısal kanıt yalnız “Tarihsel benzer” sütunundadır (gerçek veri, n ile).</p>';
    }
    function eventCard(ev, d, hold, groups, openIt) {
      var exp = EV.expectation(ev, d), pr = EV.probsFor(ev, d), kindL = ev.kind === 'official' ? 'Resmî takvim' : ev.kind === 'rule' ? 'Kural tarihi (resmî takvimle doğrulanmadı)' : ev.kind === 'market-derived' ? 'Piyasa kapanış saatinden' : 'Takvim';
      var h = '<article class="evc ' + (ev.phase === 'today' || ev.phase === 'tomorrow' ? 'soon' : '') + '"><header><div class="evd"><b>' + esc(dmy(ev.date)) + '</b><small>' + (ev.time ? esc(ev.time) + ' TSİ' : 'saat belli değil') + '</small></div><div class="evt"><h3>' + esc(ev.ti ? ev.ti.label : ev.title) + ' <span class="when">' + esc(EV.whenText(ev)) + '</span></h3><small class="muted">' + esc(ev.title) + ' · ' + esc(kindL) + (ev.source && ev.source.url ? ' · ' + ext(ev.source.url, ev.source.name || 'kaynak') : '') + '</small></div></header>';
      if (exp) h += '<p class="exp"><b>Beklenti:</b> ' + esc(exp.text) + ' · ' + ext(exp.src && exp.src.url, exp.src && exp.src.name || 'kaynak') + '</p>';
      if (pr && pr.by) h += '<div class="probs"><h4>Olasılıklar — ' + esc(pr.source) + ' (' + ext(pr.url, 'kaynak') + ')</h4>' + ev.ti.scen.filter(function (s) { return pr.by[s.code] != null; }).map(function (s) { return pbar(s.label, pr.by[s.code], s.code === 'hike' || s.code === 'above' ? 'p-hi' : s.code === 'cut' || s.code === 'below' ? 'p-lo' : ''); }).join('') + '<small class="muted">' + esc(pr.note || '') + '</small></div>';
      else if (ev.type === 'cbrt_ppk') h += '<p class="notice info"><b>Olasılık verisi yok.</b> TCMB kararı için ücretsiz, güvenilir, piyasa fiyatlı bir olasılık kaynağı yok (Fed için Kalshi var; TCMB için yok) ve TCMB anketi yalnız ortalama yayımlar. Bu yüzden yüzde olasılık <b>uydurulmadı</b>. Elimizdeki gerçek veri: anket beklentisi, geçmiş kararlar ve tarihsel tepki tablosu.</p>';
      if (ev.ti) h += '<details class="sce" data-hubopen="' + esc(ev.id) + '"' + (openIt || ui.open[ev.id] ? ' open' : '') + '><summary>Senaryo analizi: ' + ev.ti.scen.map(function (s) { return esc(s.label); }).join(' / ') + '</summary>' + scenarioTable(ev, d, hold, groups) + '</details>';
      if (ev.type === 'cbrt_ppk') { var rec = EV.recentCbrtDecisions(d.analogs, 6); if (rec.length) h += '<details class="detail-only"><summary>Son TCMB faiz kararları</summary><ul class="evl">' + rec.map(function (r) { return '<li>' + esc(dmy(r.date)) + ' — ' + esc(r.title) + '</li>'; }).join('') + '</ul></details>'; }
      return h + '</article>';
    }
    function dataRows(evs) {
      if (!evs.length) return '<p class="muted">Bu hafta için yüksek/orta etkili veri takvimi alınamadı.</p>';
      return '<div class="tablewrap"><table class="stack"><thead><tr><th>Zaman (TSİ)</th><th>Ülke</th><th>Veri</th><th>Etki</th><th class="r">Beklenti</th><th class="r">Önceki</th><th class="r">Gerçekleşen</th><th>Sapma</th></tr></thead><tbody>' + evs.map(function (e) {
        var s = EV.surprise(e); return '<tr><td data-label="Zaman">' + esc(dmy(e.date)) + ' ' + esc(e.time || '') + '</td><td data-label="Ülke">' + esc(e.country || '') + '</td><td data-label="Veri">' + esc((e.title || '').replace(/^[A-Z]{3} — /, '')) + '</td><td data-label="Etki">' + (e.impact === 'high' ? '<span class="sev sev-high">Yüksek</span>' : '<span class="sev sev-medium">Orta</span>') + '</td><td class="r" data-label="Beklenti">' + esc(e.forecast || '—') + '</td><td class="r" data-label="Önceki">' + esc(e.previous || '—') + '</td><td class="r" data-label="Gerçekleşen">' + esc(e.actual || '—') + '</td><td data-label="Sapma">' + (s ? (s.code === 'inline' ? 'beklentiyle aynı' : s.code === 'above' ? '▲ üstünde' : '▼ altında') : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    function politicsCards(d, hold, groups) {
      var items = ((d.probs && d.probs.items) || []).filter(function (p) { return p.region === 'tr' || p.id === 'us_recession_2026' || p.id === 'rec26'; });
      if (!items.length) return '<p class="muted">Siyasi/jeopolitik olasılık verisi alınamadı.</p>';
      return items.map(function (p) {
        var pol = EV.POLITICS[p.id], sc = pol ? { id: 'x', label: pol.label, analog: pol.analog, effects: pol.effects } : null, im = sc ? EV.holdingImpact(sc, hold) : null, ar = sc && pol.analog ? EV.analogRows(d.analogs, pol.analog, groups) : null;
        return '<article class="evc"><header><div class="evt"><h3>' + esc(p.question) + '</h3><small class="muted">' + esc(p.source) + ' (piyasa fiyatı) · ' + ext(p.url, 'kaynak') + (p.volume ? ' · işlem hacmi $' + Math.round(p.volume).toLocaleString('tr-TR') : '') + '</small></div></header>' +
          '<div class="probs">' + (p.outcomes || []).map(function (o) { return pbar(o.label, o.p, '', o.bid != null && o.ask != null ? 'alış %' + (o.bid * 100).toFixed(1).replace('.', ',') + ' · satış %' + (o.ask * 100).toFixed(1).replace('.', ',') : null); }).join('') + '</div>' +
          (sc ? '<details class="sce" data-hubopen="' + esc(p.id) + '"' + (ui.open[p.id] ? ' open' : '') + '><summary>Gerçekleşirse: ' + esc(pol.label) + '</summary><div class="gcr">' + Object.keys(pol.effects).map(function (g) { return groupChip(g, pol.effects[g]); }).join(' ') + '<small>' + Object.keys(pol.effects).filter(function (g) { return pol.effects[g].d !== 'flat'; }).map(function (g) { return '<b>' + esc(N.GROUPS[g].short) + ':</b> ' + esc(pol.effects[g].t); }).join('<br>') + '</small></div>' +
            (im && im.total > 0 ? '<p>Senin portföyün: ' + (im.pct.down > 0 ? '<span class="neg">%' + Math.round(im.pct.down * 100) + ' olumsuz</span> · ' : '') + (im.pct.up > 0 ? '<span class="pos">%' + Math.round(im.pct.up * 100) + ' olumlu</span> · ' : '') + '%' + Math.round((im.pct.mixed + im.pct.flat) * 100) + ' karışık/sınırlı</p>' : '') + analogHtml(ar, p.id, true) + '</details>' : '') + '</article>';
      }).join('') + '<p class="hint">Kalshi ve Polymarket resmî olmayan tahmin piyasalarıdır; fiyatlar kalabalığın beklentisini yansıtır, kesinlik değildir. Alış/satış ortası alınır (fark 8 puandan büyükse son işlem).</p>';
    }
    function renderCalendar() {
      var d = HD.get() || {}, hold = holdings(), now = Date.now(), groups = (function () { var s = {}; hold.forEach(function (h) { s[N.groupOf(h)] = 1; }); return Object.keys(s); })(); if (!hasData()) return loading();
      var evs = EV.upcoming(d.calendar, now, 75), major = evs.filter(function (e) { return e.ti && e.impact === 'high' && e.phase !== 'past'; }), data = evs.filter(function (e) { return e.type === 'data' && e.phase !== 'past' && e.daysLeft <= 8; }), pastData = evs.filter(function (e) { return e.type === 'data' && (e.phase === 'past' || (e.ms <= now && e.actual != null)); }).slice(-6);
      var other = evs.filter(function (e) { return !e.ti && e.type !== 'data' && e.phase !== 'past'; }).slice(0, 8);
      var h = '<section class="card"><h2>Piyasa nabzı ve politika faizleri</h2>' + macroStrip(d) + rateCards(d) + '</section>';
      h += '<section class="card"><h2>Yaklaşan büyük olaylar ve senaryolar</h2><p class="hint">Her olay için: beklenti, (varsa) piyasa olasılığı, senaryolara göre varlık gruplarına genel etki, senin portföyüne yansıması ve geçmişte benzer olaylarda gerçekleşen fiyat tepkisi.</p>' +
        (major.length ? major.slice(0, 4).map(function (e, i) { return eventCard(e, d, hold, groups, i === 0); }).join('') : '<p class="muted">Önümüzdeki 75 günde yüksek etkili olay bulunamadı' + (d.errors && d.errors.calendar ? ' (takvim alınamadı: ' + esc(d.errors.calendar) + ')' : '') + '.</p>') +
        (major.length > 4 ? '<details class="more-ev"><summary>+' + (major.length - 4) + ' olay daha</summary>' + major.slice(4, 12).map(function (e) { return eventCard(e, d, hold, groups, false); }).join('') + '</details>' : '') + '</section>';
      h += '<section class="card"><h2>İzlenen siyasi ve jeopolitik riskler</h2>' + politicsCards(d, hold, groups) + '</section>';
      h += '<section class="card"><h2>Bu hafta veri takvimi</h2>' + dataRows(data.concat(pastData).sort(function (a, b) { return a.ms - b.ms; })) + '<p class="hint">Kaynak: ForexFactory haftalık takvim (resmî olmayan; yalnız yüksek/orta etkili USD, EUR, TRY, GBP, JPY, CNY). Gerçekleşen değer açıklanınca beklentiyle karşılaştırılır; sapma ≥ %10 ise bildirim gelir.</p></section>';
      h += '<section class="card detail-only"><h2>Diğer takvim kalemleri</h2><ul class="evl">' + other.map(function (e) { return '<li>' + esc(dmy(e.date)) + ' ' + esc(e.time || '') + ' — ' + esc(e.title) + ' <small class="muted">(' + esc(EV.whenText(e)) + (e.kind === 'rule' ? ', kural tarihi' : '') + ')</small></li>'; }).join('') + '</ul></section>';
      h += '<section class="card">' + (cpiDist(d) || '<p class="muted">TCMB enflasyon dağılımı alınamadı.</p>') + '</section>';
      return h + srcLine(d);
    }

    /* ======================= BİLDİRİMLER ======================= */
    function notifItem(it, log, now) {
      var read = NT.isRead(log, it), sn = NT.isSnoozed(log, it, now);
      return '<li class="nt ' + (SEVC[it.sev] || '') + (read ? '' : ' unread') + (it.resolvedAt ? ' resolved' : '') + '"><div class="nt-h">' + sevPill(it.sev) + '<span class="catp">' + esc(NT.CATS[it.cat]) + '</span>' + (it.origin === 'workflow' ? '<span class="catp" title="Sunucuda (GitHub Actions) üretildi">otomatik</span>' : '') + (it.resolvedAt ? '<span class="catp ok">çözüldü</span>' : '') + (sn ? '<span class="catp">ertelendi</span>' : '') + '<b>' + esc(it.title) + '</b></div>' +
        '<p>' + esc(it.body) + '</p>' + (it.assets.length ? '<div class="nw-b">' + it.assets.map(function (a) { return '<span class="bd topic">' + esc(a) + '</span>'; }).join('') + '</div>' : '') +
        '<div class="nt-m">' + esc(tsi(it.lastAt)) + ' · ' + esc(rel(it.lastAt, now)) + (it.count > 1 ? ' · ' + it.count + ' kez tekrarlandı' : '') + (it.sources.length ? ' · Kaynak: ' + it.sources.slice(0, 3).map(function (s) { return s.url ? ext(s.url, s.label) : esc(s.label); }).join(', ') : '') + '</div>' +
        '<details class="detail-only"><summary>Neden bu bildirim?</summary><ul>' + it.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></details>' +
        '<div class="nt-a">' + (read ? '' : '<button class="btn small" data-hub="read" data-id="' + esc(it.id) + '" type="button">Okundu</button> ') + '<details class="menu"><summary class="btn small">Ertele ▾</summary><div class="menu-b"><button class="btn small" data-hub="snooze" data-h="1" data-id="' + esc(it.id) + '" type="button">1 saat</button><button class="btn small" data-hub="snooze" data-h="24" data-id="' + esc(it.id) + '" type="button">Yarına</button><button class="btn small" data-hub="snooze" data-h="168" data-id="' + esc(it.id) + '" type="button">1 hafta</button></div></details> <button class="btn small" data-hub="dismiss" data-id="' + esc(it.id) + '" type="button" title="Bu bildirimi kapat; daha ağır hâle gelmedikçe yeniden çıkmaz">Kapat</button>' + (it.href ? ' <a class="btn small" href="' + esc(it.href) + '">Aç</a>' : '') + '</div></li>';
    }
    function renderNotifs() {
      var log = logOf(), S = settings(), now = Date.now(), nf = ui.nf, c = NT.counts(log, S, now);
      var list = NT.visible(log, S, now, { cat: nf.cat === 'all' ? null : nf.cat, sev: nf.sev === 'all' ? null : nf.sev, unread: nf.unread, history: nf.hist }).sort(function (a, b) { return NT.SEV[b.sev].rank - NT.SEV[a.sev].rank || b.lastAt - a.lastAt; });
      return '<section class="card"><div class="nt-top"><div><h2>Bildirimler</h2><p class="muted">' + c.unread + ' okunmamış · ' + c.active + ' aktif. Motor son çalışma: ' + esc(log.lastRun ? tsi(log.lastRun) : 'henüz çalışmadı') + '. Uygulama açıkken her 10 dakikada ve veri yenilenince çalışır.</p></div><div class="row"><button class="btn small" data-hub="runnow" type="button"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Kontrol ediliyor…' : 'Şimdi kontrol et') + '</button> <button class="btn small" data-hub="readall" type="button">Tümünü okundu yap</button></div></div>' +
        '<div class="flt"><label>Önem <select data-hubn="sev">' + opts([['all', 'Hepsi']].concat(['critical', 'high', 'medium', 'info'].map(function (s) { return [s, SEVL[s]]; })), nf.sev) + '</select></label><label>Kategori <select data-hubn="cat">' + opts([['all', 'Hepsi']].concat(Object.keys(NT.CATS).map(function (k) { return [k, NT.CATS[k]]; })), nf.cat) + '</select></label>' +
        '<label class="chk"><input type="checkbox" data-hubn="unread"' + (nf.unread ? ' checked' : '') + '> Yalnız okunmamış</label><label class="chk"><input type="checkbox" data-hubn="hist"' + (nf.hist ? ' checked' : '') + '> Geçmiş (çözülen/ertelenen dahil)</label></div>' +
        (list.length ? '<ul class="ntl">' + list.map(function (it) { return notifItem(it, log, now); }).join('') + '</ul>' : '<p class="muted">Bu filtrelerle bildirim yok. ' + (log.lastRun ? 'Portföyün, haberler ve takvim kontrol edildi: şu an eşiği aşan bir durum yok.' : '') + '</p>') +
        '<p class="hint">Bildirimler cihazında üretilir (portföy verin dışarı çıkmaz); piyasa geneli uyarılar ayrıca iş akışında üretilir ve uygulama kapalıyken de hesaplanır. Her bildirimde neden, kaynak ve saat vardır. Dil asla “sat” demez; “analizden sonra gözden geçir” der.</p></section>';
    }
    function setPath(obj, path, val) { var p = path.split('.'), o = obj; for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = val; }
    function renderSettings() {
      var S = settings(), perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission, h = '', tp = (S.ntfy && S.ntfy.topic) || '';
      h += '<section class="card"><h2>Kategori ayarları</h2><div class="tablewrap"><table class="stack"><thead><tr><th>Kategori</th><th>Açık</th><th>Dışarı bildir (tarayıcı/ekran)</th><th>Ne için</th></tr></thead><tbody>' +
        Object.keys(NT.CATS).map(function (k) { var c = S.cats[k]; return '<tr><td data-label="Kategori"><b>' + esc(NT.CATS[k]) + '</b></td><td data-label="Açık"><input type="checkbox" data-hubs="cats.' + k + '.on"' + (c.on ? ' checked' : '') + ' aria-label="' + esc(NT.CATS[k]) + ' açık"></td><td data-label="Dışarı bildir"><select data-hubs="cats.' + k + '.push" aria-label="' + esc(NT.CATS[k]) + ' bildirim eşiği">' + opts([['critical', 'Yalnız kritik'], ['high', 'Yüksek ve kritik'], ['medium', 'Orta ve üstü'], ['off', 'Kapalı (yalnız listede)']], c.push) + '</select></td><td data-label="Ne için"><small>' + esc(NT.CAT_HELP[k]) + '</small></td></tr>'; }).join('') + '</tbody></table></div></section>';
      h += '<section class="card"><h2>Sessiz saatler</h2><div class="flt"><label class="chk"><input type="checkbox" data-hubs="quiet.on"' + (S.quiet.on ? ' checked' : '') + '> Sessiz saatleri kullan</label> <label>Başlangıç <input type="time" data-hubs="quiet.from" value="' + S.quiet.from + '"></label> <label>Bitiş <input type="time" data-hubs="quiet.to" value="' + S.quiet.to + '"></label> <label class="chk"><input type="checkbox" data-hubs="quiet.critBypass"' + (S.quiet.critBypass ? ' checked' : '') + '> Kritik olanlar yine de bildirsin</label></div><p class="hint">Sessiz saatlerde tarayıcı/ekran bildirimi gönderilmez; bildirimler listede birikir (saat dilimi: TSİ).</p></section>';
      h += '<section class="card"><h2>Eşikler</h2><div class="grid two"><div><label>Portföy düşüşü — orta (%) <input type="number" step="1" min="1" max="50" data-hubs="thr.ddMedium" value="' + S.thr.ddMedium + '"></label><label>yüksek (%) <input type="number" step="1" min="2" max="70" data-hubs="thr.ddHigh" value="' + S.thr.ddHigh + '"></label><label>kritik (%) <input type="number" step="1" min="3" max="90" data-hubs="thr.ddCritical" value="' + S.thr.ddCritical + '"></label></div><div><label>Tek varlık günlük düşüş — yüksek (%) <input type="number" step="1" min="1" max="50" data-hubs="thr.move1d" value="' + S.thr.move1d + '"></label><label>kritik (%) <input type="number" step="1" min="2" max="80" data-hubs="thr.move1dCritical" value="' + S.thr.move1dCritical + '"></label><label>Haber kapsamı <select data-hubs="newsScope">' + opts([['portfolio', 'Yalnız portföyümle ilgili/kritik'], ['market', 'Genel piyasa haberleri de']], S.newsScope) + '</select></label></div></div><p class="hint">Net varlık düşüşü senin kayıtlarından hesaplanır; para girişi/çıkışı da değeri değiştirdiği için salt piyasa getirisi değildir.</p></section>';
      h += '<section class="card"><h2>Tarayıcı bildirimleri</h2><p>Durum: <b>' + (perm === 'granted' ? 'izin verildi' : perm === 'denied' ? 'engellendi (tarayıcı ayarlarından aç)' : perm === 'unsupported' ? 'bu tarayıcıda desteklenmiyor' : 'izin istenmedi') + '</b></p><div class="row">' +
        (perm === 'granted' ? '<label class="chk"><input type="checkbox" data-hubs="browser"' + (S.browser ? ' checked' : '') + '> Önemli bildirimleri tarayıcı bildirimi olarak göster</label> <button class="btn small" data-hub="testbrowser" type="button">Test bildirimi</button>' : perm === 'unsupported' || perm === 'denied' ? '' : '<button class="btn" data-hub="askbrowser" type="button">Tarayıcı bildirimlerini aç</button>') + '</div><p class="hint">Bildirimler yalnızca uygulama bir sekmede açıkken üretilir ve gösterilir (tarayıcı kısıtı). Kapalıyken telefona bildirim için aşağıdaki ntfy yolunu kullan.</p></section>';
      h += '<section class="card"><h2>Telefona anlık bildirim (isteğe bağlı): ntfy.sh</h2><p>Uygulama kapalıyken de çalışsın istiyorsan, <b>piyasa geneli kritik uyarılar</b> iş akışında hesaplanır ve ücretsiz <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer">ntfy.sh</a> servisi ile telefonuna gönderilebilir. <b>Portföyüne özel</b> uyarılar (varlık adı, tutar) gizlilik için asla dışarı gönderilmez; yalnız cihazında üretilir.</p>' +
        '<ol class="steps"><li>Aşağıdan tahmin edilemez bir konu adı üret (konu adı bir şifre gibidir; bilen herkes okuyabilir).</li><li>Telefonuna ntfy uygulamasını kur ve bu konuya abone ol.</li><li>GitHub’da <b>Settings → Secrets and variables → Actions → New repository secret</b> ile <code>NTFY_TOPIC</code> adlı sır oluşturup konu adını yapıştır (<a href="https://github.com/zurnativi/finans-pusulasi/settings/secrets/actions" target="_blank" rel="noopener noreferrer">doğrudan bağlantı</a>). İsteğe bağlı: <code>NTFY_MIN</code> (değişken) = <code>high</code> yaparsan yüksek önemliler de gelir.</li></ol>' +
        '<div class="row"><input type="text" id="ntfy-topic" data-hubs="ntfy.topic" value="' + esc(tp) + '" placeholder="örn. fp-9k2x7q4m1c8d" aria-label="ntfy konu adı" maxlength="64"> <button class="btn small" data-hub="ntfygen" type="button">Rastgele üret</button> <button class="btn small" data-hub="ntfytest" type="button"' + (tp ? '' : ' disabled') + '>Test gönder</button></div><p class="hint" id="ntfy-msg" role="status">' + esc(ui.ntfyMsg || '') + '</p><p class="hint">Konu adı yalnızca bu cihazda saklanır (eşitlenmez). Test mesajı doğrudan tarayıcından ntfy.sh’a gider; iş akışı ise sırdaki konuyu kullanır — ikisinin aynı olduğundan emin ol.</p></section>';
      return h + '<section class="card"><h2>Bildirim verisini temizle</h2><button class="btn danger small" data-hub="clearlog" type="button">Bildirim geçmişini sil</button> <button class="btn small" data-hub="resetset" type="button">Ayarları varsayılana döndür</button></section>';
    }

    /* ======================= GÜNCELLİK (v8.1) ======================= */
    function srcNames(d) { var o = {}; ((d.feed && d.feed.items) || []).forEach(function (i) { if (i.s && String(i.s).indexOf('GDELT') !== 0) o[i.s] = (o[i.s] || 0) + 1; }); return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }); }
    var FR = window.Fresh, JSHORT = { news: 'Haber', intraday: 'Seans içi', daily: 'Günlük', crypto: 'Kripto' };
    function freshEval() { var d = HD.get() || {}; return FR.evaluate(HD.statuses(d), Date.now()); }
    function freshStrip() {
      var d = HD.get(); if (!d || !FR) return ''; var ev = freshEval(), ai = d.analysisIdx;
      var dots = ev.jobs.map(function (j) { return '<span class="fr-j st-' + j.state + '" title="' + esc(j.label + ' — ' + j.text + (j.lastAt ? ' · son: ' + tsiIso(j.lastAt) : '')) + '"><i aria-hidden="true"></i>' + esc(JSHORT[j.id]) + ' <b>' + esc(j.lastAt ? FR.ageText(j.age) : '—') + '</b></span>'; }).join('');
      return '<a class="fresh-strip" href="#haberler/durum" aria-label="Veri güncelliği: ayrıntı için aç"><span class="fr-t">Arka plan verisi</span>' + dots + (ai && ai.generatedAt ? '<span class="fr-j st-ok"><i aria-hidden="true"></i>Analiz <b>' + esc(FR.ageText(Date.now() - Date.parse(ai.generatedAt))) + '</b></span>' : '') + '</a>' +
        (ev.banner ? '<div class="notice warn" role="alert">' + esc(ev.banner.text) + '</div>' : '');
    }
    function homeFresh() { var d = HD.get(); if (!d || !FR) return ''; return freshStrip(); }
    var SKIND = { official: 'resmî kurum', rss: 'RSS', html: 'liste sayfası (RSS yok)' };
    function renderStatus() {
      var d = HD.get() || {}, now = Date.now(); if (!hasData()) return loading(); var ev = freshEval(), srcs = FR.sources(d.sources, now), ai = d.analysisIdx, mid = d.sources && d.sources.midas;
      var h = '<section class="card"><h2>Arka plan işleri <small class="muted">— siten kapalıyken de çalışır</small></h2><div class="tablewrap"><table class="stack"><thead><tr><th>İş</th><th>Ne zaman çalışır</th><th>Son başarılı çalışma</th><th>Durum</th></tr></thead><tbody>' +
        ev.jobs.map(function (j) { return '<tr><td data-label="İş"><b>' + esc(j.label) + '</b></td><td data-label="Zamanlama">' + esc(j.every) + '</td><td data-label="Son çalışma">' + (j.lastAt ? esc(tsiIso(j.lastAt)) + ' <small class="muted">(' + esc(FR.ageText(j.age)) + ')</small>' + (j.run ? ' · <a href="' + esc(j.run) + '" target="_blank" rel="noopener noreferrer">kayıt ↗</a>' : '') : '—') + '</td><td data-label="Durum"><span class="pill ' + (j.state === 'ok' ? 'ok' : 'warn') + '">' + esc(j.text) + '</span></td></tr>'; }).join('') +
        '</tbody></table></div><p class="hint">Zamanlar GitHub Actions ile (ücretsiz) çalışır; GitHub zamanlanmış işleri dakikalarca hatta yarım saat geciktirebilir, bu yüzden “gecikmeli” uyarısı gevşek eşiklidir. Bir iş uzun süre çalışmazsa burada ve Haberler/Ana sayfada uyarı çıkar. Tarayıcın açıkken veri 5 dakikada bir yenilenir.</p></section>';
      h += '<section class="card"><h2>Haber kaynakları</h2>' + (srcs.length ? '<div class="tablewrap"><table class="stack"><thead><tr><th>Kaynak</th><th>Tür</th><th>Son çekme</th><th>En yeni haber</th><th>Başlık</th><th>Durum</th></tr></thead><tbody>' +
        srcs.map(function (x) { return '<tr><td data-label="Kaynak"><b>' + esc(x.name) + '</b></td><td data-label="Tür">' + esc(SKIND[x.kind] || x.kind || '') + '</td><td data-label="Son çekme">' + esc(x.fetchedAt ? FR.ageText(x.fetchedAgo) : '—') + '</td><td data-label="En yeni haber">' + esc(x.lastAt ? FR.ageText(x.lastAgo) : '—') + '</td><td data-label="Başlık">' + (x.n != null ? x.n : '—') + '</td><td data-label="Durum"><span class="pill ' + (x.state === 'ok' && x.n !== 0 ? 'ok' : x.state === 'fail' ? 'err' : 'warn') + '">' + (x.state === 'fail' ? 'alınamadı' + (x.err ? ' (' + esc(x.err) + ')' : '') : x.state === 'stale' ? 'eski' : x.n === 0 ? 'boş yanıt' : 'çalışıyor') + '</span></td></tr>'; }).join('') + '</tbody></table></div>' :
        '<p class="muted">Kaynak durumu henüz üretilmedi (haber işi ilk çalışmasını bekliyor).</p>') + '<p class="hint">Yalnız başlık, bağlantı ve saat saklanır; içerik kopyalanmaz, her haber kaynağına bağlanır.</p></section>';
      h += '<section class="card"><h2>Midas’ın Kulakları</h2><p>' + (mid && mid.ok ? '<span class="pill ok">çalışıyor</span> ' : mid ? '<span class="pill err">alınamadı</span> ' : '<span class="pill warn">henüz çekilmedi</span> ') + 'Midas’ın Kulakları (<a href="https://www.getmidas.com/midasin-kulaklari/" target="_blank" rel="noopener noreferrer">getmidas.com ↗</a>) haber akışına eklendi. Sitenin <code>robots.txt</code> dosyası bu bölümü yasaklamıyor; resmî bir RSS akışı yok (genel <code>/feed/</code> başka içerik veriyor), bu yüzden herkese açık liste sayfası nazikçe (≈20 dakikada tek istek, kimlikli kullanıcı etiketiyle) okunur. Yalnız <b>başlık, bağlantı, tarih ve okuma süresi</b> saklanır; yazı metni kopyalanmaz — başlığa dokunmak Midas’a götürür.' +
        (mid && mid.ok ? ' Son okuma: ' + (mid.n || 0) + ' makale görüldü, en yenisi ' + esc(mid.lastAt ? tsiIso(mid.lastAt) : '—') + '.' : '') + (mid && mid.err ? ' Hata: ' + esc(mid.err) : '') + '</p><p class="hint">Bunlar Midas’ın editoryal içerikleridir, resmî duyuru değildir; yatırım tavsiyesi olarak okuma. Haber saati makale sayfasındaki yayın saatinden alınır; alınamazsa gün başı gösterilir.</p></section>';
      h += '<section class="card"><h2>Sunucu analizleri</h2>' + (ai && ai.items ? '<p>' + ai.items.length + ' varlığın analizi (Katılım 50 hisseleri, endeksler, altın/gümüş, döviz, helal ETF, örnek fonlar, kripto) arka planda hesaplanır; <b>aynı hesaplama kodu</b> tarayıcıda da çalışır. İşler: ' + Object.keys(ai.runs || {}).map(function (k) { var r = ai.runs[k]; return esc(k) + ' — ' + esc(r.generatedAt ? FR.ageText(now - Date.parse(r.generatedAt)) : '—') + (r.failed && r.failed.length ? ' (' + r.failed.length + ' alınamadı)' : ''); }).join(' · ') + '. <a href="#analiz">Portföy Analizi → Genel bakış</a></p>' : '<p class="muted">Sunucu analizi henüz üretilmedi.</p>') +
        '<p class="hint">Kendi varlıkların için hesap yine cihazında yapılır (portföy bilgin sunucuya gitmez). Sunucu anlık görüntüsü yalnız herkese açık piyasa verisinden üretilir.</p></section>';
      return h + bgCard();
    }
    /* ---------- Periodic Background Sync (deneysel, en iyi çaba) ---------- */
    var BG_LS = 'finans-pusulasi:bgsync';
    function bgSupported() { return 'serviceWorker' in navigator && typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype; }
    function bgOn() { try { return localStorage.getItem(BG_LS) === '1'; } catch (e) { return false; } }
    function watchKeys() { var k = {}; holdings().forEach(function (x) { if (/^[a-z]+:/.test(x.key) && x.key.indexOf('a:') !== 0) k[x.key] = 1; }); var A = X.aui(); try { ((X.state().analysis && X.state().analysis.watchlist) || []).forEach(function (w) { k[w.key] = 1; }); } catch (e) { /* yok */ } return Object.keys(k).slice(0, 60); }
    function bgPush() { if (!('serviceWorker' in navigator)) return; navigator.serviceWorker.ready.then(function (reg) { if (reg.active) reg.active.postMessage({ type: 'FP_WATCH', keys: watchKeys(), base: window.MData.URL.mdIndex.replace(/index\.json$/, '') }); }).catch(function () { }); }
    function bgEnable() {
      if (!bgSupported()) { ui.bgMsg = 'Bu tarayıcı arka plan eşitlemeyi (Periodic Background Sync) desteklemiyor.'; X.render(); return; }
      var ask = typeof Notification !== 'undefined' && Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
      ask.then(function (p) {
        if (p !== 'granted') { ui.bgMsg = 'Bildirim izni gerekli (tarayıcı ayarlarından izin ver).'; X.render(); return; }
        return navigator.serviceWorker.ready.then(function (reg) { return reg.periodicSync.register('fp-refresh', { minInterval: 60 * 60 * 1000 }); }).then(function () { try { localStorage.setItem(BG_LS, '1'); } catch (e) { /* yok */ } bgPush(); ui.bgMsg = 'Açıldı. Tarayıcı uygun gördükçe (genelde günde birkaç kez) arka planda kontrol eder; garanti verilmez.'; X.render(); });
      }).catch(function (e) { ui.bgMsg = 'Açılamadı: ' + (e && e.message || e) + ' (uygulamayı ana ekrana yüklemen gerekebilir).'; X.render(); });
    }
    function bgDisable() { try { localStorage.setItem(BG_LS, '0'); } catch (e) { /* yok */ } navigator.serviceWorker.ready.then(function (reg) { return reg.periodicSync && reg.periodicSync.unregister('fp-refresh'); }).catch(function () { }).then(function () { ui.bgMsg = 'Kapatıldı.'; X.render(); }); }
    function bgCard() {
      var sup = bgSupported(), on = bgOn();
      return '<section class="card"><h2>Site kapalıyken bildirim</h2><div class="grid two"><div><h3>1) Telefona anlık bildirim (önerilen)</h3><p>İş akışı piyasa geneli <b>kritik</b> uyarıları (ve ister isen yüksek olanları) ücretsiz ntfy ile gönderir. Kurulum: <a href="#haberler/ayar">Bildirim ayarları → ntfy</a>. Portföy tutarların sunucuya hiç gitmez; isteğe bağlı <code>WATCH_SYMBOLS</code> değişkeniyle yalnız sembol listesi (tutarsız) verilirse o semboller için seviye uyarıları da gelir.</p></div>' +
        '<div><h3>2) Tarayıcı arka plan kontrolü <span class="pill warn">deneysel · en iyi çaba</span></h3><p>Yalnız <b>Chrome/Android’de ana ekrana yüklenmiş uygulamada</b> çalışır; tarayıcı ne sıklıkla çalıştıracağına kendisi karar verir (kullanım sıklığına göre, genelde günde birkaç kez). Kontrol: yeni kritik/yüksek piyasa uyarıları ve <b>cihazında</b> izlediğin varlıkların analizindeki sert düşüş. İzleme listen yalnız bu cihazda (tarayıcı önbelleğinde) tutulur.</p>' +
        (sup ? '<label class="chk"><input type="checkbox" data-hub="bgtoggle"' + (on ? ' checked' : '') + '> Arka plan kontrolünü aç</label>' : '<p class="muted">Bu tarayıcıda desteklenmiyor (masaüstü Safari/Firefox, iOS vb.). ntfy yöntemini kullan.</p>') + (ui.bgMsg ? '<p class="hint">' + esc(ui.bgMsg) + '</p>' : '') + '</div></div></section>';
    }
    function render() {
      var s = X.sub(), tab = TAB_HASH[s] || 'akis', h = '<h1>Haberler <span class="muted" style="font-size:.9rem;font-weight:400">— haber, takvim, senaryo ve bildirimler</span></h1>' + tabsNav(s in TAB_HASH ? s : '');
      try { h += freshStrip(); h += tab === 'takvim' ? renderCalendar() : tab === 'bildirim' ? renderNotifs() : tab === 'ayar' ? renderSettings() : tab === 'durum' ? renderStatus() : renderFeed(); } catch (e) { console.error(e); h += '<div class="notice warn">Bu bölüm gösterilemedi (' + esc(e.message) + '). Diğer bölümler çalışıyor.</div>'; }
      if (!ui.opened) { ui.opened = true; setTimeout(function () { run(false); }, 50); }
      return h;
    }

    /* ======================= ANA SAYFA KARTLARI ======================= */
    function homeAlerts() {
      var log = logOf(), S = settings(), now = Date.now(); if (!log.lastRun) return '';
      var list = NT.visible(log, S, now).filter(function (it) { return S.cats[it.cat].on && NT.SEV[it.sev].rank >= 3 && !NT.isRead(log, it); }).sort(function (a, b) { return NT.SEV[b.sev].rank - NT.SEV[a.sev].rank || b.lastAt - a.lastAt; });
      if (!list.length) return '';
      return '<section class="card hub-alerts" role="region" aria-label="Önemli bildirimler"><h2>Dikkat: ' + list.length + ' önemli bildirim</h2><ul class="actions">' + list.slice(0, 3).map(function (it) { return '<li class="lv-' + (it.sev === 'critical' ? 'danger' : 'warn') + '"><span><b>' + esc(SEVL[it.sev]) + ':</b> ' + esc(it.title) + ' <small class="muted">· ' + esc(rel(it.lastAt, now)) + '</small></span></li>'; }).join('') + '</ul><p><a class="btn small primary" href="#haberler/bildirim">Hepsini gör (' + list.length + ')</a></p></section>';
    }
    function moodInput() {
      var s = st(), c = null; try { c = X.calc(); } catch (e) { c = null; }
      return { nw: s.nwHistory || [], isExample: !!s.isExample, nwSynthetic: !!s.nwExample, targetAlloc: c && c.an.targetAlloc, currentAlloc: c && c.an.currentAlloc, emergency: c && c.an.emergency, risk: c ? c.risk.items : [], recovery: (HD.get() || {}).recovery, checkins: (s.mood && s.mood.checkins) || [], today: X.today() };
    }
    function ddChart(a) {
      var s = st(), nw = s.nwHistory || []; if (!a.metrics || nw.length < 5) return '';
      var peak = 0, pts = nw.map(function (p) { if (p.v > peak) peak = p.v; return [p.d, peak > 0 ? +(((p.v - peak) / peak) * 100).toFixed(2) : 0]; }), ck = ((s.mood && s.mood.checkins) || []).map(function (c) { var f = pts.filter(function (p) { return p[0] === c.d; })[0]; return f ? { name: MO.MOODS[c.m], value: [c.d, f[1]] } : null; }).filter(Boolean);
      return window.Charts.custom('hub-dd', 170, 'Net varlığın zirveden uzaklığı (%) ve duygu kayıtların', function (t) {
        return { animation: !window.Charts.reduced(), grid: { left: 44, right: 12, top: 12, bottom: 26 }, tooltip: window.Charts.tooltip(t, { trigger: 'axis', valueFormatter: function (v) { return (typeof v === 'number' ? v.toFixed(1).replace('.', ',') : v) + '%'; } }), xAxis: { type: 'time', axisLabel: { color: t.muted, fontSize: 10 }, axisLine: { lineStyle: { color: t.line } } }, yAxis: { type: 'value', max: 0, axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ name: 'Zirveden uzaklık', type: 'line', data: pts, showSymbol: false, areaStyle: { color: t.risky, opacity: 0.18 }, lineStyle: { color: t.risky, width: 2 }, itemStyle: { color: t.risky } }].concat(ck.length ? [{ name: 'Duygu kaydı', type: 'scatter', data: ck, symbolSize: 12, itemStyle: { color: t.brand } }] : []) };
      });
    }
    function factLi(f) { return '<li>' + esc(f.text) + '<br><small class="muted">Kaynak: ' + (f.src && f.src.url ? ext(f.src.url, f.src.name) : esc(f.src ? f.src.name : '')) + (f.src && f.src.at ? ' · ' + esc(tsiIso(f.src.at)) : '') + '</small></li>'; }
    function moodCard() {
      var inp = moodInput(), a = MO.assess(inp), sid = a.state.id, m = a.metrics, s = st(), today = X.today(), mine = ((s.mood && s.mood.checkins) || []), tcheck = mine.filter(function (c) { return c.d === today; })[0];
      var stCls = sid === 'stress' ? 'err' : sid === 'watch' ? 'warn' : sid === 'calm' ? 'ok' : 'info';
      var h = '<section class="card mood" id="mood-card"><div class="mood-h"><h2>Duygu durumu <small class="muted">— verine göre çıkarım, hissin esastır</small></h2><span class="pill ' + stCls + '">' + esc(a.state.label) + '</span></div>';
      if (a.notice) h += '<p class="notice info">' + esc(a.notice) + '</p>';
      h += '<div class="mood-in"><span class="k">Bugün nasıl hissediyorsun?</span><div class="seg wrap" role="group" aria-label="Duygu durumu seçimi">' + Object.keys(MO.MOODS).map(function (k) { return '<button type="button" data-hub="mood" data-m="' + k + '" aria-pressed="' + (!!tcheck && tcheck.m === k) + '">' + esc(MO.MOODS[k]) + '</button>'; }).join('') + '</div></div>';
      if (a.mismatch) h += '<p class="notice warn">' + esc(a.mismatch) + '</p>';
      if (m) h += '<div class="mood-k"><div><span class="k">Zirveden</span><b class="' + (m.dd >= 0.05 ? 'neg' : '') + '">−%' + pc1(m.dd) + '</b></div><div><span class="k">30 gün</span><b class="' + (m.chg30 != null && m.chg30 < 0 ? 'neg' : 'pos') + '">' + (m.chg30 == null ? '—' : sg(m.chg30)) + '</b></div><div class="detail-only"><span class="k">90 gün</span><b>' + (m.chg90 == null ? '—' : sg(m.chg90)) + '</b></div><div class="detail-only"><span class="k">Oynaklık (30 kayıt, günlük)</span><b>' + (m.vol30 == null ? '—' : '%' + pc1(m.vol30)) + '</b></div><div><span class="k">Düşüş serisi</span><b>' + m.streakDown + ' kayıt</b></div></div><p class="hint">Kaynak: cihazındaki net varlık kayıtları (' + esc(dmy(m.from)) + ' – ' + esc(dmy(m.to)) + ', ' + m.n + ' kayıt). Net varlık para girişi/çıkışından da etkilenir; salt yatırım getirisi değildir.</p>';
      if (a.emotions.length) h += '<ul class="emo">' + a.emotions.map(function (e) { return '<li class="lv-' + (e.level === 'high' ? 'danger' : e.level === 'mid' ? 'warn' : 'ok') + '"><span><b>' + esc(e.label) + '</b> <small>(olasılık: ' + (e.level === 'high' ? 'yüksek' : e.level === 'mid' ? 'orta' : 'düşük') + ')</small><br><small>' + esc(e.why) + '</small></span></li>'; }).join('') + '</ul>';
      h += '<h3>Şimdi ne yapmalı?</h3><p class="notice ok sm">Duyguya bakarak satış/alış yapma. Karar plana, vadeye ve kurala göre verilir.</p><ul class="tips">' + a.tips.slice(0, 3).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + a.tips.slice(3).map(function (t) { return '<li class="detail-only">' + esc(t) + '</li>'; }).join('') + '</ul>';
      h += '<h3>Kontrol listesi</h3><ul class="chk-l">' + a.checklist.map(function (c) { return '<li class="ck-' + c.status + '"><span class="ck-i" aria-hidden="true">' + (c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '?') + '</span><span><b>' + esc(c.text) + '</b><br><small>' + esc(c.detail) + (c.href ? ' <a href="' + esc(c.href) + '">Aç</a>' : '') + '</small></span></li>'; }).join('') + '</ul>';
      if (a.facts.length) h += '<h3>Geçmişte ne oldu? <small class="muted">(gerçek veri)</small></h3><ul class="facts">' + a.facts.slice(0, 2).map(factLi).join('') + '</ul>' + (a.facts.length > 2 ? '<div class="detail-only"><ul class="facts">' + a.facts.slice(2).map(factLi).join('') + '</ul></div>' : '');
      if (m) h += '<div class="detail-only">' + ddChart(a) + '</div>';
      if (mine.length) h += '<div class="detail-only"><h3>Duygu kayıtların</h3><ul class="evl">' + mine.slice(-10).reverse().map(function (c) { return '<li>' + esc(dmy(c.d)) + ' — ' + esc(MO.MOODS[c.m]) + (c.dd != null ? ' <small class="muted">(o gün zirveden −%' + pc1(c.dd) + ')</small>' : '') + '</li>'; }).join('') + '</ul></div>';
      return h + '<details class="refs"><summary>Kaynaklar ve yöntem</summary><ul>' + a.refs.map(function (r) { return '<li>' + ext(r.url, r.cite) + '<br><small>' + esc(r.claim) + '</small></li>'; }).join('') + '</ul><p class="hint">Yöntem: duygu durumu kural tabanlıdır (zirveden düşüş ≥ %10 veya 30 günde ≥ %8 düşüş → “baskı altında”; ≥ %5 / ≥ %4 veya 5+ kayıt düşüş serisi → “dikkatli”; 30 günde ≥ %15 artış → “coşkulu”). Bu bir psikolojik değerlendirme veya yatırım tavsiyesi değildir; yoğun sıkıntı yaşıyorsan bir uzmana başvur.</p></details></section>';
    }
    function homeCards() { try { return homeFresh() + homeAlerts(); } catch (e) { console.error(e); return ''; } }
    function homeMood() { try { return moodCard(); } catch (e) { console.error(e); return ''; } }

    /* ======================= VARLIK SAYFASI KARTI ======================= */
    var KIND_GROUP = { stock: 'tr_equity', fund: 'tr_equity', etf: 'us_equity', crypto: 'crypto' };
    function assetCard(A) {
      var g = KIND_GROUP[A.kind] || (/^metal:XAU/.test(A.key || '') ? 'gold' : /^idx:/.test(A.key || '') ? 'tr_equity' : null), d = HD.get(); if (!g || !d || !d.calendar) return '';
      var hold = holdings(), evs = EV.upcoming(d.calendar, Date.now(), 45).filter(function (e) { return e.ti && e.impact === 'high' && e.phase !== 'past' && (N.TOPIC_GROUPS[e.ti.topic] || []).indexOf(g) >= 0; }).slice(0, 3);
      var procd = procNews(d, hold), now = Date.now(), nws = procd.filter(function (it) { return it.matches.some(function (m) { return m.h.key === A.key; }) || (it.imp.topics.some(function (t) { return (N.TOPIC_GROUPS[t] || []).indexOf(g) >= 0; }) && it.imp.level !== 'low'); }).sort(function (a, b) { return b.imp.rank - a.imp.rank; }).slice(0, 3);
      if (!evs.length && !nws.length) return '';
      var h = '<section class="card asset-hub"><h2>Yaklaşan olaylar ve haberler <small class="muted">— ' + esc(N.GROUPS[g].label) + '</small></h2>';
      h += evs.map(function (ev) {
        var pr = EV.probsFor(ev, d), exp = EV.expectation(ev, d);
        return '<div class="ah-ev"><b>' + esc(dmy(ev.date)) + ' · ' + esc(ev.ti.label) + '</b> <span class="when">' + esc(EV.whenText(ev)) + '</span>' + (exp ? '<br><small>' + esc(exp.text) + '</small>' : '') +
          '<div class="ah-sc">' + ev.ti.scen.map(function (sc) { var e = sc.effects[g], p = EV.probOfScenario(sc, pr); return '<span class="gchip d-' + (e ? e.d : 'flat') + '" title="' + esc(e ? e.t : '') + '">' + (e ? EV.DIR_ICON[e.d] : '–') + ' ' + esc(sc.label) + (p != null ? ' %' + Math.round(p * 100) : '') + '</span>'; }).join(' ') + '</div></div>';
      }).join('');
      if (nws.length) h += '<h3>İlgili haberler</h3><ul class="nwl">' + nws.map(function (it) { return newsItem(it, now); }).join('') + '</ul>';
      return h + '<p class="hint"><a href="#haberler/takvim">Tüm senaryolar ve tarihsel benzer olaylar</a> · Yön okları genel iktisat çerçevesidir; tahmin değildir.</p></section>';
    }

    /* ======================= OLAYLAR ======================= */
    function onClick(e) {
      var panel = document.getElementById('bell-panel'), bell = document.getElementById('bell');
      if (bell && bell.contains(e.target)) { e.preventDefault(); togglePanel(); return; }
      if (panel && !panel.hidden && !panel.contains(e.target)) closePanel();
      var el = e.target.closest ? e.target.closest('[data-hub],[data-hubf]') : null; if (!el) return;
      if (el.dataset.hubf && el.tagName === 'BUTTON') { ui.f[el.dataset.hubf] = el.dataset.v; ui.limit = 30; X.render(); return; }
      var act = el.dataset.hub, id = el.dataset.id, now = Date.now();
      function upd(fn) { var log = logOf(); fn(log); X.quiet(function (s) { s.notifLog = log; }); updateBell(); X.render(); }
      if (act === 'bgtoggle') { if (el.checked) bgEnable(); else bgDisable(); return; }
      if (act === 'refresh') { ui.busy = true; X.render(); run(true); }
      else if (act === 'runnow') { run(true); }
      else if (act === 'more') { ui.limit += 30; X.render(); }
      else if (act === 'allimp') { ui.f.imp = 'all'; X.render(); }
      else if (act === 'read') upd(function (l) { NT.markRead(l, id, now); });
      else if (act === 'readall') upd(function (l) { NT.markAllRead(l, NT.visible(l, settings(), now).map(function (i) { return i.id; }), now); });
      else if (act === 'snooze') upd(function (l) { NT.snooze(l, id, now + (+el.dataset.h) * 3600000); NT.markRead(l, id, now); });
      else if (act === 'dismiss') upd(function (l) { NT.dismiss(l, id); });
      else if (act === 'openn') { var log2 = logOf(); NT.markRead(log2, id, now); X.quiet(function (s) { s.notifLog = log2; }); closePanel(); updateBell(); }
      else if (act === 'closepanel') closePanel();
      else if (act === 'mood') {
        var dd = null; try { var mm = MO.metrics(st().nwHistory || []); if (mm && !st().isExample && !st().nwExample) dd = mm.dd; } catch (e2) { /* */ }
        var m = el.dataset.m; X.quiet(function (s) { s.mood = { checkins: MO.addCheckin((s.mood && s.mood.checkins) || [], m, X.today(), null, dd, now) }; }); X.render(); X.toast('Kaydedildi: ' + MO.MOODS[m] + '. Öneriler buna göre.');
      }
      else if (act === 'askbrowser') { if (typeof Notification === 'undefined') return; Notification.requestPermission().then(function (p) { if (p === 'granted') X.quiet(function (s) { var S = NT.cleanSettings(s.notifSettings); S.browser = true; s.notifSettings = S; }); X.render(); }); }
      else if (act === 'testbrowser') { try { new Notification('Finans Pusulası — test', { body: 'Bildirimler çalışıyor. Önemli durumlarda böyle görünecek.' }); } catch (e3) { X.toast('Tarayıcı bildirimi gösterilemedi.'); } }
      else if (act === 'ntfygen') { var ar = new Uint8Array(10); window.crypto.getRandomValues(ar); setNtfy('fp-' + Array.prototype.map.call(ar, function (b) { return 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]; }).join('')); X.render(); }
      else if (act === 'ntfytest') ntfyTest();
      else if (act === 'clearlog') { if (window.confirm('Bildirim geçmişi silinsin mi?')) { X.quiet(function (s) { s.notifLog = NT.cleanLog(null); }); updateBell(); X.render(); } }
      else if (act === 'resetset') { X.quiet(function (s) { s.notifSettings = NT.cleanSettings(null); }); X.render(); }
    }
    function setNtfy(topic) { X.quiet(function (s) { var S = NT.cleanSettings(s.notifSettings); S.ntfy.topic = NT.TOPIC_RE.test(topic) ? topic : ''; S.ntfy.on = !!S.ntfy.topic; s.notifSettings = S; }); }
    function ntfyTest() {
      var tp = settings().ntfy.topic; if (!tp) return;
      ui.ntfyMsg = 'Gönderiliyor…'; X.render();
      fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: tp, title: 'Finans Pusulası — test', message: 'ntfy bağlantısı çalışıyor. Piyasa geneli kritik uyarılar buraya gelecek.', priority: 3, tags: ['white_check_mark'] }) })
        .then(function (r) { ui.ntfyMsg = r.ok ? 'Test gönderildi ✓ — telefonunda bu konuya abone isen birkaç saniyede gelir.' : 'ntfy hata verdi: HTTP ' + r.status; X.render(); }, function (e) { ui.ntfyMsg = 'Gönderilemedi: ' + e.message; X.render(); });
    }
    function onChange(e) {
      var el = e.target; if (!el.dataset) return;
      if (el.dataset.hubf && el.tagName !== 'BUTTON') { ui.f[el.dataset.hubf] = el.value; ui.limit = 30; if (el.id !== 'hub-q') X.render(); return; }
      if (el.dataset.hubn) { ui.nf[el.dataset.hubn] = el.type === 'checkbox' ? el.checked : el.value; X.render(); return; }
      if (el.dataset.hubs) {
        var path = el.dataset.hubs, v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? parseFloat(el.value) : el.value;
        if (path === 'ntfy.topic') { var tv = String(v).trim(); if (tv && !NT.TOPIC_RE.test(tv)) { el.setAttribute('aria-invalid', 'true'); X.toast('Konu adı 8–64 karakter; yalnız harf, rakam, - ve _ olabilir.'); return; } setNtfy(tv); X.render(); return; }
        X.quiet(function (s) { var S = NT.cleanSettings(s.notifSettings); setPath(S, path, v); s.notifSettings = NT.cleanSettings(S); });
        X.render(); run(false);
      }
    }
    function onInput(e) {
      var el = e.target; if (el && el.id === 'hub-q') { ui.f.q = el.value; clearTimeout(onInput.t); onInput.t = setTimeout(function () { var pos = el.selectionStart; X.render(); var q = document.getElementById('hub-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e2) { /* */ } } }, 250); }
    }
    document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.dataset && d.dataset.hubopen) ui.open[d.dataset.hubopen] = d.open; }, true);
    return { render: render, start: start, run: run, updateBell: updateBell, homeCards: homeCards, homeMood: homeMood, assetCard: assetCard, _ui: ui };
  };
})();
