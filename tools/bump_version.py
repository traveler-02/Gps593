#!/usr/bin/env python3
"""Sube la versión de GPS593 mini en TODOS los sitios a la vez.
Uso: python tools/bump_version.py 1.0.1 "Qué cambió en esta versión"
Actualiza: version.js, sw.js (nombre de la caché), index.html (?v= de los archivos), package.json y CAMBIOS.md."""
import re, sys, json, datetime, pathlib
ver, nota = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'Mejoras y correcciones')
assert re.fullmatch(r'\d+\.\d+\.\d+', ver), 'La versión debe verse como 1.2.3'
hoy = datetime.date.today().isoformat()
def edit(path, fn):
    p = pathlib.Path(path); p.write_text(fn(p.read_text(encoding='utf-8')), encoding='utf-8')
edit('version.js', lambda s: re.sub(r"version: '[\d.]+', date: '[\d-]+'", f"version: '{ver}', date: '{hoy}'", s))
edit('sw.js', lambda s: re.sub(r"const CACHE = '[^']*'", f"const CACHE = 'gps593-mini-{ver}'", s))
edit('index.html', lambda s: re.sub(r'\?v=[\w.]+', f'?v={ver}', s))
pj = json.load(open('package.json', encoding='utf-8')); pj['version'] = ver; json.dump(pj, open('package.json', 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
log = pathlib.Path('CAMBIOS.md'); old = log.read_text(encoding='utf-8') if log.exists() else '# Historial de versiones de GPS593 mini\n'
head, _, rest = old.partition('\n'); log.write_text(head + f'\n\n## {ver} · {hoy}\n{nota}\n' + rest, encoding='utf-8')
print('GPS593 mini ->', ver)
