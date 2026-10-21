# Mac's Marlin 🎣

A mobile-first PWA for offshore marlin fishing from Bundaberg, 1770, Hervey Bay and K'gari (Fraser) down the Sunshine Coast to Moreton. It is a separate app from [Mac's Jacks](https://jonathanagronica.github.io/fishing-apps/) and reuses its sun, moon and solunar code.

**Live:** https://jonathanagronica.github.io/marlin-app/

## Tabs
- **Ocean**: sea surface temperature, temperature breaks (fronts), EAC and eddy current arrows, chlorophyll, depth contours (the 200 m shelf edge is bold), public FADs and your private marks. Shade by bite score, SST, chlorophyll or current speed, and move the time slider over the next 7 days. Tap anywhere for a score breakdown.
- **Score**: best time and score at every mark for a chosen day, with the factor breakdown. Includes the *Accuracy & method* drop-down, which lists every weight.
- **Plan**: go / no-go from Open-Meteo wind, gusts, sea and swell (with period) against limits you set. Shows the best window, when to leave port, when to head home, suggested marks, and bar notes with modelled tides and the ebb (run-out) at Round Hill Ck, Burnett Heads, Wide Bay Bar, Mooloolaba and Moreton, plus BoM and MSQ links.
- **Marks**: private marks (name, lat/lon in decimal or degrees-minutes, depth, type). **Stored in the phone's localStorage only, never uploaded.** You can export and import them as JSON.
- **Log**: species (black, blue, striped, sailfish, other), tag/release, tag number, size, lure/bait, where, SST at the time (filled from the satellite grid) and the bite score then. Private, with JSON/CSV export.

## Data (all free, no keys, attributed in-app)
| Layer | Source | Refresh |
|---|---|---|
| SST | NASA JPL MUR SST v4.1 (GHRSST L4) via NOAA CoastWatch ERDDAP `jplMURSST41` | GitHub Action, 2× daily (see below) |
| Fronts | computed from the MUR SST gradient (≥ 0.03 °C/km) | with SST |
| Currents / eddies | IMOS OceanCurrent GSLA NRT (geostrophic UCUR/VCUR + sea level anomaly), AODN THREDDS (CC BY 4.0) | 2× daily |
| Chlorophyll | NOAA-20 VIIRS weekly → MODIS-Aqua 8-day NRT → VIIRS gap-filled (first available), via ERDDAP | 2× daily |
| Bathymetry | NOAA NCEI ETOPO1 via ERDDAP `etopo180` (contours computed once) | static |
| Public FADs | Queensland Government FAD list (qld.gov.au) | static (`data/fads.json`) |
| Wind / waves / modelled sea level | Open-Meteo forecast and marine APIs (fetched by the browser) | live |

Skipped: **Copernicus Marine** (needs a login). **GEBCO / AusSeabed** grids are large downloads that ERDDAP doesn't serve; ETOPO1 is derived from GEBCO.

## Build
```
python3 scripts/fetch_ocean.py   # optional locally; the Action does it
python3 build.py                 # inlines src/* into index.html and bumps the sw.js build id
```
Source lives in `src/` (`app.html`, `app.css`, `app.js`, `astro.js` from Mac's Jacks, `sw.js` template). The service worker only touches caches named `macsmarlin-*` because the github.io origin is shared with Mac's Jacks.

## Privacy
No accounts, analytics or keys. Marks, catches and settings stay in the browser's localStorage. Nothing personal is committed to this repo.

Not for navigation. Always check the official BoM forecasts and warnings and MSQ notices before crossing a bar.

## Scheduled refresh (one-time setup)
The workflow is in `ops/ocean-workflow.yml`. The CLI token used to create this repo has no `workflow` scope, so it couldn't be pushed to `.github/workflows/`. To switch it on, do one of these:
- run `gh auth refresh -s workflow`, then `mkdir -p .github/workflows && git mv ops/ocean-workflow.yml .github/workflows/ocean.yml && git commit -m "enable ocean refresh" && git push`, **or**
- on GitHub, choose *Add file → Create new file*, name it `.github/workflows/ocean.yml` and paste the contents in.

Until then, `data/ocean.json` only updates when `python3 scripts/fetch_ocean.py` is run and committed by hand. The app shows the data age in the header.
