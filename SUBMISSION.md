# AnalogLens: submission text

Copy each section into its field. Every number comes from the team's final run (`public/data/`,
generated 2026-11-15) or from `config/`.

---

## High-level project summary

AnalogLens finds the places on Earth where Mars missions can rehearse, and explains each match.
Most analog searches stop at "this place looks like Mars". AnalogLens ranks Earth locations for a
specific mission task and scores every dimension separately: terrain shape, slope, roughness, relief
and wind-aligned texture. Earth and Mars are cut on the same 463 m grid from NASA's MOLA elevation
data and NOAA's ETOPO 2022, and a vision model (DINOv2) compares the shape of the terrain. For the
wind-carved yardangs of Medusae Fossae on Mars, we scored 5,140 Earth tiles, 30 km across, in
northeast Africa and western Arabia. The best wind-erosion match is in Egypt's Western Desert
(score 0.90). The best rover-mobility match, in the central Sahara, has an average slope of 1.165°
against 1.167° on Mars. Every result comes with a fingerprint card: what matches, how well, where the
analogy breaks, and which field tests the place suits. The results are shown on one interactive 3D
scene of Earth, the Moon and Mars, built from NASA imagery.

---

## Detailed project description

### What it does

Space agencies test rovers, instruments and crews on Earth before they go to Mars or the Moon. No
place on Earth is like Mars in every way, and teams keep going back to the same few famous analog
sites. The question "does this place look like Mars?" is also too broad. A rover team cares about
slope and roughness. A wind-erosion scientist cares about wind-carved ridges. The same ground can be
excellent for one job and useless for the other.

AnalogLens answers three questions for every place it ranks: what matches, how well, and where the
analogy breaks. You choose a target on Mars and a mission task, and AnalogLens ranks thousands of
Earth tiles for that task. Each top result gets a fingerprint card that explains the score one
dimension at a time.

### How it works

1. **One grid for both planets.** Mars and Earth elevation are resampled to the same metric grid:
   64 × 64 pixels at 463 m per pixel, which makes tiles about 30 km across. The Mars target is cut
   from the Mars Global Surveyor MOLA elevation model (MEGDR, 128 pixels per degree). Earth tiles come
   from NOAA's ETOPO 2022 at 15 arc-seconds. We screened 15–30°N, 15–45°E with a 30 km step, which
   gives 5,140 Earth tiles over about 4.6 million km² of northeast Africa and western Arabia.
2. **Measurable terrain dimensions.** For every tile we compute the median slope, roughness (terrain
   ruggedness index), total relief and wind-aligned texture (how strongly the terrain runs in one
   direction). Each one is scored from 0 to 1 by how close it is to the Mars value. Roughness and
   relief are compared on a log scale.
3. **Terrain shape from a vision model.** Each tile is rendered as a shaded-relief image and
   embedded with DINOv2 (ViT-S/14). Embeddings are averaged over four 90° rotations, so a ridge field
   running north–south still matches one running east–west. The cosine similarity to the Mars target
   becomes a calibrated 0–1 terrain-shape score.
4. **Task-specific scoring.** Each mission task weights the dimensions differently:
   - Rover mobility: terrain shape, slope, roughness and relief.
   - Wind-erosion science: terrain shape and wind-aligned texture.

   Scores are combined with a weighted geometric mean, so one poor dimension pulls the total down
   instead of being averaged away. Missing data lowers the coverage figure and never counts as a
   match.
5. **Novelty and validation.** A result more than 200 km from every site on our list of 14
   established analog sites is flagged as a candidate new analog. Tiles cut around the known sites
   show where those sites land in each ranking, and the rank of every known site is reported openly.
6. **Fingerprint cards.** The top 50 tiles for each task get a card (100 cards in total).

### What we found

- **Wind-erosion science:** the number-one match of 5,140 tiles is in Egypt's Western Desert
  (23.2°N, 27.5°E), about 160 km east of the centre of the Gilf Kebir plateau. It scores 0.90, and its
  wind-aligned texture is 0.135 against 0.152 for Medusae Fossae. Four of the top ten wind-erosion
  tiles are in Egypt. One of them, ranked 13th, lies about 120 km from the Kharga Depression, whose
  yardangs USGS field studies compared with Mars.
