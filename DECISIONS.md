# Decisions log

One line per decision, added in the same commit as the change.

| Time (Sat, Cairo) | Decision | Why |
| --- | --- | --- |
| 19:00 | First end-to-end target: Medusae Fossae x Egypt's Western Desert (Kharga) | Published evidence (Breed et al. 1984); tests the riskiest assumption first |
| 19:00 | Colab for compute, Drive for checkpoints (zips, not many small files), laptops for API + demo | Save local bandwidth; the demo runs offline |
| 19:00 | LST from MOD11C3, not MOD11A2 | sample_climate.py expects lat/lon grids; MOD11A2 is sinusoidal |
| 19:00 | No FAISS | Ranking uses cosine_all (numpy); the index search is not on the scoring path |
| 19:00 | MERRA-2 wind and NASA POWER deferred | No dimension uses them |
| 19:00 | Egypt bbox 22-30N, 24-36E | ETOPO N30 tiles cover 15-30N |
| 19:00 | medusae_fossae validation_tags: yardang, aeolian (dropped "mars") | "mars" matched 12 of 14 known sites, so the AUC meant nothing |
| 19:00 | Report per-site percentiles with n, not a headline AUC | Only 2 matching known sites |
| 19:20 | uv for local envs (pyproject.toml + uv.lock); pip install -e on Colab | One dependency source, same versions on all five laptops |
| 20:30 | Read the MOLA tile as raw big-endian int16 with numpy, not through GDAL | Avoids PDS label issues; layout taken from the PDS4 label megt44n180hb.xml |
| 20:30 | Smoke test keeps cut_tiles default --min-land-frac 0.5 | Drops Red Sea tiles; also drops Qattara (below sea level), revisit later |
| Sun 10:00 | Site is one three.js scene with the Moon, Earth and Mars together (not to scale), arcs linking targets to Earth analogs | One page for the video and the demo; three.js is ~140 KB gzipped against ~1.1 MB for Cesium |
| Sun 10:00 | Site shows real data only: it reads `out/` published by `npm run data:publish`, which refuses `"synthetic": true`; `sample_out/` is not in this repo | Plan rule: no number from sample_out in the video or slides |
| Sun 10:00 | Before real output exists, the site shows config places (targets, known analogs, Egypt sites) and links, with "Awaiting pipeline output" | Real, sourced content from hour 0 without inventing scores |
| Sun 10:00 | Links: known site to target when `known_for` shares a specific `validation_tags` entry (ignore "mars"/"moon"); Egypt site to target from `analog_for` | Same tag logic as validation; generic body tags link everything (19:00 decision) |
| Sun 10:00 | Globe textures are built once from NASA tiles (`npm run textures`, WebP, about 1.1 MB); region close-ups stream live Trek/GIBS tiles | Fast first view; sharp detail only where you dive in |
| Sun 10:00 | Deploy on Vercel (`vercel.json`) | Team choice; GitHub Actions only runs checks |
| Sun 10:00 | Local setup installs the `uv.lock` pins with pip into `tools/python` | uv's cache renames are blocked by antivirus on some Windows laptops |
| Sun 13:00 | No orbiting camera: drag turns the planet under the cursor, drag on space pans, wheel zooms to the cursor; view level follows the camera | Each planet moves on its own; scrolling out of a region never gets stuck |
| Sun 13:00 | Earth from Blue Marble NG (day), VIIRS Black Marble 2016 (night lights) and OSM land mask (ocean glint), all via GIBS | More realistic than the shaded-relief layer; still display only |
| Sun 13:00 | No top bar and no permanent lines: arcs appear only for the hovered or open region; data status lives in About and the target card | Cleaner presentation; status still visible where it matters |
| Sun 13:00 | Palette: Xiketic, Space Cadet, Purple Navy, Dark Blue Gray with white and black | Team visual direction |
| Sun 15:00 | Earth is the hero up front; Moon and Mars at real relative radii (0.273, 0.532) further out; all spin slowly | Earth is where the answers are; real proportions read as credible |
| Sun 15:00 | Trips between bodies: turn, jump with star streaks and FOV widening, pause on the whole planet, dive | Makes the Earth to Mars/Moon link tangible in the demo |
| Sun 15:00 | Pan, zoom and planet turning scale with altitude above the surface; turning glides (slerp) | Close-up motion was fast and jumpy |
| Sun 17:00 | Home is Earth alone, centred; Moon and Mars placed hundreds of radii away and drawn only within range, so a destination appears as a speck and grows | One body at a time reads clearer; the trip itself shows the distance |
| Sun 17:00 | Trips last 8-12 s (lift off, turn, long jump with even braking, beat on the whole planet, dive) | Previous jumps were too short to read in the video |
| Sun 17:00 | Key light follows the camera (upper left, in front); Earth day lighting wrapped and brighter | Earth looked dark; every arrival now lands on the lit side |
| Sun 17:00 | No arcs at all; hovering a region shows a small translucent name label | Links stay in the card; the globe stays clean |
