"""Crop NISAR L2 GCOV scenes to Sivasagar / Jorhat / Charaideo and map flood water.

Method (L-band, HH by default):
  1. Read the backscatter layer (e.g. HHHH = |HH|^2, linear gamma0) only inside the
     districts' bounding box, straight from the HDF5 file (no full-frame load).
  2. Put all dates on one common grid (the pre-flood crop), Lee speckle filter, convert to dB.
  3. Open water = dB below one threshold, picked with Otsu's method on the pooled
     histogram of all dates (or set with --threshold).
  4. Change detection against the pre-flood date:
        1 permanent water      water before AND at peak
        2 flooded, receded     new water at peak (dropped >= --drop dB), dry again after
        3 flooded, persisting  new water at peak, still water after
        4 possible flooded vegetation  HH rose >= --rise dB at peak (L-band double bounce
                                        off trunks/stems standing in water). Indicative only.
  5. Remove speckle-sized blobs, clip to district outlines, report km^2 per district.

Usage:
  python -P scripts/flood_map.py --pre PRE.h5 --peak PEAK.h5 --post POST.h5 \
      --districts boundaries/upper_assam_districts.geojson --out D:/sar-dance/output
"""
import argparse
import csv
import re
import warnings
from pathlib import Path

import geopandas as gpd
import h5py
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage
from shapely.ops import unary_union
from skimage.filters import threshold_otsu

CLASS_NAMES = {1: "permanent water", 2: "flooded (receded by post)",
               3: "flooded (still wet at post)", 4: "possible flooded vegetation"}
NODATA_CLASS = 255
# Validated (dataviz palette, all-pairs, light+dark). Class 4 is a texture (hatch), not a hue,
# because no 4th solid hue clears the all-pairs floors on a map.
CLASS_COLORS = {1: "#2a78d6", 2: "#1baf7a", 3: "#eb6834"}
CLASS_KEYS = {1: "permanent", 2: "flooded_receded", 3: "flooded_persisting",
              4: "flooded_vegetation"}
WEB_MAX_PX = 2000   # longest side of the web PNG overlays


# ----------------------------------------------------------------------------- reading
def find_freq_group(f: h5py.File, pol_layer: str):
    """Return the HDF5 group that holds the requested covariance layer."""
    preferred = "science/LSAR/GCOV/grids/frequencyA"
    if preferred in f and pol_layer in f[preferred]:
        return f[preferred]
    hits = []
    f.visititems(lambda n, o: hits.append(n.rsplit("/", 1)[0])
                 if isinstance(o, h5py.Dataset) and n.endswith("/" + pol_layer) else None)
    if not hits:
        raise KeyError(f"{pol_layer} not found in {f.filename}")
    return f[sorted(hits)[0]]


def read_epsg(grp):
    ds = grp.get("projection")
    if ds is None:
        raise KeyError("no 'projection' dataset next to the backscatter layer")
    for key in ("epsg_code", "epsg"):
        if key in ds.attrs:
            return int(np.ravel(ds.attrs[key])[0])
    return int(np.ravel(ds[()])[0])


def scene_date(path):
    m = re.search(r"_(\d{8})T\d{6}_", Path(path).name)
    return m.group(1) if m else Path(path).stem