- **Rover mobility:** the top tile, in the central Sahara near the Niger–Libya border (23.2°N, 15.2°E),
  scores 0.95. Its average slope is 1.165° against 1.167° on Mars, its roughness 9.96 m against
  9.98 m, and its relief 294 m against 256 m.
- **Egypt stands out:**
  - It holds 14 of the top 50 tiles for rover mobility and 16 of the top 50 for wind erosion.
  - The Western Desert tile that wins wind erosion also ranks fourth for rover mobility.
- **The task changes the answer:** only 24 tiles appear in both top-50 lists. The other 26 in each
  list suit one job and not the other.
- **Strong on every dimension:** among the top 50, 16 wind-erosion tiles and 8 rover-mobility tiles
  score 0.7 or more on every dimension they were scored on.
- **New candidates:** every one of the top 50 tiles, in both tasks, is more than 1,800 km from any
  site on the established analog list. These are candidate new analog sites to confirm in the field.
- **Validation:** among the known analog sites, Iran's Lut Desert yardangs land in the top fifth of
  all tiles for rover mobility.

### The fingerprint card

Each card shows:
- The task and the overall score.
- One bar per dimension, with its weight, its score and the Earth value next to the Mars value.
- The Earth tile and the Mars target side by side, as shaded relief at the same scale.
- What the place is strong for.
- Where the analogy breaks, with the fixed differences no Earth site can copy:
  - About 0.38 g instead of 1 g.
  - An atmosphere about 1% as dense as Earth's, mostly carbon dioxide.
  - No global magnetic field to shield the surface from radiation.
  - No stable liquid water on the surface today.
- Field tests that suit the place, for example:
  - Measure yardang shapes and erosion rates and compare them with Martian ones.
  - Calibrate rover cameras on wind-carved layered rock.
  - Drive a prototype rover across slopes like the target's and log wheel slip.
  - Plan traverses from orbital-resolution maps, then check them on the ground.
- Whether the place is near a known analog site or is a candidate new one.

### The website

The site is a single interactive 3D scene with Earth, the Moon and Mars at their true relative sizes
(the distances are compressed).
- Earth uses NASA's Blue Marble Next Generation by day, VIIRS Black Marble city lights on the night
  side and a land mask for sun glint on the oceans.
- The Moon and Mars blend NASA Trek colour mosaics with LOLA and MOLA hillshade.
- You can fly between the bodies, dive into any target, known analog site or Egypt site, and open the
  ranked tiles and their fingerprint cards.
- When you rest close to a surface, NASA tiles stream in at screen resolution for exactly the area
  on screen, including the poles.
- It works with the keyboard and includes a guided tour.
- It shows real data only: any file marked synthetic is refused, malformed output is rejected with the
  file and field named, and nothing is shown as a score unless it comes from the pipeline.
- Approximate coordinates are flagged on screen.

### Benefits

- **Mission and field-test planners** get a ranked shortlist for a specific task, with the reasons
  and the gaps written out, instead of a single "Mars-like" label.
- **Researchers** get candidate analog sites outside the usual handful, with the measurements to
  check them.
- **Egypt and the region** gain a data-backed case for the Western Desert as a Mars analog for
  wind-erosion science and rover testing. The case follows on from the work of the Egyptian
  geologist Farouk El-Baz, who helped NASA choose the Apollo landing sites.
- **Students and the public** see what makes two places alike, and what can never be alike between a
  planet and its analog.
- **Others can extend it** without changing code: targets, tasks, dimensions, body limits and known
  sites all live in JSON configuration.

### Limits, stated openly

- The score is a similarity, not a probability.
- At 463 m per pixel the terrain comparison sees texture over 30 km. It does not see single yardangs,
  dunes or boulders.
- Known analog sites inside our screened region are few, so we report each known site's rank rather
  than one headline accuracy number.

### What's next

