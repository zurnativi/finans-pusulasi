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
import json, os, sys, time, math, random, re, shutil, html, datetime, unicodedata, urllib.request, urllib.error, concurrent.futures as cf
import xml.etree.ElementTree as ET

OUT = sys.argv[1] if len(sys.argv) > 1 else 'market-data-out'
PREV = os.environ.get('PREV_DIR', '')          # önceki çalıştırmanın çıktısı (varsa)
LIMIT = int(os.environ.get('LIMIT', '0'))       # test için sembol sınırı
MODE = os.environ.get('MODE', 'full')          # full: günlük + saatlik + KAP + haber; intraday: saatlik + KAP + haber (seans içi)
SKIP_GDELT = os.environ.get('SKIP_GDELT') == '1'
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

def http(url, data=None, headers=None, timeout=30, tries=4, raw=False):
    h = {'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*'}
    h.update(headers or {})
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                return b if raw else json.loads(b.decode('utf-8'))
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
    for idx in ['XKTUM', 'XK100', 'XK050', 'XK030', 'XU100', 'XU030']:
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

def load_json(p):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception: return None

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

KAT_IDX = ['XKTUM', 'XK100', 'XK050', 'XK030']
KAT_NAMES = {'XKTUM': 'Katılım Tüm endeksi', 'XK100': 'Katılım 100 endeksi', 'XK050': 'Katılım 50 endeksi', 'XK030': 'Katılım 30 endeksi'}

# ---------- Saatlik (gün içi) mumlar ----------
def yahoo_intraday(sym, rng):
    url = 'https://query2.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=60m&includePrePost=false' % (urllib.request.quote(sym), rng)
    j = http(url)
    res = (j.get('chart') or {}).get('result')
    if not res: raise RuntimeError('Yahoo boş yanıt: %s' % ((j.get('chart') or {}).get('error')))
    r = res[0]; q = (r.get('indicators', {}).get('quote') or [{}])[0]; ts = r.get('timestamp') or []
    bars, dropped = [], 0
    for i, t in enumerate(ts):
        o, h, l, c = (q.get(k, [None] * len(ts))[i] for k in ('open', 'high', 'low', 'close'))
        v = (q.get('volume') or [None] * len(ts))[i]
        if None in (o, h, l, c) or c <= 0: dropped += 1; continue
        bars.append([int(t), rnd(o), rnd(h), rnd(l), rnd(c), int(v) if isinstance(v, (int, float)) and v >= 0 else None])
    meta = r.get('meta', {})
    return {'bars': bars, 'dropped': dropped, 'currency': meta.get('currency'), 'gmtoffset': int(meta.get('gmtoffset') or 0)}

def merge_ts(old, new, cap):
    m = {b[0]: b for b in (old or [])}
    for b in new: m[b[0]] = b
    return [m[k] for k in sorted(m)][-cap:]

H1_CAP = 1200   # ~6 ay (BIST günde ~9 saatlik mum)
def h1_job(kind, key, ysym, extra):
    rel = 'h1/%s/%s.json' % (kind, key)
    prev = load_prev(rel)
    try:
        y = yahoo_intraday(ysym, '5d' if prev and prev.get('bars') else '180d')
        bars = merge_ts(prev.get('bars') if prev else [], y['bars'], H1_CAP)
        if len(bars) < 5: raise RuntimeError('çok az satır (%d)' % len(bars))
        obj = {'symbol': key, 'yahoo': ysym, 'kind': kind, 'tf': '1h', 'fetchedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'),
               'source': 'Yahoo Finance chart API, 60 dakikalık mumlar (sunucu tarafı, resmi olmayan; BIST mumu ~15 dk gecikmeli, çubuk başlangıç saati)',
               'currency': y['currency'], 'gmtoffset': y['gmtoffset'], 'cols': ['t', 'o', 'h', 'l', 'c', 'v'], 'bars': bars}
        obj.update(extra or {})
        write(os.path.join(OUT, rel), obj)
        return key, 'ok', len(bars), bars[-1][0]
    except Exception as e:
        if prev:
            prev['stale'] = True; prev['lastError'] = str(e)[:160]; write(os.path.join(OUT, rel), prev)
            return key, 'stale', len(prev.get('bars', [])), None
        return key, 'fail: ' + str(e)[:100], 0, None

