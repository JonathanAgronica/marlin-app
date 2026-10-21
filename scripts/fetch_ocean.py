#!/usr/bin/env python3
"""Fetch + precompute ocean layers for Mac's Marlin.
Sources (all free, public, no login):
  SST  : NASA JPL MUR SST v4.1 (GHRSST L4) via NOAA CoastWatch ERDDAP  (jplMURSST41)
  Chl  : NOAA-20 VIIRS chlorophyll-a weekly NRT via NOAA CoastWatch ERDDAP (nesdisVHNnoaa20chlaWeekly_Lon0360)
  Curr : IMOS OceanCurrent GSLA NRT (geostrophic UCUR/VCUR + sea level anomaly) via AODN THREDDS OPeNDAP
  Depth: NOAA NCEI ETOPO1 via NOAA CoastWatch ERDDAP (etopo180)  (bathy.json, cached)
Writes data/tiles/<id>.json (grid + fronts per region), <id>_bathy.json, <id>_depth.json, and the small index data/ocean.json.
Every source is optional: a failed fetch keeps that layer null and the app says so."""
import csv, io, json, math, os, re, sys, time, urllib.request, datetime as dt
import numpy as np
from scipy import ndimage

# Region tiles (lazy-loaded by the app). (id, name, lat0, lat1, lon0, lon1); 0.05 deg grid (MUR stride 5).
TILES = [
    ('ncq', 'Cape York to Cairns', -17.50, -12.30, 143.00, 147.50),
    ('ccq', 'Townsville to Whitsundays', -21.50, -17.50, 145.50, 152.00),
    ('caq', 'Mackay to Bundaberg', -25.50, -21.50, 148.50, 154.50),
    ('seq', 'Fraser to Gold Coast', -29.50, -25.50, 152.50, 155.50),
    ('nnsw', 'Tweed to Port Stephens', -33.50, -29.50, 151.00, 155.00),
    ('snsw', 'Sydney to Eden', -37.50, -33.50, 149.50, 153.50),
    ('bass', 'East Gippsland to Port Phillip', -39.50, -37.50, 143.80, 151.00),
]
STEP = 0.05
LAT0 = LAT1 = LON0 = LON1 = None; LATS = LONS = None; NY = NX = 0
def set_tile(t):
    global LAT0, LAT1, LON0, LON1, LATS, LONS, NY, NX
    _, _, LAT0, LAT1, LON0, LON1 = t
    LATS = np.round(np.arange(LAT0, LAT1 + 1e-9, STEP), 2); LONS = np.round(np.arange(LON0, LON1 + 1e-9, STEP), 2)
    NY, NX = len(LATS), len(LONS)
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
TD = os.path.join(OUT, 'tiles')
ERD = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/'
UA = {'User-Agent': 'macs-marlin/1.0 (github.com/JonathanAgronica/marlin-app)'}

HTTP_TIMEOUT = int(os.environ.get('MARLIN_HTTP_TIMEOUT', '120')); HTTP_TRIES = int(os.environ.get('MARLIN_HTTP_TRIES', '3'))

def get(url, tries=None, timeout=None):
    tries = tries or HTTP_TRIES; timeout = timeout or HTTP_TIMEOUT
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode('utf8', 'ignore')
        except Exception as e:
            if getattr(e, 'code', None) in (400, 404): raise RuntimeError(f'HTTP {e.code} ' + url[:120])  # dataset/region not served: no point retrying
            print('  retry', i + 1, url[:110], e, file=sys.stderr); time.sleep(5 * (i + 1))
    raise RuntimeError('fetch failed ' + url[:120])

def erddap_csv(url):
    rows = list(csv.reader(io.StringIO(get(url))))[2:]
    return rows

def bin_to_grid(pts):
    """pts: iterable of (lat, lon, value) -> mean per 0.04 cell (NaN if empty)."""
    s = np.zeros((NY, NX)); n = np.zeros((NY, NX))
    for la, lo, v in pts:
        if v is None or not math.isfinite(v): continue
        j = int(round((la - LAT0) / STEP)); i = int(round((lo - LON0) / STEP))
        if 0 <= j < NY and 0 <= i < NX: s[j, i] += v; n[j, i] += 1
    with np.errstate(invalid='ignore'): return np.where(n > 0, s / np.maximum(n, 1), np.nan)

