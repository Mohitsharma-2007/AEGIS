"""Rasterise tray icons: tray/png/<character>/<variant>/<state>-<size>.png and tray/ico/<character>/<variant>/<state>.ico (16/24/32/48/256).
   pip install resvg-py pillow ; run after `npm run build`."""
import io, os, glob, resvg_py
from PIL import Image
import shutil
root = os.path.join(os.path.dirname(__file__), '..', 'tray'); n = 0
for d in ('png', 'ico'): shutil.rmtree(os.path.join(root, d), ignore_errors=True)
for svg in sorted(glob.glob(os.path.join(root, 'svg', '*', '*', '*.svg'))):
    theme, state = os.path.join(*svg.split(os.sep)[-3:-1]), os.path.basename(svg)[:-4]
    big = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_path=svg, width=256, height=256)))).convert('RGBA')
    for d in ('png', 'ico'): os.makedirs(os.path.join(root, d, theme), exist_ok=True)
    for s in (16, 24, 32, 48):
        im = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_path=svg, width=s, height=s)))).convert('RGBA'); im.save(os.path.join(root, 'png', theme, f'{state}-{s}.png')); n += 1
    big.save(os.path.join(root, 'ico', theme, f'{state}.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (256, 256)]); n += 1
print('tray files', n)
