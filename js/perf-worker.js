/* perf-worker.js — v8.9.0: Monte Carlo'yu arayüzü dondurmadan arka planda çalıştırır (perf.js ile aynı kod). */
/* global importScripts, Perf */
importScripts('perf.js' + (self.location.search || ''));
self.onmessage = function (e) {
  var o = e.data || {}, t0 = Date.now();
  try {
    var mc = Perf.monteCarlo({ rp: o.rp, rx: o.rx, months: o.months, paths: o.paths, seed: o.seed, block: o.block, drift: o.drift });
    if (mc.error) { self.postMessage({ id: o.id, error: mc.error }); return; }
    var tr = [mc.A.buffer, mc.B.buffer]; if (mc.X) tr.push(mc.X.buffer, mc.BX.buffer);
    mc.ms = Date.now() - t0; mc.id = o.id; self.postMessage(mc, tr);
  } catch (err) { self.postMessage({ id: o.id, error: String(err && err.message || err) }); }
};
