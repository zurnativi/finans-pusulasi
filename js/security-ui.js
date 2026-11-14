/* security-ui.js — Yedek güvenliği, anlık görüntüler, uçtan uca şifreli eşitleme ve uygulama kilidi arayüzü.
 * app.js tarafından window.SecurityUI(X) ile kurulur. Hesap/para mantığına dokunmaz; yalnızca veriyi korur ve taşır. */
(function () {
  'use strict';
  window.SecurityUI = function (X) {
    var CB = window.CryptoBox, LK = window.LockCore, SY = window.Sync, SM = window.SyncMerge, S = window.Sample, CH = window.Charts && window.Charts.available && window.Charts.available() ? window.Charts : null;
    var esc = X.esc, tip = X.tip;
    var META_KEY = 'finans-pusulasi:backup-meta', SNOOZE_KEY = 'finans-pusulasi:backup-snooze', FAILS_KEY = 'finans-pusulasi:lock-fails';
    var AUTO_SNAP_MS = 30 * 60000;
    var syncCfg = null, syncBusy = false, syncStatus = null, conflicts = [], keyCache = {}, wizard = null, syncTimer = null;
    var persistOk = null, estimate = null, snaps = [], lastSnapAt = 0, lockCfg = LK.loadCfg(), lastActivity = Date.now(), lockTimer = null, lockUi = null;

    /* ---------- küçük yardımcılar ---------- */
    function now() { return Date.now(); }
    function meta() { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function setMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* */ } }
    function daysSince(iso) { if (!iso) return null; var t = Date.parse(iso); if (!isFinite(t)) return null; return Math.max(0, Math.floor((now() - t) / 86400000)); }
    function fmtTime(ms) { if (!ms) return '—'; var d = new Date(ms); return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); }
    function ago(ms) {
      if (!ms) return 'hiç'; var s = Math.round((now() - ms) / 1000);
      if (s < 60) return 'az önce'; if (s < 3600) return Math.floor(s / 60) + ' dk önce'; if (s < 86400) return Math.floor(s / 3600) + ' saat önce'; return Math.floor(s / 86400) + ' gün önce';
    }
    function reminderDays() { var s = X.state(); var d = s && s.settings && s.settings.backupReminderDays; return d == null ? 7 : d; }
    function sizeTxt(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function countsTxt(c) { if (!c) return ''; return c.islem + ' işlem · ' + c.varlik + ' varlık · ' + c.alimSatim + ' alım-satım'; }
    function deviceName() { var ua = navigator.userAgent || ''; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Tarayıcı'; }
    function secureCtx() { return !!window.isSecureContext && /^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href); }

    /* ---------- Modal (parola sorma, onay) ---------- */
    function modal(o) {
      return new Promise(function (resolve) {
        var root = document.createElement('div'); root.className = 'modal-bg'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', o.title);
        var fields = (o.fields || []).map(function (f, i) { return '<div class="field"><label for="md-' + i + '">' + esc(f.label) + '</label><input id="md-' + i + '" type="' + (f.type || 'password') + '" autocomplete="' + (f.autocomplete || 'off') + '"' + (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + ' value=""></div>'; }).join('');
        root.innerHTML = '<form class="modal card"><h2>' + esc(o.title) + '</h2>' + (o.html || '<p>' + esc(o.text || '') + '</p>') + fields + '<p class="md-err neg" role="alert"></p><div class="row"><button class="btn primary" type="submit">' + esc(o.ok || 'Tamam') + '</button><button class="btn" type="button" data-md="cancel">' + esc(o.cancel || 'Vazgeç') + '</button></div></form>';
        document.body.appendChild(root);
        var form = root.querySelector('form'), inputs = root.querySelectorAll('input');
        if (inputs[0]) setTimeout(function () { inputs[0].focus(); }, 30);
        function close(v) { root.remove(); resolve(v); }
        root.querySelector('[data-md=cancel]').onclick = function () { close(null); };
        root.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(null); });
        form.onsubmit = function (e) {
          e.preventDefault(); var vals = Array.prototype.map.call(inputs, function (i) { return i.value; });
          var err = o.check ? o.check(vals) : null; if (err) { root.querySelector('.md-err').textContent = err; return; }
          close(o.fields && o.fields.length ? vals : true);
        };
      });
    }
    function askPassword(title, text, confirmTwice) {
      var f = [{ label: 'Parola' }]; if (confirmTwice) f.push({ label: 'Parola (tekrar)' });
      return modal({ title: title, text: text, fields: f, ok: 'Devam', check: function (v) { if (!v[0]) return 'Parola boş olamaz'; if (confirmTwice && v[0].length < 8) return 'En az 8 karakter'; if (confirmTwice && v[0] !== v[1]) return 'İki parola aynı değil'; return null; } }).then(function (v) { return v ? v[0] : null; });
    }

    /* ---------- Yedek ---------- */
    function backupCopy() { var copy = JSON.parse(JSON.stringify(X.state())); copy.exportedAt = new Date().toISOString(); copy.app = 'Finans Pusulası'; return copy; }
    function markBackup(kind) { var m = meta(); m.lastAt = new Date().toISOString(); m.kind = kind; setMeta(m); try { localStorage.removeItem(SNOOZE_KEY); } catch (e) { /* */ } }
    function exportPlain() { X.download('finans-yedek-' + X.today() + '.json', JSON.stringify(backupCopy(), null, 2)); markBackup('dosya'); X.toast('Yedek indirildi. Dosyayı güvenli bir yere (ör. kendi bulut klasörün) koy.'); X.render(); }
    function exportEncrypted() {
      askPassword('Şifreli yedek', 'Bu parolayla şifrelenir. Parolayı unutursan bu yedek açılamaz; bir yere not et.', true).then(function (pass) {
        if (!pass) return; X.busyToast('Şifreleniyor…');
        return CB.encryptJson(backupCopy(), pass, { meta: { app: 'Finans Pusulası', exportedAt: new Date().toISOString() } }).then(function (env) {
          X.download('finans-yedek-sifreli-' + X.today() + '.json', JSON.stringify(env)); markBackup('şifreli'); X.toast('Şifreli yedek indirildi.'); X.render();
        });
      }).catch(function (e) { X.toast('Şifreli yedek alınamadı: ' + e.message); });
    }
    /* Şifreli yedek dosyasını açar (geri yükleme için) */
    function decryptBackup(env) {
      return askPassword('Şifreli yedeği aç', 'Bu yedek parolayla şifrelenmiş. Yedeği alırken yazdığın parolayı gir.', false).then(function (pass) {
        if (!pass) throw new Error('Parola girilmedi');
        return CB.decryptJson(env, pass).catch(function () { throw new Error('Parola yanlış veya dosya bozuk'); });
      });
    }
    function backupDue() {
      var d = reminderDays(), s = X.state(); if (!d || !s || s.isExample) return null;
      var m = meta(), ds = daysSince(m.lastAt);
      if (ds != null && ds < d) return null;
      var sn = 0; try { sn = +localStorage.getItem(SNOOZE_KEY) || 0; } catch (e) { /* */ }
      if (sn > now()) return null;
      return { days: ds, limit: d };
    }
    function banner() {
      var due = backupDue(); if (!due) return '';
      return '<div class="banner backup" role="note"><span class="bk-ic" aria-hidden="true">💾</span><div class="grow"><b>' + (due.days == null ? 'Henüz hiç yedek almadın' : 'Son yedek ' + due.days + ' gün önce') + '</b> — Tarayıcı verisi silinirse bilgilerin gidebilir. Tek dokunuşla yedek indir.' +
        (syncCfg ? ' <span class="hint">(Buluttaki şifreli kopya ' + (syncStatus && syncStatus.okAt ? ago(syncStatus.okAt) : 'henüz yok') + ')</span>' : '') + '</div>' +
        '<button class="btn small primary" data-act="sec-export">Yedeği indir</button><button class="btn small" data-act="sec-snooze">Yarın hatırlat</button></div>';
    }

    /* ---------- Anlık görüntüler ---------- */
    function refreshSnaps() { return window.Store.listSnapshots().then(function (l) { snaps = l; lastSnapAt = l.length ? Date.parse(l[0].at) : 0; return l; }); }
    function snapshot(reason) { var s = X.state(); if (!s) return Promise.resolve(); return window.Store.addSnapshot(s, reason, SM.counts(s)).then(refreshSnaps).catch(function (e) { console.error(e); }); }
    function onSaved() {
      if (now() - lastSnapAt > AUTO_SNAP_MS) { lastSnapAt = now(); snapshot('Otomatik'); }
      scheduleSync(8000);
    }

    /* ---------- Eşitleme ---------- */
    function loadSecrets() {
      return Promise.all([window.Store.getSecret('sync'), window.Store.getSecret('sync-conflicts'), window.Store.getSecret('sync-status')]).then(function (r) {
        syncCfg = r[0] && r[0].token ? r[0] : null; conflicts = Array.isArray(r[1]) ? r[1] : []; syncStatus = r[2] || null;
      }).catch(function (e) { console.error(e); });
    }
    function saveCfg() { return window.Store.setSecret('sync', syncCfg); }
    function saveStatus() { return window.Store.setSecret('sync-status', syncStatus); }
    function scheduleSync(ms) { if (!syncCfg || syncCfg.auto === false) return; clearTimeout(syncTimer); syncTimer = setTimeout(function () { syncNow('auto', true); }, ms); }
    function client() { return (X.gistClient || SY.GistClient)(syncCfg.token); }
    function syncNow(mode, quiet) {
      if (!syncCfg) { if (!quiet) X.toast('Önce eşitlemeyi kur (Yedek ve güvenlik).'); return Promise.resolve(null); }
      if (syncBusy) return Promise.resolve(null);
      if (navigator.onLine === false) { syncStatus = Object.assign({}, syncStatus, { at: now(), ok: false, msg: 'İnternet yok; bağlanınca eşitlenecek' }); updateChip(); return Promise.resolve(null); }
      syncBusy = true; updateChip(); if (!quiet) X.render();
      var startMs = now(), before = JSON.stringify(X.state());
      return SY.run({ local: X.state(), cfg: syncCfg, client: client(), keyCache: keyCache, mode: mode || 'auto', startMs: startMs, validate: function (s) { return S.validateState(s); } }).then(function (res) {
        var p = Promise.resolve();
        if (res.state) {
          // eşitleme sırasında kullanıcı bir şey değiştirdiyse, o değişiklik kaybolmasın: bir sonraki turda yeniden birleşir
          if (JSON.stringify(X.state()) !== before) { syncBusy = false; scheduleSync(500); return null; }
          p = snapshot('Eşitleme öncesi (' + (res.action === 'pulled-replace' ? 'buluttaki veri alındı' : 'birleştirildi') + ')').then(function () { X.replaceState(res.state); });
        }
        return p.then(function () {
          syncCfg.gistId = res.gistId; syncCfg.lastSyncAt = res.lastSyncAt;
          if (res.conflicts && res.conflicts.length) { conflicts = res.conflicts.map(function (c) { c.at = now(); return c; }).concat(conflicts).slice(0, 200); window.Store.setSecret('sync-conflicts', conflicts); }
          var txt = { created: 'Bulutta şifreli kopya oluşturuldu', 'pushed-replace': 'Bu cihazdaki veri buluta yazıldı', 'pulled-replace': 'Buluttaki veri bu cihaza alındı', merged: res.state ? 'Diğer cihazdaki değişiklikler alındı' + (res.pushed ? ' ve bu cihazınkiler gönderildi' : '') : res.pushed ? 'Bu cihazdaki değişiklikler gönderildi' : 'Her şey zaten eşit' }[res.action] || 'Eşitlendi';
          syncStatus = { at: now(), okAt: now(), ok: true, msg: txt, conflicts: (res.conflicts || []).length, remoteDevice: res.remoteDevice || '' };
          return Promise.all([saveCfg(), saveStatus()]).then(function () {
            syncBusy = false; updateChip();
            if (!quiet || res.state || (res.conflicts && res.conflicts.length)) X.toast(txt + ((res.conflicts || []).length ? ' · ' + res.conflicts.length + ' çakışma var, Yedek ve güvenlik sayfasında gözden geçir.' : '.'));
            X.render(); return res;
          });
        });
      }).catch(function (e) {
        syncBusy = false; syncStatus = Object.assign({}, syncStatus, { at: now(), ok: false, msg: e.message, code: e.code || null }); saveStatus(); updateChip();
        if (!quiet || e.code === 'MERGE_INVALID') X.toast('Eşitlenemedi: ' + e.message); X.render(); return null;
      });
    }
    function chipHtml() {
      if (!syncCfg) return '';
      var cls = syncBusy ? 'busy' : syncStatus && !syncStatus.ok ? 'err' : conflicts.length ? 'warn' : 'ok';
      var txt = syncBusy ? 'Eşitleniyor…' : syncStatus && !syncStatus.ok ? 'Eşitlenemedi' : syncStatus && syncStatus.okAt ? 'Eşitlendi · ' + ago(syncStatus.okAt) : 'Eşitlenmedi';
      return '<button type="button" class="sync-chip ' + cls + '" data-act="sec-sync" title="Şimdi eşitle"><span class="sc-dot" aria-hidden="true">' + (syncBusy ? '<span class="spinner"></span>' : '☁') + '</span>' + esc(txt) + '</button>';
    }
    function updateChip() { var el = document.getElementById('sync-chip'); if (el) el.innerHTML = chipHtml(); }

    /* Kurulum sihirbazı */
    function wizardHtml() {
      var w = wizard, h = '<div class="wizard"><ol class="steps">' + ['Anahtar oluştur', 'Anahtarı yapıştır', 'Eşitleme parolası', 'Bağla'].map(function (t, i) { return '<li class="' + (w.step === i + 1 ? 'cur' : w.step > i + 1 ? 'done' : '') + '"><span>' + (w.step > i + 1 ? '✓' : i + 1) + '</span>' + t + '</li>'; }).join('') + '</ol>';
      if (w.step === 1) {
        h += '<p>Verilerin, <b>kendi GitHub hesabındaki gizli bir dosyada</b> şifreli durur. GitHub hesabın yoksa <a href="https://github.com/signup" target="_blank" rel="noopener">ücretsiz aç</a>. Sonra yalnızca "gist" izni olan bir anahtar oluştur:</p>' +
          '<ol class="howto"><li><a class="btn small primary" href="' + SY.TOKEN_URL_CLASSIC + '" target="_blank" rel="noopener">GitHub\'da anahtar sayfasını aç ↗</a> — sayfa "gist" izni seçili olarak açılır.</li>' +
          '<li><b>Note</b> kutusu dolu gelir. <b>Expiration</b> için "No expiration" (süresiz) veya en uzun süreyi seç.</li><li>Başka hiçbir kutuyu işaretleme; yalnızca <b>gist</b> seçili kalsın.</li><li>En alttaki yeşil <b>Generate token</b> düğmesine bas ve çıkan <code>ghp_…</code> ile başlayan anahtarı kopyala.</li></ol>' +
          '<details class="hint"><summary>İnce ayarlı (fine-grained) anahtar kullanmak istersen</summary><a href="' + SY.TOKEN_URL_FINE + '" target="_blank" rel="noopener">Bu sayfada</a> "Account permissions → Gists → Read and write" seç; depo (repository) erişimi verme. Anahtar <code>github_pat_…</code> ile başlar.</details>' +
          '<div class="row"><button class="btn primary" data-act="sec-wz-next">Anahtarı kopyaladım →</button><button class="btn" data-act="sec-wz-cancel">Vazgeç</button></div>';
      } else if (w.step === 2) {
        h += '<div class="field"><label for="wz-token">GitHub anahtarı</label><input id="wz-token" type="password" autocomplete="off" spellcheck="false" value="' + esc(w.token || '') + '" placeholder="ghp_… veya github_pat_…"></div>' +
          '<p class="hint">Anahtar yalnızca bu cihazda saklanır' + (lockCfg ? ' (uygulama kilidiyle şifreli)' : '') + '; yedek dosyasına ve buluta asla girmez. Yalnızca gist dosyalarına erişebilir, kodlarına veya diğer bilgilerine dokunamaz.</p>' +
          '<div class="row"><button class="btn primary" data-act="sec-wz-token"' + (w.busy ? ' disabled' : '') + '>' + (w.busy ? '<span class="spinner"></span> Deneniyor…' : 'Bağlantıyı dene →') + '</button><button class="btn" data-act="sec-wz-back">← Geri</button></div>';
      } else if (w.step === 3) {
        h += '<p>✓ GitHub bağlantısı tamam' + (w.login ? ': <b>' + esc(w.login) + '</b>' : '') + '.</p><p>Şimdi bir <b>eşitleme parolası</b> belirle. Veriler buluta gitmeden önce bu parolayla şifrelenir. <b>Diğer cihazlarda da aynı parolayı yazacaksın.</b></p>' +
          '<div class="grid two"><div class="field"><label for="wz-pass">Eşitleme parolası (en az 10 karakter)</label><input id="wz-pass" type="password" autocomplete="new-password" value=""></div><div class="field"><label for="wz-pass2">Parola (tekrar)</label><input id="wz-pass2" type="password" autocomplete="new-password" value=""></div></div>' +
          '<div class="notice warn">Bu parolayı unutursan buluttaki kopya açılamaz (bu cihazdaki verin etkilenmez). Bir kâğıda yaz ya da parola yöneticine kaydet.</div>' +
          '<div class="row"><button class="btn primary" data-act="sec-wz-pass">Devam →</button><button class="btn" data-act="sec-wz-back">← Geri</button></div>';
      } else if (w.step === 4) {
        h += '<p>Hazır. "Bağla ve eşitle"ye basınca:</p><ul class="howto"><li>Bulutta daha önce oluşturduğun dosya varsa bulunur ve parolanla açılır.</li><li>Bu cihazda yalnızca <b>örnek veri</b> varsa buluttaki gerçek verin buraya gelir (örnek veri karışmaz).</li><li>İki tarafta da gerçek veri varsa <b>birleştirilir</b>; hiçbir kayıt sessizce silinmez, çakışmalar sana gösterilir.</li><li>Öncesinde bu cihazdaki verinin bir kopyası (anlık görüntü) alınır.</li></ul>' +
          (w.err ? '<div class="notice danger">' + esc(w.err) + '</div>' : '') +
          '<div class="row"><button class="btn primary" data-act="sec-wz-connect"' + (w.busy ? ' disabled' : '') + '>' + (w.busy ? '<span class="spinner"></span> Bağlanıyor…' : 'Bağla ve eşitle') + '</button><button class="btn" data-act="sec-wz-back">← Geri</button></div>';
      }
      return h + '</div>';
    }
    function wizardToken() {
      var v = (document.getElementById('wz-token') || {}).value; v = (v || '').trim();
      if (!/^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,})$/.test(v)) return X.toast('Bu bir GitHub anahtarına benzemiyor. ghp_ veya github_pat_ ile başlamalı.');
      wizard.token = v; wizard.busy = true; X.render();
      var c;
      Promise.resolve().then(function () { c = (X.gistClient || SY.GistClient)(v); return c.user(); }).then(function (u) { wizard.login = u.login; return c.find(); }).then(function (id) { wizard.gistId = id; wizard.busy = false; wizard.step = 3; X.render(); }, function (e) { wizard.busy = false; X.render(); X.toast(e.message); });
    }
    function wizardPass() {
      var a = document.getElementById('wz-pass').value, b = document.getElementById('wz-pass2').value;
      if (a.length < 10) return X.toast('Eşitleme parolası en az 10 karakter olmalı');
      if (a !== b) return X.toast('İki parola aynı değil');
      wizard.pass = a; wizard.step = 4; wizard.err = null; X.render();
    }
    function wizardConnect() {
      wizard.busy = true; wizard.err = null; X.render();
      var prev = syncCfg;
      syncCfg = { provider: 'gist', token: wizard.token, pass: wizard.pass, gistId: wizard.gistId || null, lastSyncAt: 0, auto: true, device: deviceName(), login: wizard.login || '', since: new Date().toISOString() };
      keyCache = {};
      snapshot('Eşitleme kurulumu öncesi').then(function () { return syncNow('auto', true); }).then(function (res) {
        if (!res) { wizard.busy = false; wizard.err = (syncStatus && syncStatus.msg) || 'Bağlanılamadı'; syncCfg = prev; X.render(); return; }
        wizard = null; X.toast('Eşitleme kuruldu ✓ ' + (syncStatus ? syncStatus.msg : '')); X.render();
      });
    }

    /* ---------- Uygulama kilidi ---------- */
    function fails() { try { return JSON.parse(localStorage.getItem(FAILS_KEY) || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } }
    function setFails(f) { try { localStorage.setItem(FAILS_KEY, JSON.stringify(f)); } catch (e) { /* */ } }
    function bioAvailable() {
      if (!window.PublicKeyCredential || !secureCtx() || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return Promise.resolve(false);
      return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; });
    }
    function prfGet(bio) {
      return navigator.credentials.get({ publicKey: { challenge: CB.rand(32), allowCredentials: [{ type: 'public-key', id: CB.unb64(bio.credId) }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: CB.unb64(bio.prfSalt) } } } } }).then(function (cred) {
        var ext = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
        var out = ext.prf && ext.prf.results && ext.prf.results.first; if (!out) throw new Error('Bu cihaz biyometrik anahtar türetmeyi (PRF) desteklemiyor');
        return new Uint8Array(out);
      });
    }
    function bioRegister(raw) {
      var prfSalt = CB.rand(32);
      return navigator.credentials.create({ publicKey: { rp: { name: 'Finans Pusulası' }, user: { id: CB.rand(16), name: 'finans-pusulasi', displayName: 'Finans Pusulası kilidi' }, challenge: CB.rand(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000,
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, extensions: { prf: { eval: { first: prfSalt } } } } }).then(function (cred) {
        var ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
        if (!ext.prf || ext.prf.enabled === false) throw new Error('Bu cihaz/tarayıcı biyometrik kilit açmayı desteklemiyor (WebAuthn PRF yok). PIN ile kullanmaya devam et.');
        var bio = { credId: CB.b64(new Uint8Array(cred.rawId)), prfSalt: CB.b64(prfSalt) };
        var first = ext.prf.results && ext.prf.results.first;
        return (first ? Promise.resolve(new Uint8Array(first)) : prfGet(bio)).then(function (prf) { return LK.bioWrap(raw, prf); }).then(function (wrap) { bio.wrap = wrap; bio.at = new Date().toISOString(); return bio; });
      });
    }
    function enableLock() {
      var kind = (document.querySelector('input[name=lk-kind]:checked') || {}).value || 'pin';
      var a = document.getElementById('lk-pin').value, b = document.getElementById('lk-pin2').value, ack = document.getElementById('lk-ack').checked;
      var err = LK.checkSecret(a, kind); if (err) return X.toast(err);
      if (a !== b) return X.toast((kind === 'pin' ? 'PIN\'ler' : 'Parolalar') + ' aynı değil');
      if (!ack) return X.toast('Önce uyarıyı okuyup kutuyu işaretle');
      X.busyToast('Kilit kuruluyor (birkaç saniye)…');
      snapshot('Kilit açılmadan önce').then(function () { return LK.create(a, kind, { autoLockMin: 5 }); }).then(function (r) {
        return window.Store.rekey(r.key).then(function () { lockCfg = r.cfg; LK.saveCfg(lockCfg); return refreshSnaps(); });
      }).then(function () { startAutoLock(); X.toast('Uygulama kilidi açıldı ✓ Verilerin bu cihazda şifreli.'); X.render(); }, function (e) { X.toast('Kilit kurulamadı, hiçbir şey değişmedi: ' + e.message); X.render(); });
    }
    function disableLock() {
      modal({ title: 'Kilidi kapat', text: 'Veriler bu cihazda yeniden şifresiz saklanacak. Onaylamak için ' + (lockCfg.kind === 'pin' ? 'PIN\'ini' : 'parolanı') + ' gir.', fields: [{ label: lockCfg.kind === 'pin' ? 'PIN' : 'Parola', inputmode: lockCfg.kind === 'pin' ? 'numeric' : null }], ok: 'Kilidi kapat' }).then(function (v) {
        if (!v) return; return LK.unlock(lockCfg, v[0]).then(function () { return window.Store.rekey(null); }).then(function () { lockCfg = null; LK.saveCfg(null); stopAutoLock(); X.toast('Kilit kapatıldı.'); X.render(); });
      }).catch(function (e) { X.toast(e.message); });
    }
    function changePin() {
      var isPin = lockCfg.kind === 'pin';
      modal({ title: (isPin ? 'PIN' : 'Parola') + ' değiştir', text: 'Veriler yeniden şifrelenmez; yalnızca anahtarın kilidi değişir.', fields: [{ label: 'Şu anki ' + (isPin ? 'PIN' : 'parola'), inputmode: isPin ? 'numeric' : null }, { label: 'Yeni ' + (isPin ? 'PIN (6–12 rakam)' : 'parola (en az 8)'), inputmode: isPin ? 'numeric' : null }, { label: 'Yeni (tekrar)', inputmode: isPin ? 'numeric' : null }], ok: 'Değiştir',
        check: function (v) { if (v[1] !== v[2]) return 'Yeniler aynı değil'; return LK.checkSecret(v[1], lockCfg.kind); } }).then(function (v) {
        if (!v) return; return LK.changeSecret(lockCfg, v[0], v[1]).then(function (n) { lockCfg = n; LK.saveCfg(n); X.toast((isPin ? 'PIN' : 'Parola') + ' değişti ✓'); X.render(); });
      }).catch(function (e) { X.toast(e.message); });
    }
    function enableBio() {
      modal({ title: 'Parmak izi / yüz ile aç', text: 'Bu cihazın parmak izi veya yüz tanımasıyla açmak için önce ' + (lockCfg.kind === 'pin' ? 'PIN\'ini' : 'parolanı') + ' gir. PIN her zaman yedek yol olarak kalır.', fields: [{ label: lockCfg.kind === 'pin' ? 'PIN' : 'Parola', inputmode: lockCfg.kind === 'pin' ? 'numeric' : null }], ok: 'Devam' }).then(function (v) {
        if (!v) return; return LK.unlock(lockCfg, v[0]).then(function (u) { return bioRegister(u.raw); }).then(function (bio) { lockCfg.bio = bio; LK.saveCfg(lockCfg); X.toast('Biyometrik açma etkin ✓'); X.render(); });
      }).catch(function (e) { X.toast(e.name === 'NotAllowedError' ? 'Biyometrik doğrulama iptal edildi.' : e.message); });
    }
    function disableBio() { lockCfg.bio = null; LK.saveCfg(lockCfg); X.toast('Biyometrik açma kapatıldı.'); X.render(); }
    function markActivity() { lastActivity = now(); }
    function startAutoLock() {
      stopAutoLock(); if (!lockCfg) return;
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, markActivity, { passive: true }); });
      lockTimer = setInterval(function () { if (lockCfg && lockCfg.autoLockMin > 0 && now() - lastActivity > lockCfg.autoLockMin * 60000) lockNow(); }, 15000);
      document.addEventListener('visibilitychange', visCheck);
    }
    function visCheck() { if (document.visibilityState === 'visible' && lockCfg && lockCfg.autoLockMin > 0 && now() - lastActivity > lockCfg.autoLockMin * 60000) lockNow(); }
    function stopAutoLock() { clearInterval(lockTimer); lockTimer = null; document.removeEventListener('visibilitychange', visCheck); }
    function lockNow() { window.Store.setKey(null); try { sessionStorage.setItem('finans-pusulasi:locked-by', 'auto'); } catch (e) { /* */ } location.reload(); }

    /* Kilit ekranı: Promise<CryptoKey>. diskEnc: veri şifreli mi; cfg yoksa kurtarma seçenekleri gösterilir. */
    function lockScreen(diskEnc) {
      return new Promise(function (resolve) {
        var cfg = lockCfg, root = document.createElement('div'); root.id = 'lock-screen'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Uygulama kilitli');
        document.body.classList.add('locked');
        var isPin = cfg && cfg.kind === 'pin';
        function draw(msg) {
          var f = fails(), wait = f.until > now() ? Math.ceil((f.until - now()) / 1000) : 0;
          root.innerHTML = '<div class="lock-box"><div class="lock-ic" aria-hidden="true">🔒</div><h1>Finans Pusulası kilitli</h1>' +
            (!cfg ? '<p>Veriler bu cihazda şifreli ama kilit bilgisi bulunamadı (tarayıcı verisi kısmen silinmiş olabilir). Verini yedek dosyasından veya buluttaki şifreli kopyadan geri getirebilirsin.</p><button class="btn danger" data-lk="forgot">Kurtarma seçenekleri</button>' :
            '<form id="lk-form"><label for="lk-in" class="sr">' + (isPin ? 'PIN' : 'Parola') + '</label><input id="lk-in" type="password" autocomplete="current-password" ' + (isPin ? 'inputmode="numeric" pattern="[0-9]*" placeholder="PIN"' : 'placeholder="Parola"') + (wait ? ' disabled' : '') + '>' +
            '<button class="btn primary" type="submit"' + (wait ? ' disabled' : '') + '>Aç</button></form>' +
            (cfg.bio ? '<button class="btn" data-lk="bio">👆 Parmak izi / yüz ile aç</button>' : '') +
            '<p class="lk-msg ' + (msg && msg.err ? 'neg' : 'hint') + '" role="alert">' + esc(wait ? 'Çok fazla hatalı deneme. ' + wait + ' saniye bekle.' : (msg && msg.text) || (sessionStorage.getItem('finans-pusulasi:locked-by') === 'auto' ? 'Bir süre işlem yapılmadığı için kilitlendi.' : '')) + '</p>' +
            '<button class="linkbtn" data-lk="forgot">' + (isPin ? 'PIN\'imi' : 'Parolamı') + ' unuttum</button>') + '</div>';
          var inp = root.querySelector('#lk-in'); if (inp && !wait) setTimeout(function () { inp.focus(); }, 30);
          if (wait) setTimeout(function () { draw(); }, Math.min(wait, 5) * 1000);
          var form = root.querySelector('#lk-form');
          if (form) form.onsubmit = function (e) {
            e.preventDefault(); var v = inp.value; if (!v) return;
            root.querySelector('.lk-msg').textContent = 'Açılıyor…';
            LK.unlock(cfg, v).then(function (u) { done(u.key); }, function (er) { var f2 = fails(); f2.n++; var w = LK.waitMs(f2.n); f2.until = w ? now() + w : 0; setFails(f2); draw({ err: true, text: er.message + (f2.n >= 3 ? ' (' + f2.n + '. hatalı deneme)' : '') }); });
          };
          var bb = root.querySelector('[data-lk=bio]'); if (bb) bb.onclick = function () { prfGet(cfg.bio).then(function (prf) { return LK.bioUnlock(cfg, prf); }).then(function (u) { done(u.key); }, function (er) { draw({ err: true, text: er.name === 'NotAllowedError' ? 'İptal edildi. PIN ile açabilirsin.' : er.message }); }); };
          Array.prototype.forEach.call(root.querySelectorAll('[data-lk=forgot]'), function (b) { b.onclick = forgot; });
        }
        function forgot() {
          root.innerHTML = '<div class="lock-box"><div class="lock-ic" aria-hidden="true">🛟</div><h1>Kurtarma</h1><p>' + (isPin ? 'PIN' : 'Parola') + ' olmadan bu cihazdaki şifreli veri <b>açılamaz</b> (güvenliğin gereği; kimse açamaz). Yapabileceğin:</p>' +
            '<ol class="howto"><li><b>Yedek dosyan</b> varsa (normal veya şifreli): bu cihazdaki veriyi sil, sonra Ayarlar → "Yedeği geri yükle" ile yükle.</li><li><b>Bulut eşitlemesi</b> kuruluysa: sil, sonra Yedek ve güvenlik → Eşitleme\'yi aynı GitHub anahtarı ve eşitleme parolasıyla yeniden kur; verin geri gelir.</li></ol>' +
            '<div class="notice danger">Sil dersen bu cihazdaki tüm Finans Pusulası verisi, otomatik kopyalar ve kilit kalıcı olarak silinir.</div>' +
            '<label class="row"><input type="checkbox" id="lk-wipe-ok"> Anladım, bu cihazdaki veriyi silmek istiyorum</label>' +
            '<div class="row"><button class="btn danger" data-lk="wipe">Bu cihazdaki veriyi sil</button><button class="btn" data-lk="back">← Geri</button></div></div>';
          root.querySelector('[data-lk=back]').onclick = function () { draw(); };
          root.querySelector('[data-lk=wipe]').onclick = function () {
            if (!root.querySelector('#lk-wipe-ok').checked) return alert('Önce kutuyu işaretle.');
            window.Store.wipeDevice().then(function () { LK.saveCfg(null); location.reload(); });
          };
        }
        function done(key) { setFails({ n: 0, until: 0 }); try { sessionStorage.removeItem('finans-pusulasi:locked-by'); } catch (e) { /* */ } root.remove(); document.body.classList.remove('locked'); lockUi = null; resolve(key); }
        document.body.appendChild(root); lockUi = root; draw();
      });
    }

    /* ---------- Ana sayfa kartı (görsel) ---------- */
    function homeCard() {
      var m = meta(), ds = daysSince(m.lastAt), lim = reminderDays() || 7, bp = ds == null ? 0 : Math.max(0, Math.round(10000 * (1 - Math.min(ds, lim) / lim)));
      var col = ds == null || ds >= lim ? 'danger' : ds >= lim * 0.6 ? 'medium' : 'safe';
      var h = '<section class="card sec-home"><h2>Veri güvenliği ' + tip('Verilerin yalnızca bu cihazda durur. Düzenli yedek, bulut eşitlemesi ve kilit onu korur. Halka: son yedekten bu yana geçen süre (dolu = yeni yedek).') + '</h2><div class="sec-tiles">';
      h += '<a class="sec-tile" href="#guvenlik">' + (CH ? CH.ring('ring-backup', { h: 104, bp: bp, color: col, center: ds == null ? 'yok' : ds === 0 ? 'bugün' : ds + ' gün', label: 'Son yedek: ' + (ds == null ? 'hiç alınmadı' : ds + ' gün önce') }) : '<b class="big">' + (ds == null ? '—' : ds + ' gün') + '</b>') +
        '<b>Son yedek</b><span class="hint">' + (m.lastAt ? (ds === 0 ? 'bugün' : ds + ' gün önce') + ' · ' + X.dateLabel(m.lastAt.slice(0, 10)) : 'hiç alınmadı') + '</span></a>';
      h += tile(syncCfg ? (syncStatus && !syncStatus.ok ? 'warn' : 'ok') : 'off', '☁', 'Eşitleme', syncCfg ? (syncStatus && syncStatus.okAt ? ago(syncStatus.okAt) : 'bekliyor') : 'kapalı');
      h += tile(lockCfg ? 'ok' : 'off', lockCfg ? '🔒' : '🔓', 'Kilit', lockCfg ? (lockCfg.bio ? 'PIN + biyometrik' : 'açık') : 'kapalı');
      h += tile(persistOk ? 'ok' : persistOk === false ? 'warn' : 'off', '🗄', 'Kalıcı depo', persistOk ? 'korunuyor' : persistOk === false ? 'korumasız' : 'bilinmiyor');
      h += '</div><div class="row" style="margin-top:8px"><button class="btn primary" data-act="sec-export">💾 Yedeği indir</button>' + (syncCfg ? '<button class="btn" data-act="sec-sync">☁ Eşitle</button>' : '') + '<a class="btn" href="#guvenlik">Ayrıntılar</a></div></section>';
      return h;
    }
    function tile(level, ic, name, sub) { return '<a class="sec-tile lv-' + level + '" href="#guvenlik"><span class="sec-ic" aria-hidden="true">' + ic + '</span><b>' + esc(name) + '</b><span class="hint">' + esc(sub) + '</span></a>'; }

    /* ---------- Yedek ve güvenlik sayfası ---------- */
    function renderPage() {
      var m = meta(), ds = daysSince(m.lastAt), rd = reminderDays(), h = '<h1>Yedek, eşitleme ve kilit</h1>';
      h += homeCard().replace('<h2>Veri güvenliği', '<h2>Durum');
      // 1. Yedek
      h += '<section class="card" style="margin-top:14px" id="sec-backup"><h2>💾 Yedek ' + tip('Yedek dosyası verinin tamamıdır. Telefon değişirse, tarayıcı verisi silinirse veya kilit PIN\'i unutulursa verini geri getirir. API anahtarları ve eşitleme anahtarı yedeğe girmez.') + '</h2>';
      h += '<p>Son yedek: <b>' + (m.lastAt ? fmtTime(Date.parse(m.lastAt)) + ' (' + (ds === 0 ? 'bugün' : ds + ' gün önce') + ', ' + esc(m.kind || 'dosya') + ')' : 'hiç alınmadı') + '</b></p>';
      h += '<div class="row"><button class="btn primary" data-act="sec-export">Yedeği indir</button><button class="btn" data-act="sec-export-enc">🔐 Şifreli yedek indir</button><button class="btn" data-act="import">Yedeği geri yükle</button><input type="file" id="backup-in" accept=".json,application/json" hidden></div>';
      h += '<div class="field" style="max-width:340px;margin-top:10px"><label for="sec-rem">Yedek hatırlatması</label><select id="sec-rem" data-sec="reminder">' + [[0, 'Kapalı'], [3, '3 günde bir'], [7, 'Haftada bir'], [14, '2 haftada bir'], [30, 'Ayda bir']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === rd ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
      h += '<p class="hint detail-only">Şifreli yedek: PBKDF2-SHA256 (600.000 tur) + AES-256-GCM. Normal yedek açık metin JSON\'dur; güvenli bir yerde sakla.</p>';
      h += '<h3>Tarayıcı depolaması</h3><p>' + (persistOk ? '<span class="pill ok">Kalıcı</span> Tarayıcı yer açmak için verini kendiliğinden silmez.' : persistOk === false ? '<span class="pill warn">Kalıcı değil</span> Tarayıcı, cihazda yer azalınca site verilerini silebilir. "Kalıcı depolama iste"ye bas; olmazsa siteyi ana ekrana ekle ve düzenli yedek al.' : '<span class="pill info">Bilinmiyor</span> Bu tarayıcı kalıcı depolama bilgisini vermiyor; düzenli yedek al.') + '</p>';
      if (persistOk === false) h += '<button class="btn small" data-act="sec-persist">Kalıcı depolama iste</button>';
      if (estimate && estimate.usage != null) h += '<p class="hint">Kullanılan alan: ' + sizeTxt(estimate.usage) + (estimate.quota ? ' / ' + sizeTxt(estimate.quota) : '') + '</p>';
      h += '</section>';
      // 2. Anlık görüntüler
      h += '<section class="card" style="margin-top:14px" id="sec-snaps"><h2>🕘 Otomatik kopyalar ' + tip('Bu cihazda, verinin son ' + window.Store.snapKeep() + ' sürümü kendiliğinden saklanır: en fazla 30 dakikada bir, ayrıca eşitleme, geri yükleme, sürüm yükseltme ve toplu silme gibi büyük işlemlerden önce. Yanlışlıkla bir şeyi silersen buradan geri dönersin. Tarayıcı verisi silinirse bunlar da gider; o yüzden dosya yedeği de al.') + '</h2>';
      if (!snaps.length) h += '<p class="muted">Henüz otomatik kopya yok.</p>';
      else {
        h += '<ul class="snaps">' + snaps.map(function (sn, i) { return '<li><span class="snap-dot' + (i === 0 ? ' new' : '') + '" aria-hidden="true"></span><div class="grow"><b>' + esc(fmtTime(Date.parse(sn.at))) + '</b> <span class="hint">· ' + esc(sn.reason) + (sn.enc ? ' · 🔒' : '') + '</span><div class="hint">' + esc(countsTxt(sn.counts)) + (sn.size ? ' · ' + sizeTxt(sn.size) : '') + '</div></div><button class="btn small" data-act="sec-snap-restore" data-id="' + sn.id + '">Geri yükle</button></li>'; }).join('') + '</ul>';
      }
      h += '<div class="row"><button class="btn small" data-act="sec-snap-now">Şimdi kopya al</button><label class="row hint">Saklanacak sürüm: <select data-sec="snapkeep">' + [5, 10, 20, 30].map(function (n) { return '<option' + (n === window.Store.snapKeep() ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div></section>';
      // 3. Eşitleme
      h += '<section class="card" style="margin-top:14px" id="sec-sync"><h2>☁ Cihazlar arası eşitleme ' + tip('Telefonda girdiğin bilgisayarda da görünür. Veri buluta gitmeden önce bu cihazda, senin eşitleme parolanla şifrelenir (uçtan uca). Depo olarak kendi GitHub hesabındaki gizli bir Gist kullanılır; ücretsizdir.') + '</h2>';
      if (wizard) h += wizardHtml();
      else if (!syncCfg) h += '<p>Kapalı. Kurulum 2 dakika sürer: ücretsiz bir GitHub hesabı ve yalnızca "gist" izni olan bir anahtar yeterli. Verilerin buluta <b>şifreli</b> gider; GitHub dahil kimse okuyamaz.</p><div class="row"><button class="btn primary" data-act="sec-wz-start">Eşitlemeyi kur</button></div>';
      else {
        var st = syncStatus || {};
        h += '<div class="sync-status ' + (syncBusy ? 'busy' : st.ok === false ? 'err' : 'ok') + '"><span class="ss-ic" aria-hidden="true">' + (syncBusy ? '<span class="spinner"></span>' : st.ok === false ? '⚠' : '✓') + '</span><div class="grow"><b>' + (syncBusy ? 'Eşitleniyor…' : esc(st.msg || 'Henüz eşitlenmedi')) + '</b><div class="hint">Son başarılı eşitleme: ' + (st.okAt ? fmtTime(st.okAt) + ' (' + ago(st.okAt) + ')' : '—') + (st.remoteDevice ? ' · diğer cihaz: ' + esc(st.remoteDevice) : '') + '</div></div><button class="btn primary" data-act="sec-sync"' + (syncBusy ? ' disabled' : '') + '>Eşitle</button></div>';
        if (st.code === 'MERGE_INVALID') h += '<div class="notice danger">Birleştirme sonucu tutarsız çıktığı için hiçbir şey değiştirilmedi. Hangisi doğruysa onu seç: <div class="row"><button class="btn small" data-act="sec-sync-push">Bu cihazdakini buluta yaz</button><button class="btn small" data-act="sec-sync-pull">Buluttakini bu cihaza al</button></div><span class="hint">Her iki durumda da önce bu cihazın kopyası alınır.</span></div>';
        h += '<label class="row"><input type="checkbox" data-sec="auto"' + (syncCfg.auto !== false ? ' checked' : '') + '> Otomatik eşitle (açılışta ve her kayıttan birkaç saniye sonra)</label>';
        h += '<p class="hint">GitHub hesabı: <b>' + esc(syncCfg.login || '?') + '</b> · dosya: gizli Gist <code>' + esc(SY.FILE) + '</code> · bu cihaz: ' + esc(syncCfg.device || '') + '</p>';
        h += '<details class="detail-only"><summary>Gelişmiş</summary><div class="row" style="margin-top:8px"><button class="btn small" data-act="sec-sync-push">Bu cihazdakini buluta zorla yaz</button><button class="btn small" data-act="sec-sync-pull">Buluttakini bu cihaza zorla al</button><button class="btn small" data-act="sec-sync-off">Bu cihazda eşitlemeyi kapat</button><button class="btn small danger" data-act="sec-sync-delete">Buluttaki dosyayı sil</button></div><p class="hint">Eşitleme parolasını değiştirmek için: eşitlemeyi kapat, buluttaki dosyayı sil, yeni parolayla yeniden kur (diğer cihazlarda da yeni parolayı gir).</p></details>';
      }
      if (conflicts.length) {
        h += '<h3>Çakışmalar (' + conflicts.length + ') ' + tip('Aynı kayıt iki cihazda da değiştirildiğinde daha yeni olan tutuldu. Diğer sürüm kaybolmadı; burada duruyor. İstersen onu kullan.') + '</h3><ul class="conflicts">';
        conflicts.slice(0, 30).forEach(function (c, i) {
          var other = c.kept === 'local' ? c.remote : c.local;
          h += '<li><div class="grow"><b>' + esc(c.label) + '</b><div class="hint">' + esc(c.reason) + ' · tutulan: ' + (c.kept === 'local' ? 'bu cihazınki' : 'diğer cihazınki') + ' · ' + esc(fmtTime(c.at)) + '</div>' +
            '<details class="detail-only"><summary>Farkı göster</summary><div class="cf-grid"><div><b>Bu cihaz</b><pre>' + esc(JSON.stringify(c.local, null, 1)) + '</pre></div><div><b>Diğer cihaz</b><pre>' + esc(JSON.stringify(c.remote, null, 1)) + '</pre></div></div></details></div>' +
            '<button class="btn small" data-act="sec-cf-use" data-i="' + i + '">' + (other == null ? 'Silinmiş hâlini kullan' : 'Diğer sürümü kullan') + '</button><button class="btn small" data-act="sec-cf-ok" data-i="' + i + '">Tamam</button></li>';
        });
        h += '</ul><button class="btn small" data-act="sec-cf-clear">Hepsini tamam say</button>';
      }
      h += '</section>';
      // 4. Kilit
      h += '<section class="card" style="margin-top:14px" id="sec-lock"><h2>🔒 Uygulama kilidi ' + tip('Açıkken site açılışta PIN/parola ister ve veriler bu cihazda şifreli saklanır (AES-256-GCM, anahtar PIN\'den 600.000 tur PBKDF2 ile türetilir). Bir süre işlem yapılmazsa kendiliğinden kilitlenir.') + '</h2>';
      if (!lockCfg) {
        h += '<p>Kapalı. Telefonunu başkası açtığında finans bilgilerin görünmesin istiyorsan aç.</p>';
        h += '<div class="seg" role="radiogroup" aria-label="Kilit türü"><label class="seg-b"><input type="radio" name="lk-kind" value="pin" checked> <b>PIN</b><span class="hint">6–12 rakam, hızlı</span></label><label class="seg-b"><input type="radio" name="lk-kind" value="password"> <b>Parola</b><span class="hint">en az 8 karakter, daha güçlü</span></label></div>';
        h += '<div class="grid two" style="margin-top:8px"><div class="field"><label for="lk-pin">PIN / parola</label><input id="lk-pin" type="password" autocomplete="new-password" inputmode="text"></div><div class="field"><label for="lk-pin2">Tekrar</label><input id="lk-pin2" type="password" autocomplete="new-password"></div></div>';
        h += '<div class="notice danger"><b>Önemli:</b> PIN/parolayı unutursan bu cihazdaki veri <b>açılamaz</b>. Tek kurtuluş yolu yedek dosyası veya bulut eşitlemesidir. Kilidi açmadan önce bir yedek al.</div>';
        h += '<label class="row"><input type="checkbox" id="lk-ack"> Okudum; unutursam verimi ancak yedekten geri getirebileceğimi biliyorum</label>';
        h += '<div class="row"><button class="btn primary" data-act="sec-lock-on">Kilidi aç</button><button class="btn" data-act="sec-export">Önce yedek indir</button></div>';
      } else {
        h += '<p><span class="pill ok">Açık</span> ' + (lockCfg.kind === 'pin' ? 'PIN' : 'Parola') + ' ile korunuyor; veriler bu cihazda şifreli.' + (lockCfg.bio ? ' Biyometrik açma etkin.' : '') + '</p>';
        h += '<div class="field" style="max-width:340px"><label for="lk-auto">Otomatik kilit</label><select id="lk-auto" data-sec="autolock">' + [[1, '1 dakika işlemsizlikte'], [5, '5 dakika'], [15, '15 dakika'], [60, '1 saat'], [0, 'Kapalı (yalnızca açılışta sor)']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === lockCfg.autoLockMin ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
        h += '<div class="row"><button class="btn" data-act="sec-lock-now">Şimdi kilitle</button><button class="btn" data-act="sec-lock-change">' + (lockCfg.kind === 'pin' ? 'PIN' : 'Parola') + ' değiştir</button>' +
          (lockCfg.bio ? '<button class="btn" data-act="sec-bio-off">Biyometrik açmayı kapat</button>' : '<button class="btn" data-act="sec-bio-on" id="sec-bio-on" hidden>👆 Parmak izi / yüz ile açmayı etkinleştir</button>') +
          '<button class="btn danger" data-act="sec-lock-off">Kilidi kapat</button></div>';
        h += '<p class="hint">Unutursan: kilit ekranındaki "unuttum" bağlantısı veriyi siler; sonra yedekten veya buluttan geri yüklersin. API anahtarları (Asistan) kilitten bağımsız saklanır.</p>';
      }
      h += '</section>';
      return h;
    }
    function afterRender() {
      updateChip();
      var bb = document.getElementById('sec-bio-on'); if (bb) bioAvailable().then(function (ok) { if (ok) bb.hidden = false; });
    }

    /* ---------- Olaylar ---------- */
    function onClick(act, t) {
      var A = {
        'sec-export': exportPlain,
        'sec-export-enc': exportEncrypted,
        'sec-snooze': function () { try { localStorage.setItem(SNOOZE_KEY, String(now() + 86400000)); } catch (e) { /* */ } X.render(); },
        'sec-persist': function () { window.Store.requestPersist().then(function (p) { persistOk = p; X.toast(p ? 'Kalıcı depolama açıldı ✓' : 'Tarayıcı izin vermedi. Siteyi ana ekrana ekleyip tekrar dene; düzenli yedek almayı unutma.'); X.render(); }); },
        'sec-snap-now': function () { snapshot('Elle alınan kopya').then(function () { X.toast('Kopya alındı.'); X.render(); }); },
        'sec-snap-restore': function () {
          var id = +t.dataset.id, sn = snaps.find(function (x) { return x.id === id; }); if (!sn) return;
          window.Store.getSnapshot(id).then(function (obj) {
            S.validateState(obj);
            if (!confirm(fmtTime(Date.parse(sn.at)) + ' tarihli kopya geri yüklensin mi? (' + countsTxt(SM.counts(obj)) + ')\nŞu anki verinin de bir kopyası alınır; istersen geri dönebilirsin.' + (syncCfg ? '\nEşitleme açık: geri yüklenen hâl diğer cihazlara da gider.' : ''))) return;
            return snapshot('Geri yüklemeden önce').then(function () { X.restoreState(obj, 'Kopya geri yüklendi (' + fmtTime(Date.parse(sn.at)) + ').'); });
          }).catch(function (e) { X.toast('Geri yüklenemedi, hiçbir şey değişmedi: ' + e.message); });
        },
        'sec-sync': function () { syncNow('auto', false); },
        'sec-sync-push': function () { if (confirm('Bu cihazdaki veri buluttakinin yerine yazılsın mı? Diğer cihazlar bir sonraki eşitlemede bunu alır (onlardaki farklı kayıtlar birleştirilir).')) snapshot('Zorla yazmadan önce').then(function () { syncNow('push', false); }); },
        'sec-sync-pull': function () { if (confirm('Buluttaki veri bu cihazdakinin yerine geçsin mi? Önce bu cihazın kopyası alınır.')) snapshot('Buluttan zorla almadan önce').then(function () { syncNow('pull', false); }); },
        'sec-sync-off': function () { if (!confirm('Bu cihazda eşitleme kapatılsın mı? GitHub anahtarı ve eşitleme parolası bu cihazdan silinir. Buluttaki şifreli dosya ve bu cihazdaki verin kalır.')) return; syncCfg = null; syncStatus = null; keyCache = {}; Promise.all([saveCfg(), saveStatus()]).then(function () { X.toast('Eşitleme bu cihazda kapatıldı.'); X.render(); }); },
        'sec-sync-delete': function () {
          if (!syncCfg.gistId) return X.toast('Bulutta dosya yok.');
          if (!confirm('GitHub\'daki şifreli eşitleme dosyası (gizli Gist) KALICI olarak silinsin mi? Bu cihazdaki verin silinmez. Diğer cihazlar artık eşitlenemez.')) return;
          client().remove(syncCfg.gistId).then(function () { syncCfg.gistId = null; syncCfg.lastSyncAt = 0; return saveCfg(); }).then(function () { X.toast('Buluttaki dosya silindi.'); X.render(); }, function (e) { X.toast(e.message); });
        },
        'sec-wz-start': function () { wizard = { step: 1 }; X.render(); },
        'sec-wz-cancel': function () { wizard = null; X.render(); },
        'sec-wz-next': function () { wizard.step = 2; X.render(); },
        'sec-wz-back': function () { wizard.step = Math.max(1, wizard.step - 1); wizard.busy = false; X.render(); },
        'sec-wz-token': wizardToken,
        'sec-wz-pass': wizardPass,
        'sec-wz-connect': wizardConnect,
        'sec-cf-use': function () {
          var i = +t.dataset.i, c = conflicts[i]; if (!c) return; var other = c.kept === 'local' ? c.remote : c.local;
          X.mutate(function (s) { SM.applyVersion(s, c.key, other); }, 'Diğer sürüm kullanıldı: ' + c.label);
          conflicts.splice(i, 1); window.Store.setSecret('sync-conflicts', conflicts); X.render();
        },
        'sec-cf-ok': function () { conflicts.splice(+t.dataset.i, 1); window.Store.setSecret('sync-conflicts', conflicts); X.render(); },
        'sec-cf-clear': function () { conflicts = []; window.Store.setSecret('sync-conflicts', null); X.render(); },
        'sec-lock-on': enableLock,
        'sec-lock-off': disableLock,
        'sec-lock-change': changePin,
        'sec-lock-now': lockNow,
        'sec-bio-on': enableBio,
        'sec-bio-off': disableBio
      };
      if (!A[act]) return false;
      A[act](); return true;
    }
    function onChange(el) {
      var k = el.dataset && el.dataset.sec; if (!k) return false;
      if (k === 'reminder') { var d = parseInt(el.value, 10); X.mutate(function (s) { s.settings.backupReminderDays = d; }, d ? 'Yedek hatırlatması: ' + d + ' günde bir' : 'Yedek hatırlatması kapatıldı'); }
      if (k === 'snapkeep') window.Store.setSnapKeep(parseInt(el.value, 10)).then(refreshSnaps).then(function () { X.render(); });
      if (k === 'auto') { syncCfg.auto = el.checked; saveCfg(); if (el.checked) scheduleSync(500); }
      if (k === 'autolock') { lockCfg.autoLockMin = parseInt(el.value, 10); LK.saveCfg(lockCfg); X.toast('Otomatik kilit güncellendi.'); }
      return true;
    }
    /* Kilit açıldıktan ve veri yüklendikten sonra */
    function start() {
      window.Store.requestPersist().then(function (p) { persistOk = p; return window.Store.estimate(); }).then(function (e) { estimate = e; if (X.tab() === 'ozet' || X.tab() === 'guvenlik') X.render(); });
      if (lockCfg) startAutoLock();
      return Promise.all([loadSecrets(), refreshSnaps()]).then(function () {
        var today = X.today();
        if (!snaps.length || snaps[0].at.slice(0, 10) !== today) { lastSnapAt = now(); snapshot('Günlük ilk açılış'); }
        updateChip();
        if (syncCfg && syncCfg.auto !== false) setTimeout(function () { syncNow('auto', true); }, 1200);
        window.addEventListener('online', function () { scheduleSync(1000); });
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && syncCfg && (!syncStatus || now() - (syncStatus.at || 0) > 5 * 60000)) scheduleSync(500); });
      });
    }
    return {
      start: start, lockScreen: lockScreen, lockCfg: function () { return lockCfg; }, renderPage: renderPage, homeCard: homeCard, banner: banner, afterRender: afterRender,
      onClick: onClick, onChange: onChange, onSaved: onSaved, snapshot: snapshot, decryptBackup: decryptBackup, exportPlain: exportPlain, syncEnabled: function () { return !!syncCfg; },
      chipHtml: chipHtml, syncNow: syncNow, modal: modal, _debug: function () { return { syncCfg: syncCfg, syncStatus: syncStatus, conflicts: conflicts, snaps: snaps, lockCfg: lockCfg }; }
    };
  };
})();
