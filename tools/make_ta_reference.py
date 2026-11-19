#!/usr/bin/env python3
"""TA referans değerlerini üretir: TA-Lib 0.8.3 (C kütüphanesi) + bağımsız Python uygulamaları (Ichimoku, Supertrend, VWAP).
Kullanım: python make_ta_reference.py <ASELS.json> <btc_klines.json> <çıktı.json>   (gereken: pip install TA-Lib numpy pandas pandas_ta)"""
import json, sys, math
import numpy as np, talib, pandas as pd
def L(a): return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else round(float(x), 10) for x in a]
def series_from(asels, btc):
    a = json.load(open(asels))['bars'][-400:]
    b = json.load(open(btc))
    return {
        'ASELS': {'d': [x[0] for x in a], 'o': [x[1] for x in a], 'h': [x[2] for x in a], 'l': [x[3] for x in a], 'c': [x[4] for x in a], 'v': [float(x[5]) for x in a]},
        'BTCUSDT': {'d': [str(k[0]) for k in b], 'o': [float(k[1]) for k in b], 'h': [float(k[2]) for k in b], 'l': [float(k[3]) for k in b], 'c': [float(k[4]) for k in b], 'v': [float(k[5]) for k in b]},
    }
def supertrend_ref(h, l, c, n=10, m=3.0):  # bağımsız uygulama (TradingView pine 'ta.supertrend' mantığı), ATR = talib.ATR
    a = talib.ATR(h, l, c, timeperiod=n); N = len(c); st = [None]*N; d = [None]*N; fu = [None]*N; fl = [None]*N
    for i in range(N):
        if math.isnan(a[i]): continue
        hl2 = (h[i]+l[i])/2; bu = hl2 + m*a[i]; bl = hl2 - m*a[i]
        pu = fu[i-1] if i > 0 else None; pl = fl[i-1] if i > 0 else None; pc = c[i-1] if i > 0 else None
        fu[i] = pu if (pu is not None and not (bu < pu or pc > pu)) else bu
        fl[i] = pl if (pl is not None and not (bl > pl or pc < pl)) else bl
        pd_ = d[i-1] if i > 0 else None
        if pd_ is None: d[i] = 1
        elif pd_ == -1: d[i] = 1 if c[i] > pu else -1
        else: d[i] = -1 if c[i] < pl else 1
        st[i] = fl[i] if d[i] == 1 else fu[i]
    return st, d
def main():
    S = series_from(sys.argv[1], sys.argv[2]); out = {'generator': 'TA-Lib %s + pandas_ta (Ichimoku) + bağımsız Python (Supertrend, VWAP)' % talib.__version__, 'series': {}}
    import pandas_ta as pta
    for name, s in S.items():
        h, l, c, v = (np.array(s[k], dtype=float) for k in 'hlcv')
        m, sg, hs = talib.MACD(c, 12, 26, 9)
        bu, bm, bl = talib.BBANDS(c, 20, 2, 2, 0)
        sk, sd = talib.STOCH(h, l, c, 14, 3, 0, 3, 0)
        fk, fd = talib.STOCHRSI(c, 14, 14, 3, 0)
        ich = pta.ichimoku(pd.Series(h), pd.Series(l), pd.Series(c), tenkan=9, kijun=26, senkou=52, include_chikou=True)[0]
        st, sdir = supertrend_ref(h, l, c)
        tp = (h + l + c) / 3; vw = []
        pv = vv = 0.0
        for i in range(len(c)):
            pv += tp[i]*v[i]; vv += v[i]; vw.append(pv/vv if vv else None)
        ref = {'SMA20': L(talib.SMA(c, 20)), 'EMA20': L(talib.EMA(c, 20)), 'EMA50': L(talib.EMA(c, 50)), 'WMA10': L(talib.WMA(c, 10)), 'RSI14': L(talib.RSI(c, 14)),
               'MACD': L(m), 'MACDsignal': L(sg), 'MACDhist': L(hs), 'ATR14': L(talib.ATR(h, l, c, 14)), 'TRANGE': L(talib.TRANGE(h, l, c)),
               'BBupper': L(bu), 'BBmid': L(bm), 'BBlower': L(bl), 'ADX14': L(talib.ADX(h, l, c, 14)), 'PLUS_DI14': L(talib.PLUS_DI(h, l, c, 14)), 'MINUS_DI14': L(talib.MINUS_DI(h, l, c, 14)),
               'STOCHk': L(sk), 'STOCHd': L(sd), 'STOCHRSIfastk': L(fk), 'STOCHRSIfastd': L(fd), 'OBV': L(talib.OBV(c, v)), 'CCI20': L(talib.CCI(h, l, c, 20)), 'WILLR14': L(talib.WILLR(h, l, c, 14)),
               'MFI14': L(talib.MFI(h, l, c, v, 14)), 'ROC10': L(talib.ROC(c, 10)), 'STDDEV20': L(talib.STDDEV(c, 20, 1)),
               'ICH_tenkan': L(ich['ITS_9']), 'ICH_kijun': L(ich['IKS_26']), 'ICH_spanA': L(ich['ISA_9']), 'ICH_spanB': L(ich['ISB_26']),
               'ST10_3': L(st), 'ST10_3dir': sdir, 'VWAPanch0': L(vw)}
        out['series'][name] = {'input': s, 'ref': ref}
    json.dump(out, open(sys.argv[3], 'w'), separators=(',', ':'))
    print('yazıldı', sys.argv[3])
if __name__ == '__main__': main()
