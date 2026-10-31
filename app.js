/* app.js — GPS 593: mapa, GPS, HUD, voz, ajustes y archivos sin conexión. Depende de Leaflet (L), Routing y Offline. */
(function () {
  'use strict';
  const R = Routing, $ = id => document.getElementById(id);
  const logd = m => { (window.GPSL_LOG = window.GPSL_LOG || []).push(new Date().toLocaleTimeString() + ' ' + m); };
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
  let car = null, toastTimer, baseLayer = null, pm = null, lastScan = 0, graphInfo = null;                   // pm = mapa sin conexión activo

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
  async function readWhole(path, size, onProgress) {                                        // .g593 completo, trozos de 2 MB
    let out;
    try { out = new Uint8Array(size); } catch (e) { throw new Error('memoria insuficiente para ' + Math.round(size / 1048576) + ' MB'); }
    const CH = 2097152;
    for (let off = 0; off < size; off += CH) {
      const r = await usb('read', { path, offset: off, length: Math.min(CH, size - off) });
      out.set(b64(r.data), off);
      if (onProgress) onProgress(Math.round(Math.min(off + CH, size) * 100 / size));
      await new Promise(res => setTimeout(res, 0));                                         // deja respirar a la pantalla
    }
    return out.buffer;
  }

  /* ---------- Mapa (centrado en Ecuador) ---------- */
  const map = L.map('map', { zoomControl: false }).setView([-1.83, -78.18], 7);
  const CARTO_KEY = (window.GPSL_CONFIG || {}).CARTO_KEY || '';
  function setBase() {                                                                      // en línea (CARTO) o vectorial (.pmtiles)
    const old = baseLayer, next = pm
      ? protomapsL.leafletLayer({ url: pm.source, lang: 'es', maxDataZoom: pm.maxZoom, flavor: 'light', attribution: '© OpenStreetMap, Protomaps' })
      : L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=' + CARTO_KEY,
          { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap, © CARTO' });
    next.addTo(map); baseLayer = next; if (old) old.remove();
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
    const before = pm;
    try {
      const source = new pmtiles.PMTiles(file.native ? new NativeSource(file.native) : new pmtiles.FileSource(file));
      const h = await source.getHeader();                                                   // falla si no es un .pmtiles válido
      await source.getZxy(h.minZoom, 0, 0);                                                 // prueba: leer y descomprimir un tile
      pm = { name: file.name, size: file.size, source, maxZoom: h.maxZoom };
      setBase();
      if (!quiet) map.fitBounds([[h.minLat, h.minLon], [h.maxLat, h.maxLon]]);
      logd(`mapa ok: ${file.name} z${h.minZoom}-${h.maxZoom}`);
      toast('Mapa sin conexión cargado: ' + file.name);
    } catch (e) {
      pm = before; try { setBase(); } catch (e2) { logd('setBase: ' + e2.message); }
      logd('mapa error: ' + ((e && e.message) || e));
      toast('No se pudo usar el mapa sin conexión (' + ((e && e.message) || 'error') + '). Se mantiene el mapa en línea.', 8000);
    }
  }
  async function loadGraph(file) {
    try {
      toast('Cargando datos de rutas…', 8000);
      const i = await Offline.load(file); graphInfo = { name: file.name, size: file.size || 0 }; logd('rutas ok: ' + file.name);
      toast(`Rutas y búsqueda sin conexión listas (${i.places.toLocaleString('es-EC')} lugares)`);
    } catch (e) { logd('rutas error: ' + e.message); toast('No se pudieron cargar las rutas: ' + e.message, 8000); }
  }
  async function usbScan(manual) {                                                          // APK: busca ecuador.pmtiles y .g593
    lastScan = Date.now();
    try {
      const a = await usb('access');
      if (!a.granted) { if (manual) toast('Acepta el permiso de almacenamiento y vuelve a pulsar "Buscar en el pendrive".', 6000); return false; }
      const seen = {}, list = (await usb('find')).files.filter(f => { const k = f.name + f.size; return seen[k] ? false : (seen[k] = true); });
      const pick = ext => list.filter(f => f.name.toLowerCase().endsWith(ext)).sort((x, y) => y.size - x.size)[0];
      const m = pick('.pmtiles'), g = pick('.g593');
      logd('pendrive: ' + (m ? m.name + ' ' + Math.round(m.size / 1048576) + ' MB' : 'sin .pmtiles') + ' · ' + (g ? g.name + ' ' + Math.round(g.size / 1048576) + ' MB' : 'sin .g593'));
      if (!m && !g) { if (manual) toast('No se encontraron archivos .pmtiles ni .g593.', 6000); return false; }
      if (m && !pm) await loadOfflineMap({ name: m.name, size: m.size, native: m.path }, true);
      if (g && !Offline.ready()) await loadGraph({ name: g.name, size: g.size, arrayBuffer: () => readWhole(g.path, g.size, p => toast('Cargando rutas y búsqueda… ' + p + '%', 4000)) });
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
    ok: 'speechSynthesis' in window, pick: null, cur: null,
    voice() {                                                                               // mejor voz en español disponible
      if (this.pick) return this.pick;
      const vs = speechSynthesis.getVoices();
      for (const l of ['es-EC', 'es-419', 'es-US', 'es-MX', 'es-CO', 'es-ES']) {
        const v = vs.find(x => x.lang.replace('_', '-') === l); if (v) return (this.pick = v);
      }
      return (this.pick = vs.find(x => /^es/i.test(x.lang)) || null);
    },
    say(text, force) {
      if (!this.ok || (!force && !cfg().voice)) return;
      try {
        if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text), v = this.voice();
        u.lang = v ? v.lang : 'es-ES'; if (v) u.voice = v;
        u.onerror = e => logd('voz error: ' + (e.error || '?'));
        this.cur = u;                                                                       // evita que el navegador la descarte
        logd('voz: ' + text);
        setTimeout(() => { try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch (e) { logd('voz: ' + e.message); } }, 150);
      } catch (e) { logd('voz: ' + e.message); }
    },
    unlock() { if (this.ok) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* sin voz */ } } },
    info() { return this.ok ? `${speechSynthesis.getVoices().length} voces · ${this.voice() ? this.voice().lang : 'ninguna en español'}` : 'no disponible en este navegador'; }
  };
  if (Voice.ok) speechSynthesis.onvoiceschanged = () => { Voice.pick = null; };

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
  async function getFix() {
    if (state.pos) return state.pos;
    if (NATIVE) { await nativePoll(true); return state.pos; }
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      const ok = pp => { onFix(pp); res(state.pos); };
      navigator.geolocation.getCurrentPosition(ok, e => {
        logd('geo (GPS): ' + e.code + ' ' + e.message);
        if (e.code === 1) { toast(geoMsg(e), 7000); return res(null); }
        navigator.geolocation.getCurrentPosition(ok, e2 => { logd('geo (red): ' + e2.code + ' ' + e2.message); toast(geoMsg(e2), 7000); res(null); },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });                // plan B: ubicación por red/wifi, como Google Maps
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
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
      e => { logd('geo: ' + e.code + ' ' + e.message); if (Date.now() - lastGeoToast > 20000) { lastGeoToast = Date.now(); toast(geoMsg(e), 7000); } },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    if (!state.pos) navigator.geolocation.getCurrentPosition(onFix, () => {}, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });   // primera posición rápida
  }
  function stopWatch() { if (state.watchId !== null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; } }
  function stopNav() {
    if (state.wl) { state.wl.release(); state.wl = null; }
    if (Voice.ok) speechSynthesis.cancel(); setNavUI(false);
  }
  document.addEventListener('visibilitychange', () => {                                      // sin rastreo en segundo plano
    if (document.hidden) stopLocation();
    else {
      startLocation();
      if (NATIVE && !pm && Date.now() - lastScan > 5000) usbScan(false);                     // pendrive conectado mientras tanto
    }
  });
  function onFix(pp) {
    const c = pp.coords, p = [c.latitude, c.longitude], t = pp.timestamp || Date.now();
    if (state.pos && c.accuracy > 100 && Date.now() - (state.lastFixAt || 0) < 10000) return;   // ignora lecturas imprecisas si hay una mejor reciente
    let v = c.speed;
    if ((v === null || isNaN(v)) && state.last) { const dt = (t - state.last.t) / 1000; if (dt > 0.5) v = R.haversine(state.last.p, p) / dt; }
    v = (v === null || isNaN(v)) ? 0 : v;
    state.speed = state.speed * 0.4 + v * 0.6;
    if (c.heading !== null && !isNaN(c.heading) && v > 1) state.heading = c.heading;
    else if (state.last && R.haversine(state.last.p, p) > 5) state.heading = R.bearing(state.last.p, p);
    state.last = { p, t }; state.pos = p; state.lastFixAt = Date.now();
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

  /* ---------- Ubicación: en la radio (APK) se lee el GPS de Android; en el navegador, la API del navegador ---------- */
  const geoMsg = e => e.code === 1 ? 'Permiso de ubicación denegado. Actívalo en Ajustes de Android > Aplicaciones > GPS 593 > Permisos.'
    : e.code === 3 ? 'El GPS tarda en responder: ponte a cielo abierto y espera un momento.' : 'No se pudo obtener la ubicación.';
  let locTimer = null, lastLocKey = '', lastGeoToast = 0, rawLogged = 0, lastNative = null;
  async function nativePoll(first) {
    try {
      const p = await usb('locationLast');
      if (rawLogged < 3) { rawLogged++; logd('fix nativo: ' + JSON.stringify(p)); }
      if (!p.has) return false;
      const key = [p.seq, p.time, p.lat, p.lon].join();
      if (key === lastLocKey) return true;                                                  // misma lectura de antes
      if (p.age >= 0 && p.age > (first ? 600000 : 30000)) return false;                     // vieja (age < 0 = el GPS no informa la hora)
      lastLocKey = key; lastNative = p;
      onFix({ coords: { latitude: p.lat, longitude: p.lon, accuracy: p.acc, speed: p.speed >= 0 ? p.speed : null, heading: p.bearing >= 0 ? p.bearing : null }, timestamp: Date.now() });
      return true;
    } catch (e) { return false; }
  }
  async function startLocation() {
    if (!NATIVE) { startWatch(); return; }
    if (document.hidden) return;
    try {
      const r = await usb('locationStart');
      if (!r.granted) { toast('Concede el permiso de ubicación a GPS 593 en la ventana que aparece.', 7000); setTimeout(startLocation, 5000); return; }
      logd(`ubicación nativa: gps=${r.gps} red=${r.network}`);
      if (!r.gps && !r.network) toast('La ubicación de Android está desactivada. Actívala en los ajustes del sistema.', 9000);
      clearInterval(locTimer); locTimer = setInterval(() => nativePoll(false), 1000);
      nativePoll(true);
    } catch (e) { logd('ubicación nativa falló: ' + (e.message || e)); startWatch(); }
  }
  function stopLocation() { stopWatch(); clearInterval(locTimer); locTimer = null; if (NATIVE) usb('locationStop').catch(() => {}); }

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
  $('btnVoiceTest').onclick = () => { Voice.say('Hola. Esta es la guía de voz de GPS 593.', true); toast('Voz: ' + Voice.info(), 6000); };
  $('rowFavs').onclick = () => { closeSettings(); showList(favs(), true); };
  $('rowRoutes').onclick = () => { closeSettings(); showRoutes(); };
  $('rowDiag').onclick = () => {
    const v = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1], mb = n => Math.round(n / 1048576) + ' MB';
    const lines = [`WebView Chrome ${v || '?'}${NATIVE ? ' · app Android' : ''}${v && v < 80 ? ' (antigua)' : ''}`,
      `Mapa: ${pm ? pm.name + ' ' + mb(pm.size || 0) : 'en línea'}`,
      `Rutas: ${Offline.ready() ? (graphInfo ? graphInfo.name + ' ' + mb(graphInfo.size) : 'cargadas') : 'no cargadas'}`,
      `Internet: ${navigator.onLine ? 'sí' : 'no'}`, `Voz: ${Voice.info()}`,
      `GPS: ${state.lastFixAt ? Math.round((Date.now() - state.lastFixAt) / 1000) + ' s desde el último fix' : 'sin posición todavía'}${NATIVE ? ' (GPS de Android' + (lastNative ? ': ' + lastNative.provider + ', ±' + Math.round(lastNative.acc) + ' m' : '') + ')' : ' (navegador)'}`].concat((window.GPSL_LOG || []).slice(-12));
    const box = $('diagLog'); box.textContent = lines.join('\n'); box.hidden = false;
  };


  /* ---------- Botones principales ---------- */
  $('btnGo').onclick = () => { Voice.unlock(); startNav(); startWatch(); };
  $('btnCancel').onclick = () => { stopNav(); clearRoute(); };
  $('btnLocate').onclick = async () => {
    state.follow = true;
    await getFix();
    if (state.pos) map.setView(state.pos, Math.max(map.getZoom(), 16));
    else { toast('Buscando tu ubicación… ponte a cielo abierto y espera unos segundos.', 6000); startLocation(); }
  };

  /* ---------- Inicio ---------- */
  paintIcons(); applyTheme(); paintMute(); setBase();
  startLocation();                                                                           // velocímetro y posición desde el inicio
  setInterval(() => {                                                                        // aviso visible si no hay GPS
    const ok = state.lastFixAt && Date.now() - state.lastFixAt < 15000;
    $('speed').classList.toggle('nogps', !ok); $('speed').querySelector('small').textContent = ok ? 'km/h' : 'sin GPS';
  }, 2000);
  if (NATIVE) setTimeout(() => usbScan(false), 800);                                         // APK: carga lo que haya en el pendrive
  else { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); if (cfg().remember) opfsLoad().catch(() => {}); }
})();
