#!/usr/bin/env node
/* session_report.js — Seans raporları iş akışı adımı (v8.5). GitHub Actions'ta (market-reports.yml) çalışır.
 * Kullanım: node tools/session_report.js MD_DIR OUT_DIR
 *   Hangi rapor? FORCE_SLOT ('auto' | 'bist:pre' | 'us:mid' | 'crypto:post' | tam kimlik 'bist:2026-11-24:post'); yoksa Sessions.dueSlots(şimdi) ve daha önce üretilmemiş olanlar.
 *   1) Herkese açık piyasa raporu (kişisel veri YOK): reports/public/<kimlik>.json + reports/index.json
 *   2) PORTFOLIO_KEY sırrı varsa: şifreli portföyü (gizli Gist) çözer, o seansın varlıkları için tam kişisel rapor üretir; son 12 rapor PORTFOLIO_KEY ile
 *      ŞİFRELENİP bg/reports.enc.json'a yazılır (uygulama cihazda açar). ntfy: kişisel konu (2 satır özet, tutar yok). Yoksa NTFY_TOPIC'e herkese açık özet.
 * GİZLİLİK: düz metin portföy yalnızca bellekte; günlüğe yalnızca sayılar yazılır; sırlar maskelenir. */
'use strict';
var fs = require('fs'), path = require('path');
var ARGS = process.argv.slice(2).filter(function (a) { return a.indexOf('--') !== 0; }), MDDIR = ARGS[0] || 'md', OUT = ARGS[1] || 'reports-out';
var NONET = process.env.BG_NO_NET === '1', NOW = process.env.REPORT_NOW ? Date.parse(process.env.REPORT_NOW) : Date.now();
var REALFETCH = globalThis.fetch;
require('./nodefetch.js').install(MDDIR, { noNet: NONET });
var SS = require('../js/sessions.js'), R = require('../js/report.js'), BG = require('../js/bgwatch.js'), PF = require('../js/portfolio.js'), N = require('../js/news.js');
var MD = require('../js/mdata.js'), AN = require('../js/analysis.js'), SN = require('../js/snapshot.js'), ST = require('../js/stops.js');
var APP = 'https://zurnativi.github.io/finans-pusulasi/', NTFY_URL = process.env.NTFY_URL || 'https://ntfy.sh/', KEEP_PERSONAL = 12, KEEP_PUBLIC = 120;

function log(m) { console.log('[seans-raporu] ' + m); }
function mask(v) { if (process.env.GITHUB_ACTIONS && v) console.log('::add-mask::' + String(v).replace(/\r?\n/g, '')); }
function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(MDDIR, rel), 'utf8')); } catch (e) { return null; } }
function writeOut(rel, o) { var p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o)); }
function fileOf(id) { return 'reports/public/' + id.replace(/:/g, '_') + '.json'; }
function marketsOn() { return ['bist', 'us'].concat(process.env.REPORT_CRYPTO === '1' || (process.env.PORTFOLIO_KEY || '').trim() ? ['crypto'] : []); }
function topicOk(t) { return /^[A-Za-z0-9_-]{8,64}$/.test(t || ''); }
function sendNtfy(topic, msg, click, prio) {
  if (NONET && !process.env.NTFY_URL) return Promise.reject(new Error('ağ kapalı (test)'));
  var body = { topic: topic, title: msg.title.slice(0, 120), message: msg.message.slice(0, 400), priority: prio || 3, tags: ['bar_chart'], click: click };
  return REALFETCH(NTFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'finans-pusulasi-reports' }, body: JSON.stringify(body) }).then(function (r) { if (!r.ok) throw new Error('ntfy HTTP ' + r.status); return true; });
}

/* Hangi raporlar? */
function pickSlots(index) {
  var f = (process.env.FORCE_SLOT || '').trim().toLowerCase();
  if (f && f !== 'auto') {
    var full = SS.parseId(f); if (full) return [full];
    var m = /^(bist|us|crypto):(pre|mid|post)$/.exec(f); if (!m) { console.log('::warning::FORCE_SLOT geçersiz: ' + f); return []; }
    var ymd = SS.localYmd(m[1], NOW), s = SS.sessionOf(m[1], ymd);
    for (var i = 0; !s && i < 10; i++) { ymd = SS.addDays(ymd, -1); s = SS.sessionOf(m[1], ymd); } // tatil/hafta sonu → son işlem günü
    return s ? s.slots.filter(function (x) { return x.slot === m[2]; }) : [];
  }
  var done = {}; ((index && index.items) || []).forEach(function (it) { done[it.id] = 1; });
  return SS.dueSlots(NOW, { markets: marketsOn() }).filter(function (s) { return !done[s.id]; });
}