def fnum(x):
    try: return float(x)
    except: return float('nan')

def fetch_sst():
    q = f'analysed_sst[(last)][({LAT0}):5:({LAT1})][({LON0}):5:({LON1})]'
    url = ERD + 'jplMURSST41.csv?' + urllib.parse.quote(q, safe='():[]')
    rows = erddap_csv(url)
    t = rows[0][0]
    return bin_to_grid((fnum(r[1]), fnum(r[2]), fnum(r[3])) for r in rows), t, url

CHL_CANDIDATES = [  # (datasetID, variable, has altitude dim, label) tried in order
    ('nesdisVHNnoaa20chlaWeekly_Lon0360', 'chlor_a', True, 'NOAA-20 VIIRS chlorophyll-a, weekly NRT'),
    ('erdMH1chla8day_R2022NRT', 'chlorophyll', False, 'NASA MODIS-Aqua chlorophyll-a, 8-day NRT'),
    ('nesdisVHNnoaaSNPPnoaa20chlaGapfilledDaily_Lon0360', 'chlor_a', True, 'NOAA VIIRS DINEOF gap-filled chlorophyll-a, daily'),
]

def fetch_chl():
    errs = []
    for ds, var, alt, label in CHL_CANDIDATES:
        for la in [(LAT1, LAT0), (LAT0, LAT1)]:
            q = f'{var}[(last)]' + ('[(0.0)]' if alt else '') + f'[({la[0]}):1:({la[1]})][({LON0}):1:({LON1})]'
            try:
                rows = erddap_csv(ERD + ds + '.csv?' + urllib.parse.quote(q, safe='():[]'))
            except Exception as e:
                errs.append(ds + ': ' + str(e)[:60]); continue
            k = 2 if alt else 1
            g = bin_to_grid((fnum(r[k]), fnum(r[k + 1]), fnum(r[k + 2])) for r in rows)
            if np.isfinite(g).sum() < 50: errs.append(ds + ': mostly cloud'); break
            return g, rows[0][0], ERD + ds + ' (' + label + ')'
    raise RuntimeError('; '.join(errs))

def opendap_arrays(txt):
    """parse THREDDS .ascii output into {name: ndarray} (handles 1-D maps and [0][j] rows)."""
    out = {}; cur = None; buf = []
    for line in txt.splitlines():
        m = re.match(r'^([A-Za-z_][\w.]*)\[(\d+)\](?:\[(\d+)\])?(?:\[(\d+)\])?\s*$', line.strip())
        if m:
            if cur: out[cur] = buf
            cur = m.group(1).split('.')[-1]; buf = []; continue
        if cur is None: continue
        m2 = re.match(r'^(\[\d+\])+\s*,\s*(.*)$', line.strip())
        if m2: buf.append([fnum(x) for x in m2.group(2).split(',')])
        elif line.strip() and re.match(r'^[-\d.eE+, NaN]+$', line.strip()):
            buf.append([fnum(x) for x in line.split(',')])
    if cur: out[cur] = buf
    res = {}
    for k, v in out.items():
        if not v: continue
        a = np.array(v, dtype=float)
        res.setdefault(k, a.ravel() if a.shape[0] == 1 else a)
    return res

