#!/usr/bin/env python3
"""Finans Pusulası — günlük piyasa verisi (OHLCV) derleyici. Yalnızca Python standart kütüphanesi.

Neden var: Borsa İstanbul hisseleri, emtia ve döviz için tarayıcıdan (CORS) erişilebilen ücretsiz bir
geçmiş fiyat (mum) kaynağı yok. Bu betik GitHub Actions'ta (sunucu tarafında, CORS yok) çalışır,
sonuçları depodaki ayrı `market-data` dalına yazar; site bunları raw.githubusercontent.com'dan okur.

Kaynaklar:
  - Evren ve Katılım endeksi üyeleri: TradingView tarayıcı (scanner.tradingview.com, resmi olmayan)
  - Günlük OHLCV (bölünme/bedelsize göre düzeltilmiş): Yahoo Finance chart API (resmi olmayan)
  - Bağımsız kapanış çapraz kontrolü (BIST): İş Yatırım HisseTekil (resmi olmayan)
Hiçbir değer uydurulmaz: eksik/boş satırlar atılır ve sayısı kaydedilir; alınamayan sembolde önceki
dosya (varsa) aynen bırakılır ve rapora 'stale' olarak yazılır.
Kişisel, ticari olmayan kullanım içindir.
"""
import json, os, sys, time, math, random, datetime, urllib.request, urllib.error, concurrent.futures as cf

OUT = sys.argv[1] if len(sys.argv) > 1 else 'market-data-out'
PREV = os.environ.get('PREV_DIR', '')          # önceki çalıştırmanın çıktısı (varsa)
LIMIT = int(os.environ.get('LIMIT', '0'))       # test için sembol sınırı
UA = 'Mozilla/5.0'  # Yahoo, tam tarayıcı UA dizesine 429 veriyor; kısa UA ile yanıt veriyor (Kasım 2026)
NOW = datetime.datetime.now(datetime.timezone.utc)
TR = datetime.timezone(datetime.timedelta(hours=3))

MACRO = {  # dosya adı: (yahoo sembolü, açıklama, para birimi)
    'XAUUSD': ('GC=F', 'Altın ons (COMEX vadeli, yakın vade, USD)', 'USD'),
    'XAGUSD': ('SI=F', 'Gümüş ons (COMEX vadeli, yakın vade, USD)', 'USD'),
    'USDTRY': ('USDTRY=X', 'ABD doları / TL', 'TRY'),
    'EURTRY': ('EURTRY=X', 'Euro / TL', 'TRY'),
}
INDEX = {'XU100': ('XU100.IS', 'BIST 100 endeksi'), 'XU030': ('XU030.IS', 'BIST 30 endeksi')}
US = {  # helal ETF'ler (Şer'i endeks izleyen) — fiyat okumak için; uygunluk etiketini kullanıcı/kurul onayı belirler
    'SPUS': 'SP Funds S&P 500 Sharia Industry Exclusions ETF',
    'HLAL': 'Wahed FTSE USA Shariah ETF',
    'SPSK': 'SP Funds Dow Jones Global Sukuk ETF',
    'SPRE': 'SP Funds S&P Global REIT Sharia ETF',
    'SPTE': 'SP Funds S&P Global Technology ETF',
    'SPWO': 'SP Funds S&P World (ex-US) ETF',
    'UMMA': 'Wahed Dow Jones Islamic World ETF',
}

def http(url, data=None, headers=None, timeout=30, tries=4):
    h = {'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*'}
    h.update(headers or {})
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            last = 'HTTP %s' % e.code
            if e.code in (400, 404): break
        except Exception as e:  # ağ hatası
            last = type(e).__name__ + ': ' + str(e)[:120]
        time.sleep((2 ** i) + random.random())
    raise RuntimeError(last or 'bilinmeyen hata')

def tv_scan(body):
    return http('https://scanner.tradingview.com/turkey/scan', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})

def universe():
    body = {'filter': [{'left': 'exchange', 'operation': 'equal', 'right': 'BIST'},
                       {'left': 'type', 'operation': 'in_range', 'right': ['stock', 'dr']}],
            'columns': ['name', 'description', 'sector', 'industry', 'market_cap_basic'], 'range': [0, 2000],
            'sort': {'sortBy': 'market_cap_basic', 'sortOrder': 'desc'}}
    d = tv_scan(body)
    rows = [{'s': r['d'][0], 'name': r['d'][1], 'sector': r['d'][2], 'industry': r['d'][3]} for r in d.get('data', [])
            if r['d'][0] and r['d'][0].replace('.', '').isalnum()]
    members = {}
    for idx in ['XKTUM', 'XK100', 'XK050', 'XK030']:
        dd = tv_scan({'columns': ['name'], 'symbols': {'symbolset': ['SYML:BIST;' + idx]}, 'range': [0, 1000]})
        members[idx] = sorted(x['d'][0] for x in dd.get('data', []))
        time.sleep(0.5)
    return rows, members