function fetchGist(id) {
  var base = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'finans-pusulasi-reports' }, tok = process.env.GITHUB_TOKEN;
  function get(auth) { return REALFETCH('https://api.github.com/gists/' + id, { headers: auth && tok ? Object.assign({ Authorization: 'Bearer ' + tok }, base) : base }); }
  if (process.env.BG_GIST_FILE) { try { return Promise.resolve({ content: fs.readFileSync(process.env.BG_GIST_FILE, 'utf8') }); } catch (e) { return Promise.resolve({ missing: true }); } }
  return get(true).then(function (r) { return (r.status === 401 || r.status === 403) && tok ? get(false) : r; }).then(function (r) {
    if (r.status === 404) return { missing: true }; if (!r.ok) throw new Error('Gist okunamadı: HTTP ' + r.status);
    return r.json().then(function (g) { var f = g.files && g.files[BG.GIST_FILE]; if (!f) return { missing: true }; if (!f.truncated && typeof f.content === 'string') return { content: f.content }; return REALFETCH(f.raw_url).then(function (x) { return x.text(); }).then(function (t) { return { content: t }; }); });
  });
}
function personalSetup() {
  var s = (process.env.PORTFOLIO_KEY || '').trim(); if (!s) return Promise.resolve(null);
  var S; try { S = BG.parseSetup(s); } catch (e) { console.log('::warning::PORTFOLIO_KEY geçersiz: ' + e.message); return Promise.resolve(null); }
  mask(s); mask(BG.b64u(S.key)); mask(S.gist); if (S.topic) mask(S.topic);
  return BG.kidOf(S.key).then(function (kid) {
    return fetchGist(S.gist).then(function (g) {
      if (g.missing) { log('Gist yok (izleme kapalı): kişisel rapor üretilmez.'); return { S: S, kid: kid, payload: null }; }
      var env = JSON.parse(g.content); if (env.kid !== kid) { log('Anahtar uyuşmuyor: kişisel rapor üretilmez.'); return { S: S, kid: kid, payload: null, mismatch: true }; }
      return BG.open(S.key, env).then(function (p) { return { S: S, kid: kid, payload: p }; });
    });
  }).catch(function (e) { log('kişisel veri alınamadı: ' + String(e.message || e).slice(0, 100)); return null; });
}