_CUR = {}
def fetch_currents():
    if 'raw' not in _CUR:
        try: _CUR['raw'] = _fetch_cur_raw()
        except Exception as e: _CUR['raw'] = e
    if isinstance(_CUR['raw'], Exception): raise _CUR['raw']
    la, lo, jj, ii, raw, das, t, src = _CUR['raw']
    def attr(var, a):
        m = re.search(var + r' \{.*?' + a + r' ([-\d.eE+]+);', das, re.S); return float(m.group(1)) if m else None
    out = {}
    for v in ('UCUR', 'VCUR', 'GSLA'):
        a = np.array(raw[v], dtype=float).reshape(len(jj), len(ii))
        fv, sf, ao = attr(v, '_FillValue'), attr(v, 'scale_factor') or 1.0, attr(v, 'add_offset') or 0.0
        if fv is not None: a[a == fv] = np.nan
        a = a * sf + ao
        sla, slo = la[jj], lo[ii]
        fj = np.interp(LATS, sla, np.arange(len(sla))) if sla[0] < sla[-1] else np.interp(LATS, sla[::-1], np.arange(len(sla))[::-1])
        fi = np.interp(LONS, slo, np.arange(len(slo)))
        J, I = np.meshgrid(fj, fi, indexing='ij')
        out[v] = ndimage.map_coordinates(a, [J, I], order=1, cval=np.nan, mode='nearest')
    return out, t, src

def _fetch_cur_raw():
    base = 'https://thredds.aodn.org.au/thredds/'
    yr = dt.datetime.now(dt.timezone.utc).year
    paths = []
    for y in (yr, yr - 1):
        try: paths += re.findall(r'urlPath="([^"]+GSLA[^"]+\.nc)"', get(f'{base}catalog/IMOS/OceanCurrent/GSLA/NRT/{y}/catalog.xml'))
        except Exception: pass
        if paths: break
    p = sorted(paths)[-1]
    das = get(base + 'dodsC/' + p + '.das')
    def attr(var, a):
        m = re.search(var + r' \{.*?' + a + r' ([-\d.eE+]+);', das, re.S); return float(m.group(1)) if m else None
    co = opendap_arrays(get(base + 'dodsC/' + p + '.ascii?LATITUDE,LONGITUDE'))
    la, lo = co['LATITUDE'], co['LONGITUDE']
    A0, A1 = min(t[2] for t in TILES), max(t[3] for t in TILES); O0, O1 = min(t[4] for t in TILES), max(t[5] for t in TILES)
    jj = np.where((la >= A0 - 0.4) & (la <= A1 + 0.4))[0]; ii = np.where((lo >= O0 - 0.4) & (lo <= O1 + 0.4))[0]
    sl = f'[0][{jj[0]}:1:{jj[-1]}][{ii[0]}:1:{ii[-1]}]'
    raw = opendap_arrays(get(base + 'dodsC/' + p + '.ascii?' + ','.join(v + sl for v in ('UCUR', 'VCUR', 'GSLA'))))
    t = re.search(r'_(\d{8})T', p).group(1)
    return la, lo, jj, ii, raw, das, f'{t[:4]}-{t[4:6]}-{t[6:]}', base + 'dodsC/' + p

def fetch_bathy():
    q = f'altitude[({LAT0}):1:({LAT1})][({LON0}):1:({LON1})]'
    rows = erddap_csv(ERD + 'etopo180.csv?' + urllib.parse.quote(q, safe='():[]'))
    la = sorted({fnum(r[0]) for r in rows}); lo = sorted({fnum(r[1]) for r in rows})
    Z = np.full((len(la), len(lo)), np.nan); ia = {v: k for k, v in enumerate(la)}; io_ = {v: k for k, v in enumerate(lo)}
    for r in rows: Z[ia[fnum(r[0])], io_[fnum(r[1])]] = fnum(r[2])
    return np.array(la), np.array(lo), Z

def contours(la, lo, Z, levels):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    cs = plt.contour(lo, la, -Z, levels=levels)
    feats = []
    for lev, segs in zip(cs.levels, cs.allsegs):
        lines = [[[round(float(x), 3), round(float(y), 3)] for x, y in list(s[::2]) + [s[-1]]] for s in segs if len(s) > 6]
        if lines: feats.append({'depth': int(lev), 'lines': lines})
    plt.close('all'); return feats

def km_per_cell():
    return STEP * 111.0 * math.cos(math.radians((LAT0 + LAT1) / 2)), STEP * 111.0

