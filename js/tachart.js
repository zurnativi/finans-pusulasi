/* tachart.js — Profesyonel fiyat grafiği (ECharts): mumlar/çizgi, hacim veya osilatör paneli, göstergeler ve analizden çıkan yapı:
 * destek/direnç bölgeleri, trend çizgileri ve kanal, zikzak salınımları, Fibonacci, formasyonlar, uyumsuzluklar, giriş/stop/hedef seviyeleri.
 * Çizilen her şey Analysis.analyze çıktısından gelir (grafik kendisi hesap yapmaz → ekranda görülen ile skor/plan aynı veriye dayanır). */
(function () {
  'use strict';
  var num = function (v) { return typeof v === 'number' && isFinite(v); };
  var RANGES = { '3A': 63, '6A': 126, '1Y': 252, '2Y': 504, 'Tümü': 1e9 };
  function fmt(x) { if (!num(x)) return '—'; var a = Math.abs(x); return x.toLocaleString('tr-TR', { minimumFractionDigits: a >= 1000 ? 0 : 2, maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 2 : 6 }); }
  function addBusinessDays(ymd, n) { var p = ymd.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), out = []; while (out.length < n) { d.setUTCDate(d.getUTCDate() + 1); var w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10)); } return out; }
  function build(A, view, t) {
    var C = window.Charts, hexA = C.hexA, col = A.col, I = A.ind, n = col.c.length, closeOnly = A.closeOnly, up = t.dark ? '#3fb27f' : '#16794c', dn = t.dark ? '#ff6b6b' : '#c0392b';
    var ov = view.overlays || {}, lower = view.lower || 'volume', small = (t.width || 900) < 560;
    var fut = I.ichimoku && ov.ichimoku ? addBusinessDays(col.d[n - 1], I.ichimoku.shift) : [];
    var dates = col.d.concat(fut), N = dates.length;
    // Gelecek tarihler (Ichimoku bulutu) için boşluk: ECharts'ta '-' (null, mum/çubuk öğesinde hata verir)
    var pad = function (arr) { return arr.concat(fut.map(function () { return '-'; })); };
    var span = Math.min(n, RANGES[view.range] || 252), startPct = Math.max(0, (n - span) / N * 100);
    var series = [], legend = [];
    // Ana fiyat serisi
    var main = closeOnly ? { name: 'Fiyat', type: 'line', data: pad(col.c), showSymbol: false, lineStyle: { width: 2, color: t.brand }, itemStyle: { color: t.brand }, z: 5 }
      : { name: 'Fiyat', type: 'candlestick', data: pad(col.c.map(function (c, i) { return [col.o[i], c, col.l[i], col.h[i]]; })), itemStyle: { color: up, color0: dn, borderColor: up, borderColor0: dn }, barMaxWidth: 12, z: 5 };
    main.markArea = { silent: true, data: [] }; main.markLine = { symbol: ['none', 'none'], silent: true, animation: false, data: [] }; main.markPoint = { data: [], animation: false };
    series.push(main);
    function line(name, data, color, opts) { opts = opts || {}; series.push({ name: name, type: 'line', data: pad(data), showSymbol: false, smooth: false, connectNulls: false, lineStyle: { width: opts.w || 1.4, color: color, type: opts.dash ? 'dashed' : 'solid', opacity: opts.op || 1 }, itemStyle: { color: color }, z: opts.z || 4, xAxisIndex: 0, yAxisIndex: 0, emphasis: { disabled: true } }); legend.push(name); }
    if (ov.ma) { line('SMA 20', I.sma20, t.pal[2]); line('SMA 50', I.sma50, t.pal[4]); line('SMA 200', I.sma200, t.pal[0], { w: 2 }); }
    if (ov.bb) { line('Bollinger üst', I.bb.upper, t.muted, { dash: true }); line('Bollinger alt', I.bb.lower, t.muted, { dash: true }); }
    if (ov.vwap && I.vwap) line('VWAP (son dipten)', I.vwap, t.pal[6], { w: 1.6 });
    if (ov.supertrend && I.supertrend) {
      var stU = I.supertrend.line.map(function (v, i) { return I.supertrend.dir[i] === 1 ? v : null; }), stD = I.supertrend.line.map(function (v, i) { return I.supertrend.dir[i] === -1 ? v : null; });
      line('Supertrend ↑', stU, up, { w: 2 }); line('Supertrend ↓', stD, dn, { w: 2 });
    }
    if (ov.ichimoku && I.ichimoku) {
      var ic = I.ichimoku, A_ = ic.senkouA.concat(ic.futureA), B_ = ic.senkouB.concat(ic.futureB);
      var base = A_.map(function (a, i) { return num(a) && num(B_[i]) ? Math.min(a, B_[i]) : null; });
      var g = A_.map(function (a, i) { return num(a) && num(B_[i]) ? (a >= B_[i] ? a - B_[i] : 0) : null; }), r = A_.map(function (a, i) { return num(a) && num(B_[i]) ? (a < B_[i] ? B_[i] - a : 0) : null; });
      // Bulut: görünmez taban (min(A,B)) + kalınlık; A≥B iken yeşil, A<B iken kırmızı (aynı yığında biri her zaman 0)
      series.push({ name: 'Bulut taban', type: 'line', data: base, stack: 'ichi', showSymbol: false, lineStyle: { opacity: 0 }, silent: true, z: 1, tooltip: { show: false } });
      series.push({ name: 'Bulut (yükseliş)', type: 'line', data: g, stack: 'ichi', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: hexA(up, 0.18) }, silent: true, z: 1, tooltip: { show: false } });
      series.push({ name: 'Bulut (düşüş)', type: 'line', data: r, stack: 'ichi', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: hexA(dn, 0.16) }, silent: true, z: 1, tooltip: { show: false } });
      line('Tenkan', ic.tenkan, t.pal[5], { w: 1.1 }); line('Kijun', ic.kijun, t.pal[3], { w: 1.3 });
    }
    // Yapı: bölgeler, trend çizgileri, kanal, zikzak
    if (ov.structure) {
      // Kalabalığı önlemek için: fiyatın içinde olduğu bölge + en yakın 3 destek + en yakın 3 direnç (ayrıntı Grafik yapısı tablosunda)
      var inside = A.zones.filter(function (z) { return z.lo <= A.price && z.hi >= A.price; });
      var below = A.zones.filter(function (z) { return z.hi < A.price; }).sort(function (a, b) { return b.hi - a.hi; }).slice(0, 3);
      var above = A.zones.filter(function (z) { return z.lo > A.price; }).sort(function (a, b) { return a.lo - b.lo; }).slice(0, 3);
      var near = inside.concat(below, above);
      near.forEach(function (z) {
        var sup = z.hi < A.price || (z.role === 'inside' && z.mid < A.price), c = sup ? up : z.role === 'inside' ? t.medium : dn;
        main.markArea.data.push([{ yAxis: z.lo, itemStyle: { color: hexA(c, z.touches >= 3 || z.extreme ? 0.16 : 0.08), borderColor: hexA(c, 0.35), borderWidth: 0.5 }, label: { show: !small, position: 'insideRight', color: c, fontSize: 10, formatter: (sup ? 'D ' : z.role === 'inside' ? '' : 'R ') + z.touches + '×' } }, { yAxis: z.hi }]);
      });
      ['support', 'resistance'].forEach(function (k) {
        var L = A.trendlines[k]; if (!L) return; var c = k === 'support' ? up : dn;
        main.markLine.data.push([{ coord: [col.d[L.a.i], L.a.p], lineStyle: { color: c, width: 2, type: 'solid' }, label: { show: !small, formatter: (k === 'support' ? 'Trend desteği ' : 'Trend direnci ') + L.touches + '×', color: c, fontSize: 10, position: 'insideEndBottom' } }, { coord: [col.d[n - 1], L.value] }]);
      });
      var ch = A.trendlines.channelFromSupport; if (ch && ch.valid && A.trendlines.support) { var L2 = A.trendlines.support; main.markLine.data.push([{ coord: [col.d[L2.a.i], L2.a.p + ch.offset], lineStyle: { color: up, width: 1, type: 'dashed' }, label: { show: false } }, { coord: [col.d[n - 1], L2.value + ch.offset] }]); }
      var zd = col.c.map(function () { return null; }); A.swings.forEach(function (s) { zd[s.i] = s.p; });
      series.push({ name: 'Zikzak (salınımlar)', type: 'line', data: pad(zd), connectNulls: true, showSymbol: true, symbol: 'circle', symbolSize: 4, lineStyle: { width: 1, color: t.muted, type: 'dotted' }, itemStyle: { color: t.muted }, z: 3, emphasis: { disabled: true } });
      legend.push('Zikzak (salınımlar)');
    }
    if (ov.fib && A.fib) {
      var F = A.fib; [{ r: 0, p: F.to.p }].concat(F.retr).concat([{ r: 1, p: F.from.p }]).forEach(function (x) {
        main.markLine.data.push([{ coord: [col.d[Math.min(F.from.i, F.to.i)], x.p], lineStyle: { color: t.pal[2], width: 1, type: [4, 3], opacity: 0.8 }, label: { show: !small, position: 'end', formatter: 'Fib ' + (x.r * 100).toFixed(1).replace('.0', '').replace('.', ',') + '%', color: t.pal[2], fontSize: 10 } }, { coord: [col.d[n - 1], x.p] }]);
      });
      if (F.up) F.ext.slice(0, 2).forEach(function (x) { main.markLine.data.push([{ coord: [col.d[F.to.i], x.p], lineStyle: { color: t.pal[2], width: 1, type: 'dotted' }, label: { show: !small, position: 'end', formatter: 'Fib uzantı ' + String(x.r).replace('.', ','), color: t.pal[2], fontSize: 10 } }, { coord: [col.d[n - 1], x.p] }]); });
    }
    if (ov.patterns) {
      A.patterns.forEach(function (p) {
        var c = p.dir > 0 ? up : p.dir < 0 ? dn : t.medium, pts = p.points || [];
        for (var k = 1; k < pts.length; k++) main.markLine.data.push([{ coord: [col.d[pts[k - 1].i], pts[k - 1].p], lineStyle: { color: c, width: 2, type: 'solid' }, label: { show: k === pts.length - 1 && !small, formatter: p.name + ' (' + p.status + ', %' + p.conf + ')', color: c, fontSize: 11, position: 'end' } }, { coord: [col.d[pts[k].i], pts[k].p] }]);
        if (num(p.neckline) && pts.length) main.markLine.data.push([{ coord: [col.d[pts[0].i], p.neckA ? p.neckA.p : p.neckline], lineStyle: { color: c, width: 1, type: 'dashed' }, label: { show: false } }, { coord: [col.d[n - 1], p.neckline] }]);
        if (p.upper && p.lower) { [p.upper, p.lower].forEach(function (L) { main.markLine.data.push([{ coord: [col.d[L.a.i], L.a.p], lineStyle: { color: c, width: 1.5 }, label: { show: false } }, { coord: [col.d[L.b.i], L.b.p] }]); }); }
      });
      A.divergences.filter(function (d) { return d.fresh; }).forEach(function (d) { var c = d.type === 'bull' ? up : dn; main.markLine.data.push([{ coord: [col.d[d.a.i], d.a.p], lineStyle: { color: c, width: 2, type: 'dashed' }, label: { show: !small, formatter: d.name, color: c, fontSize: 10, position: 'end' } }, { coord: [col.d[d.b.i], d.b.p] }]); });
    }
    if (ov.plan && view.plan) {
      var P = view.plan, from = col.d[Math.max(0, n - Math.min(span, 60))];
      main.markArea.data.push([{ name: 'Giriş', xAxis: from, yAxis: P.entryLo, itemStyle: { color: hexA(t.brand, 0.18), borderColor: t.brand, borderWidth: 1 }, label: { show: true, position: 'insideTopLeft', color: t.brand, fontSize: 11, formatter: 'Giriş ' + fmt(P.entryLo) + (P.entryHi !== P.entryLo ? '–' + fmt(P.entryHi) : '') } }, { xAxis: dates[N - 1], yAxis: P.entryHi === P.entryLo ? P.entryHi + A.atr * 0.08 : P.entryHi }]);
      main.markLine.data.push([{ coord: [from, P.stop], lineStyle: { color: dn, width: 2, type: 'solid' }, label: { show: true, position: 'insideStartBottom', formatter: 'Stop ' + fmt(P.stop), color: dn, fontSize: 11 } }, { coord: [dates[N - 1], P.stop] }]);
      P.targets.forEach(function (x, k) { main.markLine.data.push([{ coord: [from, x.p], lineStyle: { color: up, width: x.minor ? 1 : 2, type: x.minor ? 'dashed' : 'solid' }, label: { show: true, position: 'insideStartTop', formatter: 'Hedef ' + (k + 1) + ' ' + fmt(x.p) + (num(x.rr) ? ' (R/Ö ' + x.rr.toFixed(1).replace('.', ',') + ')' : ''), color: up, fontSize: 11 } }, { coord: [dates[N - 1], x.p] }]); });
    }
    // Son fiyat etiketi
    main.markLine.data.push({ yAxis: A.price, lineStyle: { color: t.ink, width: 1, type: 'dotted', opacity: 0.6 }, label: { show: true, position: 'end', formatter: fmt(A.price), color: t.card, backgroundColor: t.ink, padding: [2, 4], borderRadius: 3, fontSize: 11 } });
    // Alt panel
    var lowSeries = [], lowName = '';
    if (lower === 'volume' && I.hasVol) { lowName = 'Hacim'; lowSeries.push({ name: 'Hacim', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: pad(col.v.map(function (v, i) { return { value: v, itemStyle: { color: hexA(col.c[i] >= (col.o[i] != null ? col.o[i] : col.c[i - 1]) ? up : dn, 0.55) } }; })), barMaxWidth: 10 }); }
    else if (lower === 'macd') { lowName = 'MACD (12,26,9)'; lowSeries.push({ name: 'MACD histogram', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.macd.hist.map(function (v) { return num(v) ? { value: v, itemStyle: { color: hexA(v >= 0 ? up : dn, 0.6) } } : null; })), barMaxWidth: 8 }, { name: 'MACD', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.macd.macd), showSymbol: false, lineStyle: { width: 1.4, color: t.brand } }, { name: 'Sinyal', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.macd.signal), showSymbol: false, lineStyle: { width: 1.2, color: t.pal[2] } }); }
    else if (lower === 'stoch') { lowName = 'Stokastik RSI'; lowSeries.push({ name: '%K', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.stochRsi.k), showSymbol: false, lineStyle: { width: 1.4, color: t.brand }, markLine: { silent: true, symbol: 'none', lineStyle: { color: t.muted, type: 'dashed' }, label: { show: false }, data: [{ yAxis: 80 }, { yAxis: 20 }] } }, { name: '%D', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.stochRsi.d), showSymbol: false, lineStyle: { width: 1.2, color: t.pal[2] } }); }
    else if (lower === 'adx' && I.adx) { lowName = 'ADX (14)'; lowSeries.push({ name: 'ADX', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.adx.adx), showSymbol: false, lineStyle: { width: 2, color: t.ink }, markLine: { silent: true, symbol: 'none', lineStyle: { color: t.muted, type: 'dashed' }, label: { show: false }, data: [{ yAxis: 25 }] } }, { name: '+DI', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.adx.pdi), showSymbol: false, lineStyle: { width: 1.2, color: up } }, { name: '−DI', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.adx.mdi), showSymbol: false, lineStyle: { width: 1.2, color: dn } }); }
    else { lowName = 'RSI (14)'; var dv = A.divergences.filter(function (d) { return d.fresh; });
      lowSeries.push({ name: 'RSI', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pad(I.rsi), showSymbol: false, lineStyle: { width: 1.5, color: t.pal[4] },
        markArea: { silent: true, itemStyle: { color: hexA(t.pal[4], 0.06) }, data: [[{ yAxis: 30 }, { yAxis: 70 }]] },
        markLine: { silent: true, symbol: 'none', label: { show: false }, data: [{ yAxis: 70, lineStyle: { color: dn, type: 'dashed' } }, { yAxis: 30, lineStyle: { color: up, type: 'dashed' } }].concat(dv.map(function (d) { var c = d.type === 'bull' ? up : dn; return [{ coord: [col.d[d.a.i], d.oa], lineStyle: { color: c, width: 2 } }, { coord: [col.d[d.b.i], d.ob] }]; })) } }); }
    var h1 = small ? '62%' : '66%';
    var o = {
      animation: !C.reduced(), animationDuration: 600, color: t.pal,
      legend: { show: !small && legend.length > 0, top: 0, left: 0, type: 'scroll', textStyle: { color: t.muted, fontSize: 11 }, data: legend, itemWidth: 14, itemHeight: 8 },
      tooltip: C.tooltip(t, { trigger: 'axis', axisPointer: { type: 'cross', label: { backgroundColor: t.ink } }, formatter: function (ps) {
        if (!ps.length) return ''; var i = ps[0].dataIndex, d = dates[i], s = '<b>' + d + '</b>' + (i >= n ? ' (gelecek bulut)' : '');
        if (i < n) { if (!closeOnly) s += '<br>A ' + fmt(col.o[i]) + ' · Y ' + fmt(col.h[i]) + ' · D ' + fmt(col.l[i]) + ' · K <b>' + fmt(col.c[i]) + '</b>'; else s += '<br>Kapanış <b>' + fmt(col.c[i]) + '</b>'; if (num(col.v[i])) s += '<br>Hacim ' + Math.round(col.v[i]).toLocaleString('tr-TR'); if (A.col.bars[i] && A.col.bars[i].live) s += '<br><i>canlı / gecikmeli fiyat</i>'; }
        ps.forEach(function (p) { if (p.seriesType === 'candlestick' || p.seriesName === 'Fiyat' || p.seriesName === 'Hacim' || /Bulut/.test(p.seriesName) || p.value == null || (typeof p.value === 'object')) return; var v = Array.isArray(p.value) ? p.value[1] : p.value; if (num(v)) s += '<br>' + p.marker + p.seriesName + ': ' + fmt(v); });
        return s; } }),
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [{ left: 8, right: small ? 50 : 70, top: legend.length && !small ? 28 : 10, height: h1, containLabel: false }, { left: 8, right: small ? 50 : 70, top: small ? '74%' : '77%', height: small ? '16%' : '15%' }],
      xAxis: [{ type: 'category', data: dates, boundaryGap: true, axisLine: { lineStyle: { color: t.line } }, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }, min: 'dataMin', max: 'dataMax' },
        { type: 'category', gridIndex: 1, data: dates, boundaryGap: true, axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, hideOverlap: true, formatter: function (v) { var p = String(v).split('-'); return p[2] + '.' + p[1] + '.' + p[0].slice(2); } }, axisTick: { show: false } }],
      yAxis: [{ scale: true, position: 'right', axisLabel: { color: t.muted, formatter: function (v) { return fmt(v); } }, splitLine: { lineStyle: { color: t.line, opacity: 0.6 } } },
        { scale: true, gridIndex: 1, position: 'right', splitNumber: 2, name: lowName, nameLocation: 'end', nameGap: 4, nameTextStyle: { color: t.muted, fontSize: 10, align: 'right' }, axisLabel: { color: t.muted, fontSize: 10, formatter: function (v) { return Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(0) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'B' : String(Math.round(v * 100) / 100).replace('.', ','); } }, splitLine: { show: false },
          min: lower === 'rsi' || lower === 'stoch' ? 0 : undefined, max: lower === 'rsi' || lower === 'stoch' ? 100 : undefined }],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: startPct, end: 100, minValueSpan: 15 }, { type: 'slider', xAxisIndex: [0, 1], start: startPct, end: 100, height: 16, bottom: 2, borderColor: t.line, textStyle: { color: t.muted, fontSize: 10 }, showDetail: false, brushSelect: false }],
      series: series.concat(lowSeries)
    };
    return o;
  }
  /* Skor göstergesi (0-100, yarım halka) */
  function gauge(score, label, t) {
    var c = score == null ? t.muted : score >= 70 ? t.ok : score >= 55 ? t.safe : score >= 45 ? t.medium : t.danger;
    return { animation: !window.Charts.reduced(), series: [{ type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '100%', center: ['50%', '62%'], progress: { show: true, width: 12, roundCap: true, itemStyle: { color: c } },
      axisLine: { lineStyle: { width: 12, color: [[1, window.Charts.hexA(t.muted, 0.18)]] }, roundCap: true }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, anchor: { show: false },
      title: { show: true, offsetCenter: [0, '38%'], color: t.muted, fontSize: 12 }, detail: { valueAnimation: true, offsetCenter: [0, '-2%'], fontSize: 30, fontWeight: 800, color: t.ink, formatter: function (v) { return score == null ? '—' : Math.round(v); } },
      data: [{ value: score == null ? 0 : score, name: label || '' }] }] };
  }
  window.TAChart = { build: build, gauge: gauge, RANGES: RANGES, fmt: fmt };
})();
