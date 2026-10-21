# Mac's Marlin 🎣

A mobile-first PWA for offshore marlin fishing down the east coast, from Princess Charlotte Bay / Portland Roads (Cape York) past Cairns, the Whitsundays, Bundaberg, K'gari and the Gold Coast, down NSW to Eden, and on to Bass Strait and Port Phillip, out past the continental shelf. It is a separate app from [Mac's Jacks](https://jonathanagronica.github.io/fishing-apps/) and reuses its sun, moon and solunar code.

**Live:** https://jonathanagronica.github.io/marlin-app/

## Tabs
- **Ocean**: sea surface temperature, temperature breaks (fronts), EAC and eddy current arrows, chlorophyll, depth contours (the 200 m shelf edge is bold), public FADs and your private marks. Shade by bite score, SST, chlorophyll or current speed, and move the time slider over the next 7 days. Tap anywhere for a score breakdown.
- **Score**: best time and score at every mark for a chosen day, with the factor breakdown. Includes the *Accuracy & method* drop-down, which lists every weight.
- **Plan**: go / no-go from Open-Meteo wind, gusts, sea and swell (with period) against limits you set. Shows the best window, when to leave port, when to head home, suggested marks, and bar notes with modelled tides and the ebb (run-out) for 33 ports from Portland Roads to Port Phillip Heads, plus BoM, MSQ, Marine Rescue NSW and Safe Transport Victoria links.
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
| Public FADs | QLD Government FAD list (31), NSW DPIRD FAD list (13 with published positions, Tweed–Forster), VFA / Safe Transport Victoria NTM (Torquay, Lorne, Aireys Inlet; seasonal) | static (`data/fads.json`) |
| Wind / waves / modelled sea level | Open-Meteo forecast and marine APIs (fetched by the browser) | live |

Skipped: **Copernicus Marine** (needs a login). **GEBCO / AusSeabed** grids are large downloads that ERDDAP doesn't serve; ETOPO1 is derived from GEBCO.

## Ocean data tiles
`data/ocean.json` is a small index (sources, errors, tile bounds). The grid is split into 7 region tiles on a 0.05° (≈5 km) grid in `data/tiles/`: `ncq` Cape York–Cairns, `ccq` Townsville–Whitsundays, `caq` Mackay–Bundaberg, `seq` K'gari–Gold Coast, `nnsw` Tweed–Port Stephens, `snsw` Sydney–Eden, `bass` East Gippsland–Port Phillip. Each has `<id>.json` (layers + fronts, 340–710 KB raw / 47–84 KB gzipped), `<id>_bathy.json` (contours) and `<id>_depth.json` (cached, static). The app loads only the tiles in view (pan or tap to load more). The fetch makes one IMOS currents request for the whole coast, then runs the tiles in 4 parallel workers; a full refresh takes about 1–2 minutes.

## Build
```
python3 scripts/fetch_ocean.py   # optional locally; the Action does it
python3 build.py                 # inlines src/* into index.html and bumps the sw.js build id
```
Source lives in `src/` (`app.html`, `app.css`, `app.js`, `astro.js` from Mac's Jacks, `sw.js` template). The service worker only touches caches named `macsmarlin-*` because the github.io origin is shared with Mac's Jacks.

## Privacy
No accounts, analytics or keys. Marks, catches and settings stay in the browser's localStorage. Nothing personal is committed to this repo.

Not for navigation. Always check the official BoM forecasts and warnings and MSQ notices before crossing a bar.

## Scheduled refresh: box routine (active)
The ocean data is refreshed by `ops/refresh_ocean.sh`, run every hour by the owner's box routine. The script decides for itself whether a refresh is due: the last success was 11 h or more ago and it is 5–8am or 5–8pm AEST, or the last success was more than 14 h ago. That gives about two refreshes a day, near 6am and 6pm.
- It fetches MUR SST, works out the temperature breaks, then fetches IMOS currents and eddies, and chlorophyll with fallbacks. It commits and pushes `data/` only if something changed (`git pull --rebase`, no force).
- When a source fails, the last good copy of that layer is kept. If every source fails, nothing is committed.
- Hard time limit is about 6 minutes. It prints one line: `REFRESHED <ages>`, `SKIPPED not due` or `FAILED <reason>`. The exit code is 2 only on failure. `--force` skips the due check.
- State and logs are kept in `~/.cache/marlin-refresh/`.

`ops/ocean-workflow.yml` is an **inactive** GitHub Actions alternative, kept for reference. Don't turn both on.
