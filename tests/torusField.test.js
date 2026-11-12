// Torus field test checklist (runs in the browser; no dependencies). The feature-flag check needs the dashboard and is
// run there via window.__firmament (see README, "Torus field → Tests").
import { createTorusField, FIELD_DEFAULTS } from '../torusField.js';

const out = document.getElementById('out'), results = [];
const HOUR = 3600e3, DAY = 86400e3, TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function check(name, pass, detail) { results.push(pass); const li = document.createElement('li'); li.className = pass ? 'ok' : 'bad'; li.innerHTML = `${name} <small>${detail}</small>`; out.appendChild(li); }

const t0 = Date.UTC(2026, 10, 10, 0, 0);

// 1. Sun: one circuit per 24 h (exactly, without the twist pulse; within seconds a day with it)
{
  const F = createTorusField({ equationOfTime: false });
  const a0 = F.sunAt(t0).theta, a12 = F.sunAt(t0 + 12 * HOUR).theta, a24 = F.sunAt(t0 + 24 * HOUR).theta;
  const back = Math.abs(wrap(a24 - a0)), half = Math.abs(Math.abs(wrap(a12 - a0)) - Math.PI);
  const noon = F.sunAt(Date.UTC(2026, 10, 10, 12)).lon;
  const E = createTorusField(), drift = Math.abs(wrap(E.sunAt(t0 + 24 * HOUR).theta - E.sunAt(t0).theta)) / TAU * 86400;
  check('Sun completes 1 orbit per 24 h', back < 1e-9 && half < 1e-9 && Math.abs(noon) < 1e-6 && drift < 40,
    `back to start after 24 h (Δ ${back.toExponential(1)} rad), opposite after 12 h, over longitude ${noon.toFixed(3)}° at 12:00 UTC; with the twist pulse a day differs by ${drift.toFixed(0)} s`);
}
// 2. Moon lags ~50 min/day
{
  const F = createTorusField(), a0 = F.moonAt(t0).theta;
  let lo = 23 * HOUR, hi = 26 * HOUR;   // time for the moon to come back to the same angle
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; wrap(F.moonAt(t0 + m).theta - a0) > 0 ? (lo = m) : (hi = m); }
  const lag = (lo - 24 * HOUR) / 60000, m = F.moonAt(t0);
  check('Moon lags ~50 min/day', lag > 45 && lag < 55, `returns after ${(lo / HOUR).toFixed(3)} h → ${lag.toFixed(1)} min later each day; synodic month ${m.synodicDays.toFixed(2)} d`);
}
// 3. Seasonal ring shift
{
  const F = createTorusField();
  const jun = F.sunAt(Date.UTC(2026, 5, 21, 12)).lat, dec = F.sunAt(Date.UTC(2026, 11, 21, 12)).lat, mar = F.sunAt(Date.UTC(2026, 2, 20, 12)).lat, sep = F.sunAt(Date.UTC(2026, 8, 19, 6)).lat;   // a sine breathes symmetrically: half a year after the March equinox
  const okClock = Math.abs(jun - 23.44) < 0.6 && Math.abs(dec + 23.44) < 0.6 && Math.abs(mar) < 0.6 && Math.abs(sep) < 0.6;
  F.setConfig({ seasonDay: 172 }, t0); const frozen = F.sunAt(t0).lat, frozen2 = F.sunAt(t0 + 40 * DAY).lat;
  check('Seasonal ring shift works', okClock && Math.abs(frozen - 23.44) < 0.6 && frozen === frozen2,
    `ring latitude: Mar ${mar.toFixed(2)}°, Jun ${jun.toFixed(2)}° (inner), Sep 19 ${sep.toFixed(2)}°, Dec ${dec.toFixed(2)}° (outer); season slider day 172 → ${frozen.toFixed(2)}°, frozen`);
}
// 4. Aurora responds to activity
{
  const F = createTorusField(), vals = [0, 0.25, 0.5, 1].map((a) => { F.setConfig({ auroraActivity: a }, t0); return F.update(t0).aurora.intensity; });
  const rings = F.auroraRings();
  check('Aurora rings respond to the activity slider', vals.join() === '0,0.25,0.5,1' && rings.north < rings.south,
    `intensity ${vals.join(' → ')}; rings at r ${rings.north.toFixed(2)} (borealis, near the hub) and ${rings.south.toFixed(2)} (australis, near the rim)`);
}
// 5. ISS wavy track
{
  const F = createTorusField(); let peaks = 0, prev = F.issAt(t0).shell, rising = true, rMin = Infinity, rMax = 0;
  for (let i = 1; i <= 1440; i++) { const q = F.issAt(t0 + i * 60000); if (q.shell < prev && rising) peaks++; rising = q.shell > prev; prev = q.shell; rMin = Math.min(rMin, q.r); rMax = Math.max(rMax, q.r); }
  const [a, b] = FIELD_DEFAULTS.issShellRange;
  check('ISS shows a wavy track', peaks >= 15 && peaks <= 16 && rMax - rMin > 0.2,
    `${peaks} weaves in 24 h between shells ${a}–${b}; ground distance from the hub swings ${rMin.toFixed(2)}–${rMax.toFixed(2)}`);
}
// 6. Field vector directions
{
  const F = createTorusField(), g = FIELD_DEFAULTS.shellRadii;
  const hub = F.getFieldVector(1, g.axisHeight, 0), rim = F.getFieldVector(9, g.axisHeight, 0), top = F.getFieldVector(g.axisRadius, g.axisHeight + 1, 0), under = F.getFieldVector(g.axisRadius, g.axisHeight - 1, 0);
  const ok = hub.poloidal.y > 0.99 && rim.poloidal.y < -0.99 && top.poloidal.x > 0.99 && under.poloidal.x < -0.99 && top.toroidal.z > 0;
  check('Field flows up the hub, out under the firmament, down at the rim, back underneath; twist westward', ok,
    `hub ↑ ${hub.poloidal.y.toFixed(2)}, rim ↓ ${rim.poloidal.y.toFixed(2)}, top → ${top.poloidal.x.toFixed(2)}, underneath ← ${under.poloidal.x.toFixed(2)}`);
}
// 7. Changing the twist doesn't make objects jump
{
  const F = createTorusField({ equationOfTime: false }), before = F.sunAt(t0).theta; F.setConfig({ twistStrength: 2 }, t0); const after = F.sunAt(t0).theta, a24 = F.sunAt(t0 + 12 * HOUR).theta;
  check('Twist slider keeps positions continuous', Math.abs(wrap(after - before)) < 1e-9 && Math.abs(wrap(a24 - after)) < 1e-9, 'same angle at the moment of change; twist ×2 → one circuit per 12 h');
}
// 8. Sun and moon on the same shell (same height rule)
{
  const F = createTorusField(), s = F.sunAt(t0), m = F.moonAt(t0), LS = F.luminaryShell();
  const onShell = (p) => { const c = F.shellCoords(p.r, p.y); return Math.abs(c.s - LS) < 1e-9; };
  check('Sun and moon ride the same shell', onShell(s) && onShell(m), `both at s ${LS.toFixed(3)} (edges on the two tropics): sun ${s.y.toFixed(3)}, moon ${m.y.toFixed(3)} units high`);
}
// 9. Up and down, in and out: the yearly loop, and the analemma (same clock time every day)
{
  const F = createTorusField(), at = (m, d) => F.sunAt(Date.UTC(2026, m, d, 12));
  const mar = at(2, 20), jun = at(5, 21), sep = at(8, 19), dec = at(11, 21), axisY = FIELD_DEFAULTS.shellRadii.axisHeight;
  const loopOK = mar.y < axisY - 0.5 && sep.y > axisY + 0.5 && Math.abs(jun.y - axisY) < 0.1 && Math.abs(dec.y - axisY) < 0.1 && jun.lat > 23 && dec.lat < -23;
  const pts = []; for (let d = 0; d < 365; d++) pts.push(F.sunAt(Date.UTC(2026, 0, 1, 12) + d * DAY));
  const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat), ys = pts.map((p) => p.y);
  let crossings = 0; for (let i = 1; i < pts.length; i++) if (Math.sign(lons[i]) !== Math.sign(lons[i - 1])) crossings++;   // the 8 crosses the noon line 4 times a year
  const mi = 1248;
  check('Sun goes up/down and in/out between the tropics, tracing an analemma', loopOK && Math.max(...lats) > 23.3 && Math.min(...lats) < -23.3 && crossings >= 4,
    `Mar underneath ${(mar.y * mi).toFixed(0)} mi, Jun inner ${jun.lat.toFixed(1)}°, Sep over the top ${(sep.y * mi).toFixed(0)} mi, Dec outer ${dec.lat.toFixed(1)}°; noon positions swing ${Math.min(...lons).toFixed(1)}° to +${Math.max(...lons).toFixed(1)}° east–west (equation of time), height ${(Math.min(...ys) * mi).toFixed(0)}–${(Math.max(...ys) * mi).toFixed(0)} mi`);
}
const pass = results.filter(Boolean).length;
document.getElementById('sum').textContent = `${pass} / ${results.length} passed`;
window.__fieldTests = { pass, total: results.length };
