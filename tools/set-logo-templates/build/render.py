"""Step 2: build the four PhotoCraft templates (.pcraft), write their data-set CSVs, and render every set.

    python tools/set-logo-templates/build/render.py [promo-stack,energy-row,...]

Each template is built with the headless `photocraft-cli run` in two passes:
  1. draw the layers (pixel slots placed from prepared sources, shapes, type, layer styles);
  2. group them, define the Variables (Image > Variables > Define), import the CSV of data sets
     (File > Import > Variable Data Sets), apply the example data set and save templates/<name>.pcraft.
Then File > Export > Data Sets as Files renders every row into renders/<template>/<setId>.png, trimmed
to its ink with a 6 px margin (the app's logo slots are object-contain, so a trimmed logo fills them).

PATHS IN THE CSVs ARE RELATIVE TO templates/. PhotoCraft stores a data set's pixel path as written and
resolves a relative one against the folder of the document it is applied to -- not the CSV's folder,
not the working directory (checked with the CLI, 2026-11-27). Written relative to templates/, the
committed .pcraft files work from any checkout. Pass 1 is saved in .work/, which sits beside templates/
at the same depth, so the same relative paths resolve there too while pass 2 runs.
"""
import sys, os, json, csv, subprocess, shutil
from PIL import Image

from config import TEMPLATES, PROMO, ENERGY, SUBSET, PRODUCT, RIBBONS, ORDER, TOOL, PREPARED, RENDERS, WORK, PHOTOCRAFT

TEMPLATE_DIR = os.path.join(TOOL, 'templates')
DATA_DIR = os.path.join(TOOL, 'data')
LABEL_FONT = {'font': 'Bahnschrift', 'variations': {'wght': 700, 'wdth': 75}, 'fauxItalic': True}


def run(args):
    r = subprocess.run([PHOTOCRAFT] + args, capture_output=True, text=True, encoding='utf-8')
    lines = [json.loads(l) for l in r.stdout.splitlines() if l.startswith('{')]
    if r.returncode:
        raise RuntimeError(f'photocraft-cli failed ({r.returncode}):\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}')
    return lines


def prep(template, slot, key):
    """Absolute path of a prepared source (for placing it while building pass 1)."""
    return os.path.join(PREPARED, template, slot, f'{key}.png')


def rel(template, slot, key):
    """The same file as a data-set cell: relative to templates/, forward slashes."""
    return os.path.relpath(prep(template, slot, key), TEMPLATE_DIR).replace(os.sep, '/')


def box_center(template, slot):
    x, y, w, h = TEMPLATES[template]['slots'][slot]['box']
    return [x + w / 2, y + h / 2]


class Builder:
    """Collects pass-1 steps; each step that creates a layer is tagged with the name we give it."""

    def __init__(self, template):
        self.t = template
        self.steps = []   # (tag or None, command, params)

    def cmd(self, command, params=None, tag=None):
        self.steps.append((tag, command, params or {}))

    def pixel(self, slot, key, name, styles=()):
        self.cmd('file.placeEmbedded', {'path': prep(self.t, slot, key), 'smartObject': False, 'fit': False,
                                        'scale': 100, 'center': box_center(self.t, slot)}, tag=name)
        self.cmd('layer.setProps', {'name': name})
        # A vector mask inset 2 px from the slot box hides the four bounds-keeper pixels, so layer
        # styles (stroke, shadow) never draw around them; the layer's pixel bounds stay the full box.
        x, y, w, h = TEMPLATES[self.t]['slots'][slot]['box']
        i = 2
        self.cmd('layer.vectorMask.add', {'path': {'subpaths': [{'closed': True, 'knots': [[x + i, y + i], [x + w - i, y + i], [x + w - i, y + h - i], [x + i, y + h - i]]}]}})
        for c, p in styles:
            self.cmd(c, p)

    def shape(self, name, params, styles=()):
        p = dict(params)
        p['name'] = name
        self.cmd('shape.create', p, tag=name)
        for c, sp in styles:
            self.cmd(c, sp)

    def text(self, name, params, styles=()):
        p = dict(LABEL_FONT)
        p.update(params)
        p['name'] = name
        self.cmd('type.create', p, tag=name)
        for c, sp in styles:
            self.cmd(c, sp)

    def group(self, name):
        self.cmd('layer.new.group', {'name': name}, tag=name)

    def build(self, out):
        args = ['run', '--new', json.dumps({'width': TEMPLATES[self.t]['canvas'][0], 'height': TEMPLATES[self.t]['canvas'][1],
                                            'background': 'transparent', 'name': self.t, 'resolution': 72})]
        for tag, c, p in self.steps:
            args += ['--cmd', c, '--params', json.dumps(p)]
        args += ['--out', out]
        res = run(args)
        ids = {}
        for (tag, c, p), r in zip(self.steps, res):
            if tag:
                ids[tag] = r['result']['layer']
        return ids


