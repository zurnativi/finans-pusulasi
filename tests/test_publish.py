"""tools/publish.py birim testi (yerel çıplak depo; ağ yok). Çalıştırma: python3 -m unittest tests/test_publish.py"""
import os, sys, json, shutil, subprocess, tempfile, unittest, importlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'tools'))

def sh(*a, cwd=None): return subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True).stdout
def wj(root, rel, o):
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True); json.dump(o, open(p, 'w'))
def rj(root, rel): return json.load(open(os.path.join(root, rel)))

class PublishTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.bare = os.path.join(self.tmp, 'r.git'); sh('git', 'init', '-q', '--bare', '-b', 'market-data', self.bare)
        os.environ['REMOTE_URL'] = self.bare; os.environ['PRIVATE_DIR'] = os.path.join(self.tmp, 'priv'); os.environ.pop('NTFY_TOPIC', None)
        import publish; self.P = importlib.reload(publish)
        seed = os.path.join(self.tmp, 'seed'); os.makedirs(seed)
        wj(seed, 'bist/ASELS.json', {'bars': [1]}); wj(seed, 'h1/bist/ASELS.json', {'v': 1}); wj(seed, 'hub/calendar.json', {'generatedAt': 'A', 'n': 1}); wj(seed, 'hub/analogs.json', {'generatedAt': 'old'})
        wj(seed, 'hub/alerts.json', {'generatedAt': '2026-01-01T00:00:00Z', 'items': []}); wj(seed, 'news/pool.json', {'generatedAt': '2026-01-01T00:00:00Z', 'items': []})
        wj(seed, 'index.json', {'generatedAt': 'x', 'bist': [{'s': 'ASELS'}], 'news': {'generatedAt': '2026-11-18T00:00:00Z'}, 'intraday': {'generatedAt': '2026-11-18T00:00:00Z'}, 'intradayAt': '2026-11-18T00:00:00Z'})
        self.seed = seed; self.assertEqual(self.P.publish(seed, None, 'daily'), 0)
    def tearDown(self): shutil.rmtree(self.tmp, ignore_errors=True)
    def head(self):
        d = os.path.join(self.tmp, 'chk'); shutil.rmtree(d, ignore_errors=True); sh('git', 'clone', '-q', '--depth', '1', '--branch', 'market-data', self.bare, d); return d
    def start(self, name):  # bir işin başlangıç kopyası (PREV) ve çıktısı (OUT)
        prev = os.path.join(self.tmp, name + '-prev'); out = os.path.join(self.tmp, name + '-out'); h = self.head(); shutil.rmtree(os.path.join(h, '.git'))
        shutil.copytree(h, prev); shutil.copytree(h, out); return prev, out

    def test_single_commit_and_branch_exists(self):
        h = self.head(); self.assertEqual(sh('git', 'rev-list', '--count', 'HEAD', cwd=h).strip(), '1'); self.assertTrue(os.path.exists(os.path.join(h, 'status/daily.json')))

    def test_concurrent_jobs_do_not_clobber(self):
        pa, oa = self.start('news'); pb, ob = self.start('intraday')
        # intraday: yeni saatlik mum + daha taze takvim + analiz + analogs (dokunmadan) ; news: haber + takvim değişmeden
        wj(ob, 'h1/bist/ASELS.json', {'v': 2}); wj(ob, 'hub/calendar.json', {'generatedAt': 'B', 'n': 2})
        wj(ob, 'analysis/bist-ASELS.json', {'key': 'bist:ASELS', 'name': 'ASELS', 'kind': 'stock', 'total': 51, 'confidence': 90, 'confLabel': 'Yüksek', 'stance': {'code': 'neutral', 'label': 'Nötr'}, 'price': 1, 'currency': 'TRY', 'lastDate': '2026-11-17', 'at': '2026-11-18T07:00:00Z', 'blocked': False, 'halal': {'status': 'uygun'}, 'plans': None})
        wj(ob, 'hub/alerts.json', {'generatedAt': 'B', 'items': [{'id': 'a1', 'sev': 'high', 'cat': 'market', 'title': 't', 'body': 'b', 'at': '2099-01-01T00:00:00Z'}]})
        self.assertEqual(self.P.publish(ob, pb, 'intraday'), 0)
        wj(oa, 'news/feed.json', {'generatedAt': 'N', 'items': [1]}); wj(oa, 'news/pool.json', {'generatedAt': 'N', 'items': [{'url': 'u1', 'title': 't', 'at': '2099-01-01T00:00:00Z'}]})
        wj(oa, 'hub/alerts.json', {'generatedAt': 'N', 'items': [{'id': 'a2', 'sev': 'critical', 'cat': 'news', 'title': 't2', 'body': 'b', 'at': '2099-01-01T00:00:00Z'}]})
        wj(oa, 'index.json', {'generatedAt': 'x', 'bist': [], 'news': {'generatedAt': '2026-11-18T09:00:00Z'}, 'intraday': {'generatedAt': '2020-01-01T00:00:00Z'}, 'intradayAt': '2020-01-01T00:00:00Z'})
        self.assertEqual(self.P.publish(oa, pa, 'news'), 0)
        h = self.head()
        self.assertEqual(rj(h, 'h1/bist/ASELS.json'), {'v': 2}, 'intraday verisi ezilmedi')
        self.assertEqual(rj(h, 'hub/calendar.json')['n'], 2, 'news işi dokunmadığı takvimi eski kopyayla ezmedi')
        self.assertEqual(sorted(a['id'] for a in rj(h, 'hub/alerts.json')['items']), ['a1', 'a2'], 'uyarılar birleşti')
        self.assertEqual(rj(h, 'news/feed.json')['items'], [1]); self.assertEqual([x['url'] for x in rj(h, 'news/pool.json')['items']], ['u1'])
        ix = rj(h, 'index.json'); self.assertEqual(ix['news']['generatedAt'], '2026-11-18T09:00:00Z'); self.assertEqual(ix['intraday']['generatedAt'], '2026-11-18T00:00:00Z', 'eski intraday anahtarı yeniyi ezmedi'); self.assertEqual(ix['bist'], [{'s': 'ASELS'}], 'yalnız günlük iş bist listesini değiştirir')
        self.assertTrue(os.path.exists(os.path.join(h, 'status/news.json'))); self.assertTrue(os.path.exists(os.path.join(h, 'status/intraday.json')))
        ai = rj(h, 'analysis/index.json'); self.assertEqual([r['key'] for r in ai['items']], ['bist:ASELS']); self.assertEqual(sh('git', 'rev-list', '--count', 'HEAD', cwd=h).strip(), '1')

    def test_job_cannot_write_outside_its_paths(self):
        p, o = self.start('crypto'); wj(o, 'bist/ASELS.json', {'bars': [9]}); wj(o, 'analysis/cg-bitcoin.json', {'key': 'cg:bitcoin', 'name': 'BTC', 'kind': 'crypto', 'total': 48, 'confidence': 95, 'confLabel': 'x', 'stance': {'code': 'neutral', 'label': 'N'}, 'price': 1, 'currency': 'USD', 'lastDate': 'd', 'at': 'a', 'blocked': False, 'halal': {'status': 'supheli'}, 'plans': None})
        self.assertEqual(self.P.publish(o, p, 'crypto'), 0); h = self.head()
        self.assertEqual(rj(h, 'bist/ASELS.json'), {'bars': [1]}); self.assertTrue(os.path.exists(os.path.join(h, 'analysis/cg-bitcoin.json')))

    def test_retry_when_branch_moves_during_publish(self):
        p, o = self.start('news'); wj(o, 'news/feed.json', {'generatedAt': 'N', 'items': [7]})
        orig = self.P.build_merged; state = {'n': 0}
        def wrapped(*a, **k):
            r = orig(*a, **k)
            if state['n'] == 0:  # tam bu sırada başka iş dalı ilerletir → force-with-lease reddeder
                state['n'] = 1; d = os.path.join(self.tmp, 'intf'); sh('git', 'clone', '-q', '--depth', '1', '--branch', 'market-data', self.bare, d)
                wj(d, 'h1/bist/ASELS.json', {'v': 99}); sh('git', 'add', '-A', cwd=d); sh('git', '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'i', cwd=d)
                sh('git', 'push', '-q', '--force', self.bare, 'HEAD:market-data', cwd=d)
            return r
        self.P.build_merged = wrapped; self.P.time.sleep = lambda s: None
        self.assertEqual(self.P.publish(o, p, 'news'), 0); h = self.head()
        self.assertEqual(rj(h, 'h1/bist/ASELS.json'), {'v': 99}, 'araya giren iş korunur'); self.assertEqual(rj(h, 'news/feed.json')['items'], [7]); self.assertGreaterEqual(state['n'], 1)

    def test_ntfy_only_critical_unpushed_once(self):
        sent = []
        self.P.ntfy_post = lambda topic, a: sent.append((topic, a['id']))
        os.environ['NTFY_TOPIC'] = 'abcdefgh12345'; os.environ.pop('NTFY_MIN', None)
        p, o = self.start('news')
        wj(o, 'hub/alerts.json', {'generatedAt': 'N', 'items': [{'id': 'c1', 'sev': 'critical', 'cat': 'news', 'title': 't', 'body': 'b', 'at': self.P.NOWS}, {'id': 'h1', 'sev': 'high', 'cat': 'news', 'title': 't', 'body': 'b', 'at': self.P.NOWS}]})
        os.makedirs(os.environ['PRIVATE_DIR'], exist_ok=True)
        json.dump([{'id': 'watch:stop:bist:ASELS:1', 'sev': 'high', 'title': 'ASELS stop', 'body': 'b'}], open(os.path.join(os.environ['PRIVATE_DIR'], 'watch-alerts.json'), 'w'))
        self.assertEqual(self.P.publish(o, p, 'news'), 0)
        self.assertEqual([s[1] for s in sent], ['c1', 'watch:stop:bist:ASELS:1'], 'yalnız kritik + izleme listesi uyarısı (high yalnız NTFY_MIN=high ile)')
        h = self.head(); al = rj(h, 'hub/alerts.json')['items']; self.assertTrue([a for a in al if a['id'] == 'c1'][0].get('pushed'))
        self.assertNotIn('ASELS', json.dumps(rj(h, 'hub/pushed.json')), 'izleme sembolü herkese açık dosyaya yazılmaz'); self.assertNotIn('abcdefgh12345', json.dumps(rj(h, 'hub/pushed.json')))
        p2, o2 = self.start('news2'); sent.clear(); self.assertEqual(self.P.publish(o2, p2, 'news'), 0); self.assertEqual(sent, [], 'ikinci çalışmada tekrar gönderilmez')
        os.environ.pop('NTFY_TOPIC', None)

if __name__ == '__main__': unittest.main()
