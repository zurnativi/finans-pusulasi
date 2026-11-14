/* lock.js — Uygulama kilidi (PIN/parola) çekirdeği. Saf mantık; tarayıcıda ve Node testlerinde çalışır.
 * Tasarım: rastgele 256 bit veri anahtarı (DEK) tüm kayıtları şifreler. DEK, PIN'den PBKDF2 (600.000 tur) ile türetilen
 * anahtarla sarılır (AES-GCM). İsteğe bağlı biyometrik açma: WebAuthn PRF çıktısından HKDF ile türetilen anahtar DEK'in ikinci bir kopyasını sarar.
 * PIN değişince yalnızca sarma yenilenir; veri yeniden şifrelenmez. PIN unutulursa DEK açılamaz: veri ancak yedekten/buluttan geri gelir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cryptobox.js'));
  else root.LockCore = factory(root.CryptoBox);
})(typeof self !== 'undefined' ? self : this, function (CB) {
  'use strict';
  var CFG_KEY = 'finans-pusulasi:lock', ITER = 600000;
  function checkSecret(pin, kind) {
    pin = String(pin == null ? '' : pin);
    if (kind === 'pin') { if (!/^\d{6,12}$/.test(pin)) return 'PIN 6–12 rakam olmalı'; if (/^(\d)\1+$/.test(pin) || '0123456789012'.indexOf(pin) >= 0 || '9876543210987'.indexOf(pin) >= 0) return 'Bu PIN çok kolay tahmin edilir (aynı veya sıralı rakamlar)'; return null; }
    if (pin.length < 8) return 'Parola en az 8 karakter olmalı';
    return null;
  }
  /* Yeni kilit: { cfg, key (CryptoKey), raw (Uint8Array DEK) } */
  function create(pin, kind, opts) {
    var err = checkSecret(pin, kind); if (err) return Promise.reject(new Error(err));
    var iter = (opts && opts.iter) || ITER, salt = CB.rand(16), raw = CB.newRawKey();
    return CB.deriveKey(pin, salt, iter).then(function (kek) { return CB.seal(kek, raw, { noZip: true }); }).then(function (wrap) {
      return CB.importRawKey(raw).then(function (key) {
        return { cfg: { v: 1, kind: kind === 'pin' ? 'pin' : 'password', iter: iter, salt: CB.b64(salt), wrap: wrap, autoLockMin: (opts && opts.autoLockMin) || 5, bio: null, createdAt: new Date().toISOString() }, key: key, raw: raw };
      });
    });
  }
  function unlock(cfg, pin) {
    if (!cfg || !cfg.wrap) return Promise.reject(new Error('Kilit bilgisi yok'));
    return CB.deriveKey(String(pin), CB.unb64(cfg.salt), cfg.iter).then(function (kek) { return CB.openBytes(kek, cfg.wrap); }).then(function (raw) {
      return CB.importRawKey(raw).then(function (key) { return { key: key, raw: raw }; });
    }, function () { throw new Error(cfg.kind === 'pin' ? 'PIN yanlış' : 'Parola yanlış'); });
  }
  function changeSecret(cfg, oldPin, newPin, newKind) {
    var err = checkSecret(newPin, newKind || cfg.kind); if (err) return Promise.reject(new Error(err));
    return unlock(cfg, oldPin).then(function (u) {
      var salt = CB.rand(16);
      return CB.deriveKey(newPin, salt, cfg.iter || ITER).then(function (kek) { return CB.seal(kek, u.raw, { noZip: true }); }).then(function (wrap) {
        var n = JSON.parse(JSON.stringify(cfg)); n.salt = CB.b64(salt); n.wrap = wrap; n.kind = newKind || cfg.kind; n.changedAt = new Date().toISOString(); return n;
      });
    });
  }
  /* Biyometrik: prfBytes = WebAuthn PRF çıktısı (32 bayt) */
  function bioWrap(raw, prfBytes) { return CB.keyFromBytes(prfBytes, 'finans-pusulasi-biyometrik').then(function (k) { return CB.seal(k, raw, { noZip: true }); }); }
  function bioUnlock(cfg, prfBytes) {
    if (!cfg || !cfg.bio) return Promise.reject(new Error('Biyometrik açma kurulmamış'));
    return CB.keyFromBytes(prfBytes, 'finans-pusulasi-biyometrik').then(function (k) { return CB.openBytes(k, cfg.bio.wrap); }).then(function (raw) { return CB.importRawKey(raw).then(function (key) { return { key: key, raw: raw }; }); }, function () { throw new Error('Biyometrik doğrulama anahtarı açamadı; PIN ile aç'); });
  }
  /* Deneme sınırı: 5 hatalı denemeden sonra artan bekleme (30 sn, 60 sn, …, en fazla 15 dk) */
  function waitMs(fails) { return fails < 5 ? 0 : Math.min(15 * 60000, 30000 * Math.pow(2, Math.floor((fails - 5) / 3))); }
  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; } }
  function saveCfg(cfg) { if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); else localStorage.removeItem(CFG_KEY); }
  return { CFG_KEY: CFG_KEY, ITER: ITER, checkSecret: checkSecret, create: create, unlock: unlock, changeSecret: changeSecret, bioWrap: bioWrap, bioUnlock: bioUnlock, waitMs: waitMs, loadCfg: loadCfg, saveCfg: saveCfg };
});