# Layer-style shorthands
def shadow(opacity=50, distance=6, size=12, angle=90):
    return ('layer.layerStyle.dropShadow', {'color': '#000000', 'opacity': opacity, 'distance': distance, 'size': size,
                                            'angle': angle, 'useGlobalLight': False, 'blend': 'multiply', 'add': True})


def stroke(color, size=6, position='outside', opacity=100):
    return ('layer.layerStyle.stroke', {'size': size, 'position': position, 'color': color, 'opacity': opacity, 'add': True})


def grad(*stops, angle=90):
    return {'gradient': {'stops': [[t, c] for t, c in stops], 'angle': angle, 'style': 'linear'}}


def para(x0, y0, x1, y1, skew):
    """A parallelogram ribbon: top edge shifted right by `skew` (the TCG banners lean forward)."""
    return {'kind': 'path', 'path': {'subpaths': [{'closed': True, 'knots': [[x0 + skew, y0], [x1, y0], [x1 - skew, y1], [x0, y1]]}]}}


RIBBON_STYLE = {
    #          fill stops (top -> bottom)                         outline     text
    'gold':   ([(0, '#fff0b8'), (0.45, '#e2b23e'), (1, '#f7d977')], '#1b1408', '#1b1408'),
    'silver': ([(0, '#ffffff'), (0.5, '#aab2bb'), (1, '#eef1f4')], '#12161a', '#12161a'),
    'red':    ([(0, '#ff6a5c'), (0.5, '#b8141c'), (1, '#e2382f')], '#250406', '#ffe08a'),
    'ink':    ([(0, '#4a505a'), (0.5, '#15171b'), (1, '#2d323a')], '#e9e9ea', '#ffffff'),
    'yellow': ([(0, '#fff7a0'), (0.5, '#f4c400'), (1, '#ffe24d')], '#221a00', '#221a00'),
}


def define(ids, defs):
    out = []
    for name, layer_tag, kind in defs:
        d = {'name': name, 'layer': ids[layer_tag], 'type': kind}
        if kind == 'pixelReplacement':
            d.update({'method': 'fit', 'align': 'center', 'clip': False})
        out.append(d)
    return {'defs': out}


def finish(template, ids, groups, defs, rows, example):
    """Pass 2: grouping, variables, CSV import, example data set, save; then render every data set."""
    tmp = os.path.join(WORK, f'{template}.pass1.pcraft')
    final = os.path.join(TEMPLATE_DIR, f'{template}.pcraft')
    csv_path = os.path.join(DATA_DIR, f'{template}.csv')
    header = ['DataSet'] + [d[0] for d in defs]
    with open(csv_path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh, lineterminator='\n')
        w.writerow(header)
        for r in rows:
            w.writerow([r['DataSet']] + [r[h] for h in header[1:]])
    args = ['run', tmp]
    for gname, members in groups:
        args += ['--cmd', 'layer.moveTo', '--params', json.dumps({'layers': [ids[m] for m in members], 'target': ids[gname], 'position': 'into'})]
    args += ['--cmd', 'layer.delete', '--params', json.dumps({'layer': 2})]          # the empty "Layer 1" of a new document
    args += ['--cmd', 'image.variables.define', '--params', json.dumps(define(ids, defs))]
    args += ['--cmd', 'file.import.variableDataSets', '--params', json.dumps({'path': csv_path})]
    args += ['--cmd', 'image.applyDataSet', '--params', json.dumps({'name': example})]
    args += ['--out', final]
    res = run(args)
    imported = [r for r in res if r.get('command') == 'file.import.variableDataSets'][0]['result']['imported']
    # Render: export every data set, then trim each to its ink.
    raw = os.path.join(WORK, 'raw', template)
    shutil.rmtree(raw, ignore_errors=True)
    os.makedirs(raw)
    run(['run', final, '--cmd', 'file.export.dataSetsAsFiles', '--params', json.dumps({'dir': raw, 'format': 'png', 'naming': '{name}'})])
    names = {r['DataSet'].replace('.', '_'): r['DataSet'] for r in rows}
    out_dir = os.path.join(RENDERS, template)
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    for f in sorted(os.listdir(raw)):
        im = Image.open(os.path.join(raw, f)).convert('RGBA')
        a = im.getchannel('A').point(lambda v: 0 if v <= 2 else v)        # drop the 1/255 bounds keepers
        im.putalpha(a)
        bb = a.point(lambda v: 255 if v > 0 else 0).getbbox()
        m = 6
        im = im.crop((max(0, bb[0] - m), max(0, bb[1] - m), min(im.width, bb[2] + m), min(im.height, bb[3] + m)))
        # PhotoCraft writes '.' in a data-set name as '_' (swsh12.5gg -> swsh12_5gg): restore the set id.
        name = names.get(f[:-4], f[:-4])
        im.save(os.path.join(out_dir, name + '.png'))
    print(template, 'data sets', imported, 'renders', len(os.listdir(out_dir)))


