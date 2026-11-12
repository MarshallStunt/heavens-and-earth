// Torus field — the in-world "hub torus" that drives the sun, moon, ISS and aurora when the field mode is on.
//
// Rules (in-world, illustrative — see README "Torus field"):
//  1. One hub torus centred on the North Pole hub at the disc's centre.
//  2. Poloidal flow: field lines rise from the hub, arc outward under the firmament, descend at the ice-wall rim and
//     return inward under the disc.
//  3. Toroidal flow: a twist circling the hub (westward) makes the field helical; the twist is what carries objects
//     round the hub. Angular speed = twistStrength × charge (turns per day).
//  4. Nested flux surfaces ("shells") indexed by s: 0 = magnetic axis, 1 = outermost surface under the firmament.
//  5. Sun and moon ride the same shell → same height, same size. Sun charge 1 → one circuit per 24 h (on average);
//     moon charge 0.966 → slips back ~51 min per day.
//  6. Seasons: the luminary shell is the one whose inner and outer edges sit on the Tropics of Cancer and Capricorn.
//     Over a year the sun travels once round that shell's tube, the way the field circulates: underneath heading north
//     (March equinox), in at the Tropic of Cancer (June), over the top heading south (September), out at the Tropic of
//     Capricorn (December). With the daily circuit that is a helical field line (~365 turns round the hub per tube
//     loop): in and out makes the seasons, up and down plus the twist pulse (rule 6b) make the analemma.
//  6b. Twist pulse: the twist speeds up and slows down twice a year (the equation of time), so the sun runs up to
//     ~16 min ahead of or behind the clock — the analemma's figure-8. The moon rides the same kind of loop, own phase.
//  7. Aurora appears where field lines meet the ground: a ring near the hub (borealis) and a ring near the rim
//     (australis), with intensity = auroraActivity (0–1).
//  8. The ISS rides between inner shells (s weaving issShellRange) ~15.5 times a day → a wavy ground track.
//
// Units are the dashboard's: map units with the pole→ice wall distance = discRadius (10). y is height above the disc.
// The map angle θ is longitude in radians (x = r cos θ, z = −r sin θ), so westward motion is decreasing θ.
// No dependencies; pure functions plus a small closure for phase continuity when the twist changes.

const DAY = 86400000, TAU = Math.PI * 2, D2R = Math.PI / 180;
export const EPOCH = Date.UTC(2000, 0, 1, 12);              // J2000 noon: the charge-1 object is over longitude 0
const EQUINOX = Date.UTC(2000, 2, 20, 7, 35);               // March equinox 2000: breathing phase 0
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);              // a new moon: moon and sun share their angle here

