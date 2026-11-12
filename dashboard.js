import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { sky, signOf, SIGNS, PLANETS, bodyAt, subpoint, eclToEqAt, wrap180, DAY } from './astro.js';
import { createTorusField, FIELD_DEFAULTS } from './torusField.js';

// ---------- Model figures (1 unit = MI_PER_UNIT miles) ----------
const R = 10;                              // North Pole → ice wall (90°N → 90°S on the map)
const MI_PER_DEG = 60 * 208 / 180;         // Gleason 1892 scale: 60 nautical mi per degree, 180 nautical = 208 English mi → 69.33 mi
const MI_PER_UNIT = (180 * MI_PER_DEG) / R; // pole → ice wall = 12,480 mi
const SUN_ALT_MI = 3000, LUMINARY_DIAM_MI = 32;   // Sun and Moon both 32 mi across (eclipses use their real angular sizes, so they don't depend on this)
const SUN_H = SUN_ALT_MI / MI_PER_UNIT;    // sun and moon circle ~3,000 mi up
const MOON_H = SUN_H;
const LIGHT_R = 7.07;                      // sun spotlight radius (gives the equator 12 h at equinox)
// The firmament is a perfect sphere centred on the disc (the plane of inertia): the disc's surface is its equatorial plane
// and the North Pole its centre. It meets the disc just beyond the ice wall (radius R + 0.45); Gleason's time-dial border
// and the disc's edge lie outside it.
const FIRM_R = R + 0.45;                    // illustrative — no size is given for the firmament
const DOME_H = FIRM_R;                      // top of the sphere, straight above the North Pole
const domeY = (r) => Math.sqrt(Math.max(0, FIRM_R * FIRM_R - r * r));   // height of the sphere above map radius r
const WALL_H = 0.55;
// Gleason 1892 scan calibration: pole at centre, 6.938 px/° on the 3180 px crop
const GL_CROP_PX = 3180, GL_PX_PER_DEG = 6.938;
const R_OUT = R * (GL_CROP_PX / 2) / (180 * GL_PX_PER_DEG); // disc incl. Gleason's time dial
const ICE_OUT = FIRM_R + 0.3;               // realistic ice: the plane ends in a narrow rim just past the firmament (~375 mi)
const deg = THREE.MathUtils.degToRad, rad = THREE.MathUtils.radToDeg;
// Sun and moon are the same size in this model (~32 mi). Both are drawn enlarged by the same amount.
const LUM_DISC = 0.42, LUM_GLOW = 1.5;
// Luminary torus: the sun and moon ride the curved top of a field torus whose tube spans the tropics.
// Highest over the equator (equinoxes), lowest at the tropics (solstices). Height swing is adjustable.
// The sun's path: a straight slope with a fixed tilt. The sun is highest on its smallest circle (June, Tropic of
// Cancer) and lowest on its biggest circle (December, Tropic of Capricorn), moving in a straight line in between.
// The tilt is static — 42.5° from the vertical — so the analemma it traces is a straight figure-8 at that fixed tilt.
// The equator circle stays at SUN_H (3,000 mi).
const SUN_PATH_TILT = 42.5; // default tilt, degrees from vertical (adjustable: "Sun path tilt" slider in the Analemma panel)
const SUN_TILT = { v: SUN_PATH_TILT, MIN: 32, MAX: 89 };   // below 32° the December circle would sink under the plane
const LUM = Object.freeze({ rc: R / 2, a: 1.65, amp: 1000 / ((180 * 69.09) / R), ride: true, mode: 'slope' });
const TROPIC_OFF = (90 - 23.44) / 180 * R - R / 2;
const lumBase = () => SUN_H - LUM.amp * Math.sqrt(1 - (TROPIC_OFF / LUM.a) ** 2);
function lumAlt(dec) {
  if (LUM.mode === 'flat') return SUN_H;
  if (LUM.mode === 'slope') return SUN_H + (R / 2 - (90 - dec) / 180 * R) / Math.tan(SUN_TILT.v * Math.PI / 180);
  if (!LUM.ride || LUM.amp <= 0) return SUN_H;
  const q = Math.min(1, Math.abs((90 - dec) / 180 * R - LUM.rc) / LUM.a);
  return lumBase() + LUM.amp * Math.sqrt(1 - q * q);
}

const PLACES = [
  { name: 'London', lat: 51.5, lon: -0.1 }, { name: 'New York', lat: 40.7, lon: -74 },
  { name: 'Tokyo', lat: 35.7, lon: 139.7 }, { name: 'Sydney', lat: -33.9, lon: 151.2 },
  { name: 'Cape Town', lat: -33.9, lon: 18.4 }, { name: 'Buenos Aires', lat: -34.6, lon: -58.4 },
  { name: 'Cairo', lat: 30, lon: 31.2 }, { name: 'San Francisco', lat: 37.8, lon: -122.4 },
  { name: 'Chicago', lat: 41.88, lon: -87.63 }, { name: 'Algiers', lat: 36.75, lon: 3.06 },
];

const $ = (id) => document.getElementById(id);
const fmtMi = (u) => `${Math.round(u * MI_PER_UNIT).toLocaleString()} mi`;
const fmtLat = (l) => `${Math.abs(l).toFixed(1)}° ${l >= 0 ? 'N' : 'S'}`;
const fmtLon = (l) => `${Math.abs(l).toFixed(1)}° ${l >= 0 ? 'E' : 'W'}`;

// ---------- Projection (Gleason orientation: Greenwich → +x, east counter-clockwise from above) ----------
function latLonToXZ(lat, lon, y = 0, out = new THREE.Vector3()) {
  const r = (90 - lat) / 180 * R, a = deg(lon);
  return out.set(r * Math.cos(a), y, -r * Math.sin(a));
}
function xzToLatLon(x, z) {
  return { lat: 90 - Math.hypot(x, z) / R * 180, lon: rad(Math.atan2(-z, x)) };
}
// Point on the firmament for right ascension / declination (in the star wheel's own frame)
function skyPos(ra, dec, inset = 0.97, out = new THREE.Vector3()) {
  const r = Math.min((90 - dec) / 180 * R, R + 0.3), a = deg(ra);
  const y = domeY(r) * inset;   // each star sits straight above its sub-star point on the map
  return out.set(r * Math.cos(a), y, -r * Math.sin(a));
}

// ---------- Sunlit area from Gleason's map (1892): the June 21st and Dec. 21st figures ----------
// Measured from the scan (degrees from the North Pole, along a ray at angle θ from the sun's noon meridian):
//  • June 21: outline below; the far edge is a straight line 34.4° beyond the pole, so the whole Arctic Circle has
//    24 h of light ("This shows sunlight inside the Arctic Circle for 24 hours").
//  • Dec. 21: outline ≈ circle centred 56.7° from the pole on the noon meridian, radius 114.5°; cut by a straight line at
//    the Arctic Circle ("lights up … from the Arctic Circle to some portion of Antarctic ice") and no light beyond 80° S.
//  • In between, the shape blends with the sun's spiral between the tropics (June → Dec. widening, then back).
// Smooth fit: each figure's lit area is fitted (least squares) with one smooth "egg" curve, a superellipse whose
// pole-side and far-side halves have their own length and squareness; the halves meet with matching tangents, so the
// outline has no corners. Coordinates: degrees from the North Pole, x along the sun's noon meridian, y across it.
//   June 21: rms 0.64° from the figure (pole-side edge -34.5°, noon tip 158.6° ≈ 68° S)
//   Dec. 21: rms 2.47° (corners rounded on purpose; pole-side edge 22.1° = Arctic Circle, tip 169.9° = 80° S)
// Between the solstices every parameter blends with the sun's declination (its spiral between the tropics).
const GLEASON = {
  june: { cx: 28.09, aIn: 62.64, aOut: 130.53, by: 137.75, nIn: 2.828, nOut: 2.002 },
  dec: { cx: 40.07, aIn: 17.94, aOut: 129.87, by: 115.85, nIn: 4.0, nOut: 2.178 },
};
const gleasonF = (decl) => Math.min(1, Math.max(0, (decl + 23.44) / 46.88)); // 0 = Dec. solstice, 1 = June solstice
function gleasonShape(f) { const o = {}; for (const k in GLEASON.june) o[k] = GLEASON.dec[k] + (GLEASON.june[k] - GLEASON.dec[k]) * f; return o; }
/** Signed margin in degrees (distance to the outline along the ray from the shape's centre): > 0 lit, < 0 dark. */
// ---------- Real-world daylight ----------
// The sun's true height above the horizon at (lat, lon), from the point directly beneath the sun (sun's declination
// and longitude, from the verified ephemeris). Standard thresholds (sun's centre):
//   day > −0.833° (upper limb on the horizon: 34′ refraction + 16′ semi-diameter) · civil twilight to −6°
//   nautical to −12° · astronomical to −18° · night below −18°.
const TWILIGHT = { sunrise: -0.833, civil: -6, nautical: -12, astro: -18 };
function sunElevation(lat, lon, sunLat, sunLon) {
  const r = Math.PI / 180, s = Math.sin(lat * r) * Math.sin(sunLat * r) + Math.cos(lat * r) * Math.cos(sunLat * r) * Math.cos((lon - sunLon) * r);
  return Math.asin(Math.max(-1, Math.min(1, s))) / r;
}
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
/** Shared shading (map, overhead map): returns darkness alpha 0–0.74 and warm twilight glow 0–1. */
function lightShade(lat, lon, sunLat, sunLon) {
  const e = sunElevation(lat, lon, sunLat, sunLon), ins = Math.max(Math.sin(e * Math.PI / 180), 0);
  const night = e >= 0 ? 0.6 * Math.pow(1 - ins, 1.4) : 0.6 + 0.4 * smooth01(-e / 18);   // sunlight ∝ sin(height)
  return { alpha: 0.95 * night * (1 - Math.pow(ins, 3)), glow: Math.exp(-((e + 2) ** 2) / 12.5), spot: Math.pow(ins, 3) };
}
function daylightState(lat, lon, sunLat, sunLon) {
  const e = sunElevation(lat, lon, sunLat, sunLon);
  return e > TWILIGHT.sunrise ? '☀ Day' : e > TWILIGHT.civil ? '🌅 Civil twilight' : e > TWILIGHT.nautical ? '🌆 Nautical twilight' : e > TWILIGHT.astro ? '🌌 Astronomical twilight' : '🌙 Night';
}
// Hours of daylight at latitude `lat` when the sun is at declination `decl`
function dayHours(lat, decl) {
  const r = Math.PI / 180, c = (Math.sin(TWILIGHT.sunrise * r) - Math.sin(lat * r) * Math.sin(decl * r)) / (Math.cos(lat * r) * Math.cos(decl * r));
  if (c <= -1) return 24; if (c >= 1) return 0;
  return 2 * Math.acos(c) / r / 15;    // sunrise hour angle → hours of daylight
}
// The model year begins at the spring equinox, 21 March (day 1)
const yearStart = (t) => { const y = new Date(t).getUTCFullYear(), s = Date.UTC(y, 2, 21); return t >= s ? s : Date.UTC(y - 1, 2, 21); };
const dayOfYear = (t) => Math.floor((t - yearStart(t)) / DAY) + 1;
function phaseName(age) {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.floor((age / 29.530588) * 8 + 0.5) % 8];
}

// ---------- State ----------
const state = { t: Date.now(), playing: true, speed: 3600, showGrid: true, pin: { lat: 51.5, lon: -0.1, name: 'London', hidden: true }, view: 'overview', fieldMode: true };   // one combined mode: the torus field drives the scene (the on/off switch was removed)
// Torus field (in-world rules). Feature flag state.fieldMode: on → sun, moon, ISS and aurora read the field; off → real astronomy & NASA data.
const FIELD = createTorusField({ discRadius: 10 });
// Pacing: on → the field follows the real sky's timing (real day incl. the equation of time, real month, the Moon's
// monthly loop) so eclipses happen exactly when they really do; off → the pure field rules (24 h, 0.966 charge, no eclipses).
const FIELD_PACE = { real: true };

// ---------- Renderer / scene ----------
const canvas = $('scene'), stage = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
camera.position.set(0, 16, 25);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.07, zoomToCursor: true, minDistance: 0.00006, maxDistance: 70, maxPolarAngle: Math.PI * 0.97, autoRotateSpeed: 0.6 });
const ambient = new THREE.AmbientLight(0xd8e0ff, 0.8);
const hemi = new THREE.HemisphereLight(0xfff4e0, 0x1a1208, 0.6);
scene.add(ambient, hemi);

function glowTexture(inner, outer, size = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.25, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const DOT = glowTexture('#ffffff', 'rgba(255,255,255,0)');

// ---------- Map textures: NASA Blue Marble (re-projected to this disc) or Gleason 1892 ----------
const MAP_S = 3072;
const mapCanvas = document.createElement('canvas');
mapCanvas.width = mapCanvas.height = MAP_S;
const mapTex = new THREE.CanvasTexture(mapCanvas);
mapTex.colorSpace = THREE.SRGBColorSpace;
mapTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
state.mapStyle = 'satellite'; state.lightMode = 'real';   // daylight follows the real sun (the Gleason-figure option was removed)
const MAP_SOURCES = { satellite: 'assets/blue-marble-ae.jpg', gleason: 'assets/gleason-1892.jpg' };
const mapImages = {};
function mapImage(style) {
  if (!mapImages[style]) {
    const im = new Image();
    im.onload = () => { if (state.mapStyle === style) drawMap(); };
    im.src = MAP_SOURCES[style]; mapImages[style] = im;
  }
  return mapImages[style];
}
// Tropic / arctic highlight lines live on their own transparent canvas (same layout as the map), drawn over every map layer.
const GRID_S = 2048, gridCanvas = document.createElement('canvas'); gridCanvas.width = gridCanvas.height = GRID_S;
const gridTex = new THREE.CanvasTexture(gridCanvas); gridTex.colorSpace = THREE.SRGBColorSpace; gridTex.anisotropy = mapTex.anisotropy;
function drawMap() {
  const ctx0 = mapCanvas.getContext('2d'), img = mapImage(state.mapStyle);
  ctx0.fillStyle = state.mapStyle === 'satellite' ? '#e4edf4' : '#efe6d2'; ctx0.fillRect(0, 0, MAP_S, MAP_S);
  if (img.complete && img.naturalWidth) ctx0.drawImage(img, 0, 0, MAP_S, MAP_S);
  const ctx = gridCanvas.getContext('2d'), c = GRID_S / 2, pr = GRID_S / 2 * (R / R_OUT);
  ctx.clearRect(0, 0, GRID_S, GRID_S);
  if (state.showGrid) {
    ctx.save(); ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,150,210,.75)';
    ctx.beginPath(); ctx.arc(c, c, pr * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([22, 16]); ctx.strokeStyle = 'rgba(214,140,20,.85)';
    for (const lat of [23.44, -23.44]) { ctx.beginPath(); ctx.arc(c, c, pr * (90 - lat) / 180, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(60,90,160,.6)';
    for (const lat of [66.56, -66.56]) { ctx.beginPath(); ctx.arc(c, c, pr * (90 - lat) / 180, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  mapTex.needsUpdate = true; gridTex.needsUpdate = true;
}
drawMap();

// ---------- Disc, slab ----------
// ---------- Terrain: real elevation (mountains, plateaus, valleys) ----------
// Heights from the open AWS Terrain Tiles ("Terrarium": SRTM, GMTED, ETOPO1 and others; Web-Mercator tiles, zoom 0–15).
// The whole Earth loads once at ≈ 20 km per pixel; when you zoom in, a 512 × 512 window under the satellite-detail area is
// filled from the zoom level that matches it (down to ≈ 10 m). The disc is a fine polar mesh raised by the height in its
// shader (×1 = true scale: Everest 8.85 km ≈ 0.0044 map units), and every slope is lit from the elevation data itself.
// Oceans and lakes sit at sea level (sea-floor depths are not shown; land below sea level is flattened to it).
const TERR = { exag: 50, GZ: 3, DS: 512, gen: 0, linear: renderer.extensions.has('OES_texture_float_linear'), KM_PER_UNIT: MI_PER_UNIT * 1.609344, boxKey: '' };
const demTex = (w, h) => { const t = new THREE.DataTexture(new Float32Array(w * h), w, h, THREE.RedFormat, THREE.FloatType); t.minFilter = t.magFilter = TERR.linear ? THREE.LinearFilter : THREE.NearestFilter; t.needsUpdate = true; return t; };
const demGlobalTex = demTex(2048, 1024), demDetailTex = demTex(TERR.DS, TERR.DS);
demGlobalTex.wrapS = THREE.RepeatWrapping;
const terrUniforms = { uSunOn: { value: 1 }, uRealSun: { value: new THREE.Vector2(0, 0) }, uSunRad: { value: new THREE.Color(1, 1, 1) }, uDem: { value: demGlobalTex }, uDemD: { value: demDetailTex }, uDemOn: { value: 0 }, uDemDOn: { value: 0 }, uDemBox: { value: new THREE.Vector4(0, 90, 1, 1) }, uTerrK: { value: 1 / 1000 / TERR.KM_PER_UNIT } };
const TERRAIN_GLSL = `
  uniform sampler2D uDem, uDemD; uniform float uDemOn, uDemDOn, uTerrK; uniform vec4 uDemBox; uniform vec2 uRealSun; uniform vec3 uSunRad; uniform float uSunOn;
  vec2 discLL(vec2 xy) { return vec2(degrees(atan(xy.y, xy.x)), 90.0 - length(xy) / ${R.toFixed(1)} * 180.0); }   // (lon, lat)
  bool inDemBox(float lat, float lon, float m) { float u = mod(lon - uDemBox.x, 360.0) / uDemBox.z, v = 1.0 - (uDemBox.y - lat) / uDemBox.w; return u > m && u < 1.0 - m && v > m && v < 1.0 - m; }
  float demM(float lat, float lon) {            // metres above sea level (sea and below-sea-level land at 0)
    float h = 0.0;
    if (uDemOn > 0.5) h = textureLod(uDem, vec2((lon + 180.0) / 360.0, (lat + 90.0) / 180.0), 0.0).r;
    if (uDemDOn > 0.5 && inDemBox(lat, lon, 0.0)) { float u = mod(lon - uDemBox.x, 360.0) / uDemBox.z, v = 1.0 - (uDemBox.y - lat) / uDemBox.w; h = textureLod(uDemD, vec2(u, v), 0.0).r; }
    return max(h, 0.0);
  }
  float terrainH(vec2 xy) { vec2 ll = discLL(xy); return ll.y < -90.0 ? 0.0 : demM(ll.y, ll.x) * uTerrK; }`;
/** Polar grid in the disc's own plane (x, y), with the map's texture mapping — fine enough to carry the relief. */
function polarGrid(radius, rings, segs, patchFlag = 0) {
  const pos = [0, 0, 0], uv = [0.5, 0.5], idx = [];
  for (let i = 1; i <= rings; i++) { const r = radius * (i / rings) ** 1.0; for (let j = 0; j < segs; j++) { const a = j / segs * Math.PI * 2, x = r * Math.cos(a), y = r * Math.sin(a); pos.push(x, y, 0); uv.push(0.5 + x / (2 * R_OUT), 0.5 + y / (2 * R_OUT)); } }
  // counter-clockwise seen from the disc's top face (+z here, +y in the scene), so the surface faces up
  for (let j = 0; j < segs; j++) idx.push(0, 1 + (j + 1) % segs, 1 + j);
  for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) { const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + (j + 1) % segs; idx.push(a, a + segs, b, b, a + segs, b + segs); }
  const g = new THREE.BufferGeometry(), n = pos.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('aPatch', new THREE.Float32BufferAttribute(new Float32Array(n).fill(patchFlag), 1)); g.setIndex(idx);
  return g;
}
// The disc ends just past the firmament (ICE_OUT); the texture mapping is that of the full map (out to R_OUT), so it lines up.
const discGeoIce = polarGrid(ICE_OUT, 440, 1280);
const slabGeoIce = new THREE.CylinderGeometry(ICE_OUT, ICE_OUT - 0.6, 1.4, 160);
const disc = new THREE.Mesh(discGeoIce,
  new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.92, metalness: 0, emissive: 0xffffff, emissiveMap: mapTex, emissiveIntensity: 0.1 }));
disc.rotation.x = -Math.PI / 2;
scene.add(disc);
let terrPatch = null;   // created once the terrain code below has run (shares the disc's material)

// ---------- High-resolution satellite imagery: EOxCloudless 2025 (Sentinel-2, cloud-free, ~10 m per pixel) ----------
// Tiles come on a plain latitude/longitude grid (level z: 2^(z+1) × 2^z tiles of 256 px, each 180/2^z degrees), so the disc
// shader turns each point of the disc back into its latitude/longitude and samples them directly — no resampling loss.
//  • Global layer: the whole Earth at level 4 (8,192 × 4,096 px, ≈ 4.9 km per pixel), loaded once.
//  • Detail layer: a 4,096 px window around where you are looking, refetched as you zoom and pan, at the level that matches
//    the screen — down to level 14 (≈ 10 m per pixel, Sentinel-2's own resolution) when zoomed right in.
// Both fade in over the bundled Blue Marble picture, which stays as the fallback (offline, or before the tiles arrive).
// Imagery: EOxCloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0.
const SAT = {
  url: (z, y, x) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025/default/WGS84/${z}/${y}/${x}.jpg`,
  GZ: renderer.capabilities.maxTextureSize >= 8192 ? 4 : 3, MAXZ: 14, DS: 4096, T: 256, CONC: 10,
  active: 0, queue: [], gen: 0, globalDone: 0, globalTotal: 0, detailDirty: false, globalDirty: false, lastUp: 0, box: null, key: '',
};
const satGlobalCanvas = document.createElement('canvas');
satGlobalCanvas.width = SAT.T * 2 ** (SAT.GZ + 1); satGlobalCanvas.height = SAT.T * 2 ** SAT.GZ;
const satDetailCanvas = document.createElement('canvas'); satDetailCanvas.width = satDetailCanvas.height = SAT.DS;
const satTex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = mapTex.anisotropy; t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
const satGlobalTex = satTex(satGlobalCanvas), satDetailTex = satTex(satDetailCanvas);
satDetailTex.wrapS = THREE.ClampToEdgeWrapping;
const satUniforms = { uGlobal: { value: satGlobalTex }, uDetail: { value: satDetailTex }, uGrid: { value: gridTex }, uSatOn: { value: 1 }, uGlobalOn: { value: 0 }, uDetailOn: { value: 0 }, uBox: { value: new THREE.Vector4(0, 90, 1, 1) } };
disc.material.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, satUniforms);
  Object.assign(sh.uniforms, terrUniforms);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vDiscXY; attribute float aPatch; varying float vPatch;' + TERRAIN_GLSL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDiscXY = position.xy; vPatch = aPatch; transformed.z += terrainH(position.xy);');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    varying vec2 vDiscXY; varying float vPatch; uniform sampler2D uGlobal, uDetail, uGrid; uniform float uSatOn, uGlobalOn, uDetailOn; uniform vec4 uBox;` + TERRAIN_GLSL)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
    { vec2 ll0 = discLL(vDiscXY);   // the fine terrain patch covers the zoom window: the coarse disc steps aside there, and vice versa
      bool inBox = uDemDOn > 0.5 && ll0.y > -90.0 && inDemBox(ll0.y, ll0.x, 0.002);
      if (vPatch < 0.5 && inBox) discard;
      if (vPatch > 0.5 && (uDemDOn < 0.5 || !inDemBox(ll0.y, ll0.x, 0.0))) discard; }`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    { // sunlight on the ground from the REAL Sun: its true height and direction over this spot (same formula as the
      // day/night shading), falling on the terrain slope — so the lit side of every mountain faces the real Sun
      vec2 ll = discLL(vDiscXY);
      if (ll.y > -90.0) {
        float la = radians(ll.y), lo = radians(ll.x), H = lo - uRealSun.y, dc = uRealSun.x;
        float sinE = sin(la) * sin(dc) + cos(la) * cos(dc) * cos(H), cosE = sqrt(max(0.0, 1.0 - sinE * sinE));
        float Az = atan(-sin(H) * cos(dc), cos(la) * sin(dc) - sin(la) * cos(dc) * cos(H));
        vec3 Nn = vec3(-cos(lo), 0.0, sin(lo)), Ee = vec3(-sin(lo), 0.0, -cos(lo));
        vec3 sW = vec3(0.0, 1.0, 0.0) * sinE + cosE * (Nn * cos(Az) + Ee * sin(Az));
        if (uSunOn < 0.5) sW = vec3(0.0, 1.0, 0.0);   // Sun spotlight off: even light from straight above, no day/night
        vec3 nW = vec3(0.0, 1.0, 0.0);
        if (uDemOn > 0.5 && ll.y > -89.5) {
          bool inD = uDemDOn > 0.5 && inDemBox(ll.y, ll.x, 0.0);
          float dlat = inD ? uDemBox.w / ${TERR.DS.toFixed(1)} : 180.0 / 1024.0, dlon = inD ? uDemBox.z / ${TERR.DS.toFixed(1)} : 360.0 / 2048.0;
          float rr = length(vDiscXY);
          float hN = demM(ll.y + dlat, ll.x), hS = demM(ll.y - dlat, ll.x), hE = demM(ll.y, ll.x + dlon), hW = demM(ll.y, ll.x - dlon);
          float gr = (hS - hN) * uTerrK / (2.0 * dlat * ${R.toFixed(1)} / 180.0);
          float gt = (hE - hW) * uTerrK / max(2.0 * dlon * rr * PI / 180.0, 1e-6);
          nW = normalize(vec3(0.0, 1.0, 0.0) - gr * vec3(cos(lo), 0.0, -sin(lo)) - gt * Ee);
        }
        reflectedLight.directDiffuse = uSunRad * BRDF_Lambert(diffuseColor.rgb) * max(dot(nW, sW), 0.0);
        reflectedLight.directSpecular = vec3(0.0);
      } }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
    {
      float rr = length(vDiscXY), lat = 90.0 - rr / ${R.toFixed(1)} * 180.0, lon = degrees(atan(vDiscXY.y, vDiscXY.x));
      if (uSatOn > 0.5 && lat > -90.0) {
        vec2 dLon = vec2(dFdx(lon), dFdy(lon)); dLon -= 360.0 * floor(dLon / 360.0 + 0.5);   // no seam at ±180°
        vec2 dLat = vec2(dFdx(lat), dFdy(lat));
        if (uGlobalOn > 0.5) {
          vec2 uv = vec2((lon + 180.0) / 360.0, (lat + 90.0) / 180.0);
          diffuseColor.rgb = textureGrad(uGlobal, uv, vec2(dLon.x / 360.0, dLat.x / 180.0), vec2(dLon.y / 360.0, dLat.y / 180.0)).rgb;
        }
        if (uDetailOn > 0.5) {
          float u = mod(lon - uBox.x, 360.0) / uBox.z, v = 1.0 - (uBox.y - lat) / uBox.w;
          if (u > 0.0 && u < 1.0 && v > 0.0 && v < 1.0) {
            float f = smoothstep(0.0, 0.05, min(min(u, 1.0 - u), min(v, 1.0 - v)));
            vec3 det = textureGrad(uDetail, vec2(u, v), vec2(dLon.x / uBox.z, dLat.x / uBox.w), vec2(dLon.y / uBox.z, dLat.y / uBox.w)).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, det, f);
          }
        }
      }
      vec4 g = texture2D(uGrid, vMapUv); diffuseColor.rgb = mix(diffuseColor.rgb, g.rgb, g.a);
    }`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = emissive * diffuseColor.rgb;');
};
/** Fetch one tile (cached by the browser for a week); resolves to an ImageBitmap, or null on failure / when superseded. */
function satFetch(z, y, x, gen) {
  return new Promise((resolve) => { SAT.queue.push({ z, y, x, gen, resolve }); satPump(); });
}
function satPump() {
  while (SAT.active < SAT.CONC && SAT.queue.length) {
    const job = SAT.queue.shift();
    if (job.gen != null && job.gen !== SAT.gen) { job.resolve(null); continue; }   // the view moved on: skip stale detail tiles
    SAT.active++;
    fetch(SAT.url(job.z, job.y, job.x)).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null))
      .catch(() => null).then((bm) => { SAT.active--; job.resolve(bm); satPump(); });
  }
}
function satLoadGlobal() {
  const nx = 2 ** (SAT.GZ + 1), ny = 2 ** SAT.GZ, g = satGlobalCanvas.getContext('2d'); SAT.globalTotal = nx * ny;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) satFetch(SAT.GZ, y, x, null).then((bm) => {
    if (bm) { g.drawImage(bm, x * SAT.T, y * SAT.T); bm.close?.(); SAT.globalDone++; }
    else SAT.globalFail = (SAT.globalFail || 0) + 1;
    if (SAT.globalDone === SAT.globalTotal) { satGlobalTex.needsUpdate = true; satUniforms.uGlobalOn.value = 1; satCredit(); }
  });
}
/** Pick the detail window for the current view; refetch only when the level changes or the view leaves the window.
 *  Near the North Pole every longitude meets, so there the window is the whole ring (squeezed in longitude, where the
 *  circles are short) down to the latitude the view reaches. */
function satUpdate(now) {
  const off = () => { satUniforms.uDetailOn.value = 0; SAT.box = null; terrDetail(null); };
  if (state.mapStyle !== 'satellite' || OBS.active || SAT.globalDone < SAT.globalTotal) return off();
  const tg = controls.target, dist = camera.position.distanceTo(tg), W = renderer.domElement.width;
  const ext = 2 * dist * Math.tan(camera.fov * Math.PI / 360) * Math.max(1, camera.aspect);   // map units across the screen
  const r0 = Math.hypot(tg.x, tg.z), lat0 = 90 - r0 / R * 180, lon0 = rad(Math.atan2(-tg.z, tg.x));
  const needPpd = W / ext / 18 * 1.2;                                        // pixels per degree of latitude the screen can show
  const zNeed = Math.ceil(Math.log2(needPpd * 180 / SAT.T));
  if (ext > 7 || r0 > R || zNeed <= SAT.GZ) return off();
  const h = ext * 0.75, latSpan = Math.min(170, 2 * h * 18), polar = r0 < h * 1.3;
  let z, lonL, lonSpan, latTop;
  if (polar) {
    latTop = 90; const latBot = 90 - (r0 + h) * 18;
    for (z = Math.min(zNeed, SAT.MAXZ); z > SAT.GZ; z--) { const TD = 180 / 2 ** z; if (2 ** (z + 1) * Math.ceil((90 - latBot) / TD) <= 640) break; }
    lonL = -180; lonSpan = 360;
  } else {
    lonSpan = Math.min(359, 2 * h / (r0 * Math.PI / 180)); lonL = lon0 - lonSpan / 2; latTop = Math.min(90, lat0 + latSpan / 2);
    z = Math.min(zNeed, SAT.MAXZ, Math.floor(Math.log2(SAT.DS * 180 / (SAT.T * (Math.max(latSpan, lonSpan) + 1e-9)))));
  }
  if (z <= SAT.GZ) return off();
  const TD = 180 / 2 ** z, NX = 2 ** (z + 1), NY = 2 ** z, n = SAT.DS / SAT.T;
  const B = SAT.box, wy0 = (90 - latTop) / TD, wy1 = wy0 + latSpan / TD;
  const fits = B && B.z === z && B.polar === polar && wy0 >= B.y0 && Math.min(NY, wy1) <= B.y0 + B.rows &&
    (polar || ((((lonL + 180) / TD - B.x0) % NX) + NX) % NX + lonSpan / TD <= B.cols);
  if (!fits) {
    let box;
    if (polar) { const rows = Math.min(NY, Math.ceil(wy1) + 1); box = { z, polar, x0: 0, y0: 0, cols: NX, rows }; }
    else {
      const cols = Math.min(n, NX), rows = Math.min(n, NY), cx = Math.floor((lonL + lonSpan / 2 + 180) / TD - cols / 2), cy = Math.floor((wy0 + wy1) / 2 - rows / 2);
      box = { z, polar, x0: ((cx % NX) + NX) % NX, y0: Math.max(0, Math.min(NY - rows, cy)), cols, rows };
    }
    SAT.box = box; satBuildDetail(); terrDetail(box);
  }
  satUniforms.uDetailOn.value = 1;
  if (SAT.detailDirty && now - SAT.lastUp > 300) { satDetailTex.needsUpdate = true; SAT.detailDirty = false; SAT.lastUp = now; }
}
function satBuildDetail() {
  const B = SAT.box, gen = ++SAT.gen, TD = 180 / 2 ** B.z, NX = 2 ** (B.z + 1), ctx = satDetailCanvas.getContext('2d');
  const lonW = B.cols * TD, latH = B.rows * TD, lonL = B.x0 * TD - 180, latTop = 90 - B.y0 * TD, px = SAT.DS / B.cols, ph = SAT.DS / B.rows;
  satUniforms.uBox.value.set(lonL, latTop, lonW, latH);
  // placeholder: the global picture of the same area, so nothing flashes while the sharp tiles arrive
  const G = satGlobalCanvas, gx = G.width / 360, gy = G.height / 180, sx = (lonL + 180) * gx, sy = (90 - latTop) * gy, sw = lonW * gx, shh = latH * gy;
  const w1 = Math.min(sw, G.width - sx);
  ctx.drawImage(G, sx, sy, w1, shh, 0, 0, w1 / sw * SAT.DS, SAT.DS);
  if (w1 < sw) ctx.drawImage(G, 0, sy, sw - w1, shh, w1 / sw * SAT.DS, 0, (sw - w1) / sw * SAT.DS, SAT.DS);
  SAT.detailDirty = true;
  const cxm = (B.cols - 1) / 2, cym = (B.rows - 1) / 2, jobs = [];
  for (let j = 0; j < B.rows; j++) for (let i = 0; i < B.cols; i++) jobs.push([i, j, B.polar ? j : (i - cxm) ** 2 + (j - cym) ** 2]);
  jobs.sort((a, b) => a[2] - b[2]);                                           // centre of the view first (pole first when polar)
  for (const [i, j] of jobs) {
    satFetch(B.z, B.y0 + j, (B.x0 + i) % NX, gen).then((bm) => {
      if (!bm) return;
      if (gen === SAT.gen) { ctx.drawImage(bm, i * px, j * ph, px, ph); SAT.detailDirty = true; }
      bm.close?.();
    });
  }
}
function satCredit() { const el = $('satCredit'); if (el) el.hidden = state.mapStyle !== 'satellite'; }
satLoadGlobal();

// ---- terrain loading: Terrarium tiles → lat/lon height grids ----
const terrUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const terrTiles = new Map();   // "z/x/y" → Promise<Float32Array(256²) | null>, metres
function terrTile(z, x, y) {
  const k = `${z}/${x}/${y}`; if (terrTiles.has(k)) return terrTiles.get(k);
  const pr = fetch(terrUrl(z, x, y)).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null)).then((bm) => {
    if (!bm) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bm, 0, 0); bm.close?.();
    const d = g.getImageData(0, 0, 256, 256).data, out = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;   // Terrarium encoding
    return out;
  }).catch(() => null);
  terrTiles.set(k, pr); if (terrTiles.size > 600) terrTiles.delete(terrTiles.keys().next().value);
  return pr;
}
/** Heights (m) on a W × H lat/lon grid (row 0 = south edge), lon lonL..lonL+lonW, lat latTop−latH..latTop, from zoom z. */
async function terrGrid(z, lonL, latTop, lonW, latH, W, H, isCurrent = () => true) {
  const n = 2 ** z, mlat = 85.0511, mercY = (lat) => { const L = Math.max(-mlat, Math.min(mlat, lat)) * Math.PI / 180; return (1 - Math.log(Math.tan(L) + 1 / Math.cos(L)) / Math.PI) / 2 * n * 256; };
  const pxX = (lon) => ((lon + 180) / 360) * n * 256;
  const x0 = Math.floor(pxX(lonL) / 256), x1 = Math.floor(pxX(lonL + lonW) / 256), y0 = Math.max(0, Math.floor(mercY(latTop) / 256)), y1 = Math.min(n - 1, Math.floor(mercY(latTop - latH) / 256));
  const tiles = new Map(), jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const wx = ((tx % n) + n) % n; jobs.push(terrTile(z, wx, ty).then((a) => tiles.set(`${wx}/${ty}`, a))); }
  await Promise.all(jobs); if (!isCurrent()) return null;
  const at = (gx, gy) => { gx = ((gx % (n * 256)) + n * 256) % (n * 256); gy = Math.max(0, Math.min(n * 256 - 1, gy)); const t = tiles.get(`${(gx / 256) | 0}/${(gy / 256) | 0}`); return t ? t[(gy % 256) * 256 + (gx % 256)] : 0; };
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const lat = latTop - (H - 1 - j + 0.5) / H * latH, gyf = mercY(lat) - 0.5, gy = Math.floor(gyf), fy = gyf - gy;
    for (let i = 0; i < W; i++) {
      const gxf = pxX(lonL + (i + 0.5) / W * lonW) - 0.5, gx = Math.floor(gxf), fx = gxf - gx;
      out[j * W + i] = (at(gx, gy) * (1 - fx) + at(gx + 1, gy) * fx) * (1 - fy) + (at(gx, gy + 1) * (1 - fx) + at(gx + 1, gy + 1) * fx) * fy;
    }
  }
  return out;
}
terrGrid(TERR.GZ, -180, 90, 360, 180, 2048, 1024).then((a) => { if (!a) return; demGlobalTex.image.data.set(a); demGlobalTex.needsUpdate = true; terrUniforms.uDemOn.value = 1; });
// the fine patch: a lat/lon grid mesh over the zoom window, raised by the detailed heights
const TERR_PN = 320;
const terrPatchGeo = (() => {
  const N = TERR_PN, g = new THREE.BufferGeometry(), idx = [];
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((N + 1) ** 2 * 3), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((N + 1) ** 2 * 2), 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array((N + 1) ** 2 * 3).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('aPatch', new THREE.Float32BufferAttribute(new Float32Array((N + 1) ** 2).fill(1), 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }   // faces up
  g.setIndex(idx); return g;
})();
function terrPlacePatch(lonL, latTop, lonW, latH) {
  const N = TERR_PN, P = terrPatchGeo.attributes.position, U = terrPatchGeo.attributes.uv;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const lat = latTop - j / N * latH, lon = lonL + i / N * lonW, r = (90 - lat) / 180 * R, a = lon * Math.PI / 180, x = r * Math.cos(a), y = r * Math.sin(a), k = j * (N + 1) + i;
    P.setXYZ(k, x, y, 0); U.setXY(k, 0.5 + x / (2 * R_OUT), 0.5 + y / (2 * R_OUT));
  }
  P.needsUpdate = U.needsUpdate = true; terrPatchGeo.computeBoundingSphere();
}
terrPatch = new THREE.Mesh(terrPatchGeo, disc.material); terrPatch.rotation.x = -Math.PI / 2; terrPatch.frustumCulled = false; scene.add(terrPatch);
/** Called when the satellite zoom window changes: fill the same area with matching-resolution heights. */
function terrDetail(B) {
  if (!B || B.polar) { terrUniforms.uDemDOn.value = 0; TERR.boxKey = ''; return; }
  const TD = 180 / 2 ** B.z, lonW = B.cols * TD, latH = B.rows * TD, lonL = B.x0 * TD - 180, latTop = 90 - B.y0 * TD, key = `${B.z}/${B.x0}/${B.y0}`;
  if (key === TERR.boxKey) return; TERR.boxKey = key;
  const dpp = Math.max(lonW, latH) / TERR.DS; let z = Math.max(4, Math.min(14, Math.round(Math.log2(360 / (256 * dpp)))));
  while (z > 4 && (Math.ceil(lonW / (360 / 2 ** z)) + 1) * (Math.ceil(latH / (360 / 2 ** z) * 1.6) + 1) > 90) z--;   // keep it to ~90 tiles
  const gen = ++TERR.gen;
  terrGrid(z, lonL, latTop, lonW, latH, TERR.DS, TERR.DS, () => gen === TERR.gen).then((a) => {
    if (!a || gen !== TERR.gen) return;
    demDetailTex.image.data.set(a); demDetailTex.needsUpdate = true;
    terrUniforms.uDemBox.value.set(lonL, latTop, lonW, latH); terrPlacePatch(lonL, latTop, lonW, latH); terrUniforms.uDemDOn.value = 1;
  });
}

// ---------- Clouds: live geostationary infrared, cloud tops placed at their real height ----------
// Source: the 10.3–10.8 µm "clean infrared" window from the ring of weather satellites — this sees cloud-top temperature,
// day and night. NASA GIBS supplies GOES-East, GOES-West and Himawari every 10 min (palette decoded back to °C with GIBS's
// published colour map); EUMETSAT's 3-hourly geostationary-ring mosaic fills Europe/Africa/Indian Ocean (its greyscale
// calibrated against GIBS where the two overlap: T ≈ 58.7 − 0.59·grey °C, median error ≈ 2–5 °C).
// Height: each latitude band's clear-sky reference temperature (the warm end of that band, ~surface) minus the cloud-top
// temperature, divided by the standard lapse rate 6.5 °C/km, capped at the tropopause (≈ 16.5 km tropics → 8.5 km poles).
// Cover: pixels colder than the reference by > ~5 °C; thin or low warm cloud (stratocumulus, fog) is hard to see in
// infrared and is under-shown. Poleward of ~±75° the geostationary view is too oblique, so there is no cloud data there.
const CLOUD = {
  W: 2048, H: 1024, RW: 1024, RH: 512, key: '', loading: false, lastFetch: -1e9, exag: 30, cube: null, cubeD: null,
  ring: { slot: '', img: null, loading: false }, gibsImgs: [], info: 'loading…', gibsT: null, ringT: null,
  RING_FROM: Date.UTC(2021, 5, 6, 15), GIBS_DAYS: 70, targetT: 0, KM_PER_UNIT: MI_PER_UNIT * 1.609344,
};
const cloudCanvas = document.createElement('canvas'); cloudCanvas.width = CLOUD.W; cloudCanvas.height = CLOUD.H;
const cloudTex = new THREE.CanvasTexture(cloudCanvas);
Object.assign(cloudTex, { flipY: false, colorSpace: THREE.NoColorSpace, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping });
const cloudMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  uniforms: { uCloud: { value: cloudTex }, uExag: { value: 1 }, uKmToUnit: { value: 1 / CLOUD.KM_PER_UNIT }, uSunDec: { value: 0 }, uSunLon: { value: 0 }, uSunPos: { value: new THREE.Vector3(0, 3, 0) }, uOn: { value: 0 }, uSunOn: { value: 1 } },
  vertexShader: `uniform sampler2D uCloud; uniform float uExag, uKmToUnit; varying vec2 vLL; varying vec3 vW; varying float vKm;
    void main(){
      float rr = length(position.xz), lat = 90.0 - rr / ${R.toFixed(1)} * 180.0, lon = degrees(atan(-position.z, position.x));
      vLL = vec2(lon, lat);
      vec4 c = textureLod(uCloud, vec2((lon + 180.0) / 360.0, (lat + 90.0) / 180.0), 0.0);
      vKm = c.r * 18.0;
      vec3 p = position; p.y = max(vKm, 0.6) * uKmToUnit * uExag;        // cloud-top height, true scale × exaggeration
      vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `uniform sampler2D uCloud; uniform float uSunDec, uSunLon, uOn, uSunOn; uniform vec3 uSunPos; varying vec2 vLL; varying vec3 vW; varying float vKm;
    void main(){
      vec4 c = texture2D(uCloud, vec2((vLL.x + 180.0) / 360.0, (vLL.y + 90.0) / 180.0));
      float a = c.g * uOn; if (a < 0.02) discard;
      float la = radians(vLL.y), dl = radians(vLL.x) - uSunLon;
      float cz = uSunOn < 0.5 ? 1.0 : sin(la) * sin(uSunDec) + cos(la) * cos(uSunDec) * cos(dl);   // sun height above the horizon (real daylight)
      float day = smoothstep(-0.10, 0.06, cz);
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;
      float relief = 0.78 + 0.22 * max(dot(n, normalize(uSunPos - vW)), 0.0);
      vec3 col = mix(vec3(0.80, 0.83, 0.88), vec3(1.0), smoothstep(2.0, 12.0, vKm)) * relief;   // high tops brightest
      col = mix(vec3(0.06, 0.08, 0.13), col * (0.55 + 0.45 * smoothstep(0.0, 0.5, cz)), day);  // night side: barely visible
      gl_FragColor = vec4(col, a * mix(0.55, 0.92, day));
    }`,
});
const cloudMesh = (() => {   // polar grid matching the disc: 300 rings × 1024 spokes
  const NR = 300, NS = 1024, pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= NR; i++) { const r = R * i / NR; for (let j = 0; j < NS; j++) { const a = j / NS * Math.PI * 2; pos.push(r * Math.cos(a), 0, -r * Math.sin(a)); } }
  for (let j = 0; j < NS; j++) idx.push(0, 1 + j, 1 + (j + 1) % NS);
  for (let i = 1; i < NR; i++) for (let j = 0; j < NS; j++) { const a = 1 + (i - 1) * NS + j, b = 1 + (i - 1) * NS + (j + 1) % NS, c = a + NS, d = b + NS; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, cloudMat); m.renderOrder = 4; m.frustumCulled = false; m.visible = false; scene.add(m); return m;
})();
async function cloudPalette() {
  if (CLOUD.cube) return;
  const xml = await (await fetch('https://gibs.earthdata.nasa.gov/colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml')).text();
  const ents = [...xml.matchAll(/rgb="(\d+),(\d+),(\d+)"[^>]*?value="\(([-\d.]+),([-\d.]+)\]"/g)].map((m) => [+m[1], +m[2], +m[3], (+m[4] + +m[5]) / 2]);
  const cube = new Float32Array(32768), cd = new Float32Array(32768);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const R0 = r * 8 + 4, G0 = g * 8 + 4, B0 = b * 8 + 4; let best = 1e9, bt = 0;
    for (const e of ents) { const d = (e[0] - R0) ** 2 + (e[1] - G0) ** 2 + (e[2] - B0) ** 2; if (d < best) { best = d; bt = e[3]; } }
    cube[(r << 10) | (g << 5) | b] = bt; cd[(r << 10) | (g << 5) | b] = Math.sqrt(best);
  }
  CLOUD.cube = cube; CLOUD.cubeD = cd;
}
async function cloudImage(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const bm = await createImageBitmap(await r.blob());
  const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bm, 0, 0); bm.close?.();
  return g.getImageData(0, 0, cv.width, cv.height);
}
const isoMin = (t) => new Date(t).toISOString().slice(0, 16) + ':00Z';
const CLOUD_GIBS = [['GOES-East_ABI_Band13_Clean_Infrared', -75.2], ['GOES-West_ABI_Band13_Clean_Infrared', -137.2], ['Himawari_AHI_Band13_Clean_Infrared', 140.7]];
const cloudGibsUrl = (t, layer) => `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${CLOUD.W}&HEIGHT=${CLOUD.H}&FORMAT=image/png&TRANSPARENT=true&TIME=${isoMin(t)}`;
const cloudRingUrl = (t) => `https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=mumi:worldcloudmap_ir108&styles=&crs=EPSG:4326&bbox=-90,-180,90,180&width=${CLOUD.RW}&height=${CLOUD.RH}&format=image/png&transparent=true&time=${isoMin(t)}`;
/** Combine the satellite pictures into cloud-top height (red) and cover (green) on a lat/lon grid. */
function cloudBuild() {
  const { W, H, cube, cubeD } = CLOUD, gims = CLOUD.gibsImgs || [], ri = CLOUD.ring.img && Math.abs(CLOUD.ringT - CLOUD.targetT) <= 4 * HOUR ? CLOUD.ring.img : null, BT = new Float32Array(W * H).fill(NaN);   // ring used only when from the same time (±4 h)
  let nG = 0, nR = 0; const used = [0, 0, 0];
  // view angle: a geostationary satellite sees its own longitude straight down; towards its edge the infrared reads too
  // cold (limb cooling), so GIBS pixels > 62° from GOES-E/W or Himawari defer to the ring mosaic (which has Meteosat),
  // and nothing is shown > 72° from every satellite in the ring (incl. Meteosat 0° and 45.5° E).
  const cosA = (lat, lon, s0) => Math.cos(lat) * Math.cos((lon - s0) * Math.PI / 180), c62 = Math.cos(62 * Math.PI / 180), c72 = Math.cos(72 * Math.PI / 180);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, k = i * 4, la = (90 - (y + 0.5) * 180 / H) * Math.PI / 180, lo = -180 + (x + 0.5) * 360 / W;
    if (Math.max(cosA(la, lo, -75.2), cosA(la, lo, -137.2), cosA(la, lo, 140.7), cosA(la, lo, 0), cosA(la, lo, 45.5)) < c72) continue;
    const ringOk = ri && ri.data[(((y * CLOUD.RH / H) | 0) * CLOUD.RW + ((x * CLOUD.RW / W) | 0)) * 4 + 3] > 200;
    // the GIBS satellite that sees this spot most directly (each satellite fetched on its own, so edges never overwrite)
    let best = -2, img = null, bj = -1;
    if (cube) for (let j = 0; j < gims.length; j++) { const g = gims[j]; if (!g || g.data[k + 3] <= 200) continue; const c = cosA(la, lo, CLOUD_GIBS[j][1]); if (c > best) { best = c; img = g; bj = j; } }
    if (img && (best >= c62 || !ringOk)) {
      const q = ((img.data[k] >> 3) << 10) | ((img.data[k + 1] >> 3) << 5) | (img.data[k + 2] >> 3);
      if (cubeD[q] < 24) { BT[i] = cube[q]; nG++; used[bj]++; continue; }
    }
    if (ringOk) {   // bilinear between the 4 nearest ring pixels (it is half the resolution of the GIBS grid)
      const fx = (x + 0.5) * CLOUD.RW / W - 0.5, fy = (y + 0.5) * CLOUD.RH / H - 0.5, x0 = Math.floor(fx), y0 = Math.max(0, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
      let sum = 0, wsum = 0;
      for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
        const kk = (Math.min(CLOUD.RH - 1, y0 + dy) * CLOUD.RW + ((x0 + dx + CLOUD.RW) % CLOUD.RW)) * 4;
        if (ri.data[kk + 3] > 200) { sum += w * ri.data[kk]; wsum += w; }
      }
      if (wsum > 0) { BT[i] = 58.7 - 0.59 * sum / wsum; nR++; }
    }
  }
  // clear-sky reference per latitude row: the warm end (92nd percentile) of that row, smoothed over ±4 rows
  const ref = new Float32Array(H).fill(NaN), tmp = [];
  for (let y = 0; y < H; y++) { tmp.length = 0; for (let x = 0; x < W; x += 2) { const v = BT[y * W + x]; if (v === v) tmp.push(v); } if (tmp.length > 60) { tmp.sort((a, b) => a - b); ref[y] = tmp[Math.floor(tmp.length * 0.92)]; } }
  const refS = new Float32Array(H); for (let y = 0; y < H; y++) { let s = 0, n = 0; for (let d = -4; d <= 4; d++) { const v = ref[y + d]; if (v === v && v !== undefined) { s += v; n++; } } refS[y] = n ? s / n : NaN; }
  const KC = new Float32Array(W * H), CV = new Float32Array(W * H);   // cover-weighted top height, and cover
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * 180 / H, trop = 8.5 + 8 * Math.cos(lat * Math.PI / 180) ** 2, Tr = refS[y];
    for (let x = 0; x < W; x++) {
      const i = y * W + x, t = BT[i];
      if (!(t === t) || !(Tr === Tr)) { CV[i] = -1; continue; }                     // no data
      const d = Tr - t, cov = Math.min(1, Math.max(0, (d - 5) / 13)), c = cov * cov * (3 - 2 * cov);
      CV[i] = c; KC[i] = c * Math.min(trop, Math.max(0.6, d / 6.5));
    }
  }
  // tops: cover-weighted mean over ±3 px (~60 km) — smooth cloud tops whose edges fade out in place instead of sloping down
  const blur = (src, r) => { const a = new Float32Array(W * H), b = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { let acc = 0; const row = y * W; for (let x = -r; x <= r; x++) acc += Math.max(0, src[row + ((x + W) % W)]);
      for (let x = 0; x < W; x++) { a[row + x] = acc; acc += Math.max(0, src[row + (x + r + 1) % W]) - Math.max(0, src[row + ((x - r + W) % W)]); } }
    for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += a[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) { b[y * W + x] = acc; acc += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x]; } }
    return b; };
  const bKC = blur(KC, 3), bCV = blur(CV, 3), sCV = blur(CV, 1);   // cover softened over ±1 px (~20 km)
  const ctx = cloudCanvas.getContext('2d'), out = ctx.createImageData(W, H), o = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, k = (H - 1 - y) * W * 4 + x * 4;   // row 0 of the texture = south (lat −90)
    o[k + 3] = 255; if (CV[i] < 0) continue;
    const km = bCV[i] > 1e-3 ? bKC[i] / bCV[i] : 0.6;
    o[k] = Math.round(Math.min(18, km) / 18 * 255); o[k + 1] = Math.round(Math.min(1, sCV[i] / 9) * 255);
  }
  ctx.putImageData(out, 0, 0); cloudTex.flipY = false; cloudTex.needsUpdate = true;
  return { nG, nR, used };
}
/** Pick the satellite frame for the simulated time; live near the present, history back to mid-2021, latest when ahead. */
function cloudTick(nowMs) {
  const on = $('tClouds')?.checked ?? true; cloudMesh.visible = on; if (!on) return;
  const real = Date.now(), latest = real - 40 * MIN, sim = state.t;
  const target = Math.min(sim, latest), recent = target > real - CLOUD.GIBS_DAYS * DAY;
  if (target < CLOUD.RING_FROM) { cloudMat.uniforms.uOn.value = 0; CLOUD.info = 'No satellite cloud data before June 2021'; return cloudInfo(); }
  const gT = Math.floor(target / (10 * MIN)) * 10 * MIN;
  // the ring mosaic appears ~2¾ h after its time: near the present use the newest one out, otherwise the nearest 3-h slot
  const rT = Math.min(Math.round(target / (3 * HOUR)), Math.floor((real - 2.9 * HOUR) / (3 * HOUR))) * 3 * HOUR;
  const key = recent ? `g${gT}` : `r${rT}`; CLOUD.targetT = recent ? gT : rT;
  if (key !== CLOUD.key && !CLOUD.loading && nowMs - CLOUD.lastFetch > 2500) cloudLoad(key, recent ? gT : null, rT);
  // the 3-hourly ring for the gap (slow server): fetched in the background, then merged
  if (CLOUD.ring.slot !== `r${rT}` && !CLOUD.ring.loading && !(CLOUD.ring.failSlot === `r${rT}` && nowMs - CLOUD.ring.failAt < 60000)) {
    CLOUD.ring.loading = true; const slot = `r${rT}`;
    cloudImage(cloudRingUrl(rT)).then((img) => { CLOUD.ring.img = img; CLOUD.ring.slot = slot; CLOUD.ringT = rT; if (CLOUD.key && (CLOUD.cube || !recent)) { const n = cloudBuild(); cloudInfoSet(n); } })
      .catch(() => { CLOUD.ring.failSlot = slot; CLOUD.ring.failAt = performance.now(); if (!recent) { CLOUD.info = 'No cloud data for this time (EUMETSAT archive did not respond — retrying)'; cloudMat.uniforms.uOn.value = 0; cloudInfo(); } })
      .finally(() => { CLOUD.ring.loading = false; });
  }
}
async function cloudLoad(key, gT, rT) {
  CLOUD.loading = true; CLOUD.lastFetch = performance.now();
  try {
    if (gT != null) { await cloudPalette(); CLOUD.gibsImgs = await Promise.all(CLOUD_GIBS.map(([l]) => cloudImage(cloudGibsUrl(gT, l)).catch(() => null))); CLOUD.gibsT = gT; }
    else { CLOUD.gibsImgs = []; CLOUD.gibsT = null; }
    const n = cloudBuild(); cloudInfoSet(n);
    if (!n.nG && !n.nR) { CLOUD.info = gT != null ? 'No cloud data for this time' : 'Waiting for the EUMETSAT archive…'; cloudInfo(); }
    CLOUD.key = key;
  } catch (e) { CLOUD.info = `Cloud data unavailable (${e.message})`; cloudInfo(); CLOUD.key = key; }
  finally { CLOUD.loading = false; }
}
const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
function cloudInfoSet({ nG, nR, used = [] }) {
  const parts = [], names = ['GOES-East', 'GOES-West', 'Himawari'].filter((_, j) => used[j] > 2000);
  if (nG) parts.push(`${names.join(' + ')} (NASA GIBS) ${hhmm(CLOUD.gibsT)} UTC`);
  if (nR) parts.push(`Meteosat ring (EUMETSAT) ${hhmm(CLOUD.ringT)} UTC`);
  const ahead = state.t > Date.now() - 40 * MIN + 30 * MIN;
  CLOUD.info = (parts.join(' + ') || 'waiting for satellite data…') + (ahead && parts.length ? ' · latest available' : '');
  cloudMat.uniforms.uOn.value = parts.length ? 1 : 0; cloudInfo();
}
function cloudInfo() { const el = $('cloudSrc'); if (el) el.textContent = CLOUD.info; }
const slab = new THREE.Mesh(slabGeoIce,
  new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1, flatShading: true }));
slab.position.y = -0.71;
scene.add(slab);
const under = new THREE.Mesh(new THREE.CircleGeometry(R_OUT * 1.6, 64), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(90,140,255,0.35)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
under.rotation.x = -Math.PI / 2; under.position.y = -1.6; under.scale.setScalar(Math.min(1, (FIRM_R - 0.3) / (R_OUT * 1.6)));
scene.add(under);


// ---------- Realistic ice wall: layered blue ice cliffs, snowfield on top, icebergs and floes at the foot ----------
const wallReal = new THREE.Group();
scene.add(wallReal);
{
  // seamless noise around the ring: integer wave numbers only
  const TERMS = Array.from({ length: 26 }, (_, i) => ({ k: Math.round(2 + 1.42 ** i), ph: Math.random() * 6.283, w: 1 / 1.33 ** i }));
  const ring = (a, lo, hi) => { let s = 0, n = 0; for (let i = lo; i < hi; i++) { const T = TERMS[i]; s += T.w * Math.sin(T.k * a + T.ph); n += T.w; } return s / n; };
  const H = (a) => 0.46 + 0.2 * ring(a, 0, 9) + 0.07 * ring(a, 9, 26);            // cliff height
  const RF = (a) => R + 0.16 + 0.07 * ring(a + 1.7, 3, 18);                          // cliff-face line (bays, promontories)
  const canvasTex = (w, h, paint, rep = [1, 1]) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  };
  // cliff face: deep glacial blue at the waterline grading to white, annual layers, meltwater streaks, crevasses
  const cliffTex = canvasTex(1024, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, '#1d5f86'); grad.addColorStop(0.18, '#3f8fbd'); grad.addColorStop(0.5, '#a7d4ec'); grad.addColorStop(0.82, '#e6f5fc'); grad.addColorStop(1, '#ffffff');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const y = Math.random() * h; g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,80,130' : '255,255,255'},${0.05 + Math.random() * 0.1})`; g.fillRect(0, y, w, 1 + Math.random() * 4); }
    for (let i = 0; i < 260; i++) { const x = Math.random() * w, len = h * (0.2 + Math.random() * 0.8); g.fillStyle = `rgba(${Math.random() < 0.6 ? '255,255,255' : '30,90,140'},${0.05 + Math.random() * 0.12})`; g.fillRect(x, h - len, 1 + Math.random() * 3, len); }
    for (let i = 0; i < 26; i++) { let x = Math.random() * w; g.strokeStyle = `rgba(10,50,90,${0.35 + Math.random() * 0.35})`; g.lineWidth = 1 + Math.random() * 2.5; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y < h * (0.4 + Math.random() * 0.6); y += 12) { x += (Math.random() - 0.5) * 7; g.lineTo(x, y); } g.stroke(); }
  }, [36, 1]);
  const snowTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#f2f7fb'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${150 + Math.random() * 60},${185 + Math.random() * 50},${215 + Math.random() * 40},${0.05 + Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 18, 1 + Math.random() * 2); }
  }, [60, 3]);
  const NA = 2880, NY = 12;
  // cliff face
  {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2, h = H(a), rf = RF(a);
      for (let j = 0; j <= NY; j++) {
        const f = j / NY, y = -0.02 + f * (h + 0.02);
        const r = rf + 0.012 * Math.sin(j * 2.1 + i * 0.37) + 0.025 * ring(a * 1 + j * 0.2, 12, 24) * f;  // strata ledges + roughness
        pos.push(r * Math.cos(a), y, -r * Math.sin(a)); uv.push(i / NA, f);
      }
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < NY; j++) { const q = i * (NY + 1) + j, w2 = q + NY + 1; idx.push(q, q + 1, w2, w2, q + 1, w2 + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    wallReal.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: cliffTex, bumpMap: cliffTex, bumpScale: 0.6, roughness: 0.32, metalness: 0.02, emissive: 0x0c2a40, emissiveIntensity: 0.35, side: THREE.DoubleSide })));
  }
  // snowfield on top of the cliffs, out to the edge of the plane, then an ice skirt down the side
  {
    const NR = 7, rOut = ICE_OUT, pos = [], uv = [], idx = [];
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2, h = H(a), rf = RF(a);
      for (let j = 0; j <= NR; j++) {
        const f = j / NR, r = rf + (rOut - rf) * f, y = h * (1 - 0.06 * f) + 0.03 * ring(a * 3 + j, 6, 22) + (j === 0 ? 0.01 : 0);
        pos.push(r * Math.cos(a), y, -r * Math.sin(a)); uv.push(i / NA, f);
      }
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) { const q = i * (NR + 1) + j, w2 = q + NR + 1; idx.push(q, w2, q + 1, w2, w2 + 1, q + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    wallReal.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: snowTex, color: 0xf5f9fc, roughness: 0.92, emissive: 0x223344, emissiveIntensity: 0.25, side: THREE.DoubleSide })));
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(ICE_OUT + 0.01, ICE_OUT, 2.0, 360, 1, true),
      new THREE.MeshStandardMaterial({ map: cliffTex, roughness: 0.4, color: 0xcfe6f3, side: THREE.DoubleSide }));
    skirt.position.y = -0.6; wallReal.add(skirt);
  }
  // calved icebergs and sea-ice floes along the foot of the cliffs
  {
    const N = 900, geo = new THREE.DodecahedronGeometry(1, 0), m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const bergs = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, flatShading: true, emissive: 0x16384f, emissiveIntensity: 0.3 }), N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, dist = Math.random() ** 2.2 * 1.1, r = RF(a) - 0.06 - dist, big = Math.random() ** 3;
      p.set(r * Math.cos(a), 0, -r * Math.sin(a));
      q.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI, 0));
      const w = 0.02 + big * 0.12; sc.set(w * (1 + Math.random()), w * (0.25 + Math.random() * 0.5) * (1 - dist * 0.5), w * (1 + Math.random()));
      m.compose(p, q, sc); bergs.setMatrixAt(i, m); bergs.setColorAt(i, col.setHSL(0.55, 0.45, 0.82 + Math.random() * 0.16));
    }
    wallReal.add(bergs);
    const floes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 7), new THREE.MeshStandardMaterial({ color: 0xeef6fb, roughness: 0.8, transparent: true, opacity: 0.85 }), 1400);
    for (let i = 0; i < 1400; i++) {
      const a = Math.random() * Math.PI * 2, r = RF(a) - 0.04 - Math.random() ** 1.6 * 0.9, w = 0.01 + Math.random() * 0.05;
      p.set(r * Math.cos(a), 0.004, -r * Math.sin(a)); q.setFromEuler(new THREE.Euler(0, Math.random() * 6.28, 0)); sc.set(w, 0.004, w * (0.5 + Math.random()));
      m.compose(p, q, sc); floes.setMatrixAt(i, m);
    }
    wallReal.add(floes);
  }
}
function applyWallStyle() { wallReal.visible = $('tWall') ? $('tWall').checked : true; }

// ---------- Dome / firmament ----------
const domeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
    void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv; uniform float uTime;
    void main(){
      float fres = pow(1.0 - abs(dot(vN, vV)), 2.2);
      vec3 col = mix(vec3(0.12,0.3,0.85), vec3(0.55,0.85,1.0), fres);
      float a = fres*0.8 + 0.02;   // smooth glass-like firmament, no grid lines
      gl_FragColor = vec4(col*a, 1.0);
    }`,
});
const dome = new THREE.Mesh(new THREE.SphereGeometry(FIRM_R, 160, 96), domeMat);   // the whole sphere, above and below the disc
dome.renderOrder = 5;
scene.add(dome);

// Star wheel: everything fixed to the firmament lives in this group and turns once per sidereal day
const firmament = new THREE.Group();
scene.add(firmament);
const stars = new THREE.Group();
{
  const N = 2600, pos = new Float32Array(N * 3), cols = new Float32Array(N * 3), c = new THREE.Color(), v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const r = (R + 0.2) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const dec = 90 - (r / R) * 180;
    skyPos(rad(a), dec, 0.985, v); pos.set([v.x, v.y, v.z], i * 3);
    c.setHSL(0.55 + Math.random() * 0.12 - (Math.random() < 0.15 ? 0.5 : 0), 0.5, 0.75 + Math.random() * 0.25);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  stars.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.08, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const polaris = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('#ffffff', 'rgba(150,200,255,0)'), color: 0xcfe6ff, depthWrite: false, blending: THREE.AdditiveBlending }));
  polaris.position.set(0, DOME_H * 0.985, 0); polaris.scale.setScalar(0.7);
  stars.add(polaris);
}
firmament.add(stars);

// ---------- Fixed stars: on the outside of the dome, fixed to it, turning with it once a sidereal day ----------
// Real stars: the brightest and the ones that make the best-known patterns. Positions are J2000 right ascension and
// declination (°; precession since 2000 is ~0.4°, too small to see here) and visual magnitudes. Each star sits on the
// outside of the firmament straight above the point on the map it passes over (its declination = that latitude).
const FIXED_STARS = [
  // name, RA°, Dec°, mag, colour
  ['Sirius', 101.287, -16.716, -1.46, '#cfe0ff'], ['Canopus', 95.988, -52.696, -0.74, '#fff8ea'], ['Arcturus', 213.915, 19.182, -0.05, '#ffcf8a'],
  ['Vega', 279.234, 38.784, 0.03, '#d6e4ff'], ['Capella', 79.172, 45.998, 0.08, '#fff2c8'], ['Rigel', 78.634, -8.202, 0.13, '#c8d8ff'],
  ['Procyon', 114.825, 5.225, 0.34, '#fff8e8'], ['Betelgeuse', 88.793, 7.407, 0.50, '#ffb070'], ['Achernar', 24.429, -57.237, 0.46, '#c8d8ff'],
  ['Hadar', 210.956, -60.373, 0.61, '#c8d8ff'], ['Altair', 297.696, 8.868, 0.76, '#f4f6ff'], ['Acrux', 186.650, -63.099, 0.76, '#c8d8ff'],
  ['Aldebaran', 68.980, 16.509, 0.86, '#ffb878'], ['Antares', 247.352, -26.432, 0.96, '#ff9a62'], ['Spica', 201.298, -11.161, 0.97, '#c8d8ff'],
  ['Pollux', 116.329, 28.026, 1.14, '#ffd8a0'], ['Fomalhaut', 344.413, -29.622, 1.16, '#f4f6ff'], ['Deneb', 310.358, 45.280, 1.25, '#f4f6ff'],
  ['Mimosa', 191.930, -59.689, 1.25, '#c8d8ff'], ['Regulus', 152.093, 11.967, 1.35, '#dce6ff'], ['Adhara', 104.656, -28.972, 1.50, '#c8d8ff'],
  ['Castor', 113.650, 31.888, 1.58, '#f4f6ff'], ['Shaula', 263.402, -37.104, 1.62, '#c8d8ff'], ['Gacrux', 187.791, -57.113, 1.64, '#ffb878'],
  ['Bellatrix', 81.283, 6.350, 1.64, '#c8d8ff'], ['Elnath', 81.573, 28.608, 1.65, '#dce6ff'], ['Miaplacidus', 138.300, -69.717, 1.67, '#f4f6ff'],
  ['Alnilam', 84.053, -1.202, 1.69, '#c8d8ff'], ['Alnair', 332.058, -46.961, 1.74, '#c8d8ff'], ['Alnitak', 85.190, -1.943, 1.77, '#c8d8ff'],
  ['Alioth', 193.507, 55.960, 1.77, '#f4f6ff'], ['Dubhe', 165.932, 61.751, 1.79, '#ffd8a0'], ['Mirfak', 51.081, 49.861, 1.79, '#fff2c8'],
  ['Wezen', 107.098, -26.393, 1.83, '#fff2c8'], ['Sargas', 264.330, -42.998, 1.86, '#fff2c8'], ['Kaus Australis', 276.043, -34.385, 1.85, '#dce6ff'],
  ['Avior', 125.628, -59.509, 1.86, '#ffcf8a'], ['Alkaid', 206.885, 49.313, 1.86, '#c8d8ff'], ['Menkalinan', 89.882, 44.948, 1.90, '#f4f6ff'],
  ['Atria', 252.166, -69.028, 1.91, '#ffcf8a'], ['Alhena', 99.428, 16.399, 1.92, '#f4f6ff'], ['Peacock', 306.412, -56.735, 1.94, '#c8d8ff'],
  ['Polaris', 37.954, 89.264, 1.98, '#fff2c8'], ['Mirzam', 95.675, -17.956, 1.98, '#c8d8ff'], ['Alphard', 141.897, -8.659, 1.98, '#ffcf8a'],
  ['Hamal', 31.793, 23.462, 2.00, '#ffcf8a'], ['Algieba', 154.993, 19.842, 2.08, '#ffcf8a'], ['Diphda', 10.897, -17.987, 2.04, '#ffcf8a'],
  ['Nunki', 283.816, -26.297, 2.05, '#c8d8ff'], ['Menkent', 211.671, -36.370, 2.06, '#ffcf8a'], ['Mirach', 17.433, 35.621, 2.05, '#ffb878'],
  ['Alpheratz', 2.097, 29.090, 2.06, '#dce6ff'], ['Rasalhague', 263.734, 12.560, 2.07, '#f4f6ff'], ['Kochab', 222.676, 74.156, 2.08, '#ffb878'],
  ['Saiph', 86.939, -9.670, 2.09, '#c8d8ff'], ['Denebola', 177.265, 14.572, 2.14, '#f4f6ff'], ['Algol', 47.042, 40.956, 2.12, '#dce6ff'],
  ['Mizar', 200.981, 54.925, 2.23, '#f4f6ff'], ['Merak', 165.460, 56.382, 2.37, '#f4f6ff'], ['Phecda', 178.458, 53.695, 2.44, '#f4f6ff'],
  ['Megrez', 183.857, 57.033, 3.31, '#f4f6ff'], ['Mintaka', 83.002, -0.299, 2.23, '#c8d8ff'], ['Alcyone (Pleiades)', 56.871, 24.105, 2.87, '#c8d8ff'],
  ['Schedar', 10.127, 56.537, 2.24, '#ffcf8a'], ['Caph', 2.295, 59.150, 2.28, '#fff8e8'], ['γ Cassiopeiae', 14.177, 60.717, 2.47, '#c8d8ff'],
  ['Ruchbah', 21.454, 60.235, 2.68, '#f4f6ff'], ['Segin', 28.599, 63.670, 3.37, '#c8d8ff'], ['Imai (δ Crucis)', 183.786, -58.749, 2.79, '#c8d8ff'],
  ['Sadr', 305.557, 40.257, 2.23, '#fff2c8'], ['Albireo', 292.680, 27.960, 3.08, '#ffcf8a'], ['Enif', 326.046, 9.875, 2.39, '#ffb878'],
  ['Markab', 346.190, 15.205, 2.49, '#dce6ff'], ['Scheat', 345.944, 28.083, 2.42, '#ffb070'], ['Algenib', 3.309, 15.184, 2.83, '#c8d8ff'],
];
const FIXED_LINES = [   // Orion, the Plough, Cassiopeia, the Southern Cross, the Summer Triangle, the Square of Pegasus, Scorpius' tail, Cygnus
  ['Betelgeuse', 'Bellatrix'], ['Bellatrix', 'Mintaka'], ['Mintaka', 'Alnilam'], ['Alnilam', 'Alnitak'], ['Alnitak', 'Saiph'], ['Saiph', 'Rigel'], ['Rigel', 'Mintaka'], ['Betelgeuse', 'Alnitak'],
  ['Dubhe', 'Merak'], ['Merak', 'Phecda'], ['Phecda', 'Megrez'], ['Megrez', 'Dubhe'], ['Megrez', 'Alioth'], ['Alioth', 'Mizar'], ['Mizar', 'Alkaid'],
  ['Caph', 'Schedar'], ['Schedar', 'γ Cassiopeiae'], ['γ Cassiopeiae', 'Ruchbah'], ['Ruchbah', 'Segin'],
  ['Acrux', 'Gacrux'], ['Mimosa', 'Imai (δ Crucis)'],
  ['Vega', 'Deneb'], ['Deneb', 'Altair'], ['Altair', 'Vega'],
  ['Markab', 'Scheat'], ['Scheat', 'Alpheratz'], ['Alpheratz', 'Algenib'], ['Algenib', 'Markab'],
  ['Antares', 'Sargas'], ['Sargas', 'Shaula'],
  ['Deneb', 'Sadr'], ['Sadr', 'Albireo'],
];
const fixedStars = new THREE.Group(); firmament.add(fixedStars);
const FIXED_OUT = 1.012;   // just outside the dome
const fixedPos = (ra, dec, out = new THREE.Vector3()) => skyPos(ra, dec, 1, out).normalize().multiplyScalar(FIRM_R * FIXED_OUT);
const fixedByName = {};
{
  const N = FIXED_STARS.length, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), c = new THREE.Color(), v = new THREE.Vector3();
  FIXED_STARS.forEach(([name, ra, dec, mag, css], i) => {
    fixedPos(ra, dec, v); pos.set([v.x, v.y, v.z], i * 3); c.set(css); col.set([c.r, c.g, c.b], i * 3);
    size[i] = 0.32 * Math.pow(10, -0.4 * (mag - 2) * 0.5);   // brighter stars drawn larger
    fixedByName[name] = { v: v.clone(), mag };
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uMap: { value: DOT }, uScale: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale * 420.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vC; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb * 1.6, t.a); }`,
  });
  const pts = new THREE.Points(g, mat); pts.renderOrder = 4; fixedStars.add(pts);
  const seg = []; for (const [a, b] of FIXED_LINES) if (fixedByName[a] && fixedByName[b]) seg.push(fixedByName[a].v, fixedByName[b].v);
  fixedStars.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.55, depthWrite: false })));
}

// ---------- Zodiac ring on the firmament ----------
const zodiac = new THREE.Group();
function textSprite(lines, color, w = 256, h = 128) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 8;
  ctx.font = '600 64px "Apple Symbols", "Segoe UI Symbol", serif'; ctx.fillText(lines[0], w / 2, h * 0.38);
  ctx.font = '600 26px system-ui'; ctx.fillText(lines[1], w / 2, h * 0.8);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(1.0, 0.5, 1);
  return s;
}
function buildZodiac(t) {
  zodiac.clear();
  const line = (beta, opacity, color = 0xf3c46b) => {
    const pts = [];
    for (let l = 0; l <= 360; l += 1) { const q = eclToEqAt(l, beta, t); pts.push(skyPos(q.ra, q.dec, 0.975)); }
    zodiac.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
  };
  line(0, 0.75); line(8, 0.25); line(-8, 0.25);
  for (let i = 0; i < 12; i++) {
    const a = eclToEqAt(i * 30, 8, t), b = eclToEqAt(i * 30, -8, t);
    zodiac.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([skyPos(a.ra, a.dec, 0.975), skyPos(b.ra, b.dec, 0.975)]),
      new THREE.LineBasicMaterial({ color: 0xf3c46b, transparent: true, opacity: 0.45 })));
    const m = eclToEqAt(i * 30 + 15, 0, t);
    const s = textSprite([SIGNS[i].glyph, SIGNS[i].name.toUpperCase()], '#ffe2a3');
    skyPos(m.ra, m.dec, 0.93, s.position);
    zodiac.add(s);
  }
}
firmament.add(zodiac);
// marker showing where the sun sits in the zodiac
const sunMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,220,120,1)', 'rgba(255,160,40,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
sunMarker.scale.setScalar(0.6);
firmament.add(sunMarker);

// ---------- Planets ("wandering stars") ----------
const planetGroup = new THREE.Group();
const planetSprites = PLANETS.map((p) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color(p.color), depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(p.size);
  planetGroup.add(s);
  return s;
});
firmament.add(planetGroup);

// Trails across the firmament (planets, moon) live here, in the star wheel's frame

// ---------- Sun & moon (luminaries) ----------
const sun = new THREE.Group();
{
  const core = new THREE.Mesh(new THREE.SphereGeometry(LUM_DISC / 2, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,214,107,0.9)', 'rgba(255,140,40,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(LUM_GLOW);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,200,90,0.16)', 'rgba(255,120,40,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(LUM_GLOW); // same outer size as the moon's glow
  sun.add(core, glow, halo);
}
scene.add(sun);
const sunLight = new THREE.SpotLight(0xffe2b0, 2.2, 0, Math.atan(LIGHT_R * 1.12 / SUN_H), 0.12, 0);
let sunLampAt = 0, sunLampR = 0;
const sunTarget = new THREE.Object3D();
scene.add(sunLight, sunTarget);
sunLight.target = sunTarget;

const nightMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uSunP: { value: new THREE.Vector3() }, uMoonP: { value: new THREE.Vector3() }, uLumR: { value: new THREE.Vector2() }, uEcl: { value: 0 }, uMode: { value: 0 }, uSunDec: { value: 0 }, uSunLon: { value: 0 }, uShapeA: { value: new THREE.Vector4() }, uShapeB: { value: new THREE.Vector2() }, uMoon: { value: new THREE.Vector2() }, uMoonI: { value: 0 }, uL: { value: LIGHT_R }, uOn: { value: 1 }, uOutline: { value: 1 } },
  vertexShader: `varying vec2 vP;${TERRAIN_GLSL}
    void main(){ vec3 p = position; p.z += terrainH(position.xy); vec4 w = modelMatrix*vec4(p,1.0); vP = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `varying vec2 vP; uniform vec3 uSunP; uniform vec3 uMoonP; uniform vec2 uLumR; uniform float uEcl; uniform float uMode; uniform float uSunDec; uniform float uSunLon; uniform vec4 uShapeA; uniform vec2 uShapeB; uniform vec2 uMoon; uniform float uMoonI; uniform float uL; uniform float uOn; uniform float uOutline;
    const float PI = 3.14159265;
    // fraction of the sun's disc (radius rs) covered by the moon's disc (radius rm), centres d apart (all angles)
    float covered(float d, float rs, float rm){
      if (d >= rs + rm) return 0.0;
      if (d <= abs(rm - rs)) return rm >= rs ? 1.0 : (rm*rm)/(rs*rs);
      float a = rs*rs*acos(clamp((d*d + rs*rs - rm*rm)/(2.0*d*rs), -1.0, 1.0));
      float b = rm*rm*acos(clamp((d*d + rm*rm - rs*rs)/(2.0*d*rm), -1.0, 1.0));
      float k = 0.5*sqrt(max(0.0, (-d+rs+rm)*(d+rs-rm)*(d-rs+rm)*(d+rs+rm)));
      return (a + b - k) / (PI*rs*rs);
    }
    void main(){
      float c = length(vP) * ${(180 / R).toFixed(4)};                 // degrees from the North Pole
      float th = mod(atan(-vP.y, vP.x) - uSunLon + PI, 2.0*PI) - PI;  // angle from the sun's noon meridian
      float night, twilight, edge, spot = 0.0;
      if (uMode < 0.5) {
        // real world: the sun's true elevation at this point (standard sunrise/twilight thresholds)
        float lat = radians(90.0 - c), dl = th;
        float e = degrees(asin(clamp(sin(lat)*sin(uSunDec) + cos(lat)*cos(uSunDec)*cos(dl), -1.0, 1.0)));
        // sunlight strength on the ground ∝ sin(sun height): brightest directly under the sun (the spotlight),
        // fading toward sunset, then through civil/nautical/astronomical twilight to night
        float ins = max(sin(radians(e)), 0.0);
        night = e >= 0.0 ? 0.6 * pow(1.0 - ins, 1.4) : 0.6 + 0.4 * smoothstep(0.0, 18.0, -e);
        spot = pow(ins, 3.0);   // wider, brighter sunlit pool
        twilight = exp(-(e + 2.0)*(e + 2.0) / 12.5);
        edge = (1.0 - smoothstep(0.0, 0.35, abs(e + 0.833))) * uOutline * 0.3;   // the sunrise/sunset line
      } else {
        float dx = c*cos(th) - uShapeA.x, y = c*sin(th), r = max(length(vec2(dx, y)), 1e-4);
        float a = dx < 0.0 ? uShapeA.y : uShapeA.z, n = dx < 0.0 ? uShapeB.x : uShapeB.y;
        float rb = 1.0 / pow(pow(abs(dx)/r/a, n) + pow(abs(y)/r/uShapeA.w, n), 1.0/n);
        float m = rb - r;
        night = 1.0 - smoothstep(-7.0, 5.0, m);
        twilight = exp(-(m + 1.0)*(m + 1.0) / 50.0);
        edge = (1.0 - smoothstep(0.0, 0.9, abs(m))) * uOutline * 0.35;
      }
      float moon = (1.0 - smoothstep(0.0, uL*0.6, distance(vP, uMoon))) * (0.35 + 0.65*uMoonI);
      vec3 col = mix(vec3(0.01,0.02,0.07), vec3(0.10,0.15,0.32), moon);
      float alpha = night * (0.95 - 0.3*moon);   // much darker night side (moonlight still shows)
      col = mix(col, vec3(1.0,0.5,0.2), twilight*0.45);
      alpha = max(alpha, twilight*0.16);
      col = mix(col, vec3(1.0,0.93,0.7), spot); alpha = max(alpha * (1.0 - spot), spot * 0.32);   // warm sunlit pool, twice as strong
      col = mix(col, vec3(1.0,0.86,0.5), edge); alpha = max(alpha, edge*0.5);
      if (uEcl > 0.5) {
        // solar eclipse: how much of the model sun the model moon hides, seen from this spot on the plane
        vec3 P = vec3(vP.x, 0.0, vP.y), ds = uSunP - P, dm = uMoonP - P;
        if (length(dm) < length(ds)) {
          float d = atan(length(cross(ds, dm)), dot(ds, dm));
          float f = covered(d, asin(min(1.0, uLumR.x/length(ds))), asin(min(1.0, uLumR.y/length(dm))));
          float dk = 0.5 * f + 0.35 * pow(f, 6.0);
          col = mix(col, vec3(0.0, 0.01, 0.05), dk); alpha = max(alpha, dk);
          float rim = f > 0.0 ? exp(-pow((f - 0.985) * 60.0, 2.0)) : 0.0;     // edge of totality / annularity
          col = mix(col, vec3(1.0, 0.75, 0.35), rim*0.6); alpha = max(alpha, rim*0.5);
        }
      }
      gl_FragColor = vec4(col, alpha*uOn);
    }`,
});
Object.assign(nightMat.uniforms, terrUniforms);
const nightDisc = new THREE.Mesh(polarGrid(R + 0.05, 300, 768), nightMat);   // follows the terrain, so lit peaks still get night
nightDisc.rotation.x = -Math.PI / 2; nightDisc.position.y = 0.006;
scene.add(nightDisc);

const moonCanvas = document.createElement('canvas'); moonCanvas.width = moonCanvas.height = 128;
const moonTex = new THREE.CanvasTexture(moonCanvas); moonTex.colorSpace = THREE.SRGBColorSpace;
function drawMoon(age) {
  const ctx = moonCanvas.getContext('2d'), c = 64, r = 54;
  ctx.clearRect(0, 0, 128, 128);
  const dark = '#2a3346', lit = '#eef2fb';
  ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
  const k = Math.cos(2 * Math.PI * age / 29.530588), waxing = age < 29.530588 / 2;
  ctx.fillStyle = lit; ctx.beginPath(); ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2, !waxing); ctx.fill();
  ctx.fillStyle = k > 0 ? dark : lit; ctx.beginPath(); ctx.ellipse(c, c, r * Math.abs(k), r, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  for (const [x, y, s] of [[50, 48, 9], [78, 70, 7], [60, 84, 5], [84, 44, 5]]) { ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); }
  moonTex.needsUpdate = true;
}
const moon = new THREE.Group();
{
  const disk = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, depthWrite: false }));
  disk.scale.setScalar(LUM_DISC);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(190,210,255,0.45)', 'rgba(120,150,255,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(LUM_GLOW);
  moon.add(glow, disk);
}
scene.add(moon);
// self-luminous "cold" moonlight
const moonLight = new THREE.SpotLight(0x9fb8ff, 0.35, 0, Math.atan(LIGHT_R * 0.7 / MOON_H), 0.6, 0);
const moonTarget = new THREE.Object3D();
scene.add(moonLight, moonTarget);
moonLight.target = moonTarget;

// ---------- Electromagnetic torus field ----------
const field = new THREE.Group();
// The field is built around the sun's path. The "sun shell" (gold) is a flux surface whose outer flank IS the sun's
// straight 42.5° path: it rises up the polar column, arches over, runs straight down the slope through the small June
// circle and the big December circle, meets the plane and returns beneath it. Being the same all round the pole, the
// sun's daily circle lies in it (carried by its field ring) and its seasonal drift runs along the flank — so the whole
// analemma lies exactly on this surface. The other shells are nested around a magnetic axis and never cross it.
const kSlope = () => 1 / Math.tan(SUN_TILT.v * Math.PI / 180);
const flankY = (r) => SUN_H + (R / 2 - r) * kSlope();           // identical to lumAlt() on the slope
function bezierPts(p0, p1, p2, p3, n, out, skipFirst = true) {
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}
function sunShellProfile() {
  const th = SUN_TILT.v * Math.PI / 180, dir = [Math.sin(th), -Math.cos(th)];   // down the slope, outward
  const B = [0.12, -0.7], C = [0.12, 4.3];
  const F1 = [2.4, flankY(2.4)];                                         // where the flank starts (inside the June circle)
  const G = [R / 2 + (SUN_H - 0.05) / kSlope(), 0.05];                   // where the flank meets the plane (beyond December)
  const P = [];
  for (let i = 0; i <= 24; i++) P.push([B[0], B[1] + (C[1] - B[1]) * i / 24]);                    // up the polar column
  bezierPts(C, [C[0], C[1] + 0.75], [F1[0] - dir[0] * 1.0, F1[1] - dir[1] * 1.0], F1, 40, P);     // over the top
  for (let i = 1; i <= 80; i++) P.push([F1[0] + (G[0] - F1[0]) * i / 80, F1[1] + (G[1] - F1[1]) * i / 80]); // the sun's slope
  bezierPts(G, [G[0] + dir[0] * 1.5, G[1] + dir[1] * 1.5], [B[0], B[1] - 1.7], B, 50, P);          // back under the plane
  return P;
}
const FIELD_AXIS = [3.3, 1.75];                                          // the magnetic axis the shells wrap around
const SUN_SHELL = sunShellProfile();
function shellWithLengths(prof) { const cum = [0]; for (let i = 1; i < prof.length; i++) cum.push(cum[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1])); return { prof, cum, len: cum[cum.length - 1] }; }
const FIELD_SHELLS = [{ lambda: 0.36, color: 0x8a7bff }, { lambda: 0.68, color: 0x6aa8ff }, { lambda: 1.0, color: 0xffd56b, sun: true }, { lambda: 1.09, color: 0x5fffe0 }]
  .map((sh) => ({ ...sh, ...shellWithLengths(SUN_SHELL.map(([r, y]) => [Math.max(0.05, FIELD_AXIS[0] + sh.lambda * (r - FIELD_AXIS[0])), FIELD_AXIS[1] + sh.lambda * (y - FIELD_AXIS[1])])) }));
const MERIDIANS = 18;
// a point a fraction u of the way round a shell's loop (up the column → over → down the flank → back under), at azimuth `angle`
function loopPoint(shell, u, angle, out) {
  const target = (((u % 1) + 1) % 1) * shell.len; let lo = 0, hi = shell.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (shell.cum[m] <= target) lo = m; else hi = m; }
  const seg = shell.cum[hi] - shell.cum[lo] || 1, t = (target - shell.cum[lo]) / seg, a = shell.prof[lo], b = shell.prof[hi];
  const r = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
  return out.set(r * Math.cos(angle), y, -r * Math.sin(angle));
}
{
  const v = new THREE.Vector3();
  FIELD_SHELLS.forEach((sh, si) => {
    for (let m = 0; m < MERIDIANS; m++) {
      const a = (m / MERIDIANS) * Math.PI * 2 + si * 0.17, pts = [];
      for (let i = 0; i <= 220; i++) pts.push(loopPoint(sh, i / 220, a, v).clone());
      field.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: sh.color, transparent: true, opacity: sh.sun ? 0.55 : 0.28, blending: THREE.AdditiveBlending, depthWrite: false })));
    }
  });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.22, DOME_H * 0.85, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  col.position.y = DOME_H * 0.42;
  field.add(col);
}
const FP = 1600, fieldParticles = new Float32Array(FP * 3), fpMeta = [];
for (let i = 0; i < FP; i++) fpMeta.push({ shell: FIELD_SHELLS[i % 4], a: Math.random() * Math.PI * 2, u: Math.random(), sp: 0.05 + Math.random() * 0.05 });
const fpGeo = new THREE.BufferGeometry(); fpGeo.setAttribute('position', new THREE.BufferAttribute(fieldParticles, 3));
field.add(new THREE.Points(fpGeo, new THREE.PointsMaterial({ size: 0.13, map: DOT, color: 0xb8f0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));



// Daily circuits + trailing paths for the luminaries
function circleLine(color, opacity) {
  const pts = [];
  for (let i = 0; i <= 256; i++) { const a = i / 256 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a))); }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.02, gapSize: 0.015 }));
  l.computeLineDistances();
  return l;
}
const sunPath = circleLine(0xffd56b, 0.5); sunPath.position.y = SUN_H;
const moonPath = circleLine(0xaebee0, 0.3); moonPath.position.y = MOON_H;
const paths = new THREE.Group(); paths.add(sunPath, moonPath);
scene.add(paths);
// line from the sun up to its place in the zodiac
const signLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const signLine = new THREE.Line(signLineGeo, new THREE.LineDashedMaterial({ color: 0xffd56b, dashSize: 0.1, gapSize: 0.08, transparent: true, opacity: 0.5 }));
scene.add(signLine);

// ---------- Luminary torus (visual) ----------
const lumTorus = new THREE.Group();   // the Sun's path guide: Cancer ring (small, high), equator ring, Capricorn ring (big, low), slope lines
function buildLumTorus() {
  lumTorus.traverse((c) => c.geometry?.dispose());
  lumTorus.clear();
  if (LUM.mode !== 'torus') { // slope guide: Cancer ring (small, high), equator ring, Capricorn ring (big, low), straight slope lines
    if (LUM.mode === 'flat') return;
    const ring = (dec, col, op) => { const pts = []; for (let i = 0; i <= 256; i++) pts.push(latLonToXZ(dec, i / 256 * 360 - 180, lumAlt(dec))); lumTorus.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }))); };
    ring(23.44, 0xffb347, 0.7); ring(0, 0x7fd8ff, 0.5); ring(-23.44, 0xffb347, 0.7);
    const seg = [];
    for (let i = 0; i < 24; i++) { const lon = i / 24 * 360 - 180; seg.push(latLonToXZ(23.44, lon, lumAlt(23.44)), latLonToXZ(-23.44, lon, lumAlt(-23.44))); }
    lumTorus.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0xffc77a, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })));
    return;
  }
  const k = LUM.amp / LUM.a, base = lumBase();
  const shell = new THREE.Mesh(new THREE.TorusGeometry(LUM.rc, LUM.a, 48, 220),
    new THREE.MeshBasicMaterial({ color: 0xffb860, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  shell.rotation.x = Math.PI / 2;
  const holder = new THREE.Group(); holder.add(shell);
  holder.scale.y = Math.max(k, 0.02); holder.position.y = base;
  lumTorus.add(holder);
  const mat = new THREE.LineBasicMaterial({ color: 0xffc77a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const pt = (r, y, ang) => new THREE.Vector3(r * Math.cos(ang), y, -r * Math.sin(ang));
  for (let m = 0; m < 36; m++) { // cross-sections of the tube
    const ang = m / 36 * Math.PI * 2, pts = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2; pts.push(pt(LUM.rc + LUM.a * Math.cos(t), base + LUM.amp * Math.sin(t), ang)); }
    lumTorus.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  for (const off of [-TROPIC_OFF, 0, TROPIC_OFF]) { // ridges above the tropics and the equator: the luminaries' track
    const pts = [], y = lumAlt(90 - (LUM.rc + off) / R * 180);
    for (let i = 0; i <= 256; i++) pts.push(pt(LUM.rc + off, y, i / 256 * Math.PI * 2));
    lumTorus.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: off === 0 ? 0x7fd8ff : 0xffb347, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
  }
}
buildLumTorus(); scene.add(lumTorus); lumTorus.visible = false;   // shown with the analemma

// ---------- Pattern lab: trace paths over years ----------
const trace = new THREE.Group(), overlay = new THREE.Group();
scene.add(trace, overlay);
const sunSub = (t) => subpoint('Sun', t);
const moonSub = (t) => subpoint('Moon', t);
function colouredLine(pts, h0, h1, opacity = 0.85, asPoints = false) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const n = pts.length, cols = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.setHSL(h0 + (h1 - h0) * i / Math.max(1, n - 1), 0.85, 0.62); cols.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = asPoints
    ? new THREE.PointsMaterial({ size: 0.16, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    : new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  return asPoints ? new THREE.Points(g, mat) : new THREE.Line(g, mat);
}
const patternState = { zExag: 6 };
const PATTERNS = {
  none: { note: 'Pick a pattern to trace it in the scene. Time is coloured from orange (start) to blue (end).' },
  sun1: { note: 'Sun, 1 year: one loop a day around the pole, stepping out to Capricorn and back to Cancer. The loops are concentric, so they stack into a tightly wound spiral band, not overlapping circles.' },
  sun8: { note: 'Sun, 8 years: the same band traced over and over. Every loop is centred on the pole, so no petals form.' },
  moon1: { note: 'Moon, 1 day: its exact track over the Earth (ephemeris) for the next 24 h — it lags the Sun by ~50 min a day, so its daily circle drifts east.' },
  moon27: { note: 'Moon, 1 month (27.3 days): one full swing north and south of the equator, the exact track over the Earth, drawn where the Moon is in this model.' },
  moon365: { note: 'Moon, 1 year: about 13 monthly swings between its northern and southern limits, the exact track over the Earth.' },
  moon19: { note: 'Moon, 18.6 years: a monthly in-and-out swing whose reach breathes over the 18.6-year lunar node cycle (±18.3° to ±28.7°). Still a band centred on the pole.' },
  analemma: { note: 'Sun at the same clock time every day for a year: a figure-8 (the analemma) from the tropics and the equation of time.' },
  venus: { note: 'Venus, 8 years (ephemeris, geocentric): 13 Venus orbits ≈ 8 Earth years, tracing a 5-petal rose. This is the real "flower" in the sky. Drawn in 3D: distance from Earth outward, height above/below the ecliptic (magnified).' },
  mercury: { note: 'Mercury, 7 years (ephemeris, geocentric): about 3 loops a year make a dense multi-petal rosette.' },
  iss1: { note: 'ISS, 1 day (real orbit): about 15.5 orbits, each swinging between 51.6°N and 51.6°S. On this pole-centred map every orbit bends into a loop, and together they weave a ring-shaped (toroidal) band about 2,650–9,800 mi from the pole, shifting west about 23° each orbit.' },
  iss7: { note: 'ISS, 7 days (real orbit): ~108 orbits. The orbits drift west each day and fill the band. Accuracy fades with distance from the orbit data date (see ISS panel).' },
  iss14: { note: 'ISS, 14 days (real orbit): ~217 orbits densely covering the band. Positions far from the orbit data date are approximate.' },
  iss30: { note: 'ISS, 30 days (real orbit): ~465 orbits. Shape is right; exact timing drifts by tens to hundreds of km the further you go from the orbit data date.' },
  iss3: { note: 'ISS, 3 days (real orbit): about 46 interlaced loops filling the ring between 51.6°N and 51.6°S. This is the same track a satellite traces on any map; the pole-centred projection is what turns it into a torus-like band.' },
  jupiter: { note: 'Jupiter, 12 years (ephemeris, geocentric 3D): 11 retrograde loops, one per ~399-day synodic period, around one 11.9-year circuit. Height above/below the ecliptic magnified by the slider.' },
  saturn: { note: 'Saturn, 30 years (ephemeris, geocentric 3D): ~29 small loops, one per ~378 days, around one 29.5-year circuit. Height above/below the ecliptic magnified by the slider.' },
  mars: { note: 'Mars, 16 years (ephemeris, geocentric): 7 loops, one per ~2.1-year synodic period.' },
};
let traceGen = 0;
function buildTrace(kind) {
  traceGen++;
  trace.children.forEach((c) => c.geometry.dispose());
  trace.clear();
  const t0 = state.t, v = [];
  if (kind === 'sun1' || kind === 'sun8') {
    const years = kind === 'sun1' ? 1 : 8, step = kind === 'sun1' ? 20 * 60000 : 45 * 60000;
    for (let t = t0; t <= t0 + years * 365.25 * DAY; t += step) { const p = sunSub(t); v.push(latLonToXZ(p.lat, p.lon, sunHeightAt(t, p.lat))); }
    trace.add(colouredLine(v, 0.08, 0.6, 0.55));
  } else if (kind.startsWith('moon')) {
    // the Moon's exact track over the Earth (ephemeris), at the heights the Moon has in this model — the same positions as the live Moon
    const span = { moon1: DAY, moon27: 27.322 * DAY, moon365: 365.25 * DAY, moon19: 18.6 * 365.25 * DAY }[kind];
    const step = { moon1: 2 * MIN, moon27: 10 * MIN, moon365: 10 * MIN, moon19: 90 * MIN }[kind], q = new THREE.Vector3();
    const finish = () => {
      trace.add(colouredLine(v, 0.62, 0.95, kind === 'moon19' ? 0.35 : 0.85));
      if (kind !== 'moon19') { const dots = colouredLine(v.filter((_, i) => i % Math.max(1, Math.round((kind === 'moon1' ? HOUR : kind === 'moon27' ? 6 * HOUR : DAY) / step)) === 0), 0.62, 0.95, 1, true); dots.material.size = 0.06; trace.add(dots); }
    };
    if (kind === 'moon19' || kind === 'moon365') {   // 52,000-109,000 points: built in the background in small chunks, so the page never freezes
      const gen = traceGen; let t = t0;
      const chunk = () => {
        if (gen !== traceGen) return;                                   // another pattern was picked meanwhile
        const until = performance.now() + 25;
        while (t <= t0 + span && performance.now() < until) { if (sampleMoon(t, q)) v.push(q.clone()); t += step; }
        $('patternNote').textContent = `${PATTERNS[kind].note} — drawing… ${Math.round(100 * (t - t0) / span)}%`;
        if (t <= t0 + span) return setTimeout(chunk, 0);
        finish(); $('patternNote').textContent = PATTERNS[kind].note;
      };
      setTimeout(chunk, 0);
      return;
    }
    for (let t = t0; t <= t0 + span; t += step) if (sampleMoon(t, q)) v.push(q.clone());
    finish();
  } else if (kind === 'analemma') {
    for (let d = 0; d <= 365; d++) { const p = sunSub(t0 + d * DAY); v.push(latLonToXZ(p.lat, p.lon, sunHeightAt(t0 + d * DAY, p.lat))); }
    trace.add(colouredLine(v, 0.08, 0.6, 1, true), colouredLine(v, 0.08, 0.6, 0.6));
  } else if (kind.startsWith('iss')) {
    const days = { iss1: 1, iss3: 3, iss7: 7, iss14: 14, iss30: 30 }[kind], stepMs = days > 7 ? 15000 : 10000;   // fine steps: the line stays within ~1 mi of the true track
    for (let t = t0; t <= t0 + days * DAY; t += stepMs) { const q = issAt(t); if (q) v.push(issRealPoint(q)); }   // the real path at the real altitude
    const dots = colouredLine(v.filter((_, i) => i % Math.round((days > 7 ? 180000 : 90000) / stepMs) === 0), 0.5, 0.95, 1, true);   // dots at the same spacing as before
    dots.material.size = 0.06;
    trace.add(colouredLine(v, 0.5, 0.95, 0.9), dots);
  } else if (['venus', 'mercury', 'mars', 'jupiter', 'saturn'].includes(kind)) {
    // Real geocentric path in 3D: direction (ecliptic longitude & latitude of date) and distance from Earth,
    // with the height above/below the ecliptic magnified by the slider so the small tilts are visible.
    const cfg = { venus: [8, 1, 1.75], mercury: [7, 0.5, 1.47], mars: [16, 2, 2.7], jupiter: [12, 3, 6.5], saturn: [30, 6, 11.1] }[kind], [years, stepDays, maxAU] = cfg;
    const y = DOME_H * 0.42, scale = 8.5 / maxAU, zk = patternState.zExag;
    const name = kind[0].toUpperCase() + kind.slice(1);
    const drops = [];
    for (let d = 0; d <= years * 365.25; d += stepDays) {
      const e = bodyAt(name, t0 + d * DAY), lam = deg(e.lam), bet = deg(e.beta);
      const rr = e.dist * Math.cos(bet) * scale, h = e.dist * Math.sin(bet) * scale * zk;
      const pt = new THREE.Vector3(rr * Math.cos(lam), y + h, -rr * Math.sin(lam)); v.push(pt);
      if (v.length % 6 === 0) drops.push(pt, new THREE.Vector3(pt.x, y, pt.z));
    }
    const curtain = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(drops), new THREE.LineBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.18, depthWrite: false }));
    curtain.renderOrder = 7; trace.add(curtain);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(9.2, 128), new THREE.MeshBasicMaterial({ color: 0x030614, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide }));
    plate.rotation.x = -Math.PI / 2; plate.position.y = y - 0.02; plate.renderOrder = 6;
    const line = colouredLine(v, 0.08, 0.6, 1), dots = colouredLine(v.filter((_, i) => i % 2 === 0), 0.08, 0.6, 1, true);
    dots.material.size = 0.07; line.renderOrder = dots.renderOrder = 7;
    trace.add(plate, line, dots);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: 0x9fd8ff, depthWrite: false, blending: THREE.AdditiveBlending }));
    dot.position.set(0, y, 0); dot.scale.setScalar(0.5); trace.add(dot);
  }
  $('patternNote').textContent = PATTERNS[kind].note;
}
// geocentric distance (AU) — needed only for the planetary rosettes
function buildOverlay(kind) {
  overlay.traverse((c) => { c.geometry?.dispose(); });
  overlay.clear();
  if (kind === 'none') return;
  // the Flower of Life: a centre circle, 6 round it, then 12 more — 19 equal circles, each centred on its neighbours' edges
  const rho = LUM.rc / 2, centres = [[0, 0]];
  for (let i = 0; i < 6; i++) centres.push([rho * Math.cos(i * Math.PI / 3), rho * Math.sin(i * Math.PI / 3)]);
  for (let i = 0; i < 6; i++) {
    centres.push([2 * rho * Math.cos(i * Math.PI / 3), 2 * rho * Math.sin(i * Math.PI / 3)]);
    centres.push([Math.sqrt(3) * rho * Math.cos(i * Math.PI / 3 + Math.PI / 6), Math.sqrt(3) * rho * Math.sin(i * Math.PI / 3 + Math.PI / 6)]);
  }
  const ring = (c, u, v, r, mat) => { const pts = []; for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(c.clone().addScaledVector(u, r * Math.cos(a)).addScaledVector(v, r * Math.sin(a))); } overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)); };
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  if (kind === 'flower') {   // flat, at the height of the Sun's equator circle
    const y = lumAlt(0) + 0.03, mat = new THREE.LineBasicMaterial({ color: 0xff7bd5, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const [cx, cz] of centres) ring(new THREE.Vector3(cx, y, cz), X, Z, rho, mat);
    return;
  }
  if (kind === 'flower3d') {   // 3D: each circle becomes a sphere, with rings in three perpendicular planes, inside one enclosing sphere
    const y0 = Math.max(lumAlt(0), rho + 0.05);
    const ringMat = new THREE.LineBasicMaterial({ color: 0xff7bd5, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const sideMat = new THREE.LineBasicMaterial({ color: 0xb98cff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const skin = new THREE.MeshBasicMaterial({ color: 0xff7bd5, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const sphereGeo = new THREE.SphereGeometry(rho, 48, 24);
    for (const [cx, cz] of centres) {
      const c = new THREE.Vector3(cx, y0, cz);
      ring(c, X, Z, rho, ringMat);             // horizontal: the 2D Flower of Life
      ring(c, X, Y, rho, sideMat); ring(c, Z, Y, rho, sideMat);   // upright rings
      const m = new THREE.Mesh(sphereGeo, skin); m.position.copy(c); overlay.add(m);
    }
    const C = new THREE.Vector3(0, y0, 0), outer = new THREE.LineBasicMaterial({ color: 0xffd1f2, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    ring(C, X, Z, 3 * rho, outer); ring(C, X, Y, 3 * rho, outer); ring(C, Z, Y, 3 * rho, outer);
  }
}

// ---------- ISS (real orbit: CelesTrak TLE + SGP4) ----------
const sat = window.satellite;
// Default view: the ISS donut (illustrative). Map position is the exact NASA/SGP4 position; around the tube, latitude sets
// inner/outer rim and heading sets over (north) / under (south). Tube height 75% of its width, so the sun's whole
// 42.5° analemma fits inside the donut all year. Real altitude (×1) remains available as the accurate alternative.
const issView = { exag: 1, baseKm: 413, mode: 'donut', tubeH: 0.75 };
const ISS_FALLBACK = ['1 25544U 98067A   26313.46549504  .00008605  00000+0  16255-3 0  9992',
                      '2 25544  51.6321 301.1765 0007285   6.3021 353.8058 15.49275323594277'];
let issRec = sat.twoline2satrec(...ISS_FALLBACK), issSource = 'bundled TLE';
const tleEpochMs = () => (issRec.jdsatepoch - 2440587.5) * DAY;
// TLE checksum: digits summed, '-' counts as 1, modulo 10 must equal column 69
const tleOK = (l) => { if (!l || l.length < 69) return false; let sum = 0; for (const ch of l.slice(0, 68)) { if (ch >= '0' && ch <= '9') sum += +ch; else if (ch === '-') sum += 1; } return sum % 10 === +l[68]; };
function useTLE(l1, l2, source) {
  if (!tleOK(l1) || !tleOK(l2) || l1.slice(2, 7) !== '25544') return false;
  const rec = sat.twoline2satrec(l1, l2);
  if (rec.error) return false;
  issRec = rec; issSource = source;
  computeIssMean();
  try { if (nasa) { nasa.dtAfter = seamShift(nasa.stop).dt; nasa.dtBefore = seamShift(nasa.start).dt; } } catch {}
  try { refreshTrails(); } catch {}
  return true;
}
const TLE_MAX_AGE = 2 * 3600e3; // CelesTrak updates the ISS elements several times a day
async function loadISS(force = false) {
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem('issTLE') || 'null');
      if (c && Date.now() - c.at < TLE_MAX_AGE && useTLE(c.l1, c.l2, 'CelesTrak (cached)')) return;
    } catch {}
  }
  try {
    const res = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', { cache: 'no-store' });
    const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const l1 = lines.find((l) => l.startsWith('1 ')), l2 = lines.find((l) => l.startsWith('2 '));
    if (useTLE(l1, l2, 'CelesTrak live')) {
      try { localStorage.setItem('issTLE', JSON.stringify({ l1, l2, at: Date.now() })); } catch {}
      return;
    }
  } catch {}
  // offline: keep the newest valid elements we have
  try { const c = JSON.parse(localStorage.getItem('issTLE') || 'null'); if (c && useTLE(c.l1, c.l2, 'CelesTrak (offline cache)')) return; } catch {}
  issSource = 'bundled TLE';
}
loadISS();
setInterval(() => loadISS(true), TLE_MAX_AGE);
// SGP4 from the CelesTrak TLE. `shift` (s) slides it along its orbit to line up with NASA's trajectory at the seam.
function sgp4At(t, shift = 0) {
  const pv = sat.propagate(issRec, new Date(t + shift * 1000));
  if (!pv || !pv.position) return null;
  const g = sat.eciToGeodetic(pv.position, sat.gstime(new Date(t)));
  const v = pv.velocity;
  // vz: velocity along Earth's axis — positive while the ISS is heading north
  return { lat: rad(g.latitude), lon: wrap180(rad(g.longitude)), altKm: g.height, kms: Math.hypot(v.x, v.y, v.z), vz: v.z, src: 'tle' };
}

// ---------- NASA/JSC official ISS trajectory (CCSDS OEM, EME2000/J2000, 4-minute state vectors, ~15 days) ----------
const NASA_URL = 'https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt';
const NASA_MAX_AGE = 6 * 3600e3;
let nasa = null; // { t: Float64Array(ms), s: Float64Array(6n) km & km/s, start, stop, created, dtBefore, dtAfter }
function parseOEM(txt) {
  const T = [], S = [];
  for (const line of txt.split('\n')) {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(line)) continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 7) continue;
    const t = Date.parse(p[0] + 'Z');
    if (!Number.isFinite(t) || (T.length && t <= T[T.length - 1])) continue;
    T.push(t); for (let k = 1; k <= 6; k++) S.push(+p[k]);
  }
  if (T.length < 10 || S.some((x) => !Number.isFinite(x))) return null;
  const created = (txt.match(/CREATION_DATE\s*=\s*(\S+)/) || [])[1];
  return { t: Float64Array.from(T), s: Float64Array.from(S), start: T[0], stop: T[T.length - 1], created: created ? Date.parse(created + 'Z') : null };
}
// 8-point Lagrange interpolation of NASA's positions and velocities (centred on t). Interpolation error is
// far below a metre at NASA's 4-minute spacing (checked by rebuilding the file from every other point).
function nasaState(t) {
  const { t: T, s: S } = nasa, n = T.length;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  const i0 = Math.max(0, Math.min(n - 8, lo - 3)), x = (t - T[i0]) / 1000, X = [];
  for (let j = 0; j < 8; j++) X.push((T[i0 + j] - T[i0]) / 1000);
  const r = [0, 0, 0], v = [0, 0, 0];
  for (let j = 0; j < 8; j++) {
    let L = 1;
    for (let m = 0; m < 8; m++) if (m !== j) L *= (x - X[m]) / (X[j] - X[m]);
    const b = (i0 + j) * 6;
    for (let k = 0; k < 3; k++) { r[k] += L * S[b + k]; v[k] += L * S[b + 3 + k]; }
  }
  return { r, v };
}
// J2000 → true-of-date: IAU-1976 precession + main nutation terms; returns the matrix and the equation of the equinoxes
function j2000ToTOD(t) {
  const AS = Math.PI / 648000, T = (t - Date.UTC(2000, 0, 1, 12)) / (36525 * 864e5);
  const ze = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * AS, z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * AS, th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * AS;
  const Om = (125.04452 - 1934.136261 * T) * Math.PI / 180, Ls = (280.4665 + 36000.7698 * T) * Math.PI / 180, Lm = (218.3165 + 481267.8813 * T) * Math.PI / 180;
  const dpsi = (-17.2 * Math.sin(Om) - 1.32 * Math.sin(2 * Ls) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * Om)) * AS;
  const deps = (9.2 * Math.cos(Om) + 0.57 * Math.cos(2 * Ls) + 0.1 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * Om)) * AS;
  const eps = (84381.448 - 46.815 * T) * AS;
  const R1 = (x) => [[1, 0, 0], [0, Math.cos(x), Math.sin(x)], [0, -Math.sin(x), Math.cos(x)]];
  const R2 = (x) => [[Math.cos(x), 0, -Math.sin(x)], [0, 1, 0], [Math.sin(x), 0, Math.cos(x)]];
  const R3 = (x) => [[Math.cos(x), Math.sin(x), 0], [-Math.sin(x), Math.cos(x), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  const P = mul(R3(-z), mul(R2(th), R3(-ze))), N = mul(R1(-(eps + deps)), mul(R3(-dpsi), R1(eps)));
  return { M: mul(N, P), eqeq: dpsi * Math.cos(eps) };
}
const mulv = (M, x) => [0, 1, 2].map((i) => M[i][0] * x[0] + M[i][1] * x[1] + M[i][2] * x[2]);
function nasaAt(t) {
  const { r, v } = nasaState(t), { M, eqeq } = j2000ToTOD(t), rt = mulv(M, r), vt = mulv(M, v);
  const g = sat.eciToGeodetic({ x: rt[0], y: rt[1], z: rt[2] }, sat.gstime(new Date(t)) + eqeq);
  return { lat: rad(g.latitude), lon: wrap180(rad(g.longitude)), altKm: g.height, kms: Math.hypot(...v), vz: vt[2], src: 'nasa', eci: rt };
}
// Time offset that makes the TLE orbit continue exactly where NASA's data starts/ends (removes any jump at the seam)
function seamShift(tEdge) {
  const target = nasaAt(tEdge).eci, dist = (dt) => { const pv = sat.propagate(issRec, new Date(tEdge + dt * 1000)); return pv && pv.position ? Math.hypot(pv.position.x - target[0], pv.position.y - target[1], pv.position.z - target[2]) : Infinity; };
  let best = 0, bd = dist(0);
  for (let span = 120, stepS = 2; span >= 0.02; span /= 10, stepS /= 10) for (let dt = best - span; dt <= best + span; dt += stepS) { const d = dist(dt); if (d < bd) { bd = d; best = dt; } }
  return { dt: best, km: bd };
}
function useNASA(txt, source) {
  const n = parseOEM(txt);
  if (!n) return false;
  nasa = n; nasa.source = source;
  try { const a = seamShift(nasa.stop), b = seamShift(nasa.start); nasa.dtAfter = a.dt; nasa.dtBefore = b.dt; nasa.seamKm = Math.max(a.km, b.km); } catch { nasa.dtAfter = nasa.dtBefore = 0; }
  try { computeIssMean(); refreshTrails(); } catch {}
  return true;
}
async function loadNASA(force = false) {
  if (!force) {
    try { const c = JSON.parse(localStorage.getItem('issOEM') || 'null'); if (c && Date.now() - c.at < NASA_MAX_AGE && useNASA(c.txt, 'NASA/JSC (cached)')) return; } catch {}
  }
  const tryFetch = async (url) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.text(); };
  try {
    const txt = await tryFetch(NASA_URL);
    if (useNASA(txt, 'NASA/JSC live')) { try { localStorage.setItem('issOEM', JSON.stringify({ txt, at: Date.now() })); } catch {} return; }
  } catch {}
  // dev preview only (outside the extension NASA's server blocks cross-site reads): a local copy of the same file
  if (location.protocol !== 'chrome-extension:') { try { if (useNASA(await tryFetch('nasa-oem.txt'), 'NASA/JSC (local copy)')) return; } catch {} }
  try { const c = JSON.parse(localStorage.getItem('issOEM') || 'null'); if (c && useNASA(c.txt, 'NASA/JSC (offline cache)')) return; } catch {}
}

// NASA's trajectory wherever it covers the time; the TLE (seam-matched to NASA) outside it
function issAt(t) {
  if (nasa && t >= nasa.start && t <= nasa.stop) return nasaAt(t);
  return sgp4At(t, nasa ? (t > nasa.stop ? nasa.dtAfter : nasa.dtBefore) : 0);
}
loadNASA();
setInterval(() => loadNASA(true), NASA_MAX_AGE);
// Donut view. Map position stays the exact SGP4 latitude/longitude. The tube coordinate comes from real data too:
// latitude sets how far across the tube it is (51.6°N = inner rim, 51.6°S = outer rim) and the direction of travel
// sets the side: heading north = over the top, heading south = underneath. One real orbit = one wrap of the donut.
const issIncDeg = () => rad(issRec.inclo);
function issDonut() {
  const w = (issView.maxLat || issIncDeg()) / 180 * R, h = w * issView.tubeH, base = (issView.baseKm / 1.609344) / MI_PER_UNIT;
  return { rc: R / 2, w, h, yc: base + h };
}
function issPeriodMs() { return (2 * Math.PI / issRec.no) * 60000; }
function computeIssMean() { // lowest geodetic height over a day around now = the base we exaggerate from
  const t = Date.now(); let lo = Infinity, maxLat = 0;
  for (let i = -720; i <= 720; i++) { const q = issAt(t + i * 60000); if (q) { if (q.altKm < lo) lo = q.altKm; maxLat = Math.max(maxLat, Math.abs(q.lat)); } }
  if (isFinite(lo)) issView.baseKm = lo;
  if (maxLat) issView.maxLat = maxLat; // geodetic latitude peaks slightly above the orbital inclination
}
computeIssMean();
// altitude profile over the previous and next orbit (true km)
function drawIssAlt(t) {
  const cv = $('issAltChart'); if (!cv) return;
  const [ctx, w, h] = fitCanvas(cv), per = issPeriodMs(), N = 180, pts = [];
  for (let i = 0; i < N; i++) { const q = issAt(t + (i / (N - 1) - 0.5) * 2 * per); if (q) pts.push(q.altKm); }
  if (pts.length < 2) return;
  const lo = Math.min(...pts), hi = Math.max(...pts), pad = 14, X = (i) => (i / (pts.length - 1)) * w, Y = (a) => pad + (1 - (a - lo) / (hi - lo || 1)) * (h - 2 * pad);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(140,170,255,.15)'; ctx.beginPath(); ctx.moveTo(0, Y((lo + hi) / 2)); ctx.lineTo(w, Y((lo + hi) / 2)); ctx.stroke();
  ctx.beginPath(); pts.forEach((a, i) => (i ? ctx.lineTo(X(i), Y(a)) : ctx.moveTo(X(i), Y(a))));
  ctx.strokeStyle = '#7fe6ff'; ctx.lineWidth = 2; ctx.stroke();
  const mid = (pts.length - 1) / 2, cur = pts[Math.round(mid)];
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(mid), 0); ctx.lineTo(X(mid), h); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(mid), Y(cur), 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.font = '10px system-ui'; ctx.fillStyle = '#8d9bc2'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(hi / 1.609344)} mi`, 2, 0); ctx.textBaseline = 'bottom'; ctx.fillText(`${Math.round(lo / 1.609344)} mi`, 2, h);
  ctx.textAlign = 'right'; ctx.fillText('next orbit →', w - 2, h); ctx.textBaseline = 'top'; ctx.fillText('← last orbit', w - 2, 0);
  $('issRange').textContent = `${Math.round(lo)}–${Math.round(hi)} km`;
}
const issGroup = new THREE.Group();
scene.add(issGroup);
const issSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(220,250,255,1)', 'rgba(80,200,255,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
issSprite.scale.setScalar(0.45);
const issDropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const issDrop = new THREE.Line(issDropGeo, new THREE.LineBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.5 }));
issGroup.add(issSprite, issDrop);
let ISS = null;

// ---------- The real ISS: exact position, real altitude, real size and attitude ----------
// Position: NASA's live trajectory (CelesTrak elements as a backup) — latitude/longitude placed exactly on the map.
// Height: the real altitude above the surface (257–272 mi), on the map's real north–south scale (69.05 mi per degree, the
// same scale as the scale bar and the distance tool). Size: a true-scale model of the station's main structure — the
// 109 m integrated truss, eight 34 × 12 m solar-array wings, and the ~73 m stack of pressurised modules — flying as the
// real ISS does: modules along the direction of travel, truss across it, the same face toward the ground. A glowing marker
// shows where it is from afar (the station itself is microscopic at that scale); zoom in (or Follow the ISS) to see it.
const ISS_REAL_MI_PER_UNIT = (10001.966 / 1.609344 / 90) * 180 / R, M_TO_UNIT = 1 / (ISS_REAL_MI_PER_UNIT * 1609.344);
const issRealY = (altKm) => (altKm / 1.609344) / ISS_REAL_MI_PER_UNIT;
const issRealPoint = (q, out = new THREE.Vector3()) => latLonToXZ(q.lat, q.lon, issRealY(q.altKm), out);
const issModel = (() => {
  const G = new THREE.Group(), inner = new THREE.Group(); G.add(inner); inner.scale.setScalar(M_TO_UNIT);   // built in metres
  const grey = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.6, metalness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5, metalness: 0.2 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.35, metalness: 0.6, emissive: 0x2a1a05, side: THREE.DoubleSide });
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); inner.add(o); return o; };
  // axes (metres): x = direction of travel, y = up (away from the ground), z = across (the truss)
  box(5, 5, 109, grey, 0, 3, 0);                                                  // integrated truss, 109 m
  for (const z of [-52, -40, 40, 52]) for (const x of [-19, 19]) box(34, 0.3, 12, panel, x, 3, z);   // 8 solar-array wings, 34 × 12 m
  for (const z of [-9, 9]) box(14, 0.3, 4, white, 0, 3, z);                       // thermal radiators (simplified)
  const mod = (len, r, x) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24), white); c.rotation.z = Math.PI / 2; c.position.set(x, -1.5, 0); inner.add(c); };
  mod(8.5, 2.2, 22); mod(7, 2.2, 14); mod(8.5, 2.1, 6); mod(7, 2.2, -1.5); mod(13, 2.1, -12); mod(12.6, 2.0, -25); mod(15.7, 2.0, -39.1);   // US & Russian modules: 73 m end to end
  for (const z of [-12, 12]) box(18, 0.3, 4, panel, -40, -1.5, z);               // Zvezda's own wings
  scene.add(G); return G;
})();
const issVel = new THREE.Vector3(), issTmp = new THREE.Vector3(), issUp = new THREE.Vector3(0, 1, 0), issSide = new THREE.Vector3(), issMat4 = new THREE.Matrix4();
const ISS_FOLLOW = { on: false, off: new THREE.Vector3(0.00025, 0.00012, 0.00035) };
function updateISSReal(t) {
  ISS = issAt(t); if (!ISS) return;
  issRealPoint(ISS, issSprite.position);
  const dp = issDropGeo.attributes.position; issDrop.visible = true;
  dp.setXYZ(0, issSprite.position.x, issSprite.position.y, issSprite.position.z); dp.setXYZ(1, issSprite.position.x, 0.005, issSprite.position.z); dp.needsUpdate = true;
  // attitude from its real direction of travel (position 1 s later)
  const q2 = issAt(t + 1000); if (q2) { issRealPoint(q2, issTmp); issVel.subVectors(issTmp, issSprite.position); issVel.y = 0; }
  if (issVel.lengthSq() > 0) { issVel.normalize(); issSide.crossVectors(issVel, issUp).normalize(); issMat4.makeBasis(issVel, issUp, issSide); issModel.quaternion.setFromRotationMatrix(issMat4); }
  issModel.position.copy(issSprite.position); issModel.visible = issGroup.visible;
  // the glowing marker hands over to the real model when you are within ~3 mi
  const dc = camera.position.distanceTo(issSprite.position);
  issSprite.visible = dc > 0.0025; issSprite.scale.setScalar(Math.min(0.45, dc * 0.04));   // a marker of steady on-screen size
  if (ISS_FOLLOW.on) {
    if (controls.target.distanceTo(issSprite.position) > 1e-9) { ISS_FOLLOW.off.subVectors(camera.position, controls.target); }
    controls.target.copy(issSprite.position); camera.position.copy(issSprite.position).add(ISS_FOLLOW.off);
  }
}


// ---------- Adjustable trails: how long each body's path stays behind ----------
const MIN = 60000, HOUR = 3600000;
class Trail {
  constructor(parent, color, max) {
    this.max = max; this.base = new THREE.Color(color); this.cache = new Map(); this.step = 0; this.tmp = new THREE.Vector3();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    g.setDrawRange(0, 0);
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false;
    parent.add(this.line);
  }
  invalidate() { this.cache.clear(); }
  // Samples sit on a fixed time grid (multiples of `step`), so points are reused between frames and the
  // line never shimmers; only new grid points are computed. The final point is the body's exact position now.
  update(t, len, minStep, sample) {
    if (len <= 0) { this.line.visible = false; return; }
    this.line.visible = true;
    const step = Math.max(minStep, len / (this.max - 2));
    if (step !== this.step) { this.cache.clear(); this.step = step; }
    const t0 = t - len, i0 = Math.ceil(t0 / step), i1 = Math.floor(t / step);
    const pos = this.line.geometry.attributes.position, col = this.line.geometry.attributes.color, b = this.base;
    let k = 0;
    const put = (tt, p) => { const a = Math.max(0, (tt - t0) / len) ** 1.4; pos.setXYZ(k, p.x, p.y, p.z); col.setXYZ(k, b.r * a, b.g * a, b.b * a); k++; };
    for (let i = i0; i <= i1 && k < this.max - 1; i++) {
      let p = this.cache.get(i);
      if (p === undefined) { const nv = new THREE.Vector3(); p = sample(i * step, nv) ? nv : null; this.cache.set(i, p); }
      if (p) put(i * step, p);
    }
    if (sample(t, this.tmp)) put(t, this.tmp);
    pos.needsUpdate = col.needsUpdate = true;
    this.line.geometry.setDrawRange(0, k);
    if (this.cache.size > 2 * this.max) for (const key of this.cache.keys()) if (key < i0 - 2 || key > i1 + 2) this.cache.delete(key);
  }
}
const sampleSun = (tt, v) => { if (state.fieldMode) { const f = fieldSunAt(tt); v.set(f.x, f.y, f.z); return true; } const p = sunSub(tt); latLonToXZ(p.lat, p.lon, sunHeightAt(tt, p.lat), v); return true; };
const sampleMoon = (tt, v) => { if (state.fieldMode) { const f = fieldMoonAt(tt); v.set(f.x, f.y, f.z); return true; } const p = moonSub(tt); latLonToXZ(p.lat, p.lon, moonHeightAt(tt, p.lat), v); return true; };
const sampleISS = (tt, v) => { const q = issAt(tt); if (!q) return false; issRealPoint(q, v); return true; };   // the real path at the real altitude
const TRAIL_STEPS = {
  lum: [0, HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 91 * DAY, 182 * DAY, 365 * DAY],
  planet: [0, 7, 30, 60, 90, 150, 365, 730, 1461, 2922, 4383, 10957].map((d) => d * DAY),
  iss: [0, 10, 30, 93, 180, 360, 720, 1440, 2880, 4320, 10080, 20160, 43200].map((m) => m * MIN), // up to 30 days
};
const TRAILS = [
  { key: 'Sun', glyph: '☉', css: '#ffd56b', steps: 'lum', def: 3 * DAY, parts: [[paths, 36000, 15 * MIN, sampleSun]] },
  { key: 'Moon', glyph: '☾', css: '#c9d6ea', steps: 'lum', def: DAY, parts: [[paths, 36000, 15 * MIN, sampleMoon]] },
  { key: 'ISS', glyph: '🛰', css: '#7fe6ff', steps: 'iss', def: 93 * MIN, parts: [[issGroup, 45000, 8000, sampleISS]] },   // a point every 8 s (~40 mi), so loops and turnarounds stay smooth
];
for (const tr of TRAILS) {
  tr.len = tr.def;
  tr.objs = tr.parts.map(([parent, max, minStep, fn]) => ({ trail: new Trail(parent, tr.css, max), minStep, fn }));
}
function refreshTrails() { for (const tr of TRAILS) for (const o of tr.objs) o.trail.invalidate(); }
function updateAllTrails(t) {
  for (const tr of TRAILS) for (const o of tr.objs) if (o.trail.line.parent.visible) o.trail.update(t, tr.len, o.minStep, o.fn);
}
function fmtDur(ms) {
  if (!ms) return 'off';
  const m = ms / MIN; if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60; if (h < 48) return `${+h.toFixed(1)} h`;
  const d = h / 24; if (d < 60) return `${Math.round(d)} d`;
  if (d < 365) return `${Math.round(d / 30.44)} mo`;
  return `${+(d / 365.25).toFixed(1)} yr`;
}
function buildTrailControls() {
  const box = $('trailRows'); box.innerHTML = '';
  for (const tr of TRAILS) {
    const steps = TRAIL_STEPS[tr.steps], row = document.createElement('div');
    row.className = 'trow';
    row.innerHTML = `<i style="background:${tr.css}"></i><span>${tr.glyph} ${tr.key}</span><input type="range" min="0" max="${steps.length - 1}" step="1"><b></b>`;
    const input = row.querySelector('input'), out = row.querySelector('b');
    input.value = Math.max(0, steps.indexOf(tr.len));
    const show = () => { out.textContent = fmtDur(tr.len); };
    input.oninput = () => {
      tr.len = steps[+input.value]; show();
    };
    show(); box.appendChild(row);
  }
}

// ---------- Nested flux surfaces inside the ISS donut (the sun's and the moon's tori) ----------
// Built like the nested magnetic surfaces of a toroidal (tokamak-type) field, with the ISS donut as the outermost surface (ρ = 1):
//  • every surface shares the same magnetic axis (the ring over the equator) and the surfaces never cross;
//  • shaping: the edge has the ISS donut's shape (height/width 0.75); inner surfaces get rounder — elongation
//    κ(ρ) = 1 + (κ_edge − 1)·ρ², circular at the axis;
//  • safety factor q(ρ) = q0 + (qa − q0)·ρ², q0 = 1 at the axis → qa = 3.5 at the edge: a field line goes q times round the
//    long way for each turn round the tube, so inner lines wind more tightly round the tube;
//  • toroidal field ∝ 1/R (stronger on the inboard side): the flow runs faster there;
//  • low-pressure limit: Shafranov shift neglected, so the surfaces are concentric — this keeps each luminary's real map
//    position exactly on its surface.
// The sun and moon each ride the surface whose width equals their own range of declination, exactly like the ISS on its donut:
// declination sets inner (north) / outer (south) rim, heading north = over the top, heading south = underneath.
const NEST = { q0: 1.0, qa: 3.5, levels: [0.2, 0.4, 0.6, 0.8] };
const lumTori = new THREE.Group();   // old sun & moon tori: not drawn (replaced by the hub torus field); their maths still sets heights in real mode
const lumToriState = { key: '', moonMaxDec: 28.5 };
function moonMaxDeclination(t) { let m = 0; for (let d = -365; d <= 365; d += 0.5) m = Math.max(m, Math.abs(bodyAt('Moon', t + d * DAY).dec)); return m; }
function nestedSurface(rho) {
  const d = issDonut(), kEdge = d.h / d.w, a = rho * d.w, kappa = 1 + (kEdge - 1) * rho * rho;
  return { rc: d.rc, yc: d.yc, w: a, h: a * kappa, rho, q: NEST.q0 + (NEST.qa - NEST.q0) * rho * rho };
}
// ---------- The Moon's torus, the nodes (Rahu ☊ & Ketu ☋) and solar eclipses ----------
// Found by searching torus shapes against every real eclipse 2000–2030. The Moon's torus is a flat ring layered just above
// the Sun's (LIFT = 4 % higher), so normally the Moon can never pass in front of the Sun. The Moon's path is tilted ~5° to
// the Sun's and crosses it at two points, Rahu and Ketu (the lunar nodes), which drift round once every 18.6 years. When
// the Moon meets the Sun near a node — their separation in the sky falls below the eclipse limit, which grows when the
// Moon is nearer — it is drawn down through the Sun's layer, C·(limit − separation)² below the Sun. Then, and only
// then, the line from the Sun through the Moon reaches the plane: a solar eclipse. Result: 70 of 70 real solar eclipses
// 2000–2030 happen, and none at the other 314 new moons. Where the shadow lands is approximate (see the eclipse panel).
const MOONLAYER = { LIFT: 0.04, H: 0.025, C: 0.015, P: 2, BAND: 2.0, TOPO: 1.012 };   // TOPO: the Moon looks ~1.2 % bigger from under the shadow than from the centre
const toRadE = Math.PI / 180;
function gcDeg(a, b) { // angle between two sub-points = the bodies' separation in the sky (both geocentric directions)
  const c = Math.sin(a.lat * toRadE) * Math.sin(b.lat * toRadE) + Math.cos(a.lat * toRadE) * Math.cos(b.lat * toRadE) * Math.cos((a.lon - b.lon) * toRadE);
  return Math.acos(Math.max(-1, Math.min(1, c))) / toRadE;
}
function eclipseLimit(t) { // largest sun–moon separation at which the Moon can cover part of the Sun for someone (degrees)
  const dS = bodyAt('Sun', t).dist * 149597870.7, dM = bodyAt('Moon', t).dist * 149597870.7, E = 6378.137;
  return { lim: (Math.asin(E / dM) - Math.asin(E / dS) + Math.asin(1737.4 / dM) + Math.asin(696000 / dS)) / toRadE,
    sSemi: Math.asin(696000 / dS) / toRadE, mSemi: Math.asin(1737.4 / dM) / toRadE };
}
function moonSurfaceAt(sunY) {
  const d = issDonut(), w = lumToriState.moonMaxDec / 180 * R;
  return { rc: d.rc, yc: sunY * (1 + MOONLAYER.LIFT), w, h: MOONLAYER.H, rho: w / d.w, q: 2.5 };
}
/** Moon height at time t: on its ring above the Sun, or dipping through the Sun's layer at a node. */
function moonLayer(t, sunY, sp, mp, rising) {
  const T = moonSurfaceAt(sunY), f = Math.max(-1, Math.min(1, ((90 - mp.lat) / 180 * R - T.rc) / T.w));
  const base = T.yc + (rising ? 1 : -1) * T.h * Math.sqrt(1 - f * f), sep = gcDeg(sp, mp);
  if (sep > 5) return { y: base, dip: 0, sep };
  const L = eclipseLimit(t);
  if (sep >= L.lim + MOONLAYER.BAND) return { y: base, dip: 0, sep, ...L };
  if (sep >= L.lim) { const w = smooth01(1 - (sep - L.lim) / MOONLAYER.BAND); return { y: base + (sunY - base) * w, dip: w, sep, ...L }; }
  return { y: sunY * (1 - MOONLAYER.C * Math.pow(L.lim - sep, MOONLAYER.P)), dip: 1, sep, ...L };
}
function bodySurface(body) {
  if (body === 'Moon') return moonSurfaceAt(sun.position.y);
  return nestedSurface(Math.min(0.97, (23.44 / 180 * R) / issDonut().w));
}
/** Height of a luminary on its torus: declination → across the tube, heading north → over the top, south → underneath. */
function bodyHeight(body, dec, rising) {
  if (body === 'Sun') return lumAlt(dec);   // the Sun's path: highest on its small circle (Cancer, June), lowest on its big circle (Capricorn, December)
  const T = bodySurface(body), f = Math.max(-1, Math.min(1, ((90 - dec) / 180 * R - T.rc) / T.w));
  return T.yc + (rising ? 1 : -1) * T.h * Math.sqrt(1 - f * f);
}
const sunHeightAt = (t, dec) => bodyHeight('Sun', dec, subpoint('Sun', t + 3600e3).lat >= dec);
function moonHeightAt(t, dec) {
  const sp = subpoint('Sun', t), sunY = bodyHeight('Sun', sp.lat, subpoint('Sun', t + 3600e3).lat >= sp.lat);
  const mp = subpoint('Moon', t);
  return moonLayer(t, sunY, sp, mp, subpoint('Moon', t + 3600e3).lat >= mp.lat).y;
}
// three independently switchable parts: the other nested field surfaces (+ axis), the sun's torus, the moon's torus
const lumNestG = new THREE.Group(), lumSunG = new THREE.Group(), lumMoonG = new THREE.Group();
lumTori.add(lumSunG, lumMoonG); lumNestG.visible = false;
lumToriState.moonMaxDec = moonMaxDeclination(state.t);
setInterval(() => { lumToriState.moonMaxDec = moonMaxDeclination(state.t); }, 60000);

// ---------- The seven chakras along the outer boundary's axis ----------
// Placed on the axis of the outer boundary's torus (centred on the plane of inertia): the root (red) at the bottom of the
// field, the throat at its top, and sacral, solar plexus and heart evenly between them (the solar plexus at the North Pole,
// where the hole closes to a point). The third eye and the crown rise above the torus at the same spacing, which puts the
// crown at the top of the firmament. Each wheel's size follows the hole's width.
// Traditional colours and lotus petal counts (4, 6, 10, 12, 16, 2, "thousand-petalled"). Symbolic, not measured.
const CHAKRAS = [
  { name: 'Root', skt: 'Muladhara', col: '#ff3b3b', petals: 4 },
  { name: 'Sacral', skt: 'Svadhisthana', col: '#ff8c1a', petals: 6 },
  { name: 'Solar plexus', skt: 'Manipura', col: '#ffd60a', petals: 10 },
  { name: 'Heart', skt: 'Anahata', col: '#34d058', petals: 12 },
  { name: 'Throat', skt: 'Vishuddha', col: '#1e9bff', petals: 16 },
  { name: 'Third eye', skt: 'Ajna', col: '#6c63ff', petals: 2 },
  { name: 'Crown', skt: 'Sahasrara', col: '#c45bff', petals: 36 },
];
function lotusTexture(col, petals) {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), c = S / 2;
  ctx.globalCompositeOperation = 'lighter';
  const layers = petals > 20 ? [[petals, 0.47, 0.13], [petals, 0.36, 0.1, Math.PI / petals]] : [[petals, 0.46, petals === 2 ? 0.2 : Math.min(0.2, 1.9 / petals)]];
  for (const [n, len, wid, off = 0] of layers) for (let i = 0; i < n; i++) {
    const a = off + i / n * Math.PI * 2;
    ctx.save(); ctx.translate(c, c); ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, S * len, 0); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(S * 0.06, 0);
    ctx.quadraticCurveTo(S * len * 0.55, -S * wid, S * len, 0); ctx.quadraticCurveTo(S * len * 0.55, S * wid, S * 0.06, 0); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (const [r, a] of [[0.17, 0.9], [0.24, 0.5]]) { ctx.strokeStyle = col; ctx.globalAlpha = a; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c, c, S * r, 0, Math.PI * 2); ctx.stroke(); }
  const core = ctx.createRadialGradient(c, c, 0, c, c, S * 0.16); core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, col); core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 1; ctx.fillStyle = core; ctx.beginPath(); ctx.arc(c, c, S * 0.16, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const chakraG = new THREE.Group(); scene.add(chakraG);
const chakraParts = CHAKRAS.map((ck, i) => {
  const wheel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: lotusTexture(ck.col, ck.petals), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  wheel.rotation.x = -Math.PI / 2;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(ck.col, 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const holder = new THREE.Group(); holder.add(wheel, glow); chakraG.add(holder);
  return { ...ck, i, holder, wheel, glow, r: 0.3 };
});
const chakraAxis = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
chakraG.add(chakraAxis);
let chakraKey = '';
// Radius of the outer boundary's central opening at height y (its inner wall: r0 − a·√(1 − (y/b)²)); 0 at the disc.
const outerHole = (y) => outerFunnel(y);
function placeChakras() {
  const yB = -OUTER.b, step = OUTER.b / 2, yT = yB + 6 * step;   // root at −b … throat at +b (i = 4) … crown at 2b
  chakraParts.forEach((c) => {
    const y = yB + c.i * step;
    c.r = Math.min(0.95, 0.35 + 0.08 * outerHole(y));
    c.holder.position.set(0, y, 0); c.wheel.scale.setScalar(c.r * 2); c.glow.scale.setScalar(c.r * 1.1);
  });
  chakraAxis.geometry.dispose(); chakraAxis.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, yB, 0), new THREE.Vector3(0, yT, 0)]);
}
function updateChakras(dt, now) {
  const key = `${OUTER.R}`;
  if (key !== chakraKey) { chakraKey = key; placeChakras(); }
  for (const c of chakraParts) {
    c.wheel.rotation.z += dt * (0.5 + c.i * 0.12) * (c.i % 2 ? -1 : 1);                       // wheels turn, alternating
    const pulse = 1 + 0.12 * Math.sin(now / 1000 * (1.2 + c.i * 0.25) + c.i);
    c.glow.scale.setScalar(c.r * 1.1 * pulse);
  }
}

// ---------- Yin & Yang: the Sun and the Moon ----------
// A Taijitu lying flat ~560 mi above the map, placed so its two dots fall exactly under the Sun and the Moon: the light
// Yang dot straight under the Sun, the dark Yin dot straight under the Moon. In a Taijitu the dots sit opposite each other,
// halfway from the centre to the edge, so the symbol is centred midway between the two points and its radius is the
// distance between them — small near new moon (Sun and Moon close), large near full moon (far apart). Symbolic.
const yinYang = (() => {
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), c = S / 2, r = S / 2 - 6, YANG = '#ffe7a8', YIN = '#1b1f4a';
  const disc = (x, y, rr, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); };
  disc(c, c, r, YIN);
  g.fillStyle = YANG; g.beginPath(); g.arc(c, c, r, Math.PI / 2, Math.PI * 3 / 2); g.fill();   // left half: yang (sets the swirl's turning direction)
  disc(c, c - r / 2, r / 2, YANG);                    // yang's head (top of the canvas)
  disc(c, c + r / 2, r / 2, YIN);                     // yin's head (bottom)
  disc(c, c - r / 2, r / 7, '#11143a');               // the Yin dot (dark), in yang's head — goes under the Moon
  const sunDot = g.createRadialGradient(c, c + r / 2, 0, c, c + r / 2, r / 7);
  sunDot.addColorStop(0, '#ffffff'); sunDot.addColorStop(1, '#ffd56b');
  g.fillStyle = sunDot; g.beginPath(); g.arc(c, c + r / 2, r / 7, 0, Math.PI * 2); g.fill();   // the Yang dot (light, gold), in yin's head — goes under the Sun
  g.lineWidth = 6; g.strokeStyle = 'rgba(255,240,200,0.9)'; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = mapTex.anisotropy;
  const G = new THREE.Group(), body = new THREE.Group(), Y = 0.45;
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 128), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = Y; m.renderOrder = 6; body.add(m); G.add(body);   // unit radius; scaled each frame
  const sunL = textSprite(['☀ Yang dot', 'under the Sun'], '#ffe7a8', 360, 112), moonL = textSprite(['☾ Yin dot', 'under the Moon'], '#c9d6ea', 360, 112);
  for (const l of [sunL, moonL]) { l.scale.set(1.4, 0.43, 1); l.material.depthTest = false; l.renderOrder = 7; G.add(l); }
  G.userData = { body, sunL, moonL, Y };
  scene.add(G);
  return G;
})();
const yyA = new THREE.Vector3(), yyB = new THREE.Vector3();
/** Centre the symbol midway between the points under the Sun and the Moon, radius = their distance, Yang dot under the Sun. */
function updateYinYang(S, M) {
  const { body, sunL, moonL, Y } = yinYang.userData;
  latLonToXZ(S.lat, S.lon, 0, yyA); latLonToXZ(M.lat, M.lon, 0, yyB);
  const cx = (yyA.x + yyB.x) / 2, cz = (yyA.z + yyB.z) / 2, d = Math.max(1e-4, Math.hypot(yyA.x - yyB.x, yyA.z - yyB.z));
  const thA = Math.atan2(-(yyA.z - cz), yyA.x - cx);          // direction from the centre to the point under the Sun
  body.position.set(cx, 0, cz); body.scale.set(d, 1, d);
  body.rotation.y = thA + Math.PI / 2;                       // the canvas's bottom (Yang dot) turned toward the Sun
  sunL.position.set(yyA.x, Y + 0.35, yyA.z); moonL.position.set(yyB.x, Y + 0.35, yyB.z);
}

// ---------- Eclipses ----------
// SOLAR — made by the tori (see "The Moon's torus" above): the Moon dips through the Sun's layer at a node and the line
// from the 3D Sun through the 3D Moon reaches the plane. The dark spot is where the 3D Moon hides the 3D Sun.
// LUNAR — made by the shadow body on the vortex axis. On Gleason's map the line from the Sun to the point opposite it
// always crosses the central axis; the body rides the axis at that crossing, so its shadow falls on the point opposite the
// Sun, and the Moon is eclipsed only when it passes through it. The shadow is oval — longer east–west by exactly the map's
// east–west stretch at that latitude — and its size breathes with the Moon's distance (bigger when the Moon is nearer),
// ~50 mi dark core and ~90 mi faint outer shadow on the Moon's ring. Tested on every full moon 2000–2030.
// The eclipse list is predicted by these rules, then compared with the real catalogue (astronomy-engine) for honesty.
const Ast = globalThis.Astronomy, AU_KM = 149597870.7, EARTH_KM = 6378.137;
const LUNAR = { MI_PER_DEG: 180 * MI_PER_DEG / 180, RU: 52 };
const ECL = { list: [], real: [], from: Infinity, to: -Infinity, busy: false, info: null, lunarInfo: null, agree: '' };
const eqdKm = (body, time) => { const v = Ast.RotateVector(Ast.Rotation_EQJ_EQD(time), Ast.GeoVector(body, time, true)); return [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len3 = (a) => Math.sqrt(dot3(a, a));
/** Real point under the Moon's shadow axis (WGS-84), for comparison only. */
function realShadowPoint(time) {
  const FL = 1 / 298.257223563, sq = (v) => [v[0], v[1], v[2] / (1 - FL)];
  const s = sq(eqdKm(Ast.Body.Sun, time)), m = sq(eqdKm(Ast.Body.Moon, time));
  const d = [m[0] - s[0], m[1] - s[1], m[2] - s[2]], dl = len3(d); d.forEach((_, i) => (d[i] /= dl));
  const b = dot3(m, d), disc = b * b - (dot3(m, m) - EARTH_KM * EARTH_KM);
  let p, hit = disc >= 0;
  if (hit) { const k = -b - Math.sqrt(disc); p = [m[0] + k * d[0], m[1] + k * d[1], m[2] + k * d[2]]; }
  else { const q = [m[0] - b * d[0], m[1] - b * d[1], m[2] - b * d[2]], ql = len3(q); p = q.map((x) => x * EARTH_KM / ql); }
  const z = p[2] * (1 - FL), lat = Math.atan2(z, (1 - FL) * (1 - FL) * Math.hypot(p[0], p[1])) * 180 / Math.PI, ra = Math.atan2(p[1], p[0]) * 180 / Math.PI;
  return { lat, lon: wrap180(ra - Ast.SiderealTime(time) * 15), hit };
}
/** Real topocentric sun & moon for a place (for the "real" comparison column). */
function realSunMoon(time, lat, lon) {
  const obs = new Ast.Observer(lat, lon, 0);
  const es = Ast.Equator(Ast.Body.Sun, time, obs, true, true), em = Ast.Equator(Ast.Body.Moon, time, obs, true, true);
  const hs = Ast.Horizon(time, obs, es.ra, es.dec);
  const sep = Ast.AngleBetween(Ast.VectorFromSphere(new Ast.Spherical(es.dec, es.ra * 15, 1), time), Ast.VectorFromSphere(new Ast.Spherical(em.dec, em.ra * 15, 1), time));
  return { sAlt: hs.altitude, sep, sSemi: 959.63 / 3600 / es.dist, mSemi: Math.asin(1737.4 / (em.dist * AU_KM)) * 180 / Math.PI };
}
/** Fraction of a disc of radius rs covered by a disc of radius rm, centres d apart. */
function coveredFrac(d, rs, rm) {
  if (d >= rs + rm) return 0;
  if (d <= Math.abs(rm - rs)) return rm >= rs ? 1 : (rm * rm) / (rs * rs);
  const a = rs * rs * Math.acos(Math.min(1, Math.max(-1, (d * d + rs * rs - rm * rm) / (2 * d * rs))));
  const b = rm * rm * Math.acos(Math.min(1, Math.max(-1, (d * d + rm * rm - rs * rs) / (2 * d * rm))));
  const k = 0.5 * Math.sqrt(Math.max(0, (-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm)));
  return (a + b - k) / (Math.PI * rs * rs);
}
/** Where the model's Sun→Moon line meets the plane (unbounded), or null if the Moon is not below the Sun. */
function shadowLine(S3, M3) {
  if (M3.y >= S3.y - 1e-6) return null;
  const k = M3.y / (S3.y - M3.y);
  return new THREE.Vector3(M3.x + (M3.x - S3.x) * k, 0, M3.z + (M3.z - S3.z) * k);
}
function modelShadowCentre(S3, M3) { const g = shadowLine(S3, M3); return g && Math.hypot(g.x, g.z) <= R ? { ...xzToLatLon(g.x, g.z), x: g.x, z: g.z } : null; }
function modelCover(lat, lon, S3, M3, sunR, moonR) {
  const P = latLonToXZ(lat, lon, 0), ds = S3.clone().sub(P), dm = M3.clone().sub(P);
  if (dm.length() >= ds.length()) return 0;
  return coveredFrac(ds.angleTo(dm), Math.asin(Math.min(1, sunR / ds.length())), Math.asin(Math.min(1, moonR / dm.length())));
}
/** Solar eclipse geometry for the current sun/moon (true angular sizes, as seen from the model's shadow centre). */
function solarGeometry(S3, M3, L) {
  const g = shadowLine(S3, M3); if (!g || !L || !L.sSemi) return null;
  return { g, sunR: Math.tan(L.sSemi * toRadE) * S3.distanceTo(g), moonR: Math.tan(L.mSemi * MOONLAYER.TOPO * toRadE) * M3.distanceTo(g), ratio: L.mSemi * MOONLAYER.TOPO / L.sSemi, k: M3.y / S3.y };
}
/** Lunar eclipse by the axis shadow body: map distance (mi) from the Moon to the point opposite the Sun. */
function lunarModel(sp, mp, t) {
  const aLat = -sp.lat, a = latLonToXZ(aLat, wrap180(sp.lon + 180)), m = latLonToXZ(mp.lat, mp.lon);
  const dx = m.x - a.x, dz = m.z - a.z, r = Math.hypot(a.x, a.z) || 1e-9, ux = a.x / r, uz = a.z / r;
  const colat = (90 - aLat) * toRadE, stretch = colat / Math.sin(colat);                // map's east–west stretch there
  const d = Math.hypot(dx * ux + dz * uz, (-dx * uz + dz * ux) / stretch) * MI_PER_UNIT;   // distance inside the oval shadow
  if (d > 400) return { d, umbra: 0, penumbra: 0 };
  const dS = bodyAt('Sun', t).dist * AU_KM, dM = bodyAt('Moon', t).dist * AU_KM, deg = 180 / Math.PI;
  const pm = Math.asin(EARTH_KM / dM) * deg, ps = Math.asin(EARTH_KM / dS) * deg, ss = Math.asin(696000 / dS) * deg, sm = Math.asin(1737.4 / dM) * deg;
  const k = LUNAR.MI_PER_DEG, rm = sm * k, ru = 1.02 * (0.99834 * pm - ss + ps) * k, rp = 1.01 * (0.99834 * pm + ss + ps) * k;
  return { d, rm, ru, rp, umbra: coveredFrac(d, rm, ru), penumbra: coveredFrac(d, rm, rp) };
}
/** Real lunar-eclipse amounts (globe), for the comparison column only. */
function lunarReal(t) {
  const time = Ast.MakeTime(new Date(t)), s = eqdKm(Ast.Body.Sun, time), m = eqdKm(Ast.Body.Moon, time);
  const dm = len3(m), ds = len3(s), deg = 180 / Math.PI;
  const th = Math.acos(Math.max(-1, Math.min(1, -dot3(s, m) / (ds * dm)))) * deg;
  const pm = Math.asin(EARTH_KM / dm) * deg, ps = Math.asin(EARTH_KM / ds) * deg, ss = Math.asin(696000 / ds) * deg, sm = Math.asin(1737.4 / dm) * deg;
  return { umbra: coveredFrac(th, sm, 1.02 * (0.99834 * pm - ss + ps)), penumbra: coveredFrac(th, sm, 1.01 * (0.99834 * pm + ss + ps)) };
}
// ---- prediction from the model's own rules ----
function solarMetric(t) { const sp = subpoint('Sun', t), mp = subpoint('Moon', t), sep = gcDeg(sp, mp); if (sep > 3) return { v: sep, sep }; const L = eclipseLimit(t); return { v: sep - L.lim, sep, L, sp, mp }; }
function lunarMetric(t) { const sp = subpoint('Sun', t), mp = subpoint('Moon', t), m = lunarModel(sp, mp, t); return { v: m.d, ...m }; }
function closest(metric, t0) {
  let best = null;
  for (let h = -14; h <= 14; h++) { const t = t0 + h * HOUR, q = metric(t); if (!best || q.v < best.v) best = { ...q, t }; }
  for (let step of [15, 3, 0.5]) { const c = best.t; for (let m = -4; m <= 4; m++) { const t = c + m * step * MIN, q = metric(t); if (q.v < best.v) best = { ...q, t }; } }
  return best;
}
function classifySolar(b) {
  if (!(b.v < 0)) return null;
  const sunY = bodyHeight('Sun', b.sp.lat, subpoint('Sun', b.t + HOUR).lat >= b.sp.lat);
  const S3 = latLonToXZ(b.sp.lat, b.sp.lon, sunY), M3 = latLonToXZ(b.mp.lat, b.mp.lon, moonLayer(b.t, sunY, b.sp, b.mp, subpoint('Moon', b.t + HOUR).lat >= b.mp.lat).y);
  const c = modelShadowCentre(S3, M3), geo = solarGeometry(S3, M3, b.L);
  const kind = c ? (geo.ratio >= 1 ? 'total' : 'annular') : 'partial';   // ratio includes TOPO
  return { type: 'solar', kind, t: b.t, lat: c?.lat, lon: c?.lon };
}
function classifyLunar(b) {
  const kind = b.umbra >= 1 ? 'total' : b.umbra > 0 ? 'partial' : b.penumbra > 0 ? 'penumbral' : null;
  return kind && { type: 'lunar', kind, t: b.t };
}
function predictEclipses(from, to) {
  const out = [];
  for (const [phase, metric, classify] of [[0, solarMetric, classifySolar], [180, lunarMetric, classifyLunar]]) {
    let t = Ast.MakeTime(new Date(from));
    for (let i = 0; i < 400; i++) {
      const p = Ast.SearchMoonPhase(phase, t, 40); if (!p || p.date.getTime() > to) break;
      const e = classify(closest(metric, p.date.getTime())); if (e) out.push(e);
      t = Ast.MakeTime(new Date(p.date.getTime() + 5 * DAY));
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
function realCatalogue(from, to) {
  const out = [];
  for (let e = Ast.SearchGlobalSolarEclipse(new Date(from)); e.peak.date.getTime() < to; e = Ast.NextGlobalSolarEclipse(e.peak)) out.push({ type: 'solar', kind: e.kind, t: e.peak.date.getTime() });
  for (let e = Ast.SearchLunarEclipse(new Date(from)); e.peak.date.getTime() < to; e = Ast.NextLunarEclipse(e.peak)) out.push({ type: 'lunar', kind: e.kind, t: e.peak.date.getTime() });
  return out;
}
function ensureEclipses(t) {
  if (ECL.busy || (t > ECL.from + 300 * DAY && t < ECL.to - 300 * DAY)) return;
  ECL.busy = true;
  setTimeout(() => {
    try {
      const from = t - 2 * 365.25 * DAY, to = t + 4 * 365.25 * DAY;
      ECL.list = predictEclipses(from, to); ECL.real = realCatalogue(from, to); ECL.from = from; ECL.to = to;
      // agreement: every real eclipse found by the model (same day, same type), and nothing extra
      const same = (a, b) => a.type === b.type && Math.abs(a.t - b.t) < DAY;
      const found = ECL.real.filter((r) => ECL.list.some((m) => same(m, r))).length, extra = ECL.list.filter((m) => !ECL.real.some((r) => same(m, r))).length;
      const kinds = ECL.real.filter((r) => ECL.list.some((m) => same(m, r) && m.kind === r.kind)).length;
      ECL.agree = `Model predicts ${found} of ${ECL.real.length} real eclipses in ${new Date(from).getUTCFullYear()}–${new Date(to).getUTCFullYear()}, ${extra} extra; type matches for ${kinds}.`;
      buildEclipseList();
    } finally { ECL.busy = false; }
  }, 50);
}
const moonDiskMat = moon.children[1].material, moonGlowMat = moon.children[0].material;
function applyLunar(L) {
  const u = L ? L.umbra : 0, p = L ? Math.max(0, L.penumbra - L.umbra) : 0;
  const bright = (1 - 0.35 * p) * (1 - 0.55 * u);
  moonDiskMat.color.setRGB(1, 1, 1).lerp(new THREE.Color(0.85, 0.32, 0.16), Math.min(1, u * 1.15)).multiplyScalar(bright);
  moonGlowMat.opacity = 1 - 0.85 * Math.max(u, p * 0.4);
  return bright;
}
function buildEclipseList() {
  const box = $('eclList'); if (!box) return;
  const all = ECL.list, i0 = Math.max(0, all.findIndex((e) => e.t > state.t) - 2);
  box.innerHTML = '';
  for (const e of all.slice(i0, i0 + 9)) {
    const row = document.createElement('div'); row.className = 'eclrow' + (e.t < state.t ? ' past' : '');
    const where = e.type === 'solar' && Number.isFinite(e.lat) ? ` · model shadow ${fmtLat(e.lat)} ${fmtLon(e.lon)}` : '';
    row.innerHTML = `<span>${e.type === 'solar' ? '☀' : '☾'}</span><div><b>${e.kind[0].toUpperCase() + e.kind.slice(1)} ${e.type}</b><small>${new Date(e.t).toISOString().slice(0, 16).replace('T', ' ')} UTC${where}</small></div><button>Go</button>`;
    row.querySelector('button').onclick = () => { state.t = e.t - (e.type === 'solar' ? 2 * HOUR : 0); setPlaying(false); try { refreshTrails(); } catch {} buildEclipseList(); };
    box.appendChild(row);
  }
  $('eclAgree').textContent = ECL.agree;
}
function eclipsePanel(S3, M3) {
  const I = ECL.info, L = ECL.lunarInfo, P = state.pin;
  let pill = 'none now', html = '';
  if (ECL.layer && ECL.layer.dip > 0) html += `<div><span>Moon at a node</span><b>${ECL.layer.dip >= 1 ? `${Math.round((S3.y - M3.y) * MI_PER_UNIT)} mi below the Sun` : `descending, ${Math.round(ECL.layer.dip * 100)}%`}</b></div><div><span>Sun–Moon separation</span><b>${ECL.layer.sep.toFixed(2)}° (limit ${ECL.layer.lim.toFixed(2)}°)</b></div>`;
  if (I) {
    const mc = modelShadowCentre(S3, M3), time = Ast.MakeTime(new Date(state.t)), G = realShadowPoint(time);
    const realPin = realSunMoon(time, P.lat, P.lon);
    const realCov = realPin.sAlt > -0.8 ? coveredFrac(realPin.sep, realPin.sSemi, realPin.mSemi) : 0;
    const modCov = modelCover(P.lat, P.lon, S3, M3, I.sunR, I.moonR);
    pill = 'solar eclipse';
    html += `<div><span>Model shadow centre</span><b>${mc ? `${fmtLat(mc.lat)} ${fmtLon(mc.lon)}` : 'beyond the ice wall'}</b></div>`;
    html += `<div><span>Real shadow centre</span><b>${G.hit ? `${fmtLat(G.lat)} ${fmtLon(G.lon)}` : 'misses (partial only)'}</b></div>`;
    if (mc && G.hit) html += `<div><span>Model vs real</span><b>${Math.round(latLonToXZ(mc.lat, mc.lon).distanceTo(latLonToXZ(G.lat, G.lon)) * MI_PER_UNIT).toLocaleString()} mi apart</b></div>`;
    html += `<div><span>Sun hidden at pin · model / real</span><b>${(modCov * 100).toFixed(0)}% / ${(realCov * 100).toFixed(0)}%</b></div>`;
  }
  if (L && L.penumbra > 0) {
    const R2 = lunarReal(state.t); pill = 'lunar eclipse';
    html += `<div><span>Moon in dark shadow · model / real</span><b>${(L.umbra * 100).toFixed(0)}% / ${(R2.umbra * 100).toFixed(0)}%</b></div><div><span>In faint shadow · model / real</span><b>${(L.penumbra * 100).toFixed(0)}% / ${(R2.penumbra * 100).toFixed(0)}%</b></div>`;
  }
  if (!html) {
    const n = ECL.list.find((e) => e.t > state.t);
    html = `<div><span>Next eclipse (model)</span><b>${n ? `${n.kind} ${n.type}, ${new Date(n.t).toISOString().slice(0, 10)}` : '—'}</b></div><div><span>In</span><b>${n ? `${((n.t - state.t) / DAY).toFixed(1)} days` : '—'}</b></div>`;
  }
  $('eclPill').textContent = pill; $('eclNow').innerHTML = html;
}
// ---- Rahu ☊ & Ketu ☋ (the nodes, on the Sun's layer) and the shadow body on the vortex axis ----
const nodeG = new THREE.Group(); scene.add(nodeG);
function nodeSprite(inner, outer, size) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(inner, outer), transparent: true, depthWrite: false })); s.scale.setScalar(size); return s; }
const rahu = new THREE.Group(), ketu = new THREE.Group();
for (const [g, col] of [[rahu, 'rgba(150,90,255,0.95)'], [ketu, 'rgba(255,120,190,0.95)']]) {
  g.add(nodeSprite(col, 'rgba(0,0,0,0)', 0.55));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 12), new THREE.MeshBasicMaterial({ color: 0x0b0814 }));
  g.add(core); nodeG.add(g);
}
const shadowBody = new THREE.Group();
shadowBody.add(nodeSprite('rgba(120,70,200,0.55)', 'rgba(0,0,0,0)', 0.42));
const sbCore = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x050308 }));
shadowBody.add(sbCore); nodeG.add(shadowBody);
const shadowRay = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xb48cff, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.55 }));
shadowRay.frustumCulled = false; nodeG.add(shadowRay);
let nodeAt = -Infinity;
function meanNode(t) { return ((125.04452 - 1934.136261 * ((t - Date.UTC(2000, 0, 1, 12)) / (36525 * DAY))) % 360 + 360) % 360; }
function updateNodes(now, S) {
  if (now - nodeAt > 150) {
    nodeAt = now;
    const om = meanNode(state.t);
    for (const [g, lam] of [[rahu, om], [ketu, om + 180]]) {
      const q = eclToEqAt(lam, 0, state.t), lon = wrap180(q.ra - SKY.gmst), rising = Math.cos(lam * toRadE) > 0;
      latLonToXZ(q.dec, lon, bodyHeight('Sun', q.dec, rising), g.position);
    }
  }
  // shadow body: where the line from the Sun to the point opposite it (at the Moon's height) crosses the axis
  const A = latLonToXZ(-S.lat, wrap180(S.lon + 180), moon.position.y), rS = Math.hypot(sun.position.x, sun.position.z), rA = Math.hypot(A.x, A.z), f = rS / (rS + rA);
  shadowBody.position.set(0, sun.position.y + (A.y - sun.position.y) * f, 0);
  sbCore.scale.setScalar(Math.max(0.012, (ECL.lunarInfo?.ru || LUNAR.RU) / MI_PER_UNIT * f));
  const P = shadowRay.geometry.attributes.position; P.setXYZ(0, sun.position.x, sun.position.y, sun.position.z); P.setXYZ(1, 0, shadowBody.position.y, 0); P.setXYZ(2, A.x, A.y, A.z); P.needsUpdate = true; shadowRay.computeLineDistances();
  shadowRay.visible = !!(ECL.lunarInfo && ECL.lunarInfo.d < 400);
}

// ---------- Aurora borealis ----------
// The auroral oval surrounds the geomagnetic pole (IGRF dipole pole, epoch 2025: 80.8°N 72.7°W / 80.8°S 107.3°E),
// poleward on the day side (~77° magnetic latitude) and equatorward on the night side (~67°), and moves equatorward
// ~1.8° per Kp step during storms. Curtains run from ~100 km (green, oxygen 557.7 nm) up to ~320 km (red/purple, oxygen
// 630 nm, nitrogen). They are drawn where it is dark enough to see them (sun below −6°). Height can be exaggerated
// because at true scale they are thinner than the ISS's altitude. In this model the vortex feeds them.
const AURORA = { kp: 3, exag: 4, baseKm: 100, topKm: 320, poles: { N: { lat: 80.8, lon: -72.7 }, S: { lat: -80.8, lon: 107.3 } } };
// Realistic curtain light (heights along the curtain: v 0 = 100 km lower border, v 1 = 320 km):
//  • sharp lower border; green oxygen 557.7 nm peaking ~110–150 km; red oxygen 630 nm from ~200 km up, fading by ~300 km;
//  • pink/magenta nitrogen fringe along the lower border in strong activity (Kp ≥ ~5);
//  • fine vertical rays drifting along the arc, broader brightness waves, and a gentle flicker.
const auroraMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uKp: { value: 3 }, uLayers: { value: new THREE.Vector4(0.13, 0.13, 0.65, 0.3) } },   // green centre/σ, red centre/σ (fractions of the curtain)
  vertexShader: `attribute vec2 auv; attribute float adark; varying vec2 vUv; varying float vDark;
    void main(){ vUv = auv; vDark = adark; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec2 vUv; varying float vDark; uniform float uTime; uniform float uKp; uniform vec4 uLayers;
    float hash(float n){ return fract(sin(n) * 43758.5453); }
    float noise(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
    void main(){
      float u = vUv.x, v = vUv.y;
      float r1 = noise(u * 1400.0 + uTime * 1.6), r2 = noise(u * 340.0 - uTime * 0.5), r3 = noise(u * 60.0 + uTime * 0.15);
      float rays = 0.25 + 0.75 * pow(0.55 * r1 + 0.45 * r2, 1.5);
      float waves = 0.35 + 0.65 * r3;
      float lower = smoothstep(0.0, 0.03, v);
      float green = exp(-pow((v - uLayers.x) / uLayers.y, 2.0));
      float red = 0.45 * exp(-pow((v - uLayers.z) / uLayers.w, 2.0));
      float fringe = exp(-pow((v - 0.025) / 0.022, 2.0)) * smoothstep(3.5, 7.5, uKp);
      vec3 col = vec3(0.28, 1.0, 0.52) * green + vec3(0.9, 0.18, 0.32) * red + vec3(1.0, 0.3, 0.75) * fringe;
      float flick = 0.88 + 0.12 * noise(uTime * 4.0 + u * 30.0);
      float k = rays * waves * lower * vDark * flick;
      gl_FragColor = vec4(col * k * 1.5, clamp((green + red + fringe) * k, 0.0, 1.0));
    }`,
});
function makeAurora() {
  const N = 720, LAYERS = 4, geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * LAYERS * 2 * 3), uv = new Float32Array(N * LAYERS * 2 * 2), dark = new Float32Array(N * LAYERS * 2), idx = [];
  for (let L = 0; L < LAYERS; L++) for (let i = 0; i < N; i++) {
    const b = (L * N + i) * 2; uv.set([i / (N - 1) + L * 0.137, 0, i / (N - 1) + L * 0.137, 1], b * 2);
    if (i < N - 1) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('auv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('adark', new THREE.BufferAttribute(dark, 1)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, auroraMat); mesh.frustumCulled = false; mesh.userData = { N, LAYERS };
  return mesh;
}
const auroraN = makeAurora();
scene.add(auroraN);
const auroraFieldN = makeAurora(), auroraFieldS = makeAurora();   // torus-field mode: rings where the field meets the ground
auroraFieldN.visible = auroraFieldS.visible = false;
scene.add(auroraFieldN, auroraFieldS);
let auroraWanted = true;
function applyAuroraMode() {
  auroraN.visible = auroraWanted && !state.fieldMode;
  auroraFieldN.visible = auroraFieldS.visible = auroraWanted && state.fieldMode;
  auroraAt = -Infinity;
}
let auroraAt = -Infinity;
const toR = Math.PI / 180;
function destPoint(lat, lon, dist, brg) { // great-circle destination (degrees)
  const p1 = lat * toR, d = dist * toR, b = brg * toR;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = lon * toR + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / toR, lon: wrap180(l2 / toR) };
}
function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * toR, p2 = lat2 * toR, dl = (lon2 - lon1) * toR;
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / toR;
}
/**
 * Realistic auroral oval around a geomagnetic pole (IGRF dipole pole), redrawn continuously so the curtains fold and drift.
 *  • Centre of the oval (magnetic latitude) depends on magnetic local time: ~75° at magnetic noon, ~67° at magnetic midnight
 *    (Kp 3), and moves ~1.8° equatorward per Kp step; widest and brightest around midnight, thin and faint at noon.
 *  • Layers 0–2: discrete arcs across the oval; layer 3: the faint diffuse aurora on its equatorward side.
 *  • Curtain folds travel westward along the arcs; visible only where the sun is >6° below the horizon.
 */
// Fallback oval, fitted to NOAA's OVATION oval (11 Nov 2026, Kp ≈ 1.7): brightest colatitude from the geomagnetic pole
// 20.3° + 5.6°·c (c = +1 magnetic midnight, −1 noon), band width 9.4° + 3.6°·c, day side ~30 % as bright as night;
// moving ~1.8° equatorward and widening ~0.5° per Kp step.
function auroraOval(brg, midnight, kp) {
  const c = Math.cos((brg - midnight) * toR);
  return { colat: 20.34 + 5.63 * c + (kp - 1.67) * 1.8, width: 9.44 + 3.55 * c + Math.max(0, kp - 1.67) * 0.5, bright: 0.3 + 0.7 * (1 + c) / 2 };
}
function updateAuroraGeometry(mesh, pole, S, kp = AURORA.kp, tSec = performance.now() / 1000) {
  const { N, LAYERS } = mesh.userData, P = mesh.geometry.attributes.position, D = mesh.geometry.attributes.adark;
  const sign = pole.lat >= 0 ? 1 : -1, midnight = bearing(pole.lat, pole.lon, S.lat, S.lon) + 180, v = new THREE.Vector3();
  const yB = (AURORA.baseKm / 1.609344) / MI_PER_UNIT * AURORA.exag, yT = (AURORA.topKm / 1.609344) / MI_PER_UNIT * AURORA.exag;
  const act = Math.min(1.6, 0.35 + 0.14 * kp);
  for (let L = 0; L < LAYERS; L++) for (let i = 0; i < N; i++) {
    const brg = i / (N - 1) * 360, o = auroraOval(brg, midnight, kp), b = (L * N + i) * 2;
    const across = L < 3 ? (L - 1) * 0.25 * o.width : 0.45 * o.width;            // three arcs round the brightest line, diffuse glow toward the equator
    const fold = 0.35 * Math.sin(brg * toR * 9 + tSec * 0.22 + L * 1.7) + 0.16 * Math.sin(brg * toR * 23 - tSec * 0.55 + L) + 0.07 * Math.sin(brg * toR * 61 + tSec * 1.3);
    const q = destPoint(pole.lat, pole.lon, o.colat + across + fold, brg);
    latLonToXZ(q.lat, q.lon, yB, v); P.setXYZ(b, v.x, v.y, v.z);
    const top = L < 3 ? yT * (0.75 + 0.25 * Math.sin(brg * toR * 13 + L * 2 + tSec * 0.1)) : yT * 0.55;
    latLonToXZ(q.lat, q.lon, top, v); P.setXYZ(b + 1, v.x, v.y, v.z);
    const e = sunElevation(q.lat, q.lon, S.lat, S.lon), night = Math.min(1, Math.max(0, (-e - 6) / 8));
    const layerW = L === 1 ? 1 : L < 3 ? 0.7 : 0.28;                                // brightest middle arc, faint diffuse band
    const dk = night * o.bright * act * layerW;
    D.setX(b, dk); D.setX(b + 1, dk);
  }
  P.needsUpdate = true; D.needsUpdate = true;
  auroraMat.uniforms.uKp.value = kp;
}


// ---------- Accurate aurora: NOAA OVATION (live) → NOAA-measured Kp → the slider ----------
// 1. Near the present (within 2 h of NOAA's forecast time) the curtains are placed from NOAA SWPC's OVATION aurora model:
//    a worldwide 1° grid of aurora intensity. For each longitude the auroral band's equatorward edge, poleward edge and
//    brightest latitude are read from the grid; three arcs sit across the band and the diffuse glow at its equatorward
//    edge, each as bright as NOAA's value there.
// 2. Otherwise, the oval model (around the geomagnetic pole, which drifts north ~0.04°/yr) uses the Kp NOAA measured at
//    that time (last ~7 days, 3-hourly; minute-by-minute for the last hours), or the activity slider beyond that.
// 3. Heights: lower border 100 km; green oxygen layer peaking ~125 km, red ~240 km; the top rises with activity
//    (~250 km quiet → ~475 km in severe storms).
const AURORA_LIVE = { grid: null, obs: 0, fc: 0, kp3h: [], kp1m: [], loading: false, bands: {}, src: '' };
async function loadAuroraData() {
  if (AURORA_LIVE.loading) return; AURORA_LIVE.loading = true;
  try {
    const r = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json(), g = new Uint8Array(360 * 181);
      for (const [lon, lat, v] of j.coordinates) g[(((lon % 360) + 360) % 360) * 181 + (lat + 90)] = v;
      Object.assign(AURORA_LIVE, { grid: g, obs: Date.parse(j['Observation Time']), fc: Date.parse(j['Forecast Time']), bands: {} });
    }
  } catch {}
  try { const r = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); AURORA_LIVE.kp3h = (Array.isArray(j[0]) ? j.slice(1).map((a) => ({ t: Date.parse(String(a[0]).replace(' ', 'T') + 'Z'), kp: +a[1] })) : j.map((o) => ({ t: Date.parse(o.time_tag + 'Z'), kp: +o.Kp }))).filter((o) => Number.isFinite(o.kp) && Number.isFinite(o.t)); } } catch {}
  try { const r = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); AURORA_LIVE.kp1m = j.map((o) => ({ t: Date.parse(o.time_tag + 'Z'), kp: +(o.estimated_kp ?? o.kp_index) })).filter((o) => Number.isFinite(o.kp) && Number.isFinite(o.t)); } } catch {}
  AURORA_LIVE.loading = false; auroraAt = -Infinity;
}
loadAuroraData(); setInterval(loadAuroraData, 5 * 60000);
/** Kp that NOAA measured at time t, or null if t is outside the data NOAA publishes. */
function measuredKp(t) {
  const m = AURORA_LIVE.kp1m; if (m.length && t >= m[0].t && t <= m[m.length - 1].t + 30 * MIN) { let b = m[0]; for (const o of m) if (Math.abs(o.t - t) < Math.abs(b.t - t)) b = o; return b.kp; }
  const k = AURORA_LIVE.kp3h; for (const o of k) if (t >= o.t && t < o.t + 3 * HOUR) return o.kp;
  if (k.length && t >= k[k.length - 1].t && t < k[k.length - 1].t + 6 * HOUR) return k[k.length - 1].kp;   // latest block until the next is published
  return null;
}
const ovationLive = (t) => !!AURORA_LIVE.grid && Math.abs(t - AURORA_LIVE.fc) <= 2 * HOUR;
/** Geomagnetic (dipole) pole at time t: 80.79°N (geocentric) 72.7°W in 2025, drifting north ~0.04°/yr (IGRF 2020→2025). */
function geomagPole(t, hemi) {
  const yr = 1970 + t / (365.25 * DAY), lat = Math.min(86, 80.79 + 0.04 * (yr - 2025));
  return hemi === 'S' ? { lat: -lat, lon: 107.3 } : { lat, lon: -72.7 };
}
function setAuroraHeights(kp) {   // real emission heights → curtain fractions
  AURORA.baseKm = 100; AURORA.topKm = 250 + 25 * Math.max(0, Math.min(9, kp));
  const span = AURORA.topKm - AURORA.baseKm, f = (km) => (km - AURORA.baseKm) / span;
  auroraMat.uniforms.uLayers.value.set(f(125), 30 / span, f(240), 70 / span); auroraMat.uniforms.uKp.value = kp;
}
/** NOAA's auroral band at each longitude: equatorward edge, poleward edge, brightest latitude and value (one hemisphere). */
function ovationBands(hemi) {
  if (AURORA_LIVE.bands[hemi]) return AURORA_LIVE.bands[hemi];
  const g = AURORA_LIVE.grid, sgn = hemi === 'S' ? -1 : 1, thr = 4, out = [];
  for (let lon = 0; lon < 360; lon++) {
    const v = (alat) => g[lon * 181 + (sgn * alat + 90)];
    let pk = -1, pv = 0; for (let a = 35; a <= 89; a++) { const x = v(a); if (x > pv) { pv = x; pk = a; } }
    if (pv < thr) { out.push(null); continue; }
    let eq = pk, po = pk; while (eq > 35 && v(eq - 1) >= thr) eq--; while (po < 89 && v(po + 1) >= thr) po++;
    out.push({ eq: eq - 0.5, po: po + 0.5, pk, pv, veq: v(eq) });
  }
  return (AURORA_LIVE.bands[hemi] = out);
}
function ovationAt(bands, lon) {   // smoothed band at a longitude (average of ±2°)
  let n = 0, eq = 0, po = 0, pk = 0, pv = 0, veq = 0;
  for (let k = -2; k <= 2; k++) { const b = bands[(((Math.round(lon) + k) % 360) + 360) % 360]; if (!b) continue; n++; eq += b.eq; po += b.po; pk += b.pk; pv += b.pv; veq += b.veq; }
  return n ? { eq: eq / n, po: po / n, pk: pk / n, pv: pv / 5, veq: veq / n } : null;   // pv/5: missing columns fade the band out
}
function fillAuroraFromOvation(mesh, hemi, S, tSec) {
  const { N, LAYERS } = mesh.userData, P = mesh.geometry.attributes.position, D = mesh.geometry.attributes.adark, v = new THREE.Vector3();
  const bands = ovationBands(hemi), sgn = hemi === 'S' ? -1 : 1;
  const yB = (AURORA.baseKm / 1.609344) / MI_PER_UNIT * AURORA.exag, yT = (AURORA.topKm / 1.609344) / MI_PER_UNIT * AURORA.exag;
  let last = null;
  for (let L = 0; L < LAYERS; L++) for (let i = 0; i < N; i++) {
    const lon = i / (N - 1) * 360, b = ovationAt(bands, lon) || last, idx = (L * N + i) * 2;
    if (b) last = b;
    const w = b ? b.po - b.eq : 0;
    const fold = 0.12 * Math.sin(lon * toR * 9 + tSec * 0.22 + L * 1.7) + 0.06 * Math.sin(lon * toR * 23 - tSec * 0.55 + L);
    const alat = b ? (L < 3 ? Math.max(b.eq, Math.min(b.po, b.pk + (L - 1) * 0.28 * w)) : b.eq + 0.1 * w) + fold : 0;
    const lat = sgn * alat, lonW = lon > 180 ? lon - 360 : lon;
    latLonToXZ(lat, lonW, yB, v); P.setXYZ(idx, v.x, v.y, v.z);
    latLonToXZ(lat, lonW, (L < 3 ? yT * (0.8 + 0.2 * Math.sin(lon * toR * 13 + L * 2 + tSec * 0.1)) : yT * 0.55), v); P.setXYZ(idx + 1, v.x, v.y, v.z);
    const e = sunElevation(lat, lonW, S.lat, S.lon), night = Math.min(1, Math.max(0, (-e - 6) / 8));
    const val = !b ? 0 : L < 3 ? b.pv : b.veq * 0.5, layerW = L === 1 ? 1 : L < 3 ? 0.75 : 0.35;
    const dk = night * Math.min(1.6, val / 30) * layerW;
    D.setX(idx, dk); D.setX(idx + 1, dk);
  }
  P.needsUpdate = true; D.needsUpdate = true;
}
/** Draw one hemisphere's aurora from the best source for the current time. */
function drawAurora(mesh, hemi, S, kpUser, tSec) {
  const t = state.t, kpM = measuredKp(t), kp = kpM ?? kpUser;
  setAuroraHeights(kp);
  if (ovationLive(t)) { fillAuroraFromOvation(mesh, hemi, S, tSec); AURORA_LIVE.src = `NOAA OVATION live · forecast for ${new Date(AURORA_LIVE.fc).toISOString().slice(11, 16)} UTC${kpM != null ? ` · Kp ${kpM.toFixed(1)}` : ''}`; }
  else { updateAuroraGeometry(mesh, geomagPole(t, hemi), S, kp, tSec); AURORA_LIVE.src = `Oval model · Kp ${kp.toFixed(1)} ${kpM != null ? '(measured by NOAA)' : '(from the slider — no NOAA data for this time)'}`; }
}

// ---------- Pin ----------
const pin = new THREE.Group();
{
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  stick.position.y = 0.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 12), new THREE.MeshStandardMaterial({ color: 0xff5d73, emissive: 0xff2244, emissiveIntensity: 0.6 }));
  head.position.y = 0.52;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 32), new THREE.MeshBasicMaterial({ color: 0xff5d73, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  pin.add(stick, head, ring);
}
scene.add(pin);
const sightGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const sight = new THREE.Line(sightGeo, new THREE.LineDashedMaterial({ color: 0xff8d9c, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.75 }));
scene.add(sight);

// ---------- Analemma: the sun's own figure-8 ----------
// Where the sun stands at the same clock time (UTC, the current time of day) on every day of the model year.
// North–south it swings between the tropics (declination); east–west it runs up to ~16 min fast / ~14 min slow
// (the equation of time). Drawn at the sun's own height, so the figure-8 passes through the sun itself.
// Positions come from the same verified ephemeris as the sun (apparent, of date).
const anaState = { key: '', pts: [], lastBuild: 0 };
const anaGroup = new THREE.Group(); scene.add(anaGroup);
const MONTH_COLS = ['#7fd8ff', '#8ff0c8', '#b6f08a', '#f3e46b', '#ffc35a', '#ff9a5a', '#ff7b8a', '#e88bff', '#a99bff', '#7fa8ff', '#6fc8ff', '#7fe0ff'];
const timeOfDayMs = (t) => ((t % DAY) + DAY) % DAY;
function analemmaData(force = false) {
  const ys = yearStart(state.t), tod = Math.round(timeOfDayMs(state.t) / 60000) * 60000; // to the minute
  const key = `${ys},${tod},${dayOfYear(state.t)},${LUM.mode},${SUN_TILT.v},${LUM.amp.toFixed(4)},${state.fieldMode},${FIELD_PACE.real},${FIELD.config.twistStrength},${FIELD.config.seasonDay}`;
  if (!force && key === anaState.key) return anaState.pts;
  const pts = [];
  for (let d = 0; d < 366; d++) {
    const t = ys + d * DAY + tod;
    if (d === 365 && yearStart(t) !== ys) break;
    const sp = state.fieldMode ? fieldSunAt(t) : subpoint('Sun', t), meanLon = wrap180(180 - (tod / 3600000) * 15); // where a uniformly moving "mean sun" would be
    pts.push({ d, t, lat: sp.lat, lon: sp.lon, eotMin: wrap180(meanLon - sp.lon) * 4, /* apparent − mean solar time; + = sun fast (further west) */ month: new Date(t).getUTCMonth() });
  }
  anaState.key = key; anaState.pts = pts; buildAnalemma3D(pts); return pts;
}
/** Key points of an analemma (from the real positions, not fixed dates): the two solstices (Cancer = highest, small circle;
 *  Capricorn = lowest, big circle), the two equinoxes (Aries, Libra — on the equator) and where the figure-8 crosses itself
 *  (≈ +8.9° declination, about 12 April and 30 August; computed, it shifts by a few hundredths of a degree from year to year). */
function analemmaKeys(pts) {
  const n = pts.length; if (n < 300) return null;
  let hi = 0, lo = 0; pts.forEach((q, k) => { if (q.lat > pts[hi].lat) hi = k; if (q.lat < pts[lo].lat) lo = k; });
  const eq = [];
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; if ((a.lat <= 0) !== (b.lat <= 0)) eq.push({ k, f: a.lat / (a.lat - b.lat), up: b.lat > a.lat }); }
  let cross = null;
  for (let i = 0; i < n - 1 && !cross; i++) for (let j = i + 2; j < n - 1; j++) {
    const a = pts[i], b = pts[i + 1], c = pts[j], d = pts[j + 1];
    const den = (b.eotMin - a.eotMin) * (d.lat - c.lat) - (b.lat - a.lat) * (d.eotMin - c.eotMin); if (!den) continue;
    const s1 = ((c.eotMin - a.eotMin) * (d.lat - c.lat) - (c.lat - a.lat) * (d.eotMin - c.eotMin)) / den, u = ((c.eotMin - a.eotMin) * (b.lat - a.lat) - (c.lat - a.lat) * (b.eotMin - a.eotMin)) / den;
    if (s1 >= 0 && s1 <= 1 && u >= 0 && u <= 1) { cross = { i, s: s1, j, u, lat: a.lat + s1 * (b.lat - a.lat), eotMin: a.eotMin + s1 * (b.eotMin - a.eotMin), t1: a.t + s1 * DAY, t2: c.t + u * DAY }; break; }
  }
  return { hi, lo, aries: eq.find((e) => e.up), libra: eq.find((e) => !e.up), cross };
}
const mdShort = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// The analemma attached to the sun, standing upright the way it is drawn and photographed: north (declination)
// up, the equation of time sideways (sun fast = further west). It hangs in the vertical plane along the sun's
// circuit and today's point sits exactly on the sun, so it travels with it. Scale: 1° = ANA_K scene units
// (same degrees both ways, so the shape is true: ~47° tall, ~8° wide).
const ANA_K = 0.03;
const anaSun = new THREE.Group(); anaGroup.add(anaSun);
const anaGround = new THREE.Group(); anaGroup.add(anaGround);
// The analemma is drawn from the sun's actual 3D positions at this clock time on each day of the year: radius from its
// declination (circle size), sideways from the equation of time, height from the path shape. With the straight slope the
// figure-8 lies on that slope — top = small circle (June), bottom = big circle (December) — and today's point is the sun.
function buildAnalemma3D(pts) {
  anaGroup.traverse((c) => c.geometry?.dispose()); anaSun.clear(); anaGround.clear();
  const anaH = (k) => bodyHeight('Sun', pts[k].lat, pts[(k + 1) % pts.length].lat >= pts[k].lat);
  const P = pts.map((q, k) => latLonToXZ(q.lat, q.lon, anaH(k))), cols = [], c = new THREE.Color();
  for (const q of pts) { c.set(MONTH_COLS[q.month]); cols.push(c.r, c.g, c.b); }
  P.push(P[0].clone()); cols.push(cols[0], cols[1], cols[2]);
  const g = new THREE.BufferGeometry().setFromPoints(P); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  anaSun.add(new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })));
  anaSun.add(new THREE.Points(g.clone(), new THREE.PointsMaterial({ size: 0.07, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const K = analemmaKeys(pts);
  if (K) {
    const at = (k, f = 0) => { const a = P[k], b = P[(k + 1) % pts.length]; return a.clone().lerp(b, f); };
    const marks = [
      [`${mdShort(pts[K.hi].t)} · Cancer`, `small circle · highest (+${pts[K.hi].lat.toFixed(2)}°)`, at(K.hi), 0.3, 0],
      [`${mdShort(pts[K.lo].t)} · Capricorn`, `big circle · lowest (${pts[K.lo].lat.toFixed(2)}°)`, at(K.lo), -0.3, 0],
      K.aries && [`${mdShort(pts[K.aries.k].t + K.aries.f * DAY)} · Aries`, 'on the equator (0°)', at(K.aries.k, K.aries.f), 0.2, 1.1],
      K.libra && [`${mdShort(pts[K.libra.k].t + K.libra.f * DAY)} · Libra`, 'on the equator (0°)', at(K.libra.k, K.libra.f), -0.2, -1.1],
      K.cross && [`Crossing +${K.cross.lat.toFixed(1)}°`, `${mdShort(K.cross.t1)} & ${mdShort(K.cross.t2)}`, at(K.cross.i, K.cross.s), 0.18, 0.5],
    ].filter(Boolean);
    for (const [label, sub, p0, dy, side] of marks) {
      const isX = label.startsWith('Crossing'), s2 = textSprite([label, sub], isX ? '#ffffff' : '#ffe9b0', 360, 128); s2.scale.set(1.0, 0.36, 1);
      const p = p0.clone(), out = new THREE.Vector3(p.x, 0, p.z).normalize(), tang = new THREE.Vector3(-out.z, 0, out.x);
      p.y += dy; if (side) p.addScaledVector(tang, side); s2.position.copy(p); anaSun.add(s2);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(isX ? 0.045 : 0.035, 16, 10), new THREE.MeshBasicMaterial({ color: isX ? 0xffffff : 0xffe9b0 }));
      dot.position.copy(p0); anaSun.add(dot);
    }
  }
  const drops = [];
  for (let k2 = 0; k2 < pts.length; k2 += 7) { const q = pts[k2]; drops.push(latLonToXZ(q.lat, q.lon, anaH(k2)), latLonToXZ(q.lat, q.lon, 0.02)); }
  anaGround.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(drops), new THREE.LineBasicMaterial({ color: 0xffd56b, transparent: true, opacity: 0.14, depthWrite: false })));
  const ground = pts.map((q) => latLonToXZ(q.lat, q.lon, 0.02)); ground.push(ground[0].clone());
  anaGround.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ground), new THREE.LineBasicMaterial({ color: 0xffd56b, transparent: true, opacity: 0.5, depthWrite: false })));
}
function placeSunAnalemma() {} // positions are absolute (the figure-8 already passes through the sun)
function flyToAnalemma() {
  const pts = analemmaData(); if (!pts.length) return;
  const c = new THREE.Vector3(); pts.forEach((q, k) => c.add(latLonToXZ(q.lat, q.lon, bodyHeight('Sun', q.lat, pts[(k + 1) % pts.length].lat >= q.lat)))); c.divideScalar(pts.length);
  const out = new THREE.Vector3(c.x, 0, c.z).normalize(), tang = new THREE.Vector3(-out.z, 0, out.x), up = new THREE.Vector3(0, 1, 0);
  const th = deg(SUN_TILT.v), spine = out.clone().multiplyScalar(Math.sin(th)).addScaledVector(up, -Math.cos(th)); // June (high, inner) → Dec (low, outer)
  const normal = new THREE.Vector3().crossVectors(spine, tang).normalize();          // perpendicular to the slope the 8 lies on
  if (normal.y < 0) normal.negate();
  // oblique view: mostly from the side (shows the 40° slope) and partly face-on to the slope (opens the loops)
  const dir = tang.clone().multiplyScalar(0.75).addScaledVector(normal, 0.66).normalize();
  flyTo([c.x + dir.x * 6.6, c.y + dir.y * 6.6, c.z + dir.z * 6.6], [c.x, c.y, c.z]);
}
function drawAnalemmaChart() {
  const cv = $('anaChart'); if (!cv) return;
  const pts = analemmaData(), [ctx, w, h] = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  if (!pts.length) return;
  const pad = { l: 34, r: 10, t: 12, b: 26 }, X = (m) => pad.l + (m + 18) / 36 * (w - pad.l - pad.r), Y = (dec) => pad.t + (25 - dec) / 50 * (h - pad.t - pad.b);
  ctx.font = '10px system-ui'; ctx.lineWidth = 1;
  for (const dec of [-23.44, 0, 23.44]) { ctx.strokeStyle = dec ? 'rgba(214,140,20,.35)' : 'rgba(120,200,255,.35)'; ctx.setLineDash(dec ? [4, 4] : []); ctx.beginPath(); ctx.moveTo(pad.l, Y(dec)); ctx.lineTo(w - pad.r, Y(dec)); ctx.stroke(); }
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(140,170,255,.25)'; ctx.beginPath(); ctx.moveTo(X(0), pad.t); ctx.lineTo(X(0), h - pad.b); ctx.stroke();
  ctx.fillStyle = '#8d9bc2'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('+23.4°', pad.l - 4, Y(23.44)); ctx.fillText('0°', pad.l - 4, Y(0)); ctx.fillText('−23.4°', pad.l - 4, Y(-23.44));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const m of [-15, -10, -5, 0, 5, 10, 15]) ctx.fillText(m > 0 ? `+${m}` : `${m}`, X(m), h - pad.b + 4);
  ctx.fillText('sun slow  ←  equation of time (min)  →  sun fast', w / 2 + 10, h - 11);
  ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(X(q.eotMin), Y(q.lat)) : ctx.moveTo(X(q.eotMin), Y(q.lat)))); ctx.closePath();
  ctx.strokeStyle = 'rgba(255,213,107,.35)'; ctx.lineWidth = 1; ctx.stroke();
  pts.forEach((q) => { ctx.fillStyle = MONTH_COLS[q.month]; ctx.beginPath(); ctx.arc(X(q.eotMin), Y(q.lat), 2, 0, Math.PI * 2); ctx.fill(); });
  const K = analemmaKeys(pts);
  if (K) {
    const lab = (txt, e, lat) => { const right = e > 0; ctx.fillStyle = '#e6ecff'; ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'middle'; ctx.fillText(txt, X(e) + (right ? 6 : -6), Y(lat)); };
    lab('Cancer · small circle', pts[K.hi].eotMin, pts[K.hi].lat);
    lab('Capricorn · big circle', pts[K.lo].eotMin, pts[K.lo].lat);
    if (K.aries) lab('Aries · equator', pts[K.aries.k].eotMin, 0);
    if (K.libra) lab('Libra · equator', pts[K.libra.k].eotMin, 0);
    if (K.cross) {
      ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, Y(K.cross.lat)); ctx.lineTo(w - pad.r, Y(K.cross.lat)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(K.cross.eotMin), Y(K.cross.lat), 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(`crosses at +${K.cross.lat.toFixed(1)}° (${mdShort(K.cross.t1)} / ${mdShort(K.cross.t2)})`, w - pad.r, Y(K.cross.lat) - 2);
    }
  }
  const today = pts[Math.min(pts.length - 1, dayOfYear(state.t) - 1)];
  if (today) {
    ctx.fillStyle = '#fff6cf'; ctx.beginPath(); ctx.arc(X(today.eotMin), Y(today.lat), 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffc24a'; ctx.lineWidth = 2; ctx.stroke();
    const eot = today.eotMin, mm = Math.floor(Math.abs(eot)), ss = Math.round((Math.abs(eot) - mm) * 60);
    $('anaInfo').textContent = `Sun at ${new Date(state.t).toISOString().slice(11, 16)} UTC every day · today: declination ${today.lat.toFixed(2)}°, sun ${eot >= 0 ? 'fast' : 'slow'} by ${mm} min ${ss} s`;
  }
}

// ---------- Labels ----------
const labelsEl = $('labels'), labels = [];
function addLabel(text, cls, getPos, group) {
  const el = document.createElement('div');
  el.className = 'lbl ' + (cls || ''); el.textContent = text;
  el.style.left = '0'; el.style.top = '0';
  labelsEl.appendChild(el);
  const l = { el, getPos, group }; labels.push(l); return l;
}
const wp = new THREE.Vector3();
addLabel('☀ Sun', 'sun', () => sun.position, sun);
addLabel('☾ Moon', '', () => moon.position, moon);
addLabel('North Pole', 'faint', () => new THREE.Vector3(0, 0.05, 0));
addLabel('Polaris', 'faint', () => new THREE.Vector3(0, DOME_H - 0.1, 0));
addLabel('Ice wall', '', () => new THREE.Vector3(0, WALL_H + 0.35, R + 0.3));
addLabel('Ice wall', '', () => new THREE.Vector3(0, WALL_H + 0.35, -R - 0.3));
addLabel('Firmament', 'faint', () => new THREE.Vector3(-R * 0.72, DOME_H * 0.7, 0));
FIXED_STARS.filter(([n, , , mag]) => mag < 1.0 || n === 'Alnilam').forEach(([n]) => addLabel(n === 'Alnilam' ? 'Orion\'s Belt' : n, 'star', () => fixedStars.localToWorld(fixedByName[n].v.clone()), fixedStars));
PLANETS.forEach((p, i) => addLabel(`${p.glyph} ${p.name}`, 'planet', () => planetSprites[i].getWorldPosition(wp), planetGroup));
const issLabel = addLabel('🛰 ISS', 'iss', () => issSprite.position, issGroup);
const pinLabel = addLabel('Pin', 'pin', () => pin.position.clone().setY(0.62), pin);
addLabel('☊ Rahu (node)', 'node', () => rahu.position.clone().add(new THREE.Vector3(0, 0.22, 0)), nodeG);
addLabel('☋ Ketu (node)', 'node', () => ketu.position.clone().add(new THREE.Vector3(0, 0.22, 0)), nodeG);
addLabel('Shadow body', 'node', () => shadowBody.position.clone().add(new THREE.Vector3(0, 0.2, 0)), nodeG);
chakraParts.forEach((c) => addLabel(`${c.name} · ${c.skt}`, 'chakra', () => c.holder.position.clone().addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), c.r * 1.25), chakraG).el.style.setProperty('--ck', c.col));
// ---------- Religious texts: the cosmos as the scriptures describe it (an overlay; real-data layers are unchanged) ----------
// Each tradition gets its own group. Everything here is drawn from literal readings of the passages cited in SCRIPTURE;
// sizes and placements the texts don't give are the model's choices. Nothing here moves the Sun, Moon, ISS or eclipses.
// Where a text needs a compass direction on this pole-centred map, its own homeland sets "south" (India for the Puranas and
// Buddhist texts) or the east–west line (Egypt, Babylon); this is stated in the item.
const SCRIPTURE = {
  bible: {
    name: 'Bible', items: [
      ['Waters above the firmament', 'Genesis 1:6–7; Psalm 148:4; Psalm 104:3', 'a shell of water resting on the dome'],
      ['Windows of heaven', 'Genesis 7:11, 8:2; Malachi 3:10', 'eight openings in the dome'],
      ['Throne above the firmament', 'Ezekiel 1:22–26; Isaiah 66:1', 'a light above the waters, over the centre'],
      ['Pillars of heaven', 'Job 26:11', 'twelve columns at the rim, under the dome'],
      ['A circle on the waters at the boundary of light and darkness', 'Job 26:10; Proverbs 8:27', 'the live day–night line on the earth'],
      ['Storehouses of snow, hail and wind', 'Job 38:22; Psalm 135:7; Jeremiah 10:13', 'four storehouses in the ice at the rim'],
      ['Pillars of the earth', '1 Samuel 2:8; Job 9:6; Psalm 75:3', 'twelve columns beneath the land'],
      ['The great deep, waters below', 'Genesis 1:2, 7:11; Psalm 24:2, 136:6', 'the sea the earth is founded on'],
      ['Four corners of the earth', 'Isaiah 11:12; Revelation 7:1', 'four lights at the edge, for the four winds'],
      ['The sun\'s circuit', 'Psalm 19:4–6; Ecclesiastes 1:5', 'the Sun\'s circle today'],
      ['Circle of the earth; heavens spread like a tent', 'Isaiah 40:22; Psalm 104:2', 'the disc and the dome'],
    ],
  },
  talmud: {
    name: 'Talmud', items: [
      ['Seven firmaments', 'Chagigah 12b (Reish Lakish)', 'Vilon, Rakia, Shechakim, Zevul, Ma\'on, Machon, Aravot; Rabbi Yehuda counts only two'],
      ['Vilon, the curtain', 'Chagigah 12b', 'a veil below the dome that goes in at morning and out at evening'],
      ['Rakia holds the sun, moon and stars', 'Chagigah 12b', 'the dome itself'],
      ['The earth on twelve pillars', 'Chagigah 12b', 'twelve columns beneath the land (others say seven, or one)'],
      ['By day the sun goes beneath the firmament, by night above it', 'Pesachim 94b (Sages of Israel)', 'not drawn; the gentile sages\' view is that it goes beneath the earth'],
    ],
  },
  enoch: {
    name: 'Book of Enoch', items: [
      ['Six portals of the sun', '1 Enoch 72:2–32', 'six bands on the Sun\'s path, each holding the Sun for one month either side of a solstice: portal 1 (December) to 6 (June); the lit one holds the Sun now'],
      ['The moon goes through the same portals', '1 Enoch 73–74, 78', 'the silver ring marks the Moon\'s portal now'],
      ['Twelve portals of the winds', '1 Enoch 76:1–14', 'twelve gates around the edge, three in each quarter'],
      ['Seven mountains of precious stones', '1 Enoch 18:6–9, 24:1–3', 'seven peaks at the southern edge; the middle one reaches heaven like a throne'],
      ['The year of 364 days', '1 Enoch 72:32, 74:10–12, 75:1–2', 'four days added by the leaders of the seasons; shown in the readout'],
      ['The ends of the earth, where heaven rests', '1 Enoch 33:1–2', 'the firmament meeting the edge'],
    ],
  },
  quran: {
    name: 'Quran', items: [
      ['Seven heavens, one above another', 'Quran 2:29, 41:12, 67:3, 71:15', 'six more heavens above the first'],
      ['The nearest heaven adorned with lamps', 'Quran 37:6, 67:5', 'the first heaven, with the star wheel'],
      ['Sky as a protected roof, raised without pillars you can see', 'Quran 13:2, 21:32, 22:65, 31:10', 'the dome (no pillars under the sky)'],
      ['The Kursi extends over the heavens and the earth', 'Quran 2:255', 'a sphere around all seven heavens'],
      ['Lord of the Great Throne', 'Quran 9:129, 23:86', 'a light above the seventh heaven'],
      ['Seven earths like them', 'Quran 65:12', 'six more earths beneath this one'],
      ['Earth spread out like a bed', 'Quran 15:19, 20:53, 78:6, 79:30, 88:20', 'the disc'],
      ['Mountains as pegs', 'Quran 16:15, 21:31, 78:7', 'pegs driven down beneath ten great peaks'],
      ['Sun and Moon each floating in an orbit', 'Quran 21:33, 36:38–40, 55:5', 'the Sun\'s and Moon\'s circles today'],
      ['The Moon\'s stations (manāzil)', 'Quran 10:5, 36:39', 'the Moon\'s mansion now, of 28, in the readout'],
      ['The sun prostrates beneath the Throne', 'Hadith: Bukhari 3199 (not Quran)', 'not drawn'],
    ],
  },
  purana: {
    name: 'Hindu Puranas', items: [
      ['Mount Meru at the centre', 'Bhagavata Purana 5.16.7–10', 'golden, broader at the top than at the base, 84,000 yojanas high (in proportion to the Sun\'s 100,000)'],
      ['The sun chariot\'s one wheel: 12 spokes, the months', 'Bhagavata Purana 5.21.13–14', 'a wheel on the Sun\'s circle, turning with it; the spoke to the Sun is the axle'],
      ['The axle fixed on Meru', 'Bhagavata Purana 5.21.13', 'a beam from Meru\'s axis to the Sun'],
      ['Cities of the four guardians on Mānasottara', 'Bhagavata Purana 5.21.7', 'Indra (east), Yama (south), Varuṇa (west), Soma (north), with India due south of Meru'],
      ['Heights of the luminaries', 'Bhagavata Purana 5.22.8–17, 5.23.1', 'Moon 100,000 yojanas above the Sun; stars 200,000 above the Moon (some translations 300,000); then Venus, Mercury, Mars, Jupiter, Saturn 200,000 apart; the Seven Sages 1,100,000 above Saturn; Dhruva 1,300,000 above them. Rings on the axis; above the Sun the scale is compressed to fit the dome'],
      ['Dhruva, the pole star all lights circle', 'Bhagavata Purana 5.23.1–3', 'a star at the top of the dome'],
      ['Lokāloka, the ring mountain at the world\'s edge', 'Bhagavata Purana 5.20.34–38', 'a high ring beyond the ice'],
      ['Rahu and Ketu', 'Bhagavata Purana 5.24.1–3', 'the shadow bodies of eclipses; Rahu 10,000 yojanas below the Sun'],
      ['Seven islands and seven oceans', 'Bhagavata Purana 5.20', 'not drawn: the map shows only one of them'],
    ],
  },
  gita: {
    name: 'Bhagavad Gita', items: [
      ['The eternal aśvattha tree: roots above, branches below', 'Bhagavad Gita 15.1–3', 'hanging from the top of the firmament, branches spreading down toward the earth, its leaves the Vedas'],
      ['The two paths: of light and of smoke', 'Bhagavad Gita 8.24–26', 'light: fire, day, the bright fortnight, the six months of the Sun\'s northern course; smoke: night, the dark fortnight, the southern course. Today\'s Sun circle is gold in the northern course and grey in the southern, the Moon\'s bright when waxing; the arrow shows where the Sun is heading'],
      ['Sun and Moon are the eyes of the universal form', 'Bhagavad Gita 11.19', 'halos on the real Sun and Moon'],
      ['Of lights I am the radiant Sun; among the stars I am the Moon', 'Bhagavad Gita 10.21', 'labels on the real Sun and Moon'],
      ['Of peaks I am Meru', 'Bhagavad Gita 10.23', 'a golden peak at the centre'],
      ['Of months I am Mārgaśīrṣa, of seasons the flowering spring', 'Bhagavad Gita 10.35', 'today\'s lunar month and season in the readout'],
      ['The light in the Sun, Moon and fire is Mine; I become the Moon and nourish the plants', 'Bhagavad Gita 15.12–13', 'a soft cone of light from the Moon to the ground beneath it'],
      ['The supreme abode, lit by neither sun nor moon nor fire', 'Bhagavad Gita 15.6, 8.21', 'a light beyond the firmament'],
      ['A day of Brahmā is a thousand yugas, and so is his night', 'Bhagavad Gita 8.17–19', '4.32 billion years each; listed only'],
      ['Eightfold nature: earth, water, fire, air, ether, mind, intellect, ego', 'Bhagavad Gita 7.4', 'listed only'],
      ['As the one Sun lights this whole world', 'Bhagavad Gita 13.33', 'the real day side of the map'],
      ['10.21, 10.23 and 10.35 are standard verses not re-checked against a source this time', '', ''],
    ],
  },
  buddhist: {
    name: 'Buddhist (Abhidharmakośa)', items: [
      ['Mount Sumeru at the centre', 'Abhidharmakośa 3.45–50', '80,000 yojanas high and wide; north face gold, east silver, south lapis (which colours our sky), west crystal'],
      ['Seven golden mountain rings and seas', 'Abhidharmakośa 3.48–51', 'Yugandhara to Nimindhara, each half as high as the one inside it'],
      ['Sun and moon circle at half Sumeru\'s height', 'Abhidharmakośa 3.60', '40,000 yojanas up, the level of Yugandhara'],
      ['Four continents in the outer ocean', 'Abhidharmakośa 3.53–55', 'Jambudvīpa (south, cart-shaped), Pūrvavideha (east, half-moon), Aparagodānīya (west, round), Uttarakuru (north, square); enlarged to be seen, India due south'],
      ['Cakravāla, the iron ring mountain', 'Abhidharmakośa 3.51', 'the outer edge; whole scale set so it meets the map\'s rim'],
    ],
  },
  jain: {
    name: 'Jain', items: [
      ['Two suns and two moons over Jambūdvīpa', 'Sūryaprajñapti; Tattvārtha Sūtra 4.12–14', 'a second Sun and Moon opposite the real ones, always half a world away'],
      ['184 circles of the sun', 'Sūryaprajñapti 1', 'the Sun steps one circle a day between innermost (June) and outermost (December); the lit one is today'],
      ['Heights: stars 790, sun 800, moon 880 yojanas', 'Tattvārtha Sūtra 4.13 (commentaries)', 'the Moon above the Sun; noted, not redrawn'],
    ],
  },
  zoro: {
    name: 'Zoroastrian (Bundahishn)', items: [
      ['Harā / Alborz, the mountain round the world', 'Bundahishn 8, 12; Yasht 10.13', 'a mountain ring at the edge'],
      ['Stations: stars lowest, then moon, then sun, then Endless Light', 'Bundahishn 2, 12', 'three levels and the Endless Light above'],
      ['The peak around which sun, moon and stars turn', 'Bundahishn 12 (Tērag)', 'a peak at the centre'],
      ['180 windows in the east and 180 in the west for the sun', 'Bundahishn 5', 'the Sun\'s window today in the readout'],
    ],
  },
  norse: {
    name: 'Norse (Prose Edda)', items: [
      ['The sky is Ymir\'s skull, held up by four dwarves', 'Gylfaginning 8', 'Norðri, Suðri, Austri, Vestri at the four quarters of the rim'],
      ['Jörmungandr encircles the world in the ocean', 'Gylfaginning 34', 'the serpent round the edge, biting its tail'],
      ['Sköll chases the sun, Hati the moon', 'Gylfaginning 12', 'two wolves just behind the real Sun and Moon'],
      ['Yggdrasil, the world tree', 'Gylfaginning 15–16; Völuspá 19', 'at the centre, roots below, branches over all'],
      ['Bifröst, the bridge to the sky', 'Gylfaginning 13', 'a rainbow from Midgard up into the sky'],
    ],
  },
  egypt: {
    name: 'Ancient Egyptian', items: [
      ['Nut, the sky, arched over Geb, the earth', 'Book of Nut (Seti I cenotaph); Pyramid Texts', 'a starry arch over the dome along Egypt\'s east–west line'],
      ['Shu, the air, holds Nut up', 'Coffin Texts, spells 75–80', 'a column of light at the centre'],
      ['Ra sails the sky in his barque', 'Book of Nut; Book of Gates', 'a boat carrying the real Sun'],
      ['At night Ra crosses the Duat below the earth', 'Amduat; Book of Gates', 'the night path beneath the disc; the readout says where Ra is for Egypt'],
    ],
  },
  meso: {
    name: 'Mesopotamian (Enūma Eliš)', items: [
      ['Half of Tiamat made the sky, with a bar and guards', 'Enūma Eliš IV.137–140', 'a bronze bar round the rim with eight guards'],
      ['Gates on both sides, with strong bolts', 'Enūma Eliš V.9–10', 'east and west gates for Babylon'],
      ['Three stars for each of the twelve months', 'Enūma Eliš V.3–4', '36 stars on the turning firmament in the three paths of Enlil, Anu and Ea (from MUL.APIN)'],
      ['The Moon given the night, its crown by days', 'Enūma Eliš V.12–18', 'the Moon\'s day of the month in the readout'],
    ],
  },
  mason: {
    name: 'Freemasonry (symbolism of the lodge)', items: [
      ['The lodge is the world: an oblong square, due east and west', 'Entered Apprentice lecture; 18th-century catechisms', 'length east–west, breadth north–south, depth to the centre of the earth, height to the heavens; laid along London\'s east–west line (first Grand Lodge, 1717)'],
      ['Its covering: a clouded canopy, a starry-decked heaven', 'Entered Apprentice lecture', 'a many-coloured, starry canopy over the dome'],
      ['Jacob\'s ladder, its three principal rounds Faith, Hope and Charity', 'Entered Apprentice lecture; Genesis 28:12', 'from the altar up to the canopy'],
      ['Three great pillars: Wisdom, Strength, Beauty', 'Entered Apprentice lecture', 'Ionic in the East (Master), Doric in the West (Senior Warden), Corinthian in the South (Junior Warden)'],
      ['The officers follow the sun', 'Opening and closing ritual', 'the Master in the East as the sun rises, the Junior Warden in the South at high twelve, the Senior Warden in the West as it sets; the readout follows the real Sun over London'],
      ['Sun, Moon and Master: the three lesser lights', 'Entered Apprentice lecture', 'three lights at the stations of the Master and Wardens'],
      ['Boaz and Jachin at the porch', '1 Kings 7:21; Fellowcraft lecture', 'Boaz north, Jachin south at the western entrance; the globes (celestial, terrestrial) are a later Masonic addition and their placement varies'],
      ['Mosaic pavement, indented tessel, blazing star', 'Entered Apprentice lecture (ornaments of the lodge)', 'a chequered floor, a toothed border and the blazing star with G at the centre'],
      ['The altar: Volume of the Sacred Law, square and compasses', 'Entered Apprentice lecture (great lights)', 'at the centre'],
      ['Point within a circle between two parallel lines', 'Entered Apprentice lecture; astronomical reading in 19th-century Masonic writers (attributed to Mackey)', 'the parallels as the two solstice circles, the circle as today\'s Sun circle; the lecture\'s own reading is the two Saints John'],
      ['The All-Seeing Eye', 'Master Mason lecture', 'at the top of the canopy'],
      ['Freemasonry says it is not a religion', 'United Grand Lodge of England', 'these are symbols of the lodge, not a doctrine of the cosmos'],
    ],
  },
  bonacci: {
    name: 'Santos Bonacci (Syncretism, astrotheology)', items: [
      ['A modern teacher, not a scripture', 'Universal Truth School; secondary summaries', 'only ideas that published summaries attribute to him are drawn; his own lectures were not available to check'],
      ['A flat, fixed earth beneath a firmament that holds the Sun', 'summaries of his talks (2016, 2021)', 'the disc and dome, as in the model'],
      ['Stars are openings in the firmament', 'One Radio Network interview summary (2021)', 'pinholes of light in the dome, turning with the stars'],
      ['Seven layers inside the dome, outer to inner: Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon', 'the classical "Chaldean order"; added to this layer at your request', 'seven nested domes; each body is a flat disc stuck to its own layer, in the direction of its real place in the sky, turning with the firmament'],
      ['Mount Meru: a luminous, magnetic, invisible mountain at the North Pole', 'summary of his Syncretism (2016)', 'a faint glowing mountain at the pole'],
      ['The Sun\'s path between Cancer and Capricorn is the key pattern', 'summary of his Syncretism (2016)', 'small, high circle at Cancer (June), big, low circle at Capricorn (December), as in the model'],
      ['The "tabernacle of the Sun", the "breath of Brahma"', 'summary of his Syncretism (2016)', 'the real Sun\'s path for the next year, one turn a day, breathing out to Capricorn and in to Cancer'],
      ['The figure-8 (analemma) crossing about 8.5° above the equator', 'summary of his Syncretism (2016)', 'the real figure-8 at this clock time; the readout gives its computed crossing'],
      ['As above, so below: the zodiac in the human body', 'Hermetic axiom; summaries of his teaching', 'the zodiac man, Aries the head to Pisces the feet; lit where the Sun (gold) and Moon (silver) are now'],
      ['The Christos rising along the spine to the pineal', 'summaries of his "Raising the Chrism"', 'a light climbing the spine to the head'],
      ['The twelve tribes and twelve disciples are the twelve signs', 'summaries of his astrotheology', 'listed only: published pairings of tribes and apostles with signs vary'],
      ['Flower of Life, golden ratio', 'symbols he decodes', 'the Flower of Life is in Pattern Lab → Compare with'],
    ],
  },
  china: {
    name: 'Chinese (Gaitian)', items: [
      ['Heaven round, earth square', 'Zhoubi suanjing; Da Dai Liji', 'a square chessboard earth under the round heaven'],
      ['Heaven like an open canopy with 28 ribs', 'Zhoubi suanjing; Kaogongji', '28 ribs on the dome, for the 28 lodges'],
      ['Seven paths (qi heng) of the sun', 'Zhoubi suanjing B', 'seven rings from the summer (inner) to winter (outer) path; the lit gap holds the Sun'],
      ['24 solar terms', 'Huainanzi 3', 'the current term in the readout'],
      ['Gonggong broke Mount Buzhou; heaven tilted', 'Huainanzi 3.1', 'not drawn'],
    ],
  },
};
const scG = new THREE.Group(); scene.add(scG);
const SC = { sel: 'none', groups: {}, live: {}, time: { value: 0 } };
for (const k of Object.keys(SCRIPTURE)) { const g = new THREE.Group(); g.visible = false; scG.add(g); SC.groups[k] = g; }
const scGlow = (col, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(col, 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(size); return s; };
const scShellMat = (c1, c2, alpha, ripples) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: SC.time, c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, uA: { value: alpha }, uRip: { value: ripples ? 1 : 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime; uniform vec3 c1; uniform vec3 c2; uniform float uA; uniform float uRip;
    void main(){
      float fres = pow(1.0 - abs(dot(vN, vV)), 1.8);
      float w = uRip * (0.5 + 0.5 * sin(vP.x * 2.3 + uTime * 0.6) * sin(vP.z * 2.1 - uTime * 0.5 + vP.y * 1.7));
      vec3 col = mix(c1, c2, clamp(fres + w * 0.35, 0.0, 1.0));
      gl_FragColor = vec4(col * (uA * (0.35 + fres) + w * uA * 0.4), 1.0);
    }`,
});
const scUnitCircle = (col, op = 0.75, n = 256) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: n + 1 }, (_, i) => new THREE.Vector3(Math.cos(i / n * Math.PI * 2), 0, Math.sin(i / n * Math.PI * 2)))), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }));
const scDir = (lon) => latLonToXZ(0, lon, 0).setY(0).normalize();   // horizontal unit vector pointing out along a meridian
const scAt = (lon, r, y = 0) => scDir(lon).multiplyScalar(r).setY(y);
const scSunRing = (dec, col, op) => { const pts = []; for (let i = 0; i <= 256; i++) pts.push(latLonToXZ(dec, i / 256 * 360 - 180, lumAlt(dec))); return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op })); };
function scPillars(g, n, r1, r2, top, h, col = 0xd9cfb8) {
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, emissive: 0x2a2418, emissiveIntensity: 0.6 });
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, r = i % 2 ? r1 : r2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h, 20), mat); p.position.set(r * Math.cos(a), top - h / 2, -r * Math.sin(a)); g.add(p);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mat); cap.position.set(p.position.x, top - 0.03, p.position.z); g.add(cap);
  }
}
function scArch(g, pos, size, col) {   // an arched gate standing at pos, facing the centre
  const w = new THREE.Group(); w.position.copy(pos); w.lookAt(0, pos.y, 0);
  const mat = new THREE.MeshStandardMaterial({ color: col, metalness: 0.5, roughness: 0.4, emissive: col, emissiveIntensity: 0.35 });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.09, 8, 32, Math.PI), mat); arc.position.y = size; w.add(arc);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.09, size * 0.09, size, 10), mat); post.position.set(s * size, size / 2, 0); w.add(post); }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.8, size * 1.9), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); door.position.y = size * 0.95; w.add(door);
  g.add(w); return w;
}
const SC_INDIA = 78, SC_EGYPT = 31.2, SC_BABYLON = 44.4;   // reference meridians (see the note at the top)
// ======================= Bible =======================
{
  const g = SC.groups.bible;
  const WAT_R = FIRM_R + 0.55;
  const waters = new THREE.Mesh(new THREE.SphereGeometry(WAT_R, 128, 48, 0, Math.PI * 2, 0, Math.PI / 2), scShellMat(0x0a5a8c, 0x7fe3ff, 0.7, true));
  waters.renderOrder = 6; g.add(waters);
  const winMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const frameMat = new THREE.LineBasicMaterial({ color: 0xe9f6ff, transparent: true, opacity: 0.8 });
  SC.windows = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8, el = deg(50), p = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), -Math.sin(a) * Math.cos(el)).multiplyScalar(FIRM_R);
    const w = new THREE.Group(); w.position.copy(p); w.lookAt(0, 0, 0);
    w.add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), winMat));
    const f = [[-0.45, -0.6], [0.45, -0.6], [0.45, 0.6], [-0.45, 0.6], [-0.45, -0.6]].map(([x, y]) => new THREE.Vector3(x, y, 0));
    w.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(f), frameMat));
    w.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(0.45, 0, 0)]), frameMat));
    g.add(w); SC.windows.push(p);
  }
  const throne = scGlow('rgba(255,236,170,0.95)', 2.6); throne.position.set(0, WAT_R + 0.9, 0); g.add(throne);
  const throneCore = scGlow('rgba(255,255,255,1)', 0.7); throneCore.position.copy(throne.position); g.add(throneCore);
  // pillars of heaven (Job 26:11): twelve columns at the rim, from the land up to the dome
  const rH = FIRM_R - 0.45, hH = domeY(rH);
  const phMat = new THREE.MeshStandardMaterial({ color: 0xeef3ff, roughness: 0.4, transparent: true, opacity: 0.55, emissive: 0x8899bb, emissiveIntensity: 0.4 });
  for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * Math.PI * 2, p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, hH, 16), phMat); p.position.set(rH * Math.cos(a), hH / 2, -rH * Math.sin(a)); g.add(p); }
  SC.heavenPillar = new THREE.Vector3(rH * Math.cos(Math.PI / 12), hH * 0.6, -rH * Math.sin(Math.PI / 12));
  // the great deep and the pillars of the earth
  const DEEP_Y = -1.7, deepR = Math.sqrt(FIRM_R * FIRM_R - DEEP_Y * DEEP_Y);
  const deepTop = new THREE.Mesh(new THREE.CircleGeometry(deepR, 160), scShellMat(0x062a5c, 0x3d9bea, 0.5, true));
  deepTop.rotation.x = -Math.PI / 2; deepTop.position.y = DEEP_Y; g.add(deepTop);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(FIRM_R - 0.02, 128, 48, 0, Math.PI * 2, Math.acos(DEEP_Y / FIRM_R), Math.PI - Math.acos(DEEP_Y / FIRM_R)), scShellMat(0x04204a, 0x2a7fd0, 0.45, true)));
  scPillars(g, 12, R * 0.42, R * 0.78, -0.05, 6.5);
  SC.pillarPos = new THREE.Vector3(R * 0.78, -2.6, 0); SC.deepPos = new THREE.Vector3(-deepR * 0.6, DEEP_Y, 0);
  // storehouses of snow, hail and wind (Job 38:22): four in the ice at the rim
  SC.stores = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, p = new THREE.Vector3(Math.cos(a) * (ICE_OUT - 0.15), 0.25, -Math.sin(a) * (ICE_OUT - 0.15));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x9fd8ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }));
    box.position.copy(p); box.lookAt(0, p.y, 0); g.add(box); const gl = scGlow('rgba(200,235,255,0.8)', 1.0); gl.position.copy(p); g.add(gl); SC.stores.push(p);
  }
  // four corners / four winds
  SC.corners = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, p = new THREE.Vector3(Math.cos(a) * (ICE_OUT + 0.25), 0.9, -Math.sin(a) * (ICE_OUT + 0.25));
    const s = scGlow('rgba(255,250,225,0.95)', 1.1); s.position.copy(p); g.add(s);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.set(p.x, 0, p.z); g.add(beam); SC.corners.push(p);
  }
  // boundary of light and darkness (Job 26:10): the live day–night line
  const term = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(361 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.95 }));
  term.frustumCulled = false; g.add(term); SC.live.term = term; SC.termLbl = new THREE.Vector3();
  const circ = scUnitCircle(0xffd56b, 0.7); g.add(circ); SC.live.bibleSun = circ;
  SC.watersTop = new THREE.Vector3(-WAT_R * 0.55, WAT_R * 0.84, 0); SC.thronePos = throne.position;
}
// ======================= Talmud =======================
{
  const g = SC.groups.talmud;
  SC.firmNames = ['Vilon (curtain)', 'Rakia (holds sun, moon, stars)', 'Shechakim', 'Zevul', 'Ma\'on', 'Machon', 'Aravot'];
  SC.firmR = [FIRM_R - 0.25, FIRM_R, FIRM_R + 0.7, FIRM_R + 1.4, FIRM_R + 2.1, FIRM_R + 2.8, FIRM_R + 3.5];
  const veil = new THREE.Mesh(new THREE.SphereGeometry(SC.firmR[0], 96, 32, 0, Math.PI * 2, 0, Math.PI / 2), scShellMat(0x30343c, 0xc8d0e0, 0.12, false)); g.add(veil);
  for (let k = 2; k < 7; k++) g.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(SC.firmR[k], 96, 32, 0, Math.PI * 2, 0, Math.PI / 2), scShellMat([0x6a5a2a, 0x7a6326, 0x8a6a20, 0x9a7018, 0xb07a10][k - 2], 0xfff0c0, 0.15 - k * 0.012, false)), { renderOrder: 6 + k }));
  scPillars(g, 12, R * 0.42, R * 0.78, -0.05, 6.5, 0xd8c79a);
}
// ======================= Book of Enoch =======================
{
  const g = SC.groups.enoch; SC.portals = [];
  // Enoch 72: from the spring equinox the Sun spends one month in each of portals 4, 5, 6, then 6, 5, 4, then 3, 2, 1, then 1, 2, 3.
  // So each portal is one month either side of a solstice; its edges are the Sun's real declination 30 and 60 days from an equinox.
  const e = 23.44, b1 = rad(Math.asin(Math.sin(deg(e)) * Math.sin(Math.PI / 6))), b2 = rad(Math.asin(Math.sin(deg(e)) * Math.sin(Math.PI / 3)));
  SC.ENOCH_B = [-e, -b2, -b1, 0, b1, b2, e];
  SC.buildPortals = () => {
    SC.portals.forEach((p) => { g.remove(p.mesh, p.ring); p.mesh.geometry.dispose(); p.ring.geometry.dispose(); });
    SC.portals = [];
    const cols = [0x6aa8ff, 0x7fd0ff, 0x9df0d8, 0xc8f08a, 0xffd56b, 0xffa94d];
    for (let k = 0; k < 6; k++) {   // portal 1 = southernmost (winter, Capricorn) … portal 6 = northernmost (summer, Cancer)
      const d0 = SC.ENOCH_B[k], d1 = SC.ENOCH_B[k + 1], pos = [], idx = [], N = 256;
      for (let i = 0; i <= N; i++) for (const d of [d0, d1]) { const p = latLonToXZ(d, i / N * 360 - 180, lumAlt(d)); pos.push(p.x, p.y, p.z); }
      for (let i = 0; i < N; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cols[k], transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ring = scSunRing((d0 + d1) / 2, 0xe8eeff, 0.9); ring.position.y = 0.04; ring.visible = false;
      g.add(mesh, ring);
      SC.portals.push({ mesh, ring, d0, d1, label: latLonToXZ((d0 + d1) / 2, 180, lumAlt((d0 + d1) / 2) + 0.15) });
    }
  };
  SC.buildPortals();
  SC.winds = [];
  for (let i = 0; i < 12; i++) { const lon = i * 30 + 15, p = scAt(lon, ICE_OUT + 0.05, 0); scArch(g, p, 0.32, 0x9fd0ff); SC.winds.push(p.clone().setY(0.8)); }
  // seven mountains of precious stones at the southern edge (Enoch 18:6–9): three each side, the middle one tallest
  const stones = [0xe0115f, 0x50c878, 0x0f52ba, 0xffd700, 0x9966cc, 0x40e0d0, 0xfffff0];
  for (let i = -3; i <= 3; i++) {
    const h = i === 0 ? 2.6 : 1.1 - Math.abs(i) * 0.15, m = new THREE.Mesh(new THREE.ConeGeometry(0.32, h, 6), new THREE.MeshStandardMaterial({ color: stones[i + 3], metalness: 0.3, roughness: 0.2, emissive: stones[i + 3], emissiveIntensity: 0.35, flatShading: true }));
    m.position.copy(scAt(35 + i * 4.5, R - 0.35, h / 2)); g.add(m);
  }
  SC.sevenMtn = scAt(35, R - 0.35, 2.9);
}
// ======================= Quran =======================
{
  const g = SC.groups.quran;
  const hue = [0x2f5fd0, 0x3f56d8, 0x5a4fd8, 0x7348d0, 0x8a43c4, 0x9f40b4, 0xb03fa0];
  SC.heavens = [];
  for (let k = 1; k < 7; k++) {   // the first heaven is the firmament already drawn
    const r = FIRM_R + k * 0.85;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2), scShellMat(hue[k], 0xc9b8ff, 0.16 - k * 0.012, false));
    m.renderOrder = 6 + k; g.add(m); SC.heavens.push(r);
  }
  const top = FIRM_R + 6 * 0.85;
  const arsh = scGlow('rgba(255,230,160,0.9)', 4.5); arsh.position.set(0, top + 1.1, 0); g.add(arsh); SC.arsh = arsh.position;
  const kursi = new THREE.Mesh(new THREE.SphereGeometry(top + 2.2, 96, 48), scShellMat(0x1a1030, 0xffe6a8, 0.06, false)); kursi.renderOrder = 14; g.add(kursi);
  SC.kursi = new THREE.Vector3(-(top + 2.2) * 0.7, (top + 2.2) * 0.7, 0);
  // seven earths (65:12): six more beneath this one
  SC.earths = [];
  for (let k = 1; k < 7; k++) {
    const y = -1.9 - (k - 1) * 0.7, r = Math.min(9, Math.sqrt(FIRM_R * FIRM_R - y * y) - 0.3);
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 128), new THREE.MeshBasicMaterial({ color: 0x6b5a3a, transparent: true, opacity: 0.22 - k * 0.02, side: THREE.DoubleSide, depthWrite: false }));
    d.rotation.x = -Math.PI / 2; d.position.y = y; g.add(d);
    const rim = scUnitCircle(0xc8a86a, 0.5); rim.scale.set(r, 1, r); rim.position.y = y; g.add(rim); SC.earths.push(new THREE.Vector3(r * 0.7, y, r * 0.7));
  }
  const PEAKS = [['Everest', 27.988, 86.925], ['K2', 35.881, 76.513], ['Aconcagua', -32.653, -70.011], ['Denali', 63.069, -151.007], ['Kilimanjaro', -3.066, 37.355],
    ['Elbrus', 43.355, 42.439], ['Mont Blanc', 45.833, 6.865], ['Puncak Jaya', -4.078, 137.158], ['Vinson', -78.525, -85.617], ['Ararat', 39.702, 44.298]];
  const pegMat = new THREE.MeshStandardMaterial({ color: 0xe6c27a, metalness: 0.4, roughness: 0.45, emissive: 0x3a2a08, emissiveIntensity: 0.7 });
  SC.pegs = PEAKS.map(([name, lat, lon]) => {
    const p = latLonToXZ(lat, lon, 0), h = 2.6;
    const peg = new THREE.Mesh(new THREE.ConeGeometry(0.12, h, 16), pegMat); peg.rotation.x = Math.PI; peg.position.set(p.x, -h / 2 + 0.02, p.z); g.add(peg);
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 32), pegMat); head.rotation.x = Math.PI / 2; head.position.set(p.x, 0.04, p.z); g.add(head);
    return { name, pos: new THREE.Vector3(p.x, 0.12, p.z) };
  });
  SC.live.qSun = scUnitCircle(0xffd56b); SC.live.qMoon = scUnitCircle(0xcfe0ff); g.add(SC.live.qSun, SC.live.qMoon);
}
// ======================= Hindu Puranas =======================
{
  const g = SC.groups.purana;
  const Y = SUN_H / 100000, mH = 84000 * Y;
  const meru = new THREE.Mesh(new THREE.CylinderGeometry(16000 * Y, 8000 * Y, mH, 48, 1), new THREE.MeshStandardMaterial({ color: 0xffd36a, metalness: 0.55, roughness: 0.35, emissive: 0xb07a10, emissiveIntensity: 0.9 }));
  meru.position.y = mH / 2; g.add(meru);
  const crown = scGlow('rgba(255,215,120,0.9)', 1.4); crown.position.y = mH + 0.05; g.add(crown);
  SC.meruTop = new THREE.Vector3(0, mH, 0);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 12), new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(axle); SC.live.axle = axle;
  // the sun chariot's wheel: rim = the Sun's circle, 12 spokes (months), turning with the Sun
  const rim = scUnitCircle(0xffc860, 0.8); g.add(rim); SC.live.wheelRim = rim;
  const spokes = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.55 }));
  spokes.frustumCulled = false; g.add(spokes); SC.live.spokes = spokes;
  const dhruva = scGlow('rgba(220,240,255,1)', 1.3); dhruva.position.set(0, DOME_H * 0.975, 0); g.add(dhruva);
  // heights of the luminaries (5.22): rings on the axis; above the Sun the scale is compressed so Dhruva sits at the dome's top
  const hY = (yoj) => SUN_H + (yoj - 100000) / 3700000 * (DOME_H * 0.975 - SUN_H);
  SC.levels = [['Moon', 200000, 0xcfe0ff], ['Lunar mansions (28 stars)', 400000, 0xa8c8ff], ['Venus', 600000, 0xfff2c8], ['Mercury', 800000, 0xc8ffd8], ['Mars', 1000000, 0xff9a7a], ['Jupiter', 1200000, 0xffe08a], ['Saturn', 1400000, 0xd8c8a8], ['Seven Sages', 2500000, 0xe0d0ff]].map(([n, yoj, col]) => {
    const y = hY(yoj), r = 0.45 * Math.sqrt(Math.max(0.1, FIRM_R * FIRM_R - y * y)), l = scUnitCircle(col, 0.7); l.scale.set(r, 1, r); l.position.y = y; g.add(l);
    return { n: `${n} · ${(yoj / 1000).toLocaleString()}k yojanas`, pos: new THREE.Vector3(r, y + 0.05, 0) };
  });
  // the four guardians' cities, with India due south of Meru
  SC.cities = [['Devadhānī · Indra (east)', SC_INDIA + 90], ['Saṃyamanī · Yama (south)', SC_INDIA], ['Nimlocanī · Varuṇa (west)', SC_INDIA - 90], ['Vibhāvarī · Soma (north)', SC_INDIA + 180]].map(([n, lon]) => {
    const p = scAt(lon, FIRM_R - 0.8, 0); const c = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffd36a, metalness: 0.6, roughness: 0.3, emissive: 0x8a5a00, emissiveIntensity: 0.6 }));
    c.position.copy(p); g.add(c); return { n, pos: p.clone().setY(0.5) };
  });
  const lok = new THREE.Mesh(new THREE.CylinderGeometry(ICE_OUT + 0.18, ICE_OUT + 0.3, 1.6, 240, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.85, emissive: 0x2a1a06, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
  lok.position.y = 0.4; g.add(lok);
  SC.lokPos = new THREE.Vector3(0, 1.3, -(ICE_OUT + 0.25));
}
// ======================= Buddhist (Abhidharmakośa) =======================
{
  const g = SC.groups.buddhist;
  // In yojanas from the centre: Sumeru (half-width 40,000), then sea and ring in turn, each ring half the one before; outer ocean 322,000; Cakravāla 312.5.
  let x = 40000; const rings = []; let w = 40000, sea = 80000;
  for (let k = 0; k < 7; k++) { x += sea; rings.push({ r0: x, r1: x + w, h: w }); x += w; sea = w; w /= 2; }
  const edge = x + 322000 + 312.5, B = ICE_OUT / edge;   // units per yojana: the iron ring meets the map's rim
  SC.bScale = B;
  const H = 80000 * B, half = 40000 * B;
  const mats = [0x2a5cd0, 0xf2c14e, 0xf2c14e, 0x222222, 0xdff4ff, 0xd8dde6].map((c, i) => new THREE.MeshStandardMaterial({ color: c, metalness: i === 4 ? 0.1 : 0.6, roughness: 0.3, transparent: true, opacity: i === 4 ? 0.45 : 0.7, emissive: c, emissiveIntensity: 0.25 }));
  const su = new THREE.Mesh(new THREE.BoxGeometry(2 * half, H, 2 * half), mats);   // +x lapis (south, toward India), -x gold (north), +z crystal (west), -z silver (east)
  su.position.y = H / 2; su.rotation.y = deg(SC_INDIA); g.add(su); SC.sumeru = new THREE.Vector3(0, H + 0.1, 0);
  const names = ['Yugandhara', 'Īṣādhara', 'Khadiraka', 'Sudarśana', 'Aśvakarṇa', 'Vinataka', 'Nimindhara'];
  SC.bRings = rings.map((q, k) => {
    const r = (q.r0 + q.r1) / 2 * B, h = Math.max(0.02, q.h * B), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 160, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 0.7, roughness: 0.35, emissive: 0x6a4a08, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
    m.position.y = h / 2; g.add(m); return { n: names[k], pos: new THREE.Vector3(0, h + 0.08, -r) };
  });
  const cak = new THREE.Mesh(new THREE.CylinderGeometry(ICE_OUT + 0.06, ICE_OUT + 0.06, 0.5, 240, 1, true), new THREE.MeshStandardMaterial({ color: 0x5a5e66, metalness: 0.9, roughness: 0.4, side: THREE.DoubleSide }));
  cak.position.y = 0.25; g.add(cak); SC.cak = new THREE.Vector3(ICE_OUT * 0.7, 0.7, ICE_OUT * 0.7);
  SC.live.bSun = scUnitCircle(0xffd56b, 0.8); SC.live.bSun.position.y = half; g.add(SC.live.bSun); SC.bSunY = half;
  // four continents (enlarged), India due south
  const rc = (x + 161000) * B, shape = (pts) => { const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))); return s; };
  const S = 0.55, cont = [
    ['Jambudvīpa (south)', SC_INDIA, shape([[-S, -S * 0.15], [S, -S * 0.15], [S * 0.12, S * 0.9], [-S * 0.12, S * 0.9]])],
    ['Pūrvavideha (east)', SC_INDIA + 90, (() => { const s = new THREE.Shape(); s.absarc(0, 0, S * 0.8, 0, Math.PI, false); s.lineTo(S * 0.8, 0); return s; })()],
    ['Aparagodānīya (west)', SC_INDIA - 90, (() => { const s = new THREE.Shape(); s.absarc(0, 0, S * 0.7, 0, Math.PI * 2, false); return s; })()],
    ['Uttarakuru (north)', SC_INDIA + 180, shape([[-S * 0.7, -S * 0.7], [S * 0.7, -S * 0.7], [S * 0.7, S * 0.7], [-S * 0.7, S * 0.7]])],
  ];
  SC.conts = cont.map(([n, lon, s]) => {
    const p = scAt(lon, rc, 0.06), m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: 0x8ee08e, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = deg(lon) + Math.PI / 2; m.position.copy(p); g.add(m); return { n, pos: p.clone().setY(0.3) };
  });
}
// ======================= Jain =======================
{
  const g = SC.groups.jain;
  const s2 = scGlow('rgba(255,214,110,1)', 1.1), m2 = scGlow('rgba(220,230,255,1)', 0.85); g.add(s2, m2); SC.live.sun2 = s2; SC.live.moon2 = m2;
  SC.buildJain = () => {
    if (SC.jainLines) { g.remove(SC.jainLines); SC.jainLines.geometry.dispose(); }
    const pts = [];
    for (let k = 0; k < 184; k++) { const dec = 23.44 - k * 46.88 / 183; for (let i = 0; i < 96; i++) { const a = latLonToXZ(dec, i / 96 * 360, lumAlt(dec)), b = latLonToXZ(dec, (i + 1) / 96 * 360, lumAlt(dec)); pts.push(a, b); } }
    SC.jainLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.08 }));
    g.add(SC.jainLines);
  };
  SC.buildJain();
  SC.live.jainNow = scUnitCircle(0xffe08a, 0.95); g.add(SC.live.jainNow);
}
// ======================= Zoroastrian =======================
{
  const g = SC.groups.zoro;
  const hara = new THREE.Mesh(new THREE.CylinderGeometry(ICE_OUT + 0.55, ICE_OUT + 0.8, 1.4, 240, 6, true), new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 0.95, emissive: 0x1a120a, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  { const p = hara.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.3) p.setY(i, p.getY(i) + 0.25 * Math.sin(p.getX(i) * 3.1) * Math.cos(p.getZ(i) * 2.7)); hara.geometry.computeVertexNormals(); }
  hara.position.y = 0.55; g.add(hara); SC.hara = new THREE.Vector3(0, 1.6, ICE_OUT + 0.7);
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.45, SUN_H * 0.45, 7), new THREE.MeshStandardMaterial({ color: 0x7a6a5a, roughness: 0.9, flatShading: true, emissive: 0x2a1a0a, emissiveIntensity: 0.4 }));
  peak.position.y = SUN_H * 0.225; g.add(peak); SC.tera = new THREE.Vector3(0, SUN_H * 0.47, 0);
  SC.stations = [['Star station', SUN_H * 0.45, 0xbfd8ff], ['Moon station', SUN_H * 0.72, 0xe0e8ff], ['Sun station', SUN_H, 0xffd56b]].map(([n, y, col]) => {
    const r = Math.sqrt(FIRM_R * FIRM_R - y * y) * 0.92, d = new THREE.Mesh(new THREE.RingGeometry(r * 0.15, r, 128), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    d.rotation.x = -Math.PI / 2; d.position.y = y; g.add(d); const l = scUnitCircle(col, 0.6); l.scale.set(r, 1, r); l.position.y = y; g.add(l);
    return { n, pos: new THREE.Vector3(-r * 0.75, y + 0.05, 0) };
  });
  const light = scGlow('rgba(255,255,235,0.95)', 5); light.position.set(0, DOME_H + 0.6, 0); g.add(light); SC.endless = light.position;
}
// ======================= Norse =======================
{
  const g = SC.groups.norse;
  const rD = FIRM_R - 0.4, yD = domeY(rD);
  const dwMat = new THREE.MeshStandardMaterial({ color: 0x9a7a5a, roughness: 0.8, emissive: 0x2a1a0a, emissiveIntensity: 0.5 });
  SC.dwarves = ['Norðri', 'Austri', 'Suðri', 'Vestri'].map((n, i) => {
    const p = scAt(i * 90 + 45, rD, 0), grp = new THREE.Group(); grp.position.copy(p);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.7, 12), dwMat); body.position.y = yD - 0.75; grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), dwMat); head.position.y = yD - 0.27; grp.add(head);
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 8), dwMat); arm.position.set(s * 0.17, yD - 0.2, 0); arm.rotation.z = -s * 0.35; grp.add(arm); }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, yD - 1.1, 8), dwMat); col.position.y = (yD - 1.1) / 2; grp.add(col);
    g.add(grp); return { n: `${n} holds the sky`, pos: p.clone().setY(yD + 0.15) };
  });
  // Jörmungandr: a serpent round the world-ocean, biting its tail
  const pts = []; for (let i = 0; i <= 400; i++) { const a = i / 400 * Math.PI * 2 * 1.02, r = ICE_OUT + 0.4 + 0.07 * Math.sin(a * 13); pts.push(new THREE.Vector3(r * Math.cos(a), 0.05 + 0.12 * Math.sin(a * 9), -r * Math.sin(a))); }
  const curve = new THREE.CatmullRomCurve3(pts, false);
  const tube = new THREE.TubeGeometry(curve, 800, 0.11, 10, false);
  const serp = new THREE.Mesh(tube, new THREE.MeshStandardMaterial({ color: 0x2e7a4a, roughness: 0.5, metalness: 0.3, emissive: 0x0a3a1a, emissiveIntensity: 0.6 })); g.add(serp);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 12), serp.material); head.position.copy(pts[400]); head.lookAt(pts[396]); head.rotateX(-Math.PI / 2); g.add(head);
  SC.serpent = pts[200].clone().setY(0.6);
  SC.live.skoll = scGlow('rgba(255,90,40,0.95)', 0.8); SC.live.hati = scGlow('rgba(160,60,40,0.95)', 0.7); g.add(SC.live.skoll, SC.live.hati);
  // Yggdrasil
  const bark = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9, emissive: 0x1a0e04, emissiveIntensity: 0.6 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.32, 6.5, 16), bark); trunk.position.y = 0.75; g.add(trunk);
  const branch = [], root = [];
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; branch.push(new THREE.Vector3(0, 3.2, 0), new THREE.Vector3(2.8 * Math.cos(a), 4.6 + (i % 3) * 0.4, -2.8 * Math.sin(a))); }
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.4; root.push(new THREE.Vector3(0, -2.4, 0), new THREE.Vector3(2.2 * Math.cos(a), -3.4, -2.2 * Math.sin(a))); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(branch), new THREE.LineBasicMaterial({ color: 0x9ad07a, transparent: true, opacity: 0.8 })));
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(root), new THREE.LineBasicMaterial({ color: 0xb08a5a, transparent: true, opacity: 0.8 })));
  const crown = scGlow('rgba(140,220,120,0.55)', 6); crown.position.y = 4.6; g.add(crown); SC.ygg = new THREE.Vector3(0, 5.2, 0);
  // Bifröst: from Iceland up into the sky
  const b0 = latLonToXZ(64.1, -21.9, 0), b1 = new THREE.Vector3(0, DOME_H * 0.85, 0), bc = b0.clone().multiplyScalar(0.7).setY(DOME_H * 1.05);
  [0xff4a4a, 0xff9a3a, 0xffe14a, 0x5ae05a, 0x4aa8ff, 0x7a5aff].forEach((c, i) => {
    const off = new THREE.Vector3(0, 0, 0).add(scDir(-21.9 + 90).multiplyScalar((i - 2.5) * 0.06));
    const cur = new THREE.QuadraticBezierCurve3(b0.clone().add(off), bc.clone().add(off), b1.clone().add(off));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cur.getPoints(80)), new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.85 })));
  });
  SC.bifrost = new THREE.QuadraticBezierCurve3(b0, bc, b1).getPoint(0.35);
}
// ======================= Ancient Egyptian =======================
{
  const g = SC.groups.egypt;
  const d = scDir(SC_EGYPT + 90), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3().crossVectors(d, up).normalize();   // Nut lies along Egypt's east–west line
  const Rn = FIRM_R * 0.985, pos = [], idx = [], N = 120, W = 1.1;
  for (let i = 0; i <= N; i++) { const f = i / N * Math.PI; for (const s of [-W, W]) { const c = d.clone().multiplyScalar(Math.cos(f) * Rn).addScaledVector(up, Math.sin(f) * Rn).addScaledVector(n, s); pos.push(c.x, c.y, c.z); } }
  for (let i = 0; i < N; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a2a7a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })));
  const st = []; for (let i = 0; i < 260; i++) { const f = Math.random() * Math.PI, s = (Math.random() * 2 - 1) * W; st.push(d.clone().multiplyScalar(Math.cos(f) * (Rn - 0.02)).addScaledVector(up, Math.sin(f) * (Rn - 0.02)).addScaledVector(n, s)); }
  g.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(st), new THREE.PointsMaterial({ color: 0xffe9a8, size: 0.09, map: DOT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  SC.nut = up.clone().multiplyScalar(Rn + 0.3);
  const shu = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.18, Rn - 0.1, 16), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  shu.position.y = (Rn - 0.1) / 2; g.add(shu); SC.shu = new THREE.Vector3(0.25, Rn * 0.5, 0);
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 32, Math.PI), new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.6, roughness: 0.35, emissive: 0x6a4a10, emissiveIntensity: 0.6 }));
  hull.rotation.z = Math.PI; boat.add(hull); g.add(boat); SC.live.boat = boat;
  const duat = []; for (let i = 0; i <= 80; i++) { const f = Math.PI + i / 80 * Math.PI; duat.push(d.clone().multiplyScalar(Math.cos(f) * (FIRM_R - 0.6)).addScaledVector(up, Math.sin(f) * (FIRM_R * 0.55))); }
  const dl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(duat), new THREE.LineDashedMaterial({ color: 0xffb648, dashSize: 0.25, gapSize: 0.15 })); dl.computeLineDistances(); g.add(dl);
  SC.duat = duat[40].clone();
}
// ======================= Mesopotamian =======================
{
  const g = SC.groups.meso;
  const bar = new THREE.Mesh(new THREE.TorusGeometry(FIRM_R - 0.05, 0.08, 10, 240), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.85, roughness: 0.35, emissive: 0x3a2008, emissiveIntensity: 0.5 }));
  bar.rotation.x = Math.PI / 2; bar.position.y = 0.3; g.add(bar); SC.bar = scAt(200, FIRM_R - 0.05, 0.6);
  for (let i = 0; i < 8; i++) { const s = scGlow('rgba(255,170,80,0.95)', 0.6); s.position.copy(scAt(i * 45 + 22.5, FIRM_R - 0.05, 0.55)); g.add(s); }
  SC.gates = [['East gate', SC_BABYLON + 90], ['West gate', SC_BABYLON - 90]].map(([nm, lon]) => { const p = scAt(lon, FIRM_R - 0.35, 0); scArch(g, p, 0.85, 0xc8a050); return { n: nm, pos: p.clone().setY(2.0) }; });
  const sky = new THREE.Group(); g.add(sky); SC.live.mesoSky = sky;
  SC.mesoStars = [];
  [['Path of Enlil', 30, 0x9ad0ff], ['Path of Anu', 0, 0xffe08a], ['Path of Ea', -30, 0x8af0c0]].forEach(([nm, dec, col], b) => {
    for (let m = 0; m < 12; m++) {
      const s = scGlow(`#${col.toString(16).padStart(6, '0')}`, 0.55); skyPos(m * 30 + b * 10, dec, 0.97, s.position); sky.add(s);
      if (m === 0) SC.mesoStars.push({ n: `${nm} (12 stars)`, obj: s });
    }
  });
}
// ======================= Chinese (Gaitian) =======================
{
  const g = SC.groups.china;
  const a = 7.2, seg = [];
  for (let i = 0; i <= 8; i++) { const t = -a + i * a / 4; seg.push(new THREE.Vector3(-a, 0.03, t), new THREE.Vector3(a, 0.03, t), new THREE.Vector3(t, 0.03, -a), new THREE.Vector3(t, 0.03, a)); }
  const sq = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0xe0c070, transparent: true, opacity: 0.5 })); g.add(sq); SC.square = new THREE.Vector3(a, 0.2, a);
  const ribs = []; for (let k = 0; k < 28; k++) { const th = k / 28 * Math.PI * 2; for (let i = 0; i < 40; i++) { for (const j of [i, i + 1]) { const r = j / 40 * (FIRM_R - 0.05); ribs.push(new THREE.Vector3(r * Math.cos(th), domeY(r) * 0.995, -r * Math.sin(th))); } } }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ribs), new THREE.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.35 })));
  SC.canopy = new THREE.Vector3(FIRM_R * 0.5, domeY(FIRM_R * 0.5), 0);
  SC.buildHeng = () => {
    (SC.heng || []).forEach((l) => { g.remove(l); l.geometry.dispose(); });
    SC.heng = Array.from({ length: 7 }, (_, k) => { const l = scSunRing(23.44 - k * 46.88 / 6, 0xff8a6a, 0.55); g.add(l); return l; });
  };
  SC.buildHeng();
}
// ======================= Freemasonry (symbolism of the lodge) =======================
// The lodge is laid out along London's east–west line (the first Grand Lodge, 1717): East = Master, West = Senior Warden,
// South = Junior Warden; north points to the centre of this map.
{
  const g = SC.groups.mason;
  const LON = -0.13, E = scDir(LON + 90), S = scDir(LON), L = 7.6, W = 3.8;   // east, south (out to the rim); half-length, half-breadth
  const P = (e, s, y = 0) => new THREE.Vector3().addScaledVector(E, e).addScaledVector(S, s).setY(y);
  // mosaic pavement inside the oblong square, with the indented tessel round it
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const cx = cv.getContext('2d');
  for (let i = 0; i < 32; i++) for (let j = 0; j < 16; j++) { cx.fillStyle = (i + j) % 2 ? '#f4f1e8' : '#14161c'; cx.fillRect(i * 16, j * 16, 16, 16); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(2 * L, 2 * W), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  pave.rotation.x = -Math.PI / 2; pave.rotation.z = Math.atan2(-E.z, E.x); pave.position.y = 0.035; g.add(pave);
  const frame = [P(L, W, 0.05), P(L, -W, 0.05), P(-L, -W, 0.05), P(-L, W, 0.05), P(L, W, 0.05)];
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(frame), new THREE.LineBasicMaterial({ color: 0xe8c66a })));
  const teeth = [];
  const edge = (a, b, n) => { for (let i = 0; i < n; i++) { const p0 = a.clone().lerp(b, i / n), p1 = a.clone().lerp(b, (i + 1) / n), mid = p0.clone().lerp(p1, 0.5), inward = new THREE.Vector3(-mid.x, 0, -mid.z).normalize().multiplyScalar(0.22); teeth.push(p0, mid.clone().add(inward), mid.clone().add(inward), p1); } };
  edge(frame[0], frame[1], 20); edge(frame[1], frame[2], 40); edge(frame[2], frame[3], 20); edge(frame[3], frame[4], 40);
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(teeth), new THREE.LineBasicMaterial({ color: 0xe8c66a, transparent: true, opacity: 0.8 })));
  // the three great pillars
  const stone = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.5, emissive: 0x2a2418, emissiveIntensity: 0.5 });
  const column = (pos, kind) => {
    const c = new THREE.Group(); c.position.copy(pos); const h = 2.2;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, h, 24), stone); shaft.position.y = h / 2; c.add(shaft);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), stone); base.position.y = 0.06; c.add(base);
    if (kind === 'doric') { const cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.46), stone); cap.position.y = h + 0.06; c.add(cap); }
    if (kind === 'ionic') { for (const s of [-1, 1]) { const v = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 20), stone); v.position.set(s * 0.2, h + 0.02, 0); c.add(v); } const ab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.3), stone); ab.position.y = h + 0.12; c.add(ab); }
    if (kind === 'corinthian') { const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.17, 0.32, 16), new THREE.MeshStandardMaterial({ color: 0xd9c27a, metalness: 0.4, roughness: 0.4 })); bell.position.y = h + 0.16; c.add(bell); }
    c.lookAt(0, 0, 0); g.add(c); return pos.clone().setY(2.75);
  };
  SC.mPillars = [['Wisdom · Ionic · East (Master)', column(P(L - 0.6, 0), 'ionic')], ['Strength · Doric · West (Senior Warden)', column(P(-L + 0.6, 0), 'doric')], ['Beauty · Corinthian · South (Junior Warden)', column(P(0, W - 0.6), 'corinthian')]];
  // three lesser lights beside them
  for (const p of [P(L - 1.1, 0.5, 0.5), P(-L + 1.1, 0.5, 0.5), P(0.5, W - 1.1, 0.5)]) { const s = scGlow('rgba(255,210,120,0.95)', 0.6); s.position.copy(p); g.add(s); }
  // Boaz (north) and Jachin (south) at the western entrance, with globes
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb8863b, metalness: 0.8, roughness: 0.3, emissive: 0x3a2408, emissiveIntensity: 0.4 });
  const twin = (pos, globe) => {
    const h = 2.8, c = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, h, 24), bronze); c.position.copy(pos).setY(h / 2); g.add(c);
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.3, 24), bronze); ch.position.copy(pos).setY(h + 0.15); g.add(ch);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.32, 32, 16), globe); gl.position.copy(pos).setY(h + 0.62); g.add(gl); return pos.clone().setY(h + 1.15);
  };
  SC.mBoaz = twin(P(-L - 0.5, -1.3), new THREE.MeshStandardMaterial({ color: 0x1a3a8a, metalness: 0.3, roughness: 0.4, emissive: 0x2a4aa0, emissiveIntensity: 0.6 }));
  SC.mJachin = twin(P(-L - 0.5, 1.3), new THREE.MeshStandardMaterial({ color: 0x3a8a5a, metalness: 0.2, roughness: 0.6, emissive: 0x1a4a2a, emissiveIntensity: 0.5 }));
  // the altar with the Volume of the Sacred Law, square and compasses
  const altar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), stone); altar.position.y = 0.225; g.add(altar);
  const sqc = [new THREE.Vector3(-0.22, 0.47, 0.18), new THREE.Vector3(0, 0.47, -0.05), new THREE.Vector3(0, 0.47, -0.05), new THREE.Vector3(0.22, 0.47, 0.18), new THREE.Vector3(-0.22, 0.47, -0.18), new THREE.Vector3(0, 0.47, 0.05), new THREE.Vector3(0, 0.47, 0.05), new THREE.Vector3(0.22, 0.47, -0.18)];
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(sqc), new THREE.LineBasicMaterial({ color: 0xffd36a })));
  // the blazing star with the letter G, over the centre of the pavement
  const sc = document.createElement('canvas'); sc.width = sc.height = 256; const sx = sc.getContext('2d');
  sx.translate(128, 128); sx.fillStyle = '#ffd86a'; sx.beginPath();
  for (let i = 0; i < 14; i++) { const r = i % 2 ? 46 : 118, a = i / 14 * Math.PI * 2 - Math.PI / 2; sx.lineTo(r * Math.cos(a), r * Math.sin(a)); }
  sx.closePath(); sx.fill(); sx.fillStyle = '#3a2400'; sx.font = 'bold 80px Georgia, serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillText('G', 0, 6);
  const starTex = new THREE.CanvasTexture(sc); starTex.colorSpace = THREE.SRGBColorSpace;
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false })); star.scale.setScalar(0.9); star.position.y = 1.4; g.add(star);
  const halo = scGlow('rgba(255,220,120,0.6)', 2.2); halo.position.y = 1.4; g.add(halo); SC.mStar = new THREE.Vector3(0, 1.95, 0);
  // the covering: a clouded canopy, a starry-decked heaven of many colours
  const CAN_R = FIRM_R + 0.35;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(CAN_R, 128, 48, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: SC.time },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; uniform float uTime;
      vec3 hsv(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        float ang = atan(vP.z, vP.x) / 6.2831853 + 0.5, el = vP.y / ${CAN_R.toFixed(3)};
        vec3 col = hsv(fract(ang + el * 0.35 + uTime * 0.01)) * 0.55;
        vec2 gp = vec2(ang * 1400.0, el * 260.0), cell = floor(gp), f = fract(gp) - 0.5; float st = step(0.985, hash(cell)) * smoothstep(0.45, 0.05, length(f)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(cell + 3.1) * 40.0));
        float fres = pow(1.0 - abs(dot(vN, vV)), 1.6);
        gl_FragColor = vec4(col * (0.10 + fres * 0.35) + vec3(1.0, 0.92, 0.7) * st, 1.0);
      }`,
  }));
  canopy.renderOrder = 7; g.add(canopy); SC.mCanopy = new THREE.Vector3(CAN_R * 0.62, CAN_R * 0.78, 0);
  // Jacob's ladder from the altar to the canopy, with three principal rounds
  const top = new THREE.Vector3().addScaledVector(E, 2.2).setY(CAN_R * 0.93), bot = new THREE.Vector3(0, 0.5, 0), side = new THREE.Vector3().crossVectors(top.clone().sub(bot), new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.18);
  const lad = [bot.clone().add(side), top.clone().add(side), bot.clone().sub(side), top.clone().sub(side)];
  for (let i = 1; i < 24; i++) { const p = bot.clone().lerp(top, i / 24); lad.push(p.clone().add(side), p.clone().sub(side)); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lad), new THREE.LineBasicMaterial({ color: 0xf2e2b0, transparent: true, opacity: 0.85 })));
  SC.mRounds = ['Faith', 'Hope', 'Charity'].map((n, i) => { const p = bot.clone().lerp(top, (i + 1) / 4); const s = scGlow('rgba(255,235,170,0.95)', 0.55); s.position.copy(p); g.add(s); return { n, pos: p.clone().add(side.clone().multiplyScalar(2.2)) }; });
  // the All-Seeing Eye at the top of the canopy
  const ec = document.createElement('canvas'); ec.width = 256; ec.height = 256; const ex = ec.getContext('2d');
  ex.translate(128, 128); ex.fillStyle = 'rgba(255,220,130,0.95)'; ex.beginPath(); ex.moveTo(0, -105); ex.lineTo(110, 85); ex.lineTo(-110, 85); ex.closePath(); ex.fill();
  ex.fillStyle = '#fff8e6'; ex.beginPath(); ex.ellipse(0, 25, 58, 30, 0, 0, Math.PI * 2); ex.fill(); ex.fillStyle = '#2a4a8a'; ex.beginPath(); ex.arc(0, 25, 20, 0, Math.PI * 2); ex.fill(); ex.fillStyle = '#000'; ex.beginPath(); ex.arc(0, 25, 9, 0, Math.PI * 2); ex.fill();
  const eyeTex = new THREE.CanvasTexture(ec); eyeTex.colorSpace = THREE.SRGBColorSpace;
  const eye = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTex, transparent: true, depthWrite: false })); eye.scale.setScalar(1.6); eye.position.y = CAN_R + 0.9; g.add(eye);
  const eyeGlow = scGlow('rgba(255,225,150,0.6)', 3.4); eyeGlow.position.y = CAN_R + 0.9; g.add(eyeGlow); SC.mEye = new THREE.Vector3(0, CAN_R + 1.8, 0);
  // point within a circle between two parallel lines (astronomical reading): the two solstice circles, today's Sun circle, the point at the centre
  for (const dec of [23.44, -23.44]) { const l = scSunRing(dec, 0xffd36a, 0.9); l.position.y = 0; g.add(l); }
  SC.live.mSun = scUnitCircle(0xffffff, 0.9); g.add(SC.live.mSun);
  const pt = scGlow('rgba(255,255,255,1)', 0.5); pt.position.y = 0.06; g.add(pt);
  SC.mPoint = latLonToXZ(23.44, LON + 180, lumAlt(23.44) + 0.25);
  SC.mEast = P(L + 0.3, 0, 0.4); SC.mWest = P(-L - 0.3, 0, 0.4); SC.mSouth = P(0, W + 0.3, 0.4);
}
// ======================= Santos Bonacci (Syncretism / astrotheology) =======================
// A modern teacher, not a scripture. Only ideas that published summaries attribute to him are drawn (see SCRIPTURE.bonacci).
{
  const g = SC.groups.bonacci;
  // stars as openings in the firmament: pinholes of light in the dome, turning with the star wheel
  const holes = new THREE.Group(); g.add(holes); SC.live.holes = holes;
  { const pts = [], v = new THREE.Vector3(); for (let i = 0; i < 900; i++) { skyPos(Math.random() * 360, 90 - 180 * Math.sqrt(Math.random()) * 0.98, 0.998, v); pts.push(v.clone()); }
    holes.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: 0xfff6e0, size: 0.12, map: DOT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))); }
  SC.bHoles = new THREE.Vector3(-FIRM_R * 0.6, FIRM_R * 0.78, 0);
  // Mount Meru at the North Pole: luminous, magnetic, invisible
  const meru = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  meru.position.y = 1.3; g.add(meru);
  const meruEdges = new THREE.LineSegments(new THREE.EdgesGeometry(meru.geometry), new THREE.LineBasicMaterial({ color: 0xd8c0ff, transparent: true, opacity: 0.6 })); meruEdges.position.y = 1.3; g.add(meruEdges);
  const meruGlow = scGlow('rgba(200,170,255,0.7)', 1.6); meruGlow.position.y = 2.7; g.add(meruGlow); SC.bMeru = new THREE.Vector3(0, 3.0, 0);
  // the "tabernacle of the Sun": the real Sun's path over a year, one turn a day, breathing out to Capricorn and in to Cancer
  SC.buildBonacci = () => {
    for (const k of ['coil', 'ana']) if (SC[k]) { g.remove(SC[k]); SC[k].geometry.dispose(); }
    const v = new THREE.Vector3(), coil = [], t0 = state.t;
    for (let h = 0; h <= 365 * 24; h += 1) { sampleSun(t0 + h * HOUR, v); coil.push(v.clone()); }
    SC.coil = new THREE.Line(new THREE.BufferGeometry().setFromPoints(coil), new THREE.LineBasicMaterial({ color: 0xffc14a, transparent: true, opacity: 0.09 }));
    g.add(SC.coil);
    // the figure-8 (analemma): the Sun at this same clock time every day of the year, at its own height
    let pts = []; try { pts = analemmaData(); } catch {}
    const a8 = pts.map((q) => latLonToXZ(q.lat, q.lon, lumAlt(q.lat) + 0.02)); if (a8.length) a8.push(a8[0].clone());
    SC.ana = new THREE.Line(new THREE.BufferGeometry().setFromPoints(a8), new THREE.LineBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95 }));
    g.add(SC.ana);
    let K = null; try { K = analemmaKeys(pts); } catch {}
    SC.anaCross = K?.cross ? K.cross.lat : null;
    if (K?.cross) { const q = pts[K.cross.i], q2 = pts[K.cross.i + 1], s = K.cross.s; SC.bCross = latLonToXZ(K.cross.lat, q.lon + s * (q2.lon - q.lon), lumAlt(K.cross.lat) + 0.1); }
    SC.bBuiltAt = t0; SC.bTod = Math.floor(state.t / MIN) % (24 * 60);
  };
  const crossDot = scGlow('rgba(255,255,255,1)', 0.45); g.add(crossDot); SC.live.crossDot = crossDot;
  // the zodiac man: "as above, so below" — each sign rules a part of the body (melothesia), Aries the head to Pisces the feet
  const man = new THREE.Group(); g.add(man); SC.live.man = man;
  const H = 4.4, X = 3.6, base = new THREE.Vector3(-X, 0, 0); man.position.copy(base);   // standing on the disc, off the axis so Meru stays clear
  const M = (x, y) => new THREE.Vector3(x, y * H, 0);
  const body = [M(0, 0.86), M(0, 0.5), M(0, 0.8), M(-0.55, 0.62), M(0, 0.8), M(0.55, 0.62), M(-0.55, 0.62), M(-0.75, 0.42), M(0.55, 0.62), M(0.75, 0.42), M(0, 0.5), M(-0.35, 0.27), M(0, 0.5), M(0.35, 0.27), M(-0.35, 0.27), M(-0.4, 0.04), M(0.35, 0.27), M(0.4, 0.04)];
  man.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(body), new THREE.LineBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.9 })));
  const head = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2; head.push(new THREE.Vector3(0.22 * Math.cos(a), 0.93 * H + 0.22 * Math.sin(a), 0)); }
  man.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(head), new THREE.LineBasicMaterial({ color: 0xffe2a8 })));
  // the spine, with the "Christos" rising up it to the pineal
  man.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([M(0, 0.5), M(0, 0.93)]), new THREE.LineBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.9 })));
  const pineal = scGlow('rgba(160,230,255,1)', 0.35); pineal.position.copy(M(0, 0.93)); man.add(pineal);
  const chrism = scGlow('rgba(160,230,255,1)', 0.3); man.add(chrism); SC.live.chrism = chrism;
  SC.MELO = [['♈ Aries', 'head', 0, 0.95], ['♉ Taurus', 'neck', 0, 0.86], ['♊ Gemini', 'arms, shoulders', 0.5, 0.66], ['♋ Cancer', 'chest', 0, 0.74], ['♌ Leo', 'heart', 0.1, 0.68], ['♍ Virgo', 'belly', 0, 0.6], ['♎ Libra', 'loins', 0, 0.54], ['♏ Scorpio', 'genitals', 0, 0.48], ['♐ Sagittarius', 'thighs', 0.3, 0.38], ['♑ Capricorn', 'knees', 0.37, 0.25], ['♒ Aquarius', 'calves, ankles', 0.39, 0.13], ['♓ Pisces', 'feet', 0.42, 0.03]];
  SC.meloPos = SC.MELO.map(([, , x, y]) => M(x, y));
  const sunPart = scGlow('rgba(255,210,90,1)', 0.7), moonPart = scGlow('rgba(210,225,255,1)', 0.55); man.add(sunPart, moonPart); SC.live.sunPart = sunPart; SC.live.moonPart = moonPart;
  man.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } o.renderOrder = 20; });   // always drawn on top, so the Sun's coil can't hide it
  SC.bManTop = new THREE.Vector3(-X, H + 0.6, 0);
}
// ======================= Bhagavad Gita =======================
{
  const g = SC.groups.gita;
  // the eternal aśvattha (15.1): roots above, branches below — hanging from the top of the firmament toward the earth
  const top = DOME_H * 0.93, mid = 5.2, trunk = [new THREE.Vector3(0, top, 0), new THREE.Vector3(0, mid, 0)], roots = [], branches = [], leaves = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; roots.push(new THREE.Vector3(0, top, 0), new THREE.Vector3(1.6 * Math.cos(a), top + 0.25 + (i % 2) * 0.1, -1.6 * Math.sin(a))); }
  const branch = (p, dir, len, depth) => {   // branches spread downward and outward
    const q = p.clone().addScaledVector(dir, len); branches.push(p, q);
    if (depth === 0) { leaves.push(q); return; }
    for (const s of [-0.5, 0.5]) { const d2 = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), s).add(new THREE.Vector3(0, -0.15, 0)).normalize(); branch(q, d2, len * 0.62, depth - 1); }
  };
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; branch(new THREE.Vector3(0, mid, 0), new THREE.Vector3(Math.cos(a), -0.55, -Math.sin(a)).normalize(), 2.1, 3); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([...trunk, ...roots]), new THREE.LineBasicMaterial({ color: 0xe8c27a })));
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(branches), new THREE.LineBasicMaterial({ color: 0xb8e08a, transparent: true, opacity: 0.85 })));
  g.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(leaves), new THREE.PointsMaterial({ color: 0x8aff9a, size: 0.22, map: DOT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  SC.gRoots = new THREE.Vector3(1.4, top + 0.5, 0); SC.gBranches = leaves[5].clone().setY(leaves[5].y + 0.2);
  // the supreme abode, which neither sun nor moon nor fire illumines (15.6): beyond the firmament
  const abode = scGlow('rgba(200,230,255,0.85)', 5.5); abode.position.set(0, DOME_H + 2.2, 0); g.add(abode); SC.gAbode = new THREE.Vector3(0, DOME_H + 3.0, 0);
  // of peaks I am Meru (10.23)
  const meru = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.2, 24), new THREE.MeshStandardMaterial({ color: 0xffd36a, metalness: 0.6, roughness: 0.3, emissive: 0x8a5a00, emissiveIntensity: 0.7 }));
  meru.position.y = 0.6; g.add(meru); SC.gMeru = new THREE.Vector3(0, 1.4, 0); SC.gMeruMesh = meru;
  // the Sun and Moon as the eyes of the universal form (11.19): halos on the real Sun and Moon
  const eyeS = scGlow('rgba(255,220,120,0.8)', 1.6), eyeM = scGlow('rgba(220,232,255,0.8)', 1.2); g.add(eyeS, eyeM); SC.live.gEyeS = eyeS; SC.live.gEyeM = eyeM;
  // the two paths (8.24–25): today's Sun circle golden in its northern course, smoke-grey in its southern; the Moon's
  // circle bright when waxing, grey when waning; an arrow shows which way the Sun is heading
  SC.live.gSun = scUnitCircle(0xffd56b, 0.85); SC.live.gMoon = scUnitCircle(0xe8eeff, 0.7); g.add(SC.live.gSun, SC.live.gMoon);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.2, 0xffd56b, 0.35, 0.22); g.add(arrow); SC.live.gArrow = arrow;
  // the Moon nourishes the plants (15.13): a cone of soft light from the Moon to the ground under it
  const soma = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(soma); SC.live.soma = soma;
}
// Santos Bonacci layer: seven nested layers inside the dome, outer to inner Saturn, Jupiter, Mars, Sun, Venus, Mercury,
// Moon (the classical "Chaldean order"). Each body is a flat disc stuck to its own layer, in the direction of its real
// position in the sky (right ascension and declination of date), turning with the firmament.
{
  const g = SC.groups.bonacci, sky = new THREE.Group(); g.add(sky); SC.live.bLayers = sky;
  SC.B_LAYERS = [['Saturn', '♄', 0.93, '#d8c48a'], ['Jupiter', '♃', 0.85, '#e8c89a'], ['Mars', '♂', 0.77, '#ff7a52'], ['Sun', '☉', 0.69, '#ffd24a'],
    ['Venus', '♀', 0.61, '#fff3d0'], ['Mercury', '☿', 0.53, '#c9c2b8'], ['Moon', '☾', 0.45, '#e6ecff']].map(([body, glyph, f, css]) => {
    const r = FIRM_R * f, col = new THREE.Color(css);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2), scShellMat(col.clone().multiplyScalar(0.25).getHex(), col.getHex(), 0.07, false));
    shell.renderOrder = 3; sky.add(shell);
    const rim = scUnitCircle(col.getHex(), 0.45); rim.scale.set(r, 1, r); rim.position.y = 0.02; sky.add(rim);
    const disc = new THREE.Group();   // flat: a disc lying in the layer's surface
    disc.add(new THREE.Mesh(new THREE.CircleGeometry(0.34, 48), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false })));
    const edge = scUnitCircle(0xffffff, 0.8, 64); edge.scale.setScalar(0.34); edge.rotation.x = Math.PI / 2; disc.add(edge);
    if (body === 'Saturn') { const ring = scUnitCircle(0xf0e0b0, 0.9, 64); ring.scale.setScalar(0.55); ring.rotation.x = Math.PI / 2; disc.add(ring); }
    if (body === 'Sun') disc.add(scGlow('rgba(255,214,110,0.9)', 1.6));
    if (body === 'Moon') disc.add(scGlow('rgba(220,230,255,0.6)', 1.0));
    sky.add(disc);
    return { body, glyph, r, disc, dir: new THREE.Vector3(0, 1, 0) };
  });
  SC.placeBLayers = () => {
    const time = Astronomy.MakeTime(new Date(state.t)), rot = Astronomy.Rotation_EQJ_EQD(time), v = new THREE.Vector3();
    for (const L of SC.B_LAYERS) {
      const eq = Astronomy.EquatorFromVector(Astronomy.RotateVector(rot, Astronomy.GeoVector(L.body, time, true)));
      skyPos(eq.ra * 15, eq.dec, 1, v).normalize();   // the direction of the body in the sky, as on the dome
      if (v.y < 0.02) { v.y = 0.02; v.normalize(); }   // keep it on the layer's dome (never below the disc)
      L.dir.copy(v); L.disc.position.copy(v).multiplyScalar(L.r); L.disc.lookAt(0, 0, 0);   // flat against the layer
    }
  };
}
const scOn = (k) => SC.sel === 'all' || SC.sel === k;
{ // labels (one per element; hidden with their tradition)
  const L = (text, k, pos) => addLabel(text, 'scripture', typeof pos === 'function' ? pos : () => pos, SC.groups[k]);
  L('Waters above · Gen 1:7', 'bible', SC.watersTop);
  L('Windows of heaven · Gen 7:11', 'bible', SC.windows[0]);
  L('Throne · Ezek 1:26', 'bible', SC.thronePos);
  L('Pillars of heaven · Job 26:11', 'bible', SC.heavenPillar);
  L('Light and darkness · Job 26:10', 'bible', () => SC.termLbl);
  L('Storehouses of snow · Job 38:22', 'bible', SC.stores[1]);
  L('Pillars of the earth · Job 9:6', 'bible', SC.pillarPos);
  L('The great deep · Gen 7:11', 'bible', SC.deepPos);
  L('Four corners · Rev 7:1', 'bible', SC.corners[1]);
  SC.firmNames.forEach((n, k) => L(n, 'talmud', new THREE.Vector3(-SC.firmR[k] * Math.cos(deg(40 + k * 5)), SC.firmR[k] * Math.sin(deg(40 + k * 5)), 0)));
  L('Earth on twelve pillars · Chagigah 12b', 'talmud', new THREE.Vector3(-R * 0.78, -2.6, 0));
  SC.portals.forEach((p, k) => L(`Portal ${k + 1}`, 'enoch', () => SC.portals[k].label));
  L('Portals of the winds · 1 En 76', 'enoch', SC.winds[3]);
  L('Seven mountains · 1 En 18', 'enoch', SC.sevenMtn);
  SC.heavens.forEach((r, k) => L(k === 5 ? 'Seventh heaven · 67:3' : `${['2nd', '3rd', '4th', '5th', '6th'][k]} heaven`, 'quran', new THREE.Vector3(r * Math.cos(deg(62)), r * Math.sin(deg(62)), 0)));
  L('First heaven, adorned with lamps · 67:5', 'quran', new THREE.Vector3(FIRM_R * Math.cos(deg(62)) * -1, FIRM_R * Math.sin(deg(62)), 0));
  L('The Throne · 23:86', 'quran', SC.arsh);
  L('The Kursi · 2:255', 'quran', SC.kursi);
  L('Seven earths · 65:12', 'quran', SC.earths[2]);
  L('Mountains as pegs · 78:7', 'quran', SC.pegs[0].pos);
  L('Mount Meru · BhP 5.16', 'purana', SC.meruTop);
  L('Sun chariot\'s axle · BhP 5.21.13', 'purana', () => SC.axleMid || SC.meruTop);
  L('Dhruva · BhP 5.23', 'purana', new THREE.Vector3(0, DOME_H * 0.975, 0));
  L('Lokāloka mountain · BhP 5.20.34', 'purana', SC.lokPos);
  SC.levels.forEach((l) => L(l.n, 'purana', l.pos));
  SC.cities.forEach((c) => L(c.n, 'purana', c.pos));
  L('Mount Sumeru · AKB 3', 'buddhist', SC.sumeru);
  SC.bRings.forEach((r, k) => { if (k < 3) L(r.n, 'buddhist', r.pos); });
  L('Cakravāla iron ring', 'buddhist', SC.cak);
  L('Sun & moon at half Sumeru', 'buddhist', () => SC.bSunLbl || SC.sumeru);
  SC.conts.forEach((c) => L(c.n, 'buddhist', c.pos));
  L('Second sun · Jain', 'jain', () => SC.live.sun2.position.clone().setY(SC.live.sun2.position.y + 0.4));
  L('Second moon · Jain', 'jain', () => SC.live.moon2.position.clone().setY(SC.live.moon2.position.y + 0.4));
  L('Today\'s circle of 184', 'jain', () => SC.jainLbl || SC.meruTop);
  L('Harā / Alborz', 'zoro', SC.hara);
  L('Tērag, the central peak', 'zoro', SC.tera);
  SC.stations.forEach((s) => L(s.n, 'zoro', s.pos));
  L('Endless Light', 'zoro', SC.endless);
  SC.dwarves.forEach((d) => L(d.n, 'norse', d.pos));
  L('Jörmungandr', 'norse', SC.serpent);
  L('Sköll', 'norse', () => SC.live.skoll.position.clone().setY(SC.live.skoll.position.y + 0.35));
  L('Hati', 'norse', () => SC.live.hati.position.clone().setY(SC.live.hati.position.y + 0.35));
  L('Yggdrasil', 'norse', SC.ygg);
  L('Bifröst', 'norse', SC.bifrost);
  L('Nut, the sky', 'egypt', SC.nut);
  L('Shu', 'egypt', SC.shu);
  L('Barque of Ra', 'egypt', () => SC.live.boat.position.clone().setY(SC.live.boat.position.y + 0.45));
  L('The Duat (night journey)', 'egypt', SC.duat);
  L('Bar of the sky · EE IV.139', 'meso', SC.bar);
  SC.gates.forEach((q) => L(q.n, 'meso', q.pos));
  SC.mesoStars.forEach((s) => L(s.n, 'meso', () => s.obj.getWorldPosition(new THREE.Vector3())));
  L('Celestial canopy', 'mason', SC.mCanopy);
  SC.mPillars.forEach(([n, p]) => L(n, 'mason', p));
  L('Boaz (north) · celestial globe', 'mason', SC.mBoaz);
  L('Jachin (south) · terrestrial globe', 'mason', SC.mJachin);
  L('Blazing star', 'mason', SC.mStar);
  SC.mRounds.forEach((r) => L(r.n, 'mason', r.pos));
  L('All-Seeing Eye', 'mason', SC.mEye);
  L('Point within a circle: the solstice lines', 'mason', SC.mPoint);
  L('East', 'mason', SC.mEast); L('West', 'mason', SC.mWest); L('South', 'mason', SC.mSouth);
  L('Stars: openings in the firmament', 'bonacci', SC.bHoles);
  L('Mount Meru: luminous, magnetic, invisible', 'bonacci', SC.bMeru);
  SC.B_LAYERS.forEach((Lr) => L(`${Lr.glyph} ${Lr.body} · layer ${SC.B_LAYERS.indexOf(Lr) + 1} of 7`, 'bonacci', () => SC.live.bLayers.localToWorld(Lr.disc.position.clone().add(new THREE.Vector3(0, 0.45, 0)))));
  L('Tabernacle of the Sun: a year of its path', 'bonacci', () => SC.coil ? latLonToXZ(-23.44, 200, lumAlt(-23.44) + 0.3) : SC.bMeru);
  L('Figure-8 crossing', 'bonacci', () => SC.bCross || SC.bMeru);
  L('As above, so below: the zodiac man', 'bonacci', () => SC.live.man.localToWorld(new THREE.Vector3(0, 4.4 + 0.6, 0)));
  SC.MELO.forEach(([sign, part], k) => L(`${sign} · ${part}`, 'bonacci', () => SC.live.man.localToWorld(SC.meloPos[k].clone().add(new THREE.Vector3(k % 2 ? 0.9 : -0.9, 0, 0)))));
  L('Aśvattha: roots above · 15.1', 'gita', SC.gRoots);
  L('…branches below', 'gita', SC.gBranches);
  L('The supreme abode · 15.6', 'gita', SC.gAbode);
  L('Of peaks I am Meru · 10.23', 'gita', SC.gMeru);
  L('"Of lights I am the radiant Sun" · 10.21', 'gita', () => sun.position.clone().setY(sun.position.y + 0.75));
  L('"Among the stars I am the Moon" · 10.21', 'gita', () => moon.position.clone().setY(moon.position.y + 0.65));
  L('Square earth', 'china', SC.square);
  L('Canopy of heaven, 28 ribs', 'china', SC.canopy);
  L('Seven paths of the sun', 'china', () => SC.hengLbl || SC.canopy);
}
function setScripture(sel) {
  SC.sel = SCRIPTURE[sel] || sel === 'all' ? sel : 'none'; SC.liveAt = 0; SC.termAt = 0;
  for (const k of Object.keys(SCRIPTURE)) SC.groups[k].visible = scOn(k);
  nodeG.visible = $('tNodes').checked || scOn('purana');   // the Puranas' Rahu and Ketu
  sun.visible = moon.visible = !scOn('bonacci');   // Bonacci: the Sun and Moon are flat discs stuck to their layers (light, night and eclipses still follow their real positions)
  const box = $('scriptureNote');
  if (SC.sel === 'none') { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  box.innerHTML = `<div class="scLive" id="scLive"></div>` + Object.keys(SCRIPTURE).filter(scOn).map((k) => `<details class="scG"${SC.sel === 'all' ? '' : ' open'}><summary class="scT">${SCRIPTURE[k].name}</summary>` +
    SCRIPTURE[k].items.map(([what, ref, drawn]) => `<div class="scI"><b>${esc(what)}</b> <span class="scR">${esc(ref)}</span><br><span class="scD">${esc(drawn)}</span></div>`).join('') + '</details>').join('') +
    `<p class="scCave">Drawn from literal readings of these passages; most scholars in each tradition read them as poetic, symbolic or written from an observer's view. Sizes the texts don't give are the model's choices. The Sun, Moon, ISS, eclipses and map stay real data.</p>`;
}
const ENOCH_EPOCH = Date.UTC(2026, 2, 20, 14, 46);   // March equinox 2026: Enoch's year begins at the spring equinox (72:6)
const MANAZIL = ['al-Sharaṭān', 'al-Buṭayn', 'al-Thurayyā', 'al-Dabarān', 'al-Haqʿa', 'al-Hanʿa', 'al-Dhirāʿ', 'al-Nathra', 'al-Ṭarf', 'al-Jabha', 'al-Zubra', 'al-Ṣarfa', 'al-ʿAwwāʾ', 'al-Simāk', 'al-Ghafr', 'al-Zubānā', 'al-Iklīl', 'al-Qalb', 'al-Shawla', 'al-Naʿāʾim', 'al-Balda', 'Saʿd al-Dhābiḥ', 'Saʿd Bulaʿ', 'Saʿd al-Suʿūd', 'Saʿd al-Akhbiya', 'al-Fargh al-Muqaddam', 'al-Fargh al-Muʾakhkhar', 'Baṭn al-Ḥūt'];
const RASHI = ['Meṣa', 'Vṛṣabha', 'Mithuna', 'Karka', 'Siṃha', 'Kanyā', 'Tulā', 'Vṛścika', 'Dhanu', 'Makara', 'Kumbha', 'Mīna'];
const JIEQI = ['Chunfen (spring equinox)', 'Qingming', 'Guyu', 'Lixia (start of summer)', 'Xiaoman', 'Mangzhong', 'Xiazhi (summer solstice)', 'Xiaoshu', 'Dashu', 'Liqiu (start of autumn)', 'Chushu', 'Bailu', 'Qiufen (autumn equinox)', 'Hanlu', 'Shuangjiang', 'Lidong (start of winter)', 'Xiaoxue', 'Daxue', 'Dongzhi (winter solstice)', 'Xiaohan', 'Dahan', 'Lichun (start of spring)', 'Yushui', 'Jingzhe'];
function updateScripture(S) {
  SC.time.value = performance.now() / 1000;
  const sp = sun.position, mp = moon.position, rs = Math.hypot(sp.x, sp.z), rm = Math.hypot(mp.x, mp.z), M = SKY.moon;
  if (scOn('bible')) {
    SC.live.bibleSun.scale.set(rs, 1, rs); SC.live.bibleSun.position.y = sp.y;
    if (performance.now() - (SC.termAt || 0) > 500) {   // the day–night line: every point 90° from the point under the Sun
      SC.termAt = performance.now(); const a = SC.live.term.geometry.attributes.position, f1 = deg(S.lat), v = new THREE.Vector3();
      for (let i = 0; i <= 360; i++) {
        const th = deg(i), lat2 = Math.asin(Math.cos(f1) * Math.cos(th)), lon2 = S.lon + rad(Math.atan2(Math.sin(th) * Math.cos(f1), -Math.sin(f1) * Math.sin(lat2)));
        latLonToXZ(rad(lat2), lon2, 0.04, v); a.setXYZ(i, v.x, v.y, v.z); if (i === 90) SC.termLbl.copy(v).setY(0.3);
      }
      a.needsUpdate = true;
    }
  }
  if (scOn('quran')) { SC.live.qSun.scale.set(rs, 1, rs); SC.live.qSun.position.y = sp.y; SC.live.qMoon.scale.set(rm, 1, rm); SC.live.qMoon.position.y = mp.y; }
  if (scOn('purana')) {
    const ax = SC.live.axle; ax.position.set(sp.x / 2, sp.y, sp.z / 2); ax.scale.set(1, Math.max(0.001, rs), 1);
    ax.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(sp.x, 0, sp.z).normalize());
    SC.axleMid = new THREE.Vector3(sp.x / 2, sp.y + 0.12, sp.z / 2);
    SC.live.wheelRim.scale.set(rs, 1, rs); SC.live.wheelRim.position.y = sp.y;
    const a = SC.live.spokes.geometry.attributes.position, th0 = Math.atan2(-sp.z, sp.x);
    for (let k = 0; k < 12; k++) { const th = th0 + k * Math.PI / 6; a.setXYZ(2 * k, 0, sp.y, 0); a.setXYZ(2 * k + 1, rs * Math.cos(th), sp.y, -rs * Math.sin(th)); }
    a.needsUpdate = true;
  }
  if (scOn('buddhist')) { SC.live.bSun.scale.set(rs, 1, rs); SC.bSunLbl = new THREE.Vector3(sp.x, SC.bSunY + 0.1, sp.z); }
  if (scOn('jain')) {
    latLonToXZ(S.lat, S.lon + 180, sp.y, SC.live.sun2.position); latLonToXZ(M.lat, M.lon + 180, mp.y, SC.live.moon2.position);
    const k = Math.max(0, Math.min(183, Math.round((23.44 - S.dec) / 46.88 * 183))), dec = 23.44 - k * 46.88 / 183, r = (90 - dec) / 180 * R;
    SC.live.jainNow.scale.set(r, 1, r); SC.live.jainNow.position.y = lumAlt(dec) + 0.01; SC.jainK = k + 1; SC.jainLbl = new THREE.Vector3(-r, lumAlt(dec) + 0.15, 0);
  }
  if (scOn('norse')) { latLonToXZ(S.lat, S.lon + 14, sp.y, SC.live.skoll.position); latLonToXZ(M.lat, M.lon + 14, mp.y, SC.live.hati.position); }   // each wolf just behind (east of) its quarry
  if (scOn('egypt')) { const b = SC.live.boat; b.position.set(sp.x, sp.y - 0.32, sp.z); b.lookAt(latLonToXZ(S.lat, S.lon - 10, sp.y - 0.32)); b.rotateY(Math.PI / 2); }
  if (scOn('meso')) SC.live.mesoSky.rotation.y = firmament.rotation.y;
  if (scOn('gita')) {
    SC.gMeruMesh.visible = !scOn('purana');   // with the Puranas also shown, their Meru stands for both
    const L = SC.live; L.gEyeS.position.copy(sp); L.gEyeM.position.copy(mp);
    if (performance.now() - (SC.gAt || 0) > 500) {
      SC.gAt = performance.now(); SC.gNorth = subpoint('Sun', state.t + DAY).lat > S.dec; SC.gWax = Astronomy.MoonPhase(Astronomy.MakeTime(new Date(state.t))) < 180;
      L.gSun.material.color.set(SC.gNorth ? 0xffd56b : 0x8a8f99); L.gMoon.material.color.set(SC.gWax ? 0xf4f8ff : 0x6f7480);
    }
    L.gSun.scale.set(rs, 1, rs); L.gSun.position.y = sp.y; L.gMoon.scale.set(rm, 1, rm); L.gMoon.position.y = mp.y;
    const out = new THREE.Vector3(sp.x, 0, sp.z).normalize(); L.gArrow.position.copy(sp).addScaledVector(out, SC.gNorth ? 0.5 : -0.5); L.gArrow.setDirection(SC.gNorth ? out.clone().negate() : out);   // north = toward the centre
    L.gArrow.setColor(SC.gNorth ? 0xffd56b : 0x9aa0aa);
    L.soma.position.set(mp.x, mp.y / 2, mp.z); L.soma.scale.set(1, Math.max(0.01, mp.y), 1);
  }
  if (scOn('bonacci')) {
    if (!SC.coil || (Math.abs(state.t - SC.bBuiltAt) > HOUR && performance.now() - (SC.bBuildAt || 0) > 2000)) { SC.bBuildAt = performance.now(); SC.buildBonacci(); }
    SC.live.holes.rotation.y = firmament.rotation.y;
    SC.live.bLayers.rotation.y = firmament.rotation.y;   // the layers turn with the firmament
    if (performance.now() - (SC.bLayAt || 0) > 500) { SC.bLayAt = performance.now(); SC.placeBLayers(); }
    if (SC.bCross) SC.live.crossDot.position.copy(SC.bCross);
    const man = SC.live.man; man.rotation.y = Math.atan2(camera.position.x - man.position.x, camera.position.z - man.position.z);   // the figure faces the viewer
    const f = (performance.now() / 9000) % 1; SC.live.chrism.position.set(0, (0.5 + 0.43 * f) * 4.4, 0);
    if (performance.now() - (SC.bSignAt || 0) > 500) {
      SC.bSignAt = performance.now(); const time = Astronomy.MakeTime(new Date(state.t));
      SC.bSun = Math.floor(Astronomy.SunPosition(time).elon / 30) % 12; SC.bMoon = Math.floor(Astronomy.EclipticGeoMoon(time).lon / 30) % 12;
      SC.live.sunPart.position.copy(SC.meloPos[SC.bSun]); SC.live.moonPart.position.copy(SC.meloPos[SC.bMoon]).add(new THREE.Vector3(0.12, 0, 0.05));
      SC.bOut = subpoint('Sun', state.t + DAY).lat < S.dec;   // heading south: circles growing
    }
  }
  if (scOn('mason')) { SC.live.mSun.scale.set(rs, 1, rs); SC.live.mSun.position.y = sp.y; }   // the stars turn with the firmament
  if (scOn('china')) { const k = Math.max(0, Math.min(5, Math.floor((23.44 - S.dec) / (46.88 / 6)))); SC.heng.forEach((l, i) => (l.material.opacity = i === k || i === k + 1 ? 0.95 : 0.35)); SC.hengK = k; const dd = 23.44 - (k + 0.5) * 46.88 / 6; SC.hengLbl = latLonToXZ(dd, 180, lumAlt(dd) + 0.2); }
  let sunPortal = -1;
  if (scOn('enoch')) {
    const find = (d) => { const i = SC.portals.findIndex((p) => d >= p.d0 && d < p.d1); return i >= 0 ? i : d >= 0 ? 5 : 0; };
    sunPortal = find(S.dec); SC.moonPortal = find(M.dec);
    SC.portals.forEach((p, k) => { p.mesh.material.opacity = k === sunPortal ? 0.42 : 0.1; p.ring.visible = k === SC.moonPortal; });
  }
  const live = $('scLive');
  if (live && performance.now() - (SC.liveAt || 0) > 500) {
    SC.liveAt = performance.now(); const out = [], time = Astronomy.MakeTime(new Date(state.t));
    const sunLon = Astronomy.SunPosition(time).elon, moonLon = Astronomy.EclipticGeoMoon(time).lon, phase = Astronomy.MoonPhase(time);
    if (scOn('enoch')) {
      const day = Math.floor(((state.t - ENOCH_EPOCH) / DAY % 364 + 364) % 364) + 1, drift = ((state.t - ENOCH_EPOCH) / DAY / 365.2422) * 1.2422;
      out.push(`Enoch: Sun in portal ${sunPortal + 1}, Moon in portal ${SC.moonPortal + 1} · day ${day} of the 364-day year (from the 2026 spring equinox; drifted ${Math.abs(drift).toFixed(1)} days from the real seasons)`);
    }
    if (scOn('quran')) out.push(`Quran: Moon in mansion ${Math.floor(moonLon / (360 / 28)) + 1} of 28, ${MANAZIL[Math.floor(moonLon / (360 / 28))]} (equal 12°51′ stations from 0° Aries, as in medieval Arabic astronomy) · ${Math.round(phase)}° past new moon`);
    if (scOn('purana')) { const sid = ((sunLon - 24.2) % 360 + 360) % 360; out.push(`Puranas: Sun in ${RASHI[Math.floor(sid / 30)]} (sidereal, Lahiri) · the chariot wheel turns once a day with the Sun`); }
    if (scOn('jain')) out.push(`Jain: Sun on circle ${SC.jainK} of 184 (1 = innermost, June) · second Sun over ${(((S.lon + 360) % 360) - 180).toFixed(0)}° longitude`);
    if (scOn('zoro')) out.push(`Bundahishn: Sun rising from window ${Math.max(1, Math.min(180, Math.round((23.44 - S.dec) / 46.88 * 179) + 1))} of 180 (1 = the June solstice)`);
    if (scOn('egypt')) { const el = sunElevation(25.7, 32.6, S.lat, S.lon); out.push(`Egypt (Luxor): Ra is ${el > 0 ? `sailing the sky, ${el.toFixed(0)}° up` : `in the Duat, ${(-el).toFixed(0)}° below the horizon`}`); }
    if (scOn('meso')) { const dd = Math.floor(phase / 360 * 29.53) + 1; out.push(`Enūma Eliš: Moon on day ${dd} of its month ${dd <= 7 ? '(horns, days 1–6)' : dd <= 8 ? '(half-crown, day 7)' : dd >= 14 && dd <= 16 ? '(full, mid-month)' : ''}`.trim()); }
    if (scOn('gita')) {
      const MON = ['Chaitra', 'Vaiśākha', 'Jyeṣṭha', 'Āṣāḍha', 'Śrāvaṇa', 'Bhādrapada', 'Āśvina', 'Kārtika', 'Mārgaśīrṣa', 'Pauṣa', 'Māgha', 'Phālguna'], RITU = ['Vasanta (spring)', 'Grīṣma (summer)', 'Varṣā (rains)', 'Śarad (autumn)', 'Hemanta (early winter)', 'Śiśira (late winter)'];
      const tNew = state.t - phase / 360 * 29.530589 * DAY, sid = ((Astronomy.SunPosition(Astronomy.MakeTime(new Date(tNew))).elon - 24.2) % 360 + 360) % 360, mi = (Math.floor(sid / 30) + 1) % 12;   // amānta month: named by the Sun's sign at the new moon that began it
      const north = SC.gNorth, wax = phase < 180;
      out.push(`Gita: the Sun is in its ${north ? 'northern course (uttarāyaṇa), of the path of light' : 'southern course (dakṣiṇāyana), of the path of smoke'}; the Moon is ${wax ? 'waxing (bright fortnight, of light)' : 'waning (dark fortnight, of smoke)'} · month ${MON[mi]}${mi === 8 ? ' ("of months I am Mārgaśīrṣa", 10.35)' : ''}, season ${RITU[Math.floor(mi / 2)]}${mi < 2 ? ' ("of seasons I am the flowering spring", 10.35)' : ''}`);
    }
    if (scOn('bonacci') && SC.bSun != null) out.push(`Bonacci: Sun in ${SC.MELO[SC.bSun][0]} → ${SC.MELO[SC.bSun][1]}; Moon in ${SC.MELO[SC.bMoon][0]} → ${SC.MELO[SC.bMoon][1]} · the Sun is ${SC.bOut ? 'breathing out (circles growing toward Capricorn)' : 'breathing in (circles shrinking toward Cancer)'}${SC.anaCross != null ? ` · figure-8 crosses at ${SC.anaCross.toFixed(1)}° (computed; he says about 8.5°)` : ''}`);
    if (scOn('mason')) {
      const el = sunElevation(51.51, -0.13, S.lat, S.lon), H = ((-0.13 - S.lon + 540) % 360) - 180;   // hour angle at London: negative = morning
      const st = el < -0.833 ? 'the Sun is below the horizon: the lodge is at rest' : Math.abs(H) < 7.5 ? 'high twelve: the Sun is at the meridian, and the Junior Warden in the South calls from labour to refreshment' : H < 0 ? (el < 10 ? 'the Sun is rising in the East, as the Master opens the lodge' : 'morning: the Sun is climbing from the East toward the South') : (el < 10 ? 'the Sun is setting in the West, as the Senior Warden closes the lodge' : 'afternoon: the Sun is moving from the South toward the West');
      out.push(`Freemasonry (London): ${st} · Sun ${el >= 0 ? `${el.toFixed(0)}° up` : `${(-el).toFixed(0)}° below the horizon`}`);
    }
    if (scOn('china')) out.push(`Gaitian: Sun between paths ${SC.hengK + 1} and ${SC.hengK + 2} of 7 (1 = summer) · solar term ${JIEQI[Math.floor(sunLon / 15) % 24]}`);
    live.textContent = out.join('\n');
  }
}
const tmpV = new THREE.Vector3();
function updateLabels() {
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const l of labels) {
    if (l.group && !l.group.visible) { l.el.style.display = 'none'; continue; }
    tmpV.copy(l.getPos()).project(camera);
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
    l.el.style.display = vis ? '' : 'none';
    if (vis) l.el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * w}px, ${(-tmpV.y * 0.5 + 0.5) * h}px) translate(-50%, -130%)`;
  }
}

// ---------- Camera presets ----------
const VIEWS = {
  overview: { pos: [0, 16, 25], target: [0, 0.8, 0] },
  top: { pos: [0, 38, 0.01], target: [0, 0, 0] },
  wall: { pos: [2.4, 2.1, 2.4], target: [7.3, 0.6, 7.3] },
  side: { pos: [0, 0.2, 31], target: [0, 0, 0] },
  follow: null,
  analemma: null,
  observer: null,
};
let tween = null;
function flyTo(pos, target, ms = 1200) {
  tween = { from: camera.position.clone(), to: new THREE.Vector3(...pos), tf: controls.target.clone(), tt: new THREE.Vector3(...target), start: performance.now(), ms };
}
function setView(v) {
  state.view = v;
  if (ISS_FOLLOW.on) { ISS_FOLLOW.on = false; $('issFollow').classList.remove('on'); $('issFollow').textContent = 'Follow the ISS (real size)'; }
  if (v === 'observer') enterObserver(); else exitObserver();
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  const ensure = (ids) => { for (const id of ids) { const el = $(id); if (!el.checked) { el.checked = true; el.onchange(); } } };
  if (v === 'analemma') { ensure(['tAnalemma']); try { flyToAnalemma(); } catch {} }
  if (VIEWS[v]) flyTo(VIEWS[v].pos, VIEWS[v].target);
  try { scheduleSave(); } catch {}
}
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---------- Interaction ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickDisc(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(disc)[0];
  if (!hit || Math.hypot(hit.point.x, hit.point.z) > R) return null;
  return xzToLatLon(hit.point.x, hit.point.z);
}
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  if (OBS.active) return;
  const ll = pickDisc(e); if (!ll) return;
  if (MEAS.on) measureClick(ll); else setPin(ll.lat, ll.lon);
});

// ---------- Real-life scale: a live scale bar and a two-click distance tool ----------
// Scale bar: map distance under the middle of the view, per screen pixel, in real miles / km. On this map distances from
// the pole (north–south) are true everywhere; east–west they are stretched by c / sin c (c = angle from the pole), so the
// bar also says how much east–west is stretched where you are looking.
// Measure: two clicks → the real distance along the Earth's surface (great circle, mean radius 3,958.8 mi), the route
// drawn on the map, and the map's own straight-line distance for comparison.
const EARTH_MI = 3958.8, KM_PER_MI = 1.609344;
// The measuring scale: the real Earth's north–south length, 10,001.966 km pole to equator = 69.05 mi per degree of latitude
// (Gleason's map says 69.33). With it, any north–south distance measured on the map equals the real one.
const MEAS_MI_PER_UNIT = (10001.966 / KM_PER_MI / 90) * 180 / R;
const MEAS = { on: false, a: null, b: null, g: new THREE.Group() };
scene.add(MEAS.g);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), scaleTmp = [new THREE.Vector3(), new THREE.Vector3()];
const niceLen = (x) => { const p = 10 ** Math.floor(Math.log10(x)), m = x / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; };
const fmtDist = (mi) => { const km = mi * KM_PER_MI, f = (v) => (v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v.toFixed(2)); return `${f(mi)} mi · ${f(km)} km`; };
function updateScaleBar() {
  const el = $('scaleBar'); if (!el) return;
  const rc = canvas.getBoundingClientRect(), hits = [];
  for (const [i, dx] of [[0, 0], [1, 100]]) {
    ndc.set(((rc.width / 2 + dx) / rc.width) * 2 - 1, 0); ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(groundPlane, scaleTmp[i])) return (el.hidden = true);
    hits.push(scaleTmp[i]);
  }
  const unitsPerPx = hits[0].distanceTo(hits[1]) / 100, miPerPx = unitsPerPx * MEAS_MI_PER_UNIT;
  if (!(miPerPx > 0) || miPerPx > 400) return (el.hidden = true);
  el.hidden = false;
  const mi = niceLen(miPerPx * 140), px = mi / miPerPx, km = niceLen(miPerPx * 140 * KM_PER_MI), pxKm = km / KM_PER_MI / miPerPx;
  $('scaleMi').style.width = `${px.toFixed(0)}px`; $('scaleMiT').textContent = `${mi >= 1 ? mi.toLocaleString() : mi} mi`;
  $('scaleKm').style.width = `${pxKm.toFixed(0)}px`; $('scaleKmT').textContent = `${km >= 1 ? km.toLocaleString() : km} km`;
  const r = Math.hypot(hits[0].x, hits[0].z), c = Math.min(Math.PI - 1e-6, r / R * Math.PI), k = c < 1e-4 ? 1 : c / Math.sin(c);
  $('scaleNote').textContent = r > R ? 'beyond the ice wall' : `true north–south · east–west stretched ×${k.toFixed(k < 10 ? 2 : 0)} here`;
}
function gcMiles(a, b) {
  const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Points along the great circle from a to b (lat/lon, degrees). */
function drawMeasure() {
  MEAS.g.traverse((c) => { c.geometry?.dispose(); c.material?.map?.dispose?.(); }); MEAS.g.clear();
  const dot = (p, col) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); latLonToXZ(p.lat, p.lon, 0.03, m.position); m.renderOrder = 20; MEAS.g.add(m); };
  if (MEAS.a) dot(MEAS.a, 0x7fffd4);
  if (MEAS.a && MEAS.b) {
    dot(MEAS.b, 0x7fffd4);
    // a straight line across the flat map, and its length at the map's real north–south scale
    const pa = latLonToXZ(MEAS.a.lat, MEAS.a.lon, 0.02), pb = latLonToXZ(MEAS.b.lat, MEAS.b.lon, 0.02);
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), new THREE.LineBasicMaterial({ color: 0x7fffd4, depthTest: false, transparent: true }));
    ln.renderOrder = 20; MEAS.g.add(ln);
    const mapMi = pa.distanceTo(pb) * MEAS_MI_PER_UNIT, real = gcMiles(MEAS.a, MEAS.b);
    const lbl = textSprite([fmtDist(mapMi), 'straight line on the map'], '#7fffd4', 640, 128);
    lbl.scale.set(2.0, 0.4, 1); lbl.position.copy(pa).lerp(pb, 0.5).setY(0.35); lbl.material.depthTest = false; lbl.renderOrder = 21; MEAS.g.add(lbl);
    const diff = mapMi / real;
    $('measOut').innerHTML = `<b>${fmtDist(mapMi)}</b> straight line on the map<br><span>Measured on the real Earth (GPS, flights): ${fmtDist(real)} — the map line is ${Math.abs(diff - 1) < 0.005 ? 'the same' : `${diff.toFixed(2)}×`}${Math.abs(diff - 1) < 0.005 ? '' : ' that'}.</span>`;
  } else $('measOut').textContent = MEAS.on ? (MEAS.a ? 'Click the second place.' : 'Click the first place on the map.') : '';
}
function measureClick(ll) {
  if (!MEAS.a || MEAS.b) { MEAS.a = ll; MEAS.b = null; } else MEAS.b = ll;
  drawMeasure();
}
$('measBtn').onclick = () => { MEAS.on = !MEAS.on; $('measBtn').classList.toggle('on', MEAS.on); if (!MEAS.on) { MEAS.a = MEAS.b = null; } drawMeasure(); };
canvas.addEventListener('pointermove', (e) => {
  const ll = pickDisc(e);
  $('hover').textContent = ll ? `${fmtLat(ll.lat)} · ${fmtLon(ll.lon)} · ${fmtMi((90 - ll.lat) / 180 * R)} from the pole${MEAS.on && MEAS.a && !MEAS.b ? ` · ${fmtDist(latLonToXZ(MEAS.a.lat, MEAS.a.lon).distanceTo(latLonToXZ(ll.lat, ll.lon)) * MEAS_MI_PER_UNIT)} from the first point (map)` : ''}` : 'Hover the disc for coordinates';
});
controls.addEventListener('start', () => {
  tween = null;
  if (state.view === 'follow') { state.view = 'custom'; document.querySelectorAll('#views button').forEach((b) => b.classList.remove('on')); }
});

function setPin(lat, lon, name) { state.pin = { lat, lon, name: name || nearestPlace(lat, lon) }; latLonToXZ(lat, lon, 0, pin.position); pin.visible = true; if (typeof scheduleSave === 'function') try { scheduleSave(); } catch {} }
/** Remove the pin from the map (click the map or a place to put it back). Views that need a spot keep its last position. */
function clearPin() { state.pin.hidden = true; pin.visible = false; if (typeof scheduleSave === 'function') try { scheduleSave(); } catch {} }
function nearestPlace(lat, lon) {
  let best = null, bd = 1e9; const p = latLonToXZ(lat, lon);
  for (const pl of PLACES) { const d = p.distanceTo(latLonToXZ(pl.lat, pl.lon)); if (d < bd) { bd = d; best = pl; } }
  return bd < 0.35 ? `near ${best.name}` : 'Custom';
}
for (const pl of PLACES) {
  const b = document.createElement('button'); b.textContent = pl.name;
  b.onclick = () => setPin(pl.lat, pl.lon, pl.name);
  $('places').appendChild(b);
}
{ const b = document.createElement('button'); b.textContent = '✕ Clear pin'; b.className = 'clearpin'; b.title = 'Remove the pin — click the map or a place to put it back'; b.onclick = clearPin; $('places').appendChild(b); }
setPin(state.pin.lat, state.pin.lon, state.pin.name); clearPin();   // no pin by default: click the map or a place to set one

// ---------- Ground observer: stand anywhere and look up ----------
// The camera stands at the pin at eye level. Drag to turn your head, scroll to zoom, arrows also look.
// "North" on the plane is toward the pole; east is 90° clockwise from it. The card compares the angle you see in this
// 3D model with the angle actually measured from that place on that date (astronomy-engine).
const OBS = { active: false, az: 180, alt: 30, fov: 75, eye: 0.003, saved: null };
const obsMarks = new THREE.Group(); obsMarks.visible = false;
const obsBasis = () => {
  const P = state.pin, r = Math.PI / 180, l = P.lon * r;
  const north = new THREE.Vector3(-Math.cos(l), 0, Math.sin(l)), east = new THREE.Vector3(-Math.sin(l), 0, -Math.cos(l));
  return { eye: latLonToXZ(P.lat, P.lon, OBS.eye), north, east, up: new THREE.Vector3(0, 1, 0) };
};
const obsDir = (az, alt, B = obsBasis()) => {
  const r = Math.PI / 180, c = Math.cos(alt * r);
  return B.north.clone().multiplyScalar(c * Math.cos(az * r)).addScaledVector(B.east, c * Math.sin(az * r)).addScaledVector(B.up, Math.sin(alt * r));
};
function obsAltAz(P, B = obsBasis()) {
  const v = P.clone().sub(B.eye), h = Math.hypot(v.dot(B.north), v.dot(B.east));
  return { alt: Math.atan2(v.y, h) * 180 / Math.PI, az: (Math.atan2(v.dot(B.east), v.dot(B.north)) * 180 / Math.PI + 360) % 360 };
}
function realAltAz(lat, lon, bLat, bLon) { // geocentric altitude/azimuth of a body whose sub-point is (bLat, bLon)
  const r = Math.PI / 180, dl = (bLon - lon) * r, p = lat * r, d = bLat * r;
  const az = Math.atan2(Math.sin(dl) * Math.cos(d), Math.cos(p) * Math.sin(d) - Math.sin(p) * Math.cos(d) * Math.cos(dl)) / r;
  return { alt: sunElevation(lat, lon, bLat, bLon), az: (az + 360) % 360 };
}
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
COMPASS.forEach((c, i) => addLabel(c, 'compass' + (i % 2 ? ' minor' : ''), () => obsBasis().eye.add(obsDir(i * 45, 0).multiplyScalar(2)), obsMarks));
addLabel('Zenith', 'faint', () => obsBasis().eye.add(new THREE.Vector3(0, 2, 0)), obsMarks);
const cardinal = (az) => COMPASS[Math.round(az / 45) % 8];
function enterObserver() {
  if (!OBS.active) OBS.saved = { near: camera.near, fov: camera.fov };
  OBS.active = true; tween = null; controls.enabled = false; controls.autoRotate = false;
  camera.near = 0.0005; camera.fov = OBS.fov; camera.updateProjectionMatrix();
  pin.visible = false; obsMarks.visible = true; pinLabel.el.style.visibility = 'hidden';
  $('obsCard').classList.add('show'); stage.classList.add('observer');
  obsLook('sun', true);
}
function exitObserver() {
  if (!OBS.active) return;
  OBS.active = false; controls.enabled = true; controls.autoRotate = $('tAutoRotate').checked;
  camera.near = OBS.saved?.near ?? 0.05; camera.fov = OBS.saved?.fov ?? 42; camera.updateProjectionMatrix();
  pin.visible = true; obsMarks.visible = false; pinLabel.el.style.visibility = '';
  $('obsCard').classList.remove('show'); stage.classList.remove('observer');
  camera.position.copy(obsBasis().eye).add(new THREE.Vector3(0, 3, 4)); controls.target.copy(obsBasis().eye);
}
function obsLook(what, instant) {
  const B = obsBasis();
  const target = what === 'sun' ? sun.position : what === 'moon' ? moon.position : what === 'polaris' ? new THREE.Vector3(0, DOME_H * 0.985, 0) : null;
  let az = OBS.az, alt = what === 'zenith' ? 89 : OBS.alt;
  if (what === 'north') { az = 0; alt = 20; }
  if (target) { const a = obsAltAz(target, B); az = a.az; alt = Math.max(-10, Math.min(89, a.alt)); }
  OBS.look = instant ? null : { az0: OBS.az, alt0: OBS.alt, az1: OBS.az + wrap180(az - OBS.az), alt1: alt, start: performance.now() };
  if (instant) { OBS.az = az; OBS.alt = alt; }
}
function updateObserver(now) {
  if (OBS.look) {
    const k = Math.min(1, (now - OBS.look.start) / 900), e = ease(k);
    OBS.az = OBS.look.az0 + (OBS.look.az1 - OBS.look.az0) * e; OBS.alt = OBS.look.alt0 + (OBS.look.alt1 - OBS.look.alt0) * e;
    if (k >= 1) OBS.look = null;
  }
  OBS.az = (OBS.az % 360 + 360) % 360;
  const B = obsBasis();
  camera.position.copy(B.eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(B.eye.clone().add(obsDir(OBS.az, OBS.alt, B)));
  if (now - (OBS.panelAt || 0) > 200) { OBS.panelAt = now; obsPanel(B); }
}
function obsPanel(B) {
  const P = state.pin, S = SKY.sun, M = SKY.moon;
  const f = (x) => `${x.alt >= 0 ? '' : '−'}${Math.abs(x.alt).toFixed(1)}° alt · ${x.az.toFixed(0)}° ${cardinal(x.az)}`;
  const ms = obsAltAz(sun.position, B), rs = realAltAz(P.lat, P.lon, S.lat, S.lon);
  const mm = obsAltAz(moon.position, B), rm = realAltAz(P.lat, P.lon, M.lat, M.lon);
  $('obsPlace').textContent = P.name === 'Custom' ? `${fmtLat(P.lat)}, ${fmtLon(P.lon)}` : P.name;
  $('obsLookOut').textContent = `${OBS.alt.toFixed(0)}° up · ${OBS.az.toFixed(0)}° ${cardinal(OBS.az)} · ${OBS.fov.toFixed(0)}° view`;
  $('obsSunModel').textContent = f(ms); $('obsSunReal').textContent = f(rs) + (rs.alt < -0.833 ? ' (set)' : '');
  $('obsMoonModel').textContent = f(mm); $('obsMoonReal').textContent = f(rm) + (rm.alt < 0 ? ' (set)' : '');
  { // Polaris: J2000 RA 37.9546°, Dec 89.2641°, precessed to the date
    const Ast = globalThis.Astronomy, time = Ast.MakeTime(new Date(state.t));
    const eq = Ast.EquatorFromVector(Ast.RotateVector(Ast.Rotation_EQJ_EQD(time), Ast.VectorFromSphere(new Ast.Spherical(89.2641, 37.9546, 1), time)));
    $('obsPolModel').textContent = f(obsAltAz(new THREE.Vector3(0, DOME_H * 0.985, 0), B));
    $('obsPolReal').textContent = f(realAltAz(P.lat, P.lon, eq.dec, wrap180(eq.ra * 15 - SKY.gmst))) + (P.lat < -0.7 ? ' (below horizon)' : '');
  }
  $('obsLat').value = P.lat.toFixed(2); $('obsLon').value = document.activeElement === $('obsLon') ? $('obsLon').value : P.lon.toFixed(2);
}
{
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { if (OBS.active) { drag = [e.clientX, e.clientY]; OBS.look = null; canvas.setPointerCapture(e.pointerId); } });
  canvas.addEventListener('pointermove', (e) => {
    if (!OBS.active || !drag) return;
    const k = OBS.fov / stage.clientHeight;
    OBS.az -= (e.clientX - drag[0]) * k; OBS.alt = Math.max(-30, Math.min(89.5, OBS.alt + (e.clientY - drag[1]) * k));
    drag = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('wheel', (e) => {
    if (!OBS.active) return; e.preventDefault();
    OBS.fov = Math.max(15, Math.min(110, OBS.fov * Math.exp(e.deltaY * 0.001))); camera.fov = OBS.fov; camera.updateProjectionMatrix();
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!OBS.active || e.target.tagName === 'INPUT') return;
    const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
    if (d) { e.preventDefault(); OBS.look = null; OBS.az += d[0]; OBS.alt = Math.max(-30, Math.min(89.5, OBS.alt + d[1])); }
  });
  document.querySelectorAll('#obsCard [data-look]').forEach((b) => (b.onclick = () => obsLook(b.dataset.look)));
  $('obsGo').onclick = () => {
    const lat = parseFloat($('obsLat').value), lon = parseFloat($('obsLon').value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90) setPin(Math.max(-89.9, Math.min(89.9, lat)), wrap180(lon));
  };
  $('obsClose').onclick = () => setView('overview');
  $('obsMin').onclick = () => { const m = $('obsCard').classList.toggle('min'); $('obsMin').textContent = m ? '▸' : '▾'; };
}

// ---------- Controls wiring ----------
document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
const bind = (id, fn) => { const el = $(id); el.onchange = () => fn(el.checked); fn(el.checked); };
bind('tAutoRotate', (on) => (controls.autoRotate = on));
bind('tDome', (on) => (dome.visible = on));
bind('tWall', () => applyWallStyle());
$('mapStyle').onchange = (e) => { state.mapStyle = e.target.value === 'gleason' ? 'gleason' : 'satellite'; satUniforms.uSatOn.value = state.mapStyle === 'satellite' ? 1 : 0; satCredit(); drawMap(); applyWallStyle(); };
bind('tStars', (on) => (stars.visible = on));
bind('tFixedStars', (on) => (fixedStars.visible = on));
bind('tZodiac', (on) => (zodiac.visible = sunMarker.visible = signLine.visible = on));
bind('tPlanets', (on) => (planetGroup.visible = on));
let anaWanted = false;
bind('tAnalemma', (on) => { anaWanted = on; anaGroup.visible = on; });
$('anaView').onclick = () => setView('analemma');
let curPattern = 'none', curOverlay = 'none';
bind('tISS', (on) => (issGroup.visible = on));
$('issFollow').onclick = () => {
  ISS_FOLLOW.on = !ISS_FOLLOW.on; $('issFollow').classList.toggle('on', ISS_FOLLOW.on);
  $('issFollow').textContent = ISS_FOLLOW.on ? 'Stop following the ISS' : 'Follow the ISS (real size)';
  if (ISS_FOLLOW.on) { tween = null; ISS_FOLLOW.off.set(0.00025, 0.00012, 0.00035); controls.target.copy(issSprite.position); camera.position.copy(issSprite.position).add(ISS_FOLLOW.off); }
};
controls.addEventListener('start', () => {});   // the live ISS, riding its 3D torus
bind('tYinYang', (on) => (yinYang.visible = on));
bind('tChakras', (on) => (chakraG.visible = on));
bind('tNodes', (on) => (nodeG.visible = on || scOn('purana')));
$('scriptureSel').onchange = (e) => { setScripture(e.target.value); scheduleSave(); };

// ---------- Torus field panel: side view (poloidal loops) and top view (toroidal swirl) ----------
// Geometry is precomputed into Path2D objects and only rebuilt when the canvas size or the shell config changes;
// each frame just strokes them with a moving dash offset. Skipped while the tab is hidden or the panel is off screen.
const fieldViews = { on: false, cacheKey: '', side: null, top: null, issTrail: null, issTrailAt: -Infinity, issTrailT: 0 };
{
  const box = $('fieldViews');
  if (box && 'IntersectionObserver' in window) new IntersectionObserver((es) => { fieldViews.on = es.some((e) => e.isIntersecting); }).observe(box);
  else fieldViews.on = true;
}
// The hub torus's shells, each with its own switch, colour and name. s() gives the shell index now (null = not in use).
const SHELLS = [
  { id: 'sun', noSkin: true, name: 'Sun path (slope)', col: '#ffd56b', s: () => FIELD.luminaryShell(), loops: 24, skin: 0.07, line: 0.45, note: 'Cancer ring small & high → Capricorn ring big & low' },
  { id: 'moon', noSkin: true, name: 'Moon shell', col: '#c9d0ff', s: () => (FIELD_PACE.real ? moonShell() : null), loops: 16, skin: 0.05, line: 0.35, note: 'edges at the Moon’s monthly limits' },
  { id: 'iss', noSkin: true, name: 'ISS shell', col: '#7fe6ff', s: () => (FIELD_PACE.real ? issFieldAt(state.t)?.shell ?? null : null), loops: 16, skin: 0.04, line: 0.3, note: 'lowest point = real ISS altitude' },
  { id: 'outer', name: 'Outer boundary (vortex)', col: '#ff7ad1', s: () => 1, loops: 0, skin: 0.03, line: 0.22, note: 'concentric with the firmament' },
];
// Sun and Moon: their torus surfaces were removed (noSkin) — only their paths are drawn
const shellOn = (d) => !d.noSkin && !!$(`tShell_${d.id}`)?.checked;
/** The Sun's path surface (r, y): the straight slope from the Capricorn ring (big, lowest) up to the Cancer ring (small, highest). */
const sunSlopeLoop = (n = 40) => Array.from({ length: n + 1 }, (_, i) => { const dec = -23.44 + 46.88 * i / n; return [(90 - dec) / 180 * R, lumAlt(dec)]; });
// The outer boundary: a perfect torus field — a horn torus (circular cross-section whose centre circle radius equals its
// tube radius, so the hole closes to a single point). It is centred on the plane of inertia: the disc's surface is its
// equatorial plane and the North Pole the point where the hole closes. It is inscribed in the firmament sphere, touching
// just inside it all round the equator, just beyond the ice wall (outer radius OUTER.R), equal above and below the disc.
// Flow: up through the hole at the pole, out over the top, down the outside along the firmament's equator, back in below.
const OUTER = { R: FIRM_R - 0.02 };   // passes just outside the ice wall (top of the wall at r 10.38, y 0.55 clears)
OUTER.a = OUTER.R / 2; OUTER.r0 = OUTER.a; OUTER.b = OUTER.a;   // tube radius = centre-circle radius (horn torus); height ±a
/** Radius of the torus hole at height y: 0 at the North Pole, opening to a at the top and bottom (y = ±a). */
const outerFunnel = (y) => OUTER.r0 - Math.sqrt(Math.max(0, OUTER.a ** 2 - y * y));
/** Outer boundary cross-section (r, y): a circle of radius a centred a from the axis, in flow order (up the hole first). */
const outerLoop = (n = 120) => Array.from({ length: n + 1 }, (_, i) => { const p = Math.PI - i / n * Math.PI * 2; return [OUTER.r0 + OUTER.a * Math.cos(p), OUTER.a * Math.sin(p)]; });
// Field-line controls: loop density per shell, and helical field lines traced forward in time (0 = off, up to a year).
function fieldGeometry(sw, sh, tw) {
  const shellNow = SHELLS.map((d) => ({ d, s: d.s() })).filter((x) => x.s != null && shellOn(x.d));
  const key = `${sw}x${sh}|${tw}|${JSON.stringify(FIELD.config.shellRadii)}|${SUN_TILT.v}|${shellNow.map((x) => x.d.id + x.s.toFixed(3))}`;
  if (key === fieldViews.cacheKey) return;
  fieldViews.cacheKey = key;
  // side view: world x ∈ [−(R+0.6), R+0.6], y ∈ [−0.9, YTOP] (vertical scale exaggerated to fit)
  const g = FIELD.config.shellRadii, outerOn = shellNow.some((x) => x.d.id === 'outer');
  const YTOP = Math.max(g.axisHeight + g.halfHeight + 0.9, outerOn ? OUTER.b + 0.5 : 3.4), YBOT = outerOn ? -(OUTER.b + 0.4) : -0.9, XW = outerOn ? FIRM_R + 0.3 : R + 0.6;
  const SX = (x) => (x + XW) / (2 * XW) * sw, SY = (y) => sh - (y - YBOT) / (YTOP - YBOT) * sh;
  const loops = shellNow.map(({ d, s: sv }) => {
    let pts = d.id === 'outer' ? outerLoop(180) : d.id === 'sun' ? sunSlopeLoop(60) : FIELD.poloidalLoop(sv, 180);
    if (d.id === 'iss') { const f = issFieldAt(state.t); if (f) pts = Array.from({ length: 181 }, (_, i) => { const p = Math.PI - i / 180 * Math.PI * 2; return [g.axisRadius + f.tube.w * Math.cos(p), g.axisHeight + f.tube.h * Math.sin(p)]; }); }
    const right = new Path2D(), left = new Path2D(), fill = new Path2D();
    pts.forEach(([r, y], k) => { (k ? right.lineTo.bind(right) : right.moveTo.bind(right))(SX(r), SY(y)); (k ? left.lineTo.bind(left) : left.moveTo.bind(left))(SX(-r), SY(y)); });
    fill.addPath(right); fill.addPath(left);
    return { s: sv, right, left, fill, lum: d.id === 'sun', col: d.col };
  });
  const dome = new Path2D(); for (let i = 0; i <= 240; i++) { const a = i / 240 * Math.PI * 2, x = FIRM_R * Math.cos(a), y = FIRM_R * Math.sin(a); (i ? dome.lineTo.bind(dome) : dome.moveTo.bind(dome))(SX(x), SY(Math.max(YBOT, Math.min(YTOP, y)))); }
  fieldViews.side = { SX, SY, loops, dome, YTOP, YBOT };
  // top view: centred hub, scale so the ice wall fits; spiral arcs in world units (rotated each frame)
  const sc = (tw / 2 - 8) / R, spirals = [];
  for (let k = 0; k < 6; k++) { const pth = new Path2D(); for (let i = 0; i <= 80; i++) { const r = 0.5 + i / 80 * (R - 0.6), a = k / 6 * Math.PI * 2 + (r / R) * Math.PI * 1.3; const x = r * Math.cos(a), z = -r * Math.sin(a); (i ? pth.lineTo.bind(pth) : pth.moveTo.bind(pth))(x * sc, z * sc); } spirals.push(pth); }
  fieldViews.top = { sc, spirals };
}
function drawFieldViews(now, F) {
  const cs = $('fieldSide'), ct = $('fieldTop'); if (!cs || !ct) return;
  const [a, sw, sh] = fitCanvas(cs), [b, tw, th] = fitCanvas(ct);
  fieldGeometry(sw, sh, tw);
  const G = fieldViews.side, T = fieldViews.top, showShells = $('tShell_outer').checked,   // the outer boundary is the only shell with a surface
    act = F.aurora.intensity;
  const flow = (now / 1000) * 28;   // dash flow, px per second (real time, so it stays smooth at any sim speed)
  // ---- side view ----
  a.clearRect(0, 0, sw, sh);
  a.strokeStyle = 'rgba(140,170,255,.25)'; a.lineWidth = 1; a.stroke(G.dome);
  a.fillStyle = 'rgba(70,110,200,.18)'; a.fillRect(G.SX(-R), G.SY(0), G.SX(R) - G.SX(-R), 3);
  a.fillStyle = '#cfe6ff'; for (const x of [-R, R]) a.fillRect(G.SX(x) - 2, G.SY(0) - 8, 4, 8);   // ice wall
  a.setLineDash([3, 4]); a.strokeStyle = 'rgba(255,255,255,.25)'; a.beginPath(); a.moveTo(G.SX(0), G.SY(G.YBOT)); a.lineTo(G.SX(0), G.SY(G.YTOP)); a.stroke(); a.setLineDash([]);
  if (showShells) G.loops.forEach((L, i) => { a.fillStyle = L.col + '14'; a.fill(L.fill); });
  G.loops.forEach((L) => {   // each enabled shell's cross-section, dashes flowing the field's way
    a.strokeStyle = L.col; a.globalAlpha = L.lum ? 0.95 : 0.6; a.lineWidth = L.lum ? 1.8 : 1.2;
    a.setLineDash([6, 6]); a.lineDashOffset = -flow; a.stroke(L.right); a.stroke(L.left);
  });
  a.setLineDash([]); a.globalAlpha = 1;
  for (const r of [F.aurora.rings.north, F.aurora.rings.south]) for (const sx of [-1, 1]) {   // aurora footprints
    const x = G.SX(sx * r), y = G.SY(0), gr = a.createRadialGradient(x, y, 0, x, y, 14);
    gr.addColorStop(0, `rgba(80,255,150,${0.9 * act})`); gr.addColorStop(1, 'rgba(80,255,150,0)'); a.fillStyle = gr; a.fillRect(x - 14, y - 14, 28, 28);
  }
  const dot = (ctx, x, y, r, col, label) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); if (label) { ctx.font = '10px system-ui'; ctx.fillStyle = '#c9d3f2'; ctx.textAlign = 'left'; ctx.fillText(label, x + r + 3, y - r); } };
  const side = (p) => (Math.cos(p.theta) >= 0 ? 1 : -1) * p.r;   // which side of the hub the body is on (it sits on its loop)
  dot(a, G.SX(side(F.sun)), G.SY(F.sun.y), 5, '#ffd56b', 'Sun');
  dot(a, G.SX(side(F.moon)), G.SY(F.moon.y), 4.5, '#dfe6ff', 'Moon');
  dot(a, G.SX(side(F.iss)), G.SY(F.iss.y), 3, '#7fe6ff', 'ISS');
  a.font = '10px system-ui'; a.fillStyle = '#8d9bc2'; a.textAlign = 'center'; a.fillText('hub', G.SX(0), sh - 3); a.textAlign = 'left'; a.fillText('ice wall', 2, sh - 3); a.textAlign = 'right'; a.fillText('heights ×' + ((sh / (G.YTOP - G.YBOT)) / (sw / (2 * (R + 0.6)))).toFixed(1), sw - 2, 11);
  // ---- top view ----
  const cx = tw / 2, cy = th / 2, sc = T.sc, P = (x, z) => [cx + x * sc, cy + z * sc];
  b.clearRect(0, 0, tw, th);
  b.fillStyle = 'rgba(30,50,95,.35)'; b.beginPath(); b.arc(cx, cy, R * sc, 0, Math.PI * 2); b.fill();
  b.strokeStyle = 'rgba(207,230,255,.55)'; b.lineWidth = 2; b.stroke();
  const ring = (r, col, w, dash) => { b.strokeStyle = col; b.lineWidth = w; b.setLineDash(dash || []); b.beginPath(); b.arc(cx, cy, r * sc, 0, Math.PI * 2); b.stroke(); b.setLineDash([]); };
  const amp = FIELD.config.breathingAmplitude / 180 * R, r0 = FIELD.config.shellRadii.axisRadius;
  ring(r0 - amp, 'rgba(255,213,107,.35)', 1, [4, 4]); ring(r0 + amp, 'rgba(255,213,107,.35)', 1, [4, 4]);   // seasonal extremes
  ring(F.sun.ringRadius, 'rgba(255,213,107,.8)', 1.5);                                                          // today's circuit
  const pulse = 0.85 + 0.15 * Math.sin(now / 400);
  for (const [pole, col] of [[AURORA.poles.N, '80,255,150'], [AURORA.poles.S, '255,110,170']]) {   // the auroral ovals (same model as the 3D curtains)
    const mid = bearing(pole.lat, pole.lon, SKY.sun.lat, SKY.sun.lon) + 180; b.beginPath();
    for (let i = 0; i <= 120; i++) { const brg = i / 120 * 360, o = auroraOval(brg, mid, act * 9), q = destPoint(pole.lat, pole.lon, o.colat, brg), m = latLonToXZ(q.lat, q.lon), [x, y] = P(m.x, m.z); i ? b.lineTo(x, y) : b.moveTo(x, y); }
    b.strokeStyle = `rgba(${col},${(0.1 + 0.8 * act) * pulse})`; b.lineWidth = 2 + 5 * act; b.stroke();
  }
  if ($('tFieldIssTrail').checked) {   // last 24 h of the ISS, recomputed at most 10× a second
    if (now - fieldViews.issTrailAt > 500 || Math.abs(fieldViews.issTrailT - state.t) > 30e3) {
      const pts = []; for (let i = 0; i <= 2880; i++) { const q = fieldIssAt(state.t - i * 30e3); if (q) pts.push(P(q.x, q.z)); }   // every 30 s over 24 h
      fieldViews.issTrail = pts; fieldViews.issTrailAt = now; fieldViews.issTrailT = state.t;
    }
    b.strokeStyle = 'rgba(127,230,255,.55)'; b.lineWidth = 1; b.beginPath(); fieldViews.issTrail.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y))); b.stroke();
  }
  dot(b, cx, cy, 2.5, '#fff');
  dot(b, ...P(F.sun.x, F.sun.z), 5, '#ffd56b', 'Sun');
  dot(b, ...P(F.moon.x, F.moon.z), 4.5, '#dfe6ff', 'Moon');
  dot(b, ...P(F.iss.x, F.iss.z), 3, '#7fe6ff', 'ISS');
}
function fieldReadout() {
  const c = FIELD.config, F = fieldUpdate(state.t, SKY), sunH = 24 / (c.twistStrength * c.sunCharge), moonH = 24 / (c.twistStrength * c.moonCharge);
  const doy = c.seasonDay != null ? c.seasonDay : Math.floor((state.t - Date.UTC(new Date(state.t).getUTCFullYear(), 0, 1)) / DAY) + 1;
  $('fieldInfo').innerHTML = (F.paced ? `<div><span>Paced by the real sky</span><b>real day & month · eclipses on</b></div><div><span>Moon on its loop</span><b>s ${moonShell().toFixed(2)} · ${Math.round(F.moon.y * MI_PER_UNIT).toLocaleString()} mi${F.moon.layer.dip > 0 ? ' · dipping at a node' : ''}</b></div>`
      : `<div><span>Sun circuit</span><b>${sunH.toFixed(2)} h</b></div><div><span>Moon lag</span><b>${((moonH - sunH) * 60).toFixed(1)} min/day</b></div>`)
    + `<div><span>Season (day ${doy})</span><b>sun ring ${fmtLat(F.sun.lat)}</b></div><div><span>Sun on its loop</span><b>${F.sun.y > c.shellRadii.axisHeight ? 'over the top' : 'underneath'} · ${Math.round(F.sun.y * MI_PER_UNIT).toLocaleString()} mi · ${F.sun.eotMin >= 0 ? '+' : '−'}${Math.abs(F.sun.eotMin).toFixed(1)} min</b></div>`
    + (F.iss.altKm != null ? `<div><span>ISS (${F.iss.nasa ? 'NASA' : 'SGP4'} track)</span><b>shell s ${F.iss.shell.toFixed(3)} · ${F.iss.northbound ? 'underneath, northbound' : 'over the top, southbound'}</b></div>` : `<div><span>ISS shell</span><b>s ${F.iss.shell.toFixed(2)} (${c.issShellRange.join('–')})</b></div>`)
    + `<div><span>Aurora</span><b>ovals round the magnetic poles · Kp ${(F.aurora.intensity * 9).toFixed(1)}</b></div>`;
  for (const d of SHELLS) { const sv = d.s(), el = $(`shS_${d.id}`); if (el) el.textContent = sv == null ? 'not in use' : `s ${sv.toFixed(2)}`; if (d.label) d.label.el.textContent = d.name; }
  $('fieldPill').textContent = state.fieldMode ? 'driving' : 'preview';
}
// ---- the hub torus in 3D: one group per shell (surface + poloidal loops + label), and particles flowing along the field ----
const field3D = new THREE.Group();
field3D.visible = false; scene.add(field3D);
SHELLS.forEach((d, k) => {
  d.G = new THREE.Group(); d.skinG = new THREE.Group(); d.lineG = new THREE.Group(); d.G.add(d.skinG, d.lineG); field3D.add(d.G);
  d.drawn = null; d.key = '';
  d.labelAngle = (200 + k * 13) * Math.PI / 180;      // labels fanned out so they don't overlap
});
// The outer boundary drawn as a vortex: helical bands wrapping the surface that swirl westward round the hub and flow the
// field's way (up the hub, out under the firmament, down at the ice wall, back under the disc), with a glowing rim.
const outerVortexMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color('#ff7ad1') }, uCol2: { value: new THREE.Color('#8fd8ff') } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vec4 w = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-w.xyz); gl_Position = projectionMatrix * w; }`,
  fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uTime; uniform vec3 uCol; uniform vec3 uCol2;
    void main(){
      float u = vUv.x, v = vUv.y, TAU = 6.2831853;
      float b1 = smoothstep(0.62, 1.0, sin(TAU * (6.0 * u + 2.0 * v) - uTime * 0.8));
      float b2 = smoothstep(0.80, 1.0, sin(TAU * (14.0 * u + 4.0 * v) - uTime * 1.5));
      float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
      vec3 col = mix(uCol, uCol2, 0.35 * b2) * (0.55 + 1.1 * b1 + 0.6 * b2) + uCol * rim * 0.9;
      gl_FragColor = vec4(col, 0.05 + 0.32 * b1 + 0.16 * b2 + 0.45 * rim);
    }`,
});
function buildShell(d, sv) {
  for (const G of [d.skinG, d.lineG]) { G.traverse((c) => c.geometry?.dispose()); G.clear(); }
  const col = new THREE.Color(d.col);
  let loop = d.id === 'outer' ? outerLoop(120) : d.id === 'sun' ? sunSlopeLoop(40) : FIELD.poloidalLoop(sv, 120);
  if (d.id === 'iss') { const f = issFieldAt(state.t), g = FIELD.config.shellRadii; if (f) loop = Array.from({ length: 121 }, (_, i) => { const p = Math.PI - i / 120 * Math.PI * 2; return [g.axisRadius + f.tube.w * Math.cos(p), g.axisHeight + f.tube.h * Math.sin(p)]; }); }
  const lathe = new THREE.LatheGeometry(loop.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), d.id === 'outer' ? 240 : 120);
  d.skinG.add(new THREE.Mesh(lathe, d.id === 'outer' ? outerVortexMat : new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: d.skin, side: THREE.DoubleSide, depthWrite: false })));
  d.drawn = sv;
}
function shellLabelPos(d) {   // top of the shell, at the shell's own label angle
  const g = FIELD.config.shellRadii, sv = d.drawn ?? 0, r0 = d.id === 'sun' ? (90 - 23.44) / 180 * R : g.axisRadius, r = r0, y = d.id === 'outer' ? OUTER.b + 0.12 : d.id === 'sun' ? lumAlt(23.44) + 0.15 : g.axisHeight + sv * g.halfHeight + 0.12;
  return new THREE.Vector3(r * Math.cos(d.labelAngle), y, -r * Math.sin(d.labelAngle));
}
SHELLS.filter((d) => !d.noSkin).forEach((d) => { d.label = addLabel(d.name, 'shell', () => shellLabelPos(d), d.G); d.label.el.style.setProperty('--ck', d.col); });   // only shells that still have a surface get a label
function updateField3D(dt) {
  outerVortexMat.uniforms.uTime.value = performance.now() / 1000;
  const g = FIELD.config.shellRadii, gk = JSON.stringify(g) + '|' + SUN_TILT.v, showSkins = true, showLines = false;
  for (const d of SHELLS) {
    const sv = d.s(), on = sv != null && (d.noSkin || shellOn(d)) && !(d.id === 'iss' && !issGroup.visible);
    d.G.visible = on; if (!on) continue;
    if (d.noSkin) { d.skinG.visible = d.lineG.visible = false; d.drawn = sv; d.key = gk; continue; }   // paths only, no surface
    if (d.drawn == null || Math.abs(sv - d.drawn) > 0.004 || d.key !== gk) { d.key = gk; buildShell(d, sv); }
    d.skinG.visible = showSkins; d.lineG.visible = showLines;
  }
}
const moonShell = () => FIELD.shellForDec(lumToriState.moonMaxDec);
// Turnarounds. A body flips from underneath its shell (heading north) to over the top (heading south) at its northern and
// southern turning points. So that its line joins smoothly there, each half-loop runs across the tube between that
// half-loop's actual turning latitudes (c = −1 … +1), not the shell's fixed edges. Ground position is unchanged.
const latOf = (id, t) => (id === 'iss' ? issAt(t)?.lat : subpoint(id === 'sun' ? 'Sun' : 'Moon', t).lat);
const TURN = { sun: { step: DAY, max: 220 * DAY }, moon: { step: 2 * HOUR, max: 20 * DAY }, iss: { step: 60e3, max: 3 * HOUR } };
const CYC = { sun: [], moon: [], iss: [] };
function findTurn(id, t, dir) {   // the first latitude extremum from t in direction dir (+1 future, −1 past)
  const { step, max } = TURN[id], g = (tau) => latOf(id, t + dir * tau);
  let a = 0, ga = g(0), gb = g(step); if (ga == null || gb == null) return null;
  const up = gb > ga;
  for (let tau = step; tau <= max; tau += step) {
    const gn = g(tau + step); if (gn == null) return null;
    if ((gn > gb) !== up) {   // passed the extremum in [tau − step, tau + step]: ternary search
      let lo = Math.max(0, tau - step), hi = tau + step;
      for (let k = 0; k < 40; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3, f1 = g(m1), f2 = g(m2); if ((f1 < f2) === up) lo = m1; else hi = m2; }
      const tt = (lo + hi) / 2; return { t: t + dir * tt, lat: g(tt) };
    }
    gb = gn;
  }
  return null;
}
function cycleAt(id, t) {
  const list = CYC[id]; for (const c of list) if (t >= c.prev.t && t <= c.next.t) return c;
  const prev = findTurn(id, t, -1); if (!prev) return null;
  let next = findTurn(id, prev.t + 1, 1);                                  // from the last turn, the next one is always the opposite kind
  if (next && next.t < t) { const p2 = next; next = findTurn(id, p2.t + 1, 1); if (next) return cycleStore(id, { prev: p2, next }); }
  if (!next) return null;
  return cycleStore(id, { prev, next });
}
function cycleStore(id, c) { const list = CYC[id]; list.push(c); if (list.length > 400) list.shift(); return c; }
/** Across-the-tube coordinate and heading for a body at time t, closing exactly at each turnaround. */
function loopState(id, t, lat) {
  const c = cycleAt(id, t); if (!c) return null;
  const north = c.next.lat > c.prev.lat, span = c.next.lat - c.prev.lat, u = Math.abs(span) < 1e-9 ? 0.5 : (lat - c.prev.lat) / span;
  // continuous through each turnaround: +1 at the northern turning point, −1 at the southern one
  return { north, c: north ? 2 * u - 1 : 1 - 2 * u, cyc: c };
}
function bodyLoopPoint(id, shell, t, lat, lon) {
  const L = loopState(id, t, lat), north = L ? L.north : latOf(id, t + HOUR) >= lat;
  const p = FIELD.onLoop(shell, lat, lon, north, L ? L.c : undefined); p.north = north;
  if (id === 'sun') { const g = latLonToXZ(lat, lon, lumAlt(lat)); p.x = g.x; p.y = g.y; p.z = g.z; p.r = Math.hypot(g.x, g.z); }   // same sloped path in field mode
  return p;
}
/** The Moon's height in paced field mode: on its own loop, lifted just above the Sun's layer as it approaches the Sun,
 *  and drawn down through the Sun's layer only near Rahu/Ketu when it meets the Sun (the eclipse dip, same rule and
 *  constants as the real-astronomy model: 141 of 141 eclipses 2000–2030). */
function fieldMoonLayer(t, sunY, sp, mp, baseY) {
  const sep = gcDeg(sp, mp), safe = Math.max(baseY, sunY * (1 + MOONLAYER.LIFT)), FAR = 15;
  if (sep > FAR) return { y: baseY, dip: 0, sep };
  const L = eclipseLimit(t), near = L.lim + MOONLAYER.BAND;
  if (sep >= near) return { y: baseY + (safe - baseY) * smooth01((FAR - sep) / (FAR - near)), dip: 0, sep, ...L };
  if (sep >= L.lim) { const w = smooth01(1 - (sep - L.lim) / MOONLAYER.BAND); return { y: safe + (sunY - safe) * w, dip: w, sep, ...L }; }
  return { y: sunY * (1 - MOONLAYER.C * Math.pow(L.lim - sep, MOONLAYER.P)), dip: 1, sep, ...L };
}
/** Field positions for time t. sk = an already-computed sky() (saves work in the frame loop). */
function fieldUpdate(t, sk) {
  if (!FIELD_PACE.real) return { ...FIELD.update(t), paced: false };
  const sp = sk ? { lat: sk.sun.lat, lon: sk.sun.lon } : subpoint('Sun', t), mp = sk ? { lat: sk.moon.lat, lon: sk.moon.lon } : subpoint('Moon', t);
  const sN = sk ? sk.sun.rising : subpoint('Sun', t + HOUR).lat >= sp.lat, mN = sk ? sk.moon.rising : subpoint('Moon', t + HOUR).lat >= mp.lat;
  const sun = bodyLoopPoint('sun', FIELD.luminaryShell(), t, sp.lat, sp.lon);
  Object.assign(sun, { rising: sun.north, ringRadius: sun.r, eotMin: wrap180(wrap180(180 - (timeOfDayMs(t) / 3600000) * 15) - sp.lon) * 4 });
  const base = bodyLoopPoint('moon', moonShell(), t, mp.lat, mp.lon), layer = fieldMoonLayer(t, sun.y, sp, mp, base.y);
  return { sun, moon: { ...base, y: layer.y, layer, rising: mN }, iss: issFieldAt(t) || FIELD.issAt(t), aurora: { intensity: Math.max(0, Math.min(1, AURORA.kp / 9)), rings: FIELD.auroraRings() }, paced: true };
}
/** The ISS on the hub torus, from NASA's track (or SGP4 outside NASA's window): the ground position is NASA's exact lat/lon;
 *  it rides the field shell whose lowest point is its real altitude at that moment, going once round that shell's tube per
 *  orbit the way the field circulates — underneath heading north (crossing the equator at its true height), over the top
 *  heading south. Beyond the shell's reach (a degree or so short of 51.6°) it rides the tube's edge. */
function issFieldAt(t, q = issAt(t)) {
  if (!q) return null;
  // The ISS's path in 3D: over the map it is exactly NASA's ground track (latitude/longitude from NASA's orbit file, or
  // SGP4 outside its window); its height rises and falls smoothly with its position along the orbit, u (0 at the
  // northbound equator crossing): at its real altitude crossing the equator northbound, at the tube's middle height at
  // each turn, over the top crossing southbound — y = middle − h·cos u. u is scaled per orbit to that orbit's own turning
  // latitudes, so the line passes smoothly through every turn.
  const g = FIELD.config.shellRadii, inc = (typeof issRec !== 'undefined' && issRec ? rad(issRec.inclo) : 51.64) * Math.PI / 180;
  // Scale by this half-orbit's own measured turning latitudes, so the line passes exactly through each turn (no zigzag).
  const cyc = cycleAt('iss', t), D2R = Math.PI / 180;
  let north = q.vz >= 0, latTop = Math.max(inc / D2R, issView.maxLat || 0), latBot = -latTop;
  if (cyc) { north = cyc.next.lat > cyc.prev.lat; latTop = Math.max(cyc.prev.lat, cyc.next.lat); latBot = Math.min(cyc.prev.lat, cyc.next.lat); }
  const sl = Math.max(-1, Math.min(1, q.lat >= 0 ? Math.sin(q.lat * D2R) / Math.sin(Math.max(1, latTop) * D2R) : -Math.sin(q.lat * D2R) / Math.sin(Math.min(-1, latBot) * D2R))), a = Math.asin(sl);
  const u = north ? a : Math.PI - a;                                                  // argument of latitude
  const node = q.lon * Math.PI / 180 - Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u));
  const altY = (q.altKm / 1.609344) / MI_PER_UNIT, w = Math.max(inc * 180 / Math.PI, issView.maxLat || 0) / 180 * R, h = g.axisHeight - altY;
  const p = latLonToXZ(q.lat, q.lon, g.axisHeight - h * Math.cos(u));                  // NASA's exact ground position, lifted smoothly
  const x = p.x, y = p.y, z = p.z, r = Math.hypot(x, z), th = Math.atan2(-z, x);
  void node;
  return { x, y, z, r, theta: th, lat: q.lat, lon: q.lon, shell: h / g.halfHeight, tube: { w, h }, altKm: q.altKm, northbound: north, nasa: q.src === 'nasa', ground: { lat: q.lat, lon: q.lon } };
}
const fieldIssAt = (t) => (FIELD_PACE.real ? issFieldAt(t) : FIELD.issAt(t));
function fieldSunAt(t) { if (!FIELD_PACE.real) return FIELD.sunAt(t); const sp = subpoint('Sun', t); return bodyLoopPoint('sun', FIELD.luminaryShell(), t, sp.lat, sp.lon); }
function fieldMoonAt(t) {
  if (!FIELD_PACE.real) return FIELD.moonAt(t);
  const sp = subpoint('Sun', t), mp = subpoint('Moon', t), sN = subpoint('Sun', t + HOUR).lat >= sp.lat, mN = subpoint('Moon', t + HOUR).lat >= mp.lat;
  const sunY = bodyLoopPoint('sun', FIELD.luminaryShell(), t, sp.lat, sp.lon).y, base = bodyLoopPoint('moon', moonShell(), t, mp.lat, mp.lon);
  return { ...base, y: fieldMoonLayer(t, sunY, sp, mp, base.y).y };
}
function setFieldMode(on) {
  state.fieldMode = on;
  field3D.visible = on;
  applyAuroraMode(); try { refreshTrails(); } catch {}
  document.body.classList.toggle('field-mode', on);
}
setFieldMode(true);
FIELD_PACE.real = true;   // the field is always paced by the real sky (the only option), so eclipses happen when they really do
$('tFieldIssTrail').onchange = () => {};
FIELD.setConfig({ seasonDay: null }, state.t);   // the season always follows the clock (the frozen-day slider was removed)
FIELD.setConfig({ twistStrength: 1.0 }, state.t);   // twist fixed at its default; field-mode aurora uses the Aurora panel's Kp (sliders removed)
bind('tAurora', (on) => { auroraWanted = on; applyAuroraMode(); });
$('auroraKp').oninput = (e) => { AURORA.kp = +e.target.value; $('auroraKpOut').textContent = `Kp ${AURORA.kp}${AURORA.kp >= 5 ? ' (storm)' : ''}`; auroraAt = -Infinity; };
$('sunTilt').oninput = (e) => {
  SUN_TILT.v = Math.max(SUN_TILT.MIN, Math.min(SUN_TILT.MAX, +e.target.value));
  const hi = lumAlt(23.44) * MI_PER_UNIT, lo = lumAlt(-23.44) * MI_PER_UNIT;
  $('sunTiltOut').textContent = `${SUN_TILT.v}° from vertical${SUN_TILT.v === SUN_PATH_TILT ? ' (default)' : ''}`;
  $('sunTiltInfo').textContent = `Cancer (June, small circle) ${Math.round(hi).toLocaleString()} mi up · equator ${Math.round(SUN_H * MI_PER_UNIT).toLocaleString()} mi · Capricorn (December, big circle) ${Math.round(lo).toLocaleString()} mi up.`;
  buildLumTorus(); try { analemmaData(true); } catch {} try { drawAnalemmaChart(); } catch {}
  SC.buildPortals(); SC.buildJain(); SC.buildHeng();   // Enoch's portals, the Jain circles and the seven heng sit on the Sun's path
  try { scheduleSave(); } catch {}
};
$('sunTilt').oninput({ target: $('sunTilt') });
$('terrExag').oninput = (e) => { TERR.exag = +e.target.value; terrUniforms.uTerrK.value = TERR.exag / 1000 / TERR.KM_PER_UNIT; $('terrExagOut').textContent = `×${TERR.exag}${TERR.exag === 1 ? ' (true scale)' : ''}`; try { scheduleSave(); } catch {} };
$('terrExag').oninput({ target: $('terrExag') });
$('cloudExag').oninput = (e) => { CLOUD.exag = +e.target.value; cloudMat.uniforms.uExag.value = CLOUD.exag; $('cloudExagOut').textContent = `×${CLOUD.exag}${CLOUD.exag === 1 ? ' (true scale)' : ''}`; try { scheduleSave(); } catch {} };
$('cloudExag').oninput({ target: $('cloudExag') });
bind('tClouds', () => {});
$('auroraExag').oninput = (e) => { AURORA.exag = +e.target.value; $('auroraExagOut').textContent = `×${AURORA.exag}${AURORA.exag === 1 ? ' (true scale)' : ''}`; auroraAt = -Infinity; };
$('auroraKpOut').textContent = `Kp ${AURORA.kp}`; $('auroraExagOut').textContent = `×${AURORA.exag}`;
$('pattern').onchange = (e) => { curPattern = e.target.value; buildTrace(curPattern); };
$('overlaySel').onchange = (e) => { curOverlay = e.target.value; buildOverlay(curOverlay); };
$('patternTop').onclick = () => setView('top');
$('patZ').oninput = (e) => { patternState.zExag = +e.target.value; $('patZOut').textContent = `×${patternState.zExag}`; if (['venus', 'mercury', 'mars', 'jupiter', 'saturn'].includes(curPattern)) buildTrace(curPattern); };
$('patZOut').textContent = `×${patternState.zExag}`;
buildTrace('none');
buildTrailControls();
function syncIssModeUI() {}   // one ISS shape now: the 3D torus (the Donut / Real-altitude / exaggeration controls were merged away)
syncIssModeUI();
$('trailsReset').onclick = () => { for (const tr of TRAILS) tr.len = tr.def; buildTrailControls(); scheduleSave(); };
bind('tPath', (on) => { paths.visible = on; nightMat.uniforms.uOutline.value = on ? 1 : 0; });
bind('tLabels', (on) => (labelsEl.style.display = on ? '' : 'none'));
bind('tGrid', (on) => { state.showGrid = on; drawMap(); });
bind('tLight', (on) => { sunLight.visible = moonLight.visible = on; nightMat.uniforms.uOn.value = on ? 1 : 0; terrUniforms.uSunOn.value = cloudMat.uniforms.uSunOn.value = on ? 1 : 0; });   // off: no sunlight, night or shadows anywhere
const btnPlay = $('btnPlay');
function setPlaying(p) { state.playing = p; btnPlay.textContent = p ? '❚❚' : '▶'; try { scheduleSave(); } catch {} }
btnPlay.onclick = () => setPlaying(!state.playing);
$('btnNow').onclick = () => { state.t = Date.now(); $('speed').value = '1'; state.speed = 1; setPlaying(true); };
$('speed').onchange = (e) => (state.speed = +e.target.value);
addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); setPlaying(!state.playing); } });
const doyIn = $('doy'), todIn = $('tod');
let scrubbing = false;
function setFromSliders() { state.t = yearStart(state.t) + (+doyIn.value - 1) * DAY + +todIn.value * 60000; }
for (const el of [doyIn, todIn]) { el.addEventListener('input', () => { scrubbing = true; setFromSliders(); }); el.addEventListener('change', () => (scrubbing = false)); }
document.querySelectorAll('.presets button').forEach((b) => b.addEventListener('click', () => {
  const [m, d] = b.dataset.date.split('-').map(Number);
  state.t = Date.UTC(new Date(state.t).getUTCFullYear(), m - 1, d, 12, 0);
  setPlaying(false);
}));
$('sunAlt').textContent = `~${SUN_ALT_MI.toLocaleString()} mi`;
$('lumDiam').textContent = `~${LUMINARY_DIAM_MI} mi`;
$('lightR').textContent = 'real daylight (or Gleason)';
$('poleWall').textContent = `${Math.round(180 * MI_PER_DEG).toLocaleString()} mi`;
$('equatorC').textContent = `${Math.round(2 * Math.PI * R / 2 * MI_PER_UNIT).toLocaleString()} mi`;
$('rimC').textContent = `${Math.round(2 * Math.PI * R * MI_PER_UNIT).toLocaleString()} mi`;

// wandering-star list
const wsRows = ['Sun', 'Moon', ...PLANETS.map((p) => p.name)].map((name) => {
  const p = PLANETS.find((x) => x.name === name);
  const row = document.createElement('div'); row.className = 'ws';
  const glyph = name === 'Sun' ? '☉' : name === 'Moon' ? '☾' : p.glyph;
  const color = name === 'Sun' ? '#ffd56b' : name === 'Moon' ? '#c9d6ea' : p.color;
  row.innerHTML = `<i style="background:${color}"></i><span class="g">${glyph}</span><span class="n">${name}</span><b></b><em></em>`;
  $('wanderers').appendChild(row);
  return { name, b: row.querySelector('b'), em: row.querySelector('em') };
});

// ---------- 2D canvases ----------
function fitCanvas(cv) {
  const d = Math.min(devicePixelRatio, 2), r = cv.getBoundingClientRect();
  if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
  return [ctx, r.width, r.height];
}
const shadeCanvas = document.createElement('canvas'), mini = $('minimap');
function drawMinimap(S, M) {
  const [ctx, w] = fitCanvas(mini);
  const c = w / 2, po = w / 2 - 3, k = po / R_OUT, pr = R * k;
  const xy = (lat, lon) => { const p = latLonToXZ(lat, lon); return [c + p.x * k, c + p.z * k]; };
  ctx.clearRect(0, 0, w, w);
  ctx.save(); ctx.beginPath(); ctx.arc(c, c, po, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(mapCanvas, c - po, c - po, po * 2, po * 2);
  ctx.drawImage(gridCanvas, c - po, c - po, po * 2, po * 2);
  const N = 160; shadeCanvas.width = shadeCanvas.height = N;
  const s = shadeCanvas.getContext('2d'), img = s.createImageData(N, N), scale = (2 * R_OUT) / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * scale - R_OUT, z = (j + 0.5) * scale - R_OUT;
    if (Math.hypot(x, z) > R) continue;
    const ll = xzToLatLon(x, z), L = lightShade(ll.lat, ll.lon, S.lat, S.lon), o = (j * N + i) * 4;
    const sp = L.spot || 0;
    img.data[o] = 2 + 200 * L.glow + 253 * sp; img.data[o + 1] = 5 + 90 * L.glow + 225 * sp; img.data[o + 2] = 18 + 140 * sp; img.data[o + 3] = 255 * Math.max(L.alpha, L.glow * 0.2, sp * 0.18);
  }
  s.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(shadeCanvas, c - po, c - po, po * 2, po * 2);
  const [sx, sy] = xy(S.lat, S.lon);
  ctx.restore();
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,213,107,.85)'; ctx.beginPath(); ctx.arc(c, c, (90 - S.lat) / 180 * R * k, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(180,195,255,.6)'; ctx.beginPath(); ctx.arc(c, c, (90 - M.lat) / 180 * R * k, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  const [mx, my] = xy(M.lat, M.lon);
  ctx.drawImage(moonCanvas, mx - 8, my - 8, 16, 16);
  // same disc radius as the moon icon (16 px image, disc = 54/64 of its half-width)
  const discR = 8 * 54 / 64, sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, discR);
  sg.addColorStop(0, '#fffbe6'); sg.addColorStop(0.7, '#ffe08a'); sg.addColorStop(1, '#ffc24a');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, discR, 0, Math.PI * 2); ctx.fill();
  const [px, py] = xy(state.pin.lat, state.pin.lon);
  ctx.fillStyle = '#ff5d73'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
mini.addEventListener('click', (e) => {
  const r = mini.getBoundingClientRect(), c = r.width / 2, k = (c - 3) / R_OUT;
  const x = (e.clientX - r.left - c) / k, z = (e.clientY - r.top - c) / k;
  if (Math.hypot(x, z) <= R) { const ll = xzToLatLon(x, z); setPin(ll.lat, ll.lon); }
});

const dayCurveCache = new Map();
const chart = $('chart'), MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];   // the chart's year starts at the March equinox
function drawChart(doy) {
  const [ctx, w, h] = fitCanvas(chart);
  const L = 26, T = 8, Rr = 6, narrow = (w - L - Rr) / 12 < 30, B = narrow ? 30 : 18, pw = w - L - Rr, ph = h - T - B;   // narrow: month names on two rows
  const X = (d) => L + (d - 1) / 364 * pw, Y = (hr) => T + (1 - hr / 24) * ph;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '10px system-ui'; ctx.fillStyle = '#8d9bc2'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(140,170,255,.12)'; ctx.lineWidth = 1;
  for (const hr of [0, 6, 12, 18, 24]) { ctx.beginPath(); ctx.moveTo(L, Y(hr)); ctx.lineTo(w - Rr, Y(hr)); ctx.stroke(); ctx.fillText(`${hr}h`, L - 4, Y(hr)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  // month names at the 15th of each month (short names when there is room, initials when narrow), counted from 21 March,
  // with a faint line where each month begins
  const dayOf = (mo, dd) => (Date.UTC(mo < 3 ? 2001 : 2000, mo, dd) - Date.UTC(2000, 2, 21)) / DAY + 1;
  ctx.save(); ctx.strokeStyle = 'rgba(140,170,255,.10)';
  for (let i = 0; i < 12; i++) { const x = X(dayOf((3 + i) % 12, 1)); if (x > L) { ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); } }
  ctx.restore();
  MONTHS.forEach((m, i) => { const half = ctx.measureText(m).width / 2 + 1, x = Math.min(w - half, Math.max(L + half, X(dayOf((3 + i) % 12, 15)))); ctx.fillText(m, x, h - B + 4 + (narrow && i % 2 ? 12 : 0)); });   // full short names, kept inside the chart; staggered when narrow
  const ys0 = yearStart(state.t), lonP = state.pin.lon;   // day length from the real Sun's declination at local noon each day
  const curve = (lat) => { const lon = lat === 0 ? 0 : lonP, key = `${ys0}:${lat.toFixed(2)}:${lon.toFixed(1)}`; if (!dayCurveCache.has(key)) { const a = []; for (let d = 1; d <= 365; d++) a.push(dayHours(lat, subpoint('Sun', ys0 + (d - 1) * DAY + (12 - lon / 15) * HOUR).lat)); dayCurveCache.set(key, a); if (dayCurveCache.size > 8) dayCurveCache.delete(dayCurveCache.keys().next().value); } return dayCurveCache.get(key); };
  const trace = (lat) => { const a = curve(lat); ctx.beginPath(); for (let d = 1; d <= 365; d++) { const y = Y(a[d - 1]); d === 1 ? ctx.moveTo(X(d), y) : ctx.lineTo(X(d), y); } };
  trace(0); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#7f8db5'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  trace(state.pin.lat); ctx.lineTo(X(365), Y(0)); ctx.lineTo(X(1), Y(0)); ctx.closePath();
  const g = ctx.createLinearGradient(0, T, 0, T + ph); g.addColorStop(0, 'rgba(255,93,115,.28)'); g.addColorStop(1, 'rgba(255,93,115,0)');
  ctx.fillStyle = g; ctx.fill();
  trace(state.pin.lat); ctx.strokeStyle = '#ff5d73'; ctx.stroke();
  const hrs = curve(state.pin.lat)[Math.min(364, doy - 1)];
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(doy), T); ctx.lineTo(X(doy), T + ph); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(doy), Y(hrs), 3.5, 0, Math.PI * 2); ctx.fill();
  const below = Y(hrs) < T + 16;
  ctx.textAlign = X(doy) > w - 60 ? 'right' : 'left'; ctx.textBaseline = below ? 'top' : 'bottom'; ctx.font = '600 11px system-ui';
  ctx.fillText(`${hrs.toFixed(1)} h`, X(doy) + (ctx.textAlign === 'left' ? 6 : -6), Y(hrs) + (below ? 4 : -3));
}

// ---------- Main loop ----------
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage);
resize();

let lastZodiacT = -Infinity;
let last = performance.now(), lastPanel = 0, lastMoonAge = -1, lastTrail = 0, lastEps = 0, SKY = sky(state.t);
const sunGround = new THREE.Vector3(), v1 = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state.playing && !scrubbing) state.t += dt * 1000 * state.speed;
  SKY = sky(state.t);
  const FLD = state.fieldMode ? fieldUpdate(state.t, SKY) : null;
  if (FLD && !FLD.paced) {   // torus-field mode on pure rules: the field decides where the sun and moon are; everything downstream reads SKY as usual
    SKY.sun = { ...SKY.sun, lat: FLD.sun.lat, lon: FLD.sun.lon, dec: FLD.sun.lat, rising: FLD.sun.rising };
    SKY.moon = { ...SKY.moon, lat: FLD.moon.lat, lon: FLD.moon.lon, dec: FLD.moon.lat, rising: FLD.moon.rising, age: FLD.moon.age, illum: FLD.moon.illum };
  }
  const S = SKY.sun, M = SKY.moon;

  latLonToXZ(S.lat, S.lon, FLD ? FLD.sun.y : bodyHeight('Sun', S.dec, S.rising), sun.position);
  terrUniforms.uRealSun.value.set(deg(S.lat), deg(S.lon)); terrUniforms.uSunRad.value.copy(sunLight.color).multiplyScalar(sunLight.intensity);
  if (now - (sunLampAt || 0) > 500) {   // the lamp (lights the ice wall and other 3D objects) reaches every place in real daylight
    sunLampAt = now; const g = latLonToXZ(S.lat, S.lon, 0); let dmax = 0;
    for (let la = -89; la <= 89; la += 2) for (let lo = -180; lo < 180; lo += 3) if (sunElevation(la, lo, S.lat, S.lon) > -0.833) { const q = latLonToXZ(la, lo, 0); dmax = Math.max(dmax, Math.hypot(q.x - g.x, q.z - g.z)); }
    sunLampR = dmax + 0.6;
  }
  sunLight.angle = Math.min(Math.PI / 2 - 0.005, Math.atan((sunLampR || LIGHT_R * 1.12) / Math.max(0.05, sun.position.y)));
  latLonToXZ(S.lat, S.lon, 0, sunGround);
  sunLight.position.copy(sun.position); sunTarget.position.copy(sunGround);
  ECL.layer = FLD ? (FLD.paced ? FLD.moon.layer : { y: FLD.moon.y, dip: 0, sep: 180 }) : moonLayer(state.t, sun.position.y, { lat: S.lat, lon: S.lon }, { lat: M.lat, lon: M.lon }, M.rising);
  latLonToXZ(M.lat, M.lon, ECL.layer.y, moon.position);
  ensureEclipses(state.t);
  ECL.info = (!FLD || FLD.paced) && ECL.layer.dip > 0 ? solarGeometry(sun.position, moon.position, ECL.layer) : null;
  moon.scale.setScalar(ECL.info ? 1 + (ECL.info.ratio * Math.min(1, ECL.info.k) - 1) * ECL.layer.dip : 1);   // true size ratio as seen from the shadow
  { const f = OBS.active ? (LUMINARY_DIAM_MI / MI_PER_UNIT) / LUM_DISC : 1; sun.scale.setScalar(f); moon.scale.multiplyScalar(f); }   // true size from the ground
  nightMat.uniforms.uEcl.value = ECL.info ? 1 : 0;
  if (ECL.info) { nightMat.uniforms.uSunP.value.copy(sun.position); nightMat.uniforms.uMoonP.value.copy(moon.position); nightMat.uniforms.uLumR.value.set(ECL.info.sunR, ECL.info.moonR); }
  if (FLD && !FLD.paced) ECL.lunarInfo = null;   // pure field rules: no eclipses
  else { const L = lunarModel({ lat: S.lat, lon: S.lon }, { lat: M.lat, lon: M.lon }, state.t); ECL.lunarInfo = L.d < 400 ? L : null; }
  if (nodeG.visible) updateNodes(now, S);
  const lunarBright = applyLunar(ECL.lunarInfo);
  moonLight.position.copy(moon.position); moonTarget.position.set(moon.position.x, 0, moon.position.z);
  { const g = gleasonShape(gleasonF(S.dec)); nightMat.uniforms.uMode.value = 0; nightMat.uniforms.uSunDec.value = deg(S.dec); nightMat.uniforms.uSunLon.value = deg(S.lon); cloudMat.uniforms.uSunDec.value = deg(S.dec); cloudMat.uniforms.uSunLon.value = deg(S.lon); cloudMat.uniforms.uSunPos.value.copy(sun.position); nightMat.uniforms.uShapeA.value.set(g.cx, g.aIn, g.aOut, g.by); nightMat.uniforms.uShapeB.value.set(g.nIn, g.nOut); }
  nightMat.uniforms.uMoon.value.set(moon.position.x, moon.position.z);
  nightMat.uniforms.uMoonI.value = M.illum * lunarBright;
  const rs = (90 - S.lat) / 180 * R, rm = (90 - M.lat) / 180 * R;
  sunPath.scale.set(rs, 1, rs); moonPath.scale.set(rm, 1, rm);
  sunPath.position.y = sun.position.y; moonPath.position.y = moon.position.y;
  if (Math.abs(M.age - lastMoonAge) > 0.05) { drawMoon(M.age); lastMoonAge = M.age; }

  // firmament turns westward once per sidereal day
  firmament.rotation.y = -deg(SKY.gmst);
  if (Math.abs(SKY.eps - lastEps) > 0.0005 || Math.abs(state.t - lastZodiacT) > 30 * DAY) { buildZodiac(state.t); lastEps = SKY.eps; lastZodiacT = state.t; }
  skyPos(S.ra, S.dec, 0.975, sunMarker.position);
  SKY.planets.forEach((p, i) => skyPos(p.ra, p.dec, 0.965, planetSprites[i].position));
  firmament.updateMatrixWorld();
  const sl = signLineGeo.attributes.position;
  sunMarker.getWorldPosition(v1);
  sl.setXYZ(0, sun.position.x, sun.position.y, sun.position.z); sl.setXYZ(1, v1.x, v1.y, v1.z); sl.needsUpdate = true; signLine.computeLineDistances();

  // electromagnetic field flow
  anaGroup.visible = anaWanted;   // the labelled analemma, in the one combined mode
  lumTorus.visible = anaWanted;
  if (anaGroup.visible) { if (now - anaState.lastBuild > 250) { analemmaData(); anaState.lastBuild = now; } placeSunAnalemma(); }
  if (now - lastTrail > 100) { updateAllTrails(state.t); lastTrail = now; }
  if (issGroup.visible) updateISSReal(state.t); else issModel.visible = false;
  if (chakraG.visible) updateChakras(dt, now);
  if (yinYang.visible) updateYinYang(SKY.sun, SKY.moon);
  if (SC.sel !== 'none') updateScripture(SKY.sun);
  auroraMat.uniforms.uTime.value = now / 1000;
  if (now - auroraAt > 50) {
    if (auroraN.visible) { auroraAt = now; drawAurora(auroraN, 'N', S, AURORA.kp, now / 1000); }
    if (FLD && auroraFieldN.visible) { const kp = FLD.aurora.intensity * 9; auroraAt = now; drawAurora(auroraFieldN, 'N', S, kp, now / 1000); drawAurora(auroraFieldS, 'S', S, kp, now / 1000); }
  }
  if (FLD) issLabel.el.textContent = FLD.iss.altKm != null ? `🛰 ISS · NASA track on shell s ${FLD.iss.shell.toFixed(3)} · real altitude ${Math.round(FLD.iss.altKm / 1.609344)} mi` : `🛰 ISS · field shell s ${FLD.iss.shell.toFixed(2)}, ${Math.round(FLD.iss.y * MI_PER_UNIT).toLocaleString()} mi`;
  else if (ISS) issLabel.el.textContent = `🛰 ISS · real altitude ${Math.round(ISS.altKm / 1.609344)} mi`;
  if (field3D.visible) updateField3D(dt);
  if (fieldViews.on && document.visibilityState === 'visible') drawFieldViews(now, FLD || fieldUpdate(state.t, SKY));

  const sp = sightGeo.attributes.position;
  sp.setXYZ(0, pin.position.x, 0.52, pin.position.z); sp.setXYZ(1, sun.position.x, sun.position.y, sun.position.z);
  sp.needsUpdate = true; sight.computeLineDistances();
  domeMat.uniforms.uTime.value = now / 1000;

  if (tween) {
    const k = Math.min(1, (now - tween.start) / tween.ms), e = ease(k);
    camera.position.lerpVectors(tween.from, tween.to, e);
    controls.target.lerpVectors(tween.tf, tween.tt, e);
    if (k >= 1) { tween = null; scheduleSave(); }
  } else if (state.view === 'follow') {
    const dir = sunGround.clone(); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    camera.position.lerp(sunGround.clone().addScaledVector(dir, 7).setY(7), 0.05);
    controls.target.lerp(sunGround, 0.08);
  }
  if (OBS.active) updateObserver(now); else {
    controls.update();
    const dn = camera.position.distanceTo(controls.target), nr = Math.min(0.05, Math.max(0.000002, dn * 0.04));   // near plane follows zoom (down to metres, for the real-size ISS)
    if (Math.abs(camera.near - nr) > nr * 0.05) { camera.near = nr; camera.updateProjectionMatrix(); }
  }
  satUpdate(now);
  if (now - (updateScaleBar.at || 0) > 120) { updateScaleBar.at = now; updateScaleBar(); }
  cloudTick(now);
  renderer.render(scene, camera);
  updateLabels();
  if (now - lastPanel > 150) { lastPanel = now; updatePanels(S, M); }
  requestAnimationFrame(frame);
}

function updatePanels(S, M) {
  { const el = $('auroraSrc'); if (el) el.textContent = AURORA_LIVE.src || 'loading NOAA aurora data…'; }
  try { fieldReadout(); } catch (err) { console.warn(err); }
  try { eclipsePanel(sun.position, moon.position); } catch (err) { console.warn(err); }
  const altS = Math.round(sun.position.y * MI_PER_UNIT), altM = Math.round(moon.position.y * MI_PER_UNIT);
  $('sunAlt').textContent = `${altS.toLocaleString()} / ${altM.toLocaleString()} mi`;
  if (ISS) {
    $('issPos').textContent = `${fmtLat(ISS.lat)} ${fmtLon(ISS.lon)}`;
    $('issAlt').textContent = `${Math.round(ISS.altKm / 1.609344).toLocaleString()} mi`;
    $('issSpd').textContent = `${Math.round(ISS.kms * 2236.94).toLocaleString()} mph`;
    $('issRev').textContent = (issRec.no * 1440 / (2 * Math.PI)).toFixed(2);
    const inNasa = ISS.src === 'nasa', fmtD = (ms) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
    const ageDays = nasa ? (state.t > nasa.stop ? (state.t - nasa.stop) / DAY : state.t < nasa.start ? (nasa.start - state.t) / DAY : 0) : Math.abs(state.t - tleEpochMs()) / DAY;
    $('issSrc').textContent = inNasa ? nasa.source : `${issSource}${nasa ? ' · beyond NASA data' : ''}`;
    $('issNasa').textContent = nasa ? `${fmtD(nasa.start)} → ${fmtD(nasa.stop)} UTC` : 'not loaded (using TLE)';
    const tleAge = Math.abs(state.t - tleEpochMs()) / DAY;
    $('issEpoch').textContent = `${fmtD(tleEpochMs())} UTC · ${tleAge < 2 ? `${(tleAge * 24).toFixed(1)} h` : `${tleAge.toFixed(1)} d`} ${state.t >= tleEpochMs() ? 'old' : 'ahead'}`;
    // Fitted to a point-by-point comparison with NASA/JSC's official ISS ephemeris (Nov 2026): RMS map error
    // ≈ 0.5 km at the TLE epoch, ~1 km at 1 day, ~6 km at 4 days, ~30 km at 8–9 days, ~80 km at 13 days (mostly along-track).
    $('issAcc').textContent = inNasa ? 'follows NASA within ~50 m' : ageDays > 14 ? 'low: far from orbit data' : `±${(e => e < 10 ? e.toFixed(1) : Math.round(e))(0.45 + 0.35 * ageDays ** 2 + 0.012 * ageDays ** 3)} km (vs NASA)`;
    $('issAcc').style.color = ageDays > 3 ? '#ff9d7a' : '';
  }
  drawIssAlt(state.t);
  drawAnalemmaChart();
  {
    const pts = analemmaData(), maxLat = issView.maxLat || issIncDeg();
    const decs = pts.map((q) => q.lat), lo = Math.min(...decs), hi = Math.max(...decs), inBand = hi <= maxLat && lo >= -maxLat;
    const sunMi = sun.position.y * MI_PER_UNIT;
      const issMi = ISS ? ISS.altKm / 1.609344 : (issView.baseKm / 1.609344);
      $('anaBand').textContent = `${inBand ? '✓ Inside' : '✗ Outside'} the ISS orbit band: the sun stays within ${hi.toFixed(2)}°N–${Math.abs(lo).toFixed(2)}°S; the ISS covers ${maxLat.toFixed(2)}°N–${maxLat.toFixed(2)}°S. Sun now ${Math.round(sunMi).toLocaleString()} mi up, ${Math.round(sunMi - issMi).toLocaleString()} mi above the ISS (${Math.round(issMi)} mi). Tilt ${SUN_TILT.v}° from vertical.`;
  }
  const d = new Date(state.t), doy = dayOfYear(state.t);
  $('clockDate').textContent = d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  $('clockTime').textContent = d.toISOString().slice(11, 19);
  if (!scrubbing) { doyIn.value = doy; todIn.value = d.getUTCHours() * 60 + d.getUTCMinutes(); }
  $('doyOut').textContent = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} · #${doy}`;
  $('todOut').textContent = d.toISOString().slice(11, 16);

  $('sunPos').textContent = fmtLat(S.lat);
  $('sunPos2').textContent = `${fmtLon(S.lon)} · ${fmtMi((90 - S.lat) / 180 * R)} from pole`;
  $('moonPhase').textContent = phaseName(M.age);
  $('moonIllum').textContent = `${Math.round(M.illum * 100)}% · day ${M.age.toFixed(1)} · self-lit`;
  const inward = S.lam > 270 || S.lam < 90;
  $('season').textContent = Math.abs(S.dec) > 22.5 ? (S.dec > 0 ? 'Inner circuit' : 'Outer circuit') : inward ? 'Spiralling inward' : 'Spiralling outward';
  $('decl').textContent = `radius ${fmtMi((90 - S.dec) / 180 * R)} · δ ${S.dec.toFixed(1)}°`;
  const ss = signOf(S.lam);
  $('sunSign').textContent = `${ss.glyph} ${ss.name}`;
  $('sunSign2').textContent = `${ss.deg.toFixed(1)}° · star wheel ${Math.round(SKY.gmst)}°`;

  const bodies = { Sun: S, Moon: M };
  SKY.planets.forEach((p) => (bodies[p.name] = p));
  for (const r of wsRows) {
    const b = bodies[r.name], sg = signOf(b.lam);
    r.b.textContent = `${sg.glyph} ${sg.name} ${Math.floor(sg.deg)}°`;
    if (PLANETS.some((p) => p.name === r.name)) r.em.textContent = wrap180(bodyAt(r.name, state.t + DAY / 4).lam - b.lam) < 0 ? 'retrograde' : '';
  }

  const P = state.pin, pp = latLonToXZ(P.lat, P.lon), sg = latLonToXZ(S.lat, S.lon), dist = pp.distanceTo(sg);
  if (P.hidden) { $('pinPlace').textContent = 'none'; for (const id of ['pinLat', 'pinLon', 'pinTime', 'pinSun', 'pinDist', 'pinElev']) $(id).textContent = '—'; }
  else {
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
  const lmt = ((hours + P.lon / 15) % 24 + 24) % 24, lst = ((12 + wrap180(P.lon - S.lon) / 15) % 24 + 24) % 24;   // sundial: 12:00 when the Sun crosses the meridian
  $('pinPlace').textContent = P.name;
  $('pinLat').textContent = fmtLat(P.lat);
  $('pinLon').textContent = fmtLon(P.lon);
  const hm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`, eotM = Math.round(wrap180((lst - lmt) * 15) * 4);
  $('pinTime').textContent = `${hm(lst)} (mean ${hm(lmt)}, ${eotM >= 0 ? '+' : '−'}${Math.abs(eotM)} min)`;
  $('pinSun').textContent = daylightState(P.lat, P.lon, S.lat, S.lon);
  $('pinDist').textContent = fmtMi(dist);
  $('pinElev').textContent = `${sunElevation(P.lat, P.lon, S.lat, S.lon).toFixed(1)}°`;
  pinLabel.el.textContent = P.name === 'Custom' ? `${fmtLat(P.lat)}, ${fmtLon(P.lon)}` : P.name;
  }
  drawMinimap(S, M);
  drawChart(doy);
}

// ---------- Settings: saved automatically, restored on reload, exportable ----------
const SETTINGS_KEY = 'firmament.settings.v1';
let settingsReady = false, saveTimer = null;
function collectSettings() {
  const toggles = {};
  document.querySelectorAll('aside input[type=checkbox][id]').forEach((el) => (toggles[el.id] = el.checked));
  return {
    app: 'firmament', version: 12, savedAt: new Date().toISOString(), toggles,
    speed: state.speed, playing: state.playing, pin: state.pin,

    mapStyle: state.mapStyle, cloudExag: CLOUD.exag, terrExag: TERR.exag, sunTilt: SUN_TILT.v, auroraKp: AURORA.kp, auroraExag: AURORA.exag, patZ: patternState.zExag,
    pattern: curPattern, overlay: curOverlay, scripture: SC.sel,
    trails: Object.fromEntries(TRAILS.map((t) => [t.key, t.len])),
    view: state.view, camera: { pos: camera.position.toArray(), target: controls.target.toArray() },
  };
}
function applySettings(c) {
  if (!c || c.app !== 'firmament') return false;
  if (!(c.version >= 12) && c.toggles) { c = { ...c, toggles: { ...c.toggles } }; delete c.toggles.tISS; }   // v12: the ISS starts off
  if (!(c.version >= 11)) { c = { ...c }; delete c.terrExag; delete c.cloudExag; }   // v11: terrain ×50 and clouds ×30 by default
  if (!(c.version >= 10) && c.toggles) { c = { ...c, toggles: { ...c.toggles } }; delete c.toggles.tPath; }   // v10: Sun & Moon circuits and trails start off
  if (!(c.version >= 9) && c.toggles) { c = { ...c, toggles: { ...c.toggles } }; delete c.toggles.tNodes; }   // v9: Rahu & Ketu start off
  if (!(c.version >= 8) && c.toggles) { c = { ...c, toggles: { ...c.toggles } }; delete c.toggles.tStars; }   // v8: star wheel starts off
  if (!(c.version >= 7) && c.toggles) { c = { ...c, toggles: { ...c.toggles } }; delete c.toggles.tChakras; delete c.toggles.tYinYang; }   // v7: chakras and Yin & Yang start off
  if (!(c.version >= 5) && c.toggles) { c = { ...c, toggles: { ...c.toggles } }; delete c.toggles.tPathAuto; delete c.toggles.tFieldPace; }   // v5: path-repeat off by default; pacing always on
  if (!(c.version >= 4) && c.toggles) { c = { ...c, toggles: { ...c.toggles } }; delete c.toggles.tField; delete c.toggles.tLumTori; }
  if (!(c.version >= 3)) { // ISS view defaults changed (donut sized to hold the analemma): use the new defaults
    c = { ...c }; delete c.issMode; delete c.issExag; delete c.issTube; if (c.toggles) { c.toggles = { ...c.toggles }; delete c.toggles.tIssTorus; }
  }
  for (const [id, on] of Object.entries(c.toggles || {})) {
    const el = $(id);
    if (el && el.type === 'checkbox' && el.checked !== !!on) { el.checked = !!on; el.onchange?.(); }
  }
  if (c.speed && [...$('speed').options].some((o) => +o.value === +c.speed)) { state.speed = +c.speed; $('speed').value = String(c.speed); }
  if (typeof c.playing === 'boolean') setPlaying(c.playing);
  if (c.pin && Number.isFinite(c.pin.lat) && Number.isFinite(c.pin.lon)) { setPin(c.pin.lat, c.pin.lon, c.pin.name); if (c.pin.hidden || !(c.version >= 6)) clearPin(); }   // v6: the pin starts cleared
  if (c.mapStyle) { $('mapStyle').value = c.mapStyle; $('mapStyle').onchange({ target: $('mapStyle') }); }
  if (Number.isFinite(c.auroraKp)) { $('auroraKp').value = c.auroraKp; $('auroraKp').oninput({ target: $('auroraKp') }); }
  if (Number.isFinite(c.sunTilt)) { $('sunTilt').value = c.sunTilt; $('sunTilt').oninput({ target: $('sunTilt') }); }
  if (Number.isFinite(c.terrExag)) { $('terrExag').value = c.terrExag; $('terrExag').oninput({ target: $('terrExag') }); }
  if (Number.isFinite(c.cloudExag)) { $('cloudExag').value = c.cloudExag; $('cloudExag').oninput({ target: $('cloudExag') }); }
  if (Number.isFinite(c.auroraExag)) { $('auroraExag').value = c.auroraExag; $('auroraExag').oninput({ target: $('auroraExag') }); }
  if (Number.isFinite(c.patZ)) { $('patZ').value = c.patZ; $('patZ').oninput({ target: $('patZ') }); }
  if (c.trails) { for (const tr of TRAILS) { const v = c.trails[tr.key]; if (TRAIL_STEPS[tr.steps].includes(v)) tr.len = v; } buildTrailControls(); }
  if (c.pattern && PATTERNS[c.pattern]) { $('pattern').value = c.pattern; curPattern = c.pattern; buildTrace(curPattern); }
  if (c.scripture && [...$('scriptureSel').options].some((o) => o.value === c.scripture)) { $('scriptureSel').value = c.scripture; setScripture(c.scripture); }
  if (c.overlay && [...$('overlaySel').options].some((o) => o.value === c.overlay)) { $('overlaySel').value = c.overlay; curOverlay = c.overlay; buildOverlay(curOverlay); }
  if (Array.isArray(c.camera?.pos) && Array.isArray(c.camera?.target)) { tween = null; camera.position.fromArray(c.camera.pos); controls.target.fromArray(c.camera.target); controls.update(); }
  if (c.view === 'follow') setView(c.view);
  else if (c.view) { state.view = c.view; document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === c.view)); }
  return true;
}
function saveSettingsNow() {
  if (!settingsReady) return;
  const data = JSON.stringify(collectSettings());
  try { localStorage.setItem(SETTINGS_KEY, data); } catch {}
  try { globalThis.chrome?.storage?.local?.set({ [SETTINGS_KEY]: data }); } catch {}
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSettingsNow, 400); }
async function loadSavedSettings() {
  let raw = null;
  try { raw = localStorage.getItem(SETTINGS_KEY); } catch {}
  if (!raw && globalThis.chrome?.storage?.local) { try { raw = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]; } catch {} }
  if (!raw) { try { const old = JSON.parse(localStorage.getItem('firmamentTrails') || 'null'); if (old) raw = JSON.stringify({ app: 'firmament', version: 1, trails: old }); } catch {} }
  if (raw) { try { applySettings(JSON.parse(raw)); } catch {} }
  settingsReady = true;
}
document.addEventListener('change', scheduleSave);
document.addEventListener('input', scheduleSave);
controls.addEventListener('end', scheduleSave);
addEventListener('pagehide', saveSettingsNow);
$('cfgSave').onclick = () => {
  const blob = new Blob([JSON.stringify(collectSettings(), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `heavens-and-earth-settings-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('cfgMsg').textContent = 'Settings file saved to your downloads.';
};
$('cfgLoad').onclick = () => $('cfgFile').click();
$('cfgFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const ok = applySettings(JSON.parse(await f.text()));
    $('cfgMsg').textContent = ok ? `Loaded “${f.name}”.` : 'That file isn’t a Heavens & Earth settings file.';
    if (ok) saveSettingsNow();
  } catch { $('cfgMsg').textContent = 'Couldn’t read that file (not valid JSON).'; }
};
$('cfgReset').onclick = async () => {
  if (!confirm('Reset every setting to its default? Your saved settings will be cleared (files you saved are kept).')) return;
  settingsReady = false;
  try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem('firmamentTrails'); } catch {}
  try { await globalThis.chrome?.storage?.local?.remove(SETTINGS_KEY); } catch {}
  location.reload();
};
loadSavedSettings();

window.__firmament = { SC, setScripture, trace: () => trace, buildTrace: (k) => buildTrace(k), issModel, ISS_FOLLOW, issRealY, updateISSReal, useNASA: (txt, src) => useNASA(txt, src), useTLE: (a, b, src) => useTLE(a, b, src), issFieldNow: () => issFieldAt(state.t), yinYang, MEAS_MI_PER_UNIT, MEAS, measureClick, gcMiles, updateScaleBar, sunLamp: () => ({ angleDeg: sunLight.angle * 180 / Math.PI, poolR: sunLampR, pos: sunLight.position.toArray(), target: sunTarget.position.toArray() }), SUN_TILT, lumAlt, frameOnce: () => frame(performance.now()), nightDisc, terrPatch: () => terrPatch, terrUniforms, terr: () => ({ on: terrUniforms.uDemOn.value, dOn: terrUniforms.uDemDOn.value, box: terrUniforms.uDemBox.value.toArray(), key: TERR.boxKey, tiles: terrTiles.size, exag: TERR.exag, linear: TERR.linear }), anaKeys: () => { const K = analemmaKeys(analemmaData()); return K && { hi: anaState.pts[K.hi].lat, lo: anaState.pts[K.lo].lat, aries: K.aries && new Date(anaState.pts[K.aries.k].t).toISOString().slice(0, 10), libra: K.libra && new Date(anaState.pts[K.libra.k].t).toISOString().slice(0, 10), cross: K.cross && { lat: K.cross.lat, d1: new Date(K.cross.t1).toISOString().slice(0, 10), d2: new Date(K.cross.t2).toISOString().slice(0, 10) } }; }, clouds: () => ({ key: CLOUD.key, loading: CLOUD.loading, info: CLOUD.info, ring: { slot: CLOUD.ring.slot, loading: CLOUD.ring.loading, has: !!CLOUD.ring.img }, on: cloudMat.uniforms.uOn.value, vis: cloudMesh.visible }), cloudTick: () => cloudTick(performance.now() + 1e7), cloudBuild: () => cloudBuild(), CLOUD, cloudMat, sat: () => ({ GZ: SAT.GZ, globalDone: SAT.globalDone, globalTotal: SAT.globalTotal, globalFail: SAT.globalFail || 0, queue: SAT.queue.length, active: SAT.active, box: SAT.box, uniforms: { sat: satUniforms.uSatOn.value, global: satUniforms.uGlobalOn.value, detail: satUniforms.uDetailOn.value, box: satUniforms.uBox.value.toArray() } }), satUpdate: () => { controls.update(); const dn = camera.position.distanceTo(controls.target); camera.near = Math.min(0.05, Math.max(0.0004, dn * 0.04)); camera.updateProjectionMatrix(); satUpdate(performance.now() + 1e6); }, controls, chakras: () => (updateChakras(0, 0), chakraParts).map((c) => ({ name: c.name, y: +c.holder.position.y.toFixed(3), r: +c.r.toFixed(3), visible: chakraG.visible })), AURORA_LIVE, measuredKp, ovationLive, ovationBands, geomagPole, drawAurora, snapshot: (q = 0.7) => { updateLabels(); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', q); }, shellsState: () => SHELLS.map((d) => ({ id: d.id, s: d.s(), drawn: d.drawn, visible: d.G.visible, lines: d.lineG.children.length })), stepField: (dt = 0.016) => { updateField3D(dt); fieldReadout(); }, updateAuroraGeometry, AURORA, auroraOval, auroraMeshes: () => ({ real: auroraN, north: auroraFieldN, south: auroraFieldS }), xzToLatLon, FIELD, issFieldAt: (t) => issFieldAt(t), fieldUpdate: (t) => fieldUpdate(t), fieldMode: () => state.fieldMode, setFieldMode: (on) => setFieldMode(on), setTime: (t) => { state.t = t; }, sunAt: (t) => { const v = new THREE.Vector3(); sampleSun(t, v); return v; }, moonAt: (t) => { const v = new THREE.Vector3(); sampleMoon(t, v); return v; }, latLonToXZ: (a, b, y) => latLonToXZ(a, b, y || 0), MI_PER_UNIT, eclipse: () => ({ solar: ECL.info, lunar: ECL.lunarInfo, list: ECL }), sunPos: () => sun.position.clone(), moonPos: () => moon.position.clone(), modelShadowCentre, modelCover, realShadowPoint, realSunMoon, coveredFrac, lunarModel, lunarReal, predictEclipses, realCatalogue, moonLayer, eclipseLimit, solarGeometry, subpoint, MOONLAYER, LUNAR, sky: () => SKY, signOf, issAt: (t) => issAt(t), issSource: () => issSource, camera, controls, setView: (v) => setView(v), issPos: () => issSprite.position.clone(), simTime: () => state.t, issDonut: () => issDonut(), nasaAt: (t) => nasaAt(t), sgp4At: (t, sh) => sgp4At(t, sh), nasaInfo: () => nasa && { start: nasa.start, stop: nasa.stop, dtAfter: nasa.dtAfter, dtBefore: nasa.dtBefore, seamKm: nasa.seamKm, n: nasa.t.length }, parseOEM };
requestAnimationFrame(frame);
