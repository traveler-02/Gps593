/* offline.js — rutas y búsqueda sin internet. Lee un archivo .g593 (ver tools/build_graph.py). */
(function (g) {
  'use strict';
  const CS = 20000, VMAX = 110 / 3.6, RAD = Math.PI / 180;        // celda de 0,02° (unidades 1e-6°); velocidad máx. del heurístico
  const TYPE_RANK = [0, 1, 2, 3, 4, 5, 6];
  let G = null;

  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dm = (a, b) => Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos((a[0] + b[0]) * RAD / 2));
  const bearing = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * RAD), b[0] - a[0]) / RAD + 360) % 360;

  async function load(file) {
    const buf = await file.arrayBuffer(), dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x33393547) throw new Error('Archivo .g593 no válido');      // "G593"
    const nN = dv.getUint32(8, true), nS = dv.getUint32(12, true), nP = dv.getUint32(16, true),
          nA = dv.getUint32(20, true), jl = dv.getUint32(24, true);
    let o = 28;
    const take = (T, n) => { const a = new T(buf, o, n); o += a.byteLength; return a; };
    const d = { nN, nS, nP };
    d.nlat = take(Int32Array, nN); d.nlon = take(Int32Array, nN);
    d.adjS = take(Uint32Array, nN + 1); d.adj = take(Uint32Array, nA);
    d.sFrom = take(Uint32Array, nS); d.sTo = take(Uint32Array, nS);
    d.sTime = take(Float32Array, nS); d.sDist = take(Float32Array, nS); d.sName = take(Uint32Array, nS);
    d.gOff = take(Uint32Array, nS + 1); d.pts = take(Int32Array, 2 * nP); d.sFlags = take(Uint8Array, nS);
    const j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o, jl)));
    d.names = j.names; d.places = j.places; d.norm = j.places.map(p => norm(p[0]));
    // cuadrícula de puntos para ubicar la calle más cercana
    let a = 1e12, b = -1e12, c = 1e12, e = -1e12;
    for (let i = 0; i < nP; i++) {
      const la = d.pts[2 * i], lo = d.pts[2 * i + 1];
      if (la < a) a = la; if (la > b) b = la; if (lo < c) c = lo; if (lo > e) e = lo;
    }
    d.minLat = a; d.minLon = c; d.W = Math.floor((e - c) / CS) + 1; d.H = Math.floor((b - a) / CS) + 1;
    const cell = i => Math.floor((d.pts[2 * i] - a) / CS) * d.W + Math.floor((d.pts[2 * i + 1] - c) / CS);
    d.cs = new Uint32Array(d.W * d.H + 1);
    for (let i = 0; i < nP; i++) d.cs[cell(i) + 1]++;
    for (let i = 0; i < d.W * d.H; i++) d.cs[i + 1] += d.cs[i];
    d.ci = new Uint32Array(nP); const fill = d.cs.slice();
    for (let i = 0; i < nP; i++) d.ci[fill[cell(i)]++] = i;
    G = d;
    return { segments: nS, places: d.places.length };
  }

  const segOf = i => { let lo = 0, hi = G.nS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (G.gOff[m] <= i) lo = m; else hi = m; } return lo; };
  const pt = i => [G.pts[2 * i] * 1e-6, G.pts[2 * i + 1] * 1e-6];
  function segGeom(s, dir) {                                          // puntos [lat,lon] de la calle, en sentido de marcha
    const out = []; for (let i = G.gOff[s]; i < G.gOff[s + 1]; i++) out.push(pt(i));
    return dir ? out.reverse() : out;
  }
  function cut(P, f0, f1) {                                           // tramo entre fracciones f0..f1 de la longitud
    const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + dm(P[i - 1], P[i]));
    const L = cum[cum.length - 1] || 1, at = t => {
      let i = 1; while (i < P.length - 1 && cum[i] < t) i++;
      const u = (t - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * u, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u];
    };
    const t0 = f0 * L, t1 = f1 * L, out = [at(t0)];
    for (let i = 1; i < P.length - 1; i++) if (cum[i] > t0 && cum[i] < t1) out.push(P[i]);
    out.push(at(t1)); return out;
  }

  function snap(lat, lon) {                                           // calle más cercana a (lat, lon) en grados
    const d = G, la = lat * 1e6, lo = lon * 1e6;
    const cy = Math.floor((la - d.minLat) / CS), cx = Math.floor((lo - d.minLon) / CS);
    let best = null, found = -1;
    for (let r = 0; r <= 12; r++) {
      if (found >= 0 && r > found + 1) break;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(y - cy), Math.abs(x - cx)) !== r || y < 0 || x < 0 || y >= d.H || x >= d.W) continue;
        const k = y * d.W + x;
        for (let q = d.cs[k]; q < d.cs[k + 1]; q++) {
          const i = d.ci[q], s = segOf(i), g0 = d.gOff[s], g1 = d.gOff[s + 1] - 1;
          for (const [u, v] of [[i - 1, i], [i, i + 1]]) {
            if (u < g0 || v > g1) continue;
            const A = pt(u), B = pt(v), c = Math.cos(lat * RAD) * 111320;
            const ax = (A[1] - lon) * c, ay = (A[0] - lat) * 111320, bx = (B[1] - lon) * c, by = (B[0] - lat) * 111320;
            const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
            const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0, dist = Math.hypot(ax + t * dx, ay + t * dy);
            if (!best || dist < best.d) best = { s, d: dist, u, t, len: Math.sqrt(L2) };
          }
        }
      }
      if (best && found < 0) found = r;
    }
    if (!best) return null;
    let before = 0, total = 0;                                        // fracción recorrida sobre la calle
    for (let i = G.gOff[best.s]; i < G.gOff[best.s + 1] - 1; i++) {
      const L = dm(pt(i), pt(i + 1));
      if (i < best.u) before += L; else if (i === best.u) before += L * best.t;
      total += L;
    }
    best.frac = total ? before / total : 0; return best;
  }

  function Heap() {
    const f = [], n = [];
    return {
      size: () => f.length, top: () => f[0],
      push(a, b) { let i = f.length; f.push(a); n.push(b); while (i) { const p = (i - 1) >> 1; if (f[p] <= a) break; f[i] = f[p]; n[i] = n[p]; i = p; } f[i] = a; n[i] = b; },
      pop() {
        const rn = n[0], lf = f.pop(), ln = n.pop();
        if (f.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= f.length) break; if (c + 1 < f.length && f[c + 1] < f[c]) c++; if (f[c] >= lf) break; f[i] = f[c]; n[i] = n[c]; i = c; } f[i] = lf; n[i] = ln; }
        return rn;
      }
    };
  }

  function astar(starts, targets, goal) {                             // A* con varias salidas y varias llegadas
    const d = G, gS = new Float64Array(d.nN).fill(Infinity), prev = new Int32Array(d.nN).fill(-1), H = Heap();
    const h = n => dm([d.nlat[n] * 1e-6, d.nlon[n] * 1e-6], goal) / VMAX;
    for (const s of starts) if (s.g < gS[s.n]) { gS[s.n] = s.g; prev[s.n] = -2; H.push(s.g + h(s.n), s.n); }
    let best = Infinity, bestN = -1;
    while (H.size()) {
      const f = H.top(); if (f >= best) break;
      const n = H.pop(), g0 = gS[n]; if (f - h(n) > g0 + 1e-6) continue;
      const tg = targets.get(n); if (tg && g0 + tg.extra < best) { best = g0 + tg.extra; bestN = n; }
      for (let k = d.adjS[n]; k < d.adjS[n + 1]; k++) {
        const e = d.adj[k]; if (!(e & 1)) continue;
        const s = e >> 2, dir = (e >> 1) & 1, m = dir ? d.sFrom[s] : d.sTo[s], ng = g0 + d.sTime[s];
        if (ng < gS[m]) { gS[m] = ng; prev[m] = s * 2 + dir; H.push(ng + h(m), m); }
      }
    }
    return bestN < 0 ? null : { bestN, prev };
  }

  const MOD = a => { const x = Math.abs(a), side = a > 0 ? 'right' : 'left';
    return x > 165 ? 'uturn' : x < 20 ? 'straight' : x < 60 ? 'slight ' + side : x < 120 ? side : 'sharp ' + side; };
  function turnAngle(P, Q) {                                          // giro entre el final de P y el inicio de Q (+ = derecha)
    const e = P[P.length - 1]; let a = P[0]; for (let i = P.length - 2; i >= 0; i--) if (dm(P[i], e) >= 12) { a = P[i]; break; }
    const s = Q[0]; let b = Q[Q.length - 1]; for (let i = 1; i < Q.length; i++) if (dm(s, Q[i]) >= 12) { b = Q[i]; break; }
    return ((bearing(s, b) - bearing(a, e) + 540) % 360) - 180;
  }

  function route(from, to) {                                          // from, to = [lat, lng]; devuelve ruta con forma OSRM
    if (!G) throw new Error('Datos sin conexión no cargados.');
    const d = G, A = snap(from[0], from[1]), B = snap(to[0], to[1]);
    if (!A || !B) throw new Error('Ese punto está fuera de la zona de los datos sin conexión.');
    const F = s => d.sFlags[s], T = s => d.sTime[s];
    const piece = (s, dir, f0, f1, node) => {
      const P = cut(segGeom(s, dir), f0, f1), k = f1 - f0;
      return { pts: P, name: d.names[d.sName[s]], len: d.sDist[s] * k, time: T(s) * k, n: node };
    };
    let pieces = null;
    if (A.s === B.s && ((F(A.s) & 1 && B.frac >= A.frac) || (F(A.s) & 2 && B.frac <= A.frac))) {
      const fw = F(A.s) & 1 && B.frac >= A.frac;                      // mismo tramo: ir directo
      pieces = [fw ? piece(A.s, 0, A.frac, B.frac, -1) : piece(A.s, 1, 1 - A.frac, 1 - B.frac, -1)];
    } else {
      const starts = [], startEnt = new Map(), targets = new Map();
      if (F(A.s) & 1) { starts.push({ n: d.sTo[A.s], g: T(A.s) * (1 - A.frac) }); startEnt.set(d.sTo[A.s], [A.s, 0, A.frac, 1]); }
      if (F(A.s) & 2) { starts.push({ n: d.sFrom[A.s], g: T(A.s) * A.frac }); startEnt.set(d.sFrom[A.s], [A.s, 1, 1 - A.frac, 1]); }
      if (F(B.s) & 1) targets.set(d.sFrom[B.s], { extra: T(B.s) * B.frac, e: [B.s, 0, 0, B.frac] });
      if (F(B.s) & 2) { const x = { extra: T(B.s) * (1 - B.frac), e: [B.s, 1, 0, 1 - B.frac] }, old = targets.get(d.sTo[B.s]); if (!old || x.extra < old.extra) targets.set(d.sTo[B.s], x); }
      const r = astar(starts, targets, to);
      if (!r) throw new Error('No hay ruta disponible entre esos puntos.');
      const mid = []; let n = r.bestN;
      for (;;) { const p = r.prev[n]; if (p === -2) break; mid.push([p >> 1, p & 1, n]); n = (p & 1) ? d.sTo[p >> 1] : d.sFrom[p >> 1]; }
      const s0 = startEnt.get(n), t1 = targets.get(r.bestN).e;
      pieces = [piece(s0[0], s0[1], s0[2], s0[3], -1)];
      mid.reverse().forEach(([s, dir]) => pieces.push(piece(s, dir, 0, 1, dir ? d.sTo[s] : d.sFrom[s])));
      pieces.push(piece(t1[0], t1[1], t1[2], t1[3], t1[1] ? d.sTo[t1[0]] : d.sFrom[t1[0]]));
    }
    // pasos de navegación
    const steps = []; let cur = { distance: 0, name: pieces[0].name, maneuver: { type: 'depart', location: pieces[0].pts[0] } };
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (i) {
        const q = pieces[i - 1], deg = d.adjS[p.n + 1] - d.adjS[p.n], ang = turnAngle(q.pts, p.pts);
        const turn = deg >= 3 && Math.abs(ang) >= 25, rename = p.name && p.name !== q.name;
        if (turn || rename) {
          steps.push(cur);
          cur = { distance: 0, name: p.name, maneuver: { type: turn ? 'turn' : 'new name', modifier: turn ? MOD(ang) : 'straight', location: p.pts[0] } };
        }
      }
      cur.distance += p.len;
    }
    steps.push(cur);
    const coords = [], last = pieces[pieces.length - 1].pts;
    pieces.forEach(p => p.pts.forEach(c => { const l = coords[coords.length - 1]; if (!l || l[0] !== c[1] || l[1] !== c[0]) coords.push([c[1], c[0]]); }));
    steps.forEach(s => { s.maneuver.location = [s.maneuver.location[1], s.maneuver.location[0]]; });
    steps.push({ distance: 0, name: '', maneuver: { type: 'arrive', location: [last[last.length - 1][1], last[last.length - 1][0]] } });
    return {
      distance: pieces.reduce((a, p) => a + p.len, 0), duration: pieces.reduce((a, p) => a + p.time, 0),
      geometry: { coordinates: coords }, legs: [{ steps }]
    };
  }

  function search(q) {                                                // lugares, poblaciones y calles (sin tildes ni mayúsculas)
    if (!G) return [];
    const toks = norm(q).split(/\s+/).filter(Boolean); if (!toks.length) return [];
    const nq = toks.join(' '), hits = [];
    for (let i = 0; i < G.norm.length; i++) {
      const s = G.norm[i]; if (!toks.every(t => s.includes(t))) continue;
      hits.push([(s.startsWith(nq) ? 0 : 10) + TYPE_RANK[G.places[i][3]], i]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    return hits.slice(0, 8).map(([, i]) => {
      const p = G.places[i], c = p[4] >= 0 ? G.places[p[4]] : null;
      return { name: p[0] + (c && c[0] !== p[0] ? ', ' + c[0] : ''), lat: p[1], lng: p[2] };
    });
  }

  g.Offline = { load, ready: () => !!G, route, search };
})(typeof window !== 'undefined' ? window : globalThis);