# ---------- Katılım endeksleri: Yahoo'da günlük geçmiş yok (tek satır), ama 730 günlük saatlik mum var → günlük OHLC'ye çevrilir ----------
def katilim_index_job(idx, members_bars):
    ysym = idx + '.IS'
    y = yahoo_intraday(ysym, '730d')
    off = y['gmtoffset']; days = {}
    for t, o, h, l, c, v in y['bars']:
        d = datetime.datetime.fromtimestamp(t + off, datetime.timezone.utc).strftime('%Y-%m-%d')
        if d not in days: days[d] = [d, o, h, l, c, None]
        else:
            b = days[d]; b[2] = max(b[2], h); b[3] = min(b[3], l); b[4] = c
    bars = [days[d] for d in sorted(days)]
    # Bağımsız kontrol: güncel üyelerin eşit ağırlıklı günlük getirileri ile endeksin günlük getirileri arasındaki korelasyon
    check = equal_weight_check(bars, members_bars)
    obj = {'symbol': idx, 'yahoo': ysym, 'kind': 'index', 'name': KAT_NAMES[idx], 'fetchedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'),
           'source': 'Yahoo Finance chart API — 60 dakikalık endeks mumlarından günlük OHLC (açılış = günün ilk saatlik açılışı, kapanış = son saatlik kapanış). Resmi olmayan; Borsa İstanbul kapanış değerinden küçük fark olabilir.',
           'derived': '60 dk mumlardan günlüğe çevrildi', 'currency': 'TRY', 'cols': ['d', 'o', 'h', 'l', 'c', 'v'], 'bars': bars, 'check': check}
    write(os.path.join(OUT, 'index/%s.json' % idx), obj)
    h1 = {'symbol': idx, 'yahoo': ysym, 'kind': 'index', 'tf': '1h', 'name': KAT_NAMES[idx], 'fetchedAt': obj['fetchedAt'], 'source': 'Yahoo Finance chart API, 60 dakikalık mumlar (resmi olmayan)',
          'currency': 'TRY', 'gmtoffset': off, 'cols': ['t', 'o', 'h', 'l', 'c', 'v'], 'bars': y['bars'][-H1_CAP:]}
    write(os.path.join(OUT, 'h1/index/%s.json' % idx), h1)
    return idx, 'ok', len(bars), bars[-1][0] if bars else None

def equal_weight_check(bars, members_bars):
    """Endeksin günlük getirisi ile güncel üyelerin eşit ağırlıklı ortalama getirisi (son 250 gün) — korelasyon ve yıllık izleme farkı."""
    if not members_bars: return {'method': 'eşit ağırlıklı üye karşılaştırması', 'error': 'üye verisi yok'}
    closes = {d[0]: d[4] for d in bars}; ds = sorted(closes)[-251:]
    ri, rm = [], []
    for a, b in zip(ds, ds[1:]):
        rs = []
        for mb in members_bars.values():
            ca, cb = mb.get(a), mb.get(b)
            if ca and cb: rs.append(cb / ca - 1)
        if len(rs) >= 0.6 * len(members_bars):
            ri.append(closes[b] / closes[a] - 1); rm.append(sum(rs) / len(rs))
    if len(ri) < 60: return {'method': 'eşit ağırlıklı üye karşılaştırması', 'error': 'yetersiz ortak gün (%d)' % len(ri)}
    n = len(ri); mi = sum(ri) / n; mm = sum(rm) / n
    cov = sum((x - mi) * (y - mm) for x, y in zip(ri, rm)); vi = sum((x - mi) ** 2 for x in ri); vm = sum((y - mm) ** 2 for y in rm)
    corr = cov / math.sqrt(vi * vm) if vi > 0 and vm > 0 else None
    te = math.sqrt(sum((x - y) ** 2 for x, y in zip(ri, rm)) / n) * math.sqrt(252)
    return {'method': 'Güncel üyelerin eşit ağırlıklı günlük getirisi ile karşılaştırma (son %d gün). Not: güncel üye listesi kullanılır (geçmiş üye değişiklikleri yok).' % n,
            'days': n, 'members': len(members_bars), 'corr': round(corr, 4) if corr is not None else None, 'trackingErrorAnn': round(te, 4)}

