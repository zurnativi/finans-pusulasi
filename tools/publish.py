#!/usr/bin/env python3
"""publish.py — market-data dalına çakışmasız yayın (v8.1).
Kullanım: python3 tools/publish.py OUT_DIR PREV_DIR JOB     (JOB: news | intraday | daily | crypto | portfolio | reports)

Neden gerekli: birden çok zamanlanmış iş (haber ≈20 dk, saatlik seans içi, günlük tam, kripto saatlik) aynı dala yazar. Her iş başında dalın o anki halini
(PREV) okur; bitirdiğinde dal başka bir iş tarafından değişmiş olabilir. Bu betik yayın anında dalın GÜNCEL halini alır, yalnızca bu işin BAŞLANGIÇ halinden
farklılaşan dosyalarını üstüne işler (böylece başka işin daha taze verisi eski kopyayla ezilmez), özel dosyaları birleştirir (uyarılar, haber havuzu, index.json),
analiz dizinini yeniden üretir, isteğe bağlı ntfy gönderir, tek commit'lik dalı --force-with-lease ile yazar; reddedilirse yeniden dener.
Depo şişmez: dal her seferinde TEK commit'tir (geçmiş tutulmaz)."""
import os, sys, json, re, shutil, subprocess, tempfile, time, hashlib, datetime, urllib.request, base64

ISO = '%Y-%m-%dT%H:%M:%SZ'
NOW = datetime.datetime.now(datetime.timezone.utc)
NOWS = NOW.strftime(ISO)
BRANCH = 'market-data'
OWN = {  # işin yazabileceği yollar (güvenlik ağı)
    'news': ('news/', 'hub/', 'index.json', 'status/news.json'),
    'intraday': ('h1/', 'kap/', 'news/', 'hub/', 'analysis/', 'index.json', 'status/intraday.json'),
    'crypto': ('analysis/', 'status/crypto.json'),
    'daily': ('',),
    'portfolio': ('bg/',),   # v8.2: yalnız ŞİFRELİ sonuç dosyası (bg/results.enc.json); düz metin portföy verisi asla
    'reports': ('reports/', 'bg/reports.enc.json', 'status/reports.json'),   # v8.5: herkese açık piyasa raporları + ŞİFRELİ kişisel raporlar
}
INDEX_LATEST = ('intraday', 'kap', 'news')      # index.json'da "en yeni generatedAt kazanır" anahtarlar
PRIVATE = os.environ.get('PRIVATE_DIR', '/tmp/fp-private')

def sh(cmd, cwd=None, check=True, quiet=False):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError('%s → %s' % (' '.join(cmd[:3]), (r.stderr or r.stdout)[-300:].replace(os.environ.get('GITHUB_TOKEN', '\0'), '***')))
    return r

def remote_url():
    if os.environ.get('REMOTE_URL'): return os.environ['REMOTE_URL']
    return 'https://x-access-token:%s@github.com/%s.git' % (os.environ['GITHUB_TOKEN'], os.environ['GITHUB_REPOSITORY'])

def read_json(p, default=None):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception: return default

def write_json(p, o):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f: json.dump(o, f, ensure_ascii=False, separators=(',', ':'))

def files(root):
    for d, ds, fs in os.walk(root):
        if '.git' in ds: ds.remove('.git')
        for f in fs:
            p = os.path.join(d, f); yield os.path.relpath(p, root).replace(os.sep, '/')

def same(a, b):
    try:
        if os.path.getsize(a) != os.path.getsize(b): return False
        with open(a, 'rb') as x, open(b, 'rb') as y: return x.read() == y.read()
    except OSError: return False

def allowed(job, rel):
    own = OWN[job]
    if job == 'crypto': return (rel.startswith('analysis/cg-') or rel == 'analysis/_run-crypto.json' or rel == 'status/crypto.json')
    return any(rel == o or (o.endswith('/') and rel.startswith(o)) or o == '' for o in own)

