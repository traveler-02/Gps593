/* routing.js — geocodificación (Nominatim), ruteo (OSRM) y geometría. Sin dependencias.
   Módulo en patrón IIFE para que funcione al abrir el HTML sin servidor de módulos. */
(function (g) {
  'use strict';

  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const R = 6371000;
  const rad = d => d * Math.PI / 180;

  /* ---------- Geometría ---------- */
  function haversine(a, b) {                       // a, b = [lat, lng] → metros
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearing(a, b) {                         // rumbo 0–360°
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
              Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /* Punto más cercano de la polilínea a p. Devuelve distancia a la ruta (m),
     segmento y metros recorridos a lo largo de la ruta. */
  function locate(route, p) {
    const { coords, cum } = route, cosL = Math.cos(rad(p[0]));
    let best = { d: Infinity, i: 0, t: 0 };
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const ax = (a[1] - p[1]) * cosL, ay = a[0] - p[0];
      const dx = (b[1] - p[1]) * cosL - ax, dy = (b[0] - p[0]) - ay;
      const L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy) * 111320;
      if (d < best.d) best = { d, i, t };
    }
    best.along = cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i]);
    return best;
  }

  /* Posición y rumbo a d metros del inicio (para el modo demo). */
  function pointAt(route, d) {
    const { cum, coords } = route;
    d = Math.min(d, route.total);
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    const t = (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1), a = coords[i], b = coords[i + 1];
    return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
  }

  /* ---------- Instrucciones en español ---------- */
  const DIR = {
    left: 'a la izquierda', right: 'a la derecha', straight: 'recto',
    'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha',
    'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha'
  };
  const ICON = {
    left: '↰', right: '↱', straight: '↑', uturn: '↶',
    'slight left': '↖', 'slight right': '↗', 'sharp left': '↲', 'sharp right': '↳'
  };

  function describe(s) {
    const m = s.maneuver, mod = m.modifier, name = s.name || '';
    const via = name ? ` hacia ${name}` : '';
    const dir = DIR[mod] ? ' ' + DIR[mod] : '';
    let icon = ICON[mod] || '↑', text;
    switch (m.type) {
      case 'depart':  text = `Inicia la ruta${name ? ' por ' + name : ''}`; icon = '↑'; break;
      case 'arrive':  text = 'Has llegado a tu destino'; icon = '⚑'; break;
      case 'roundabout': case 'rotary': case 'roundabout turn':
        text = `En la rotonda, toma la salida ${m.exit || ''}${via}`.replace('  ', ' '); icon = '⟳'; break;
      case 'merge':   text = `Incorpórate${dir}${via}`; break;
      case 'on ramp': case 'off ramp': text = `Toma el ramal${dir}${via}`; break;
      case 'fork':    text = `Mantente${dir || ' en la vía'}${via}`; break;
      case 'continue': case 'new name':
        text = `Continúa${mod && mod !== 'straight' ? dir : ' recto'}${name ? ' por ' + name : ''}`; break;
      default:
        text = mod === 'uturn' ? `Haz un giro en U${via}` : `Gira${dir || ' recto'}${via}`;
    }
    return { type: m.type, icon, text };
  }

  /* fetch con límite de tiempo (señal débil); respeta el cancelar del usuario */
  function fetchT(url, signal, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    if (signal) signal.addEventListener('abort', () => c.abort());
    return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
  }

  /* ---------- OSRM ---------- */
  function build(rt) {
    const coords = rt.geometry.coordinates.map(c => [c[1], c[0]]);   // GeoJSON [lng,lat] → [lat,lng]
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1], k = total / (rt.distance || total);
    const steps = []; let acc = 0;
    rt.legs.forEach(leg => leg.steps.forEach(s => {
      steps.push({ ...describe(s), start: acc * k });                 // metros desde el inicio donde ocurre la maniobra
      acc += s.distance;
    }));
    return { coords, cum, total, distance: rt.distance, duration: rt.duration, steps };
  }

  async function osrmRoute(from, to, signal) {                       // from, to = [lat, lng]
    const url = `${OSRM}${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
    let j;
    try { j = await (await fetchT(url, signal, 8000)).json(); }
    catch (e) {
      if (signal && signal.aborted) throw e;
      throw new Error('No se pudo conectar con el servicio de rutas.');
    }
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error('No hay ruta disponible entre esos puntos.');
    return build(j.routes[0]);
  }

  /* Reconstruye una ruta guardada (se guarda sin 'cum' para ahorrar espacio) */
  function restore(sv) {
    const cum = [0];
    for (let i = 1; i < sv.coords.length; i++) cum.push(cum[i - 1] + haversine(sv.coords[i - 1], sv.coords[i]));
    return { ...sv, cum, total: cum[cum.length - 1] };
  }

  /* Estado del viaje para una posición p = [lat, lng] */
  function progress(route, p) {
    const loc = locate(route, p), remaining = Math.max(0, route.total - loc.along);
    let k = 0;
    while (k + 1 < route.steps.length && route.steps[k + 1].start <= loc.along) k++;
    const next = Math.min(k + 1, route.steps.length - 1);
    return {
      off: loc.d,                                                      // metros fuera de la ruta
      remaining,                                                       // metros restantes
      eta: route.duration * (remaining / route.total),                 // segundos restantes (proporcional)
      next,                                                            // índice de la próxima maniobra
      toNext: Math.max(0, route.steps[next].start - loc.along)
    };
  }

  /* ---------- Nominatim (solo Ecuador) ---------- */
  async function onlineGeocode(q, signal) {
    const url = `${NOMINATIM}?format=jsonv2&countrycodes=ec&limit=6&accept-language=es&q=${encodeURIComponent(q)}`;
    let rows;
    try { rows = await (await fetchT(url, signal, 8000)).json(); }
    catch (e) {
      if (signal && signal.aborted) throw e;
      throw new Error('Búsqueda no disponible.');
    }
    return rows.map(p => ({ name: p.display_name.split(', ').slice(0, 4).join(', '), lat: +p.lat, lng: +p.lon }));
  }

  /* ---------- Con internet usa OSRM/Nominatim; sin internet (o si fallan) usa los datos .g593 si están cargados ---------- */
  const local = () => g.Offline && g.Offline.ready();
  async function fetchRoute(from, to, signal) {
    if (local() && !navigator.onLine) return { ...build(g.Offline.route(from, to)), local: true };
    try { return await osrmRoute(from, to, signal); }
    catch (e) {
      if ((signal && signal.aborted) || !local()) throw e;
      return { ...build(g.Offline.route(from, to)), local: true };
    }
  }
  /* Photon (OpenStreetMap): tolera errores de escritura y sirve para sugerencias mientras se escribe.
     Nominatim no permite autocompletar, por eso solo se usa al pulsar Buscar. */
  async function photon(q, signal, near) {
    let url = `https://photon.komoot.io/api/?limit=8&bbox=-81.1,-5.1,-75.1,1.5&q=${encodeURIComponent(q)}`;
    if (near) url += `&lat=${near[0].toFixed(4)}&lon=${near[1].toFixed(4)}`;     // prioriza lo cercano
    let j;
    try { j = await (await fetchT(url, signal, 6000)).json(); }
    catch (e) { if (signal && signal.aborted) throw e; throw new Error('Búsqueda no disponible.'); }
    const seen = {};
    return (j.features || []).filter(f => !f.properties.countrycode || f.properties.countrycode === 'EC').map(f => {
      const p = f.properties, c = f.geometry.coordinates;
      const street = [p.street, p.housenumber].filter(Boolean).join(' ');
      const title = p.name || street || p.city || '';
      const sub = [p.name ? street : '', p.district, p.city || p.county, p.state].filter(Boolean).join(', ');
      return { name: sub ? `${title}, ${sub}` : title, title, sub, lat: c[1], lng: c[0] };
    }).filter(r => r.title && !seen[r.name] && (seen[r.name] = 1));
  }
  async function geocode(q, signal, opts) {
    opts = opts || {};
    if (local() && !navigator.onLine) return g.Offline.search(q);
    try {
      let r = await photon(q, signal, opts.near);
      if (!r.length && !opts.typing) r = await onlineGeocode(q, signal);          // Nominatim solo en búsquedas explícitas
      return r.length || !local() ? r : g.Offline.search(q);
    } catch (e) { if ((signal && signal.aborted) || !local()) throw e; return g.Offline.search(q); }
  }

  /* ---------- Formatos ---------- */
  const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m / 10) * 10 + ' m';
  const fmtTime = s => {
    const m = Math.max(1, Math.round(s / 60));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
  };
  const fmtClock = sec => new Date(Date.now() + sec * 1000)
    .toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });

  g.Routing = { geocode, fetchRoute, restore, progress, pointAt, haversine, bearing, fmtDist, fmtTime, fmtClock };
})(typeof window !== 'undefined' ? window : globalThis);
