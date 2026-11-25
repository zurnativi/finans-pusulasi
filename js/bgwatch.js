/* bgwatch.js — "Arka planda portföyümü de izle" (v8.2). Tarayıcıda ve Node'da (GitHub Actions) AYNI kod çalışır.
 * Gizlilik tasarımı: depo herkese açık. Portföy verisi cihazda şifrelenir (AES-256-GCM, rastgele 256 bit anahtar); yalnız ŞİFRELİ metin gizli bir Gist'e
 * yüklenir. Anahtar yalnızca (1) bu cihazda (kilit açıksa şifreli) ve (2) GitHub Actions sırrı PORTFOLIO_KEY'de durur. Çözme yalnızca Actions çalışırken bellekte
 * olur; sonuçlar yine bu anahtarla şifrelenip market-data dalına (bg/results.enc.json) yazılır, uygulama cihazda açar. Telefona giden bildirim ntfy'dir.
 * Bu dosyada hiçbir sır, anahtar ya da kullanıcı verisi yoktur. Saf mantık: ağ/depolama dışarıdan verilir (testli). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory({ CB: require('./cryptobox.js'), PF: require('./portfolio.js'), C: require('./calc.js'), L: require('./ledger.js'), PR: require('./prices.js'), AN: require('./analysis.js'),
    NT: require('./notify.js'), N: require('./news.js'), EV: require('./events.js'), MO: require('./mood.js'), AL: require('./alerts.js'), SN: require('./snapshot.js'), CD: require('./chartdata.js'), ST: require('./stops.js') });
  else root.BgWatch = factory({ CB: root.CryptoBox, PF: root.Portfolio, C: root.Calc, L: root.Ledger, PR: root.Prices, AN: root.Analysis, NT: root.Notify, N: root.News, EV: root.Events, MO: root.Mood, AL: root.Alerts, SN: root.Snap, CD: root.ChartData, ST: root.Stops });
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  var CB = D.CB, PF = D.PF, C = D.C, L = D.L, PR = D.PR, AN = D.AN, NT = D.NT, N = D.N, EV = D.EV, MO = D.MO, AL = D.AL, SN = D.SN, CD = D.CD, ST = D.ST;
  var VERSION = 1, FORMAT = 'finans-pusulasi-bg', GIST_FILE = 'finans-pusulasi-portfoy.sifreli.json', RESULT_PATH = 'bg/results.enc.json', SETUP_PREFIX = 'FPBG1.', BUCKET = 16384, MAX_PAYLOAD_AGE_D = 30;
  var te = new TextEncoder(), td = new TextDecoder();
  function cr() { var c = globalThis.crypto; if (!c || !c.subtle) throw new Error('Bu ortamda Web Crypto yok'); return c; }
  function b64u(u8) { return CB.b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return CB.unb64(s); }
  function hex(u8) { return Array.prototype.map.call(u8, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function tsiYmd(ms) { return new Date(ms + 3 * 3600000).toISOString().slice(0, 10); }

  /* ======================= ANAHTAR, KURULUM DİZGESİ, ŞİFRELEME ======================= */
  var TOPIC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  function newTopic() { var r = cr().getRandomValues(new Uint8Array(14)), s = 'fp-'; for (var i = 0; i < r.length; i++) s += TOPIC_ALPHABET[r[i] % TOPIC_ALPHABET.length]; return s; }
  function newKey() { return cr().getRandomValues(new Uint8Array(32)); }
  function kidOf(key) { return cr().subtle.digest('SHA-256', te.encode('fp-bg-kid|' + b64u(key))).then(function (h) { return hex(new Uint8Array(h).subarray(0, 8)); }); }
  /* Kurulum dizgesi: tek GitHub sırrı (PORTFOLIO_KEY) içine yapıştırılır. İçinde: anahtar, gizli Gist numarası, ntfy konu adı. */
  function makeSetup(o) {
    if (!(o.key instanceof Uint8Array) || o.key.length !== 32) throw new Error('Anahtar 32 bayt olmalı');
    if (!/^[0-9a-f]{20,40}$/i.test(o.gist || '')) throw new Error('Gist numarası geçersiz');
    var t = o.topic || ''; if (t && !NT.TOPIC_RE.test(t)) throw new Error('ntfy konu adı geçersiz');
    return SETUP_PREFIX + b64u(te.encode(JSON.stringify({ v: 1, k: b64u(o.key), g: o.gist, t: t })));
  }
  function parseSetup(s) {
    s = String(s || '').trim(); if (s.indexOf(SETUP_PREFIX) !== 0) throw new Error('PORTFOLIO_KEY biçimi geçersiz (FPBG1. ile başlamalı)');
    var j; try { j = JSON.parse(td.decode(unb64u(s.slice(SETUP_PREFIX.length)))); } catch (e) { throw new Error('PORTFOLIO_KEY çözülemedi (kopyalarken eksik/fazla karakter olmuş olabilir)'); }
    var k = j && typeof j.k === 'string' ? unb64u(j.k) : null;
    if (!k || k.length !== 32 || !/^[0-9a-f]{20,40}$/i.test(j.g || '') || (j.t && !NT.TOPIC_RE.test(j.t))) throw new Error('PORTFOLIO_KEY içeriği geçersiz');
    return { key: k, gist: j.g, topic: j.t || '' };
  }
  function cryptoKey(raw, usage) { return cr().subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage); }
  /* Sıkıştır (varsa) → 5 baytlık başlık (bayrak + uzunluk) + veri → 16 KiB'ın katına rastgele-bağımsız sıfır dolgu → AES-GCM. Dolgu, zarf boyutundan portföy büyüklüğü sızmasın diye. */
  function gz(u8, up) {
    if (typeof CompressionStream !== 'function') return Promise.resolve(null);
    var S = up ? CompressionStream : DecompressionStream;
    return new Response(new Blob([u8]).stream().pipeThrough(new S('gzip'))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function frame(u8, flag) {
    var n = u8.length + 5, tot = Math.ceil(n / BUCKET) * BUCKET, out = new Uint8Array(tot); out[0] = flag; new DataView(out.buffer).setUint32(1, u8.length); out.set(u8, 5); return out;
  }
  function seal(key, obj, kid) {
    var raw = te.encode(JSON.stringify(obj));
    return gz(raw, true).then(function (z) {
      var use = z && z.length < raw.length ? z : raw, fr = frame(use, use === raw ? 0 : 1), iv = cr().getRandomValues(new Uint8Array(12));
      return cryptoKey(key, ['encrypt']).then(function (k) { return cr().subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode(FORMAT + '|' + kid + '|' + VERSION) }, k, fr); }).then(function (ct) {
        return { format: FORMAT, v: VERSION, kid: kid, iv: CB.b64(iv), ct: CB.b64(new Uint8Array(ct)) };
      });
    });
  }
  function open(key, env) {
    if (!env || env.format !== FORMAT || env.v !== VERSION || typeof env.iv !== 'string' || typeof env.ct !== 'string') return Promise.reject(new Error('Şifreli dosya biçimi tanınmadı'));
    return cryptoKey(key, ['decrypt']).then(function (k) { return cr().subtle.decrypt({ name: 'AES-GCM', iv: CB.unb64(env.iv), additionalData: te.encode(FORMAT + '|' + env.kid + '|' + env.v) }, k, CB.unb64(env.ct)); })
      .then(function (pt) {
        var u = new Uint8Array(pt), flag = u[0], len = new DataView(u.buffer, u.byteOffset).getUint32(1), data = u.subarray(5, 5 + len);
        return (flag === 1 ? gz(data, false) : Promise.resolve(data)).then(function (raw) { return JSON.parse(td.decode(raw)); });
      }, function () { var e = new Error('Anahtar yanlış veya dosya bozulmuş'); e.code = 'BAD_KEY'; throw e; });
  }

  /* ======================= YÜK (PAYLOAD): yalnızca gerekli en az veri ======================= */
  // Beyaz liste: bütçe ayrıntısı (işlemler, tekrarlayanlar, transferler), TÜFE, senkron izi, serbest metinler yüke GİRMEZ.
  var KEEP = ['schema', 'isExample', 'nwExample', 'nwHistory', 'incomes', 'expenses', 'debts', 'goal', 'goals', 'settings', 'accounts', 'assets', 'rates', 'installments', 'sinkingFunds', 'trades', 'prices', 'analysis', 'notifSettings', 'mood'];
  function slice(state, nowMs, device, opts) {
    opts = opts || {};
    var s = {}; KEEP.forEach(function (k) { if (state[k] !== undefined) s[k] = JSON.parse(JSON.stringify(state[k])); });
    (s.trades || []).forEach(function (t) { t.note = ''; });
    (s.installments || []).forEach(function (t) { t.description = ''; });
    ['incomes', 'expenses'].forEach(function (k) { (s[k] || []).forEach(function (x) { x.name = String(x.name || '').slice(0, 0); }); });
    if (s.notifSettings) { try { s.notifSettings = NT.cleanSettings(s.notifSettings); } catch (e) { delete s.notifSettings; } }
    var out = { v: VERSION, at: iso(nowMs), device: String(device || '').slice(0, 40), isExample: !!state.isExample, pushMode: opts.pushMode === 'generic' ? 'generic' : 'detail', state: s };
    out.reminders = remindersOf(state, tsiYmd(nowMs));
    if (opts.testPush) out.testPush = { id: String(opts.testPush.id).slice(0, 40), at: opts.testPush.at };
    if (Array.isArray(opts.inboxAck) && opts.inboxAck.length) out.inboxAck = opts.inboxAck.slice(-20); // v8.7.0: uzaktan düzenleme kutusu — uygulandı bilgisi (numara, saat, kısa özet)
    return out;
  }

  /* Yaklaşan ödemeler: cihazda (tam durumdan, "ödendi" bilgisiyle) hesaplanır; yüke yalnız hatırlatma listesi girer (işlem/tekrarlayan listesi girmez). */
  function remindersOf(state, todayYmd) {
    var up; try { up = L.upcoming(state, todayYmd, 45); } catch (e) { return []; }
    var rec = {}, acc = {}; (state.recurring || []).forEach(function (r) { rec[r.id] = r; }); (state.accounts || []).forEach(function (a) { acc[a.id] = a; });
    return up.slice(0, 40).map(function (x) {
      var rd = x.kind === 'recurring' ? rec[x.id] && rec[x.id].remindDays : x.kind === 'card' ? acc[x.id] && acc[x.id].card && acc[x.id].card.remindDays : 7;
      rd = Number.isInteger(rd) && rd >= 0 && rd <= 31 ? rd : (x.kind === 'sinking' ? 7 : 3);
      return { id: x.kind + ':' + x.id + ':' + x.date, kind: x.kind, title: String(x.title || '').slice(0, 80), date: x.date, amount: Number.isSafeInteger(x.amount) ? Math.abs(x.amount) : 0, remind: rd };
    });
  }
  function reminderCands(list, today, nowIso) {
    var cands = [], rows = [];
    (list || []).forEach(function (r) {
      if (!r || !L.isYmd(r.date)) return; var dl = L.daysBetween(today, r.date), level = dl < 0 ? 'overdue' : dl === 0 ? 'today' : dl <= r.remind ? 'soon' : 'later';
      rows.push({ id: r.id, kind: r.kind, title: r.title, date: r.date, amount: r.amount, daysLeft: dl, level: level });
      if (level === 'later' || dl < -14) return;
      cands.push({ id: 'pay:' + r.id, cat: 'payment', sev: level === 'soon' ? 'medium' : 'high', state: true, title: r.title + (dl < 0 ? ' — ödeme günü geçti (' + (-dl) + ' gün)' : dl === 0 ? ' — bugün son gün' : ' — ' + dl + ' gün sonra'),
        body: r.date.slice(8, 10) + '.' + r.date.slice(5, 7) + '.' + r.date.slice(0, 4) + ' tarihli ödeme. Ödediysen uygulamada “Ödendi” işaretle; işaretlenince bu hatırlatma kalkar.', href: '#odemeler', assets: [],
        why: ['Uygulamandaki ödeme planına göre (hatırlatma günü: ' + r.remind + ')'], sources: [{ label: 'Ödeme planın (cihazından, şifreli)', at: nowIso }] });
    });
    return { cands: cands, rows: rows };
  }

  /* ======================= ORTAK HESAPLAR (tarayıcıdaki arayüzle aynı fonksiyonlar) ======================= */
  function calcOf(s, today, ym) {
    var e = L.effectiveState(s, today), an = C.analyze(e, ym), rep = PF.goalsReport(e, an); PF.patchAnalysis(an, e, rep);
    var pos = PF.positions(s, e, an, today), sm = PF.summary(s, today), risk = PF.riskReport(s, an, pos);
    return { s: s, today: today, e: e, an: an, rep: rep, pos: pos, sm: sm, risk: risk };
  }
  function keyOfAsset(a) {
    if (!a) return null; var pk = a.priceKey || '', sym = String(a.symbol || '').toUpperCase(), US = SN.US_HALAL;
    if (/^(bist|tefas|cg|metal|fx|idx):/.test(pk)) return pk;
    if (/^td:/.test(pk)) return US[pk.slice(3)] ? 'us:' + pk.slice(3) : pk;
    if (a.cls === 'katilim_stock' && /^[A-Z0-9]{3,6}$/.test(sym)) return 'bist:' + sym;
    if ((a.cls === 'katilim_fund' || a.cls === 'sukuk') && /^[A-Z0-9]{3}$/.test(sym)) return 'tefas:' + sym;
    if (a.cls === 'halal_etf' && /^[A-Z]{2,5}$/.test(sym)) return US[sym] ? 'us:' + sym : 'td:' + sym;
    if (a.cls === 'gold') return 'metal:XAU';
    return null;
  }
  function holdingsOf(c) { // bildirim motorunun beklediği biçim (hub-ui.holdings ile aynı)
    return c.pos.filter(function (p) { return p.valueTL > 0 && !p.synthetic; }).map(function (p) {
      var a = p.asset; return { key: (a && keyOfAsset(a)) || (a ? 'a:' + a.id : 'acc:' + p.name), name: p.name, sym: a ? a.symbol : null, cls: a ? a.cls : 'cash', value: p.valueTL, halal: p.halal, asset: a };
    });
  }
  function healthInput(s, c, o) {
    o = o || {}; var sm = c.sm, R = Object.assign({}, PF.DEFAULT_RULES, (s.settings && s.settings.riskRules) || {}), rr = null; try { rr = PF.returnsReport(s, c.today); } catch (e) { rr = null; }
    var bench = null; if (rr && !rr.empty && rr.benchmarks) { var b = rr.benchmarks.filter(function (x) { return x.sim && x.sim.xirr != null && x.halal; })[0]; if (b) bench = { v: b.sim.xirr, label: b.label }; }
    var an = s.analysis || {}, prof = (an.profile && an.profile.risk) || ({ conservative: 'low', standard: 'medium', aggressive: 'high' }[(s.goals && s.goals[0] && s.goals[0].glide) || 'standard'] || 'medium');
    return { positions: c.pos.filter(function (p) { return p.valueTL > 0; }).map(function (p) { return { name: p.name, value: p.valueTL, tier: p.tier, halal: p.halal, liquid: !!(p.asset && p.asset.tracking === 'trades') || (p.isAccount && !p.synthetic) }; }),
      target: c.an.targetAlloc, current: c.an.currentAlloc, emergency: { have: c.an.emergency.current, need: c.an.emergency.target }, rules: { ok: c.risk.ok, total: c.risk.total },
      fees: sm.feesTL, invested: sm.boughtTL, perf: rr && !rr.empty && bench && rr.xirr != null ? { xirr: rr.xirr, bench: bench.v, benchLabel: bench.label } : null, profile: prof, maxSingleBp: R.maxAssetBp, corr: o.corr && !o.corr.error ? o.corr : null };
  }
  function movesOf(s, now) {
    var out = [];
    (s.assets || []).forEach(function (a) {
      var pk = a.priceKey && s.prices && s.prices[a.priceKey]; if (!pk || !pk.points || pk.points.length < 2) return; var p1 = pk.points[pk.points.length - 1], p0 = pk.points[pk.points.length - 2];
      if (!(p0.p > 0) || !(p1.p > 0) || EV.daysBetween(p0.d, p1.d) > 5 || EV.daysBetween(p1.d, EV.tsiYmd(now)) > 3) return;
      var tr = (s.trades || []).some(function (t) { return t.assetId === a.id; }); if (!tr || PF.isClosed(s, a)) return;
      out.push({ key: a.id, name: a.name, pct: (p1.p - p0.p) / p0.p, asOf: p1.d, prevD: p0.d, src: p1.src || 'Fiyat geçmişi' });
    });
    return out;
  }
  function firedList(s, now) {
    return ((s.analysis && s.analysis.alerts) || []).filter(function (a) { return a.triggeredAt && now - Date.parse(a.triggeredAt) < 7 * 86400000; }).map(function (a) {
      return { id: a.id, at: Date.parse(a.triggeredAt), title: a.name + ': ' + a.label + (a.dir === 'above' ? ' yukarı kesildi' : ' aşağı kesildi'), text: 'Seviye ' + a.price + ' · tetikleyen fiyat ' + a.firedPrice + ' (' + (a.firedSource || 'kaynak yok') + '). Alım/satım kararı vermeden önce güncel analizi aç.', name: a.name, href: '#analiz/varlik/' + a.key };
    });
  }
  function staleList(c) {
    var out = []; c.pos.forEach(function (p) { if (p.asset && p.asset.tracking === 'trades' && p.ledger && p.ledger.units > 0 && (!p.price || (p.stale && p.stale.level !== 'ok'))) out.push({ name: p.name, note: !p.price ? 'fiyat yok' : (p.stale && p.stale.label) || 'eski' }); });
    return out;
  }
  function moodInput(s, c, hub, today) { return { nw: s.nwHistory || [], isExample: !!s.isExample, nwSynthetic: !!s.nwExample, targetAlloc: c && c.an.targetAlloc, currentAlloc: c && c.an.currentAlloc, emergency: c && c.an.emergency, risk: c ? c.risk.items : [], recovery: hub && hub.recovery, checkins: (s.mood && s.mood.checkins) || [], today: today }; }
  function kapItems(MD, hold) { // KAP bildirimleri (hub-ui.loadKap ile aynı eşleme)
    var seen = {}, syms = hold.filter(function (h) { return /^bist:/.test(h.key); }).filter(function (h) { var s = h.key.slice(5); if (seen[s]) return false; seen[s] = 1; return true; }).slice(0, 15);
    return Promise.all(syms.map(function (h) { var s = h.key.slice(5); return MD.kap(s).then(function (j) { return (j.items || []).slice(0, 12).map(function (x) { return { t: s + ' — ' + x.subj, u: 'https://www.kap.org.tr/tr/Bildirim/' + x.i, s: 'KAP', a: new Date(Date.parse(x.at)).toISOString(), r: 'tr', o: 'KAP', kap: { tag: x.tag, tone: x.tone, key: h.key, sym: s } }; }); }, function () { return []; }); }))
      .then(function (arr) { return [].concat.apply([], arr); });
  }
  /* Bildirim motoru bağlamı (hub-ui.buildCtx ile aynı alanlar) */
  function buildCtx(a) {
    var s = a.state, c = a.calc, now = a.now, hold = a.hold, d = a.hub || {};
    return { now: now, settings: a.settings, hold: hold, nw: s.nwHistory || [], isExample: !!s.isExample, nwIsSynthetic: !!s.nwExample, risk: c ? c.risk.items : [], emergency: c ? c.an.emergency : null, health: a.health || null,
      moves: movesOf(s, now), fired: firedList(s, now), stale: c ? staleList(c) : [], news: a.news || [], events: EV.upcoming(d.calendar, now, 14), hub: { calendar: d.calendar, probs: d.probs, macro: d.macro, analogs: d.analogs, recovery: d.recovery, status: d.status },
      server: (d.alerts && d.alerts.items) || [], meta: a.meta };
  }

  /* ======================= FİYAT YENİLEME (uygulamadaki "Fiyatları güncelle" ile aynı doğrulama; onaysız yalnız geçerli ve büyük sıçrama olmayanlar) ======================= */
  function usedKeys(s) {
    var keys = []; (s.assets || []).forEach(function (a) { if (a.tracking === 'trades' && !PF.isClosed(s, a) && !PF.isIdle(s, a)) { var k = PF.assetKey(a); if (keys.indexOf(k) < 0) keys.push(k); } });
    ['fx:USD', 'fx:EUR', 'metal:XAU', 'idx:KATLM', 'idx:XKTUM', 'idx:XU100'].forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    Object.keys(s.prices || {}).forEach(function (k) { if (keys.indexOf(k) < 0 && PF.keyInfo(k)) keys.push(k); });
    return keys;
  }
  function setPrice(s, key, d, p, src, at) { PF.setPrice(s, key, d, p, src, at); } // uygulamadakiyle aynı yol (Portfolio.setPrice)
  function refreshPrices(s, today, opts) {
    var keys = usedKeys(s).filter(function (k) { var ki = PF.keyInfo(k); return ki && ki.kind !== 'manual'; }), out = { applied: [], skipped: [], errors: [] };
    return PR.fetchAll(keys, { twelveKey: '' }).then(function (res) {
      out.errors = res.errors.slice(0, 12); var extra = [];
      // Twelve Data anahtarı yok: ABD ETF'leri için TradingView (aynı kaynak, tarayıcıdaki canlı analizle aynı)
      var have = {}; res.candidates.forEach(function (c2) { have[c2.key] = 1; });
      var tdKeys = keys.filter(function (k) { return /^td:/.test(k) && !have[k]; });
      return Promise.all(tdKeys.map(function (k) { return opts.quoteOf ? opts.quoteOf(k, null).then(function (q) { var p = PF.parseScaled(String(q.price), 6); if (p) extra.push({ key: k, cur: 'USD', p: p, d: today, at: q.at, src: q.source + ' (anahtarsız yedek)' }); }, function () { }) : null; })).then(function () {
        res.candidates.concat(extra).forEach(function (c2) {
          var old = PF.lastPoint(s, c2.key), chk = PF.checkPrice(c2.p, old, PF.kindFor(c2.key, (s.assets || []).find(function (a) { return PF.assetKey(a) === c2.key; })), c2.d, today);
          if (c2.badCurrency) { chk.valid = false; chk.reasons.push('para birimi ' + c2.badCurrency); }
          if (c2.cross && !c2.cross.check.ok) { chk.needsConfirm = true; chk.reasons.push('kaynaklar arası fark'); }
          if (old && old.d === c2.d && old.p === c2.p) return;
          if (chk.valid && !chk.needsConfirm) { setPrice(s, c2.key, c2.d, c2.p, c2.src, c2.at); out.applied.push(c2.key); }
          else out.skipped.push({ key: c2.key, why: chk.reasons.join('; ') || 'geçersiz' });
        });
        return out;
      });
    }, function (e) { out.errors.push(String(e && e.message || e)); return out; });
  }
  /* Tek varlık için canlı fiyat (analiz arayüzündeki quickPrice ile aynı) */
  function quote(MD, key, sym) {
    var k = key.split(':')[0], s = key.slice(k.length + 1), TV = function (x) { return MD.tvLive(x).then(function (r) { return { price: r.c, at: r.at, source: MD.SOURCES.tv }; }); };
    if (k === 'bist' || k === 'idx') return TV('BIST:' + s);
    if (k === 'us' || k === 'td') return MD.TV_US[s] ? TV(MD.TV_US[s]) : Promise.reject(new Error('kaynak yok'));
    if (k === 'macro') return TV(MD.TV_MACRO[s]);
    if (k === 'fx') return TV(MD.TV_MACRO[s + 'TRY']);
    if (k === 'metal') return Promise.all([MD.tvLive(MD.TV_MACRO[s === 'XAU' ? 'XAUUSD' : 'XAGUSD']), MD.tvLive(MD.TV_MACRO.USDTRY)]).then(function (r) { return { price: r[0].c * r[1].c / 31.1034768, at: r[0].at, source: 'TradingView (ons × USD/TL ÷ 31,1035, türetilmiş)' }; });
    if (k === 'cg') { var pair = MD.cryptoPair(s, sym); if (!pair) return Promise.reject(new Error('parite bilinmiyor')); return MD.fetchJson('https://data-api.binance.vision/api/v3/ticker/price?symbol=' + pair, { timeout: 12000 }).then(function (j) { var v = +j.price; if (!(v > 0)) throw new Error('fiyat yok'); return { price: v, at: new Date().toISOString(), source: 'Binance spot (' + pair + ')' }; }); }
    if (k === 'tefas') return MD.fetchJson(MD.URL.tefas(s, 0), { timeout: 15000 }).then(function (j) { if (!(j && j.price > 0)) throw new Error('fiyat yok'); return { price: j.price, at: j.data_date ? j.data_date + 'T18:00:00+03:00' : new Date().toISOString(), source: MD.SOURCES.tefas }; });
    return Promise.reject(new Error('kaynak yok'));
  }

  /* ======================= ANA KONTROL ======================= */
  var WEAK = { weak: 1, veryweak: 1 };
  function pickAnalysisCands(hold, snaps, prevAn, now, wl) {
    var cands = [], an = {}, seen = {};
    function consider(key, name, role) {
      if (!key || seen[key]) return; seen[key] = 1; var s = snaps[key]; if (!s || s.blocked || s.total == null) return;
      an[key] = { total: s.total, stance: s.stance && s.stance.code, at: s.at, price: s.price, lastDate: s.lastDate, hold: s.stance && s.stance.hold ? s.stance.hold.code : null };
      var o = prevAn && prevAn[key], nm = name || s.name.split(' — ')[0], day = tsiYmd(now);
      if (role === 'hold' && o && o.total != null) {
        var d = s.total - o.total;
        if (d <= -15) cands.push({ id: 'an:drop:' + key + ':' + day, cat: 'portfolio', sev: 'high', title: nm + ': analiz skoru ' + o.total + ' → ' + s.total, body: 'Son kontrolden bu yana ' + Math.abs(d) + ' puan düştü; görünüm: ' + (s.stance && s.stance.label) + '. Satış emri değildir: önce güncel analizi aç ve gerekçeleri oku.', href: '#analiz/varlik/' + key, assets: [nm], why: ['Eşik: skor ≥15 puan düşüşü', 'Aynı analiz motoru, günlük mumlar'], sources: [{ label: 'Analiz anlık görüntüsü', at: s.at }] });
        if (!WEAK[o.stance] && s.stance && WEAK[s.stance.code]) cands.push({ id: 'an:weak:' + key + ':' + day, cat: 'portfolio', sev: 'high', title: nm + ': görünüm zayıfladı', body: '"' + (s.stance.label) + '" (skor ' + s.total + '). Yeni alım yapma; elindeki için güncel analizi aç ve planını gözden geçir.', href: '#analiz/varlik/' + key, assets: [nm], why: ['Duruş zayıf/çok zayıf sınıfına geçti'], sources: [{ label: 'Analiz anlık görüntüsü', at: s.at }] });
        if (s.stance && s.stance.hold && s.stance.hold.code === 'trim' && !(o.hold === 'trim')) cands.push({ id: 'an:trim:' + key + ':' + day, cat: 'portfolio', sev: 'high', title: nm + ': yorulma işaretleri — kısmi azaltmayı gözden geçir', body: (s.stance.hold.why || []).slice(0, 2).join(' · ') + '. Bu otomatik satış değildir; yalnızca taze analizin gösterdiği zayıflık/yorulma. Kararı sen ver.', href: '#analiz/varlik/' + key, assets: [nm], why: ['Satış kuralı: yalnız taze analiz dirençte ≥2 yorulma işareti gösterirse'], sources: [{ label: 'Analiz anlık görüntüsü', at: s.at }] });
      }
      var p = s.plans && s.plans.conservative;
      if (role === 'hold' && s.halalOk && p && p.stop != null && s.price != null && s.price < p.stop) cands.push({ id: 'stop:' + key + ':' + p.stop + ':' + s.lastDate, cat: 'level', sev: 'high', state: true, title: nm + ': fiyat analiz stop seviyesinin altında', body: 'Son ' + s.price + ' < seviye ' + p.stop + ' (' + (p.stopLabel || 'yapı bazlı') + '). Güncel analizi aç; bu otomatik satış emri değildir.', href: '#analiz/varlik/' + key, assets: [nm], why: ['Seviye, taze analizin yapısından çıkar (sabit % değil)'], sources: [{ label: 'Analiz anlık görüntüsü', at: s.at }] });
    }
    hold.forEach(function (h) { consider(h.key, h.name, 'hold'); });
    (wl || []).forEach(function (w) { consider(w.key, w.name, 'watch'); });
    return { cands: cands, an: an };
  }
  /* payload: şifresi çözülmüş yük; data: herkese açık piyasa verisi {feed, calendar, probs, macro, analogs, recovery, status, alerts};
   * opts: { now, MD, prev (önceki sonuçlar), snapOf(key)→Promise<anlık görüntü|null>, quoteOf(key,sym)→Promise, refresh:true } */
  /* v8.5: Zarar durdur (stop) kontrolü — kullanıcının koyduğu seviyeler, gerçek fiyatla. Tekrar önleme durumu önceki şifreli sonuçta (prev.stopState) tutulur. */
  function checkStops(state, hold, prev, opts, now, nowIso, res) {
    if (!ST) return Promise.resolve([]);
    var held = {}; hold.forEach(function (h) { if (h.asset) held[h.asset.id] = h; });
    var list = (state.assets || []).filter(function (a) { return a.stop && held[a.id] && ST.clean(a.stop) && a.stop.active !== false; });
    var prevMap = ST.cleanStateMap((prev && prev.stopState) || (state.analysis && state.analysis.stopState) || {}), next = {}, cands = [], rows = [], logs = [];
    res.stopState = prevMap;
    if (!list.length) { res.stops = []; return Promise.resolve([]); }
    return Promise.all(list.map(function (a) {
      var st = ST.clean(a.stop), key = keyOfAsset(a);
      var qp = key && opts.stopQuoteOf ? opts.stopQuoteOf(a, key, st) : Promise.reject(new Error(key ? 'fiyat kaynağı yok' : 'piyasa anahtarı yok'));
      return qp.then(function (q) {
        var ev = ST.evaluate(st, q), stp = ST.step(prevMap[a.id], st, ev, nowIso); next[a.id] = stp.state;
        rows.push({ assetId: a.id, name: a.name, level: ev.level, eff: ev.eff ? ev.eff.level : st.price, how: ev.eff ? ev.eff.how : null, distPct: ev.distPct != null ? Math.round(ev.distPct * 10000) / 10000 : null, price: ev.price || null, at: ev.at || null, src: ev.source || null, text: ev.text });
        if (stp.event) { cands.push(ST.notifCand(a, st, stp.event)); logs.push(ST.logEntry(a, st, stp.event, 'bg')); }
      }, function (e) { if (prevMap[a.id]) next[a.id] = prevMap[a.id]; rows.push({ assetId: a.id, name: a.name, level: null, eff: st.price, text: 'Fiyat alınamadı — stop kontrol edilemedi (' + String(e && e.message || e).slice(0, 60) + ')' }); });
    })).then(function () {
      res.stops = rows; res.stopState = next;
      var lg = (prev && prev.stopLog) || []; logs.forEach(function (l) { lg = ST.addLog(lg, l); }); res.stopLog = ST.cleanLog(lg);
      res.stopEvents = logs;
      return cands;
    });
  }
  function check(payload, data, opts) {
    opts = opts || {}; var now = opts.now || Date.now(), nowIso = iso(now), state = JSON.parse(JSON.stringify(payload.state)), today = tsiYmd(now), ym = today.slice(0, 7), prev = opts.prev || null;
    var res = { v: VERSION, generatedAt: nowIso, payloadAt: payload.at, isExample: !!state.isExample, errors: [], steps: {} };
    var ageD = (now - Date.parse(payload.at)) / 86400000; res.payloadAgeDays = isFinite(ageD) ? Math.round(ageD * 10) / 10 : null;
    if (ageD > MAX_PAYLOAD_AGE_D) { res.ok = false; res.status = 'payload_old'; res.errors.push('Cihazdaki veri ' + Math.floor(ageD) + ' gündür güncellenmedi; uygulamayı bir kez aç.'); return Promise.resolve({ res: res, deliver: [], settings: null }); }
    return Promise.resolve().then(function () {
      if (opts.refresh === false || state.isExample) { res.steps.prices = { skipped: state.isExample ? 'örnek veri' : 'kapalı' }; return null; }
      return refreshPrices(state, today, opts).then(function (r) { res.steps.prices = r; });
    }).then(function () {
      var c = calcOf(state, today, ym), hold = holdingsOf(c);
      if (!state.isExample && !state.nwExample && c.an && c.an.assets && Number.isSafeInteger(c.an.assets.netWorth)) { var rec = CD.record(state.nwHistory, today, c.an.assets.netWorth); state.nwHistory = rec.list; }
      var total = hold.reduce(function (t, h) { return t + h.value; }, 0), H = null; try { H = AN.health(healthInput(state, c)); } catch (e) { res.errors.push('sağlık skoru: ' + e.message); }
      res.health = H ? { total: H.total, grade: H.grade, scores: Object.keys(H.scores).reduce(function (o, k) { o[k] = H.scores[k] ? H.scores[k].score : null; return o; }, {}), fixes: H.fixes.slice(0, 4).map(function (f) { return { k: f.k, score: f.score, text: f.text }; }), coverage: H.coverage } : null;
      res.positions = hold.map(function (h) { return { key: h.key, name: h.name, cls: h.cls, share: total > 0 ? Math.round(h.value / total * 1000) / 10 : null, halal: h.halal }; }).sort(function (a, b) { return (b.share || 0) - (a.share || 0); });
      res.netWorth = c.an.assets.netWorth; res.nwLast = (state.nwHistory || []).slice(-30);
      var prevLog = NT.cleanLog(prev && prev.log), S = NT.cleanSettings(state.notifSettings);
      // 1) Seviye alarmları: aktif alarmların güncel fiyatı
      var alerts = (state.analysis && state.analysis.alerts) || [], act = AL.active(alerts), prices = {}, qerr = [];
      var qjobs = []; var qseen = {}; act.forEach(function (a) { if (qseen[a.key]) return; qseen[a.key] = 1; if (opts.quoteOf) qjobs.push(opts.quoteOf(a.key, a.sym).then(function (q) { prices[a.key] = q; }, function (e) { qerr.push(a.name + ': ' + e.message); })); });
      return Promise.all(qjobs).then(function () {
        var ev = AL.evaluate(alerts, prices, nowIso); state.analysis = state.analysis || {}; state.analysis.alerts = ev.alerts;
        res.alertsChecked = { total: act.length, priced: Object.keys(prices).length, errors: qerr.slice(0, 8) };
        res.alertsFired = ev.fired.map(function (a) { return { id: a.id, key: a.key, triggeredAt: a.triggeredAt, firedPrice: a.firedPrice, firedSource: a.firedSource }; });
        return checkStops(state, hold, prev, opts, now, nowIso, res);
      }).then(function (stopCands) {
        // 2) Varlık analizleri (taze anlık görüntüler): portföy + izleme listesi
        var wl = (state.analysis && state.analysis.watchlist) || [], keys = {}; hold.forEach(function (h) { if (/^(bist|tefas|cg|metal|fx|idx|us):/.test(h.key)) keys[h.key] = 1; }); wl.forEach(function (w) { if (w.key) keys[w.key] = 1; });
        var snaps = {}, ks = Object.keys(keys).slice(0, 40);
        return Promise.all(ks.map(function (k) { return opts.snapOf ? opts.snapOf(k).then(function (s) { if (s) snaps[k] = s; }, function (e) { res.errors.push(k + ': analiz alınamadı (' + String(e && e.message || e).slice(0, 60) + ')'); }) : null; })).then(function () {
          var pa = pickAnalysisCands(hold, snaps, prev && prev.analysis, now, wl); res.analysis = pa.an;
          // 3) Haber ve KAP
          return (opts.MD ? kapItems(opts.MD, hold) : Promise.resolve([])).then(function (kap) {
            var items = ((data.feed && data.feed.items) || []).concat(kap), news = N.process(items, hold, now);
            var health = H, meta = prevLog.meta, ctx = buildCtx({ state: state, calc: c, now: now, hold: hold, settings: S, health: health, news: news, hub: data, meta: meta });
            var ev2 = NT.evaluate(ctx), rm = reminderCands(payload.reminders, today, nowIso), cands = ev2.cands.concat(stopCands || [], pa.cands, rm.cands); res.reminders = rm.rows.slice(0, 20);
            var firstRun = !prev || !prev.log, fresh = NT.merge(prevLog, cands, now, ev2.metaPatch);
            prevLog.items.forEach(function (it) { if (/^an:/.test(it.id) && !it.resolvedAt && now - (it.firstAt || it.at || now) > 36 * 3600000) it.resolvedAt = now; }); // geçiş uyarıları 36 sa sonra kutudan kalkar
            var dl = NT.deliverable(prevLog, fresh, S, now).filter(function (it) { return it.origin !== 'workflow'; }); // piyasa geneli uyarıları zaten tools/publish.py ntfy'ye gönderir (çift bildirim olmasın)
            if (firstRun) dl = dl.filter(function (it) { return it.sev === 'critical'; }).slice(0, 3); // ilk çalışmada eski durumlar için bildirim yağmuru olmasın
            res.log = prevLog; res.fresh = fresh; res.deliver = dl.map(function (it) { return it.id; });
            res.items = NT.visible(prevLog, S, now).slice(0, 40).map(function (it) { return { id: it.id, cat: it.cat, sev: it.sev, title: it.title, body: it.body, href: it.href, at: it.at, assets: it.assets, why: it.why, sources: (it.sources || []).slice(0, 3) }; });
            res.counts = NT.counts(prevLog, S, now);
            res.news = { total: news.length, mine: news.filter(function (n) { return n.mine; }).length, top: news.filter(function (n) { return n.mine && n.imp && n.imp.level !== 'low'; }).slice(0, 6).map(function (n) { return { t: n.t, u: n.u, s: n.s, a: n.a, level: n.imp.level }; }) };
            try { var m = MO.assess(moodInput(state, c, data, today)); res.mood = { state: m.state.id, label: m.state.label, metrics: m.metrics ? { dd: m.metrics.dd, vol: m.metrics.vol } : null, notice: m.notice || null, mismatch: m.mismatch || null }; } catch (e) { res.errors.push('duygu: ' + e.message); }
            res.alertsState = state.analysis.alerts.filter(function (a) { return a.triggeredAt; }).map(function (a) { return { id: a.id, triggeredAt: a.triggeredAt, firedPrice: a.firedPrice, firedSource: a.firedSource, lastPrice: a.lastPrice }; });
            res.settings = { cats: S.cats, quiet: S.quiet, pushMode: payload.pushMode === 'generic' ? 'generic' : 'detail' };
            res.ok = true; res.status = 'ok';
            return { res: res, deliver: dl, settings: S };
          });
        });
      });
    }).then(function (r) { return r; }, function (e) { res.ok = false; res.status = 'error'; res.errors.push(String(e && e.message || e).slice(0, 200)); return { res: res, deliver: [], settings: null }; });
  }

  /* ======================= ntfy GÖVDESİ ======================= */
  // ntfy.sh sunucusu mesaj metnini görür. "ayrıntılı": başlık + gövde, ama TL tutarları ve adetler silinir; "genel": yalnız önem derecesi ve kategori.
  function redact(t) {
    return String(t || '').replace(/\d[\d.\s]*(?:,\d+)?\s*(?:bin|milyon|mn|mr)?\s*(?:TL\b|₺)/gi, '[tutar]').replace(/(?:₺|TL)\s*\d[\d.,]*(?:\s*(?:bin|milyon))?/gi, '[tutar]').replace(/\s+/g, ' ').trim();
  }
  function pushMessage(it, mode) {
    var sevL = (NT.SEV[it.sev] || {}).label || it.sev, cat = NT.CATS[it.cat] || it.cat;
    if (mode === 'generic') return { title: (it.sev === 'critical' ? '🔴 ' : '🟠 ') + 'Portföy uyarısı: ' + sevL + ' · ' + cat, message: 'Ayrıntı için Finans Pusulası uygulamasını aç.', priority: it.sev === 'critical' ? 5 : 4 };
    return { title: (it.sev === 'critical' ? '🔴 ' : '🟠 ') + redact(it.title).slice(0, 100), message: redact(it.body).slice(0, 280), priority: it.sev === 'critical' ? 5 : 4 };
  }

  return { VERSION: VERSION, FORMAT: FORMAT, GIST_FILE: GIST_FILE, RESULT_PATH: RESULT_PATH, SETUP_PREFIX: SETUP_PREFIX, KEEP: KEEP, MAX_PAYLOAD_AGE_D: MAX_PAYLOAD_AGE_D, b64u: b64u, unb64u: unb64u,
    newKey: newKey, newTopic: newTopic, kidOf: kidOf, makeSetup: makeSetup, parseSetup: parseSetup, seal: seal, open: open, slice: slice, calcOf: calcOf, keyOfAsset: keyOfAsset, holdingsOf: holdingsOf,
    healthInput: healthInput, movesOf: movesOf, firedList: firedList, staleList: staleList, moodInput: moodInput, kapItems: kapItems, buildCtx: buildCtx, refreshPrices: refreshPrices, quote: quote, check: check, redact: redact, pushMessage: pushMessage, tsiYmd: tsiYmd, iso: iso };
});
