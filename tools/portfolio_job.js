#!/usr/bin/env node
/* portfolio_job.js — "Arka planda portföyümü izle" iş akışı adımı (v8.2). GitHub Actions'ta çalışır.
 * Kullanım: node tools/portfolio_job.js MD_DIR OUT_DIR
 *   MD_DIR : market-data dalının çıkış kopyası (herkese açık piyasa verisi + önceki şifreli sonuç bg/results.enc.json)
 *   OUT_DIR: yazılacak yeni dosyalar (bg/results.enc.json) — tools/publish.py ile dala yazılır. OUT_DIR/.delete içindeki yollar dalda silinir.
 * Ortam: PORTFOLIO_KEY (Actions sırrı: kurulum dizgesi), GITHUB_TOKEN, NTFY_URL (varsayılan https://ntfy.sh/), BG_GIST_FILE (test: Gist yerine yerel dosya), BG_NO_NET=1 (test).
 * GİZLİLİK: çözülmüş veri yalnızca bu işlemin belleğinde yaşar. Günlüklere yalnızca sayılar yazılır (varlık adı, tutar, anahtar, konu adı YAZILMAZ);
 * sırlar ::add-mask:: ile maskelenir. Portföye özgü sonuçlar yalnızca (1) ntfy ve (2) PORTFOLIO_KEY ile şifrelenmiş bg/results.enc.json'a gider. */
'use strict';
var fs = require('fs'), path = require('path');
var MDDIR = process.argv[2] || 'market-data-out', OUT = process.argv[3] || 'bg-out';
var NONET = process.env.BG_NO_NET === '1', NOW = process.env.BG_NOW ? Date.parse(process.env.BG_NOW) : Date.now();
var REALFETCH = globalThis.fetch;
require('./nodefetch.js').install(MDDIR, { noNet: NONET });
var RP = require('../js/report.js'), SS = require('../js/sessions.js'), BG = require('../js/bgwatch.js'), MD = require('../js/mdata.js'), AN = require('../js/analysis.js'), SN = require('../js/snapshot.js');
var NTFY_URL = process.env.NTFY_URL || 'https://ntfy.sh/', APP = 'https://zurnativi.github.io/finans-pusulasi/';

function mask(v) { if (process.env.GITHUB_ACTIONS && v) console.log('::add-mask::' + String(v).replace(/\r?\n/g, '')); }
function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(MDDIR, rel), 'utf8')); } catch (e) { return null; } }
function writeOut(rel, text) { var p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function log(m) { console.log('[portföy-izleme] ' + m); }

function fetchGist(id) {
  if (process.env.BG_GIST_FILE) { try { return Promise.resolve({ content: fs.readFileSync(process.env.BG_GIST_FILE, 'utf8') }); } catch (e) { return Promise.resolve({ missing: true }); } }
  var base = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'finans-pusulasi-bg' }, tok = process.env.GITHUB_TOKEN;
  function get(auth) { return fetch('https://api.github.com/gists/' + id, { headers: auth && tok ? Object.assign({ Authorization: 'Bearer ' + tok }, base) : base }); }
  return get(true).then(function (r) { return (r.status === 401 || r.status === 403) && tok ? get(false) : r; }).then(function (r) { // Actions belirteci Gist'e yetkili değilse kimliksiz dene (gizli Gist numarasıyla okunur)
    if (r.status === 404) return { missing: true };
    if (!r.ok) throw new Error('Gist okunamadı: HTTP ' + r.status);
    return r.json().then(function (g) {
      var f = g.files && g.files[BG.GIST_FILE]; if (!f) return { missing: true };
      if (!f.truncated && typeof f.content === 'string') return { content: f.content };
      return fetch(f.raw_url).then(function (rr) { if (!rr.ok) throw new Error('Gist dosyası indirilemedi: HTTP ' + rr.status); return rr.text(); }).then(function (t) { return { content: t }; });
    });
  });
}
function sendNtfy(topic, msg, click) {
  var body = { topic: topic, title: msg.title, message: msg.message, priority: msg.priority || 4, tags: ['briefcase'], click: click || APP + '#haberler' };
  if (NONET && !process.env.NTFY_URL) return Promise.reject(new Error('ağ kapalı (test)'));
  return REALFETCH(NTFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'finans-pusulasi-bg' }, body: JSON.stringify(body) }).then(function (r) { if (!r.ok) throw new Error('ntfy HTTP ' + r.status); return true; });
}
function snapFile(key) { return readJson('analysis/' + SN.fileOf(key) + '.json'); }
function snapOf(key) {
  var f = snapFile(key), age = f && f.at ? NOW - Date.parse(f.at) : Infinity;
  if (f && age < 6 * 3600000) return Promise.resolve(f); // herkese açık, taze anlık görüntü (saatlik/günlük iş akışı)
  if (NONET) return Promise.resolve(f || null);
  return SN.analyzeKey(MD, AN, key, new Date(NOW).toISOString()).catch(function () { return f || null; });
}

