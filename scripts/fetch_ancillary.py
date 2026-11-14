"""Fetch the extra (non-NISAR) data the website uses. Each step is independent; a failed
step just leaves its slot empty on the site.

Usage:  python -P scripts/fetch_ancillary.py D:/sar-dance/web/data [step ...]
Steps:  rain  optical  places  rivers   (default: all)

  rain     daily rainfall near Sivasagar, Open-Meteo archive (ERA5)  -> rainfall.js
  optical  MODIS true-colour photo for the peak date, NASA GIBS      -> optical_peak.jpg + optical.js
  places   towns/villages inside the districts, GeoNames (CC BY 4.0) -> places.js
  rivers   river lines from OpenStreetMap                            -> boundaries/rivers.geojson
"""
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "flood-map-site-builder/1.0"}


def rain(web, meta):
    lat, lon = 26.98, 94.63          # Sivasagar town
    try:
        r = requests.get("https://archive-api.open-meteo.com/v1/archive", timeout=60, params={
            "latitude": lat, "longitude": lon, "start_date": "2026-06-01", "end_date": "2026-09-15",
            "daily": "precipitation_sum", "timezone": "Asia/Kolkata"})
        r.raise_for_status()
        d = r.json()["daily"]
        days, mm = d["time"], d["precipitation_sum"]
        source = "Open-Meteo historical weather API (ERA5 reanalysis)"
    except Exception as e:                       # fall back to NASA POWER
        print(f"rain: Open-Meteo unreachable ({type(e).__name__}); trying NASA POWER")
        r = requests.get("https://power.larc.nasa.gov/api/temporal/daily/point", timeout=120, params={
            "parameters": "PRECTOTCORR", "community": "AG", "longitude": lon, "latitude": lat,
            "start": "20260601", "end": "20260915", "format": "JSON"})
        r.raise_for_status()
        vals = r.json()["properties"]["parameter"]["PRECTOTCORR"]
        days = [f"{k[:4]}-{k[4:6]}-{k[6:]}" for k in sorted(vals)]
        mm = [None if vals[k] < 0 else vals[k] for k in sorted(vals)]
        source = "NASA POWER (MERRA-2 reanalysis)"
    out = {"place": "Sivasagar", "lat": lat, "lon": lon, "source": source,
           "days": days, "mm": [0 if v is None else round(v, 1) for v in mm]}
    (web / "rainfall.js").write_text("window.RAINFALL_DATA = " + json.dumps(out, separators=(",", ":")) + ";",
                                     encoding="utf-8")
    print(f"rain: {source}: {len(days)} days, total {sum(out['mm']):.0f} mm, max {max(out['mm'])} mm")


def optical(web, meta):
    (s, w), (n, e) = meta["bounds"]
    date = meta["dates"]["peak"]
    width = 1200
    height = round(width * (n - s) / ((e - w) * 0.893))      # cos(26.8 deg): roughly Mercator shape
    for layer, sensor in [("MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS on NASA's Terra satellite"),
                          ("MODIS_Aqua_CorrectedReflectance_TrueColor", "MODIS on NASA's Aqua satellite"),
                          ("VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS on the Suomi NPP satellite")]:
        r = requests.get("https://wvs.earthdata.nasa.gov/api/v1/snapshot", timeout=180, params={
            "REQUEST": "GetSnapshot", "TIME": date, "BBOX": f"{s},{w},{n},{e}", "CRS": "EPSG:4326",
            "LAYERS": layer, "FORMAT": "image/jpeg", "WIDTH": width, "HEIGHT": height})
        if r.ok and r.headers.get("content-type", "").startswith("image") and len(r.content) > 20000:
            (web / "optical_peak.jpg").write_bytes(r.content)
            (web / "optical.js").write_text("window.OPTICAL = " + json.dumps(
                {"date": date, "sensor": sensor, "source": "NASA GIBS / Worldview"}) + ";", encoding="utf-8")
            print(f"optical: {layer} {len(r.content)} bytes")
            return
        print(f"optical: {layer} -> HTTP {r.status_code}, {len(r.content)} bytes")
    raise RuntimeError("no optical layer returned an image")


def places(web, meta):
    import geopandas as gpd
    from shapely.geometry import Point
    dl = ROOT / "ancillary" / "geonames"          # untrusted download kept in its own folder
    dl.mkdir(parents=True, exist_ok=True)
    zp = dl / "IN.zip"
    if not zp.exists() or not zipfile.is_zipfile(zp):      # also replaces a cut-off download
        part = dl / "IN.zip.part"
        with requests.get("https://download.geonames.org/export/dump/IN.zip", timeout=600, stream=True,
                          headers=UA) as r:
            r.raise_for_status()
            with open(part, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        part.replace(zp)
    d = gpd.read_file(ROOT / "boundaries" / "upper_assam_districts.geojson")
    d = d[d.shapeName.isin(["Sivasagar", "Jorhat", "Charaideo"])]
    area = d.union_all()
    minx, miny, maxx, maxy = area.bounds
    out, seen = [], set()
    with zipfile.ZipFile(zp) as z, z.open("IN.txt") as f:
        for line in io.TextIOWrapper(f, encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            if len(c) < 9 or c[6] != "P":
                continue
            lat, lon = float(c[4]), float(c[5])
            if not (miny <= lat <= maxy and minx <= lon <= maxx) or not area.contains(Point(lon, lat)):
                continue
            name = c[2] or c[1]                 # plain-ASCII name, so typed searches match
            key = (name.lower(), round(lat, 2), round(lon, 2))
            if key not in seen:
                seen.add(key)
                out.append([name, round(lat, 5), round(lon, 5)])
    out += [["Sivasagar", la, lo] for n, la, lo in out if n == "Sibsagar"]   # modern spelling
    out.sort(key=lambda p: p[0].lower())
    (web / "places.js").write_text("window.PLACES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";",
                                   encoding="utf-8")
    print(f"places: {len(out)} populated places inside the districts")


def rivers(web, meta):
    subprocess.run([sys.executable, "-P", str(ROOT / "scripts" / "fetch_rivers.py"),
                    str(ROOT / "boundaries" / "rivers.geojson")], check=True)


def main():
    web = Path(sys.argv[1])
    meta = json.loads((web / "data.json").read_text(encoding="utf-8"))["meta"]
    steps = sys.argv[2:] or ["rain", "optical", "places", "rivers"]
    for name in steps:
        try:
            globals()[name](web, meta)
        except Exception as e:
            print(f"{name}: FAILED ({type(e).__name__}: {str(e)[:200]})")


if __name__ == "__main__":
    main()