# ---------------------------------------------------------------- birleştirmeler
def merge_alerts(head, mine, extra):
    items = {}
    for a in (head or {}).get('items', []) + (mine or {}).get('items', []) + extra:
        o = items.get(a['id'])
        if o is None: items[a['id']] = dict(a)
        else:
            if a.get('pushed') and not o.get('pushed'): o['pushed'] = a['pushed']
    cut = (NOW - datetime.timedelta(days=7)).strftime(ISO)
    allitems = sorted([a for a in items.values() if a['at'] >= cut], key=lambda a: a['at'], reverse=True)[:150]
    return {'generatedAt': max((mine or {}).get('generatedAt') or '', (head or {}).get('generatedAt') or '') or NOWS, 'items': allitems, 'newCount': (mine or {}).get('newCount', 0)}

def merge_pool(head, mine):
    pool = {x['url']: x for x in (head or {}).get('items', [])}
    for x in (mine or {}).get('items', []):
        o = pool.get(x['url'])
        if o is None or (x.get('gsym') and not o.get('gsym')) or (x.get('at') and not o.get('at')): pool[x['url']] = x
        elif o.get('approx') and not x.get('approx'): pool[x['url']] = x
    cut = (NOW - datetime.timedelta(days=14)).strftime(ISO)
    its = sorted([x for x in pool.values() if (x.get('at') or NOWS) >= cut], key=lambda x: x.get('at') or '', reverse=True)[:4000]
    return {'generatedAt': max((mine or {}).get('generatedAt') or '', (head or {}).get('generatedAt') or ''), 'items': its}

def merge_index(head, mine, job):
    if not head: return mine
    out = dict(head)
    for k, v in (mine or {}).items():
        if k in INDEX_LATEST:
            hv = head.get(k)
            if not (isinstance(hv, dict) and isinstance(v, dict) and (hv.get('generatedAt') or '') > (v.get('generatedAt') or '')): out[k] = v
        elif k == 'intradayAt': out[k] = max(v or '', head.get(k) or '')
        elif job == 'daily' or k not in head: out[k] = v
    return out

# ---------------------------------------------------------------- analiz dizini (Snap.row ile aynı alanlar)
def snap_row(s):
    st = s.get('stance') or {}; pl = (s.get('plans') or {}).get('conservative')
    return {'key': s['key'], 'name': s['name'], 'kind': s['kind'], 'total': s['total'], 'conf': s['confidence'], 'confLabel': s['confLabel'], 'stance': st.get('label'), 'stanceCode': st.get('code'),
            'price': s['price'], 'cur': s['currency'], 'lastDate': s['lastDate'], 'at': s['at'], 'blocked': s['blocked'], 'halal': (s.get('halal') or {}).get('status'), 'rr': pl['rr'] if pl else None}

def rebuild_analysis_index(root):
    d = os.path.join(root, 'analysis'); items = []; runs = {}
    if not os.path.isdir(d): return
    for f in sorted(os.listdir(d)):
        if not f.endswith('.json'): continue
        o = read_json(os.path.join(d, f))
        if not o: continue
        if f.startswith('_run-'): runs[f[5:-5]] = {k: o.get(k) for k in ('generatedAt', 'ok', 'failed', 'seconds')}; continue
        if f == 'index.json' or 'key' not in o: continue
        items.append(snap_row(o))
    items.sort(key=lambda r: r['key'])
    write_json(os.path.join(d, 'index.json'), {'generatedAt': max([r['at'] or '' for r in items] or [NOWS]), 'v': 1, 'count': len(items), 'runs': runs, 'items': items})

# ---------------------------------------------------------------- ntfy
def ntfy_post(topic, a):
    msg = {'topic': topic, 'title': ('🔴 ' if a['sev'] == 'critical' else '🟠 ') + a['title'][:100], 'message': a['body'][:300], 'priority': 5 if a['sev'] == 'critical' else 4,
           'tags': ['chart_with_downwards_trend'], 'click': a.get('url') or 'https://zurnativi.github.io/finans-pusulasi/#haberler'}
    req = urllib.request.Request(os.environ.get('NTFY_URL', 'https://ntfy.sh/'), data=json.dumps(msg).encode('utf-8'), headers={'Content-Type': 'application/json', 'User-Agent': 'finans-pusulasi'})
    urllib.request.urlopen(req, timeout=20).read()

def hid(topic, id_): return hashlib.sha256((topic + '|' + id_).encode('utf-8')).hexdigest()[:16]

