# Upper Assam flood website

Main experience: **`globe.html`** (3D globe → fly to Assam → story panel → explore).
The longer scrolling page is `index.html` ("Learn more").

Open either file in a browser (double-click). No server needed.
Globe test links: `globe.html?noauto` (no auto-start), `?view=assam`, `?panel=story|clouds|numbers`,
`?explore=1`, `?at=26.94,94.58`, `?lang=hi`, `?tour=1` … `?tour=6` (open the guided tour at a stop;
browsers hold back its sound until you press Play), `?debug=1` (logs camera and tour events to the console;
with `&missingclip=N` it pretends clip N is missing, to test the fallback).

## Report (download and share)

The tour's last stop offers four options:

- **Report:** opens `report.html?print=1`, a printable A4 analysis (3 pages, English or Hindi),
  then the print dialog; choose "Save as PDF". `report.html` can also be opened on its own.
- **Data:** `upper-assam-flood-2026-<lang>.csv`, one row per district and setting.
- **Map image:** a PNG of the current map view with a title band, legend and credit.
- **Share:** the device's share sheet (with the PNG attached where the browser allows it), otherwise
  copy text, WhatsApp, email or X. The shared link is the page itself when it is online, otherwise
  the GitHub repository (from `js/config.js`).

Everything is built in the browser from the files in `data/`, so it also works offline
(`js/report-tools.js`, `js/report.js`, `css/report.css`).

## Guided tour

"▶ Watch the story" (globe screen or the story panel) starts a six-stop narrated tour.
Each stop moves the camera, sets the layers and plays `data/narration/<en|hi>_<n>.mp3`.
The next stop starts only when the clip has ended, the camera has arrived and at least 6 s have
passed. If a clip is missing (or hasn't started after 10 s), the browser's own voice reads the
subtitle in the same language; with no suitable voice, the stop lasts 8 s.
Controls: Play/Pause (Space), Back/Next (← →), Replay, language switch (restarts the stop),
sound on/off, close (Esc), which goes to explore mode.
Subtitles are the `tour.1`–`tour.6` keys in `js/i18n-globe.js`; the clips are made from the same
text by `scripts/make_narration.py`. Keep the two in step when you change a line.

`globe.html` uses MapLibre GL JS 5.24.1 (`vendor/maplibre/`). Version 6 ships only as ES modules,
which browsers block for pages opened from disk, so it would break double-click opening.
Its map overlays come from `data/globe_layers.js` (WebP data URLs), rebuilt by
`scripts/build_globe_assets.py`; `flood_map.py --web` runs that automatically.
Background map tiles need an internet connection; everything else is local.

Handy links: `index.html?lang=hi` (Hindi), `?mode=explore`, `?step=4` (story step),
`?at=26.94,94.58` (open the popup at a place).

## Things to fill in

Edit `js/config.js`: team names, GitHub link, the "Strict" slider preset, story zoom spots.
Until then the Team and Code boxes show a "to be added" note.

## Updating the data

Run from the repository root (the folder that contains `scripts/` and `web/`):

```
python -P scripts/flood_map.py ^
  --pre  D:/sar-dance/data/NISAR_L2_PR_GCOV_023_163_D_075_4005_DHDH_A_20260625T122531_20260625T122606_P05023_N_F_J_001.h5 ^
  --peak D:/sar-dance/data/NISAR_L2_PR_GCOV_025_163_D_075_4005_DHDH_A_20260719T122530_20260719T122604_P05023_N_F_J_001.h5 ^
  --post D:/sar-dance/data/NISAR_L2_PR_GCOV_029_163_D_075_4005_DHDH_A_20260905T122527_20260905T122602_P05023_N_F_J_002.h5 ^
  --districts boundaries/upper_assam_districts.geojson ^
  --threshold -15 --conservative-threshold -17 ^
  --out D:/sar-dance/output ^
  --web D:/sar-dance/web/data

python -P scripts/fetch_ancillary.py D:/sar-dance/web/data            (all extras)
python -P scripts/fetch_ancillary.py D:/sar-dance/web/data rain       (just one: rain | optical | places | rivers)
```

Add `--rivers boundaries/rivers.geojson` to `flood_map.py` once `fetch_ancillary.py rivers`
has succeeded; the map then gets a Rivers layer.

The automatic (Otsu) threshold is not used: on these scenes it lands near -10 dB, between
rough land and wet paddy fields. -15 dB is the main estimate and -17 dB the careful one.

## Data contract (fixed names in `data/`)

Written by `flood_map.py --web`:

| File | Content |
|---|---|
| `site_data.js` / `data.json` | `window.FLOOD_DATA = {meta, stats, districts, rivers}`; `stats.conservative` holds the careful-setting numbers |
| `backscatter_{before,peak,after}.png` | HH backscatter, grey (-25 to 0 dB), Web Mercator |
| `water_{before,peak,after}.png` | water per date, main threshold |
| `flood_classes.png`, `flood_classes_careful.png` | 1 water before+peak, 2 new flood drained, 3 new flood still wet, 4 possibly flooded plants (hatched) |
| `status_grid.js` | `window.FLOOD_STATUS`: per-pixel status for the click popup (PNG data URL: R = valid + water bits for 3 dates x 2 thresholds, G = main class, B = careful class) |
| `db_grids.js` | `window.FLOOD_GRIDS`: 200 m dB grids per date for the "Be the scientist" slider |

Written by `fetch_ancillary.py` (each is optional; the page shows a labelled empty slot without it):

| File | Content |
|---|---|
| `optical_peak.jpg`, `optical.js` | MODIS true-colour photo for the peak date (clouds-vs-radar swipe) |
| `rainfall.js` | `window.RAINFALL_DATA = {place, source, days[], mm[]}` (rainfall chart) |
| `places.js` | `window.PLACES = [[name, lat, lon], ...]` (village search) |

All images share `meta.bounds` (`[[south, west], [north, east]]`).

## Files

- `index.html`: the eight sections
- `css/style.css`: dark navy theme; all controls are at least 44 px tall
- `js/i18n.js`: every piece of text, in English and Hindi
- `js/config.js`: team, GitHub link, presets
- `js/app.js`: language switch, swipe, map (story + explore), popup, search, slider, charts, tables
- `vendor/leaflet/`: local copy of Leaflet 1.9.4
