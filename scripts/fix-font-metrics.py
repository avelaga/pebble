"""Rebalance Nimbus Sans L's vertical metrics for the editor's /fonts files.

As shipped, the font puts all its spare vertical room below the baseline
(ascent 729 = cap height, descent 271), so text sits 2-5px high in every
button, tag and field. CSS ascent-override would fix that in Chrome and
Firefox but Safari ignores it, so the metrics are changed in the files.
865/135 leaves equal room above the capitals and below the baseline.

Usage (needs: pip install fonttools brotli):
  python3 scripts/fix-font-metrics.py <dir with original NimbusSanL-*.woff2> editor/public/fonts
"""
import sys
from fontTools.ttLib import TTFont

src, dst = sys.argv[1], sys.argv[2]
ASCENT, DESCENT = 865, 135

for name in ["Reg", "RegIta", "Bol", "BolIta"]:
    f = TTFont(f"{src}/NimbusSanL-{name}.woff2")
    h, o = f["hhea"], f["OS/2"]
    h.ascent, h.descent, h.lineGap = ASCENT, -DESCENT, 0  # macOS, iOS, Safari
    o.sTypoAscender, o.sTypoDescender, o.sTypoLineGap = ASCENT, -DESCENT, 0
    o.version = max(o.version, 4)
    o.fsSelection |= 1 << 7  # USE_TYPO_METRICS, so Windows uses the same numbers
    f.flavor = "woff2"
    f.save(f"{dst}/NimbusSanL-{name}.woff2")
    print(f"patched NimbusSanL-{name}.woff2")
