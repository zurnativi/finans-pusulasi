/* cryptobox.js — Uçtan uca şifreleme yardımcıları (yalnızca tarayıcının yerleşik Web Crypto'su; dış kütüphane yok).
 * Parola → anahtar: PBKDF2-SHA256, varsayılan 600.000 tur (OWASP 2023 önerisi), 16 bayt rastgele tuz.
 * Şifreleme: AES-256-GCM, her kayıtta 12 bayt rastgele IV; GCM etiketi yanlış parola veya bozulmayı yakalar.
 * Veri, destekleniyorsa şifrelemeden önce gzip ile sıkıştırılır (z:1). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CryptoBox = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FORMAT = 'finans-pusulasi-sifreli', DEFAULT_ITER = 600000, MIN_ITER = 100000;
  var te = new TextEncoder(), td = new TextDecoder();
  function cr() { var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null; if (!c || !c.subtle) throw new Error('Bu tarayıcı şifrelemeyi desteklemiyor (Web Crypto yok). Güncel Chrome, Safari, Edge veya Firefox kullan.'); return c; }
  function available() { try { cr(); return true; } catch (e) { return false; } }
  function rand(n) { return cr().getRandomValues(new Uint8Array(n)); }
  function b64(u8) { var s = '', CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function unb64(s) { var bin = atob(s), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
  function toBytes(x) { return typeof x === 'string' ? te.encode(x) : x; }

  function pipe(u8, Stream) { return new Response(new Blob([u8]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  var canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function';
  function gzip(u8) { return canZip ? pipe(u8, CompressionStream) : Promise.resolve(null); }
  function gunzip(u8) { if (!canZip) return Promise.reject(new Error('Bu tarayıcı sıkıştırılmış veriyi açamıyor')); return pipe(u8, DecompressionStream); }

  /* Paroladan AES-GCM anahtarı (dışa aktarılamaz) */
  function deriveKey(pass, salt, iter) {
    if (typeof pass !== 'string' || !pass.length) return Promise.reject(new Error('Parola boş olamaz'));
    var s = cr().subtle;
    return s.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter || DEFAULT_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  /* Rastgele bayttan (ör. WebAuthn PRF çıktısı) HKDF ile AES-GCM anahtarı */
  function keyFromBytes(bytes, info) {
    var s = cr().subtle;
    return s.importKey('raw', bytes, 'HKDF', false, ['deriveKey']).then(function (base) {
      return s.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info || 'finans-pusulasi') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  /* Ham veri anahtarı (DEK) üret / içe aktar */
  function newRawKey() { return rand(32); }
  function importRawKey(raw) { return cr().subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }

  /* Anahtarla mühürle / aç. data: metin veya Uint8Array. Dönüş: {iv, ct, z?} (base64) */
  function seal(key, data, opts) {
    var bytes = toBytes(data), iv = rand(12), zip = !(opts && opts.noZip) && bytes.length > 256;
    return (zip ? gzip(bytes) : Promise.resolve(null)).then(function (gz) {
      var use = gz && gz.length < bytes.length ? gz : bytes;
      return cr().subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, use).then(function (ct) {
        var o = { iv: b64(iv), ct: b64(new Uint8Array(ct)) }; if (use === gz) o.z = 1; return o;
      });
    });
  }
  function openBytes(key, box) {
    if (!box || typeof box.iv !== 'string' || typeof box.ct !== 'string') return Promise.reject(new Error('Şifreli veri bozuk'));
    return cr().subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)).then(function (pt) {
      var u8 = new Uint8Array(pt); return box.z ? gunzip(u8) : u8;
    }, function () { throw new Error('Parola/anahtar yanlış veya veri bozulmuş'); });
  }
  function open(key, box) { return openBytes(key, box).then(function (u8) { return td.decode(u8); }); }

  /* Paroyla tam zarf: yedek dosyası ve buluta giden veri için */
  function isEnvelope(x) { return !!(x && typeof x === 'object' && x.format === FORMAT && x.kdf && typeof x.ct === 'string'); }
  function encryptJson(obj, pass, opts) {
    var iter = (opts && opts.iter) || DEFAULT_ITER, kc = opts && opts.keyCache, salt, kp;
    // Aynı parolayla tekrar tekrar şifrelerken (eşitleme) türetilmiş anahtar ve tuzu yeniden kullan: her seferinde 600 bin tur beklenmesin
    if (kc && kc.pass === pass && kc.last && kc.last.iter === iter) { salt = unb64(kc.last.salt); kp = Promise.resolve(kc.last.key); }
    else { salt = rand(16); kp = deriveKey(pass, salt, iter).then(function (k) { if (kc) { if (kc.pass !== pass) { kc.pass = pass; kc.map = {}; } kc.last = { salt: b64(salt), iter: iter, key: k }; kc.map[b64(salt) + ':' + iter] = k; } return k; }); }
    return kp.then(function (key) {
      return seal(key, JSON.stringify(obj)).then(function (box) {
        var env = { format: FORMAT, v: 1, note: 'Uçtan uca şifreli Finans Pusulası verisi. Parola olmadan açılamaz.', kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: iter, salt: b64(salt) }, alg: 'AES-256-GCM', iv: box.iv, ct: box.ct };
        if (box.z) env.z = 1;
        if (opts && opts.meta) Object.keys(opts.meta).forEach(function (k) { if (env[k] == null) env[k] = opts.meta[k]; });
        return env;
      });
    });
  }
  /* keyCache (isteğe bağlı): aynı tuz için türetilen anahtarı bellekte tutar (her eşitlemede 600 bin tur tekrarlanmasın) */
  function envelopeKey(env, pass, keyCache) {
    if (!isEnvelope(env)) return Promise.reject(new Error('Bu bir şifreli Finans Pusulası dosyası değil'));
    var it = env.kdf.iter; if (!Number.isInteger(it) || it < MIN_ITER || it > 10000000) return Promise.reject(new Error('Şifreleme ayarı geçersiz'));
    var ck = env.kdf.salt + ':' + it;
    if (keyCache && keyCache.pass === pass && keyCache.map && keyCache.map[ck]) return Promise.resolve(keyCache.map[ck]);
    return deriveKey(pass, unb64(env.kdf.salt), it).then(function (k) { if (keyCache) { if (keyCache.pass !== pass) { keyCache.pass = pass; keyCache.map = {}; } keyCache.map[ck] = k; keyCache.last = { salt: env.kdf.salt, iter: it, key: k }; } return k; });
  }
  function decryptJson(env, pass, keyCache) {
    return envelopeKey(env, pass, keyCache).then(function (key) { return open(key, env); }).then(function (txt) { return JSON.parse(txt); });
  }
  return { FORMAT: FORMAT, DEFAULT_ITER: DEFAULT_ITER, MIN_ITER: MIN_ITER, available: available, rand: rand, b64: b64, unb64: unb64,
    deriveKey: deriveKey, keyFromBytes: keyFromBytes, newRawKey: newRawKey, importRawKey: importRawKey, seal: seal, open: open, openBytes: openBytes,
    isEnvelope: isEnvelope, encryptJson: encryptJson, decryptJson: decryptJson, envelopeKey: envelopeKey };
});
