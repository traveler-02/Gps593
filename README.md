# GPS 593

Navegación paso a paso ligera para Ecuador: sin anuncios, sin analíticas y sin rastreo en segundo plano.
HTML + CSS + JavaScript, Leaflet, OSRM y Nominatim. Las librerías van en `lib/` (no dependen de internet).

## Publicar en GitHub Pages
Sube TODO el contenido de esta carpeta a la raíz del repositorio (incluidas `lib/`, `icons/`, `tools/` y `.github/`).
Settings > Pages > Deploy from a branch > `main` / `(root)`. La key de CARTO se edita solo en `config.js`.

## Sin internet (tres piezas)
1. **La app**: tras la primera visita con internet queda guardada en el dispositivo (`sw.js`).
2. **Mapa y rutas en el pendrive**: en el repo, Actions > "Crear mapa y rutas de Ecuador" > Run workflow
   (primero con `dry_run` activado para ver el tamaño; luego desactivado). Los archivos `ecuador.pmtiles` y
   `ecuador.g593` quedan en Releases (https://github.com/USUARIO/REPO/releases/tag/mapas); cópialos al pendrive.
   En la app: ☰ > "Cargar mapa y rutas sin conexión" y elige los dos archivos a la vez.
   Con el navegador hay que volver a elegirlos cada vez que se abre la app.
3. **Con los dos archivos cargados** funcionan sin internet: mapa, búsqueda de calles, poblaciones y
   gasolineras/hospitales/farmacias/policía, cálculo de rutas y recálculo al desviarse, voz, velocidad y ETA.
   Con internet se usa OSRM/Nominatim; si fallan o no hay señal, la app cambia sola a los datos locales.

Para crear el flujo: en el repo, Add file > Create new file > `.github/workflows/crear-mapa.yml` y pega su contenido.

## Límites actuales del ruteo local
Sin restricciones de giro (giros prohibidos), sin tráfico ni peajes, rotondas tratadas como giros normales,
y sin vías tipo `track` (caminos rurales sin asfaltar). OSM puede tener huecos en vías rurales.

## Versión Android (APK)
1. En el repo: Actions > "Compilar APK Android" > Run workflow (compila en un servidor de GitHub; no necesitas Android Studio).
2. Descarga `gps593-debug.apk` de https://github.com/USUARIO/REPO/releases/tag/android e instálalo
   (permite instalar apps de origen desconocido).
3. Pon `ecuador.pmtiles` y `ecuador.g593` en el pendrive (en cualquier carpeta) y conéctalo a la radio.
4. Al abrir GPS 593 busca y carga solos esos archivos. Si conectas el pendrive después: ☰ > "Buscar mapa y rutas en el pendrive".
   La primera vez Android pide permiso de almacenamiento: acéptalo.
5. ☰ > "Diagnóstico" muestra la versión del WebView de la radio (con menos de 80 el mapa puede fallar).
