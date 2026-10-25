# Builds media/icons.woff from Material Symbols Rounded for the icons in package.json; usage: python3 scripts/icons.py <MaterialSymbolsRounded[...].ttf> (needs fonttools).
import json
import sys

from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SCALE = 1.25

icons = json.load(open('package.json'))['contributes']['icons'].values()
codes = [int(i['default']['fontCharacter'].lstrip('\\'), 16) for i in icons]

font = instantiateVariableFont(TTFont(sys.argv[1]), {'FILL': 1, 'wght': 500, 'GRAD': 0, 'opsz': 20})
options = Options()
options.layout_features = []
options.hinting = False
subsetter = Subsetter(options)
subsetter.populate(unicodes=codes)
subsetter.subset(font)

# Material draws inside a padded 24-unit grid, so at text size its glyphs look smaller than codicons; enlarge about the grid centre.
glyf, hmtx = font['glyf'], font['hmtx']
c = font['head'].unitsPerEm / 2
for name in font.getGlyphOrder():
    if glyf[name].numberOfContours <= 0:
        continue
    pen = TTGlyphPen(None)
    glyf[name].draw(TransformPen(pen, (SCALE, 0, 0, SCALE, c * (1 - SCALE), c * (1 - SCALE))), glyf)
    glyf[name] = pen.glyph()
    glyf[name].recalcBounds(glyf)
    hmtx[name] = (hmtx[name][0], glyf[name].xMin)

font.flavor = 'woff'
font.save('media/icons.woff')
