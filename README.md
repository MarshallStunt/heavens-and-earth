# Heavens & Earth

Chrome extension: an interactive 3D flat-earth explorer. The disc is a live satellite map (or Gleason's New Standard
Map of the World, 1892) with real terrain and clouds, ringed by the Antarctic ice wall under a spherical firmament. Real
fixed stars sit on the outside of the dome; a 32-mile Sun and Moon circle about 3,000 miles up, carried by a hub torus
field; the zodiac, the five classical planets, the live ISS, eclipses, the aurora and a Religious texts overlay complete it.

Gleason map scan: Leventhal Map & Education Center (Boston Public Library), no known copyright restrictions.
Sun, Moon and planet positions come from astronomy-engine (via `astro.js`); see Astronomy below.

## Install
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Click the Heavens & Earth toolbar icon to open the dashboard in a new tab.

## Controls
- Drag to orbit, scroll to zoom, click the disc (or the overhead map) to drop a pin.
- Top bar: the clock, **Now**, play / pause (Space) and the speed.
- **Left panel — what you see**, in the order you'd set it: View (camera presets), Time, Earth (map, terrain, clouds),
  Layers (grouped: Sky & firmament · Sun & Moon · Earth & above · Symbols · Display), Trails, Aurora, Religious texts,
  Settings (save, load, reset) and The model.
- **Right panel — what's happening**: the live tiles (Sun, Moon, season, zodiac), then your place (Pin, Overhead map,
  Daylight hours), the Sun analemma, Eclipses, Wandering stars, ISS, Torus field and the Pattern lab.
- Long explanations sit behind **ⓘ More about this**; in Religious texts each tradition's list folds on its own (all
  folded when showing all texts together).

