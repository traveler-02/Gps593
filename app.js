/* app.js — GPS 593: mapa, GPS, HUD, voz, ajustes y archivos sin conexión. Depende de Leaflet (L), Routing y Offline. */
(function () {
  'use strict';
  const R = Routing, $ = id => document.getElementById(id);
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); };            // compatible con WebView antiguos
  const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());

  /* ---------- Datos locales y ajustes ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('gpsl.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('gpsl.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const favs = () => store.get('favs', []), routes = () => store.get('routes', []);
  const sameDest = (a, b) => a.lat === b.lat && a.lng === b.lng;
  const cfg = () => Object.assign({ theme: 'auto', voice: true, awake: true, alert: false, limit: 100, remember: true }, store.get('cfg', {}));
  const setCfg = o => store.set('cfg', Object.assign(cfg(), o));

  /* ---------- Iconos (SVG en línea, sin imágenes) ---------- */
  const IC = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    star: '<polygon points="12 2 15.1 8.6 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.6 12 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    vol: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M23 9l-6 6M17 9l6 6"/>',
    save: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  const paintIcons = () => document.querySelectorAll('[data-i]').forEach(e => { e.innerHTML = svg(e.dataset.i); });

  /* ---------- Estado ---------- */
  const state = {
    pos: null, last: null, heading: 0, speed: 0, dest: null, route: null, nav: false, follow: true,
    watchId: null, off: 0, lastReroute: 0, lastWarn: 0, spoken: {}, ctrl: null, sctrl: null, wl: null
  };
  const layers = {};
  let car = null, toastTimer, baseLayer = null, pm = null, lastScan = 0;                   // pm = mapa sin conexión activo

  /* ---------- Avisos ---------- */
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3500);
  }

  /* ---------- Lectura directa desde el pendrive (solo APK Android, plugin UsbFiles) ---------- */
  const usb = (method, opts) => Capacitor.nativePromise('UsbFiles', method, opts || {});
  const b64 = str => { const t = atob(str), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  class NativeSource {                                                                      // pmtiles: lecturas por rango
    constructor(path) { this.path = path; }
    getKey() { return this.path; }
    async getBytes(offset, length) { const r = await usb('read', { path: this.path, offset, length }); return { data: b64(r.data).buffer }; }
  }
  async function readWhole(path, size) {                                                    // .g593 completo, trozos de 4 MB
    const out = new Uint8Array(size);
    for (let off = 0; off < size; off += 4194304) {
      const r = await usb('read', { path, offset: off, length: Math.min(4194304, size - off) });
      out.set(b64(r.data), off);
    }
    return out.buffer;
  }

  /* ---------- Mapa (centrado en Ecuador) ---------- */
  const map = L.map('map', { zoomControl: false }).setView([-1.83, -78.18], 7);
  const CARTO_KEY = (window.GPSL_CONFIG || {}).CARTO_KEY || '';
  function setBase() {                                                                      // en línea (CARTO) o vectorial (.pmtiles)
    if (baseLayer) baseLayer.remove();
    baseLayer = pm
      ? protomapsL.leafletLayer({ url: pm.source, lang: 'es', maxDataZoom: pm.maxZoom, flavor: 'light', attribution: '© OpenStreetMap, Protomaps' })
      : L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=' + CARTO_KEY,
          { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap, © CARTO' });
    baseLayer.addTo(map);
  }
  map.on('dragstart', () => { state.follow = false; });
  map.on('click', e => {
    if (state.nav) return;
    const { lat, lng } = e.latlng, b = document.createElement('button');
    b.textContent = 'Ir aquí';
    b.onclick = () => { map.closePopup(); setDestination({ name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, title: 'Punto en el mapa', sub: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); };
    L.popup({ closeButton: false }).setLatLng(e.latlng).setContent(b).openOn(map);
  });

  /* ---------- Archivos sin conexión ---------- */
  async function loadOfflineMap(file, quiet) {
    try {
      const source = new pmtiles.PMTiles(file.native ? new NativeSource(file.native) : new pmtiles.FileSource(file));
      const h = await source.getHeader();                                                   // falla si no es un .pmtiles válido
      pm = { name: file.name, source, maxZoom: h.maxZoom };
      setBase();
      if (!quiet) map.fitBounds([[h.minLat, h.minLon], [h.maxLat, h.maxLon]]);
      toast('Mapa sin conexión cargado: ' + file.name);
    } catch (e) { toast('No se pudo leer ese mapa. Debe ser un archivo .pmtiles.'); }
  }
  async function loadGraph(file) {
    try {
      toast('Cargando datos de rutas…', 8000);
      const i = await Offline.load(file);
      toast(`Rutas y búsqueda sin conexión listas (${i.places.toLocaleString('es-EC')} lugares)`);
    } catch (e) { toast('No se pudo leer ese archivo: ' + e.message); }
  }
  async function usbScan(manual) {                                                          // APK: busca ecuador.pmtiles y .g593
    lastScan = Date.now();
    try {
      const a = await usb('access');
      if (!a.granted) { if (manual) toast('Acepta el permiso de almacenamiento y vuelve a pulsar "Buscar en el pendrive".', 6000); return false; }
      const seen = {}, list = (await usb('find')).files.filter(f => { const k = f.name + f.size; return seen[k] ? false : (seen[k] = true); });
      const pick = ext => list.filter(f => f.name.toLowerCase().endsWith(ext)).sort((x, y) => y.size - x.size)[0];
      const m = pick('.pmtiles'), g = pick('.g593');
      if (!m && !g) { if (manual) toast('No se encontraron archivos .pmtiles ni .g593.', 6000); return false; }
      if (m && !pm) await loadOfflineMap({ name: m.name, size: m.size, native: m.path }, true);
      if (g && !Offline.ready()) await loadGraph({ name: g.name, size: g.size, arrayBuffer: () => readWhole(g.path, g.size) });
      return true;
    } catch (e) { if (manual) toast('No se pudo leer el almacenamiento: ' + (e.message || e)); return false; }
  }
  // Navegador: los archivos elegidos se guardan una vez en el almacenamiento privado de la app y se recuperan solos
  const opfs = async () => (navigator.storage && navigator.storage.getDirectory) ? navigator.storage.getDirectory() : null;
  async function opfsSave(file) {
    const d = await opfs(); if (!d) return;
    const w = await (await d.getFileHandle(file.name, { create: true })).createWritable();
    await file.stream().pipeTo(w);
  }
  async function opfsLoad() {
    const d = await opfs(); if (!d) return;
    for await (const [name, h] of d.entries()) {
      if (h.kind !== 'file') continue;
      const f = await h.getFile();
      if (/\.g593$/i.test(name)) await loadGraph(f); else if (/\.pmtiles$/i.test(name)) await loadOfflineMap(f, true);
    }
  }
  async function opfsClear() {
    const d = await opfs(); if (!d) return;
    for await (const [name] of d.entries()) await d.removeEntry(name);
    toast('Archivos guardados borrados.');
  }
  $('fileMap').onchange = async e => {
    for (const f of Array.from(e.target.files)) {
      if (/\.g593$/i.test(f.name)) await loadGraph(f); else await loadOfflineMap(f);
      if (!NATIVE && cfg().remember) { try { await opfsSave(f); } catch (err) { toast('No se pudo guardar una copia de ' + f.name); } }
    }
    renderSettings();
  };

  /* ---------- Tema ---------- */
  function applyTheme() {
    const c = cfg().theme, n = new Date(), h = n.getHours() + n.getMinutes() / 60;
    const eff = c === 'auto' ? (h >= 18.25 || h < 6.25 ? 'dark' : 'light') : c;           // Ecuador: ~06:15–18:15 todo el año
    document.documentElement.dataset.theme = eff;
    $('btnTheme').innerHTML = svg(eff === 'dark' ? 'sun' : 'moon');
  }
  $('btnTheme').onclick = () => { setCfg({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }); applyTheme(); };
  setInterval(() => { if (cfg().theme === 'auto') applyTheme(); }, 60000);

  /* ---------- Voz ---------- */
  const Voice = {
    ok: 'speechSynthesis' in window,
    say(text) {
      if (!this.ok || !cfg().voice) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = 'es-EC';
      const v = speechSynthesis.getVoices().find(x => /^es/i.test(x.lang)); if (v) u.voice = v;
      speechSynthesis.speak(u);
    },
    unlock() { if (this.ok) speechSynthesis.speak(new SpeechSynthesisUtterance('')); }
  };
  const paintMute = () => { $('btnMute').innerHTML = svg(cfg().voice ? 'vol' : 'mute'); };
  $('btnMute').onclick = () => { setCfg({ voice: !cfg().voice }); paintMute(); if (Voice.ok) speechSynthesis.cancel(); };

  /* ---------- Buscador: sugerencias mientras se escribe ---------- */
  function showList(items, isFav) {
    const ul = $('list'); clear(ul);
    if (!items.length) {
      const li = document.createElement('li'); li.className = 'empty';
      li.textContent = isFav ? 'Aún no tienes favoritos. Guarda un destino con ☆.' : 'Sin resultados. Prueba con otro nombre o agrega la ciudad.';
      ul.append(li);
    }
    items.forEach(p => {
      const li = document.createElement('li'), ic = document.createElement('span'), tx = document.createElement('div'), t = document.createElement('b');
      ic.className = 'ic'; ic.innerHTML = svg(isFav ? 'star' : 'pin'); tx.className = 'tx';
      t.textContent = p.title || p.name.split(',')[0]; tx.append(t);
      const sub = p.sub !== undefined ? p.sub : p.name.split(',').slice(1).join(',').trim();
      if (sub) { const s = document.createElement('small'); s.textContent = sub; tx.append(s); }
      li.append(ic, tx);
      if (isFav) {
        const x = document.createElement('button'); x.innerHTML = svg('x'); x.setAttribute('aria-label', 'Quitar de favoritos');
        x.onclick = e => { e.stopPropagation(); store.set('favs', favs().filter(f => !sameDest(f, p))); showList(favs(), true); };
        li.append(x);
      }
      li.onclick = () => { ul.hidden = true; $('q').blur(); setDestination(p); };
      ul.append(li);
    });
    ul.hidden = false;
  }
  async function search(q, typing) {
    if (state.sctrl) state.sctrl.abort();
    const ctrl = state.sctrl = new AbortController(), c = map.getCenter();
    try {
      const r = await R.geocode(q, ctrl.signal, { typing, near: state.pos || [c.lat, c.lng] });
      if ($('q').value.trim() === q) showList(r);
    } catch (err) { if (err.name !== 'AbortError' && !typing) toast(err.message); }
  }
  let typingTimer;
  $('q').addEventListener('input', () => {
    clearTimeout(typingTimer);
    const q = $('q').value.trim(); $('qClear').hidden = !q;
    if (q.length < 2) { $('list').hidden = true; return; }
    typingTimer = setTimeout(() => search(q, true), 350);                                   // espera a que termines de teclear
  });
  $('q').addEventListener('focus', () => { if (!$('q').value && favs().length) showList(favs(), true); });
  $('qClear').onclick = () => { $('q').value = ''; $('qClear').hidden = true; $('list').hidden = true; $('q').focus(); };
  $('searchForm').onsubmit = e => { e.preventDefault(); const q = $('q').value.trim(); if (q.length >= 2) search(q, false); };
  $('btnFavs').onclick = () => { if ($('list').hidden) showList(favs(), true); else $('list').hidden = true; };
  document.addEventListener('click', e => { if (!e.target.closest('.top')) $('list').hidden = true; });
  $('btnSave').onclick = () => {
    const f = favs(), d = state.dest;
    if (f.some(x => sameDest(x, d))) return toast('Ya está en favoritos');
    f.push(d); store.set('favs', f); toast('Guardado en favoritos');
  };

  /* ---------- Ruta ---------- */
  function clearLayers() { ['casing', 'line', 'pin'].forEach(k => { if (layers[k]) { layers[k].remove(); layers[k] = null; } }); }
  function drawRoute() {
    clearLayers();
    const c = state.route.coords;
    layers.casing = L.polyline(c, { weight: 11, className: 'route-casing', lineJoin: 'round', interactive: false }).addTo(map);
    layers.line = L.polyline(c, { weight: 6, className: 'route', lineJoin: 'round', interactive: false }).addTo(map);
    layers.pin = L.marker([state.dest.lat, state.dest.lng], { icon: L.divIcon({ className: 'pin', iconSize: [22, 22] }), interactive: false }).addTo(map);
  }
  function paintSummary(sec, m) { $('sEta').textContent = R.fmtClock(sec); $('sTime').textContent = R.fmtTime(sec); $('sDist').textContent = R.fmtDist(m); }
  function setNavUI(on) {
    state.nav = on; document.body.classList.toggle('nav', on); $('turn').hidden = !on;
    ['btnGo', 'btnSave', 'btnRouteSave'].forEach(id => { $(id).hidden = on; });
    $('btnCancel').textContent = on ? 'Salir de la ruta' : 'Cancelar';
  }
  function paintTurn(step, dist) { $('turnIcon').textContent = step.icon; $('turnDist').textContent = R.fmtDist(dist); $('turnText').textContent = step.text; }
  function presentRoute() {
    const d = state.dest, parts = d.name.split(',');
    $('sheet').hidden = false; document.body.classList.add('has-route');
    $('sDest').textContent = d.title || parts[0];
    $('sSub').textContent = d.sub !== undefined ? d.sub : parts.slice(1).join(',').trim();
    paintSummary(state.route.duration, state.route.distance); setNavUI(false);
    map.fitBounds(layers.line.getBounds(), { paddingTopLeft: [24, 90], paddingBottomRight: [24, 300] });
  }
  function getFix() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(pp => { onFix(pp); res(state.pos); }, () => res(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });
  }
  async function computeRoute(from, reroute) {
    if (state.ctrl) state.ctrl.abort();
    const ctrl = state.ctrl = new AbortController();
    try {
      const r = await R.fetchRoute(from, [state.dest.lat, state.dest.lng], ctrl.signal);
      state.route = r; state.spoken = {}; state.off = 0; drawRoute();
      if (reroute) return;
      presentRoute();
      if (r.local) toast('Ruta calculada sin conexión');
    } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  }
  async function setDestination(p) {
    stopNav(); state.dest = p;
    let from = state.pos || await getFix();
    if (!from) { const c = map.getCenter(); from = [c.lat, c.lng]; toast('Sin GPS: se usa el centro del mapa como origen.'); }
    computeRoute(from, false);
  }
  function clearRoute() {
    if (state.ctrl) state.ctrl.abort();
    clearLayers(); state.route = state.dest = null;
    $('sheet').hidden = true; document.body.classList.remove('has-route');
  }

  /* ---------- Navegación ---------- */
  function startNav() {
    setNavUI(true); state.follow = true;
    try { if (cfg().awake && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { state.wl = l; }).catch(() => {}); } catch (e) { /* sin soporte */ }
    const r = state.route, n = Math.min(1, r.steps.length - 1);
    paintTurn(r.steps[n], r.steps[n].start); Voice.say(r.steps[0].text); map.setZoom(17);
  }
  function startWatch() {
    if (state.watchId !== null || !navigator.geolocation) return;
    state.watchId = navigator.geolocation.watchPosition(onFix,
      e => toast(e.code === 1 ? 'Permiso de ubicación denegado.' : 'No se pudo obtener la ubicación.'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  }
  function stopWatch() { if (state.watchId !== null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; } }
  function stopNav() {
    if (state.wl) { state.wl.release(); state.wl = null; }
    stopWatch(); if (Voice.ok) speechSynthesis.cancel(); setNavUI(false);
  }
  document.addEventListener('visibilitychange', () => {                                      // sin rastreo en segundo plano
    if (document.hidden) stopWatch();
    else {
      if (state.nav) startWatch();
      if (NATIVE && !pm && Date.now() - lastScan > 5000) usbScan(false);                     // pendrive conectado mientras tanto
    }
  });
  function onFix(pp) {
    const c = pp.coords, p = [c.latitude, c.longitude], t = pp.timestamp || Date.now();
    if (state.pos && c.accuracy > 100) return;
    let v = c.speed;
    if ((v === null || isNaN(v)) && state.last) { const dt = (t - state.last.t) / 1000; if (dt > 0.5) v = R.haversine(state.last.p, p) / dt; }
    v = (v === null || isNaN(v)) ? 0 : v;
    state.speed = state.speed * 0.4 + v * 0.6;
    if (c.heading !== null && !isNaN(c.heading) && v > 1) state.heading = c.heading;
    else if (state.last && R.haversine(state.last.p, p) > 5) state.heading = R.bearing(state.last.p, p);
    state.last = { p, t }; state.pos = p;
    const kmh = Math.round(state.speed * 3.6), over = cfg().alert && kmh > cfg().limit;
    $('speedVal').textContent = kmh; $('speed').classList.toggle('over', over);
    if (over && state.nav && Date.now() - state.lastWarn > 30000) { state.lastWarn = Date.now(); Voice.say('Reduce la velocidad'); }
    moveCar();
    if (state.nav && state.route) navigate(p, c.accuracy);
  }
  const CAR_SVG = '<div class="car-rot"><svg viewBox="0 0 24 24"><path d="M12 2 20 21 12 17 4 21Z" style="fill:#f5b800;stroke:#14202b;stroke-width:1.5;stroke-linejoin:round"/></svg></div>';
  function moveCar() {
    if (!car) car = L.marker(state.pos, { icon: L.divIcon({ className: 'car', html: CAR_SVG, iconSize: [40, 40], iconAnchor: [20, 20] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    car.setLatLng(state.pos);
    const el = car.getElement() && car.getElement().firstChild; if (el) el.style.transform = `rotate(${state.heading}deg)`;
    if (state.nav && state.follow) map.panTo(state.pos, { animate: true, duration: 0.8 });
  }
  function navigate(p, accuracy) {
    const pr = R.progress(state.route, p);
    if (pr.remaining < 25) return finish();
    if (pr.off > Math.max(40, (accuracy || 0) * 1.5)) { if (++state.off >= 3) reroute(p); } else state.off = 0;
    paintSummary(pr.eta, pr.remaining); paintTurn(state.route.steps[pr.next], pr.toNext); announce(pr);
  }
  function reroute(p) {
    const now = Date.now();
    if (now - state.lastReroute < 10000) return;
    state.lastReroute = now; state.off = 0;
    if (!navigator.onLine && !Offline.ready()) {
      state.lastReroute = now + 20000; Voice.say('Te has salido de la ruta'); toast('Sin internet: no se puede recalcular la ruta.'); return;
    }
    Voice.say('Recalculando ruta'); toast('Recalculando ruta…'); computeRoute(p, true);
  }
  const TIERS = [400, 150, 30];
  function announce(pr) {
    const step = state.route.steps[pr.next], sp = state.spoken[pr.next] || (state.spoken[pr.next] = {});
    let t = -1; TIERS.forEach((m, i) => { if (pr.toNext <= m) t = i; });
    if (t < 0 || sp[t]) return;
    for (let i = 0; i <= t; i++) sp[i] = 1;
    if (step.type === 'arrive') return Voice.say(t === 2 ? step.text : `Tu destino está a ${TIERS[t]} metros`);
    Voice.say(t === 2 ? step.text : `En ${TIERS[t]} metros, ${step.text[0].toLowerCase() + step.text.slice(1)}`);
  }
  function finish() { Voice.say('Has llegado a tu destino'); toast('Has llegado a tu destino'); stopNav(); clearRoute(); }

  /* ---------- Rutas guardadas (sirven sin internet) ---------- */
  $('btnRouteSave').onclick = () => {
    if (!state.route) return;
    const { coords, steps, distance, duration } = state.route, d = state.dest;
    const slim = { coords: coords.map(c => [+c[0].toFixed(5), +c[1].toFixed(5)]), steps, distance, duration };
    const list = routes().filter(x => !sameDest(x.dest, d)); list.unshift({ dest: d, route: slim });
    toast(store.set('routes', list.slice(0, 5)) ? 'Ruta guardada: podrás usarla sin internet' : 'No hay espacio para guardar la ruta');
  };
  function openSaved(item) {
    stopNav(); state.dest = item.dest; state.route = R.restore(item.route); state.spoken = {}; state.off = 0;
    drawRoute(); presentRoute(); toast('Ruta cargada. Inicia desde el punto de partida.');
  }
  function showRoutes() {
    const ul = $('list'), items = routes(); clear(ul);
    if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No hay rutas guardadas. Calcula una y pulsa el marcador.'; ul.append(li); }
    items.forEach(it => {
      const li = document.createElement('li'), ic = document.createElement('span'), tx = document.createElement('div'), t = document.createElement('b'), s = document.createElement('small'), x = document.createElement('button');
      ic.className = 'ic'; ic.innerHTML = svg('save'); tx.className = 'tx';
      t.textContent = it.dest.title || it.dest.name.split(',')[0]; s.textContent = R.fmtDist(it.route.distance) + ' · ' + R.fmtTime(it.route.duration); tx.append(t, s);
      x.innerHTML = svg('x'); x.setAttribute('aria-label', 'Borrar ruta guardada');
      x.onclick = e => { e.stopPropagation(); store.set('routes', routes().filter(r => !sameDest(r.dest, it.dest))); showRoutes(); };
      li.append(ic, tx, x); li.onclick = () => { ul.hidden = true; openSaved(it); }; ul.append(li);
    });
    ul.hidden = false;
  }

  /* ---------- Ajustes (botón de engranaje) ---------- */
  function renderSettings() {
    const c = cfg();
    document.querySelectorAll('#segTheme button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === c.theme)));
    [['tgVoice', 'voice'], ['tgAwake', 'awake'], ['tgAlert', 'alert'], ['tgRemember', 'remember']].forEach(([id, k]) => $(id).setAttribute('aria-checked', String(c[k])));
    $('limVal').textContent = c.limit; $('rowLimit').hidden = !c.alert;
    $('offMap').textContent = pm ? pm.name + ' (sin conexión)' : 'En línea (CARTO)';
    $('offGraph').textContent = Offline.ready() ? 'Activas: rutas y búsqueda sin internet' : 'No cargadas';
    $('btnUsb').hidden = !NATIVE; $('btnForget').hidden = NATIVE; $('rowRemember').hidden = NATIVE; $('btnOnline').hidden = !pm;
  }
  const closeSettings = () => { $('settings').hidden = true; };
  $('btnMenu').onclick = () => { $('list').hidden = true; renderSettings(); $('settings').hidden = false; };
  $('setClose').onclick = closeSettings;
  $('settings').onclick = e => { if (e.target === $('settings')) closeSettings(); };
  document.querySelectorAll('#segTheme button').forEach(b => { b.onclick = () => { setCfg({ theme: b.dataset.v }); applyTheme(); renderSettings(); }; });
  [['tgVoice', 'voice'], ['tgAwake', 'awake'], ['tgAlert', 'alert'], ['tgRemember', 'remember']].forEach(([id, k]) => {
    $(id).onclick = () => { setCfg({ [k]: !cfg()[k] }); paintMute(); renderSettings(); };
  });
  $('limDown').onclick = () => { setCfg({ limit: Math.max(30, cfg().limit - 10) }); renderSettings(); };
  $('limUp').onclick = () => { setCfg({ limit: Math.min(160, cfg().limit + 10) }); renderSettings(); };
  $('btnLoad').onclick = () => $('fileMap').click();
  $('btnUsb').onclick = async () => { await usbScan(true); renderSettings(); };
  $('btnOnline').onclick = () => { pm = null; $('fileMap').value = ''; setBase(); renderSettings(); };
  $('btnForget').onclick = async () => { try { await opfsClear(); } catch (e) { toast('No se pudo borrar.'); } };
  $('rowFavs').onclick = () => { closeSettings(); showList(favs(), true); };
  $('rowRoutes').onclick = () => { closeSettings(); showRoutes(); };
  $('rowDiag').onclick = () => {
    const v = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];
    toast(`WebView Chrome ${v || '?'}${NATIVE ? ' · app Android' : ''}${v && v < 80 ? ' · antigua: puede fallar el mapa' : ''}`, 7000);
  };

  /* ---------- Botones principales ---------- */
  $('btnGo').onclick = () => { Voice.unlock(); startNav(); startWatch(); };
  $('btnCancel').onclick = () => { stopNav(); clearRoute(); };
  $('btnLocate').onclick = async () => {
    state.follow = true;
    if (state.watchId === null) await getFix();                                              // una sola lectura, sin vigilancia continua
    if (state.pos) map.setView(state.pos, Math.max(map.getZoom(), 16));
    else toast('No se pudo obtener tu ubicación. Activa el GPS y concede el permiso.');
  };

  /* ---------- Inicio ---------- */
  paintIcons(); applyTheme(); paintMute(); setBase();
  if (NATIVE) setTimeout(() => usbScan(false), 800);                                         // APK: carga lo que haya en el pendrive
  else { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); if (cfg().remember) opfsLoad().catch(() => {}); }
})();