# ---------- KAP bildirimleri (kap.org.tr herkese açık bildirim sorgusu; resmi API belgesi yok) ----------
KAP_URL = 'https://www.kap.org.tr/tr/api/disclosure/members/byCriteria'
def kap_tag(subj, summ, cls):
    t = (subj or '') + ' ' + (summ or '')
    if re.search(r'Geri Al', t, re.I): return ('Pay geri alımı', 'pos')
    if re.search(r'Yeni İş İlişkisi|İş İlişkisi|sözleşme imza|ihale', t, re.I): return ('Yeni iş / sözleşme', 'pos')
    if re.search(r'Kar Payı|Kâr Payı|temettü', t, re.I): return ('Kâr payı', 'info')
    if re.search(r'Sermaye Artırımı|Bedelsiz|Bedelli', t, re.I): return ('Sermaye işlemi', 'info')
    if cls == 'FR' or re.search(r'Finansal Rapor|Faaliyet Raporu', t, re.I): return ('Finansal rapor', 'info')
    if re.search(r'Pay Alım Satım Bildirimi', t, re.I): return ('İçeriden pay alım/satımı', 'info')
    if re.search(r'Dava|İdari Para Cezası|Yaptırım|Konkordato|İflas|Haciz|Soruşturma|İşlem Yasağı|Tedbir', t, re.I): return ('Dikkat: hukuki/idari', 'neg')
    if re.search(r'Özel Durum', t, re.I): return ('Özel durum açıklaması', 'info')
    if re.search(r'Genel Kurul', t, re.I): return ('Genel kurul', 'info')
    return ('Diğer bildirim', 'info')

def kap_fetch(days=30):
    end = NOW.astimezone(TR).date(); start = end - datetime.timedelta(days=days); allx = []; errors = []
    cur = start
    while cur <= end:
        e = min(cur + datetime.timedelta(days=1), end)
        if e.year != cur.year: e = datetime.date(cur.year, 12, 31)
        body = json.dumps({'fromDate': cur.isoformat(), 'toDate': e.isoformat(), 'mkkMemberOidList': [], 'subjectList': []}).encode()
        try:
            arr = http(KAP_URL, data=body, headers={'Content-Type': 'application/json', 'Referer': 'https://www.kap.org.tr/tr/bildirim-sorgu'}, tries=3)
            if isinstance(arr, list):
                allx += arr
                if len(arr) >= 2000: errors.append('%s..%s: 2000 sınırına ulaşıldı (eksik olabilir)' % (cur, e))
        except Exception as ex: errors.append('%s..%s: %s' % (cur, e, str(ex)[:80]))
        cur = e + datetime.timedelta(days=1); time.sleep(0.6)
    by = {}
    seen = set()
    for x in allx:
        idx = x.get('disclosureIndex')
        if idx in seen: continue
        seen.add(idx)
        try: pd = datetime.datetime.strptime(x.get('publishDate') or '', '%d.%m.%Y %H:%M:%S').strftime('%Y-%m-%dT%H:%M:%S+03:00')
        except Exception: pd = None
        tag = kap_tag(x.get('subject'), x.get('summary'), x.get('disclosureClass'))
        item = {'i': idx, 'at': pd, 'subj': (x.get('subject') or '').strip()[:140], 'sum': (x.get('summary') or '').strip()[:220], 'cls': x.get('disclosureClass'),
                'tag': tag[0], 'tone': tag[1], 'late': bool(x.get('isLate')), 'fix': bool(x.get('modifyStatus')), 'att': x.get('attachmentCount') or 0}
        own = [c.strip() for c in (x.get('stockCodes') or '').split(',') if c.strip()]
        rel = [c.strip() for c in (x.get('relatedStocks') or '').split(',') if c.strip()]
        for c in own: by.setdefault(c, []).append(item)
        for c in rel:
            if c not in own: by.setdefault(c, []).append(dict(item, related=True))
    return by, len(seen), errors

# ---------- Haberler: Türk ekonomi RSS akışları (başlık + bağlantı; içerik kopyalanmaz) + GDELT (açık veri) ----------
RSS = [('Dünya', 'https://www.dunya.com/rss?dunya'), ('Habertürk Ekonomi', 'https://www.haberturk.com/rss/ekonomi.xml'), ('Ekonomim', 'https://www.ekonomim.com/rss'),
       ('TRT Haber Ekonomi', 'https://www.trthaber.com/ekonomi_articles.rss'), ('Borsa Gündem', 'https://www.borsagundem.com.tr/rss'), ('ForInvest', 'https://www.foreks.com/rss'),
       ('Hürriyet Ekonomi', 'https://www.hurriyet.com.tr/rss/ekonomi'), ('Bloomberg HT', 'https://www.bloomberght.com/rss')]