three.js 0.160.0 is bundled in `lib/` (MV3 extensions can't load remote scripts).

## ISS data
- Primary: NASA/JSC's official ISS trajectory (CCSDS OEM, J2000 state vectors every 4 minutes, ~15 days),
  `nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt`, refreshed every 6 h.
  Interpolated with 8-point Lagrange (metre-level), converted J2000 → true-of-date (IAU-76 precession + nutation) → geodetic.
- Outside NASA's window: SGP4 from CelesTrak's TLE (refreshed every 2 h), time-shifted so it continues seamlessly from NASA's data.

**The real ISS:** the ISS is shown exactly as it is, from live data (NASA's precise trajectory; CelesTrak elements as a
backup). Over the map it sits exactly on its real position, at its real altitude (257–272 mi above the surface, on the map's
real north–south scale — the same as the scale bar), with a line down to the point beneath it. The station is a true-scale
model of its main structure — the 109 m integrated truss, eight 34 × 12 m solar-array wings and 73 m of pressurised
modules — flying as the real ISS does (modules along the direction of travel, truss across it). From afar a glowing marker
shows where it is; zoom in, or press **Follow the ISS (real size)** in the ISS panel, to see the station. Its trail and the
Pattern Lab's ISS paths (1–30 days) are the real path at the real altitude. Measured: position within ~1 mi of independent
live data, altitude within 0.2 km.

## Fixed stars
**Layers → Fixed stars (outside the dome)**, on by default: 75 real stars on the outside of the firmament, fixed to it and
turning with it once a sidereal day. They include the brightest stars and the stars of Orion, the Plough, Cassiopeia,
the Southern Cross, the Summer Triangle, the Square of Pegasus, Cygnus and Scorpius' tail, with lines joining them.
Positions are J2000 right ascension and declination: each star sits straight above the point on the map it passes
over, so its declination is that latitude. Precession since 2000 is about 0.4°. Brighter stars are drawn larger, in
their real colours, and the brightest are named. The old random "Star wheel" is a separate switch, off by default.

## Religious texts
**Layers → Religious texts** shows the cosmos as each tradition describes it, one at a time or **all together** (off by
default). The panel lists every element with its reference, and a live readout ties the texts to today's real sky.

| Tradition | Drawn | Live |
|---|---|---|
| **Bible** | waters above (Gen 1:7), windows of heaven (Gen 7:11), throne (Ezek 1:26), pillars of heaven (Job 26:11), storehouses of snow (Job 38:22), pillars of the earth (Job 9:6) in the great deep (Gen 7:11), four corners (Rev 7:1) | the boundary of light and darkness (Job 26:10) is the real day–night line; the Sun's circuit (Ps 19) |
| **Talmud** | seven named firmaments, Vilon to Aravot, and twelve pillars (Chagigah 12b) | — |
| **Book of Enoch** | six sun portals (72), twelve wind portals (76), seven mountains of precious stones (18:6–9) | Sun's and Moon's portal; day of the 364-day year |
| **Quran** | seven heavens (67:3), Kursi (2:255), Throne (23:86), seven earths (65:12), mountains as pegs (78:7) | Sun's and Moon's orbits (36:40); Moon's mansion of 28 (10:5) |
| **Hindu Puranas** | Meru, Lokāloka, Dhruva, the four guardians' cities, the heights of Moon, stars and planets (BhP 5.16–5.23) | chariot wheel and axle on the Sun (5.21.13); Sun's sidereal sign |
| **Bhagavad Gita** | the eternal aśvattha with roots above and branches below (15.1); Meru (10.23); the supreme abode beyond the firmament (15.6) | the two paths (8.24–25): today's Sun circle gold in its northern course and grey in its southern, the Moon's bright when waxing; the Sun and Moon as the eyes of the universal form (11.19); the Moon's light nourishing the plants (15.13); the lunar month and season (10.35) |
| **Buddhist** | Sumeru with its four coloured faces, seven golden rings, four continents, Cakravāla (Abhidharmakośa 3) | Sun's ring at half Sumeru's height |
| **Jain** | 184 sun circles (Sūryaprajñapti) | second Sun and Moon opposite the real ones; today's circle |
| **Zoroastrian** | Harā/Alborz, central peak, star → moon → sun stations, Endless Light (Bundahishn) | Sun's window of 180 |
| **Norse** | four dwarves holding the sky, Jörmungandr, Yggdrasil, Bifröst (Gylfaginning) | Sköll and Hati behind the real Sun and Moon |
| **Egyptian** | Nut arched over the dome, Shu, the Duat path below (Book of Nut, Amduat) | Ra's barque carries the Sun; day or Duat at Luxor |
| **Mesopotamian** | Tiamat's bar and guards, east and west gates (Enūma Eliš IV–V) | 36 stars (three a month) turning with the sky; Moon's day |
| **Chinese** | square earth, 28-ribbed canopy, seven sun paths (Zhoubi suanjing) | Sun's path gap; current solar term |
| **Freemasonry** (lodge symbolism) | the lodge as the world: an oblong square due east–west on a mosaic pavement with indented tessel; three great pillars, Wisdom (Ionic, East), Strength (Doric, West) and Beauty (Corinthian, South); Boaz and Jachin with globes; the altar; the blazing star; Jacob's ladder (Faith, Hope, Charity) to a starry canopy of many colours; the All-Seeing Eye | the officers follow the real Sun over London, from rising in the East through high twelve in the South to setting in the West; the point within a circle uses the solstice circles and today's Sun circle |
| **Santos Bonacci** (Syncretism; a modern teacher) | seven layers inside the dome, outer to inner Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon (the classical Chaldean order), each body a flat disc stuck to its layer in the direction of its real place in the sky (with this layer on, the round Sun and Moon are hidden, so these flat discs are the Sun and Moon; daylight, night and eclipses still follow their real positions); stars as openings in the firmament; a luminous, magnetic, invisible Mount Meru at the pole; the zodiac man (as above, so below), Aries the head to Pisces the feet; the Christos rising up the spine to the pineal | the "tabernacle of the Sun": the real Sun's path for the next year, breathing out to Capricorn and in to Cancer; the real figure-8 with its computed crossing (8.9°; he gives about 8.5°); the body parts lit by the Sun's and Moon's real signs |

Notes:
- **Enoch's portals:** Enoch has the Sun spend one month in each portal on either side of a solstice. The band edges
  are therefore the Sun's real declination 30 and 60 days from an equinox (±11.5°, ±20.1°). Checked month by month:
  4→5→6→6→5→4→3→2→1→1→2→3.
- **Directions:** where a text needs a compass direction on this pole-centred map, its homeland sets it. India is due
  south of Meru and Sumeru; the east–west line runs through Egypt or Babylon.
- **Puranic scale:** heights above the Sun are compressed so that Dhruva sits at the top of the dome.
- **Buddhist scale:** the iron ring meets the map's rim.
- **What's left out:** passages the sources disagree on are noted rather than drawn, such as the moon-to-stars
  distance (200,000 or 300,000 yojanas). Passages with no clear placement are left undrawn, such as Gonggong and
  Pesachim 94b.

- **Freemasonry:** Freemasonry says it is not a religion, so this layer shows the symbols of the lodge from its
  lectures, not a doctrine of the cosmos. The solstice reading of the point within a circle comes from 19th-century
  Masonic writers (attributed to Mackey); the lecture's own reading is the two Saints John. The globes on Boaz and Jachin
  are a later Masonic addition, and which globe sits where varies.

- **Santos Bonacci:** he is a modern teacher, not a scripture. His own lectures weren't available to check, so only ideas
  that published summaries attribute to him are drawn. Pairings of the twelve tribes and disciples with the signs vary
  between sources, so they're listed, not drawn.

These are literal readings; most scholars in each tradition read the passages as poetic, symbolic or written from an
observer's view. Sizes the texts don't give are the model's choices. The overlay changes nothing real: the Sun, Moon,
ISS, eclipses, clouds and map are the same live data.

## The Moon's real path
The Pattern Lab draws the Moon's exact path over the Earth for **1 day**, **1 month (27.3 days)**, **1 year** and the
**18.6-year** nodal cycle. Every point is the same position the live Moon uses (ELP/MPP02 via astronomy-engine), sampled
every 2 min (day), 10 min (month, year) or 90 min (18.6 yr). Measured: each point is 0 mi from the ephemeris; the
straight segments between points cut corners by at most 0.07 mi (day) and 1.8 mi (month, year). Cross-checked with NASA JPL Horizons at 24 instants across 2026: live Moon within 0.07 mi, drawn line within 1.5 mi. Over a month the path
swings between its northern and southern limits (in 2026 they shrink from ±28.4° in Feb–Mar to ±27.6° in December,
as the 2024–25 major lunar standstill fades); over 18.6 years those limits range from ±18.3° to
±28.7°. The 1-year and 18.6-year paths (52,000 and 109,000 points) are built in the background with a progress note,
so the page never freezes. Only the path is real; the Moon's height and size in the dome are still the model's.

## Astronomy
- Sun, moon and planets: astronomy-engine 2.1.19 (MIT, `lib/astronomy.browser.min.js`) — VSOP87 planets, ELP/MPP02 moon,
  IAU 2000B nutation, light-time and aberration. Apparent positions of date. Checked against JPL Horizons (2025–2030):
  sun 1″, moon 3.5″, planets 3–18″; zodiac signs from apparent ecliptic longitude of date (tropical); belt drawn on the
  true ecliptic of date; GAST within 0.2″ of an independent formula; 2026 equinoxes/solstices within 1 min of USNO.
- Analemma: the sun's topocentric altitude/azimuth (with refraction) at the pin, same local mean time daily.

## Maps
- **Satellite (default): EOxCloudless 2025** — a cloud-free Sentinel-2 mosaic of the whole Earth, streamed as you look.
  The disc shader turns every point back into its latitude/longitude and samples the tiles directly (they are on a plain
  lat/lon grid), so nothing is resampled twice. The whole Earth loads once at ≈ 4.9 km per pixel (512 tiles); scroll to zoom
  in where the pointer is and a 4,096-px window around the view sharpens down to ≈ 10 m per pixel (Sentinel-2's own
  resolution), roughly 12 mi across the screen at the closest zoom. Near the North Pole every longitude meets, so the window
  there covers the whole ring and stays coarser (≈ 2.4 km per pixel). Tiles are cached by the browser for a week.
  Imagery: EOxCloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025),
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — free for non-commercial use with attribution.
- NASA Blue Marble (public domain), re-projected to the same pole-centred azimuthal-equidistant disc as Gleason's map —
  bundled, shown until the satellite tiles arrive and whenever they can't be reached (offline).
