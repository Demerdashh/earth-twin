# Analog Finder: Architecture and Stack

Nov 14, 2026 · @osama

## The idea in two lines

A 3D web tool that answers one question: **where on Earth is there a place that resembles a specific lunar or Martian site?** The user picks a target (for example the rim of Shackleton crater) and the tool returns the best matching sites on Earth, with the reason for the similarity.

The tool has two modes: **Story mode** (a guided, scroll-driven journey where the camera flies between bodies) and **Explore mode** (layers, weight sliders and export for scientists). Every number comes from real NASA data.

## Architecture: two worlds joined by files

_[embedded diagram: architecture · offline pipeline + static site]_

Sources go into Python offline and come out as files; the website reads only those files, and fetches display imagery from Trek and GIBS directly (the dotted line).

## Stack and tools

Each tool takes from the one before it, and no heavy computation happens in the browser.

| Tool | Role | Takes from | Produces |
| --- | --- | --- | --- |
| **Moon Trek / Mars Trek + PDS (ODE)** | Moon and Mars data source | NASA missions (LOLA, Diviner, MOLA...) | GeoTIFF/IMG files for specific regions; Trek also provides display tiles |
| **Google Earth Engine** | Earth data source | Copernicus DEM, Sentinel-2, MODIS | Earth feature grid (elevation, temperature, vegetation, minerals) |
| **GDAL + rasterio + NumPy** | Read and unify files, compute slope and roughness | Raw files from Trek/PDS and Earth Engine | A unified feature grid (same units and resolution) |
| **scikit-learn / NumPy** | Similarity, ranking and clustering | Feature grids + targets file | `earth_candidates.json`, `analogs_*.geojson`, `similarity_*.png` |
| **AI and model** | Defined by the domain owner | — | — |
| **CesiumJS** | The 3D globe that switches between Earth, Moon and Mars | Tiles from Trek and NASA GIBS + `public/data` files | Display, camera and popups |
| **three.js** (optional) | 3D mesh of a specific site compared with its analog | Small DEM of the site from Trek/Earth Engine | Rotatable terrain scene |
| **Vite + GitHub Pages/Netlify** | Build the site as static files and host it | `src/` code + `public/data/` | Public demo link |
| **Git + CLAUDE.md** | Team coordination | The agreed schema | One branch per person; the contract written in one place |

## Data sources per body

Every feature must be measured with the same meaning on both bodies, which is why every row here has an Earth counterpart.

| Feature | Moon | Mars | Earth |
| --- | --- | --- | --- |
| Elevation, slope, roughness | LOLA DEM | MOLA DEM (HiRISE/CTX for detail) | Copernicus DEM |
| Surface temperature and its range | Diviner | THEMIS / TES | MODIS LST |
| Minerals and geology | M3 (Chandrayaan-1) | CRISM / TES | Sentinel-2 band ratios |
| Ice / hydrogen indicators | LP Neutron Spectrometer | Radar and orbital instrument data | Surface water layers |
| Vegetation | Not applicable | Not applicable | NDVI from MODIS/Sentinel-2 (exclusion filter) |
| Display imagery | Moon Trek (LRO WAC, hillshade) | Mars Trek (Viking, MOLA) | NASA GIBS / OSM |

Dataset names come from our general knowledge, so verify availability and resolution in Trek and PDS before relying on them. The Space Agency Partners resources are a reference for Earth only: Copernicus Data Space, JAXA G-Portal and the ESA Open Science Catalog.

## Pipeline and similarity method

All processing runs offline in Python; the website only receives ready-made files.

1. **Download:** raw files go into `data/raw` (excluded from git).
2. **Unify:** reproject and resample onto a common grid, and handle missing and outlier values with written rules.
3. **Features:** `elevation_m`, `slope_deg`, `roughness`, `temp_range_k`, a mineral index, and an ice indicator for the Moon and Mars.
4. **Target fingerprint:** mean of the values around the target site within a defined radius.
5. **Similarity:** weighted distance between the target fingerprint and every Earth cell; keep the top 200 to 300 candidates per target for the browser.
6. **Validation:** known NASA analog sites (Atacama, Haughton, Hawaii, Iceland, San Francisco Volcanic Field) must appear near the top.
7. **Export:** `public/data` files with a provenance record for every dataset.

