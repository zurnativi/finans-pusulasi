/* charts.js — Canlı grafikler (Apache ECharts, vendor/echarts.min.js, çevrimdışı çalışır).
 * Kullanım: görünüm HTML'i üretilirken Charts.area/donut/bars/... bir yer tutucu <div> döndürür ve grafiği kaydeder;
 * render() HTML'i yerleştirdikten sonra Charts.flush() grafikleri kurar, sayaçları canlandırır.
 * Aynı grafik tekrar çizilirse eski hâlinden yenisine yumuşak geçiş yapar. Tutarlar her zaman tam sayı kuruştur;
 * ipuçları ve etiketler Money.format ile biçimlenir (yuvarlama yok). prefers-reduced-motion'da animasyon kapalıdır. */
(function () {
  'use strict';
  var M = window.Money, CD = window.ChartData;
  var specs = {}, insts = {}, lastOpt = {}, lastCnt = {}, ranges = {}, entry = true, ro = null;
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function reduced() { return !!mqReduce.matches; }
  function ok() { return !!window.echarts; }
  function tl(k) { return M.format(Math.round(k), { noDecimals: true }); }
  function tl2(k) { return M.format(Math.round(k)); }
  function short(k) { return M.formatShort(Math.round(k)); }
  function pctBp(bp) { return bp == null ? '—' : '%' + (Math.abs(bp) / 100).toFixed(1).replace('.', ','); }
  var MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  function dLabel(ymd, withYear) { var p = String(ymd).split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + (withYear ? ' ' + p[0] : ''); }
  function theme() {
    var cs = getComputedStyle(document.documentElement), v = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
    var dark = !!mqDark.matches;
    return {
      dark: dark, ink: v('--ink', '#14213d'), muted: v('--muted', '#5b6475'), line: v('--line', '#e3e8f0'), card: v('--card', '#fff'), brand: v('--brand', '#1f6feb'),
      safe: v('--safe', '#2f9e6e'), medium: v('--medium', '#e0a100'), risky: v('--risky', '#d9534f'), ok: v('--ok', '#16794c'), danger: v('--danger', '#b42318'),
      // renk körlüğüne dayanıklı palet (Okabe-Ito'dan uyarlanmış, koyu/açık temada okunur)
      pal: dark ? ['#4b8cf5', '#5ad19a', '#f3b95f', '#ff8a80', '#b79cff', '#56c8e8', '#f08bd0', '#c3cf5a', '#9aa5b8', '#ffa94d']
        : ['#1f6feb', '#16794c', '#c27c00', '#c0392b', '#7048e8', '#0b8aa8', '#c2257d', '#6b7d12', '#5b6475', '#d9480f']
    };
  }
  function anim(o) {
    var r = reduced();
    o.animation = !r; o.animationDuration = r ? 0 : 1000; o.animationEasing = 'cubicOut'; o.animationDurationUpdate = r ? 0 : 650; o.animationEasingUpdate = 'cubicInOut';
    return o;
  }
  function baseTooltip(t, extra) {
    var o = { confine: true, triggerOn: 'mousemove|click', backgroundColor: t.card, borderColor: t.line, textStyle: { color: t.ink, fontSize: 13 }, extraCssText: 'box-shadow:0 4px 14px rgba(0,0,0,.18);border-radius:10px;' };
    for (var k in extra) o[k] = extra[k];
    return o;
  }
  function holder(key, h, label, cls) {
    return '<div class="ec' + (cls ? ' ' + cls : '') + '" data-ec="' + esc(key) + '" style="height:' + h + 'px" role="img" aria-label="' + esc(label) + '"><noscript>' + esc(label) + '</noscript></div>';
  }
  function reg(key, h, label, build, cls) { specs[key] = { build: build, label: label }; return holder(key, h, label, cls); }

  /* ---------- Grafik türleri ---------- */
  /* Alan/çizgi (zaman ekseni). o.series: [{ name, data: [{d, v}], color?, dashed?, area? }]; o.ranges: true → 1A/3A/6A/1Y/Tümü düğmeleri */
  function area(key, o) {
    var r0 = ranges[key] || o.defaultRange || 'Tümü';
    ranges[key] = r0;
    var html = '';
    if (o.ranges) {
      html += '<div class="seg" role="group" aria-label="Zaman aralığı">' + Object.keys(CD.RANGES).map(function (r) {
        return '<button type="button" data-ec-range="' + esc(key) + '" data-r="' + r + '" aria-pressed="' + (r === r0) + '">' + r + '</button>'; }).join('') + '</div>';
    }
    specs[key] = { label: o.label, build: function (t) { return areaOpt(t, o, ranges[key]); }, caption: o.caption };
    html += holder(key, o.h || 240, o.label);
    if (o.caption) html += '<div class="ec-cap" data-ec-cap="' + esc(key) + '">' + o.caption(ranges[key]) + '</div>';
    return html;
  }
  function areaOpt(t, o, range) {
    var today = o.today, multiYear = false;
    var ser = o.series.map(function (s, i) {
      var pts = o.ranges ? CD.inRange(s.data, range, today) : s.data;
      if (pts.length && pts[0].d.slice(0, 4) !== pts[pts.length - 1].d.slice(0, 4)) multiYear = true;
      var cl = col(t, s.color, t.pal[i % t.pal.length]);
      return {
        name: s.name, type: 'line', smooth: 0.35, showSymbol: pts.length < 3, symbolSize: 6, sampling: 'lttb', data: pts.map(function (p) { return [p.d, p.v]; }),
        lineStyle: { width: s.dashed ? 2 : 3, type: s.dashed ? 'dashed' : 'solid', color: s.dashed ? t.muted : cl }, itemStyle: { color: s.dashed ? t.muted : cl },
        areaStyle: s.area === false || s.dashed ? undefined : { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexA(cl, t.dark ? 0.45 : 0.32) }, { offset: 1, color: hexA(cl, 0.02) }] } },
        emphasis: { focus: 'series' }, z: s.dashed ? 1 : 2,
        markLine: s.markLine ? { symbol: 'none', silent: true, label: { color: t.ink, formatter: s.markLine.label, position: 'insideEndTop' }, lineStyle: { color: t.ink, type: 'dashed' }, data: [{ yAxis: s.markLine.y }] } : undefined
      };
    });
    return anim({
      color: t.pal, grid: { left: 8, right: 12, top: o.legend ? 34 : 14, bottom: 6, containLabel: true },
      legend: o.legend ? { top: 0, textStyle: { color: t.muted } } : undefined,
      tooltip: baseTooltip(t, { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.muted } },
        formatter: function (ps) { if (!ps.length) return ''; var d = ps[0].value[0]; return '<b>' + dLabel(d, true) + '</b><br>' + ps.map(function (p) { return p.marker + esc(p.seriesName) + ': <b>' + tl(p.value[1]) + '</b>'; }).join('<br>'); } }),
      xAxis: { type: 'time', boundaryGap: false, axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, hideOverlap: true, formatter: function (v) { var d = new Date(v); return MONTHS[d.getMonth()] + (multiYear && d.getMonth() === 0 ? ' ' + d.getFullYear() : ''); } }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: !o.zeroBase, axisLabel: { color: t.muted, formatter: function (v) { return short(v); } }, splitLine: { lineStyle: { color: t.line } } },
      series: ser
    });
  }
  /* Halka (donut). o.items: [{ name, value (kuruş), color? }], o.center: { title, value (kuruş) } */
  function donut(key, o) {
    return reg(key, o.h || 240, o.label, function (t) {
      var items = o.items.filter(function (x) { return x.value > 0; }), total = items.reduce(function (s, x) { return s + x.value; }, 0);
      var small = (t.width || 999) < 420;
      return anim({
        color: t.pal,
        tooltip: baseTooltip(t, { trigger: 'item', formatter: function (p) { return p.marker + '<b>' + esc(p.name) + '</b><br>' + tl(p.value) + ' · ' + pctBp(total ? Math.round(p.value * 10000 / total) : null); } }),
        legend: o.legend === false ? undefined : { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 12 }, formatter: function (n) { return n.length > 16 ? n.slice(0, 15) + '…' : n; } },
        title: o.center ? { text: o.center.value != null ? short(o.center.value) : '', subtext: o.center.title, left: o.legend === false ? 'center' : '28%', top: '40%', textAlign: 'center',
          textStyle: { color: t.ink, fontSize: 16, fontWeight: 700 }, subtextStyle: { color: t.muted, fontSize: 11 } } : undefined,
        series: [{ type: 'pie', radius: ['56%', '80%'], center: [o.legend === false ? '50%' : '28%', '50%'], avoidLabelOverlap: true, padAngle: 1.5, itemStyle: { borderRadius: 6, borderColor: t.card, borderWidth: 2 },
          label: { show: false }, emphasis: { scale: true, scaleSize: 6, label: { show: false } }, animationType: 'expansion',
          data: items.map(function (x) { return { name: x.name, value: x.value, itemStyle: x.color ? { color: col(t, x.color) } : undefined }; }) }]
      });
    });
  }
  /* Çubuklar. o.cats: etiketler; o.series: [{ name, data: [kuruş], color?, stack?, partialIndex? }]; o.horizontal */
  function bars(key, o) {
    return reg(key, o.h || 240, o.label, function (t) {
      var hz = !!o.horizontal, f = o.pctAxis ? function (v) { return '%' + (v / 100).toFixed(1).replace('.', ','); } : tl2, fs = o.pctAxis ? function (v) { return '%' + Math.round(v / 100); } : short;
      var cat = { type: 'category', data: o.cats, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.muted, interval: 0, hideOverlap: !hz, width: hz ? 92 : undefined, overflow: 'truncate' } };
      var val = { type: 'value', max: o.pctAxis ? 10000 : undefined, axisLabel: { color: t.muted, formatter: function (v) { return fs(v); } }, splitLine: { lineStyle: { color: t.line } } };
      return anim({
        color: t.pal, grid: { left: 6, right: hz ? 18 : 8, top: o.legend ? 34 : 18, bottom: 4, containLabel: true },
        legend: o.legend ? { top: 0, textStyle: { color: t.muted } } : undefined,
        tooltip: baseTooltip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function (ps) { return '<b>' + esc(ps[0].name) + '</b><br>' + ps.map(function (p) { return p.marker + esc(p.seriesName) + ': <b>' + f(p.value) + '</b>'; }).join('<br>') + (o.tipExtra ? o.tipExtra(ps[0].dataIndex) : ''); } }),
        xAxis: hz ? val : cat, yAxis: hz ? (cat.inverse = true, cat) : val,
        series: o.series.map(function (s, i) {
          var cl = col(t, s.color, t.pal[i % t.pal.length]), cols = s.colors ? s.colors.map(function (c) { return col(t, c); }) : null;
          return { name: s.name, type: 'bar', stack: s.stack, barMaxWidth: 34, itemStyle: { color: cols ? cols[0] : cl, borderRadius: s.stack ? 0 : (hz ? [0, 6, 6, 0] : [6, 6, 0, 0]) },
            emphasis: { focus: 'series' }, animationDelay: function (idx) { return reduced() ? 0 : idx * 60; },
            label: s.labels ? { show: true, position: hz ? 'right' : 'top', color: t.muted, fontSize: 11, formatter: function (p) { return fs(p.value); } } : undefined,
            data: s.data.map(function (v, j) { return s.partialIndex === j ? { value: v, itemStyle: { color: hexA(cl, 0.3), borderColor: cl, borderWidth: 2, borderType: 'dashed' } } : (cols ? { value: v, itemStyle: { color: cols[j] } } : v); }) };
        })
      });
    });
  }
  /* Akış (sankey). o.nodes: [{ name, color? }], o.links: [{ source, target, value (kuruş) }] */
  function sankey(key, o) {
    return reg(key, o.h || 260, o.label, function (t) {
      return anim({
        tooltip: baseTooltip(t, { trigger: 'item', formatter: function (p) { return p.dataType === 'edge' ? esc(p.data.source) + ' → ' + esc(p.data.target) + '<br><b>' + tl(p.value) + '</b>' : '<b>' + esc(p.name) + '</b><br>' + tl(p.value); } }),
        series: [{ type: 'sankey', left: 4, right: (t.width || 999) < 520 ? 92 : 130, top: 8, bottom: 8, nodeWidth: 14, nodeGap: 14, draggable: false, layoutIterations: 0, nodeAlign: 'left',
          emphasis: { focus: 'adjacency' }, lineStyle: { color: 'gradient', opacity: t.dark ? 0.45 : 0.35, curveness: 0.5 },
          label: { color: t.ink, fontSize: 12, formatter: function (p) { return (p.data && p.data.depth === 2) || (t.width || 999) < 520 ? p.name + ' {v|' + short(p.value) + '}' : p.name + '\n{v|' + short(p.value) + '}'; }, rich: { v: { color: t.muted, fontSize: 11 } } },
          data: o.nodes.map(function (n, i) { var c = col(t, n.color, t.pal[i % t.pal.length]); var d = { name: n.name, itemStyle: { color: c, borderColor: c } }; if (n.depth != null) d.depth = n.depth; return d; }),
          links: o.links.filter(function (l) { return l.value > 0; }) }]
      });
    });
  }
  /* İlerleme halkası. o.bp: 0..10000, o.center: metin, o.color */
  function ring(key, o) {
    return reg(key, o.h || 130, o.label, function (t) {
      var cl = col(t, o.color, t.brand), v = Math.max(0, Math.min(100, o.bp / 100));
      return anim({
        series: [{ type: 'gauge', startAngle: 90, endAngle: -270, min: 0, max: 100, radius: '92%', pointer: { show: false },
          progress: { show: true, overlap: false, roundCap: true, clip: false, width: 12, itemStyle: { color: cl } },
          axisLine: { lineStyle: { width: 12, color: [[1, t.line]] } }, splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
          title: { show: false }, detail: { valueAnimation: !reduced(), offsetCenter: [0, 0], fontSize: 20, fontWeight: 700, color: t.ink, formatter: function (x) { return '%' + Math.round(x); } },
          data: [{ value: Math.round(v * 10) / 10 }] }]
      });
    }, 'ring');
  }
  /* Küçük eğilim çizgisi/çubuğu. o.labels, o.values (kuruş), o.type 'bar'|'line', o.highlightLast */
  function spark(key, o) {
    return reg(key, o.h || 54, o.label, function (t) {
      var cl = col(t, o.color, t.brand), n = o.values.length;
      return anim({
        grid: { left: 2, right: 2, top: 4, bottom: 2 },
        tooltip: baseTooltip(t, { trigger: 'axis', axisPointer: { type: o.type === 'bar' ? 'shadow' : 'line' }, formatter: function (ps) { return esc(ps[0].name) + ': <b>' + tl(ps[0].value) + '</b>'; } }),
        xAxis: { type: 'category', data: o.labels, show: false, boundaryGap: o.type === 'bar' }, yAxis: { type: 'value', show: false, min: 0 },
        series: [o.type === 'bar'
          ? { type: 'bar', barMaxWidth: 16, data: o.values.map(function (v, i) { return { value: v, itemStyle: { color: i === n - 1 && o.highlightLast ? cl : hexA(cl, 0.45), borderRadius: [3, 3, 0, 0] } }; }), animationDelay: function (i) { return reduced() ? 0 : i * 70; } }
          : { type: 'line', smooth: true, showSymbol: false, data: o.values, lineStyle: { width: 2.5, color: cl }, areaStyle: { color: hexA(cl, 0.18) } }]
      });
    }, 'spark');
  }
  /* Senaryo çizgileri (ay ekseni). o.x: etiketler; o.series: [{ name, data, color }]; o.target: kuruş; o.goalIndex */
  function lines(key, o) {
    return reg(key, o.h || 300, o.label, function (t) {
      return anim({
        color: t.pal, grid: { left: 8, right: 14, top: 36, bottom: 6, containLabel: true }, legend: { top: 0, textStyle: { color: t.muted } },
        tooltip: baseTooltip(t, { trigger: 'axis', formatter: function (ps) { return '<b>' + esc(ps[0].name) + '</b><br>' + ps.map(function (p) { return p.marker + esc(p.seriesName) + ': <b>' + tl(p.value) + '</b>'; }).join('<br>') + (o.target ? '<br><span style="opacity:.7">Hedef: ' + tl(o.target) + '</span>' : ''); } }),
        xAxis: { type: 'category', data: o.x, boundaryGap: false, axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, interval: function (i) { return i % 12 === 0; } } },
        yAxis: { type: 'value', axisLabel: { color: t.muted, formatter: function (v) { return short(v); } }, splitLine: { lineStyle: { color: t.line } } },
        series: o.series.map(function (s, i) {
          var cl = col(t, s.color, t.pal[i % t.pal.length]);
          return { name: s.name, type: 'line', smooth: 0.25, showSymbol: false, data: s.data, lineStyle: { width: 3, color: cl }, itemStyle: { color: cl }, emphasis: { focus: 'series' },
            areaStyle: i === 1 ? { color: hexA(cl, 0.10) } : undefined,
            markLine: i === 0 && (o.target || o.goalIndex != null) ? { symbol: 'none', silent: true, lineStyle: { color: t.ink, type: 'dashed' }, label: { color: t.ink }, data: [].concat(
              o.target ? [{ yAxis: o.target, label: { formatter: 'Hedef ' + short(o.target), position: 'insideEndTop' } }] : [],
              o.goalIndex != null && o.goalIndex < o.x.length ? [{ xAxis: o.goalIndex, label: { formatter: 'Hedef tarihi', position: 'end' }, lineStyle: { color: t.muted, type: 'dotted' } }] : []) } : undefined };
        })
      });
    });
  }
  /* Renk belirteci: '#hex', 'safe', 'var(--safe)', 'safe@0.45' → temaya göre gerçek renk (koyu/açık temada doğru kalır) */
  function col(t, c, fallback) {
    if (!c) return fallback;
    var m = /^(?:var\(--)?([a-z]+)\)?(?:@([\d.]+))?$/i.exec(c);
    if (m && t[m[1]] && m[1] !== 'dark' && m[1] !== 'pal' && m[1] !== 'width') return m[2] ? hexA(t[m[1]], +m[2]) : t[m[1]];
    var m2 = /^(#[0-9a-f]{3,6})@([\d.]+)$/i.exec(c);
    if (m2) return hexA(m2[1], +m2[2]);
    return c;
  }
  function hexA(c, a) {
    if (/^#([0-9a-f]{6})$/i.test(c)) { var n = parseInt(c.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
    if (/^#([0-9a-f]{3})$/i.test(c)) { return hexA('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3], a); }
    return c;
  }

  /* ---------- Sayaçlar: <span class="cnt" data-cnt="kuruş" data-k="anahtar" data-fmt="tl|tl2">son metin</span> ---------- */
  function counter(key, kurus, fmt, cls) {
    var txt = fmt === 'tl2' ? tl2(kurus) : tl(kurus);
    return '<span class="cnt num' + (cls ? ' ' + cls : '') + '" data-cnt="' + kurus + '" data-k="' + esc(key) + '" data-fmt="' + (fmt || 'tl') + '">' + esc(txt) + '</span>';
  }
  function runCounters(root) {
    var els = Array.prototype.slice.call((root || document).querySelectorAll('.cnt[data-cnt]'));
    els.forEach(function (el) {
      var to = +el.dataset.cnt, k = el.dataset.k, fmt = el.dataset.fmt === 'tl2' ? tl2 : tl, finalTxt = el.textContent;
      var from = entry || lastCnt[k] == null ? 0 : lastCnt[k];
      lastCnt[k] = to;
      if (reduced() || from === to || !isFinite(to)) return;
      var t0 = null, dur = entry ? 1100 : 600;
      el.classList.add('counting');
      function step(ts) {
        if (!el.isConnected) return;
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        if (p >= 1) { el.textContent = finalTxt; el.classList.remove('counting'); return; } // son değer her zaman tam, biçimlenmiş metin
        el.textContent = fmt(from + (to - from) * e);
        requestAnimationFrame(step);
      }
      el.textContent = fmt(from);
      requestAnimationFrame(step);
    });
  }

  /* ---------- Yaşam döngüsü ---------- */
  function observe(el, inst) {
    if (!window.ResizeObserver) return;
    if (!ro) ro = new ResizeObserver(function (es) { es.forEach(function (e) { var i = window.echarts && echarts.getInstanceByDom(e.target); if (i) i.resize(); }); });
    ro.observe(el);
  }
  function disposeGone() {
    Object.keys(insts).forEach(function (k) {
      var i = insts[k];
      if (!i || i.isDisposed() || !document.body.contains(i.getDom())) { try { if (ro) ro.unobserve(i.getDom()); i.dispose(); } catch (e) { /* */ } delete insts[k]; }
    });
  }
  var live = {};
  function flush() {
    disposeGone();
    var t = theme(), cur = specs; specs = {}; live = {};
    Object.keys(cur).forEach(function (key) {
      var el = document.querySelector('[data-ec="' + key.replace(/"/g, '') + '"]');
      if (!el) return;
      live[key] = cur[key];
      if (!ok()) { el.classList.add('ec-off'); el.textContent = 'Grafik kütüphanesi yüklenemedi. ' + cur[key].label; return; }
      try {
        var opt = cur[key].build(Object.assign({}, t, { width: el.clientWidth }));
        var inst = echarts.init(el, null, { renderer: 'canvas' });
        opt.aria = { enabled: true, label: { description: cur[key].label } };
        if (!entry && lastOpt[key]) { var prev = lastOpt[key]; prev.animation = false; inst.setOption(prev); opt.animation = !reduced(); }
        inst.setOption(opt);
        lastOpt[key] = opt;
        insts[key] = inst; observe(el, inst);
      } catch (e) { console.error('Grafik çizilemedi (' + key + ')', e); el.textContent = cur[key].label; }
    });
    runCounters(document);
    entry = false;
  }
  function setRange(key, r) {
    if (!CD.RANGES.hasOwnProperty(r) || !live[key]) return;
    ranges[key] = r;
    document.querySelectorAll('[data-ec-range="' + key + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.r === r)); });
    var i = insts[key];
    if (i && !i.isDisposed()) { var opt = live[key].build(Object.assign({}, theme(), { width: i.getDom().clientWidth })); i.setOption(opt, { replaceMerge: ['series'] }); lastOpt[key] = opt; }
    var cap = document.querySelector('[data-ec-cap="' + key + '"]');
    if (cap && live[key].caption) { cap.innerHTML = live[key].caption(r); runCounters(cap); }
  }
  function retheme() {
    var t = theme();
    Object.keys(live).forEach(function (k) { var i = insts[k]; if (i && !i.isDisposed()) { var opt = live[k].build(Object.assign({}, t, { width: i.getDom().clientWidth })); opt.aria = { enabled: true, label: { description: live[k].label } }; i.setOption(opt, true); lastOpt[k] = opt; } });
  }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-ec-range]'); if (b) setRange(b.dataset.ecRange, b.dataset.r); });
  if (mqDark.addEventListener) mqDark.addEventListener('change', retheme);
  window.Charts = {
    area: area, donut: donut, bars: bars, sankey: sankey, ring: ring, spark: spark, lines: lines, counter: counter,
    flush: flush, entering: function () { entry = true; }, isEntering: function () { return entry; }, setRange: setRange, range: function (k) { return ranges[k]; }, reduced: reduced, available: ok,
    _insts: insts
  };
})();
