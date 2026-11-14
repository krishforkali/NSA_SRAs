"""Fetch river centre-lines for Upper Assam from OpenStreetMap (Overpass API).

Usage:  python -P scripts/fetch_rivers.py boundaries/rivers.geojson
Writes one LineString/MultiLineString per river with a normalised 'name' field,
for flood_map.py --rivers.
"""
import json
import sys
import time

import requests

RIVERS = {"dikhow": "Dikhow", "disang": "Disang", "brahmaputra": "Brahmaputra",
          "dhansiri": "Dhansiri", "jhanji": "Jhanji", "bhogdoi": "Bhogdoi"}
BBOX = (26.3, 93.7, 27.4, 95.5)   # S, W, N, E
QUERY = f"""[out:json][timeout:180];
way["waterway"="river"]["name"~"{'|'.join(RIVERS)}",i]{BBOX};
out geom;"""
SERVERS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]


def main(out_path):
    data = None
    for attempt in range(3):
        for url in SERVERS:
            try:
                r = requests.post(url, data={"data": QUERY}, timeout=200)
                r.raise_for_status()
                data = r.json()
                break
            except Exception as e:
                print(f"{url}: {type(e).__name__}", flush=True)
        if data:
            break
        time.sleep(30)
    if not data:
        sys.exit("all Overpass servers failed; try again later")

    by_name = {}
    for el in data["elements"]:
        raw = el.get("tags", {}).get("name", "").lower()
        key = next((v for k, v in RIVERS.items() if k in raw), None)
        if key and el.get("geometry"):
            by_name.setdefault(key, []).append([[p["lon"], p["lat"]] for p in el["geometry"]])
    feats = [{"type": "Feature", "properties": {"name": n},
              "geometry": {"type": "MultiLineString", "coordinates": lines}}
             for n, lines in sorted(by_name.items())]
    json.dump({"type": "FeatureCollection", "features": feats}, open(out_path, "w"))
    print({n: len(v) for n, v in by_name.items()}, "->", out_path)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "boundaries/rivers.geojson")