FOLD = str.maketrans({'ı': 'I', 'İ': 'I', 'i': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C', 'â': 'A', 'Â': 'A', 'î': 'I', 'û': 'U'})
def fold(t): return re.sub(r'\s+', ' ', (t or '').translate(FOLD).upper())
ALIAS = {'THYAO': ['THY', 'TURK HAVA YOLLARI'], 'BIMAS': ['BIM'], 'TUPRS': ['TUPRAS'], 'SISE': ['SISECAM'], 'EREGL': ['ERDEMIR'], 'KCHOL': ['KOC HOLDING'], 'SAHOL': ['SABANCI HOLDING'],
         'FROTO': ['FORD OTOSAN'], 'TOASO': ['TOFAS'], 'PGSUS': ['PEGASUS'], 'TCELL': ['TURKCELL'], 'TTKOM': ['TURK TELEKOM'], 'ASELS': ['ASELSAN'], 'KOZAL': ['KOZA ALTIN'],
         'PETKM': ['PETKIM'], 'ARCLK': ['ARCELIK'], 'MGROS': ['MIGROS'], 'ENKAI': ['ENKA'], 'ULKER': ['ULKER'], 'CCOLA': ['COCA-COLA ICECEK'], 'DOAS': ['DOGUS OTOMOTIV'], 'TAVHL': ['TAV HAVALIMANLARI'],
         'KRDMD': ['KARDEMIR'], 'GARAN': ['GARANTI BBVA'], 'AKBNK': ['AKBANK'], 'YKBNK': ['YAPI KREDI'], 'ISCTR': ['IS BANKASI'], 'HEKTS': ['HEKTAS'], 'SASA': ['SASA POLYESTER'], 'ASTOR': ['ASTOR ENERJI'],
         'KONTR': ['KONTROLMATIK'], 'OYAKC': ['OYAK CIMENTO'], 'TUREX': ['TUREKS'], 'ALARK': ['ALARKO'], 'BRSAN': ['BORUSAN'], 'VESTL': ['VESTEL'], 'OTKAR': ['OTOKAR'], 'TKFEN': ['TEKFEN'], 'AEFES': ['ANADOLU EFES'],
         'SOKM': ['SOK MARKETLER'], 'MAVI': ['MAVI GIYIM'], 'LOGO': ['LOGO YAZILIM'], 'KOZAA': ['KOZA ANADOLU'], 'GUBRF': ['GUBRE FABRIKALARI', 'GUBRETAS'], 'ISMEN': ['IS YATIRIM'], 'CIMSA': ['CIMSA'], 'EUPWR': ['EUROPOWER']}
STOP = set('TURKIYE TURK ANADOLU GLOBAL EURO HEDEF MEGA KONYA IZMIR ISTANBUL ANKARA BURSA NET EGE PASIFIK DOGU BATI YENI MARMARA AKDENIZ KARADENIZ ATLAS ALTIN ENERJI YATIRIM HOLDING GRUP SANAYI TICARET CLASS BANK BANKASI GAYRIMENKUL PETROL INSAAT GIDA TEKSTIL KAGIT CIMENTO ELEKTRIK SIGORTA FINANS MADEN OTOMOTIV TARIM ULUSLARARASI DUNYA ORTAK BORSA PARK DENIZ HAVA'.split())
def keywords(sym, name):
    ks = set(ALIAS.get(sym, []))
    w = [x for x in re.split(r'[^A-Z0-9-]+', fold(name)) if x]
    if w and len(w[0]) >= 5 and w[0] not in STOP: ks.add(w[0])
    return sorted(ks)

def parse_rss(src, b):
    out = []
    try: root = ET.fromstring(b)
    except ET.ParseError: return out
    for it in root.iter('item'):
        t = html.unescape((it.findtext('title') or '').strip()); l = (it.findtext('link') or '').strip(); pd = it.findtext('pubDate') or ''
        try: at = datetime.datetime.strptime(pd.strip()[:25].strip(), '%a, %d %b %Y %H:%M:%S').replace(tzinfo=datetime.timezone.utc)
        except Exception: at = None
        m = re.search(r'([+-]\d{4})$', pd.strip())
        if at and m:
            sg = 1 if m.group(1)[0] == '+' else -1; at = at - sg * datetime.timedelta(hours=int(m.group(1)[1:3]), minutes=int(m.group(1)[3:5]))
        if t and l.startswith('http'): out.append({'title': t[:240], 'url': l[:400], 'src': src, 'at': at.strftime('%Y-%m-%dT%H:%M:%SZ') if at else None})
    return out

def news_fetch(rows, prio):
    status = {}; items = []
    for name, url in RSS:
        try:
            b = http(url, headers={'Accept': 'application/rss+xml,application/xml,text/xml,*/*'}, tries=2, raw=True)
            got = parse_rss(name, b); items += got; status[name] = {'ok': True, 'n': len(got)}
        except Exception as e: status[name] = {'ok': False, 'err': str(e)[:80]}
    gd = {'ok': 0, 'fail': 0}
    if MODE == 'full' and not SKIP_GDELT:
        names = {r['s']: r['name'] for r in rows}
        for sym in prio:
            kw = keywords(sym, names.get(sym, ''))
            q = (kw[0] if kw else sym)
            url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=%s&mode=artlist&format=json&maxrecords=20&timespan=7d&sort=datedesc' % urllib.request.quote('"%s" sourcecountry:turkey' % q.lower() if len(q.split()) > 1 else q.lower() + ' sourcecountry:turkey')
            try:
                j = http(url, tries=1, timeout=20)
                for a in (j.get('articles') or []):
                    sd = a.get('seendate') or ''
                    at = ('%s-%s-%sT%s:%s:%sZ' % (sd[0:4], sd[4:6], sd[6:8], sd[9:11], sd[11:13], sd[13:15])) if len(sd) >= 15 else None
                    items.append({'title': (a.get('title') or '')[:240], 'url': (a.get('url') or '')[:400], 'src': 'GDELT · ' + (a.get('domain') or ''), 'at': at, 'gsym': sym})
                gd['ok'] += 1
            except Exception: gd['fail'] += 1
            time.sleep(6)
    status['GDELT'] = gd
    # Önceki 14 günle birleştir (aynı bağlantı tek), 14 günden eskiler atılır
    prev = load_prev('news/pool.json') or {}
    pool = {x['url']: x for x in prev.get('items', [])}
    for x in items:
        if x['url'] not in pool or (x.get('gsym') and not pool[x['url']].get('gsym')): pool[x['url']] = x
    cut = (NOW - datetime.timedelta(days=14)).strftime('%Y-%m-%dT%H:%M:%SZ')
    allit = sorted([x for x in pool.values() if (x.get('at') or NOW.strftime('%Y-%m-%dT%H:%M:%SZ')) >= cut and (x.get('at') or '') <= (NOW + datetime.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ')], key=lambda x: x.get('at') or '', reverse=True)
    write(os.path.join(OUT, 'news/pool.json'), {'generatedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'items': allit[:3000]})
    # Hisse eşleştirme: başlıkta (Türkçe karakterler katlanarak) şirketin belirgin adı/kısa adı veya büyük harfle hisse kodu geçmeli
    by = {}; folded = [fold(x['title']) for x in allit]
    for r in rows:
        sym = r['s']; kws = keywords(sym, r['name']); pats = [re.compile(r'(?<![A-Z0-9])' + re.escape(k) + r'(?![A-Z0-9])') for k in kws]
        tick = re.compile(r'(?<![A-Za-z0-9])' + re.escape(sym) + r'(?![A-Za-z0-9])') if len(sym) >= 4 else None
        for x, ft in zip(allit, folded):
            hit = None
            for k, pt in zip(kws, pats):
                if pt.search(ft): hit = k; break
            if not hit and tick and tick.search(x['title']): hit = sym
            if not hit and x.get('gsym') == sym: hit = 'GDELT sorgusu: ' + (kws[0] if kws else sym)
            if hit: by.setdefault(sym, []).append(dict(x, match=hit))
    topics = {'gold': r'(?<![A-Z])(ALTIN|ONS|GRAM ALTIN|GUMUS)(?![A-Z])', 'fx': r'(?<![A-Z])(DOLAR|EURO|KUR|TCMB|MERKEZ BANKASI|DOVIZ)(?![A-Z])',
              'crypto': r'(?<![A-Z])(BITCOIN|KRIPTO|ETHEREUM|BTC|ETH)(?![A-Z])', 'market': r'(?<![A-Z])(BORSA ISTANBUL|BIST|BIST 100|BORSA)(?![A-Z])'}
    for k, rx in topics.items():
        R = re.compile(rx); its = [x for x, ft in zip(allit, folded) if R.search(ft)][:40]
        write(os.path.join(OUT, 'news/topic/%s.json' % k), {'generatedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'topic': k, 'items': its})
    for sym, its in by.items():
        write(os.path.join(OUT, 'news/bist/%s.json' % sym), {'generatedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'symbol': sym, 'keywords': keywords(sym, next((r['name'] for r in rows if r['s'] == sym), '')), 'items': its[:30]})
    return {'generatedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'feeds': status, 'pool': len(allit), 'symbols': {k: len(v) for k, v in by.items()},
            'method': 'Başlıkta şirketin belirgin adı (Türkçe karakterler katlanarak, tam kelime) veya büyük harfle hisse kodu geçen haberler; GDELT için şirket adıyla Türkiye kaynaklı sorgu. Yalnız başlık + bağlantı saklanır.'}

def copy_prev():
    if PREV and os.path.isdir(PREV):
        for name in os.listdir(PREV):
            if name in ('.git',): continue
            src = os.path.join(PREV, name); dst = os.path.join(OUT, name)
            if os.path.isdir(src): shutil.copytree(src, dst, dirs_exist_ok=True)
            elif name != 'README.md': shutil.copy2(src, dst)

def run_side(rows, members):
    """Saatlik mumlar, KAP ve haberler (iki modda da)."""
    t1 = time.time()
    intr = sorted(set(members.get('XKTUM', [])) | set(members.get('XU100', [])) | set(members.get('XU030', [])))
    names = {r['s']: r for r in rows}
    if LIMIT: intr = intr[:LIMIT]
    jobs = [('bist', s_, s_ + '.IS', {'name': names[s_]['name'] if s_ in names else s_}) for s_ in intr]
    jobs += [('index', k, v[0], {'name': v[1]}) for k, v in INDEX.items()]
    jobs += [('macro', k, v[0], {'name': v[1]}) for k, v in MACRO.items()]
    jobs += [('us', k, k, {'name': v}) for k, v in US.items()]
    res = []
    with cf.ThreadPoolExecutor(max_workers=int(os.environ.get('WORKERS', '6'))) as ex:
        for f in cf.as_completed([ex.submit(h1_job, *j) for j in jobs]): res.append(f.result())
    h1 = {'ok': sum(1 for r in res if r[1] == 'ok'), 'stale': sum(1 for r in res if r[1] == 'stale'), 'fail': sorted(r[0] + ': ' + r[1] for r in res if r[1].startswith('fail'))[:50],
          'symbols': {'bist': sorted(r[0] for r in res if r[2] > 0 and r[0] in names), 'index': sorted(k for k in INDEX), 'macro': sorted(MACRO), 'us': sorted(US)}, 'seconds': round(time.time() - t1)}
    try:
        kap, kn, kerr = kap_fetch(30)
        for sym, its in kap.items():
            its.sort(key=lambda x: x.get('at') or '', reverse=True)
            write(os.path.join(OUT, 'kap/%s.json' % sym), {'generatedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'symbol': sym, 'source': 'KAP — Kamuyu Aydınlatma Platformu (kap.org.tr bildirim sorgusu, son 30 gün)', 'items': its[:40]})
        kapst = {'ok': kn > 0, 'disclosures': kn, 'symbols': len(kap), 'list': sorted(kap.keys()), 'errors': kerr[:10], 'days': 30}
    except Exception as e: kapst = {'ok': False, 'error': str(e)[:120]}
    prio = sorted(set(members.get('XK030', [])) | set(members.get('XU030', [])))
    try: nst = news_fetch(rows, prio)
    except Exception as e: nst = {'error': str(e)[:160]}
    return h1, kapst, nst

def main_intraday():
    t0 = time.time(); copy_prev()
    prev_idx = load_prev('index.json')
    if not prev_idx: print('Önce tam çalıştırma gerekli (index.json yok)'); sys.exit(2)
    rows = [{'s': b['s'], 'name': b['n'], 'sector': b.get('sec')} for b in prev_idx.get('bist', [])]
    members = dict(prev_idx.get('katilim', {}).get('members', {})); members.update(prev_idx.get('indexMembers', {}))
    h1, kapst, nst = run_side(rows, members)
    prev_idx['intraday'] = dict(h1, generatedAt=NOW.strftime('%Y-%m-%dT%H:%M:%SZ')); prev_idx['kap'] = dict(kapst, generatedAt=NOW.strftime('%Y-%m-%dT%H:%M:%SZ')); prev_idx['news'] = nst
    prev_idx['intradayAt'] = NOW.strftime('%Y-%m-%dT%H:%M:%SZ')
    write(os.path.join(OUT, 'index.json'), prev_idx)
    print('intraday', json.dumps({'h1': {k: h1[k] for k in ('ok', 'stale', 'seconds')}, 'kap': kapst, 'news': {k: nst.get(k) for k in ('pool', 'feeds')}}, ensure_ascii=False)[:1500], round(time.time() - t0), 's')

def main():
    if MODE == 'intraday': return main_intraday()
    t0 = time.time(); copy_prev()
    rows, members = universe()
    if LIMIT: rows = rows[:LIMIT]
    print('BIST evreni:', len(rows), {k: len(v) for k, v in members.items()})
    kat = set(members.get('XKTUM', []))
    jobs = [('bist', r['s'], r['s'] + '.IS', {'name': r['name'], 'sector': r['sector'], 'katilim': [k for k in KAT_IDX if r['s'] in members.get(k, [])]}) for r in rows]
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
        'katilim': {'asOf': NOW.astimezone(TR).strftime('%Y-%m-%d'), 'source': 'Borsa İstanbul Katılım endeksleri bileşenleri — TradingView endeks listesi (SYML:BIST;XKTUM/XK100/XK050/XK030)', 'members': {k: members.get(k, []) for k in KAT_IDX}},
        'indexMembers': {k: members.get(k, []) for k in ('XU100', 'XU030')},
        'bist': [{'s': r['s'], 'n': r['name'], 'sec': r['sector'], 'k': 1 if r['s'] in kat else 0} for r in rows if r['s'] in avail],
        'index': sorted(k for k in INDEX if k in avail), 'macro': sorted(k for k in MACRO if k in avail), 'us': sorted(k for k in US if k in avail),
        'stats': {'ok': len(ok), 'stale': len(stale), 'fail': len(fail), 'seconds': round(time.time() - t0)},
        'failed': sorted(r[0] + ': ' + r[1] for r in fail)[:200], 'staleList': sorted(r[0] for r in stale)[:200]
    }
    # Katılım endeksleri (gerçek endeks değerleri, saatlikten günlüğe) + bağımsız eşit ağırlık kontrolü
    kidx = {}
    for idx in KAT_IDX:
        mb = {}
        for s_ in members.get(idx, []):
            o = load_json(os.path.join(OUT, 'bist/%s.json' % s_))
            if o and o.get('bars'): mb[s_] = {b[0]: b[4] for b in o['bars'][-260:]}
        try: kidx[idx] = katilim_index_job(idx, mb)[1]
        except Exception as e:
            kidx[idx] = 'fail: ' + str(e)[:100]
            print('Katılım endeksi alınamadı', idx, e)
    index['index'] = sorted(set(index['index']) | {k for k, v in kidx.items() if v == 'ok' or os.path.exists(os.path.join(OUT, 'index/%s.json' % k))})
    index['katilimIndex'] = kidx
    h1, kapst, nst = run_side(rows, members)
    index['intraday'] = dict(h1, generatedAt=NOW.strftime('%Y-%m-%dT%H:%M:%SZ')); index['kap'] = dict(kapst, generatedAt=NOW.strftime('%Y-%m-%dT%H:%M:%SZ')); index['news'] = nst
    index['intradayAt'] = NOW.strftime('%Y-%m-%dT%H:%M:%SZ')
    index['stats']['seconds'] = round(time.time() - t0)
    write(os.path.join(OUT, 'index.json'), index)
    print(json.dumps(index['stats']), 'başarısız örnek:', index['failed'][:10])
    print('katılım endeksleri', kidx, 'saatlik', {k: h1[k] for k in ('ok', 'stale', 'seconds')}, 'kap', kapst, 'haber', json.dumps(nst.get('feeds'), ensure_ascii=False))
    if len(ok) + len(stale) < 0.5 * len(jobs):
        print('HATA: sembollerin yarısından azı alınabildi'); sys.exit(2)

if __name__ == '__main__':
    main()
