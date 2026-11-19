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
  const favs = () => store.get('favs', []), routes = () => store.get('routes', []), recents = () => store.get('recents', []);
  const place = k => store.get(k, null), isFav = p => favs().some(f => sameDest(f, p)), placeName = p => p.title || p.name.split(',')[0],
    clean = p => ({ name: p.name, title: p.title, sub: p.sub, lat: p.lat, lng: p.lng });          // solo datos (sin funciones) para guardar
  const saveKey = (k, v) => { const ok = store.set(k, v); if (!ok) { logd('no se pudo guardar ' + k); toast('No se pudo guardar: el almacenamiento del teléfono está lleno o bloqueado.', 6000); } return ok; };
  async function namePlace(p) { const r = await R.reverse(p.lat, p.lng); if (r) { p.name = r.name; p.title = r.title; p.sub = r.sub; } return p; }
  const addRecent = p => store.set('recents', [clean(p)].concat(recents().filter(x => !sameDest(x, p))).slice(0, 8));
  const sameDest = (a, b) => a.lat === b.lat && a.lng === b.lng;
  const cfg = () => Object.assign({ theme: 'auto', voice: true, awake: true, alert: false, limit: 100, remember: true, autoOffline: true }, store.get('cfg', {}));
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
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="M12 4.5l3.2 7.5H8.8z" fill="#e11d48" stroke="none"/><path d="M12 19.5l-3.2-7.5h6.4z" fill="currentColor" stroke="none" opacity=".45"/>'
  };
  const svg = (n, filled) => `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  const paintIcons = () => document.querySelectorAll('[data-i]').forEach(e => { e.innerHTML = svg(e.dataset.i); });

  /* ---------- Estado ---------- */
  const state = {
    pos: null, last: null, heading: 0, speed: 0, dest: null, route: null, nav: false, follow: true,
    pick: null, origin: null, rotAcc: 0, rotLast: null, watchId: null, off: 0, lastReroute: 0, lastWarn: 0, spoken: {}, ctrl: null, sctrl: null, wl: null
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

  /* ---------- Selector de archivos de Android: lectura fiable y el permiso queda guardado ---------- */
  function nativeFile(f) {
    const rd = (offset, length) => async () => b64((await usb('read', { path: f.uri, offset, length })).data).buffer;
    return { name: f.name, size: f.size, native: f.uri, uriInfo: { uri: f.uri, name: f.name, size: f.size },
      head: rd(0, 28), tail: rd(Math.max(0, f.size - 8), Math.min(8, f.size)),
      arrayBuffer: () => readWhole(f.uri, f.size, p => toast('Cargando rutas y búsqueda… ' + p + '%', 4000)) };
  }
  async function pickNative() {
    let r; try { r = await usb('pickFile'); } catch (e) { if (/cancel/i.test((e && e.message) || '')) return []; throw e; }
    const out = [];
    for (const f of r.files || []) {
      if (f.size < 0) { try { f.size = (await usb('fileSize', { path: f.uri })).size; } catch (e) { f.size = 0; } }
      out.push(nativeFile(f));
    }
    return out;
  }

  /* ---------- Mapa (centrado en Ecuador) ---------- */
  const map = L.map('map', { zoomControl: false }).setView([-1.83, -78.18], 7);
  const CARTO_KEY = (window.GPSL_CONFIG || {}).CARTO_KEY || '';
  function loadScript(src) {
    return new Promise((ok, fail) => { const e = document.createElement('script'); e.src = src; e.onload = ok; e.onerror = () => fail(new Error('no se pudo cargar ' + src)); document.head.appendChild(e); });
  }
  let vecReady = null;
  const ensureVector = () => vecReady || (vecReady = (window.protomapsL && window.pmtiles) ? Promise.resolve()
    : loadScript('lib/pmtiles.js').then(() => loadScript('lib/protomaps-leaflet.js')));      // solo se cargan si se usa un mapa sin conexión
  function watchVector(layer) {                                                             // si el mapa vectorial no dibuja nada, vuelve al mapa en línea
    let ok = 0; layer.on('tileload', () => { ok++; });
    setTimeout(() => {
      if (pm && baseLayer === layer && ok === 0) {
        logd('mapa vectorial sin tiles: se vuelve al mapa en línea'); pm = null; setBase();
        toast('El mapa sin conexión no se dibuja en este dispositivo. Se usa el mapa en línea.', 9000);
      }
    }, 15000);
  }
  function setBase() {                                                                      // en línea (CARTO) o vectorial (.pmtiles)
    const old = baseLayer, next = pm
      ? protomapsL.leafletLayer({ url: pm.source, lang: 'es', maxDataZoom: pm.maxZoom, flavor: 'light', attribution: '© OpenStreetMap, Protomaps' })
      : L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=' + CARTO_KEY,
          { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap, © CARTO' });
    next.addTo(map); baseLayer = next; if (old) old.remove();
    if (pm) watchVector(next);
  }
  map.on('dragstart', () => { state.follow = false; });
  map.on('click', e => {
    if (state.nav) return;
    const { lat, lng } = e.latlng, mk = t => ({ name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, title: t, sub: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng });
    const box = document.createElement('div'); box.className = 'pop';
    [['Desde aquí', async () => setOrigin(await namePlace(mk('Punto de partida')))], ['Hasta aquí', async () => setDestination(await namePlace(mk('Punto en el mapa')))], ['Guardar', async () => openSaveMenu(await namePlace(mk('Lugar guardado')))]].forEach(([t, fn]) => {
      const b = document.createElement('button'); b.textContent = t; b.onclick = () => { map.closePopup(); fn(); }; box.append(b);
    });
    L.popup({ closeButton: false }).setLatLng(e.latlng).setContent(box).openOn(map);
  });

  /* ---------- Archivos sin conexión ---------- */
  async function loadOfflineMap(file, quiet) {
    const before = pm;
    try {
      await ensureVector();
      const source = new pmtiles.PMTiles(file.native ? new NativeSource(file.native) : new pmtiles.FileSource(file));
      const h = await source.getHeader();                                                   // falla si no es un .pmtiles válido
      await source.getZxy(h.minZoom, 0, 0);                                                 // prueba: leer y descomprimir un tile
      pm = { name: file.name, size: file.size, source, maxZoom: h.maxZoom };
      setBase();
      if (!quiet) map.fitBounds([[h.minLat, h.minLon], [h.maxLat, h.maxLon]]);
      logd(`mapa ok: ${file.name} z${h.minZoom}-${h.maxZoom}`);
      toast('Mapa sin conexión cargado: ' + file.name);
      return { ok: true };
    } catch (e) {
      pm = before; try { setBase(); } catch (e2) { logd('setBase: ' + e2.message); }
      logd('mapa error: ' + ((e && e.message) || e));
      toast('No se pudo usar el mapa sin conexión (' + ((e && e.message) || 'error') + '). Se mantiene el mapa en línea.', 8000);
      return { ok: false, msg: (e && e.message) || 'error' };
    }
  }
  async function graphHead(file) { return file.head ? file.head() : file.slice(0, 28).arrayBuffer(); }
  async function graphTail(file) { return file.tail ? file.tail() : file.slice(Math.max(0, file.size - 8), file.size).arrayBuffer(); }
  async function loadGraph(file) {
    try {
      const v = Offline.inspect(await graphHead(file), file.size, await graphTail(file));                          // ¿es un archivo de rutas de esta app, completo y de formato 1?
      if (!v.ok) throw new Error(v.message);
      toast('Cargando datos de rutas…', 8000);
      const i = await Offline.load(file); graphInfo = { name: file.name, size: file.size || 0 }; logd('rutas ok: ' + file.name);
      toast(`Rutas y búsqueda sin conexión listas (${i.places.toLocaleString('es-EC')} lugares)`);
      return { ok: true };
    } catch (e) { logd('rutas error (' + file.name + '): ' + e.message); toast('No se pudieron cargar las rutas: ' + e.message, 9000); return { ok: false, msg: e.message }; }
  }
  async function usbScan(manual) {                                                          // APK: busca ecuador.pmtiles y .g593
    lastScan = Date.now();
    try {
      const a = await usb('access');
      if (!a.granted) { if (manual) toast('Acepta el permiso de almacenamiento y vuelve a pulsar "Buscar en el pendrive".', 6000); return false; }
      const res = await usb('find');
      logd('buscar archivos: ' + res.visited + ' carpetas' + (res.unreadable && res.unreadable.length ? ' · SIN PERMISO en: ' + res.unreadable.join(', ') : ''));
      const seen = {}, list = res.files.filter(f => { const k = f.name + f.size; return seen[k] ? false : (seen[k] = true); });
      const byName = (a, b) => (/mini/i.test(b.name) - /mini/i.test(a.name)) || (b.size - a.size);   // primero los archivos «mini», luego los más grandes
      const ofType = ext => list.filter(f => f.name.toLowerCase().endsWith(ext)).sort(byName);
      const tail = (path, size) => async () => b64((await usb('read', { path, offset: Math.max(0, size - 8), length: 8 })).data).buffer;
      const head = path => async () => b64((await usb('read', { path, offset: 0, length: 28 })).data).buffer;
      const m = ofType('.pmtiles')[0]; let g = null;
      for (const c of ofType('.g593')) {                                                     // se usa el primero compatible con esta app
        const v = Offline.inspect(await head(c.path)(), c.size, await tail(c.path, c.size)());
        if (v.ok) { g = c; break; }
        logd('rutas incompatibles: ' + c.name + ' · ' + v.message);
      }
      logd('pendrive: ' + (m ? m.name + ' ' + Math.round(m.size / 1048576) + ' MB' : 'sin .pmtiles') + ' · ' + (g ? g.name + ' ' + Math.round(g.size / 1048576) + ' MB' : 'sin .g593 compatible'));
      if (!m && !g) { if (manual) toast('No se encontraron archivos .pmtiles ni .g593 compatibles.', 6000); return false; }
      if (m && !pm) await loadOfflineMap({ name: m.name, size: m.size, native: m.path }, true);
      if (g && !Offline.ready()) await loadGraph({ name: g.name, size: g.size, head: head(g.path), tail: tail(g.path, g.size), arrayBuffer: () => readWhole(g.path, g.size, p => toast('Cargando rutas y búsqueda… ' + p + '%', 4000)) });
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
  async function loadPicked(files) {
    const out = [], saved = store.get('nativeFiles', {});
    for (const f of files) {
      const isG = /\.g593$/i.test(f.name), r = isG ? await loadGraph(f) : await loadOfflineMap(f);
      out.push(`${isG ? 'Rutas' : 'Mapa'} ${r.ok ? '✓' : '✗'} ${f.name}${r.ok ? '' : ' — ' + r.msg}`);
      if (r.ok && f.uriInfo) saved[isG ? 'graph' : 'map'] = f.uriInfo;                       // la app recuerda dónde está: no hay que volver a elegirlo
      else if (r.ok && !NATIVE && cfg().remember) { try { await opfsSave(f); } catch (err) { toast('No se pudo guardar una copia de ' + f.name); } }
    }
    store.set('nativeFiles', saved);
    if (out.length > 1) toast(out.join('\n'), 12000);                                       // resumen: qué cargó y qué no
    renderSettings();
  }
  $('fileMap').onchange = e => loadPicked(Array.from(e.target.files));
  async function loadRemembered() {                                                          // al abrir la app: vuelve a cargar los archivos elegidos antes
    const saved = store.get('nativeFiles', {}); let any = false;
    for (const kind of ['map', 'graph']) {
      const f = saved[kind]; if (!f) continue;
      try {
        await usb('read', { path: f.uri, offset: 0, length: 16 });                           // ¿sigue accesible?
        const r = kind === 'map' ? await loadOfflineMap(nativeFile(f), true) : await loadGraph(nativeFile(f));
        if (r.ok) any = true; else delete saved[kind];
      } catch (e) { logd('archivo recordado no accesible: ' + f.name); delete saved[kind]; }
    }
    store.set('nativeFiles', saved); return any;
  }

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
    ok: NATIVE || 'speechSynthesis' in window, pick: null, cur: null,
    voice() {                                                                               // mejor voz en español disponible (navegador)
      if (this.pick) return this.pick;
      const vs = speechSynthesis.getVoices();
      for (const l of ['es-EC', 'es-419', 'es-US', 'es-MX', 'es-CO', 'es-ES']) {
        const v = vs.find(x => x.lang.replace('_', '-') === l); if (v) return (this.pick = v);
      }
      return (this.pick = vs.find(x => /^es/i.test(x.lang)) || null);
    },
    say(text, force) {
      if (!this.ok || (!force && !cfg().voice)) return;
      logd('voz: ' + text);
      if (NATIVE) { usb('speak', { text }).catch(e => logd('voz nativa: ' + ((e && e.message) || e))); return; }
      try {
        if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text), v = this.voice();
        u.lang = v ? v.lang : 'es-ES'; if (v) u.voice = v;
        u.onerror = e => logd('voz error: ' + (e.error || '?'));
        this.cur = u;                                                                       // evita que el navegador la descarte
        setTimeout(() => { try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch (e) { logd('voz: ' + e.message); } }, 150);
      } catch (e) { logd('voz: ' + e.message); }
    },
    stop() { if (NATIVE) usb('speakStop').catch(() => {}); else if (this.ok) speechSynthesis.cancel(); },
    unlock() { if (!NATIVE && this.ok) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* sin voz */ } } },
    info() { return NATIVE ? 'voz del sistema Android' : this.ok ? `${speechSynthesis.getVoices().length} voces · ${this.voice() ? this.voice().lang : 'ninguna en español'}` : 'no disponible en este navegador'; }
  };
  if (!NATIVE && Voice.ok) speechSynthesis.onvoiceschanged = () => { Voice.pick = null; };
  const paintMute = () => { $('btnMute').innerHTML = svg(cfg().voice ? 'vol' : 'mute'); };
  $('btnMute').onclick = () => { setCfg({ voice: !cfg().voice }); paintMute(); Voice.stop(); };

  /* ---------- Buscador: sugerencias mientras se escribe ---------- */
  function toggleFav(p) { const f = favs(); return isFav(p) ? saveKey('favs', f.filter(x => !sameDest(x, p))) : saveKey('favs', f.concat([clean(p)])); }
  function renderList(sections, emptyMsg) {
    const ul = $('list'); clear(ul); let n = 0;
    sections.forEach(sec => {
      if (!sec.items.length) return;
      if (sec.title) { const h = document.createElement('li'); h.className = 'hdr'; h.textContent = sec.title; ul.append(h); }
      sec.items.forEach(p => {
        n++;
        const li = document.createElement('li'), ic = document.createElement('span'), tx = document.createElement('div'), t = document.createElement('b');
        ic.className = 'ic'; ic.innerHTML = svg(p.icon || sec.icon || 'pin'); tx.className = 'tx';
        t.textContent = placeName(p); tx.append(t);
        const sub = p.sub !== undefined ? p.sub : (p.name || '').split(',').slice(1).join(',').trim();
        if (sub) { const sm = document.createElement('small'); sm.textContent = sub; tx.append(sm); }
        li.append(ic, tx);
        if (sec.star) {                                                                      // estrella: guardar o quitar de favoritos sin salir de la lista
          const st = document.createElement('button'); st.className = 'rowstar'; st.setAttribute('aria-label', 'Guardar o quitar de favoritos'); st.innerHTML = svg('star', isFav(p));
          st.onclick = e => { e.stopPropagation(); toggleFav(p); const sv = st.querySelector('svg'); if (sv) sv.setAttribute('fill', isFav(p) ? 'currentColor' : 'none'); };   // no se reemplaza el icono: así el toque no cierra la lista
          li.append(st);
        }
        if (sec.del) {
          const x = document.createElement('button'); x.innerHTML = svg('x'); x.setAttribute('aria-label', 'Quitar de la lista');
          x.onclick = e => { e.stopPropagation(); sec.del(p); };
          li.append(x);
        }
        li.onclick = () => { ul.hidden = true; $('q').blur(); (p.onpick || choose)(p); };
        ul.append(li);
      });
    });
    if (!n) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = emptyMsg || 'Sin resultados.'; ul.append(li); }
    ul.hidden = false;
  }
  const showFavs = () => renderList([{ title: 'Favoritos', icon: 'star', items: favs(), del: p => { store.set('favs', favs().filter(f => !sameDest(f, p))); showFavs(); } }],
    'Aún no tienes favoritos. Toca la estrella de cualquier lugar para guardarlo.');
  const quick = (kind, label) => { const p = place(kind); return { title: label, icon: kind, sub: p ? placeName(p) : 'Toca para configurar', onpick: () => (p ? setDestination(p) : startPick(kind)) }; };
  const showHome = () => renderList([
    { items: [quick('home', 'Casa'), quick('work', 'Trabajo')] },
    { title: 'Recientes', icon: 'clock', star: true, items: recents(), del: p => { store.set('recents', recents().filter(r => !sameDest(r, p))); showHome(); } },
    { title: 'Favoritos', icon: 'star', items: favs(), del: p => { store.set('favs', favs().filter(f => !sameDest(f, p))); showHome(); } }
  ]);
  function choose(p) {
    if (state.pick === 'origin') setOrigin(p);
    else if (state.pick === 'home' || state.pick === 'work') savePlace(state.pick, p);
    else setDestination(p);
  }
  function startPick(kind) {
    state.pick = kind; $('q').placeholder = kind === 'home' ? 'Busca la dirección de tu casa…' : kind === 'work' ? 'Busca la dirección de tu trabajo…' : 'Buscar el punto de partida…';
    $('q').focus(); toast(kind === 'origin' ? 'Busca el punto de partida o toca el mapa y elige "Desde aquí".' : 'Busca la dirección y tócala para guardarla.', 6000);
  }
  function savePlace(kind, p) {
    if (!saveKey(kind, clean(p))) return;
    state.pick = null; $('q').placeholder = '¿A dónde vamos?'; $('q').value = ''; $('qClear').hidden = true;
    toast((kind === 'home' ? 'Casa' : 'Trabajo') + ' guardada: ' + placeName(p)); renderSettings();
  }
  async function search(q, typing) {
    if (state.sctrl) state.sctrl.abort();
    const ctrl = state.sctrl = new AbortController(), c = map.getCenter();
    try {
      const r = await R.geocode(q, ctrl.signal, { typing, near: state.pos || [c.lat, c.lng] });
      if ($('q').value.trim() === q) renderList([{ icon: 'pin', star: true, items: r }], 'Sin resultados. Prueba con otro nombre o agrega la ciudad.');
    } catch (err) { if (err.name !== 'AbortError' && !typing) toast(err.message); }
  }
  let typingTimer;
  $('q').addEventListener('input', () => {
    clearTimeout(typingTimer);
    const q = $('q').value.trim(); $('qClear').hidden = !q;
    if (q.length < 2) { if (!q) showHome(); else $('list').hidden = true; return; }
    typingTimer = setTimeout(() => search(q, true), 350);                                   // espera a que termines de teclear
  });
  $('q').addEventListener('focus', () => { if (!$('q').value) showHome(); });
  $('list').addEventListener('mousedown', e => e.preventDefault());                         // tocar la lista no le quita el foco a la barra (evita toques perdidos con el teclado)
  $('qClear').onclick = () => { $('q').value = ''; $('qClear').hidden = true; $('q').focus(); showHome(); };
  $('searchForm').onsubmit = e => { e.preventDefault(); const q = $('q').value.trim(); if (q.length >= 2) search(q, false); };
  $('btnFavs').onclick = () => { if ($('list').hidden) showFavs(); else $('list').hidden = true; };
  document.addEventListener('click', e => { if (e.target.isConnected && !e.target.closest('.top')) $('list').hidden = true; });
  const paintSaveStar = () => { if (state.dest) $('btnSave').innerHTML = svg('star', isFav(state.dest)); };
  let saveTarget = null;
  function openSaveMenu(p) {                                                                // p = lugar a guardar (si no, el destino de la ruta)
    const d = p || state.dest; if (!d) return; saveTarget = d;
    $('saveSub').textContent = placeName(d); $('saveFav').textContent = isFav(d) ? 'Quitar de favoritos' : 'Guardar en favoritos'; $('saveMenu').hidden = false;
  }
  const closeSave = () => { $('saveMenu').hidden = true; };
  $('btnSave').onclick = () => openSaveMenu(null); $('saveClose').onclick = closeSave; $('saveMenu').onclick = e => { if (e.target === $('saveMenu')) closeSave(); };
  $('saveFav').onclick = () => { const ok = toggleFav(saveTarget); closeSave(); paintSaveStar(); if (ok) toast(isFav(saveTarget) ? 'Guardado en favoritos' : 'Quitado de favoritos'); };
  $('saveHome').onclick = () => { if (saveKey('home', clean(saveTarget))) toast('Casa guardada: ' + placeName(saveTarget)); closeSave(); };
  $('saveWork').onclick = () => { if (saveKey('work', clean(saveTarget))) toast('Trabajo guardado: ' + placeName(saveTarget)); closeSave(); };

  /* ---------- Ruta ---------- */
  function clearLayers() { ['casing', 'line', 'pin', 'org'].forEach(k => { if (layers[k]) { layers[k].remove(); layers[k] = null; } }); }
  function drawRoute() {
    clearLayers();
    const c = state.route.coords;
    layers.casing = L.polyline(c, { weight: 11, className: 'route-casing', lineJoin: 'round', interactive: false }).addTo(map);
    layers.line = L.polyline(c, { weight: 6, className: 'route', lineJoin: 'round', interactive: false }).addTo(map);
    layers.pin = L.marker([state.dest.lat, state.dest.lng], { icon: L.divIcon({ className: 'pin', iconSize: [22, 22] }), interactive: false }).addTo(map);
    if (state.origin) layers.org = L.circleMarker([state.origin.lat, state.origin.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#16a34a', fillOpacity: 1, interactive: false }).addTo(map);
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
    const o = state.origin; $('sFrom').textContent = o ? (o.title || o.name.split(',')[0]) : 'Mi ubicación'; $('btnFromReset').hidden = !o;
    $('btnGo').textContent = o ? 'Ir desde mi ubicación' : 'Iniciar'; paintSaveStar();
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
  async function recompute() {
    if (!state.dest) return;
    let from = state.origin ? [state.origin.lat, state.origin.lng] : (state.pos || await getFix());
    if (!from) { const c = map.getCenter(); from = [c.lat, c.lng]; toast('Sin GPS: se usa el centro del mapa como origen.'); }
    return computeRoute(from, false);
  }
  async function setDestination(p) { stopNav(); state.dest = p; addRecent(p); return recompute(); }
  function setOrigin(p) {
    state.origin = p; state.pick = null; $('q').placeholder = '¿A dónde vamos?'; $('q').value = ''; $('qClear').hidden = true;
    if (state.dest) recompute(); else toast('Punto de partida: ' + (p.title || p.name.split(',')[0]) + '. Ahora elige el destino.', 5000);
  }
  function clearRoute() {
    if (state.ctrl) state.ctrl.abort();
    clearLayers(); state.route = state.dest = null; state.origin = null; state.pick = null; $('q').placeholder = '¿A dónde vamos?';
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
    Voice.stop(); setNavUI(false);
  }
  document.addEventListener('visibilitychange', () => {                                      // sin rastreo en segundo plano
    if (document.hidden) stopLocation();
    else {
      startLocation();
      if (NATIVE && cfg().autoOffline && !pm && Date.now() - lastScan > 5000) usbScan(false);                     // pendrive conectado mientras tanto
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
  function rotateCar(a) {
    if (!car) return;
    state.rotAcc = state.rotLast === null ? a : state.rotAcc + ((a - state.rotLast + 540) % 360) - 180; state.rotLast = a;   // sin vueltas largas al cruzar 0°/360°
    const el = car.getElement() && car.getElement().firstChild; if (el) el.style.transform = `rotate(${state.rotAcc}deg)`;
  }
  function moveCar() {
    if (!car) car = L.marker(state.pos, { icon: L.divIcon({ className: 'car', html: CAR_SVG, iconSize: [44, 44], iconAnchor: [22, 22] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    car.setLatLng(state.pos);
    rotateCar(compassOn && compassHeading !== null && state.speed < 1.5 ? compassHeading : state.heading);
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

  /* ---------- Brújula: la aguja roja señala el Norte (sensor magnético del teléfono) ---------- */
  let compassHeading = null, compassOn = false, lastOrient = 0;
  const CARD = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  function tiltHeading(alpha, beta, gamma) {                                                // hacia dónde apunta el teléfono (compensa la inclinación)
    const r = Math.PI / 180, x = (beta || 0) * r, y = (gamma || 0) * r, z = (alpha || 0) * r;
    const cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
    const vx = -cZ * sY - sZ * sX * cY, vy = -sZ * sY + cZ * sX * cY;
    if (Math.hypot(vx, vy) < 0.35) return (360 - (alpha || 0)) % 360;                         // teléfono acostado: la fórmula no sirve, se usa el borde superior
    let h = Math.atan(vx / vy); if (vy < 0) h += Math.PI; else if (vx < 0) h += 2 * Math.PI;
    return h / r;
  }
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.alpha !== null && e.alpha !== undefined && (e.absolute || e.type === 'deviceorientationabsolute')) h = tiltHeading(e.alpha, e.beta, e.gamma);
    if (h === null || isNaN(h)) return;
    const now = Date.now(); if (now - lastOrient < 100) return; lastOrient = now;
    compassHeading = h;
    const needle = $('btnCompass').querySelector('svg'); if (needle) needle.style.transform = `rotate(${-h}deg)`;
    if (compassOn && car && state.speed < 1.5) rotateCar(h);                                 // parado: la flecha muestra hacia dónde miras
  }
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
  $('btnCompass').onclick = () => {
    if (compassHeading === null) return toast('Este dispositivo no entrega datos de brújula (no tiene sensor magnético).', 6000);
    compassOn = !compassOn; $('btnCompass').classList.toggle('on', compassOn);
    if (state.pos) map.setView(state.pos, Math.max(map.getZoom(), 15));
    toast(compassOn ? `Brújula activa: miras hacia el ${CARD[Math.round(compassHeading / 45) % 8]} (${Math.round(compassHeading)}°). La aguja roja señala el Norte; el mapa siempre tiene el Norte arriba.` : 'Brújula desactivada.', 7000);
  };

  /* ---------- Rutas guardadas (sirven sin internet) ---------- */
  $('btnRouteSave').onclick = () => {
    if (!state.route) return;
    const { coords, steps, distance, duration } = state.route, d = state.dest;
    const slim = { coords: coords.map(c => [+c[0].toFixed(5), +c[1].toFixed(5)]), steps, distance, duration };
    const list = routes().filter(x => !sameDest(x.dest, d)); list.unshift({ dest: d, route: slim });
    toast(store.set('routes', list.slice(0, 5)) ? 'Ruta guardada: podrás usarla sin internet' : 'No hay espacio para guardar la ruta');
  };
  function openSaved(item) {
    stopNav(); state.origin = null; state.dest = item.dest; state.route = R.restore(item.route); state.spoken = {}; state.off = 0;
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
    [['tgVoice', 'voice'], ['tgAwake', 'awake'], ['tgAlert', 'alert'], ['tgRemember', 'remember'], ['tgAuto', 'autoOffline']].forEach(([id, k]) => $(id).setAttribute('aria-checked', String(c[k])));
    $('limVal').textContent = c.limit; $('rowLimit').hidden = !c.alert;
    $('offMap').textContent = pm ? pm.name + ' (sin conexión)' : 'En línea (CARTO)';
    $('offGraph').textContent = Offline.ready() ? 'Activas: rutas y búsqueda sin internet' : 'No cargadas';
    const hm = place('home'), wk = place('work');
    $('homeSub').textContent = hm ? placeName(hm) : 'No configurada'; $('btnHome').textContent = hm ? 'Cambiar' : 'Configurar'; $('btnHomeX').hidden = !hm;
    $('workSub').textContent = wk ? placeName(wk) : 'No configurado'; $('btnWork').textContent = wk ? 'Cambiar' : 'Configurar'; $('btnWorkX').hidden = !wk;
    const V = window.GPS593_VERSION || { version: '?', date: '' }; $('aboutVersion').textContent = V.version + (V.date ? ' · ' + V.date : ''); $('aboutVer').textContent = 'Versión ' + V.version;
    $('btnUsb').hidden = !NATIVE; $('btnForget').hidden = NATIVE; $('rowRemember').hidden = NATIVE; $('rowAuto').hidden = !NATIVE; $('btnOnline').hidden = !pm;
  }
  const closeSettings = () => { $('settings').hidden = true; };
  let curTab = 'general';
  function showTab(name) {
    curTab = name;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
  }
  document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
  $('btnMenu').onclick = () => { $('list').hidden = true; renderSettings(); showTab(curTab); $('settings').hidden = false; };
  $('btnHome').onclick = () => { closeSettings(); startPick('home'); };
  $('btnWork').onclick = () => { closeSettings(); startPick('work'); };
  async function savePlaceHere(kind) {
    if (!state.pos) return toast('Todavía no hay posición GPS. Sal a cielo abierto y espera unos segundos.', 5000);
    savePlace(kind, await namePlace({ name: 'Mi ubicación', title: 'Mi ubicación', sub: '', lat: state.pos[0], lng: state.pos[1] }));
  }
  $('btnHomeHere').onclick = () => savePlaceHere('home'); $('btnWorkHere').onclick = () => savePlaceHere('work');
  $('btnHomeX').onclick = () => { store.set('home', null); renderSettings(); };
  $('btnWorkX').onclick = () => { store.set('work', null); renderSettings(); };
  $('setClose').onclick = closeSettings;
  $('settings').onclick = e => { if (e.target === $('settings')) closeSettings(); };
  document.querySelectorAll('#segTheme button').forEach(b => { b.onclick = () => { setCfg({ theme: b.dataset.v }); applyTheme(); renderSettings(); }; });
  [['tgVoice', 'voice'], ['tgAwake', 'awake'], ['tgAlert', 'alert'], ['tgRemember', 'remember'], ['tgAuto', 'autoOffline']].forEach(([id, k]) => {
    $(id).onclick = () => { setCfg({ [k]: !cfg()[k] }); paintMute(); renderSettings(); };
  });
  $('limDown').onclick = () => { setCfg({ limit: Math.max(30, cfg().limit - 10) }); renderSettings(); };
  $('limUp').onclick = () => { setCfg({ limit: Math.min(160, cfg().limit + 10) }); renderSettings(); };
  $('btnLoad').onclick = async () => {
    if (!NATIVE) return $('fileMap').click();
    try { const list = await pickNative(); if (list.length) await loadPicked(list); }
    catch (e) { logd('selector nativo: ' + ((e && e.message) || e)); toast('No se pudo abrir el selector de Android; se usa el del navegador.', 5000); $('fileMap').click(); }
  };
  $('btnUsb').onclick = async () => { await usbScan(true); renderSettings(); };
  $('btnOnline').onclick = () => { pm = null; $('fileMap').value = ''; setBase(); renderSettings(); };
  $('btnForget').onclick = async () => { try { await opfsClear(); } catch (e) { toast('No se pudo borrar.'); } };
  $('btnVoiceTest').onclick = () => { Voice.say('Hola. Esta es la guía de voz de GPS 593.', true); toast('Voz: ' + Voice.info(), 6000); };
  $('rowFavs').onclick = () => { closeSettings(); showFavs(); };
  $('rowRoutes').onclick = () => { closeSettings(); showRoutes(); };
  $('btnClearHist').onclick = () => { store.set('recents', []); toast('Historial de búsquedas borrado.'); };
  $('rowDiag').onclick = async () => {
    const v = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1], mb = n => Math.round(n / 1048576) + ' MB';
    let voz = Voice.info();
    if (NATIVE) { try { const t = await usb('ttsInfo'); voz = t.ready ? 'voz del sistema (' + (t.engine || '?') + ')' : 'voz del sistema: iniciando o sin motor de voz instalado'; } catch (e) { voz = 'voz nativa: error'; } }
    const V = window.GPS593_VERSION || {};
    const lines = [`GPS593 mini v${V.version || '?'}`, `WebView Chrome ${v || '?'}${NATIVE ? ' · app Android' : ''}${v && v < 80 ? ' (antigua)' : ''}`,
      `Mapa: ${pm ? pm.name + ' ' + mb(pm.size || 0) : 'en línea'}`,
      `Rutas: ${Offline.ready() ? (graphInfo ? graphInfo.name + ' ' + mb(graphInfo.size) : 'cargadas') : 'no cargadas'}`,
      `Internet: ${navigator.onLine ? 'sí' : 'no'}`, `Voz: ${voz}`,
      `Almacenamiento: favoritos ${favs().length} · recientes ${recents().length} · casa ${place('home') ? 'sí' : 'no'} · trabajo ${place('work') ? 'sí' : 'no'} · escritura ${store.set('probe', 1) ? 'OK' : 'FALLA'}`,
      `GPS: ${state.lastFixAt ? Math.round((Date.now() - state.lastFixAt) / 1000) + ' s desde el último fix' : 'sin posición todavía'}${NATIVE ? ' (GPS de Android' + (lastNative ? ': ' + lastNative.provider + ', ±' + Math.round(lastNative.acc) + ' m' : '') + ')' : ' (navegador)'}`
    ].concat((window.GPSL_LOG || []).slice(-12));
    const box = $('diagLog'); box.textContent = lines.join('\n'); box.hidden = false;
  };

  /* ---------- Botones principales ---------- */
  $('btnGo').onclick = async () => {
    Voice.unlock();
    if (state.origin) { state.origin = null; await recompute(); }                           // navegar siempre desde donde estás
    startNav(); startWatch();
  };
  $('btnFrom').onclick = () => { startPick('origin'); showHome(); };
  $('btnFromReset').onclick = () => { state.origin = null; recompute(); };
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
  if (NATIVE) { if (cfg().autoOffline) setTimeout(async () => { if (!(await loadRemembered())) usbScan(false); }, 800); }                                         // APK: carga lo que haya en el pendrive
  else { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); if (cfg().remember) opfsLoad().catch(() => {}); }
})();
