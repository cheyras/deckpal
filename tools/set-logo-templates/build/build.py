"""Run the whole set-logo pipeline: prepare sources, build + render the templates, ship the WebPs.

    python tools/set-logo-templates/build/build.py                 # everything
    python tools/set-logo-templates/build/build.py product-plate   # one template (comma-separate several)
    python tools/set-logo-templates/build/build.py --repin         # accept re-sourced tier bytes

Needs Python 3.10+ with Pillow, PhotoCraft's photocraft-cli, and the Bahnschrift font (ships with
Windows 10/11). vectorcraft-cli is needed only to redraw an energy row. See ../README.md.
"""
import sys

import prepare_sources
import render
import ship
import contact_sheet
from config import sets_by_template


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    only = args[0].split(',') if args else None
    prepare_sources.main()
    render.main(only)
    ids = None if only is None else {sid for t in only for sid, _, _ in sets_by_template()[t]}
    ship.main(ids)
    contact_sheet.main()


if __name__ == '__main__':
    main()