def rnd(v):
    if v is None or not isinstance(v, (int, float)) or not math.isfinite(v): return None
    a = abs(v)
    return round(v, 2 if a >= 1000 else 4 if a >= 1 else 6)

def yahoo(sym, rng='3y'):
    url = 'https://query2.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=1d&events=div%%2Csplits&includeAdjustedClose=true' % (urllib.request.quote(sym), rng)
    j = http(url)
    res = (j.get('chart') or {}).get('result')
    if not res: raise RuntimeError('Yahoo boş yanıt: %s' % ((j.get('chart') or {}).get('error')))
    r = res[0]; meta = r.get('meta', {}); off = int(meta.get('gmtoffset') or 0)
    q = (r.get('indicators', {}).get('quote') or [{}])[0]
    ts = r.get('timestamp') or []
    bars, dropped, seen = [], 0, set()
    for i, t in enumerate(ts):
        o, h, l, c = (q.get(k, [None] * len(ts))[i] for k in ('open', 'high', 'low', 'close'))
        v = (q.get('volume') or [None] * len(ts))[i]
        d = datetime.datetime.fromtimestamp(t + off, datetime.timezone.utc).strftime('%Y-%m-%d')
        if None in (o, h, l, c) or c <= 0 or d in seen:
            dropped += 1; continue
        seen.add(d)
        bars.append([d, rnd(o), rnd(h), rnd(l), rnd(c), int(v) if isinstance(v, (int, float)) and v >= 0 else None])
    ev = r.get('events') or {}
    splits = sorted([[datetime.datetime.fromtimestamp(int(k) + off, datetime.timezone.utc).strftime('%Y-%m-%d'), x.get('numerator'), x.get('denominator')] for k, x in (ev.get('splits') or {}).items()])
    divs = sorted([[datetime.datetime.fromtimestamp(int(k) + off, datetime.timezone.utc).strftime('%Y-%m-%d'), rnd(x.get('amount'))] for k, x in (ev.get('dividends') or {}).items()])
    return {'bars': bars, 'dropped': dropped, 'currency': meta.get('currency'), 'splits': splits, 'dividends': divs,
            'exchangeTz': meta.get('exchangeTimezoneName'), 'regularMarketTime': meta.get('regularMarketTime')}

def isy_check(sym, bars):
    """İş Yatırım günlük kapanışı ile son ~90 günü karşılaştırır (bağımsız ikinci kaynak)."""
    end = NOW.astimezone(TR); start = end - datetime.timedelta(days=120)
    url = ('https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/Data.aspx/HisseTekil?hisse=%s&startdate=%s&enddate=%s'
           % (sym, start.strftime('%d-%m-%Y'), end.strftime('%d-%m-%Y')))
    j = http(url, tries=2)
    ref = {}
    for x in j.get('value') or []:
        try:
            dd, mm, yy = x['HGDG_TARIH'].split('-'); ref['%s-%s-%s' % (yy, mm, dd)] = float(x['HGDG_KAPANIS'])
        except Exception: pass
    diffs = []
    for b in bars[-90:]:
        r = ref.get(b[0])
        if r and r > 0: diffs.append((b[0], (b[4] - r) / r * 100))
    if not diffs: return {'source': 'İş Yatırım', 'compared': 0}
    bad = [(d, round(x, 3)) for d, x in diffs if abs(x) > 0.5]
    recent = diffs[-5:]
    # Eski günlerde sabit fark + son günler uyumlu ise: kaynaklardan biri geçmişi temettü/sermaye işlemine göre farklı düzeltmiştir
    return {'source': 'İş Yatırım', 'compared': len(diffs), 'maxAbsDiffPct': round(max(abs(x) for _, x in diffs), 3), 'over05': len(bad),
            'recentCompared': len(recent), 'recentMaxAbsDiffPct': round(max(abs(x) for _, x in recent), 3), 'lastDate': diffs[-1][0], 'examples': bad[-5:]}

