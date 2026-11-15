# AnalogLens: presentation script (about 5:00)

Two speakers (**A** and **B**), with the live site and slides on screen. 744 spoken words: at about
150 words a minute this runs 5:00 (5:08 at 145). Every number comes from the published final run
(`public/data/`: DINOv2, 5,140 Earth tiles, generated 2026-11-15) or from `config/`.

---

### 0:00 to 0:25 · Hook (A)
**[SCREEN: site preloader, then Earth alone, slowly spinning]**

**A:** In the 1960s, an Egyptian geologist, Farouk El-Baz, helped NASA choose where Apollo would land
on the Moon, and he trained the astronauts to read the ground. The next landings are on Mars and at
the Moon's south pole. Before anyone goes, rovers, instruments and crews rehearse on Earth. We built
AnalogLens to help choose where those rehearsals should happen.

### 0:25 to 0:55 · The problem (B)
**[SLIDE 2: Problem]**

**B:** No place on Earth is like Mars in every way. Teams keep going back to the same handful of
famous analog sites. And "it looks like Mars" is the wrong
question. A rover team cares about slope and roughness. A wind-erosion scientist cares about
wind-carved ridges. The same ground can be perfect for one and useless for the other. So for every
place we ask three questions: what matches, how well, and where does the analogy break?

### 0:55 to 1:45 · How it works (A)
**[SLIDE 4: How. Then the site: travel from Earth to Mars and dive into Medusae Fossae]**

**A:** AnalogLens puts Earth and Mars on the same grid: 463 metres per pixel, in tiles 30 kilometres
across. For Mars we use NASA's MOLA elevation data; for Earth, NOAA's ETOPO 2022. For each tile we
measure slope, roughness, relief and wind-aligned texture. On top of that, a vision model, DINOv2,
compares the shape of the terrain itself. We average it over four rotations,
so a ridge pointing north still matches one pointing east.
Each mission task weights those dimensions differently, and we combine them with a geometric mean,
so one bad dimension drags the whole score down. Missing data never counts as a match.
Our first target is Medusae Fossae, the wind-carved yardangs of Mars. We scored 5,140 Earth
tiles across North Africa and Arabia, for two tasks: wind-erosion science and rover mobility.

### 1:45 to 3:05 · What we found (B, then A)
**[SITE: back to Earth, ranked tiles light up; choose Wind-erosion science, open tile #1]**

**B:** For wind-erosion science, the number-one match out of 5,140 tiles is in Egypt's Western
Desert, about 130 kilometres east of the Gilf Kebir plateau. It scores 0.90. Its wind-aligned
texture reads 0.135; Medusae Fossae reads 0.152. Four of the top ten wind-erosion tiles are in
Egypt, and one of them, ranked 13th, sits about 120 kilometres from the Kharga Depression, whose
yardangs the USGS compared with Mars in the 1980s.

**[SITE: switch the task to Rover mobility, open tile #1]**

**A:** Switch to rover mobility and the list reorders. The top tile, in the central Sahara near the
Niger–Libya border, scores 0.95. Its average slope is 1.165 degrees; Mars's is 1.167. Its
roughness is 9.96 metres against 9.98.

**[SITE: zoom out over Egypt and the Sahara with the ranked tiles visible]**

**B:** Three patterns stand out. First, Egypt is not a one-off: it holds 14 of the top 50 tiles for
rovers and 16 for wind erosion, and the Western Desert tile that wins wind erosion also ranks fourth
for rovers.
Second, the task matters. Only 24 tiles appear in both top-50 lists; the other 26 in each are
good for one job and not the other.
Third, every one of the top 50, in both tasks, is more than 1,800 kilometres from any site on the
established analog list. These are new candidate analogs, not the usual suspects.

### 3:05 to 3:45 · The fingerprint card (A)
**[SITE: the open card. Point at the bars, then the side-by-side images, then the breaks box]**

**A:** Every result comes with a fingerprint card. The bars show each dimension: its weight, its
score, and the Earth value next to the Mars value. The Earth tile and the Mars target sit side by
side, at the same scale. The card also says plainly where the analogy breaks: 0.38 g instead of 1 g,
an atmosphere about one percent as dense, no magnetic field against radiation, and no stable liquid
water. Then it suggests what you could actually test there: measure yardang erosion rates, calibrate
rover cameras on wind-carved rock, or train hazard detection.

### 3:45 to 4:15 · The site (B)
**[SITE: guided tour. Earth to the Moon, then to Mars; hover the dotted areas]**

**B:** The site is one 3D scene with Earth, the Moon and Mars at their true relative sizes, built
from NASA imagery: Blue Marble by day, Black Marble city lights at night, and Moon and Mars Trek
mosaics. Dive into any place and live NASA tiles stream in at screen resolution. It shows real data
only: anything marked synthetic is refused.

### 4:15 to 4:40 · Checking ourselves (B)
**[SLIDE 5: Proof]**

**B:** We also check ourselves against known analogs. Iran's Lut Desert yardangs land in the top fifth
for rover mobility, and the site shows the rank of every known site openly. At 30-kilometre tiles we
see terrain texture, not single yardangs, so the next step is to zoom in on the Egypt candidates with
finer elevation data.

### 4:40 to 5:00 · What's next, and close (A, then both)
**[SLIDE 7: Impact and limits, then the logo and the link]**

**A:** Everything is driven by configuration. The Moon's south pole is already set up: Shackleton,
Malapert and Haworth, plus Jezero and Arcadia Planitia on Mars, with ice prospecting and base
construction as tasks. AnalogLens doesn't just tell you that a place looks like Mars.

**B:** It tells you which test that place is good for.

**A + B:** And where it will mislead you.

---

## Notes for the team (not to be read aloud)

**Check before recording**
- **El-Baz:** "helped choose where Apollo landed and trained the astronauts" is the commonly cited
  version. Check the exact wording against the source in the prep kit.
- **Place names:** the rover #1 tile (NE02820) is at 23.22°N, 15.15°E, the wind #1 tile (NE02862) at
  23.22°N, 27.46°E, and the wind #13 tile (NE03516) at 25.11°N, 29.43°E. Check all three on a map
  before saying "Niger–Libya border", "130 km east of Gilf Kebir" and "120 km from Kharga".
- **Kharga and the USGS:** DECISIONS.md cites Breed et al. 1984. Check the year and the wording.
- **Tile extent:** check that "North Africa and Arabia" matches the bbox you cut.
- **Configured targets:** the Moon and the extra Mars targets are in `config/`, but no pipeline run
  has used them yet. Say "set up", never "results".

**Left out on purpose** (have an answer ready if a judge asks)
- **Headline AUC:** 0.42 for wind erosion and 0.51 for rover mobility, with only 2 matching known
  sites. DECISIONS.md already says we report per-site ranks with n, not an AUC.
- **Death Valley** ranks only in the middle of both lists.
- **Ablation:** removing terrain shape did not lower the AUC. So the script presents DINOv2 as one
  dimension among several, never as the reason the method works.
- **Aridity and dust** have weights in `tasks.json` but were not scored in the final run. The
  script never claims them.

**Why the "novel" line is fair:** no top-50 tile is within 1,800 km of a known analog site. Most known
sites lie outside the screened region, so if asked, describe these as candidates to confirm, not
as discoveries.
