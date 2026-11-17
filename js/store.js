/* store.js — Veriler yalnızca bu tarayıcıda: IndexedDB (ana) + localStorage (yedek kopya). API anahtarları ayrı tutulur ve yedeğe girmez.
 * v5: Uygulama kilidi açıksa tüm kayıtlar (ana veri, anlık görüntüler, eşitleme ayarları) AES-256-GCM ile şifreli yazılır; anahtar yalnızca bellektedir.
 * Anlık görüntüler (snapshots): son N sürüm IndexedDB'de tutulur, istenince geri yüklenir. */
(function (root) {
  'use strict';
  var DB = 'finans-pusulasi', DBV = 2, STORE = 'kv', SNAPS = 'snaps', KEY = 'state', LS_KEY = 'finans-pusulasi:state', AI_KEY = 'finans-pusulasi:ai', SNAP_KEEP_KEY = 'finans-pusulasi:snap-keep';
  var dbp = null, dek = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!root.indexedDB) return rej(new Error('IndexedDB yok'));
      var req = indexedDB.open(DB, DBV);
      req.onupgradeneeded = function () { var db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS, { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = function () { var db = req.result; db.onversionchange = function () { db.close(); dbp = null; }; res(db); };
      req.onerror = function () { dbp = null; rej(req.error); };
      req.onblocked = function () { /* başka sekme eski sürümü açık tutuyor */ };
    });
    return dbp;
  }
  function tx(store, mode, fn) { return openDb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(store, mode), out; out = fn(t.objectStore(store)); t.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); }; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error || new Error('İşlem iptal')); }; }); }); }
  function idbGet(k) { return tx(STORE, 'readonly', function (s) { return s.get(k); }); }
  function idbSet(k, v) { return tx(STORE, 'readwrite', function (s) { s.put(v, k); }); }
  function idbDel(k) { return tx(STORE, 'readwrite', function (s) { s.delete(k); }); }

  function lockedError() { var e = new Error('Uygulama kilitli'); e.code = 'LOCKED'; return e; }
  function isEncText(txt) { return typeof txt === 'string' && txt.indexOf('{"fpEnc":1') === 0; }
  /* Nesne → kaydedilecek metin (kilit açıksa şifreli) */
  function encode(obj, key) {
    var json = JSON.stringify(obj), k = key === undefined ? dek : key;
    if (!k) return Promise.resolve(json);
    return root.CryptoBox.seal(k, json).then(function (b) { return JSON.stringify({ fpEnc: 1, iv: b.iv, ct: b.ct, z: b.z || 0 }); });
  }
  function decode(txt, key) {
    if (txt == null || txt === '') return Promise.resolve(null);
    if (!isEncText(txt)) return Promise.resolve(JSON.parse(txt));
    var k = key === undefined ? dek : key;
    if (!k) return Promise.reject(lockedError());
    return root.CryptoBox.open(k, JSON.parse(txt)).then(function (j) { return JSON.parse(j); });
  }
  /* Cihaz anahtarı: kilit KAPALIYKEN bile gizli kayıtlar (API anahtarları, eşitleme parolası/jetonu) açık metin yazılmaz.
   * WebCrypto ile üretilen, DIŞA AKTARILAMAZ (extractable:false) AES-GCM anahtarı IndexedDB'de durur. Sınır: bu tarayıcı profiline
   * tam erişimi olan biri (aynı profilde çalışan kod) yine çözebilir; asıl koruma uygulama kilidi (PIN) açıkken sağlanır. */
  var devKeyP = null;
  function deviceKey() {
    if (devKeyP) return devKeyP;
    devKeyP = idbGet('devkey').catch(function () { return null; }).then(function (k) {
      if (k && typeof k === 'object' && k.algorithm && k.type === 'secret') return k;
      var c = root.crypto && root.crypto.subtle; if (!c) return null;
      return c.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (nk) { return idbSet('devkey', nk).then(function () { return nk; }); });
    }).catch(function () { devKeyP = null; return null; });
    return devKeyP;
  }
  function isDk(txt) { return isEncText(txt) && txt.indexOf('"dk":1') > 0; }
  function encodeSecret(obj) {
    if (dek) return encode(obj);
    return deviceKey().then(function (k) {
      if (!k) return JSON.stringify(obj);
      return root.CryptoBox.seal(k, JSON.stringify(obj), { noZip: true }).then(function (b) { return JSON.stringify({ fpEnc: 1, dk: 1, iv: b.iv, ct: b.ct, z: b.z || 0 }); });
    });
  }
  function decodeSecret(txt, key) {
    if (isDk(txt)) return deviceKey().then(function (k) { if (!k) throw new Error('Cihaz anahtarı yok'); return root.CryptoBox.open(k, JSON.parse(txt)).then(function (j) { return JSON.parse(j); }); });
    return decode(txt, key);
  }
  var apiKeys = { ai: {}, twelve: '' }, PRICES_KEY = 'finans-pusulasi:prices';
  function rawState() {
    return idbGet(KEY).catch(function () { return null; }).then(function (v) {
      if (v) return v;
      try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
    });
  }
  function snapKeep() { var n = 10; try { n = parseInt(localStorage.getItem(SNAP_KEEP_KEY) || '10', 10); } catch (e) { /* */ } return n >= 3 && n <= 50 ? n : 10; }

  var Store = {
    setKey: function (k) { dek = k || null; },
    hasKey: function () { return !!dek; },
    isEncText: isEncText,
    /* Kayıtlı veri şifreli mi (kilit ekranı gerekir mi)? */
    isLockedOnDisk: function () { return rawState().then(isEncText); },
    load: function () { return rawState().then(function (v) { return decode(v); }); },
    save: function (state) {
      state.updatedAt = new Date().toISOString();
      return encode(state).then(function (txt) {
        var okLs = false;
        try { localStorage.setItem(LS_KEY, txt); okLs = true; } catch (e) { /* kota dolmuş olabilir */ }
        return idbSet(KEY, txt).then(function () { return true; }, function (e) { if (okLs) return true; throw e; });
      });
    },
    clearAll: function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* */ }
      return idbSet(KEY, '').catch(function () { });
    },
    /* Gizli küçük kayıtlar (eşitleme ayarı, çakışmalar): kilit açıksa şifreli; yedeğe girmez */
    getSecret: function (name) { return idbGet('sec:' + name).catch(function () { return null; }).then(function (v) { return decodeSecret(v); }).catch(function (e) { if (e.code === 'LOCKED') throw e; return null; }); },
    setSecret: function (name, obj) { if (obj == null) return idbDel('sec:' + name).catch(function () { }); return encodeSecret(obj).then(function (t) { return idbSet('sec:' + name, t); }); },
    /* ---------- Anlık görüntüler ---------- */
    snapKeep: snapKeep,
    setSnapKeep: function (n) { try { localStorage.setItem(SNAP_KEEP_KEY, String(n)); } catch (e) { /* */ } return Store.pruneSnapshots(); },
    addSnapshot: function (state, reason, counts) {
      return encode(state).then(function (txt) {
        var rec = { at: new Date().toISOString(), reason: String(reason || 'otomatik').slice(0, 80), counts: counts || null, size: txt.length, enc: isEncText(txt), schema: state && state.schema, data: txt };
        return tx(SNAPS, 'readwrite', function (s) { s.add(rec); });
      }).then(function () { return Store.pruneSnapshots(); });
    },
    listSnapshots: function () {
      return tx(SNAPS, 'readonly', function (s) { return s.getAll(); }).then(function (all) {
        return (all || []).map(function (r) { return { id: r.id, at: r.at, reason: r.reason, counts: r.counts, size: r.size, enc: r.enc, schema: r.schema }; }).sort(function (a, b) { return b.id - a.id; });
      }).catch(function () { return []; });
    },
    getSnapshot: function (id) { return tx(SNAPS, 'readonly', function (s) { return s.get(id); }).then(function (r) { if (!r) throw new Error('Anlık görüntü bulunamadı'); return decode(r.data); }); },
    deleteSnapshot: function (id) { return tx(SNAPS, 'readwrite', function (s) { s.delete(id); }); },
    pruneSnapshots: function () {
      var keep = snapKeep();
      return Store.listSnapshots().then(function (l) { var old = l.slice(keep); if (!old.length) return; return tx(SNAPS, 'readwrite', function (s) { old.forEach(function (r) { s.delete(r.id); }); }); });
    },
    /* Kilit açılırken/kapatılırken/PIN değişirken: tüm kayıtları eski anahtarla aç, yeni anahtarla (veya şifresiz) yeniden yaz */
    rekey: function (newKey) {
      var oldKey = dek;
      return rawState().then(function (v) { return decode(v, oldKey); }).then(function (state) {
        return tx(SNAPS, 'readonly', function (s) { return s.getAll(); }).catch(function () { return []; }).then(function (snaps) {
          return Promise.all((snaps || []).map(function (r) { return decode(r.data, oldKey).then(function (d) { return { r: r, d: d }; }, function () { return { r: r, d: undefined }; }); })).then(function (dec) {
            return tx(STORE, 'readonly', function (s) { return s.getAllKeys(); }).catch(function () { return []; }).then(function (keys) {
              var secKeys = (keys || []).filter(function (k) { return String(k).indexOf('sec:') === 0; });
              return Promise.all(secKeys.map(function (k) { return idbGet(k).then(function (t) { return decodeSecret(t, oldKey); }).then(function (d) { return { k: k, d: d }; }, function () { return { k: k, d: undefined }; }); }));
            }).then(function (secs) {
              dek = newKey || null;
              var jobs = [];
              if (state) jobs.push(Store.save(state));
              dec.forEach(function (x) { if (x.d === undefined) return; jobs.push(encode(x.d).then(function (t) { x.r.data = t; x.r.enc = isEncText(t); x.r.size = t.length; return tx(SNAPS, 'readwrite', function (s) { s.put(x.r); }); })); });
              secs.forEach(function (x) { if (x.d === undefined || x.d === null) return; jobs.push(encodeSecret(x.d).then(function (t) { return idbSet(x.k, t); })); });
              // Eski sürümlerin localStorage'da bıraktığı açık metin kopyalar: anlık görüntüye taşınır (kilit açıksa şifreli), sonra silinir
              if (newKey) { try { Object.keys(localStorage).forEach(function (k) { if (/^finans-pusulasi:(v\d+-oncesi-yedek|okunamayan-kayit-\d+)$/.test(k)) { var o = null; try { o = JSON.parse(localStorage.getItem(k)); } catch (e) { /* */ } if (o) jobs.push(Store.addSnapshot(o, 'Eski kopya (' + k.slice(16) + ')')); localStorage.removeItem(k); } }); } catch (e) { /* */ } }
              return Promise.all(jobs);
            });
          });
        });
      }).catch(function (e) { dek = oldKey; throw e; });
    },
    /* PIN unutuldu: bu cihazdaki tüm uygulama verisini sil (ana veri, anlık görüntüler, gizli kayıtlar) */
    wipeDevice: function () {
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('finans-pusulasi:') === 0) localStorage.removeItem(k); }); } catch (e) { /* */ }
      dek = null;
      return openDb().then(function (db) { return new Promise(function (res) { var t = db.transaction([STORE, SNAPS], 'readwrite'); t.objectStore(STORE).clear(); t.objectStore(SNAPS).clear(); t.oncomplete = res; t.onerror = res; }); }).catch(function () { });
    },
    /* Yapay zekâ ayarları: sağlayıcı/model gibi gizli olmayanlar localStorage'da; API ANAHTARLARI gizli kayıtta ('api-keys'):
     * kilit açıksa PIN anahtarıyla, değilse cihaz anahtarıyla şifreli. Eski sürümlerin localStorage'a yazdığı anahtarlar loadApiKeys'te taşınır. */
    loadAi: function () { var c; try { c = JSON.parse(localStorage.getItem(AI_KEY) || 'null') || {}; } catch (e) { c = {}; } if (!c.keys) c.keys = apiKeys.ai; return c; },
    saveAi: function (cfg) {
      var plain = {}; Object.keys(cfg || {}).forEach(function (k) { if (k !== 'keys') plain[k] = cfg[k]; });
      localStorage.setItem(AI_KEY, JSON.stringify(plain));
      if (cfg && cfg.keys && cfg.keys !== apiKeys.ai) { apiKeys.ai = cfg.keys; }
      return Store.setSecret('api-keys', apiKeys).catch(function (e) { console.error(e); });
    },
    clearAi: function () { localStorage.removeItem(AI_KEY); apiKeys.ai = {}; return Store.setSecret('api-keys', apiKeys); },
    apiKeys: function () { return apiKeys; },
    saveApiKeys: function () { return Store.setSecret('api-keys', apiKeys); },
    /* Açılışta (kilit açıldıktan sonra): gizli anahtarları yükle; eski açık metin anahtarları önce şifreli kayda yaz, SONRA localStorage'dan sil. */
    loadApiKeys: function () {
      return Store.getSecret('api-keys').catch(function () { return null; }).then(function (v) {
        apiKeys = v && typeof v === 'object' ? v : { ai: {}, twelve: '' }; if (!apiKeys.ai || typeof apiKeys.ai !== 'object') apiKeys.ai = {};
        var ai = null, pc = null, moved = false;
        try { ai = JSON.parse(localStorage.getItem(AI_KEY) || 'null'); } catch (e) { ai = null; }
        try { pc = JSON.parse(localStorage.getItem(PRICES_KEY) || 'null'); } catch (e) { pc = null; }
        if (ai && ai.keys && typeof ai.keys === 'object' && Object.keys(ai.keys).length) { Object.keys(ai.keys).forEach(function (k) { if (ai.keys[k] && !apiKeys.ai[k]) apiKeys.ai[k] = ai.keys[k]; }); moved = true; }
        if (pc && pc.twelveKey) { if (!apiKeys.twelve) apiKeys.twelve = pc.twelveKey; moved = true; }
        if (!moved) return apiKeys;
        return Store.setSecret('api-keys', apiKeys).then(function () {
          try { if (ai && ai.keys) { delete ai.keys; localStorage.setItem(AI_KEY, JSON.stringify(ai)); } if (pc && pc.twelveKey) { delete pc.twelveKey; localStorage.setItem(PRICES_KEY, JSON.stringify(pc)); } } catch (e) { /* */ }
          return apiKeys;
        });
      });
    },
    /* Kilit kapalıyken eski sürümlerin açık metin yazdığı gizli kayıtları (eşitleme jetonu/parolası) cihaz anahtarıyla şifrele */
    migrateSecrets: function () {
      return tx(STORE, 'readonly', function (s) { return s.getAllKeys(); }).catch(function () { return []; }).then(function (keys) {
        var sec = (keys || []).filter(function (k) { return String(k).indexOf('sec:') === 0; });
        return Promise.all(sec.map(function (k) { return idbGet(k).then(function (t) { if (!t || isEncText(t)) return; var o; try { o = JSON.parse(t); } catch (e) { return; } return encodeSecret(o).then(function (nt) { return idbSet(k, nt); }); }).catch(function () { }); }));
      });
    },
    /* PIN deneme sayacı: localStorage + IndexedDB'de (ikisinden büyük olan geçerli). Yalnızca localStorage'ı silmek sayacı sıfırlamaz. */
    getFails: function () {
      var ls = null; try { ls = JSON.parse(localStorage.getItem('finans-pusulasi:lock-fails') || 'null'); } catch (e) { ls = null; }
      return idbGet('lockfails').catch(function () { return null; }).then(function (db) {
        var a = ls && typeof ls.n === 'number' ? ls : { n: 0, until: 0 }, b = db && typeof db.n === 'number' ? db : { n: 0, until: 0 };
        return { n: Math.max(a.n, b.n), until: Math.max(a.until || 0, b.until || 0) };
      });
    },
    setFails: function (f) { try { localStorage.setItem('finans-pusulasi:lock-fails', JSON.stringify(f)); } catch (e) { /* */ } return idbSet('lockfails', f).catch(function () { }); },
    /* Kalıcı depolama: tarayıcı yer açmak için verini silmesin */
    persistStatus: function () { var n = root.navigator && navigator.storage; if (!n || !n.persisted) return Promise.resolve(null); return n.persisted().catch(function () { return null; }); },
    requestPersist: function () { var n = root.navigator && navigator.storage; if (!n || !n.persist) return Promise.resolve(null); return n.persisted().then(function (p) { return p || n.persist(); }).catch(function () { return null; }); },
    estimate: function () { var n = root.navigator && navigator.storage; if (!n || !n.estimate) return Promise.resolve(null); return n.estimate().catch(function () { return null; }); },
    download: function (filename, text, mime) {
      var blob = new Blob([text], { type: mime || 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  };
  root.Store = Store;
})(this);