def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f: json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))

def load_prev(rel):
    if not PREV: return None
    p = os.path.join(PREV, rel)
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception: return None

def job(kind, key, ysym, extra):
    rel = '%s/%s.json' % (kind, key)
    try:
        y = yahoo(ysym)
        if len(y['bars']) < 5: raise RuntimeError('çok az satır (%d)' % len(y['bars']))
        obj = {'symbol': key, 'yahoo': ysym, 'kind': kind, 'fetchedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'),
               'source': 'Yahoo Finance chart API (sunucu tarafı, resmi olmayan; OHLC bölünme/bedelsize göre düzeltilmiş)',
               'currency': y['currency'], 'droppedRows': y['dropped'], 'splits': y['splits'], 'dividends': y['dividends'],
               'cols': ['d', 'o', 'h', 'l', 'c', 'v'], 'bars': y['bars']}
        obj.update(extra or {})
        if kind == 'bist':
            try: obj['check'] = isy_check(key, y['bars'])
            except Exception as e: obj['check'] = {'source': 'İş Yatırım', 'error': str(e)[:120]}
        write(os.path.join(OUT, rel), obj)
        return key, 'ok', len(y['bars']), obj['bars'][-1][0]
    except Exception as e:
        prev = load_prev(rel)
        if prev:
            prev['stale'] = True; prev['lastError'] = str(e)[:160]
            write(os.path.join(OUT, rel), prev)
            return key, 'stale', len(prev.get('bars', [])), prev['bars'][-1][0] if prev.get('bars') else None
        return key, 'fail: ' + str(e)[:100], 0, None

def main():
    t0 = time.time()
    rows, members = universe()
    if LIMIT: rows = rows[:LIMIT]
    print('BIST evreni:', len(rows), {k: len(v) for k, v in members.items()})
    kat = set(members.get('XKTUM', []))
    jobs = [('bist', r['s'], r['s'] + '.IS', {'name': r['name'], 'sector': r['sector'], 'katilim': [k for k in members if r['s'] in members[k]]}) for r in rows]
    jobs += [('index', k, v[0], {'name': v[1]}) for k, v in INDEX.items()]
    jobs += [('macro', k, v[0], {'name': v[1]}) for k, v in MACRO.items()]
    jobs += [('us', k, k, {'name': v}) for k, v in US.items()]
    results = []
    with cf.ThreadPoolExecutor(max_workers=int(os.environ.get('WORKERS', '6'))) as ex:
        futs = [ex.submit(job, *j) for j in jobs]
        for f in cf.as_completed(futs):
            results.append(f.result())
    ok = [r for r in results if r[1] == 'ok']; stale = [r for r in results if r[1] == 'stale']; fail = [r for r in results if r[1].startswith('fail')]
    avail = {r[0] for r in results if r[2] > 0}
    index = {
        'generatedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'note': 'Kişisel, ticari olmayan kullanım. Kaynaklar resmi değildir; doğruluğu garanti edilmez.',
        'sources': {'universe': 'TradingView tarayıcı (scanner.tradingview.com)', 'ohlcv': 'Yahoo Finance chart API', 'crosscheck': 'İş Yatırım HisseTekil (BIST kapanış)'},
        'katilim': {'asOf': NOW.astimezone(TR).strftime('%Y-%m-%d'), 'source': 'Borsa İstanbul Katılım endeksleri bileşenleri — TradingView endeks listesi (SYML:BIST;XKTUM/XK100/XK050/XK030)', 'members': members},
        'bist': [{'s': r['s'], 'n': r['name'], 'sec': r['sector'], 'k': 1 if r['s'] in kat else 0} for r in rows if r['s'] in avail],
        'index': sorted(k for k in INDEX if k in avail), 'macro': sorted(k for k in MACRO if k in avail), 'us': sorted(k for k in US if k in avail),
        'stats': {'ok': len(ok), 'stale': len(stale), 'fail': len(fail), 'seconds': round(time.time() - t0)},
        'failed': sorted(r[0] + ': ' + r[1] for r in fail)[:200], 'staleList': sorted(r[0] for r in stale)[:200]
    }
    write(os.path.join(OUT, 'index.json'), index)
    print(json.dumps(index['stats']), 'başarısız örnek:', index['failed'][:10])
    if len(ok) + len(stale) < 0.5 * len(jobs):
        print('HATA: sembollerin yarısından azı alınabildi'); sys.exit(2)

if __name__ == '__main__':
    main()
