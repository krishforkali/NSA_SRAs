# NSA_SRAs: Upper Assam flood map from NISAR radar

Mapping the July 2026 flood in Sivasagar, Jorhat and Charaideo (Assam, India) with
NASA–ISRO NISAR L-band radar, and a bilingual (English / Hindi) website that explains it.

- **Website:** open `web/index.html` in a browser, or serve it locally:
  `python -m http.server 8000 --directory web` and go to http://localhost:8000
- **How it was made and how to update it:** see [web/README.md](web/README.md)

## What is here

| Folder | Content |
|---|---|
| `web/` | The website and its data files (map images, statistics, rainfall, place list) |
| `scripts/` | `search_nisar.py` and `download_gcov.py` (find and download NISAR GCOV scenes), `flood_map.py` (crop, water mapping, website export), `fetch_ancillary.py` (cloud photo, rainfall, place names, rivers) |
| `boundaries/` | District outlines (geoBoundaries, 2021) |
| `selected_scenes*.txt` | The NISAR scenes considered and used |

The NISAR scenes themselves (about 7 GB each) are not in this repository. Download them from the
Alaska Satellite Facility with `scripts/download_gcov.py` (needs a free NASA Earthdata login).

## Result in one line

About 96–195 km² of land was newly under water on 19 July 2026, and most of it had drained
by 5 September. The range comes from two water thresholds (−17 dB and −15 dB). The NISAR data is a
provisional release and the map has not been checked on the ground.

## Sources

NISAR L2 GCOV (ASF DAAC) · NASA Worldview/GIBS (MODIS) · NASA POWER (rainfall) ·
geoBoundaries · GeoNames (CC BY 4.0) · Esri basemaps · Leaflet · MapLibre GL JS

News reports quoted in the narration:
[BBC News via The Star, 28 Jul 2026](https://www.the-star.co.ke/news/world/2026-07-28-indias-assam-faces-worst-floods-in-years) ·
[The Wire](https://thewire.in/environment/assams-floods-are-worsening-and-extreme-rainfall-is-only-part-of-the-reason) ·
[Outlook India, 28 Jul 2026](https://www.outlookindia.com/national/outlook-explains-why-assam-floods-every-year-despite-decades-of-flood-control-projects)

Narration voices: Microsoft Edge neural text-to-speech (en-IN-NeerjaNeural, hi-IN-SwaraNeural), made with `scripts/make_narration.py`.