- Gleason's New Standard Map of the World (1892), Leventhal Map & Education Center.

## Terrain (real mountains and valleys)
- Heights from the open AWS Terrain Tiles (Terrarium: SRTM, GMTED2010, ETOPO1, NED and others). The whole Earth loads once
  at ≈ 20 km per pixel; when you zoom in, a 512 × 512 height window under the satellite-detail area is filled from the
  matching zoom (down to ≈ 10 m) and drawn as a fine patch mesh.
- The disc is a fine polar mesh raised by the height in its shader; slopes are lit from the elevation itself, so ridges and
  valleys catch the sun. *Terrain height* ×1 is true scale (Everest 8.85 km ≈ 0.0044 map units) — relief shows best close
  up; raise it (to ×50) to see it from afar. The night shading follows the terrain.
- Oceans and lakes sit at sea level (sea-floor depths are not drawn; land below sea level, e.g. the Dead Sea shore, is
  flattened to sea level). Near the North Pole the zoom window is skipped, so relief there stays at the global resolution.


## The Sun's yearly path (analemma)
The Sun rides a straight slope (default 42.5° from the vertical; adjustable 32°–89° with **Sun path tilt** in the Analemma panel — 32° = steepest, 89° ≈ flat; the Sun's real yearly size change would imply ≈ 88.3°): **highest on its small circle at the Tropic of Cancer in June**
(radius 4,615 mi, 4,773 mi up — closest to the centre) and **lowest on its big circle at the Tropic of Capricorn in
December** (radius 7,865 mi, 1,227 mi up — farthest from the centre), passing the equator circle (6,240 mi, 3,000 mi up) at
the equinoxes, Aries (≈ 20 Mar) and Libra (≈ 22 Sep). Its height depends only on how far north it is, going north or south
alike. At the same clock time each day the Sun traces the analemma on that slope;
the figure-8 crosses itself at **+8.9°** declination (≈ 12 April and 30 August, computed from the ephemeris). All five
points are marked on the 3D analemma and the chart, and the slope guide (Cancer, equator and Capricorn rings) is shown
with the analemma. Eclipses are unchanged by the new heights (2024–2030: 32 of 32 match the real catalogue).

## Daylight, night and time (checked against the real sky)
- **Day/night shading** uses the real Sun's height over each spot (standard sunrise −0.833°, twilight to −18°): sunrise and
  sunset match Astronomy Engine to ~1 s (max 15 s over 1,026 events in 10 cities), polar day/night 34 of 34.
- **Sunlight on the ground and mountains** comes from the real Sun's height and direction at each spot (not from the 3D
  lamp), so slopes are lit from where the Sun really is. The 3D lamp (for the ice wall and other objects) widens every
  half-second to cover all places in real daylight.