function main() {
  var index = readJson('reports/index.json') || { v: 1, items: [] }, slots = pickSlots(index);
  if (!slots.length) { log('Şu an üretilecek rapor yok (' + SS.fmtTsiFull(NOW) + ' TSİ).'); return Promise.resolve(0); }
  var data = { macro: readJson('hub/macro.json'), calendar: readJson('hub/calendar.json'), scenarios: readJson('hub/scenarios.json'), probs: readJson('hub/probs.json'), alerts: readJson('hub/alerts.json'), feed: readJson('news/feed.json') };
  var gaps0 = []; ['macro', 'calendar', 'scenarios', 'feed'].forEach(function (k) { if (!data[k]) gaps0.push('Veri dosyası okunamadı: ' + k); else if (data[k].generatedAt && NOW - Date.parse(data[k].generatedAt) > 36 * 3600000) gaps0.push(k + ' verisi ' + Math.round((NOW - Date.parse(data[k].generatedAt)) / 3600000) + ' saat eski'); });
  var status = { job: 'reports', generatedAt: new Date(NOW).toISOString(), slots: [], personal: 'off', ntfy: { sent: 0, failed: 0 } };
  return personalSetup().then(function (P) {
    status.personal = !P ? 'off' : P.mismatch ? 'key_mismatch' : !P.payload ? 'no_payload' : P.payload.isExample ? 'example' : 'on';
    var prevPersonal = null, jobs = Promise.resolve(), newPersonal = [];
    var prevEnv = readJson('bg/reports.enc.json');
    var ready = P && P.payload && !P.payload.isExample ? (prevEnv ? BG.open(P.S.key, prevEnv).then(function (x) { prevPersonal = x; }, function () { prevPersonal = null; }) : Promise.resolve()) : Promise.resolve();
    return ready.then(function () {
      slots.forEach(function (sl) {
        jobs = jobs.then(function () {
          var personalOn = P && P.payload && !P.payload.isExample;
          if (sl.market === 'crypto' && process.env.REPORT_CRYPTO !== '1' && !(personalOn && R.holdingsFor(BG, PF, P.payload.state, SS.tsiYmd(NOW), 'crypto').length)) {
            index.items = [{ id: sl.id, market: sl.market, slot: sl.slot, ymd: sl.ymd, skipped: 'Elinde kripto yok' }].concat((index.items || []).filter(function (x) { return x.id !== sl.id; })).slice(0, KEEP_PUBLIC);
            status.slots.push({ id: sl.id, skipped: true }); return null;
          }
          var pub = R.buildPublic({ slot: sl, nowMs: NOW, calendar: data.calendar, scenarios: data.scenarios, probs: data.probs, macro: data.macro, alerts: data.alerts, feed: data.feed, gaps: gaps0, origin: 'actions' });
          writeOut(fileOf(sl.id), pub);
          index.items = [{ id: sl.id, market: sl.market, slot: sl.slot, ymd: sl.ymd, slotAt: pub.slotAt, generatedAt: pub.generatedAt, file: fileOf(sl.id), title: pub.summary.headline.title, line1: pub.summary.headline.line1 }].concat((index.items || []).filter(function (x) { return x.id !== sl.id; })).slice(0, KEEP_PUBLIC);
          var st = { id: sl.id, public: true, personal: null };
          status.slots.push(st);
          if (!(P && P.payload && !P.payload.isExample)) {
            var t = process.env.NTFY_TOPIC || '';
            if (topicOk(t) && !process.env.NO_PUSH) return sendNtfy(t, R.pushText(pub), APP + '#raporlar', 3).then(function () { status.ntfy.sent++; }, function () { status.ntfy.failed++; });
            return null;
          }
          var state = P.payload.state, today = SS.tsiYmd(NOW), hold = R.holdingsFor(BG, PF, state, today, sl.market);
          if (!hold.length) { st.personal = 'no_holdings'; return null; }
          var allHold = BG.holdingsOf(BG.calcOf(state, today, today.slice(0, 7)));
          return (NONET ? Promise.resolve([]) : BG.kapItems(MD, allHold)).then(function (kap) {
            var news = N.process(((data.feed && data.feed.items) || []).concat(kap), allHold, NOW);
            return R.generate({ MD: MD, AN: AN, SN: SN, now: NOW }, { slot: sl, nowMs: NOW, holdings: hold, news: news, calendar: data.calendar, scenarios: data.scenarios, probs: data.probs, macro: data.macro, alerts: data.alerts, gaps: gaps0, feedAt: data.feed && data.feed.generatedAt, origin: 'actions' });
          }).then(function (rep) {
            newPersonal.push(rep); st.personal = 'ok'; st.assets = rep.assets.length; st.gaps = rep.gaps.length;
            if (P.S.topic && !process.env.NO_PUSH) {
              var msg = R.pushText(rep); msg = { title: BG.redact(msg.title), message: BG.redact(msg.message) };
              return sendNtfy(P.S.topic, msg, APP + '#raporlar/' + encodeURIComponent(rep.id), rep.summary.stopsNear.some(function (s) { return s.level === 'hit'; }) ? 5 : 3).then(function () { status.ntfy.sent++; }, function () { status.ntfy.failed++; });
            }
          }, function (e) { st.personal = 'error'; log('kişisel rapor hatası: ' + String(e && e.message || e).slice(0, 120)); });
        });
      });
      return jobs;
    }).then(function () {
      writeOut('reports/index.json', Object.assign({ v: 1, generatedAt: new Date(NOW).toISOString(), note: 'Herkese açık seans raporları (kişisel veri yok). Kişisel raporlar bg/reports.enc.json içinde şifreli.' }, { items: index.items }));
      var w = Promise.resolve();
      if (newPersonal.length) {
        var items = newPersonal.concat(((prevPersonal && prevPersonal.items) || []).filter(function (x) { return !newPersonal.some(function (n) { return n.id === x.id; }); })).slice(0, KEEP_PERSONAL);
        w = BG.seal(P.S.key, { v: 1, kind: 'reports', generatedAt: new Date(NOW).toISOString(), items: items }, P.kid).then(function (env) { writeOut('bg/reports.enc.json', env); });
      }
      return w.then(function () {
        writeOut('status/reports.json', status);
        log('üretilen=' + status.slots.length + ' kişisel=' + status.personal + ' kişisel_rapor=' + newPersonal.length + ' ntfy_gönderilen=' + status.ntfy.sent + ' ntfy_hata=' + status.ntfy.failed);
        return 0;
      });
    });
  });
}
/* --check: dal indirilmeden önce hızlı karar (yalnız reports/index.json ağdan okunur). Çıktı: GITHUB_OUTPUT'a due=1|0 */
function check() {
  var f = (process.env.FORCE_SLOT || '').trim().toLowerCase();
  function out(d, why) { log((d ? 'Rapor zamanı: ' : 'Rapor zamanı değil: ') + why); if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'due=' + (d ? 1 : 0) + '\n'); return 0; }
  if (f && f !== 'auto') return Promise.resolve(out(true, 'elle istendi (' + f + ')'));
  var due = SS.dueSlots(NOW, { markets: marketsOn() }); if (!due.length) return Promise.resolve(out(false, SS.fmtTsiFull(NOW) + ' TSİ'));
  return REALFETCH('https://raw.githubusercontent.com/zurnativi/finans-pusulasi/market-data/reports/index.json?t=' + NOW, { headers: { 'Cache-Control': 'no-cache' } }).then(function (r) { return r.ok ? r.json() : { items: [] }; }, function () { return { items: [] }; })
    .then(function (ix) { var done = {}; (ix.items || []).forEach(function (x) { done[x.id] = 1; }); var todo = due.filter(function (s) { return !done[s.id]; }); return out(todo.length > 0, todo.length ? todo.map(function (s) { return s.id; }).join(', ') : 'zaten üretilmiş (' + due.map(function (s) { return s.id; }).join(', ') + ')'); });
}
if (require.main === module && process.argv.indexOf('--check') > 0) check().then(function (c) { process.exit(c); });
else if (require.main === module) main().then(function (c) { process.exit(c); }, function (e) { console.log('::error::seans raporu hatası: ' + String(e && e.message || e).slice(0, 200)); process.exit(1); });
module.exports = { main: main, pickSlots: pickSlots, check: check };