export const FIELD_DEFAULTS = Object.freeze({
  twistStrength: 1.0,            // turns per day of the toroidal flow for a charge-1 object
  sunCharge: 1.0,                // → 1 circuit / 24 h
  moonCharge: 0.966,             // → lags (1 − 0.966) × 1440 ≈ 49 min / day
  issCharge: 1.0,                // ISS drift round the hub (turns per day at twist 1)
  shellRadii: {                  // the outermost shell (s = 1) as an ellipse in the (r, y) plane; inner shells scale by s
    axisRadius: 5.0,             //   magnetic axis distance from the hub (5 = the equator)
    axisHeight: 1.5,             //   magnetic axis height (≈ 1,870 mi): the sun's yearly loop is centred here
    halfWidth: 5.0,              //   reaches from the hub (r = 0) to the ice wall (r = 10)
    halfHeight: 2.09,            //   top ≈ 4,480 mi; the outermost shell stays ≥ 3 % under the firmament everywhere,
                                 //   bottom under the disc (return flow); meets the ground at ~63°N and ~63°S
  },
  displayShells: [0.45, 0.65, 0.85, 1.0],   // drawn besides the luminary shell
  luminaryShell: null,           // null → the shell whose edges are the two tropics (breathingAmplitude / halfWidth)
  equationOfTime: true,          // twist pulse: sun up to ~16 min fast/slow through the year (figure-8 analemma)
  breathingAmplitude: 23.44,     // degrees of latitude the sun's circuit swings either side of the equator
  breathingPeriodDays: 365.25,
  moonBreathingPeriodDays: 365.25,
  moonBreathingPhase: 0.25,      // turns ahead of the sun's breathing
  issShellRange: [0.35, 0.55],
  issWeavesPerDay: 15.5,
  issPoloidalAngleDeg: -30,      // where on its shells the ISS rides (0 = outer side, −90 = underneath)
  auroraActivity: 0.5,           // 0–1
  seasonDay: null,               // day of year 1–365 to freeze the breathing, or null to follow the clock
  discRadius: 10,
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createTorusField(overrides = {}) {
  const cfg = mergeConfig(FIELD_DEFAULTS, overrides);
  const lumShell = () => cfg.luminaryShell ?? (cfg.breathingAmplitude / 180 * cfg.discRadius) / cfg.shellRadii.halfWidth;
  /** Every shell drawn: the luminary shell plus displayShells, inner to outer. */
  const shells = () => [...new Set([lumShell(), ...cfg.displayShells])].sort((a, b) => a - b);
  // phase offsets (radians) so the twist can change without objects jumping
  const phase = { sun: 0, moon: 0, iss: 0 };
  {
    const dn = (NEW_MOON - EPOCH) / DAY;
    phase.moon = TAU * cfg.twistStrength * (cfg.moonCharge - cfg.sunCharge) * dn;   // moon meets the sun at NEW_MOON
  }
  const days = (t) => (t - EPOCH) / DAY;
  const angleOf = (who, charge, t) => phase[who] - TAU * cfg.twistStrength * charge * days(t);

  /** Change config; keeps every object's current angle continuous at time `atTime`. */
  function setConfig(patch, atTime = Date.now()) {
    const before = { sun: angleOf('sun', cfg.sunCharge, atTime), moon: angleOf('moon', cfg.moonCharge, atTime), iss: angleOf('iss', cfg.issCharge, atTime) };
    Object.assign(cfg, mergeConfig(cfg, patch));
    for (const [who, charge] of [['sun', cfg.sunCharge], ['moon', cfg.moonCharge], ['iss', cfg.issCharge]])
      phase[who] += before[who] - angleOf(who, charge, atTime);
    return cfg;
  }

  // ---- geometry ----
  const G = () => cfg.shellRadii;
  /** Shell index s and poloidal angle ψ (0 = outer side, +90° = top) of a point at distance r from the hub, height y. */
  function shellCoords(r, y) {
    const g = G(), u = (r - g.axisRadius) / g.halfWidth, v = (y - g.axisHeight) / g.halfHeight;
    return { s: Math.hypot(u, v), psi: Math.atan2(v, u) };
  }
  /** Position on shell s at hub angle `angle` (map longitude, radians) and poloidal angle psi (radians, default top). */
  function getShellPosition(s, angle, time, psi = Math.PI / 2) {
    const g = G(), r = g.axisRadius + s * g.halfWidth * Math.cos(psi), y = g.axisHeight + s * g.halfHeight * Math.sin(psi);
    return toPoint(r, y, angle);
  }
  /** Position on the top half of shell s at distance r from the hub (used by the sun and moon). */
  function topOfShellAt(s, r, angle) {
    const g = G(), c = clamp((r - g.axisRadius) / (s * g.halfWidth), -1, 1);
    return toPoint(r, g.axisHeight + s * g.halfHeight * Math.sqrt(1 - c * c), angle);
  }
  function toPoint(r, y, angle) {
    const R = cfg.discRadius, x = r * Math.cos(angle), z = -r * Math.sin(angle);
    return { x, y, z, r, theta: angle, lat: 90 - r / R * 180, lon: wrapPi(angle) / D2R, map: { x, z } };
  }

  /** Field direction at a world point: poloidal (hub → up → out → down at the rim → back in underneath) + toroidal (westward). */
  function getFieldVector(x, y, z) {
    const g = G(), r = Math.hypot(x, z), th = Math.atan2(-z, x);
    const u = (r - g.axisRadius) / g.halfWidth, v = (y - g.axisHeight) / g.halfHeight, s = Math.hypot(u, v);
    let pr = v * g.halfWidth, py = -u * g.halfHeight; const pl = Math.hypot(pr, py) || 1; pr /= pl; py /= pl;
    const poloidal = { x: pr * Math.cos(th), y: py, z: -pr * Math.sin(th) };
    const bt = cfg.twistStrength * (g.axisRadius / Math.max(r, 0.25));        // toroidal strength ∝ 1/r
    const toroidal = { x: Math.sin(th) * bt, y: 0, z: Math.cos(th) * bt };    // −θ direction = westward
    const sum = { x: poloidal.x + toroidal.x, y: poloidal.y + toroidal.y, z: poloidal.z + toroidal.z }, n = Math.hypot(sum.x, sum.y, sum.z) || 1;
    return { x: sum.x / n, y: sum.y / n, z: sum.z / n, poloidal, toroidal, s };
  }

  // ---- breathing (seasons) ----
  function breathPhase(t, periodDays, extraTurns) {
    const d = cfg.seasonDay != null ? (cfg.seasonDay - 79.5) : (t - EQUINOX) / DAY;   // day 79.5 ≈ March equinox
    return TAU * (d / periodDays + extraTurns);
  }
  const ringRadius = (ph) => G().axisRadius - (cfg.breathingAmplitude / 180 * cfg.discRadius) * Math.sin(ph);
  const ringRising = (ph) => Math.cos(ph) > 0;   // radius shrinking → moving north
  // poloidal angle on the luminary shell for breathing phase ph: ψ = −ph − 90° (decreasing = the field's circulation):
  // ph 0 (March) underneath, 90° (June) inner edge, 180° (September) over the top, 270° (December) outer edge
  const loopPsi = (ph) => -ph - Math.PI / 2;
  /** Equation of time (minutes, + = sun fast) for the breathing phase's day of year — the twist pulse. */
  function eotMin(t) {
    if (!cfg.equationOfTime) return 0;
    const d = cfg.seasonDay != null ? cfg.seasonDay : 79.5 + ((((t - EQUINOX) / DAY) % 365.25) + 365.25) % 365.25;
    const B = TAU * (d - 81) / 364;
    return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  }

  /** The shell whose inner and outer edges sit at ±maxDec (e.g. the sun's tropics, or the moon's monthly extremes). */
  const shellForDec = (maxDec) => (maxDec / 180 * cfg.discRadius) / G().halfWidth;
  /** Point on a body's yearly/monthly loop given where it is overhead and which way it is heading (northbound → underneath,
   *  southbound → over the top: the field's circulation). Used when the field is paced by the real sky. */
  function onLoop(shell, lat, lon, northbound, cAcross) {
    const g = G(), r = (90 - lat) / 180 * cfg.discRadius, c = clamp(cAcross ?? (r - g.axisRadius) / (shell * g.halfWidth), -1, 1);
    return toPoint(r, g.axisHeight + (northbound ? -1 : 1) * shell * g.halfHeight * Math.sqrt(1 - c * c), lon * D2R);
  }

  // ---- bodies ----
  function sunAt(t) {
    const ph = breathPhase(t, cfg.breathingPeriodDays, 0), s = lumShell(), eot = eotMin(t);
    const p = getShellPosition(s, angleOf('sun', cfg.sunCharge, t) - eot / 1440 * TAU, t, loopPsi(ph));   // fast sun → further west
    return { ...p, shell: s, rising: ringRising(ph), ringRadius: ringRadius(ph), eotMin: eot, loopDeg: ((ph / D2R) % 360 + 360) % 360 };
  }
  function moonAt(t) {
    const ph = breathPhase(t, cfg.moonBreathingPeriodDays, cfg.moonBreathingPhase), th = angleOf('moon', cfg.moonCharge, t), s = lumShell();
    const p = getShellPosition(s, th, t, loopPsi(ph));
    const synodic = 1 / Math.max(1e-6, cfg.twistStrength * Math.abs(cfg.sunCharge - cfg.moonCharge));
    const frac = (((angleOf('sun', cfg.sunCharge, t) - th) / TAU) % 1 + 1) % 1;     // 0 = new, 0.5 = full
    return { ...p, shell: s, rising: ringRising(ph), ringRadius: ringRadius(ph), age: frac * synodic, synodicDays: synodic, illum: (1 - Math.cos(TAU * frac)) / 2 };
  }
  function issAt(t) {
    const [a, b] = cfg.issShellRange, s = (a + b) / 2 + (b - a) / 2 * Math.sin(TAU * cfg.issWeavesPerDay * days(t));
    const p = getShellPosition(s, angleOf('iss', cfg.issCharge, t), t, cfg.issPoloidalAngleDeg * D2R);
    return { ...p, shell: s };
  }
  /** Where the outermost shell meets the ground (y = 0): the borealis ring near the hub and the australis ring near the rim. */
  function auroraRings() {
    const g = G(), v = -g.axisHeight / g.halfHeight;
    if (Math.abs(v) >= 1) return { north: 0.6, south: cfg.discRadius - 0.6 };
    const u = Math.sqrt(1 - v * v);
    return { north: g.axisRadius - g.halfWidth * u, south: g.axisRadius + g.halfWidth * u };
  }
  function update(time) {
    return { sun: sunAt(time), moon: moonAt(time), iss: issAt(time), aurora: { intensity: clamp(cfg.auroraActivity, 0, 1), rings: auroraRings() } };
  }
  /** Poloidal loop (one side, r > 0) for shell s as [r, y] points, ordered with the flow: up the hub side, out, down, back in. */
  function poloidalLoop(s, n = 160) {
    const g = G(), pts = [];
    for (let i = 0; i <= n; i++) { const psi = Math.PI - i / n * TAU; pts.push([g.axisRadius + s * g.halfWidth * Math.cos(psi), g.axisHeight + s * g.halfHeight * Math.sin(psi)]); }
    return pts;
  }

  return { config: cfg, setConfig, getFieldVector, getShellPosition, topOfShellAt, shellCoords, update, sunAt, moonAt, issAt, auroraRings, poloidalLoop, angleOf, shells, luminaryShell: lumShell, eotMin, onLoop, shellForDec };
}

function mergeConfig(base, patch) {
  const out = { ...base, ...patch };
  out.shellRadii = { ...base.shellRadii, ...(patch.shellRadii || {}) };
  out.issShellRange = [...(patch.issShellRange || base.issShellRange)];
  out.displayShells = [...(patch.displayShells || base.displayShells)];
  return out;
}
