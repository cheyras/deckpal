"""Step 3: turn the trimmed renders into the WebP files the app serves.

    python tools/set-logo-templates/build/ship.py [setId,setId,...]

renders/<template>/<setId>.png -> apps/web/public/set-logos/<setId>.webp

Each render is fitted inside SHIP_BOX (870 x 396: the set-page header's 290 x 132 CSS box at 3x, which
also covers the series row's 112 x 64 slot at 3x) without ever being upscaled, then written as WebP with
lossy colour at SHIP_QUALITY and lossless alpha. The app maps set ids to these files in
apps/web/src/lib/releasedSetAssets.ts (TEMPLATE_SET_LOGOS); a test there fails if a CSV row has no
shipped file or a shipped file has no row.
"""
import sys, os, glob
from PIL import Image

from config import RENDERS, SHIP_DIR, SHIP_BOX, SHIP_QUALITY, ORDER, sets_by_template


def ship_one(src, dest):
    im = Image.open(src).convert('RGBA')
    s = min(SHIP_BOX[0] / im.width, SHIP_BOX[1] / im.height, 1.0)
    if s < 1.0:
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    im.save(dest, 'WEBP', quality=SHIP_QUALITY, alpha_quality=100, method=6)
    return im.size, os.path.getsize(dest)


def main(only=None):
    os.makedirs(SHIP_DIR, exist_ok=True)
    total, n = 0, 0
    for template in ORDER:
        for sid, name, status in sets_by_template()[template]:
            if only and sid not in only:
                continue
            src = os.path.join(RENDERS, template, f'{sid}.png')
            if not os.path.exists(src):
                raise SystemExit(f'no render for {sid} at {src}: run render.py first')
            size, nbytes = ship_one(src, os.path.join(SHIP_DIR, f'{sid}.webp'))
            total += nbytes
            n += 1
            print(f'{template:14s} {sid:12s} {size[0]:4d}x{size[1]:<4d} {nbytes / 1024:6.1f} KiB')
    print(f'shipped {n} logos, {total / 1024:.0f} KiB -> {os.path.relpath(SHIP_DIR)}')
    known = {sid for sets in sets_by_template().values() for sid, _, _ in sets}
    stray = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(SHIP_DIR, '*.webp'))
                   if os.path.basename(p)[:-5] not in known)
    if stray:
        print('WARNING: shipped files with no row in config.py:', ', '.join(stray))


if __name__ == '__main__':
    main(set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None)
