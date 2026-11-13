/* store.js — Veriler yalnızca bu tarayıcıda: IndexedDB (ana) + localStorage (yedek kopya). API anahtarları ayrı tutulur ve yedeğe girmez. */
(function (root) {
  'use strict';
  var DB = 'finans-pusulasi', STORE = 'kv', KEY = 'state', LS_KEY = 'finans-pusulasi:state', AI_KEY = 'finans-pusulasi:ai';
  function openDb() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) return rej(new Error('IndexedDB yok'));
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function idbGet(k) { return openDb().then(function (db) { return new Promise(function (res, rej) { var r = db.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }); }
  function idbSet(k, v) { return openDb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }

  var Store = {
    load: function () {
      return idbGet(KEY).catch(function () { return null; }).then(function (v) {
        if (v) return JSON.parse(v);
        var ls = null; try { ls = localStorage.getItem(LS_KEY); } catch (e) { /* yok */ }
        return ls ? JSON.parse(ls) : null;
      });
    },
    save: function (state) {
      state.updatedAt = new Date().toISOString();
      var json = JSON.stringify(state), okLs = false;
      try { localStorage.setItem(LS_KEY, json); okLs = true; } catch (e) { /* kota dolmuş olabilir */ }
      return idbSet(KEY, json).then(function () { return true; }, function (e) { if (okLs) return true; throw e; });
    },
    clearAll: function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* */ }
      return idbSet(KEY, '').catch(function () { });
    },
    loadAi: function () { try { return JSON.parse(localStorage.getItem(AI_KEY) || 'null') || {}; } catch (e) { return {}; } },
    saveAi: function (cfg) { localStorage.setItem(AI_KEY, JSON.stringify(cfg)); },
    clearAi: function () { localStorage.removeItem(AI_KEY); },
    download: function (filename, text, mime) {
      var blob = new Blob([text], { type: mime || 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  };
  root.Store = Store;
})(this);