**Important scientific rules:**

- Compare actual physical values (degrees, kelvin, metres), not a per-body percentile, so that the steepest slope on the Moon is not mistakenly "similar" to the steepest slope on Earth.
- Vegetation is an exclusion filter: candidates must be in sparsely vegetated areas.

## AI and model

To be written by the domain owner.

## Interface: the globe, Story and Explore

The site is fully static; it reads the `public/data` files and requests display imagery from Trek and GIBS.

- **Switching bodies:** each body is a separate Viewer with its own ellipsoid (WGS84 for Earth, Moon for the Moon, and a custom ellipsoid for Mars); the switch button destroys the old one and builds the new one. The ellipsoid must be passed into every coordinate calculation.
- **Layers:** imagery (tiles), similarity heatmap (PNG over the globe), vegetation as an exclusion filter, water and ice indicators. Each layer has a toggle and opacity, and an isolate mode dims the rest.
- **Click:** popup with the measured values at the point (from a grid JSON) and the site's "fingerprint" compared with the target.
- **Sliders:** weights for slope, temperature and minerals; the ranking is recomputed in the browser over the list of 200 to 300 candidates.
- **Story mode:** scroll-linked chapters, each chapter a `flyTo` + layers. Chapters: hook, the problem, the fingerprint, the search, trust (validation), the discovery (if the data supports it), your turn.
- **Explore mode:** all layers and weights, the source of every number, GeoJSON/CSV export, and a short Methods page.
- **Optional:** a three.js mesh of the target site next to its analog at the same scale, with a slider for vertical exaggeration.

## Team, contract and 36-hour plan

The contract between the data world and the website world is the `public/data` files; their schema must be locked in the first hour and written in `CLAUDE.md`.

| Role | Owns | Delivers to |
| --- | --- | --- |
| **A: Earth** | Earth Engine and `earth_candidates.json` | Similarity owner |
| **B: Moon and Mars** | Trek/PDS and `targets.json` | Similarity owner |
| **Similarity** (A+B, or whoever is strongest in Python) | `similarity.py` and `export.py` | Interface |
| **C: Interface** | Cesium, Story/Explore and the pitch | — |

```json
{ "id": "shackleton", "body": "moon", "lat": -89.9, "lon": 0.0,
  "features": { "elevation_m": 1200, "slope_deg": 8.5, "roughness": 0.4, "temp_range_k": 150 } }
```

```text
project/
  CLAUDE.md                # the contract: features, units and responsibilities
  data/raw/                # raw data (excluded from git)
  pipeline/                # earth_features.py, moon_features.py, similarity.py, export.py
  public/data/             # targets.json, earth_candidates.json, analogs_*.geojson, similarity_*.png
  src/                     # Cesium: main.js, layers.js, ui.js
```

1. **Hours 0-2:** one hero target for the Moon (Shackleton) and one for Mars (Jezero), the schema, a 7-chapter storyboard, and mock data for the interface.
2. **Hours 2-12:** A and B fetch data and compute features; C builds the globe, the body switch and the layers on mock data.
3. **Hours 12-20:** first full end-to-end integration for one target, and validation against known NASA sites.
4. **Hours 20-28:** Mars through the same pipeline, sliders and popups, vegetation as a filter, and Story mode.
5. **Hours 28-36:** polish, Methods page, recorded demo video, and the pitch. The 3D mesh only if time is left.

## Risks, fallbacks and scientific limits

| Risk | Fallback |
| --- | --- |
| The Trek server slows down or goes down during the presentation | A small local basemap per body, and a recorded demo video |
| Downloading large datasets wastes time | A bounded region per target, and Earth Engine instead of downloading files |
| Different resolutions across bodies | A unified grid and documented resampling |
| Mars is not finished | Mars is shown as visual layers, and full similarity becomes "future work" |
| Animations and meshes take time | They stay the lowest priority; the core is the globe, similarity and validation |

**Scientific limits that must be stated in the pitch:** similarity here is in terms of terrain, temperature, minerals and aridity, not gravity, radiation or vacuum. No place on Earth reproduces the extreme temperature swings that happen within a single day on Mars. Any new candidate (for example in Egypt) must be described as our result, not NASA-validated.