# ---------------------------------------------------------------------------------------------
def promo_stack():
    t = 'promo-stack'
    b = Builder(t)
    b.pixel('promoMark', 'black-star-promo', 'Black Star Promo mark', [stroke('#ffffff', 10), shadow(45, 8, 16)])
    b.pixel('wordmark', 'me', 'Series wordmark', [shadow(55, 6, 12)])
    # Text mode (series with no wordmark of their own): a leaning black banner with the series name.
    b.group('Series name (text mode)')
    b.shape('Series banner', dict(para(190, 92, 930, 232, 30), fill=grad((0, '#3b3b3b'), (1, '#050505'))),
            [stroke('#ffffff', 7), shadow(50, 6, 12)])
    b.text('Series name', {'x': 560, 'y': 205, 'text': 'MISCELLANEOUS', 'size': 124, 'color': '#ffffff', 'align': 'center', 'tracking': 20})
    ids = b.build(os.path.join(WORK, f'{t}.pass1.pcraft'))
    defs = [('wordmark', 'Series wordmark', 'pixelReplacement'), ('showWordmark', 'Series wordmark', 'visibility'),
            ('seriesText', 'Series name', 'textReplacement'), ('showSeriesText', 'Series name (text mode)', 'visibility'),
            ('promoMark', 'Black Star Promo mark', 'pixelReplacement')]
    rows = []
    for sid, name, series, text, status in PROMO:
        rows.append({'DataSet': sid, 'wordmark': rel(t, 'wordmark', series or '_blank'), 'showWordmark': 'true' if series else 'false',
                     'seriesText': text or 'BLACK STAR', 'showSeriesText': 'false' if series else 'true',
                     'promoMark': rel(t, 'promoMark', 'black-star-promo')})
    finish(t, ids, [('Series name (text mode)', ['Series banner', 'Series name'])], defs, rows, 'mep')


def energy_row():
    t = 'energy-row'
    b = Builder(t)
    b.shape('Tray', {'kind': 'roundedRect', 'rect': [26, 226, 1068, 226], 'radii': 113,
                     'fill': grad((0, '#3d3935'), (0.5, '#191614'), (1, '#0b0a09'))},
            [stroke('#e7e5e4', 6, 'outside', 90), shadow(50, 8, 16)])
    b.pixel('energyRow', 'mee', 'Energy row', [shadow(40, 4, 8)])
    b.pixel('wordmark', 'me', 'Series wordmark', [shadow(55, 6, 12)])
    ids = b.build(os.path.join(WORK, f'{t}.pass1.pcraft'))
    defs = [('wordmark', 'Series wordmark', 'pixelReplacement'), ('energyRow', 'Energy row', 'pixelReplacement'),
            ('showTray', 'Tray', 'visibility')]
    rows = [{'DataSet': sid, 'wordmark': rel(t, 'wordmark', series), 'energyRow': rel(t, 'energyRow', sid), 'showTray': 'true'}
            for sid, name, series, types, status in ENERGY]
    finish(t, ids, [], defs, rows, 'mee')


def subset_tag():
    t = 'subset-tag'
    b = Builder(t)
    b.pixel('parentLogo', 'swsh12tg', 'Parent set logo', [shadow(45, 5, 10)])
    groups = []
    for rb in RIBBONS:
        stops, outline, ink = RIBBON_STYLE[rb]
        g = f'Ribbon · {rb}'
        b.group(g)
        b.shape(f'Ribbon shape · {rb}', dict(para(110, 430, 1010, 584, 30), fill=grad(*stops)), [stroke(outline, 8), shadow(45, 6, 12)])
        b.text(f'Ribbon label · {rb}', {'x': 560, 'y': 548, 'text': 'TRAINER GALLERY', 'size': 112, 'color': ink, 'align': 'center', 'tracking': 10})
        groups.append((g, [f'Ribbon shape · {rb}', f'Ribbon label · {rb}']))
    ids = b.build(os.path.join(WORK, f'{t}.pass1.pcraft'))
    defs = [('parentLogo', 'Parent set logo', 'pixelReplacement')]
    for rb in RIBBONS:
        defs += [(f'show_{rb}', f'Ribbon · {rb}', 'visibility'), (f'label_{rb}', f'Ribbon label · {rb}', 'textReplacement')]
    rows = []
    for sid, name, cands, label, ribbon, status in SUBSET:
        r = {'DataSet': sid, 'parentLogo': rel(t, 'parentLogo', sid)}
        for rb in RIBBONS:
            r[f'show_{rb}'] = 'true' if rb == ribbon else 'false'
            r[f'label_{rb}'] = label          # every ribbon carries the label, so any can be switched on by hand
        rows.append(r)
    finish(t, ids, groups, defs, rows, 'swsh12tg')


