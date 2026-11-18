#!/usr/bin/env node
/* scenarios.js — Olay senaryo özeti (v8.1). Tarayıcıdaki js/events.js aynen kullanılır; yalnız genel (portföysüz) çıktı üretir:
 * önümüzdeki 21 gündeki olaylar → beklenti, SADECE gerçek kaynaktan olasılık (yoksa null), senaryo başına varlık grubu etkisi, önde giden senaryo.
 * Portföy payı kullanıcının cihazında hesaplanır (burada portföy yok). Kullanım: node tools/scenarios.js OUT_DIR */
'use strict';
var fs = require('fs'), path = require('path'), EV = require('../js/events.js');
var OUT = process.argv[2] || 'market-data-out', NOW = Date.parse(process.env.SCENARIOS_NOW || new Date().toISOString());
function rj(rel) { try { return JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8')); } catch (e) { return null; } }
function build(cal, probs, nowMs) {
  var d = { calendar: cal, probs: probs }, evs = EV.upcoming(cal, nowMs, 21).filter(function (e) { return e.daysLeft >= 0 && e.ti && (e.impact === 'high' || e.type !== 'data'); }), out = [];
  evs.forEach(function (ev) {
    var pr = EV.probsFor(ev, d), exp = EV.expectation(ev, d);
    var sc = (ev.ti.scen || []).map(function (s) {
      var p = EV.probOfScenario(s, pr);
      return { id: s.id, label: s.label, code: s.code, prob: p == null ? null : Math.round(p * 1000) / 1000, effects: Object.keys(s.effects || {}).filter(function (g) { return s.effects[g].d !== 'flat'; }).map(function (g) { return { group: g, dir: s.effects[g].d }; }) };
    });
    var lead = sc.filter(function (s) { return s.prob != null; }).sort(function (a, b) { return b.prob - a.prob; })[0] || null;
    out.push({ id: ev.id, type: ev.type, label: ev.ti.label, title: ev.title, date: ev.date, time: ev.time || null, daysLeft: ev.daysLeft, impact: ev.impact || null, kind: ev.kind,
      expectation: exp ? { text: exp.text, kind: exp.kind, src: exp.src } : null,
      probs: pr ? { source: pr.source, kind: pr.kind, url: pr.url, by: pr.by, note: pr.note } : null,
      probsNote: pr ? null : 'Bu olay için güvenilir bir olasılık kaynağı yok; sayı gösterilmez.', scenarios: sc, leading: lead ? { id: lead.id, label: lead.label, prob: lead.prob } : null });
  });
  var pol = ((probs && probs.items) || []).filter(function (p) { return EV.POLITICS[p.id]; }).map(function (p) { return { id: p.id, label: EV.POLITICS[p.id].label, question: p.question, source: p.source, url: p.url, outcomes: (p.outcomes || []).map(function (o) { return { label: o.label, p: o.p }; }) }; });
  return { generatedAt: new Date(nowMs).toISOString(), horizonDays: 21, events: out, politics: pol, method: 'Olasılıklar yalnızca Kalshi/Polymarket piyasa fiyatından; TCMB kararı için olasılık gösterilmez (anket/dağılım ayrı). Etki yönleri belgeli şablonlardır, tahmin değildir.' };
}
if (require.main === module) {
  var cal = rj('hub/calendar.json'), probs = rj('hub/probs.json');
  if (!cal) { console.error('takvim yok'); process.exit(0); }
  var o = build(cal, probs, NOW); fs.mkdirSync(path.join(OUT, 'hub'), { recursive: true }); fs.writeFileSync(path.join(OUT, 'hub/scenarios.json'), JSON.stringify(o));
  console.log('scenarios', o.events.length, 'olay', o.politics.length, 'siyasi', o.events.filter(function (e) { return e.probs; }).length, 'olasılıklı');
}
module.exports = { build: build };
