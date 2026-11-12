// Sun, moon and the five classical "wandering stars", computed with astronomy-engine (MIT, Don Cross):
// VSOP87 planets, ELP/MPP02-based moon, IAU 2000B nutation, light-time and aberration corrections.
// Everything is *apparent, of date* (true equator / true ecliptic of the date), the same convention as
// JPL Horizons' apparent RA/Dec and observer ecliptic longitude. Verified against Horizons (see README).

const A = globalThis.Astronomy;
if (!A) throw new Error('astronomy-engine (lib/astronomy.browser.min.js) must load before astro.js');

export const DAY = 86400000;
export const norm360 = (a) => ((a % 360) + 360) % 360;
export const wrap180 = (a) => ((a + 540) % 360) - 180;
const T = (t) => A.MakeTime(new Date(t));

export const PLANETS = [
  { name: 'Mercury', glyph: '☿', color: '#c9c3b6', size: 0.32 },
  { name: 'Venus', glyph: '♀', color: '#fff1c9', size: 0.55 },
  { name: 'Mars', glyph: '♂', color: '#ff7b54', size: 0.42 },
  { name: 'Jupiter', glyph: '♃', color: '#ffd9a0', size: 0.5 },
  { name: 'Saturn', glyph: '♄', color: '#e9cf8a', size: 0.42 },
];

/** Greenwich apparent sidereal time, degrees. */
export const gast = (t) => A.SiderealTime(T(t)) * 15;

/** True obliquity of the ecliptic of date, degrees. */
export const trueObliquity = (t) => A.e_tilt(T(t)).tobl;

/**
 * Apparent geocentric position of a body at time t (ms):
 * ra/dec on the true equator of date (deg), lam/beta on the true ecliptic of date (deg), dist in AU.
 */
export function bodyAt(name, t) {
  const time = T(t);
  const vec = A.GeoVector(A.Body[name], time, true);            // J2000 equator, light-time + aberration
  const eqd = A.EquatorFromVector(A.RotateVector(A.Rotation_EQJ_EQD(time), vec)); // precession + nutation
  const ecl = A.Ecliptic(vec);                                   // true ecliptic of date
  return { ra: norm360(eqd.ra * 15), dec: eqd.dec, lam: norm360(ecl.elon), beta: ecl.elat, dist: eqd.dist };
}

/** Point on the ground directly beneath the body (geocentric latitude = declination, longitude = RA − GAST). */
export function subpoint(name, t) {
  const b = bodyAt(name, t);
  return { lat: b.dec, lon: wrap180(b.ra - gast(t)) };
}

/** Convert a true-ecliptic-of-date direction to the true equator of date (for drawing the zodiac belt). */
export function eclToEqAt(lam, beta, t) {
  const time = T(t);
  const v = A.VectorFromSphere(new A.Spherical(beta, lam, 1), time);
  const eq = A.EquatorFromVector(A.RotateVector(A.Rotation_ECT_EQD(time), v));
  return { ra: norm360(eq.ra * 15), dec: eq.dec };
}

export const SIGNS = [
  ['♈', 'Aries'], ['♉', 'Taurus'], ['♊', 'Gemini'], ['♋', 'Cancer'], ['♌', 'Leo'], ['♍', 'Virgo'],
  ['♎', 'Libra'], ['♏', 'Scorpio'], ['♐', 'Sagittarius'], ['♑', 'Capricorn'], ['♒', 'Aquarius'], ['♓', 'Pisces'],
].map(([g, name]) => ({ glyph: g + '︎', name }));

/** Tropical zodiac sign for an ecliptic longitude of date (0° = March equinox point). */
export function signOf(lam) {
  const l = norm360(lam), i = Math.floor(l / 30);
  return { ...SIGNS[i], deg: l - i * 30, index: i };
}

/** Everything the dashboard needs for time t (ms). */
export function sky(t) {
  const time = T(t);
  const sun = bodyAt('Sun', t), moon = bodyAt('Moon', t), g = gast(t);
  const elong = A.MoonPhase(time);                                // moon − sun ecliptic longitude, 0–360°
  const illum = A.Illumination(A.Body.Moon, time).phase_fraction; // lit fraction of the disc
  const sunRising = bodyAt('Sun', t + 3600e3).dec >= sun.dec, moonRising = bodyAt('Moon', t + 3600e3).dec >= moon.dec; // heading north?
  return {
    t, eps: trueObliquity(t), gmst: g,
    sun: { ...sun, lat: sun.dec, lon: wrap180(sun.ra - g), rising: sunRising },
    moon: { ...moon, lat: moon.dec, lon: wrap180(moon.ra - g), age: elong / 360 * 29.530588, illum, elong, rising: moonRising },
    planets: PLANETS.map((p) => ({ ...p, ...bodyAt(p.name, t) })),
  };
}
