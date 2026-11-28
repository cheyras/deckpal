"""Step 1: gather and prepare every source image the logo templates use.

    python tools/set-logo-templates/build/prepare_sources.py [--repin]

THE POKEMON COMPANY'S IMAGES ARE FETCHED, NEVER COMMITTED. Set logos and official artwork come from the
app's own image tier, the one place they are fetched from, and land in gitignored caches under sources/.
What IS committed is sources/tier-sources.json: for every file, the tier URL, the upstream URL the tier
filled it from, and the SHA-256 of the exact bytes the tier served when the templates were approved.
Every fetch is checked against it, so a rebuild either reproduces the approved inputs or stops and says
which file changed (re-run with --repin to accept the new bytes, then review the renders). This is the
2026-07-24 rule ("Sprites are fetched, never committed") applied to this tool; see ../README.md.

- set logos:        {TIER}/sets/<setId>/logo.webp      -> sources/logos/<setId>.png (trimmed to its ink)
- Pokemon artwork:  {TIER}/sprites/art/<id>.png        -> sources/sprites/<id>.png  (trimmed)
- Black Star mark:  {TIER}/sets/svp/logo.webp, upscaled 4x with its edges re-hardened
                                                        -> sources/marks/black-star-promo.png
- energy rows:      committed (DeckPal's own drawing): sources/energy-rows/<setId>.png. To redraw one,
                    put the E2 energy glyph SVGs in sources/energy-glyphs/ (README, "Energy rows").

Then every pixel-slot source is 'prepared' into sources/prepared/ (gitignored): fitted into its slot's
exact box and given four near-invisible corner pixels, so PhotoCraft's Pixel Replacement keeps the
full box (README, "PhotoCraft quirks"). The data-set CSVs point at these prepared files.
"""
import os, re, sys, json, hashlib, subprocess, urllib.request
from PIL import Image, ImageFilter

from config import (TEMPLATES, SERIES_WORDMARK, ENERGY, SUBSET, PRODUCT, SOURCES, PREPARED, WORK,
                    VECTORCRAFT, TIER, REPO)

UA = {'User-Agent': 'deckpal-set-logo-templates'}
DL = os.path.join(WORK, 'downloads')
MANIFEST_PATH = os.path.join(SOURCES, 'tier-sources.json')
REPIN = '--repin' in sys.argv


def _get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def _sprites_sha():
    src = open(os.path.join(REPO, 'packages', 'storage', 'src', 'paths.ts'), encoding='utf-8').read()
    return re.search(r"SPRITES_SHA = '([0-9a-f]{40})'", src).group(1)


class Manifest:
    """sources/tier-sources.json: {kind: {key: {tier, upstream, sha256, bytes}}}."""

    def __init__(self):
        self.data = json.load(open(MANIFEST_PATH, encoding='utf-8')) if os.path.exists(MANIFEST_PATH) else {}
        self.dirty = False

    def fetch(self, kind, key, tier_url, upstream):
        """The tier's bytes for this source, checked against (or pinned into) the manifest."""
        dest = os.path.join(DL, f'{kind}_{key}.bin')
        pinned = self.data.get(kind, {}).get(key)
        if os.path.exists(dest):
            data = open(dest, 'rb').read()
        else:
            print(f'  fetching {tier_url}')
            data = _get(tier_url)
            os.makedirs(DL, exist_ok=True)
            open(dest, 'wb').write(data)
        sha = hashlib.sha256(data).hexdigest()
        if pinned and pinned['sha256'] == sha:
            return dest
        if pinned and not REPIN:
            os.remove(dest)
            raise SystemExit(
                f'{tier_url} no longer serves the pinned bytes ({pinned["sha256"][:12]} -> {sha[:12]}).\n'
                f'The image tier re-sourced this file. Re-run with --repin to accept it, then compare the renders\n'
                f'(contact_sheet.py) before shipping.')
        entry = {'tier': tier_url, 'upstream': upstream() if callable(upstream) else upstream,
                 'sha256': sha, 'bytes': len(data)}
        self.data.setdefault(kind, {})[key] = entry
        self.dirty = True
        print(f'  pinned {kind}/{key} {sha[:12]} (commit sources/tier-sources.json)')
        return dest

    def save(self):
        if self.dirty:
            ordered = {k: dict(sorted(v.items())) for k, v in sorted(self.data.items())}
            with open(MANIFEST_PATH, 'w', encoding='utf-8', newline='\n') as fh:
                json.dump(ordered, fh, indent=1, ensure_ascii=False)
                fh.write('\n')