def ntfy_topic():
    """Konu adı: NTFY_TOPIC sırrı; yoksa PORTFOLIO_KEY kurulum dizgesinin içindeki konu (tek sırla kurulum). Yazdırılmaz."""
    t = os.environ.get('NTFY_TOPIC', '').strip()
    if t: return t
    k = os.environ.get('PORTFOLIO_KEY', '').strip()
    if k.startswith('FPBG1.'):
        try:
            b = k[6:]; b += '=' * (-len(b) % 4)
            return str(json.loads(base64.urlsafe_b64decode(b)).get('t') or '')
        except Exception: return ''
    return ''

def notify(merged_root, sent_cache):
    """Herkese açık uyarılar: kritik (+ NTFY_MIN=high ise yüksek), pushed işaretsiz, son 12 saatte. İzleme listesine özel uyarılar: yalnız ntfy, tuzlu özet ile tekrar önleme."""
    topic = ntfy_topic(); res = {'enabled': False, 'sent': 0}
    if not topic or not re.match(r'^[A-Za-z0-9_-]{8,64}$', topic): return res
    res['enabled'] = True; minhigh = os.environ.get('NTFY_MIN', '').strip().lower() == 'high'
    ap = os.path.join(merged_root, 'hub/alerts.json'); al = read_json(ap) or {'items': []}; cut = (NOW - datetime.timedelta(hours=12)).strftime(ISO); sent = 0
    for a in al['items']:
        if a.get('pushed') or a['at'] < cut or a['sev'] not in ('critical', 'high') or (a['sev'] == 'high' and not minhigh): continue
        if a['id'] in sent_cache: a['pushed'] = sent_cache[a['id']]; continue
        if sent >= 5: break
        try: ntfy_post(topic, a); a['pushed'] = NOWS; sent_cache[a['id']] = NOWS; sent += 1
        except Exception as e: print('ntfy hata', str(e)[:80])
    write_json(ap, al)
    pp = os.path.join(merged_root, 'hub/pushed.json'); pushed = read_json(pp) or {'h': []}
    for a in (read_json(os.path.join(PRIVATE, 'watch-alerts.json')) or []):
        h = hid(topic, a['id'])
        if h in pushed['h'] or h in sent_cache or sent >= 8: continue
        try: ntfy_post(topic, dict(a, url='https://zurnativi.github.io/finans-pusulasi/#analiz')); pushed['h'].append(h); sent_cache[h] = NOWS; sent += 1
        except Exception as e: print('ntfy hata', str(e)[:80])
    pushed['h'] = pushed['h'][-500:]; write_json(pp, {'h': pushed['h'], 'note': 'Tuzlu özetler: gizli konu adı olmadan hangi uyarının gönderildiği anlaşılamaz.'})
    res['sent'] = sent; return res

