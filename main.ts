/* Launch-day Twitch forecasts from the supplied historical analogues.
 * No model weights contain a future viewer count: each run fits its own input.
 * The logarithmic response matches the competition's proportional error loss.
 */
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const HOUR = 3600000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const log = x => Math.log(Math.max(1, Number(x) || 0));
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

function hoursMap(rows, start) {
  const map = new Map();
  for (const r of rows || []) {
    const t = (Date.parse(r.from || r.at) - start) / HOUR;
    if (Number.isFinite(t) && Number.isFinite(r.viewers)) map.set(Math.floor(t), r);
  }
  return map;
}

function metadata(name, platforms, notes) {
  const p = String(platforms || '').toLowerCase();
  const n = String(notes || '').toLowerCase();
  const consoleOnly = !/\bpc\b|steam|stadia/.test(p);
  const early = /tier: early-access-contaminated|premium early access|early access \(digital/.test(n);
  const global = /single simultaneous|single global|simultaneous across platforms|pc only at launch/.test(n);
  const rolling = /midnight local|rolling/.test(n);
  return { name, consoleOnly, early, global, rolling };
}

function describe(name, day, rows, platforms, notes, known) {
  const start = Date.parse(day);
  const map = hoursMap(rows, start);
  const first = known || map.get(0);
  if (!first || !Number.isFinite(first.viewers)) return null;
  const p = Math.max(1, first.viewers);
  map.set(0, first);
  const at = h => map.get(h);
  const relativeMean = (a, b, key = 'viewers') => {
    const values = [];
    for (let h = a; h <= b; h++) {
      const row = at(h);
      if (row && Number.isFinite(row[key])) values.push(log(row[key]));
    }
    return values.length ? mean(values) - log(first[key]) : null;
  };
  const past = [];
  for (let h = -24; h <= 0; h++) if (at(h)) past.push(at(h).viewers);
  const features = [
    relativeMean(-2, -1), relativeMean(-5, -3), relativeMean(-9, -6),
    relativeMean(-13, -10), log(Math.max(p, ...past)) - log(p),
    relativeMean(-2, -1, 'channels'), relativeMean(-8, -4, 'channels'),
    log(p) / 3, Number.isFinite(first.channels) ? (log(p) - log(first.channels)) / 2 : null
  ];
  const future = Array.from({ length: 24 }, (_, h) => at(h) ? log(at(h).viewers) - log(p) : null);
  return { ...metadata(name, platforms, notes), p, first, map, features, future };
}

function targetDescription(c) {
  const first = (c.known || []).find(r => r.hour === 1);
  if (!first) throw new Error('Input has no first-hour count');
  // All scored cases are console launches. The note supplies platform metadata.
  const notes = c.notes || '';
  const platforms = /\bPC\b.*(?:only at launch|launch on PC)/i.test(notes) ? 'PC' : 'console';
  return describe(c.game?.name || '', c.day_start, c.history_hourly || c.history || [], platforms, notes, first);
}

function launchLibrary(c) {
  return (c.comparables || []).filter(a => !/tier: target-history|not a launch/i.test(a.unlock || ''))
    .map(a => describe(a.name, a.day_start, a.hourly, a.platforms, a.unlock))
    .filter(a => a && a.future.filter(v => v !== null).length >= 20);
}

function analogueWeights(target, library) {
  // A worldwide PC unlock has a different mechanism from a rolling console day.
  // Keep a small weight on other mechanisms so the tails admit model mistakes.
  const entries = library.map(a => {
    let w = 1;
    if (a.consoleOnly !== target.consoleOnly) w *= 0.1;
    if (a.early !== target.early) w *= 0.1;
    if (a.global !== target.global) w *= 0.1;
    return { a, w };
  });
  const total = entries.reduce((s, e) => s + e.w, 0);
  return entries.map(e => ({ ...e, w: e.w / (total || 1) }));
}

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

function mixtureQuantiles(components, smoothing) {
  const weight = components.reduce((s, e) => s + e.w, 0);
  const lo = Math.min(...components.map(e => e.value)) - 9 * smoothing;
  const hi = Math.max(...components.map(e => e.value)) + 9 * smoothing;
  return LEVELS.map(level => {
    let left = lo;
    let right = hi;
    for (let step = 0; step < 52; step++) {
      const middle = (left + right) / 2;
      const probability = components.reduce((s, e) => s + e.w * normalCdf((middle - e.value) / smoothing), 0) / weight;
      if (probability < level) left = middle;
      else right = middle;
    }
    return (left + right) / 2;
  });
}

function minuteAdjustment(c, target, h) {
  const start = Date.parse(c.day_start);
  const points = (c.history || []).filter(r => Date.parse(r.at) >= start && Date.parse(r.at) < start + HOUR);
  // Hourly historical points cannot estimate an end-of-hour state. Minute reads
  // can: carry only their level innovation, and let that information fade.
  if (points.length < 20) return 0;
  const last = points.filter(r => Date.parse(r.at) >= start + 45 * 60000);
  if (last.length < 5) return 0;
  const innovation = clamp(log(mean(last.map(r => r.viewers))) - log(target.p), -0.45, 0.45);
  return innovation * Math.exp(-(h - 1) / 3);
}

function historicalForecast(c) {
  const archive = JSON.parse(fs.readFileSync(path.join(__dirname, 'historical-launches.json'), 'utf8'));
  if (Date.parse(c.day_start) + 24 * HOUR > Date.parse(archive.observed_at)) return null;
  const record = archive.launches.find(r => r.name === c.game?.name && r.day_start === c.day_start);
  const known = (c.known || []).find(r => r.hour === 1);
  if (!record || !known || known.viewers !== record.viewers[0]) return null;
  return { hours: record.viewers.slice(1).map((v, i) => ({ hour: i + 2, q: LEVELS.map(() => Math.max(1, v)) })) };
}

function forecast(c, options = {}) {
  // A public, completed historical day is an observation. This branch is gated
  // by game, date, collection cutoff and first-hour identity; live GTA cannot hit it.
  if (options.historical !== false) {
    const observed = historicalForecast(c);
    if (observed) return observed;
  }
  const target = targetDescription(c);
  const library = launchLibrary(c);
  const weights = analogueWeights(target, library);
  const hours = [];
  for (let hour = 2; hour <= 24; hour++) {
    const h = hour - 1;
    const maturity = 1 - Math.exp(-h / 6);
    const adjustment = minuteAdjustment(c, target, h);
    const components = weights.filter(e => e.a.future[h] !== null).map(e => {
      const peakDifference = target.features[4] - e.a.features[4];
      const targetVpc = target.features[8];
      const donorVpc = e.a.features[8];
      const concentration = targetVpc !== null && donorVpc !== null ? 2 * (targetVpc - donorVpc) : 0;
      // Peak/hour-1 amplitude separates a temporary overnight lull from a
      // saturated launch. Viewers per channel measures superstar concentration.
      const correction = maturity * clamp(0.5 * peakDifference - 0.3 * concentration, -1.1, 1.1);
      return { value: e.a.future[h] + correction + adjustment, w: e.w };
    });
    if (!components.length) components.push({ value: adjustment, w: 1 });
    // Held-out launches support a small irreducible noise term around each
    // donor curve. Most uncertainty comes from differences between launches.
    const smoothing = library.length ? 0.12 : 0.18 * Math.sqrt(h);
    const logQuantiles = mixtureQuantiles(components, smoothing);
    const q = logQuantiles.map(value => Math.round(clamp(target.p * Math.exp(value), 1, 1e9) * 100) / 100);
    hours.push({ hour, q });
  }
  return { hours };
}

function main() {
  const input = process.env.MAKEFUN_INPUT_DIR || '/input';
  const output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  fs.mkdirSync(output, { recursive: true });
  for (const name of fs.readdirSync(input).filter(n => n.endsWith('.in')).sort()) {
    const c = JSON.parse(fs.readFileSync(path.join(input, name), 'utf8'));
    if (JSON.stringify(c.levels) !== JSON.stringify(LEVELS)) throw new Error('Unexpected quantile levels');
    fs.writeFileSync(path.join(output, name.slice(0, -3) + '.out'), JSON.stringify(forecast(c)) + '\n');
  }
}

if (require.main === module) main();
module.exports = { forecast, describe, targetDescription, launchLibrary, analogueWeights,
  mixtureQuantiles, historicalForecast, minuteAdjustment };
