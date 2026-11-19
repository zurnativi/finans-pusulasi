/* notify.js — Bildirim motoru: portföy, seviye, haber, olay ve piyasa kaynaklarından ADAY üretir; tekrarı ayıklar, okundu/ertele/sessiz/sessiz saat uygular. SAF (testli).
 * Her bildirimde: önem derecesi, NEDEN (kural), KAYNAK + zaman damgası, etkilenen varlıklar ve gerekirse tarihsel benzer olay (n ile) bulunur.
 * Satış emri vermez: en ağır dil "analizden sonra gözden geçir"dir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./news.js'), require('./events.js'));
  else root.Notify = factory(root.News, root.Events);
})(typeof self !== 'undefined' ? self : this, function (N, EV) {
  'use strict';
  var SEV = { critical: { rank: 4, label: 'Kritik' }, high: { rank: 3, label: 'Yüksek' }, medium: { rank: 2, label: 'Orta' }, info: { rank: 1, label: 'Bilgi' } };
  var CATS = { portfolio: 'Portföy', level: 'Fiyat seviyesi', news: 'Kritik haber', event: 'Takvim ve senaryo', market: 'Piyasa şoku', data: 'Veri kalitesi', payment: 'Ödeme hatırlatması' };
  var CAT_HELP = { portfolio: 'Düşüş eşikleri, varlık/limit aşımı, sağlık skoru, acil fon, helal durum değişikliği.', level: 'Koyduğun fiyat seviyelerinin tetiklenmesi.', news: 'Çok önemli haberler ve portföyüne olası etkisi.', event: 'Faiz kararı, enflasyon, seçim gibi olayların 1 gün öncesi ve sonucu (beklenti sapması).', market: 'BIST, USD/TL, altın, Bitcoin, VIX\'te olağandışı hareket; tahmin piyasalarında ani kayma.', data: 'Eski/eksik fiyat, ulaşılamayan veri kaynağı.', payment: 'Yaklaşan/geçmiş düzenli ödemeler, kart son ödeme günü, yıllık giderler (arka plan izleme açıkken telefona da gelir).' };
  var DEFAULT_SETTINGS = {
    v: 1, cats: { portfolio: { on: true, push: 'high' }, level: { on: true, push: 'high' }, news: { on: true, push: 'high' }, event: { on: true, push: 'high' }, market: { on: true, push: 'critical' }, data: { on: true, push: 'critical' }, payment: { on: true, push: 'medium' } },
    quiet: { on: true, from: '23:00', to: '08:00', critBypass: true }, browser: false, ntfy: { on: false, topic: '', min: 'critical' }, newsScope: 'portfolio',
    thr: { ddMedium: 5, ddHigh: 10, ddCritical: 20, move1d: 7, move1dCritical: 12 }
  };
  var TOPIC_RE = /^[A-Za-z0-9_-]{8,64}$/;
  function num(v, lo, hi, d) { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : d; }
  function hhmm(v, d) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d; }
  function cleanSettings(x) {
    var D = DEFAULT_SETTINGS, o = JSON.parse(JSON.stringify(D)); if (!x || typeof x !== 'object') return o;
    Object.keys(D.cats).forEach(function (k) { var c = x.cats && x.cats[k]; if (c && typeof c === 'object') { o.cats[k].on = c.on !== false; o.cats[k].push = c.push === 'critical' || c.push === 'high' || c.push === 'medium' || c.push === 'off' ? c.push : D.cats[k].push; } });
    if (x.quiet && typeof x.quiet === 'object') { o.quiet.on = x.quiet.on !== false; o.quiet.from = hhmm(x.quiet.from, D.quiet.from); o.quiet.to = hhmm(x.quiet.to, D.quiet.to); o.quiet.critBypass = x.quiet.critBypass !== false; }
    o.browser = x.browser === true;
    if (x.ntfy && typeof x.ntfy === 'object') { o.ntfy.topic = TOPIC_RE.test(String(x.ntfy.topic || '')) ? String(x.ntfy.topic) : ''; o.ntfy.on = x.ntfy.on === true && !!o.ntfy.topic; o.ntfy.min = x.ntfy.min === 'high' ? 'high' : 'critical'; }
    o.newsScope = x.newsScope === 'market' ? 'market' : 'portfolio';
    if (x.thr && typeof x.thr === 'object') { o.thr.ddMedium = num(x.thr.ddMedium, 1, 50, D.thr.ddMedium); o.thr.ddHigh = num(x.thr.ddHigh, 2, 70, D.thr.ddHigh); o.thr.ddCritical = num(x.thr.ddCritical, 3, 90, D.thr.ddCritical); o.thr.move1d = num(x.thr.move1d, 1, 50, D.thr.move1d); o.thr.move1dCritical = num(x.thr.move1dCritical, 2, 80, D.thr.move1dCritical);
      if (!(o.thr.ddMedium < o.thr.ddHigh && o.thr.ddHigh < o.thr.ddCritical)) { o.thr.ddMedium = D.thr.ddMedium; o.thr.ddHigh = D.thr.ddHigh; o.thr.ddCritical = D.thr.ddCritical; }
      if (!(o.thr.move1d < o.thr.move1dCritical)) { o.thr.move1d = D.thr.move1d; o.thr.move1dCritical = D.thr.move1dCritical; } }
    return o;
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function safeUrl(u) { return typeof u === 'string' && /^https?:\/\//i.test(u) ? u.slice(0, 500) : null; }
  function cleanItem(it) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !SEV[it.sev] || !CATS[it.cat]) return null;
    var o = { id: it.id.slice(0, 120), cat: it.cat, sev: it.sev, title: str(it.title, 200), body: str(it.body, 1500), at: Number.isFinite(+it.at) ? +it.at : 0, firstAt: Number.isFinite(+it.firstAt) ? +it.firstAt : (+it.at || 0), lastAt: Number.isFinite(+it.lastAt) ? +it.lastAt : (+it.at || 0), count: Math.max(1, Math.min(999, +it.count || 1)), state: it.state === true, origin: it.origin === 'workflow' ? 'workflow' : 'app' };
    o.why = (Array.isArray(it.why) ? it.why : []).slice(0, 8).map(function (x) { return str(x, 300); }).filter(Boolean);
    o.sources = (Array.isArray(it.sources) ? it.sources : []).slice(0, 6).map(function (s) { return s && { label: str(s.label, 120), url: safeUrl(s.url), at: str(s.at, 40) }; }).filter(function (s) { return s && s.label; });
    o.assets = (Array.isArray(it.assets) ? it.assets : []).slice(0, 12).map(function (x) { return str(x, 80); }).filter(Boolean);
    o.href = typeof it.href === 'string' && /^#[\w\/:.-]{0,80}$/.test(it.href) ? it.href : null;
    if (it.resolvedAt) o.resolvedAt = +it.resolvedAt || null;
    return o;
  }
  function cleanLog(x) {
    var o = { items: [], read: {}, snooze: {}, dismissed: {}, meta: { halal: {}, health: null, expect: {}, seen: 0 }, lastRun: 0 }; if (!x || typeof x !== 'object') return o;
    (Array.isArray(x.items) ? x.items : []).slice(0, 400).forEach(function (it) { var c = cleanItem(it); if (c) o.items.push(c); });
    ['read', 'snooze', 'dismissed'].forEach(function (k) { if (x[k] && typeof x[k] === 'object') Object.keys(x[k]).slice(0, 800).forEach(function (id) { var v = +x[k][id]; if (isFinite(v) && v >= 0) o[k][id.slice(0, 120)] = v; }); });
    if (x.meta && typeof x.meta === 'object') {
      if (x.meta.halal && typeof x.meta.halal === 'object') Object.keys(x.meta.halal).slice(0, 200).forEach(function (k) { o.meta.halal[k.slice(0, 80)] = str(x.meta.halal[k], 20); });
      if (x.meta.health && Number.isFinite(+x.meta.health.score)) o.meta.health = { score: +x.meta.health.score, at: +x.meta.health.at || 0 };
      if (x.meta.expect && typeof x.meta.expect === 'object') Object.keys(x.meta.expect).slice(0, 60).forEach(function (k) { var e = x.meta.expect[k]; if (e && typeof e === 'object') o.meta.expect[k.slice(0, 120)] = { code: str(e.code, 10), deltaBp: Number.isFinite(+e.deltaBp) ? +e.deltaBp : null, at: +e.at || 0 }; });
      o.meta.seen = +x.meta.seen || 0;
    }
    o.lastRun = +x.lastRun || 0; return o;
  }
  /* ---------- Biçim yardımcıları ---------- */
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 1 : d).replace('.', ',') + '%'; }
  function signed(x, d) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d == null ? 1 : d).replace('.', ',') + '%'; }
  function tlK(v) { return (Math.round(v / 100)).toLocaleString('tr-TR') + ' ₺'; }
  function dtr(ms) { return new Date(ms + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' TSİ'; }
  function slug(t) { return N.fold(t).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40); }

  /* ---------- Tarihsel benzer olay satırı (konudan gruba) ---------- */
  var TOPIC_ANALOG = { politics_tr: ['turkey_shock', 'turkey_election'], geo: ['global_shock'], rating: ['turkey_shock'] };
  function analogLine(topics, analogs, heldGroups) {
    if (!analogs) return null;
    for (var i = 0; i < topics.length; i++) {
      var gs = TOPIC_ANALOG[topics[i]]; if (!gs) continue;
      var r = EV.analogRows(analogs, gs[0], heldGroups); if (!r || !r.rows.length) continue;
      var row = r.rows[0], m = row.d1.median; if (m == null) continue;
      return 'Geçmişte benzer olaylarda (' + r.label + ', n=' + r.n + '): ' + row.label + ' ilk işlem günü medyan ' + signed(m) + ' (en kötü ' + signed(row.d1.min) + ', en iyi ' + signed(row.d1.max) + ')' + (r.small ? ' — örnek sayısı çok küçük, kesin çıkarım yapma.' : '.');
    }
    return null;
  }
  function heldGroups(hold) { var s = {}; (hold || []).forEach(function (h) { if (h.value > 0) s[N.groupOf(h)] = 1; }); return Object.keys(s); }
  function exposureText(matches, total) {
    var ex = N.exposure(matches, total); if (!ex.n) return null;
    var names = []; matches.forEach(function (m) { if (names.indexOf(m.h.name) < 0) names.push(m.h.name); });
    return 'Etkilenebilecek varlıkların: ' + names.slice(0, 4).join(', ') + (names.length > 4 ? ' +' + (names.length - 4) : '') + ' (portföyün ~%' + Math.round(ex.bp / 100) + '\'i).';
  }
  var SRV_GROUPS = { XU100: ['tr_equity'], USDTRY: ['tr_income', 'gold', 'tr_equity'], XAUUSD: ['gold'], BTCUSD: ['crypto'], VIX: ['us_equity', 'tr_equity', 'crypto'] };
  function groupsOfServer(a) {
    var m = /^mkt:([A-Z0-9]+):/.exec(a.id); if (m && SRV_GROUPS[m[1]]) return SRV_GROUPS[m[1]];
    var ev = /^event:([^:]+(?::[^:]+)*):T[01]$/.exec(a.id); if (ev) { var t = ev[1].split(':')[0]; var ti = EV.TYPES[t]; return ti ? (N.TOPIC_GROUPS[ti.topic] || []) : []; }
    if (/^prob:/.test(a.id)) return /^prob:tr_/.test(a.id) ? ['tr_equity', 'tr_income', 'gold'] : ['us_equity', 'gold', 'crypto'];
    return [];
  }
  /* ---------- Aday üretimi ---------- */
  function evaluate(ctx) {
    var now = ctx.now, S = ctx.settings || DEFAULT_SETTINGS, thr = S.thr, hold = ctx.hold || [], total = hold.reduce(function (s, h) { return s + (h.value > 0 ? h.value : 0); }, 0), out = [], metaPatch = { halal: {}, expect: {} };
    var hub = ctx.hub || {}, hg = heldGroups(hold);
    function add(c) { c.at = c.at || now; c.sources = c.sources || []; c.why = c.why || []; c.assets = c.assets || []; out.push(c); }
    function on(cat) { return !S.cats || !S.cats[cat] || S.cats[cat].on !== false; }
    /* 1) PORTFÖY ---------------------------------------------------------- */
    if (on('portfolio')) {
      var nw = ctx.nw;
      if (nw && !ctx.isExample && nw.length >= 5 && !ctx.nwIsSynthetic) {
        var recent = nw.slice(-365), peak = recent[0]; recent.forEach(function (p) { if (p.v >= peak.v) peak = p; });
        var cur = nw[nw.length - 1], dd = peak.v > 0 ? (peak.v - cur.v) / peak.v : 0, lvl = dd * 100 >= thr.ddCritical ? 'critical' : dd * 100 >= thr.ddHigh ? 'high' : dd * 100 >= thr.ddMedium ? 'medium' : null;
        if (lvl) {
          var rec = hub.recovery && hub.recovery.assets && hub.recovery.assets.XU100 && hub.recovery.assets.XU100.thr && hub.recovery.assets.XU100.thr['10'];
          add({ id: 'dd:' + lvl, cat: 'portfolio', sev: lvl, state: true, title: 'Net varlığın zirveden %' + f1(dd * 100) + ' geriledi', href: '#analiz',
            body: 'Zirve ' + tlK(peak.v) + ' (' + peak.d + '), son kayıt ' + tlK(cur.v) + ' (' + cur.d + '). Panikle karar verme: önce planına, vadene ve acil fonuna bak; satış için "analizden sonra gözden geçir" adımını izle.' + (rec ? ' Bağlam: BIST 100\'de %10+ düşüşlerin medyan toparlanması ' + rec.medianDaysToRecover + ' gün (n=' + rec.n + ', nominal).' : ''),
            why: ['Eşik: %' + (lvl === 'critical' ? thr.ddCritical : lvl === 'high' ? thr.ddHigh : thr.ddMedium) + ' (Ayarlar\'dan değiştirilebilir)', 'Kaynak veri: senin net varlık kayıtların — para girişi/çıkışı da değeri değiştirir; bu salt piyasa getirisi değildir'],
            sources: [{ label: 'Net varlık geçmişi (cihazdaki kayıtların)', at: cur.d }].concat(rec ? [{ label: 'BIST 100 toparlanma istatistiği — Yahoo Finance', url: hub.recovery.assets.XU100.url || null, at: hub.recovery.generatedAt }] : []) });
        }
      }
      (ctx.risk || []).forEach(function (r) {
        if (r.level !== 'danger' && r.level !== 'warn') return;
        var sev = r.id === 'halal' ? (r.level === 'danger' ? 'high' : 'medium') : r.id === 'emergency' ? (ctx.emergency && ctx.emergency.target > 0 && ctx.emergency.current / ctx.emergency.target < 0.5 ? 'high' : 'medium') : r.level === 'danger' ? 'high' : 'medium';
        add({ id: 'risk:' + r.id + ':' + r.level, cat: 'portfolio', sev: sev, state: true, title: r.title, body: r.text, href: '#portfoy/risk', why: ['Portföy risk kuralları (Portföy → Risk) ihlal edildi'], sources: [{ label: 'Senin kurallarınla portföy hesabı', at: dtr(now) }] });
      });
      (hold || []).forEach(function (h) {
        if (!h.key || !h.halal) return; metaPatch.halal[h.key] = h.halal; var was = ctx.meta && ctx.meta.halal && ctx.meta.halal[h.key];
        if (was && was !== h.halal) add({ id: 'halal:' + h.key + ':' + h.halal, cat: 'portfolio', sev: h.halal === 'uygun_degil' ? 'high' : 'medium', title: h.name + ': helal durum değişti', body: '"' + was + '" → "' + h.halal + '". ' + (h.halal === 'uygun' ? '' : 'Önerilere girmez; elden çıkarmayı yalnızca analiz ve uzman görüşünden sonra gözden geçir.'), href: '#portfoy/varliklar', why: ['Kayıtlı uygunluk etiketi değişti'], sources: [{ label: 'Varlık etiketi / endeks üyeliği', at: dtr(now) }], assets: [h.name] });
      });
      if (ctx.health && ctx.health.total != null) {
        var prevH = ctx.meta && ctx.meta.health, hs = ctx.health.total;
        if (prevH && prevH.score - hs >= 10) add({ id: 'health:drop:' + EV.tsiYmd(now), cat: 'portfolio', sev: 'high', title: 'Portföy sağlık skoru ' + prevH.score + ' → ' + hs, body: 'Son kontrolden bu yana 10+ puan düştü. Hangi ölçütün düştüğünü Portföy Analizi → Genel bakış\'ta gör.', href: '#analiz', why: ['Önceki kontrol: ' + prevH.score + '/100'], sources: [{ label: 'Portföy sağlık skoru (10 ölçüt)', at: dtr(now) }] });
        if (hs < 40) add({ id: 'health:low', cat: 'portfolio', sev: 'high', state: true, title: 'Portföy sağlık skoru düşük: ' + hs + '/100', body: 'Skor 40\'ın altında. En zayıf ölçütleri düzeltme önerileriyle birlikte Genel bakış\'ta gör.', href: '#analiz', why: ['Eşik: 40/100'], sources: [{ label: 'Portföy sağlık skoru', at: dtr(now) }] });
        else if (hs < 55) add({ id: 'health:weak', cat: 'portfolio', sev: 'medium', state: true, title: 'Portföy sağlık skoru orta-alt: ' + hs + '/100', body: 'Düzeltme önerileri Genel bakış\'ta.', href: '#analiz', why: ['Eşik: 55/100'], sources: [{ label: 'Portföy sağlık skoru', at: dtr(now) }] });
        metaPatch.health = { score: hs, at: now };
      }
      (ctx.moves || []).forEach(function (m) {
        var d = m.pct; if (d == null || d > -thr.move1d / 100) return; var crit = d <= -thr.move1dCritical / 100;
        add({ id: 'move:' + m.key + ':' + m.asOf, cat: 'portfolio', sev: crit ? 'critical' : 'high', title: m.name + ' bir günde ' + signed(d), body: 'Son iki fiyat noktası arasındaki değişim (' + m.prevD + ' → ' + m.asOf + '). Önce haberi/KAP\'ı kontrol et; tek günlük harekete göre karar verme.', href: '#analiz', assets: [m.name], why: ['Eşik: %' + (crit ? thr.move1dCritical : thr.move1d) + ' günlük düşüş'], sources: [{ label: m.src || 'Fiyat geçmişi', at: m.asOf }] });
      });
    }
    if (on('data')) {
      if (ctx.stale && ctx.stale.length) add({ id: 'data:stale', cat: 'data', sev: 'medium', state: true, title: ctx.stale.length + ' varlığın fiyatı eski/eksik', body: ctx.stale.slice(0, 5).map(function (x) { return x.name + (x.note ? ' (' + x.note + ')' : ''); }).join(', ') + (ctx.stale.length > 5 ? ' …' : '') + '. Eski fiyatla hesaplanan değerler gerçeği yansıtmayabilir.', href: '#portfoy/varliklar', why: ['Fiyat güncelliği eşiği aşıldı'], sources: [{ label: 'Portföy fiyat güncelliği', at: dtr(now) }] });
      if (hub.status && hub.status.generatedAt) {
        var age = (now - Date.parse(hub.status.generatedAt)) / 3600000;
        if (age > 36) add({ id: 'data:hub', cat: 'data', sev: 'medium', state: true, title: 'Haber/takvim verisi ' + Math.floor(age) + ' saattir güncellenmedi', body: 'Otomatik veri akışı (GitHub Actions) çalışmıyor olabilir; haber, takvim ve olasılıklar eski. Eski veriyle karar verme.', href: '#haberler', why: ['Son üretim: ' + hub.status.generatedAt], sources: [{ label: 'market-data dalı / hub/status.json', at: hub.status.generatedAt }] });
      }
    }
    /* 2) SEVİYE UYARILARI ------------------------------------------------- */
    if (on('level')) (ctx.fired || []).forEach(function (f) { add({ id: 'lvl:' + f.id + ':' + EV.tsiYmd(f.at || now), cat: 'level', sev: 'high', title: f.title, body: f.text, href: f.href || '#analiz', assets: f.name ? [f.name] : [], at: f.at || now, why: ['Senin koyduğun seviye tetiklendi'], sources: [{ label: f.src || 'Canlı fiyat', at: f.when || '' }] }); });
    /* 3) HABER ------------------------------------------------------------ */
    if (on('news')) (ctx.news || []).forEach(function (it) {
      if (!it.imp) return;
      if (it.kap) { if (!it.mine || it.imp.level === 'low') return; } else if (it.imp.level !== 'critical' && it.imp.level !== 'high') return;
      if (!it.kap && it.imp.level === 'high' && !it.exp.direct && S.newsScope !== 'market') return; // yalnız konu eşleşen "yüksek" haber bildirim olmaz (akışta görünür)
      var at = it.a ? Date.parse(it.a) : NaN; if (!isFinite(at) || now - at > 36 * 3600000 || at - now > 3 * 3600000) return;
      var mine = it.mine, sev;
      if (it.kap) sev = it.imp.level === 'high' ? 'high' : 'medium';
      else if (it.imp.level === 'critical') sev = mine ? 'critical' : 'high';
      else if (mine) sev = it.exp.direct ? 'high' : 'medium'; // konu eşleşmesi tek başına en fazla "orta"; doğrudan (hisse/şirket adı) eşleşme "yüksek"
      else if (S.newsScope === 'market') sev = 'medium'; else return;
      var body = [exposureText(it.matches, total), analogLine(it.imp.topics, hub.analogs, hg), mine ? null : 'Portföyündeki varlıklarla doğrudan eşleşme bulunamadı; genel piyasa haberi.'].filter(Boolean).join(' ');
      add({ id: 'news:' + slug(it.t), cat: 'news', sev: sev, title: it.t.slice(0, 160), body: body || 'Haber akışında öne çıktı.', href: '#haberler', at: at, assets: it.matches.map(function (m) { return m.h.name; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 6),
        why: it.imp.notes.slice(0, 4), sources: it.srcs.slice(0, 4).map(function (s) { return { label: s.s, url: s.u, at: s.a }; }) });
    });
    /* 4) OLAYLAR ---------------------------------------------------------- */
    if (on('event')) {
      (ctx.events || []).forEach(function (ev) {
        if (!ev.ti || ev.impact !== 'high') return;
        var tag = ev.phase === 'today' ? 'T0' : ev.phase === 'tomorrow' ? 'T1' : ev.daysLeft === 7 ? 'W' : null; if (!tag) return;
        var exp = EV.expectation(ev, hub), pr = EV.probsFor(ev, hub), lines = [];
        if (exp) lines.push(exp.text + '.');
        if (pr && pr.by) lines.push('Piyasa olasılıkları (' + pr.source + '): ' + ev.ti.scen.filter(function (s) { return pr.by[s.code] != null; }).map(function (s) { return s.label + ' %' + Math.round(pr.by[s.code] * 100); }).join(' · ') + '.');
        else if (ev.type === 'cbrt_ppk') lines.push('TCMB kararı için piyasa fiyatlı olasılık kaynağı yok; yalnız anket beklentisi var.');
        var worst = null; ev.ti.scen.forEach(function (sc) { var im = EV.holdingImpact(sc, hold); if (!worst || im.pct.down > worst.im.pct.down) worst = { sc: sc, im: im }; });
        if (worst && worst.im.total > 0) lines.push('En olumsuz senaryo (' + worst.sc.label + '): portföyünün ~%' + Math.round(worst.im.pct.down * 100) + '\'i olumsuz yönde etkilenebilecek varlıklarda (genel çerçeve; kesin sonuç değil).');
        if (exp && (ev.type === 'cbrt_ppk' || ev.type === 'fomc')) metaPatch.expect[ev.id] = { code: exp.code || '', deltaBp: exp.deltaBp != null ? exp.deltaBp : null, at: now };
        add({ id: 'event:' + ev.id + ':' + tag, cat: 'event', sev: tag === 'W' ? 'info' : 'high', title: (tag === 'T0' ? 'Bugün: ' : tag === 'T1' ? 'Yarın: ' : '7 gün sonra: ') + ev.title, href: '#haberler/takvim', at: now, body: lines.join(' ') || 'Yüksek etkili ekonomik olay.', assets: [],
          why: ['Yüksek etkili olay · ' + ev.date + (ev.time ? ' ' + ev.time + ' TSİ' : '')], sources: [ev.source && ev.source.name ? { label: ev.source.name, url: ev.source.url } : { label: 'Ekonomik takvim' }].concat(exp && exp.src ? [{ label: exp.src.name, url: exp.src.url }] : []) });
      });
      /* Sonuç - beklenti sürprizi */
      (ctx.events || []).forEach(function (ev) {
        if (ev.type === 'data' && ev.actual != null && ev.forecast != null && ev.impact === 'high' && now - ev.ms < 24 * 3600000 && now >= ev.ms) {
          var s = EV.surprise(ev); if (s && s.material) add({ id: 'surprise:' + ev.id, cat: 'event', sev: 'medium', title: 'Beklenti sapması: ' + ev.title, body: s.text + '. Etkiyi senaryo sayfasından ve fiyat tepkisinden izle.', href: '#haberler/takvim', at: ev.ms, why: ['Gerçekleşen ve beklenti sayısal olarak karşılaştırıldı'], sources: [ev.source && ev.source.name ? { label: ev.source.name, url: ev.source.url } : { label: 'Ekonomik takvim' }] });
        }
      });
      var dec = hub.analogs && hub.analogs.events || [];
      Object.keys(ctx.meta && ctx.meta.expect || {}).forEach(function (eid) {
        var ex = ctx.meta.expect[eid], m = /^(cbrt_ppk|fomc):(\d{4}-\d{2}-\d{2})$/.exec(eid); if (!m) return;
        var ae = dec.filter(function (e) { return e.auto && e.date === m[2] && /^(cbrt|fed)_/.test(e.group); })[0]; if (!ae) return;
        var bm = /\(([+\-−]?\d+) bp\)/.exec(ae.title), bp = bm ? parseInt(bm[1].replace('−', '-'), 10) : null; if (bp == null) return;
        var label = m[1] === 'cbrt_ppk' ? 'TCMB' : 'Fed', surprise;
        if (m[1] === 'cbrt_ppk' && ex.deltaBp != null) { var d = EV.rateSurprise(ex.deltaBp / 100 + 0, bp / 100 + 0); surprise = d && d.code !== 'inline' ? (d.bp > 0 ? 'Beklentiden şahin (daha az indirim/ daha çok artırım): ' : 'Beklentiden güvercin (daha çok indirim): ') + (d.bp > 0 ? '+' : '') + d.bp + ' bp sapma' : null; }
        else if (m[1] === 'fomc' && ex.code) { var code = bp < 0 ? 'cut' : bp > 0 ? 'hike' : 'hold'; surprise = code !== ex.code ? 'Piyasanın en olası dediği "' + ex.code + '" değil, "' + code + '" geldi' : null; }
        add({ id: 'result:' + eid, cat: 'event', sev: surprise ? 'high' : 'info', title: label + ' kararı açıklandı: ' + (bp === 0 ? 'faiz sabit' : (bp > 0 ? '+' : '') + bp + ' bp'), body: (surprise ? surprise + '. ' : 'Karar, kaydettiğimiz beklentiyle uyumlu. ') + 'Fiyat tepkisini ve senaryo analizini Haberler → Takvim\'de gör.', href: '#haberler/takvim', at: Date.parse(m[2] + 'T12:00:00+03:00'),
          why: ['Beklenti T-1\'de kaydedildi: ' + (ex.deltaBp != null ? ex.deltaBp + ' bp' : ex.code)], sources: [{ label: 'Resmî karar tablosu (TCMB/Fed) — olay çalışması verisi', at: hub.analogs && hub.analogs.generatedAt }] });
      });
    }
    /* 5) İŞ AKIŞI (sunucu tarafı) uyarıları: kişiselleştirerek ekle ---------- */
    (ctx.server || []).forEach(function (a) {
      var cat = CATS[a.cat] ? a.cat : 'market'; if (!on(cat) || !SEV[a.sev]) return;
      var at = Date.parse(a.at); if (!isFinite(at) || now - at > 7 * 86400000) return;
      var groups = groupsOfServer(a), tps = a.cat === 'news' ? N.topicsOf(a.title) : [];
      if (a.cat === 'news') tps.forEach(function (t) { (N.TOPIC_GROUPS[t] || []).forEach(function (g) { if (groups.indexOf(g) < 0) groups.push(g); }); });
      var mm = []; hold.forEach(function (h) { if (h.value > 0 && groups.indexOf(N.groupOf(h)) >= 0) mm.push({ h: h, kind: 'topic' }); });
      var extra = [exposureText(mm, total), a.cat === 'news' ? analogLine(tps, hub.analogs, hg) : null].filter(Boolean).join(' ');
      add({ id: a.id, cat: cat, sev: a.sev, title: a.title, body: (a.body || '') + (extra ? ' ' + extra : ''), at: at, origin: 'workflow', href: a.cat === 'news' ? '#haberler' : a.cat === 'event' ? '#haberler/takvim' : '#haberler/bildirim', assets: mm.map(function (m) { return m.h.name; }).slice(0, 6),
        why: ['İş akışı tarafı kural (sunucuda üretildi, kapalıyken de çalışır)'], sources: [{ label: 'market-data iş akışı' + (a.url ? '' : ''), url: a.url || null, at: a.at }] });
    });
    return { cands: out, metaPatch: metaPatch };
  }
  /* ---------- Günlüğe birleştirme: tekrar ayıklama, yükselme, çözülme ---------- */
  function merge(log, cands, now, metaPatch) {
    var byId = {}; log.items.forEach(function (it) { byId[it.id] = it; });
    var fresh = [], seenNow = {};
    cands.forEach(function (c) {
      if (seenNow[c.id]) return; seenNow[c.id] = 1;
      var old = byId[c.id], dis = log.dismissed[c.id];
      if (dis != null && SEV[c.sev].rank <= dis) return; // kullanıcı kapattı; yalnız daha ağır olursa yeniden çıkar
      if (!old) { var it = cleanItem(Object.assign({}, c, { firstAt: now, lastAt: now, count: 1 })); if (it) { log.items.push(it); byId[it.id] = it; fresh.push({ id: it.id, why: 'new', sev: it.sev, cat: it.cat }); } return; }
      var up = SEV[c.sev].rank > SEV[old.sev].rank, react = !!old.resolvedAt;
      old.lastAt = now; old.title = c.title || old.title; old.body = c.body || old.body; old.why = c.why && c.why.length ? c.why.slice(0, 8) : old.why; old.sources = (c.sources && c.sources.length ? c.sources : old.sources).slice(0, 6); old.assets = c.assets || old.assets; old.href = c.href || old.href;
      if (up) { old.sev = c.sev; delete log.read[old.id]; fresh.push({ id: old.id, why: 'escalated', sev: old.sev, cat: old.cat }); }
      if (react) { delete old.resolvedAt; old.count = Math.min(999, old.count + 1); delete log.read[old.id]; fresh.push({ id: old.id, why: 'again', sev: old.sev, cat: old.cat }); }
    });
    log.items.forEach(function (it) { if (it.state && !seenNow[it.id] && !it.resolvedAt) it.resolvedAt = now; });
    if (metaPatch) {
      if (metaPatch.halal) Object.keys(metaPatch.halal).forEach(function (k) { log.meta.halal[k] = metaPatch.halal[k]; });
      if (metaPatch.health) log.meta.health = metaPatch.health;
      if (metaPatch.expect) Object.keys(metaPatch.expect).forEach(function (k) { if (!log.meta.expect[k]) log.meta.expect[k] = metaPatch.expect[k]; });
    }
    prune(log, now); log.lastRun = now; return fresh;
  }
  function prune(log, now) {
    var cut = now - 60 * 86400000;
    log.items = log.items.filter(function (it) { return (it.lastAt || it.at || 0) >= cut; });
    if (log.items.length > 300) { log.items.sort(function (a, b) { return SEV[b.sev].rank - SEV[a.sev].rank || b.lastAt - a.lastAt; }); log.items = log.items.slice(0, 300); }
    var ids = {}; log.items.forEach(function (it) { ids[it.id] = 1; });
    ['read', 'snooze'].forEach(function (k) { Object.keys(log[k]).forEach(function (id) { if (!ids[id]) delete log[k][id]; }); });
    Object.keys(log.dismissed).slice(0, 5000); var keys = Object.keys(log.dismissed); if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(function (k) { delete log.dismissed[k]; });
    Object.keys(log.meta.expect).forEach(function (k) { if ((log.meta.expect[k].at || 0) < now - 45 * 86400000) delete log.meta.expect[k]; });
    log.items.sort(function (a, b) { return b.lastAt - a.lastAt; });
  }
  /* ---------- Durum sorguları ---------- */
  function isSnoozed(log, it, now) { var u = log.snooze[it.id]; return u != null && u > now; }
  function isRead(log, it) { return log.read[it.id] != null; }
  function visible(log, S, now, opts) {
    opts = opts || {};
    return log.items.filter(function (it) {
      if (opts.cat && it.cat !== opts.cat) return false;
      if (opts.sev && it.sev !== opts.sev) return false;
      if (!opts.history && (it.resolvedAt || isSnoozed(log, it, now))) return false;
      if (opts.unread && isRead(log, it)) return false;
      return true;
    });
  }
  function counts(log, S, now) {
    var act = visible(log, S, now).filter(function (it) { return !S.cats || !S.cats[it.cat] || S.cats[it.cat].on !== false; }), unread = act.filter(function (it) { return !isRead(log, it) && SEV[it.sev].rank >= 2; });
    var max = unread.reduce(function (m, it) { return SEV[it.sev].rank > m ? SEV[it.sev].rank : m; }, 0);
    return { unread: unread.length, active: act.length, max: max, maxSev: max === 4 ? 'critical' : max === 3 ? 'high' : max === 2 ? 'medium' : null };
  }
  function inQuiet(S, now) {
    var q = S.quiet; if (!q || !q.on) return false; var d = new Date(now + 3 * 3600000), m = d.getUTCHours() * 60 + d.getUTCMinutes();
    var a = +q.from.slice(0, 2) * 60 + +q.from.slice(3), b = +q.to.slice(0, 2) * 60 + +q.to.slice(3);
    return a === b ? false : a < b ? (m >= a && m < b) : (m >= a || m < b);
  }
  /* Hangileri dışarı (tarayıcı bildirimi/ntfy/ekran içi) gönderilmeli? */
  function deliverable(log, fresh, S, now) {
    var quiet = inQuiet(S, now);
    return fresh.map(function (f) { return log.items.filter(function (it) { return it.id === f.id; })[0]; }).filter(function (it) {
      if (!it || isSnoozed(log, it, now) || it.resolvedAt) return false;
      var c = S.cats && S.cats[it.cat]; if (c && (c.on === false || c.push === 'off')) return false;
      var need = c ? SEV[c.push] ? SEV[c.push].rank : 3 : 3; if (SEV[it.sev].rank < need) return false;
      if (quiet && !(S.quiet.critBypass && it.sev === 'critical')) return false;
      return true;
    });
  }
  function markRead(log, id, now) { log.read[id] = now; }
  function markAllRead(log, ids, now) { ids.forEach(function (id) { log.read[id] = now; }); }
  function snooze(log, id, until) { log.snooze[id] = until; }
  function dismiss(log, id) { var it = log.items.filter(function (x) { return x.id === id; })[0]; if (!it) return; log.dismissed[id] = SEV[it.sev].rank; log.items = log.items.filter(function (x) { return x.id !== id; }); delete log.read[id]; delete log.snooze[id]; }
  function push(it, S) { // ntfy gövdesi (özel veri içermez: varlık adı/tutar yok)
    return { title: (it.sev === 'critical' ? '🔴 ' : '🟠 ') + it.title.slice(0, 100), message: (it.body || '').replace(/\s+/g, ' ').slice(0, 280), priority: it.sev === 'critical' ? 5 : 4 };
  }
  return { SEV: SEV, CATS: CATS, CAT_HELP: CAT_HELP, DEFAULT_SETTINGS: DEFAULT_SETTINGS, TOPIC_RE: TOPIC_RE, cleanSettings: cleanSettings, cleanLog: cleanLog, cleanItem: cleanItem, evaluate: evaluate, merge: merge, prune: prune, visible: visible, counts: counts, inQuiet: inQuiet,
    deliverable: deliverable, markRead: markRead, markAllRead: markAllRead, snooze: snooze, dismiss: dismiss, isSnoozed: isSnoozed, isRead: isRead, push: push, analogLine: analogLine, slug: slug, signed: signed, pct: pct, f1: f1, tlK: tlK, dtr: dtr };
});