def read_crop(path, pol_layer, aoi_ll, pad_m=2000, ml=1):
    """Read the pol layer inside the AOI bbox, averaging ml x ml blocks (multilook) strip by
    strip so a full-resolution crop never sits in memory. Returns (array, transform, crs)."""
    with h5py.File(path, "r") as f:
        grp = find_freq_group(f, pol_layer)
        epsg = read_epsg(grp)
        x = grp["xCoordinates"][:]
        y = grp["yCoordinates"][:]
        aoi = gpd.GeoSeries([aoi_ll], crs=4326).to_crs(epsg)
        minx, miny, maxx, maxy = aoi.total_bounds
        minx, miny, maxx, maxy = minx - pad_m, miny - pad_m, maxx + pad_m, maxy + pad_m
        cols = np.where((x >= minx) & (x <= maxx))[0]
        rows = np.where((y >= miny) & (y <= maxy))[0]
        if cols.size == 0 or rows.size == 0:
            raise ValueError(f"{Path(path).name} does not overlap the districts")
        c0, c1, r0, r1 = cols.min(), cols.max() + 1, rows.min(), rows.max() + 1
        c1 = c0 + (c1 - c0) // ml * ml
        r1 = r0 + (r1 - r0) // ml * ml
        nr, nc = (r1 - r0) // ml, (c1 - c0) // ml
        data = np.empty((nr, nc), "float32")
        ds = grp[pol_layer]
        strip = max(ml, (2048 // ml) * ml)
        for s in range(r0, r1, strip):
            e = min(s + strip, r1)
            blk = ds[s:e, c0:c1].astype("float32")
            blk[~np.isfinite(blk) | (blk <= 0)] = np.nan
            blk = blk.reshape((e - s) // ml, ml, nc, ml)
            with warnings.catch_warnings():          # all-NaN blocks -> NaN, quietly
                warnings.simplefilter("ignore", RuntimeWarning)
                data[(s - r0) // ml:(e - r0) // ml] = np.nanmean(blk, axis=(1, 3))
        dx, dy = float(x[1] - x[0]), float(y[1] - y[0])   # dy is negative (north-up)
        transform = from_origin(x[c0] - dx / 2, y[r0] - dy / 2, dx * ml, abs(dy) * ml)
    data[~np.isfinite(data) | (data <= 0)] = np.nan
    covered = np.isfinite(data).mean() * 100
    print(f"  {Path(path).name}: {pol_layer} crop {data.shape}, EPSG:{epsg}, "
          f"{covered:.0f}% valid pixels in crop", flush=True)
    return data, transform, rasterio.crs.CRS.from_epsg(epsg)


def to_grid(arr, src_tr, src_crs, ref_shape, ref_tr, ref_crs):
    if src_tr == ref_tr and src_crs == ref_crs and arr.shape == ref_shape:
        return arr
    out = np.full(ref_shape, np.nan, "float32")
    reproject(arr, out, src_transform=src_tr, src_crs=src_crs, dst_transform=ref_tr,
              dst_crs=ref_crs, resampling=Resampling.bilinear,
              src_nodata=np.nan, dst_nodata=np.nan)
    return out


# --------------------------------------------------------------------------- processing
def lee_filter(img, size=5, enl=8.0):
    """Lee speckle filter in the linear domain, NaN-aware (normalised convolution).
    float32 throughout to keep memory down on large crops."""
    valid = np.isfinite(img)
    z = np.where(valid, img, 0).astype("float32")
    w = ndimage.uniform_filter(valid.astype("float32"), size)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = ndimage.uniform_filter(z, size) / w
        var = ndimage.uniform_filter(z * z, size) / w
        var -= mean * mean
        np.maximum(var, 0, out=var)
        cu2 = np.float32(1.0 / enl)
        k = np.maximum((var - mean * mean * cu2) / (1 + cu2), 0)
        k = np.where(var > 0, k / var, 0).astype("float32")
        del var, w
        out = mean + k * (z - mean)
    out[~valid] = np.nan
    return out


def to_db(lin):
    with np.errstate(divide="ignore", invalid="ignore"):
        return (10 * np.log10(lin)).astype("float32")


def pick_threshold(db_list, inside):
    pooled = np.concatenate([d[inside & np.isfinite(d)] for d in db_list])
    pooled = pooled[(pooled > -40) & (pooled < 5)]
    rng = np.random.default_rng(0)
    if pooled.size > 2_000_000:
        pooled = rng.choice(pooled, 2_000_000, replace=False)
    t = float(threshold_otsu(pooled))
    if not -26 <= t <= -12:
        print(f"  WARNING: Otsu threshold {t:.1f} dB is outside the usual L-band open-water "
              f"range (-26..-12 dB); check the histogram and consider --threshold", flush=True)
    return t


def clean(mask, min_px):
    mask = ndimage.binary_opening(mask, structure=np.ones((3, 3)))
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return mask
    sizes = np.bincount(lab.ravel())
    keep = sizes >= min_px
    keep[0] = False
    return keep[lab]


# ------------------------------------------------------------------------------ outputs
def write_tif(path, arr, tr, crs, nodata, dtype):
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1],
                       count=1, dtype=dtype, crs=crs, transform=tr, nodata=nodata,
                       compress="deflate", tiled=True) as dst:
        dst.write(arr.astype(dtype), 1)


def save_figure(path, dbs, dates, classes, districts_proj, tr, threshold):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap

    h, w = classes.shape
    ext = (tr.c, tr.c + w * tr.a, tr.f + h * tr.e, tr.f)
    fig, axes = plt.subplots(1, 4, figsize=(22, 6), constrained_layout=True)
    for ax, d, lab in zip(axes[:3], dbs, ("Before", "Peak", "After")):
        im = ax.imshow(d, cmap="gray", vmin=-28, vmax=0, extent=ext)
        ax.set_title(f"{lab} {dates[lab]}  HH (dB)")
    fig.colorbar(im, ax=axes[:3], shrink=0.7, label="gamma0 HH (dB)")
    cmap = ListedColormap(["#f2f2f2"] + [CLASS_COLORS[c] for c in (1, 2, 3)] + ["#55534e"])
    shown = np.where(classes == NODATA_CLASS, np.nan, classes).astype(float)
    axes[3].imshow(shown, cmap=cmap, vmin=-0.5, vmax=4.5, extent=ext, interpolation="nearest")
    axes[3].set_title(f"Flood classes (water < {threshold:.1f} dB)")
    from matplotlib.patches import Patch
    axes[3].legend(handles=[Patch(color=cmap(i), label=n) for i, n in CLASS_NAMES.items()],
                   loc="lower left", fontsize=8)
    for ax in axes:
        districts_proj.boundary.plot(ax=ax, color="yellow", linewidth=0.8)
        ax.set_xticks([]); ax.set_yticks([])
    fig.savefig(path, dpi=150)
    plt.close(fig)


# ------------------------------------------------------------------------- web export
# Fixed file names - the website (D:/sar-dance/web) reads exactly these:
#   site_data.js                window.FLOOD_DATA = {meta, stats, districts, rivers}
#   data.json                   same content as plain JSON
#   backscatter_{before,peak,after}.png   HH dB, grey, Web-Mercator, transparent nodata
#   water_{before,peak,after}.png         open water per date (blue)
#   flood_classes.png                     the four change classes
WEB_PHASES = {"Before": "before", "Peak": "peak", "After": "after"}


def _hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


GRID_MAX_PX = 720          # longest side of the "Be the scientist" dB grids
GRID_DB0, GRID_DB1 = -30.0, 5.0   # uint8 code 1..255 spans this; 0 = no data


def export_grids(web, db, inside, valid, ref_tr, ref_crs, merc, dtr, dw, dh, warp):
    """Small quantised dB grids (Web Mercator, same bounds as the PNGs) for the in-browser
    threshold slider. Written as a .js file so the page also works from file://."""
    import base64
    import json
    scale = max(dw, dh) / GRID_MAX_PX
    gw, gh = int(np.ceil(dw / scale)), int(np.ceil(dh / scale))
    gtr = rasterio.Affine(dtr.a * dw / gw, 0, dtr.c, 0, dtr.e * dh / gh, dtr.f)
    step = (GRID_DB1 - GRID_DB0) / 254
    out = {"w": gw, "h": gh, "db0": GRID_DB0, "step": step, "phases": {}}
    for k, ph in WEB_PHASES.items():
        arr = np.where(valid, db[k], np.nan).astype("float32")
        g = np.full((gh, gw), np.nan, "float32")
        reproject(arr, g, src_transform=ref_tr, src_crs=ref_crs, dst_transform=gtr, dst_crs=merc,
                  resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
        code = np.where(np.isfinite(g), np.clip(np.round((g - GRID_DB0) / step) + 1, 1, 255), 0)
        out["phases"][ph] = base64.b64encode(code.astype("uint8").tobytes()).decode("ascii")
    # true ground area of one grid cell per row (Mercator stretches with 1/cos(lat))
    y = gtr.f + (np.arange(gh) + 0.5) * gtr.e
    lat = np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - np.pi / 2)
    cell = abs(gtr.a) * np.cos(np.radians(lat))
    out["row_km2"] = [round(float(c * c / 1e6), 6) for c in cell]
    (web / "db_grids.js").write_text("window.FLOOD_GRIDS = " + json.dumps(out, separators=(",", ":")) + ";" + chr(10),
                                     encoding="utf-8")
    print(f"  slider grids {gw}x{gh} written", flush=True)


def export_web(web, a, paths, dates, db, water, classes, valid, inside, ref_tr, ref_crs,
               sel, rows, river_stats, rivers_ll, thr, px_km2, cons=None, rows_c=None,
               river_stats_c=None, water_c=None, classes_c=None):
    import datetime as dt
    import json
    from PIL import Image
    from pyproj import Transformer
    from rasterio.warp import calculate_default_transform

    web.mkdir(parents=True, exist_ok=True)
    h, w = classes.shape
    left, top = ref_tr.c, ref_tr.f
    right, bottom = left + w * ref_tr.a, top + h * ref_tr.e
    merc = rasterio.crs.CRS.from_epsg(3857)
    dtr, dw, dh = calculate_default_transform(ref_crs, merc, w, h, left, bottom, right, top)
    scale = max(dw, dh) / WEB_MAX_PX
    if scale > 1:   # downsample for the web
        dw, dh = int(np.ceil(dw / scale)), int(np.ceil(dh / scale))
        dtr = rasterio.Affine(dtr.a * scale, 0, dtr.c, 0, dtr.e * scale, dtr.f)

    def warp(arr, resampling, fill):
        out = np.full((dh, dw), fill, arr.dtype)
        reproject(arr, out, src_transform=ref_tr, src_crs=ref_crs, dst_transform=dtr,
                  dst_crs=merc, resampling=resampling, src_nodata=fill, dst_nodata=fill)
        return out

    inside_m = warp(inside.astype("uint8"), Resampling.nearest, np.uint8(0)).astype(bool)

    def save_rgba(name, rgba):
        Image.fromarray(rgba, "RGBA").save(web / name, optimize=True)

    # backscatter (grey stretch -25..0 dB); outside the districts dimmed
    for k, ph in WEB_PHASES.items():
        d = warp(np.where(np.isfinite(db[k]), db[k], np.nan).astype("float32"),
                 Resampling.average, np.float32(np.nan))
        g = np.clip((d + 25) / 25 * 255, 0, 255)
        rgba = np.zeros((dh, dw, 4), "uint8")
        rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = np.nan_to_num(g).astype("uint8")
        rgba[..., 3] = np.where(np.isfinite(d), np.where(inside_m, 255, 90), 0)
        save_rgba(f"backscatter_{ph}.png", rgba)

        wm = warp(np.where(valid, water[k], 0).astype("uint8"), Resampling.nearest, np.uint8(0))
        rgba = np.zeros((dh, dw, 4), "uint8")
        rgba[wm == 1] = (*_hex_rgb(CLASS_COLORS[1]), 210)
        save_rgba(f"water_{ph}.png", rgba)

    yy, xx = np.mgrid[0:dh, 0:dw]
    stripe = ((xx + yy) % 6) < 2                      # 45-degree hatch for class 4

    def class_png(cls, name):
        c = warp(cls, Resampling.nearest, np.uint8(NODATA_CLASS))
        rgba = np.zeros((dh, dw, 4), "uint8")
        for k in (1, 2, 3):
            rgba[c == k] = (*_hex_rgb(CLASS_COLORS[k]), 230)
        rgba[(c == 4) & stripe] = (31, 31, 30, 235)
        rgba[(c == 4) & ~stripe] = (255, 255, 255, 90)
        save_rgba(name, rgba)
        return c

    c_main = class_png(classes, "flood_classes.png")
    c_care = class_png(classes_c, "flood_classes_careful.png") if classes_c is not None else None

    # per-pixel status for the click popup, on the same grid as the PNGs.
    # R: bit0 valid, bits1-3 water before/peak/after (main), bits4-6 same (careful)
    # G: main class 0-4, B: careful class 0-4.  Shipped as a PNG data URL inside a .js file so
    # the browser can read the pixels even when the page is opened from file://.
    import base64
    import io
    st = np.zeros((dh, dw, 3), "uint8")
    st[..., 0] = warp(valid.astype("uint8"), Resampling.nearest, np.uint8(0))
    for i, k in enumerate(WEB_PHASES):
        st[..., 0] |= warp((water[k] & valid).astype("uint8"), Resampling.nearest, np.uint8(0)) << (1 + i)
        if water_c is not None:
            st[..., 0] |= warp((water_c[k] & valid).astype("uint8"), Resampling.nearest, np.uint8(0)) << (4 + i)
    st[..., 1] = np.where(c_main == NODATA_CLASS, 0, c_main)
    if c_care is not None:
        st[..., 2] = np.where(c_care == NODATA_CLASS, 0, c_care)
    buf = io.BytesIO()
    Image.fromarray(st, "RGB").save(buf, "PNG", optimize=True)
    (web / "status_grid.js").write_text(
        "window.FLOOD_STATUS = " + json.dumps({"w": dw, "h": dh, "png": "data:image/png;base64," +
                                               base64.b64encode(buf.getvalue()).decode("ascii")}) + ";",
        encoding="utf-8")
    print(f"  status grid {dw}x{dh} written ({buf.tell() // 1024} KB)", flush=True)

    to_ll = Transformer.from_crs(3857, 4326, always_xy=True)
    x0, y1 = dtr.c, dtr.f
    x1, y0 = x0 + dw * dtr.a, y1 + dh * dtr.e
    (w_, s_), (e_, n_) = to_ll.transform(x0, y0), to_ll.transform(x1, y1)

    def phase_of(k):
        return WEB_PHASES[k]

    def stats_block(rows_):
        ds = [{"name": r["district"], "valid_km2": r["valid_km2"],
               "water_km2": {phase_of(k): r[f"water_{dates[k]}_km2"] for k in WEB_PHASES},
               "classes_km2": {CLASS_KEYS[c]: r[f"{CLASS_NAMES[c]}_km2"] for c in CLASS_NAMES}}
              for r in rows_]
        tot = {"name": "All three districts",
               "valid_km2": round(sum(x["valid_km2"] for x in ds), 1),
               "water_km2": {p: round(sum(x["water_km2"][p] for x in ds), 1) for p in WEB_PHASES.values()},
               "classes_km2": {k: round(sum(x["classes_km2"][k] for x in ds), 1) for k in CLASS_KEYS.values()}}
        return ds, tot

    stats_d, total = stats_block(rows)
    conservative = None
    if rows_c:
        cd, ct = stats_block(rows_c)
        conservative = {"districts": cd, "total": ct, "rivers": river_stats_c or []}

    export_grids(web, db, inside, valid, ref_tr, ref_crs, merc, dtr, dw, dh, warp)

    m = re.search(r"GCOV_\d+_(\d+)_([AD])_(\d+)_", Path(paths["Before"]).name)
    districts_ll = sel.to_crs(4326)[[a.name_field, "geometry"]].rename(
        columns={a.name_field: "name"})
    districts_ll["geometry"] = districts_ll.geometry.simplify(0.0008, preserve_topology=True)

    payload = {
        "meta": {
            "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "placeholder": bool(a.placeholder),
            "dates": {phase_of(k): f"{v[:4]}-{v[4:6]}-{v[6:]}" for k, v in dates.items()},
            "scenes": {phase_of(k): Path(p).name for k, p in paths.items()},
            "track": int(m.group(1)) if m else None,
            "direction": {"A": "ascending", "D": "descending"}.get(m.group(2)) if m else None,
            "frame": int(m.group(3)) if m else None,
            "polarization": a.pol[:2],
            "threshold_db": round(thr, 2),
            "conservative_threshold_db": round(cons, 2) if cons is not None else None,
            "change_drop_db": a.drop, "change_rise_db": a.rise,
            "pixel_m": round(abs(ref_tr.a), 1),
            "river_buffer_km": a.river_buffer_km,
            "bounds": [[s_, w_], [n_, e_]],
            "classes": [
                {"id": 1, "key": "permanent", "label": "Permanent water", "color": CLASS_COLORS[1]},
                {"id": 3, "key": "flooded_persisting", "label": "Flooded, still wet after",
                 "color": CLASS_COLORS[3]},
                {"id": 2, "key": "flooded_receded", "label": "Flooded, receded after",
                 "color": CLASS_COLORS[2]},
                {"id": 4, "key": "flooded_vegetation", "label": "Possible flooded vegetation",
                 "color": "hatch"},
            ],
        },
        "stats": {"districts": stats_d, "total": total, "rivers": river_stats,
                  "conservative": conservative},
        "districts": json.loads(districts_ll.to_json()),
        "rivers": json.loads(rivers_ll.to_json()) if rivers_ll is not None and len(rivers_ll)
                  else None,
    }
    text = json.dumps(payload, separators=(",", ":"))
    (web / "data.json").write_text(text, encoding="utf-8")
    (web / "site_data.js").write_text("window.FLOOD_DATA = " + text + ";\n", encoding="utf-8")
    print(f"Website data written to {web}", flush=True)


# --------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pre", required=True)
    ap.add_argument("--peak", required=True)
    ap.add_argument("--post", required=True)
    ap.add_argument("--districts", required=True, help="GeoJSON/shapefile of district polygons")
    ap.add_argument("--name-field", default="shapeName")
    ap.add_argument("--names", default="Sivasagar,Jorhat,Charaideo",
                    help="comma list; matched case-insensitively as substrings")
    ap.add_argument("--pol", default="HHHH", help="HHHH (default) or HVHV")
    ap.add_argument("--threshold", type=float, help="water threshold in dB (default: Otsu)")
    ap.add_argument("--conservative-threshold", type=float,
                    help="second, stricter threshold (e.g. -17); results saved alongside and "
                         "shown on the website as the low end of a range")
    ap.add_argument("--drop", type=float, default=3.0, help="min dB decrease for new flood")
    ap.add_argument("--rise", type=float, default=3.0, help="min dB increase for flooded veg")
    ap.add_argument("--min-area-px", type=int, default=12, help="drop blobs smaller than this")
    ap.add_argument("--enl", type=float, default=8.0, help="equivalent looks for Lee filter")
    ap.add_argument("--multilook", type=int, default=2,
                    help="average NxN input pixels while reading (2 -> 20 m from 10 m GCOV)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--web", help="website data folder (e.g. D:/sar-dance/web/data); "
                                  "fixed file names are (re)written there")
    ap.add_argument("--rivers", help="optional river lines (GeoJSON) with a 'name' field, "
                                     "for the river-corridor statistics")
    ap.add_argument("--river-buffer-km", type=float, default=2.0)
    ap.add_argument("--placeholder", action="store_true",
                    help="mark the web data as placeholder/test data (shows a banner)")
    a = ap.parse_args()

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

    gdf = gpd.read_file(a.districts).to_crs(4326)
    wanted = [n.strip().lower() for n in a.names.split(",")]
    sel = gdf[gdf[a.name_field].str.lower().apply(lambda s: any(w in s for w in wanted))]
    found = sorted(sel[a.name_field])
    print(f"Districts used: {found}", flush=True)
    missing = [w for w in wanted if not any(w in f.lower() for f in found)]
    if missing:
        print(f"  NOTE: not in boundary file: {missing} (Charaideo was split from Sivasagar "
              f"in 2015; older boundaries include it inside Sivasagar)", flush=True)
    if sel.empty:
        raise SystemExit("none of the requested districts found in the boundary file")
    aoi_ll = unary_union(sel.geometry)

    paths = {"Before": a.pre, "Peak": a.peak, "After": a.post}
    dates = {k: scene_date(p) for k, p in paths.items()}
    print("Reading crops ...", flush=True)
    raw = {k: read_crop(p, a.pol, aoi_ll, ml=a.multilook) for k, p in paths.items()}

    ref, ref_tr, ref_crs = raw["Before"]
    shape = ref.shape
    lin = {k: to_grid(arr, tr, crs, shape, ref_tr, ref_crs) for k, (arr, tr, crs) in raw.items()}

    sel_proj = sel.to_crs(ref_crs)
    inside = ~geometry_mask(sel_proj.geometry, out_shape=shape, transform=ref_tr)

    print("Speckle filtering ...", flush=True)
    db = {k: to_db(lee_filter(v, enl=a.enl)) for k, v in lin.items()}
    valid = inside & np.all([np.isfinite(d) for d in db.values()], axis=0)

    thr = a.threshold if a.threshold is not None else pick_threshold(list(db.values()), valid)
    print(f"Water threshold: {thr:.2f} dB ({'user' if a.threshold is not None else 'Otsu'})", flush=True)
    cons = a.conservative_threshold
    if cons is not None:
        print(f"Conservative threshold: {cons:.2f} dB", flush=True)

    diff = db["Peak"] - db["Before"]
    brightened = clean(valid & (diff >= a.rise), a.min_area_px)   # threshold-independent

    def classify(t):
        water = {k: clean(np.nan_to_num(d, nan=0) < t, a.min_area_px) & valid for k, d in db.items()}
        new_flood = clean(water["Peak"] & ~water["Before"] & (diff <= -a.drop), a.min_area_px)
        classes = np.zeros(shape, "uint8")
        classes[water["Before"] & water["Peak"]] = 1
        classes[new_flood & ~water["After"]] = 2
        classes[new_flood & water["After"]] = 3
        classes[brightened & ~water["Peak"] & (classes == 0)] = 4
        classes[~valid] = NODATA_CLASS
        return water, classes

    px_km2 = abs(ref_tr.a * ref_tr.e) / 1e6
    dmasks = [(d[a.name_field], ~geometry_mask([d.geometry], out_shape=shape, transform=ref_tr) & valid)
              for _, d in sel_proj.iterrows()]

    def district_rows(water, classes):
        rows = []
        for name, m in dmasks:
            rows.append({"district": name,
                         "valid_km2": round(m.sum() * px_km2, 1),
                         **{f"water_{dates[k]}_km2": round((water[k] & m).sum() * px_km2, 1) for k in water},
                         **{f"{CLASS_NAMES[c]}_km2": round(((classes == c) & m).sum() * px_km2, 1)
                            for c in CLASS_NAMES}})
        return rows

    def write_set(folder, water, classes, rows, t):
        folder.mkdir(parents=True, exist_ok=True)
        for k in db:
            write_tif(folder / f"water_{dates[k]}.tif",
                      np.where(valid, water[k], NODATA_CLASS), ref_tr, ref_crs, NODATA_CLASS, "uint8")
        write_tif(folder / "flood_classes.tif", classes, ref_tr, ref_crs, NODATA_CLASS, "uint8")
        with open(folder / "flood_area_by_district.csv", "w", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=list(rows[0])); wr.writeheader(); wr.writerows(rows)
        save_figure(folder / "flood_overview.png", [db["Before"], db["Peak"], db["After"]],
                    dates, classes, sel_proj, ref_tr, t)
        print(f"  [{t:.1f} dB] written to {folder}", flush=True)
        for r in rows:
            print("    " + ", ".join(f"{k}={v}" for k, v in r.items()), flush=True)

    # ---- shared GeoTIFFs (threshold-independent)
    for k, d in db.items():
        write_tif(out / f"{a.pol[:2]}_dB_{dates[k]}.tif", np.where(inside, d, np.nan),
                  ref_tr, ref_crs, np.nan, "float32")
    write_tif(out / "dB_change_peak_minus_pre.tif", np.where(valid, diff, np.nan),
              ref_tr, ref_crs, np.nan, "float32")

    water, classes = classify(thr)
    rows = district_rows(water, classes)
    write_set(out, water, classes, rows, thr)
    water_c = classes_c = rows_c = None
    if cons is not None:
        water_c, classes_c = classify(cons)
        rows_c = district_rows(water_c, classes_c)
        write_set(out / f"conservative_{abs(cons):g}dB", water_c, classes_c, rows_c, cons)

    # ---- river corridor statistics (the tributary comparison)
    rivers_ll, corridors = None, []
    if a.rivers:
        rv = gpd.read_file(a.rivers)
        name_col = "name" if "name" in rv.columns else rv.columns[0]
        rv = rv[rv[name_col].notna()].dissolve(by=name_col).reset_index()
        for _, r in rv.to_crs(ref_crs).iterrows():
            m = ~geometry_mask([r.geometry.buffer(a.river_buffer_km * 1000)],
                               out_shape=shape, transform=ref_tr) & valid
            if m.any():
                corridors.append((str(r[name_col]), m))
        bbox = sel.total_bounds
        rivers_ll = rv.to_crs(4326).clip((bbox[0] - .1, bbox[1] - .1, bbox[2] + .1, bbox[3] + .1))
        rivers_ll = rivers_ll.rename(columns={name_col: "name"})[["name", "geometry"]]

    def river_stats_for(classes):
        out_ = []
        for name, m in corridors:
            area = m.sum() * px_km2
            newly = (((classes == 2) | (classes == 3)) & m).sum() * px_km2
            out_.append({"name": name, "corridor_km2": round(area, 1),
                         "newly_flooded_km2": round(newly, 1),
                         "newly_flooded_pct": round(100 * newly / area, 1) if area else 0.0,
                         "persisting_km2": round(((classes == 3) & m).sum() * px_km2, 1),
                         "permanent_km2": round(((classes == 1) & m).sum() * px_km2, 1)})
        return sorted(out_, key=lambda s: -s["newly_flooded_pct"])

    river_stats = river_stats_for(classes)
    river_stats_c = river_stats_for(classes_c) if classes_c is not None else []
    for s_ in river_stats:
        print(f"  river {s_['name']}: {s_['newly_flooded_pct']}% of {a.river_buffer_km} km "
              f"corridor newly flooded ({s_['newly_flooded_km2']} km2)", flush=True)

    if a.web:
        export_web(Path(a.web), a, paths, dates, db, water, classes, valid, inside, ref_tr,
                   ref_crs, sel, rows, river_stats, rivers_ll, thr, px_km2,
                   cons=cons, rows_c=rows_c, river_stats_c=river_stats_c,
                   water_c=water_c, classes_c=classes_c)


if __name__ == "__main__":
    main()