MANIFEST = Manifest()


def trimmed(path):
    im = Image.open(path).convert('RGBA')
    bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop(bb) if bb else im


def _logo_upstream(set_id):
    """The upstream URL the API reports the set's logo is filled from (null when it reports none)."""
    return lambda: json.loads(_get(f'https://deckpal.app/api/sets/{set_id}'))['set']['images']['logoUrl']


def logo_raw(set_id):
    return MANIFEST.fetch('logos', set_id, f'{TIER}/sets/{set_id}/logo.webp', _logo_upstream(set_id))


def logo(set_id):
    out = os.path.join(SOURCES, 'logos', f'{set_id}.png')
    if not os.path.exists(out):
        raw = logo_raw(set_id)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        trimmed(raw).save(out)
    return out


def best_logo(candidates):
    """Highest-resolution file among candidates (a subset's own tier file is often its parent's art at 2x)."""
    files = []
    for c in candidates:
        try:
            files.append(logo(c))
        except SystemExit:
            raise
        except Exception as e:  # a 404 just drops that candidate
            print('  no logo for', c, e)
    if not files:
        raise RuntimeError(f'no logo for any of {candidates}')
    return max(files, key=lambda p: Image.open(p).size[0] * Image.open(p).size[1])


def sprite(dex):
    out = os.path.join(SOURCES, 'sprites', f'{dex}.png')
    if not os.path.exists(out):
        upstream = f'https://raw.githubusercontent.com/PokeAPI/sprites/{_sprites_sha()}/sprites/pokemon/other/official-artwork/{dex}.png'
        raw = MANIFEST.fetch('sprites', str(dex), f'{TIER}/sprites/art/{dex}.png', upstream)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        trimmed(raw).save(out)
    return out


def black_star():
    """The Black Star PROMO mark. The tier's file (svp's logo) is 200x181, so it is upscaled 4x and its
    edges re-hardened to stay crisp at the template's 420x380 slot."""
    out = os.path.join(SOURCES, 'marks', 'black-star-promo.png')
    if os.path.exists(out):
        return out
    im = trimmed(logo_raw('svp'))
    up = im.resize((im.width * 4, im.height * 4), Image.LANCZOS)
    hard = lambda v: max(0, min(255, int((v - 128) * 2.2 + 128)))
    r, g, b, a = up.split()
    lum = Image.merge('RGB', (r, g, b)).convert('L').point(hard)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    Image.merge('RGBA', (lum, lum, lum, a.point(hard))).save(out)
    return out


def mix(hex_, other, t):
    c = [int(hex_[i:i + 2], 16) for i in (1, 3, 5)]
    o = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    return '#%02x%02x%02x' % tuple(round(a + (b - a) * t) for a, b in zip(c, o))