- **Day-length chart** uses the real Sun's declination at local noon each day: within ~20 s of real day length.
- **Pin card** shows sundial (apparent solar) time — exact — with mean solar time and the equation of time beside it.
- Not real: the angles you would see the Sun and Moon at from the ground in the 3D scene (see the accuracy notes above).

## Real-life scale and distances
- **Scale bar** (bottom left of the 3D view): a miles bar and a kilometres bar for the ground under the middle of the view,
  updated as you zoom (from 5,000 mi across the whole disc down to a few miles close up). North–south distances on this map
  are true everywhere; east–west they are stretched by c / sin c (c = angle from the pole — ×1.57 at the equator, much more in
  the far south), and the bar says how much at the spot you are looking at.
- **📏 Measure distance:** click two places on the map. A straight line is drawn across the flat map and its length is
  given at the map's real north–south scale (69.05 mi per degree of latitude — the real Earth's meridian length; Gleason's
  map uses 69.33). Below it, the distance measured on the real Earth (GPS / flight great-circle distance, mean radius
  3,958.8 mi) is shown for comparison. North–south lines agree (50°N→equator: map 3,453 mi, real 3,455 mi; London–Accra
  3,170 vs 3,172 mi); east–west and far-south lines do not (London–New York 3,691 vs 3,461 mi; Sydney–Buenos Aires 16,589 vs
  7,333 mi). While choosing the second point the coordinates line shows the live map distance. Click the button again to stop.

