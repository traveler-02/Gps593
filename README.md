# GPS Lite Ecuador

Navegación paso a paso ligera: sin anuncios, sin analíticas y sin rastreo en segundo plano.
HTML + CSS + JavaScript vanilla, con Leaflet, OSRM y Nominatim.

## Probar en GitHub Pages
1. Sube `index.html`, `style.css`, `app.js` y `routing.js` a la raíz del repositorio.
2. Settings > Pages > Source: **Deploy from a branch** > rama `main`, carpeta `/ (root)` > Save.
3. Abre `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/` (tarda 1–2 minutos la primera vez).

Pages usa HTTPS, así que el navegador permite la geolocalización.
Sin GPS puedes buscar un destino y pulsar **Demo** para simular el recorrido.

## Límites
OSRM, Nominatim y las teselas de CARTO son servicios públicos de demostración.
Para producción, usa servidores propios o con licencia.

## API key de CARTO (obligatoria para las teselas)
1. Pídela gratis en https://carto.com/basemaps/apikey (llega por correo, hasta 5 millones de teselas/mes).
2. Pégala en `app.js`, en la constante `CARTO_KEY`.
3. En https://dashboard.basemaps.carto.com restringe la key a tu dominio (`TU-USUARIO.github.io`), porque en un sitio estático la key queda visible.