def grad(a):
    """magnitude of spatial gradient per km, NaN-safe (fills gaps by nearest for the stencil only)."""
    dxk, dyk = km_per_cell()
    m = np.isnan(a)
    if m.all(): return np.full_like(a, np.nan)
    idx = ndimage.distance_transform_edt(m, return_distances=False, return_indices=True)
    f = a[tuple(idx)]
    gx = ndimage.sobel(f, axis=1) / (8 * dxk); gy = ndimage.sobel(f, axis=0) / (8 * dyk)
    g = np.hypot(gx, gy); g[m] = np.nan; return g

def dist_km(mask, valid):
    if not mask.any(): return np.where(valid, 99.0, np.nan)
    dxk, dyk = km_per_cell()
    d = ndimage.distance_transform_edt(~mask, sampling=(dyk, dxk)); return np.where(valid, d, np.nan)

def r(a, nd=2):
    return [[None if not np.isfinite(v) else round(float(v), nd) for v in row] for row in a]

def do_tile(T):
    set_tile(T); tid = T[0]
    meta = {'tile': tid, 'name': T[1], 'bounds': [LAT0, LAT1, LON0, LON1], 'built': dt.datetime.now(dt.timezone.utc).isoformat(timespec='minutes'), 'grid': {'lat0': LAT0, 'lon0': LON0, 'step': STEP, 'ny': NY, 'nx': NX}, 'sources': {}, 'errors': {}}
    prev = {}
    pf = os.path.join(TD, tid + '.json')
    if os.path.exists(pf):
        try: prev = json.load(open(pf))
        except Exception: prev = {}
    layers = {}
    # bathymetry (static, cached)
    bf = os.path.join(TD, tid + '_bathy.json'); dg = os.path.join(TD, tid + '_depth.json')
    if not os.path.exists(bf) or not os.path.exists(dg):
        la, lo, Z = fetch_bathy()
        json.dump({'source': 'NOAA NCEI ETOPO1 (1 arc-minute) via NOAA CoastWatch ERDDAP etopo180', 'contours': contours(la, lo, Z, [50, 100, 200, 500, 1000, 2000, 3000])}, open(bf, 'w'), separators=(',', ':'))
        J, I = np.meshgrid(np.interp(LATS, la, np.arange(len(la))), np.interp(LONS, lo, np.arange(len(lo))), indexing='ij')
        D = -ndimage.map_coordinates(Z, [J, I], order=1)
        json.dump(r(np.where(D > 0, D, -1), 0), open(dg, 'w'), separators=(',', ':'))
    depth = np.array(json.load(open(dg)), dtype=float)
    layers['depth'] = depth
    meta['sources']['depth'] = {'name': 'NOAA NCEI ETOPO1 via CoastWatch ERDDAP (etopo180)', 'url': ERD + 'etopo180.html'}
    land = depth <= 0
    for key, fn in (('sst', fetch_sst), ('chl', fetch_chl), ('cur', fetch_currents)):
        try:
            a, t, url = fn()
            if key == 'cur':
                for k, v in a.items(): layers[k.lower()] = np.where(land, np.nan, v)
            else: layers[key] = np.where(land, np.nan, a)
            meta['sources'][key] = {'time': t, 'url': url.split('?')[0]}
            print('ok', key, t)
        except Exception as e:
            meta['errors'][key] = str(e)[:200]; print('FAIL', key, e, file=sys.stderr)
            # keep the last good layer (marked stale) so the app still has something
            for k in (['ucur', 'vcur', 'gsla'] if key == 'cur' else [key]):
                if prev.get(k): layers[k] = np.array([[np.nan if v is None else v for v in row] for row in prev[k]], dtype=float)
            if prev.get('meta', {}).get('sources', {}).get(key):
                meta['sources'][key] = dict(prev['meta']['sources'][key], stale=True)
    valid = ~land
    out = {'meta': meta}
    if 'sst' in layers:
        g = grad(layers['sst'])  # degC per km
        layers['sstgrad'] = g
        thr = 0.03  # °C/km ~ 0.3°C over 10 km: a usable temperature break for MUR (smooth L4)
        meta['frontThreshold'] = thr
        layers['dfront'] = dist_km(np.nan_to_num(g) >= thr, valid)
        # front lines = isotherm segments (0.5°C) where gradient is strong
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        s = layers['sst']; lv = np.arange(math.floor(np.nanmin(s) * 2) / 2, np.nanmax(s) + 0.5, 0.5)
        cs = plt.contour(LONS, LATS, np.nan_to_num(s, nan=np.nanmean(s)), levels=lv)
        fronts = []
        for lev, segs in zip(cs.levels, cs.allsegs):
            for sg in segs:
                cur = []
                for x, y in sg:
                    j = int(round((y - LAT0) / STEP)); i = int(round((x - LON0) / STEP))
                    ok = 0 <= j < NY and 0 <= i < NX and np.nan_to_num(g[j, i]) >= thr and valid[j, i]
                    if ok: cur.append([round(float(x), 3), round(float(y), 3)])
                    elif len(cur) > 2: fronts.append({'t': float(lev), 'l': cur}); cur = []
                    else: cur = []
                if len(cur) > 2: fronts.append({'t': float(lev), 'l': cur})
        plt.close('all'); out['fronts'] = fronts
    if 'chl' in layers:
        lc = np.log10(np.clip(layers['chl'], 0.01, 50))
        layers['chlgrad'] = grad(lc)  # log10 units per km
    if 'ucur' in layers:
        u, v = layers['ucur'], layers['vcur']; sp = np.hypot(u, v); layers['speed'] = sp
        layers['curedge'] = grad(sp)  # m/s per km (shear/edges of the EAC and eddies)
        if 'gsla' in layers: layers['slagrad'] = grad(layers['gsla'])  # m per km (eddy rims)
    nd = {'sst': 2, 'chl': 3, 'depth': 0, 'ucur': 2, 'vcur': 2, 'gsla': 2, 'sstgrad': 3, 'dfront': 1, 'chlgrad': 3, 'speed': 2, 'curedge': 4, 'slagrad': 4}
    for k, a in layers.items(): out[k] = r(a, nd.get(k, 3))
    json.dump(out, open(pf + '.tmp', 'w'), separators=(',', ':')); os.replace(pf + '.tmp', pf)  # atomic: a killed run never leaves a half file
    print('wrote', pf, os.path.getsize(pf) // 1024, 'KB', 'errors:', meta['errors'], flush=True)
    return meta

def main():
    os.makedirs(TD, exist_ok=True)
    t0 = time.time()
    try: _CUR['raw'] = _fetch_cur_raw()          # one THREDDS request for the whole coast, shared by the tile workers
    except Exception as e: _CUR['raw'] = e; print('FAIL cur', e, file=sys.stderr)
    print('currents', f'{time.time()-t0:.0f}s', flush=True)
    import multiprocessing as mp
    with mp.get_context('fork').Pool(int(os.environ.get('MARLIN_WORKERS', '4'))) as pool: metas = pool.map(do_tile, TILES, chunksize=1)
    print('tiles done', f'{time.time()-t0:.0f}s')
    src, err = {}, {}
    for m in metas:
        for k, v in m['sources'].items():
            if k not in src or (v.get('time') or '') < (src[k].get('time') or ''): src[k] = dict(v)
            if v.get('stale'): src[k]['stale'] = True
        for k, v in m['errors'].items(): err[k] = m['tile'] + ': ' + v
    idx = {'meta': {'built': dt.datetime.now(dt.timezone.utc).isoformat(timespec='minutes'), 'sources': src, 'errors': err, 'step': STEP},
           'tiles': [{'id': m['tile'], 'name': m['name'], 'bounds': m['bounds'], 'grid': m['grid'], 'sources': m['sources'], 'errors': m['errors']} for m in metas]}
    pf = os.path.join(OUT, 'ocean.json'); json.dump(idx, open(pf + '.tmp', 'w'), separators=(',', ':')); os.replace(pf + '.tmp', pf)
    print('index ok', f'{time.time()-t0:.0f}s', 'errors:', err)

if __name__ == '__main__':
    import urllib.parse
    main()
