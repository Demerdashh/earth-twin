# AnalogLens: presentation script (about 3:30)

Two speakers (**A** and **B**), with the live site and slides on screen. At a calm pace of about
145 words a minute this runs 3:20 to 3:40. Every number comes from the published final run
(`public/data/`: DINOv2, 5,140 Earth tiles, generated 2026-11-15).

---

### 0:00 to 0:20 · Hook (A)
**[SCREEN: site preloader, then Earth alone, slowly spinning]**

**A:** In the 1960s, an Egyptian geologist, Farouk El-Baz, helped NASA choose where Apollo would land
on the Moon, and he trained the astronauts to read the ground. The next landings are on Mars and at
the Moon's south pole. We built AnalogLens to help choose where on Earth to rehearse them.

### 0:20 to 0:45 · The problem (B)
**[SLIDE 2: Problem]**

**B:** No place on Earth is like Mars in every way. Teams keep going back to the same handful of
famous analog sites. And "it looks like Mars" is the wrong question: a rover team and a wind-erosion
scientist need different things from the same ground. So we ask three questions: what matches,
how well, and where does the analogy break?

### 0:45 to 1:20 · How it works (A)
**[SLIDE 4: How. Then the site: travel from Earth to Mars and dive into Medusae Fossae]**

**A:** AnalogLens puts Earth and Mars on the same grid: 463 metres per pixel, in tiles 30 kilometres
across. From NASA's MOLA elevation data for Mars and NOAA's ETOPO 2022 for Earth, we measure slope,
roughness, relief and wind-aligned texture. On top of that, a vision model, DINOv2, compares the
shape of the terrain itself.
Our first target is Medusae Fossae, the wind-carved yardangs of Mars. We scored 5,140 Earth tiles
across North Africa and Arabia, separately for each mission task.

### 1:20 to 2:05 · What we found (B)
**[SITE: back to Earth, ranked tiles light up; choose Wind-erosion science, open tile #1]**

**B:** For wind-erosion science, the number-one match out of 5,140 tiles is in Egypt's Western
Desert, about 130 kilometres east of the Gilf Kebir plateau. It scores 0.90, and its wind-aligned
texture reads 0.135 against 0.152 for Medusae Fossae.

**[SITE: switch the task to Rover mobility, open tile #1]**

**B:** Switch to rover mobility and the list reorders. The top tile, in the central Sahara near the
Niger–Libya border, scores 0.95. Its average slope is 1.165 degrees; Mars's is 1.167. Its
roughness is 9.96 metres against 9.98.

**[SITE: zoom out over Egypt with the ranked tiles visible]**

**B:** Egypt is not a one-off. It holds 14 of the top 50 tiles for rover mobility and 16 for wind
erosion, and that same Western Desert tile ranks fourth for rovers as well. Every one of the top 50,
in both tasks, is more than 1,800 kilometres from any site on the established analog list. These are
new candidate analogs, not the usual suspects.

### 2:05 to 2:40 · The fingerprint card (A)
**[SITE: the open card. Point at the bars, then the side-by-side images, then the breaks box]**

**A:** Every result comes with a fingerprint card. The bars show each dimension: what matches and by
how much. The Earth tile and the Mars target sit side by side, at the same scale. The card also says
plainly where the analogy breaks: 0.38 g instead of 1 g, and an atmosphere about one percent as
dense. Then it suggests what you could actually test there: measure yardang erosion rates, or
calibrate rover cameras on wind-carved rock.

### 2:40 to 3:10 · Checking ourselves, and what's next (B)
**[SLIDE 5: Proof, then SLIDE 7: Impact and limits]**

**B:** We also check ourselves against known analogs. Iran's Lut Desert yardangs land in the top fifth
for rover mobility, and the site shows the rank of every known site openly. At 30-kilometre tiles
we see terrain texture, not single yardangs, so the next step is to zoom in on the Egypt candidates
with finer elevation data, and then to run the Moon's south pole, which is already configured.

### 3:10 to 3:30 · Close (A, then both)
**[SITE: travel back to Earth, which ends whole and centred; then the logo and the link]**

**A:** One page and real data only: Earth, the Moon and Mars in one scene, at their true relative
sizes. AnalogLens doesn't just tell you that a place looks like Mars.

**B:** It tells you which test that place is good for.

**A + B:** And where it will mislead you.

---

## Notes for the team (not to be read aloud)

**Check before recording**
- **El-Baz:** "helped choose where Apollo landed and trained the astronauts" is the commonly cited
  version. Check the exact wording against the source in the prep kit.
- **Place names:** the rover #1 tile (NE02820) is at 23.22°N, 15.15°E, and the wind #1 tile
  (NE02862) is at 23.22°N, 27.46°E. Check both on a map before saying "Niger–Libya border" and
  "130 km east of Gilf Kebir".
- **Tile extent:** check that "North Africa and Arabia" matches the bbox you cut.

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