def product_plate():
    t = 'product-plate'
    b = Builder(t)
    b.shape('Plate', {'kind': 'roundedRect', 'rect': [40, 196, 1040, 392], 'radii': 64,
                      'fill': grad((0, '#3a3531'), (0.55, '#1a1715'), (1, '#0d0b0a'))},
            [stroke('#e7e5e4', 6, 'outside', 90), shadow(50, 8, 16)])
    b.pixel('mascot', '380', 'Mascot (Pokémon artwork)', [shadow(45, 6, 14)])
    b.group('Text · beside mascot')
    b.text('Line 1 · beside mascot', {'x': 96, 'y': 330, 'text': 'TRAINER KIT', 'size': 86, 'color': '#e7e5e4', 'align': 'left', 'tracking': 20})
    b.text('Line 2 · beside mascot', {'x': 92, 'y': 498, 'text': 'LATIAS', 'size': 124, 'color': '#ffcf4a', 'align': 'left'})
    b.group('Text · centred')
    b.text('Line 1 · centred', {'x': 560, 'y': 330, 'text': "McDONALD'S COLLECTION", 'size': 86, 'color': '#e7e5e4', 'align': 'center', 'tracking': 20})
    b.text('Line 2 · centred', {'x': 560, 'y': 506, 'text': '2024', 'size': 150, 'color': '#ffcf4a', 'align': 'center'})
    b.pixel('eraWordmark', 'xy', 'Era wordmark', [shadow(55, 6, 12)])
    b.group('Era name (text mode)')
    b.shape('Era banner', dict(para(330, 48, 790, 176, 26), fill=grad((0, '#3b3b3b'), (1, '#050505'))), [stroke('#ffffff', 6), shadow(50, 6, 12)])
    b.text('Era name', {'x': 560, 'y': 146, 'text': 'EX SERIES', 'size': 92, 'color': '#ffffff', 'align': 'center', 'tracking': 20})
    ids = b.build(os.path.join(WORK, f'{t}.pass1.pcraft'))
    groups = [('Text · beside mascot', ['Line 1 · beside mascot', 'Line 2 · beside mascot']),
              ('Text · centred', ['Line 1 · centred', 'Line 2 · centred']),
              ('Era name (text mode)', ['Era banner', 'Era name'])]
    defs = [('eraWordmark', 'Era wordmark', 'pixelReplacement'), ('showEraWordmark', 'Era wordmark', 'visibility'),
            ('eraText', 'Era name', 'textReplacement'), ('showEraText', 'Era name (text mode)', 'visibility'),
            ('mascot', 'Mascot (Pokémon artwork)', 'pixelReplacement'), ('showMascot', 'Mascot (Pokémon artwork)', 'visibility'),
            ('line1_beside', 'Line 1 · beside mascot', 'textReplacement'), ('line2_beside', 'Line 2 · beside mascot', 'textReplacement'),
            ('showTextBeside', 'Text · beside mascot', 'visibility'),
            ('line1_centred', 'Line 1 · centred', 'textReplacement'), ('line2_centred', 'Line 2 · centred', 'textReplacement'),
            ('showTextCentred', 'Text · centred', 'visibility')]
    rows = []
    for sid, name, era, l1, l2, dex, status in PRODUCT:
        text_era = isinstance(era, tuple)
        m = dex is not None
        rows.append({'DataSet': sid,
                     'eraWordmark': rel(t, 'eraWordmark', '_blank' if text_era else era), 'showEraWordmark': 'false' if text_era else 'true',
                     'eraText': era[1] if text_era else 'EX SERIES', 'showEraText': 'true' if text_era else 'false',
                     'mascot': rel(t, 'mascot', str(dex) if m else '_blank'), 'showMascot': 'true' if m else 'false',
                     'line1_beside': l1, 'line2_beside': l2, 'showTextBeside': 'true' if m else 'false',
                     'line1_centred': l1, 'line2_centred': l2, 'showTextCentred': 'false' if m else 'true'})
    finish(t, ids, groups, defs, rows, 'tk-xy-p')


BUILDERS = {'promo-stack': promo_stack, 'energy-row': energy_row, 'subset-tag': subset_tag, 'product-plate': product_plate}


def main(only=None):
    for d in (WORK, TEMPLATE_DIR, DATA_DIR, RENDERS):
        os.makedirs(d, exist_ok=True)
    for name in ORDER:
        if only is None or name in only:
            BUILDERS[name]()


if __name__ == '__main__':
    main(sys.argv[1].split(',') if len(sys.argv) > 1 else None)
