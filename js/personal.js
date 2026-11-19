/* personal.js — v8.3: Şifreli kişisel veri paketi (data/kisisel-veri.enc.json).
 * Amaç: kullanıcı hiçbir dosya yüklemeden, siteyi açıp parolasını bir kez yazarak kendi gerçek verisini yükler.
 * Güvenlik: depo herkese açık; pakette YALNIZCA şifreli metin vardır (AES-256-GCM, PBKDF2-SHA256, rastgele tuz/IV — cryptobox.js ile aynı biçim).
 * Parola hiçbir yere yazılmaz (ne dosya, ne depolama, ne günlük); yalnızca bellekte, açma sırasında kullanılır.
 * Cihazda yalnızca paket kimliği (rastgele, gizli olmayan) "uygulandı" diye tutulur. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cryptobox.js'), require('./sample.js'));
  else root.PersonalData = factory(root.CryptoBox, root.Sample);
})(typeof self !== 'undefined' ? self : this, function (CB, S) {
  'use strict';
  var FILE = 'data/kisisel-veri.enc.json', KIND = 'kisisel-veri', LS_APPLIED = 'finans-pusulasi:kisisel-paket', SS_SKIP = 'finans-pusulasi:kisisel-gec';
  var LISTS = ['incomes', 'expenses', 'assets', 'debts', 'transactions', 'accounts', 'recurring', 'installments', 'transfers', 'trades', 'sinkingFunds'];

  function validEnvelope(env) { return !!(CB.isEnvelope(env) && env.kind === KIND && typeof env.bundleId === 'string' && /^[0-9a-f]{8,32}$/.test(env.bundleId)); }

  /* Cihazdaki veri yalnızca örnek mi (ya da boş mu)? Gerçek kayıt varsa false. */
  function isSampleOrEmpty(state) { return !state || state.isExample === true || S.realRecordCount(state) === 0; }

  /* Örnek veri izi kaldı mı? (test ve doğrulama için) */
  function sampleLeftovers(state) {
    var n = []; if (!state) return n;
    if (state.isExample) n.push('isExample');
    if (state.nwExample) n.push('nwExample');
    LISTS.forEach(function (k) { if (Array.isArray(state[k])) state[k].forEach(function (x) { if (x && x.source === 'örnek') n.push(k + ':' + x.id); }); });
    return n;
  }

  /* Karar: 'none' (hiçbir şey gösterme) | 'first' (örnek/boş veri → kurulum) | 'update' (gerçek veri var → güncelleme teklifi) */
  function decide(state, env, appliedId, skippedId) {
    if (!validEnvelope(env)) return 'none';
    if (appliedId && appliedId === env.bundleId) return 'none';
    if (state && state.personalBundleId === env.bundleId) return 'none';
    if (skippedId && skippedId === env.bundleId) return 'none';
    return isSampleOrEmpty(state) ? 'first' : 'update';
  }

  /* Paketi parolayla aç ve doğrula. Hata kodları: BAD_PASSWORD (yanlış parola/bozuk veri), BAD_DATA (açıldı ama geçersiz) */
  function unlock(env, pass) {
    function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
    if (!validEnvelope(env)) return Promise.reject(err('BAD_DATA', 'Kişisel veri paketi geçersiz'));
    if (typeof pass !== 'string' || !pass) return Promise.reject(err('BAD_PASSWORD', 'Şifre boş olamaz'));
    return CB.envelopeKey(env, pass).then(function (key) {
      return CB.open(key, env).then(null, function () { throw err('BAD_PASSWORD', 'Şifre yanlış'); });
    }).then(function (txt) {
      var obj;
      try { obj = JSON.parse(txt); } catch (e) { throw err('BAD_DATA', 'Paket açıldı ama içeriği okunamadı'); }
      try {
        delete obj.exportedAt; delete obj.app;
        obj = S.validateState(obj);
      } catch (e) { throw err('BAD_DATA', 'Paket açıldı ama veri doğrulanamadı: ' + e.message); }
      if (obj.isExample) throw err('BAD_DATA', 'Paket örnek veri içeriyor');
      obj.personalBundleId = env.bundleId; // cihazdan bağımsız "bu paket uygulandı" izi
      return obj;
    });
  }

  function counts(o) {
    return { islem: (o.transactions || []).length, hesap: (o.accounts || []).length, transfer: (o.transfers || []).length, taksit: (o.installments || []).length,
      duzenli: (o.recurring || []).length, varlik: (o.assets || []).length, alimSatim: (o.trades || []).length, hedef: (o.goals || []).length };
  }

  /* ---------- Cihaz izleri (parola içermez) ---------- */
  function getApplied() { try { return localStorage.getItem(LS_APPLIED) || null; } catch (e) { return null; } }
  function markApplied(id) { try { localStorage.setItem(LS_APPLIED, id); } catch (e) { /* */ } }
  function getSkipped() { try { return sessionStorage.getItem(SS_SKIP) || null; } catch (e) { return null; } }
  function markSkipped(id) { try { sessionStorage.setItem(SS_SKIP, id); } catch (e) { /* */ } }

  function fetchBundle(fetchFn) {
    fetchFn = fetchFn || (typeof fetch === 'function' ? function (u, o) { return fetch(u, o); } : null);
    if (!fetchFn) return Promise.resolve(null);
    return fetchFn(FILE, { cache: 'no-store' }).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (j) { return validEnvelope(j) ? j : null; }, function () { return null; });
  }

  /* ---------- Arayüz ---------- */
  function ui(X) {
    var bundle = null, busy = false;
    function esc(s) { return X.esc(s); }
    function modal(mode, env) {
      return new Promise(function (resolve) {
        var first = mode === 'first', rootEl = document.createElement('div'); rootEl.className = 'modal-bg'; rootEl.id = 'personal-unlock'; rootEl.setAttribute('role', 'dialog'); rootEl.setAttribute('aria-modal', 'true'); rootEl.setAttribute('aria-label', 'Kişisel verilerin hazır');
        rootEl.innerHTML = '<form class="modal card" autocomplete="off"><h2>🔐 Kişisel verilerin hazır</h2>' +
          (first
            ? '<p>Bütçen, hesapların ve portföyün senin için siteye <b>şifreli</b> olarak yerleştirildi. Dosya yüklemene gerek yok: <b>şifreni gir</b>, hepsi bu cihaza yüklensin. Örnek veriler tamamen kaldırılır.</p>'
            : '<p>Siteye yeni bir şifreli veri paketi konmuş. Bu cihazda kendi girdiğin veriler var; devam edersen paket onların <b>yerine</b> geçer. Önce otomatik bir kopya alınır (Ayarlar → Otomatik kopyalar\'dan geri dönebilirsin).</p>') +
          '<div class="field"><label for="pd-pass">Şifre</label><input id="pd-pass" name="pd-pass" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required></div>' +
          '<p class="md-err neg" role="alert" aria-live="assertive"></p><p class="hint pd-note">Şifre hiçbir yere kaydedilmez ve gönderilmez; çözme bu cihazda yapılır.</p>' +
          '<div class="row"><button class="btn primary" type="submit">' + (first ? 'Aç ve yükle' : 'Güncelle (mevcut verinin yerine geçer)') + '</button><button class="btn" type="button" data-pd="skip">Şimdilik geç</button></div></form>';
        document.body.appendChild(rootEl);
        var form = rootEl.querySelector('form'), inp = rootEl.querySelector('#pd-pass'), err = rootEl.querySelector('.md-err'), okBtn = rootEl.querySelector('button[type=submit]'), skip = rootEl.querySelector('[data-pd=skip]');
        setTimeout(function () { inp.focus(); }, 30);
        function close(v) { rootEl.remove(); resolve(v); }
        skip.onclick = function () { if (!busy) close(null); };
        rootEl.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !busy) close(null); });
        form.onsubmit = function (e) {
          e.preventDefault(); if (busy) return;
          var pass = inp.value; if (!pass) { err.textContent = 'Şifreyi yaz.'; return; }
          busy = true; err.textContent = ''; var label = okBtn.textContent; okBtn.disabled = true; okBtn.textContent = 'Doğrulanıyor…';
          unlock(env, pass).then(function (obj) { pass = null; inp.value = ''; busy = false; close(obj); }, function (er) {
            busy = false; okBtn.disabled = false; okBtn.textContent = label;
            err.textContent = er.code === 'BAD_PASSWORD' ? 'Şifre yanlış. Tekrar dene.' : 'Paket açılamadı: ' + er.message; inp.value = ''; inp.focus();
          });
        };
      });
    }
    function applyObj(obj, env, mode) {
      return X.snapshot(mode === 'first' ? 'Kişisel veri yüklenmeden önce' : 'Yedek geri yüklemeden önce').then(function () {
        X.restoreState(obj, 'Kişisel verilerin yüklendi: ' + obj.transactions.length + ' işlem, ' + obj.accounts.length + ' hesap, ' + (obj.assets || []).length + ' varlık, ' + (obj.trades || []).length + ' alım-satım. Örnek veriler kaldırıldı.', true);
        markApplied(env.bundleId);
      });
    }
    /* mode: 'first' | 'update'; manual true ise "geç" kararı hatırlanmaz */
    function run(env, mode) {
      return modal(mode, env).then(function (obj) {
        if (!obj) { markSkipped(env.bundleId); return false; }
        return applyObj(obj, env, mode).then(function () { return true; });
      }).catch(function (e) { console.error(e); X.toast('Kişisel veri yüklenemedi, hiçbir şey değişmedi: ' + e.message); return false; });
    }
    function check() {
      return fetchBundle().then(function (env) {
        bundle = env; if (!env) return false;
        var st = X.state(), d = decide(st, env, getApplied(), getSkipped());
        if (d === 'none') return false;
        return run(env, d);
      });
    }
    /* Örnek veri bandındaki "Kişisel verilerimi aç" düğmesi */
    function openManual() {
      var p = bundle ? Promise.resolve(bundle) : fetchBundle();
      return p.then(function (env) { bundle = env; if (!env) { X.toast('Bu sitede şifreli kişisel veri paketi yok.'); return false; } return run(env, isSampleOrEmpty(X.state()) ? 'first' : 'update'); });
    }
    return { check: check, openManual: openManual, available: function () { return !!bundle; } };
  }

  return { FILE: FILE, KIND: KIND, validEnvelope: validEnvelope, isSampleOrEmpty: isSampleOrEmpty, sampleLeftovers: sampleLeftovers, decide: decide, unlock: unlock, counts: counts,
    fetchBundle: fetchBundle, getApplied: getApplied, markApplied: markApplied, ui: ui };
});