function main() {
  var setupStr = (process.env.PORTFOLIO_KEY || '').trim();
  if (!setupStr) { log('PORTFOLIO_KEY tanımlı değil: özellik kapalı, yapılacak bir şey yok.'); return Promise.resolve(0); }
  var S; try { S = BG.parseSetup(setupStr); } catch (e) { console.log('::warning::PORTFOLIO_KEY geçersiz: ' + e.message); return Promise.resolve(0); }
  mask(setupStr); mask(BG.b64u(S.key)); mask(S.gist); if (S.topic) mask(S.topic);
  var prevEnv = null; try { prevEnv = JSON.parse(fs.readFileSync(path.join(MDDIR, BG.RESULT_PATH), 'utf8')); } catch (e) { prevEnv = null; }
  var kid, prev = null;
  return BG.kidOf(S.key).then(function (k) { kid = k; return prevEnv ? BG.open(S.key, prevEnv).then(function (p) { prev = p; }, function () { prev = null; }) : null; }).then(function () {
    return fetchGist(S.gist);
  }).then(function (g) {
    if (g.missing) { // kullanıcı izlemeyi kapattı / Gist'i sildi → uzaktaki şifreli sonucu da sil
      fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, '.delete'), BG.RESULT_PATH + '\n'); log('Gist yok (izleme kapatılmış): şifreli sonuç dosyası silinecek.'); return 0;
    }
    var env; try { env = JSON.parse(g.content); } catch (e) { throw new Error('Gist içeriği JSON değil'); }
    var base = { v: BG.VERSION, kid: kid, generatedAt: BG.iso(NOW) };
    function writeRes(res) {
      if (prev && !res.log && prev.log) { res.log = prev.log; res.analysis = res.analysis || prev.analysis; }
      if (prev && !res.stopState && prev.stopState) { res.stopState = prev.stopState; res.stopLog = prev.stopLog; }
      res.kid = kid; res.run = process.env.GITHUB_RUN_ID ? String(process.env.GITHUB_RUN_ID) : null;
      return BG.seal(S.key, res, kid).then(function (e) { writeOut(BG.RESULT_PATH, JSON.stringify(e)); });
    }
    if (env.kid !== kid) { // Actions sırrındaki anahtar uygulamadakiyle aynı değil
      log('Anahtar uyuşmuyor (uygulamadaki ve Actions sırrındaki PORTFOLIO_KEY farklı).');
      return writeRes(Object.assign({}, base, { ok: false, status: 'key_mismatch', payloadKid: env.kid, errors: ['Actions sırrındaki PORTFOLIO_KEY, uygulamadaki anahtarla aynı değil.'] })).then(function () { return 0; });
    }
    return BG.open(S.key, env).then(function (payload) {
      var data = { feed: readJson('news/feed.json'), calendar: readJson('hub/calendar.json'), probs: readJson('hub/probs.json'), macro: readJson('hub/macro.json'), analogs: readJson('hub/analogs.json'), recovery: readJson('hub/recovery.json'), status: readJson('hub/status.json'), alerts: readJson('hub/alerts.json') };
      var opts = { now: NOW, MD: NONET ? { kap: function () { return Promise.resolve({ items: [] }); } } : MD, prev: prev, refresh: !NONET, snapOf: snapOf, quoteOf: function (key, sym) { return NONET ? Promise.reject(new Error('ağ kapalı')) : BG.quote(MD, key, sym); },
        stopQuoteOf: function (a, key, st) { return MD.load(key, {}).then(function (series) { var q = RP.stopQuote({ ok: true, bars: (series.bars || []).filter(function (b) { return b && typeof b.c === 'number'; }), live: series.live || null, hist: series.histSource || null }, SS.marketOfKey(key), NOW, st); if (!q) throw new Error('fiyat yok'); return q; }); } };
      return BG.check(payload, data, opts).then(function (r) {
        var res = Object.assign(base, r.res), topic = S.topic, ntfy = { enabled: !!topic, sent: 0, failed: 0, skippedExample: false };
        res.ntfy = ntfy; res.payloadKid = env.kid; res.device = payload.device || '';
        var jobs = Promise.resolve();
        // a) bekleyen (önceki çalışmada gönderilemeyen) + yeni bildirimler
        var queue = []; (prev && prev.pending || []).forEach(function (p) { if (NOW - p.at < 6 * 3600000 && p.tries < 3) queue.push(p); });
        var itemById = {}; ((res.log && res.log.items) || []).forEach(function (it) { itemById[it.id] = it; });
        (r.deliver || []).forEach(function (it) { if (!queue.some(function (q) { return q.id === it.id; })) queue.push({ id: it.id, at: NOW, tries: 0 }); });
        var pending = [];
        if (payload.isExample) { ntfy.skippedExample = true; queue = []; }
        if (!topic) queue = [];
        queue.slice(0, 6).forEach(function (q) { var it = itemById[q.id]; if (!it) return; jobs = jobs.then(function () { return sendNtfy(topic, BG.pushMessage(it, payload.pushMode), APP + (it.href || '#haberler')).then(function () { ntfy.sent++; }, function () { ntfy.failed++; pending.push({ id: q.id, at: q.at, tries: q.tries + 1 }); }); }); });
        // b) kurulum testi: uygulamadan istenen tek seferlik test bildirimi
        if (payload.testPush && topic && !(prev && prev.testAck && prev.testAck.id === payload.testPush.id)) {
          jobs = jobs.then(function () { return sendNtfy(topic, { title: '✅ Finans Pusulası — zincir çalışıyor', message: 'Arka plan portföy izleme bu bildirimi GitHub Actions üzerinden gönderdi. Uygulamada "Arka plan son kontrol" saatini görebilirsin.', priority: 3 }).then(function () { res.testAck = { id: payload.testPush.id, at: BG.iso(NOW) }; ntfy.sent++; }, function () { ntfy.failed++; }); });
        } else if (prev && prev.testAck) res.testAck = prev.testAck;
        return jobs.then(function () { res.pending = pending; return writeRes(res).then(function () {
          log('durum=' + res.status + ' örnek=' + !!res.isExample + ' kalem=' + (res.positions ? res.positions.length : 0) + ' sağlık=' + (res.health ? res.health.total : '-') + ' görünür_uyarı=' + (res.items ? res.items.length : 0) + ' yeni=' + (res.fresh ? res.fresh.length : 0) + ' ntfy_gönderilen=' + ntfy.sent + ' ntfy_hata=' + ntfy.failed + ' stop=' + (res.stops ? res.stops.length : 0) + ' stop_olay=' + (res.stopEvents ? res.stopEvents.length : 0) + ' fiyat_güncellenen=' + (res.steps && res.steps.prices && res.steps.prices.applied ? res.steps.prices.applied.length : 0) + ' hata=' + (res.errors ? res.errors.length : 0));
          return res.ok ? 0 : 1; }); });
      });
    }, function (e) {
      log('Gist içeriği açılamadı: ' + e.message);
      return writeRes(Object.assign({}, base, { ok: false, status: 'bad_payload', errors: [e.message] })).then(function () { return 1; });
    });
  });
}
if (require.main === module) main().then(function (code) { process.exit(code); }, function (e) { console.log('::error::portföy izleme hatası: ' + String(e && e.message || e).slice(0, 160)); process.exit(1); });
module.exports = { main: main };
