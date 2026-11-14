/* sync.js — Cihazlar arası UÇTAN UCA ŞİFRELİ eşitleme. Sunucu yok, ücret yok.
 * Depo: kullanıcının kendi GitHub hesabında GİZLİ (secret) bir Gist. Tarayıcı api.github.com'a doğrudan bağlanır (CORS açık).
 * Buluta giden tek şey, eşitleme parolasıyla (PBKDF2 600.000 tur + AES-256-GCM) şifrelenmiş zarf. GitHub dahil kimse içeriği okuyamaz.
 * Anahtar (token) ve eşitleme parolası yalnızca bu cihazda (kilit açıksa şifreli) saklanır; yedek dosyasına ve buluta asla girmez. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cryptobox.js'), require('./syncmerge.js'));
  else root.Sync = factory(root.CryptoBox, root.SyncMerge);
})(typeof self !== 'undefined' ? self : this, function (CB, SM) {
  'use strict';
  var FILE = 'finans-pusulasi.sifreli.json', API = 'https://api.github.com';
  var TOKEN_URL_CLASSIC = 'https://github.com/settings/tokens/new?scopes=gist&description=Finans%20Pusulasi%20esitleme';
  var TOKEN_URL_FINE = 'https://github.com/settings/personal-access-tokens/new';

  function httpError(status, body, what) {
    var m = body && body.message ? String(body.message) : '';
    var msg = status === 401 ? 'GitHub anahtarı geçersiz veya süresi dolmuş. Yeni anahtar oluşturup yapıştır.'
      : status === 403 && /rate limit/i.test(m) ? 'GitHub istek sınırı doldu; birkaç dakika sonra tekrar dene.'
      : status === 403 || status === 404 ? 'Anahtarın Gist izni yok ya da eşitleme dosyası silinmiş (' + (what || '') + '). Anahtarı "gist" izniyle oluştur.'
      : status === 422 ? 'GitHub isteği reddetti: ' + m
      : 'GitHub hatası (' + status + ')' + (m ? ': ' + m : '');
    var e = new Error(msg); e.status = status; return e;
  }
  /* GitHub Gist istemcisi. fetchFn test için değiştirilebilir. */
  function GistClient(token, fetchFn) {
    var f = fetchFn || (typeof fetch === 'function' ? fetch.bind(typeof self !== 'undefined' ? self : globalThis) : null);
    if (!f) throw new Error('Bu tarayıcı ağ isteği (fetch) desteklemiyor');
    function req(method, path, body) {
      var h = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' };
      if (body) h['Content-Type'] = 'application/json';
      return f(API + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }).then(function (r) {
        if (r.status === 204) return null;
        return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* */ } if (!r.ok) throw httpError(r.status, j, path.split('?')[0]); return j; });
      }, function () { throw new Error('GitHub\'a bağlanılamadı. İnternet bağlantını kontrol et.'); });
    }
    function contentOf(g) {
      var file = g && g.files && g.files[FILE]; if (!file) return Promise.resolve(null);
      if (!file.truncated && typeof file.content === 'string') return Promise.resolve(file.content);
      return f(file.raw_url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Büyük eşitleme dosyası indirilemedi (' + r.status + ')'); return r.text(); });
    }
    return {
      user: function () { return req('GET', '/user').then(function (u) { return { login: u && u.login }; }); },
      find: function () {
        var page = 1;
        function next() { return req('GET', '/gists?per_page=100&page=' + page).then(function (list) { var g = (list || []).find(function (x) { return x.files && x.files[FILE]; }); if (g) return g.id; if (!list || list.length < 100 || page >= 10) return null; page++; return next(); }); }
        return next();
      },
      read: function (id) { return req('GET', '/gists/' + encodeURIComponent(id)).then(function (g) { return contentOf(g).then(function (c) { return { content: c, updatedAt: g.updated_at, version: g.history && g.history[0] ? g.history[0].version : null }; }); }); },
      create: function (content) { var files = {}; files[FILE] = { content: content }; return req('POST', '/gists', { description: 'Finans Pusulası — uçtan uca şifreli eşitleme dosyası (parola olmadan okunamaz)', public: false, files: files }).then(function (g) { if (g.public) throw new Error('Gist gizli oluşturulamadı'); return { id: g.id, updatedAt: g.updated_at }; }); },
      update: function (id, content) { var files = {}; files[FILE] = { content: content }; return req('PATCH', '/gists/' + encodeURIComponent(id), { files: files }).then(function (g) { return { id: g.id, updatedAt: g.updated_at }; }); },
      remove: function (id) { return req('DELETE', '/gists/' + encodeURIComponent(id)); }
    };
  }
  function parseEnvelope(content) {
    var env; try { env = JSON.parse(content); } catch (e) { throw new Error('Buluttaki eşitleme dosyası okunamadı (bozuk)'); }
    if (!CB.isEnvelope(env)) throw new Error('Buluttaki dosya Finans Pusulası şifreli verisi değil');
    return env;
  }
  function seal(state, pass, keyCache, device) {
    return CB.encryptJson(state, pass, { keyCache: keyCache, meta: { app: 'Finans Pusulası', savedAt: new Date().toISOString(), device: device || '' } }).then(function (env) { return JSON.stringify(env); });
  }
  /* Tek eşitleme turu.
   * o: { local, cfg:{token,pass,gistId,lastSyncAt,device}, client, validate(state)→state, keyCache, mode:'auto'|'merge'|'pull'|'push', startMs }
   * Dönüş: { action, state (yeni yerel durum veya null), pushed, conflicts, gistId, stats, remoteDevice } */
  function run(o) {
    var cfg = o.cfg, client = o.client, mode = o.mode || 'auto', startMs = o.startMs || Date.now();
    var local = JSON.parse(JSON.stringify(o.local));
    function push(state, action, extra) {
      return seal(state, cfg.pass, o.keyCache, cfg.device).then(function (content) {
        return (cfg.gistId ? client.update(cfg.gistId, content) : client.create(content)).then(function (r) {
          var out = { action: action, state: null, pushed: true, conflicts: [], gistId: r.id, stats: null, lastSyncAt: startMs, bytes: content.length };
          if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
          return out;
        });
      });
    }
    var idP = cfg.gistId ? Promise.resolve(cfg.gistId) : client.find();
    return idP.then(function (id) {
      cfg.gistId = id || null;
      if (!id) { if (mode === 'pull') throw new Error('Bulutta henüz eşitleme dosyası yok. Önce verinin olduğu cihazda eşitlemeyi kur.'); return push(local, 'created'); }
      return client.read(id).then(function (rd) {
        if (!rd.content) { if (mode === 'pull') throw new Error('Buluttaki eşitleme dosyası boş'); return push(local, 'created'); }
        var env = parseEnvelope(rd.content);
        return CB.decryptJson(env, cfg.pass, o.keyCache).catch(function () { throw new Error('Eşitleme parolası buluttaki veriyi açamadı. Diğer cihazda kullandığın parolanın aynısını yaz.'); }).then(function (remoteRaw) {
          var remote = o.validate(remoteRaw); // eski sürüm verisi yeni şemaya taşınır; daha yeni sürüm ise hata
          var m = mode;
          if (m === 'auto') {
            if (!cfg.lastSyncAt && local.isExample) m = 'pull'; // bu cihazda yalnızca örnek veri var: örnek veri buluttakine asla karışmaz
            else if (!cfg.lastSyncAt && remote.isExample && !local.isExample) m = 'push';
            else m = 'merge';
          }
          if (m === 'push') return push(local, 'pushed-replace');
          if (m === 'pull') {
            var view = local.settings && local.settings.view; if (view && remote.settings) remote.settings.view = view;
            return { action: 'pulled-replace', state: remote, pushed: false, conflicts: [], gistId: id, stats: null, lastSyncAt: startMs, remoteDevice: env.device || '' };
          }
          var mg = SM.merge(local, remote, cfg.lastSyncAt || 0, startMs), merged;
          try { merged = o.validate(JSON.parse(JSON.stringify(mg.state))); merged._sync = mg.state._sync; }
          catch (e) { var er = new Error('Birleştirilen veri doğrulanamadı, hiçbir şey değiştirilmedi: ' + e.message); er.code = 'MERGE_INVALID'; throw er; }
          var res = { action: 'merged', state: mg.changedLocal ? merged : null, pushed: false, conflicts: mg.conflicts, gistId: id, stats: mg.stats, lastSyncAt: startMs, remoteDevice: env.device || '' };
          if (!mg.needPush) return res;
          return seal(merged, cfg.pass, o.keyCache, cfg.device).then(function (content) { return client.update(id, content).then(function () { res.pushed = true; res.bytes = content.length; return res; }); });
        });
      });
    });
  }
  return { FILE: FILE, API: API, TOKEN_URL_CLASSIC: TOKEN_URL_CLASSIC, TOKEN_URL_FINE: TOKEN_URL_FINE, GistClient: GistClient, run: run, parseEnvelope: parseEnvelope, httpError: httpError };
});
