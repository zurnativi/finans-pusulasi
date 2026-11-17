/* portfolio-ui.js — Portföy Yönetimi arayüzü (Ana sayfa alan kartları, Portföy sayfaları, alım-satım ve fiyat listesi içe aktarma).
 * Hesaplar portfolio.js'te (testli, tam sayı). Bu dosya yalnızca gösterir ve kullanıcı onayıyla kaydeder. app.js'ten önce yüklenir. */
(function () {
  'use strict';
  window.PortfolioUI = function (X) {
    var M = window.Money, C = window.Calc, L = window.Ledger, PF = window.Portfolio, PR = window.Prices, S = window.Sample, P = window.ImportParse;
    var esc = X.esc, tl = X.tl, tl2 = X.tl2, tip = X.tip, pct = X.pct, pct1 = function (bp) { return M.formatBp(bp, 1); };
    var TIERS = PF.TIERS, RISKCOL = { safe: 'var(--safe)', medium: 'var(--medium)', risky: 'var(--risky)' };
    var PCFG_KEY = 'finans-pusulasi:prices'; // fiyat ayarları (Twelve Data anahtarı) — yedeğe girmez
    var pReview = null, priceRun = null, histMsg = '', fetching = false;
    function st() { return X.state(); }
    function pcfg() { try { return JSON.parse(localStorage.getItem(PCFG_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function savePcfg(c) { try { localStorage.setItem(PCFG_KEY, JSON.stringify(c)); } catch (e) { X.toast('Ayar kaydedilemedi'); } }
    function sbp1(bp) { return (bp > 0 ? '+' : bp < 0 ? '−' : '') + '%' + (Math.abs(bp) / 100).toFixed(1).replace('.', ','); }
    function pctF(x, dec) { if (x == null || !isFinite(x)) return '—'; var v = x * 100; if (dec == null) dec = Math.abs(v) < 1 ? 2 : 1; return (v > 0 ? '+' : v < 0 ? '−' : '') + '%' + Math.abs(v).toFixed(dec).replace('.', ','); }
    function plCls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
    function signTl(v) { return (v > 0 ? '+' : '') + tl(v); }
    function pill(level, text) { var c = level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'danger' ? 'err' : 'info'; return '<span class="pill ' + c + '">' + esc(text) + '</span>'; }
    function halalPill(s) { var h = PF.HALAL[s] || PF.HALAL.bilinmiyor; return pill(h.level, h.label); }
    function curSym(c) { return c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'PT' ? 'puan' : 'TL'; }
    function money(minor, cur) { return cur === 'TRY' || !cur ? tl2(minor) : M.format(minor, { symbol: false }) + ' ' + curSym(cur); }
    function priceTxt(p, cur) { return p == null ? '—' : PF.fmtPrice(p) + ' ' + curSym(cur); }
    function keyLabel(k, asset) { var ki = PF.keyInfo(k); if (!ki) return k; if (ki.kind === 'manual') return 'Elle: ' + (asset ? asset.name : k.slice(2)); return ki.label; }
    function assetByKey(k) { return (st().assets || []).find(function (a) { return PF.assetKey(a) === k; }); }
    function keyCur(k) { var ki = PF.keyInfo(k); if (ki && ki.cur) return ki.cur; var a = assetByKey(k); return a ? (a.currency || 'TRY') : 'TRY'; }
    function fieldRow(label, inner, help) { return '<div class="field"><label>' + label + (help ? ' ' + tip(help) : '') + '</label>' + inner + '</div>'; }
    function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    function staleTxt(s) { if (!s || s.level === 'none') return pill('warn', 'fiyat yok'); if (s.level === 'ok') return pill('ok', s.days === 0 ? 'bugün' : s.days + ' gün önce'); if (s.level === 'future') return pill('danger', 'gelecek tarih'); return pill(s.level === 'old' ? 'danger' : 'warn', s.days + ' gün eski'); }

    /* Ortak hesap: analiz (çoklu hedefe göre yamalı), hedef raporu, pozisyonlar */
    function calc() {
      var s = st(), today = X.today(), e = X.eff(), an = C.analyze(e, X.nowYm()), rep = PF.goalsReport(e, an);
      PF.patchAnalysis(an, e, rep);
      var pos = PF.positions(s, e, an, today), sm = PF.summary(s, today), risk = PF.riskReport(s, an, pos);
      return { s: s, today: today, e: e, an: an, rep: rep, pos: pos, sm: sm, risk: risk };
    }
    function newMoneyDefault(an) { var p = an.plan; return Math.max(0, M.sub(p.surplus, p.toEmergency || 0)); }
    function staleList(s, today) {
      var out = [];
      (s.assets || []).forEach(function (a) {
        if (a.tracking !== 'trades' || !PF.tradesOf(s, a.id).length) return;
        var p = PF.position(s, a, today); if (p.ledger.units <= 0) return;
        if (!p.price || p.stale.level !== 'ok') out.push({ asset: a, stale: p.stale, price: p.price });
      });
      ['USD', 'EUR'].forEach(function (c) {
        if (!(s.assets || []).some(function (a) { return a.tracking === 'trades' && a.currency === c; })) return;
        var r = s.rates && s.rates[c]; var sl = r ? PF.staleness({ d: r.date }, 'fx', today) : { level: 'none' };
        if (sl.level !== 'ok') out.push({ asset: { name: c + '/TL kuru' }, stale: sl });
      });
      return out;
    }

    /* ---------- ANA SAYFA: üç alanın sade özeti ---------- */
    function homeCards() {
      var c; try { c = calc(); } catch (e) { console.error(e); return ''; }
      var s = c.s, b = c.an.budget, up = 0; try { up = L.badgeCount(L.upcoming(s, c.today, 30)); } catch (e) { up = 0; }
      var tracked = c.sm.rows.length, worst = c.risk.worst, onTrack = c.rep.goals.filter(function (g) { return g.onTrack; }).length;
      var h = '<div class="areas">';
      h += '<a class="area card" href="#butce"><div class="area-h"><span class="area-ic" aria-hidden="true">🧾</span><b>Bütçe</b></div>' +
        '<div class="area-v ' + (b.surplus < 0 ? 'neg' : 'pos') + '">' + (window.Charts ? window.Charts.counter('a-sur', b.surplus) : tl(b.surplus)) + '</div><div class="hint">her ay artan para</div>' +
        '<div class="area-f">' + (up ? pill('warn', up + ' yaklaşan/geciken ödeme') : pill('ok', 'Yaklaşan ödeme yok')) + '</div></a>';
      h += '<a class="area card" href="#portfoy"><div class="area-h"><span class="area-ic" aria-hidden="true">📈</span><b>Portföy Yönetimi</b></div>' +
        '<div class="area-v">' + (window.Charts ? window.Charts.counter('a-tot', c.an.assets.total) : tl(c.an.assets.total)) + '</div><div class="hint">toplam birikim' + (tracked ? ' · kâr/zarar <b class="' + plCls(c.sm.totalPLTL) + '">' + signTl(c.sm.totalPLTL) + '</b>' : '') + '</div>' +
        '<div class="area-f">' + pill(worst, worst === 'ok' ? 'Risk kuralları tamam' : c.risk.items.filter(function (i) { return i.level !== 'ok'; }).length + ' risk uyarısı') + ' ' + pill(onTrack === c.rep.goals.length ? 'ok' : 'warn', onTrack + '/' + c.rep.goals.length + ' hedef yolunda') + '</div></a>';
      h += '<a class="area card soon" href="#analiz"><div class="area-h"><span class="area-ic" aria-hidden="true">🔎</span><b>Portföy Analizi</b></div>' +
        '<div class="area-v muted">Yakında</div><div class="hint">piyasa ve varlık analizleri</div><div class="area-f">' + pill('info', 'Hazırlanıyor') + '</div></a>';
      h += '</div>';
      var warn = c.risk.items.filter(function (i) { return i.level !== 'ok'; });
      if (warn.length) h += '<div class="notice ' + (worst === 'danger' ? 'danger' : 'warn') + ' simple-risk"><b>Portföy uyarıları:</b> ' + warn.map(function (i) { return esc(i.title); }).join(' · ') + ' — <a href="#portfoy/risk">ayrıntı</a></div>';
      return h;
    }

    /* ---------- PORTFÖY: alt sayfalar ---------- */
    var SUBS = [['', 'Genel bakış'], ['varliklar', 'Varlıklar'], ['islemler', 'Alım-satım'], ['dengeleme', 'Dengeleme'], ['getiri', 'Getiri'], ['hedefler', 'Hedefler'], ['risk', 'Risk ve helal'], ['fiyatlar', 'Fiyatlar']];
    function renderPortfolio() {
      var sub = X.sub(), h = '<h1>Portföy Yönetimi</h1>' + X.subtabs('portfoy', SUBS), c;
      if (st().isExample) h += '<p class="hint">Örnek portföydeki fiyatlar <b>ÖRNEK</b>tir, gerçek piyasa fiyatı değildir. Gerçek fiyat için Fiyatlar → "Fiyatları güncelle".</p>';
      var f = { '': pOverview, varliklar: pAssets, islemler: pTrades, dengeleme: pRebalance, getiri: pReturns, hedefler: pGoals, risk: pRisk, fiyatlar: pPrices }[sub] || pOverview;
      // Bölüm hatası tüm sayfayı kilitlemez: hedefler her durumda düzenlenebilir
      function errBox(e) { console.warn(e); return '<div class="notice warn section-err">Bu bölüm gösterilemedi (' + esc(e.message) + '). Verilerin güvende.</div>'; }
      try { c = calc(); } catch (e) { return h + errBox(e) + goalsEditOnly(); }
      try { return h + f(c); } catch (e2) { return h + errBox(e2) + (sub === 'hedefler' || sub === '' || sub === 'dengeleme' ? goalsEditOnly() : ''); }
    }
    function renderAnalysis() {
      return '<h1>Portföy Analizi</h1><section class="card"><h2>Yakında</h2><p>Bu alan hazırlanıyor: varlıkların piyasa analizi, haber ve trend özetleri, senaryo testleri burada olacak.</p>' +
        '<p class="hint">Şimdilik portföyünü <a href="#portfoy">Portföy Yönetimi</a> bölümünden takip edebilirsin: getiri, dengeleme, risk kuralları ve helal kontrolü orada.</p></section>';
    }

    /* Portföy panosu: değer eğrisi (zaman aralıklı) ve varlık dağılımı halkası */
    /* Seçilen aralıkta gerçek kazanç = değer değişimi − net yatırılan para değişimi (para girişleri kazanç sayılmaz) */
    function rangeGain(val, inv, r, today, rr) {
      var CD = window.ChartData, v = CD.inRange(val, r, today), i = CD.inRange(inv, r, today);
      if (r === 'Tümü' || v.length < 2) { var dvAll = v.length ? v[v.length - 1].v : 0; return { gain: rr.gainTL, dv: dvAll, di: M.sub(dvAll, rr.gainTL) }; }
      var dv = M.sub(v[v.length - 1].v, v[0].v), di = M.sub(i[i.length - 1].v, i[0].v);
      return { gain: M.sub(dv, di), dv: dv, di: di };
    }
    function pVisuals(c) {
      var CH = window.Charts; if (!CH) return '';
      var s = c.s, rr = null; try { rr = PF.returnsReport(s, c.today); } catch (e) { console.error(e); }
      var h = '<div class="grid hero-grid">';
      if (rr && !rr.empty && rr.series.length >= 2) {
        var cum = 0, flowsBy = {}; rr.flows.forEach(function (f) { flowsBy[f.date] = M.add(flowsBy[f.date] || 0, f.amount); });
        var val = [], inv = []; rr.series.forEach(function (p) { cum = M.add(cum, flowsBy[p.date] || 0); val.push({ d: p.date, v: p.value }); inv.push({ d: p.date, v: cum }); });
        h += '<section class="card hero"><div class="label">Yatırımlarının değeri ' + tip('Alım-satımla izlenen varlıkların değeri (ay sonları ve işlem günleri). Kesikli çizgi: net yatırdığın para. Aralığı üstteki düğmelerle değiştir; üzerine gelince o günün tutarlarını görürsün.') + '</div>' +
          '<div class="hero-v">' + CH.counter('p-val', rr.valueNow) + '</div>' +
          CH.area('p-val', { h: 220, label: 'Portföy değeri ve net yatırılan para', today: c.today, ranges: true, defaultRange: 'Tümü', legend: true, series: [{ name: 'Değer', data: val, color: 'brand' }, { name: 'Net yatırılan', data: inv, dashed: true }],
            caption: function (r) { var g = rangeGain(val, inv, r, c.today, rr); var up = g.gain > 0;
              return '<span class="chg big ' + plCls(g.gain) + '">' + (up ? '▲ +' : g.gain < 0 ? '▼ ' : '') + esc(tl(g.gain)) + '</span> <span class="muted">gerçek kazanç (' + esc(r) + ')</span>' +
                '<div class="hint">Değer değişimi ' + esc(signTl(g.dv)) + ' = kazanç ' + esc(signTl(g.gain)) + ' + senin yatırdığın para ' + esc(signTl(g.di)) + '</div>'; } }) + '</section>';
      } else h += '<section class="card hero"><div class="label">Yatırımlarının değeri</div><p class="hint">Alım-satım girince değer eğrin burada canlı çizilir. <a href="#portfoy/islemler">Alım-satım ekle</a></p></section>';
      var items = c.pos.filter(function (p) { return p.valueTL > 0; }).sort(function (a, b) { return b.valueTL - a.valueTL; });
      var tot = M.sum(items.map(function (p) { return p.valueTL; }));
      var top = items.slice(0, 7), rest = M.sum(items.slice(7).map(function (p) { return p.valueTL; }));
      var dItems = top.map(function (p) { return { name: p.name, value: p.valueTL }; }); if (rest > 0) dItems.push({ name: 'Diğer (' + (items.length - 7) + ')', value: rest });
      h += '<section class="card"><h2>Dağılım ' + tip('Acil durum fonu hariç yatırımlarının varlıklara göre payı. Dilime dokununca tutar ve yüzde çıkar.') + '</h2>' +
        (dItems.length ? CH.donut('p-mix', { h: 220, label: 'Yatırımların varlıklara göre dağılımı', items: dItems, center: { title: 'yatırım', value: tot } }) : '<p class="muted">Henüz yatırım yok.</p>') +
        CH.bars('p-tiers', { h: 150, horizontal: true, pctAxis: true, label: 'Risk grubuna göre hedef ve şu anki pay', cats: TIERS.map(function (k) { return C.RISK[k]; }),
          series: [{ name: 'Hedef', data: TIERS.map(function (k) { return c.an.targetAlloc[k]; }), colors: ['safe', 'medium', 'risky'] }, { name: 'Şu an', data: TIERS.map(function (k) { return c.an.currentAlloc[k]; }), colors: ['safe@0.45', 'medium@0.45', 'risky@0.45'] }] }) +
        '<p class="hint">Koyu: hedef · açık: şu an</p></section>';
      return h + '</div>';
    }
    function pOverview(c) {
      var s = c.s, an = c.an, sm = c.sm, CH = window.Charts, h = pVisuals(c) + '<div class="grid kpis">';
      h += X.kpi('Toplam birikim', CH ? CH.counter('p-tot', an.assets.total) : tl(an.assets.total), 'Acil fon dahil; hesaplar ve varlıklar.', 'Hesaplar (kurla TL\'ye çevrilmiş) ve varlıkların bugünkü toplam değeri. Alım-satımla izlenen varlıklar son fiyat × adetle hesaplanır.');
      h += X.kpi('Toplam kâr / zarar', sm.rows.length ? '<span class="' + plCls(sm.totalPLTL) + '">' + (sm.totalPLTL > 0 ? '+' : '') + (CH ? CH.counter('p-pl', sm.totalPLTL) : tl(sm.totalPLTL)) + '</span>' : '<span class="muted">—</span>', sm.rows.length ? 'Yatırılana göre ' + sbp1(sm.totalPLBp) + ' (gerçekleşen ' + tl(sm.realizedTL) + (sm.divTL ? ', temettü dahil ' + tl(sm.divTL) : '') + ')' : 'Alım-satım girince hesaplanır.', 'Alım-satımla izlenen varlıklarda: (bugünkü değer − kalan maliyet) + satışlardan gerçekleşen kâr. Komisyonlar maliyete dahildir.');
      h += X.kpi('Risk kuralları', c.risk.ok + '/' + c.risk.total + ' tamam', pill(c.risk.worst, c.risk.worst === 'ok' ? 'Sorun yok' : c.risk.worst === 'danger' ? 'Önemli uyarı var' : 'Dikkat'), 'Tek varlık sınırı, riskli varlık sınırı, önce acil fon, çeşitlendirme ve helal uygunluk kuralları.');
      var on = c.rep.goals.filter(function (g) { return g.onTrack; }).length;
      h += X.kpi('Hedefler', on + '/' + c.rep.goals.length + ' yolunda', c.rep.goals.map(function (g) { return esc(g.goal.name); }).join(' · '), 'Temel senaryoda hedef tarihine kadar hedef tutara ulaşan hedef sayısı.');
      h += '</div>';
      var sl = staleList(s, c.today);
      if (sm.missing.length) h += '<div class="notice warn">Fiyatı veya kuru olmayan varlık: ' + esc(sm.missing.join(', ')) + '. Değeri kalan maliyetle sayıldı. <a href="#portfoy/fiyatlar">Fiyat gir</a></div>';
      else if (sl.length) h += '<div class="notice warn">' + sl.length + ' fiyat eski: ' + sl.map(function (x) { return esc(x.asset.name); }).join(', ') + '. <a href="#portfoy/fiyatlar">Fiyatları güncelle</a></div>';
      // Bu ay ne alınmalı
      var rb = PF.rebalance(c.pos, an.targetAlloc, newMoneyDefault(an), { tierBandBp: s.settings.rebalance.tierBandBp, assetBandBp: s.settings.rebalance.assetBandBp, blockRisky: C.riskyBlocked(s, an.emergency) });
      h += '<div class="grid two" style="margin-top:14px"><section class="card"><h2>Bu ay yeni parayla ne alınır? ' + tip('Hedef dağılımdan en çok geride kalan helal varlıklara öncelik verilir. Satış önerilmez.') + '</h2>';
      if (an.emergency.shortfall > 0 && an.plan.toEmergency) h += '<p>Önce <b>' + tl(an.plan.toEmergency) + '</b> acil durum fonuna.</p>';
      if (!rb.buys.length) h += '<p class="muted">Bu ay yatırıma ayrılan para yok veya alınacak uygun varlık yok.</p>';
      else h += '<ul class="actions">' + rb.buys.map(function (r) { return '<li class="lv-info"><span><b>' + tl(r.buyTL) + '</b> → ' + esc(r.pos.name) + (r.units ? ' (' + PF.fmtQty(r.units) + ' adet)' : '') + '</span></li>'; }).join('') + '</ul>';
      h += '<a class="btn small" href="#portfoy/dengeleme">Dengeleme ayrıntısı</a></section>';
      h += '<section class="card"><h2>Risk ve helal kontrolü</h2><ul class="rules">' + c.risk.items.map(function (i) { return '<li class="lv-' + i.level + '">' + pill(i.level, i.level === 'ok' ? 'Tamam' : i.level === 'danger' ? 'Önemli' : i.level === 'info' ? 'Bilgi' : 'Dikkat') + ' <b>' + esc(i.title) + '</b><div class="hint">' + esc(i.text) + '</div></li>'; }).join('') + '</ul></section></div>';
      // Varlık listesi
      var total = M.sum(c.pos.map(function (p) { return p.valueTL; }));
      h += '<section class="card" style="margin-top:14px"><h2>Neyim var? ' + tip('Acil durum fonuna ayrılan kısım hariç, yatırım için tutulan her şey. Pay: bu toplam içindeki yüzde.') + '</h2><div class="tablewrap"><table class="holdings stack"><thead><tr><th>Varlık</th><th>Risk</th><th class="r">Değer</th><th class="r">Pay</th><th class="r">Kâr/zarar</th><th>Helal</th></tr></thead><tbody>';
      var byId = {}; sm.rows.forEach(function (r) { byId[r.asset.id] = r; });
      c.pos.slice().sort(function (a, b) { return b.valueTL - a.valueTL; }).forEach(function (p) {
        var r = byId[p.id];
        h += '<tr><td>' + esc(p.name) + (p.isAccount && !p.synthetic ? ' <span class="hint">(hesap)</span>' : '') + '</td><td><i class="dotc" style="background:' + RISKCOL[p.tier] + '"></i> ' + C.RISK[p.tier] + '</td><td class="r num">' + tl(p.valueTL) + '</td><td class="r num">' + (total ? pct(M.ratioBp(p.valueTL, total)) : '—') + '</td>' +
          '<td class="r num ' + (r && r.totalPLTL != null ? plCls(r.totalPLTL) : '') + '">' + (r && r.totalPLTL != null ? signTl(r.totalPLTL) : '<span class="muted">—</span>') + '</td><td>' + halalPill(p.halal) + '</td></tr>';
      });
      h += '</tbody><tfoot><tr><th colspan="2">Yatırım toplamı</th><th class="r num">' + tl(total) + '</th><th></th><th></th><th></th></tr></tfoot></table></div>';
      h += '<p class="hint">Acil durum fonu (' + tl(an.emergency.current) + ') bu listeye dahil değildir.</p></section>';
      return h;
    }

    /* ---------- VARLIKLAR ---------- */
    function pkType(k) { if (!k) return ''; if (/^cg:/.test(k)) return 'cg'; if (/^td:/.test(k)) return 'td'; if (/^tefas:/.test(k)) return 'tefas'; if (/^bist:/.test(k)) return 'bist'; return k; }
    var PK_PH = { cg: 'CoinGecko kimliği, ör. bitcoin', td: 'Sembol, ör. SPUS', tefas: 'Fon kodu, ör. KTV', bist: 'Hisse kodu, ör. ASELS' };
    function codeOf(a, re, len, dflt) { var c = String(a.symbol || '').toUpperCase().replace(re, ''); return c.length >= 2 && c.length <= len ? c : dflt; }
    function pAssets(c) {
      var s = c.s, h = '<p class="hint">Her varlık için <b>değeri elle yaz</b> ya da <b>alım-satımla izle</b> (adet ve fiyattan otomatik hesaplanır). Banka/katılım hesapları, nakit, döviz ve altın hesabı <a href="#hesaplar">Hesaplar</a>\'da tutulur; burada tekrar yazma.</p>';
      h += '<section class="card"><h2>Varlıklarım ' + tip('Bir satıra dokununca ayrıntılar açılır. "Acil fon" işaretliler acil durum fonuna sayılır. Risk seviyesi dağılım hesabında kullanılır.') + '</h2>';
      var byId = {}; c.sm.rows.forEach(function (r) { byId[r.asset.id] = r; });
      if (!s.assets.length) h += '<p class="muted">Henüz varlık yok.</p>';
      s.assets.forEach(function (a) {
        var r = byId[a.id], tracked = a.tracking === 'trades', hs = PF.halalOf(a), id = esc(a.id), pk = pkType(a.priceKey);
        h += '<details class="acard"' + (pAssets.open === a.id ? ' open' : '') + ' data-acard="' + id + '"><summary><span class="acard-n">' + esc(a.name) + (a.symbol ? ' <span class="hint">' + esc(a.symbol) + '</span>' : '') + '</span>' +
          '<span class="acard-v num">' + tl(a.value) + (tracked && a.valueBasis === 'cost' ? ' <span class="pill warn" title="Fiyat veya kur yok; kalan maliyetle sayıldı">maliyet</span>' : '') + '</span>' + halalPill(hs) + '</summary><div class="acard-b grid three">';
        h += fieldRow('Ad', '<input type="text" maxlength="80" data-pfa="name" data-id="' + id + '" value="' + esc(a.name) + '">');
        h += fieldRow('Sembol / kod', '<input type="text" maxlength="30" data-pfa="symbol" data-id="' + id + '" value="' + esc(a.symbol || '') + '" placeholder="ör. ASELS, KTV, SPUS">', 'Aracı kurum dökümünden aktarırken eşleştirmek için kullanılır.');
        h += fieldRow('Tür', '<select data-pfa="cls" data-id="' + id + '">' + Object.keys(C.ASSET_CLASSES).map(function (k) { return opt(k, C.ASSET_CLASSES[k].label, a.cls); }).join('') + '</select>');
        h += fieldRow('Risk', '<select data-pfa="risk" data-id="' + id + '">' + TIERS.map(function (k) { return opt(k, C.RISK[k], a.risk); }).join('') + '</select>');
        h += fieldRow('Nasıl izlensin?', '<select data-pfa="tracking" data-id="' + id + '">' + opt('manual', 'Değeri elle yazarım', tracked ? 'trades' : 'manual') + opt('trades', 'Alım-satım ve fiyatla', tracked ? 'trades' : 'manual') + '</select>', 'Alım-satımla izlenen varlığın değeri = adet × son fiyat (yabancı parada × kur).');
        if (!tracked) h += fieldRow('Değer (TL)', '<input class="money" type="text" inputmode="decimal" data-pfa="value" data-id="' + id + '" value="' + esc(M.format(a.value, { symbol: false })) + '">');
        else {
          h += fieldRow('Para birimi', '<select data-pfa="currency" data-id="' + id + '">' + ['TRY', 'USD', 'EUR'].map(function (k) { return opt(k, k === 'TRY' ? 'TL' : k, a.currency || 'TRY'); }).join('') + '</select>');
          h += fieldRow('Adet türü', '<select data-pfa="lot" data-id="' + id + '">' + Object.keys(PF.LOTS).map(function (k) { return opt(k, PF.LOTS[k], a.lot || 'fraction'); }).join('') + '</select>', 'Hisse ve ETF tam adet alınır; dengeleme önerisi aşağı yuvarlar.');
          h += fieldRow('Fiyat kaynağı', '<select data-pfa="pktype" data-id="' + id + '">' + opt('', 'Elle girerim', pk) + opt('tefas', 'TEFAS fonu (otomatik, günde bir)', pk) + opt('bist', 'BIST hissesi (otomatik, 15 dk gecikmeli)', pk) + opt('metal:XAU', 'Gram altın (otomatik)', pk) + opt('metal:XAG', 'Gram gümüş (otomatik)', pk) + opt('fx:USD', 'ABD doları (otomatik)', pk) + opt('fx:EUR', 'Euro (otomatik)', pk) +
            opt('cg', 'Kripto — CoinGecko (otomatik)', pk) + opt('td', 'ABD ETF/hisse — Twelve Data (ücretsiz anahtar)', pk) + '</select>' +
            (PK_PH[pk] ? '<input type="text" style="margin-top:4px" data-pfa="pkcode" data-id="' + id + '" value="' + esc(a.priceKey.slice(a.priceKey.indexOf(':') + 1)) + '" placeholder="' + PK_PH[pk] + '" aria-label="Fiyat kodu">' : ''),
            'Otomatik kaynaklar ücretsizdir ve tarayıcıdan doğrudan çekilir. TEFAS fonu: fon kodu (ör. KTV) — resmi olmayan ara servis, günde bir. BIST hissesi: hisse kodu (ör. ASELS) — TradingView, resmi değil, 15 dk gecikmeli. Kaynak çalışmazsa fiyatı elle gir veya liste yapıştır.');
        }
        h += fieldRow('Acil fona say', '<label class="row"><input type="checkbox" data-pfa="emergency" data-id="' + id + '"' + (a.emergency ? ' checked' : '') + '> Evet</label>');
        h += fieldRow('Bağlı hedef', '<select data-pfa="goalId" data-id="' + id + '">' + opt('', '— Ortak havuz', a.goalId || '') + (s.goals || []).map(function (g) { return opt(g.id, g.name, a.goalId || ''); }).join('') + '</select>', 'Bir hedefe bağlanan varlığın tamamı o hedefe sayılır. Bağlanmayanlar ortak havuzda; hedeflere paylarına göre dağılır.');
        h += fieldRow('Helal uygunluk', '<select data-pfa="halal.status" data-id="' + id + '">' + Object.keys(PF.HALAL).map(function (k) { return opt(k, PF.HALAL[k].label, hs); }).join('') + '</select>', '"Uygun" etiketlenmeyen varlık alım önerilerine girmez. Uygun değil/şüpheli olanlar "gözden geçir" listesinde gösterilir.');
        h += '<div class="detail-only field"><label>Helal notu</label><input type="text" maxlength="300" data-pfa="halal.note" data-id="' + id + '" value="' + esc((a.halal && a.halal.note) || '') + '" placeholder="ör. Katılım endeksinde"></div>';
        h += '<div class="detail-only field"><label>Kaynak</label><input type="text" maxlength="300" data-pfa="halal.source" data-id="' + id + '" value="' + esc((a.halal && a.halal.source) || '') + '" placeholder="ör. Danışma kurulu kararı, tarih"></div>';
        h += '<div class="detail-only field"><label>Kademe içi hedef payı (%) ' + tip('Aynı risk kademesindeki alınabilir varlıklar arasında bu varlığın hedef payı. Boş bırakılırsa mevcut değerlerine göre paylaşılır.') + '</label><input type="number" min="0" max="100" step="1" data-pfa="withinTierBp" data-id="' + id + '" value="' + (a.withinTierBp == null ? '' : a.withinTierBp / 100) + '"></div>';
        h += '</div>';
        if (tracked && r) {
          var lg = r.ledger;
          h += '<p class="hint">' + PF.fmtQty(lg.units) + ' adet · ortalama maliyet ' + priceTxt(lg.avgPrice, r.currency) + ' · son fiyat ' + (r.price ? priceTxt(r.price.p, r.currency) + ' (' + X.dateLabel(r.price.d) + ', ' + esc(r.price.src || '') + ')' : '—') + ' ' + staleTxt(r.stale) +
            (lg.errors.length ? '<br><b class="neg">' + esc(lg.errors.join('; ')) + '</b>' : '') + ' · <a href="#portfoy/islemler" data-act="pf-trade-for" data-id="' + id + '">alım-satım ekle</a></p>';
        }
        h += '<div class="row"><button class="btn small danger" data-act="pf-del-asset" data-id="' + id + '">Varlığı sil</button></div></details>';
      });
      h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="pf-add-asset" data-kind="manual">+ Değeri elle yazılan varlık</button><button class="btn" data-act="pf-add-asset" data-kind="trades">+ Alım-satımla izlenen varlık</button></div>';
      h += '<p class="hint">Helal araç örnekleri — Güvenli: katılım hesabı, kira sertifikası (sukuk) fonu. Orta: altın, katılım fonları. Riskli: katılım endeksi hisseleri, SPUS/HLAL gibi helal ETF\'ler. Faizli mevduat/fon/tahvil önerilmez.</p></section>';
      // Hesapların helal etiketi
      if ((s.accounts || []).length) {
        h += '<section class="card" style="margin-top:14px"><h2>Hesapların helal etiketi ' + tip('Hesap bakiyeleri Hesaplar bölümünden gelir. Burada yalnızca faizsiz uygunluk etiketini işaretle.') + '</h2><div class="tablewrap"><table><thead><tr><th>Hesap</th><th>Helal</th><th class="detail-only">Not</th></tr></thead><tbody>';
        s.accounts.forEach(function (a) {
          var hs2 = a.halal && a.halal.status ? a.halal.status : (a.type === 'cash' ? 'uygun' : 'bilinmiyor');
          h += '<tr><td>' + esc(a.name) + '</td><td><select data-pfacc="status" data-id="' + esc(a.id) + '" aria-label="' + esc(a.name) + ' helal etiketi">' + Object.keys(PF.HALAL).map(function (k) { return opt(k, PF.HALAL[k].label, hs2); }).join('') + '</select></td>' +
            '<td class="detail-only"><input type="text" maxlength="300" data-pfacc="note" data-id="' + esc(a.id) + '" value="' + esc((a.halal && a.halal.note) || '') + '" aria-label="Not"></td></tr>';
        });
        h += '</tbody></table></div><p class="hint">Faizli vadeli mevduat "Uygun değil" olarak işaretlenmelidir; katılım bankası kâr payı hesapları genelde "Uygun"dur.</p></section>';
      }
      h += X.debtsCard();
      return h;
    }

    /* ---------- ALIM-SATIM ---------- */
    var tradeFor = '';
    function fxAt(s, cur, d) { if (cur === 'TRY') return null; var pts = PF.fxPoints(s, cur), p = PF.priceAt(pts, d); return p ? PF.fxKurusFromPrice(p.p) : null; }
    function pTrades(c) {
      var s = c.s, tracked = s.assets.filter(function (a) { return a.tracking === 'trades'; }), h = '';
      h += '<section class="card"><h2>İşlem ekle: alım, satım, temettü, bedelsiz ' + tip('Her alım ve satımı gir; ortalama maliyet, kâr/zarar ve getiri otomatik hesaplanır. Komisyon maliyete eklenir, satışta gelirden düşülür. Temettü (net) gerçekleşen kâra eklenir; bedelsiz/bölünme adedi artırır, toplam maliyeti değiştirmez (ortalama maliyet düşer); bedelli yeni pay alımıdır.') + '</h2>';
      if (!tracked.length) h += '<p>Önce <a href="#portfoy/varliklar">Varlıklar</a>\'da "Alım-satımla izlenen varlık" ekle ya da aracı kurum dökümünü aktar.</p>';
      else {
        var sel = tracked.find(function (a) { return a.id === tradeFor; }) || tracked[0], cur = sel.currency || 'TRY';
        h += '<form id="pf-trade-form" class="grid three tradef" data-side="buy" autocomplete="off">' +
          fieldRow('Varlık', '<select id="pt-asset">' + tracked.map(function (a) { return opt(a.id, a.name + (a.currency && a.currency !== 'TRY' ? ' (' + a.currency + ')' : ''), sel.id); }).join('') + '</select>') +
          fieldRow('İşlem', '<select id="pt-side">' + Object.keys(PF.SIDES).map(function (k) { return opt(k, PF.SIDES[k], 'buy'); }).join('') + '</select>') +
          fieldRow('Tarih', '<input id="pt-date" type="date" required max="' + c.today + '" value="' + c.today + '">') +
          '<div class="tf tf-ratio">' + fieldRow('Oran (%)', '<input id="pt-ratio" type="text" inputmode="decimal" placeholder="ör. 100">', 'Bedelsiz: %100 = her 1 paya 1 yeni pay; %50 = her 2 paya 1. Hisse birleşmesi için eksi yaz (ör. −50 = 2 pay 1 pay olur). Bedellide yazarsan yeni pay adedi eldeki adetten hesaplanır.') + '</div>' +
          '<div class="tf tf-qp">' + fieldRow('Adet', '<input id="pt-qty" type="text" inputmode="decimal" placeholder="ör. 10 veya 0,5">', 'Küsurat için virgül kullan (8 haneye kadar). Bedellide alınan yeni pay adedi.') + '</div>' +
          '<div class="tf tf-qp">' + fieldRow('<span class="lbl-buy">Birim fiyat</span><span class="lbl-rights">Bedelli fiyatı</span> (' + curSym(cur) + ')', '<input id="pt-price" type="text" inputmode="decimal" placeholder="ör. 145,20">', 'Fon fiyatları için 6 haneye kadar ondalık. Bedelli fiyatı genelde 1 TL\'dir.') + '</div>' +
          '<div class="tf tf-div">' + fieldRow('Brüt temettü tutarı (' + curSym(cur) + ')', '<input id="pt-amount" class="money" type="text" inputmode="decimal" placeholder="ör. 240,00">', 'Kesintiden önceki toplam tutar (pay başına temettü × adet).') + '</div>' +
          '<div class="tf tf-div">' + fieldRow('Stopaj / vergi kesintisi (' + curSym(cur) + ')', '<input id="pt-wht" class="money" type="text" inputmode="decimal" placeholder="0,00">', 'Kesinti yoksa boş bırak. Hesabına geçen = brüt − stopaj.') + '</div>' +
          '<div class="tf tf-fee">' + fieldRow('Komisyon / masraf (' + curSym(cur) + ')', '<input id="pt-fee" class="money" type="text" inputmode="decimal" placeholder="0,00">') + '</div>' +
          (cur !== 'TRY' ? '<div class="tf tf-fx">' + fieldRow('O günkü kur (1 ' + cur + ' = ? TL)', '<input id="pt-fx" class="money" type="text" inputmode="decimal" value="' + esc(fxAt(s, cur, c.today) ? M.format(fxAt(s, cur, c.today), { symbol: false }) : '') + '">', 'TL maliyet ve kur farkı için gerekli. Aracı kurum dökümündeki kuru yaz.') + '</div>' : '') +
          fieldRow('Not', '<input id="pt-note" type="text" maxlength="200" placeholder="isteğe bağlı">') +
          '<div class="field"><button class="btn primary" type="submit">Kaydet</button></div></form><div id="pt-preview" class="hint" aria-live="polite"></div>';
        h += '<p class="hint">Daha hızlısı: <a href="#veri" data-act="pf-import-mode" data-mode="trades">aracı kurum dökümünü (Excel/CSV/PDF/ekran görüntüsü) aktar</a>.</p>';
      }
      h += '</section>';
      // Pozisyon özeti
      var sm = c.sm;
      var dRows = sm.rows.filter(function (r) { return r.ledger.divTL || r.ledger.splits; }), dMax = Math.max.apply(null, dRows.map(function (r) { return r.ledger.divTL || 0; }).concat([1]));
      if (dRows.length) {
        h += '<section class="card div-card" style="margin-top:14px"><h2>💰 Temettü ve bedelsiz ' + tip('Net temettü = brüt − stopaj; gerçekleşen kâra ve getiri hesabına (XIRR/TWR) nakit girişi olarak eklenir. Bedelsiz/bölünme adedi artırır, toplam maliyeti değiştirmez.') + '</h2><div class="grid kpis">' +
          X.kpi('Net temettü', '<span class="pos">+' + tl2(sm.divTL) + '</span>', 'Stopaj: ' + tl2(sm.withholdingTL), 'Hesabına geçen toplam temettü (TL).') +
          X.kpi('Bedelsiz / bölünme', String(dRows.reduce(function (n, r) { return n + (r.ledger.splits || 0); }, 0)) + ' kez', 'Adet arttı, maliyet aynı kaldı', 'Bedelsiz sermaye artırımı veya hisse bölünmesi sayısı.') + '</div>';
        h += '<div class="div-bars">' + dRows.map(function (r) { var v = r.ledger.divTL || 0; return '<div class="div-bar"><span class="db-name" title="' + esc(r.asset.name) + '"><b>' + esc(r.asset.symbol || r.asset.name) + '</b></span><span class="db-track"><span class="db-fill" style="width:' + Math.max(2, Math.round(v * 100 / dMax)) + '%"></span></span><span class="db-val num">' + (v ? '+' + tl2(v) : '—') + (r.ledger.splits ? ' · ' + r.ledger.splits + '× bedelsiz' : '') + '</span></div>'; }).join('') + '</div></section>';
      }
      if (sm.rows.length) {
        h += '<section class="card" style="margin-top:14px"><h2>Pozisyonlar ve kâr/zarar ' + tip('Ağırlıklı ortalama maliyet yöntemi: her alımda maliyet eklenir; satışta, satılan adet oranında maliyet düşülür ve aradaki fark gerçekleşen kâr/zarardır. Yabancı para varlıkta TL maliyet işlem günündeki kurla hesaplanır (kur farkı dahil).') + '</h2><div class="tablewrap"><table><thead><tr><th>Varlık</th><th class="r">Adet</th><th class="r">Ort. maliyet</th><th class="r">Son fiyat</th><th class="r">Değer (TL)</th><th class="r">Gerçekleşmemiş</th><th class="r detail-only">Gerçekleşen</th><th class="r">Toplam</th></tr></thead><tbody>';
        sm.rows.forEach(function (r) {
          var lg = r.ledger, totBp = lg.boughtTL && r.totalPLTL != null ? M.ratioBp(r.totalPLTL, lg.boughtTL) : null;
          h += '<tr><td>' + esc(r.asset.name) + (lg.divTL ? '<div class="hint pos">+' + tl2(lg.divTL) + ' net temettü</div>' : '') + (lg.splits ? '<div class="hint">' + lg.splits + ' bedelsiz/bölünme</div>' : '') + (lg.errors.length ? '<div class="neg hint">' + esc(lg.errors[0]) + '</div>' : '') + '</td><td class="r num">' + PF.fmtQty(lg.units) + '</td><td class="r num">' + priceTxt(lg.avgPrice, r.currency) + '</td>' +
            '<td class="r num">' + (r.price ? priceTxt(r.price.p, r.currency) + qpBtn(PF.assetKey(r.asset)) + '<div class="hint">' + X.dateLabel(r.price.d) + ' ' + staleTxt(r.stale) + '</div>' : pill('warn', 'fiyat yok') + qpBtn(PF.assetKey(r.asset))) + '</td>' +
            '<td class="r num">' + (r.mvTL != null ? tl2(r.mvTL) : '<span class="muted">' + tl2(lg.costTL) + ' (maliyet)</span>') + '</td>' +
            '<td class="r num ' + plCls(r.unrealizedTL) + '">' + (r.unrealizedTL != null ? signTl(r.unrealizedTL) : '—') + '</td><td class="r num detail-only ' + plCls(lg.realizedTL) + '">' + signTl(lg.realizedTL) + '</td>' +
            '<td class="r num ' + plCls(r.totalPLTL) + '">' + (r.totalPLTL != null ? signTl(r.totalPLTL) + (totBp != null ? '<div class="hint">' + sbp1(totBp) + '</div>' : '') : '—') + '</td></tr>' + qpRow(PF.assetKey(r.asset), 8, X.today());
        });
        h += '</tbody><tfoot><tr><th colspan="4">Toplam</th><th class="r num">' + tl2(sm.mvTL) + '</th><th class="r num ' + plCls(sm.unrealizedTL) + '">' + signTl(sm.unrealizedTL) + '</th><th class="r num detail-only ' + plCls(sm.realizedTL) + '">' + signTl(sm.realizedTL) + '</th><th class="r num ' + plCls(sm.totalPLTL) + '">' + signTl(sm.totalPLTL) + '<div class="hint">' + sbp1(sm.totalPLBp) + '</div></th></tr></tfoot></table></div>';
        h += '<p class="hint detail-only">Formüller: Ortalama maliyet = kalan maliyet ÷ kalan adet. Gerçekleşmemiş = adet × son fiyat (× bugünkü kur) − kalan TL maliyet. Gerçekleşen = satış geliri (− komisyon) × o günkü kur − satılan adedin TL maliyeti + net temettüler (brüt − stopaj). Bedelsiz/bölünme toplam maliyeti değiştirmez, adedi artırır. Toplam yüzde, toplam alım tutarına göredir. Ödenen toplam komisyon: ' + tl2(sm.feesTL) + '. Net temettü: ' + tl2(sm.divTL) + ' (stopaj ' + tl2(sm.withholdingTL) + ').</p></section>';
      }
      // İşlem listesi
      if ((s.trades || []).length) {
        var list = s.trades.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }), byA = {};
        s.assets.forEach(function (a) { byA[a.id] = a; });
        h += '<section class="card" style="margin-top:14px"><h2>Tüm alım-satımlar <span class="muted" style="font-size:.9rem;font-weight:400">(' + list.length + ')</span></h2><div class="tablewrap"><table><thead><tr><th>Tarih</th><th>Varlık</th><th>İşlem</th><th class="r">Adet</th><th class="r">Fiyat</th><th class="r detail-only">Komisyon</th><th class="r">Tutar</th><th class="r detail-only">Kur</th><th></th></tr></thead><tbody>';
        var added = {}; s.assets.forEach(function (a) { if (a.tracking === 'trades') PF.ledger(PF.tradesOf(s, a.id)).rows.forEach(function (r) { if (r.unitsAdded != null) added[r.trade.id] = r.unitsAdded; }); });
        list.slice(0, 300).forEach(function (t) {
          var a = byA[t.assetId] || { name: '?' }, cash = PF.tradeCash(t), sd = t.side;
          var pl = sd === 'buy' ? pill('info', 'Alış') : sd === 'sell' ? pill('warn', 'Satış') : sd === 'div' ? '<span class="pill div">💰 Temettü</span>' : sd === 'split' ? '<span class="pill split">✚ Bedelsiz</span>' : '<span class="pill rights">Bedelli</span>';
          var qtyTd = sd === 'div' ? '—' : sd === 'split' ? (added[t.id] != null ? (added[t.id] >= 0 ? '+' : '−') + PF.fmtQty(Math.abs(added[t.id])) : '?') + '<div class="hint">%' + String(t.ratioBp / 100).replace('.', ',') + '</div>' : PF.fmtQty(t.qty);
          var priceTd = sd === 'div' || sd === 'split' ? '—' : priceTxt(t.price, t.currency);
          var cashTd = sd === 'split' ? '<span class="muted">nakit yok</span>' : (sd === 'div' ? '<span class="pos">+' + money(cash, t.currency) + '</span><div class="hint">brüt ' + money(t.amount, t.currency) + (t.withholding ? ' − stopaj ' + money(t.withholding, t.currency) : '') + '</div>' : money(cash, t.currency)) + (t.currency !== 'TRY' && sd !== 'split' ? '<div class="hint">≈ ' + tl2(PF.tradeTL(t, cash)) + '</div>' : '');
          h += '<tr><td class="num">' + X.dateLabel(t.date) + '</td><td>' + esc(a.name) + (t.note ? '<div class="hint">' + esc(t.note) + '</div>' : '') + '</td><td>' + pl + '</td><td class="r num">' + qtyTd + '</td><td class="r num">' + priceTd + '</td>' +
            '<td class="r num detail-only">' + money(t.fee || 0, t.currency) + '</td><td class="r num">' + cashTd + '</td><td class="r num detail-only">' + (t.fxRate ? tl2(t.fxRate) : '—') + '</td>' +
            '<td><button class="btn small danger" data-act="pf-del-trade" data-id="' + esc(t.id) + '" aria-label="İşlemi sil">Sil</button></td></tr>';
        });
        h += '</tbody></table></div>' + (list.length > 300 ? '<p class="hint">Son 300 işlem gösteriliyor.</p>' : '') + '</section>';
      }
      return h;
    }
    function tradeVals() {
      var $ = function (i) { return document.getElementById(i); }, s = st(), a = s.assets.find(function (x) { return x.id === $('pt-asset').value; });
      var side = $('pt-side').value, feeRaw = $('pt-fee').value.trim(), whtRaw = ($('pt-wht') || {}).value || '', ratioRaw = String(($('pt-ratio') || {}).value || '').trim().replace('−', '-');
      var v = { s: s, a: a, side: side, date: P.parseDate($('pt-date').value), q: PF.parseScaled($('pt-qty').value, 8), p: PF.parseScaled($('pt-price').value, 6), fee: feeRaw ? M.parse(feeRaw) : 0,
        amount: M.parse(($('pt-amount') || {}).value || ''), wht: whtRaw.trim() ? M.parse(whtRaw) : 0, ratioBp: ratioRaw ? PF.parseScaled(ratioRaw, 2) : null, cur: a ? a.currency || 'TRY' : 'TRY' };
      v.lg = a ? PF.ledger(PF.tradesOf(s, a.id).filter(function (t) { return !v.date || t.date <= v.date; })) : null;
      if (side === 'rights' && (!v.q || v.q <= 0) && v.ratioBp > 0 && v.lg) v.q = PF.splitAdded(v.lg.units, v.ratioBp); // oran yazıldıysa yeni pay adedi
      return v;
    }
    function tradePreview() {
      var el = document.getElementById('pt-preview'); if (!el) return;
      var form = document.getElementById('pf-trade-form'), side = document.getElementById('pt-side').value; if (form) form.dataset.side = side;
      var v = tradeVals(), a = v.a, cur = v.cur, lg = v.lg; if (!a) return;
      var msg = '';
      if (side === 'div') {
        if (!v.amount || v.amount <= 0 || v.wht == null || v.fee == null) { el.textContent = ''; return; }
        var net = v.amount - Math.abs(v.wht) - Math.abs(v.fee);
        msg = 'Hesabına geçen net temettü = brüt ' + money(v.amount, cur) + (v.wht ? ' − stopaj ' + money(Math.abs(v.wht), cur) : '') + (v.fee ? ' − masraf ' + money(Math.abs(v.fee), cur) : '') + ' = <b class="pos">' + money(net, cur) + '</b> · gerçekleşen kâra ve getiriye eklenir; maliyet ve adet değişmez.';
        if (lg && lg.units <= 0) msg += ' · <b class="neg">O tarihte eldeki adet yok</b>';
      } else if (side === 'split') {
        if (!v.ratioBp || v.ratioBp <= -10000) { el.textContent = ''; return; }
        if (!lg || lg.units <= 0) { el.innerHTML = '<b class="neg">O tarihte eldeki adet yok</b>'; return; }
        var add = PF.splitAdded(lg.units, v.ratioBp), nu = lg.units + add;
        msg = 'Eldeki ' + PF.fmtQty(lg.units) + ' adet → <b>' + PF.fmtQty(nu) + ' adet</b> (' + (add >= 0 ? '+' : '−') + PF.fmtQty(Math.abs(add)) + ') · toplam maliyet aynı (' + money(lg.costNative, cur) + ') · ortalama maliyet ' + priceTxt(lg.avgPrice, cur) + ' → <b>' + (nu > 0 ? priceTxt(PF.mulDiv(lg.costNative, 1000000000000, nu), cur) : '—') + '</b>';
      } else {
        var q = v.q, p = v.p, fee = v.fee;
        if (!q || !p || q <= 0 || p <= 0 || fee == null) { el.textContent = side === 'rights' && v.ratioBp ? 'Eldeki adet yok; oran uygulanamadı.' : ''; return; }
        var t = { side: side, qty: q, price: p, fee: Math.abs(fee), currency: cur }, g = PF.tradeGross(t), cash = PF.tradeCash(t);
        msg = (side === 'rights' ? 'Yeni pay: <b>' + PF.fmtQty(q) + '</b> · ' : '') + 'Adet × fiyat = <b>' + money(g, cur) + '</b> · ' + (side !== 'sell' ? 'ödenecek' : 'eline geçecek') + ' (komisyon dahil): <b>' + money(cash, cur) + '</b>';
        if (side !== 'sell') { var nu2 = lg.units + q, nc = lg.costNative + cash; msg += ' · yeni ortalama maliyet ≈ ' + priceTxt(PF.mulDiv(nc, 1000000000000, nu2), cur); }
        else if (q > lg.units) msg += ' · <b class="neg">Eldeki adet (' + PF.fmtQty(lg.units) + ') yetmiyor</b>';
        else { var out = PF.mulDiv(lg.costNative, q, lg.units); msg += ' · tahmini gerçekleşen kâr/zarar: <b class="' + plCls(cash - out) + '">' + money(cash - out, cur) + '</b>' + (cur !== 'TRY' ? ' (' + cur + ' cinsinden, kur farkı hariç)' : ''); }
      }
      el.innerHTML = msg;
    }
    function submitTrade() {
      var $ = function (i) { return document.getElementById(i); }, v = tradeVals(), s = v.s, a = v.a; if (!a) return X.toast('Varlık seç');
      var side = v.side, cur = v.cur, fx = cur !== 'TRY' && side !== 'split' ? M.parse(($('pt-fx') || {}).value || '') : null, errs = [];
      if (!v.date) errs.push('tarih'); else if (v.date > X.today()) errs.push('tarih gelecekte olamaz');
      if (v.fee == null || v.fee < 0) errs.push('komisyon'); if (cur !== 'TRY' && side !== 'split' && (!fx || fx <= 0)) errs.push('kur');
      var t = { id: S.uid(), assetId: a.id, date: v.date, side: side, qty: 0, price: 0, fee: side === 'split' ? 0 : Math.abs(v.fee || 0), currency: cur, fxRate: cur === 'TRY' || side === 'split' ? null : fx, note: $('pt-note').value.trim(), source: 'elle' };
      if (side === 'div') { if (!v.amount || v.amount <= 0) errs.push('brüt temettü tutarı'); if (v.wht == null || v.wht < 0 || (v.amount && v.wht > v.amount)) errs.push('stopaj (0 ile brüt arası)'); t.amount = v.amount; t.withholding = Math.abs(v.wht || 0); }
      else if (side === 'split') { if (!v.ratioBp || v.ratioBp <= -10000) errs.push('oran (ör. 100)'); else if (!v.lg || v.lg.units <= 0) errs.push('o tarihte eldeki adet yok'); t.ratioBp = v.ratioBp; }
      else { if (!v.q || v.q <= 0) errs.push('adet'); if (!v.p || v.p <= 0) errs.push('fiyat'); t.qty = v.q; t.price = v.p; if (side === 'rights' && v.ratioBp) t.ratioBp = v.ratioBp; }
      if (errs.length) return X.toast('Kontrol et: ' + errs.join(', '));
      if ((side === 'buy' || side === 'sell') && s.trades.some(function (x) { return PF.tradeKey(x) === PF.tradeKey(t); }) && !confirm('Aynı tarih, adet ve fiyatla bir işlem zaten var. Yine de eklensin mi?')) return;
      tradeFor = a.id;
      var lbl = side === 'div' ? 'Temettü kaydedildi: ' + a.name + ' net ' + money(PF.tradeCash(t), cur) : side === 'split' ? 'Bedelsiz/bölünme kaydedildi: ' + a.name + ' %' + String(t.ratioBp / 100).replace('.', ',') : PF.SIDES[side] + ' kaydedildi: ' + a.name + ' ' + PF.fmtQty(t.qty) + ' adet';
      X.mutate(function (s2) { s2.trades.push(t); }, lbl);
    }

    /* ---------- DENGELEME ---------- */
    var rbMoney = null;
    function pRebalance(c) {
      var s = c.s, an = c.an, rs = s.settings.rebalance, money = rbMoney == null ? newMoneyDefault(an) : rbMoney;
      var block = C.riskyBlocked(s, an.emergency);
      var rb = PF.rebalance(c.pos, an.targetAlloc, money, { tierBandBp: rs.tierBandBp, assetBandBp: rs.assetBandBp, blockRisky: block });
      var h = '<section class="card"><h2>Dengeleme: önce yeni parayla ' + tip('Hedef dağılımdan sapma varsa, önce bu ay yatıracağın yeni parayla en geride kalan helal varlıklar alınır. Hiçbir zaman otomatik satış önerilmez: hedefin üstündekiler "gözden geçir" olarak listelenir; satış kararı ayrı analiz gerektirir.') + '</h2>';
      h += '<div class="grid three">' + fieldRow('Bu ay yatırılacak yeni para (TL)', '<input id="rb-money" class="money" type="text" inputmode="decimal" value="' + esc(M.format(money, { symbol: false })) + '">', 'Varsayılan: aylık fazla − acil fona giden kısım (' + tl(newMoneyDefault(an)) + ').') +
        '<div class="detail-only">' + fieldRow('Kademe sapma bandı (%)', '<input type="number" min="0" max="50" step="1" data-pfset="tierBandBp" value="' + rs.tierBandBp / 100 + '">', 'Güvenli/orta/riskli payı hedeften bu kadar puan saparsa "dengeleme gerekli" denir.') + '</div>' +
        '<div class="detail-only">' + fieldRow('Varlık sapma bandı (%)', '<input type="number" min="0" max="50" step="1" data-pfset="assetBandBp" value="' + rs.assetBandBp / 100 + '">', 'Bir varlık hedef payını bu kadar puan aşarsa "gözden geçir" listesine girer.') + '</div></div>';
      h += '<p>' + (rb.needsRebalance ? pill('warn', 'Hedeften sapma var') : pill('ok', 'Dağılım hedefe yakın')) + ' Hedef dağılım: ' + TIERS.map(function (k) { return C.RISK[k] + ' ' + pct1(an.targetAlloc[k]); }).join(' · ') + (c.rep.goals.length > 1 ? ' <span class="hint">(hedeflerin ağırlıklı ortalaması)</span>' : '') + '</p>';
      h += '<div class="tablewrap"><table><thead><tr><th>Grup</th><th class="r">Şu an</th><th class="r">Hedef</th><th class="r">Fark</th><th class="r">Alımdan sonra</th></tr></thead><tbody>' + rb.tiers.map(function (t) {
        return '<tr><td><i class="dotc" style="background:' + RISKCOL[t.tier] + '"></i> ' + C.RISK[t.tier] + '</td><td class="r num">' + tl(t.now) + ' <span class="hint">' + pct1(t.nowBp) + '</span></td><td class="r num">' + pct1(t.targetBp) + '</td><td class="r num ' + (Math.abs(t.driftBp) > rs.tierBandBp ? 'neg' : '') + '">' + X.sbp(t.driftBp) + '</td><td class="r num">' + pct1(t.afterBp) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
      h += '<section class="card" style="margin-top:14px"><h2>Alınacaklar (yeni parayla)</h2>';
      if (!rb.buys.length) h += '<p class="muted">' + (money ? 'Alınacak uygun varlık yok.' : 'Yeni para girilmedi.') + '</p>';
      else {
        h += '<div class="tablewrap"><table><thead><tr><th>Varlık</th><th class="r">Tutar</th><th class="r">Adet</th><th class="r detail-only">Birim fiyat</th><th class="r detail-only">Artan</th></tr></thead><tbody>';
        rb.buys.forEach(function (r) {
          h += '<tr><td>' + esc(r.pos.name) + (r.pos.generic ? '<div class="hint">Bu kademede alınabilir (helal etiketli) varlığın yok; genel öneri.</div>' : '') + '</td><td class="r num"><b>' + tl2(r.buyTL) + '</b>' + (r.buyNative != null ? '<div class="hint">≈ ' + money(r.buyNative, r.pos.currency) + '</div>' : '') + '</td>' +
            '<td class="r num">' + (r.units != null ? PF.fmtQty(r.units) + (r.pos.lot === 'whole' ? ' <span class="hint">tam</span>' : '') : (r.pos.asset && r.pos.asset.tracking !== 'trades' ? '<span class="muted">tutar olarak</span>' : '<span class="muted">fiyat yok</span>')) + '</td><td class="r num detail-only">' + (r.pos.priceTL ? priceTxt(r.pos.priceTL, 'TRY') : '—') + '</td><td class="r num detail-only">' + (r.cashLeft != null ? tl2(r.cashLeft) : '—') + '</td></tr>';
        });
        h += '</tbody><tfoot><tr><th>Toplam</th><th class="r num">' + tl2(M.sum(rb.buys.map(function (r) { return r.buyTL; }))) + '</th><th></th><th class="detail-only"></th><th class="r num detail-only">' + tl2(rb.leftoverCash) + '</th></tr></tfoot></table></div>';
        if (rb.leftoverCash > 0) h += '<p class="hint">Tam adet yuvarlaması nedeniyle ' + tl2(rb.leftoverCash) + ' nakit kalır (sonraki aya devreder).</p>';
      }
      rb.notes.forEach(function (n) { h += '<div class="notice warn">' + esc(n) + '</div>'; });
      h += '</section>';
      h += '<section class="card" style="margin-top:14px"><h2>Gözden geçir (satış emri değildir) ' + tip('Bu liste satış önerisi değildir. Hedefin üstündeki veya helal uygunluğu olmayan varlıkları gösterir. Satış kararı vergi, maliyet ve piyasa analizi gerektirir.') + '</h2>';
      if (!rb.reviews.length) h += '<p class="muted">Gözden geçirilecek varlık yok.</p>';
      else h += '<div class="tablewrap"><table><thead><tr><th>Varlık</th><th>Neden</th><th class="r">Hedefin üstündeki kısım</th><th class="r detail-only">≈ Adet</th></tr></thead><tbody>' + rb.reviews.map(function (r) {
        return '<tr><td>' + esc(r.pos.name) + '</td><td>' + pill(r.pos.halal === 'uygun_degil' ? 'danger' : 'warn', r.reason) + '</td><td class="r num">' + tl(r.excess) + ' <span class="hint">' + X.sbp(r.driftBp) + '</span></td><td class="r num detail-only">' + (r.reviewUnits != null ? PF.fmtQty(r.reviewUnits) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">Kuralın: satış ancak analizden sonra. Bu tablo yalnızca dikkat çekmek içindir.</p>';
      h += '</section>';
      h += '<p class="hint detail-only">Yöntem: Toplam (mevcut + yeni para) hedef paylara kuruşu kuruşuna bölünür. Hesaplar ve helal etiketi "Bilinmiyor" olan varlıklar mevcut değerinde sabit tutulur; "Uygun değil/Şüpheli" varlıkların hedefi 0\'dır. Yeni para önce hedefin altında kalanların açığına (oranlı), açıklar kapanırsa hedef paylarına göre dağıtılır. Adet aşağı yuvarlanır, tutar hiç aşılmaz.</p>';
      return h;
    }

    /* ---------- GETİRİ ---------- */
    function lineChart(points, label) {
      if (points.length < 2) return '';
      var w = 900, hh = 220, padL = 90, padB = 24, padT = 10, vals = points.map(function (p) { return p.v; });
      var minV = Math.min.apply(null, vals.concat([0])), maxV = Math.max.apply(null, vals) * 1.05 || 1, n = points.length - 1;
      function x(i) { return padL + (w - padL - 10) * i / n; } function y(v) { return padT + (hh - padT - padB) * (1 - (v - minV) / (maxV - minV || 1)); }
      var svg = '<svg viewBox="0 0 ' + w + ' ' + hh + '" role="img" aria-label="' + esc(label) + '">';
      for (var i = 0; i <= 3; i++) { var v = minV + (maxV - minV) * i / 3; svg += '<line x1="' + padL + '" x2="' + (w - 10) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (padL - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(M.formatShort(Math.round(v))) + '</text>'; }
      [0, Math.floor(n / 2), n].forEach(function (i) { svg += '<text x="' + x(i) + '" y="' + (hh - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === n ? 'end' : 'middle') + '">' + esc(X.dateLabel(points[i].d)) + '</text>'; });
      if (points[0].c != null) svg += '<polyline fill="none" stroke="var(--muted)" stroke-dasharray="4 3" stroke-width="2" points="' + points.map(function (p, i2) { return x(i2).toFixed(1) + ',' + y(p.c).toFixed(1); }).join(' ') + '"/>';
      svg += '<polyline fill="none" stroke="var(--brand)" stroke-width="2.5" points="' + points.map(function (p, i2) { return x(i2).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ') + '"/></svg>';
      return '<div class="chart">' + svg + '</div>';
    }
    function pReturns(c) {
      var s = c.s, rr = PF.returnsReport(s, c.today), h = '';
      if (rr.empty) return '<section class="card"><h2>Getiri</h2><p>Getiri ölçümü için alım-satım gir. <a href="#portfoy/islemler">Alım-satım ekle</a> veya <a href="#veri" data-act="pf-import-mode" data-mode="trades">dökümden aktar</a>.</p></section>' + cpiCard(c, null);
      var t = rr.twr, inf = rr.inflation;
      h += '<div class="grid kpis">';
      var gr = rr.gross || { bought: rr.invested, sold: rr.withdrawn, dividends: 0 };
      h += X.kpi('Yatırılan (net)', tl(M.sub(rr.invested, rr.withdrawn)), 'Alımlar ' + tl(gr.bought) + ' − satışlar ' + tl(gr.sold) + (gr.dividends ? ' − temettüler ' + tl(gr.dividends) : ''), 'Alım-satımla izlenen varlıklara giren ve çıkan para (komisyon dahil, TL). Satışlar ve temettüler ayrı gösterilir; ikisi de cebine dönen paradır.');
      h += X.kpi('Bugünkü değer', tl(rr.valueNow), 'Alım-satımla izlenen varlıklar · kazanç: <b class="' + plCls(rr.gainTL) + '">' + signTl(rr.gainTL) + '</b>', 'Yalnızca alım-satım kaydı olan varlıkların bugünkü değeri (adet × son fiyat). Banka hesapları ve tutar olarak girilen varlıklar getiri hesabına girmez; onlar Genel bakış\'taki toplam birikimde. Kazanç = bugünkü değer + satışlardan çekilen − yatırılan.');
      h += X.kpi('Yıllık getirin<span class="detail-only"> (para ağırlıklı, XIRR)</span>', '<span class="' + plCls(rr.xirr) + '">' + pctF(rr.xirr) + '</span>', 'Enflasyondan arındırılmış: ' + (rr.realXirr != null ? '<b class="' + plCls(rr.realXirr) + '">' + pctF(rr.realXirr) + '</b>' : '<span class="muted">TÜFE gir</span>'), 'Paranı ne zaman, ne kadar yatırdığını hesaba katan yıllık getiri: senin cebine yansıyan gerçek sonuç. (Teknik adı: para ağırlıklı getiri, XIRR.)');
      h += X.kpi('<span class="simple-only">Seçtiğin varlıkların performansı</span><span class="detail-only">Zaman ağırlıklı getiri (TWR)</span>', '<span class="' + plCls(t.period) + '">' + pctF(t.period) + '</span>', (t.annualized != null ? 'Yıllık ' + pctF(t.annualized) + ' · ' : '') + X.monthsLabel(Math.round(t.days / 30.44)) + (rr.realTwr != null ? ' · enflasyondan sonra ' + pctF(rr.realTwr) : ''), 'Ne zaman para eklediğinden bağımsız olarak, seçtiğin varlıkların kendisi ne kadar kazandırdı. 1 yıldan kısa sürede yıllığa çevrilmez. (Teknik adı: zaman ağırlıklı getiri, TWR.)');
      h += '</div>';
      if (inf.factor == null) h += '<div class="notice warn">Enflasyondan arındırılmış getiri için ' + esc(rr.first.slice(0, 7)) + ' ayından bu yana aylık TÜFE değerlerini aşağıya gir.' + (inf.missing.length ? ' Eksik: ' + esc(inf.missing.slice(0, 6).join(', ')) + (inf.missing.length > 6 ? '…' : '') : '') + '</div>';
      else if (inf.partial) h += '<p class="hint">Reel getiri ' + esc(inf.upTo) + ' ayına kadarki TÜFE ile hesaplandı (' + esc(inf.missing.join(', ')) + ' henüz girilmedi). Dönemdeki toplam enflasyon: ' + pctF(inf.factor - 1) + '.</p>';
      else h += '<p class="hint">Dönemdeki toplam enflasyon (TÜFE): ' + pctF(inf.factor - 1) + '.</p>';
      // Değer grafiği
      var cum = 0, flowsBy = {}; rr.flows.forEach(function (f) { flowsBy[f.date] = M.add(flowsBy[f.date] || 0, f.amount); });
      var pts = rr.series.map(function (p) { cum = M.add(cum, flowsBy[p.date] || 0); return { d: p.date, v: p.value, c: cum }; });
      var CH = window.Charts;
      h += '<section class="card" style="margin-top:14px"><h2>Portföy değeri ' + tip('Mavi çizgi: alım-satımla izlenen varlıkların ay sonu değerleri. Kesikli çizgi: net yatırdığın para. Üzerine gelince o günün tutarlarını görürsün.') + '</h2>' +
        (CH && pts.length >= 2 ? CH.area('r-val', { h: 260, label: 'Portföy değeri ve yatırılan para', today: c.today, ranges: true, defaultRange: 'Tümü', legend: true, series: [{ name: 'Değer', data: pts.map(function (p) { return { d: p.d, v: p.v }; }), color: 'brand' }, { name: 'Net yatırılan', data: pts.map(function (p) { return { d: p.d, v: p.c }; }), dashed: true }] }) : lineChart(pts, 'Portföy değeri ve yatırılan para')) + '<p class="hint detail-only">Mavi: değer · kesikli: net yatırılan.</p></section>';
      // Kıyas
      h += '<section class="card" style="margin-top:14px"><h2>Kıyas: aynı parayı başka yere koysaydın ' + tip('Her alımda ve satımda aynı TL tutarı aynı gün Katılım 50 endeksine (varsayılan helal kıyas), altına veya dolara koysaydın bugün ne olurdu? Fiyat geçmişi gerekir. BIST 100 faizli şirketleri de içerdiği için yalnızca detaylı görünümde, bilgi amaçlı gösterilir.') + '</h2><div class="tablewrap"><table><thead><tr><th>Seçenek</th><th class="r">Bugünkü değer</th><th class="r">Yıllık getiri</th><th class="r">Fark</th></tr></thead><tbody>';
      h += '<tr><td><b>Senin portföyün</b></td><td class="r num"><b>' + tl(rr.valueNow) + '</b></td><td class="r num">' + pctF(rr.xirr) + '</td><td></td></tr>';
      var needHist = false;
      rr.benchmarks.forEach(function (b) {
        var trc = b.detailOnly ? ' class="detail-only"' : b.primary ? ' class="bench-primary"' : '';
        if (!b.sim.ok) { needHist = true; h += '<tr' + trc + '><td>' + esc(b.label) + (b.primary ? ' <span class="pill info">varsayılan</span>' : '') + '</td><td colspan="3" class="hint">Fiyat geçmişi eksik (' + esc(b.sim.missing.slice(0, 3).map(X.dateLabel).join(', ')) + (b.sim.missing.length > 3 ? '…' : '') + ')</td></tr>'; return; }
        var diff = M.sub(rr.valueNow, b.sim.finalTL);
        h += '<tr' + trc + '><td>' + (b.primary ? '<b>' + esc(b.label) + '</b> <span class="pill ok">varsayılan</span>' : esc(b.label)) + (b.sim.approx ? ' <span class="pill info" title="Bazı günler için en yakın önceki fiyat kullanıldı (en çok ' + b.sim.maxGapDays + ' gün)">yaklaşık</span>' : '') + '</td><td class="r num">' + tl(b.sim.finalTL) + '</td><td class="r num">' + pctF(b.sim.xirr) + '</td><td class="r num ' + plCls(diff) + '">' + (diff >= 0 ? 'portföyün ' + tl(diff) + ' önde' : 'portföyün ' + tl(-diff) + ' geride') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="row" style="margin-top:8px"><button class="btn small" data-act="pf-hist"' + (fetching ? ' disabled' : '') + '>Geçmiş fiyatları indir (dolar, altın, kripto)</button><a class="btn small" href="#portfoy/fiyatlar">Katılım 50 geçmişini gir</a></div>' +
        (histMsg ? '<div class="hint" role="status">' + histMsg + '</div>' : '') + '<p class="hint"><span class="detail-only">Dolar: Avrupa Merkez Bankası kurları (Frankfurter). Altın: Currency API (ons altın ÷ 31,1035). </span> Katılım 50 (KATLM) ve BIST 100 geçmişi için ücretsiz tarayıcı kaynağı yok; Fiyatlar\'dan elle veya CSV ile girebilirsin. Katılım Tüm endeksinin güncel değeri "Fiyatları güncelle" ile TradingView\'den gelir ve her güncellemede geçmişe eklenir. Hiçbir fiyat uydurulmaz.</p>' + (needHist ? '' : '') + '</section>';
      h += cpiCard(c, rr.first);
      h += '<p class="hint detail-only">Formüller: TWR = Π (Vᵢ − Akışᵢ) ÷ Vᵢ₋₁ − 1 (değerlemeler ay sonu ve işlem günlerinde). XIRR: Σ akış ÷ (1+r)^(gün/365) = 0 denklemini çözen r (ikiye bölme yöntemi). Reel = (1 + nominal) ÷ TÜFE çarpanı − 1; TÜFE çarpanı aylık değişimlerin gün ağırlıklı bileşimi.</p>';
      return h;
    }
    function cpiCard(c, first) {
      var s = c.s, map = {}; (s.cpi || []).forEach(function (x) { map[x.ym] = x.bp; });
      var end = X.nowYm(), start = first ? first.slice(0, 7) : L.addMonthsYm(end, -12), months = [], ym = start;
      if (L.addMonthsYm(start, 36) < end) start = L.addMonthsYm(end, -36);
      ym = start; while (ym <= end) { months.push(ym); ym = L.addMonthsYm(ym, 1); }
      var h = '<section class="card" style="margin-top:14px"><h2>Aylık enflasyon (TÜFE) ' + tip('TÜİK\'in açıkladığı aylık TÜFE değişimini (%) gir. Ör. %2,55 için 2,55 yaz. Uygulama bu veriyi internetten çekmez; resmi kaynaktan kendin girersin.') + '</h2>';
      h += '<div class="cpi-grid">' + months.slice().reverse().map(function (m) { return '<label class="cpi-cell"><span>' + esc(X.ymLabel(m)) + '</span><input type="text" inputmode="decimal" data-cpi="' + m + '" value="' + (map[m] == null ? '' : String(map[m] / 100).replace('.', ',')) + '" placeholder="%"></label>'; }).join('') + '</div>';
      h += '<details style="margin-top:8px"><summary>Toplu yapıştır</summary><p class="hint">Her satıra "YYYY-AA değer" yaz (ör. <code>2026-10 2,55</code>). Mevcut aylar güncellenir.</p><textarea id="cpi-bulk" rows="4" style="width:100%"></textarea><button class="btn small" data-act="pf-cpi-bulk">Kaydet</button></details>';
      return h + '<p class="hint">Kaynak: TÜİK Tüketici Fiyat Endeksi bülteni (aylık % değişim).</p></section>';
    }

    /* ---------- HEDEFLER ---------- */
    /* Hedef düzenleme alanları: projeksiyon hesaplanamasa bile (ör. aşırı değerler) her zaman gösterilir */
    function goalEditor(g, canDelete, open) {
      var id = esc(g.id);
      return '<details' + (open ? ' open' : '') + '><summary>Düzenle</summary><div class="grid two">' +
          fieldRow('Ad', '<input type="text" maxlength="60" data-pfg="name" data-id="' + id + '" value="' + esc(g.name) + '">') +
          fieldRow('Hedef tutar (bugünün parasıyla, TL)', '<input class="money" type="text" inputmode="decimal" data-pfg="target" data-id="' + id + '" value="' + esc(M.format(g.target, { symbol: false })) + '">') +
          fieldRow('Hedef tarih (ay)', '<input type="month" data-pfg="targetYm" data-id="' + id + '" value="' + esc(g.targetYm) + '">') +
          fieldRow('Aylık birikimden pay (%)', '<input type="number" min="0" max="100" step="1" data-pfg="shareBp" data-id="' + id + '" value="' + g.shareBp / 100 + '">', 'Her ay artan paranın (acil fon sonrası) bu hedefe giden yüzdesi. Mevcut ortak birikim de bu oranla paylaştırılır.') +
          fieldRow('Risk profili<span class="detail-only"> (süzülme yolu)</span>', '<select data-pfg="glide" data-id="' + id + '">' + Object.keys(PF.GLIDES).map(function (k) { return opt(k, PF.GLIDES[k].label, g.glide); }).join('') + '</select>', 'Hedefe yaklaştıkça riskli payın ne hızla azalacağı. Temkinli: kısa vadeli, kaybı kaldıramayacağın hedefler. Büyüme: emeklilik gibi uzun vadeli hedefler.') +
          '</div>' + (canDelete ? '<button class="btn small danger" data-act="pf-del-goal" data-id="' + id + '">Hedefi sil</button>' : '') + '</details>';
    }
    function goalsEditOnly() {
      var gs = st().goals || [];
      return '<section class="card"><h2>Hedeflerini düzenle</h2><p class="hint">Tahminler şu an hesaplanamadı; hedef tutarını, tarihini veya Ayarlar\'daki enflasyonu düzelterek sorunu giderebilirsin.</p>' +
        gs.map(function (g) { return '<div class="card goal"><b>' + esc(g.name) + '</b>' + goalEditor(g, gs.length > 1, true) + '</div>'; }).join('') + '</section>';
    }
    function pGoals(c) {
      var s = c.s, rep = c.rep, h = '<p class="hint">Birden fazla hedefin olabilir. Her hedef aylık birikimden bir pay alır; istersen bir varlığı doğrudan bir hedefe bağlarsın (Varlıklar). Tutarları <b>bugünün parasıyla</b> yaz.</p>';
      h += '<div class="notice ' + (rep.shareTotalBp > 10000 ? 'danger' : 'info') + '">Payların toplamı: <b>' + pct(rep.shareTotalBp) + '</b>' + (rep.shareTotalBp < 10000 ? ' · kalan ' + pct(10000 - rep.shareTotalBp) + ' (' + tl(rep.unallocatedMonthly) + '/ay) hiçbir hedefe ayrılmadı; uzun vadeli dengeli birikim sayılır.' : '') + ' Ortak havuz: ' + tl(rep.unassigned) + ' (acil fon hariç, bir hedefe bağlanmamış birikim).</div>';
      h += '<div class="goals">';
      rep.goals.forEach(function (r, gi) {
        var g = r.goal, id = esc(g.id), sc = r.projection, CH = window.Charts;
        h += '<section class="card goal"><div class="row" style="justify-content:space-between"><h2 style="margin:0">' + esc(g.name) + '</h2>' + (r.onTrack ? pill('ok', 'Yolunda') : pill('warn', 'Geride')) + '</div>';
        h += '<div class="goal-top">' + (CH ? CH.ring('pg-' + gi, { h: 104, bp: r.progressBp, color: r.onTrack ? 'safe' : 'medium', label: g.name + ' hedefi: yüzde ' + Math.round(r.progressBp / 100) }) : '') + '<div class="grow">' +
          '<div class="value num" style="font-size:1.4rem;font-weight:700">' + (CH ? CH.counter('pg-' + gi, r.current) : tl(r.current)) + ' <span class="muted" style="font-size:1rem">/ ' + tl(g.target) + '</span></div>' + X.progress(r.progressBp) + X.monthsLabel(r.monthsLeft) + ' kaldı (' + esc(X.ymLabel(g.targetYm)) + ')</div></div>';
        h += '<p class="hint">Aylık payı: <b>' + tl(r.monthly) + '</b> · getirisiz gereken: ' + tl(r.neededMonthly) + '/ay · bağlı varlıklar ' + tl(r.assigned) + ' + havuzdan ' + tl(r.fromPool) + '</p>';
        if (sc.base.capped || sc.optimistic.capped) h += '<div class="notice warn">Tahmin çok büyük çıktı (10 trilyon TL üstü, "çok büyük" yazıyor). Çok uzak hedef tarihi veya çok yüksek enflasyon/getiri varsayımını kontrol et.</div>';
        h += '<p class="hint">Temel senaryoda hedef tarihinde: <b>' + tl(sc.base.atGoal) + '</b>' + (sc.base.reachMonth != null ? ' · hedefe ' + X.monthsLabel(sc.base.reachMonth) + ' sonra ulaşılır' : ' · ufuk içinde ulaşılmıyor') + '<span class="detail-only"> · kötümser ' + tl(sc.pessimistic.atGoal) + ' · iyimser ' + tl(sc.optimistic.atGoal) + '</span></p>';
        h += '<p class="hint">Önerilen dağılım (' + esc(PF.GLIDES[g.glide].label) + '): ' + TIERS.map(function (k) { return C.RISK[k] + ' ' + pct(r.targetAlloc[k]); }).join(' · ') + '</p>';
        h += goalEditor(g, rep.goals.length > 1) + '</section>';
      });
      h += '</div><button class="btn" data-act="pf-add-goal">+ Hedef ekle</button>';
      h += '<section class="card detail-only" style="margin-top:14px"><h2>Süzülme yolu profilleri</h2><div class="tablewrap"><table><thead><tr><th>Hedefe kalan</th>' + Object.keys(PF.GLIDES).map(function (k) { return '<th class="r">' + esc(PF.GLIDES[k].label) + '<div class="hint">güvenli / orta / riskli</div></th>'; }).join('') + '</tr></thead><tbody>';
      [60, 36, 12, 0].forEach(function (m) { h += '<tr><td>' + (m ? m + ' ay' + (m === 60 ? ' ve üstü' : '') : 'Hedef ayı') + '</td>' + Object.keys(PF.GLIDES).map(function (k) { var a = C.targetAllocation(m, PF.GLIDES[k].path); return '<td class="r num">' + pct(a.safe) + ' / ' + pct(a.medium) + ' / ' + pct(a.risky) + '</td>'; }).join('') + '</tr>'; });
      h += '</tbody></table></div><p class="hint">Ara aylarda doğrusal geçiş. Portföyün toplam hedef dağılımı, hedeflerin bugünkü birikimleriyle ağırlıklı ortalamadır.</p></section>';
      return h;
    }

    /* ---------- RİSK VE HELAL ---------- */
    function pRisk(c) {
      var s = c.s, R = c.risk.rules, h = '<section class="card"><h2>Risk kuralları ' + tip('Sınırlar aşılınca uyarı verilir; alım önerileri de bu kurallara uyar.') + '</h2><ul class="rules">' + c.risk.items.map(function (i) { return '<li class="lv-' + i.level + '">' + pill(i.level, i.level === 'ok' ? 'Tamam' : i.level === 'danger' ? 'Önemli' : i.level === 'info' ? 'Bilgi' : 'Dikkat') + ' <b>' + esc(i.title) + '</b><div class="hint">' + esc(i.text) + '</div></li>'; }).join('') + '</ul>';
      h += '<h3>Sınırları ayarla</h3><div class="grid two">' +
        fieldRow('Tek varlık en fazla (%)', '<input type="number" min="5" max="100" step="1" data-pfrule="maxAssetBp" value="' + R.maxAssetBp / 100 + '">', 'Tek bir varlık (hesap dahil) yatırım toplamının bu yüzdesini geçerse uyarır.') +
        fieldRow('Riskli varlıklar en fazla (%)', '<input type="number" min="0" max="100" step="1" data-pfrule="maxRiskyBp" value="' + R.maxRiskyBp / 100 + '">') +
        fieldRow('En az kaç farklı varlığa yayılsın', '<input type="number" min="1" max="20" step="1" data-pfrule="minPositions" value="' + R.minPositions + '">', 'Paran birkaç varlıkta toplanmışsa uyarır. (Detay: etkin varlık sayısı = 1 ÷ Σ(payᵢ²).) Paralar birkaç varlıkta toplanmışsa düşük çıkar.') +
        fieldRow('Önce acil durum fonu', '<label class="row"><input type="checkbox" data-pfrule="emergencyFirst"' + (R.emergencyFirst ? ' checked' : '') + '> Acil fon tamamlanmadan riskli alım önerme</label>') + '</div></section>';
      // Helal tablo
      var rows = c.pos.filter(function (p) { return !p.synthetic; });
      h += '<section class="card" style="margin-top:14px"><h2>Helal uygunluk listesi ' + tip('Her varlık ve hesap için durum. Etiketi Varlıklar sayfasından değiştir. "Uygun" olmayan hiçbir şey alım önerisine girmez.') + '</h2><div class="tablewrap"><table><thead><tr><th>Varlık / hesap</th><th>Durum</th><th>Not</th><th class="detail-only">Kaynak</th></tr></thead><tbody>';
      rows.forEach(function (p) { var src = p.asset || p.account || {}, hh = src.halal || {}; h += '<tr><td>' + esc(p.name) + '</td><td>' + halalPill(p.halal) + '</td><td class="hint">' + esc(hh.note || (p.isAccount && src.type === 'cash' ? 'Nakit' : '')) + '</td><td class="hint detail-only">' + esc(hh.source || '') + '</td></tr>'; });
      h += '</tbody></table></div><p class="hint">Uygulama bir fetva kaynağı değildir. Ürünün danışma kurulu onayını ve katılım endeksinde olup olmadığını kendin doğrula; notu ve kaynağı kaydet.</p></section>';
      return h;
    }

    /* ---------- FİYATLAR ---------- */
    function usedKeys(s) {
      var keys = [];
      (s.assets || []).forEach(function (a) { if (a.tracking === 'trades') { var k = PF.assetKey(a); if (keys.indexOf(k) < 0) keys.push(k); } });
      ['fx:USD', 'fx:EUR', 'metal:XAU', 'idx:KATLM', 'idx:XKTUM', 'idx:XU100'].forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      Object.keys(s.prices || {}).forEach(function (k) { if (keys.indexOf(k) < 0 && PF.keyInfo(k)) keys.push(k); });
      return keys;
    }
    function autoKeys(s) { return usedKeys(s).filter(function (k) { var ki = PF.keyInfo(k); return ki && ki.kind !== 'manual'; }); }
    function pPrices(c) {
      var s = c.s, cfg = pcfg(), keys = usedKeys(s), h = '';
      h += '<section class="card"><h2>Fiyatları güncelle ' + tip('Ücretsiz kaynaklardan güncel fiyatlar çekilir, önce kontrol tablosunda gösterilir. Sen onaylamadan hiçbir fiyat kaydedilmez. Büyük sıçramalar ayrıca onay ister.') + '</h2>';
      h += '<p>Otomatik çekilebilen: ' + autoKeys(s).map(function (k) { return esc(keyLabel(k)); }).join(', ') + '.</p>';
      h += '<div class="row"><button class="btn primary" data-act="pf-fetch"' + (fetching ? ' disabled' : '') + '>' + (fetching ? '<span class="spinner"></span> Fiyatlar alınıyor…' : 'Fiyatları güncelle') + '</button></div>';
      if (priceRun) h += priceRunTable(s, c.today);
      h += '</section>';
      // Elle fiyat
      h += '<section class="card" style="margin-top:14px"><h2>Elle fiyat gir ' + tip('Otomatik kaynak çalışmazsa (TEFAS ara servisi, TradingView resmi değildir) fiyatı aracı kurum uygulamandan veya tefas.gov.tr\'den bakıp yaz. Otomatik kaynakları da elle düzeltebilirsin. Tablodaki ✎ ile tek dokunuşta düzeltebilirsin.') + '</h2>';
      h += '<form id="pf-price-form" class="grid three">' + fieldRow('Ne için?', '<select id="pp-key">' + keys.map(function (k) { return opt(k, keyLabel(k, assetByKey(k)) + ' — ' + curSym(keyCur(k)), ''); }).join('') + '</select>') +
        fieldRow('Tarih', '<input id="pp-date" type="date" max="' + c.today + '" value="' + c.today + '">') + fieldRow('Fiyat', '<input id="pp-price" type="text" inputmode="decimal" placeholder="ör. 3,251234">') +
        '<div class="field"><button class="btn primary" type="submit">Kaydet</button></div></form>';
      h += '<p class="hint">Çok sayıda fiyat için: <a href="#veri" data-act="pf-import-mode" data-mode="prices">fiyat listesi aktar — Excel/CSV, yapıştır veya ekran görüntüsü</a>.</p></section>';
      // Kayıtlı fiyatlar
      h += '<section class="card" style="margin-top:14px"><h2>Kayıtlı fiyatlar</h2><div class="tablewrap"><table><thead><tr><th>Ne</th><th class="r">Son fiyat</th><th>Tarih</th><th>Kaynak</th><th class="r detail-only">Kayıt</th><th class="detail-only"></th></tr></thead><tbody>';
      keys.forEach(function (k) {
        var a = assetByKey(k), lp = PF.lastPoint(s, k), kind = PF.kindFor(k, a), sl = PF.staleness(lp, kind, c.today), n = PF.points(s, k).length;
        h += '<tr><td>' + esc(keyLabel(k, a)) + '</td><td class="r num">' + (lp ? priceTxt(lp.p, keyCur(k)) : '—') + qpBtn(k) + '</td><td>' + (lp ? X.dateLabel(lp.d) + ' ' : '') + staleTxt(sl) + '</td><td class="hint">' + esc(lp ? lp.src || '' : '') + (lp && lp.at ? '<div>alındı: ' + esc(fmtAt(lp.at)) + '</div>' : '') + '</td><td class="r num detail-only">' + n + '</td>' +
          '<td class="detail-only">' + (lp ? '<button class="btn small danger" data-act="pf-del-pt" data-key="' + esc(k) + '" data-d="' + lp.d + '">Son fiyatı sil</button>' : '') + '</td></tr>' + qpRow(k, 6, c.today);
      });
      h += '</tbody></table></div><p class="hint">Eskime sınırı: kripto 2 gün, döviz/altın 3 gün, endeks 4 gün, ETF/hisse/fon 5 gün, diğer 31 gün. Eski fiyat uyarı verir ama silinmez.</p>';
      h += '<details><summary>Geçmiş fiyatları toplu yapıştır (ör. Katılım 50)</summary><p class="hint">Her satıra "tarih fiyat" yaz (ör. <code>31.10.2026 11.250,40</code>). Kıyas ve getiri grafiği için kullanılır.</p><div class="grid two">' + fieldRow('Ne için?', '<select id="pp-bulk-key">' + keys.map(function (k) { return opt(k, keyLabel(k, assetByKey(k)), 'idx:KATLM'); }).join('') + '</select>') + '</div><textarea id="pp-bulk" rows="5" style="width:100%"></textarea><button class="btn small" data-act="pf-bulk-prices">Kaydet</button></details></section>';
      // Ayar ve kaynaklar
      h += '<section class="card" style="margin-top:14px"><h2>Kaynaklar ve ayarlar</h2><div class="field"><label for="td-key">Twelve Data anahtarı (ABD ETF/hisse için, isteğe bağlı) ' + tip('twelvedata.com\'dan ücretsiz hesapla alınır (günde 800 istek). Anahtar yalnızca bu cihazda saklanır, yedeğe girmez.') + '</label><div class="row"><input id="td-key" type="password" autocomplete="off" value="' + esc(window.Store.apiKeys().twelve || '') + '" style="max-width:340px" placeholder="anahtar yoksa ETF fiyatını elle gir"><button class="btn small" data-act="pf-td-save">Kaydet</button>' + (window.Store.apiKeys().twelve ? '<button class="btn small danger" data-act="pf-td-del">Sil</button>' : '') + '</div></div>';
      h += '<div class="tablewrap"><table><thead><tr><th>Kaynak</th><th>Ne için</th></tr></thead><tbody>' + Object.keys(PR.SOURCES).map(function (k) { var x = PR.SOURCES[k]; return '<tr><td>' + esc(x.label) + '<div class="hint">' + esc(x.site) + '</div></td><td class="hint">' + esc(x.what) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      h += '<p class="hint">Hepsi ücretsizdir (Kasım 2026\'da test edildi). <span class="detail-only">TCMB, tefas.gov.tr, Borsa İstanbul, İş Yatırım ve Yahoo tarayıcı erişimini (CORS) engellediği için doğrudan kullanılamıyor; </span>TEFAS fonları TEFAS verisini yayınlayan ücretsiz bir ara servisten, BIST hisseleri TradingView\'in herkese açık tarayıcısından (resmi değil, 15 dk gecikmeli) alınır. Bir kaynak çalışmazsa eski fiyat aynen kalır; uygulama hiçbir zaman fiyat uydurmaz.</p></section>';
      return h;
    }
    function fmtAt(iso) { var d = new Date(iso); if (isNaN(d)) return iso; return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (TSİ)'; }
    function priceRunTable(s, today) {
      var r = priceRun, h = '<div class="tablewrap" style="margin-top:10px"><table class="prun"><thead><tr><th>Al</th><th>Ne</th><th class="r">Eski</th><th class="r">Yeni</th><th class="r">Değişim</th><th>Kontrol</th></tr></thead><tbody>';
      r.candidates.forEach(function (c2, i) {
        var a = assetByKey(c2.key), old = PF.lastPoint(s, c2.key), cur = keyCur(c2.key);
        h += '<tr class="' + (c2.check.valid ? '' : 'excluded') + '"><td><input type="checkbox" data-pfrun="' + i + '"' + (c2.include ? ' checked' : '') + (c2.check.valid ? '' : ' disabled') + ' aria-label="Bu fiyatı kaydet"></td><td>' + esc(keyLabel(c2.key, a)) + '<div class="hint">' + esc(c2.src) + ' · ' + esc(fmtAt(c2.at)) + '</div></td>' +
          '<td class="r num">' + (old ? priceTxt(old.p, cur) + '<div class="hint">' + X.dateLabel(old.d) + '</div>' : '—') + '</td><td class="r num"><b>' + priceTxt(c2.p, cur) + '</b><div class="hint">' + X.dateLabel(c2.d) + '</div></td><td class="r num">' + (c2.check.jumpBp != null ? sbp1(c2.check.jumpBp) : '—') + '</td><td>' +
          (c2.check.reasons.length ? c2.check.reasons.map(function (x) { return '<div class="' + (c2.check.valid ? 'warn-t' : 'neg') + '">⚠ ' + esc(x) + '</div>'; }).join('') : pill('ok', 'Makul')) +
          (c2.cross ? '<div class="hint">' + esc(c2.cross.label) + ': ' + priceTxt(c2.cross.p, cur) + ' → ' + (c2.cross.check.ok ? 'fark %' + (c2.cross.check.diffBp / 100).toFixed(2).replace('.', ',') + ' ✓' : '<b class="neg">fark %' + (c2.cross.check.diffBp / 100).toFixed(2).replace('.', ',') + ' — kontrol et</b>') + '</div>' : '') + (c2.note ? '<div class="hint">' + esc(c2.note) + '</div>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (r.errors.length) h += '<div class="notice warn">Alınamayanlar: ' + esc(r.errors.join(' · ')) + '</div>';
      h += '<p class="hint">Kaynak durumu: ' + Object.keys(r.sources).map(function (k) { var x = r.sources[k]; return esc((PR.SOURCES[k] || { label: k }).label.split(' — ')[0]) + ' ' + (x.ok ? '✓' : '✕ (' + esc(x.msg) + ')'); }).join(' · ') + '</p>';
      h += '<div class="row"><button class="btn primary" data-act="pf-apply">Seçili fiyatları kaydet</button><button class="btn" data-act="pf-run-cancel">Vazgeç</button></div>';
      return h;
    }
    function startFetch() {
      if (fetching) return; fetching = true; priceRun = null; X.render();
      var s = st(), keys = autoKeys(s);
      PR.fetchAll(keys, { twelveKey: window.Store.apiKeys().twelve || '' }).then(function (res) {
        var s2 = st(), today = X.today();
        res.candidates.forEach(function (c2) {
          var a = assetByKey(c2.key), old = PF.lastPoint(s2, c2.key);
          c2.check = PF.checkPrice(c2.p, old, PF.kindFor(c2.key, a), c2.d, today);
          if (c2.badCurrency) { c2.check.valid = false; c2.check.reasons.push('Kaynağın para birimi ' + c2.badCurrency + ', beklenen USD'); }
          if (c2.cross && !c2.cross.check.ok) { c2.check.needsConfirm = true; c2.check.reasons.push('İki kaynak arasında fark büyük'); }
          var same = old && old.d === c2.d && old.p === c2.p;
          c2.include = c2.check.valid && !c2.check.needsConfirm && !same;
          if (same) c2.note = 'Kayıtlı fiyatla aynı.';
        });
        priceRun = res; fetching = false; X.render();
        if (!res.candidates.length) X.toast('Hiçbir kaynaktan fiyat alınamadı. İnternet bağlantını kontrol et; fiyatları elle girebilirsin.');
      }, function (e) { fetching = false; X.toast('Fiyatlar alınamadı: ' + e.message); X.render(); });
    }
    function applyPrices() {
      if (!priceRun) return;
      var sel = priceRun.candidates.filter(function (c2) { return c2.include && c2.check.valid; });
      if (!sel.length) return X.toast('Seçili fiyat yok.');
      var conf = sel.filter(function (c2) { return c2.check.needsConfirm; });
      if (conf.length && !confirm(conf.length + ' fiyatta büyük değişim veya kaynak farkı var (' + conf.map(function (c2) { return keyLabel(c2.key); }).join(', ') + '). Yine de kaydedilsin mi?')) return;
      var ok = X.mutate(function (s) { sel.forEach(function (c2) { setPrice(s, c2.key, c2.d, c2.p, c2.src, c2.at); }); }, sel.length + ' fiyat kaydedildi.');
      if (ok) { priceRun = null; X.render(); }
    }
    /* Fiyatı kaydeder; döviz ve gram altın fiyatı, en yeni fiyatsa Hesaplar'daki kurla da eşitlenir */
    function setPrice(s, key, d, p, src, at) {
      var pt = { d: d, p: p, src: String(src || '').slice(0, 160) }; if (at) pt.at = at;
      PF.addPricePoint(s.prices, key, keyCur(key), pt);
      var m = /^(fx:(USD|EUR)|metal:(XAU))$/.exec(key);
      if (m) {
        var cur = m[2] || m[3], used = (s.accounts || []).some(function (a) { return a.currency === cur; }) || (s.assets || []).some(function (a) { return a.currency === cur; }) || (s.rates && s.rates[cur]);
        // Onaylanan fiyat bu serinin en yeni noktasıysa Hesaplar'daki kur da ona eşitlenir (eski tarihli giriş kuru değiştirmez)
        var lp = PF.lastPoint(s, key);
        if (used && lp && lp.d === d) s.rates[cur] = { rate: PF.fxKurusFromPrice(p), date: d };
      }
    }
    function rateEdited(s, cur, kurus, d) { var key = cur === 'XAU' ? 'metal:XAU' : (cur === 'USD' || cur === 'EUR') ? 'fx:' + cur : null; if (key) PF.addPricePoint(s.prices, key, 'TRY', { d: d, p: PF.fxPriceFromKurus(kurus), src: 'Kullanıcı girişi (Hesaplar → kur)' }); }
    /* Hızlı fiyat düzeltme (✎) */
    var qpKey = null;
    function qpBtn(k) { return ' <button type="button" class="linkbtn qp-btn" data-act="pf-qp" data-key="' + esc(k) + '" aria-label="Fiyatı hızlı düzenle" title="Fiyatı hızlı düzenle">✎</button>'; }
    function plainPrice(p) { return p ? String(p / 1e6).replace('.', ',') : ''; }
    function qpRow(k, cols, today) {
      if (qpKey !== k) return '';
      var lp = PF.lastPoint(st(), k);
      return '<tr class="qp-row"><td colspan="' + cols + '"><form class="qp-form" data-qpkey="' + esc(k) + '"><b>' + esc(keyLabel(k, assetByKey(k))) + '</b> <input class="qp-d" type="date" max="' + today + '" value="' + today + '" aria-label="Tarih"> <input class="qp-p" type="text" inputmode="decimal" value="' + plainPrice(lp && lp.p) + '" aria-label="Yeni fiyat" placeholder="fiyat"> <button class="btn small primary" type="submit">Kaydet</button> <button class="btn small" type="button" data-act="pf-qp" data-key="' + esc(k) + '">Vazgeç</button></form></td></tr>';
    }
    function submitQuick(form) {
      var s = st(), k = form.dataset.qpkey, d = P.parseDate(form.querySelector('.qp-d').value), pi = form.querySelector('.qp-p'), p = PF.parseScaled(pi.value, 6);
      if (!d || d > X.today()) return X.toast('Geçerli bir tarih seç (gelecek olamaz)');
      if (!p || p <= 0) { pi.setAttribute('aria-invalid', 'true'); return X.toast('Geçersiz fiyat. Örnek: 3,251234'); }
      var a = assetByKey(k), chk = PF.checkPrice(p, PF.priceAt(PF.points(s, k), d), PF.kindFor(k, a), d, X.today());
      if (chk.needsConfirm && !confirm('Dikkat: ' + chk.reasons.join('; ') + '. Fiyat doğru mu?')) return;
      qpKey = null;
      X.mutate(function (s2) { setPrice(s2, k, d, p, 'Elle düzeltildi', new Date().toISOString()); }, keyLabel(k, a) + ' fiyatı güncellendi.');
    }
    function submitPrice() {
      var s = st(), k = document.getElementById('pp-key').value, d = P.parseDate(document.getElementById('pp-date').value), p = PF.parseScaled(document.getElementById('pp-price').value, 6);
      if (!d || d > X.today()) return X.toast('Geçerli bir tarih seç (gelecek olamaz)');
      if (!p || p <= 0) { document.getElementById('pp-price').setAttribute('aria-invalid', 'true'); return X.toast('Geçersiz fiyat. Örnek: 3,251234'); }
      var a = assetByKey(k), chk = PF.checkPrice(p, PF.priceAt(PF.points(s, k), d), PF.kindFor(k, a), d, X.today());
      if (chk.needsConfirm && !confirm('Dikkat: ' + chk.reasons.join('; ') + '. Fiyat doğru mu?')) return;
      X.mutate(function (s2) { setPrice(s2, k, d, p, 'Elle girildi', new Date().toISOString()); }, keyLabel(k, a) + ' fiyatı kaydedildi.');
    }
    function bulkPrices() {
      var k = document.getElementById('pp-bulk-key').value, lines = document.getElementById('pp-bulk').value.split(/\r?\n/), pts = [], bad = 0;
      lines.forEach(function (l) { l = l.trim(); if (!l) return; var m = /^(\S+)[\s;,\t]+(.+)$/.exec(l); var d = m && P.parseDate(m[1]), p = m && PF.parseScaled(m[2].trim(), 6); if (d && p > 0 && d <= X.today()) pts.push({ d: d, p: p }); else bad++; });
      if (!pts.length) return X.toast('Okunabilen satır yok. Örnek: 31.10.2026 11.250,40');
      if (!confirm(pts.length + ' fiyat kaydedilecek' + (bad ? ', ' + bad + ' satır okunamadı' : '') + '. Devam?')) return;
      X.mutate(function (s) { pts.forEach(function (x) { PF.addPricePoint(s.prices, k, keyCur(k), { d: x.d, p: x.p, src: 'Elle (toplu)' }); }); }, pts.length + ' geçmiş fiyat kaydedildi.');
    }
    function fetchHistory() {
      var s = st(), rr = PF.returnsReport(s, X.today()); if (rr.empty) return;
      var dates = rr.flows.map(function (f) { return f.date; }).concat([X.today()]), monthly = [];
      var ym = rr.first.slice(0, 7); while (ym < X.nowYm()) { monthly.push(L.ymdOf(ym, 31)); ym = L.addMonthsYm(ym, 1); }
      var gold = dates.concat(monthly).filter(function (d, i, a) { return a.indexOf(d) === i && d < X.today(); }).sort();
      var crypto = s.assets.filter(function (a) { return a.tracking === 'trades' && /^cg:/.test(a.priceKey || ''); }).map(function (a) { return a.priceKey.slice(3); });
      var funds = s.assets.filter(function (a) { return a.tracking === 'trades' && /^tefas:/.test(a.priceKey || ''); }).map(function (a) { return a.priceKey.slice(6); });
      fetching = true; histMsg = '<span class="spinner"></span> Geçmiş fiyatlar indiriliyor…'; X.render();
      PR.fetchHistory({ fxFrom: L.addDays ? rr.first : rr.first, to: X.today(), goldDates: gold, cryptoIds: crypto, tefasCodes: funds }).then(function (out) {
        fetching = false; var n = 0;
        var ok = X.mutate(function (s2) {
          Object.keys(out.series).forEach(function (k) {
            var src = k === 'fx:USD' ? 'Frankfurter (AMB) geçmiş kur' : k === 'metal:XAU' ? 'Currency API geçmiş ons altın ÷ 31,1035' : /^tefas:/.test(k) ? 'TEFAS Fon Analiz geçmiş (günlük)' : 'CoinGecko geçmiş (günlük)';
            out.series[k].forEach(function (x) { var ex = PF.points(s2, k).find(function (q) { return q.d === x.d; }); if (ex && !/geçmiş/.test(ex.src || '')) return; PF.addPricePoint(s2.prices, k, 'TRY', { d: x.d, p: x.p, src: src }); n++; });
          });
        });
        histMsg = ok ? n + ' geçmiş fiyat kaydedildi.' + (out.errors.length ? ' Alınamayan: ' + esc(out.errors.slice(0, 4).join(' · ')) : '') : 'Kaydedilemedi.';
        X.render();
      }, function (e) { fetching = false; histMsg = 'İndirilemedi: ' + esc(e.message); X.render(); });
    }

    /* ---------- VERİ EKLE: alım-satım dökümü ve fiyat listesi ---------- */
    var importKind = 'tx';
    function importModes() {
      var h = '<div class="field" style="margin-bottom:12px"><span class="label-like"><b>Ne aktarıyorsun?</b></span><div class="seg" role="radiogroup" aria-label="Aktarılacak veri türü">';
      [['tx', 'Harcama / gelir', 'Banka ekstresi, fiş, kart ekstresi'], ['trades', 'Yatırım alım-satım', 'Aracı kurum işlem dökümü'], ['prices', 'Fiyat listesi', 'Fon/hisse fiyat tablosu']].forEach(function (m) {
        h += '<button type="button" role="radio" class="seg-b" aria-checked="' + (importKind === m[0]) + '" data-act="pf-import-mode" data-mode="' + m[0] + '"><b>' + m[1] + '</b><span class="hint">' + m[2] + '</span></button>';
      });
      h += '</div></div>';
      if (importKind === 'trades') h += '<div class="notice info">Aracı kurum dökümünü (Excel/CSV, PDF veya ekran görüntüsü) seç. Tarih, sembol, alış/satış, adet, fiyat, komisyon ve tutar okunur; satır satır <b>adet × fiyat</b> hesaplanıp belgedeki tutarla karşılaştırılır.</div>';
      if (importKind === 'prices') h += '<div class="notice info">İçinde <b>sembol/kod</b> ve <b>fiyat</b> olan bir Excel/CSV, PDF veya <b>ekran görüntüsü</b> seç (ücretsiz OCR ile okunur) ya da listeyi aşağıya yapıştır. Varlıklarınla koddan eşleşir; kaynak ve okunma saati kaydedilir, büyük sıçramalar işaretlenir.</div>' +
        '<div class="card paste-prices" style="margin-bottom:12px"><label for="pp-paste"><b>📋 Listeyi yapıştır</b> <span class="hint">her satır: KOD fiyat (tarih isteğe bağlı)</span></label><textarea id="pp-paste" rows="4" style="width:100%" placeholder="KTV 8,326309&#10;ASELS 345,50&#10;13.11.2026 KTN 3,2514"></textarea><button class="btn small primary" data-act="pf-paste-prices">Listeyi oku ve kontrol et</button></div>';
      return h;
    }
    function readTable(file) {
      return X.loadScript('vendor/xlsx.full.min.js').then(function () { return file.arrayBuffer(); }).then(function (buf) {
        var ext = file.name.split('.').pop().toLowerCase(), wb;
        if (ext === 'csv' || ext === 'txt' || ext === 'tsv') wb = XLSX.read(X.decodeText(buf).replace(/^\uFEFF/, ''), { type: 'string', raw: true });
        else wb = XLSX.read(buf, { type: 'array', cellDates: true });
        var sheets = wb.SheetNames.map(function (n) { return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }; });
        var best = sheets.reduce(function (a, b) { return b.rows.length > a.rows.length ? b : a; }, sheets[0]);
        if (!best || !best.rows.length) throw new Error('Dosyada veri bulunamadı');
        return { sheets: sheets, best: best };
      });
    }
    var TRADE_PROMPT = 'Bu belge bir aracı kurum / banka yatırım işlem dökümü veya ekran görüntüsüdür. Alım ve satım işlemlerini çıkar.\nSADECE şu JSON\'u döndür:\n' +
      '{"trades": [{"date": "YYYY-MM-DD", "symbol": "sembol veya fon kodu", "side": "buy veya sell", "qty": sayı, "price": sayı, "fee": sayı veya 0, "total": sayı veya null, "currency": "TRY/USD/EUR"}], "total": belgedeki genel toplam veya null}\n' +
      'Kurallar: Sayıları JSON sayısı olarak nokta ondalıkla yaz, binlik ayırıcı kullanma. qty adet/lot, price birim fiyat. total o satırın tutarı. Belgede olmayan hiçbir şeyi uydurma; okuyamadığını null bırak. Türkiye tarih biçimi GG.AA.YYYY.';
    function handleFile(file) {
      var name = file.name || 'dosya', ext = (name.split('.').pop() || '').toLowerCase();
      if (importKind === 'prices') {
        if (/^image\//.test(file.type) || /^(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/.test(ext)) {
          X.busy('Ücretsiz OCR ile okunuyor… (ilk seferde biraz sürer)');
          return X.readImage(file).then(function (img) { return X.getOcrWorker().then(function (w) { return X.ocrRecognize(w, img.ocrPlain || img.dataUrl, 'ham'); }).then(function (r) {
            var rows = PF.parsePriceText(r.text, P.parseDate); if (!rows.length) throw new Error('Görselde "KOD fiyat" satırı okunamadı. Listeyi yapıştırmayı veya elle girmeyi dene.');
            startPriceReview(name + ' (ekran görüntüsü OCR)', rows, { text: r.text, preview: img.dataUrl, warn: ['OCR sonucu: her fiyatı görselle karşılaştır.'] });
          }); });
        }
        if (ext === 'pdf' || file.type === 'application/pdf') {
          X.busy('PDF okunuyor…');
          return X.loadPdfLib().then(function (lib) { return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: new Uint8Array(buf) }).promise; }); }).then(function (pdf) { return X.pdfText(pdf); }).then(function (text) {
            var rows = PF.parsePriceText(text, P.parseDate); if (!rows.length) throw new Error('PDF\'te "KOD fiyat" satırı bulunamadı');
            startPriceReview(name, rows, { text: text });
          });
        }
        if (!/^(xlsx|xls|csv|ods|txt|tsv)$/.test(ext)) return Promise.reject(new Error('Fiyat listesi için Excel/CSV, PDF veya ekran görüntüsü seç'));
        X.busy('Fiyat listesi okunuyor…');
        return readTable(file).then(function (t) { var map = PF.detectPriceColumns(t.best.rows); startPriceReview(name, PF.priceRowsFromTable(t.best.rows, map, P.parseDate)); });
      }
      if (/^(xlsx|xls|csv|ods|txt|tsv)$/.test(ext)) {
        X.busy('Döküm okunuyor…');
        return readTable(file).then(function (t) {
          var map = PF.detectTradeColumns(t.best.rows);
          var rows = PF.tradeRowsFromTable(t.best.rows, map, P.parseDate), total = null;
          t.best.rows.forEach(function (r) { var j = r.map(function (c) { return PF.fold(c); }).join(' '); if (/(genel )?toplam|total/.test(j) && map.total >= 0) { var v = M.parse(r[map.total]); if (v != null) total = Math.abs(v); } });
          startTradeReview(name, rows, total, { table: t.best.rows, map: map });
        });
      }
      if (ext === 'pdf' || file.type === 'application/pdf') {
        X.busy('PDF okunuyor…');
        return X.loadPdfLib().then(function (lib) { return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: new Uint8Array(buf) }).promise; }); }).then(function (pdf) {
          return X.pdfText(pdf).then(function (text) {
            var rows = PF.parseTradeText(text, P.parseDate);
            if (rows.length) return startTradeReview(name, rows, null, { text: text });
            if (!X.aiReady()) throw new Error('PDF\'te işlem satırı bulunamadı. Yapay zekâ ayarlarsan (Asistan) taranmış dökümleri de okuyabilirim.');
            return X.pdfToImages(pdf, 4).then(function (imgs) { return aiTrades(imgs, name); });
          });
        });
      }
      if (/^image\//.test(file.type) || /^(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/.test(ext)) {
        X.busy('Görsel hazırlanıyor…');
        return X.readImage(file).then(function (img) { return X.aiReady() ? aiTrades([img], name) : ocrTrades([img], name, ''); });
      }
      return Promise.reject(new Error('Bu dosya türü desteklenmiyor: .' + ext));
    }
    function aiTrades(images, name) {
      X.busy('Yapay zekâ dökümü okuyor…');
      return window.AI.chat(X.aiCfg(), 'Sen dikkatli bir yatırım muhasebe asistanısın. Yalnızca geçerli JSON üretirsin.', [{ role: 'user', text: TRADE_PROMPT, images: images }], true).then(function (txt) {
        var res = PF.rowsFromAiTrades(txt, P.parseDate);
        if (!res.rows.length) throw new Error('Yapay zekâ belgede alım-satım bulamadı.');
        startTradeReview(name + ' (yapay zekâ)', res.rows, res.docTotal, { preview: images[0].dataUrl });
      }, function (e) { return ocrTrades(images, name, 'Yapay zekâ okuyamadı (' + e.message + '), ücretsiz OCR denendi.'); });
    }
    function ocrTrades(images, name, note) {
      X.busy('Ücretsiz OCR ile okunuyor… (ilk seferde biraz sürer)');
      return X.getOcrWorker().then(function (w) {
        var texts = [], chain = Promise.resolve();
        images.forEach(function (im) { chain = chain.then(function () { return X.ocrRecognize(w, im.ocrPlain || im.dataUrl, 'ham').then(function (r) { texts.push(r.text); }); }); });
        return chain.then(function () {
          var text = texts.join('\n'), rows = PF.parseTradeText(text, P.parseDate);
          startTradeReview(name + ' (OCR)', rows, null, { text: text, preview: images[0].dataUrl, warn: (note ? [note] : []).concat(rows.length ? ['OCR sonucu: her satırı belgeyle karşılaştır.'] : ['Görselde alım-satım satırı okunamadı. Satırları "+ Satır ekle" ile elle girebilirsin.']) });
        });
      });
    }
    function startTradeReview(name, rows, docTotal, extra) {
      var s = st(), today = X.today(), existing = {};
      (s.trades || []).forEach(function (t) { existing[PF.tradeKey(t)] = true; });
      pReview = { kind: 'trades', source: name, docTotal: docTotal, text: extra.text || null, preview: extra.preview || null, warn: extra.warn || [], table: extra.table || null, map: extra.map || null, rows: [] };
      pReview.rows = rows.map(function (r, i) {
        var a = PF.matchAsset(s, r.symbol), cur = r.currency || (a && a.currency) || 'TRY';
        var x = { key: i, include: true, date: r.date, rawDate: r.rawDate, symbol: r.symbol, side: r.side, rawSide: r.rawSide, qty: r.qty, price: r.price, fee: r.fee || 0, written: r.written, currency: cur, assetId: a && a.tracking === 'trades' ? a.id : '', fxRate: null };
        if (cur !== 'TRY' && x.date) x.fxRate = fxAt(s, cur, x.date);
        return x;
      });
      pReview.rows.forEach(function (x) { validateTr(x, today, existing, true); });
      X.setStatus(''); X.render();
    }
    function validateTr(x, today, existing, initial) {
      var r = PF.validateTradeRow(x, today);
      if (x.assetId) { var a = st().assets.find(function (q) { return q.id === x.assetId; }); if (a && (a.currency || 'TRY') !== x.currency) r.errors.push('Varlığın para birimi ' + (a.currency || 'TRY')); }
      var tk = PF.tradeKey({ assetId: x.assetId || null, symbol: x.symbol, date: x.date, side: x.side, qty: x.qty, price: x.price });
      x.dup = !!(x.assetId && existing && existing[tk]);
      if (x.dup) r.warnings.push('Bu işlem zaten kayıtlı (mükerrer)');
      if (initial && (x.dup || r.errors.length)) { x.include = false; x.autoEx = !x.dup; }
      else if (!initial && x.autoEx && !r.errors.length) { x.include = true; x.autoEx = false; }
    }
    function revalidateTrades() { var ex = {}; (st().trades || []).forEach(function (t) { ex[PF.tradeKey(t)] = true; }); pReview.rows.forEach(function (x) { validateTr(x, X.today(), ex, false); }); }
    function trStatus(x) {
      var o = x.errors.map(function (e) { return '<span class="pill err">' + esc(e) + '</span>'; }).concat(x.warnings.map(function (w) { return '<span class="pill warn">' + esc(w) + '</span>'; }));
      if (!x.assetId && x.symbol) o.push('<span class="pill info">Yeni varlık açılır: ' + esc(x.symbol) + ' (helal: bilinmiyor)</span>');
      if (x.calc && x.calc.writtenOk) o.push('<span class="pill ok">Adet × fiyat = belgedeki tutar ✓</span>');
      return o.length ? o.join(' ') : '<span class="pill ok">Uygun</span>';
    }
    function renderImportReview() { return pReview.kind === 'trades' ? renderTradeReview() : renderPriceReview(); }
    function renderTradeReview() {
      var r = pReview, s = st(), tracked = s.assets.filter(function (a) { return a.tracking === 'trades'; });
      var h = '<h1>Kontrol et ve onayla — alım-satım</h1><p>Kaynak: <b>' + esc(r.source) + '</b>. Her satırda <b>adet × fiyat</b> yeniden hesaplanır ve belgedeki tutarla karşılaştırılır. <b>"Onayla ve kaydet"e basana kadar hiçbir şey kaydedilmez.</b></p>';
      r.warn.forEach(function (w) { h += '<div class="notice warn">' + esc(w) + '</div>'; });
      h += '<section class="card" style="margin-top:10px" id="ptr-summary">' + tradeSummary() + '</section>';
      if (r.preview) h += '<details class="card" style="margin-top:10px"><summary><b>Belgeyi göster</b></summary><img src="' + r.preview + '" alt="Yüklenen belge" style="max-width:100%;max-height:600px;margin-top:10px;border-radius:8px"></details>';
      h += '<section class="card" style="margin-top:10px"><div class="row" style="margin-bottom:10px"><button class="btn small" data-act="ptr-all">Tümünü seç</button><button class="btn small" data-act="ptr-none">Tümünü kaldır</button><button class="btn small" data-act="ptr-add">+ Satır ekle</button></div>';
      h += '<div class="tablewrap"><table class="review trades-rv"><thead><tr><th>✓</th><th>Tarih</th><th>Varlık</th><th>İşlem</th><th class="r">Adet</th><th class="r">Fiyat</th><th class="r">Komisyon</th><th>Para</th><th class="r">Kur (TL)</th><th class="r">Hesaplanan ' + tip('Adet × fiyat (± komisyon). Belgedeki tutardan kopyalanmaz; kuruşu kuruşuna yeniden hesaplanır.') + '</th><th class="r">Belgede</th><th>Durum</th></tr></thead><tbody>';
      r.rows.forEach(function (x) {
        var aSel = '<select data-ptr="assetId" aria-label="Varlık">' + opt('', x.symbol ? '+ Yeni: ' + x.symbol : '— seç —', x.assetId) + tracked.map(function (a) { return opt(a.id, a.name, x.assetId); }).join('') + '</select>';
        h += '<tr data-pkey="' + x.key + '" class="' + (x.include ? '' : 'excluded ') + (x.include && x.errors.length ? 'has-err' : '') + '"><td><input type="checkbox" data-ptr="include"' + (x.include ? ' checked' : '') + ' aria-label="Dahil et"></td>' +
          '<td><input type="date" data-ptr="date" value="' + esc(x.date || '') + '" aria-label="Tarih">' + (!x.date && x.rawDate ? '<div class="hint">Okunan: ' + esc(x.rawDate) + '</div>' : '') + '</td>' +
          '<td>' + aSel + '<input type="text" data-ptr="symbol" value="' + esc(x.symbol || '') + '" aria-label="Sembol" placeholder="sembol" style="margin-top:3px;max-width:110px"></td>' +
          '<td><select data-ptr="side" aria-label="İşlem">' + opt('', '?', x.side || '') + opt('buy', 'Alış', x.side || '') + opt('sell', 'Satış', x.side || '') + '</select></td>' +
          '<td><input type="text" inputmode="decimal" data-ptr="qty" value="' + (x.qty ? esc(PF.fmtQty(x.qty)) : '') + '" aria-label="Adet" style="max-width:100px"></td>' +
          '<td><input type="text" inputmode="decimal" data-ptr="price" value="' + (x.price ? esc(PF.formatScaled(x.price, 6, 6, 2)) : '') + '" aria-label="Fiyat" style="max-width:110px"></td>' +
          '<td><input type="text" class="money" inputmode="decimal" data-ptr="fee" value="' + esc(M.format(x.fee || 0, { symbol: false })) + '" aria-label="Komisyon" style="max-width:90px"></td>' +
          '<td><select data-ptr="currency" aria-label="Para birimi">' + ['TRY', 'USD', 'EUR'].map(function (k) { return opt(k, k === 'TRY' ? 'TL' : k, x.currency); }).join('') + '</select></td>' +
          '<td>' + (x.currency !== 'TRY' ? '<input type="text" class="money" inputmode="decimal" data-ptr="fxRate" value="' + (x.fxRate ? esc(M.format(x.fxRate, { symbol: false })) : '') + '" aria-label="Kur" style="max-width:90px">' : '<span class="muted">—</span>') + '</td>' +
          '<td class="r num ptr-calc">' + (x.calc ? money(x.calc.cash, x.currency) + '<div class="hint">brüt ' + M.format(x.calc.gross, { symbol: false }) + '</div>' : '—') + '</td><td class="r num">' + (x.written != null ? money(x.written, x.currency) : '<span class="muted">—</span>') + '</td><td class="ptr-status">' + trStatus(x) + '</td></tr>';
      });
      h += '</tbody></table></div>' + (r.rows.length ? '' : '<p class="muted">Hiç satır çıkarılamadı. Sütunlar tanınmadıysa "+ Satır ekle" ile elle gir.</p>') + '</section>';
      h += '<div class="row savebar"><button class="btn primary" data-act="ptr-save">Onayla ve kaydet</button><button class="btn" data-act="ptr-cancel">Vazgeç</button></div>';
      if (r.text) h += '<details class="card detail-only" style="margin-top:14px"><summary>Belgeden okunan ham metin</summary><pre style="white-space:pre-wrap;font-size:.8rem;max-height:400px;overflow:auto">' + esc(r.text) + '</pre></details>';
      return h;
    }
    function tradeSummary() {
      var r = pReview, chk = PF.tradeTotalsCheck(r.rows, r.docTotal), t = chk.totals, errs = r.rows.filter(function (x) { return x.include && x.errors.length; }).length, dups = r.rows.filter(function (x) { return x.dup; }).length;
      var cur = chk.single || 'TRY', x = t.byCurrency[cur] || { buys: 0, sells: 0, net: 0, fees: 0, grossBuys: 0, grossSells: 0 };
      var computed = chk.computed != null ? chk.computed : (x.buys && x.sells ? Math.abs(x.net) : (x.buys || x.sells));
      var h = '<p class="hint" style="margin-top:0">Soldaki tutar seçili satırların <b>adet × fiyat (± komisyon)</b> ile tek tek hesaplanıp toplanmasıdır — belgede yazanı kopyalamıyoruz. Sağdaki, belgede yazılı toplamdır.</p>';
      h += '<div class="row" style="gap:16px"><span><b>' + r.rows.length + '</b> satır bulundu</span><span><b>' + t.count + '</b> seçili</span>' + (dups ? '<span class="pill warn">' + dups + ' mükerrer (seçilmedi)</span>' : '') + (errs ? '<span class="pill err">' + errs + ' seçili satırda hata</span>' : '') + (t.currencies.length > 1 ? '<span class="pill warn">Birden fazla para birimi: toplam kontrolü para birimi başına yapılır</span>' : '') + '</div>';
      h += '<div class="rv-totals"><div class="rv-kpi" id="ptr-computed"><div class="label">Seçili satırların toplamı ' + tip('Alımlar ödenen (adet × fiyat + komisyon), satışlar eline geçen (adet × fiyat − komisyon). Hem alım hem satım varsa net tutar.') + '</div><div class="value">' + money(computed, cur) + '</div><div class="sub">Alımlar ' + money(x.buys, cur) + ' (brüt ' + money(x.grossBuys || 0, cur) + ') · satışlar ' + money(x.sells, cur) + ' (brüt ' + money(x.grossSells || 0, cur) + ')</div></div>';
      h += '<div class="rv-kpi"><label class="label" for="ptr-total">Belgedeki toplam</label><div class="value' + (r.docTotal == null ? ' muted' : '') + '">' + (r.docTotal == null ? 'Okunamadı' : money(r.docTotal, cur)) + '</div><div class="row" style="margin-top:6px"><span class="hint">Yanlışsa düzelt:</span><input id="ptr-total" class="money" type="text" inputmode="decimal" style="max-width:160px" placeholder="belgedeki toplam" value="' + (r.docTotal != null ? esc(M.format(r.docTotal, { symbol: false })) : '') + '"></div></div>';
      var cls, txt, sub;
      if (r.docTotal == null) { cls = 'miss'; txt = 'Belgedeki toplam yok'; sub = 'Kontrol için yukarıya yaz. Satır satır kontrol yine yapıldı.'; }
      else if (!chk.single) { cls = 'miss'; txt = 'Karşılaştırılamadı'; sub = 'Birden fazla para birimi veya seçili satır yok.'; }
      else if (chk.match) { cls = 'ok'; txt = 'Tutuyor ✓'; sub = { buys: 'Alımların toplamı (komisyon dahil) belgedekiyle aynı.', sells: 'Satışların toplamı (komisyon düşülmüş) belgedekiyle aynı.', net: 'Net tutar belgedekiyle aynı.', grossBuys: 'Alımların brüt toplamı (adet × fiyat) belgedekiyle aynı.', grossSells: 'Satışların brüt toplamı (adet × fiyat) belgedekiyle aynı.', grossNet: 'Brüt net tutar belgedekiyle aynı.' }[chk.by]; }
      else { var d = Math.abs(chk.diff); cls = 'err'; txt = 'Fark: ' + money(d, cur); sub = 'Satırların toplamı belgedekinden ' + money(d, cur) + (chk.diff < 0 ? ' eksik.' : ' fazla.'); }
      h += '<div class="rv-status-box ' + cls + '" role="status"><div class="value">' + esc(txt) + '</div><div class="sub">' + esc(sub) + '</div></div></div>';
      h += '<p class="hint detail-only">Kuruş toplamları: alımlar ' + x.buys + ', satışlar ' + x.sells + ', komisyon ' + x.fees + (r.docTotal != null ? ', belge ' + r.docTotal : '') + '.</p>';
      return h;
    }
    function refreshTradeRow(x) {
      var tr = document.querySelector('tr[data-pkey="' + x.key + '"]'); if (!tr) return;
      tr.className = (x.include ? '' : 'excluded ') + (x.include && x.errors.length ? 'has-err' : '');
      tr.querySelector('.ptr-status').innerHTML = trStatus(x);
      tr.querySelector('.ptr-calc').innerHTML = x.calc ? money(x.calc.cash, x.currency) + '<div class="hint">brüt ' + M.format(x.calc.gross, { symbol: false }) + '</div>' : '—';
      var cb = tr.querySelector('input[data-ptr="include"]'); if (cb) cb.checked = !!x.include;
      var sm = document.getElementById('ptr-summary'); if (sm) sm.innerHTML = tradeSummary();
    }
    function onTradeRowChange(el) {
      var tr = el.closest('tr'), x = pReview.rows.find(function (q) { return String(q.key) === tr.dataset.pkey; }), f = el.dataset.ptr, rerender = false;
      if (f === 'include') { x.include = el.checked; x.autoEx = false; }
      else if (f === 'date') { x.date = P.parseDate(el.value); if (x.currency !== 'TRY' && x.date && !x.fxRate) { x.fxRate = fxAt(st(), x.currency, x.date); rerender = true; } }
      else if (f === 'symbol') x.symbol = el.value.trim();
      else if (f === 'assetId') { x.assetId = el.value; var a = st().assets.find(function (q) { return q.id === x.assetId; }); if (a) { x.currency = a.currency || 'TRY'; if (x.currency !== 'TRY' && !x.fxRate && x.date) x.fxRate = fxAt(st(), x.currency, x.date); if (x.currency === 'TRY') x.fxRate = null; } rerender = true; }
      else if (f === 'side') x.side = el.value || null;
      else if (f === 'qty') { x.qty = PF.parseScaled(el.value, 8); el.setAttribute('aria-invalid', String(!(x.qty > 0))); }
      else if (f === 'price') { x.price = PF.parseScaled(el.value, 6); el.setAttribute('aria-invalid', String(!(x.price > 0))); }
      else if (f === 'fee') { var fv = el.value.trim() ? M.parse(el.value) : 0; x.fee = fv == null ? -1 : Math.abs(fv); }
      else if (f === 'currency') { x.currency = el.value; x.fxRate = x.currency === 'TRY' ? null : (x.fxRate || (x.date ? fxAt(st(), x.currency, x.date) : null)); rerender = true; }
      else if (f === 'fxRate') x.fxRate = M.parse(el.value);
      revalidateTrades();
      if (rerender) X.render(); else refreshTradeRow(x);
    }
    function saveTrades() {
      var r = pReview, sel = r.rows.filter(function (x) { return x.include; });
      if (!sel.length) return X.toast('Kaydedilecek satır seçilmedi.');
      var bad = sel.filter(function (x) { return x.errors.length; });
      if (bad.length) return X.toast(bad.length + ' seçili satırda hata var. Düzelt veya işaretini kaldır.');
      var chk = PF.tradeTotalsCheck(r.rows, r.docTotal);
      if (r.docTotal != null && chk.single && !chk.match && !confirm('Satırların toplamı belgedeki toplamla tutmuyor (fark ' + money(Math.abs(chk.diff), chk.single) + '). Yine de kaydedilsin mi?')) return;
      var newSyms = {};
      var ok = X.mutate(function (s) {
        sel.forEach(function (x) {
          var aid = x.assetId;
          if (!aid) {
            var key = PF.fold(x.symbol) + '|' + x.currency;
            if (!newSyms[key]) { var na = PF.newAssetFromSymbol(x.symbol.toUpperCase(), x.currency, S.uid); s.assets.push(na); newSyms[key] = na.id; }
            aid = newSyms[key];
          }
          s.trades.push({ id: S.uid(), assetId: aid, date: x.date, side: x.side, qty: x.qty, price: x.price, fee: x.fee || 0, currency: x.currency, fxRate: x.currency === 'TRY' ? null : x.fxRate, note: '', source: String(r.source).slice(0, 120) });
        });
      }, sel.length + ' alım-satım kaydedildi' + (Object.keys(newSyms).length ? ', ' + Object.keys(newSyms).length + ' yeni varlık açıldı (türünü, riskini ve helal etiketini Varlıklar\'da belirle)' : '') + '.');
      if (ok) { pReview = null; location.hash = '#portfoy/islemler'; }
    }
    /* Fiyat listesi */
    function startPriceReview(name, rows, extra) {
      var s = st(), today = X.today(); extra = extra || {};
      pReview = { kind: 'prices', source: name, at: new Date().toISOString(), text: extra.text || null, preview: extra.preview || null, warn: extra.warn || [], rows: rows.map(function (r, i) {
        var a = PF.matchAsset(s, r.symbol), key = a ? PF.assetKey(a) : '', x = { key: i, symbol: r.symbol, price: r.price, date: r.date || today, currency: r.currency, pkey: key, asset: a };
        priceRowCheck(x, s, today); x.include = !!(key && x.chk.valid && !x.chk.needsConfirm); return x;
      }) };
      X.setStatus(''); X.render();
    }
    function priceRowCheck(x, s, today) {
      x.chk = x.pkey ? PF.checkPrice(x.price, PF.priceAt(PF.points(s, x.pkey), x.date), PF.kindFor(x.pkey, x.asset), x.date, today) : { valid: false, reasons: ['Eşleşen varlık yok'], needsConfirm: false };
      if (x.pkey && x.currency && x.currency !== keyCur(x.pkey)) { x.chk.valid = false; x.chk.reasons.push('Para birimi ' + x.currency + ', varlığınki ' + keyCur(x.pkey)); }
    }
    function renderPriceReview() {
      var r = pReview, s = st(), h = '<h1>Kontrol et ve onayla — fiyat listesi</h1><p>Kaynak: <b>' + esc(r.source) + '</b> · okundu ' + esc(fmtAt(r.at)) + '. Varlıklarınla koddan eşleşen fiyatlar işaretli gelir. Büyük sıçramalar <b>onay</b> ister. Satırdaki fiyatı düzeltebilirsin.</p>';
      (r.warn || []).forEach(function (w) { h += '<div class="notice warn">' + esc(w) + '</div>'; });
      if (r.preview) h += '<details class="card"><summary>Görseli göster</summary><img src="' + esc(r.preview) + '" alt="Okunan görsel" style="max-width:100%"></details>';
      if (r.text) h += '<details class="card detail-only"><summary>Okunan ham metin</summary><pre class="rawtext">' + esc(String(r.text).slice(0, 4000)) + '</pre></details>';
      var opts = s.assets.filter(function (a) { return a.tracking === 'trades'; });
      h += '<section class="card"><div class="tablewrap"><table class="review"><thead><tr><th>✓</th><th>Listede</th><th>Varlık</th><th class="r">Fiyat</th><th>Tarih</th><th class="r">Önceki</th><th>Kontrol</th></tr></thead><tbody>';
      r.rows.forEach(function (x) {
        var old = x.pkey ? PF.priceAt(PF.points(s, x.pkey), x.date) : null;
        h += '<tr data-prkey="' + x.key + '" class="' + (x.include ? '' : 'excluded') + '"><td><input type="checkbox" data-ppr="include"' + (x.include ? ' checked' : '') + (x.chk.valid ? '' : ' disabled') + ' aria-label="Dahil et"></td><td>' + esc(x.symbol) + '</td>' +
          '<td><select data-ppr="asset" aria-label="Varlık">' + opt('', '— eşleşmedi —', x.asset ? x.asset.id : '') + opts.map(function (a) { return opt(a.id, a.name, x.asset ? x.asset.id : ''); }).join('') + '</select></td>' +
          '<td class="r num"><input class="num" type="text" inputmode="decimal" data-ppr="price" style="width:8.5em" value="' + plainPrice(x.price) + '" aria-label="Fiyat"' + (x.price ? '' : ' aria-invalid="true"') + '><div class="hint">' + (x.price ? priceTxt(x.price, x.pkey ? keyCur(x.pkey) : (x.currency || 'TRY')) : '<span class="neg">okunamadı</span>') + '</div></td><td>' + X.dateLabel(x.date) + '</td><td class="r num">' + (old ? priceTxt(old.p, keyCur(x.pkey)) + '<div class="hint">' + X.dateLabel(old.d) + '</div>' : '—') + '</td>' +
          '<td>' + (x.chk.reasons.length ? x.chk.reasons.map(function (q) { return '<div class="' + (x.chk.valid ? 'warn-t' : 'neg') + '">⚠ ' + esc(q) + '</div>'; }).join('') : pill('ok', 'Makul')) + '</td></tr>';
      });
      h += '</tbody></table></div></section><div class="row savebar"><button class="btn primary" data-act="ppr-save">Seçilileri kaydet</button><button class="btn" data-act="ptr-cancel">Vazgeç</button></div>';
      return h;
    }
    function savePriceList() {
      var sel = pReview.rows.filter(function (x) { return x.include && x.chk.valid && x.price > 0; }); if (!sel.length) return X.toast('Seçili fiyat yok.');
      var conf = sel.filter(function (x) { return x.chk.needsConfirm; });
      if (conf.length && !confirm(conf.length + ' fiyatta büyük değişim var: ' + conf.map(function (x) { return x.symbol; }).join(', ') + '. Kaydedilsin mi?')) return;
      var src = 'Fiyat listesi: ' + pReview.source, at = pReview.at || new Date().toISOString();
      if (X.mutate(function (s) { sel.forEach(function (x) { setPrice(s, x.pkey, x.date, x.price, src, at); }); }, sel.length + ' fiyat kaydedildi.')) { pReview = null; location.hash = '#portfoy/fiyatlar'; }
    }

    /* ---------- Olaylar ---------- */
    /* Elle girilen fiyat serisi otomatik kaynağa geçince kaybolmasın: yeni seri boşsa eski noktalar taşınır */
    function carryPoints(s, from, to, cur) {
      if (!from || !to || from === to || !/^m:/.test(from)) return;
      var src = s.prices && s.prices[from]; if (!src || !src.points || !src.points.length || (s.prices[to] && s.prices[to].points.length)) return;
      if ((src.cur || 'TRY') !== cur) return;
      src.points.forEach(function (pt) { PF.addPricePoint(s.prices, to, cur, JSON.parse(JSON.stringify(pt))); });
    }
    function findAsset(s, id) { return s.assets.find(function (a) { return a.id === id; }); }
    function onAssetField(el) {
      var s = st(), id = el.dataset.id, f = el.dataset.pfa, a = findAsset(s, id); if (!a) return;
      pAssets.open = id;
      var v = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'name') { v = v.trim(); if (!v) { el.setAttribute('aria-invalid', 'true'); return X.toast('Ad boş olamaz'); } return X.mutate(function (s2) { findAsset(s2, id).name = v; }); }
      if (f === 'symbol') return X.mutate(function (s2) { findAsset(s2, id).symbol = v.trim().toUpperCase(); });
      if (f === 'cls') return X.mutate(function (s2) { var x = findAsset(s2, id), d = C.ASSET_CLASSES[v]; x.cls = v; x.risk = d.risk; x.emergency = d.emergency; if (x.tracking === 'trades' && !x.lot) x.lot = (v === 'halal_etf' || v === 'katilim_stock') ? 'whole' : 'fraction'; });
      if (f === 'risk' || f === 'lot') return X.mutate(function (s2) { findAsset(s2, id)[f] = v; });
      if (f === 'emergency') return X.mutate(function (s2) { findAsset(s2, id).emergency = !!v; });
      if (f === 'value') { var k = M.parse(v); if (k == null || k < 0) { el.setAttribute('aria-invalid', 'true'); return X.toast('Geçersiz tutar. Örnek: 1.250,50'); } return X.mutate(function (s2) { findAsset(s2, id).value = k; }); }
      if (f === 'tracking') {
        if (v === 'manual' && PF.tradesOf(s, id).length) { X.toast('Bu varlığın alım-satım kayıtları var. Önce Alım-satım sayfasından onları sil.'); return X.render(); }
        if (v === 'trades' && a.value > 0 && !confirm('Alım-satımla izlenince değer, gireceğin alımlardan hesaplanır (şu an ' + tl(a.value) + ' yazılı). Mevcut adetlerini bir "alış" olarak girmen gerekir. Devam?')) return X.render();
        return X.mutate(function (s2) { var x = findAsset(s2, id); x.tracking = v; if (v === 'trades') { x.currency = x.currency || 'TRY'; x.lot = x.lot || ((x.cls === 'halal_etf' || x.cls === 'katilim_stock') ? 'whole' : 'fraction'); if (x.priceKey === undefined) x.priceKey = null; } else { x.priceKey = null; } });
      }
      if (f === 'currency') return X.mutate(function (s2) { var x = findAsset(s2, id); x.currency = v; if (x.priceKey && PF.keyInfo(x.priceKey).cur !== v) x.priceKey = null; });
      if (f === 'pktype') {
        var key = v === 'cg' ? 'cg:' + (a.priceKey && /^cg:/.test(a.priceKey) ? a.priceKey.slice(3) : (PF.fold(a.symbol || a.name).replace(/[^a-z0-9-]/g, '') || 'bitcoin')) : v === 'td' ? 'td:' + ((a.symbol || 'SPUS').toUpperCase().replace(/[^A-Z0-9.:-]/g, '') || 'SPUS') :
          v === 'tefas' ? 'tefas:' + codeOf(a, /[^A-Z0-9]/g, 6, 'KTV') : v === 'bist' ? 'bist:' + codeOf(a, /[^A-Z0-9]/g, 8, 'ASELS') : v || null;
        var cur = key ? PF.keyInfo(key).cur : (a.currency || 'TRY'), oldKey = PF.assetKey(a);
        return X.mutate(function (s2) { var x = findAsset(s2, id); x.priceKey = key; x.currency = cur; carryPoints(s2, oldKey, PF.assetKey(x), cur); }, key ? 'Fiyat kaynağı: ' + keyLabel(key) : 'Fiyat elle girilecek');
      }
      if (f === 'pkcode') {
        var pre = a.priceKey.slice(0, a.priceKey.indexOf(':') + 1), code = pre === 'cg:' ? v.trim().toLowerCase() : v.trim().toUpperCase(), nk = pre + code;
        if (!PF.keyInfo(nk)) { el.setAttribute('aria-invalid', 'true'); return X.toast(pre === 'cg:' ? 'CoinGecko kimliği küçük harf ve tire olmalı (ör. bitcoin, avalanche-2)' : pre === 'tefas:' ? 'Fon kodu 2-6 harf/rakam olmalı (ör. KTV)' : pre === 'bist:' ? 'Hisse kodu 2-8 harf/rakam olmalı (ör. ASELS)' : 'Sembol harf/rakam olmalı (ör. SPUS)'); }
        return X.mutate(function (s2) { findAsset(s2, id).priceKey = nk; });
      }
      if (f === 'goalId') return X.mutate(function (s2) { findAsset(s2, id).goalId = v || null; });
      if (f === 'withinTierBp') { if (v === '') return X.mutate(function (s2) { findAsset(s2, id).withinTierBp = null; }); var n = Number(String(v).replace(',', '.')); if (!(n >= 0 && n <= 100)) return X.toast('0 ile 100 arasında bir yüzde gir'); return X.mutate(function (s2) { findAsset(s2, id).withinTierBp = Math.round(n * 100); }); }
      if (/^halal\./.test(f)) {
        var hf = f.slice(6);
        return X.mutate(function (s2) { var x = findAsset(s2, id); x.halal = x.halal || { status: 'bilinmiyor', note: '', source: '', date: null }; x.halal[hf] = hf === 'status' ? v : String(v).trim().slice(0, 300); x.halal.date = X.today(); }, hf === 'status' ? 'Helal etiketi: ' + PF.HALAL[v].label : null);
      }
    }
    function onChange(el) {
      if (el.dataset.pfa) { onAssetField(el); return true; }
      if (el.dataset.pfacc) {
        var id = el.dataset.id, f = el.dataset.pfacc, v = el.value;
        X.mutate(function (s) { var a = s.accounts.find(function (x) { return x.id === id; }); a.halal = a.halal || { status: a.type === 'cash' ? 'uygun' : 'bilinmiyor', note: '', source: '', date: null }; a.halal[f] = f === 'status' ? v : v.trim().slice(0, 300); a.halal.date = X.today(); });
        return true;
      }
      if (el.dataset.pfg) {
        var gid = el.dataset.id, gf = el.dataset.pfg, gv = el.value;
        if (gf === 'target') { var k = M.parse(gv); if (k == null || k < 0) { el.setAttribute('aria-invalid', 'true'); X.toast('Geçersiz tutar'); return true; } gv = k; }
        if (gf === 'targetYm') { if (!/^\d{4}-\d{2}$/.test(gv)) { X.toast('Geçerli bir ay seç'); return true; } if (gv < X.nowYm()) { X.toast('Hedef tarihi geçmişte olamaz'); X.render(); return true; } }
        if (gf === 'shareBp') { var n = Number(String(gv).replace(',', '.')); if (!(n >= 0 && n <= 100)) { X.toast('0 ile 100 arasında gir'); return true; } gv = Math.round(n * 100); }
        if (gf === 'name') { gv = gv.trim(); if (!gv) { X.toast('Ad boş olamaz'); return true; } }
        X.mutate(function (s) { s.goals.find(function (g) { return g.id === gid; })[gf] = gv; });
        return true;
      }
      if (el.dataset.pfrule) {
        var rf = el.dataset.pfrule, rv = el.type === 'checkbox' ? el.checked : Number(String(el.value).replace(',', '.'));
        if (rf !== 'emergencyFirst') { if (!isFinite(rv)) { X.toast('Sayı gir'); return true; } rv = rf === 'minPositions' ? Math.round(rv) : Math.round(rv * 100); }
        X.mutate(function (s) { s.settings.riskRules[rf] = rv; }, 'Kural kaydedildi.');
        return true;
      }
      if (el.dataset.pfset) { var sv = Number(String(el.value).replace(',', '.')); if (!(sv >= 0 && sv <= 50)) { X.toast('0 ile 50 arasında gir'); return true; } X.mutate(function (s) { s.settings.rebalance[el.dataset.pfset] = Math.round(sv * 100); }); return true; }
      if (el.id === 'rb-money') { var m = M.parse(el.value); if (m == null || m < 0) { X.toast('Geçersiz tutar'); return true; } rbMoney = m; X.render(); return true; }
      if (el.dataset.cpi) {
        var ym = el.dataset.cpi, raw = el.value.trim().replace('%', '');
        if (!raw) { X.mutate(function (s) { s.cpi = s.cpi.filter(function (c) { return c.ym !== ym; }); }); return true; }
        var bp = PF.parseScaled(raw, 2); if (bp == null || bp < -5000 || bp > 20000) { el.setAttribute('aria-invalid', 'true'); X.toast('Aylık yüzde değişim gir, ör. 2,55'); return true; }
        X.mutate(function (s) { var c = s.cpi.find(function (q) { return q.ym === ym; }); if (c) c.bp = bp; else { s.cpi.push({ ym: ym, bp: bp }); s.cpi.sort(function (a, b) { return a.ym < b.ym ? -1 : 1; }); } });
        return true;
      }
      if (el.dataset.pfrun != null && priceRun) { var cand = priceRun.candidates[+el.dataset.pfrun]; if (cand) cand.include = el.checked && cand.check.valid; return true; }
      if (el.id === 'pt-asset') { tradeFor = el.value; X.render(); return true; }
      if (el.dataset.ptr && pReview) { onTradeRowChange(el); return true; }
      if (el.id === 'ptr-total' && pReview) { var dt = el.value.trim() ? M.parse(el.value) : null; if (el.value.trim() && dt == null) { X.toast('Geçersiz toplam'); return true; } pReview.docTotal = dt == null ? null : Math.abs(dt); var sm = document.getElementById('ptr-summary'); if (sm) sm.innerHTML = tradeSummary(); return true; }
      if (el.dataset.ppr && pReview) {
        var tr = el.closest('tr'), x = pReview.rows.find(function (q) { return String(q.key) === tr.dataset.prkey; });
        if (el.dataset.ppr === 'include') x.include = el.checked;
        else if (el.dataset.ppr === 'price') { var np = PF.parseScaled(el.value, 6); if (!np || np <= 0) { el.setAttribute('aria-invalid', 'true'); X.toast('Geçersiz fiyat. Örnek: 3,251234'); return true; } x.price = np; priceRowCheck(x, st(), X.today()); x.include = !!(x.pkey && x.chk.valid && !x.chk.needsConfirm); X.render(); }
        else { var a = findAsset(st(), el.value); x.asset = a || null; x.pkey = a ? PF.assetKey(a) : ''; priceRowCheck(x, st(), X.today()); x.include = !!(x.pkey && x.chk.valid && !x.chk.needsConfirm); X.render(); }
        return true;
      }
      return false;
    }
    function onInput(el) { if (/^pt-(qty|price|fee|side|asset|amount|wht|ratio|date)$/.test(el.id)) tradePreview(); }
    function onSubmit(e) {
      if (e.target.id === 'pf-trade-form') { e.preventDefault(); submitTrade(); return true; }
      if (e.target.id === 'pf-price-form') { e.preventDefault(); submitPrice(); return true; }
      if (e.target.classList && e.target.classList.contains('qp-form')) { e.preventDefault(); submitQuick(e.target); return true; }
      return false;
    }
    function actions(t) {
      return {
        'pf-add-asset': function () { var kind = t.dataset.kind, a = { id: S.uid(), name: 'Yeni varlık', cls: kind === 'trades' ? 'katilim_fund' : 'cash', risk: kind === 'trades' ? 'medium' : 'safe', emergency: kind !== 'trades', value: 0, halal: { status: 'bilinmiyor', note: '', source: '', date: null } }; if (kind === 'trades') { a.tracking = 'trades'; a.currency = 'TRY'; a.lot = 'fraction'; a.priceKey = null; a.symbol = ''; } else a.tracking = 'manual'; pAssets.open = a.id; X.mutate(function (s) { s.assets.push(a); }); var inp = document.querySelector('input[data-pfa="name"][data-id="' + a.id + '"]'); if (inp) { inp.focus(); inp.select(); } },
        'pf-del-asset': function () { var id = t.dataset.id, s = st(), a = findAsset(s, id), n = PF.tradesOf(s, id).length; if (!confirm('"' + a.name + '" silinsin mi?' + (n ? ' ' + n + ' alım-satım kaydı ve fiyat geçmişi de silinecek.' : ''))) return; X.mutate(function (s2) { s2.assets = s2.assets.filter(function (x) { return x.id !== id; }); s2.trades = s2.trades.filter(function (x) { return x.assetId !== id; }); delete s2.prices['m:' + id]; }, 'Varlık silindi.'); },
        'pf-trade-for': function () { tradeFor = t.dataset.id; },
        'pf-del-trade': function () { var id = t.dataset.id; X.mutate(function (s) { s.trades = s.trades.filter(function (x) { return x.id !== id; }); }, 'İşlem silindi.'); },
        'pf-add-goal': function () { var s = st(), used = M.sum(s.goals.map(function (g) { return g.shareBp; })); X.mutate(function (s2) { s2.goals.push({ id: S.uid(), name: 'Yeni hedef', target: 0, targetYm: L.addMonthsYm(X.nowYm(), 36), glide: 'standard', shareBp: Math.max(0, 10000 - used) }); }, 'Hedef eklendi. Payı ve tutarı düzenle.'); },
        'pf-del-goal': function () { var id = t.dataset.id; if (!confirm('Hedef silinsin mi? Bağlı varlıklar ortak havuza döner.')) return; X.mutate(function (s) { s.goals = s.goals.filter(function (g) { return g.id !== id; }); s.assets.forEach(function (a) { if (a.goalId === id) a.goalId = null; }); }, 'Hedef silindi.'); },
        'pf-fetch': startFetch,
        'pf-apply': applyPrices,
        'pf-run-cancel': function () { priceRun = null; X.render(); },
        'pf-del-pt': function () { var k = t.dataset.key, d = t.dataset.d; if (!confirm(keyLabel(k) + ' için ' + X.dateLabel(d) + ' fiyatı silinsin mi?')) return; X.mutate(function (s) { var h = s.prices[k]; h.points = h.points.filter(function (p) { return p.d !== d; }); if (!h.points.length) delete s.prices[k]; }, 'Fiyat silindi.'); },
        'pf-bulk-prices': bulkPrices,
        'pf-td-save': function () { var v = document.getElementById('td-key').value.trim(); window.Store.apiKeys().twelve = v; window.Store.saveApiKeys(); X.toast(v ? 'Anahtar bu cihaza kaydedildi.' : 'Anahtar silindi.'); X.render(); },
        'pf-td-del': function () { window.Store.apiKeys().twelve = ''; window.Store.saveApiKeys(); X.toast('Anahtar silindi.'); X.render(); },
        'pf-hist': fetchHistory,
        'pf-cpi-bulk': function () {
          var lines = document.getElementById('cpi-bulk').value.split(/\r?\n/), add = [], bad = 0;
          lines.forEach(function (l) { l = l.trim(); if (!l) return; var m = /^(\d{4})[-./](\d{1,2})[\s;,\t]+([-−]?[\d.,]+)\s*%?$/.exec(l); var bp = m && PF.parseScaled(m[3].replace('−', '-'), 2); if (m && +m[2] >= 1 && +m[2] <= 12 && bp != null && bp >= -5000 && bp <= 20000) add.push({ ym: m[1] + '-' + String(+m[2]).padStart(2, '0'), bp: bp }); else bad++; });
          if (!add.length) return X.toast('Okunabilen satır yok. Örnek: 2026-10 2,55');
          X.mutate(function (s) { add.forEach(function (x) { var c = s.cpi.find(function (q) { return q.ym === x.ym; }); if (c) c.bp = x.bp; else s.cpi.push(x); }); s.cpi.sort(function (a, b) { return a.ym < b.ym ? -1 : 1; }); }, add.length + ' ay TÜFE kaydedildi' + (bad ? ', ' + bad + ' satır okunamadı' : '') + '.');
        },
        'pf-import-mode': function () { importKind = t.dataset.mode || 'tx'; if (location.hash !== '#veri') location.hash = '#veri'; else X.render(); },
        'ptr-all': function () { pReview.rows.forEach(function (x) { x.include = true; }); X.render(); },
        'ptr-none': function () { pReview.rows.forEach(function (x) { x.include = false; }); X.render(); },
        'ptr-add': function () { var key = pReview.rows.reduce(function (m, x) { return Math.max(m, x.key); }, -1) + 1; var x = { key: key, include: true, date: X.today(), symbol: '', side: 'buy', qty: null, price: null, fee: 0, written: null, currency: 'TRY', assetId: '', fxRate: null, manual: true }; pReview.rows.push(x); revalidateTrades(); x.include = true; X.render(); },
        'ptr-save': saveTrades,
        'ppr-save': savePriceList,
        'pf-qp': function () { qpKey = qpKey === t.dataset.key ? null : t.dataset.key; X.render(); if (qpKey) setTimeout(function () { var i = document.querySelector('.qp-form .qp-p'); if (i) { i.focus(); i.select(); } }, 0); },
        'pf-paste-prices': function () {
          var ta = document.getElementById('pp-paste'), txt = ta ? ta.value : '', rows = PF.parsePriceText(txt, P.parseDate);
          if (!rows.length) return X.toast('Listede "KOD fiyat" satırı bulunamadı. Örnek: KTV 8,326309');
          startPriceReview('Yapıştırılan liste', rows, { text: txt });
        },
        'ptr-cancel': function () { if (confirm('Kontrol tablosu kapatılsın mı? Hiçbir şey kaydedilmeyecek.')) { pReview = null; X.render(); } }
      };
    }
    function contextSummary() {
      try {
        var c = calc(), l = [];
        if (c.sm.rows.length) l.push('Portföy (alım-satımla izlenen): ' + c.sm.rows.map(function (r) { return r.asset.name + ' ' + PF.fmtQty(r.ledger.units) + ' adet, değer ' + (r.mvTL != null ? tl(r.mvTL) : '?') + ', toplam K/Z ' + (r.totalPLTL != null ? signTl(r.totalPLTL) : '?') + ', helal: ' + PF.HALAL[PF.halalOf(r.asset)].label; }).join('; ') + '.');
        l.push('Hedefler: ' + c.rep.goals.map(function (g) { return g.goal.name + ' ' + tl(g.current) + '/' + tl(g.goal.target) + ' (' + g.goal.targetYm + ', pay ' + pct(g.goal.shareBp) + (g.onTrack ? ', yolunda' : ', geride') + ')'; }).join('; ') + '.');
        l.push('Risk kuralları: ' + c.risk.items.map(function (i) { return i.title + ': ' + i.text; }).join(' | '));
        return l.join('\n');
      } catch (e) { return ''; }
    }
    return { homeCards: homeCards, renderPortfolio: renderPortfolio, renderAnalysis: renderAnalysis, importModes: importModes, importKind: function () { return importKind; }, setImportKind: function (k) { importKind = k; },
      handleFile: handleFile, hasReview: function () { return !!pReview; }, renderImportReview: renderImportReview, onChange: onChange, onInput: onInput, onSubmit: onSubmit, actions: actions,
      rateEdited: rateEdited, contextSummary: contextSummary, afterRender: function () { tradePreview(); } };
  };
})();
