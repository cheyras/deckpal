"""Optional: a contact sheet of every render on the app's logo-slot gradient, for review.

    python tools/set-logo-templates/build/contact_sheet.py   -> .work/contact-sheet.png

Uses Segoe UI from C:/Windows/Fonts for the captions (falls back to PIL's default font elsewhere).
"""
import os
from PIL import Image, ImageDraw, ImageFont

from config import RENDERS, WORK, TEMPLATES, ORDER, sets_by_template

TEXT = (231, 229, 228)
MUTED = (148, 141, 135)
PAGE = (28, 25, 23)


def font(name, size):
    try:
        return ImageFont.truetype('C:/Windows/Fonts/' + name, size)
    except OSError:
        return ImageFont.load_default()


def slot_gradient(w, h):
    """linear-gradient(135deg, surface-quaternary, surface-tertiary), as SeriesDetail's logo panel."""
    g = Image.new('L', (w, h))
    px = g.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = int(255 * (x + y) / max(1, (w + h - 2)))
    a = Image.new('RGB', (w, h), (87, 83, 77))
    b = Image.new('RGB', (w, h), (68, 64, 59))
    return Image.composite(b, a, g).convert('RGBA')


def contain(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def main():
    cols, tw, th = 6, 380, 250
    sets = sets_by_template()
    blocks = [(t, sets[t], (len(sets[t]) + cols - 1) // cols) for t in ORDER]
    H = 80 + sum(70 + r * th for _, _, r in blocks) + 20
    sheet = Image.new('RGBA', (cols * tw + 40, H), PAGE + (255,))
    d = ImageDraw.Draw(sheet)
    d.text((20, 24), 'DeckPal set-logo templates: every render on the logo-slot gradient', fill=TEXT, font=font('segoeuib.ttf', 30))
    y = 80
    for t, rows_, nrows in blocks:
        d.text((20, y + 18), f'{t}.pcraft  -  {TEMPLATES[t]["title"]}  ({len(rows_)} sets)', fill=TEXT, font=font('segoeuib.ttf', 24))
        y += 70
        for i, (sid, name, status) in enumerate(rows_):
            x0, y0 = 20 + (i % cols) * tw, y + (i // cols) * th
            tile = slot_gradient(tw - 12, th - 12)
            p = os.path.join(RENDERS, t, f'{sid}.png')
            if os.path.exists(p):
                im = contain(Image.open(p).convert('RGBA'), tw - 52, th - 82)
                tile.alpha_composite(im, ((tile.width - im.width) // 2, 14 + (th - 82 - im.height) // 2))
            td = ImageDraw.Draw(tile)
            td.text((12, th - 62), sid, fill=TEXT, font=font('segoeuib.ttf', 17))
            td.text((12, th - 40), name[:40], fill=MUTED, font=font('segoeui.ttf', 15))
            sheet.alpha_composite(tile, (x0, y0))
        y += nrows * th
    os.makedirs(WORK, exist_ok=True)
    out = os.path.join(WORK, 'contact-sheet.png')
    sheet.convert('RGB').save(out)
    print('contact sheet ->', os.path.relpath(out))


if __name__ == '__main__':
    main()