def energy_row(set_id, types, box_w, box_h):
    """A row of energy 'coins': disc with a soft radial light, a dark rim, the glyph. The committed PNG is
    used as is; delete it and supply sources/energy-glyphs/<type>.svg to redraw (needs vectorcraft-cli)."""
    out = os.path.join(SOURCES, 'energy-rows', f'{set_id}.png')
    if os.path.exists(out):
        return out
    n = len(types)
    gap = 10
    D = min(box_h - 20, (box_w - 20 - gap * (n - 1)) / n)
    total = n * D + (n - 1) * gap
    x0 = (box_w - total) / 2
    cy = box_h / 2
    defs, body = [], []
    for i, t in enumerate(types):
        svg = open(os.path.join(SOURCES, 'energy-glyphs', f'{t}.svg'), encoding='utf-8').read()
        col = re.search(r'<circle[^>]*fill="(#[0-9a-fA-F]{6})"', svg).group(1)
        glyph = re.search(r'<g id="glyph"[^>]*>(.*?)</g>', svg, re.S).group(1)
        cx = x0 + i * (D + gap) + D / 2
        defs.append(f'<radialGradient id="g{i}" cx="0.38" cy="0.30" r="0.78">'
                    f'<stop offset="0" stop-color="{mix(col, "#ffffff", 0.42)}"/>'
                    f'<stop offset="0.55" stop-color="{col}"/>'
                    f'<stop offset="1" stop-color="{mix(col, "#000000", 0.30)}"/></radialGradient>')
        k = D / 24
        body.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{D / 2:.2f}" fill="url(#g{i})"/>'
                    f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{D / 2 - 1.6:.2f}" fill="none" stroke="#000000" stroke-opacity="0.45" stroke-width="3.2"/>'
                    f'<g transform="translate({cx - D / 2:.2f} {cy - D / 2:.2f}) scale({k:.5f})" fill="#000000" fill-rule="evenodd">{glyph}</g>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{box_w}" height="{box_h}" viewBox="0 0 {box_w} {box_h}">'
           f'<defs>{"".join(defs)}</defs>{"".join(body)}</svg>')
    os.makedirs(WORK, exist_ok=True)
    src = os.path.join(WORK, f'energy_row_{set_id}.svg')
    open(src, 'w', encoding='utf-8').write(svg)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    r = subprocess.run([VECTORCRAFT, 'convert', src, out], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return out


def prepare(src, template, slot, key, upscale_ok=True):
    """Fit src into the slot's box (keeping aspect), aligned per the slot, plus bounds-keeper corners."""
    box = TEMPLATES[template]['slots'][slot]
    _, _, bw, bh = box['box']
    canvas = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    if src is not None:
        im = Image.open(src).convert('RGBA')
        s = min(bw / im.width, bh / im.height)
        if not upscale_ok:
            s = min(s, 1.0)
        w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
        fitted = im.resize((w, h), Image.LANCZOS)
        if s > 1.3:
            fitted = fitted.filter(ImageFilter.UnsharpMask(radius=2, percent=55, threshold=2))
        x = (bw - w) // 2
        y = bh - h if box['align'] == 'bottom' else (bh - h) // 2
        canvas.alpha_composite(fitted, (x, y))
    px = canvas.load()
    for (x, y) in ((0, 0), (bw - 1, 0), (0, bh - 1), (bw - 1, bh - 1)):
        if px[x, y][3] < 1:
            px[x, y] = (0, 0, 0, 1)      # 1/255 alpha: invisible, but it holds the layer bounds at the full box
    d = os.path.join(PREPARED, template, slot)
    os.makedirs(d, exist_ok=True)
    out = os.path.join(d, f'{key}.png')
    canvas.save(out)
    return out


def main():
    chosen = {}
    try:
        star = black_star()
        for t, slot in (('promo-stack', 'wordmark'), ('energy-row', 'wordmark'), ('product-plate', 'eraWordmark'),
                        ('product-plate', 'mascot')):
            prepare(None, t, slot, '_blank')
        for key, sid in SERIES_WORDMARK.items():
            f = logo(sid)
            prepare(f, 'promo-stack', 'wordmark', key)
            prepare(f, 'energy-row', 'wordmark', key)
            prepare(f, 'product-plate', 'eraWordmark', key)
        prepare(star, 'promo-stack', 'promoMark', 'black-star-promo')
        for sid, name, series, types, status in ENERGY:
            row = energy_row(sid, types, *TEMPLATES['energy-row']['slots']['energyRow']['box'][2:])
            prepare(row, 'energy-row', 'energyRow', sid, upscale_ok=False)
        for sid, name, cands, label, ribbon, status in SUBSET:
            f = best_logo(cands)
            chosen[sid] = os.path.basename(f)
            prepare(f, 'subset-tag', 'parentLogo', sid)
        for sid, name, era, l1, l2, dex, status in PRODUCT:
            if dex is not None:
                prepare(sprite(dex), 'product-plate', 'mascot', str(dex))
    finally:
        MANIFEST.save()
    os.makedirs(WORK, exist_ok=True)
    json.dump(chosen, open(os.path.join(WORK, 'subset_parent_logos.json'), 'w'), indent=1)
    print('sources prepared ->', os.path.relpath(PREPARED))


if __name__ == '__main__':
    main()