## Clouds (live satellite infrared)
Cloud tops from the weather satellites' 10.3–10.8 µm infrared window, which measures cloud-top temperature day and night.
- **Sources:** NASA GIBS — GOES-East, GOES-West and Himawari, every 10 min, each fetched separately; the brightness
  temperature is decoded from GIBS's published colour map. EUMETSAT's geostationary-ring mosaic (3-hourly, includes Meteosat)
  fills Europe, Africa and the Indian Ocean; its greyscale was calibrated against GIBS where they overlap
  (T ≈ 58.7 − 0.59·grey °C). Each spot uses the satellite that sees it most directly; GIBS pixels > 62° from their satellite
  defer to the mosaic (limb cooling), and nothing is shown > 72° from every satellite (no data poleward of ~±75°).
- **Height:** (clear-sky reference − cloud-top temperature) ÷ 6.5 °C/km, the reference being the warm end of each latitude
  band; capped at the tropopause (≈ 16.5 km tropics → 8.5 km poles). Tops are smoothed over ~60 km. *Cloud height* ×1 is
  true scale (17 km ≈ 0.008 map units); raise it to see relief.
- **Cover:** colder than the reference by > ~5 °C, fading in over the next 13 °C. Thin or low warm cloud (fog, stratocumulus)
  is hard to see in infrared and is under-shown; IR gives no cloud base or thickness, so the layer shows tops only.
- **Time:** live near the present (≈ 40 min behind real time); back ~70 days with GIBS (Himawari only ~6 h); older dates use
  the EUMETSAT archive (from June 2021) when its server answers, otherwise the panel says there is no data. When the
  simulation runs ahead of real time, the latest frame is shown and labelled "latest available".
- Lit by the real sun (day/night from the Sun's sub-point), relief shaded from the 3D sun. Credits: NASA GIBS / NOAA / JMA,
  EUMETSAT (EUMETView).

## Torus field
One hub torus field, always on (there is no switch): the outer boundary is the only surface drawn, a horn torus whose
hole closes to a point at the North Pole and which fills the firmament, swirling westward up through the hole, out over
the top, down the outside and back in underneath. **Outer boundary (vortex)** in the Torus field panel shows or hides it.
The field is paced by the real sky: the Sun, Moon and ISS are always at their real positions and times, so every real
eclipse happens when it really does (2024–2030: 32 of 32 match the real catalogue). The panel's side and top views show
the field in cross-section, the aurora ovals and the ISS's last 24 hours.

- **Firmament:** a perfect sphere (radius 10.45 units ≈ 13,040 mi) centred on the North Pole at the disc's surface,
  meeting the disc just beyond the ice wall.
- **Outer boundary:** tube radius = centre-circle radius = 5.215 units ≈ 6,510 mi, so it reaches ±6,510 mi above and below
  the disc and touches just inside the firmament round its equator.
- **Chakras** (off by default): on the torus axis, the root (red) at the bottom of the field, the throat at its top,
  sacral, solar plexus (at the North Pole) and heart evenly between, and the third eye and crown above the torus at the
  same spacing, which puts the crown at the top of the firmament (25 mi below its apex, by the geometry).
- **Aurora:** ovals round the north and south geomagnetic poles; see Aurora below.

Code: `torusField.js` (pure maths, no dependencies; tests in `tests/torusField.test.html`); wiring and the panel's views are
in `dashboard.js`.

## Aurora (accuracy)
- **Live (near the present):** curtains are placed from NOAA SWPC's OVATION aurora model
  (`services.swpc.noaa.gov/json/ovation_aurora_latest.json`, a worldwide 1° grid, refreshed every 5 min). For each longitude
  the band's equatorward edge, poleward edge and brightest latitude are read from NOAA's grid; three arcs sit across the band
  and the diffuse glow at its equatorward edge, each as bright as NOAA's value. Used within 2 h of NOAA's forecast time.
- **Other dates:** the oval model round the geomagnetic (dipole) pole — 80.8°N 72.7°W in 2025, drifting north ~0.04°/yr —
  sized by the Kp NOAA measured at that time (`noaa-planetary-k-index.json`, last ~7 days; `planetary_k_index_1m.json`
  for recent hours), or by the activity slider when NOAA has no data for that time.
- **Heights:** lower border 100 km; green oxygen 557.7 nm peaking ~125 km; red oxygen 630 nm ~240 km; top 250 km (quiet) to
  ~475 km (Kp 9). Curtain height can be exaggerated for visibility (×1 = true scale).
- Visible only where the sun is >6° below the horizon. The panel shows which source is in use.
