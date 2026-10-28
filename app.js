/* app.js — mapa, GPS, HUD, voz, favoritos y tema. Depende de Leaflet (L) y Routing. */
(function () {
  'use strict';
  const R = Routing;
  const $ = id => document.getElementById(id);

  /* ---------- Almacenamiento local (favoritos, tema, voz) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('gpsl.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('gpsl.' + k, JSON.stringify(v)); } catch { /* sin espacio o bloqueado */ } }
  };
  const favs = () => store.get('favs', []);

  /* ---------- Estado ---------- */
  const state = {
    pos: null, last: null, heading: 0, speed: 0,          // posición, último fix, rumbo, velocidad (m/s)
    dest: null, route: null, nav: false, follow: true,
    watchId: null, demo: null, off: 0, lastReroute: 0, spoken: {}, ctrl: null, sctrl: null
  };
  const layers = {};
  let car = null, toastTimer;

  /* ---------- Mapa (centrado en Ecuador) ---------- */
  const map = L.map('map', { zoomControl: false }).setView([-1.83, -78.18], 7);
  // CARTO exige una API key gratuita (https://carto.com/basemaps/apikey). Pégala aquí:
  const CARTO_KEY = cb1_4wh9_1_2c28c26457c5fdae8444b3bf ;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=' + CARTO_KEY, {
    subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap, © CARTO'
  }).addTo(map);
  map.on('dragstart', () => { state.follow = false; });
  map.on('click', e => {
    if (state.nav) return;
    const { lat, lng } = e.latlng, b = document.createElement('button');
    b.textContent = 'Ir aquí';
    b.onclick = () => { map.closePopup(); setDestination({ name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); };
    L.popup({ closeButton: false }).setLatLng(e.latlng).setContent(b).openOn(map);
  });

  /* ---------- Utilidades de interfaz ---------- */
  function toast(msg, ms = 3500) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------- Tema: auto (por hora; Ecuador ≈ 06:15–18:15 todo el año), claro u oscuro ---------- */
  const THEMES = ['auto', 'light', 'dark'], LABEL = { auto: 'Auto', light: 'Claro', dark: 'Oscuro' };
  let theme = store.get('theme', 'auto');
  function applyTheme() {
    const now = new Date(), h = now.getHours() + now.getMinutes() / 60;
    const eff = theme === 'auto' ? (h >= 18.25 || h < 6.25 ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = eff;
    $('btnTheme').textContent = LABEL[theme];
  }
  $('btnTheme').onclick = () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; store.set('theme', theme); applyTheme(); };
  setInterval(() => { if (theme === 'auto') applyTheme(); }, 60000);
  applyTheme();

  /* ---------- Voz (speechSynthesis) ---------- */
  const Voice = {
    ok: 'speechSynthesis' in window,
    say(text) {
      if (!this.ok || !store.get('voice', true)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-EC';
      const v = speechSynthesis.getVoices().find(x => /^es/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    },
    unlock() { if (this.ok) speechSynthesis.speak(new SpeechSynthesisUtterance('')); }  // los móviles exigen un gesto del usuario
  };
  const paintMute = () => { $('btnMute').textContent = store.get('voice', true) ? '🔊' : '🔇'; };
  $('btnMute').onclick = () => { store.set('voice', !store.get('voice', true)); paintMute(); if (Voice.ok) speechSynthesis.cancel(); };
  paintMute();

  /* ---------- Buscador y favoritos ---------- */
  function showList(items, isFav) {
    const ul = $('list'); ul.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li'); li.className = 'empty';
      li.textContent = isFav ? 'Aún no tienes favoritos. Guarda un destino con ☆.' : 'Sin resultados en Ecuador.';
      ul.append(li);
    }
    items.forEach(p => {
      const li = document.createElement('li'), s = document.createElement('span');
      s.textContent = p.name; li.append(s);
      if (isFav) {
        const x = document.createElement('button');
        x.textContent = '✕'; x.setAttribute('aria-label', 'Quitar de favoritos');
        x.onclick = e => { e.stopPropagation(); store.set('favs', favs().filter(f => !(f.lat === p.lat && f.lng === p.lng))); showList(favs(), true); };
        li.append(x);
      }
      li.onclick = () => { ul.hidden = true; setDestination(p); };
      ul.append(li);
    });
    ul.hidden = false;
  }

  $('searchForm').onsubmit = async e => {
    e.preventDefault();
    const q = $('q').value.trim();
    if (q.length < 3) return;
    if (state.sctrl) state.sctrl.abort();
    state.sctrl = new AbortController();
    try { showList(await R.geocode(q, state.sctrl.signal)); }
    catch (err) { if (err.name !== 'AbortError') toast(err.message); }
  };
  $('btnFavs').onclick = () => { if ($('list').hidden) showList(favs(), true); else $('list').hidden = true; };
  $('btnSave').onclick = () => {
    const f = favs(), d = state.dest;
    if (f.some(x => x.lat === d.lat && x.lng === d.lng)) return toast('Ya está en favoritos');
    f.push(d); store.set('favs', f); toast('Guardado en favoritos');
  };

  /* ---------- Ruta ---------- */
  function clearLayers() { ['casing', 'line', 'pin'].forEach(k => { if (layers[k]) { layers[k].remove(); layers[k] = null; } }); }

  function drawRoute() {
    clearLayers();
    const c = state.route.coords;
    layers.casing = L.polyline(c, { weight: 11, className: 'route-casing', lineJoin: 'round', interactive: false }).addTo(map);
    layers.line = L.polyline(c, { weight: 6, className: 'route', lineJoin: 'round', interactive: false }).addTo(map);
    layers.pin = L.marker([state.dest.lat, state.dest.lng], {
      icon: L.divIcon({ className: 'pin', iconSize: [22, 22] }), interactive: false
    }).addTo(map);
  }

  function paintSummary(sec, m) {
    $('sEta').textContent = R.fmtClock(sec);
    $('sTime').textContent = R.fmtTime(sec);
    $('sDist').textContent = R.fmtDist(m);
  }

  function setNavUI(on) {
    state.nav = on;
    document.body.classList.toggle('nav', on);
    $('turn').hidden = !on;
    ['btnGo', 'btnDemo', 'btnSave'].forEach(id => { $(id).hidden = on; });
    $('btnCancel').textContent = on ? 'Salir' : 'Cancelar';
  }

  function paintTurn(step, dist) {
    $('turnIcon').textContent = step.icon;
    $('turnDist').textContent = R.fmtDist(dist);
    $('turnText').textContent = step.text;
  }

  function getFix() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        pp => { onFix(pp); res(state.pos); }, () => res(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });
  }

  async function computeRoute(from, reroute) {
    if (state.ctrl) state.ctrl.abort();
    const ctrl = state.ctrl = new AbortController();
    try {
      const r = await R.fetchRoute(from, [state.dest.lat, state.dest.lng], ctrl.signal);
      state.route = r; state.spoken = {}; state.off = 0;
      drawRoute();
      if (reroute) return;
      $('sheet').hidden = false; document.body.classList.add('has-route');
      $('sDest').textContent = state.dest.name;
      paintSummary(r.duration, r.distance);
      setNavUI(false);
      map.fitBounds(layers.line.getBounds(), { paddingTopLeft: [24, 90], paddingBottomRight: [24, 230] });
    } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  }

  async function setDestination(p) {
    stopNav(); state.dest = p;
    let from = state.pos || await getFix();
    if (!from) {
      const c = map.getCenter(); from = [c.lat, c.lng];
      toast('Sin GPS: se usa el centro del mapa como origen.');
    }
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
    const r = state.route;
    paintTurn(r.steps[Math.min(1, r.steps.length - 1)], r.steps[Math.min(1, r.steps.length - 1)].start);
    Voice.say(r.steps[0].text);
    map.setZoom(17);
  }

  function startWatch() {
    if (state.watchId !== null || !navigator.geolocation) return;
    state.watchId = navigator.geolocation.watchPosition(onFix,
      e => toast(e.code === 1 ? 'Permiso de ubicación denegado.' : 'No se pudo obtener la ubicación.'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  }
  function stopWatch() {
    if (state.watchId !== null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
  }
  function stopNav() {
    clearInterval(state.demo); state.demo = null;
    stopWatch();
    if (Voice.ok) speechSynthesis.cancel();
    setNavUI(false);
  }

  // Sin rastreo en segundo plano: al ocultar la app se apaga el GPS.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopWatch();
    else if (state.nav && !state.demo) startWatch();
  });

  function onFix(pp) {
    const c = pp.coords, p = [c.latitude, c.longitude], t = pp.timestamp || Date.now();
    if (state.pos && c.accuracy > 100) return;                       // descarta lecturas muy imprecisas

    let v = c.speed;                                                 // m/s; si el dispositivo no la da, se calcula
    if ((v === null || isNaN(v)) && state.last) {
      const dt = (t - state.last.t) / 1000;
      if (dt > 0.5) v = R.haversine(state.last.p, p) / dt;
    }
    v = (v === null || isNaN(v)) ? 0 : v;
    state.speed = state.speed * 0.4 + v * 0.6;                       // suavizado

    if (c.heading !== null && !isNaN(c.heading) && v > 1) state.heading = c.heading;
    else if (state.last && R.haversine(state.last.p, p) > 5) state.heading = R.bearing(state.last.p, p);

    state.last = { p, t }; state.pos = p;
    $('speedVal').textContent = Math.round(state.speed * 3.6);
    moveCar();
    if (state.nav && state.route) navigate(p, c.accuracy);
  }

  const CAR_SVG = '<div class="car-rot"><svg viewBox="0 0 24 24"><path d="M12 2 20 21 12 17 4 21Z" ' +
    'style="fill:var(--accent);stroke:#14202b;stroke-width:1.5;stroke-linejoin:round"/></svg></div>';

  function moveCar() {
    if (!car) {
      car = L.marker(state.pos, {
        icon: L.divIcon({ className: 'car', html: CAR_SVG, iconSize: [40, 40], iconAnchor: [20, 20] }),
        interactive: false, keyboard: false, zIndexOffset: 1000
      }).addTo(map);
    }
    car.setLatLng(state.pos);
    const el = car.getElement() && car.getElement().firstChild;
    if (el) el.style.transform = `rotate(${state.heading}deg)`;
    if (state.nav && state.follow) map.panTo(state.pos, { animate: true, duration: 0.8 });
  }

  function navigate(p, accuracy) {
    const pr = R.progress(state.route, p);
    if (pr.remaining < 25) return finish();

    // Desviación: 3 lecturas seguidas fuera de la ruta → recalcular
    if (pr.off > Math.max(40, (accuracy || 0) * 1.5)) { if (++state.off >= 3) reroute(p); }
    else state.off = 0;

    paintSummary(pr.eta, pr.remaining);
    paintTurn(state.route.steps[pr.next], pr.toNext);
    announce(pr);
  }

  function reroute(p) {
    const now = Date.now();
    if (now - state.lastReroute < 10000) return;
    state.lastReroute = now; state.off = 0;
    Voice.say('Recalculando ruta'); toast('Recalculando ruta…');
    computeRoute(p, true);
  }

  // Avisos de voz a 400 m, 150 m y 30 m de cada maniobra
  const TIERS = [400, 150, 30];
  function announce(pr) {
    const step = state.route.steps[pr.next], sp = state.spoken[pr.next] || (state.spoken[pr.next] = {});
    let t = -1;
    TIERS.forEach((m, i) => { if (pr.toNext <= m) t = i; });
    if (t < 0 || sp[t]) return;
    for (let i = 0; i <= t; i++) sp[i] = 1;                          // no repetir avisos más lejanos
    if (step.type === 'arrive') return Voice.say(t === 2 ? step.text : `Tu destino está a ${TIERS[t]} metros`);
    Voice.say(t === 2 ? step.text : `En ${TIERS[t]} metros, ${step.text[0].toLowerCase() + step.text.slice(1)}`);
  }

  function finish() {
    Voice.say('Has llegado a tu destino'); toast('Has llegado a tu destino');
    stopNav(); clearRoute();
  }

  /* Modo demo: recorre la ruta a ~50 km/h sin GPS (para probar en escritorio) */
  function startDemo() {
    Voice.unlock(); startNav();
    let d = 0;
    state.demo = setInterval(() => {
      d += 14;
      const { pos, heading } = R.pointAt(state.route, d);
      onFix({ coords: { latitude: pos[0], longitude: pos[1], speed: 14, heading, accuracy: 5 }, timestamp: Date.now() });
    }, 1000);
  }

  /* ---------- Botones ---------- */
  $('btnGo').onclick = () => { Voice.unlock(); startNav(); startWatch(); };
  $('btnDemo').onclick = startDemo;
  $('btnCancel').onclick = () => { stopNav(); clearRoute(); };
  $('btnLocate').onclick = async () => {
    state.follow = true;
    if (state.watchId === null) await getFix();                      // una sola lectura, sin vigilancia continua
    if (state.pos) map.setView(state.pos, Math.max(map.getZoom(), 16));
    else toast('No se pudo obtener tu ubicación. Activa el GPS y concede el permiso.');
  };
})();
