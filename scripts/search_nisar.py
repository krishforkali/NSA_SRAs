"""Search ASF for NISAR L-band GCOV products over Upper Assam (Sivasagar, Jorhat, Charaideo)."""
import json, sys
import asf_search as asf

# Bounding polygon covering Jorhat, Sivasagar, Charaideo + Dikhow/Disang lower reaches
AOI = "POLYGON((93.90 26.40, 95.20 26.40, 95.20 27.30, 93.90 27.30, 93.90 26.40))"

res = asf.search(
    dataset=asf.DATASET.NISAR,
    processingLevel=asf.PRODUCT_TYPE.GCOV,
    intersectsWith=AOI,
    start="2026-06-01T00:00:00Z",
    end="2026-10-31T23:59:59Z",
)
print(f"Found {len(res)} GCOV products")
rows = []
for r in res:
    p = r.properties
    rows.append({k: p.get(k) for k in ("sceneName", "startTime", "pathNumber", "frameNumber",
                                         "flightDirection", "polarization", "bytes", "url", "fileName")})
    rows[-1]["additionalUrls"] = p.get("additionalUrls")
def total_bytes(b):
    if isinstance(b, dict):
        return sum(total_bytes(v) for v in b.values())
    return b if isinstance(b, (int, float)) else 0
for x in rows:
    x["bytes_detail"] = x["bytes"]; x["bytes"] = total_bytes(x["bytes"])
rows.sort(key=lambda x: x["startTime"])
for x in rows:
    print(x["startTime"], x["flightDirection"], "track", x["pathNumber"], "frame", x["frameNumber"],
          x["polarization"], f"{(x['bytes'] or 0)/1e9:.2f} GB", x["sceneName"])
json.dump(rows, open(sys.argv[1], "w"), indent=1, default=str)