# ---------------------------------------------------------------- ana akış
def build_merged(out, prev, job, work, sent_cache):
    headdir = os.path.join(work, 'head')
    if os.path.exists(headdir): shutil.rmtree(headdir)
    r = sh(['git', 'clone', '-q', '--depth', '1', '--branch', BRANCH, remote_url(), headdir], check=False)
    headsha = None
    if r.returncode == 0: headsha = sh(['git', 'rev-parse', 'HEAD'], cwd=headdir).stdout.strip()
    else:
        if 'not found' not in (r.stderr or '') and 'Remote branch' not in (r.stderr or ''): raise RuntimeError('dal alınamadı: ' + (r.stderr or '')[-200:].replace(os.environ.get('GITHUB_TOKEN', '\0'), '***'))
        os.makedirs(headdir)
    shutil.rmtree(os.path.join(headdir, '.git'), ignore_errors=True)
    copied = 0
    for rel in files(out):
        if not allowed(job, rel): continue
        if rel in ('hub/alerts.json', 'news/pool.json', 'index.json') or rel.startswith('analysis/index'): continue   # özel birleştirme
        src = os.path.join(out, rel); dst = os.path.join(headdir, rel)
        if prev and os.path.exists(os.path.join(prev, rel)) and same(src, os.path.join(prev, rel)) and os.path.exists(dst): continue   # bu iş değiştirmedi → dalın (belki daha taze) hali kalır
        os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst); copied += 1
    # özel dosyalar
    extra = [dict(a, at=NOWS) for a in (read_json(os.path.join(PRIVATE, 'analysis-alerts.json')) or [])]   # analiz değişimi uyarıları (kripto işi de üretir)
    if allowed(job, 'hub/alerts.json') or extra:
        mine = read_json(os.path.join(out, 'hub/alerts.json')) if allowed(job, 'hub/alerts.json') else None
        write_json(os.path.join(headdir, 'hub/alerts.json'), merge_alerts(read_json(os.path.join(headdir, 'hub/alerts.json')), mine, extra))
    if allowed(job, 'news/pool.json') and os.path.exists(os.path.join(out, 'news/pool.json')):
        write_json(os.path.join(headdir, 'news/pool.json'), merge_pool(read_json(os.path.join(headdir, 'news/pool.json')), read_json(os.path.join(out, 'news/pool.json'))))
    if allowed(job, 'index.json') and os.path.exists(os.path.join(out, 'index.json')):
        write_json(os.path.join(headdir, 'index.json'), merge_index(read_json(os.path.join(headdir, 'index.json')), read_json(os.path.join(out, 'index.json')), job))
    # silinecek yollar (OUT/.delete): yalnızca işin kendi izin listesindekiler (ör. kapatılan portföy izlemenin şifreli sonucu)
    dp = os.path.join(out, '.delete')
    if os.path.exists(dp):
        for rel in open(dp, encoding='utf-8').read().split():
            if allowed(job, rel) and rel != '' and os.path.isfile(os.path.join(headdir, rel)): os.remove(os.path.join(headdir, rel))
    if job in ('portfolio', 'reports'): return headdir, headsha, copied, {'enabled': False, 'sent': 0}   # kendi bildirimini kendisi gönderir
    rebuild_analysis_index(headdir)
    st = {'job': job, 'ok': True, 'generatedAt': NOWS, 'seconds': int(os.environ.get('JOB_SECONDS', '0') or 0)}
    if os.environ.get('GITHUB_RUN_ID'): st['run'] = '%s/%s/actions/runs/%s' % (os.environ.get('GITHUB_SERVER_URL', 'https://github.com'), os.environ.get('GITHUB_REPOSITORY', ''), os.environ['GITHUB_RUN_ID'])
    write_json(os.path.join(headdir, 'status/%s.json' % job), st)
    nt = notify(headdir, sent_cache)
    return headdir, headsha, copied, nt

def publish(out, prev, job):
    if job not in OWN: raise SystemExit('bilinmeyen iş: ' + job)
    work = tempfile.mkdtemp(prefix='fp-pub-'); sent_cache = {}
    last = None
    for attempt in range(1, 7):
        try:
            headdir, headsha, copied, nt = build_merged(out, prev, job, work, sent_cache)
            sh(['git', 'init', '-q', '-b', BRANCH], cwd=headdir)
            sh(['git', 'config', 'user.name', 'market-data-bot'], cwd=headdir); sh(['git', 'config', 'user.email', 'actions@users.noreply.github.com'], cwd=headdir)
            readme = os.path.join(headdir, 'README.md')
            if not os.path.exists(readme):
                with open(readme, 'w', encoding='utf-8') as f: f.write('# Finans Pusulası piyasa verisi\nOtomatik üretilir (tools/*.py, tools/precompute.js). Kişisel, ticari olmayan kullanım. Kaynaklar resmi değildir.\n')
            sh(['git', 'add', '-A'], cwd=headdir)
            sh(['git', 'commit', '-q', '-m', 'Piyasa verisi %s (%s)' % (NOW.strftime('%Y-%m-%dT%H:%MZ'), job)], cwd=headdir)
            lease = '--force-with-lease=%s:%s' % (BRANCH, headsha or '')
            sh(['git', 'push', '-q', lease, remote_url(), 'HEAD:refs/heads/' + BRANCH], cwd=headdir)
            print('yayınlandı', job, 'deneme', attempt, 'değişen dosya', copied, 'ntfy', json.dumps(nt))
            shutil.rmtree(work, ignore_errors=True); return 0
        except Exception as e:
            last = str(e); print('yayın denemesi %d başarısız: %s' % (attempt, last[:200])); time.sleep(min(30, 3 * attempt) + (hash(job) % 5))
    shutil.rmtree(work, ignore_errors=True)
    print('HATA: yayınlanamadı —', last); return 2

if __name__ == '__main__':
    if len(sys.argv) != 4: raise SystemExit(__doc__)
    sys.exit(publish(sys.argv[1], sys.argv[2] if os.path.isdir(sys.argv[2]) else None, sys.argv[3]))