- Zoom in on the Egypt candidates with finer elevation data.
- Add climate dimensions (dryness, dust and temperature range) from NASA MODIS and MERRA-2.
- Run the targets already configured:
  - On the Moon's south pole: Shackleton crater rim, Malapert Massif and Haworth.
  - On Mars: Jezero crater and Arcadia Planitia.
  - With the ice-prospecting and base-construction tasks.

### Tools, languages and software

- **Pipeline:** Python 3.11 with NumPy, SciPy, Pillow and rasterio. PyTorch and DINOv2 ViT-S/14 for
  terrain embeddings. FastAPI for an optional offline API. uv for pinned dependencies.
- **Compute:** Google Colab (GPU) and Google Drive for checkpoints.
- **Website:** TypeScript, three.js and Vite. Tested with Vitest and Playwright; linted with ESLint
  and Prettier.
- **Hosting:** Vercel, with source on GitHub (https://github.com/Demerdashh/earth-twin).

---

## NASA data

| Dataset | Provider | Used for |
| --- | --- | --- |
| MGS MOLA Mission Experiment Gridded Data Record (MEGDR), 128 pixels per degree, tile `megt44n180hb` | NASA Planetary Data System, Geosciences Node | **Scored.** Elevation of the Medusae Fossae target (terrain shape, slope, roughness, relief, wind-aligned texture). https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg128/ |
| Mars Odyssey THEMIS image PIA03770 (Medusae Fossae yardangs) | NASA Photojournal (NASA/JPL/ASU) | Location of the Mars target (11°N, 159°W). https://photojournal.jpl.nasa.gov/catalog/PIA03770 |
| Blue Marble Next Generation (true colour) | NASA Earth Observatory via NASA GIBS | Display: Earth by day. https://gibs.earthdata.nasa.gov |
| VIIRS Black Marble 2016 (night lights) | NASA Earth Observatory via NASA GIBS | Display: Earth's night side. https://gibs.earthdata.nasa.gov |
| OSM Land Mask | NASA GIBS (built from OpenStreetMap data) | Display: sun glint on Earth's oceans. https://gibs.earthdata.nasa.gov |
| LRO WAC Global Mosaic, 303 ppd v02 | NASA/GSFC/ASU via NASA Moon Trek | Display: Moon colour. https://trek.nasa.gov/moon |
| LRO LOLA Global Hillshade, 256 ppd v06 | NASA/GSFC via NASA Moon Trek | Display: Moon relief shading. https://trek.nasa.gov/moon |
| Viking MDIM 2.1 Colour Mosaic, 232 m | NASA/USGS via NASA Mars Trek | Display: Mars colour. https://trek.nasa.gov/mars |
| MGS MOLA Colour Hillshade, 463 m | NASA/GSFC via NASA Mars Trek | Display: Mars relief shading. https://trek.nasa.gov/mars |
| Mars and Moon facts (Mars atmosphere about 1% of Earth's density; Moon 54 °C in sunlight to −203 °C in shadowed craters) | NASA JPL and NASA's Moon Base page | Text of the fixed limits on every fingerprint card |

## Other agencies' data

| Dataset | Provider | Used for |
| --- | --- | --- |
| ETOPO 2022 Global Relief Model, 15 arc-second surface elevation: tiles `N30E015` and `N30E030` (screening region) and `N45E045` and `N45W120` (around known analog sites) | NOAA National Centers for Environmental Information (NCEI) | **Scored.** Elevation of all 5,140 Earth tiles and of the validation tiles at known analog sites. https://www.ncei.noaa.gov/products/etopo-global-relief-model |
| OpenStreetMap land polygons (inside NASA GIBS's OSM Land Mask) | OpenStreetMap contributors | Display only: ocean sun glint |
| Viking MDIM 2.1 (co-produced) | U.S. Geological Survey (USGS) Astrogeology | Display only: Mars colour (with NASA, see above) |
| DINOv2 ViT-S/14 pretrained model weights | Meta AI (open source) | Terrain-shape embeddings (a model, not a dataset) |

## References

- USGS field studies of yardangs and wind-cut channels in the Kharga Depression, Egypt, compared with
  Mars (Breed et al., 1984).
- Oquab et al., "DINOv2: Learning Robust Visual Features without Supervision" (Meta AI, 2023).
