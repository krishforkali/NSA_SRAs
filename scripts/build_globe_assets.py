"""Pack the website's map overlays into web/data/globe_layers.js for globe.html.

MapLibre loads image overlays with fetch(), which browsers block for pages opened straight
from disk (file://). Data URLs inside a .js file avoid that. Overlays are re-encoded as WebP
(radar: lossy; water and flood classes: lossless, so the hatch pattern stays sharp).

Usage:  python -P scripts/build_globe_assets.py web/data
Run automatically at the end of flood_map.py --web.
"""
import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

PHASES = ("before", "peak", "after")
RADAR_MAX_PX = 2000


def data_url(path, lossless, max_px=None):
    im = Image.open(path).convert("RGBA")
    if max_px and max(im.size) > max_px:
        s = max_px / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    buf = io.BytesIO()
    if lossless:
        im.save(buf, "WEBP", lossless=True, quality=100, method=6)
    else:
        im.save(buf, "WEBP", quality=72, alpha_quality=60, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii"), buf.tell()


def build(web):
    web = Path(web)
    meta = json.loads((web / "data.json").read_text(encoding="utf-8"))["meta"]
    layers, sizes = {}, {}
    for p in PHASES:
        layers[f"radar_{p}"], sizes[f"radar_{p}"] = data_url(web / f"backscatter_{p}.png", False, RADAR_MAX_PX)
        layers[f"water_{p}"], sizes[f"water_{p}"] = data_url(web / f"water_{p}.png", True)
    layers["classes"], sizes["classes"] = data_url(web / "flood_classes.png", True)
    if (web / "flood_classes_careful.png").exists():
        layers["classes_careful"], sizes["classes_careful"] = data_url(web / "flood_classes_careful.png", True)
    out = {"generated_utc": meta["generated_utc"], "bounds": meta["bounds"], "layers": layers}
    (web / "globe_layers.js").write_text("window.GLOBE_LAYERS = " + json.dumps(out, separators=(",", ":")) + ";",
                                         encoding="utf-8")
    total = sum(sizes.values())
    print(f"  globe_layers.js: {len(layers)} layers, {total / 1e6:.1f} MB of WebP", flush=True)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "web/data")
