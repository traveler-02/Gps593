#!/usr/bin/env python3
"""Ajusta el proyecto Android generado por Capacitor: plugin del pendrive, permisos, versión de SDK e íconos."""
import re, shutil, pathlib
from PIL import Image

A = pathlib.Path('android'); main = A / 'app' / 'src' / 'main'

# 1) Código Java: actividad con el plugin UsbFiles
dst = main / 'java' / 'ec' / 'gps593' / 'app'; dst.mkdir(parents=True, exist_ok=True)
for f in ('MainActivity.java', 'UsbFilesPlugin.java'): shutil.copy(f'android-extra/{f}', dst / f)

# 2) Permisos y almacenamiento clásico (para leer el pendrive sin selector de archivos)
mf = main / 'AndroidManifest.xml'; s = mf.read_text(encoding='utf-8')
perms = ''.join(f'    <uses-permission android:name="android.permission.{p}" />\n'
                for p in ('ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_EXTERNAL_STORAGE', 'WAKE_LOCK'))
assert '</manifest>' in s and '<application' in s
s = s.replace('</manifest>', perms + '</manifest>').replace('<application', '<application android:requestLegacyExternalStorage="true"', 1)
mf.write_text(s, encoding='utf-8')

# 3) targetSdk 29: en Android 10 o menor (radios) mantiene el acceso clásico a /storage/XXXX
vg = A / 'variables.gradle'; v = vg.read_text(encoding='utf-8')
v2 = re.sub(r'targetSdkVersion\s*=\s*\d+', 'targetSdkVersion = 29', v); assert v2 != v
vg.write_text(v2, encoding='utf-8')

# 4) Íconos y pantalla de inicio con el logo de GPS 593
logo = Image.open('icons/logo.png').convert('RGBA')
def fit(canvas, frac, bg=(0, 0, 0, 0)):
    c = Image.new('RGBA', canvas, bg); k = frac * min(canvas) / max(logo.size)
    r = logo.resize((max(1, int(logo.width * k)), max(1, int(logo.height * k))), Image.LANCZOS)
    c.paste(r, ((canvas[0] - r.width) // 2, (canvas[1] - r.height) // 2), r); return c
res = main / 'res'; n = 0
for d in res.glob('mipmap-*dpi'):
    for name, frac, bg in (('ic_launcher.png', .9, (255, 255, 255, 255)), ('ic_launcher_round.png', .78, (255, 255, 255, 255)),
                           ('ic_launcher_foreground.png', .56, (0, 0, 0, 0))):
        p = d / name
        if p.exists(): fit(Image.open(p).size, frac, bg).save(p); n += 1
for p in res.glob('drawable*/splash.png'):
    fit(Image.open(p).size, .3, (255, 255, 255, 255)).convert('RGB').save(p); n += 1
print('íconos/pantallas actualizados:', n)
