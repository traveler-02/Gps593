#!/usr/bin/env python3
"""GPS 593 — convierte un .osm.pbf en un archivo .g593 (grafo vial comprimido + lugares para buscar sin internet).
Uso: python build_graph.py ecuador-latest.osm.pbf ecuador.g593"""
import sys, re, json, math
from collections import defaultdict
import numpy as np, osmium

SPEED = {'motorway': 90, 'motorway_link': 60, 'trunk': 80, 'trunk_link': 50, 'primary': 70, 'primary_link': 45,
         'secondary': 60, 'secondary_link': 40, 'tertiary': 50, 'tertiary_link': 35, 'unclassified': 40,
         'residential': 30, 'living_street': 15, 'service': 20}
PENALTY = {'service': 2.0, 'living_street': 1.5}          # desincentiva atajos por vías menores
PLACE = {'city': 0, 'town': 1, 'village': 2, 'suburb': 3, 'neighbourhood': 3, 'hamlet': 4}
AMENITY = {'fuel': 'gasolinera', 'hospital': 'hospital', 'clinic': 'clínica', 'pharmacy': 'farmacia', 'police': 'policía'}

NO_SERVICE = '--sin-servicio' in sys.argv                    # grafo más liviano: sin calles de servicio

def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 12742000 * math.asin(math.sqrt(h))

def maxspeed(t, default):
    m = re.match(r'\s*(\d+)\s*(mph)?', t.get('maxspeed', ''))
    if not m: return default
    v = int(m.group(1)) * (1.609 if m.group(2) else 1)
    return max(5, min(110, v))

class Reader(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.ways = []; s.use = defaultdict(int); s.places = []; s.streets = {}
    def node(s, n):
        nm = n.tags.get('name')
        if not nm or not n.location.valid(): return
        p = n.tags.get('place'); a = n.tags.get('amenity')
        if p in PLACE: s.places.append([nm, n.location.lat, n.location.lon, PLACE[p]])
        elif a in AMENITY: s.places.append([f'{nm} ({AMENITY[a]})', n.location.lat, n.location.lon, 5])
    def way(s, w):
        t = w.tags; hw = t.get('highway')
        if hw not in SPEED or (hw == 'service' and NO_SERVICE): return
        if t.get('access') in ('no', 'private') and t.get('motor_vehicle') not in ('yes', 'designated'): return
        if t.get('motor_vehicle') in ('no', 'private') or t.get('motorcar') in ('no', 'private'): return
        if hw == 'service' and t.get('service') in ('parking_aisle', 'driveway'): return
        try: pts = [(n.ref, n.lat, n.lon) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if len(pts) < 2: return
        ow = t.get('oneway')
        if ow is None and (t.get('junction') == 'roundabout' or hw in ('motorway', 'motorway_link')): ow = 'yes'
        flags = 1 if ow in ('yes', 'true', '1') else 2 if ow in ('-1', 'reverse') else 3
        name = t.get('name') or t.get('ref') or ''
        for r, _, _ in pts: s.use[r] += 1
        s.ways.append((pts, flags, maxspeed(t, SPEED[hw]), PENALTY.get(hw, 1.0), name))
        if t.get('name') and hw != 'service':
            mid = pts[len(pts) // 2]
            s.streets.setdefault((name, round(mid[1], 2), round(mid[2], 2)), [name, mid[1], mid[2], 6])

def main(src, dst):
    h = Reader(); h.apply_file(src, locations=True, idx='flex_mem')
    node_id, nlat, nlon = {}, [], []
    names, name_idx = [''], {'': 0}
    sf, st, sfl, stime, sdist, snm, goff, pts = [], [], [], [], [], [], [0], []
    def nid(r, lat, lon):
        i = node_id.get(r)
        if i is None: i = node_id[r] = len(nlat); nlat.append(round(lat * 1e6)); nlon.append(round(lon * 1e6))
        return i
    for wp, flags, sp, pen, name in h.ways:
        start = 0
        for i in range(1, len(wp)):
            if i != len(wp) - 1 and h.use[wp[i][0]] < 2: continue
            ch = wp[start:i + 1]; start = i
            dist = sum(hav(ch[k][1:], ch[k + 1][1:]) for k in range(len(ch) - 1))
            a, b = nid(ch[0][0], ch[0][1], ch[0][2]), nid(ch[-1][0], ch[-1][1], ch[-1][2])
            if a == b and dist < 5: continue
            if name not in name_idx: name_idx[name] = len(names); names.append(name)
            sf.append(a); st.append(b); sfl.append(flags); sdist.append(dist)
            stime.append(dist / (sp / 3.6) * pen); snm.append(name_idx[name])
            pts.extend((round(p[1] * 1e6), round(p[2] * 1e6)) for p in ch); goff.append(len(pts))
    nN, nS = len(nlat), len(sf)
    sf_a, st_a, fl = np.array(sf, np.uint32), np.array(st, np.uint32), np.array(sfl, np.uint8)
    seg = np.arange(nS, dtype=np.uint32)          # entrada de adyacencia = seg*4 + dir*2 + transitable
    nodes = np.concatenate([sf_a, st_a])
    vals = np.concatenate([seg * 4 + 0 + (fl & 1), seg * 4 + 2 + ((fl >> 1) & 1)]).astype(np.uint32)
    order = np.argsort(nodes, kind='stable'); adj = vals[order]
    adjs = np.concatenate([[0], np.cumsum(np.bincount(nodes, minlength=nN))]).astype(np.uint32)

    # Lugares: contexto = población (ciudad/pueblo/parroquia) más cercana, para distinguir calles homónimas
    places = h.places; grid = defaultdict(list)
    for i, p in enumerate(places):
        if p[3] <= 2: grid[(int(p[1] * 10), int(p[2] * 10))].append(i)
    def ctx(p):
        cx, cy = int(p[1] * 10), int(p[2] * 10); best, bd = -1, 1e18
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in grid.get((cx + dx, cy + dy), ()):
                    d = hav(p[1:3], places[i][1:3])
                    if d < bd: best, bd = i, d
        return best
    allp = [[p[0], round(p[1], 5), round(p[2], 5), p[3], ctx(p) if p[3] >= 5 else -1] for p in places]
    base = len(places)
    for p in h.streets.values():
        allp.append([p[0], round(p[1], 5), round(p[2], 5), 6, ctx(p)])
    blob = json.dumps({'names': names, 'places': allp}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

    with open(dst, 'wb') as f:
        f.write(b'G593'); f.write(np.array([1, nN, nS, len(pts), len(adj), len(blob)], '<u4').tobytes())
        for arr in (np.array(nlat, '<i4'), np.array(nlon, '<i4'), adjs.astype('<u4'), adj.astype('<u4'),
                    sf_a.astype('<u4'), st_a.astype('<u4'), np.array(stime, '<f4'), np.array(sdist, '<f4'),
                    np.array(snm, '<u4'), np.array(goff, '<u4'), np.array(pts, '<i4').reshape(-1), fl):
            f.write(arr.tobytes())
        f.write(blob)
    print(f'nodos={nN} segmentos={nS} puntos={len(pts)} lugares={len(allp)} -> {dst}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
