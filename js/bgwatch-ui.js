/* bgwatch-ui.js — "Arka planda portföyümü de izle" kurulum sihirbazı, durum kontrolü, sonuç kartı, anahtar yenileme ve kapatma/silme (v8.2).
 * Hesap/şifreleme js/bgwatch.js'te (testli, Node'da da çalışır). Bu dosya yalnızca gösterir ve kullanıcı eylemini uygular.
 * Gizlilik: yük cihazda şifrelenir; yalnız şifreli metin gizli Gist'e gider. Anahtar bu cihazda (Store.setSecret, kilit açıksa PIN anahtarıyla) ve kullanıcının
 * GitHub Actions sırrında (PORTFOLIO_KEY) durur. Hiçbir sır bu dosyada ya da depoda yoktur. */
(function () {
  'use strict';
  window.BgUI = function (X) {
    var BG = window.BgWatch, NT = window.Notify, esc = X.esc, SYNC = window.Sync;
    var REPO = 'zurnativi/finans-pusulasi', GH = 'https://github.com/' + REPO;
    var URLS = { secretNew: GH + '/settings/secrets/actions/new', secrets: GH + '/settings/secrets/actions', run: GH + '/actions/workflows/market-portfolio.yml', ntfyApp: 'https://docs.ntfy.sh/subscribe/phone/', token: 'https://github.com/settings/tokens/new?scopes=gist&description=Finans%20Pusulasi%20arka%20plan', gists: 'https://gist.github.com/' };
    var RESULT_URL = 'https://raw.githubusercontent.com/' + REPO + '/market-data/' + BG.RESULT_PATH;
    var IB = window.Inbox, INBOX_URL = 'https://raw.githubusercontent.com/' + REPO + '/market-data/' + (IB ? IB.PATH : 'bg/inbox.enc.json'); // v8.7.0: uzaktan düzenleme kutusu
    var inbox = { applied: [] }, inboxBusy = false;
    var STANCE = { strong: 'Güçlü', positive: 'Olumlu', neutral: 'Nötr', weak: 'Zayıf', veryweak: 'Çok zayıf', nosignal: 'Sinyal yok', raise: 'Güçlü', trim: 'Yorulma' };
    var HOLD = { trim: 'azaltmayı gözden geçir', raise: 'hedefi yükselt', hold: 'tut' };
    var SEVL = { critical: 'Kritik', high: 'Yüksek', medium: 'Orta', info: 'Bilgi', low: 'Düşük' }, SEVC = { critical: 'sev-critical', high: 'sev-high', medium: 'sev-medium', info: 'sev-info', low: 'sev-info' };
    var cfg = null, cfgErr = null, loading = false, resCache = null, started = false;
    var ui = { busy: '', msg: '', kind: '', reveal: false, check: null, res: null, resErr: null, resAt: 0, tokenDraft: '', waiting: false, rotated: false, confirmOff: false, openTech: false };
    var timers = { pull: 0, push: 0, wait: 0 };

    /* ---------- Yardımcılar ---------- */
    function st() { return X.state(); }
    function tsi(ms) { return new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' TSİ'; }
    function rel(ms) { var m = Math.round((Date.now() - ms) / 60000); if (!isFinite(m)) return ''; if (m < 1) return 'şimdi'; if (m < 60) return m + ' dk önce'; var h = Math.round(m / 60); return h < 48 ? h + ' sa önce' : Math.round(h / 24) + ' gün önce'; }
    function sevPill(s) { return '<span class="sev ' + (SEVC[s] || 'sev-info') + '">' + esc(SEVL[s] || s) + '</span>'; }
    function isExample() { var s = st(); return !!(s && s.isExample); }
    function msg(text, kind) { ui.msg = text || ''; ui.kind = kind || ''; X.render(); }
    function sha(txt) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (b) { return BG.b64u(new Uint8Array(b)); }); }
    function loadCfg() {
      if (cfg || loading) return Promise.resolve(cfg); loading = true;
      return Promise.all([window.Store.getSecret('bgwatch'), window.Store.getSecret('bgwatch-res'), window.Store.getSecret('bgwatch-inbox').catch(function () { return null; })]).then(function (r) { cfg = r[0] || { on: false }; if (r[2] && Array.isArray(r[2].applied)) inbox = r[2]; if (!resCache && r[1] && r[1].res) { resCache = r[1]; ui.res = r[1].res; ui.resAt = r[1].fetchedAt || 0; } cfgErr = null; }, function (e) { cfgErr = e.code === 'LOCKED' ? 'Uygulama kilitli; kilidi aç.' : 'Ayarlar okunamadı: ' + e.message; cfg = null; }).then(function () { loading = false; X.render(); return cfg; });
    }
    function saveCfg() { return window.Store.setSecret('bgwatch', cfg); }
    function syncToken() { return window.Store.getSecret('sync').then(function (c) { return c && c.token ? c.token : null; }, function () { return null; }); }
    function token() { return cfg && cfg.token ? Promise.resolve(cfg.token) : syncToken(); }
    /* Gizli Gist istemcisi (yalnızca bu özelliğin dosyası; eşitleme Gist'ine dokunmaz) */
    function gist(tok) {
      function req(method, path, body) {
        var h = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + tok, 'X-GitHub-Api-Version': '2022-11-28' }; if (body) h['Content-Type'] = 'application/json';
        return fetch('https://api.github.com' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }).then(function (r) {
          if (r.status === 204) return null;
          return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* */ } if (!r.ok) throw (SYNC && SYNC.httpError ? SYNC.httpError(r.status, j, path.split('?')[0]) : Object.assign(new Error('GitHub hatası (' + r.status + ')'), { status: r.status })); return j; });
        }, function () { throw new Error('GitHub’a bağlanılamadı. İnternet bağlantını kontrol et.'); });
      }
      function files(content) { var f = {}; f[BG.GIST_FILE] = { content: content }; return f; }
      return {
        user: function () { return req('GET', '/user'); },
        create: function (content) { return req('POST', '/gists', { description: 'Finans Pusulası — arka plan portföy izleme (şifreli; anahtar olmadan okunamaz)', public: false, files: files(content) }).then(function (g) { if (g.public) throw new Error('Gist gizli oluşturulamadı'); return g.id; }); },
        update: function (id, content) { return req('PATCH', '/gists/' + encodeURIComponent(id), { files: files(content) }); },
        read: function (id) { return req('GET', '/gists/' + encodeURIComponent(id)).then(function (g) { var f = g && g.files && g.files[BG.GIST_FILE]; if (!f) return null; if (!f.truncated && typeof f.content === 'string') return f.content; return fetch(f.raw_url, { cache: 'no-store' }).then(function (r) { return r.text(); }); }); },
        remove: function (id) { return req('DELETE', '/gists/' + encodeURIComponent(id)); }
      };
    }
    function deviceName() { var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'tarayıcı'; return String(p).slice(0, 30); }
    function payloadNow(testPush) { return BG.slice(st(), Date.now(), deviceName(), { pushMode: cfg.pushMode, testPush: testPush, inboxAck: IB ? IB.ackList(inbox.applied) : [] }); }
    function sigText(p) { return JSON.stringify(p.state) + (p.inboxAck ? '|ack:' + p.inboxAck.map(function (a) { return a.id; }).join(',') : ''); }
    function sealPayload(key, kid, testPush) { var p = payloadNow(testPush), sig = sigText(p); return sha(sig).then(function (h) { return BG.seal(key, p, kid).then(function (env) { return { text: JSON.stringify(env), sig: h + '|' + p.pushMode + '|' + (testPush ? testPush.id : '') }; }); }); }
    function keyOf() { return BG.unb64u(cfg.key); }

    /* ---------- Yükleme (cihaz → gizli Gist, şifreli) ---------- */
    var uploading = false;
    function upload(reason, testPush) {
      if (!cfg || !cfg.on || !cfg.gist || !st() || uploading) return Promise.resolve(false); uploading = true;
      return token().then(function (tok) { if (!tok) throw new Error('GitHub erişim anahtarı yok'); return sealPayload(keyOf(), cfg.kid, testPush).then(function (s) { return gist(tok).update(cfg.gist, s.text).then(function () { cfg.uploadedAt = Date.now(); cfg.sig = s.sig; cfg.upErr = null; return saveCfg(); }); }); })
        .then(function () { uploading = false; return true; }, function (e) { uploading = false; cfg.upErr = String(e.message || e).slice(0, 160); saveCfg(); if (reason !== 'auto') throw e; return false; });
    }
    function tick() {
      if (!cfg || !cfg.on || !st() || document.hidden || uploading) return;
      var p = payloadNow(), sig = sigText(p);
      sha(sig).then(function (h) { var full = h + '|' + p.pushMode + '|' + ((cfg.sig || '').split('|')[2] || ''); if (cfg.sig !== full || Date.now() - (cfg.uploadedAt || 0) > 12 * 3600000) upload('auto'); });
    }

    /* ---------- Sonuçlar (Actions → cihaz, şifreli) ---------- */
    function pull(manual) {
      if (!cfg || !cfg.on) return Promise.resolve(null);
      return fetch(RESULT_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
        if (r.status === 404) { ui.res = null; ui.resErr = { code: 'none' }; return null; }
        if (!r.ok) throw new Error('Sonuç dosyası alınamadı: HTTP ' + r.status);
        return r.json().then(function (env) {
          if (env.kid !== cfg.kid) { ui.resErr = { code: 'kid', kid: env.kid }; ui.res = null; return null; }
          return BG.open(keyOf(), env).then(function (res) { ui.res = res; ui.resErr = null; ui.resAt = Date.now(); resCache = { res: res, fetchedAt: ui.resAt }; window.Store.setSecret('bgwatch-res', resCache); mergeAlerts(res); return res; });
        });
      }).catch(function (e) { ui.resErr = { code: e.code === 'BAD_KEY' ? 'badkey' : 'net', text: e.message }; return null; }).then(function (r) { X.render(); pullInbox(); return r; });
    }

    /* ---------- v8.7.0: Uzaktan düzenleme kutusu (iş akışı → cihaz, şifreli; cihaz anahtarıyla açılır) ----------
     * Yeni bir düzenleme (daha önce uygulanmamış numara) gelince: önce otomatik kopya (Ayarlar → Yedek → Anlık görüntüler), sonra uygulama,
     * "Geri al"lı bildirim; sonuç (numara, saat, kısa özet) cihazın şifreli yüküne girer ki kutu tarafı doğrulayabilsin. */
    function saveInbox() { return window.Store.setSecret('bgwatch-inbox', inbox); }
    function pullInbox() {
      if (!IB || !cfg || !cfg.on || !cfg.kid || inboxBusy || !st() || !X.mutate) return Promise.resolve(null);
      inboxBusy = true;
      return fetch(INBOX_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) return null; // 404: bekleyen düzenleme yok
        return r.json().then(function (env) { if (!env || env.kid !== cfg.kid) return null; return BG.open(keyOf(), env).then(applyEdit); });
      }).catch(function (e) { console.error('uzaktan düzenleme:', e && e.message); return null; }).then(function (x) { inboxBusy = false; return x; });
    }
    function applyEdit(edit) {
      if (!edit || typeof edit.id !== 'string' || IB.done(inbox.applied, edit.id)) return null;
      var MG = window.Migrate; if (MG && MG.locked(edit.id)) return null; // v8.7.2: yerleşik tek seferlik düzenleme şu an aynı numarayı uyguluyor
      if (MG && MG.isDone(edit.id)) return Promise.resolve(recordExternal({ id: edit.id, at: new Date().toISOString(), ok: true, lines: ['Bu cihazda yerleşik tek seferlik düzenlemeyle zaten uygulanmıştı'] }));
      var title = String(edit.title || 'Uzaktan düzenleme').slice(0, 120), at = new Date().toISOString();
      function done(rec) { rec.ver = IB.APP_VERSION; inbox.applied = IB.record(inbox.applied, rec); return saveInbox().then(function () { return upload('auto'); }).catch(function () { return false; }).then(function () { X.render(); return rec; }); }
      var errs = IB.errors(edit);
      if (errs.length) { X.toast('Uzaktan düzenleme uygulanmadı: ' + errs[0]); return done({ id: edit.id, at: at, ok: false, error: errs.slice(0, 3).join(' · ') }); }
      var pv = IB.preview(st(), edit, X.uid);
      if (!pv.ok) { X.toast('Uzaktan düzenleme uygulanmadı: ' + pv.error); return done({ id: edit.id, at: at, ok: false, error: pv.error }); }
      return Promise.resolve(X.snapshot ? X.snapshot('Uzaktan düzenleme öncesi: ' + title) : null).catch(function () { return null; }).then(function () {
        var err = null, lines = null;
        var ok = X.mutate(function (s) { try { lines = IB.apply(s, edit, X.uid); } catch (x) { err = x; throw x; } }, '✓ ' + title + ' uygulandı — ' + pv.lines.join(' · ') + '. Önce otomatik kopya alındı.');
        return done(ok ? { id: edit.id, at: at, ok: true, lines: lines || pv.lines } : { id: edit.id, at: at, ok: false, error: String(err && err.message || 'doğrulama hatası').slice(0, 300) });
      });
    }
    function recordExternal(rec) { rec.ver = rec.ver || (IB && IB.APP_VERSION); inbox.applied = IB.record(inbox.applied, rec); return saveInbox().then(function () { return upload('auto'); }).catch(function () { return false; }).then(function () { X.render(); return rec; }); }
    function inboxCard() {
      var l = IB ? IB.ackList(inbox.applied).slice(-5).reverse() : []; if (!l.length) return '';
      return '<section class="card bgw-inbox"><h2>Uzaktan düzenlemeler</h2><p class="hint">Senin isteğinle hazırlanan düzenlemeler şifreli olarak gelir; uygulanmadan önce otomatik kopya alınır (Ayarlar → Yedek → Anlık görüntüler), değişiklik geçmişinden geri alınabilir.</p><ul>' +
        l.map(function (a) { var t = Date.parse(a.at); return '<li class="' + (a.ok ? 'ok' : 'bad') + '"><b>' + (a.ok ? '✓ Uygulandı' : '✗ Uygulanmadı') + '</b> · ' + esc(isFinite(t) ? tsi(t) : a.at) + '<br>' + esc(a.ok ? a.lines.join(' · ') : (a.error || '')) + '</li>'; }).join('') + '</ul></section>';
    }
    function mergeAlerts(res) { // arka planda tetiklenen seviye alarmını uygulamadaki alarma da işle (yalnız henüz tetiklenmemişse)
      var s = st(), list = (res.alertsState || []).filter(function (a) { return a.triggeredAt; }); if (!s || !s.analysis || !s.analysis.alerts || !list.length) return;
      var changed = false; list.forEach(function (a) { var l = s.analysis.alerts.filter(function (x) { return x.id === a.id; })[0]; if (l && !l.triggeredAt) changed = true; }); if (!changed) return;
      X.quiet(function (state) { list.forEach(function (a) { var l = state.analysis.alerts.filter(function (x) { return x.id === a.id; })[0]; if (l && !l.triggeredAt) { l.triggeredAt = a.triggeredAt; l.firedPrice = a.firedPrice; l.firedSource = a.firedSource ? String(a.firedSource) + ' (arka plan)' : 'arka plan'; l.lastPrice = a.lastPrice; } }); });
    }
    function status() { // 'ok' | 'late' | 'error' | 'old' | 'mismatch' | 'none'
      var r = ui.res; if (!r) return ui.resErr && ui.resErr.code === 'kid' ? 'mismatch' : 'none';
      if (r.status === 'key_mismatch') return 'mismatch'; if (r.status === 'payload_old') return 'old'; if (r.status !== 'ok') return 'error';
      return Date.now() - Date.parse(r.generatedAt) > 100 * 60000 ? 'late' : 'ok';
    }

    /* ---------- Eylemler ---------- */
    function enable() {
      ui.busy = 'enable'; msg('Kurulum yapılıyor…');
      var tok = null, key = BG.newKey(), S = NT.cleanSettings(st().notifSettings), topic = S.ntfy && S.ntfy.topic && NT.TOPIC_RE.test(S.ntfy.topic) ? S.ntfy.topic : BG.newTopic();
      return Promise.resolve().then(function () { cfg = cfg || { on: false }; if (ui.tokenDraft.trim()) cfg.token = ui.tokenDraft.trim(); return token(); }).then(function (t) {
        if (!t) throw new Error('Önce GitHub erişim anahtarını gir (aşağıdaki 1. adım).'); tok = t; return gist(tok).user().catch(function (e) { if (cfg.token) { cfg.token = null; } throw e; });
      }).then(function () { return BG.kidOf(key); }).then(function (kid) {
        var c2 = { on: true, key: BG.b64u(key), kid: kid, topic: topic, pushMode: (cfg && cfg.pushMode) || 'detail', token: cfg.token || null, createdAt: Date.now() }; cfg = c2;
        return sealPayload(key, kid).then(function (s) { return gist(tok).create(s.text).then(function (id) { cfg.gist = id; cfg.uploadedAt = Date.now(); cfg.sig = s.sig; return saveCfg(); }); });
      }).then(function () { if (!S.ntfy.topic) X.quiet(function (s) { var N2 = NT.cleanSettings(s.notifSettings); N2.ntfy.topic = topic; N2.ntfy.on = true; s.notifSettings = N2; }); ui.busy = ''; ui.reveal = false; ui.tokenDraft = ''; msg('Şifreli yedek yüklendi ✓ Şimdi aşağıdaki 2. adımı yap.', 'ok'); setTimers(); },
        function (e) { ui.busy = ''; if (cfg && !cfg.gist) cfg = { on: false, token: cfg.token || null }; msg('Kurulum yapılamadı: ' + e.message, 'err'); });
    }
    function setupString() { return BG.makeSetup({ key: keyOf(), gist: cfg.gist, topic: cfg.topic }); }
    function copy(text, okMsg) {
      var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('panoya erişilemedi'));
      return p.then(function () { X.toast(okMsg || 'Kopyalandı'); return true; }, function () { X.toast('Otomatik kopyalanamadı; metni seçip elle kopyala.'); return false; });
    }
    function sendTestPush() {
      if (!cfg || !cfg.topic) return Promise.resolve({ ok: false, text: 'Konu adı yok' });
      return fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: cfg.topic, title: 'Finans Pusulası — kurulum testi', message: 'Telefona bildirim çalışıyor (bu test tarayıcından gönderildi). Arka plan portföy uyarıları bu konuya gelecek.', priority: 3, tags: ['white_check_mark'] }) })
        .then(function (r) { return { ok: r.ok, text: r.ok ? 'Gönderildi — ntfy uygulamasında abone isen birkaç saniyede gelir.' : 'ntfy HTTP ' + r.status }; }, function (e) { return { ok: false, text: 'Gönderilemedi: ' + e.message }; });
    }
    function runCheck() {
      ui.busy = 'check'; ui.check = []; X.render(); var rows = ui.check;
      function add(ok, text, hint) { rows.push({ ok: ok, text: text, hint: hint || '' }); X.render(); }
      return Promise.resolve().then(function () { // 1) şifreleme
        return BG.seal(keyOf(), { t: 1 }, cfg.kid).then(function (e) { return BG.open(keyOf(), e); }).then(function (o) { add(o && o.t === 1, 'Şifreleme bu cihazda çalışıyor (AES-256-GCM).'); }, function (e) { add(false, 'Şifreleme hatası: ' + e.message); });
      }).then(function () { // 2) gizli Gist
        return token().then(function (tok) {
          if (!tok) return add(false, 'GitHub erişim anahtarı yok', 'Kurulum adımında anahtarı yeniden gir.');
          return gist(tok).read(cfg.gist).then(function (c) {
            if (!c) return add(false, 'Gizli Gist’te şifreli yedek bulunamadı', 'Anahtarı yenile veya kurulumu yeniden yap.');
            return BG.open(keyOf(), JSON.parse(c)).then(function (p) { add(true, 'Gizli Gist’te şifreli yedek var ve bu cihazın anahtarıyla açılıyor (son yükleme: ' + tsi(Date.parse(p.at)) + (p.isExample ? ', örnek veri' : '') + ').'); }, function () { add(false, 'Gist’teki yedek bu anahtarla açılmıyor', 'Anahtarı yenile.'); });
          }, function (e) { add(false, 'Gist okunamadı: ' + e.message); });
        });
      }).then(function () { return sendTestPush().then(function (r) { add(r.ok, 'Telefona test bildirimi: ' + r.text, r.ok ? '' : 'ntfy konu adını ve internetini kontrol et.'); }); })
        .then(function () { return pull(true); }).then(function () {
          var s = status(), r = ui.res;
          if (s === 'none') add(null, 'Arka plan henüz sonuç yazmadı.', 'GitHub sırrı PORTFOLIO_KEY’i 2. adımdaki gibi eklediğinden emin ol; hemen çalıştırmak için “Run workflow” sayfasını kullan (en geç ~20 dk içinde kendiliğinden de çalışır).');
          else if (s === 'mismatch') add(false, 'GitHub’daki PORTFOLIO_KEY bu cihazdaki anahtarla aynı değil.', '2. adımdaki dizgeyi yeniden kopyalayıp sırrı güncelle (Update secret).');
          else if (ui.resErr && ui.resErr.code === 'badkey') add(false, 'Sonuç dosyası bu anahtarla açılmadı.', 'Anahtarı yenile ve sırrı güncelle.');
          else if (ui.resErr && ui.resErr.code === 'net') add(false, 'Sonuç dosyası alınamadı: ' + ui.resErr.text);
          else if (r) { add(s === 'ok' || s === 'late', 'Arka plan çalışıyor: son kontrol ' + tsi(Date.parse(r.generatedAt)) + ' (' + rel(Date.parse(r.generatedAt)) + ')' + (r.isExample ? ' — örnek veriyle' : '') + (s === 'error' ? ' — hata: ' + ((r.errors || [])[0] || '') : ''), s === 'late' ? 'Son çalışma beklenenden eski; GitHub Actions gecikmiş olabilir.' : ''); if (cfg.testId) add(!!(r.testAck && r.testAck.id === cfg.testId), r.testAck && r.testAck.id === cfg.testId ? 'Uçtan uca doğrulandı: Actions telefona test bildirimi gönderdi ✓' : 'Uçtan uca test bildirimi henüz gönderilmedi (sonraki çalışmayı bekle).'); }
          ui.busy = ''; X.render();
        }).catch(function (e) { add(false, 'Kontrol hatası: ' + e.message); ui.busy = ''; X.render(); });
    }
    function e2eTest() {
      ui.busy = 'e2e'; msg('Test isteği yükleniyor…'); var id = 't' + Date.now().toString(36); cfg.testId = id;
      return saveCfg().then(function () { return upload('manual', { id: id, at: Date.now() }); }).then(function () {
        ui.busy = ''; ui.waiting = true; msg('Test isteği yüklendi ✓ Arka plan en geç ~20 dk içinde çalışıp telefona “zincir çalışıyor” bildirimi gönderir. Bu sayfa açıkken sonucu kendisi kontrol eder; hemen çalıştırmak için “Run workflow” sayfasını aç.', 'ok'); clearInterval(timers.wait);
        timers.wait = setInterval(function () { pull().then(function (r) { if (r && r.testAck && r.testAck.id === id) { clearInterval(timers.wait); ui.waiting = false; msg('Uçtan uca doğrulandı ✓ Actions telefona test bildirimi gönderdi.', 'ok'); } }); }, 45000);
      }, function (e) { ui.busy = ''; msg('Yüklenemedi: ' + e.message, 'err'); });
    }
    function rotate() {
      if (!window.confirm('Anahtar yenilensin mi? Eski anahtar geçersiz olur; GitHub’daki PORTFOLIO_KEY sırrını yeni değerle güncellemen gerekir (güncelleyene kadar arka plan izleme durur).')) return;
      ui.busy = 'rotate'; msg('Yeni anahtar üretiliyor…'); var key = BG.newKey();
      BG.kidOf(key).then(function (kid) { return token().then(function (tok) { if (!tok) throw new Error('GitHub erişim anahtarı yok'); var old = { key: cfg.key, kid: cfg.kid }; cfg.key = BG.b64u(key); cfg.kid = kid; return sealPayload(key, kid).then(function (s) { return gist(tok).update(cfg.gist, s.text).then(function () { cfg.uploadedAt = Date.now(); cfg.sig = s.sig; cfg.testId = null; return saveCfg(); }, function (e) { cfg.key = old.key; cfg.kid = old.kid; throw e; }); }); }); })
        .then(function () { ui.res = null; ui.resErr = { code: 'none' }; window.Store.setSecret('bgwatch-res', null); resCache = null; ui.reveal = false; ui.busy = ''; ui.rotated = true; msg('Yeni anahtar hazır ✓ Şimdi GitHub’da PORTFOLIO_KEY sırrını aşağıdaki yeni değerle güncelle.', 'ok'); }, function (e) { ui.busy = ''; msg('Anahtar yenilenemedi: ' + e.message, 'err'); });
    }
    function disable(localOnly) {
      ui.busy = 'off'; msg('Kapatılıyor…');
      return Promise.resolve().then(function () { if (localOnly || !cfg.gist) return; return token().then(function (tok) { if (!tok) throw new Error('GitHub erişim anahtarı yok; Gist’i silemedim'); return gist(tok).remove(cfg.gist).catch(function (e) { if (e.status === 404) return; throw e; }); }); })
        .then(function () { var gid = cfg.gist; cfg = { on: false }; ui.res = null; ui.resErr = null; ui.check = null; ui.reveal = false; ui.confirmOff = false; resCache = null; clearInterval(timers.wait); return Promise.all([saveCfg(), window.Store.setSecret('bgwatch-res', null)]).then(function () { ui.busy = ''; ui.offDone = { local: !!localOnly, gist: gid }; msg(localOnly ? 'Bu cihazda kapatıldı. Gist’i elle sil (aşağıdaki bağlantı).' : 'Kapatıldı: gizli Gist silindi, anahtar bu cihazdan kaldırıldı. Arka plan bir sonraki çalışmada Gist’in yok olduğunu görüp şifreli sonuç dosyasını da siler.', 'ok'); }); })
        .catch(function (e) { ui.busy = ''; msg('Kapatılamadı: ' + e.message + ' — “Yalnız bu cihazda kapat” ile devam edip Gist’i gist.github.com’dan elle silebilirsin.', 'err'); });
    }
    function setPush(mode) { cfg.pushMode = mode === 'generic' ? 'generic' : 'detail'; saveCfg().then(function () { return upload('manual'); }).then(function () { X.toast('Kaydedildi'); X.render(); }, function (e) { msg('Kaydedildi ama yüklenemedi: ' + e.message, 'err'); }); }
    function setTimers() {
      if (started) return; started = true;
      setTimeout(function () { if (cfg && cfg.on) { tick(); pull(); } }, 6000);
      timers.push = setInterval(tick, 60000); timers.pull = setInterval(function () { if (cfg && cfg.on && !document.hidden) pull(); }, 10 * 60000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden && cfg && cfg.on) { tick(); if (Date.now() - ui.resAt > 5 * 60000) pull(); } });
    }

    /* ---------- Görünüm ---------- */
    function pill(s) { var M = { ok: ['ok', 'Çalışıyor'], late: ['warn', 'Gecikmiş'], error: ['neg', 'Hata'], old: ['warn', 'Veri eski'], mismatch: ['neg', 'Anahtar uyuşmuyor'], none: ['muted', 'Henüz sonuç yok'] }[s] || ['muted', s]; return '<span class="bgw-pill ' + M[0] + '">' + esc(M[1]) + '</span>'; }
    function banner() {
      var h = ''; if (ui.msg) h += '<p class="bgw-msg ' + esc(ui.kind) + '" role="status">' + esc(ui.msg) + '</p>';
      if (isExample()) h += '<div class="notice warn bgw-ex" role="note"><b>Örnek veri gösteriliyor.</b> Arka plan, örnek portföyünü şifreleyip sistemi dener; bu verilerle <b>gerçek bildirim gönderilmez</b> (yalnız kurulum testi). Kendi verini girdiğinde sistem otomatik olarak gerçek izlemeye geçer.</div>';
      return h;
    }
    function intro() {
      return '<section class="card"><h2>Arka planda portföyümü de izle <span class="bgw-pill muted">isteğe bağlı</span></h2>' +
        '<p>Site kapalıyken de portföyüne özel kontroller çalışsın: <b>portföy sağlık skoru, seviye/stop alarmları, ellerindeki varlıkların analiz değişimi, portföyünle ilgili haber/olaylar, duygu durumu, yaklaşan ödemeler (kira, fatura, kart son ödeme günü)</b>. Önemli bir şey olunca telefonuna bildirim gelir. Uygulamayı açtığında da son sonuçları burada görürsün.</p>' +
        '<ul class="bgw-list"><li><b>Gizli kalır:</b> veriler bu cihazda <b>şifrelenir</b> (AES-256-GCM, rastgele 256 bit anahtar) ve yalnız şifreli hâliyle <b>gizli</b> bir GitHub Gist’ine yüklenir. Anahtar yalnız bu cihazda ve senin GitHub Actions sırrında durur; depoda, kodda ya da herkese açık dosyada <b>asla</b> yoktur.</li>' +
        '<li><b>Sonuçlar da şifreli:</b> arka plan sonucu aynı anahtarla şifreleyip yazar; yalnız bu uygulama cihazında açar. Actions günlüklerine yalnız sayılar yazılır (varlık adı, tutar yok).</li>' +
        '<li><b>Telefona giden bildirim</b> ntfy.sh üzerinden geçer: ntfy sunucusu mesaj metnini görebilir. Bu yüzden tutarlar her zaman silinir; istersen “genel” kipte yalnız “Kritik portföy uyarısı” yazar (aşağıda).</li>' +
        '<li><b>Satış emri değildir:</b> bildirimler yalnız taze analizin gösterdiği zayıflık/yorulmayı ve seviye temaslarını bildirir; karar sende.</li></ul></section>';
    }
    function stepHtml(n, title, done, body) { return '<li class="bgw-step' + (done ? ' done' : '') + '"><div class="bgw-n" aria-hidden="true">' + (done ? '✓' : n) + '</div><div class="bgw-b"><h3>' + esc(title) + (done ? ' <span class="sr-only">(tamamlandı)</span>' : '') + '</h3>' + body + '</div></li>'; }
    function wizardOff() {
      var hasTok = ui.hasTok; var b = ui.busy === 'enable';
      return '<section class="card"><h2>Kurulum</h2><ol class="bgw-steps">' +
        stepHtml(1, 'GitHub erişim anahtarı (yalnız Gist için)', hasTok, hasTok ? '<p class="muted">Eşitleme anahtarın bulundu; aynısı kullanılacak. Anahtar bu cihazdan çıkmaz.</p>' :
          '<p>Şifreli yedeğin yükleneceği <b>gizli Gist</b> için “gist” izinli bir anahtar gerekir (başka izin verme). <a href="' + esc(URLS.token) + '" target="_blank" rel="noopener noreferrer">Anahtarı oluştur ↗</a> (sayfada <b>Generate token</b>’a bas, kopyala). Güvenlik sekmesinde bulut eşitlemeyi kurduysan bu adım otomatik atlanır.</p>' +
          '<div class="row"><input type="password" id="bgw-tok" autocomplete="off" spellcheck="false" placeholder="ghp_… veya github_pat_…" value="' + esc(ui.tokenDraft) + '" aria-label="GitHub erişim anahtarı"></div>') +
        stepHtml(2, 'Kur', false, '<p>Düğmeye bastığında cihazında rastgele bir anahtar ve ntfy konu adı üretilir, portföy verin şifrelenip gizli Gist’e yüklenir.</p><button class="btn primary" data-bg="enable" type="button"' + (b ? ' disabled' : '') + '>' + (b ? 'Kuruluyor…' : 'Kurulumu başlat') + '</button>') +
        '</ol></section>';
    }
    function wizardOn() {
      var ss = ''; try { ss = setupString(); } catch (e) { ss = ''; }
      var s = status(), chain = !!(ui.res && ui.res.testAck && cfg.testId && ui.res.testAck.id === cfg.testId), running = s === 'ok' || s === 'late' || s === 'error' || s === 'old';
      var secret = '<p>GitHub’da bir kez, bu değeri <b>sır</b> olarak ekle:</p><ol class="bgw-sub"><li><a class="btn small primary" href="' + esc(URLS.secretNew) + '" target="_blank" rel="noopener noreferrer">GitHub’da sır oluştur ↗</a> sayfasını aç (“Name” alanı kendiliğinden gelmez; elle yaz).</li><li><b>Name</b>: <code>PORTFOLIO_KEY</code> <button class="btn small" data-bg="copyname" type="button">Adı kopyala</button></li><li><b>Secret</b>: aşağıdaki değeri kopyalayıp yapıştır → <b>Add secret</b>.</li></ol>' +
        '<div class="bgw-secret"><textarea id="bgw-ss" readonly rows="3" spellcheck="false" aria-label="PORTFOLIO_KEY değeri" class="' + (ui.reveal ? '' : 'masked') + '">' + esc(ui.reveal ? ss : '•'.repeat(48)) + '</textarea><div class="row"><button class="btn small" data-bg="reveal" type="button">' + (ui.reveal ? 'Gizle' : 'Göster') + '</button> <button class="btn small primary" data-bg="copyss" type="button">Kopyala</button></div></div>' +
        '<p class="hint">Bu değer anahtarın kendisidir: kimseyle paylaşma, ekran görüntüsü alma. Yalnız GitHub sırrına yapıştır.' + (ui.rotated ? ' <b>Anahtar yenilendi: mevcut sırrı aynı adla “Update” ile bu yeni değere güncelle.</b>' : '') + '</p>';
      var phone = '<p>Telefonuna <a href="' + esc(URLS.ntfyApp) + '" target="_blank" rel="noopener noreferrer">ntfy uygulamasını kur ↗</a> (ücretsiz; Android/iPhone), <b>+</b> ile aşağıdaki konuya abone ol. Konu adı bir şifre gibidir: bilen herkes bildirimleri okuyabilir; paylaşma.</p><div class="row"><code class="bgw-topic">' + esc(cfg.topic) + '</code> <button class="btn small" data-bg="copytopic" type="button">Kopyala</button> <a class="btn small" href="https://ntfy.sh/' + esc(cfg.topic) + '" target="_blank" rel="noopener noreferrer">Tarayıcıda aç ↗</a> <button class="btn small" data-bg="testpush" type="button">Test bildirimi gönder</button></div>';
      var ver = '<div class="row"><button class="btn primary" data-bg="check" type="button"' + (ui.busy === 'check' ? ' disabled' : '') + '>' + (ui.busy === 'check' ? 'Kontrol ediliyor…' : 'Durumu kontrol et') + '</button> <button class="btn" data-bg="e2e" type="button"' + (ui.busy === 'e2e' ? ' disabled' : '') + ' title="Actions’ın telefona gerçekten bildirim gönderdiğini doğrular">Uçtan uca test başlat</button> <a class="btn small" href="' + esc(URLS.run) + '" target="_blank" rel="noopener noreferrer">“Run workflow” sayfası ↗</a></div>' +
        (ui.check ? '<ul class="bgw-check" aria-live="polite">' + ui.check.map(function (r) { return '<li class="' + (r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'wait') + '"><b aria-hidden="true">' + (r.ok === true ? '✓' : r.ok === false ? '✗' : '…') + '</b> ' + esc(r.text) + (r.hint ? '<small>' + esc(r.hint) + '</small>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="hint">Kontrol: şifreleme, gizli Gist, telefona test bildirimi ve arka plan sonucu. Arka plan sonuç yazdıysa zincirin tamamı çalışıyor demektir.</p>');
      var warnH = s === 'mismatch' ? '<div class="notice danger" role="alert"><b>Anahtar uyuşmuyor.</b> GitHub’daki <code>PORTFOLIO_KEY</code> sırrı bu cihazdaki anahtarla aynı değil: 2. adımdaki değeri kopyalayıp sırrı “Update secret” ile güncelle. Sonra <button class="btn small" data-bg="pull" type="button">Sonucu yeniden kontrol et</button></div>' : ui.resErr && ui.resErr.code === 'badkey' ? '<div class="notice danger" role="alert">Sonuç dosyası bu cihazın anahtarıyla açılamadı. Anahtarı yenile ve sırrı güncelle.</div>' : '';
      return '<section class="card"><h2>Kurulum adımları ' + pill(s) + '</h2>' + warnH + '<ol class="bgw-steps">' +
        stepHtml(1, 'Şifreli yedek gizli Gist’te', true, '<p class="muted">Son yükleme: ' + esc(cfg.uploadedAt ? tsi(cfg.uploadedAt) + ' (' + rel(cfg.uploadedAt) + ')' : '—') + '. Verin değiştikçe otomatik güncellenir (uygulama açıkken).' + (cfg.upErr ? ' <b class="neg">Son yükleme hatası: ' + esc(cfg.upErr) + '</b>' : '') + '</p>') +
        stepHtml(2, 'GitHub sırrı PORTFOLIO_KEY', running || chain || ui.res != null, secret) +
        stepHtml(3, 'Telefon: ntfy aboneliği', chain, phone) +
        stepHtml(4, 'Doğrula', chain, ver) + '</ol></section>';
    }
    function resultsCard() {
      var r = ui.res, s = status(); if (!r) return '';
      var posBy = {}; (r.positions || []).forEach(function (p) { posBy[p.key] = p; });
      var items = (r.items || []).slice(0, 8), an = r.analysis || {}, keys = Object.keys(an).filter(function (k) { return posBy[k]; }).sort(function (a, b) { return (posBy[b].share || 0) - (posBy[a].share || 0); }).slice(0, 10);
      var h = '<section class="card bgw-res"><div class="bgw-top"><div><h2>Arka plan son kontrol ' + pill(s) + '</h2><p class="muted"><b>' + esc(tsi(Date.parse(r.generatedAt))) + '</b> · ' + esc(rel(Date.parse(r.generatedAt))) + ' · cihazdaki veri: ' + esc(r.payloadAt ? tsi(Date.parse(r.payloadAt)) : '—') + '</p></div><button class="btn small" data-bg="pull" type="button">Yenile</button></div>';
      if (r.isExample) h += '<div class="notice warn bgw-ex"><b>Örnek veri.</b> Bu sonuçlar örnek portföyden üretildi; gerçek portföyünü yansıtmaz ve bildirim gönderilmedi.</div>';
      if (s === 'late') h += '<div class="notice warn">Son çalışma beklenenden eski (zamanlama ≈20 dk). GitHub Actions gecikmiş olabilir; sorun sürerse Actions sayfasına bak.</div>';
      if (s === 'old') h += '<div class="notice warn">Arka plan yalnız eski bir yedek gördü: uygulamayı bir kez aç (yeni veri yüklenir).</div>';
      if (s === 'error') h += '<div class="notice danger">Arka plan hata verdi: ' + esc((r.errors || [])[0] || 'bilinmiyor') + '</div>';
      if (s === 'mismatch') return h + '<div class="notice danger">GitHub’daki <code>PORTFOLIO_KEY</code> bu cihazdaki anahtarla aynı değil. Kurulum 2. adımdaki değeri sırra yeniden yapıştır.</div></section>';
      if (r.status === 'ok') {
        h += '<div class="bgw-kpis"><div><span>Sağlık skoru</span><b>' + (r.health ? r.health.total + '/100' : '—') + '</b><small>' + esc(r.health ? r.health.grade : '') + '</small></div><div><span>Net değer</span><b>' + (r.netWorth != null ? esc(X.tl(r.netWorth)) : '—') + '</b></div><div><span>Seviye alarmı</span><b>' + esc(r.alertsChecked ? r.alertsChecked.total + ' aktif' : '—') + '</b><small>' + (r.alertsFired && r.alertsFired.length ? r.alertsFired.length + ' tetiklendi' : 'tetiklenen yok') + '</small></div><div><span>Portföyünle ilgili haber</span><b>' + (r.news ? r.news.mine : '—') + '</b><small>' + (r.news ? r.news.total + ' haber tarandı' : '') + '</small></div><div><span>Duygu durumu</span><b>' + esc(r.mood ? r.mood.label : '—') + '</b></div></div>';
        if (r.health && r.health.fixes && r.health.fixes.length) h += '<details><summary>Sağlık skorunu iyileştirecekler (' + r.health.fixes.length + ')</summary><ul>' + r.health.fixes.map(function (f) { return '<li>' + esc(f.text) + '</li>'; }).join('') + '</ul></details>';
        h += '<h3>Uyarılar (' + (r.items || []).length + ')</h3>' + (items.length ? '<ul class="bgw-items">' + items.map(function (it) { return '<li class="' + (SEVC[it.sev] || '') + '">' + sevPill(it.sev) + ' <b>' + esc(it.title) + '</b><p>' + esc(it.body) + '</p>' + (it.href ? '<a class="btn small" href="' + esc(it.href) + '">Aç</a>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">Şu an aktif portföy uyarısı yok.</p>');
        if (r.reminders && r.reminders.length) h += '<details><summary>Yaklaşan ödemeler (' + r.reminders.length + ') — arka planda da hatırlatılır</summary><ul class="bgw-rem">' + r.reminders.map(function (x) { var d = x.daysLeft, lab = x.level === 'overdue' ? 'gecikti (' + (-d) + ' gün)' : x.level === 'today' ? 'bugün' : d + ' gün sonra'; return '<li class="' + esc(x.level) + '"><b>' + esc(x.title) + '</b> · ' + esc(x.date.slice(8, 10) + '.' + x.date.slice(5, 7) + '.' + x.date.slice(0, 4)) + ' · ' + esc(lab) + (x.amount ? ' · ' + esc(X.tl(x.amount)) : '') + '</li>'; }).join('') + '</ul></details>';
        if (keys.length) h += '<details open><summary>Elindeki varlıkların son analizi (arka planda taze)</summary><div class="tablewrap"><table class="tbl"><thead><tr><th>Varlık</th><th>Pay</th><th>Skor</th><th>Görünüm</th><th>Elde tutma</th></tr></thead><tbody>' + keys.map(function (k) { var a = an[k], p = posBy[k]; return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.share != null ? String(p.share).replace('.', ',') + '%' : '—') + '</td><td>' + esc(a.total) + '</td><td>' + esc(STANCE[a.stance] || a.stance || '—') + '</td><td>' + esc(HOLD[a.hold] || '—') + '</td></tr>'; }).join('') + '</tbody></table></div><p class="hint">Analizler halka açık piyasa verisinden aynı analiz motoruyla üretilir; “azaltmayı gözden geçir” yalnız taze analiz dirençte yorulma gösterirse çıkar ve satış emri değildir.</p></details>';
        if (r.news && r.news.top && r.news.top.length) h += '<details><summary>Portföyünle ilgili öne çıkan haberler (' + r.news.top.length + ')</summary><ul>' + r.news.top.map(function (n) { return '<li>' + (/^https?:\/\//.test(n.u || '') ? '<a href="' + esc(n.u) + '" target="_blank" rel="noopener noreferrer">' + esc(n.t) + ' ↗</a>' : esc(n.t)) + ' <small class="muted">' + esc(n.s || '') + '</small></li>'; }).join('') + '</ul></details>';
        h += '<p class="hint">Telefona gönderilen: ' + esc(r.ntfy ? r.ntfy.sent + ' bildirim' + (r.ntfy.failed ? ', ' + r.ntfy.failed + ' gönderilemedi (yeniden denenecek)' : '') + (r.ntfy.skippedExample ? ' (örnek veri: gönderilmez)' : '') : '—') + ' · Kontrol sıklığı ≈20 dk.</p>';
      }
      return h + '</section>';
    }
    function settingsCard() {
      var pm = cfg.pushMode === 'generic' ? 'generic' : 'detail';
      return '<section class="card"><h2>Ayarlar ve gizlilik</h2><fieldset class="bgw-fs"><legend>Telefon bildirimi içeriği</legend><label class="chk"><input type="radio" name="bgw-pm" data-bg="pm" value="detail"' + (pm === 'detail' ? ' checked' : '') + '> <span><b>Ayrıntılı</b> (önerilen): varlık adı ve gerekçe; <b>TL tutarları silinir</b>.</span></label><label class="chk"><input type="radio" name="bgw-pm" data-bg="pm" value="generic"' + (pm === 'generic' ? ' checked' : '') + '> <span><b>Genel</b>: yalnız “Portföy uyarısı: Kritik”; ayrıntı yalnız uygulamada. ntfy sunucusu hiçbir varlık adı görmez.</span></label></fieldset>' +
        '<p class="hint">Hangi kategori/önem derecesinin bildirileceği ve sessiz saatler <a href="#haberler/ayar">Bildirim ayarları</a>’ndan gelir; arka plan aynı ayarları kullanır.</p>' +
        '<div class="row"><button class="btn" data-bg="rotate" type="button"' + (ui.busy ? ' disabled' : '') + '>Anahtarı yenile</button> ' + (ui.confirmOff ? '<span class="bgw-warn">Gizli Gist silinecek, anahtar bu cihazdan kalkacak. Emin misin?</span> <button class="btn danger" data-bg="off" type="button">Evet, kapat ve sil</button> <button class="btn small" data-bg="offlocal" type="button" title="Gist’i elle sileceksen">Yalnız bu cihazda kapat</button> <button class="btn small" data-bg="offcancel" type="button">Vazgeç</button>' : '<button class="btn danger" data-bg="offask" type="button"' + (ui.busy ? ' disabled' : '') + '>Kapat ve uzaktaki şifreli veriyi sil</button>') + '</div>' +
        '<details><summary>Tehdit modeli (kısa)</summary><ul class="bgw-list"><li>Depo herkese açıktır; orada yalnız <b>şifreli</b> sonuç dosyası vardır (boyutu 16 KiB kademeleriyle gizlenir). Zaman damgası ve “bir kullanıcı bu özelliği kullanıyor” bilgisi görünür.</li><li>Gizli Gist: GitHub şifreli metni barındırır; anahtar olmadan okunamaz. Gist adresini bilen biri yalnız şifreli metni görür.</li><li>Anahtar yalnız cihazında ve GitHub Actions sırrında durur. Actions günlükleri herkese açıktır: sırlar maskelenir ve günlüğe yalnız sayılar yazılır.</li><li>ntfy.sh mesaj metnini görür (tutarlar silinir; “genel” kip hiçbir ad göstermez). Konu adın bir şifre gibidir.</li><li>Anahtarı yenilersen eski şifreli veriler okunamaz hâle gelir. Kapatınca Gist silinir; arka plan sonuç dosyasını da siler.</li></ul></details>' +
        (cfg.gist ? '<p class="hint">Gist numarası: <code>' + esc(cfg.gist.slice(0, 6)) + '…</code> · <a href="' + esc(URLS.secrets) + '" target="_blank" rel="noopener noreferrer">GitHub sırları ↗</a> (kapattıktan sonra <code>PORTFOLIO_KEY</code> sırrını da silmeni öneririz).</p>' : '') + '</section>';
    }
    function offDone() {
      if (!ui.offDone) return '';
      return '<section class="card"><h2>Kapatıldı</h2><p>Son bir adım: GitHub’da kullanılmayan sırrı sil — <a href="' + esc(URLS.secrets) + '" target="_blank" rel="noopener noreferrer">sırlar sayfası ↗</a> → <code>PORTFOLIO_KEY</code> → Delete.' + (ui.offDone.local ? ' Gist’i de <a href="' + esc(URLS.gists) + '" target="_blank" rel="noopener noreferrer">gist.github.com ↗</a> adresinden “Finans Pusulası — arka plan portföy izleme” açıklamalı kaydı sil.' : '') + '</p></section>';
    }
    function render() {
      if (!cfg) { if (cfgErr) return '<section class="card"><div class="notice warn">' + esc(cfgErr) + '</div></section>'; loadCfg(); return '<section class="card"><p class="muted">Yükleniyor…</p></section>'; }
      if (ui.hasTok == null) { ui.hasTok = false; syncToken().then(function (t) { ui.hasTok = !!(t || cfg.token); X.render(); }); }
      if (cfg.on && !started) setTimers();
      var h = banner() + intro();
      if (!cfg.on) return h + offDone() + wizardOff();
      return h + wizardOn() + inboxCard() + resultsCard() + settingsCard();
    }
    function homeLine() { // Ana sayfa/Bildirimler için tek satır
      if (!cfg || !cfg.on) return ''; var r = ui.res; if (!r) return '<p class="hint bgw-line">Arka plan portföy izleme: henüz sonuç yok · <a href="#haberler/arka">kurulumu tamamla</a></p>';
      return '<p class="hint bgw-line">Arka plan son kontrol: <b>' + esc(tsi(Date.parse(r.generatedAt))) + '</b> (' + esc(rel(Date.parse(r.generatedAt))) + ') ' + pill(status()) + ' · <a href="#haberler/arka">ayrıntı</a></p>';
    }

    /* ---------- Olaylar ---------- */
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-bg]') : null; if (!el || el.type === 'radio') return; var a = el.dataset.bg;
      if (a === 'enable') { var t = document.getElementById('bgw-tok'); if (t) ui.tokenDraft = t.value; enable(); }
      else if (a === 'reveal') { ui.reveal = !ui.reveal; X.render(); }
      else if (a === 'copyss') { try { copy(setupString(), 'Kopyalandı — GitHub sırrına yapıştır'); } catch (err) { X.toast(err.message); } }
      else if (a === 'copyname') copy('PORTFOLIO_KEY', 'Ad kopyalandı');
      else if (a === 'copytopic') copy(cfg.topic, 'Konu adı kopyalandı');
      else if (a === 'testpush') { sendTestPush().then(function (r) { X.toast(r.text); }); }
      else if (a === 'check') runCheck();
      else if (a === 'e2e') e2eTest();
      else if (a === 'pull') { pull(true).then(function () { X.toast(ui.res ? 'Güncellendi' : 'Henüz sonuç yok'); }); }
      else if (a === 'rotate') rotate();
      else if (a === 'offask') { ui.confirmOff = true; X.render(); }
      else if (a === 'offcancel') { ui.confirmOff = false; X.render(); }
      else if (a === 'off') disable(false);
      else if (a === 'offlocal') disable(true);
    });
    document.addEventListener('change', function (e) { var el = e.target; if (el && el.dataset && el.dataset.bg === 'pm' && cfg) setPush(el.value); });
    document.addEventListener('input', function (e) { if (e.target && e.target.id === 'bgw-tok') ui.tokenDraft = e.target.value; });
    function start() { loadCfg().then(function () { if (cfg && cfg.on) { setTimers(); } }); }
    var api = { render: render, start: start, homeLine: homeLine, status: status, _ui: ui, _cfg: function () { return cfg; }, _pull: pull, _upload: upload, _tick: tick, _inbox: pullInbox, _applyEdit: applyEdit, recordExternal: function (rec) { return window.Store.getSecret('bgwatch-inbox').catch(function () { return null; }).then(function (r) { (r && Array.isArray(r.applied) ? r.applied : []).forEach(function (a) { if (a && !IB.seen(inbox.applied, a.id)) inbox.applied = IB.record(inbox.applied, a); }); return recordExternal(rec); }); }, _inboxState: function () { return inbox; } };
    window.BgUI.instance = api; // yalnız uçtan uca testler için
    return api;
  };
})();
